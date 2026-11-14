import { MarketError } from "./dart.ts";
import type { DartTransport } from "./dart.ts";
import type { Company } from "./market.ts";
import type { IssuerQuote, StockQuote } from "./valuation.ts";

type QuoteRow = {
  itemCode: string;
  stockName: string;
  stockEndType: string;
  closePriceRaw?: string;
  closePrice: string;
  marketValueRaw?: string;
  marketValue: string;
  localTradedAt: string;
};
type QuotePage = { totalCount: number; stocks: QuoteRow[] };
type SavedQuotes = { fetched_at: number; data: string };

function integer(value: string | undefined) {
  const cleaned = value?.replaceAll(",", "").trim() ?? "";
  return /^\d+$/.test(cleaned) ? cleaned : null;
}

export function parseQuote(row: QuoteRow): StockQuote | null {
  const price = integer(row.closePriceRaw ?? row.closePrice);
  const rawCap = integer(row.marketValueRaw);
  const displayCap = integer(row.marketValue);
  const marketCap = rawCap ?? (displayCap === null ? null : (BigInt(displayCap) * BigInt(100_000_000)).toString());
  if (row.stockEndType !== "stock" || !/^[A-Z0-9]{6}$/.test(row.itemCode) || !row.stockName ||
      !price || !marketCap || BigInt(price) <= BigInt(0) || BigInt(marketCap) <= BigInt(0) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(row.localTradedAt) || !Number.isFinite(Date.parse(row.localTradedAt))) return null;
  return { code: row.itemCode, name: row.stockName, price, marketCap, quotedAt: row.localTradedAt };
}

export function issuerQuote(stocks: StockQuote[], code: string, fetchedAt: number, stale: boolean): IssuerQuote {
  const common = stocks.find((stock) => stock.code === code);
  if (!common) throw new MarketError("해당 종목의 시가총액을 조회하지 못했습니다.");
  const base = common.name.normalize("NFKC").replace(/\s+/g, "");
  const members = stocks.filter((stock) => {
    if (stock.code === code) return true;
    if (stock.code.slice(0, 5) !== code.slice(0, 5)) return false;
    const name = stock.name.normalize("NFKC").replace(/\s+/g, "");
    return name.startsWith(base) && /^(?:\d+)?우[BC]?$/.test(name.slice(base.length));
  });
  if (members.some((stock) => stock.quotedAt.slice(0, 10) !== common.quotedAt.slice(0, 10))) {
    throw new MarketError("보통주·우선주 시가총액의 기준일이 달라 계산할 수 없습니다.");
  }
  return {
    marketCap: members.reduce((sum, stock) => sum + BigInt(stock.marketCap), BigInt(0)).toString(),
    quotedAt: members.reduce((latest, stock) => Date.parse(stock.quotedAt) > Date.parse(latest) ? stock.quotedAt : latest, common.quotedAt),
    fetchedAt, stale, stocks: members.sort((a, b) => a.code === code ? -1 : b.code === code ? 1 : a.code.localeCompare(b.code)),
  };
}

export function quoteService(db: D1Database, transport?: DartTransport) {
  async function quote(company: Company): Promise<IssuerQuote> {
    if (!company.market) throw new MarketError("상장기업을 선택해 주세요.", 400);
    const market = company.market;
    const cached = await db.prepare("SELECT fetched_at, data FROM market_quotes WHERE market = ?")
      .bind(market).first<SavedQuotes>();
    const now = Date.now();
    if (cached && now - cached.fetched_at < 15 * 60_000) {
      return issuerQuote(JSON.parse(cached.data) as StockQuote[], company.stockCode, cached.fetched_at, false);
    }

    async function page(number: number): Promise<QuotePage> {
      const args = { page: String(number), pageSize: "100" };
      const response = transport
        ? await transport("quotes/" + market, args)
        : await fetch("https://m.stock.naver.com/api/stocks/marketValue/" + market + "?" + new URLSearchParams(args),
          { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new MarketError("네이버 증권 시가총액을 불러오지 못했습니다.");
      const result = await response.json<QuotePage>();
      if (!Array.isArray(result.stocks) || !Number.isInteger(result.totalCount) || result.totalCount < 1 || result.totalCount > 6000) {
        throw new MarketError("시가총액 목록을 완전히 읽지 못했습니다.");
      }
      return result;
    }

    let stocks: StockQuote[];
    try {
      const first = await page(1);
      const rows = [...first.stocks];
      const pages = Math.ceil(first.totalCount / 100);
      for (let index = 2; index <= pages; index += 4) {
        const group = await Promise.all(Array.from({ length: Math.min(4, pages - index + 1) }, (_, offset) => page(index + offset)));
        rows.push(...group.flatMap((result) => result.stocks));
      }
      if (rows.length !== first.totalCount) throw new MarketError("시가총액 목록 일부가 누락되었습니다.");
      stocks = rows.map(parseQuote).filter((stock): stock is StockQuote => stock !== null);
      if (!stocks.length) throw new MarketError("사용할 수 있는 시가총액 자료가 없습니다.");
    } catch (error) {
      if (cached) return issuerQuote(JSON.parse(cached.data) as StockQuote[], company.stockCode, cached.fetched_at, true);
      throw error instanceof MarketError ? error : new MarketError("시가총액에 연결하지 못했습니다. 다시 시도해 주세요.");
    }
    await db.prepare(
      "INSERT INTO market_quotes (market, fetched_at, data) VALUES (?, ?, ?) " +
      "ON CONFLICT(market) DO UPDATE SET fetched_at=excluded.fetched_at, data=excluded.data WHERE excluded.fetched_at >= market_quotes.fetched_at",
    ).bind(market, now, JSON.stringify(stocks)).run();
    return issuerQuote(stocks, company.stockCode, now, false);
  }
  return { quote };
}
