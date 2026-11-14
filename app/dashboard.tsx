"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { changePercent, growth, metrics } from "../lib/market";
import type { AnnualReport, Company, Financials, Metric, QuarterlyFinancials, QuarterlyYear, QuarterReport } from "../lib/market";
import { requestJson } from "../lib/client-api";
import GiantsPage from "./giants";
import CompanyResearch from "./company-research";
import ValuationPanel from "./valuation";
import CompanyPriceChart from "./price-chart";

const figures = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const exactFigures = new Intl.NumberFormat("ko-KR");

function money(value: string | null, currency: string | null) {
  if (value === null) return "—";
  return currency === "KRW" ? figures.format(Number(value) / 100_000_000) : exactFigures.format(BigInt(value));
}

function unit(currency: string | null) {
  return currency === "KRW" ? "억 원" : currency ?? "";
}

function percentage(value: number) {
  const display = figures.format(Math.abs(value));
  return (display === "0" ? "" : value < 0 ? "−" : "+") + display + "%";
}

const basisName = { CFS: "연결", OFS: "별도" };

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    plus: <path d="M5 12h14M12 5v14"/>,
    back: <path d="M19 12H5m6 6-6-6 6-6"/>,
    star: <path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9Z"/>,
    external: <path d="M13 5h6v6m0-6-9 9m8-1v6H5V6h6"/>,
    chart: <path d="M4 5v15h16M7 15l4-5 4 2 4-6"/>,
    table: <><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M10 10v9"/></>,
    research: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h6"/></>,
    database: <><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 4 14 4 14 0V6M5 12c0 4 14 4 14 0"/></>,
    info: <><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5m0-8v.1"/></>,
    revenue: <path d="M5 19V13m7 6V9m7 10V5"/>,
    operating: <path d="M3 17l6-6 4 4 7-8m-5 0h5v5"/>,
    net: <><circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/></>,
    parentNet: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function HeroChart() {
  return <svg className="hero-chart" width="410" height="230" viewBox="0 0 410 230" fill="none" aria-hidden="true">
    <defs>
      <pattern id="hero-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0v32" stroke="#b9dbcc" strokeWidth="1"/></pattern>
      <linearGradient id="hero-fill" x1="200" y1="58" x2="200" y2="220" gradientUnits="userSpaceOnUse">
        <stop stopColor="#62ba98" stopOpacity=".26"/><stop offset="1" stopColor="#62ba98" stopOpacity="0"/>
      </linearGradient>
      <linearGradient id="hero-fade"><stop stopColor="white" stopOpacity="0"/><stop offset=".28" stopColor="white"/><stop offset="1" stopColor="white"/></linearGradient>
      <mask id="fade-grid"><rect width="410" height="230" fill="url(#hero-fade)"/></mask>
    </defs>
    <g mask="url(#fade-grid)">
      <path d="M0 0h410v230H0z" fill="url(#hero-grid)" opacity=".7"/>
      <path d="M0 191 70 166 110 173 172 130 216 138 266 92 310 106 374 51 410 31V230H0Z" fill="url(#hero-fill)"/>
      <path d="M0 191 70 166 110 173 172 130 216 138 266 92 310 106 374 51 410 31" stroke="#4d9c83" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M0 207 70 191 110 195 172 173 216 179 266 158 310 159 374 124 410 114" stroke="#80b9a4" strokeWidth="1.5" strokeDasharray="5 6"/>
      <circle cx="266" cy="92" r="4" fill="#f4fff8" stroke="#4d9c83" strokeWidth="2"/>
      <circle cx="374" cy="51" r="9" fill="#9ed4c0" opacity=".55"/><circle cx="374" cy="51" r="4" fill="#08725c"/>
    </g>
  </svg>;
}

function request<T>(params: Record<string, string>, signal?: AbortSignal) {
  return requestJson<T>("/api/market?" + new URLSearchParams(params), { signal });
}

type GrowthPeriod = {
  label: string;
  axisLabel: string;
  group?: number;
  report: AnnualReport;
  previous?: AnnualReport;
};

function GrowthChart({ periods, title, subtitle, note, controls }: {
  periods: GrowthPeriod[];
  title: string;
  subtitle: string;
  note: string;
  controls?: ReactNode;
}) {
  const titleId = useId();
  const [selection, setSelection] = useState<Metric | "all">("all");
  const [focusedPeriod, setFocusedPeriod] = useState<string | null>(null);
  const hover = periods.findIndex(({ label }) => label === focusedPeriod);
  const groups = Array.from(new Set(periods.flatMap(({ group }) => group === undefined ? [] : [group])));
  const series = metrics.filter(({ key }) => selection === "all" || selection === key).map((metric) => ({
    ...metric,
    values: periods.map(({ report, previous }) => changePercent(report, previous, metric.key)),
  }));
  const values = series.flatMap(({ values }) => values).filter((value): value is number => value !== null);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const rawStep = (max - min) / 4 || 5;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 2.5, 5, 10].find((value) => value * magnitude >= rawStep) ?? 10) * magnitude;
  const bottom = Math.floor(min / step) * step;
  const top = Math.ceil(max / step) * step || step;
  const y = (value: number) => 10 + (top - value) / (top - bottom) * 166;
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, index) => top - step * index);
  const x = (index: number) => (index + .5) / periods.length * 960;

  return <section className="panel chart-panel" aria-labelledby={titleId}>
    <div className="panel-head">
      <div className="panel-heading"><span className="panel-icon"><Icon name="chart"/></span>
        <div><h3 id={titleId}>{title}</h3><p>{subtitle}</p></div>
      </div>
      <div className="chart-controls">
        {controls}
        <div className="legend" role="group" aria-label="차트 항목">
          {metrics.map(({ key, label, color }) =>
            <button type="button" key={key} className={selection === "all" || selection === key ? "" : "muted"}
              aria-pressed={selection === key} onClick={() => { setSelection(selection === key ? "all" : key); setFocusedPeriod(null); }}>
              <span className="dot" style={{ background: color }}/>{label}
            </button>)}
        </div>
      </div>
    </div>
    {values.length === 0 ? <p className="empty-chart">선택한 항목에서 비교할 수 있는 자료가 없습니다.</p> :
      <div className="chart-scroll">
        <div className="chart-area" style={groups.length ? { minWidth: 40 + periods.length * 27 } : undefined}>
          <div className="y-axis" aria-hidden="true">
            {ticks.map((tick) => <span key={tick} style={{ top: (y(tick) / 1.86) + "%" }}>{figures.format(tick)}%</span>)}
          </div>
          <div className="plot">
            <div className="plot-lines">
              <svg viewBox="0 0 960 186" preserveAspectRatio="none" role="img" aria-label={series.map(({ label }) => label).join(", ") + " " + title}>
                {ticks.map((tick) => <line key={tick} x1="0" x2="960" y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "#aabbb4" : "#e8eeeb"} strokeDasharray={tick === 0 ? "5 4" : undefined} vectorEffect="non-scaling-stroke"/>)}
                {groups.slice(1).map((group, index) => {
                  const divider = (index + 1) / groups.length * 960;
                  return <line key={group} x1={divider} x2={divider} y1="8" y2="178" stroke="#e8eeeb" vectorEffect="non-scaling-stroke"/>;
                })}
                {hover >= 0 && <line x1={x(hover)} x2={x(hover)} y1="8" y2="178" stroke="#b9cac3" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"/>}
                {series.map(({ key, color, values }) => {
                  const path = values.map((value, index) => value === null ? "" :
                    (index === 0 || values[index - 1] === null ? "M" : "L") + x(index) + "," + y(value)).join(" ");
                  return <path key={key} d={path} fill="none" stroke={color} strokeWidth="2.35" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>;
                })}
              </svg>
              {series.flatMap(({ key, color, values }) => values.map((value, index) => value === null ? null :
                <span key={key + index} className="chart-point" style={{
                  left: x(index) / 9.6 + "%", top: y(value) / 1.86 + "%", color,
                }}/>))}
              <div className="chart-targets">
                {periods.map(({ label }, index) => <button type="button" key={label}
                  aria-label={label + " " + series.map((item) => item.label + " " + (item.values[index] === null ? "비교 불가" : percentage(item.values[index]))).join(", ")}
                  onPointerEnter={() => setFocusedPeriod(label)} onPointerLeave={() => setFocusedPeriod(null)}
                  onFocus={() => setFocusedPeriod(label)} onBlur={() => setFocusedPeriod(null)}
                  onClick={() => setFocusedPeriod(label)} onKeyDown={(event) => { if (event.key === "Escape") setFocusedPeriod(null); }}/>)}
              </div>
              {hover >= 0 && <div className="chart-tooltip"
                style={{ left: Math.min(77, Math.max(23, x(hover) / 9.6)) + "%" }} aria-hidden="true">
                <strong>{periods[hover].label}</strong>
                {series.map(({ key, label, color, values }) => <div key={key}>
                  <span><i className="dot" style={{ background: color }}/>{label}</span>
                  <b>{values[hover] === null ? "—" : percentage(values[hover])}</b>
                </div>)}
              </div>}
            </div>
            <div className="x-axis">{periods.map(({ label, axisLabel }) => <span key={label}>{axisLabel}</span>)}</div>
            {groups.length > 0 && <div className="x-axis year-axis">{groups.map((year) => <span key={year}>{year}</span>)}</div>}
          </div>
        </div>
      </div>}
    <p className="chart-note"><Icon name="info" size={14}/> {note}</p>
  </section>;
}

function AnnualGrowthChart({ reports }: { reports: AnnualReport[] }) {
  const periods = reports.slice(1).map((report, index) => ({
    label: report.year + "년", axisLabel: String(report.year), report,
    previous: report.year === reports[index].year + 1 ? reports[index] : undefined,
  }));
  return <GrowthChart periods={periods} title="전년 대비 증감률" subtitle="연도별 변화율 · %"
    note="(당해 금액 − 전년 금액) ÷ |전년 금액| × 100. 전년 금액이 0이거나 비교 기준이 다른 경우는 생략합니다."/>;
}

const quarterComparisons = { yoy: "전년 동분기 대비", qoq: "직전 분기 대비" } as const;
const quarterIndex = ({ year, quarter }: QuarterReport) => year * 4 + quarter - 1;

function QuarterlyGrowthChart({ years, byQuarter }: { years: QuarterlyYear[]; byQuarter: Map<number, QuarterReport> }) {
  const [comparison, setComparison] = useState<keyof typeof quarterComparisons>("yoy");
  const offset = comparison === "yoy" ? 4 : 1;
  const reports = years.slice().reverse().flatMap((year) => year.reports);
  const periods = reports.map((report) => ({
    label: report.year + "년 " + report.quarter + "분기",
    axisLabel: report.quarter + "Q",
    group: report.year,
    report,
    previous: byQuarter.get(quarterIndex(report) - offset),
  }));
  const controls = <div className="chart-comparison" role="group" aria-label="분기 증감률 비교 기준">
    {(Object.keys(quarterComparisons) as (keyof typeof quarterComparisons)[]).map((key) =>
      <button key={key} type="button" aria-pressed={comparison === key} onClick={() => setComparison(key)}>
        {quarterComparisons[key]}
      </button>)}
  </div>;
  return <GrowthChart periods={periods} title="분기 증감률" subtitle={quarterComparisons[comparison] + " · %"}
    controls={controls} note="(해당 분기 금액 − 비교 분기 금액) ÷ |비교 분기 금액| × 100. 자료가 없거나, 비교 금액이 0이거나, 통화·연결 기준이 다르면 비워둡니다."/>;
}

type ReportColumn = {
  label: string;
  filing: string;
  report: AnnualReport;
  calculated?: boolean;
  priorYear?: QuarterReport | null;
};

function currencyLabel(reports: AnnualReport[], period: string) {
  const currencies = new Set(reports.flatMap(({ currency }) => currency ? [currency] : []));
  if (currencies.size === 0) return "";
  if (currencies.size > 1) return "단위 " + period + "별 표시";
  return "단위 " + unit([...currencies][0]);
}

function ReportTable({ columns, label }: { columns: ReportColumn[]; label: string }) {
  const mixedCurrencies = new Set(columns.flatMap(({ report }) => report.currency ? [report.currency] : [])).size > 1;
  return <div className="table-scroll" tabIndex={0} aria-label={label}>
    <table>
      <thead><tr><th scope="col">구분</th>{columns.map(({ label, filing, report, calculated }) =>
        <th scope="col" key={label}>
          {report.receipt ? <a href={"https://dart.fss.or.kr/dsaf001/main.do?rcpNo=" + report.receipt}
            target="_blank" rel="noreferrer" title={filing}>{label}<Icon name="external" size={12}/></a> : label}
          <small>{report.basis ? basisName[report.basis] : "자료 없음"}
            {calculated && report.basis ? " · 산출" : ""}
            {mixedCurrencies && report.currency ? " · " + unit(report.currency) : ""}</small>
        </th>)}</tr></thead>
      <tbody>{metrics.map(({ key, label, color }) => <tr key={key}>
        <th scope="row"><i className="dot" style={{ background: color }}/>{label}</th>
        {columns.map(({ label, report, priorYear }) => {
          const value = report.amounts[key] ?? null;
          const change = changePercent(report, priorYear ?? undefined, key);
          return <td key={label} title={value === null ? "자료 없음" : exactFigures.format(BigInt(value)) + " " + (report.currency ?? "")}>
            <span className={priorYear === undefined ? undefined : "quarter-amount"}>
              <span>{money(value, report.currency)}</span>
              {priorYear !== undefined && value !== null && <span
                className={"quarter-change " + (change === null || change === 0 ? "flat" : change > 0 ? "up" : "down")}
                title={quarterComparisons.yoy + " " + (change === null ? "비교 불가" : percentage(change))}>
                {change === null ? "—" : percentage(change)}
              </span>}
            </span>
          </td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}

function FinancialTable({ reports }: { reports: AnnualReport[] }) {
  return <section className="panel table-panel annual-panel" aria-labelledby="table-title">
    <div className="panel-head">
      <div className="panel-heading"><span className="panel-icon"><Icon name="table"/></span>
        <div><h3 id="table-title">연간 재무제표</h3><p>사업연도별 주요 계정</p></div>
      </div>
      <span className="unit">{currencyLabel(reports, "연도")}</span>
    </div>
    <ReportTable label="연간 재무제표 표" columns={reports.map((report) => ({
      label: String(report.year), filing: report.year + "년 DART 사업보고서", report,
    }))}/>
    <p className="chart-note"><Icon name="info" size={14}/> 순이익은 당기순이익입니다. 지배주주 순이익은 연결재무제표 기준으로 표시합니다.</p>
  </section>;
}

async function requestQuarters(corpCode: string, year: number | undefined, signal: AbortSignal) {
  const params: Record<string, string> = { corp: corpCode, period: "quarterly" };
  if (year !== undefined) params.year = String(year);
  return request<QuarterlyFinancials>(params, signal);
}

function QuarterlyTable({ company, data, setData }: {
  company: Company;
  data: QuarterlyFinancials | null;
  setData: Dispatch<SetStateAction<QuarterlyFinancials | null>>;
}) {
  const { corpCode, closingMonth } = company;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [baseline, setBaseline] = useState<QuarterlyYear>();
  const active = useRef<AbortController | null>(null);
  const comparisonRequest = useRef<{ year: number; result: Promise<QuarterlyFinancials> } | null>(null);

  const load = useCallback(async (year?: number) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError("");
    try {
      const prefetched = comparisonRequest.current;
      const fetchYear = () => requestQuarters(corpCode, year, controller.signal);
      const result = prefetched && prefetched.year === year
        ? await prefetched.result.catch(fetchYear)
        : await fetchYear();
      if (!controller.signal.aborted) {
        setData((current) => year === undefined || !current ? result : {
          years: [...current.years, ...result.years],
          nextYear: result.nextYear,
        });
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "분기 재무제표 조회 중 오류가 발생했습니다.");
    } finally {
      if (active.current === controller && !controller.signal.aborted) {
        active.current = null;
        setLoading(false);
      }
    }
  }, [corpCode, setData]);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [corpCode, load]);

  const nextYear = data?.nextYear;
  useEffect(() => {
    if (nextYear == null) return;
    const controller = new AbortController();
    const result = requestQuarters(corpCode, nextYear, controller.signal);
    comparisonRequest.current = { year: nextYear, result };
    void result.then(({ years }) => {
      if (!controller.signal.aborted) setBaseline(years[0]);
    }, () => {
      // The visible quarterly data still supports comparisons between its own periods.
    });
    return () => {
      controller.abort();
      comparisonRequest.current = null;
    };
  }, [corpCode, nextYear]);

  const olderReports = baseline && baseline.year === nextYear ? baseline.reports : [];
  const byQuarter = new Map([...olderReports, ...(data?.years.flatMap(({ reports }) => reports) ?? [])]
    .map((report) => [quarterIndex(report), report]));
  return <>
    {data && <QuarterlyGrowthChart years={data.years} byQuarter={byQuarter}/>}
    <section className="panel table-panel quarterly-panel" aria-labelledby="quarterly-title">
      <div className="panel-head">
        <div className="panel-heading"><span className="panel-icon"><Icon name="table"/></span>
          <div><h3 id="quarterly-title">분기 재무제표</h3><p>각 분기의 3개월 실적 · 전년 동분기 대비 증감률 · {closingMonth}월 결산</p></div>
        </div>
      </div>
      <div aria-busy={loading}>
        {data?.years.map(({ year, reports }) => <div className="quarter-year" key={year}>
          <div className="quarter-year-head">
            <h4>{year} 사업연도</h4><span className="unit">{currencyLabel(reports, "분기")}</span>
          </div>
          <ReportTable label={year + "년 분기 재무제표 표"} columns={reports.map((report) => ({
            label: report.quarter + "분기",
            filing: year + " 사업연도 DART " + ({ 1: "1분기보고서", 2: "반기보고서", 3: "3분기보고서", 4: "사업보고서" })[report.quarter],
            report,
            calculated: report.quarter === 4,
            priorYear: byQuarter.get(quarterIndex(report) - 4) ?? null,
          }))}/>
        </div>)}
      </div>
      {loading && <p className="quarter-loading" role="status"><span className="spinner"/> 분기 실적을 불러오고 있습니다.</p>}
      {error && <p className="quarter-error" role="alert">{error}</p>}
      {(typeof nextYear === "number" || (!data && error)) && <div className="quarter-actions">
        <button type="button" className="expand-button" disabled={loading} onClick={() => void load(nextYear ?? undefined)}>
          <Icon name="plus" size={16}/>{typeof nextYear === "number" ? nextYear + "년 확장" : "다시 조회"}
        </button>
      </div>}
      {data && <p className="chart-note"><Icon name="info" size={14}/> 4분기는 같은 재무제표 기준과 통화의 연간 실적에서 3분기 누적 실적을 빼서 표시합니다.</p>}
    </section>
  </>;
}

function companyHref(corpCode: string, view?: string) {
  const params = new URLSearchParams({ corp: corpCode });
  if (view) params.set("view", view);
  return "/?" + params;
}

function CompanyIdentity({ company }: { company: Company }) {
  return <span className="company-ident">
    <span className="company-mark" aria-hidden="true">{company.name.slice(0, 2)}</span>
    <span className="company-label"><strong>{company.name}</strong>
      <small><span className="market-badge">{company.market}</span> {company.stockCode}</small>
    </span>
  </span>;
}

function FinancialSearchPage() {
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<Company[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const search = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request<{ configured: boolean }>({ status: "1" }, controller.signal)
      .then((result) => setConfigured(result.configured)).catch(() => {});
    return () => { controller.abort(); search.current?.abort(); };
  }, []);

  async function run(term: string) {
    search.current?.abort();
    const controller = new AbortController();
    search.current = controller;
    setQuery(term);
    setError("");
    setChoices([]);
    setLoading(true);
    try {
      const { companies } = await request<{ companies: Company[] }>({ q: term }, controller.signal);
      if (controller.signal.aborted) return;
      if (!companies.length) throw new Error("검색 결과가 없습니다. 회사명이나 종목코드를 확인해 주세요.");
      if (companies.length === 1) window.location.assign(companyHref(companies[0].corpCode));
      else setChoices(companies);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "기업 검색 중 오류가 발생했습니다.");
    } finally {
      if (search.current === controller) {
        search.current = null;
        setLoading(false);
      }
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim()) void run(query.trim());
  }

  return <>
    <section className="hero" aria-labelledby="page-title">
      <HeroChart/>
      <div className="hero-content">
        <div className="eyebrow"><span className="dot"/> KOSPI · KOSDAQ</div>
        <h1 id="page-title">재무검색</h1>
        <p>기업을 검색해 재무와 주가 흐름을 확인하고, 관심종목에 등록하세요.</p>
        <form className="search" onSubmit={submit} role="search">
          <Icon name="search" size={21}/>
          <input type="search" value={query} maxLength={60} onChange={(event) => setQuery(event.target.value)}
            aria-label="기업명 또는 종목코드" placeholder="기업명 또는 종목코드 입력" required/>
          <button type="submit" disabled={loading}>{loading ? "검색 중…" : "검색"}{!loading && <Icon name="arrow" size={16}/>}</button>
        </form>
        <div className="suggestions"><span>검색 예시</span>
          {["삼성전자", "SK하이닉스", "에코프로"].map((name) => <button type="button" key={name} disabled={loading}
            onClick={() => void run(name)}>{name}</button>)}
        </div>
      </div>
    </section>
    {configured === false && <p className="notice"><Icon name="info" size={17}/> OpenDART 신규 조회에는 인증키 설정이 필요합니다.</p>}
    {error && <p className="notice error" role="alert"><Icon name="info" size={17}/> {error}</p>}
    {choices.length > 0 && <section className="panel results" aria-labelledby="search-results-title">
      <h2 id="search-results-title">검색 결과</h2><p>상세 화면에서 관심종목을 등록할 수 있습니다.</p>
      <ul>{choices.map((company) => <li key={company.corpCode}>
        <a className="company-row" href={companyHref(company.corpCode)}><CompanyIdentity company={company}/><Icon name="arrow"/></a>
      </li>)}</ul>
    </section>}
  </>;
}

function WatchlistPage() {
  const [saved, setSaved] = useState<Company[] | null>(null);
  const [watchError, setWatchError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let controller: AbortController;
    function refresh() {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      setWatchError("");
      requestJson<{ companies: Company[] }>("/api/watchlist", { signal }).then(
        ({ companies }) => { if (!signal.aborted) setSaved(companies); },
        () => { if (!signal.aborted) setWatchError("관심종목 목록을 불러오지 못했습니다."); },
      );
    }
    function restore(event: PageTransitionEvent) { if (event.persisted) refresh(); }
    refresh();
    window.addEventListener("pageshow", restore);
    return () => { controller.abort(); window.removeEventListener("pageshow", restore); };
  }, [attempt]);

  async function remove(company: Company) {
    if (removing) return;
    setRemoving(company.corpCode); setActionError(""); setNotice("");
    try {
      await requestJson("/api/watchlist?" + new URLSearchParams({ corp: company.corpCode }), { method: "DELETE" });
      setSaved(current => current?.filter(item => item.corpCode !== company.corpCode) ?? null);
      setNotice(company.name + " 관심종목 등록을 해제했습니다.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "관심종목을 해제하지 못했습니다.");
    } finally { setRemoving(null); }
  }

  return <>
    <section className="hero watchlist-hero" aria-labelledby="watchlist-page-title">
      <div className="eyebrow"><span className="dot"/> MY WATCHLIST</div>
      <h1 id="watchlist-page-title">관심종목</h1>
      <p>등록한 기업의 재무와 차트를 확인하고, 관심종목을 관리하세요.</p>
      <a href="/" className="watch-button watchlist-add-link"><Icon name="plus" size={16}/> 기업 검색·추가</a>
    </section>
    <section className="panel watchlist" aria-labelledby="watchlist-title">
      <div className="watchlist-head">
        <span className="panel-icon"><Icon name="star"/></span>
        <h2 id="watchlist-title">내 관심종목</h2>
        {saved && <span className="watch-count">{saved.length}개</span>}
      </div>
      {watchError ? <div className="watchlist-empty">
        <p role="alert">{watchError}</p><button className="expand-button" onClick={() => setAttempt(value => value + 1)}>다시 조회</button>
      </div> : !saved ? <p className="loading watchlist-loading" role="status"><span className="spinner"/> 관심종목을 불러오는 중…</p>
        : saved.length === 0 ? <div className="watchlist-empty">
          <span className="empty-star"><Icon name="star" size={23}/></span>
          <strong>등록된 관심종목이 없습니다</strong>
          <p>재무검색에서 기업을 찾은 뒤 상세 화면에서 관심종목을 등록하세요.</p>
          <a href="/" className="watch-button">재무검색으로 이동</a>
        </div> : <ul className="watchlist-items">{saved.map((company) => <li key={company.corpCode} className="watchlist-item">
          <a className="company-row" href={companyHref(company.corpCode)}><CompanyIdentity company={company}/><Icon name="arrow"/></a>
          <a className="watch-chart-link" href={companyHref(company.corpCode, "chart")} aria-label={company.name + " 주가 차트"}><Icon name="chart" size={17}/><span>차트</span></a>
          <button type="button" className="watch-remove-button" disabled={Boolean(removing)}
            aria-label={company.name + " 관심종목 해제"} onClick={() => void remove(company)}>
            {removing === company.corpCode ? "해제 중…" : "해제"}
          </button>
        </li>)}</ul>}
      {actionError && <p className="notice error" role="alert">{actionError}</p>}
      {notice && <p className="watchlist-action-notice" role="status">{notice}</p>}
    </section>
  </>;
}

function WatchlistButton({ corpCode }: { corpCode: string }) {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ companies: Company[] }>("/api/watchlist", { signal: controller.signal }).then(
      ({ companies }) => { if (!controller.signal.aborted) setSaved(companies.some((item) => item.corpCode === corpCode)); },
      () => { if (!controller.signal.aborted) setError("관심종목 등록 상태를 확인하지 못했습니다."); },
    );
    return () => controller.abort();
  }, [corpCode, attempt]);

  async function toggle() {
    setError("");
    if (saved === null) {
      setAttempt(attempt + 1);
      return;
    }
    setBusy(true);
    try {
      const result = await requestJson<{ saved: boolean }>("/api/watchlist?" + new URLSearchParams({ corp: corpCode }),
        { method: saved ? "DELETE" : "PUT" });
      setSaved(result.saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "관심종목을 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="watch-control">
    <button type="button" className={"watch-button" + (saved ? " is-saved" : "")}
      disabled={busy || (saved === null && !error)} onClick={() => void toggle()}>
      <Icon name="star" size={17}/>{busy ? "저장 중…" : saved ? "관심종목 해제" :
        saved === false ? "관심종목 등록" : error ? "등록 상태 다시 확인" : "등록 상태 확인 중…"}
    </button>
    {error && <p className="watch-error" role="alert">{error}</p>}
  </div>;
}

function CompanyFinancials({ company }: { company: Company }) {
  const [data, setData] = useState<Financials | null>(null);
  const [quarters, setQuarters] = useState<QuarterlyFinancials | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    request<Financials>({ corp: company.corpCode }, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setData(result); },
      (caught) => { if (!controller.signal.aborted) setError(caught.message); },
    );
    return () => controller.abort();
  }, [company.corpCode, attempt]);

  const reports = data?.reports;
  const latest = reports?.[reports.length - 1];
  return <section className="financials" aria-label="기업 재무">
    {error ? <div className="notice error" role="alert">
      <Icon name="info" size={17}/><span>{error}</span>
      <button className="expand-button" onClick={() => { setError(""); setAttempt(attempt + 1); }}>다시 조회</button>
    </div> : !data || !reports || !latest ? <p className="loading" role="status"><span className="spinner"/> 연간 실적을 불러오는 중…</p> : <>
      <div className="financials-meta">
        <span>{reports[0].year}–{latest.year} 사업연도</span>
        <span className="source-badge"><Icon name="database" size={15}/>{data.source === "DB" ? "DB 저장본" : "OpenDART 조회"}</span>
      </div>
      <div className="kpis">
        {metrics.map(({ key, label, color, light }) => {
          const change = growth(reports, reports.length - 1, key);
          return <article className="kpi" key={key}>
            <div className="kpi-heading"><span className="kpi-icon" style={{ color, background: light }}><Icon name={key} size={17}/></span>
              <h3>{label}</h3><span className="kpi-year">{latest.year}</span></div>
            <div className="kpi-amount">{money(latest.amounts[key] ?? null, latest.currency)}{latest.amounts[key] != null && <span>{unit(latest.currency)}</span>}</div>
            <div className="kpi-change">
              <span className={change === null ? "flat" : change < 0 ? "down" : change > 0 ? "up" : "flat"}>
                {change === null ? "—" : percentage(change)}
              </span><small>전년 대비</small>
            </div>
          </article>;
        })}
      </div>
      <ValuationPanel company={company} annual={latest} quarters={quarters}/>
      <AnnualGrowthChart reports={reports}/>
      <FinancialTable reports={reports}/>
    </>}
    {(data || error) && <QuarterlyTable company={company} data={quarters} setData={setQuarters}/>}
  </section>;
}

const companyViews = [
  { key: "financials", label: "기업 재무", icon: "table", content: CompanyFinancials },
  { key: "chart", label: "주가 차트", icon: "chart", content: CompanyPriceChart },
  { key: "research", label: "기업 리서치", icon: "research", content: CompanyResearch },
] as const;

function CompanyDetail({ corpCode, view }: { corpCode: string; view?: string }) {
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    request<Company>({ corp: corpCode, profile: "1" }, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setCompany(result); },
      (caught) => { if (!controller.signal.aborted) setError(caught.message); },
    );
    return () => controller.abort();
  }, [corpCode]);

  const selected = companyViews.find((item) => item.key === view) ?? companyViews[0];
  const Content = selected.content;
  return <>
    <div className="detail-backlinks">
      <a className="back-link" href="/"><Icon name="back" size={16}/> 재무검색</a>
      <a className="back-link" href="/?section=watchlist"><Icon name="star" size={16}/> 관심종목 목록</a>
    </div>
    {error ? <p className="notice error" role="alert"><Icon name="info" size={17}/> {error}</p>
      : !company ? <p className="loading" role="status"><span className="spinner"/> 기업 정보를 불러오는 중…</p> : <>
        <section className="panel company-detail" aria-labelledby="company-name">
          <div className="company-head">
            <div className="company-ident">
              <span className="company-mark" aria-hidden="true">{company.name.slice(0, 2)}</span>
              <div><h1 id="company-name">{company.name}</h1>
                <p><span className="market-badge">{company.market}</span> {company.stockCode}</p>
              </div>
            </div>
            <WatchlistButton corpCode={corpCode}/>
          </div>
          <nav className="company-tabs" aria-label="기업 상세 메뉴">
            {companyViews.map((item) => <a href={companyHref(corpCode, item.key)} key={item.key}
              aria-current={item.key === selected.key ? "page" : undefined}><Icon name={item.icon} size={17}/>{item.label}</a>)}
          </nav>
        </section>
        <Content company={company}/>
      </>}
  </>;
}

export default function Dashboard({ corpCode, view, section }: { corpCode?: string; view?: string; section?: string }) {
  const giants = section === "giants";
  const research = section === "research";
  const watchlist = section === "watchlist";
  return <>
    <header className="site-header">
      <div className="shell topbar">
        <a className="brand" href="/" aria-label="스탁인사이트 홈"><img src="/favicon.svg" width="37" height="37" alt=""/><span>스탁인사이트</span></a>
        <span className="header-divider"/>
        <span className="header-caption">기업 재무 리서치</span>
        <div className="header-meta"><span className="market-badge">KOSPI</span><span className="market-badge">KOSDAQ</span></div>
      </div>
      <nav className="shell main-nav" aria-label="메인 메뉴">
        <a href="/" aria-current={!giants && !research && !watchlist ? "page" : undefined}><Icon name="search" size={16}/> 재무검색</a>
        <a href="/?section=giants" aria-current={giants ? "page" : undefined}><Icon name="table" size={16}/> 거인의 어깨</a>
        <a href="/?section=research" aria-current={research ? "page" : undefined}><Icon name="research" size={16}/> 기업 리서치</a>
        <a href="/?section=watchlist" aria-current={watchlist ? "page" : undefined}><Icon name="star" size={16}/> 관심종목</a>
      </nav>
    </header>
    <main className="shell">
      {research ? <CompanyResearch/> : giants ? <GiantsPage/> : watchlist ? <WatchlistPage/>
        : corpCode ? <CompanyDetail key={corpCode} corpCode={corpCode} view={view}/> : <FinancialSearchPage/>}
    </main>
    <footer className="shell footer">
      <span>스탁인사이트 <span className="footer-version">로컬 v1.1</span></span>
      <a href="https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS003&apiId=2019020" target="_blank" rel="noreferrer">금융감독원 OpenDART <Icon name="external" size={14}/></a>
    </footer>
  </>;
}
