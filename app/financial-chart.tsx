import { useId, useState } from "react";
import { metrics } from "../lib/market";
import type { AnnualReport, Metric, QuarterReport, QuarterlyYear } from "../lib/market";
import { annualPeriods, chartAmount, chartChange, chartNumber, chartPercentage, financialScale, quarterlyPeriods } from "../lib/financial-chart";
import type { FinancialChartMode, FinancialComparison, FinancialPeriod } from "../lib/financial-chart";
import "./financial-chart.css";

const comparisons = { yoy: "전년 동분기 대비", qoq: "직전 분기 대비" } as const;
const basisNames = { CFS: "연결", OFS: "별도" };

function TrendPlot({ periods, selected, onSelect, metricKeys, title, mode, comparison, currency, quarterly }: {
  periods: FinancialPeriod[]; selected: FinancialPeriod | undefined; onSelect: (label: string) => void;
  metricKeys: Metric[]; title: string; mode: FinancialChartMode; comparison: FinancialComparison; currency: string; quarterly: boolean;
}) {
  const titleId = useId();
  const items = metrics.filter(metric => metricKeys.includes(metric.key));
  const series = items.map(metric => ({ ...metric, values: periods.map(period => mode === "amount"
    ? chartAmount(period.report, metric.key, currency)
    : period.report.currency === currency ? chartChange(period, metric.key, comparison) : null) }));
  const values = series.flatMap(item => item.values);
  const { ticks, y } = financialScale(values);
  const hasData = values.some(value => value !== null);
  const unit = currency === "KRW" ? "억 원" : currency;
  const compareLabel = quarterly ? comparisons[comparison] : "전년 대비";
  const yoyLabel = quarterly ? comparisons.yoy : "전년 대비";
  const groups = [...new Set(periods.flatMap(period => period.group === undefined ? [] : [period.group]))];
  const x = (i: number) => (i + .5) / periods.length * 1000;
  const slot = 1000 / Math.max(1, periods.length);
  const barWidth = slot * .66 / series.length;

  function periodDescription(period: FinancialPeriod) {
    return period.label + ", " + items.map(metric => {
      const amount = chartAmount(period.report, metric.key, currency);
      return metric.label + " " + (amount === null ? "자료 없음" : chartNumber(amount) + " " + unit) + ", "
        + yoyLabel + " " + chartPercentage(amount === null ? null : chartChange(period, metric.key, "yoy"))
        + (quarterly && mode === "growth" && comparison === "qoq" ? ", 직전 분기 대비 " + chartPercentage(amount === null ? null : chartChange(period, metric.key, "qoq")) : "");
    }).join(", ");
  }

  return <section className="financial-trend" aria-labelledby={titleId}>
    <div className="financial-trend-heading"><h4 id={titleId}>{title}</h4><span>{mode === "amount" ? "단위 " + unit : compareLabel + " · %"}</span></div>
    {!hasData ? <p className="empty-chart">{mode === "amount" ? "표시할 금액 자료가 없습니다." : "선택한 기준으로 비교할 수 있는 자료가 없습니다."}</p> : <div className="financial-plot-scroll">
      <div className="financial-plot-grid" style={{ minWidth: 60 + periods.length * (quarterly ? 54 : 46) }}>
        <div className="financial-y-axis" aria-hidden="true">{ticks.map(tick => <span key={tick} style={{ top: y(tick) / 2.2 + "%" }}>{chartNumber(tick, true)}{mode === "growth" ? "%" : ""}</span>)}</div>
        <div>
          <div className="financial-plot">
            <svg viewBox="0 0 1000 220" preserveAspectRatio="none" role="img" aria-label={title + (mode === "amount" ? " 금액 추이 · " + unit : " 증감률 추이 · " + compareLabel)}>
              {selected && <rect x={x(periods.indexOf(selected)) - slot / 2} y="4" width={slot} height="210" fill="#f1f7f3"/>}
              {ticks.map(tick => <line key={tick} x1="0" x2="1000" y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "#79978a" : "#e8eeeb"} strokeWidth={tick === 0 ? 1.4 : 1} vectorEffect="non-scaling-stroke"/>)}
              {mode === "amount" ? series.flatMap((metric, seriesIndex) => metric.values.map((value, i) => value === null ? null : <rect key={metric.key + i}
                x={x(i) - slot * .33 + seriesIndex * barWidth + barWidth * .08} width={barWidth * .84}
                y={Math.min(y(0), y(value))} height={Math.abs(y(value) - y(0))} rx="2" fill={metric.color} opacity={selected === periods[i] ? 1 : .75}/>))
                : series.map(metric => <g key={metric.key}>
                  <path d={metric.values.map((value, i) => value === null ? "" : (i === 0 || metric.values[i - 1] === null ? "M" : "L") + x(i) + "," + y(value)).join(" ")}
                    fill="none" stroke={metric.color} strokeWidth="2.3" vectorEffect="non-scaling-stroke"/>
                  {metric.values.map((value, i) => value === null ? null : <circle key={i} cx={x(i)} cy={y(value)} r="3" fill={metric.color}/>)}
                </g>)}
            </svg>
            <div className="financial-targets">{periods.map(period => <button type="button" key={period.label} aria-label={periodDescription(period)} disabled={Boolean(period.report.currency && period.report.currency !== currency)}
              aria-pressed={selected === period} onClick={() => onSelect(period.label)} onFocus={() => onSelect(period.label)}
              onPointerEnter={event => { if (event.pointerType === "mouse") onSelect(period.label); }}/>)}</div>
          </div>
          <div className="financial-x-axis" aria-hidden="true">{periods.map(period => <span key={period.label}>{period.axisLabel}</span>)}</div>
          {groups.length > 0 && <div className="financial-year-axis" aria-hidden="true">{groups.map(group => <span key={group} style={{ flex: periods.filter(period => period.group === group).length }}>{group}년</span>)}</div>}
        </div>
      </div>
    </div>}
    {selected && <div className="financial-selection" aria-label={title + " 선택 실적"}>
      <div className="financial-selection-heading"><strong>{selected.label}</strong><span>{selected.report.basis ? basisNames[selected.report.basis] : "자료 없음"} · {unit || "통화 미확인"}</span></div>
      <div className="financial-value-heading"><span>항목</span><span>금액</span><span>{yoyLabel}</span></div>
      {items.map(metric => {
        const amount = chartAmount(selected.report, metric.key, currency);
        const yoy = amount === null ? null : chartChange(selected, metric.key, "yoy");
        return <div className="financial-value-row" key={metric.key}>
          <span><i className="dot" style={{ background: metric.color }}/>{metric.label}</span>
          <strong title={amount === null ? undefined : new Intl.NumberFormat("ko-KR").format(BigInt(selected.report.amounts[metric.key]!)) + " " + currency}>{amount === null ? "—" : chartNumber(amount)}</strong>
          <span className={yoy === null ? "flat" : yoy < 0 ? "down" : yoy > 0 ? "up" : "flat"}>{chartPercentage(yoy)}</span>
        </div>;
      })}
      {quarterly && mode === "growth" && comparison === "qoq" && <p className="financial-qoq-detail">직전 분기 대비 · {items.map(metric => metric.label + " " + chartPercentage(chartChange(selected, metric.key, "qoq"))).join(" / ")}</p>}
    </div>}
  </section>;
}

export function FinancialTrendChart({ periods, quarterly = false }: { periods: FinancialPeriod[]; quarterly?: boolean }) {
  const titleId = useId();
  const [mode, setMode] = useState<FinancialChartMode>("amount");
  const [comparison, setComparison] = useState<FinancialComparison>("yoy");
  const [profit, setProfit] = useState<Metric | "all">("all");
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const currencies = [...new Set(periods.flatMap(({ report }) => report.currency ? [report.currency] : []))];
  const currency = selectedCurrency && currencies.includes(selectedCurrency) ? selectedCurrency : currencies[currencies.length - 1] ?? "";
  const activePeriods = periods.filter(period => period.report.currency === currency);
  const selected = periods.find(period => period.label === selectedLabel && (!period.report.currency || period.report.currency === currency)) ?? activePeriods[activePeriods.length - 1];
  const profits = metrics.filter(metric => metric.key !== "revenue");
  const keys = profits.filter(metric => profit === "all" || metric.key === profit).map(metric => metric.key);
  const props = { periods, selected, onSelect: setSelectedLabel, mode, comparison, currency, quarterly };

  return <section className="panel chart-panel financial-chart-panel" aria-labelledby={titleId}>
    <div className="panel-head"><div className="panel-heading"><div><h3 id={titleId}>{quarterly ? "분기 실적 추이" : "연간 실적 추이"}</h3>
      <p>{quarterly ? "각 분기의 3개월 실적" : "사업연도별 실적"} · {mode === "amount" ? "금액" : "증감률"}</p></div></div>
      <div className="chart-comparison financial-mode" role="group" aria-label={(quarterly ? "분기" : "연간") + " 차트 표시 방식"}>
        <button type="button" aria-pressed={mode === "amount"} onClick={() => setMode("amount")}>금액</button>
        <button type="button" aria-pressed={mode === "growth"} onClick={() => setMode("growth")}>증감률</button>
      </div>
    </div>
    <div className="financial-chart-filters">
      {currencies.length > 1 && <label>표시 통화 <select value={currency} onChange={event => setSelectedCurrency(event.target.value)}>{currencies.map(item => <option key={item}>{item}</option>)}</select></label>}
      {quarterly && mode === "growth" && <div className="chart-comparison" role="group" aria-label="분기 증감률 비교 기준">{(Object.keys(comparisons) as FinancialComparison[]).map(key =>
        <button type="button" key={key} aria-pressed={comparison === key} onClick={() => setComparison(key)}>{comparisons[key]}</button>)}</div>}
    </div>
    <TrendPlot {...props} title="매출액" metricKeys={["revenue"]}/>
    <div className="financial-profit-options" role="group" aria-label={(quarterly ? "분기" : "연간") + " 이익 차트 항목"}>
      <button type="button" aria-pressed={profit === "all"} onClick={() => setProfit("all")}>이익 전체</button>
      {profits.map(metric => <button type="button" key={metric.key} aria-pressed={profit === metric.key} onClick={() => setProfit(metric.key)}><i className="dot" style={{ background: metric.color }}/>{metric.label}</button>)}
    </div>
    <TrendPlot {...props} title="이익" metricKeys={keys}/>
    <p className="chart-note">{mode === "amount" ? "매출과 이익은 각각의 금액 축으로 표시합니다. 적자는 0선 아래로 표시하며, 빈 구간은 자료 없음입니다."
      : "(현재 금액 − 비교 금액) ÷ |비교 금액| × 100. 비교 금액이 0이거나, 자료·통화·연결 기준이 다르면 비교 불가로 표시합니다."}
      {" "}그래프를 누르면 선택한 기간의 금액과 {quarterly ? "전년 동분기" : "전년"} 대비 증감률을 함께 볼 수 있습니다.</p>
  </section>;
}

export function AnnualFinancialChart({ reports }: { reports: AnnualReport[] }) {
  return <FinancialTrendChart periods={annualPeriods(reports)}/>;
}
export function QuarterlyFinancialChart({ years, byQuarter }: { years: QuarterlyYear[]; byQuarter: Map<number, QuarterReport> }) {
  return <FinancialTrendChart periods={quarterlyPeriods(years, byQuarter)} quarterly/>;
}
