import { setTimeout as delay } from "node:timers/promises";
import { MarketError } from "../lib/dart.ts";
import type { DartTransport } from "../lib/dart.ts";

export function collectorTransport(key: string, budget: number) {
  let queue: Promise<unknown> = Promise.resolve();
  let requests = 0;
  const transport: DartTransport = (path, params) => {
    const next = queue.then(async () => {
      if (!/^(corpCode\.xml|company\.json|fnlttSinglAcntAll\.json|list\.json|document\.xml|quotes\/(KOSPI|KOSDAQ))$/.test(path)) {
        throw new MarketError("지원하지 않는 수집 경로입니다.");
      }
      const quote = path.startsWith("quotes/");
      const url = new URL(quote ? "https://m.stock.naver.com/api/stocks/marketValue/" + path.slice(7)
        : "https://opendart.fss.or.kr/api/" + path);
      url.search = new URLSearchParams(quote ? params : { ...params, crtfc_key: key }).toString();
      for (let attempt = 0; attempt < 3; attempt++) {
        if (requests >= budget) throw new MarketError("이번 실행의 수집 한도에 도달했습니다. 다음 실행에서 이어집니다.");
        requests++;
        await delay(attempt ? 1000 * 2 ** attempt : 180);
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error",
            headers: { "User-Agent": "StockInsight/1.0", Accept: "application/json,application/xml,*/*" } });
          if (!response.ok) continue;
          // Consume each body within the queue; retries must not leak key-bearing URLs.
          const body = await response.arrayBuffer();
          return new Response(body, { status: response.status, headers: response.headers });
        } catch { /* Only sanitized errors leave the collector transport. */ }
      }
      throw new MarketError(quote ? "네이버 시가총액 수집에 실패했습니다." : "OpenDART 연결에 실패했습니다.");
    });
    queue = next.catch(() => {});
    return next;
  };
  return { transport, requestCount: () => requests };
}
