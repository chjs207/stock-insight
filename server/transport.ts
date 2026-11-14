import { setTimeout as delay } from "node:timers/promises";
import { createKiwoomClient } from "../scripts/kiwoom-client.mjs";
import { MarketError } from "../lib/dart.ts";
import type { DartTransport } from "../lib/dart.ts";
import type { Configuration } from "./config.ts";

export function serverTransport(config: Configuration): DartTransport {
  const kiwoom = createKiwoomClient(config.appKey, config.appSecret);
  let queue: Promise<unknown> = Promise.resolve();
  return (path, params) => {
    if (path === "kiwoom/chart") return kiwoom.chart(params.stockCode).then(result => Response.json(result.body, { status: result.status }));
    const quote = /^quotes\/(KOSPI|KOSDAQ)$/.test(path);
    if (!quote && !/^(corpCode\.xml|company\.json|fnlttSinglAcntAll\.json|list\.json|document\.xml)$/.test(path)) {
      return Promise.reject(new MarketError("지원하지 않는 조회 경로입니다.", 400));
    }
    const next = queue.then(async () => {
      const url = new URL(quote ? "https://m.stock.naver.com/api/stocks/marketValue/" + path.slice(7)
        : "https://opendart.fss.or.kr/api/" + path);
      url.search = new URLSearchParams(quote ? params : { ...params, crtfc_key: config.dartKey }).toString();
      for (let attempt = 0; attempt < 3; attempt++) {
        await delay(attempt ? 1000 * 2 ** attempt : 200);
        try {
          const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "StockInsight/1.1" } });
          if (!response.ok) continue;
          return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
        } catch { /* Credential-bearing URLs and upstream exceptions stay on the server. */ }
      }
      throw new MarketError(quote ? "시가총액 조회에 실패했습니다." : "OpenDART에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요.");
    });
    queue = next.catch(() => {});
    return next;
  };
}
