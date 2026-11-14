// Local server-only Kiwoom gateway. Keys and access tokens stay in memory,
// never in browser responses, the database, or build output.
export function createKiwoomClient(appKey, appSecret, fetcher = fetch) {
  let accessToken;
  let tokenUntil = 0;
  let authenticating;
  let queue = Promise.resolve();
  const pending = new Map();

  function failure(message, status = 502) {
    return Object.assign(new Error(message), { status });
  }

  function apiFailure(data) {
    const code = Number(data?.return_code);
    const message = String(data?.return_msg ?? "");
    if (code === 8010 || /IP|아이피|지정단말|단말기/i.test(message)) {
      return failure("키움 허용 IP를 확인해 주세요. 공인 IP가 바뀌었다면 키움 홈페이지에서 새 IP를 등록한 뒤 다시 조회해 주세요.", 503);
    }
    if (/초당|한도|제한|과부하/.test(message)) return failure("키움 조회 한도에 도달했습니다. 잠시 후 다시 조회해 주세요.", 429);
    if (/인증|토큰|token|appkey|secretkey/i.test(message)) return failure("키움 인증에 실패했습니다. 서버의 키와 키움 허용 IP 설정을 확인해 주세요.", 503);
    return failure("키움에서 차트 자료를 가져오지 못했습니다. 잠시 후 다시 조회해 주세요.");
  }

  async function token(signal) {
    if (!appKey?.trim() || !appSecret?.trim()) throw failure("서버 .env에 키움 App Key와 App Secret을 설정해 주세요.", 503);
    if (accessToken && Date.now() < tokenUntil) return accessToken;
    if (!authenticating) {
      authenticating = (async () => {
        const response = await fetcher("https://api.kiwoom.com/oauth2/token", {
          method: "POST", redirect: "error", signal,
          headers: { "Content-Type": "application/json;charset=UTF-8" },
          body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey.trim(), secretkey: appSecret.trim() }),
        });
        const result = await response.json();
        if (!response.ok || Number(result.return_code ?? 0) !== 0 || typeof result.token !== "string" || !result.token) throw apiFailure(result);
        const expiry = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(result.expires_dt));
        const expiresAt = expiry ? Date.parse(`${expiry[1]}-${expiry[2]}-${expiry[3]}T${expiry[4]}:${expiry[5]}:${expiry[6]}+09:00`) : NaN;
        accessToken = result.token;
        tokenUntil = Number.isFinite(expiresAt) ? expiresAt - 60_000 : Date.now() + 20 * 3_600_000;
        return accessToken;
      })().finally(() => { authenticating = undefined; });
    }
    return authenticating;
  }

  // Serialize requests across companies as well as continuation pages.
  function schedule(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, 250)));
    return result;
  }

  async function history(stockCode) {
    const signal = AbortSignal.timeout(28_000);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const cutoff = (Number(today.slice(0, 4)) - 5) + today.slice(4).replaceAll("-", "");
    const baseDate = today.replaceAll("-", "");
    const rows = [];
    let nextKey = "";
    const seenKeys = new Set();
    for (let page = 0; page < 5; page++) {
      const result = await schedule(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const currentToken = await token(signal);
          const response = await fetcher("https://api.kiwoom.com/api/dostk/chart", {
            method: "POST", redirect: "error", signal,
            headers: { "Content-Type": "application/json;charset=UTF-8", authorization: "Bearer " + currentToken,
              "api-id": "ka10081", "cont-yn": nextKey ? "Y" : "N", "next-key": nextKey },
            // A bare stock code selects KRX. Keep the original base date on all
            // continuation pages so historical adjusted prices share one basis.
            body: JSON.stringify({ stk_cd: stockCode, base_dt: baseDate, upd_stkpc_tp: "1" }),
          });
          const data = await response.json();
          if ([8005, 8010].includes(Number(data.return_code)) && attempt === 0) {
            accessToken = undefined;
            tokenUntil = 0;
            continue;
          }
          if (!response.ok || Number(data.return_code ?? 0) !== 0) throw apiFailure(data);
          return { data, more: response.headers.get("cont-yn") === "Y", next: response.headers.get("next-key") ?? "" };
        }
      });
      const items = result?.data.stk_dt_pole_chart_qry;
      if (!Array.isArray(items) || result.data.stk_cd !== stockCode) throw failure("키움 차트 응답의 종목 또는 자료 형식을 확인하지 못했습니다.");
      rows.push(...items);
      const dates = items.map(item => item?.dt).filter(date => typeof date === "string" && /^\d{8}$/.test(date));
      if (dates.length !== items.length) throw failure("키움 차트 날짜를 읽지 못했습니다.");
      if (!result.more || (dates.length && dates.reduce((a, b) => a < b ? a : b) <= cutoff)) return { rows, cutoff, fetchedAt: Date.now() };
      if (!items.length || !result.next || seenKeys.has(result.next)) throw failure("키움 연속조회가 완전히 끝나지 않았습니다. 다시 조회해 주세요.");
      seenKeys.add(result.next);
      nextKey = result.next;
    }
    throw failure("차트 조회 범위를 모두 가져오지 못했습니다. 다시 조회해 주세요.");
  }

  return {
    async chart(stockCode) {
      if (!/^[A-Z0-9]{6}$/.test(stockCode ?? "")) return { status: 400, body: { error: "올바른 종목코드가 필요합니다." } };
      if (!pending.has(stockCode)) {
        pending.set(stockCode, history(stockCode).then(body => ({ status: 200, body })).catch(error => ({
          status: Number.isInteger(error?.status) ? error.status : 502,
          body: { error: Number.isInteger(error?.status) ? error.message : "키움 시세 서버에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요." },
        })).finally(() => { pending.delete(stockCode); }));
      }
      return pending.get(stockCode);
    },
  };
}
