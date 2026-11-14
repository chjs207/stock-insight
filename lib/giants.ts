import { dartClient, MarketError } from "./dart.ts";
import type { DartTransport } from "./dart.ts";
import { vipManager } from "./ownership.ts";
import type { AssetManager, Disclosure, HoldingReport, ManagerPreview, Ownership, OwnershipCoverage, OwnershipView } from "./ownership.ts";

type FilingRow = {
  corp_cls: string; corp_code: string; stock_code: string; corp_name: string;
  flr_nm: string; report_nm: string; rcept_no: string; rcept_dt: string; rm?: string;
};
type FilingPage = { list: FilingRow[]; total_page: number };
type MonthWindow = { month: string; from: string; to: string };

function managerKey(name: string) {
  const key = name.normalize("NFKC").toLowerCase()
    .replace(/\s+/g, "").replace(/\(주\)|주식회사/g, "");
  return key === "vip자산운용" ? vipManager.key : key;
}

function dayString(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function disclosureWindow(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (part: string) => Number(parts.find(({ type }) => type === part)?.value);
  const year = get("year");
  const month = get("month") - 1;
  const day = get("day");
  const end = dayString(new Date(Date.UTC(year, month, day)));
  const start = dayString(new Date(Date.UTC(year - 3, month,
    Math.min(day, new Date(Date.UTC(year - 3, month + 1, 0)).getUTCDate()))));
  const months: MonthWindow[] = Array.from({ length: 37 }, (_, offset) => {
    const from = dayString(new Date(Date.UTC(year, month - offset, 1)));
    const to = offset ? dayString(new Date(Date.UTC(year, month - offset + 1, 0))) : end;
    return { month: from.slice(0, 6), from, to };
  });
  return { start, end, months };
}

function shares(text: string | null) {
  const plain = text?.replace(/[,\s]/g, "") ?? "";
  return /^\d+$/.test(plain) ? plain : null;
}

function percentage(text: string | null) {
  const plain = text?.replace(/[,\s%]/g, "") ?? "";
  return /^[+-]?\d+(\.\d+)?$/.test(plain) ? Number(plain) : null;
}

export function readOwnership(xml: string): Ownership {
  function value(code: string) {
    const tag = new RegExp('<TE\\b[^>]*\\bACODE="' + code + '"[^>]*>([\\s\\S]*?)</TE>', "gi");
    const raw = Array.from(xml.matchAll(tag)).at(-1)?.[1];
    return raw?.replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|cr|#160);/gi, " ")
      .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() || null;
  }
  const ratio = percentage(value("SUM_TMT_RT"));
  const previous = percentage(value("SUM_BMT_RT"));
  return {
    shares: shares(value("SUM_TMT_CNT")), ratio,
    change: ratio !== null && previous !== null ? Math.round((ratio - previous) * 10000) / 10000 : null,
    reason: value("SUM_CHN_RWN"),
  };
}

const unavailable: Ownership = { shares: null, ratio: null, change: null, reason: null };

export function giantsService(db: D1Database, key?: string, transport?: DartTransport) {
  const dart = dartClient(key, transport);
  const now = new Date();
  const { start, end, months } = disclosureWindow(now);
  const currentMonth = months[0].month;

  async function coverage(): Promise<OwnershipCoverage> {
    const rows = await db.prepare("SELECT month, searched_through FROM ownership_months WHERE month BETWEEN ? AND ?")
      .bind(start.slice(0, 6), currentMonth).all<{ month: string; searched_through: string }>();
    const completed = new Map(rows.results.map((row) => [row.month, row.searched_through]));
    const missing = months.filter((window) => (completed.get(window.month) ?? "") < window.to);
    return { start, end, currentMonth, through: rows.results.reduce<string | null>(
      (latest, row) => !latest || latest < row.searched_through ? row.searched_through : latest, null),
      missing: missing.map((item) => item.month),
    };
  }

  async function managers(): Promise<AssetManager[]> {
    const rows = await db.prepare("SELECT key, name FROM asset_managers ORDER BY added_at, name").all<AssetManager>();
    return rows.results;
  }

  async function addManager(input: string): Promise<AssetManager> {
    const result = await previewManager(input);
    if (!result.reports.length) {
      if (result.coverage.missing.length) {
        throw new MarketError("공시 목록이 일부만 수집되어 조회 내역을 확인하지 못했습니다. 공시 목록을 갱신한 뒤 다시 조회해 주세요.", 409);
      }
      throw new MarketError("최근 3년 내 조회된 지분공시가 없어 등록할 수 없습니다. DART 공시 제출인명을 확인해 주세요.", 400);
    }
    const { key, name } = result.manager;
    await db.prepare("INSERT OR IGNORE INTO asset_managers (key, name, added_at) VALUES (?, ?, ?)")
      .bind(key, name, now.getTime()).run();
    const saved = await db.prepare("SELECT key, name FROM asset_managers WHERE key = ?").bind(key).first<AssetManager>();
    if (!saved) throw new MarketError("운용사를 저장하지 못했습니다.");
    return saved;
  }

  async function removeManager(input: string) {
    const key = managerKey(input.trim());
    if (!key || input.length > 80 || !/[가-힣a-z0-9]/i.test(key)) {
      throw new MarketError("삭제할 운용사를 선택해 주세요.", 400);
    }
    await db.prepare("DELETE FROM asset_managers WHERE key = ?").bind(key).run();
  }

  async function syncMonth(month: string) {
    const window = months.find((item) => item.month === month);
    if (!window) throw new MarketError("최근 3년 조회 범위에 해당하는 월을 선택해 주세요.", 400);
    const cached = await db.prepare("SELECT searched_through, fetched_at FROM ownership_months WHERE month = ?")
      .bind(month).first<{ searched_through: string; fetched_at: number }>();
    if (cached && cached.searched_through >= window.to &&
        (month !== currentMonth || now.getTime() - cached.fetched_at < 15 * 60_000)) return;

    const params = {
      bgn_de: window.from, end_de: window.to, pblntf_detail_ty: "D001",
      last_reprt_at: "N", page_count: "100", sort_mth: "asc",
    };
    const page = (number: number) => dart.json<FilingPage>("list.json", { ...params, page_no: String(number) });
    const first = await page(1);
    const total = Number(first?.total_page ?? 0);
    if (!Number.isInteger(total) || total < 0 || total > 40 || (first && !Array.isArray(first.list))) {
      throw new MarketError("OpenDART의 월별 지분공시 목록을 완전히 읽지 못했습니다.");
    }
    const rows = [...(first?.list ?? [])];
    for (let number = 2; number <= total; number += 4) {
      const group = await Promise.all(Array.from({ length: Math.min(4, total - number + 1) }, (_, offset) => page(number + offset)));
      for (const result of group) {
        if (!Array.isArray(result?.list)) throw new MarketError("OpenDART 지분공시 목록 일부를 읽지 못했습니다.");
        rows.push(...result.list);
      }
    }
    const reports = new Map<string, Disclosure>();
    for (const row of rows) {
      const market = row.corp_cls === "Y" ? "KOSPI" : row.corp_cls === "K" ? "KOSDAQ" : null;
      if (!market || !row.flr_nm || row.rm?.includes("철") || !/^\d{14}$/.test(row.rcept_no) ||
          !/^\d{8}$/.test(row.corp_code) || !/^\d{8}$/.test(row.rcept_dt)) continue;
      reports.set(row.rcept_no, {
        receipt: row.rcept_no, date: row.rcept_dt, corpCode: row.corp_code, stockCode: row.stock_code,
        company: row.corp_name, market, filer: row.flr_nm, filerKey: managerKey(row.flr_nm),
        title: row.report_nm, corrected: row.rm?.includes("정") ?? false,
      });
    }
    await db.prepare(
      "INSERT INTO ownership_months (month, searched_through, fetched_at, data) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(month) DO UPDATE SET searched_through=excluded.searched_through, fetched_at=excluded.fetched_at, data=excluded.data " +
      "WHERE excluded.searched_through >= ownership_months.searched_through AND excluded.fetched_at >= ownership_months.fetched_at",
    ).bind(month, window.to, now.getTime(), JSON.stringify(Array.from(reports.values()))).run();
  }

  async function readReports(key: string): Promise<OwnershipView> {
    const rows = await db.prepare(
      "SELECT j.value AS filing, json_extract(d.data, '$.' || json_extract(j.value, '$.receipt')) AS ownership " +
      "FROM ownership_months m, json_each(m.data) j LEFT JOIN ownership_details d ON d.corp_code = json_extract(j.value, '$.corpCode') " +
      "WHERE m.month BETWEEN ? AND ? AND json_extract(j.value, '$.date') BETWEEN ? AND ? " +
      "AND json_extract(j.value, '$.filerKey') = ? ORDER BY json_extract(j.value, '$.receipt') DESC",
    ).bind(start.slice(0, 6), currentMonth, start, end, key).all<{ filing: string; ownership: string | null }>();
    const reports = rows.results.map(({ filing, ownership }): HoldingReport => ({
      ...(JSON.parse(filing) as Disclosure),
      ownership: ownership === null ? null : JSON.parse(ownership) as Ownership,
    }));
    return { reports, pending: reports.filter((report) => report.ownership === null).length };
  }

  async function previewManager(input: string): Promise<ManagerPreview> {
    const name = input.trim().replace(/\s+/g, " ");
    const key = managerKey(name);
    if (!key || name.length > 80 || !/[가-힣a-z0-9]/i.test(key)) {
      throw new MarketError("운용사명을 80자 이내로 입력해 주세요.", 400);
    }
    const [view, range, saved] = await Promise.all([
      readReports(key), coverage(),
      db.prepare("SELECT 1 FROM asset_managers WHERE key = ?").bind(key).first(),
    ]);
    // Preview reads collected filings only and never registers a manager.
    // Use the filer name from an actual in-range report, not an unchecked input.
    return { ...view, manager: { key, name: view.reports[0]?.filer ?? name },
      registered: Boolean(saved), coverage: range };
  }

  async function snapshot(key: string): Promise<OwnershipView> {
    const exists = await db.prepare("SELECT 1 FROM asset_managers WHERE key = ?").bind(key).first();
    if (!exists) throw new MarketError("추가한 운용사를 선택해 주세요.", 404);
    return readReports(key);
  }

  async function syncDetails(key: string, limit = 5) {
    const current = await snapshot(key);
    const missing = current.reports.filter((report) => report.ownership === null).slice(0, limit);
    await Promise.all(missing.map(async ({ receipt, corpCode }) => {
      const xml = await dart.document(receipt);
      const value = xml ? readOwnership(xml) : unavailable;
      await db.prepare(
        "INSERT INTO ownership_details (corp_code, fetched_at, data) VALUES (?, ?, ?) " +
        "ON CONFLICT(corp_code) DO UPDATE SET fetched_at = MAX(ownership_details.fetched_at, excluded.fetched_at), " +
        "data = json_patch(ownership_details.data, excluded.data)",
      ).bind(corpCode, now.getTime(), JSON.stringify({ [receipt]: value })).run();
    }));
    return missing.length;
  }

  return { coverage, managers, previewManager, addManager, removeManager, syncMonth, snapshot, syncDetails };
}
