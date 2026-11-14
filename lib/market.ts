export const metrics = [
  { key: "revenue", label: "매출액", color: "#007d65", light: "#e3f5ee" },
  { key: "operating", label: "영업이익", color: "#6354c1", light: "#efedfb" },
  { key: "net", label: "순이익", color: "#b76818", light: "#fbf1e2" },
  { key: "parentNet", label: "지배주주 순이익", color: "#2379ac", light: "#e8f2fa" },
] as const;

export type Metric = (typeof metrics)[number]["key"];

export interface Company {
  corpCode: string;
  stockCode: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | null;
  closingMonth: number;
}

export interface AnnualReport {
  year: number;
  basis: "CFS" | "OFS" | null;
  currency: string | null;
  receipt: string | null;
  amounts: Record<Metric, string | null>;
}

export interface Financials {
  company: Company;
  reports: AnnualReport[];
  source: "DART" | "DB";
}

export const quarterNumbers = [1, 2, 3, 4] as const;
export type Quarter = (typeof quarterNumbers)[number];
export const firstReportYear = 2015;

export interface QuarterReport extends AnnualReport {
  quarter: Quarter;
}

export interface QuarterlyYear {
  year: number;
  reports: QuarterReport[];
}

export interface QuarterlyFinancials {
  years: QuarterlyYear[];
  nextYear: number | null;
}

export function emptyReport(year: number): AnnualReport {
  return {
    year, basis: null, currency: null, receipt: null,
    amounts: { revenue: null, operating: null, net: null, parentNet: null },
  };
}

export function growth(reports: AnnualReport[], index: number, metric: Metric) {
  const previous = reports[index - 1];
  const current = reports[index];
  if (!previous || !current || current.year !== previous.year + 1) return null;
  return changePercent(current, previous, metric);
}

export function changePercent(current: AnnualReport, previous: AnnualReport | undefined, metric: Metric) {
  if (!previous || !current.basis || !current.currency ||
      current.basis !== previous.basis || current.currency !== previous.currency) {
    return null;
  }
  const from = previous.amounts[metric] ?? null;
  const to = current.amounts[metric] ?? null;
  if (from === null || to === null || BigInt(from) === BigInt(0)) return null;
  return Number(BigInt(to) - BigInt(from)) / Math.abs(Number(from)) * 100;
}
