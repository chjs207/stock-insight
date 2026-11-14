import { MarketError } from "./dart.ts";
import type { DartTransport } from "./dart.ts";
import type { Company } from "./market.ts";
import { parseCandles } from "./price-data.ts";
import type { Candle, PriceHistory } from "./price-data.ts";

type SavedPrices = { data: string; fetched_at: number };
const inflight = new WeakMap<D1Database, Map<string, Promise<PriceHistory>>>();

export function priceService(db: D1Database, transport?: DartTransport) {
  async function load(company: Company, refresh: boolean): Promise<PriceHistory> {
    const cached = await db.prepare("SELECT data, fetched_at FROM price_history WHERE stock_code = ?")
      .bind(company.stockCode).first<SavedPrices>();
    const saved = cached ? { candles: JSON.parse(cached.data) as Candle[], fetchedAt: cached.fetched_at } : null;
    if (saved && Date.now() - saved.fetchedAt < (refresh ? 30_000 : 15 * 60_000)) {
      return { ...saved, source: "DB", stale: false };
    }
    try {
      const args = { stockCode: company.stockCode };
      const response = transport ? await transport("kiwoom/chart", args)
        : await fetch("https://kiwoom.stock-insight.internal/chart?" + new URLSearchParams(args), { signal: AbortSignal.timeout(32_000) });
      const result = await response.json<{ rows?: unknown[]; cutoff?: string; fetchedAt?: number; error?: string }>();
      if (!response.ok) throw new MarketError(result.error ?? "키움 차트를 조회하지 못했습니다.", response.status);
      if (!Array.isArray(result.rows) || !/^\d{8}$/.test(result.cutoff ?? "") || !Number.isSafeInteger(result.fetchedAt)) throw new MarketError("키움 차트 자료를 확인하지 못했습니다.");
      let candles: Candle[];
      try { candles = parseCandles(result.rows, result.cutoff!); }
      catch { throw new MarketError("키움 가격·거래량 자료를 읽지 못했습니다. 다시 조회해 주세요."); }
      if (!candles.length) throw new MarketError("표시할 주가 자료가 없습니다. 신규 상장 또는 거래 상태를 확인해 주세요.", 404);
      const fetchedAt = result.fetchedAt!;
      await db.prepare("INSERT INTO price_history (stock_code, fetched_at, data) VALUES (?, ?, ?) " +
        "ON CONFLICT(stock_code) DO UPDATE SET fetched_at=excluded.fetched_at, data=excluded.data WHERE excluded.fetched_at >= price_history.fetched_at")
        .bind(company.stockCode, fetchedAt, JSON.stringify(candles)).run();
      return { candles, fetchedAt, source: "KIWOOM", stale: false };
    } catch (error) {
      const failure = error instanceof MarketError ? error : new MarketError("키움 시세 서버에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요.");
      if (saved) return { ...saved, source: "DB", stale: true, warning: failure.message };
      throw failure;
    }
  }

  return {
    history(company: Company, refresh = false) {
      if (!company.market) throw new MarketError("KOSPI·KOSDAQ 상장기업을 선택해 주세요.", 400);
      let requests = inflight.get(db);
      if (!requests) { requests = new Map(); inflight.set(db, requests); }
      const pending = requests.get(company.stockCode);
      if (pending) return pending;
      const result = load(company, refresh).finally(() => requests!.delete(company.stockCode));
      requests.set(company.stockCode, result);
      return result;
    },
  };
}
