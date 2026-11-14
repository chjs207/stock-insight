import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get as httpGet } from "node:http";
import { openDatabase } from "../server/database";
import { readConfiguration } from "../server/config";
import { createApi } from "../server/api";
import { httpApplication } from "../server/http";
import { importData } from "../server/import-data";
import { emptyReport } from "../lib/market";

const paths: string[] = [];
async function folder() { const path = await mkdtemp(join(tmpdir(), "stock-local-")); paths.push(path); return path; }
afterEach(async () => { for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true }); });
const company = { corpCode: "00126380", stockCode: "005930", name: "삼성전자", market: "KOSPI", closingMonth: 12 };
function seed(database: ReturnType<typeof openDatabase>) {
  database.sql.prepare("INSERT INTO companies VALUES (?, ?, ?, ?)").run(company.corpCode, company.stockCode, "삼성전자", JSON.stringify(company));
}
const url = (query: string) => new URL("http://127.0.0.1/api/market?corp=" + company.corpCode + query);

test("configuration reads only the project .env and rejects missing or sample credentials", async () => {
  const root = await folder();
  expect(() => readConfiguration(root)).toThrow(".env.example");
  await writeFile(join(root, ".env"), "DART_API_KEY=your_key\nKIWOOM_APP_KEY=\nKIWOOM_APP_SECRET=\n");
  expect(() => readConfiguration(root)).toThrow("DART_API_KEY");
  await writeFile(join(root, ".env"), "DART_API_KEY=dart-private-test\nKIWOOM_APP_KEY=kiwoom-private-test\nKIWOOM_APP_SECRET=secret-private-test\nPORT=4180\n");
  expect(readConfiguration(root)).toMatchObject({ dartKey: "dart-private-test", host: "127.0.0.1", port: 4180 });
  expect(readConfiguration(root, true).host).toBe("0.0.0.0");
});

test("financial and chart caches survive server restart without external API calls", async () => {
  const file = join(await folder(), "app.sqlite");
  const first = openDatabase(file); seed(first);
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date())) - 1;
  for (let fiscalYear = year - 4; fiscalYear <= year; fiscalYear++) {
    const report = { ...emptyReport(fiscalYear), basis: "CFS", currency: "KRW", amounts: { revenue: "100", operating: "20", net: "15", parentNet: "12" } };
    first.sql.prepare("INSERT INTO annual_reports VALUES (?, ?, ?, ?)").run(company.corpCode, fiscalYear, JSON.stringify(report), Date.now());
  }
  const candles = [{ time: "2026-11-13", open: 100, high: 120, low: 90, close: 110, volume: 20 }];
  first.sql.prepare("INSERT INTO price_history VALUES (?, ?, ?)").run(company.stockCode, Date.now(), JSON.stringify(candles));
  first.sql.prepare("INSERT INTO watchlist VALUES (?, ?)").run(company.corpCode, Date.now()); first.close();
  const second = openDatabase(file);
  try {
    const network = vi.fn(async () => { throw new Error("must not call upstream"); });
    const api = createApi(second.db, "test-key", network);
    expect(await (await api(url(""), "GET")).json()).toMatchObject({ source: "DB", reports: expect.any(Array) });
    expect(await (await api(url("&chart=1"), "GET")).json()).toMatchObject({ candles, source: "DB", stale: false });
    expect(await (await api(new URL("http://localhost/api/watchlist"), "GET")).json()).toMatchObject({ companies: [company] });
    expect(network).not.toHaveBeenCalled();
  } finally { second.close(); }
});

test("a failed Kiwoom refresh retains stored candles and returns a clear warning", async () => {
  const database = openDatabase(":memory:"); seed(database);
  try {
    const candles = [{ time: "2026-11-13", open: 100, high: 120, low: 90, close: 110, volume: 20 }];
    const timestamp = Date.now() - 3600_000;
    database.sql.prepare("INSERT INTO price_history VALUES (?, ?, ?)").run(company.stockCode, timestamp, JSON.stringify(candles));
    const network = vi.fn(async () => Response.json({ error: "키움 허용 IP를 확인해 주세요." }, { status: 503 }));
    const api = createApi(database.db, "test-key", network);
    expect(await (await api(url("&chart=1&refresh=1"), "GET")).json()).toMatchObject({ candles, fetchedAt: timestamp, source: "DB", stale: true, warning: expect.stringContaining("IP") });
    expect(database.sql.prepare("SELECT fetched_at FROM price_history").get()?.fetched_at).toBe(timestamp);
  } finally { database.close(); }
});

test("HTTP serves only built assets and rejects file disclosure and cross-site API use", async () => {
  const dist = await folder(); await mkdir(join(dist, "assets")); await writeFile(join(dist, "index.html"), "<h1>Stock Insight</h1>");
  await writeFile(join(dist, "assets", "app.js"), "console.log('app')");
  const api = vi.fn(async () => Response.json({ configured: true }));
  const { server } = httpApplication(api, { port: 0, lan: false, dist });
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
  const port = (server.address() as { port: number }).port; const base = "http://127.0.0.1:" + port;
  try {
    expect((await fetch(base + "/")).status).toBe(200);
    expect((await fetch(base + "/assets/app.js")).status).toBe(200);
    for (const path of ["/.env", "/.local/stock-insight.sqlite", "/data/catalog.json", "/server/config.ts"]) expect((await fetch(base + path)).status).toBe(404);
    expect((await fetch(base + "/api/market?status=1", { headers: { Origin: "https://untrusted.example" } })).status).toBe(403);
    const rejectedHost = await new Promise<number | undefined>((accept, reject) => {
      httpGet(base + "/api/market?status=1", { headers: { Host: "untrusted.example:" + port } }, response => {
        response.resume(); accept(response.statusCode);
      }).once("error", reject);
    });
    expect(rejectedHost).toBe(403);
    expect(api).not.toHaveBeenCalled();
    expect((await fetch(base + "/api/market?status=1")).status).toBe(200);
    expect(api).toHaveBeenCalledTimes(1);
    expect((await fetch(base + "/api/giants?manager=test", { method: "DELETE", headers: { Origin: "https://untrusted.example" } })).status).toBe(403);
    expect(api).toHaveBeenCalledTimes(1);
    expect((await fetch(base + "/api/giants?manager=test", { method: "DELETE" })).status).toBe(200);
    expect(api).toHaveBeenLastCalledWith(new URL(base + "/api/giants?manager=test"), "DELETE");
    expect((await fetch(base + "/api/research?page=0")).status).toBe(200);
    expect(api).toHaveBeenLastCalledWith(new URL(base + "/api/research?page=0"), "GET");
    expect((await fetch(base + "/api/research", { method: "POST" })).status).toBe(405);
  } finally { server.closeIdleConnections(); await new Promise<void>(accept => server.close(() => accept())); }
});

test("imports legacy SQLite records and merges newer JSON cache without losing the watchlist", async () => {
  const root = await folder(); const sourcePath = join(root, "old.sqlite");
  const source = openDatabase(sourcePath); seed(source);
  source.sql.prepare("INSERT INTO watchlist VALUES (?, ?)").run(company.corpCode, 1);
  source.sql.prepare("INSERT INTO annual_reports VALUES (?, ?, ?, ?)").run(company.corpCode, 2025, JSON.stringify(emptyReport(2025)), 1); source.close();
  const target = openDatabase(":memory:");
  try {
    expect(importData(target.sql, sourcePath).watchlist).toBe(1);
    const file = join(root, "cache.json");
    await writeFile(file, JSON.stringify({ version: 1, tables: { annual_reports: [{ corp_code: company.corpCode, year: 2025, data: JSON.stringify({ ...emptyReport(2025), amounts: { revenue: "200", operating: "40", net: "30", parentNet: "20" } }), fetched_at: 2 }] } }));
    expect(importData(target.sql, file).annual_reports).toBe(1);
    expect(target.sql.prepare("SELECT COUNT(*) AS n FROM watchlist").get()?.n).toBe(1);
    expect(JSON.parse(String(target.sql.prepare("SELECT data FROM annual_reports").get()?.data)).amounts.parentNet).toBe("20");
  } finally { target.close(); }
});
