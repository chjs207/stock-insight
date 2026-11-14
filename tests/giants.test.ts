import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/database";
import { createApi } from "../server/api";
import { giantsService } from "../lib/giants";
import type { Disclosure } from "../lib/ownership";
import { vipManager } from "../lib/ownership";

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
    expect(database.count()).toBe(1);
    expect(database.network).not.toHaveBeenCalled();
  } finally { database.close(); }
});

test("registration after reviewing a result saves one manager and remains idempotent", async () => {
  const database = await setup();
  try {
    const preview = await database.service.previewManager("샘플자산운용");
    expect(database.count()).toBe(1);
    const saved = await database.service.addManager(preview.manager.name);
    expect(saved.name).toBe("샘플자산운용");
    expect(database.count()).toBe(2);
    await database.service.addManager("(주)샘플 자산운용");
    expect(database.count()).toBe(2);
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
    expect(database.count()).toBe(1);
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
    expect(database.count()).toBe(1);
  } finally { database.close(); }
});

test("a genuinely observed filing can be reviewed and registered with incomplete coverage", async () => {
  const database = await setup([report()], false);
  try {
    const preview = await database.service.previewManager("샘플자산운용");
    expect(preview.reports).toHaveLength(1);
    expect(preview.coverage.missing.length).toBeGreaterThan(0);
    expect(database.count()).toBe(1);
    await database.service.addManager(preview.manager.name);
    expect(database.count()).toBe(2);
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
    expect(database.count()).toBe(1);
  } finally { database.close(); }
});

test("invalid manager names never write registry entries", async () => {
  const database = await setup();
  try {
    for (const name of ["   ", "---", "가".repeat(81)]) {
      await expect(database.service.previewManager(name)).rejects.toMatchObject({ httpStatus: 400 });
      await expect(database.service.addManager(name)).rejects.toMatchObject({ httpStatus: 400 });
    }
    expect(database.count()).toBe(1);
  } finally { database.close(); }
});

test("deletion removes only the registration and allows a fresh preview and registration from the preserved cache", async () => {
  const database = await setup();
  try {
    const saved = await database.service.addManager("샘플자산운용");
    const ownership = { shares: "1000", ratio: 5, change: 1, reason: "단순투자" };
    database.sql.prepare("INSERT INTO ownership_details VALUES (?, ?, ?)")
      .run(report().corpCode, Date.now(), JSON.stringify({ [report().receipt]: ownership }));
    const originalMonths = database.sql.prepare("SELECT * FROM ownership_months ORDER BY month").all();
    const originalDetails = database.sql.prepare("SELECT * FROM ownership_details").all();
    const api = createApi(database.db, "test-key", database.network);
    const url = new URL("http://localhost/api/giants?" + new URLSearchParams({ manager: saved.key }));
    const response = await api(url, "DELETE");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ managers: [vipManager] });
    expect((await api(url, "GET")).status).toBe(404);
    expect((await api(url, "DELETE")).status).toBe(200);
    expect(database.sql.prepare("SELECT * FROM ownership_months ORDER BY month").all()).toEqual(originalMonths);
    expect(database.sql.prepare("SELECT * FROM ownership_details").all()).toEqual(originalDetails);
    const preview = await database.service.previewManager(saved.name);
    expect(preview.registered).toBe(false);
    expect(preview.reports[0].ownership).toEqual(ownership);
    expect(await database.service.addManager(preview.manager.name)).toEqual(saved);
    expect(await database.service.snapshot(saved.key)).toMatchObject({ pending: 0, reports: [expect.objectContaining({ ownership })] });
    expect(database.network).not.toHaveBeenCalled();
  } finally { database.close(); }
});

test("legacy registrations with no matching filings can be deleted without calling DART", async () => {
  const database = await setup([]);
  try {
    database.sql.prepare("INSERT INTO asset_managers VALUES (?, ?, ?)").run("없는자산운용", "없는자산운용", 1);
    expect((await database.service.snapshot("없는자산운용")).reports).toEqual([]);
    await database.service.removeManager("없는자산운용");
    expect(await database.service.managers()).toEqual([vipManager]);
    expect(database.network).not.toHaveBeenCalled();
  } finally { database.close(); }
});

test("missing or invalid deletion targets cannot remove any registrations", async () => {
  const database = await setup();
  try {
    await database.service.addManager("샘플자산운용");
    const before = await database.service.managers();
    const api = createApi(database.db, "test-key", database.network);
    for (const manager of [null, "", "---", "가".repeat(81)]) {
      const params = new URLSearchParams(manager === null ? {} : { manager });
      const response = await api(new URL("http://localhost/api/giants?" + params), "DELETE");
      expect(response.status).toBe(400);
    }
    expect(await database.service.managers()).toEqual(before);
  } finally { database.close(); }
});

test("the default manager can be deleted and registered again using the preserved filings", async () => {
  const database = await setup([report({ filer: vipManager.name, filerKey: vipManager.key })]);
  try {
    expect((await database.service.previewManager("VIP자산운용")).registered).toBe(true);
    await database.service.removeManager(vipManager.key);
    expect(await database.service.managers()).toEqual([]);
    await expect(database.service.snapshot(vipManager.key)).rejects.toMatchObject({ httpStatus: 404 });
    const preview = await database.service.previewManager("VIP자산운용");
    expect(preview.registered).toBe(false);
    expect(preview.reports).toHaveLength(1);
    expect(await database.service.addManager(preview.manager.name)).toEqual(vipManager);
    expect(await database.service.managers()).toEqual([vipManager]);
    expect(database.network).not.toHaveBeenCalled();
  } finally { database.close(); }
});

test("upgrading registers the former built-in manager once and keeps deletion after database reopen", async () => {
  const folder = mkdtempSync(join(tmpdir(), "stock-manager-migration-"));
  const path = join(folder, "app.sqlite");
  try {
    const original = openDatabase(path);
    original.sql.exec("DELETE FROM asset_managers; DELETE FROM local_migrations WHERE id = 6");
    original.sql.prepare("INSERT INTO asset_managers VALUES (?, ?, ?)").run("기존운용사", "기존운용사", 1);
    original.close();
    const upgraded = openDatabase(path);
    try {
      const service = giantsService(upgraded.db);
      expect(await service.managers()).toEqual([vipManager, { key: "기존운용사", name: "기존운용사" }]);
      await service.removeManager(vipManager.key);
      await service.removeManager("기존운용사");
      expect(await service.managers()).toEqual([]);
    } finally { upgraded.close(); }
    const reopened = openDatabase(path);
    try { expect(await giantsService(reopened.db).managers()).toEqual([]); }
    finally { reopened.close(); }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
