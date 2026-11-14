import { useEffect, useState } from "react";
import type { Company } from "../lib/market";
import type { Catalog, CompanyData } from "./data-types";
import { getCatalog, getCompanyData } from "./runtime";
import { appHref, workflowUrl } from "./config";

export function dateLabel(date: string | null) {
  return date ? new Date(date).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "아직 수집되지 않음";
}

export function CollectionHelp({ company, manager }: { company?: Company; manager?: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const value = manager || company?.stockCode || "";
  return <details className="collection-help" open={Boolean(manager)}>
    <summary>{manager ? "운용사 추가 수집" : "새 자료 수집 · 과거 분기 추가"}</summary>
    <div>
      <p>자료 수집을 실행하면 완료 후 이 사이트에 반영됩니다. 등록한 기업과 운용사는 이후 자동 갱신됩니다.</p>
      {value && <p className="collection-value">{manager ? "운용사명" : "종목코드"} <code>{value}</code>
        <button type="button" className="expand-button" onClick={() => {
          void navigator.clipboard.writeText(value).then(() => { setCopied(true); setCopyError(false); }, () => setCopyError(true));
        }}>{copied ? "복사됨" : "복사"}</button></p>}
      {copyError && <p role="status">복사하지 못했습니다. 위 값을 직접 입력해 주세요.</p>}
      <ol>
        <li><a href={workflowUrl} target="_blank" rel="noreferrer">자료 수집 화면 열기 ↗</a> → <strong>Run workflow</strong></li>
        <li>{manager ? "자산운용사명" : "기업명 또는 종목코드"} 입력란에 {value || "추가할 값"} 입력</li>
        {!manager && <li>더 오래된 분기가 필요하면 ‘분기 수집 연수’를 늘려 주세요. 최대 2015년까지 지원합니다.</li>}
        <li><strong>Run workflow</strong> 실행 → 완료 후 이 페이지 새로고침</li>
      </ol>
      <p className="muted-text">저장소 소유자의 GitHub 로그인이 필요합니다. 새 자료 수집에는 몇 분이 걸릴 수 있습니다.</p>
    </div>
  </details>;
}

export function SiteDataStatus() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => { void getCatalog().then(setCatalog, () => {}); }, []);
  return <div className="data-status" role="status">
    <span>{catalog?.generatedAt ? "자료 갱신 " + dateLabel(catalog.generatedAt) : "저장된 자료를 확인하고 있습니다."}</span>
    <a href={appHref("?section=settings")}>자료 상태 · 수집</a>
  </div>;
}

export function CompanyDataStatus({ company }: { company: Company }) {
  const [state, setState] = useState<{ loaded: boolean; data?: CompanyData }>({ loaded: false });
  useEffect(() => {
    let active = true;
    void getCatalog().then(async catalog => catalog.collected[company.corpCode] ? getCompanyData(company.corpCode) : undefined)
      .then(data => { if (active) setState({ loaded: true, data }); }, () => { if (active) setState({ loaded: true }); });
    return () => { active = false; };
  }, [company.corpCode]);
  return <div className="company-data-status">
    {state.data ? <p>재무 확인 {dateLabel(state.data.collectedAt)} · 저장된 분기 {state.data.quarters?.at(-1)?.year ?? "—"}–{state.data.quarters?.[0]?.year ?? "—"}년</p>
      : state.loaded && <p>아직 수집되지 않은 기업입니다. 관심종목 등록과 네이버 차트는 바로 이용할 수 있습니다.</p>}
    {state.data?.warnings.map((warning, index) => <p className="data-warning" key={index}>{warning}</p>)}
    <CollectionHelp company={company}/>
  </div>;
}
