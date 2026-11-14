import { useEffect, useState } from "react";
import type { Company } from "../lib/market";
import type { Catalog, GiantsData } from "./data-types";
import { getCatalog, getGiants, readWatchlist, writeWatchlist } from "./runtime";
import { CollectionHelp, dateLabel } from "./data-status";
import { workflowUrl } from "./config";

export default function AppSettings() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [giants, setGiants] = useState<GiantsData | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void getCatalog().then(setCatalog, () => setMessage("자료 상태를 읽지 못했습니다. 새로고침해 주세요."));
    void getGiants().then(setGiants, () => {});
  }, []);
  function backup() {
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, companies: readWatchlist() }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "stock-insight-watchlist.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage((error as Error).message); }
  }
  async function restore(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("관심종목 파일이 너무 큽니다.");
      const data = JSON.parse(await file.text()) as { version: number; companies: Company[] };
      if (data.version !== 1 || !Array.isArray(data.companies)) throw new Error("관심종목 백업 파일을 선택해 주세요.");
      writeWatchlist([...readWatchlist(), ...data.companies]);
      setMessage("관심종목을 기존 목록에 추가했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "관심종목 파일을 읽지 못했습니다."); }
  }
  return <>
    <section className="hero"><div className="eyebrow">스탁인사이트</div><h1>자료 상태 · 수집</h1><p>저장된 자료의 기준 시각과 수집 진행 상태를 확인하세요.</p></section>
    <section className="panel settings-panel"><h2>공개 재무자료</h2>
      <dl className="status-grid"><dt>최근 갱신</dt><dd>{dateLabel(catalog?.generatedAt ?? null)}</dd>
        <dt>검색 가능한 기업</dt><dd>{catalog?.companies.length.toLocaleString() ?? "—"}개</dd>
        <dt>재무 수집 기업</dt><dd>{catalog ? Object.keys(catalog.collected).length : "—"}개</dd>
        <dt>지분공시 목록</dt><dd>{giants ? giants.coverage.missing.length ? `${giants.coverage.missing.length}개월 추가 수집 예정` : "최근 3년 수집 완료" : "—"}</dd>
        <dt>지분공시 원문</dt><dd>{giants ? Object.values(giants.snapshots).reduce((sum, view) => sum + view.pending, 0) + "건 추가 수집 예정" : "—"}</dd>
      </dl>
      <p>매일 오전 7:17 · 오후 7:17에 자동 수집합니다. 실행이 지연되면 이전 저장본을 계속 표시합니다. 시가총액과 재무자료는 실시간 값이 아닙니다.</p>
      <a className="expand-button" href={workflowUrl} target="_blank" rel="noreferrer">수집 실행 내역 ↗</a>
      <CollectionHelp/>
      {catalog && catalog.warnings.length > 0 && <details className="collection-help"><summary>최근 수집 안내 {catalog.warnings.length}건</summary><ul>{catalog.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul></details>}
    </section>
    <section className="panel settings-panel"><h2>내 관심종목</h2>
      <p>관심종목은 현재 브라우저에 저장됩니다. 다른 휴대폰이나 브라우저에서는 백업 파일을 가져와 이어서 사용할 수 있습니다.</p>
      <div className="settings-actions"><button className="expand-button" onClick={backup}>관심종목 내보내기</button>
        <label className="expand-button file-label">관심종목 가져오기<input type="file" accept=".json,application/json" onChange={event => { void restore(event.target.files?.[0]); event.target.value = ""; }}/></label></div>
      {message && <p role="status">{message}</p>}
    </section>
  </>;
}
