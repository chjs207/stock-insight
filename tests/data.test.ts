import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../scripts/database";
import { marketService, parseReport } from "../lib/dart";
import { emptyReport } from "../lib/market";
import type { Company, QuarterlyYear } from "../lib/market";
import { quarterSlice, searchCompanies, writeWatchlist, readWatchlist } from "../src/runtime";

const samsung: Company = { corpCode: "00126380", stockCode: "005930", name: "삼성전자", market: "KOSPI", closingMonth: 12 };
afterEach(() => vi.unstubAllGlobals());

describe("persistent public database", () => {
  it("restores annual statements and serves repeated reads without calling DART", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stock-insight-test-"));
    const path = join(directory, "cache.json");
    const first = await openDatabase();
    try {
      first.sql.run("INSERT INTO companies VALUES (?, ?, ?, ?)", [samsung.corpCode, samsung.stockCode, "삼성전자", JSON.stringify(samsung)]);
      const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date())) - 1;
      for (let fiscalYear = year - 4; fiscalYear <= year; fiscalYear++) {
        const report = { ...emptyReport(fiscalYear), basis: "CFS", currency: "KRW", amounts: { revenue: "100", operating: "20", net: "15", parentNet: "12" } };
        first.sql.run("INSERT INTO annual_reports VALUES (?, ?, ?, ?)", [samsung.corpCode, fiscalYear, JSON.stringify(report), Date.now()]);
      }
      await first.save(path);
      const backup = JSON.parse(await readFile(path, "utf8"));
      expect(Object.keys(backup.tables)).not.toContain("watchlist");
      const second = await openDatabase(path);
      try {
        const network = vi.fn(() => { throw new Error("must not call DART"); });
        const service = marketService(second.db, "test-key", network);
        expect((await service.financials(samsung.corpCode)).reports).toHaveLength(5);
        expect((await service.financials(samsung.corpCode)).source).toBe("DB");
        expect(network).not.toHaveBeenCalled();
      } finally { second.sql.close(); }
    } finally { first.sql.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("refreshes a corrected report after the cache expires", async () => {
    const database = await openDatabase();
    try {
      database.sql.run("INSERT INTO companies VALUES (?, ?, ?, ?)", [samsung.corpCode, samsung.stockCode, "삼성전자", JSON.stringify(samsung)]);
      const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date())) - 1;
      for (let fiscalYear = year - 4; fiscalYear <= year; fiscalYear++) {
        const report = { ...emptyReport(fiscalYear), basis: "CFS", currency: "KRW", amounts: { revenue: "100", operating: "20", net: "15", parentNet: "12" } };
        database.sql.run("INSERT INTO annual_reports VALUES (?, ?, ?, ?)", [samsung.corpCode, fiscalYear, JSON.stringify(report), Date.now() - 8 * 86400_000]);
      }
      const network = vi.fn(async () => new Response(JSON.stringify({ status: "000", list: [
        { sj_div: "IS", account_id: "ifrs-full_Revenue", account_nm: "매출액", thstrm_amount: "200", currency: "KRW", rcept_no: "20261114000123" },
      ] })));
      const result = await marketService(database.db, "test-key", network).financials(samsung.corpCode);
      expect(result.reports.at(-1)?.amounts.revenue).toBe("200");
      const cached = await marketService(database.db, "test-key", network).financials(samsung.corpCode);
      expect(cached.source).toBe("DB");
      expect(network).toHaveBeenCalledTimes(5);
    } finally { database.sql.close(); }
  });
});

describe("static views and browser watchlist", () => {
  it("returns two initial years, then one earlier year per expansion", () => {
    const years: QuarterlyYear[] = [2026, 2025, 2024, 2023, 2022].map(year => ({ year, reports: [] }));
    expect(quarterSlice(years).years.map(item => item.year)).toEqual([2026, 2025]);
    expect(quarterSlice(years).nextYear).toBe(2024);
    expect(quarterSlice(years, 2024).years).toHaveLength(1);
    expect(quarterSlice(years, 2022).nextYear).toBeNull();
    expect(() => quarterSlice(years, 2021)).toThrow("아직 수집되지");
  });
  it("matches company names and exact stock codes", () => {
    const list = [samsung, { ...samsung, corpCode: "00123456", stockCode: "028260", name: "삼성물산" }];
    expect(searchCompanies(list, "005930")).toEqual([samsung]);
    expect(searchCompanies(list, "삼성")).toHaveLength(2);
    expect(searchCompanies(list, "")).toEqual([]);
  });
  it("keeps watchlists locally, rejects invalid imports and reports failed writes", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
    writeWatchlist([samsung, samsung]);
    expect(readWatchlist()).toEqual([samsung]);
    expect(() => writeWatchlist([{ name: "malformed" } as Company])).toThrow();
    expect(readWatchlist()).toEqual([samsung]);
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("quota"); } });
    expect(() => writeWatchlist([samsung])).toThrow("저장하지 못했습니다");
  });
  it("collects controlling shareholder income independently of total profit", () => {
    const report = parseReport([
      { sj_div: "IS", account_id: "ifrs-full_ProfitLoss", account_nm: "당기순이익", thstrm_amount: "1,500", currency: "KRW", rcept_no: "20261114000123" },
      { sj_div: "IS", account_id: "ifrs-full_ProfitLossAttributableToOwnersOfParent", account_nm: "지배주주순이익", thstrm_amount: "1,200", currency: "KRW", rcept_no: "20261114000123" },
    ], 2025, "CFS");
    expect(report.amounts.net).toBe("1500");
    expect(report.amounts.parentNet).toBe("1200");
  });
});
