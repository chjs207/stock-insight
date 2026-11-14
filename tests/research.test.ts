import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/database";
import { createApi } from "../server/api";
import { serverTransport } from "../server/transport";
import { researchService } from "../lib/research";

afterEach(() => vi.restoreAllMocks());
const item = { nid: "12345", title: "반도체 투자 전망", itemName: "테스트전자", itemCode: "005930",
  brokerName: "테스트증권", writeDate: "2026-11-13", goalPrice: "120000", opinionText: "매수",
  content: "<script>malicious()</script><p>보고서 본문</p>", attachUrl: "javascript:malicious()" };
const page = (items = [item], totalCount = "41", hasNext = true) => ({ items, totalCount, hasNext });

test("normalizes list metadata, constructs trusted report URLs, and never returns or caches report HTML", async () => {
  const database = openDatabase(":memory:");
  try {
    const network = vi.fn(async () => Response.json(page()));
    const service = researchService(database.db, network);
    const result = await service.list();
    expect(result).toMatchObject({ source: "NAVER", page: 0, query: "", total: 41, hasNext: true, stale: false,
      reports: [{ id: "12345", title: item.title, company: item.itemName, stockCode: "005930", broker: item.brokerName,
        date: item.writeDate, targetPrice: "120000", opinion: "매수", url: "https://stock.naver.com/research/company/12345" }] });
    expect(JSON.stringify(result)).not.toContain("malicious");
    expect(String(database.sql.prepare("SELECT data FROM research_pages").get()?.data)).not.toContain("본문");
    expect((await service.list()).source).toBe("DB");
    expect((await service.list(0, "", true)).source).toBe("DB");
    expect(network).toHaveBeenCalledTimes(1);
  } finally { database.close(); }
});

test("searches the upstream corpus and caches each search and page independently", async () => {
  const database = openDatabase(":memory:");
  try {
    const network = vi.fn(async () => Response.json(page()));
    const service = researchService(database.db, network);
    await service.list(0, "  반도체  ");
    expect(network).toHaveBeenLastCalledWith("research/company", { index: "0", size: "20", query: "반도체" });
    await service.list(1, "반도체");
    expect(network).toHaveBeenLastCalledWith("research/company", { index: "1", size: "20", query: "반도체" });
    await service.list(0, "은행");
    await service.list(0, "반도체");
    expect(network).toHaveBeenCalledTimes(3);
    expect(database.sql.prepare("SELECT COUNT(*) AS n FROM research_pages").get()?.n).toBe(3);
  } finally { database.close(); }
});

test("company search sends a stock code filter and keeps it on later pages", async () => {
  const database = openDatabase(":memory:");
  try {
    const network = vi.fn(async () => Response.json(page()));
    const api = createApi(database.db, "private-dart-test", network);
    for (const index of [0, 1]) {
      const response = await api(new URL("http://localhost/api/research?" + new URLSearchParams({ mode: "company", stock: "005930", page: String(index) })), "GET");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ mode: "company", stockCode: "005930", query: "", page: index, total: 41,
        reports: [expect.objectContaining({ stockCode: "005930" })] });
      expect(network).toHaveBeenLastCalledWith("research/company", { index: String(index), size: "20", itemCodes: "005930" });
    }
    expect(network).toHaveBeenCalledTimes(2);
  } finally { database.close(); }
});

test("company and keyword searches have separate caches and preserve their different meaning", async () => {
  const database = openDatabase(":memory:");
  try {
    const other = { ...item, nid: "12346", itemName: "관련기업", itemCode: "000660" };
    const network = vi.fn(async () => Response.json(page([other])));
    const service = researchService(database.db, network);
    const keyword = await service.list(0, "삼성전자");
    expect(keyword).toMatchObject({ mode: "keyword", stockCode: null, reports: [expect.objectContaining({ company: "관련기업" })] });
    network.mockResolvedValueOnce(Response.json(page()));
    const company = await service.list(0, "", false, "005930");
    expect(company).toMatchObject({ mode: "company", reports: [expect.objectContaining({ stockCode: "005930" })] });
    expect(await service.list(0, "삼성전자")).toMatchObject({ source: "DB", reports: keyword.reports });
    expect(await service.list(0, "", false, "005930")).toMatchObject({ source: "DB", reports: company.reports });
    expect(network).toHaveBeenCalledTimes(2);
  } finally { database.close(); }
});

test("an ignored company filter never exposes other companies or reuses keyword results", async () => {
  const database = openDatabase(":memory:");
  try {
    const wrongPage = page([{ ...item, itemCode: "000660", itemName: "다른기업" }]);
    const network = vi.fn(async () => Response.json(wrongPage));
    const service = researchService(database.db, network);
    await service.list(0, "삼성전자");
    await expect(service.list(0, "", false, "005930")).rejects.toMatchObject({ httpStatus: 502 });
    network.mockResolvedValueOnce(Response.json(page()));
    const correct = await service.list(0, "", false, "005930");
    database.sql.prepare("UPDATE research_pages SET fetched_at = ?").run(Date.now() - 11 * 60_000);
    const fallback = await service.list(0, "", false, "005930");
    expect(fallback).toMatchObject({ stale: true, mode: "company", reports: correct.reports });
    expect(fallback.reports.every(report => report.stockCode === "005930")).toBe(true);
  } finally { database.close(); }
});

test("legacy keyword-only cache entries cannot satisfy a company query", async () => {
  const database = openDatabase(":memory:");
  try {
    database.sql.prepare("INSERT INTO research_pages VALUES (?, ?, ?)")
      .run(JSON.stringify(["삼성전자", 0]), Date.now(), JSON.stringify({ reports: [{ stockCode: "000660" }], total: 1, page: 0, query: "삼성전자", hasNext: false }));
    const network = vi.fn(async () => Response.json(page()));
    expect(await researchService(database.db, network).list(0, "", false, "005930")).toMatchObject({ source: "NAVER", stockCode: "005930" });
    expect(network).toHaveBeenCalledTimes(1);
  } finally { database.close(); }
});

test("ambiguous search modes and invalid company filters are rejected before upstream access", async () => {
  const database = openDatabase(":memory:");
  try {
    const network = vi.fn(async () => Response.json(page()));
    const api = createApi(database.db, "private-dart-test", network);
    for (const params of [
      { mode: "company" }, { mode: "company", stock: "00593" }, { mode: "company", stock: "005930,000660" },
      { mode: "company", stock: "005930", q: "삼성전자" }, { mode: "keyword", stock: "005930" }, { mode: "invalid" },
    ]) {
      const query = new URLSearchParams(Object.entries(params));
      expect((await api(new URL("http://localhost/api/research?" + query), "GET")).status).toBe(400);
    }
    expect(network).not.toHaveBeenCalled();
  } finally { database.close(); }
});

test("an expired or forced refresh failure keeps the stored list and returns a warning", async () => {
  const database = openDatabase(":memory:");
  try {
    const network = vi.fn(async () => Response.json(page()));
    const service = researchService(database.db, network);
    const first = await service.list();
    const timestamp = Date.now() - 60_000;
    database.sql.prepare("UPDATE research_pages SET fetched_at = ?").run(timestamp);
    network.mockResolvedValueOnce(new Response("upstream unavailable", { status: 503 }));
    const stale = await service.list(0, "", true);
    expect(stale).toMatchObject({ source: "DB", stale: true, reports: first.reports, fetchedAt: timestamp, warning: expect.stringContaining("조회하지 못했습니다") });
    expect(database.sql.prepare("SELECT fetched_at FROM research_pages").get()?.fetched_at).toBe(timestamp);
    database.sql.prepare("UPDATE research_pages SET fetched_at = ?").run(Date.now() - 11 * 60_000);
    expect((await service.list()).source).toBe("NAVER");
    expect(network).toHaveBeenCalledTimes(3);
  } finally { database.close(); }
});

test("confirmed empty searches are displayed and cached as empty results", async () => {
  const database = openDatabase(":memory:");
  try {
    const network = vi.fn(async () => Response.json(page([], "0", false)));
    const service = researchService(database.db, network);
    expect(await service.list(0, "없는검색어")).toMatchObject({ reports: [], total: 0, hasNext: false, stale: false });
    expect((await service.list(0, "없는검색어")).source).toBe("DB");
    expect(network).toHaveBeenCalledTimes(1);
  } finally { database.close(); }
});

test("changed or malformed upstream responses never overwrite a saved list with an empty success", async () => {
  const database = openDatabase(":memory:");
  try {
    const network = vi.fn(async () => Response.json(page()));
    const service = researchService(database.db, network);
    await service.list();
    database.sql.prepare("UPDATE research_pages SET fetched_at = ?").run(Date.now() - 11 * 60_000);
    const original = database.sql.prepare("SELECT * FROM research_pages").get();
    for (const malformed of [{ items: null }, page([{ ...item, nid: "javascript:123" }]), { ...page(), hasNext: "true" }, page([], "41", true), page([item, item])]) {
      network.mockResolvedValueOnce(Response.json(malformed));
      expect(await service.list()).toMatchObject({ stale: true, source: "DB", reports: [expect.objectContaining({ id: "12345" })] });
      expect(database.sql.prepare("SELECT * FROM research_pages").get()).toEqual(original);
    }
    database.sql.exec("DELETE FROM research_pages");
    network.mockResolvedValueOnce(Response.json({ items: null }));
    await expect(service.list()).rejects.toMatchObject({ httpStatus: 502 });
  } finally { database.close(); }
});

test("invalid pages and overlong queries are rejected before any upstream request", async () => {
  const database = openDatabase(":memory:");
  try {
    const network = vi.fn(async () => Response.json(page()));
    const api = createApi(database.db, "private-dart-test", network);
    for (const value of ["-1", "1.5", "1e2", "10001", "NaN"]) {
      expect((await api(new URL("http://localhost/api/research?page=" + value), "GET")).status).toBe(400);
    }
    expect((await api(new URL("http://localhost/api/research?" + new URLSearchParams({ q: "가".repeat(61) })), "GET")).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  } finally { database.close(); }
});

test("concurrent reads of the same page share one upstream request", async () => {
  const database = openDatabase(":memory:");
  try {
    const network = vi.fn(async () => Response.json(page()));
    const results = await Promise.all([researchService(database.db, network).list(), researchService(database.db, network).list()]);
    expect(results[0]).toEqual(results[1]);
    expect(network).toHaveBeenCalledTimes(1);
  } finally { database.close(); }
});

test("research transport uses only the Naver host and never sends DART or Kiwoom credentials", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(page()));
  const transport = serverTransport({ dartKey: "dart-private-test", appKey: "kiwoom-private-test", appSecret: "secret-private-test",
    host: "127.0.0.1", port: 4180, databasePath: ":memory:" });
  const response = await transport("research/company", { index: "0", size: "20", query: "삼성 & 반도체" });
  expect(response.status).toBe(200);
  const [input, options] = network.mock.calls[0];
  const url = new URL(String(input));
  expect(url.origin).toBe("https://stock.naver.com");
  expect(url.pathname).toBe("/api/stockSecurity/researches/v2/company");
  expect(Object.fromEntries(url.searchParams)).toEqual({ index: "0", size: "20", query: "삼성 & 반도체" });
  expect(JSON.stringify([String(input), options])).not.toContain("private-test");
  await transport("research/company", { index: "1", size: "20", itemCodes: "005930" });
  const companyUrl = new URL(String(network.mock.calls[1][0]));
  expect(Object.fromEntries(companyUrl.searchParams)).toEqual({ index: "1", size: "20", itemCodes: "005930" });
  expect(JSON.stringify(network.mock.calls[1])).not.toContain("private-test");
  await expect(transport("research/https://untrusted.example", {})).rejects.toMatchObject({ httpStatus: 400 });
  expect(network).toHaveBeenCalledTimes(2);
});

test("a saved research page survives reopening the local database without a network call", async () => {
  const folder = await mkdtemp(join(tmpdir(), "stock-research-"));
  const path = join(folder, "app.sqlite");
  try {
    const first = openDatabase(path);
    const network = vi.fn(async () => Response.json(page()));
    try { await researchService(first.db, network).list(); }
    finally { first.close(); }
    const second = openDatabase(path);
    try {
      const result = await researchService(second.db, network).list();
      expect(result).toMatchObject({ source: "DB", reports: [expect.objectContaining({ id: "12345" })] });
      expect(network).toHaveBeenCalledTimes(1);
    } finally { second.close(); }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
