import { readFile, mkdir, appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { dartClient, marketService, MarketError } from "../lib/dart.ts";
import { giantsService } from "../lib/giants.ts";
import { quoteService } from "../lib/quotes.ts";
import { firstReportYear } from "../lib/market.ts";
import type { Company, QuarterlyYear } from "../lib/market.ts";
import type { StockQuote } from "../lib/valuation.ts";
import type { Catalog, CompanyData, GiantsData } from "../src/data-types.ts";
import { openDatabase, atomicJson, optionalJson, query } from "./database.ts";
import { collectorTransport } from "./transport.ts";

type Config = { companies: string[]; managers: string[]; quarterYears: number; monthsPerRun: number; detailsPerRun: number; requestsPerRun: number };
function integer(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value?.trim()) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`수집 범위는 ${min}–${max} 사이 정수여야 합니다.`);
  return number;
}
function inputs(value = "") {
  const values = value.split(/[,\n]/).map(item => item.trim()).filter(Boolean);
  if (values.length > 50 || values.some(item => item.length > 80)) throw new Error("수집 대상 입력이 너무 깁니다.");
  return values;
}
function safeError(error: unknown) {
  return error instanceof MarketError ? error.message : "자료를 처리하지 못했습니다. 이전 저장본을 유지합니다.";
}

async function main() {
  const key = process.env.DART_API_KEY?.trim();
  if (!key) throw new Error("DART_API_KEY가 없습니다. 저장소 Actions Secret에 등록하세요.");
  const config = JSON.parse(await readFile(new URL("../config/collection.json", import.meta.url), "utf8")) as Config;
  const quarterYears = integer(process.env.COLLECT_QUARTER_YEARS, config.quarterYears, 3, 20);
  const monthsPerRun = integer(process.env.COLLECT_MONTHS, config.monthsPerRun, 1, 37);
  const detailsPerRun = integer(process.env.COLLECT_DETAILS, config.detailsPerRun, 0, 1000);
  const budget = integer(process.env.COLLECT_REQUEST_LIMIT, config.requestsPerRun, 100, 10000);
  const root = resolve(process.env.DATA_DIR || ".data");
  const site = join(root, "site");
  await mkdir(join(site, "companies"), { recursive: true });
  const database = await openDatabase(join(root, "cache.json"));
  const { db, sql } = database;
  const { transport, requestCount } = collectorTransport(key, budget);
  const dart = dartClient(key, transport);
  const market = marketService(db, key, transport);
  const quotes = quoteService(db, transport);
  const giants = giantsService(db, key, transport);
  const warnings: string[] = [];
  const started = new Date().toISOString();
  const oldCatalog = await optionalJson<Catalog>(join(site, "catalog.json"));
  const warn = (scope: string, error: unknown) => {
    const message = scope + ": " + safeError(error);
    warnings.push(message);
    console.log(message);
  };
  try {
    // Refresh the full DART company directory weekly. Never replace it on failure.
    const directory = query<{ fetched_at: number }>(sql, "SELECT fetched_at FROM corp_directory WHERE id=1")[0];
    if (!directory || Date.now() - directory.fetched_at > 7 * 86400_000) {
      try {
        const candidates = await dart.directory();
        sql.run("INSERT OR REPLACE INTO corp_directory (id, data, fetched_at) VALUES (1, ?, ?)", [JSON.stringify(candidates), Date.now()]);
        console.log(`DART 기업 목록 ${candidates.length}개 확인`);
      } catch (error) { warn("기업 목록", error); }
    }
    // Market lists also include preferred shares for issuer market capitalization.
    for (const [code, marketName] of [["005930", "KOSPI"], ["086520", "KOSDAQ"]] as const) {
      try {
        const quote = await quotes.quote({ corpCode: "", name: "", stockCode: code, market: marketName, closingMonth: 12 });
        if (quote.stale) warnings.push(marketName + " 시가총액은 이전 저장본입니다.");
      } catch (error) { warn(marketName + " 시가총액", error); }
    }

    const requested = inputs(process.env.COLLECT_COMPANIES);
    for (const input of [...new Set([...config.companies, ...requested])]) {
      try {
        const companies = /^\d{8}$/.test(input) ? [await market.listedCompany(input)] : await market.search(input);
        if (companies.length !== 1) {
          warnings.push(`기업 입력 '${input}': ${companies.length ? "여러 기업이 검색됩니다. 종목코드로 지정하세요." : "상장기업을 찾지 못했습니다."}`);
          continue;
        }
        const company = companies[0];
        sql.run("INSERT INTO collection_targets (corp_code, quarter_years) VALUES (?, ?) ON CONFLICT(corp_code) DO UPDATE SET quarter_years=MAX(quarter_years, excluded.quarter_years)", [company.corpCode, quarterYears]);
      } catch (error) { warn("기업 등록 " + input, error); }
    }

    // Revisit every registered target; successful cached filings avoid DART calls for seven days.
    const targets = query<{ corp_code: string; quarter_years: number }>(sql, "SELECT * FROM collection_targets ORDER BY corp_code");
    for (const target of targets) {
      const path = join(site, "companies", target.corp_code + ".json");
      const previous = await optionalJson<CompanyData>(path);
      try {
        const company = await market.listedCompany(target.corp_code);
        const next: CompanyData = { ...previous, company, collectedAt: previous?.collectedAt || started, warnings: [] };
        let updated = false;
        try {
          const annual = await market.financials(company.corpCode);
          next.annual = { ...annual, source: "DB" };
          updated = true;
        } catch (error) { next.warnings.push("연간 재무: " + safeError(error)); }
        try {
          const initial = await market.quarterly(company.corpCode);
          const years = new Map<number, QuarterlyYear>((previous?.quarters ?? []).map(year => [year.year, year]));
          initial.years.forEach(year => years.set(year.year, year));
          let year = initial.nextYear;
          for (let count = 2; count < target.quarter_years && year !== null && year >= firstReportYear; count++, year--) {
            try {
              const result = await market.quarterly(company.corpCode, year);
              result.years.forEach(item => years.set(item.year, item));
            } catch (error) { next.warnings.push(year + "년 분기: " + safeError(error)); }
          }
          next.quarters = [...years.values()].sort((a, b) => b.year - a.year);
          updated = true;
        } catch (error) { next.warnings.push("분기 재무: " + safeError(error)); }
        try { next.quote = await quotes.quote(company); }
        catch (error) {
          if (next.quote) next.quote = { ...next.quote, stale: true };
          next.warnings.push("시가총액: " + safeError(error));
        }
        if (updated) next.collectedAt = started;
        await atomicJson(path, next);
        console.log(`${company.name}: 연간 ${next.annual?.reports.length ?? 0}년, 분기 ${next.quarters?.length ?? 0}년`);
        warnings.push(...next.warnings.map(message => company.name + ": " + message));
      } catch (error) { warn("기업 " + target.corp_code, error); }
      // Checkpoint each company. A later interruption cannot erase previously saved results.
      await database.save(join(root, "cache.json"));
    }

    const giantWarnings: string[] = [];
    for (const name of [...new Set([...config.managers, ...inputs(process.env.COLLECT_MANAGERS)])]) {
      try { await giants.addManager(name); }
      catch (error) { giantWarnings.push(name + ": " + safeError(error)); }
    }
    const coverage = await giants.coverage();
    // Refresh current month even when the date is unchanged; resume missing months next run.
    const months = [...new Set([coverage.currentMonth, ...coverage.missing])].slice(0, monthsPerRun);
    for (const month of months) {
      try { await giants.syncMonth(month); console.log("지분공시 목록 " + month); }
      catch (error) { giantWarnings.push(month + ": " + safeError(error)); }
      await database.save(join(root, "cache.json"));
    }
    const managers = await giants.managers();
    let remaining = detailsPerRun;
    for (const manager of managers) {
      try {
        // A fair share avoids starving managers added after VIP.
        let allowance = Math.min(remaining, Math.ceil(detailsPerRun / managers.length));
        while (allowance > 0) {
          const count = await giants.syncDetails(manager.key, Math.min(5, allowance));
          if (!count) break;
          allowance -= count;
          remaining -= count;
        }
      } catch (error) { giantWarnings.push(manager.name + ": " + safeError(error)); }
      await database.save(join(root, "cache.json"));
    }
    const giantData: GiantsData = {
      collectedAt: started, managers, coverage: await giants.coverage(), snapshots: {}, warnings: giantWarnings,
    };
    for (const manager of managers) giantData.snapshots[manager.key] = await giants.snapshot(manager.key);
    await atomicJson(join(site, "giants.json"), giantData);
    warnings.push(...giantWarnings);

    // Publish only public company metadata and public statement snapshots.
    const row = query<{ data: string; fetched_at: number }>(sql, "SELECT * FROM corp_directory WHERE id=1")[0];
    const candidates = row ? JSON.parse(row.data) as Pick<Company, "corpCode" | "stockCode" | "name">[] : [];
    const markets = new Map<string, "KOSPI" | "KOSDAQ">();
    for (const cache of query<{ market: "KOSPI" | "KOSDAQ"; data: string }>(sql, "SELECT * FROM market_quotes")) {
      for (const stock of JSON.parse(cache.data) as StockQuote[]) markets.set(stock.code, cache.market);
    }
    const profiles = new Map(query<{ data: string }>(sql, "SELECT data FROM companies").map(({ data }) => {
      const company = JSON.parse(data) as Company; return [company.corpCode, company] as const;
    }));
    const companies = new Map<string, Company>();
    for (const candidate of candidates) {
      const market = markets.get(candidate.stockCode);
      if (market) companies.set(candidate.corpCode, { ...candidate, closingMonth: 12, ...profiles.get(candidate.corpCode), market });
    }
    if (!companies.size) for (const company of oldCatalog?.companies ?? []) companies.set(company.corpCode, company);
    for (const company of profiles.values()) if (company.market && (markets.has(company.stockCode) || !markets.size)) companies.set(company.corpCode, company);
    const collected: Catalog["collected"] = {};
    for (const target of targets) {
      const data = await optionalJson<CompanyData>(join(site, "companies", target.corp_code + ".json"));
      if (data?.annual || data?.quarters?.length) collected[target.corp_code] = {
        collectedAt: data.collectedAt, oldestQuarterYear: data.quarters?.at(-1)?.year ?? null,
      };
    }
    const catalog: Catalog = { schemaVersion: 1, generatedAt: started,
      directoryUpdatedAt: row ? new Date(row.fetched_at).toISOString() : null,
      companies: [...companies.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")), collected, warnings };
    await atomicJson(join(site, "catalog.json"), catalog);
    const summary = `수집 대상 ${targets.length}개 · 검색 목록 ${companies.size}개 · 요청 ${requestCount()}회\n지분공시 미수집 ${giantData.coverage.missing.length}개월 · 원문 대기 ${Object.values(giantData.snapshots).reduce((sum, value) => sum + value.pending, 0)}건\n`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      "## 자료 수집 결과\n\n" + summary.replaceAll("\n", "\n\n") + (warnings.length ? "\n일부 수집 실패 또는 지연이 있습니다. 화면의 자료 상태를 확인하세요.\n" : ""));
    if (!Object.keys(collected).length) throw new Error("게시할 재무자료가 없습니다. DART 인증 설정 및 수집 결과를 확인하세요.");
  } finally {
    await database.save(join(root, "cache.json"));
    sql.close();
  }
}

main().catch(error => {
  // Unexpected driver/HTTP errors can contain URLs. Never print the raw error or stack.
  console.error(error instanceof MarketError ? error.message : "수집을 완료하지 못했습니다. DART_API_KEY, 입력 범위와 data 브랜치 백업 형식을 확인하세요.");
  process.exitCode = 1;
});
