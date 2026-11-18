import { MarketError, marketService } from "../lib/dart.ts";
import type { DartTransport } from "../lib/dart.ts";
import { giantsService } from "../lib/giants.ts";
import { quoteService } from "../lib/quotes.ts";
import { priceService } from "../lib/prices.ts";
import { researchService } from "../lib/research.ts";
import type { Company } from "../lib/market.ts";
import { highService } from "../lib/highs.ts";

export function createApi(db: D1Database, dartKey: string, transport: DartTransport) {
  return async (url: URL, method: string, body?: unknown): Promise<Response> => {
    const params = url.searchParams;
    const market = marketService(db, dartKey, transport);
    const headers = { "Cache-Control": "no-store" };
    const json = (data: unknown) => Response.json(data, { headers });
    try {
      if (url.pathname === "/api/highs" && method === "POST") {
        if (!body || typeof body !== "object" || Array.isArray(body) || !("text" in body) || typeof body.text !== "string" ||
            ("refresh" in body && typeof body.refresh !== "boolean")) throw new MarketError("조회할 메시지를 올바르게 입력해 주세요.", 400);
        return json(await highService(db, dartKey, transport).analyze(body.text, "refresh" in body && body.refresh === true));
      }
      if (url.pathname === "/api/research" && method === "GET") {
        const page = params.get("page") ?? "0";
        if (!/^(0|[1-9]\d{0,4})$/.test(page)) throw new MarketError("올바른 페이지를 선택해 주세요.", 400);
        const mode = params.get("mode") ?? "keyword";
        if (!["company", "keyword"].includes(mode) || (mode === "keyword" && params.has("stock"))) {
          throw new MarketError("기업명 또는 키워드 검색 방식을 선택해 주세요.", 400);
        }
        return json(await researchService(db, transport).list(Number(page), params.get("q") ?? "", params.get("refresh") === "1",
          mode === "company" ? params.get("stock") ?? "" : undefined));
      }
      if (url.pathname === "/api/market" && method === "GET") {
        if (params.get("status") === "1") return json({ configured: Boolean(dartKey) });
        const corp = params.get("corp");
        if (corp !== null) {
          if (!/^\d{8}$/.test(corp)) throw new MarketError("올바른 기업 고유번호를 입력해 주세요.", 400);
          const company = () => market.listedCompany(corp);
          if (params.get("chart") === "1") return json(await priceService(db, transport).history(await company(), params.get("refresh") === "1"));
          if (params.get("valuation") === "1") return json(await quoteService(db, transport).quote(await company()));
          if (params.get("profile") === "1") return json(await company());
          if (params.get("period") === "quarterly") {
            const year = params.get("year");
            if (year !== null && !/^\d{4}$/.test(year)) throw new MarketError("올바른 사업연도를 입력해 주세요.", 400);
            return json(await market.quarterly(corp, year === null ? undefined : Number(year)));
          }
          return json(await market.financials(corp));
        }
        const query = params.get("q")?.trim();
        if (!query || query.length > 60) throw new MarketError("기업명 또는 종목코드를 60자 이내로 입력해 주세요.", 400);
        return json({ companies: await market.search(query) });
      }
      if (url.pathname === "/api/watchlist") {
        if (method === "GET") {
          const rows = await db.prepare("SELECT companies.data FROM watchlist JOIN companies ON companies.corp_code = watchlist.corp_code ORDER BY watchlist.added_at DESC, watchlist.corp_code").all<{ data: string }>();
          return json({ companies: rows.results.map(row => JSON.parse(row.data) as Company) });
        }
        const corp = params.get("corp");
        if (!corp || !/^\d{8}$/.test(corp)) throw new MarketError("올바른 기업 고유번호를 입력해 주세요.", 400);
        if (method === "PUT") {
          const company = await market.listedCompany(corp);
          await db.prepare("INSERT OR IGNORE INTO watchlist (corp_code, added_at) VALUES (?, ?)").bind(company.corpCode, Date.now()).run();
          return json({ saved: true });
        }
        if (method === "DELETE") {
          await db.prepare("DELETE FROM watchlist WHERE corp_code=?").bind(corp).run();
          return json({ saved: false });
        }
      }
      if (url.pathname === "/api/giants") {
        const service = giantsService(db, dartKey, transport);
        const manager = params.get("manager");
        if (method === "GET" && params.get("preview") === "1") return json(await service.previewManager(params.get("name") ?? ""));
        if (method === "PUT") return json(await service.addManager(params.get("name") ?? ""));
        if (method === "DELETE") {
          await service.removeManager(manager ?? "");
          return json({ managers: await service.managers() });
        }
        if (method === "POST" && !manager) { await service.syncMonth(params.get("month") ?? ""); return json({ synced: true }); }
        if (manager) {
          if (method === "POST") await service.syncDetails(manager);
          return json(await service.snapshot(manager));
        }
        return json({ managers: await service.managers(), coverage: await service.coverage() });
      }
      return Response.json({ error: "지원하지 않는 요청입니다." }, { status: 404, headers });
    } catch (error) {
      if (error instanceof MarketError) return Response.json({ error: error.message }, { status: error.httpStatus, headers });
      return Response.json({ error: "자료를 처리하지 못했습니다. 잠시 후 다시 조회해 주세요." }, { status: 500, headers });
    }
  };
}
