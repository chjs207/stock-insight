export type AssetManager = { key: string; name: string };

export const vipManager: AssetManager = { key: "브이아이피자산운용", name: "브이아이피자산운용" };

export type Disclosure = {
  receipt: string;
  date: string;
  corpCode: string;
  stockCode: string;
  company: string;
  market: "KOSPI" | "KOSDAQ";
  filer: string;
  filerKey: string;
  title: string;
  corrected: boolean;
};

export type Ownership = {
  shares: string | null;
  ratio: number | null;
  change: number | null;
  reason: string | null;
};

export type HoldingReport = Disclosure & { ownership: Ownership | null };
export type OwnershipView = { reports: HoldingReport[]; pending: number };

export type OwnershipCoverage = {
  start: string;
  end: string;
  missing: string[];
  currentMonth: string;
  through: string | null;
};
