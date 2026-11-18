import { dartClient, MarketError, marketService } from "./dart.ts";
import type { DartTransport } from "./dart.ts";
import type { Company } from "./market.ts";
import { highCompanyLimit, highMessageLimit, parseHighMessage } from "./high-message.ts";
import type { HighCandidate, HighIssue, HighListing, HighRow } from "./high-message.ts";

export function highService(db: D1Database, key: string, transport: DartTransport) {
  return {
    async analyze(text: string, refresh = false): Promise<HighListing> {
      if (!text.trim() || text.length > highMessageLimit) throw new MarketError("메시지를 20,000자 이내로 붙여넣어 주세요.", 400);
      const [saved, profiles] = await Promise.all([
        db.prepare("SELECT data, fetched_at FROM corp_directory WHERE id=1").first<{ data: string; fetched_at: number }>(),
        db.prepare("SELECT data FROM companies").all<{ data: string }>(),
      ]);
      const known = profiles.results.map(row => JSON.parse(row.data) as Company);
      let catalog = saved ? JSON.parse(saved.data) as HighCandidate[] : [];
      let updated = saved?.fetched_at ?? 0;
      let warning: string | undefined;
      if (!saved || refresh) {
        if (saved && refresh && Date.now() - saved.fetched_at < 30_000) throw new MarketError("기업 목록을 방금 갱신했습니다. 30초 뒤 다시 시도해 주세요.", 429);
        try {
          catalog = await dartClient(key, transport).directory(); updated = Date.now();
          await db.prepare("INSERT INTO corp_directory (id,data,fetched_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at WHERE excluded.fetched_at >= corp_directory.fetched_at")
            .bind(JSON.stringify(catalog), updated).run();
        } catch (error) {
          if (!saved && !known.length) throw error;
          warning = "기업 목록 갱신에 실패해 저장된 기업 목록으로 조회했습니다.";
        }
      }
      let mentions;
      try { mentions = parseHighMessage(text, [...catalog, ...known]); }
      catch (error) { throw new MarketError(error instanceof Error ? error.message : "메시지를 나누어 붙여넣어 주세요.", 400); }
      if (!mentions.length) throw new MarketError("기업명 또는 종목코드를 찾지 못했습니다. 종목 목록을 붙여넣어 주세요.", 400);
      const identifiers = new Set(mentions.flatMap(item => item.candidates.map(company => company.corpCode)));
      if (identifiers.size > highCompanyLimit) throw new MarketError("한 번에 최대 100개 기업을 조회할 수 있습니다. 메시지를 나누어 주세요.", 400);
      const market = marketService(db, key, transport);
      const verified = new Map<string, Company | null>();
      const failures = new Set<string>();
      let upstreamFailed = false;
      for (const corpCode of identifiers) {
        const cached = known.find(company => company.corpCode === corpCode);
        if (cached) { verified.set(corpCode, cached.market ? cached : null); continue; }
        if (upstreamFailed) { failures.add(corpCode); continue; }
        try { verified.set(corpCode, await market.listedCompany(corpCode)); }
        catch (error) {
          if (error instanceof MarketError && error.httpStatus === 404) verified.set(corpCode, null);
          else { failures.add(corpCode); upstreamFailed = true; }
        }
      }
      const rows = new Map<string, HighRow>();
      const issues: HighIssue[] = [];
      for (const mention of mentions) {
        const companies = [...new Map(mention.candidates.map(item => verified.get(item.corpCode)).filter((item): item is Company => Boolean(item)).map(company => [company.corpCode, company])).values()];
        const hasFailure = mention.candidates.some(item => failures.has(item.corpCode));
        if (!mention.conflict && companies.length === 1 && !hasFailure) {
          const company = companies[0];
          const row = rows.get(company.corpCode) ?? { company, inputs: [], categories: [], notes: [] };
          row.inputs = [...new Set([...row.inputs, mention.input])];
          row.categories = [...new Set([...row.categories, ...mention.categories])];
          row.notes = [...new Set([...row.notes, ...mention.notes])];
          rows.set(company.corpCode, row);
        } else {
          const status = mention.conflict ? "conflict" : hasFailure ? "failed" : companies.length > 1 ? "ambiguous"
            : mention.candidates.length ? "excluded" : "unmatched";
          const messages = { conflict: "기업명과 종목코드가 일치하지 않습니다.", failed: "상장기업 확인에 실패했습니다. 다시 조회해 주세요.",
            ambiguous: "동명 기업이 여러 개입니다. 종목코드를 입력해 구분해 주세요.", excluded: "KOSPI·KOSDAQ 상장기업으로 확인되지 않았습니다.",
            unmatched: "일치하는 기업을 찾지 못했습니다. 이름·코드를 확인하거나 기업 목록을 갱신해 주세요." };
          issues.push({ input: mention.input, categories: mention.categories, notes: mention.notes, status, message: messages[status],
            ...(companies.length > 1 ? { choices: companies } : {}) });
        }
      }
      return { rows: [...rows.values()], issues, mentionCount: mentions.length, analyzedAt: Date.now(), directoryUpdatedAt: updated,
        ...(warning || upstreamFailed ? { warning: warning ?? "일부 기업의 상장 여부를 확인하지 못했습니다. 확인된 기업부터 표시합니다." } : {}) };
    },
  };
}
