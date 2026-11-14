import type { Company, QuarterlyFinancials, QuarterlyYear } from "../lib/market";
import type { Catalog, CompanyData, GiantsData } from "./data-types";
import { basePath } from "./config";

const pending = new Map<string, Promise<unknown>>();
export async function dataFile<T>(name: string): Promise<T> {
  if (!pending.has(name)) {
    pending.set(name, (async () => {
      const response = await fetch(basePath + "data/" + name, { cache: "no-cache" });
      if (!response.ok) throw new Error("저장된 자료를 읽지 못했습니다. 잠시 후 새로고침해 주세요.");
      try { return await response.json(); }
      catch { throw new Error("자료 형식을 읽지 못했습니다. 최신 배포 상태를 확인해 주세요."); }
    })().catch(error => { pending.delete(name); throw error; }));
  }
  return pending.get(name) as Promise<T>;
}

export const getCatalog = () => dataFile<Catalog>("catalog.json");
export const getGiants = () => dataFile<GiantsData>("giants.json");
export const getCompanyData = (corp: string) => {
  if (!/^\d{8}$/.test(corp)) throw new Error("기업 고유번호를 확인해 주세요.");
  return dataFile<CompanyData>("companies/" + corp + ".json");
};

const storageKey = "stock-insight-pages:watchlist:v1";
function validCompany(value: unknown): value is Company {
  if (!value || typeof value !== "object") return false;
  const company = value as Company;
  return /^\d{8}$/.test(company.corpCode) && /^[A-Z0-9]{6}$/.test(company.stockCode) &&
    typeof company.name === "string" && company.name.length > 0 && company.name.length <= 150 &&
    (company.market === "KOSPI" || company.market === "KOSDAQ") &&
    Number.isInteger(company.closingMonth) && company.closingMonth >= 1 && company.closingMonth <= 12;
}
export function readWatchlist(): Company[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved) || !saved.every(validCompany)) throw new Error();
    return saved;
  } catch { throw new Error("이 브라우저의 관심종목 저장소를 읽지 못했습니다. 브라우저 저장 권한을 확인해 주세요."); }
}
export function writeWatchlist(companies: Company[]) {
  if (companies.length > 1000 || !companies.every(validCompany)) throw new Error("관심종목 파일 형식이 올바르지 않습니다.");
  const unique = [...new Map(companies.map(company => [company.corpCode, company])).values()];
  try { localStorage.setItem(storageKey, JSON.stringify(unique)); }
  catch { throw new Error("관심종목을 저장하지 못했습니다. 브라우저의 저장 공간과 권한을 확인해 주세요."); }
}

function normalize(value: string) { return value.normalize("NFKC").toLowerCase().replace(/[\s.·()_-]/g, ""); }
export function searchCompanies(companies: Company[], query: string) {
  const term = normalize(query);
  if (!term) return [];
  const rank = (company: Company) => company.stockCode.toLowerCase() === term || normalize(company.name) === term ? 0
    : normalize(company.name).startsWith(term) ? 1 : normalize(company.name).includes(term) ? 2 : 3;
  const sorted = companies.map(company => ({ company, rank: rank(company) })).filter(item => item.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.company.name.length - b.company.name.length);
  const exact = sorted.filter(item => item.rank === 0);
  return (exact.length ? exact : sorted.slice(0, 20)).map(item => item.company);
}

export function quarterSlice(years: QuarterlyYear[], requestedYear?: number): QuarterlyFinancials {
  const sorted = years.slice().sort((a, b) => b.year - a.year);
  const selected = requestedYear === undefined ? sorted.slice(0, 2) : sorted.filter(year => year.year === requestedYear);
  if (!selected.length) throw new Error("해당 연도는 아직 수집되지 않았습니다. 자료 수집에서 분기 수집 연수를 늘려 주세요.");
  const last = selected.at(-1)!.year;
  return { years: selected, nextYear: sorted.some(year => year.year === last - 1) ? last - 1 : null };
}

export async function pagesRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = new URL(path, "https://stock-insight.local");
  const params = url.searchParams;
  const method = options.method ?? "GET";
  if (url.pathname === "/api/watchlist") {
    const saved = readWatchlist();
    if (method === "GET") return { companies: saved } as T;
    const corp = params.get("corp");
    if (!corp || !/^\d{8}$/.test(corp)) throw new Error("기업 고유번호를 확인해 주세요.");
    if (method === "DELETE") { writeWatchlist(saved.filter(company => company.corpCode !== corp)); return { saved: false } as T; }
    if (method === "PUT") {
      const company = (await getCatalog()).companies.find(company => company.corpCode === corp);
      if (!company) throw new Error("검색 목록에 있는 상장기업을 선택해 주세요.");
      writeWatchlist([company, ...saved.filter(item => item.corpCode !== corp)]);
      return { saved: true } as T;
    }
  }
  if (url.pathname === "/api/market" && method === "GET") {
    const catalog = await getCatalog();
    if (params.get("status") === "1") return { configured: catalog.companies.length > 0 } as T;
    const corp = params.get("corp");
    if (corp) {
      const company = catalog.companies.find(company => company.corpCode === corp);
      if (!company) throw new Error("KOSPI·KOSDAQ 기업 목록에서 찾지 못했습니다.");
      if (params.get("profile") === "1") return (catalog.collected[corp] ? (await getCompanyData(corp)).company : company) as T;
      if (!catalog.collected[corp]) throw new Error("아직 수집되지 않은 기업입니다. 자료 수집 안내에서 종목을 추가해 주세요.");
      const data = await getCompanyData(corp);
      if (params.get("valuation") === "1") {
        if (!data.quote) throw new Error("수집된 시가총액이 없습니다. 다음 수집 후 PER·POR를 계산할 수 있습니다.");
        return { ...data.quote, stale: data.quote.stale || Date.now() - data.quote.fetchedAt > 86400_000 } as T;
      }
      if (params.get("period") === "quarterly") {
        const year = params.get("year");
        if (year !== null && !/^\d{4}$/.test(year)) throw new Error("사업연도를 확인해 주세요.");
        return quarterSlice(data.quarters ?? [], year === null ? undefined : Number(year)) as T;
      }
      if (!data.annual) throw new Error("연간 재무자료가 아직 수집되지 않았습니다.");
      return data.annual as T;
    }
    const search = params.get("q")?.trim();
    if (!search || search.length > 60) throw new Error("기업명 또는 종목코드를 입력해 주세요.");
    return { companies: searchCompanies(catalog.companies, search) } as T;
  }
  if (url.pathname === "/api/giants" && method === "GET") {
    const data = await getGiants();
    const manager = params.get("manager");
    if (!manager) return { managers: data.managers, coverage: data.coverage } as T;
    return (data.snapshots[manager] ?? { reports: [], pending: 0 }) as T;
  }
  throw new Error("자료 갱신은 GitHub의 자료 수집 화면에서 실행해 주세요.");
}
