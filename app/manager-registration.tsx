import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { requestJson } from "../lib/client-api";
import type { AssetManager, ManagerPreview } from "../lib/ownership";

const dateLabel = (value: string) => value.slice(0, 4) + "." + value.slice(4, 6) + "." + value.slice(6, 8);

export default function ManagerRegistration({ onComplete, onCancel, onRefresh }: {
  onComplete: (manager: AssetManager) => void;
  onCancel: () => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<ManagerPreview | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  function changeName(value: string) {
    active.current?.abort();
    active.current = null;
    setName(value); setPreview(null); setError(""); setSearching(false); setShowAll(false);
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || searching || saving) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setSearching(true); setPreview(null); setError(""); setShowAll(false);
    try {
      const params = new URLSearchParams({ preview: "1", name: name.trim() });
      const result = await requestJson<ManagerPreview>("/api/giants?" + params, { signal: controller.signal });
      if (!controller.signal.aborted) setPreview(result);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "공시 내역을 조회하지 못했습니다.");
    } finally {
      if (active.current === controller) { active.current = null; setSearching(false); }
    }
  }

  async function register() {
    if (!preview?.reports.length || preview.registered || saving) return;
    setSaving(true); setError("");
    try {
      const params = new URLSearchParams({ name: preview.manager.name });
      const saved = await requestJson<AssetManager>("/api/giants?" + params, { method: "PUT" });
      onComplete(saved);
    } catch (error) {
      setError(error instanceof Error ? error.message : "운용사를 등록하지 못했습니다.");
    } finally { setSaving(false); }
  }

  const reports = preview?.reports ?? [];
  const visible = showAll ? reports : reports.slice(0, 10);
  const companyCount = new Set(reports.map(report => report.corpCode)).size;
  const missing = preview?.coverage.missing.length ?? 0;
  return <section className="manager-registration" aria-labelledby="manager-registration-heading">
    <h3 id="manager-registration-heading">운용사 공시 조회</h3>
    <p>공시 내역을 먼저 확인하고, 원하는 운용사를 등록하세요. 조회만으로 등록되지는 않습니다.</p>
    <form className="manager-form" onSubmit={search}>
      <label className="manager-field">DART 공시 제출인명
        <input value={name} onChange={event => changeName(event.target.value)} maxLength={80}
          placeholder="예시 신영자산운용" disabled={saving} required/>
      </label>
      <button type="submit" className="watch-button" disabled={!name.trim() || searching || saving}>
        {searching ? "조회 중…" : "공시 조회"}
      </button>
      <button type="button" className="expand-button" disabled={saving} onClick={onCancel}>취소</button>
    </form>
    {searching && <p className="loading" role="status"><span className="spinner"/> 공시 내역을 확인하고 있습니다.</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {preview && <div className="manager-preview">
      <div className="manager-preview-summary" role="status">
        <strong>{preview.manager.name}</strong>
        <span>{companyCount.toLocaleString()}개 기업 · {reports.length.toLocaleString()}건 공시</span>
      </div>
      <p className="giants-period">조회 기간 {dateLabel(preview.coverage.start)}–{dateLabel(preview.coverage.end)}
        {preview.coverage.through ? " · 목록 수집 기준 " + dateLabel(preview.coverage.through) : ""}</p>
      {missing > 0 && <div className="notice manager-coverage-note" role="status">
        <span>{missing}개월의 공시 목록이 아직 수집되지 않았습니다. 현재 수집된 내역만 표시합니다.</span>
        <button type="button" className="expand-button" disabled={saving} onClick={onRefresh}>공시 목록 갱신</button>
      </div>}
      {reports.length === 0 ? <p className="manager-preview-empty" role="status">
        {missing ? "아직 조회된 내역이 없어 등록할 수 없습니다. 공시 목록을 갱신한 뒤 다시 조회해 주세요."
          : "최근 3년 내 조회된 지분공시가 없어 등록할 수 없습니다. DART 공시 제출인명을 확인해 주세요."}
      </p> : <>
        <div className="table-scroll manager-preview-scroll" tabIndex={0} aria-label="등록 전 공시 조회 내역">
          <table className="manager-preview-table"><thead><tr>
            <th scope="col">기업</th><th scope="col">접수일</th><th scope="col">보고서 · 제출인</th>
          </tr></thead><tbody>{visible.map(report => <tr key={report.receipt}>
            <th scope="row">{report.company}<small>{report.market} {report.stockCode}</small></th>
            <td>{dateLabel(report.date)}</td>
            <td><a className="filing-link" href={"https://dart.fss.or.kr/dsaf001/main.do?rcpNo=" + report.receipt}
              target="_blank" rel="noreferrer">{report.title} ↗</a><small>{report.filer}</small></td>
          </tr>)}</tbody></table>
        </div>
        {reports.length > 10 && <button type="button" className="expand-button manager-preview-more"
          onClick={() => setShowAll(value => !value)}>{showAll ? "최근 10건만 보기" : "전체 " + reports.length.toLocaleString() + "건 보기"}</button>}
        <div className="manager-preview-actions">
          {preview.registered ? <><span>이미 등록된 운용사입니다.</span>
            <button type="button" className="watch-button" onClick={() => onComplete(preview.manager)}>이 운용사 보기</button>
          </> : <><span>위 공시의 제출인을 확인한 뒤 등록해 주세요.</span>
            <button type="button" className="watch-button" disabled={saving} onClick={() => void register()}>
              {saving ? "등록 중…" : "이 운용사 등록"}
            </button>
          </>}
        </div>
      </>}
    </div>}
  </section>;
}
