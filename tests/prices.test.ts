import { test } from "vitest";
import assert from "node:assert/strict";
import { aggregateCandles, movingAverage, parseCandles, previousSwing } from "../lib/price-data.ts";
import { createKiwoomClient } from "../scripts/kiwoom-client.mjs";

const bar = (time: string, open: number, close: number, volume = 10) => ({ time, open, high: Math.max(open, close) + 2, low: Math.min(open, close) - 2, close, volume });
test("directional price signs are not negative prices; suspended days remain flat", () => {
  assert.deepEqual(parseCandles([
    { dt: "20261106", open_pric: "-100", high_pric: "+110", low_pric: "-90", cur_prc: "-95", trde_qty: "20" },
    { dt: "20261105", open_pric: "0", high_pric: "0", low_pric: "0", cur_prc: "100", trde_qty: "0" },
  ], "20200101"), [
    { time: "2026-11-05", open: 100, high: 100, low: 100, close: 100, volume: 0 },
    { time: "2026-11-06", open: 100, high: 110, low: 90, close: 95, volume: 20 },
  ]);
  assert.throws(() => parseCandles([{ dt: "20261106", open_pric: "100", high_pric: "80", low_pric: "70", cur_prc: "95", trde_qty: "20" }], "20200101"));
  assert.throws(() => parseCandles([{ dt: "20260230" }], "20200101"));
});

test("weekly candles combine across year boundaries; monthly candles separate them", () => {
  const daily = [bar("2025-12-29", 100, 110, 10), bar("2025-12-30", 110, 105, 20), bar("2026-01-02", 105, 120, 30), bar("2026-01-05", 120, 115, 40)];
  assert.deepEqual(aggregateCandles(daily, "week"), [
    { time: "2025-12-29", open: 100, high: 122, low: 98, close: 120, volume: 60 },
    { time: "2026-01-05", open: 120, high: 122, low: 113, close: 115, volume: 40 },
  ]);
  const monthly = aggregateCandles(daily, "month");
  assert.equal(monthly[0].close, 105);
  assert.equal(monthly[1].time, "2026-01-02");
  assert.equal(monthly[1].volume, 70);
  assert.equal(monthly[1].close, 115);
});

test("moving averages require full windows and roll forward without future prices", () => {
  const candles = [10, 20, 30, 40].map((close, index) => bar(`2026-01-0${index + 1}`, close, close));
  assert.deepEqual(movingAverage(candles, 3), [{ time: "2026-01-03", value: 20 }, { time: "2026-01-04", value: 30 }]);
  assert.deepEqual(movingAverage(candles, 20), []);
});

test("previous swing low picks the latest confirmed trough, even when the latest candle breaks below it", () => {
  const candles = [115, 90, 125, 105, 125, 100].map((low, index) => ({ ...bar(`2026-01-0${index + 1}`, low + 1, low + 2), low }));
  assert.equal(previousSwing(candles, "low"), candles[3]);
});

test("equal adjacent lows form one trough and require higher lows on both sides", () => {
  const candles = [110, 100, 100, 125, 95, 95].map((low, index) => ({ ...bar(`2026-01-0${index + 1}`, low + 1, low + 2), low }));
  assert.equal(previousSwing(candles, "low"), candles[2]);
  assert.equal(previousSwing(candles.slice(0, 3), "low"), null);
  assert.equal(previousSwing(candles.slice(1), "low"), null);
});

test("previous swing high uses candle highs and ignores an unconfirmed latest high", () => {
  const candles = [110, 130, 120, 125, 125, 115, 140].map((high, index) => ({ ...bar(`2026-01-0${index + 1}`, 100, 100 + index), high }));
  assert.equal(previousSwing(candles, "high"), candles[4]);
  assert.equal(previousSwing(candles.slice(-2), "high"), null);
});

test("continuation keeps adjusted-price basis and tokens are reused, including concurrent readers", async () => {
  const calls: { url: string; body: Record<string, string>; headers: Record<string, string> }[] = [];
  const client = createKiwoomClient("test-app-key", "test-secret", async (input, options) => {
    const url = String(input);
    const body = JSON.parse(String(options?.body));
    const headers = options?.headers as Record<string, string>;
    calls.push({ url, body, headers });
    if (url.endsWith("/oauth2/token")) return Response.json({ token: "test-token", expires_dt: "20990101000000", return_code: 0 });
    return Response.json({ stk_cd: body.stk_cd, stk_dt_pole_chart_qry: [{ dt: headers["next-key"] ? "20000101" : "20990101" }], return_code: 0 }, {
      headers: { "cont-yn": headers["next-key"] ? "N" : "Y", "next-key": headers["next-key"] ? "" : "continuation-key" },
    });
  });
  const [one, duplicate] = await Promise.all([client.chart("005930"), client.chart("005930")]);
  assert.equal(one.status, 200);
  assert.deepEqual(one, duplicate);
  await client.chart("000660");
  assert.equal(calls.filter(call => call.url.endsWith("/oauth2/token")).length, 1);
  const chartCalls = calls.filter(call => call.url.endsWith("/chart"));
  assert.equal(chartCalls.length, 4);
  assert.equal(chartCalls[0].body.base_dt, chartCalls[1].body.base_dt);
  assert.equal(chartCalls[1].headers["cont-yn"], "Y");
  assert.equal(chartCalls[1].headers["next-key"], "continuation-key");
  assert.ok(chartCalls.every(call => call.body.upd_stkpc_tp === "1" && call.headers["api-id"] === "ka10081"));
  assert.ok(chartCalls.every(call => !JSON.stringify(call.body).includes("test-secret")));
});

test("IP errors and missing credentials expose only safe guidance", async () => {
  const client = createKiwoomClient("private-key", "private-secret", async () => Response.json({ return_code: 8050, return_msg: "지정단말기 인증 실패 private-secret" }));
  const result = await client.chart("005930");
  assert.equal(result.status, 503);
  assert.match(result.body.error ?? "", /IP/);
  assert.ok(!JSON.stringify(result).includes("private-secret"));
  assert.equal((await createKiwoomClient("", "").chart("005930")).status, 503);
  assert.equal((await client.chart("../oauth2/token")).status, 400);
});
