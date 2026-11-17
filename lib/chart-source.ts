export type ChartSource = "kiwoom" | "naver";
export const chartSourceStorageKey = "stock-insight.chart-source.v1";

export function readChartSource(): ChartSource {
  try { return localStorage.getItem(chartSourceStorageKey) === "naver" ? "naver" : "kiwoom"; }
  catch { return "kiwoom"; }
}

export function naverChartUrl(stockCode: string): string | null {
  return /^\d{6}$/.test(stockCode) ? "https://m.stock.naver.com/fchart/domestic/stock/" + stockCode : null;
}
