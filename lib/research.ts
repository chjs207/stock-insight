import { MarketError } from "./dart.ts";
import type { DartTransport } from "./dart.ts";
import { researchPageSize, researchSourceUrl } from "./research-data.ts";
import type { ResearchListing, ResearchPage, ResearchReport } from "./research-data.ts";

const inflight = new WeakMap<D1Database, Map<string, Promise<ResearchListing>>>();
const invalidResponse = () => new MarketError("네이버 리서치 목록의 형식을 확인하지 못했습니다. 네이버 원본을 확인하거나 나중에 다시 조회해 주세요.");

function readPage(data: unknown, page: number, query: string): ResearchPage {
  if (!data || typeof data !== "object") throw invalidResponse();
  const raw = data as Record<string, unknown>;
  const total = Number(raw.totalCount);
  if (!Array.isArray(raw.items) || raw.items.length > researchPageSize ||
      typeof raw.hasNext !== "boolean" || !/^(0|[1-9]\d*)$/.test(String(raw.totalCount)) ||
      !Number.isSafeInteger(total) || total < raw.items.length || (raw.hasNext && !raw.items.length)) throw invalidResponse();
  const reports: ResearchReport[] = raw.items.map(value => {
    if (!value || typeof value !== "object") throw invalidResponse();
    const item = value as Record<string, unknown>;
    const id = String(item.nid ?? "");
    if (!/^\d{1,12}$/.test(id) || typeof item.title !== "string" || !item.title.trim() ||
        typeof item.writeDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.writeDate) ||
        !Number.isFinite(Date.parse(item.writeDate))) throw invalidResponse();
    const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
    const target = String(item.goalPrice ?? "");
    return {
      id, title: item.title.trim(), company: text(item.itemName) || "종목 미상",
      stockCode: /^\d{6}$/.test(String(item.itemCode)) ? String(item.itemCode) : null,
      broker: text(item.brokerName) || "발행사 미상", date: item.writeDate,
      targetPrice: /^[1-9]\d*$/.test(target) ? target : null,
      opinion: text(item.opinionText) || null, url: researchSourceUrl + "/" + id,
    };
  });
  if (new Set(reports.map(report => report.id)).size !== reports.length) throw invalidResponse();
  return { reports, total, hasNext: raw.hasNext, page, query };
}

export function researchService(db: D1Database, transport: DartTransport) {
  async function load(page: number, query: string, refresh: boolean, cacheKey: string): Promise<ResearchListing> {
    const cached = await db.prepare("SELECT data, fetched_at FROM research_pages WHERE cache_key = ?")
      .bind(cacheKey).first<{ data: string; fetched_at: number }>();
    const saved = cached ? { ...JSON.parse(cached.data) as ResearchPage, fetchedAt: cached.fetched_at } : null;
    if (saved && Date.now() - saved.fetchedAt < (refresh ? 30_000 : 10 * 60_000)) {
      return { ...saved, source: "DB", stale: false };
    }
    try {
      const response = await transport("research/company", { index: String(page), size: String(researchPageSize), ...(query ? { query } : {}) });
      if (!response.ok) throw new MarketError("네이버 리서치 목록을 조회하지 못했습니다. 잠시 후 다시 조회해 주세요.");
      const result = readPage(await response.json(), page, query);
      const fetchedAt = Date.now();
      await db.prepare("INSERT INTO research_pages (cache_key, fetched_at, data) VALUES (?, ?, ?) " +
        "ON CONFLICT(cache_key) DO UPDATE SET fetched_at=excluded.fetched_at, data=excluded.data WHERE excluded.fetched_at >= research_pages.fetched_at")
        .bind(cacheKey, fetchedAt, JSON.stringify(result)).run();
      return { ...result, fetchedAt, source: "NAVER", stale: false };
    } catch (error) {
      const failure = error instanceof MarketError ? error : new MarketError("네이버 리서치에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요.");
      if (saved) return { ...saved, source: "DB", stale: true, warning: failure.message };
      throw failure;
    }
  }

  return {
    list(page = 0, input = "", refresh = false): Promise<ResearchListing> {
      const query = input.trim();
      if (!Number.isInteger(page) || page < 0 || page > 10_000 || query.length > 60) {
        throw new MarketError("검색어는 60자 이내, 페이지는 올바른 범위로 입력해 주세요.", 400);
      }
      const cacheKey = JSON.stringify([query, page]);
      let requests = inflight.get(db);
      if (!requests) { requests = new Map(); inflight.set(db, requests); }
      const pending = requests.get(cacheKey);
      if (pending) return pending;
      const result = load(page, query, refresh, cacheKey).finally(() => requests!.delete(cacheKey));
      requests.set(cacheKey, result);
      return result;
    },
  };
}
