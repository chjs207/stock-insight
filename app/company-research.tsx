import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { requestJson } from "../lib/client-api";
import { researchPageSize, researchSourceUrl } from "../lib/research-data";
import type { ResearchListing, ResearchSearchMode } from "../lib/research-data";
import type { Company } from "../lib/market";

const numbers = new Intl.NumberFormat("ko-KR");
const updated = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
type Selection = { query: string; company: Company | null; page: number; refresh: boolean; version: number };

export default function CompanyResearch({ company }: { company?: Company }) {
  const [searchText, setSearchText] = useState("");
  const [mode, setMode] = useState<ResearchSearchMode>("company");
  const [selection, setSelection] = useState<Selection>({ query: "", company: company ?? null, page: 0, refresh: false, version: 0 });
  const [choices, setChoices] = useState<Company[]>([]);
  const [companySearching, setCompanySearching] = useState(false);
  const [companyError, setCompanyError] = useState("");
  const companyRequest = useRef<AbortController | null>(null);
  const [listing, setListing] = useState<ResearchListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const currentCompany = company ?? selection.company;
  useEffect(() => () => companyRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ page: String(selection.page), mode: currentCompany ? "company" : "keyword" });
    if (currentCompany) params.set("stock", currentCompany.stockCode);
    else if (selection.query) params.set("q", selection.query);
    if (selection.refresh) params.set("refresh", "1");
    requestJson<ResearchListing>("/api/research?" + params, { signal: controller.signal }).then(
      result => { if (!controller.signal.aborted) setListing(result); },
      failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "리서치 목록을 읽지 못했습니다."); },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selection, currentCompany?.stockCode]);

  function clearCompanySearch() {
    companyRequest.current?.abort(); companyRequest.current = null;
    setChoices([]); setCompanyError(""); setCompanySearching(false);
  }

  function resetSearch() {
    clearCompanySearch(); setSearchText("");
    setSelection(current => ({ query: "", company: null, page: 0, refresh: false, version: current.version + 1 }));
  }

  function selectCompany(company: Company) {
    setChoices([]); setCompanyError(""); setSearchText(company.name);
    setSelection(current => ({ query: "", company, page: 0, refresh: false, version: current.version + 1 }));
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) { resetSearch(); return; }
    if (mode === "keyword") {
      setSelection(current => ({ query, company: null, page: 0, refresh: false, version: current.version + 1 }));
      return;
    }
    clearCompanySearch();
    const controller = new AbortController(); companyRequest.current = controller;
    setCompanySearching(true);
    try {
      const { companies } = await requestJson<{ companies: Company[] }>("/api/market?" + new URLSearchParams({ q: query }), { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (companies.length === 1) selectCompany(companies[0]);
      else if (companies.length) setChoices(companies);
      else setCompanyError("일치하는 KOSPI·KOSDAQ 기업이 없습니다. 기업명이나 종목코드를 확인해 주세요.");
    } catch (failure) {
      if (!controller.signal.aborted) setCompanyError(failure instanceof Error ? failure.message : "기업을 검색하지 못했습니다.");
    } finally {
      if (companyRequest.current === controller) { companyRequest.current = null; setCompanySearching(false); }
    }
  }

  function refresh() { setSelection(current => ({ ...current, refresh: true, version: current.version + 1 })); }
  function changePage(page: number) {
    setSelection(current => ({ ...current, page, refresh: false }));
    window.scrollTo(0, 0);
  }
  const data = listing?.page === selection.page && listing.query === selection.query &&
    listing.stockCode === (currentCompany?.stockCode ?? null) ? listing : null;
  const busy = loading || companySearching;
  return <>
    <section className="panel research-toolbar" aria-labelledby="research-title">
      <div>
        {company ? <h2 id="research-title">{company.name} 기업 리서치</h2> : <h1 id="research-title">기업 리서치</h1>}
        <p>{company ? company.name + " (" + company.stockCode + ") 보고서만 표시합니다. 제목을 누르면 상세 내용을 새 탭에서 볼 수 있습니다."
          : "네이버 증권의 기업 보고서 목록입니다. 제목을 누르면 상세 내용을 새 탭에서 볼 수 있습니다."}</p>
      </div>
      <div className="research-actions">
        <button type="button" className="expand-button" disabled={busy} onClick={refresh}>최신 목록 조회</button>
        <a className="watch-button" href={researchSourceUrl} target="_blank" rel="noopener noreferrer">네이버 전체 목록 ↗</a>
      </div>
    </section>
    <section className="panel research-results" aria-label="기업 보고서 목록" aria-busy={busy}>
      {!company && <>
      <form className="research-search" onSubmit={search}>
        <fieldset className="research-search-mode"><legend>검색 방식</legend>
          {([{ value: "company", label: "기업명" }, { value: "keyword", label: "키워드" }] as const).map(item =>
            <label key={item.value}><input type="radio" name="research-search-mode" value={item.value} checked={mode === item.value}
              onChange={() => { setMode(item.value); resetSearch(); }}/>{item.label}</label>)}
        </fieldset>
        <label htmlFor="research-query">{mode === "company" ? "기업명·종목코드 검색" : "키워드 검색"}</label>
        <div className="research-search-input">
          <input id="research-query" type="search" value={searchText} maxLength={60}
            placeholder={mode === "company" ? "예: 삼성전자 또는 005930" : "예: 반도체, AI, 배당"}
            onChange={event => { setSearchText(event.target.value); clearCompanySearch(); }}/>
          <button type="submit" className="watch-button" disabled={busy}>{companySearching ? "기업 조회 중…" : "검색"}</button>
          {(selection.query || selection.company) && <button type="button" className="expand-button" disabled={busy} onClick={resetSearch}>전체 목록</button>}
        </div>
        <p className="research-search-help">{mode === "company" ? "선택한 기업에 대한 보고서만 조회합니다. 여러 기업이 검색되면 목록에서 선택해 주세요."
          : "제목·본문 등에서 키워드를 검색합니다. 해당 단어가 언급된 다른 기업의 보고서도 포함됩니다."}</p>
      </form>
      {companyError && <p className="notice error" role="alert">{companyError}</p>}
      {companySearching && <p className="loading research-loading" role="status"><span className="spinner"/> 기업을 검색하는 중…</p>}
      {choices.length > 0 && <div className="research-company-choices" role="group" aria-label="검색된 기업 선택">
        <p>보고서를 조회할 기업을 선택해 주세요.</p>
        <ul>{choices.map(company => <li key={company.corpCode}><button type="button" className="research-company-choice"
          onClick={() => selectCompany(company)}><strong>{company.name}</strong><span>{company.market} · {company.stockCode}</span></button></li>)}</ul>
      </div>}
      </>}
      {loading && <p className="loading research-loading" role="status"><span className="spinner"/> 보고서 목록을 불러오는 중…</p>}
      {error && <p className="notice error" role="alert">{error}
        <button type="button" className="expand-button" onClick={refresh} disabled={loading}>다시 조회</button>
      </p>}
      {data && <>
        <div className="research-list-meta" role="status">
          <span>{currentCompany ? currentCompany.name + " (" + currentCompany.stockCode + ") 보고서 "
            : selection.query ? "키워드 ‘" + selection.query + "’ 검색 결과 " : "전체 "}<strong>{numbers.format(data.total)}건</strong>
            {data.reports.length > 0 && " · " + numbers.format(selection.page * researchPageSize + 1) + "–" + numbers.format(selection.page * researchPageSize + data.reports.length) + "번째"}</span>
          <small>출처 네이버 증권 · {updated.format(new Date(data.fetchedAt))} 기준</small>
        </div>
        {data.warning && <p className="notice" role="status">{data.warning} 저장된 목록을 표시합니다.</p>}
        {data.reports.length === 0 ? <p className="research-empty">{company ? "아직 이 기업에 대한 보고서가 없습니다."
          : currentCompany ? "이 기업에 대한 보고서가 없습니다. 다른 기업을 검색하거나 전체 목록을 확인해 주세요."
          : "검색 결과가 없습니다. 다른 키워드로 검색해 주세요."}</p>
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
          <button type="button" className="expand-button" disabled={busy || selection.page === 0}
            onClick={() => changePage(selection.page - 1)}>이전</button>
          <span>{numbers.format(selection.page + 1)}페이지</span>
          <button type="button" className="expand-button" disabled={busy || !data.hasNext}
            onClick={() => changePage(selection.page + 1)}>다음</button>
        </nav>
      </>}
    </section>
  </>;
}
