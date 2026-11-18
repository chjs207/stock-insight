import type { Company } from "./market.ts";

export const highMessageLimit = 20_000;
export const highCompanyLimit = 100;
export type HighCandidate = Pick<Company, "corpCode" | "stockCode" | "name">;
export type HighMention = {
  input: string;
  name: string;
  stockCode: string | null;
  categories: string[];
  notes: string[];
  candidates: HighCandidate[];
  conflict: boolean;
};
export type HighRow = {
  inputs: string[];
  categories: string[];
  notes: string[];
  company: Company;
};
export type HighIssue = {
  input: string;
  categories: string[];
  notes: string[];
  status: "unmatched" | "ambiguous" | "conflict" | "excluded" | "failed";
  message: string;
  choices?: Company[];
};
export type HighListing = {
  rows: HighRow[];
  issues: HighIssue[];
  mentionCount: number;
  analyzedAt: number;
  directoryUpdatedAt: number;
  warning?: string;
};

export const highName = (name: string) => name.normalize("NFKC").replace(/(?:\(주\)|주식회사|㈜)/gu, "").replace(/\s+/gu, "").toLowerCase();
const stockCode = (word: string) => {
  const value = word.replace(/^[\[⟪]|[\]⟫]$/gu, "").toUpperCase();
  const code = /^A\d{6}$/.test(value) ? value.slice(1) : value;
  return /^(?=.*\d)[A-Z0-9]{6}$/.test(code) ? code : null;
};
const heading = /^(?:52주|52주신고가|신고가|신고가종목|종목|종목명|기업|기업명|KOSPI|KOSDAQ|코스피|코스닥|목록|오늘|금일|신규)$/iu;

/** Resolve only complete names/codes; substring and fuzzy matches can select another issuer. */
export function parseHighMessage(text: string, catalog: HighCandidate[]): HighMention[] {
  const names = new Map<string, HighCandidate[]>();
  const codes = new Map<string, HighCandidate[]>();
  for (const candidate of catalog) {
    for (const [map, key] of [[names, highName(candidate.name)], [codes, candidate.stockCode.toUpperCase()]] as const) {
      const group = map.get(key) ?? [];
      if (!group.some(item => item.corpCode === candidate.corpCode)) group.push(candidate);
      map.set(key, group);
    }
  }
  const cleaned = text.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/gu, "")
    .replace(/https?:\/\/[^\s)\]>]+/giu, " ").replace(/[*`]/gu, "")
    .replace(/\(([A-Za-z0-9\s]{6,10})\)/gu, (all, value: string) => stockCode(value.trim()) ? ` ⟪${value.trim()}⟫ ` : all)
    .replace(/\(주\)/gu, "");
  let category = "";
  const mentions: HighMention[] = [];
  function nameAt(words: string[], index: number) {
    for (let size = Math.min(4, words.length - index); size > 0; size--) {
      const group = words.slice(index, index + size);
      if (group.some(word => stockCode(word) || /[⟪⟫]/u.test(word))) continue;
      const raw = group.join(" ");
      const exact = names.get(highName(raw));
      if (exact) return { name: raw, size, candidates: exact, note: "" };
      if (size === 1) {
        const annotated = raw.match(/^(.+?)[—–-](.+)$/u);
        if (annotated) return { name: annotated[1], size, candidates: names.get(highName(annotated[1])) ?? [], note: annotated[2] };
      }
    }
    return null;
  }
  function add(name: string, code: string | null, candidates: HighCandidate[], note = "") {
    if (mentions.length >= 300) throw new Error("한 번에 처리할 수 있는 항목은 300개입니다. 메시지를 나누어 붙여넣어 주세요.");
    const byCode = code ? codes.get(code) ?? [] : [];
    const intersection = candidates.filter(item => byCode.some(other => other.corpCode === item.corpCode));
    const conflict = Boolean(code && name && !intersection.length);
    mentions.push({ input: [name, code].filter(Boolean).join(" "), name, stockCode: code,
      categories: category ? [category] : [], notes: note ? [note] : [],
      candidates: code ? name && candidates.length ? intersection : byCode : candidates, conflict });
  }
  for (const part of cleaned.split(/(\([^()\n]{1,80}\))/u)) {
    if (/^\([^()]+\)$/u.test(part)) { category = part.slice(1, -1).trim(); continue; }
    for (let line of part.split(/[\n,;|•●▶▷▪■]+/u)) {
      const label = line.match(/^\s*([\p{L}][\p{L}\p{N}\s/·]{0,35})\)\s*/u);
      if (label) { category = label[1].trim(); line = line.slice(label[0].length); }
      line = line.replace(/^\s*(?:\d{1,3}[.)]|[-–—#])\s*/u, "");
      const words = line.trim().split(/\s+/u).filter(Boolean);
      for (let index = 0; index < words.length;) {
        const word = words[index];
        if (heading.test(word) || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[:.]?$/u.test(word) || !/[\p{L}]/u.test(word) && !stockCode(word)) { index++; continue; }
        const code = stockCode(word);
        if (code) {
          const next = nameAt(words, index + 1);
          add(next?.name ?? "", code, next?.candidates ?? [], next?.note);
          index += 1 + (next?.size ?? 0);
          continue;
        }
        const found = nameAt(words, index);
        if (found) {
          const following = stockCode(words[index + found.size] ?? "");
          add(found.name, following, found.candidates, found.note);
          index += found.size + (following ? 1 : 0);
        } else {
          const following = stockCode(words[index + 1] ?? "");
          if (/[\p{L}]/u.test(word) && word.length <= 60) add(word, following, []);
          index += following ? 2 : 1;
        }
      }
    }
  }
  return mentions;
}
