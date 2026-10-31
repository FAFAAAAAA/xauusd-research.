// End-to-end tests of the backend services against a REAL PostgreSQL database
// with the real migration applied. Telegram HTTP is replaced by a recording stub
// (the sandbox has no route to api.telegram.org) — production uses global fetch.
// Every fixture below is synthetic and flagged TEST / is_test = true.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { psqlDb } from './helpers/psql-db';
import * as repo from '../src/lib/server/repo';
import { createReplaySession, stepReplay, resetReplaySession, visibleCandles } from '../src/lib/server/replay-service';
import { handleTradingViewWebhook } from '../src/lib/server/webhook-service';
import { importOhlcChunk, deriveTimeframes, importEconomicEventsCsv, importStrategyReportCsv } from '../src/lib/server/import-service';
import { loadNewsWindow, snapshotAt } from '../src/lib/server/news-service';
import { sendTelegram, type FetchLike } from '../src/lib/server/telegram';
import { analytics } from '../src/lib/server/analytics-service';
import { HttpError } from '../src/lib/server/db';
import { runBacktest } from '../src/lib/server/backtest-service';
import { zigzag } from './helpers/zigzag';

const conn = { host: process.env.PGHOST ?? '/var/tmp', port: Number(process.env.PGPORT ?? 54329), user: process.env.PGUSER ?? 'postgres', db: 'xau_e2e' };
const admin = psqlDb({ ...conn, db: 'postgres' });
const db = psqlDb(conn);
const H = 3_600_000;
const T0 = Date.UTC(2030, 0, 7, 0); // synthetic TEST period (future date: cannot be mistaken for history)

process.env.TELEGRAM_BOT_TOKEN = '000000:TEST-TOKEN-NOT-REAL';
process.env.TRADINGVIEW_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.APP_BASE_URL = 'https://example.invalid';

const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
let mode: 'ok' | '400' | '429-then-ok' = 'ok';
let calls429 = 0;
const fakeFetch: FetchLike = async (url, init) => {
  sent.push({ url, body: JSON.parse(init.body) });
  if (mode === '400') return { status: 400, json: async () => ({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }) };
  if (mode === '429-then-ok' && calls429++ === 0) return { status: 429, json: async () => ({ ok: false, description: 'Too Many Requests', parameters: { retry_after: 1 } }) };
  return { status: 200, json: async () => ({ ok: true, result: { message_id: 1000 + sent.length } }) };
};

let sourceId = '';
let instrumentId = '';

before(() => {
  admin.exec(`select pg_terminate_backend(pid) from pg_stat_activity where datname='xau_e2e';`);
  admin.exec(`drop database if exists xau_e2e;`);
  admin.exec(`create database xau_e2e;`);
  admin.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
              if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;`);
  db.exec(readFileSync('supabase/migrations/20261031000000_init.sql', 'utf8'));
});

/** Synthetic TEST candles: a deterministic walk down toward 1950 and back up. */
function fixtureCsv(): string {
  const lines = ['time,open,high,low,close,volume'];
  let px = 1960;
  for (let i = 0; i < 48; i++) {
    const t = new Date(T0 + i * H).toISOString();
    const drift = i < 20 ? -0.6 : i < 30 ? 0 : 0.7;
    const o = px, c = +(px + drift).toFixed(2);
    lines.push(`${t},${o},${Math.max(o, c) + 0.3},${Math.min(o, c) - 0.3},${c},${100 + i}`);
    px = c;
  }
  return lines.join('\n');
}

test('1. migration: tables, seeds and RLS lock-out of anon', async () => {
  const t = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_schema='public'`);
  assert.equal(t[0].n, 20);
  const rls = await db.query<{ n: number }>(`select count(*)::int as n from pg_tables where schemaname='public' and rowsecurity`);
  assert.equal(rls[0].n, 20);
  const priv = await db.query<{ ok: boolean }>(`select has_table_privilege('anon','telegram_settings','select') as ok`);
  assert.equal(priv[0].ok, false, 'anon must not read Telegram secrets');
  instrumentId = await repo.getInstrumentId(db);
  const sv = await repo.listStrategyVersions(db);
  assert.ok(sv.find((s) => s.adapter_key === 'not_configured' && s.status === 'active'));
});

test('2. OHLC import (TEST source), idempotent re-import, derive H4', async () => {
  const src = await repo.createSource(db, {
    name: 'TEST fixture source', provider: 'TEST (synthetic)', kind: 'csv_import', broker_symbol: null, file_timezone: 'UTC',
    price_basis: 'bid', spread_spec: { type: 'fixed', points: 0.3 }, notes: 'Synthetic data for technical tests only', is_test: true,
  });
  sourceId = src.id;
  const csv = fixtureCsv();
  const r1 = await importOhlcChunk(db, { sourceId, timeframe: 'H1', text: csv, filename: 'TEST.csv' });
  assert.equal(r1.inserted, 48);
  assert.equal(r1.issueCount, 0);
  const r2 = await importOhlcChunk(db, { sourceId, timeframe: 'H1', text: csv });
  assert.equal(r2.inserted, 0);
  assert.equal(r2.existing, 48);
  // chunked upload with explicit header
  const lines = csv.split('\n');
  const r3 = await importOhlcChunk(db, { sourceId, timeframe: 'H1', header: lines[0], text: lines.slice(1, 5).join('\n'), lineOffset: 2 });
  assert.equal(r3.parsed, 4);
  const d = await deriveTimeframes(db, sourceId, 'H1', ['H4'], 'utc');
  assert.equal(d.H4, 12);
  const cov = await repo.dataCoverage(db);
  assert.equal(cov.find((c) => c.timeframe === 'H1')!.first, T0);
});

test('3. news import with anti-lookahead (TEST calendar)', async () => {
  const csv = [
    'external_id,title,category,currency,impact,scheduled_at,schedule_available_at,forecast,previous,actual,actual_available_at,source_url',
    `TEST-CPI-1,TEST US CPI y/y,US_CPI,USD,high,${new Date(T0 + 10 * H).toISOString()},${new Date(T0 - 72 * H).toISOString()},2.0,1.9,2.4,${new Date(T0 + 10 * H + 60_000).toISOString()},`,
    `TEST-NFP-1,TEST Non-Farm Payrolls,NFP,USD,high,${new Date(T0 + 30 * H).toISOString()},,180,170,,,`,
    `TEST-BAD,Missing availability,US_CPI,USD,high,${new Date(T0 + 5 * H).toISOString()},,1,1,1,,`,
  ].join('\n');
  const r = await importEconomicEventsCsv(db, csv, { provider: 'TEST', isTest: true });
  assert.equal(r.inserted, 2);
  assert.equal(r.issues.length, 1, 'actual without actual_available_at is rejected');
  assert.equal(r.sentiments, 1);
  const w = await loadNewsWindow(db, T0, T0 + 47 * H);
  const before = snapshotAt(w, T0 + 10 * H);
  assert.equal(before.items.length, 0, 'CPI actual not visible at release minute');
  assert.ok(before.upcoming.find((u) => u.category === 'NFP'));
  const after = snapshotAt(w, T0 + 11 * H);
  assert.equal(after.items[0].title, 'TEST US CPI y/y');
  assert.equal(after.items[0].sentiment?.label, 'Bearish');
  const none = await loadNewsWindow(db, Date.UTC(2031, 5, 1), Date.UTC(2031, 5, 2));
  assert.equal(none.archiveAvailable, false, '→ UI shows DATA UNAVAILABLE');
});

test('4. replay with unconfigured strategy produces no events', async () => {
  const nc = (await repo.listStrategyVersions(db)).find((x) => x.adapter_key === 'not_configured')!;
  const s = await createReplaySession(db, { sourceId, timeframe: 'H1', startTime: T0 + 5 * H, strategyVersionId: nc.id });
  assert.equal(s.cursor_time, T0 + 4 * H, 'history before start is visible; processing starts at start candle');
  await repo.updateReplayControls(db, s.id, { status: 'playing' });
  const out = await stepReplay(db, s.id, { count: 10, manual: false, fetchImpl: fakeFetch });
  assert.equal(out.strategy.configured, false);
  assert.equal(out.events.length, 0);
  assert.equal(out.revealed.length, 10);
});

let replayId = '';
test('5. replay with TEST adapter: events, Telegram, pause, no duplicates, hidden future', async () => {
  const testSv = (await repo.listStrategyVersions(db)).find((s) => s.adapter_key === 'test_zone_proximity')!;
  await repo.createZone(db, { instrumentId, mode: 'BACKTEST', kind: 'support', low: 1947.5, high: 1948.5, timeframe: 'H1', origin: 'test', validFrom: T0, validUntil: null, replaySessionId: null, isTest: true, notes: 'TEST zone' });
  await repo.createZone(db, { instrumentId, mode: 'BACKTEST', kind: 'resistance', low: 1900, high: 1901, timeframe: 'H1', origin: 'test', validFrom: T0 + 100 * H, validUntil: null, replaySessionId: null, isTest: true, notes: 'TEST future zone (must stay invisible)' });
  await repo.updateTelegramSettings(db, { chat_id: '-100TEST', backtest_enabled: true, cooldown_seconds: 0 });

  const s = await createReplaySession(db, { sourceId, timeframe: 'H1', startTime: T0 + 2 * H, strategyVersionId: testSv.id, params: { near_distance: 1.5 } });
  replayId = s.id;
  assert.equal(s.telegram_enabled, false, 'simulation Telegram is OFF by default');
  assert.equal(s.is_test, true);

  await assert.rejects(stepReplay(db, s.id, { count: 1, manual: false }), (e: HttpError) => e.status === 409, 'auto-step rejected until Play');

  const vis0 = await visibleCandles(db, s.id);
  assert.equal(vis0.candles.length, 2);
  assert.ok(vis0.candles.every((c) => c.time <= vis0.session.cursor_time!));

  await repo.updateReplayControls(db, s.id, { status: 'playing', telegram_enabled: true, speed: 5 });
  sent.length = 0;
  const a = await stepReplay(db, s.id, { count: 25, manual: false, expectedCursor: T0 + H, fetchImpl: fakeFetch });
  assert.deepEqual(a.events.map((e) => e.event_type), ['SNR_NEAR', 'SNR_TOUCH']);
  assert.ok(a.events.every((e) => e.telegram && 'status' in e.telegram && e.telegram.status === 'sent'));
  assert.equal(sent.length, 2);
  const txt = String(sent[0].body.text);
  assert.match(txt, /BACKTEST 2030/);
  assert.match(txt, /SIMULASI HISTORIS — BUKAN SINYAL LIVE/);
  assert.match(txt, /TEST FIXTURE/);
  assert.deepEqual((sent[0].body.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard[0][0].text, 'Lihat Replay');
  // Event time = candle CLOSE, never before the data that produced it
  assert.ok(a.events.every((e) => e.event_time <= a.marketTime!));

  // Duplicate request (same expected cursor, e.g. a retried HTTP call) → conflict, nothing re-sent
  const dup = await stepReplay(db, s.id, { count: 25, manual: false, expectedCursor: T0 + H, fetchImpl: fakeFetch });
  assert.equal(dup.conflict, true);
  assert.equal(sent.length, 2);

  // Pause stops automatic processing; Next Candle (manual) still works
  await repo.updateReplayControls(db, s.id, { status: 'paused' });
  await assert.rejects(stepReplay(db, s.id, { count: 1, manual: false }), (e: HttpError) => e.status === 409);
  const m = await stepReplay(db, s.id, { count: 1, manual: true, fetchImpl: fakeFetch });
  assert.equal(m.revealed.length, 1);

  const vis = await visibleCandles(db, s.id);
  assert.equal(vis.candles[vis.candles.length - 1].time, vis.session.cursor_time);
  assert.ok(vis.candles.length < 48, 'future candles are not returned');

  const logs = await repo.listDeliveries(db);
  assert.equal(logs.filter((l) => l.status === 'sent').length, 2);
  const links = await db.query<{ n: number }>(`select count(*)::int as n from event_news_links`);
  assert.ok(links[0].n >= 1, 'events linked to news that was already available');
  const ev = await repo.listEvents(db, { replaySessionId: s.id });
  assert.ok(ev.some((e) => e.confirmations.sentiment?.startsWith('Bearish')), 'CPI sentiment was available after release');
  assert.ok(ev.every((e) => e.confirmations.trend === 'Not configured'));
});

test('6. reset: policy "never" does not resend; "new_run" does', async () => {
  sent.length = 0;
  await resetReplaySession(db, replayId);
  await repo.updateReplayControls(db, replayId, { status: 'playing' });
  const r1 = await stepReplay(db, replayId, { count: 30, manual: false, fetchImpl: fakeFetch });
  assert.equal(r1.events.length, 0);
  assert.equal(sent.length, 0);

  await repo.updateReplayControls(db, replayId, { resend_policy: 'new_run' });
  const after = await resetReplaySession(db, replayId);
  assert.equal(after!.run_number, 2);
  await repo.updateReplayControls(db, replayId, { status: 'playing' });
  const r2 = await stepReplay(db, replayId, { count: 30, manual: false, fetchImpl: fakeFetch });
  assert.equal(r2.events.length, 2);
  assert.equal(sent.length, 2);
});

test('7. replay runs to the end and finishes', async () => {
  let last;
  for (let i = 0; i < 5; i++) {
    last = await stepReplay(db, replayId, { count: 50, manual: false, fetchImpl: fakeFetch }).catch((e) => e);
    if (!(last instanceof Error) && last.session.status === 'finished') break;
  }
  assert.equal((last as Awaited<ReturnType<typeof stepReplay>>).session.status, 'finished');
});

test('8. TradingView webhook: auth, validation, dedupe, LIVE Telegram', async () => {
  await repo.updateTelegramSettings(db, { live_enabled: true });
  sent.length = 0;
  mode = 'ok';
  const now = Date.now();
  const payload = {
    secret: 'test-webhook-secret', event_id: `TEST-${now}`, symbol: 'OANDA:XAUUSD', timeframe: '60', event_type: 'SNR_NEAR',
    timestamp: new Date(now - 30_000).toISOString(), price: 2001.25, zone: { low: 1995, high: 1998, kind: 'support' },
    strategy_version: 'snr-dev', source: 'tradingview-TEST', mode: 'LIVE',
  };
  const ok = await handleTradingViewWebhook(db, JSON.stringify(payload), '127.0.0.1', { fetchImpl: fakeFetch });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.telegram, 'sent');
  assert.match(String(sent[0].body.text), /XAUUSD — LIVE/);
  assert.doesNotMatch(String(sent[0].body.text), /BACKTEST/);

  const dup = await handleTradingViewWebhook(db, JSON.stringify(payload), '127.0.0.1', { fetchImpl: fakeFetch });
  assert.equal(dup.body.duplicate, true);
  assert.equal(sent.length, 1);

  const bad = await handleTradingViewWebhook(db, JSON.stringify({ ...payload, secret: 'nope' }), '127.0.0.1');
  assert.equal(bad.status, 401);
  const stale = await handleTradingViewWebhook(db, JSON.stringify({ ...payload, event_id: 'TEST-old', timestamp: '2019-07-15T10:00:00Z' }), '127.0.0.1');
  assert.equal(stale.status, 422);
  const notJson = await handleTradingViewWebhook(db, '{oops', '127.0.0.1');
  assert.equal(notJson.status, 400);

  const logs = await repo.listWebhookLogs(db);
  assert.deepEqual(logs.map((l) => l.status).sort(), ['accepted', 'duplicate', 'rejected_auth', 'rejected_validation', 'rejected_validation'].sort());
  const stored = await db.query<{ payload: { secret: string } }>(`select payload from tradingview_webhook_logs where status='rejected_auth'`);
  assert.equal(stored[0].payload.secret, '[REDACTED]');
  const live = await repo.listEvents(db, { mode: 'LIVE' });
  assert.equal(live.length, 1);
  assert.equal(live[0].replay_session_id, null);
});

test('9. Telegram failure, retry and idempotency are logged honestly', async () => {
  sent.length = 0;
  mode = '400';
  const f = await sendTelegram(db, { deliveryKey: 'TEST-fail-1', mode: 'TEST', text: 'x' }, { fetchImpl: fakeFetch });
  assert.equal(f.status, 'failed');
  assert.match(f.error!, /chat not found/);
  assert.equal(sent.length, 1, '4xx is not retried');
  mode = 'ok';
  const again = await sendTelegram(db, { deliveryKey: 'TEST-fail-1', mode: 'TEST', text: 'x' }, { fetchImpl: fakeFetch });
  assert.equal(again.status, 'duplicate', 'no silent resend without explicit retry');
  const retry = await sendTelegram(db, { deliveryKey: 'TEST-fail-1', mode: 'TEST', text: 'x', allowRetryFailed: true }, { fetchImpl: fakeFetch });
  assert.equal(retry.status, 'sent');
  mode = '429-then-ok';
  const rl = await sendTelegram(db, { deliveryKey: 'TEST-429', mode: 'TEST', text: 'y' }, { fetchImpl: fakeFetch });
  assert.equal(rl.status, 'sent');
  assert.equal(rl.attempts, 2);
  const row = await db.query<{ error: string | null }>(`select error from telegram_delivery_logs where delivery_key='TEST-fail-1'`);
  assert.ok(!String(row[0].error ?? '').includes('TEST-TOKEN'), 'token never written to logs');
});

test('10. analytics: empty until real trades exist; TradingView report import', async () => {
  const empty = await analytics(db, null);
  assert.equal(empty.hasData, false);
  assert.equal(empty.overall, null);
  const report = [
    'Trade #,Type,Signal,Date/Time,Price USD,Contracts,Profit USD',
    '1,Exit Long,TP,2030-01-07 12:00,1962,1,200',
    '1,Entry Long,L,2030-01-07 10:00,1960,1,',
    '2,Exit Short,SL,2030-01-08 03:00,1955,1,-100',
    '2,Entry Short,S,2030-01-08 01:00,1954,1,',
  ].join('\n');
  const imp = await importStrategyReportCsv(db, report, { name: 'TEST TradingView report', chartTimezone: 'UTC', timeframe: 'H1', isTest: true });
  assert.equal(imp.trades, 2);
  const a = await analytics(db, null);
  assert.equal(a.overall!.totalTrades, 2);
  assert.equal(a.overall!.totalPnl, 100);
  assert.equal(a.overall!.winRate, 0.5);
  assert.equal(a.comparison.find((c) => c.profile === 'snr_news')!.metrics, null, 'comparison slots stay empty until such a run exists');
});

test('11. SNR backtest: M15 + derived H1/H4, RR 1/2/3 sessions, causal, no overlapping trades; replay agrees', async () => {
  const src = await repo.createSource(db, {
    name: 'TEST SNR zigzag', provider: 'TEST (synthetic)', kind: 'csv_import', broker_symbol: null, file_timezone: 'UTC',
    price_basis: 'bid', spread_spec: {}, notes: 'Synthetic zigzag for strategy tests', is_test: true,
  });
  const m15 = zigzag(192 * 12, 1);
  const csv = ['time,open,high,low,close,volume', ...m15.map((c) => `${new Date(c.time).toISOString()},${c.open},${c.high},${c.low},${c.close},1`)].join('\n');
  assert.equal((await importOhlcChunk(db, { sourceId: src.id, timeframe: 'M15', text: csv })).inserted, m15.length);
  // Without H1/H4 the run is refused with a clear message
  await assert.rejects(runBacktest(db, { sourceId: src.id, from: m15[0].time, to: m15[100].time }), (e: HttpError) => e.status === 422 && /H1/.test(e.message));
  await deriveTimeframes(db, src.id, 'M15', ['H1', 'H4'], 'utc');

  const from = m15[0].time + 5 * 86_400_000, to = m15[m15.length - 1].time - 2 * 86_400_000;
  const r = await runBacktest(db, { sourceId: src.id, from, to, costs: { spread: 0.3, slippage: 0.1, commissionPerUnit: 7 }, size: 0.01 });
  assert.equal(r.strategy, 'snr h4h1m15-v0.1');
  assert.equal(r.sessions.length, 3);
  assert.equal(r.guardViolations, 0);
  assert.ok(r.setups > 0, 'synthetic uptrend must produce setups');
  console.log('# TEST backtest summary', JSON.stringify({ setups: r.setups, near: r.nearEvents, sessions: r.sessions.map((x) => [x.rr, x.trades, x.skipped]) }));

  const events = await db.query<{ et: number; bs: string; zl: number; zh: number; type: string }>(
    `select extract(epoch from event_time)*1000 as et, backtest_session_id as bs, zone_low::float8 as zl, zone_high::float8 as zh, event_type as type
     from market_events where backtest_session_id is not null`);
  for (const ses of r.sessions) {
    const trades = await repo.listTrades(db, ses.backtestSessionId);
    assert.equal(trades.length, ses.trades);
    assert.ok(trades.length > 0);
    let lastExit = -Infinity;
    for (const t of trades) {
      const entry = Number(t.entry_ms), sl = Number(t.stop_loss), tp = Number(t.take_profit), ep = Number(t.entry_price);
      assert.equal(t.side, 'long', 'bullish H4 → BUY only');
      assert.ok(sl < ep && tp > ep);
      assert.ok(Math.abs((tp - ep) / (ep - sl) - ses.rr) < 1e-3, 'TP = entry + RR × risk');
      assert.equal(Number(t.planned_rr), ses.rr);
      assert.ok(entry > lastExit, 'no overlapping trades within one RR session');
      lastExit = t.exit_ms == null ? Infinity : Number(t.exit_ms);
      assert.ok(entry >= from && entry <= to + 15 * 60_000);
      // the entry candle opens exactly when the signal candle closed
      const ev = events.find((e) => e.bs === ses.backtestSessionId && Number(e.et) === entry);
      assert.ok(ev, 'each trade has its SETUP_CONFIRMED event at the entry time');
      assert.equal(ev!.type, 'SETUP_CONFIRMED');
      assert.ok(sl < Number(ev!.zl), 'SL is outside (below) the support zone');
      if (!r.newsArchive) assert.equal(t.news_confirmed, null, 'no archive → unknown, not "false"');
      else assert.equal(typeof t.news_confirmed, 'boolean');
    }
  }

  // Causality: a shorter run gives the same trades for the shared period
  const shortTo = from + 5 * 86_400_000;
  const r2 = await runBacktest(db, { sourceId: src.id, from, to: shortTo, rrList: [2], costs: { spread: 0.3, slippage: 0.1, commissionPerUnit: 7 }, size: 0.01 });
  const long2 = (await repo.listTrades(db, r.sessions.find((x) => x.rr === 2)!.backtestSessionId)).filter((t) => Number(t.entry_ms) <= shortTo);
  const short2 = await repo.listTrades(db, r2.sessions[0].backtestSessionId);
  const key = (t: Record<string, unknown>) => `${t.entry_ms}|${t.entry_price}|${t.stop_loss}|${t.exit_ms}|${t.exit_reason}`;
  assert.deepEqual(short2.map(key), long2.map(key));

  // The step-by-step replay engine produces the same setups as the backtest runner
  const sv = (await repo.listStrategyVersions(db)).find((x) => x.adapter_key === 'snr_h4h1_m15')!;
  const rp = await createReplaySession(db, { sourceId: src.id, timeframe: 'M15', startTime: from, strategyVersionId: sv.id });
  const replaySetups: number[] = [];
  for (let k = 0; k < 6; k++) {
    const out = await stepReplay(db, rp.id, { count: 50, manual: true, fetchImpl: fakeFetch });
    assert.deepEqual(out.violations, []);
    replaySetups.push(...out.events.filter((e) => e.event_type === 'SETUP_CONFIRMED').map((e) => e.event_time));
  }
  const until = from + 300 * 15 * 60_000;
  const btSetups = [...new Set(events.filter((e) => e.type === 'SETUP_CONFIRMED' && Number(e.et) <= until).map((e) => Number(e.et)))].sort((a, b) => a - b);
  assert.ok(btSetups.length > 0, 'comparison window must contain setups');
  assert.deepEqual(replaySetups, btSetups);
  const a = await analytics(db, r.sessions[0].backtestSessionId);
  assert.equal(a.overall!.totalTrades, r.sessions[0].trades);
});

test('12. SNR backtest with fixed $10 risk per trade: SL loss ≈ $10 + costs, TP win ≈ RR × $10', async () => {
  const src = (await repo.listSources(db)).find((s) => s.name === 'TEST SNR zigzag')!;
  const cov = (await repo.dataCoverage(db)).find((c) => c.source_id === src.id && c.timeframe === 'M15')!;
  const from = cov.first + 5 * 86_400_000, to = cov.last - 2 * 86_400_000;
  const r = await runBacktest(db, { sourceId: src.id, from, to, riskUsd: 10, rrList: [2], costs: { spread: 0.3, slippage: 0.1, commissionPerUnit: 7 } });
  assert.equal(r.riskUsd, 10);
  const trades = await repo.listTrades(db, r.sessions[0].backtestSessionId);
  assert.ok(trades.length > 0);
  for (const t of trades) {
    const sr = t.setup_reason as { lot: number; risk_usd: number };
    assert.ok(Math.abs(sr.risk_usd - 10) < 0.05, `planned risk ${sr.risk_usd}`);
    const pnl = Number(t.pnl);
    if (t.exit_reason === 'sl') assert.ok(pnl < -10 && pnl > -12, `SL loss ${pnl}`);
    if (t.exit_reason === 'tp') assert.ok(pnl > 19 && pnl <= 20, `TP win ${pnl}`);
  }
  // deleting a run removes its sessions, trades and signal events
  const ids = r.sessions.map((x) => x.backtestSessionId);
  assert.deepEqual((await repo.deleteBacktestSessions(db, ids)).sort(), [...ids].sort());
  assert.equal((await repo.listTrades(db, ids[0])).length, 0);
  const left = await db.query<{ n: number }>(`select count(*)::int as n from market_events where backtest_session_id = any($1::uuid[])`, [ids]);
  assert.equal(left[0].n, 0);
});
