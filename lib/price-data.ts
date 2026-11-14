export type PricePeriod = "day" | "week" | "month";
export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };
export type PriceHistory = {
  candles: Candle[];
  fetchedAt: number;
  source: "DB" | "KIWOOM";
  stale: boolean;
  warning?: string;
};

function unsigned(value: unknown) {
  if (typeof value !== "string" || !/^[+-]?\d+$/.test(value.trim())) return null;
  const result = Math.abs(Number(value));
  return Number.isSafeInteger(result) ? result : null;
}

export function parseCandles(rows: unknown[], cutoff: string): Candle[] {
  const candles = new Map<string, Candle>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") throw new Error("차트 자료 형식이 올바르지 않습니다.");
    const row = raw as Record<string, unknown>;
    const date = String(row.dt ?? "");
    if (!/^\d{8}$/.test(date)) throw new Error("차트 날짜가 올바르지 않습니다.");
    const time = date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8);
    if (!Number.isFinite(Date.parse(time)) || new Date(time).toISOString().slice(0, 10) !== time) throw new Error("차트 날짜가 올바르지 않습니다.");
    const open = unsigned(row.open_pric), high = unsigned(row.high_pric), low = unsigned(row.low_pric);
    const close = unsigned(row.cur_prc), volume = unsigned(row.trde_qty);
    if (open === null || high === null || low === null || close === null || volume === null) throw new Error("차트 가격 또는 거래량을 읽지 못했습니다.");
    // Suspended days can have zero OHLC. Keep the last quoted close as a flat
    // candle only when no trades took place; never turn malformed data into a bar.
    let candle: Candle;
    if (volume === 0 && open === 0 && high === 0 && low === 0 && close > 0) candle = { time, open: close, high: close, low: close, close, volume };
    else if (open === 0 && high === 0 && low === 0 && close === 0 && volume === 0) continue;
    else {
      if (low <= 0 || high < Math.max(open, close) || low > Math.min(open, close)) throw new Error("차트 고가·저가 범위가 올바르지 않습니다.");
      candle = { time, open, high, low, close, volume };
    }
    const previous = candles.get(time);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candle)) throw new Error("같은 날짜의 차트 자료가 서로 다릅니다.");
    if (date >= cutoff) candles.set(time, candle);
  }
  return [...candles.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export function aggregateCandles(daily: Candle[], period: PricePeriod): Candle[] {
  if (period === "day") return daily;
  const groups = new Map<string, Candle>();
  for (const candle of daily) {
    const date = new Date(candle.time + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const key = period === "month" ? candle.time.slice(0, 7) : date.toISOString().slice(0, 10);
    const group = groups.get(key);
    if (!group) groups.set(key, { ...candle });
    else {
      group.high = Math.max(group.high, candle.high);
      group.low = Math.min(group.low, candle.low);
      group.close = candle.close;
      group.volume += candle.volume;
    }
  }
  return [...groups.values()];
}

export function previousSwing(candles: readonly Candle[], field: "low" | "high"): Candle | null {
  const moreExtreme = field === "low"
    ? (price: number, neighbor: number) => price < neighbor
    : (price: number, neighbor: number) => price > neighbor;
  // A swing needs a candle on both sides of its price level.
  let index = candles.length - 2;
  while (index > 0) {
    const candidate = candles[index];
    const price = candidate[field];
    const next = candles[index + 1][field];
    // Treat equal neighboring prices as one level dated at its last candle.
    while (index > 0 && candles[index - 1][field] === price) index--;
    if (index > 0 && moreExtreme(price, candles[index - 1][field]) && moreExtreme(price, next)) return candidate;
    index--;
  }
  return null;
}

export function movingAverage(candles: Candle[], window: number) {
  const points: { time: string; value: number }[] = [];
  let total = 0;
  for (let index = 0; index < candles.length; index++) {
    total += candles[index].close;
    if (index >= window) total -= candles[index - window].close;
    if (index >= window - 1) points.push({ time: candles[index].time, value: total / window });
  }
  return points;
}
