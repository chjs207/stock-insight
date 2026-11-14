import type { Company } from "../lib/market";
export default function CompanyPriceChart({ company }: { company: Company }) {
  const url = /^[A-Z0-9]{6}$/.test(company.stockCode)
    ? "https://m.stock.naver.com/fchart/domestic/stock/" + company.stockCode : null;
  return <section className="panel price-panel naver-chart-panel" aria-labelledby="price-title">
    <div className="panel-head"><div><h2 id="price-title">주가 차트</h2><p>네이버 증권</p></div><span className="source-badge">NAVER</span></div>
    <div className="naver-chart-content">
      <div className="naver-chart-symbol" aria-hidden="true">↗</div>
      <h3>{company.name} 차트</h3><p>네이버 증권에서 주가 흐름과 거래량을 확인하세요.</p>
      {url && <a className="naver-chart-open" href={url} target="_blank" rel="noopener noreferrer">네이버 차트 열기 ↗</a>}
      <p className="naver-chart-note">새 탭으로 열립니다. 차트를 닫으면 스탁인사이트로 돌아올 수 있습니다.</p>
    </div>
  </section>;
}
