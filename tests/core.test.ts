// Unit tests for framework-free core logic. All fixtures here are synthetic TEST data,
// not market history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatInTz, normalizeTimeframe, parseTimestamp, sessionOf, tzOffsetMinutes, zonedWallTimeToUtc } from '../src/lib/core/time';
import { parseOhlcCsv } from '../src/lib/core/csv';
import { aggregateCandles, bucketStart } from '../src/lib/core/timeframes';
import { runStrategyGuarded, type StrategyAdapter, type StrategyContext } from '../src/lib/core/strategy/adapter';
import { notConfiguredAdapter, testZoneProximityAdapter } from '../src/lib/core/strategy/registry';
import { eventAsOf, surpriseSentiment, type EconomicEventRecord } from '../src/lib/core/news';
import { validateWebhookPayload, safeEqual, SlidingWindowLimiter } from '../src/lib/core/webhook';
import { computeMetrics } from '../src/lib/core/metrics';
import { simulateTrade, DEFAULT_COSTS } from '../src/lib/core/tradesim';
import { buildEventMessage } from '../src/lib/core/telegram-format';
import { encryptSecret, decryptSecret, maskToken, signSession, verifySession } from '../src/lib/core/crypto';
import type { Candle } from '../src/lib/core/types';

const H = 3_600_000;
const T0 = Date.UTC(2030, 0, 7, 0, 0); // synthetic date, deliberately not a real market period

test('time: New York DST offsets are correct', () => {
  assert.equal(tzOffsetMinutes(Date.UTC(2019, 0, 15, 12), 'America/New_York'), -300); // EST
  assert.equal(tzOffsetMinutes(Date.UTC(2019, 6, 15, 12), 'America/New_York'), -240); // EDT
  assert.equal(tzOffsetMinutes(Date.UTC(2019, 6, 15, 12), 'Asia/Seoul'), 540);
  assert.equal(formatInTz(Date.UTC(2019, 6, 15, 14, 30), 'America/New_York'), '2019-07-15 10:30');
});

test('time: wall clock → UTC handles DST and fixed offsets', () => {
  assert.equal(zonedWallTimeToUtc(2019, 7, 15, 10, 0, 0, 'America/New_York'), Date.UTC(2019, 6, 15, 14));
  assert.equal(zonedWallTimeToUtc(2019, 1, 15, 10, 0, 0, 'America/New_York'), Date.UTC(2019, 0, 15, 15));
  assert.equal(zonedWallTimeToUtc(2019, 7, 15, 10, 0, 0, 'UTC+3'), Date.UTC(2019, 6, 15, 7));
  // fall-back overlap 2019-11-03 01:30 NY → earlier instant (EDT)
  assert.equal(zonedWallTimeToUtc(2019, 11, 3, 1, 30, 0, 'America/New_York'), Date.UTC(2019, 10, 3, 5, 30));
});

test('time: sessions and TradingView interval normalization', () => {
  assert.equal(sessionOf(Date.UTC(2019, 6, 15, 14)), 'new_york');
  assert.equal(sessionOf(Date.UTC(2019, 6, 15, 9)), 'london');
  assert.equal(sessionOf(Date.UTC(2019, 6, 15, 2)), 'asia');
  assert.equal(normalizeTimeframe('60'), 'H1');
  assert.equal(normalizeTimeframe('240'), 'H4');
  assert.equal(normalizeTimeframe('D'), 'D1');
  assert.equal(normalizeTimeframe('7'), null);
  assert.equal(parseTimestamp('2019-07-15T10:00:00'), null, 'ISO without zone must be rejected');
  assert.equal(parseTimestamp('2019-07-15T10:00:00Z'), Date.UTC(2019, 6, 15, 10));
  assert.equal(parseTimestamp(1563184800), 1563184800000);
});

test('csv: TradingView, MetaTrader and Dukascopy formats', () => {
  const tv = parseOhlcCsv('time,open,high,low,close,Volume\n1893974400,10,12,9,11,5\n1893978000,11,13,10,12,6\n', { fileTimezone: 'UTC' });
  assert.equal(tv.candles.length, 2);
  assert.equal(tv.candles[0].time, 1893974400000);

  const mt = parseOhlcCsv('2030.01.07,00:00,10,12,9,11,5\n2030.01.07,01:00,11,13,10,12,6', { fileTimezone: 'UTC+2' });
  assert.equal(mt.candles[0].time, Date.UTC(2030, 0, 6, 22));

  const duk = parseOhlcCsv('Gmt time,Open,High,Low,Close,Volume\n07.01.2030 00:00:00.000,10,12,9,11,5', { fileTimezone: 'UTC' });
  assert.equal(duk.candles[0].time, T0);
});

test('csv: invalid rows are reported, not fixed; duplicates removed', () => {
  const r = parseOhlcCsv('time,open,high,low,close\n2030-01-07T00:00:00Z,10,9,8,9\n2030-01-07T01:00:00Z,abc,1,1,1\n2030-01-07T02:00:00Z,10,11,9,10\n2030-01-07T02:00:00Z,10,11,9,10', { fileTimezone: 'UTC' });
  assert.equal(r.candles.length, 1);
  assert.equal(r.issues.length, 3);
});

test('timeframes: aggregation keeps only complete buckets', () => {
  const m: Candle[] = [];
  for (let i = 0; i < 90; i++) m.push({ time: T0 + i * 60_000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i });
  const h1 = aggregateCandles(m, 'M1', 'H1');
  assert.equal(h1.length, 1, 'second hour is incomplete and must be dropped');
  assert.deepEqual([h1[0].open, h1[0].high, h1[0].low, h1[0].close], [100, 160, 99, 159.5]);
  // NY-close daily alignment: 17:00 New York (EDT → 21:00 UTC)
  assert.equal(bucketStart(Date.UTC(2019, 6, 16, 10), 'D1', 'ny_close'), Date.UTC(2019, 6, 15, 21));
});

function ctx(candles: Candle[], extra: Partial<StrategyContext> = {}): StrategyContext {
  const last = candles[candles.length - 1];
  return {
    mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'H1', candles, now: last.time + H, zones: [],
    news: { archiveAvailable: false, items: [], upcoming: [] }, params: {}, state: {}, ...extra,
  };
}

test('strategy: not-configured adapter never emits events', () => {
  const c: Candle[] = [{ time: T0, open: 10, high: 11, low: 9, close: 10 }];
  assert.equal(notConfiguredAdapter.configured, false);
  assert.deepEqual(runStrategyGuarded(notConfiguredAdapter, ctx(c)).events, []);
});

test('strategy guard: future zones/news hidden and look-ahead output dropped', () => {
  let seenZones = -1, seenNews = -1;
  const cheater: StrategyAdapter = {
    key: 'x', name: 'x', configured: true, testOnly: true, warmupCandles: 0,
    evaluate(c) {
      seenZones = c.zones.length; seenNews = c.news.items.length;
      return [{ type: 'SNR_NEAR', candleTime: c.candles[c.candles.length - 1].time + H, price: 1 }];
    },
  };
  const c: Candle[] = [{ time: T0, open: 10, high: 11, low: 9, close: 10 }];
  const r = runStrategyGuarded(cheater, ctx(c, {
    zones: [{ kind: 'support', low: 9, high: 9.5, validFrom: T0 + 10 * H, origin: 'test' }],
    news: { archiveAvailable: true, upcoming: [], items: [{ kind: 'article', id: 'a', title: 't', category: 'OTHER', availableAt: T0 + 5 * H }] },
  }));
  assert.equal(seenZones, 0);
  assert.equal(seenNews, 0);
  assert.equal(r.events.length, 0);
  assert.equal(r.violations.length, 1);
});

test('TEST adapter is edge-triggered (no repeat while state unchanged)', () => {
  const zone = { id: 'z1', kind: 'support' as const, low: 95, high: 96, validFrom: 0, origin: 'test' as const };
  const state = {};
  const mk = (i: number, low: number, close: number): Candle => ({ time: T0 + i * H, open: close, high: close + 0.5, low, close });
  const seq = [mk(0, 99, 100), mk(1, 96.8, 97), mk(2, 96.6, 96.9), mk(3, 95.5, 96.2), mk(4, 99, 100)];
  const out: string[] = [];
  const hist: Candle[] = [];
  for (const c of seq) {
    hist.push(c);
    const r = runStrategyGuarded(testZoneProximityAdapter, ctx(hist, { zones: [zone], params: { near_distance: 1.5 }, state }));
    out.push(...r.events.map((e) => e.type));
  }
  assert.deepEqual(out, ['SNR_NEAR', 'SNR_TOUCH']);
});

test('news: actual hidden until available; sentiment rule', () => {
  const e: EconomicEventRecord = {
    id: 'e', title: 'TEST CPI', category: 'US_CPI', currency: 'USD', impact: 'high', scheduledAt: T0 + 12 * H,
    scheduleAvailableAt: T0 - 48 * H, forecast: 2.0, previous: 1.9, actual: 2.3, actualAvailableAt: T0 + 12 * H + 60_000,
    sourceUrl: null, provider: 'TEST',
  };
  assert.equal(eventAsOf(e, T0 - 72 * H), null, 'schedule unknown → hidden');
  assert.equal(eventAsOf(e, T0 + 12 * H)!.actual, null, 'at release minute, actual not yet available');
  assert.equal(eventAsOf(e, T0 + 13 * H)!.actual, 2.3);
  assert.equal(surpriseSentiment(e).label, 'Bearish');
  assert.equal(surpriseSentiment({ ...e, category: 'UNEMPLOYMENT' }).label, 'Bullish');
  assert.equal(surpriseSentiment({ ...e, category: 'FOMC' }).label, 'Unknown');
  assert.equal(surpriseSentiment({ ...e, forecast: null }).label, 'Unknown');
  assert.ok(surpriseSentiment(e).confidence! <= 0.6);
});

test('webhook: validation, freshness, secret compare, limiter', () => {
  const now = Date.UTC(2030, 0, 7, 12);
  const good = {
    secret: 's', event_id: 'tv-1', symbol: 'OANDA:XAUUSD', timeframe: '60', event_type: 'SNR_NEAR', timestamp: new Date(now - 60_000).toISOString(),
    price: 2000.5, zone: { low: 1995, high: 1998, kind: 'support' }, strategy_version: 'snr-dev', source: 'tradingview', mode: 'LIVE',
  };
  const ok = validateWebhookPayload(good, now);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.timeframe, 'H1');
  const bad = validateWebhookPayload({ ...good, mode: 'BACKTEST', symbol: 'EURUSD', zone: { low: 3, high: 2 } }, now);
  assert.equal(bad.ok, false);
  const old = validateWebhookPayload({ ...good, timestamp: '2019-07-15T10:00:00Z' }, now);
  assert.equal(old.ok, false, 'historical timestamps are not accepted on the live webhook');
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  const lim = new SlidingWindowLimiter(2, 1000);
  assert.deepEqual([lim.allow('a', 0), lim.allow('a', 1), lim.allow('a', 2), lim.allow('a', 1500)], [true, true, false, true]);
});

test('metrics: empty → null, computed values correct', () => {
  assert.equal(computeMetrics([]), null);
  const mk = (i: number, pnl: number, r: number) => ({ id: String(i), entryTime: i, exitTime: i + 1, pnl, pnlR: r, plannedRr: 2, timeframe: 'H1', session: null, newsConfirmed: null, zoneOutcome: null });
  const m = computeMetrics([mk(1, 200, 2), mk(2, -100, -1), mk(3, -100, -1), mk(4, 200, 2)])!;
  assert.equal(m.totalTrades, 4);
  assert.equal(m.winRate, 0.5);
  assert.equal(m.totalPnl, 200);
  assert.equal(m.profitFactor, 2);
  assert.equal(m.expectancy, 50);
  assert.equal(m.expectancyR, 0.5);
  assert.equal(m.maxDrawdown, 200);
  assert.equal(m.maxConsecutiveLosses, 2);
  assert.deepEqual(m.lossStreaks, [0, 0, 1]);
  // L L BE L W L → one streak of 3 (breakeven does not break it) and one streak of 1
  const s2 = computeMetrics([mk(1, -10, -1), mk(2, -10, -1), mk(3, -0.3, -0.03), mk(4, -10, -1), mk(5, 20, 2), mk(6, -10, -1)])!;
  assert.deepEqual(s2.lossStreaks, [0, 1, 0, 1]); assert.equal(s2.maxConsecutiveLosses, 3); assert.equal(s2.breakeven, 1); assert.equal(s2.losses, 4);
});

test('tradesim: costs and ambiguous TP/SL policy', () => {
  const c: Candle[] = [
    { time: T0, open: 100, high: 100.5, low: 99.5, close: 100 },
    { time: T0 + H, open: 100, high: 103, low: 98, close: 100 }, // both SL and TP inside
  ];
  const costs = { ...DEFAULT_COSTS, spread: 0.2, slippage: 0.1, commissionPerUnit: 7, contractSize: 100 };
  const intent = { side: 'long' as const, entryBarIndex: 0, stopLoss: 98.5, takeProfit: 102.5, size: 1 };
  const worst = simulateTrade(c, intent, { ...costs, ambiguityPolicy: 'worst' });
  assert.equal(worst.entryPrice, 100.3);
  assert.equal(worst.exitReason, 'ambiguous_worst');
  assert.ok(worst.pnl! < 0);
  assert.equal(simulateTrade(c, intent, { ...costs, ambiguityPolicy: 'skip' }).pnl, null);
  assert.ok(simulateTrade(c, intent, { ...costs, ambiguityPolicy: 'best' }).pnl! > 0);
});

test('telegram format: BACKTEST label is unmistakable and HTML is escaped', () => {
  const m = buildEventMessage({
    mode: 'BACKTEST', eventType: 'SNR_NEAR', timeframe: 'H1', eventTime: Date.UTC(2019, 6, 15, 14), price: 1412.3, zoneLow: 1405, zoneHigh: 1408,
    zoneKind: 'support', confirmations: { news: '<b>x</b>' }, status: 'TEST', displayTimezone: 'America/New_York', replaySessionId: 'abc',
    strategyLabel: 'test', isTest: true, linkUrl: 'http://localhost:3000',
  });
  assert.match(m.text, /BACKTEST 2019/);
  assert.match(m.text, /SIMULASI HISTORIS — BUKAN SINYAL LIVE/);
  assert.match(m.text, /Tanggal pasar:<\/b> 15\.07\.2019/);
  assert.match(m.text, /Waktu pasar:<\/b> 10:00/);
  assert.match(m.text, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(m.text, /Trend: Not configured/);
  assert.equal(m.button, undefined, 'non-https links are not attached');
  const live = buildEventMessage({ mode: 'LIVE', eventType: 'SNR_TOUCH', timeframe: 'H4', eventTime: 0, price: 1, zoneLow: 1, zoneHigh: 2, zoneKind: 'resistance', confirmations: {}, status: 's', displayTimezone: 'UTC', strategyLabel: 'v', linkUrl: 'https://x.y' });
  assert.match(live.text, /XAUUSD — LIVE/);
  assert.doesNotMatch(live.text, /BACKTEST/);
  assert.equal(live.button?.text, 'Buka Chart');
});

test('crypto: secret encryption round-trip, masking, sessions', async () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)));
  const blob = await encryptSecret('123456:ABCDEF-secret', key);
  assert.ok(!blob.includes('ABCDEF'));
  assert.equal(await decryptSecret(blob, key), '123456:ABCDEF-secret');
  assert.equal(maskToken('123456789:AAEabcdefghijklmnop'), '1234…mnop');
  const tok = await signSession(Date.now() + 1000, 'sec');
  assert.equal(await verifySession(tok, 'sec', Date.now()), true);
  assert.equal(await verifySession(tok, 'other', Date.now()), false);
  assert.equal(await verifySession(tok.replace(/.$/, 'x'), 'sec', Date.now()), false);
  assert.equal(await verifySession(tok, 'sec', Date.now() + 5000), false);
});

test('swap: rollover 21:00 UTC Mon–Fri, Wednesday counts 3, charged per lot per night', async () => {
  const { swapNights, simulateTrade } = await import('../src/lib/core/tradesim');
  const H = 3_600_000, mon = Date.UTC(2024, 0, 1); // Monday
  assert.equal(swapNights(mon + 10 * H, mon + 20 * H), 0);
  assert.equal(swapNights(mon + 10 * H, mon + 22 * H), 1);
  assert.equal(swapNights(mon + 10 * H, mon + 7 * 24 * H + 10 * H), 7); // a full week = 7 nights
  assert.equal(swapNights(mon + 2 * 24 * H + 20 * H, mon + 2 * 24 * H + 22 * H), 3); // Wednesday
  const bars = [0, 1, 2].map((d) => ({ time: mon + d * 24 * H + 12 * H, open: 100, high: d === 2 ? 103 : 100.5, low: 99.5, close: 100, volume: 0 }));
  const cost = { spread: 0, slippage: 0, commissionPerUnit: 0, ambiguityPolicy: 'worst' as const, contractSize: 100, swapLong: 20 };
  const r = simulateTrade(bars as any, { side: 'long', entryBarIndex: 0, stopLoss: 99, takeProfit: 102, size: 0.1 }, cost);
  assert.equal(r.costs.nights, 2);
  assert.ok(Math.abs((r.pnl ?? 0) - (20 - 2 * 20 * 0.1)) < 1e-9);
});

test('live trading: lot, journal validation, signal from alert extra, Telegram trade message', async () => {
  const J = await import('../src/lib/core/journal');
  const { buildEventMessage } = await import('../src/lib/core/telegram-format');
  const l = J.lotFor(10, 2650, 2645)!;            // $5 SL → $500 per lot → 0.02 lot
  assert.equal(l.lot, 0.02); assert.equal(l.risk, 10);
  assert.equal(J.lotFor(10, 2650, 2600)!.lot, 0); // too small → 0 (rounded down)
  assert.equal(J.lotFor(10, 2650, 2650), null);
  assert.equal(typeof J.cleanTrade({ side: 'BUY', entry: 100, sl: 101, tp: 102, lot: 0.1, openedAt: 1 }, 'x'), 'string');
  const t = J.cleanTrade({ strategy: 'v1', side: 'SELL', entry: 100, sl: 101, tp: 98, lot: 0.1, openedAt: 1, result: 'tp' }, 'x') as any;
  assert.equal(t.exit, 98); assert.equal(t.pnl, 19.3);   // 20 gross − commission 7 × 0.1 lot (SELL swap 0)
  const D = 86_400_000, mon = Date.UTC(2030, 5, 3);
  const tb = J.cleanTrade({ strategy: 'v2', side: 'BUY', entry: 100, sl: 99, tp: 102, lot: 0.1, openedAt: mon + 10 * 3_600_000, closedAt: mon + D + 10 * 3_600_000, result: 'tp' }, 'b') as any;
  assert.equal(tb.pnl, Math.round((20 - 0.7 - 4.747) * 100) / 100);   // one night of BUY swap 47.47 × 0.1
  const s = J.journalStats([{ ...t, pnl: 20 }, { ...t, id: 'y', result: 'sl', exit: 101, pnl: -10 }, { ...t, id: 'z', result: 'open', pnl: null }], 'v1');
  assert.equal(s.closed, 2); assert.equal(s.open, 1); assert.equal(s.winRate, 0.5); assert.equal(s.pnl, 10);
  assert.ok(Math.abs((s.avgR ?? 0) - 0.5) < 1e-9);
  assert.deepEqual(J.liveSignalFrom({ side: 'buy', sl: 95, tp: 110 }, 100), { side: 'BUY', entry: 100, sl: 95, tp: 110 });
  assert.equal(J.liveSignalFrom({ side: 'BUY', sl: 105, tp: 110 }, 100), null);
  assert.equal(J.liveSignalFrom(null, 100), null);
  assert.deepEqual(J.readLiveRisk({ capital: -5, riskPct: 2 }), { capital: 1000, riskPct: 2 });
  const msg = buildEventMessage({ mode: 'LIVE', eventType: 'SETUP_CONFIRMED', timeframe: 'M15', eventTime: Date.UTC(2026, 0, 5), price: 100, zoneLow: 99, zoneHigh: 99,
    zoneKind: 'resistance', confirmations: {}, status: 'x', displayTimezone: 'UTC', strategyLabel: 'v2 · Breakout volatilitas',
    trade: { side: 'BUY', entry: 100, sl: 95, tp: 110, lot: 0.02, riskUsd: 10, riskPct: 1 } });
  assert.match(msg.text, /BUY/); assert.match(msg.text, /SL:<\/b> <code>95\.00<\/code>/); assert.match(msg.text, /TP:<\/b> <code>110\.00<\/code>/); assert.match(msg.text, /Lot:<\/b> <code>0\.02<\/code>/);
  assert.deepEqual(msg.copy?.map((c) => c.value), ['100.00', '95.00', '110.00', '0.02']);
  assert.match(msg.text, /RR 1:2\.0/);
});

test('tradesim breakeven: SL moves to entry after +1R from the next bar; exit at entry is flagged', async () => {
  const { simulateTrade } = await import('../src/lib/core/tradesim');
  const c = (t: number, o: number, h: number, l: number, cl: number) => ({ time: t * 900_000, open: o, high: h, low: l, close: cl, volume: 0 });
  const bars = [c(0, 100, 100, 100, 100), c(1, 100, 100.5, 99.5, 100), c(2, 100, 101.2, 99.8, 101), c(3, 101, 101.1, 99.9, 100), c(4, 100, 103, 99, 102)];
  const cost = { spread: 0, slippage: 0, commissionPerUnit: 0, ambiguityPolicy: 'worst' as const, contractSize: 100 };
  const be = simulateTrade(bars, { side: 'long', entryBarIndex: 1, stopLoss: 99, takeProfit: 102, size: 1, breakevenR: 1 }, cost);
  assert.equal(be.exitTime, bars[3].time); assert.equal(be.exitPrice, 100); assert.equal(be.pnl, 0); assert.equal(be.costs.breakeven, true);
  const plain = simulateTrade(bars, { side: 'long', entryBarIndex: 1, stopLoss: 99, takeProfit: 102, size: 1 }, cost);
  assert.equal(plain.exitReason, 'ambiguous_worst');   // bar 4 touches both 99 and 102
});
