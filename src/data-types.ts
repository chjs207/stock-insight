import type { Company, Financials, QuarterlyYear } from "../lib/market.ts";
import type { AssetManager, OwnershipCoverage, OwnershipView } from "../lib/ownership.ts";
import type { IssuerQuote } from "../lib/valuation.ts";

export type CompanyData = {
  company: Company;
  collectedAt: string;
  annual?: Financials;
  quarters?: QuarterlyYear[];
  quote?: IssuerQuote;
  warnings: string[];
};
export type Catalog = {
  schemaVersion: 1;
  generatedAt: string | null;
  directoryUpdatedAt: string | null;
  companies: Company[];
  collected: Record<string, { collectedAt: string; oldestQuarterYear: number | null }>;
  warnings: string[];
};
export type GiantsData = {
  collectedAt: string | null;
  managers: AssetManager[];
  coverage: OwnershipCoverage;
  snapshots: Record<string, OwnershipView>;
  warnings: string[];
};
