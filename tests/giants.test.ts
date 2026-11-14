import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { openDatabase } from "../server/database";
import { createApi } from "../server/api";
import { giantsService } from "../lib/giants";
import type { Disclosure } from "../lib/ownership";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-14T10:00:00Z")); });
afterEach(() => vi.useRealTimers());

function report(overrides: Partial<Disclosure> = {}): Disclosure {
  return { receipt: "20261112000123", date: "20261112", corpCode: "00126380", stockCode: "005930",
    company: "삼성전자", market: "KOSPI", filer: "샘플자산운용", filerKey: "샘플자산운용",
    title: "주식등의대량보유상황보고서(약식)", corrected: false, ...overrides };
}

async function setup(reports: Disclosure[] = [report()], complete = true) {
  const database = openDatabase(":memory:");
  const network = vi.fn(async () => { throw new Error("preview must not call DART"); });
  const service = giantsService(database.db, "test-key", network);
  const coverage = await service.coverage();
  const months = complete ? coverage.missing : [coverage.currentMonth];
  for (const month of months) {
    const through = month === coverage.currentMonth ? coverage.end : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4)), 0)).toISOString().slice(0, 10).replaceAll("-", "");
    database.sql.prepare("INSERT INTO ownership_months VALUES (?, ?, ?, ?)")
      .run(month, through, Date.now(), JSON.stringify(reports.filter(item => item.date.startsWith(month))));
  }
  const count = () => database.sql.prepare("SELECT COUNT(*) AS n FROM asset_managers").get()?.n;
  return { ...database, service, network, count };
}

test("preview shows actual filings and canonical filer name without registering anything", async () => {
  const database = await setup([report(), report({ receipt: "20251010000123", date: "20251010" })]);
  try {
    const result = await database.service.previewManager("  (주) 샘플 자산운용  ");
    expect(result.manager).toEqual({ key: "샘플자산운용", name: "샘플자산운용" });
    expect(result.reports).toHaveLength(2);
    expect(result.registered).toBe(false);
    expect(result.coverage.missing).toEqual([]);
    expect(database.count()).toBe(0);
    expect(database.network).not.toHaveBeenCalled();
  } finally { database.close(); }
});

test("registration after reviewing a result saves one manager and remains idempotent", async () => {
  const database = await setup();
  try {
    const preview = await database.service.previewManager("샘플자산운용");
    expect(database.count()).toBe(0);
    const saved = await database.service.addManager(preview.manager.name);
    expect(saved.name).toBe("샘플자산운용");
    expect(database.count()).toBe(1);
    await database.service.addManager("(주)샘플 자산운용");
    expect(database.count()).toBe(1);
    expect((await database.service.previewManager("샘플자산운용")).registered).toBe(true);
    expect((await database.service.snapshot(saved.key)).reports).toHaveLength(1);
  } finally { database.close(); }
});

test("a complete empty result cannot be registered even by a direct PUT request", async () => {
  const database = await setup();
  try {
    const api = createApi(database.db, "test-key", database.network);
    const preview = await api(new URL("http://localhost/api/giants?preview=1&name=없는자산운용"), "GET");
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ reports: [], registered: false, coverage: { missing: [] } });
    const response = await api(new URL("http://localhost/api/giants?name=없는자산운용"), "PUT");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("등록할 수 없습니다") });
    expect(database.count()).toBe(0);
    expect(database.network).not.toHaveBeenCalled();
  } finally { database.close(); }
});

test("missing collection is distinguished from a confirmed empty result", async () => {
  const database = await setup([], false);
  try {
    const preview = await database.service.previewManager("샘플자산운용");
    expect(preview.reports).toEqual([]);
    expect(preview.coverage.missing.length).toBeGreaterThan(0);
    await expect(database.service.addManager("샘플자산운용")).rejects.toMatchObject({ httpStatus: 409 });
    expect(database.count()).toBe(0);
  } finally { database.close(); }
});

test("a genuinely observed filing can be reviewed and registered with incomplete coverage", async () => {
  const database = await setup([report()], false);
  try {
    const preview = await database.service.previewManager("샘플자산운용");
    expect(preview.reports).toHaveLength(1);
    expect(preview.coverage.missing.length).toBeGreaterThan(0);
    expect(database.count()).toBe(0);
    await database.service.addManager(preview.manager.name);
    expect(database.count()).toBe(1);
  } finally { database.close(); }
});

test("reports older than three years or dated in the future cannot authorize registration", async () => {
  const database = await setup([
    report({ date: "20231101", receipt: "20231101000123" }),
    report({ date: "20261115", receipt: "20261115000123" }),
  ]);
  try {
    expect((await database.service.previewManager("샘플자산운용")).reports).toEqual([]);
    await expect(database.service.addManager("샘플자산운용")).rejects.toMatchObject({ httpStatus: 400 });
    expect(database.count()).toBe(0);
  } finally { database.close(); }
});

test("invalid manager names never write registry entries", async () => {
  const database = await setup();
  try {
    for (const name of ["   ", "---", "가".repeat(81)]) {
      await expect(database.service.previewManager(name)).rejects.toMatchObject({ httpStatus: 400 });
      await expect(database.service.addManager(name)).rejects.toMatchObject({ httpStatus: 400 });
    }
    expect(database.count()).toBe(0);
  } finally { database.close(); }
});
