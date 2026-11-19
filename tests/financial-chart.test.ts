import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnnualFinancialChart, QuarterlyFinancialChart } from "../app/financial-chart";
import { annualPeriods, chartAmount, chartChange, financialScale, quarterIndex, quarterlyPeriods } from "../lib/financial-chart";
import { emptyReport } from "../lib/market";
import type { AnnualReport, QuarterReport } from "../lib/market";

const annual = (year: number, revenue = "10000000000", operating: string | null = "100000000"): AnnualReport => ({
  ...emptyReport(year), basis: "CFS", currency: "KRW", amounts: { revenue, operating, net: operating, parentNet: operating },
});
const quarter = (year: number, q: 1 | 2 | 3 | 4, revenue = "1000000000"): QuarterReport => ({ ...annual(year, revenue), quarter: q });

test("annual amounts retain all five years, sort chronologically and do not compare across missing years", () => {
  const reports = [2025, 2024, 2023, 2022, 2021].map(year => annual(year));
  const periods = annualPeriods(reports);
  expect(periods.map(period => period.report.year)).toEqual([2021, 2022, 2023, 2024, 2025]);
  expect(periods[0].priorYear).toBeUndefined();
  expect(periods[4].priorYear?.year).toBe(2024);
  expect(annualPeriods([annual(2021), annual(2023)])[1].priorYear).toBeUndefined();
  expect(reports[0].year).toBe(2025);
});

test("quarterly plots use individual quarter amounts and the hidden baseline for YoY, including year-boundary QoQ", () => {
  const older = quarter(2024, 1, "500000000");
  const previous = quarter(2024, 4, "800000000");
  const first = quarter(2025, 1, "1000000000");
  const second = quarter(2025, 2, "1200000000");
  const map = new Map([older, previous, first, second].map(report => [quarterIndex(report), report]));
  const periods = quarterlyPeriods([{ year: 2025, reports: [second, first] }], map);
  expect(periods.map(period => chartAmount(period.report, "revenue", "KRW"))).toEqual([10, 12]);
  expect(periods.map(period => period.axisLabel)).toEqual(["1Q", "2Q"]);
  expect(chartChange(periods[0], "revenue", "yoy")).toBe(100);
  expect(chartChange(periods[0], "revenue", "qoq")).toBe(25);
  expect(chartChange(periods[1], "revenue", "qoq")).toBe(20);
});

test("amounts preserve losses and real zero; missing or foreign-currency values cannot be drawn as KRW", () => {
  const report = annual(2025, "50000000000", "-250000000");
  expect(chartAmount(report, "operating", "KRW")).toBe(-2.5);
  expect(chartAmount(annual(2025, "0", null), "revenue", "KRW")).toBe(0);
  expect(chartAmount(annual(2025, "0", null), "operating", "KRW")).toBeNull();
  expect(chartAmount({ ...report, currency: "USD" }, "revenue", "KRW")).toBeNull();
  expect(chartAmount({ ...report, currency: "USD" }, "operating", "USD")).toBe(-250000000);
  expect(chartAmount({ ...report, currency: null }, "revenue", "KRW")).toBeNull();
  expect(chartAmount(annual(2025, "invalid"), "revenue", "KRW")).toBeNull();
});

test("zero baselines and changes in reporting basis/currency leave growth unavailable while amounts still display", () => {
  const report = annual(2025);
  for (const previous of [annual(2024, "0"), { ...annual(2024), basis: "OFS" as const }, { ...annual(2024), currency: "USD" }]) {
    const period = { label: "2025", axisLabel: "2025", report, priorYear: previous };
    expect(chartAmount(report, "revenue", "KRW")).toBe(100);
    expect(chartChange(period, "revenue", "yoy")).toBeNull();
  }
});

test("chart scales include zero and position losses below it, including zero/negative-only and missing datasets", () => {
  for (const values of [[100, 200], [-10, -1], [-5, 0, 15], [0], [null], []]) {
    const scale = financialScale(values);
    expect(scale.ticks).toContain(0);
    expect(scale.ticks.every(Number.isFinite)).toBe(true);
    expect(scale.y(0)).toBeGreaterThanOrEqual(12);
    expect(scale.y(0)).toBeLessThanOrEqual(208);
    for (const value of values) if (value !== null) {
      expect(scale.y(value)).toBeGreaterThanOrEqual(12);
      expect(scale.y(value)).toBeLessThanOrEqual(208);
      if (value < 0) expect(scale.y(value)).toBeGreaterThan(scale.y(0));
    }
  }
});

test("the annual UI defaults to two amount plots, includes the first year, and exposes amount plus YoY selection details", () => {
  const reports = [2021, 2022, 2023, 2024, 2025].map(year => annual(year, String((year - 2020) * 10000000000)));
  const html = renderToStaticMarkup(createElement(AnnualFinancialChart, { reports }));
  expect(html).toContain('aria-pressed="true">금액');
  expect(html).toContain('aria-label="매출액 금액 추이 · 억 원"');
  expect(html).toContain('aria-label="이익 금액 추이 · 억 원"');
  expect(html).toContain('aria-label="2021년, 매출액 100 억 원, 전년 대비 비교 불가"');
  expect(html).toContain('aria-label="2025년, 매출액 500 억 원, 전년 대비 +25%"');
  expect(html).toContain('지배주주 순이익');
  expect(html).toContain('매출액 선택 실적');
  expect(html).not.toMatch(/NaN|Infinity/);
});

test("missing quarters remain blank and mixed currencies show a selector without mixing amounts", () => {
  const first = quarter(2025, 1);
  const missing = { ...emptyReport(2025), quarter: 2 as const };
  const foreign = { ...quarter(2025, 3), currency: "USD" };
  const reports = [first, missing, foreign];
  const html = renderToStaticMarkup(createElement(QuarterlyFinancialChart, { years: [{ year: 2025, reports }], byQuarter: new Map(reports.map(report => [quarterIndex(report), report])) }));
  expect(html).toContain('표시 통화');
  expect(html).toMatch(/<option[^>]*selected=""[^>]*>USD<\/option>/);
  expect(html).toContain('매출액 자료 없음');
  expect(html).not.toContain('aria-label="분기 증감률 비교 기준"');
  expect(html).not.toMatch(/NaN|Infinity/);
});
