import { afterEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import CompanyPriceChart from "../app/price-chart";
import { chartSourceStorageKey, naverChartUrl } from "../lib/chart-source";
import { readConfiguration } from "../server/config";
import { serverTransport } from "../server/transport";

const company = { corpCode: "00126380", stockCode: "005930", name: "삼성전자", market: "KOSPI" as const, closingMonth: 12 };
const folders: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true });
});

test("Naver selection is restored before mounting the Kiwoom chart and links only the current stock", () => {
  const getItem = vi.fn((key: string) => key === chartSourceStorageKey ? "naver" : null);
  vi.stubGlobal("localStorage", { getItem });
  const markup = renderToStaticMarkup(createElement(CompanyPriceChart, { company }));
  expect(markup).toContain('aria-pressed="true">네이버 증권');
  expect(markup).toContain('href="https://m.stock.naver.com/fchart/domestic/stock/005930"');
  expect(markup).toContain('target="_blank" rel="noopener noreferrer"');
  expect(markup).not.toContain("최신 자료 조회");
  const other = renderToStaticMarkup(createElement(CompanyPriceChart, { company: { ...company, stockCode: "000660", name: "SK하이닉스" } }));
  expect(other).toContain('href="https://m.stock.naver.com/fchart/domestic/stock/000660"');
  expect(other).not.toContain('/stock/005930');
});

test("unavailable or invalid browser preferences keep the existing Kiwoom default", () => {
  for (const getItem of [() => null, () => "unknown", () => { throw new Error("storage blocked"); }]) {
    vi.stubGlobal("localStorage", { getItem });
    const markup = renderToStaticMarkup(createElement(CompanyPriceChart, { company }));
    expect(markup).toContain('aria-pressed="true">키움 API');
    expect(markup).not.toContain('class="naver-chart-open"');
  }
});

test("invalid stock codes cannot create a Naver chart link", () => {
  vi.stubGlobal("localStorage", { getItem: () => "naver" });
  for (const stockCode of ["", "12345", "1234567", "../005930", "005930?token=secret", "javascript:alert(1)"]) {
    expect(naverChartUrl(stockCode)).toBeNull();
    const markup = renderToStaticMarkup(createElement(CompanyPriceChart, { company: { ...company, stockCode } }));
    expect(markup).not.toContain('class="naver-chart-open"');
    expect(markup).toContain('role="alert"');
  }
});

test("DART-only configurations start without Kiwoom credentials; missing Kiwoom returns guidance without any upstream request", async () => {
  const root = await mkdtemp(join(tmpdir(), "stock-chart-source-")); folders.push(root);
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const optional of ["", "KIWOOM_APP_KEY=\nKIWOOM_APP_SECRET=\n", "KIWOOM_APP_KEY=your_key\nKIWOOM_APP_SECRET=your_secret\n"]) {
    await writeFile(join(root, ".env"), "DART_API_KEY=test-dart-key\n" + optional);
    const config = readConfiguration(root);
    expect(config).toMatchObject({ dartKey: "test-dart-key", appKey: "", appSecret: "" });
    const response = await serverTransport(config)("kiwoom/chart", { stockCode: company.stockCode });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: expect.stringContaining(".env") });
  }
  expect(fetcher).not.toHaveBeenCalled();
});
