"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { averageColors, averageSettingsError, defaultAverages, maxAverageLines, maxAveragePeriod } from "../lib/chart-preferences";
import type { CloseAverage } from "../lib/chart-preferences";

type DraftLine = { period: string; color: string; visible: boolean };
const draftLines = (lines: CloseAverage[]): DraftLine[] => lines.map(line => ({ ...line, period: String(line.period) }));

export default function AverageSettings({ initial, unit, onApply, onCancel }: {
  initial: CloseAverage[]; unit: string; onApply: (lines: CloseAverage[]) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => draftLines(initial));
  const [error, setError] = useState("");

  function change(index: number, patch: Partial<DraftLine>) {
    setDraft(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
    setError("");
  }

  function add() {
    setDraft(current => {
      if (current.length >= maxAverageLines) return current;
      const period = [5, 10, 20, 60, 120, 240].find(value => !current.some(line => Number(line.period) === value))!;
      return [...current, { period: String(period), color: averageColors[current.length].value, visible: true }];
    });
    setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.some(line => !/^\d+$/.test(line.period))) { setError("기간은 1~600 사이의 정수로 입력해 주세요."); return; }
    const lines = draft.map(line => ({ ...line, period: Number(line.period) }));
    const validation = averageSettingsError(lines);
    if (validation) { setError(validation); return; }
    onApply(lines);
  }

  return <form className="average-settings" aria-labelledby="average-settings-title" onSubmit={submit} noValidate>
    <div className="average-settings-head"><div><h3 id="average-settings-title">종가 이동평균 설정</h3>
      <p>단순 이동평균 · 기간 1~600봉 · 최대 5개</p></div>
      <button type="button" className="average-text-button" onClick={() => { setDraft(draftLines(defaultAverages())); setError(""); }}>기본값 복원</button>
    </div>
    <div className="average-setting-rows">
      {draft.map((line, index) => <div className="average-setting-row" key={index}>
        <label className="average-show"><input type="checkbox" aria-label={`${index + 1}번 이동평균 표시`} checked={line.visible}
          onChange={event => change(index, { visible: event.target.checked })}/><span>표시</span></label>
        <label className="average-period-field"><span>기간</span><span className="average-number-unit">
          <input type="number" aria-label={`${index + 1}번 이동평균 기간`} min={1} max={maxAveragePeriod} step={1} required value={line.period}
            aria-describedby="average-settings-note" onChange={event => change(index, { period: event.target.value })}/><span>{unit}</span>
        </span></label>
        <label className="average-color-field"><span>색상</span><span className="average-color-select">
          <i style={{ background: line.color }} aria-hidden="true"/><select aria-label={`${index + 1}번 이동평균 색상`} value={line.color}
            onChange={event => change(index, { color: event.target.value })}>
            {averageColors.map(color => <option key={color.value} value={color.value}>{color.label}</option>)}
          </select>
        </span></label>
        <button type="button" className="average-remove" disabled={draft.length === 1} aria-label={`${index + 1}번 이동평균 삭제`}
          title={draft.length === 1 ? "최소 1개를 남겨두고 표시를 해제할 수 있습니다" : "이동평균선 삭제"}
          onClick={() => { setDraft(current => current.filter((_, lineIndex) => lineIndex !== index)); setError(""); }}>×</button>
      </div>)}
    </div>
    <div className="average-settings-add"><button type="button" className="average-text-button" disabled={draft.length >= maxAverageLines} onClick={add}>＋ 선 추가</button><span>{draft.length} / {maxAverageLines}</span></div>
    <p id="average-settings-note" className="average-settings-note">선택한 봉 주기의 종가 평균입니다. 설정은 이 브라우저의 모든 종목에 적용됩니다. 자료가 부족한 선은 표시하지 않습니다.</p>
    {error && <p className="average-settings-error" role="alert">{error}</p>}
    <div className="average-settings-actions"><button type="button" onClick={onCancel}>취소</button><button type="submit">적용</button></div>
  </form>;
}
