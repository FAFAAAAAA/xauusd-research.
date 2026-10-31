// Unit tests for the SNR H4/H1 → M15 strategy (v0.1). All candles are SYNTHETIC (year 2030), not market history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCandles } from '../src/lib/core/timeframes';
import { runStrategyGuarded, type StrategyEventDraft } from '../src/lib/core/strategy/adapter';
import { atrSeries, computeSnrView, findPivots, snrAdapter, SNR_DEFAULTS, trendFromPivots } from '../src/lib/core/strategy/snr';
import { getAdapter } from '../src/lib/core/strategy/registry';
import { TIMEFRAME_MS, type Candle, type Timeframe } from '../src/lib/core/types';
import { zigzag } from './helpers/zigzag';

const M15 = 15 * 60_000;
const T0 = Date.UTC(2030, 0, 7, 0, 0);

/** Same loop the backtest service uses: at each M15 close only closed H1/H4 candles are visible. */
function walk(m15: Candle[]) {
  const h1 = aggregateCandles(m15, 'M15', 'H1', 'utc', false);
  const h4 = aggregateCandles(m15, 'M15', 'H4', 'utc', false);
  const state: Record<string, unknown> = {};
  const out: Array<StrategyEventDraft & { now: number }> = [];
  for (let i = 0; i < m15.length; i++) {
    const now = m15[i].time + M15;
    const closed = (a: Candle[], tf: Timeframe) => a.filter((c) => c.time + TIMEFRAME_MS[tf] <= now).slice(-400);
    const res = runStrategyGuarded(snrAdapter, {
      mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: m15.slice(Math.max(0, i - 499), i + 1), now, zones: [],
      news: { archiveAvailable: false, items: [], upcoming: [] }, htf: { H1: closed(h1, 'H1'), H4: closed(h4, 'H4') }, params: {}, state,
    });
    assert.deepEqual(res.violations, []);
    for (const e of res.events) out.push({ ...e, now });
  }
  return out;
}

test('snr: registered and needs H1+H4', () => {
  assert.equal(getAdapter('snr_h4h1_m15'), snrAdapter);
  assert.deepEqual(snrAdapter.requiredTimeframes, ['H1', 'H4']);
});

test('snr: pivots are confirmed only after n closed candles (no repaint)', () => {
  const c = [1, 2, 5, 2, 1].map((h, i) => ({ time: i, open: h, high: h, low: h - 0.5, close: h }));
  assert.equal(findPivots(c.slice(0, 4), 2).filter((p) => p.type === 'high').length, 0); // only 1 right candle → not yet
  const ph = findPivots(c, 2).filter((p) => p.type === 'high');
  assert.equal(ph.length, 1); assert.equal(ph[0].index, 2);
});

test('snr: ATR (Wilder) is NaN before warm-up then positive', () => {
  const a = atrSeries(zigzag(30, 1), 14);
  assert.ok(Number.isNaN(a[12])); assert.ok(a[13] > 0 && a[29] > 0);
});

test('snr: H4 swing trend bullish on rising zigzag, bearish on falling', () => {
  for (const [dir, want] of [[1, 'bullish'], [-1, 'bearish']] as const) {
    const h4 = aggregateCandles(zigzag(192 * 8, dir), 'M15', 'H4', 'utc', false);
    assert.equal(trendFromPivots(findPivots(h4, 2)).trend, want);
    const v = computeSnrView(h4, aggregateCandles(zigzag(192 * 8, dir), 'M15', 'H1', 'utc', false), SNR_DEFAULTS);
    assert.ok(v.zones.length > 0);
    for (const z of v.zones) assert.ok(z.low < z.high);
  }
});

test('snr: uptrend → only BUY setups at support, SL below zone by 0.5 ATR; NEAR precedes TOUCH', () => {
  const ev = walk(zigzag(192 * 10, 1));
  const setups = ev.filter((e) => e.type === 'SETUP_CONFIRMED');
  assert.ok(setups.length >= 3, `expected setups, got ${setups.length}`);
  for (const s of setups) {
    assert.equal(s.details?.side, 'long');
    assert.equal(s.zone?.kind, 'support');
    assert.ok((s.details!.stop_loss as number) < s.zone!.low);
    const gap = s.zone!.low - (s.details!.stop_loss as number);
    assert.ok(Math.abs(gap - 0.5 * (s.details!.atr_m15 as number)) < 1e-3);
    assert.ok(s.candleTime + M15 === s.now, 'event belongs to the candle that just closed');
  }
  assert.ok(ev.some((e) => e.type === 'SNR_NEAR'));
});

test('snr: downtrend → only SELL setups at resistance', () => {
  const setups = walk(zigzag(192 * 10, -1)).filter((e) => e.type === 'SETUP_CONFIRMED');
  assert.ok(setups.length >= 3);
  for (const s of setups) { assert.equal(s.details?.side, 'short'); assert.equal(s.zone?.kind, 'resistance'); assert.ok((s.details!.stop_loss as number) > s.zone!.high); }
});

test('snr: a zone is not re-entered while price stays on it (needs to move away first)', () => {
  const ev = walk(zigzag(192 * 10, 1)).filter((e) => e.type === 'SETUP_CONFIRMED');
  for (let i = 1; i < ev.length; i++) {
    const a = ev[i - 1], b = ev[i];
    const same = a.zone!.low === b.zone!.low && a.zone!.high === b.zone!.high;
    if (same) assert.ok(b.now - a.now > M15, 'consecutive candles on the same zone must not both fire');
  }
});

test('snr: causality — events up to time T do not change when later data exists', () => {
  const full = zigzag(192 * 10, 1);
  const cut = full.length - 192 * 3;
  const a = walk(full.slice(0, cut)).map((e) => JSON.stringify(e));
  const b = walk(full).filter((e) => e.now <= full[cut - 1].time + M15).map((e) => JSON.stringify(e));
  assert.deepEqual(b, a);
});

test('guard: unclosed higher-timeframe candles are removed before the strategy sees them', () => {
  let seen: readonly Candle[] = [];
  const spy = { ...snrAdapter, evaluate: (ctx: Parameters<typeof snrAdapter.evaluate>[0]) => { seen = ctx.htf!.H4!; return []; } };
  const h4 = [0, 1, 2].map((i) => ({ time: T0 + i * 4 * 3_600_000, open: 1, high: 1, low: 1, close: 1 }));
  const now = T0 + 9 * 3_600_000; // third H4 candle (08:00–12:00) is still forming
  runStrategyGuarded(spy, { mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: [{ time: now - M15, open: 1, high: 1, low: 1, close: 1 }], now, zones: [],
    news: { archiveAvailable: false, items: [], upcoming: [] }, htf: { H4: h4 }, params: {}, state: {} });
  assert.equal(seen.length, 2);
});

test('snr+snd (owner TradingView indicator): registered, no look-ahead, signals carry a valid stop', async () => {
  const { snrSndAdapter, htfLevels, SNRSND_DEFAULTS } = await import('../src/lib/core/strategy/snrsnd');
  assert.equal(getAdapter('snr_snd_mtf_v1'), snrSndAdapter);
  const m15 = zigzag(192 * 12, 1);
  const h1 = aggregateCandles(m15, 'M15', 'H1', 'utc', false), h4 = aggregateCandles(m15, 'M15', 'H4', 'utc', false);
  const L = htfLevels(h4, SNRSND_DEFAULTS);
  assert.ok(L.emaFast > L.emaSlow, 'uptrend → EMA50 above EMA200');
  const state: Record<string, unknown> = {};
  for (let i = 0; i < m15.length; i++) {
    const now = m15[i].time + M15;
    const res = runStrategyGuarded(snrSndAdapter, { mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: m15.slice(Math.max(0, i - 499), i + 1), now, zones: [],
      news: { archiveAvailable: false, items: [], upcoming: [] }, htf: { H1: h1.filter((c) => c.time + 3_600_000 <= now), H4: h4.filter((c) => c.time + 14_400_000 <= now) }, params: {}, state });
    assert.deepEqual(res.violations, []);
    for (const e of res.events) {
      const sl = e.details!.stop_loss as number;
      assert.ok(e.details!.side === 'long' ? sl < e.price : sl > e.price);
    }
  }
});
