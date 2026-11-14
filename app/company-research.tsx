import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { requestJson } from "../lib/client-api";
import { researchPageSize, researchSourceUrl } from "../lib/research-data";
import type { ResearchListing } from "../lib/research-data";

const numbers = new Intl.NumberFormat("ko-KR");
const updated = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function CompanyResearch() {
  const [searchText, setSearchText] = useState("");
  const [selection, setSelection] = useState({ query: "", page: 0, refresh: false, version: 0 });
  const [listing, setListing] = useState<ResearchListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ page: String(selection.page), q: selection.query });
    if (selection.refresh) params.set("refresh", "1");
    requestJson<ResearchListing>("/api/research?" + params, { signal: controller.signal }).then(
      result => { if (!controller.signal.aborted) setListing(result); },
      failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "리서치 목록을 읽지 못했습니다."); },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selection]);

  function search(event: FormEvent) {
    event.preventDefault();
    setSelection(current => ({ query: searchText.trim(), page: 0, refresh: false, version: current.version + 1 }));
  }

  function refresh() { setSelection(current => ({ ...current, refresh: true, version: current.version + 1 })); }
  function changePage(page: number) {
    setSelection(current => ({ ...current, page, refresh: false }));
    window.scrollTo(0, 0);
  }
  const data = listing?.page === selection.page && listing.query === selection.query ? listing : null;
  const originalUrl = researchSourceUrl + (selection.query ? "?" + new URLSearchParams({ searchText: selection.query }) : "");
  return <>
    <section className="panel research-toolbar" aria-labelledby="research-title">
      <div>
        <h1 id="research-title">기업 리서치</h1>
        <p>네이버 증권의 기업 보고서 목록입니다. 제목을 누르면 상세 내용을 새 탭에서 볼 수 있습니다.</p>
      </div>
      <div className="research-actions">
        <button type="button" className="expand-button" disabled={loading} onClick={refresh}>최신 목록 조회</button>
        <a className="watch-button" href={originalUrl} target="_blank" rel="noopener noreferrer">네이버에서 보기 ↗</a>
      </div>
    </section>
    <section className="panel research-results" aria-label="기업 보고서 목록" aria-busy={loading}>
      <form className="research-search" onSubmit={search}>
        <label htmlFor="research-query">보고서 검색</label>
        <div className="research-search-input">
          <input id="research-query" type="search" value={searchText} maxLength={60}
            placeholder="기업명·키워드" onChange={event => setSearchText(event.target.value)}/>
          <button type="submit" className="watch-button" disabled={loading}>검색</button>
          {selection.query && <button type="button" className="expand-button" disabled={loading} onClick={() => {
            setSearchText(""); setSelection(current => ({ query: "", page: 0, refresh: false, version: current.version + 1 }));
          }}>전체 목록</button>}
        </div>
      </form>
      {loading && <p className="loading research-loading" role="status"><span className="spinner"/> 보고서 목록을 불러오는 중…</p>}
      {error && <p className="notice error" role="alert">{error}
        <button type="button" className="expand-button" onClick={refresh} disabled={loading}>다시 조회</button>
      </p>}
      {data && <>
        <div className="research-list-meta" role="status">
          <span>{selection.query ? "‘" + selection.query + "’ 검색 결과 " : "전체 "}<strong>{numbers.format(data.total)}건</strong>
            {data.reports.length > 0 && " · " + numbers.format(selection.page * researchPageSize + 1) + "–" + numbers.format(selection.page * researchPageSize + data.reports.length) + "번째"}</span>
          <small>출처 네이버 증권 · {updated.format(new Date(data.fetchedAt))} 기준</small>
        </div>
        {data.warning && <p className="notice" role="status">{data.warning} 저장된 목록을 표시합니다.</p>}
        {data.reports.length === 0 ? <p className="research-empty">검색 결과가 없습니다. 다른 기업명이나 키워드로 검색해 주세요.</p>
          : <ul className="research-list">{data.reports.map(report => <li key={report.id}>
            <article className="research-row">
              <div className="research-company"><strong>{report.company}</strong><small>{report.stockCode}</small></div>
              <div className="research-report-body">
                <h2><a href={report.url} target="_blank" rel="noopener noreferrer">{report.title} <span aria-hidden="true">↗</span></a></h2>
                <p><span>{report.broker}</span><time dateTime={report.date}>{report.date.replaceAll("-", ".")}</time></p>
              </div>
              <dl className="research-opinion">
                <div><dt>목표주가</dt><dd>{report.targetPrice ? numbers.format(BigInt(report.targetPrice)) + "원" : "—"}</dd></div>
                <div><dt>투자의견</dt><dd>{report.opinion ?? "—"}</dd></div>
              </dl>
            </article>
          </li>)}</ul>}
        <nav className="research-pagination" aria-label="보고서 목록 페이지 이동">
          <button type="button" className="expand-button" disabled={loading || selection.page === 0}
            onClick={() => changePage(selection.page - 1)}>이전</button>
          <span>{numbers.format(selection.page + 1)}페이지</span>
          <button type="button" className="expand-button" disabled={loading || !data.hasNext}
            onClick={() => changePage(selection.page + 1)}>다음</button>
        </nav>
      </>}
    </section>
  </>;
}
