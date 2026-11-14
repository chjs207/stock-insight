# 스탁인사이트

KOSPI·KOSDAQ 기업 재무와 자산운용사의 지분공시를 조회합니다.

**사이트:** https://chjs207.github.io/stock-insight/

GitHub Pages가 화면과 수집된 JSON을 제공하고, GitHub Actions가 OpenDART 자료를 수집합니다. 휴대폰에서 웹 주소를 열면 사용할 수 있으며 Mac을 켜둘 필요가 없습니다. 기존 PC 서버와 네이티브 모바일 앱은 별도 프로젝트로 유지합니다.

## 제공 기능

- 상장기업 이름·종목코드 검색, 브라우저별 관심종목 등록과 백업·가져오기
- 연간 5개년 매출액·영업이익·순이익·지배주주 순이익 및 증감률 차트
- 분기 기본 2개년, 1년씩 확장, 전년 동분기·직전 분기 증감률
- 수집된 시가총액으로 PER·POR 계산, TTM·최근 연간 기준 선택
- 네이버 증권 종목 차트 연결
- ‘거인의 어깨’: 최근 3년 운용사별 지분공시, 종목별 최신 보고 및 과거 이력
- 수집 기준 시각, 누락·실패 안내, 이전 정상 자료 유지

## 새 기업·운용사 수집

검색 목록은 전체 KOSPI·KOSDAQ을 대상으로 구성하지만 **재무자료는 수집 대상으로 등록한 기업에 한해 제공**합니다. 초기 예시 대상은 삼성전자·SK하이닉스·에코프로·글로벌텍스프리이며, 개인 관심종목과 별개입니다. 최초 수집 운용사는 브이아이피자산운용입니다.

1. 사이트의 **자료 · 설정 → 수집 실행 내역** 또는 이 저장소 **Actions → 자료 수집 및 Pages 배포**를 엽니다.
2. **Run workflow**, 브랜치 **main**을 선택합니다.
3. 기업명/6자리 종목코드 또는 자산운용사명을 입력합니다. 여러 개는 쉼표로 구분합니다.
4. 필요한 경우 ‘분기 수집 연수’를 늘립니다. 기본 수집은 5년, 지원 시작은 2015년입니다. 화면은 2년부터 1년씩 확장됩니다.
5. 실행 완료 후 사이트를 새로고침합니다. 추가한 대상은 `data` 브랜치에 저장되어 이후 자동 수집에 포함됩니다.

Actions는 실시간 API 서버가 아닙니다. 브라우저 검색 자체가 DART 수집을 실행하지 않으며, 수집 실행에는 저장소 쓰기 권한이 있는 GitHub 계정이 필요합니다. 브라우저에는 GitHub 토큰·DART 인증키를 넣지 않습니다.

## 자동 실행과 영구 저장

- 한국 시간 **매일 07:17, 19:17** 실행, 필요할 때 수동 실행
- 최초 실행과 수동 ‘3년 전체’ 실행은 최대 37개월 공시 목록, 최대 500건 원문 수집
- 일반 실행은 현재 월과 미수집 월 최대 6개월, 원문 최대 120건을 이어서 수집
- 실행당 요청 한도 1,800회, 요청 간격·재시도 적용; 다 못 읽은 공시는 다음 실행에서 계속 처리
- 금융자료 조회 성공분은 7일간 캐시 사용 후 정정 공시 재확인, 자료 없음은 1일 후 재확인
- 매 실행마다 **SQLite**를 `data/cache.json` 백업에서 복원하여 사용하고 다시 백업합니다.
- `data` 브랜치는 `cache.json`과 `site/` 공개 자료를 보관합니다. Actions 임시 디스크나 캐시 보존 기간에 의존하지 않습니다.
- 정상 수집 항목만 갱신하고 실패한 항목의 이전 저장본은 유지합니다. 배포 실패 시 기존 Pages 사이트가 유지됩니다.
- 워크플로 전체를 직렬화하며, `data` 변경은 다른 배포를 재귀적으로 실행하지 않습니다.

**소스 코드:** `main` (개발 브랜치 `feature/github-pages`)

**공개 자료:** `data`

**설정:** `config/collection.json`

## GitHub 설정

1. 저장소를 **Public**으로 유지합니다.
2. **Settings → Secrets and variables → Actions → Secrets**에 `DART_API_KEY`를 등록합니다.
3. **Settings → Pages → Source**를 **GitHub Actions**로 선택합니다.
4. Actions 실행을 허용합니다. 워크플로가 수집 작업에 `contents: write`, 배포 작업에 `pages: write`와 `id-token: write`를 요청합니다.
5. **Actions → 자료 수집 및 Pages 배포 → Run workflow**를 실행합니다.

Kiwoom 키는 이 버전에서 사용하지 않습니다. `.env`, 키 파일, 개인 DB를 저장소에 올리지 마세요. 공개 자료와 소스는 누구나 볼 수 있습니다. 관심종목은 브라우저에만 저장되며 브라우저 데이터 삭제 시 사라질 수 있습니다.

표준 GitHub 호스티드 러너를 쓰는 공개 저장소와 Pages의 무료 제공 범위로 구성했습니다. GitHub의 실행·저장·트래픽 제한, DART API 한도는 적용됩니다. 예약 실행은 지연될 수 있고 공개 저장소에 60일 동안 활동이 없으면 자동 비활성화될 수 있습니다. 이 경우 Actions에서 다시 활성화합니다.

## 로컬 개발

Node.js 24 권장. 이 폴더에서 실행합니다.

```sh
npm ci
cp .env.example .env
# .env에 DART_API_KEY 입력
node --env-file=.env --experimental-strip-types scripts/collect.ts
npm run prepare:data
npm test
npm run build
npm run dev
```

로컬 주소: `http://127.0.0.1:4195/stock-insight/`. 수집 데이터는 무시되는 `.data/`, 공개 복사본은 무시되는 `public/data/`에 생성됩니다. 배포 빌드에는 `dist/`만 올립니다.

환경변수 `COLLECT_COMPANIES`, `COLLECT_MANAGERS`, `COLLECT_QUARTER_YEARS`, `COLLECT_MONTHS`, `COLLECT_DETAILS`로 로컬 수집 범위를 조절할 수 있습니다. 값은 셸 명령으로 실행하지 않고 문자열 입력으로 처리합니다.

## 자료 해석

연결 재무제표를 우선하고 없으면 별도를 사용합니다. 4분기는 같은 통화·재무제표 기준의 연간 실적에서 3분기 누적 실적을 빼서 산출합니다. 증감률은 `(당기 − 비교기) ÷ |비교기| × 100`이며 기준 불일치·0·자료 없음은 비워둡니다. 지배주주 순이익과 전체 순이익을 구분합니다.

PER는 지배주주 순이익(별도는 순이익), POR는 영업이익을 사용하며 양수인 이익에 대해서만 계산합니다. 시가총액은 수집 시점의 네이버 증권 자료로 보통주·식별 가능한 우선주를 합산합니다. 실시간 매매 지표가 아닙니다. 지분공시는 보고 시점의 보유주식등 기준이며 현재 실제 보유량과 다를 수 있습니다.

## 참고

- [GitHub Pages 사용자 지정 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Actions 과금 및 무료 범위](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [예약 워크플로 동작](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [OpenDART 개발 가이드](https://opendart.fss.or.kr/guide/main.do)
