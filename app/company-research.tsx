import { useState } from "react";

const researchUrl = "https://stock.naver.com/research/company";

export default function CompanyResearch() {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  return <>
    <section className="panel research-toolbar" aria-labelledby="research-title">
      <div>
        <h1 id="research-title">기업 리서치</h1>
        <p>네이버 증권에서 제공하는 증권사 기업 분석 보고서를 확인하세요.</p>
      </div>
      <div className="research-actions">
        <button type="button" className="expand-button" onClick={() => { setLoading(true); setVersion(value => value + 1); }}>
          새로고침
        </button>
        <a className="watch-button" href={researchUrl} target="_blank" rel="noopener noreferrer">새 탭에서 열기 ↗</a>
      </div>
    </section>
    <section className="panel research-embed" aria-label="네이버 증권 기업 리서치" aria-busy={loading}>
      {loading && <p className="loading research-loading" role="status"><span className="spinner"/> 기업 리서치를 불러오는 중…</p>}
      <iframe key={version} className="research-frame" src={researchUrl} title="네이버 증권 기업 리서치 페이지"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        onLoad={() => setLoading(false)} onError={() => setLoading(false)}/>
    </section>
  </>;
}
