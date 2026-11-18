import { afterEach, expect, test, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { openDatabase } from "../server/database";
import { highService } from "../lib/highs";
import { parseHighMessage } from "../lib/high-message";
import { createApi } from "../server/api";
import type { Company } from "../lib/market";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));
const company = (corpCode: string, stockCode: string, name: string, market: Company["market"] = "KOSDAQ"): Company => ({ corpCode, stockCode, name, market, closingMonth: 12 });
const companies = [company("01693922", "446840", "지슨"), company("00945776", "289860", "지슨", null),
  company("00962223", "263860", "지니언스"), company("01408999", "336060", "웨이버스"),
  company("00347734", "051630", "진양화학", "KOSPI"), company("00175623", "050120", "ES큐브"),
  company("00545716", "089860", "롯데렌탈", "KOSPI"), company("00306719", "069510", "에스텍")];
const message = "보안) 지슨, 지니언스 (호실적) 웨이버스 (오세훈) 진양화학 (동전주/시총500억이하) Es큐브, 웨이버스 (기타) 옵토닉스-신규상장 롯데렌탈-매각 (몰루) 에스텍";
function database(catalog = companies, profiles = companies) {
  const database = openDatabase(":memory:"); databases.push(database);
  database.sql.prepare("INSERT INTO corp_directory VALUES (1,?,?)").run(JSON.stringify(catalog), Date.now() - 60_000);
  for (const profile of profiles) database.sql.prepare("INSERT INTO companies VALUES (?,?,?,?)").run(profile.corpCode, profile.stockCode, profile.name.toLowerCase(), JSON.stringify(profile));
  return database;
}

test("parses the supplied Telegram format, preserving categories, repeats and inline notes", () => {
  const parsed = parseHighMessage(message, companies);
  expect(parsed).toHaveLength(9);
  expect(parsed.filter(row => row.name === "웨이버스").map(row => row.categories)).toEqual([["호실적"], ["동전주/시총500억이하"]]);
  expect(parsed.find(row => row.name === "Es큐브")?.candidates[0].name).toBe("ES큐브");
  expect(parsed.find(row => row.name === "옵토닉스")).toMatchObject({ notes: ["신규상장"], categories: ["기타"], candidates: [] });
  expect(parsed.find(row => row.name === "롯데렌탈")?.notes).toEqual(["매각"]);
});

test("merges duplicate issuers and selects the listed namesake using cached profiles, without API calls", async () => {
  const store = database(); const network = vi.fn(async () => { throw new Error("must use cache"); });
  const result = await highService(store.db, "", network).analyze(message);
  expect(result.rows).toHaveLength(7);
  expect(result.rows.find(row => row.company.name === "지슨")?.company.stockCode).toBe("446840");
  expect(result.rows.find(row => row.company.name === "웨이버스")?.categories).toEqual(["호실적", "동전주/시총500억이하"]);
  expect(result.issues).toMatchObject([{ input: "옵토닉스", status: "unmatched", notes: ["신규상장"] }]);
  expect(network).not.toHaveBeenCalled();
  expect(store.sql.prepare("SELECT COUNT(*) AS n FROM watchlist").get()?.n).toBe(0);
});

test("two genuinely listed namesakes stay ambiguous instead of choosing the first code", async () => {
  const namesakes = companies.slice(0, 2).map(item => ({ ...item, market: "KOSDAQ" as const }));
  const store = database(namesakes, namesakes);
  const result = await highService(store.db, "", vi.fn()).analyze("지슨");
  expect(result.rows).toEqual([]);
  expect(result.issues[0]).toMatchObject({ status: "ambiguous", choices: expect.any(Array) });
  expect(result.issues[0].choices).toHaveLength(2);
});

test("matches full names and codes, supports spaced names, and never uses substring matches or mismatched codes", () => {
  const catalog = [company("00126380", "005930", "삼성전자"), company("00164779", "000660", "SK하이닉스"),
    company("00306719", "069510", "에스텍"), company("00111111", "041910", "에스텍파마")];
  const parsed = parseHighMessage("52주 신고가\n2026.11.17\n삼성전자(000660), SK 하이닉스, 에스텍파마, 에스텍파마텍, 005930\nhttps://example.com/000660", catalog);
  expect(parsed).toHaveLength(5);
  expect(parsed[0].conflict).toBe(true);
  expect(parsed[0].candidates).toEqual([]);
  expect(parsed[1].candidates[0].stockCode).toBe("000660");
  expect(parsed[2].candidates[0].stockCode).toBe("041910");
  expect(parsed[3].candidates).toEqual([]);
  expect(parsed[4].candidates[0].name).toBe("삼성전자");
  expect(parseHighMessage("틀린이름(005930)", catalog)[0].conflict).toBe(true);
});

test("refreshes the directory explicitly, caches newly verified profiles, and never sends the pasted message upstream", async () => {
  const store = database([], []);
  const newcomer = company("12345678", "123450", "새기업");
  const network = vi.fn(async (path: string) => {
    if (path === "corpCode.xml") {
      const bytes = zipSync({ "CORPCODE.xml": strToU8("<result><list><corp_code>12345678</corp_code><corp_name>새기업</corp_name><stock_code>123450</stock_code></list></result>") });
      return new Response(bytes);
    }
    return Response.json({ status: "000", corp_name: "새기업", stock_name: "새기업", stock_code: "123450", corp_cls: "K", acc_mt: "12" });
  });
  const service = highService(store.db, "test-key", network);
  const input = "(내가 기록한 비공개 분류) 새기업-메모";
  expect((await service.analyze(input)).issues[0].status).toBe("unmatched");
  expect(network).not.toHaveBeenCalled();
  expect((await service.analyze(input, true)).rows[0].company).toEqual(newcomer);
  expect(network.mock.calls.map(call => call[0])).toEqual(["corpCode.xml", "company.json"]);
  expect(JSON.stringify(network.mock.calls)).not.toContain("비공개");
  await service.analyze(input);
  expect(network).toHaveBeenCalledTimes(2);
  await expect(service.analyze(input, true)).rejects.toMatchObject({ httpStatus: 429 });
});

test("partial network failure preserves cached matches and stops repeated failing upstream calls", async () => {
  const store = database(companies, [companies[2]]);
  const network = vi.fn(async () => { throw new Error("sensitive upstream URL"); });
  const result = await highService(store.db, "test-key", network).analyze("지니언스, 웨이버스, 진양화학");
  expect(result.rows.map(row => row.company.name)).toEqual(["지니언스"]);
  expect(result.issues.map(row => row.status)).toEqual(["failed", "failed"]);
  expect(network).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain("sensitive");
});

test("rejects invalid API bodies and oversized messages before fetching any corporate profiles", async () => {
  const store = database(); const network = vi.fn(); const api = createApi(store.db, "", network);
  const url = new URL("http://localhost/api/highs");
  for (const body of [null, [], { text: 5 }, { text: "지슨", refresh: "yes" }, { text: "" }, { text: "가".repeat(20_001) }]) {
    expect((await api(url, "POST", body)).status).toBe(400);
  }
  const many = Array.from({ length: 101 }, (_, i) => company(String(i + 1).padStart(8, "0"), String(i + 1).padStart(6, "0"), "기업" + i));
  const bulk = database(many, []);
  await expect(highService(bulk.db, "", network).analyze(many.map(item => item.name).join(","))).rejects.toMatchObject({ httpStatus: 400 });
  expect(network).not.toHaveBeenCalled();
  expect(() => parseHighMessage(Array(301).fill("005930").join(","), [])).toThrow("300개");
});
