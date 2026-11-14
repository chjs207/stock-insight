export const researchSourceUrl = "https://stock.naver.com/research/company";
export const researchPageSize = 20;
export type ResearchSearchMode = "company" | "keyword";

export type ResearchReport = {
  id: string;
  title: string;
  company: string;
  stockCode: string | null;
  broker: string;
  date: string;
  targetPrice: string | null;
  opinion: string | null;
  url: string;
};

export type ResearchPage = {
  reports: ResearchReport[];
  total: number;
  hasNext: boolean;
  page: number;
  query: string;
  mode: ResearchSearchMode | "all";
  stockCode: string | null;
};

export type ResearchListing = ResearchPage & {
  fetchedAt: number;
  source: "NAVER" | "DB";
  stale: boolean;
  warning?: string;
};
