"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AutoscaleInfo, IChartApi, ISeriesApi } from "lightweight-charts";
import type { Company } from "../lib/market";
import { requestJson } from "../lib/client-api";
import { aggregateCandles, movingAverage, previousSwing } from "../lib/price-data";
import type { Candle, PriceHistory, PricePeriod } from "../lib/price-data";
import { averageStorageKey, defaultAverages, maxAverageLines, readAverageSettings } from "../lib/chart-preferences";
import type { CloseAverage } from "../lib/chart-preferences";
import AverageSettings from "./average-settings";

const periods = { day: "일봉", week: "주봉", month: "월봉" } as const;
const units = { day: "일", week: "주", month: "개월" };
const ranges = [{ months: 3, label: "3개월" }, { months: 6, label: "6개월" }, { months: 12, label: "1년" }, { months: 36, label: "3년" }, { months: 60, label: "5년" }];
const figures = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const percentages = new Intl.NumberFormat("ko-KR", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
const red = "#cd4949", blue = "#3677c4";
const swingKinds = [
  { field: "low", label: "저점", color: "#345c85", comparison: "낮은 저가" },
  { field: "high", label: "고점", color: "#9b4637", comparison: "높은 고가" },
] as const;
type SwingLevel = (typeof swingKinds)[number] & { pivot: { price: number; time: string } | null };

function updateAverageSeries(lines: ISeriesApi<"Line">[], candles: Candle[], settings: CloseAverage[]) {
  for (let index = 0; index < lines.length; index++) {
    const setting = settings[index];
    lines[index].applyOptions({ color: setting?.color ?? "#53655d", visible: Boolean(setting?.visible && candles.length >= setting.period) });
    lines[index].setData(setting ? movingAverage(candles, setting.period) : []);
  }
}

function selectRange(chart: IChartApi, candles: Candle[], months: number) {
  if (!candles.length) return;
  if (months === 60) { chart.timeScale().fitContent(); return; }
  const cutoff = new Date(candles[candles.length - 1].time + "T00:00:00Z");
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const from = Math.max(0, candles.findIndex(candle => candle.time >= cutoff.toISOString().slice(0, 10)));
  chart.timeScale().setVisibleLogicalRange({ from, to: candles.length + 2 });
}

function PriceCanvas({ candles, swingLevels, months, rangeRevision, averages, onHover, onManualRange, onPresetRange }: {
  candles: Candle[]; swingLevels: SwingLevel[]; months: number; rangeRevision: number; averages: CloseAverage[]; onHover: (candle: Candle | null) => void;
  onManualRange: () => void; onPresetRange: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const lines = useRef<ISeriesApi<"Line">[]>([]);
  const currentMonths = useRef(months);
  const currentAverages = useRef(averages);
  currentMonths.current = months;
  currentAverages.current = averages;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let created: IChartApi | null = null;
    setReady(false);
    setError("");
    onHover(null);
    void import("lightweight-charts").then(({ createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode, LineStyle }) => {
      if (disposed || !container.current) return;
      created = createChart(container.current, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#53655d", fontFamily: "-apple-system, sans-serif", fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: "#f2f5f3" }, horzLines: { color: "#edf2ef" } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: "#e2eae5", minimumWidth: 67, scaleMargins: { top: 0.08, bottom: 0.26 } },
        timeScale: { borderColor: "#e2eae5", rightOffset: 3, timeVisible: false, fixLeftEdge: true, lockVisibleTimeRangeOnResize: true },
        localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd" },
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      });
      chart.current = created;
      const prices: ISeriesApi<"Candlestick"> = created.addSeries(CandlestickSeries, {
        upColor: red, downColor: blue, wickUpColor: red, wickDownColor: blue, borderVisible: false,
        priceFormat: { type: "price", precision: 0, minMove: 1 },
      });
      prices.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      const levelPrices: number[] = [];
      for (const { label, color, pivot } of swingLevels) {
        if (!pivot) continue;
        levelPrices.push(pivot.price);
        prices.createPriceLine({ price: pivot.price, color, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `직전 ${label}` });
      }
      if (levelPrices.length) {
        prices.applyOptions({ autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
          const info = original();
          const range = created?.timeScale().getVisibleLogicalRange();
          if (!info?.priceRange || (range && range.to < candles.length - 1)) return info;
          return { ...info, priceRange: {
            minValue: Math.min(info.priceRange.minValue, ...levelPrices),
            maxValue: Math.max(info.priceRange.maxValue, ...levelPrices),
          } };
        } });
      }
      const volumes = created.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false,
      });
      volumes.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
      volumes.setData(candles.map(candle => ({ time: candle.time, value: candle.volume, color: candle.close >= candle.open ? "#cd494960" : "#3677c460" })));
      for (let index = 0; index < maxAverageLines; index++) {
        const line = created.addSeries(LineSeries, {
          lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, visible: false,
          priceFormat: { type: "price", precision: 0, minMove: 1 },
        });
        lines.current[index] = line;
      }
      updateAverageSeries(lines.current, candles, currentAverages.current);
      const byDate = new Map(candles.map(candle => [candle.time, candle]));
      created.subscribeCrosshairMove(event => {
        const time = event.time;
        const key = typeof time === "object" ? `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}` : String(time ?? "");
        onHover(byDate.get(key) ?? null);
      });
      selectRange(created, candles, currentMonths.current);
      setReady(true);
    }).catch(() => { if (!disposed) setError("차트를 표시하지 못했습니다. 페이지를 새로고침해 주세요."); });
    return () => { disposed = true; created?.remove(); chart.current = null; lines.current = []; };
  }, [candles, swingLevels, onHover]);

  useEffect(() => { if (chart.current) selectRange(chart.current, candles, months); }, [months, candles, rangeRevision]);
  useEffect(() => {
    updateAverageSeries(lines.current, candles, averages);
  }, [averages, candles]);

  function zoom(factor: number) {
    const current = chart.current?.timeScale().getVisibleLogicalRange();
    if (!current || !chart.current) return;
    const center = (current.from + current.to) / 2;
    const half = Math.max(5, Math.min(candles.length, (current.to - current.from) * factor)) / 2;
    chart.current.timeScale().setVisibleLogicalRange({ from: center - half, to: center + half });
    onManualRange();
  }

  return <>
    <div className="price-canvas-wrap" onWheel={onManualRange} onPointerMove={event => { if (event.buttons === 1) onManualRange(); }}>
      <div className="price-canvas" ref={container} role="img" aria-label="캔들·거래량·이동평균선 차트. 직전 저점은 파란 점선, 직전 고점은 붉은 점선으로 표시합니다."/>
      {!ready && <p className="price-canvas-status" role="status">{error || "차트를 그리는 중…"}</p>}
    </div>
    <div className="price-gesture">
      <span>좌우로 이동 · 휠 또는 두 손가락으로 확대</span>
      <div className="price-zoom" role="group" aria-label="차트 확대·축소">
        <button disabled={!ready} onClick={() => zoom(0.7)} aria-label="차트 확대">＋</button>
        <button disabled={!ready} onClick={() => zoom(1.4)} aria-label="차트 축소">−</button>
        <button disabled={!ready} onClick={() => { if (chart.current) selectRange(chart.current, candles, currentMonths.current); onPresetRange(); }}>보기 초기화</button>
      </div>
    </div>
  </>;
}

export default function CompanyPriceChart({ company }: { company: Company }) {
  const [data, setData] = useState<PriceHistory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const force = useRef(false);
  const [period, setPeriod] = useState<PricePeriod>("day");
  const [months, setMonths] = useState(6);
  const [rangeRevision, setRangeRevision] = useState(0);
  const [presetRange, setPresetRange] = useState(true);
  const manualRange = useCallback(() => setPresetRange(false), []);
  const resetRange = useCallback(() => setPresetRange(true), []);
  const [averages, setAverages] = useState<CloseAverage[]>(defaultAverages);
  const [editingAverages, setEditingAverages] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [hovered, setHovered] = useState<Candle | null>(null);
  const candles = useMemo(() => aggregateCandles(data?.candles ?? [], period), [data, period]);
  const swingLevels = useMemo(() => swingKinds.map(kind => {
    const candle = previousSwing(candles, kind.field);
    return { ...kind, pivot: candle ? { price: candle[kind.field], time: candle.time } : null };
  }), [candles]);
  const last = data?.candles[data.candles.length - 1];
  const previous = data?.candles[data.candles.length - 2];
  const change = last && previous ? last.close - previous.close : null;
  const selected = hovered ?? candles[candles.length - 1];

  useEffect(() => {
    try {
      const saved = readAverageSettings(localStorage.getItem(averageStorageKey));
      if (saved) setAverages(saved);
    } catch { setSettingsNotice("저장된 설정을 읽지 못해 기본값을 사용합니다."); }
  }, []);

  function saveAverages(next: CloseAverage[]) {
    setAverages(next);
    try { localStorage.setItem(averageStorageKey, JSON.stringify(next)); setSettingsNotice(""); }
    catch { setSettingsNotice("설정은 적용했지만 브라우저에 저장하지 못했습니다. 다음 방문에는 유지되지 않을 수 있습니다."); }
  }

  function closeAverageSettings() {
    setEditingAverages(false);
    settingsButton.current?.focus();
  }

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ corp: company.corpCode, chart: "1" });
    if (force.current) params.set("refresh", "1");
    force.current = false;
    setLoading(true);
    setError("");
    requestJson<PriceHistory>("/api/market?" + params, { signal: controller.signal }).then(
      result => { if (!controller.signal.aborted) setData(result); },
      caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "차트 자료를 불러오지 못했습니다."); },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [company.corpCode, attempt]);

  function reload() { force.current = true; setAttempt(value => value + 1); }

  return <section className="panel price-panel" aria-labelledby="price-title" aria-busy={loading}>
    <div className="panel-head">
      <div className="panel-heading"><div><h2 id="price-title">주가 차트</h2><p>KRX · 수정주가 · 원 / 주</p></div></div>
      <button type="button" className="expand-button" disabled={loading} onClick={reload}>{loading ? "조회 중…" : "최신 자료 조회"}</button>
    </div>
    {error && <div className="notice error" role="alert"><span>{error}</span></div>}
    {data?.stale && <div className="notice" role="status"><span>최신 조회에 실패해 저장된 차트를 표시합니다. {data.warning}</span></div>}
    {!data && loading && <p className="loading price-loading" role="status"><span className="spinner"/> 키움에서 주가 자료를 불러오는 중…</p>}
    {data && last && <>
      <div className="price-summary">
        <div><strong>{figures.format(last.close)}<small>원</small></strong>
          {change !== null && previous && <span className={change > 0 ? "price-rise" : change < 0 ? "price-fall" : ""}>
            {change > 0 ? "+" : ""}{figures.format(change)}원 ({change > 0 ? "+" : ""}{(change / previous.close * 100).toFixed(2)}%)
          </span>}
          <p>{last.time} 마지막 일봉 · 전 거래일 대비</p>
        </div>
        <span className="source-badge">{data.source === "DB" ? "DB 저장본" : "키움 API 조회"}{data.stale ? " · 갱신 필요" : ""}</span>
      </div>
      <div className="price-toolbar">
        <div className="chart-comparison" role="group" aria-label="봉 주기">
          {(Object.keys(periods) as PricePeriod[]).map(key => <button key={key} aria-pressed={period === key} onClick={() => {
            setPeriod(key); setMonths(key === "day" ? 6 : key === "week" ? 36 : 60); setHovered(null);
            setPresetRange(true); setRangeRevision(value => value + 1);
          }}>{periods[key]}</button>)}
        </div>
        <div className="price-ranges" role="group" aria-label="차트 표시 기간">
          {ranges.map(range => <button key={range.months} aria-pressed={presetRange && months === range.months} onClick={() => {
            setMonths(range.months); setPresetRange(true); setRangeRevision(value => value + 1);
          }}>{range.label}</button>)}
        </div>
      </div>
      <div className="price-averages" role="group" aria-label="이동평균선">
        <span>종가 이동평균</span>
        {averages.map((line, index) => <button key={index} aria-pressed={line.visible && candles.length >= line.period} disabled={editingAverages || candles.length < line.period}
          title={editingAverages ? "아래 설정에서 변경해 주세요" : candles.length < line.period ? line.period + "개 이상의 봉이 필요합니다" : undefined}
          onClick={() => saveAverages(averages.map((current, lineIndex) => lineIndex === index ? { ...current, visible: !current.visible } : current))}>
          <i style={{ background: line.color }}/>{line.period}{units[period]}</button>)}
        <button ref={settingsButton} className="average-config-button" aria-expanded={editingAverages} aria-controls="average-settings-container"
          onClick={() => setEditingAverages(current => !current)}>이동평균 설정</button>
      </div>
      {editingAverages && <div id="average-settings-container"><AverageSettings initial={averages} unit={units[period]}
        onApply={next => { saveAverages(next); closeAverageSettings(); }} onCancel={closeAverageSettings}/></div>}
      {settingsNotice && <p className="average-storage-notice" role="status">{settingsNotice}</p>}
      {swingLevels.map(({ field, label, comparison, color, pivot }) => {
        const changeFromPivot = pivot ? (last.close - pivot.price) / pivot.price : 0;
        return <div className="price-swing-row" aria-label={`직전 ${label} 비교`} key={field}>
          <span className="price-swing-label" style={{ color }} title={`앞뒤 봉보다 ${comparison}를 기록한 가장 최근 구간입니다.`}><i aria-hidden="true"/>직전 {label}</span>
          {pivot ? <>
            <strong>{figures.format(pivot.price)}원</strong>
            <time dateTime={pivot.time}>{period === "month" ? pivot.time.slice(0, 7) : pivot.time}{period === "week" ? " 주간" : ""}</time>
            <span className="price-swing-change">{label} 대비 <strong className={changeFromPivot > 0 ? "price-rise" : changeFromPivot < 0 ? "price-fall" : undefined}>{percentages.format(changeFromPivot)}</strong></span>
          </> : <span className="price-swing-empty">확인된 {label} 없음</span>}
        </div>;
      })}
      {selected && <div className="price-ohlcv" aria-label="선택한 봉의 가격과 거래량">
        <strong>{selected.time}</strong>
        <span>시가 <b>{figures.format(selected.open)}</b></span><span>고가 <b>{figures.format(selected.high)}</b></span>
        <span>저가 <b>{figures.format(selected.low)}</b></span><span>종가 <b>{figures.format(selected.close)}</b></span>
        <span>거래량 <b>{figures.format(selected.volume)}주</b></span>
      </div>}
      <PriceCanvas candles={candles} swingLevels={swingLevels} months={months} rangeRevision={rangeRevision} averages={averages} onHover={setHovered} onManualRange={manualRange} onPresetRange={resetRange}/>
      <details className="price-table-details"><summary>최근 10개 {periods[period]} 가격 보기</summary>
        <div className="table-scroll" tabIndex={0} aria-label="최근 주가 자료">
          <table className="price-table"><thead><tr><th scope="col">기준일</th><th scope="col">시가</th><th scope="col">고가</th><th scope="col">저가</th><th scope="col">종가</th><th scope="col">거래량(주)</th></tr></thead>
            <tbody>{candles.slice(-10).reverse().map(candle => <tr key={candle.time}><th scope="row">{candle.time}</th>
              {[candle.open, candle.high, candle.low, candle.close, candle.volume].map((value, index) => <td key={index}>{figures.format(value)}</td>)}</tr>)}</tbody></table>
        </div>
      </details>
      <div className="price-footnote">
        <p>최대 최근 5년 · {data.candles[0].time}–{last.time} · 조회 {new Date(data.fetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })}</p>
        <p>15분 동안 저장본을 사용합니다. 실시간 차트가 아니며 장중에는 마지막 봉이 변할 수 있습니다. 주봉·월봉은 저장된 일봉을 합산하며 기준일은 첫 거래일입니다. 보유 범위의 첫 주·월은 일부 거래일만 포함할 수 있습니다.</p>
        <p>빨강 상승 · 파랑 하락 · 이동평균은 선택한 주기의 봉 기준이며 자료가 부족한 선은 표시하지 않습니다.</p>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.</a>
      </div>
    </>}
  </section>;
}
