"use client";

import { Fragment, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { requestJson } from "../lib/client-api";
import { vipManager } from "../lib/ownership";
import type { AssetManager, HoldingReport, OwnershipCoverage, OwnershipView } from "../lib/ownership";

type Overview = { managers: AssetManager[]; coverage: OwnershipCoverage };

const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

function dateLabel(value: string | null) {
  return value ? value.slice(0, 4) + "." + value.slice(4, 6) + "." + value.slice(6, 8) : "—";
}

function sourceUrl(receipt: string) {
  return "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=" + receipt;
}

function giantsRequest<T>(params: Record<string, string> = {}, options?: RequestInit) {
  return requestJson<T>("/api/giants?" + new URLSearchParams(params), options);
}

function sharesLabel(value: string | null | undefined) {
  return value == null ? "—" : number.format(BigInt(value));
}

function ratioLabel(value: number | null | undefined) {
  return value == null ? "—" : number.format(value) + "%";
}

function changeLabel(value: number | null | undefined) {
  if (value == null) return "—";
  return (value > 0 ? "+" : value < 0 ? "−" : "") + number.format(Math.abs(value)) + "%p";
}

function HoldingsTable({ reports }: { reports: HoldingReport[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const byCompany = new Map<string, HoldingReport[]>();
  for (const report of reports) {
    const company = byCompany.get(report.corpCode);
    if (company) company.push(report);
    else byCompany.set(report.corpCode, [report]);
  }
  const companies = Array.from(byCompany.values(), (history) => ({
    history, latest: history.find((report) => !report.corrected) ?? history[0],
  })).sort((a, b) => b.latest.receipt.localeCompare(a.latest.receipt));

  return <section className="panel holdings-panel" aria-labelledby="holdings-heading">
    <div className="panel-head">
      <div><h2 id="holdings-heading">종목별 최신 지분공시</h2><p>공시 접수일 기준 · 이력을 열어 이전 보유 현황을 확인할 수 있습니다.</p></div>
      <span className="watch-count">{number.format(companies.length)}종목 · {number.format(reports.length)}건</span>
    </div>
    <div className="table-scroll holdings-scroll" tabIndex={0} aria-label="종목별 최신 지분공시 표">
      <table className="holdings-table">
        <thead><tr>
          <th scope="col">기업</th><th scope="col">보유주식등 수</th><th scope="col">보유비율</th>
          <th scope="col">직전 공시 대비</th><th scope="col">최신 접수일</th><th scope="col">공시 이력</th>
        </tr></thead>
        <tbody>{companies.map(({ latest, history }) => {
          const { corpCode, company, stockCode, market, date, receipt, ownership } = latest;
          const open = expanded === corpCode;
          const change = ownership?.change;
          return <Fragment key={corpCode}>
            <tr>
              <th scope="row"><a href={"/?corp=" + corpCode}>{company}</a><small>{market} {stockCode}</small></th>
              <td>{sharesLabel(ownership?.shares)}</td>
              <td><strong>{ratioLabel(ownership?.ratio)}</strong></td>
              <td><span className={"holding-change " + (change == null || change === 0 ? "flat" : change > 0 ? "up" : "down")}>{changeLabel(change)}</span></td>
              <td><a className="filing-link" href={sourceUrl(receipt)} target="_blank" rel="noreferrer"
                aria-label={company + " " + dateLabel(date) + " DART 원문"}>{dateLabel(date)} ↗</a></td>
              <td><button type="button" className="history-button" aria-expanded={open}
                aria-controls={"history-" + corpCode} aria-label={company + " 공시 이력 " + history.length + "건"}
                onClick={() => setExpanded(open ? null : corpCode)}>{history.length}건 {open ? "▴" : "▾"}</button></td>
            </tr>
            {open && <tr id={"history-" + corpCode} className="holding-history"><td colSpan={6}>
              <strong>{company} 공시 이력</strong>
              <ul>{history.map((report) => <li key={report.receipt}>
                <a className="filing-link" href={sourceUrl(report.receipt)} target="_blank" rel="noreferrer">
                  {dateLabel(report.date)} <span>{report.title} ↗</span>
                </a>
                <span>{sharesLabel(report.ownership?.shares)} · {ratioLabel(report.ownership?.ratio)} · {changeLabel(report.ownership?.change)}</span>
                <small>{[report.corrected ? "정정 대상" : "", report.ownership?.reason].filter(Boolean).join(" · ")}</small>
              </li>)}</ul>
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table>
    </div>
    <p className="holdings-note">보유 수량과 비율은 보고서 요약의 보유주식등 기준입니다. 공시 시점의 수치이며, 빈 값은 원문에서 확인할 수 있습니다.</p>
  </section>;
}

export default function GiantsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [manager, setManager] = useState(vipManager.key);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<{ manager: string; data: OwnershipView } | null>(null);
  const [dataError, setDataError] = useState("");
  const [actionError, setActionError] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    giantsRequest<Overview>({}, { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setOverview(data); },
      (error) => { if (!controller.signal.aborted) setActionError(error.message); },
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setDataError("");
    async function load() {
      try {
        let data = await giantsRequest<OwnershipView>({ manager }, { signal });
        if (!signal.aborted) setView({ manager, data });
        while (!signal.aborted && data.pending > 0) {
          data = await giantsRequest<OwnershipView>({ manager }, { method: "POST", signal });
          if (!signal.aborted) setView({ manager, data });
        }
      } catch (error) {
        if (!signal.aborted) setDataError(error instanceof Error ? error.message : "지분공시를 읽지 못했습니다.");
      }
    }
    void load();
    return () => controller.abort();
  }, [manager, revision]);

  async function addManager(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setActionError("");
    try {
      const saved = await giantsRequest<AssetManager>({ name: name.trim() }, { method: "PUT" });
      setOverview((current) => current && !current.managers.some((item) => item.key === saved.key)
        ? { ...current, managers: [...current.managers, saved] } : current);
      setManager(saved.key);
      setName("");
      setAdding(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "운용사를 추가하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function sync() {
    if (!overview) return;
    const months = [...new Set([overview.coverage.currentMonth, ...overview.coverage.missing])];
    setActionError("");
    setSyncing({ done: 0, total: months.length });
    try {
      for (let index = 0; index < months.length; index += 2) {
        const batch = months.slice(index, index + 2);
        await Promise.all(batch.map((month) => giantsRequest({ month }, { method: "POST" })));
        setSyncing({ done: index + batch.length, total: months.length });
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "공시 목록을 갱신하지 못했습니다.");
    } finally {
      try {
        setOverview(await giantsRequest<Overview>());
      } catch {
        setActionError("공시 목록의 갱신 상태를 확인하지 못했습니다.");
      }
      setRevision((value) => value + 1);
      setSyncing(null);
    }
  }

  const data = view?.manager === manager ? view.data : null;
  const coverage = overview?.coverage;
  return <>
    <section className="hero giants-hero" aria-labelledby="giants-title">
      <div className="eyebrow"><span className="dot"/> DART 지분공시</div>
      <h1 id="giants-title">거인의 어깨</h1>
      <p>운용사가 최근 3년 동안 공시한 보유 종목과 지분 변동을 확인하세요.</p>
    </section>
    <section className="panel manager-panel" aria-label="운용사 선택과 추가">
      <div className="manager-bar">
        <label className="manager-field">자산운용사
          <select value={manager} onChange={(event) => setManager(event.target.value)}>
            {(overview?.managers ?? [vipManager]).map(({ key, name }) => <option value={key} key={key}>{name}</option>)}
          </select>
        </label>
        <button type="button" className="expand-button" aria-expanded={adding}
          disabled={!overview} onClick={() => setAdding((value) => !value)}>＋ 운용사 추가</button>
        <button type="button" className="expand-button" disabled={!overview || Boolean(syncing)}
          onClick={() => void sync()}>{syncing ? "갱신 중…" : "공시 목록 갱신"}</button>
      </div>
      {adding && <form className="manager-form" onSubmit={addManager}>
        <label className="manager-field">DART 공시 제출인명
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80}
            placeholder="예시 신영자산운용" required/>
        </label>
        <button type="submit" className="watch-button" disabled={saving}>{saving ? "추가 중…" : "추가"}</button>
      </form>}
      {coverage && <p className="giants-period">조회 기간 {dateLabel(coverage.start)}–{dateLabel(coverage.end)}
        {coverage.through ? " · 목록 수집 기준 " + dateLabel(coverage.through) : ""}
        {coverage.missing.length ? " · 미수집 " + coverage.missing.length + "개월" : ""}
      </p>}
      {syncing && <p className="loading" role="status"><span className="spinner"/> 공시 목록 갱신 {syncing.done}/{syncing.total}개월</p>}
      {actionError && <p className="notice error" role="alert">{actionError}</p>}
    </section>
    {dataError && <div className="notice error" role="alert">{dataError}
      <button type="button" className="expand-button" onClick={() => setRevision((value) => value + 1)}>다시 조회</button>
    </div>}
    {!data ? (!dataError && <p className="loading" role="status"><span className="spinner"/> 지분공시를 불러오는 중…</p>)
      : data.reports.length === 0 ? <div className="panel giants-empty">
        {coverage?.missing.length ? "아직 불러온 공시가 없습니다. 공시 목록 갱신으로 조회 범위를 채울 수 있습니다."
          : "조회 기간에 이 이름으로 접수된 지분공시가 없습니다. DART 공시 제출인명을 확인해 주세요."}
      </div> : <>
        {data.pending > 0 && !dataError && <p className="loading" role="status"><span className="spinner"/> 공시 원문에서 보유 현황을 읽는 중 · {data.pending}건 남음</p>}
        <HoldingsTable key={manager} reports={data.reports}/>
      </>}
  </>;
}
