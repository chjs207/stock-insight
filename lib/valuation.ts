import { metrics } from "./market.ts";
import type { AnnualReport, QuarterlyFinancials } from "./market.ts";

export type StockQuote = {
  code: string;
  name: string;
  price: string;
  marketCap: string;
  quotedAt: string;
};

export type IssuerQuote = {
  marketCap: string;
  quotedAt: string;
  fetchedAt: number;
  stale: boolean;
  stocks: StockQuote[];
};

export type ValuationEarnings = {
  label: string;
  basis: AnnualReport["basis"];
  currency: string | null;
  parentProfit: string | null;
  operatingProfit: string | null;
  reason: string | null;
};

export function annualEarnings(report: AnnualReport): ValuationEarnings {
  return {
    label: report.year + "년 연간",
    basis: report.basis,
    currency: report.currency,
    parentProfit: report.basis === "OFS" ? report.amounts.net : report.amounts.parentNet,
    operatingProfit: report.amounts.operating,
    reason: report.basis ? null : "연간 실적 자료가 없습니다.",
  };
}

export function trailingEarnings(data: QuarterlyFinancials): ValuationEarnings | null {
  const reports = data.years.flatMap(({ reports }) => reports)
    .sort((a, b) => a.year * 4 + a.quarter - b.year * 4 - b.quarter);
  const last = reports.map(report => Boolean(report.basis)).lastIndexOf(true);
  if (last < 0) return null;
  const current = reports[last];
  const recent = reports.slice(Math.max(0, last - 3), last + 1);
  const first = recent[0];
  const comparable = recent.length === 4 && recent.every((report, index) =>
    report.year * 4 + report.quarter === first.year * 4 + first.quarter + index &&
    report.basis === current.basis && report.currency === current.currency);
  function total(key: (typeof metrics)[number]["key"]) {
    if (!comparable || recent.some((report) => report.amounts[key] == null)) return null;
    return recent.reduce((sum, report) => sum + BigInt(report.amounts[key]!), BigInt(0)).toString();
  }
  return {
    label: first.year + "년 " + first.quarter + "분기–" + current.year + "년 " + current.quarter + "분기",
    basis: current.basis,
    currency: current.currency,
    parentProfit: total(current.basis === "OFS" ? "net" : "parentNet"),
    operatingProfit: total("operating"),
    reason: comparable ? null : "같은 통화·재무제표 기준의 연속 4개 분기가 필요합니다.",
  };
}

export function earningsMultiple(marketCap: string, profit: string | null): number | null {
  if (profit === null || BigInt(profit) <= BigInt(0)) return null;
  const ratio = Number(marketCap) / Number(profit);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}
