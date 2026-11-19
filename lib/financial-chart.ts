import { changePercent } from "./market";
import type { AnnualReport, Metric, QuarterReport, QuarterlyYear } from "./market";

export type FinancialPeriod = {
  label: string;
  axisLabel: string;
  group?: number;
  report: AnnualReport;
  priorYear?: AnnualReport;
  priorQuarter?: AnnualReport;
};
export type FinancialChartMode = "amount" | "growth";
export type FinancialComparison = "yoy" | "qoq";
export const quarterIndex = ({ year, quarter }: QuarterReport) => year * 4 + quarter - 1;

export function annualPeriods(reports: AnnualReport[]): FinancialPeriod[] {
  const ordered = reports.slice().sort((a, b) => a.year - b.year);
  const byYear = new Map(ordered.map(report => [report.year, report]));
  return ordered.map(report => ({ label: report.year + "년", axisLabel: String(report.year), report, priorYear: byYear.get(report.year - 1) }));
}

export function quarterlyPeriods(years: QuarterlyYear[], byQuarter: Map<number, QuarterReport>): FinancialPeriod[] {
  return years.flatMap(year => year.reports).slice().sort((a, b) => quarterIndex(a) - quarterIndex(b)).map(report => ({
    label: report.year + "년 " + report.quarter + "분기", axisLabel: report.quarter + "Q", group: report.year, report,
    priorYear: byQuarter.get(quarterIndex(report) - 4), priorQuarter: byQuarter.get(quarterIndex(report) - 1),
  }));
}

export function chartAmount(report: AnnualReport, metric: Metric, currency: string): number | null {
  const raw = report.amounts[metric];
  if (!report.basis || report.currency !== currency || typeof raw !== "string" || !/^[+-]?\d+$/.test(raw)) return null;
  const value = Number(raw) / (currency === "KRW" ? 100_000_000 : 1);
  return Number.isFinite(value) ? value : null;
}

export function chartChange(period: FinancialPeriod, metric: Metric, comparison: FinancialComparison): number | null {
  const value = changePercent(period.report, comparison === "yoy" ? period.priorYear : period.priorQuarter, metric);
  return value !== null && Number.isFinite(value) ? value : null;
}

export function financialScale(values: (number | null)[]) {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const min = Math.min(0, ...finite), max = Math.max(0, ...finite);
  const raw = (max - min) / 4 || 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find(value => value * magnitude >= raw) ?? 10) * magnitude;
  const bottom = Math.floor(min / step) * step, top = Math.ceil(max / step) * step || (bottom === 0 ? step : 0);
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) => top - step * i);
  return { ticks, y: (value: number) => 12 + (top - value) / (top - bottom) * 196 };
}

const numbers = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const smallNumbers = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
const compactNumbers = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });
export function chartNumber(value: number, compact = false) {
  return compact && Math.abs(value) >= 10_000 ? compactNumbers.format(value)
    : value !== 0 && Math.abs(value) < .01 ? smallNumbers.format(value) : numbers.format(value);
}
export function chartPercentage(value: number | null) {
  return value === null ? "비교 불가" : (value > 0 ? "+" : "") + chartNumber(value) + "%";
}
