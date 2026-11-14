"use client";

import { useEffect, useState } from "react";
import { requestJson } from "../lib/client-api";
import { annualEarnings, earningsMultiple, trailingEarnings } from "../lib/valuation";
import type { IssuerQuote } from "../lib/valuation";
import type { AnnualReport, Company, QuarterlyFinancials } from "../lib/market";

const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

function amount(value: string | null) {
  return value === null ? "—" : number.format(Number(value) / 100_000_000) + "억 원";
}

export default function ValuationPanel({ company, annual, quarters }: {
  company: Company;
  annual: AnnualReport;
  quarters: QuarterlyFinancials | null;
}) {
  const [quote, setQuote] = useState<IssuerQuote | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"ttm" | "annual">("ttm");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    requestJson<IssuerQuote>("/api/market?" + new URLSearchParams({ corp: company.corpCode, valuation: "1" }),
      { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setQuote(data); },
      (caught) => { if (!controller.signal.aborted) setError(caught.message); },
    );
    return () => controller.abort();
  }, [company.corpCode, attempt]);

  const earnings = mode === "annual" ? annualEarnings(annual) : quarters ? trailingEarnings(quarters) : null;
  const reason = earnings?.reason ?? (earnings && earnings.currency !== "KRW" ? "원화 기준 실적이 필요합니다." : null);
  const items = [
    { key: "per", name: "PER", profit: earnings?.parentProfit ?? null,
      label: earnings?.basis === "OFS" ? "별도 순이익" : "지배주주 순이익" },
    { key: "por", name: "POR", profit: earnings?.operatingProfit ?? null, label: "영업이익" },
  ];

  return <section className="panel valuation-panel" aria-labelledby="valuation-title">
    <div className="panel-head">
      <div><h3 id="valuation-title">PER · POR</h3><p>시가총액 ÷ 실적</p></div>
      <div className="chart-comparison" role="group" aria-label="PER·POR 실적 기준">
        <button type="button" aria-pressed={mode === "ttm"} onClick={() => setMode("ttm")}>최근 4분기(TTM)</button>
        <button type="button" aria-pressed={mode === "annual"} onClick={() => setMode("annual")}>최근 연간</button>
      </div>
    </div>
    {error && <div className="notice error" role="alert"><span>{error}</span>
      <button type="button" className="expand-button" onClick={() => setAttempt(attempt + 1)}>다시 조회</button>
    </div>}
    {quote ? <>
      <div className="valuation-meta">
        <span>시가총액 <strong>{amount(quote.marketCap)}</strong></span>
        <span>시세 {quote.quotedAt.replace("T", " ").slice(0, 16)}</span>
        <a href={"https://m.stock.naver.com/domestic/stock/" + company.stockCode} target="_blank" rel="noreferrer">네이버 증권 ↗</a>
      </div>
      <div className="valuation-metrics">
        {items.map(({ key, name, profit, label }) => {
          const multiple = earnings && !reason ? earningsMultiple(quote.marketCap, profit) : null;
          const unavailable = profit === null ? "실적 자료 없음" : BigInt(profit) < BigInt(0) ? "적자" : "이익 0";
          return <article key={key} className="valuation-card">
            <h4>{name}<small>{mode === "ttm" ? "TTM" : annual.year + "년"}</small></h4>
            <div className="valuation-number">{multiple === null ? "—" : number.format(multiple)}
              {multiple !== null && <span>배</span>}
            </div>
            <p>{!earnings ? "분기 실적을 불러온 뒤 계산됩니다." : reason || (multiple === null ? unavailable : label + " " + amount(profit))}</p>
          </article>;
        })}
      </div>
      <div className="valuation-note">
        {earnings && <p>실적 {earnings.label} · {earnings.basis === "CFS" ? "연결" : "별도"}</p>}
        <p>{quote.stocks.map(({ name }) => name).join(" · ")} 시가총액 합산 기준</p>
        {quote.stale && <p>시가총액 저장본을 사용했습니다. 수집 시각 {new Date(quote.fetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>}
      </div>
    </> : !error && <p className="quarter-loading" role="status"><span className="spinner"/> 시가총액을 불러오는 중…</p>}
  </section>;
}
