import { inflateSync } from "fflate";
import { emptyReport, firstReportYear, metrics, quarterNumbers } from "./market.ts";
import type { AnnualReport, Company, Metric, QuarterlyFinancials, QuarterlyYear } from "./market.ts";

const day = 86_400_000;
const marketCodes = { Y: "KOSPI", K: "KOSDAQ" } as const;

export class MarketError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus = 502) { super(message); this.httpStatus = httpStatus; }
}

type Candidate = { corpCode: string; stockCode: string; name: string };
type Directory = { data: string; fetched_at: number };
type SavedAnnual = { year: number; data: string | null; fetched_at: number };
type InterimReport = { report: AnnualReport; cumulative: AnnualReport | null };
type Account = {
  sj_div: string;
  account_id: string;
  account_nm: string;
  thstrm_amount: string;
  thstrm_add_amount?: string;
  currency: string;
  rcept_no: string;
};

function normalize(name: string) {
  return name.normalize("NFKC").toLowerCase()
    .replace(/^(?:주식회사|\(주\))|(?:주식회사|\(주\))$/g, "")
    .replace(/[\s.·()_-]/g, "");
}

function amount(value: string | undefined) {
  const cleaned = value?.trim().replaceAll(",", "").replace(/^\((\d+)\)$/, "-$1");
  return cleaned && /^[+-]?\d+$/.test(cleaned) ? BigInt(cleaned).toString() : null;
}

const names: Record<Metric, string[]> = {
  revenue: ["매출액", "매출", "수익(매출액)", "영업수익", "총영업수익", "영업수익(매출액)"],
  operating: ["영업이익", "영업손익", "영업이익(손실)", "영업손실", "영업이익(영업손실)"],
  net: ["당기순이익", "당기순손익", "당기순이익(손실)", "당기순손실", "당기순이익(당기순손실)", "연결당기순이익"],
  parentNet: [
    "지배기업의 소유주에게 귀속되는 당기순이익(손실)", "지배기업의 소유주에게 귀속되는 당기순이익",
    "지배기업 소유주지분 순이익", "지배기업 소유주지분 당기순이익(손실)",
    "지배주주순이익", "지배주주순이익(손실)", "지배주주지분순이익", "지배주주지분순이익(손실)",
    "지배기업소유주지분 당기순이익",
  ],
};
const ids: Record<Metric, string[]> = {
  revenue: ["ifrs-full_Revenue", "ifrs_Revenue", "dart_OperatingRevenue"],
  operating: ["dart_OperatingIncomeLoss", "ifrs-full_ProfitLossFromOperatingActivities"],
  net: ["ifrs-full_ProfitLoss", "ifrs_ProfitLoss"],
  parentNet: ["ifrs-full_ProfitLossAttributableToOwnersOfParent", "ifrs_ProfitLossAttributableToOwnersOfParent"],
};

function reconciledParent(candidates: Account[], field: "thstrm_amount" | "thstrm_add_amount", total: string | null) {
  if (total === null) return undefined;
  const owners = ["지배기업의소유주", "지배기업소유주지분", "지배기업소유주", "지배주주지분", "지배지분"];
  const interests = ["비지배지분", "비지배주주지분", "비지배주주"];
  const ordinary = candidates.filter((row) => !/Comprehensive/.test(row.account_id));
  const minority = ordinary.filter((row) =>
    /^(?:ifrs-full|ifrs)_ProfitLossAttributableToNoncontrollingInterests$/.test(row.account_id) ||
    interests.includes(normalize(row.account_nm)));
  return ordinary.find((owner) => owners.includes(normalize(owner.account_nm)) &&
    minority.some((other) => owner.currency === other.currency &&
      BigInt(amount(owner[field])!) + BigInt(amount(other[field])!) === BigInt(total)));
}

export function parseReport(
  rows: Account[], year: number, basis: "CFS" | "OFS",
  field: "thstrm_amount" | "thstrm_add_amount" = "thstrm_amount",
): AnnualReport {
  const income = rows.filter(({ sj_div }) => sj_div === "IS" || sj_div === "CIS");
  const candidates = income.filter((row) => amount(row[field]) !== null);
  const report = emptyReport(year);
  report.basis = basis;
  report.receipt = rows.find((row) => /^\d{14}$/.test(row.rcept_no))?.rcept_no ?? null;
  const statementCurrency = income.find((row) => /^[A-Z]{3}$/.test(row.currency))?.currency;
  for (const { key } of metrics) {
    if (key === "parentNet" && basis === "OFS") continue;
    const account = candidates.find((row) => ids[key].includes(row.account_id)) ??
      candidates.find((row) => names[key].map(normalize).includes(normalize(row.account_nm))) ??
      (key === "parentNet" ? reconciledParent(candidates, field, report.amounts.net) : undefined);
    if (!account) continue;
    const currency = /^[A-Z]{3}$/.test(account.currency) ? account.currency : statementCurrency;
    if (!currency || (report.currency && report.currency !== currency)) continue;
    report.currency = currency;
    report.amounts[key] = amount(account[field]);
  }
  report.currency ??= statementCurrency ?? null;
  return report;
}

function fourthQuarter(year: number, annual: AnnualReport | null, cumulative: AnnualReport | null) {
  const report = emptyReport(year);
  if (!annual || !cumulative || !annual.currency ||
      annual.basis !== cumulative.basis || annual.currency !== cumulative.currency) return report;
  for (const { key } of metrics) {
    const total = annual.amounts[key] ?? null;
    const throughThirdQuarter = cumulative.amounts[key] ?? null;
    if (total !== null && throughThirdQuarter !== null) {
      report.amounts[key] = (BigInt(total) - BigInt(throughThirdQuarter)).toString();
    }
  }
  if (Object.values(report.amounts).some((value) => value !== null)) {
    report.basis = annual.basis;
    report.currency = annual.currency;
    report.receipt = annual.receipt;
  }
  return report;
}

function statusError(status: string) {
  if (["010", "011", "012", "901"].includes(status)) {
    return new MarketError("OpenDART 인증키 또는 접근 설정을 확인해 주세요.", 503);
  }
  if (status === "020") return new MarketError("OpenDART API 요청 한도에 도달했습니다.", 503);
  return new MarketError("OpenDART에서 자료를 가져오지 못했습니다. 잠시 후 다시 검색해 주세요.");
}

function decodeEntities(value: string) {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, key: string) => entities[key]);
}

function readZipXml(buffer: ArrayBuffer): string {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  if (view.byteLength < 4 || view.getUint32(0, true) !== 0x04034b50) {
    const status = decoder.decode(buffer.slice(0, 4096)).match(/<status>(\d+)<\/status>/)?.[1];
    throw statusError(status ?? "");
  }

  let end = view.byteLength - 22;
  const minEnd = Math.max(0, end - 65_535);
  while (end >= minEnd && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < minEnd) throw new MarketError("OpenDART 파일의 압축 형식이 올바르지 않습니다.");
  const central = view.getUint32(end + 16, true);
  if (central + 46 > end || view.getUint32(central, true) !== 0x02014b50) {
    throw new MarketError("OpenDART 압축 파일을 읽을 수 없습니다.");
  }

  const offset = view.getUint32(central + 42, true);
  const size = view.getUint32(central + 20, true);
  const expanded = view.getUint32(central + 24, true);
  const method = view.getUint16(central + 10, true);
  if (offset + 30 > central || view.getUint32(offset, true) !== 0x04034b50 ||
      expanded > 40_000_000 || (method !== 0 && method !== 8)) {
    throw new MarketError("OpenDART 파일의 압축 형식을 지원하지 않습니다.");
  }
  const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
  if (start + size > central) throw new MarketError("OpenDART 압축 파일이 손상되었습니다.");
  const compressed = new Uint8Array(buffer, start, size);
  return decoder.decode(method === 8 ? inflateSync(compressed, { out: new Uint8Array(expanded) }) : compressed);
}

export function readDirectory(buffer: ArrayBuffer): Candidate[] {
  const xml = readZipXml(buffer);
  const result: Candidate[] = [];
  for (const [, row] of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const stockCode = row.match(/<stock_code>([^<]*)<\/stock_code>/)?.[1].trim() ?? "";
    if (!/^[A-Z0-9]{6}$/.test(stockCode)) continue;
    const corpCode = row.match(/<corp_code>(\d{8})<\/corp_code>/)?.[1];
    const name = row.match(/<corp_name>([^<]+)<\/corp_name>/)?.[1].trim();
    if (corpCode && name) result.push({ corpCode, stockCode, name: decodeEntities(name) });
  }
  if (!result.length) throw new MarketError("OpenDART 기업 목록이 비어 있습니다.");
  return result;
}

export type DartTransport = (path: string, params: Record<string, string>) => Promise<Response>;

export function localDartTransport(url: URL, token?: string): DartTransport | undefined {
  if (!token) return undefined;
  return (path, args) => {
    const origin = "http://127.0.0.1" + (url.port ? ":" + url.port : "");
    const proxy = new URL("/__market/dart", origin);
    proxy.search = new URLSearchParams({ endpoint: path, ...args }).toString();
    return fetch(proxy, {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(path === "kiwoom/chart" ? 32_000 : 12_000),
      redirect: "manual",
    });
  };
}

export function dartClient(key?: string, transport?: DartTransport) {
  async function request(path: string, params: Record<string, string> = {}) {
    if (!key?.trim()) throw new MarketError("GitHub Actions Secret에 DART_API_KEY를 등록해 주세요.", 503);
    const url = new URL("https://opendart.fss.or.kr/api/" + path);
    url.search = new URLSearchParams({ crtfc_key: key.trim(), ...params }).toString();
    try {
      const response = transport ? await transport(path, params) :
        await fetch(url, { signal: AbortSignal.timeout(12_000), redirect: "manual" });
      if (response.ok) return response;
    } catch {
      // The upstream URL contains the credential. Report only a fixed message.
    }
    throw new MarketError("OpenDART에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  return {
    directory: async () => readDirectory(await (await request("corpCode.xml")).arrayBuffer()),
    async document(receipt: string) {
      const file = await (await request("document.xml", { rcept_no: receipt })).arrayBuffer();
      const signature = file.byteLength >= 4 ? new DataView(file).getUint32(0, true) : 0;
      if (signature !== 0x04034b50) {
        const status = new TextDecoder().decode(file.slice(0, 4096)).match(/<status>(\d+)<\/status>/)?.[1];
        if (status === "013" || status === "014") return null;
        throw statusError(status ?? "");
      }
      return readZipXml(file);
    },
    async json<T>(path: string, params: Record<string, string>): Promise<T | null> {
      const response = await request(path, params);
      let body: T & { status: string };
      try { body = await response.json(); } catch { throw statusError(""); }
      if (body?.status === "013") return null;
      if (body?.status !== "000") throw statusError(body?.status ?? "");
      return body;
    },
  };
}

export function marketService(db: D1Database, key?: string, transport?: DartTransport) {
  const now = new Date();
  const dart = dartClient(key, transport);
  const timestamp = now.getTime();

  async function profile(corpCode: string): Promise<Company | null> {
    const saved = await db.prepare("SELECT data FROM companies WHERE corp_code = ?")
      .bind(corpCode).first<string>("data");
    if (saved) return JSON.parse(saved) as Company;
    const data = await dart.json<{
      stock_name: string;
      corp_name: string;
      stock_code: string;
      corp_cls: keyof typeof marketCodes;
      acc_mt: string;
    }>("company.json", { corp_code: corpCode });
    if (!data) return null;
    const closingMonth = Number(data.acc_mt);
    const company: Company = {
      corpCode,
      stockCode: data.stock_code?.trim() ?? "",
      name: data.stock_name?.trim() || data.corp_name,
      market: marketCodes[data.corp_cls] ?? null,
      closingMonth: closingMonth >= 1 && closingMonth <= 12 ? closingMonth : 12,
    };
    await db.prepare(
      "INSERT OR IGNORE INTO companies (corp_code, stock_code, search_name, data) VALUES (?, ?, ?, ?)",
    ).bind(corpCode, company.stockCode, normalize(company.name), JSON.stringify(company)).run();
    return company;
  }

  async function search(query: string): Promise<Company[]> {
    const term = normalize(query);
    if (!term) return [];
    const [saved, directory] = await Promise.all([
      db.prepare("SELECT data FROM companies WHERE search_name = ? OR stock_code = ?")
        .bind(term, term.toUpperCase()).all<{ data: string }>(),
      db.prepare("SELECT data, fetched_at FROM corp_directory WHERE id = 1").first<Directory>(),
    ]);
    const aliases = saved.results.map((row) => JSON.parse(row.data) as Company);
    const rank = (candidate: Candidate) => {
      const name = normalize(candidate.name);
      if (name === term || candidate.stockCode.toLowerCase() === term) return 0;
      if (name.startsWith(term)) return 1;
      return name.includes(term) ? 2 : 3;
    };

    const matches = (catalog: Candidate[]) => {
      const unique = new Map<string, { candidate: Candidate; rank: number }>();
      for (const candidate of [...catalog, ...aliases]) {
        const score = rank(candidate);
        const existing = unique.get(candidate.corpCode);
        if (score < 3 && (!existing || score < existing.rank)) {
          unique.set(candidate.corpCode, { candidate, rank: score });
        }
      }
      return Array.from(unique.values())
        .sort((a, b) => a.rank - b.rank || a.candidate.name.length - b.candidate.name.length)
        .slice(0, 12);
    };

    let candidates = matches(directory ? JSON.parse(directory.data) as Candidate[] : []);
    if (!candidates.length && (!directory || timestamp - directory.fetched_at > 7 * day)) {
      const catalog = await dart.directory();
      await db.prepare(
        "INSERT INTO corp_directory (id, data, fetched_at) VALUES (1, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at " +
        "WHERE excluded.fetched_at >= corp_directory.fetched_at",
      ).bind(JSON.stringify(catalog), timestamp).run();
      candidates = matches(catalog);
    }

    const groups = [candidates.filter((item) => item.rank === 0), candidates.filter((item) => item.rank > 0)];
    for (const group of groups) {
      const found: Company[] = [];
      for (let i = 0; i < group.length; i += 5) {
        const verified = await Promise.all(group.slice(i, i + 5).map(({ candidate }) => profile(candidate.corpCode)));
        found.push(...verified.filter((company): company is Company => Boolean(company?.market && company.stockCode)));
      }
      if (found.length) return found;
    }
    return [];
  }

  async function listedCompany(corpCode: string) {
    const company = await profile(corpCode);
    if (!company?.market || !company.stockCode) throw new MarketError("KOSPI·KOSDAQ 상장 기업을 찾을 수 없습니다.", 404);
    return company;
  }

  function calendar() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit",
    }).formatToParts(now);
    const year = Number(parts.find(({ type }) => type === "year")?.value);
    const month = Number(parts.find(({ type }) => type === "month")?.value);
    return { year, month };
  }

  function normalized(report: AnnualReport) {
    return { ...report, amounts: { ...emptyReport(report.year).amounts, ...report.amounts } };
  }

  function fresh(row: { data: string | null; fetched_at: number }) {
    if (row.data === null) return timestamp - row.fetched_at < day;
    // Revisit successful filings weekly so subsequent corrections are reflected.
    if (timestamp - row.fetched_at >= 7 * day) return false;
    const saved = JSON.parse(row.data) as AnnualReport | InterimReport;
    if ("report" in saved) {
      return Object.hasOwn(saved.report.amounts, "parentNet") &&
        (!saved.cumulative || Object.hasOwn(saved.cumulative.amounts, "parentNet"));
    }
    return Object.hasOwn(saved.amounts, "parentNet");
  }

  async function filing(corpCode: string, year: number, reprtCode: string) {
    const params = { corp_code: corpCode, bsns_year: String(year), reprt_code: reprtCode };
    let basis: "CFS" | "OFS" = "CFS";
    let response = await dart.json<{ list: Account[] }>("fnlttSinglAcntAll.json", { ...params, fs_div: basis });
    if (!response) {
      basis = "OFS";
      response = await dart.json<{ list: Account[] }>("fnlttSinglAcntAll.json", { ...params, fs_div: basis });
    }
    if (response && !Array.isArray(response.list)) throw statusError("");
    return response ? { rows: response.list, basis } : null;
  }

  async function fetchAnnual(corpCode: string, fiscalYear: number) {
    const result = await filing(corpCode, fiscalYear, "11011");
    let report = result ? parseReport(result.rows, fiscalYear, result.basis) : null;
    if (!report) {
      const original = await db.prepare("SELECT data FROM annual_reports WHERE corp_code = ? AND year = ?")
        .bind(corpCode, fiscalYear).first<string>("data");
      if (original) report = normalized(JSON.parse(original) as AnnualReport);
    }
    await db.prepare(
      "INSERT INTO annual_reports (corp_code, year, data, fetched_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(corp_code, year) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at " +
      "WHERE excluded.fetched_at >= annual_reports.fetched_at",
    ).bind(corpCode, fiscalYear, report ? JSON.stringify(report) : null, timestamp).run();
    return report;
  }

  async function financials(corpCode: string) {
    const company = await listedCompany(corpCode);
    const { year, month } = calendar();
    const upper = month > company.closingMonth ? year : year - 1;
    const lower = upper - 8;
    const saved = await db.prepare(
      "SELECT year, data, fetched_at FROM annual_reports WHERE corp_code = ? AND year BETWEEN ? AND ?",
    ).bind(corpCode, lower, upper).all<SavedAnnual>();
    const reports = new Map(saved.results
      .filter(fresh)
      .map((row) => [row.year, JSON.parse(row.data ?? "null") as AnnualReport | null]));
    let fetched = false;

    async function annual(fiscalYear: number) {
      if (reports.has(fiscalYear)) return reports.get(fiscalYear) ?? null;
      fetched = true;
      return fetchAnnual(corpCode, fiscalYear);
    }

    const years = Array.from({ length: 5 }, (_, index) => upper - index);
    const results = await Promise.all(years.map(annual));
    const newest = results.find((report) => report !== null);
    if (!newest) throw new MarketError("최근 5개 사업연도의 연간 재무제표를 찾지 못했습니다.", 404);
    const window = Array.from({ length: 5 }, (_, index) => newest.year - 4 + index);
    const output = await Promise.all(window.map(async (fiscalYear) => {
      const original = years.indexOf(fiscalYear);
      const report = original >= 0 ? results[original] : await annual(fiscalYear);
      return report ?? emptyReport(fiscalYear);
    }));
    return { company, reports: output, source: fetched ? "DART" : "DB" } as const;
  }

  async function quarterly(corpCode: string, requestedYear?: number): Promise<QuarterlyFinancials> {
    const company = await listedCompany(corpCode);
    const { year, month } = calendar();
    const currentMonth = year * 12 + month - 1;
    const fiscalYear = month > company.closingMonth ? year + 1 : year;
    const reportCodes = { 1: "11013", 2: "11012", 3: "11014" } as const;
    if (requestedYear !== undefined && (requestedYear < firstReportYear || requestedYear > fiscalYear)) {
      throw new MarketError("조회 가능한 사업연도를 선택해 주세요.", 400);
    }

    const closing = (forYear: number) => forYear * 12 + company.closingMonth - 1;

    async function yearReports(forYear: number): Promise<QuarterlyYear> {
      const closed = closing(forYear);
      const saved = await db.prepare(
        "SELECT quarter, data, fetched_at FROM quarterly_reports WHERE corp_code = ? AND year = ?",
      ).bind(corpCode, forYear).all<{ quarter: number; data: string | null; fetched_at: number }>();
      const cache = new Map(saved.results.filter(fresh).map((row) => [row.quarter, row.data]));

      async function interim(quarter: keyof typeof reportCodes): Promise<InterimReport | null> {
        const periodEnd = closed - (4 - quarter) * 3;
        const reportYear = Math.floor(periodEnd / 12);
        if (periodEnd >= currentMonth || reportYear < firstReportYear) return null;
        const cached = cache.get(quarter);
        if (cached !== undefined) return cached === null ? null : JSON.parse(cached) as InterimReport;
        const result = await filing(corpCode, reportYear, reportCodes[quarter]);
        let data: InterimReport | null = result ? {
          report: parseReport(result.rows, forYear, result.basis),
          cumulative: quarter === 3 ? parseReport(result.rows, forYear, result.basis, "thstrm_add_amount") : null,
        } : null;
        if (!data) {
          const original = saved.results.find((row) => row.quarter === quarter)?.data;
          if (original) {
            const old = JSON.parse(original) as InterimReport;
            data = { report: normalized(old.report), cumulative: old.cumulative ? normalized(old.cumulative) : null };
          }
        }
        await db.prepare(
          "INSERT INTO quarterly_reports (corp_code, year, quarter, data, fetched_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(corp_code, year, quarter) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at " +
          "WHERE excluded.fetched_at >= quarterly_reports.fetched_at",
        ).bind(corpCode, forYear, quarter, data ? JSON.stringify(data) : null, timestamp).run();
        return data;
      }

      const [first, second, third] = await Promise.all([interim(1), interim(2), interim(3)]);
      let fourth = emptyReport(forYear);
      if (closed < currentMonth && third?.cumulative) {
        const savedAnnual = await db.prepare(
          "SELECT data, fetched_at FROM annual_reports WHERE corp_code = ? AND year = ?",
        ).bind(corpCode, forYear).first<SavedAnnual>();
        const annual = savedAnnual && fresh(savedAnnual)
          ? JSON.parse(savedAnnual.data ?? "null") as AnnualReport | null
          : await fetchAnnual(corpCode, forYear);
        fourth = fourthQuarter(forYear, annual, third.cumulative);
      }
      const statements = [first?.report, second?.report, third?.report, fourth];
      return {
        year: forYear,
        reports: quarterNumbers.map((quarter, index) => ({
          ...(statements[index] ?? emptyReport(forYear)), quarter,
        })),
      };
    }

    if (requestedYear !== undefined) {
      return { years: [await yearReports(requestedYear)], nextYear: requestedYear > firstReportYear ? requestedYear - 1 : null };
    }
    let latestYear = closing(fiscalYear) - 9 < currentMonth ? fiscalYear : fiscalYear - 1;
    let latest = await yearReports(latestYear);
    if (latestYear === fiscalYear && !latest.reports.some(({ basis }) => basis)) {
      latestYear--;
      latest = await yearReports(latestYear);
    }
    return { years: [latest, await yearReports(latestYear - 1)], nextYear: latestYear - 2 };
  }

  return { search, listedCompany, financials, quarterly };
}
