import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { requestJson } from "../lib/client-api";
import { highMessageLimit } from "../lib/high-message";
import type { HighListing } from "../lib/high-message";
import type { Company } from "../lib/market";

const draftKey = "stock-insight.high-message";
const date = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
function readDraft() { try { return (sessionStorage.getItem(draftKey) ?? "").slice(0, highMessageLimit); } catch { return ""; } }
const companyLink = (company: Company, view: string) => "/?" + new URLSearchParams({ corp: company.corpCode, view });

export default function HighsPage() {
  const [text, setText] = useState(readDraft);
  const [listing, setListing] = useState<HighListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    try { if (text) sessionStorage.setItem(draftKey, text); else sessionStorage.removeItem(draftKey); } catch { /* Draft persistence is optional. */ }
  }, [text]);
  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ companies: Company[] }>("/api/watchlist", { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSaved(result.companies.map(item => item.corpCode)); }, () => {});
    return () => { controller.abort(); pending.current?.abort(); };
  }, []);
  async function analyze(refresh = false) {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestJson<HighListing>("/api/highs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, refresh }), signal: controller.signal });
      if (!controller.signal.aborted) setListing(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "기업 목록을 조회하지 못했습니다.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function add(company: Company) {
    setAdding(company.corpCode); setNotice("");
    try {
      await requestJson("/api/watchlist?" + new URLSearchParams({ corp: company.corpCode }), { method: "PUT" });
      setSaved(current => [...new Set([...current, company.corpCode])]);
      setNotice(company.name + " 관심종목에 등록했습니다.");
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "관심종목을 등록하지 못했습니다."); }
    finally { setAdding(null); }
  }
  function changeText(value: string) { setText(value); setListing(null); setError(""); setNotice(""); }
  function submit(event: FormEvent) { event.preventDefault(); void analyze(); }
  return <>
    <section className="hero highs-hero" aria-labelledby="highs-title">
      <div className="eyebrow"><span className="dot"/> 52-WEEK HIGH</div>
      <h1 id="highs-title">52주 신고가</h1>
      <p>텔레그램에서 복사한 종목 목록으로 기업의 재무·차트·리서치를 확인하세요.</p>
    </section>
    <section className="panel highs-input-panel">
      <form onSubmit={submit}>
        <label htmlFor="high-message">메시지 붙여넣기</label>
        <textarea id="high-message" value={text} maxLength={highMessageLimit} readOnly={busy} rows={6}
          placeholder={"반도체) 삼성전자, SK하이닉스\n(자동차) 현대차-실적\n삼성전자(005930)처럼 종목코드도 입력할 수 있습니다."}
          onChange={event => changeText(event.target.value)} aria-describedby="high-message-help"/>
        <div className="highs-input-meta"><p id="high-message-help">괄호 안 분류와 하이픈 뒤 메모를 함께 표시하고, 중복 기업은 합칩니다.</p><small>{text.length.toLocaleString()} / 20,000자</small></div>
        <div className="highs-input-actions">
          <button type="submit" className="watch-button" disabled={busy || !text.trim()}>{busy ? "기업 확인 중…" : "기업 목록 조회"}</button>
          <button type="button" className="expand-button" disabled={busy || !text.trim()} onClick={() => void analyze(true)}>기업 목록 갱신 후 조회</button>
          <button type="button" className="expand-button" disabled={busy || !text} onClick={() => changeText("")}>입력 비우기</button>
        </div>
      </form>
      <p className="highs-source-note">신고가 분류는 붙여넣은 메시지 기준입니다. 기업을 열면 새 탭에서 조회합니다.</p>
    </section>
    {error && <p className="notice error" role="alert">{error}</p>}
    {busy && <p className="loading" role="status"><span className="spinner"/> KOSPI·KOSDAQ 상장기업을 확인하고 있습니다.</p>}
    {notice && <p className="notice" role="status">{notice} <a href="/?section=watchlist">관심종목 목록 →</a></p>}
    {listing && <>
      <section className="panel highs-results" aria-label="조회된 신고가 기업">
        <div className="highs-results-head"><div><h2>확인된 기업 <strong>{listing.rows.length}</strong></h2>
          <p>입력 {listing.mentionCount}건 · 확인 필요 {listing.issues.length}건 · 중복 기업 통합</p></div>
          <small>조회 {date.format(new Date(listing.analyzedAt))}</small></div>
        {listing.warning && <p className="notice" role="status">{listing.warning}</p>}
        {!listing.rows.length ? <p className="research-empty">연결된 기업이 없습니다. 아래 확인 필요 항목에서 입력한 이름과 종목코드를 확인해 주세요.</p>
          : <ul className="highs-company-list">{listing.rows.map(row => <li key={row.company.corpCode}>
            <div className="highs-company-name"><strong>{row.company.name}</strong><small>{row.company.market} · {row.company.stockCode}</small></div>
            <div className="highs-company-notes">
              {row.categories.length ? <div className="highs-tags">{row.categories.map(label => <span key={label}>{label}</span>)}</div> : <small>분류 없음</small>}
              {row.notes.length > 0 && <p>{row.notes.join(" · ")}</p>}
            </div>
            <div className="highs-company-links" aria-label={row.company.name + " 조회"}>
              {[{ view: "financials", label: "재무" }, { view: "chart", label: "차트" }, { view: "research", label: "리서치" }].map(item =>
                <a key={item.view} href={companyLink(row.company, item.view)} target="_blank" rel="noopener noreferrer" aria-label={row.company.name + " " + item.label + " 새 탭에서 보기"}>{item.label} ↗</a>)}
            </div>
            <button type="button" className="watch-button highs-watch" disabled={Boolean(adding) || saved.includes(row.company.corpCode)}
              onClick={() => void add(row.company)} aria-label={row.company.name + " 관심종목 등록"}>
              {saved.includes(row.company.corpCode) ? "등록됨" : adding === row.company.corpCode ? "등록 중…" : "관심종목 +"}</button>
          </li>)}</ul>}
        {listing.directoryUpdatedAt > 0 && <p className="highs-directory-date">기업 목록 기준 {date.format(new Date(listing.directoryUpdatedAt))}</p>}
      </section>
      {listing.issues.length > 0 && <section className="panel highs-issues" aria-labelledby="highs-issues-title">
        <h2 id="highs-issues-title">확인 필요 <strong>{listing.issues.length}</strong></h2>
        <p>정확한 기업명이나 종목코드로 메시지를 수정한 뒤 다시 조회해 주세요.</p>
        <ul>{listing.issues.map((issue, index) => <li key={index}>
          <strong>{issue.input}</strong><span>{[...issue.categories, ...issue.notes].join(" · ")}</span><p>{issue.message}</p>
          {issue.choices && <div className="highs-choice-list">{issue.choices.map(company => <span key={company.corpCode}>{company.name} · {company.market} · {company.stockCode}</span>)}</div>}
        </li>)}</ul>
      </section>}
    </>}
  </>;
}
