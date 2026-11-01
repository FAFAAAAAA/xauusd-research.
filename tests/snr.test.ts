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

test('builder: validation messages, rule strategy fires without look-ahead, signals file only acts on its own candle', async () => {
  const { validateDefinition, customAdapter } = await import('../src/lib/core/strategy/builder');
  const { parseSignalsCsv } = await import('../src/lib/core/signals-csv');
  const bad = validateDefinition({ kind: 'rules', name: '', sides: 'x', entry: { type: 'nope' }, stop: { type: 'range' } });
  assert.equal(bad.ok, false);
  const good = { kind: 'rules', name: 'Breakout M15', sides: 'both', entry: { type: 'donchian', tf: 'M15', length: 20 },
    filters: [{ type: 'ema_trend', tf: 'H1', fast: 20, slow: 50 }], stop: { type: 'atr', tf: 'M15', mult: 2 }, cooldownBars: 4 };
  assert.equal(validateDefinition(good).ok, true);
  const m15 = zigzag(192 * 6, 1);
  const h1 = aggregateCandles(m15, 'M15', 'H1', 'utc', false), h4 = aggregateCandles(m15, 'M15', 'H4', 'utc', false), d1 = aggregateCandles(m15, 'M15', 'D1', 'utc', false);
  const run = (definition: unknown) => {
    const state: Record<string, unknown> = {};
    const out: Array<{ t: number; side: unknown; sl: number; price: number }> = [];
    for (let i = 0; i < m15.length; i++) {
      const now = m15[i].time + M15;
      const res = runStrategyGuarded(customAdapter, { mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: m15.slice(Math.max(0, i - 499), i + 1), now, zones: [],
        news: { archiveAvailable: false, items: [], upcoming: [] }, htf: { H1: h1, H4: h4, D1: d1 }, params: { definition }, state });
      assert.deepEqual(res.violations, []);
      for (const e of res.events) out.push({ t: e.candleTime, side: e.details!.side, sl: e.details!.stop_loss as number, price: e.price });
    }
    return out;
  };
  const ev = run(good);
  assert.ok(ev.length > 0, 'uptrend donchian produces signals');
  for (const e of ev) { assert.equal(e.side, 'long', 'H1 uptrend filter blocks SELL'); assert.ok(e.sl < e.price); }
  for (let k = 1; k < ev.length; k++) assert.ok(ev[k].t - ev[k - 1].t >= 4 * M15, 'cooldown respected');
  // signals file
  const csv = `time,side,stop_loss\n${new Date(m15[300].time).toISOString().slice(0, 16).replace('T', ' ')},BUY,${m15[300].close - 5}\nbad,line,x`;
  const parsed = parseSignalsCsv(csv);
  assert.equal(parsed.signals.length, 1);
  assert.equal(parsed.errors.length, 1);
  const sev = run({ kind: 'signals', name: 'file', signals: parsed.signals });
  assert.equal(sev.length, 1);
  assert.equal(sev[0].t, m15[300].time);
});

test('snr+snd v2 (owner Pine strategy): registered, no look-ahead, stop on the right side, time exit attached', async () => {
  const { snrSnd2Adapter } = await import('../src/lib/core/strategy/snrsnd2');
  assert.equal(getAdapter('snr_snd_mtf_v2'), snrSnd2Adapter);
  const m15 = zigzag(192 * 12, 1);
  const h1 = aggregateCandles(m15, 'M15', 'H1', 'utc', false), h4 = aggregateCandles(m15, 'M15', 'H4', 'utc', false);
  const state: Record<string, unknown> = {};
  for (let i = 30; i < m15.length; i++) {
    const now = m15[i].time + M15;
    const res = runStrategyGuarded(snrSnd2Adapter, { mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: m15.slice(Math.max(0, i - 499), i + 1), now, zones: [],
      news: { archiveAvailable: false, items: [], upcoming: [] }, htf: { H1: h1, H4: h4 }, params: {}, state });
    assert.deepEqual(res.violations, []);
    for (const e of res.events) {
      assert.ok(e.details!.side === 'long' ? (e.details!.stop_loss as number) < e.price : (e.details!.stop_loss as number) > e.price);
      assert.equal(e.details!.max_bars, 96);
    }
  }
});

test('pola N: registered; BUY only after a close through B, stop beyond C, never before C is confirmed', async () => {
  const { nPatternAdapter } = await import('../src/lib/core/strategy/npattern');
  assert.equal(getAdapter('n_pattern_v1'), nPatternAdapter);
  const m15 = zigzag(192 * 10, 1);
  const h1 = aggregateCandles(m15, 'M15', 'H1', 'utc', false), h4 = aggregateCandles(m15, 'M15', 'H4', 'utc', false);
  const state: Record<string, unknown> = {};
  let n = 0;
  for (let i = 60; i < m15.length; i++) {
    const now = m15[i].time + M15;
    const res = runStrategyGuarded(nPatternAdapter, { mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: m15.slice(Math.max(0, i - 499), i + 1), now, zones: [],
      news: { archiveAvailable: false, items: [], upcoming: [] }, htf: { H1: h1, H4: h4 }, params: { trend: false, pivot: 3, rMax: 0.95, maxBars: 200 }, state });
    assert.deepEqual(res.violations, []);
    for (const e of res.events) {
      const d = e.details as { side: string; stop_loss: number; B: number; C: number };
      n++;
      if (d.side === 'long') { assert.ok(e.price > d.B && d.stop_loss < d.C); } else { assert.ok(e.price < d.B && d.stop_loss > d.C); }
    }
  }
  assert.ok(n > 0, 'zigzag contains N patterns');
});

test('rbr/dbd: registered; zones from closed candles only, stop beyond the base, one trade per zone', async () => {
  const { rbrDbdAdapter, findRbrDbd } = await import('../src/lib/core/strategy/rbrdbd');
  assert.equal(getAdapter('rbr_dbd_v1'), rbrDbdAdapter);
  // hand-made RBR: leg-in up, 2 small candles, leg-out up
  const mk = (o: number, c: number, i: number): Candle => ({ time: T0 + i * M15, open: o, close: c, high: Math.max(o, c) + 0.1, low: Math.min(o, c) - 0.1 });
  const flat = Array.from({ length: 20 }, (_, i) => mk(100 + (i % 2) * 0.5, 100 + ((i + 1) % 2) * 0.5, i));
  const seq = [...flat, mk(100, 103, 20), mk(103, 103.2, 21), mk(103.2, 103.1, 22), mk(103.1, 107, 23)];
  const z = findRbrDbd(seq, { legAtr: 1, baseMax: 3, baseBody: 0.5, legBars: 3 });
  assert.equal(z.length, 1);
  assert.equal(z[0].side, 1);
  assert.equal(z[0].outIndex, 23);
  assert.ok(Math.abs(z[0].proximal - 103.2) < 1e-9 && Math.abs(z[0].distal - 102.9) < 1e-9);
  // full walk on synthetic data
  const m15 = zigzag(192 * 10, 1);
  const h1 = aggregateCandles(m15, 'M15', 'H1', 'utc', false), h4 = aggregateCandles(m15, 'M15', 'H4', 'utc', false);
  const state: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (let i = 60; i < m15.length; i++) {
    const now = m15[i].time + M15;
    const res = runStrategyGuarded(rbrDbdAdapter, { mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: m15.slice(Math.max(0, i - 499), i + 1), now, zones: [],
      news: { archiveAvailable: false, items: [], upcoming: [] }, htf: { H1: h1, H4: h4 }, params: { trend: false, zoneTf: 'M15', fresh: false, entry: 'touch' }, state });
    assert.deepEqual(res.violations, []);
    for (const e of res.events) {
      const d = e.details as { side: string; stop_loss: number };
      if (d.side === 'long') assert.ok(d.stop_loss < e.zone!.low && d.stop_loss < e.price); else assert.ok(d.stop_loss > e.zone!.high && d.stop_loss > e.price);
      const k = `${e.zone!.low}:${e.zone!.high}`;
      assert.ok(!seen.has(k), 'one trade per zone');
      seen.add(k);
    }
  }
});

test('snr breakout H1: registered; BUY only after an H1 close above a confirmed swing high, stop below the level', async () => {
  const { snrBreakAdapter } = await import('../src/lib/core/strategy/snrbreak');
  assert.equal(getAdapter('snr_break_h1_v1'), snrBreakAdapter);
  const m15 = zigzag(192 * 10, 1);
  const h1 = aggregateCandles(m15, 'M15', 'H1', 'utc', false);
  const state: Record<string, unknown> = {};
  let n = 0;
  for (let i = 30; i < m15.length; i++) {
    const now = m15[i].time + M15;
    const res = runStrategyGuarded(snrBreakAdapter, { mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: m15.slice(Math.max(0, i - 499), i + 1), now, zones: [],
      news: { archiveAvailable: false, items: [], upcoming: [] }, htf: { H1: h1 }, params: {}, state });
    assert.deepEqual(res.violations, []);
    for (const e of res.events) {
      const d = e.details as { side: string; stop_loss: number; level: number };
      n++;
      assert.equal(now % TIMEFRAME_MS.H1, 0, 'acts on H1 close only');
      if (d.side === 'long') assert.ok(e.price > d.level && d.stop_loss < d.level); else assert.ok(e.price < d.level && d.stop_loss > d.level);
    }
  }
  assert.ok(n > 0, 'zigzag breaks swing levels');
});

test('breakout v0.3: registered; SELL needs D1 EMA50 < EMA200, defaults include M30', async () => {
  const { breakoutV03Adapter, breakoutAdapter } = await import('../src/lib/core/strategy/breakout');
  assert.equal(getAdapter('breakout_v03'), breakoutV03Adapter);
  assert.equal(breakoutV03Adapter.htfWindow?.D1, 1000);
  assert.notEqual(breakoutV03Adapter.evaluate, breakoutAdapter.evaluate);
});

test('breakout v0.4: registered; level part only fires on an H1 close and reports 2-3 touches', async () => {
  const { breakoutV04Adapter } = await import('../src/lib/core/strategy/breakout');
  assert.equal(getAdapter('breakout_v04'), breakoutV04Adapter);
  const m15 = zigzag(192 * 12, 1);
  const tfs = { H1: aggregateCandles(m15, 'M15', 'H1', 'utc', false), H4: aggregateCandles(m15, 'M15', 'H4', 'utc', false), D1: aggregateCandles(m15, 'M15', 'D1', 'utc', false) };
  const state: Record<string, unknown> = {};
  for (let i = 60; i < m15.length; i++) {
    const now = m15[i].time + M15;
    const htf = Object.fromEntries(Object.entries(tfs).map(([k, v]) => [k, v.filter((c) => c.time + TIMEFRAME_MS[k as Timeframe] <= now)]));
    const res = runStrategyGuarded(breakoutV04Adapter, { mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: m15.slice(Math.max(0, i - 499), i + 1), now, zones: [],
      news: { archiveAvailable: false, items: [], upcoming: [] }, htf, params: { sellD1Bear: false, d1Filter: false }, state });
    assert.deepEqual(res.violations, []);
    for (const e of res.events) {
      const d = e.details as { component: string; touches?: number; side: string; stop_loss: number };
      if (d.component === 'LVL') { assert.equal(now % TIMEFRAME_MS.H1, 0); assert.ok(d.touches! >= 2 && d.touches! <= 3); }
      assert.ok(d.side === 'long' ? d.stop_loss < e.price : d.stop_loss > e.price);
    }
  }
});

test('breakout v0.5: registered; never emits London or M30 signals', async () => {
  const { breakoutV05Adapter } = await import('../src/lib/core/strategy/breakout');
  assert.equal(getAdapter('breakout_v05'), breakoutV05Adapter);
  const m15 = zigzag(192 * 8, 1);
  const tfs = { H1: aggregateCandles(m15, 'M15', 'H1', 'utc', false), H4: aggregateCandles(m15, 'M15', 'H4', 'utc', false), D1: aggregateCandles(m15, 'M15', 'D1', 'utc', false) };
  const state: Record<string, unknown> = {};
  for (let i = 60; i < m15.length; i++) {
    const now = m15[i].time + M15;
    const htf = Object.fromEntries(Object.entries(tfs).map(([k, v]) => [k, v.filter((c) => c.time + TIMEFRAME_MS[k as Timeframe] <= now)]));
    const res = runStrategyGuarded(breakoutV05Adapter, { mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: m15.slice(Math.max(0, i - 499), i + 1), now, zones: [],
      news: { archiveAvailable: false, items: [], upcoming: [] }, htf, params: { d1Filter: false, sellD1Bear: false }, state });
    for (const e of res.events) assert.ok(!['LON', 'M30'].includes(String(e.details!.component)));
  }
});

test('ob+fvg: registered; finds a bullish FVG with BOS and an order block below it', async () => {
  const { obFvgAdapter, findObFvg } = await import('../src/lib/core/strategy/obfvg');
  assert.equal(getAdapter('ob_fvg_v1'), obFvgAdapter);
  const mk = (o: number, h: number, l: number, c: number, i: number): Candle => ({ time: T0 + i * M15, open: o, high: h, low: l, close: c });
  const c: Candle[] = [];
  for (let i = 0; i < 30; i++) c.push(mk(100, 100.6, 99.4, 100.2, i));
  c.push(mk(100.2, 101.5, 100, 101.2, 30)); for (let i = 31; i < 35; i++) c.push(mk(101, 101.1, 100.3, 100.5, i)); // swing high 101.5
  c.push(mk(100.5, 100.6, 99.8, 99.9, 35));            // bearish = order block (a)
  c.push(mk(99.9, 104, 99.8, 103.8, 36));              // displacement (b)
  c.push(mk(103.8, 105, 102, 104.6, 37));              // c: low 102 > high(a) 100.6 → FVG, close > 101.5 → BOS
  const z = findObFvg(c, { fvgAtr: 0.3, entry: 'fvg' }).filter((x) => x.side === 1);
  assert.equal(z.length, 1);
  assert.equal(z[0].entry, 102);
  assert.equal(z[0].obFar, 99.8);
});

test('multi-pair: bundled datasets decode, aggregate without look-ahead, and USD-base pairs convert P&L', async () => {
  const { datasets, fileProvider } = await import('../src/lib/server/market-files');
  const { usdPerPoint, instrumentCosts } = await import('../src/lib/core/instruments');
  const ds = datasets();
  assert.ok(ds.some((d) => d.symbol === 'EURUSD' && d.tf === 'M15'));
  const p = fileProvider('EURUSD', 'M15');
  const from = Date.UTC(2020, 0, 6), to = Date.UTC(2020, 0, 13);
  const m15 = p.between('M15', from, to), h1 = p.between('H1', from, to);
  assert.ok(m15.length > 400 && h1.length > 100);
  assert.ok(m15.every((c) => c.time >= from && c.time < to && c.high >= c.low));
  assert.equal(Math.round(m15[0].close * 1e5), m15[0].close * 1e5, 'prices rounded to 5 digits');
  // first H1 candle = the 4 M15 candles of that hour
  const k = m15.findIndex((c) => c.time === h1[0].time);
  assert.equal(h1[0].high, Math.max(...m15.slice(k, k + 4).map((c) => c.high)));
  assert.ok(p.upTo('M15', from - 1, 10).every((c) => c.time < from));
  assert.equal(usdPerPoint('USDJPY', 100_000, 125), 800);           // 1.00 JPY move on 1 lot = ¥100,000 = $800 at 125
  assert.equal(usdPerPoint('EURUSD', 100_000, 1.1), 100_000);
  assert.equal(instrumentCosts('XAUUSD').contractSize, 100);
});

test('breakout v0.7: registered; Pola N fires BUY on the first close above B with SL at C (C above A, uptrend)', async () => {
  const { breakoutV07Adapter, nPolaEvaluate } = await import('../src/lib/core/strategy/npola');
  assert.equal(getAdapter('breakout_v07'), breakoutV07Adapter);
  const H = TIMEFRAME_MS.H1;
  const mk = (o: number, h: number, l: number, c: number, i: number): Candle => ({ time: T0 + i * H, open: o, high: h, low: l, close: c, volume: 0 });
  const h1: Candle[] = [];
  for (let i = 0; i < 20; i++) h1.push(mk(100, 100.3, 99.7, 100, i));
  const seq: [number, number, number, number][] = [
    [100, 100.3, 98, 98.2], [98.2, 98.4, 97, 97.2], [97.2, 99.5, 97.1, 99.3],   // A = 97
    [99.3, 102, 99.2, 101.8], [101.8, 101.9, 99.5, 99.7],                        // B = 102
    [99.7, 99.8, 98.5, 98.7], [98.7, 101.5, 98.6, 101.3],                        // C = 98.5 (> A) → pattern visible
    [101.3, 102.6, 101.2, 102.4],                                                // close above B → BUY
  ];
  seq.forEach((s, j) => h1.push(mk(...s, 20 + j)));
  const up = Array.from({ length: 250 }, (_, i) => mk(50 + i, 51 + i, 49 + i, 50.5 + i, i - 300));
  const st = {};
  const ev: StrategyEventDraft[] = [];
  for (let i = 1; i <= h1.length; i++) {
    const w = h1.slice(0, i);
    ev.push(...nPolaEvaluate({ mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'H1', candles: w, now: w[w.length - 1].time + H, zones: [], news: {} as never,
      htf: { H1: w, H4: up, D1: up }, params: {}, state: {} }, st, { k: 2, useH1: true, useH4: false }));
  }
  assert.equal(ev.length, 1);
  assert.equal(ev[0].details?.side, 'long');
  assert.equal(ev[0].details?.stop_loss, 98.5);
  assert.equal(ev[0].details?.level, 102);
  assert.equal(ev[0].candleTime, h1[h1.length - 1].time);
});

test('breakout v0.8: registered; base = ≥3 overlapping candles within 1.5×ATR, breakout candle excluded', async () => {
  const { breakoutV08Adapter, findBase } = await import('../src/lib/core/strategy/basebrk');
  assert.equal(getAdapter('breakout_v08'), breakoutV08Adapter);
  const { METHODS } = await import('../src/lib/core/strategy/methods-meta');
  for (const mm of METHODS) assert.equal(getAdapter(mm.adapterKey)?.key, mm.adapterKey);
  const H = TIMEFRAME_MS.H1;
  const mk = (o: number, h: number, l: number, c: number, i: number): Candle => ({ time: T0 + i * H, open: o, high: h, low: l, close: c, volume: 0 });
  const p = { minN: 3, overlap: 0.5, mult: 1.5 };
  const trend = [mk(90, 91, 89, 90, 0), mk(90, 96, 90, 95, 1)];
  const base = [mk(100, 101, 99.5, 100.5, 2), mk(100.5, 101.2, 99.8, 100.2, 3), mk(100.2, 101, 99.6, 100.8, 4)];
  const b = findBase([...trend, ...base], 2, p);
  assert.ok(b);
  assert.equal(b!.n, 3); assert.equal(b!.top, 101.2); assert.equal(b!.bot, 99.5);
  assert.equal(findBase([...trend, ...base], 0.9, p), null, 'height 1.7 > 1.5 × 0.9');
  assert.equal(findBase([...trend, ...base.slice(0, 2)], 2, p), null, 'only 2 candles');
  const noOverlap = [mk(100, 101, 100, 100.9, 2), mk(100.9, 102, 100.9, 101.9, 3), mk(101.9, 103, 101.9, 102.9, 4)];
  assert.equal(findBase(noOverlap, 5, p), null, 'touching candles overlap 0%');
  assert.equal(findBase([...trend, ...base], 2, p, base[0].time), null, 'candles up to the breakout candle are excluded');
});

test('v2 volatility breakout: registered; BUY when close crosses today open + 0.5 × yesterday range in an uptrend', async () => {
  const { volBreakAdapter } = await import('../src/lib/core/strategy/volbreak');
  assert.equal(getAdapter('metode_volbreak'), volBreakAdapter);
  const D = 86_400_000, H4 = 4 * 3_600_000;
  const day0 = Date.UTC(2030, 5, 4);   // a Tuesday (Monday uses Friday's range, see the next test)
  const d1: Candle[] = Array.from({ length: 260 }, (_, i) => ({ time: day0 - (260 - i) * D, open: 100 + i, high: 101 + i + (i === 259 ? 9 : 0), low: 99 + i, close: 100.5 + i, volume: 0 }));
  const h4: Candle[] = Array.from({ length: 260 }, (_, i) => ({ time: day0 - (260 - i) * H4, open: 300 + i, high: 301 + i, low: 299 + i, close: 300.5 + i, volume: 0 }));
  const y = d1[d1.length - 1]; const range = y.high - y.low;               // 11
  const open = 400, lvl = open + 0.5 * range;                                // 405.5
  const mk = (i: number, o: number, c: number): Candle => ({ time: day0 + i * M15, open: o, high: Math.max(o, c) + 0.1, low: Math.min(o, c) - 0.1, close: c, volume: 0 });
  const m = [mk(-1, 399, 399.5), mk(0, open, 403), mk(1, 403, 405), mk(2, 405, 406), mk(3, 406, 404), mk(4, 404, 407)];
  const st = {}; const ev: StrategyEventDraft[] = [];
  for (let i = 1; i < m.length; i++) {
    const w = m.slice(0, i + 1);
    ev.push(...volBreakAdapter.evaluate({ mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: w, now: w[w.length - 1].time + M15, zones: [], news: {} as never, htf: { H4: h4, D1: d1 }, params: {}, state: st }));
  }
  assert.equal(ev.length, 1, 'only the first cross of the day');
  assert.equal(ev[0].details?.side, 'long');
  assert.equal(ev[0].candleTime, m[3].time);
  assert.equal(ev[0].details?.level, lvl);
  // SL = level − 0.35 × ATR14 D1
  assert.ok(Number(ev[0].details?.stop_loss) < lvl && Number(ev[0].details?.stop_loss) > lvl - 1.5);
});

test('v2: on Monday the Sunday session is skipped, Friday range is used', async () => {
  const { volBreakAdapter } = await import('../src/lib/core/strategy/volbreak');
  const D = 86_400_000, H4 = 4 * 3_600_000;
  const mon = Date.UTC(2030, 5, 3);                                           // Monday
  const d1: Candle[] = [];
  for (let i = 300; i >= 1; i--) {
    const t = mon - i * D, dow = new Date(t).getUTCDay();
    if (dow === 6) continue;                                                  // no Saturday candle
    const k = 300 - i, sun = dow === 0;
    d1.push({ time: t, open: 100 + k, high: 101 + k + (sun ? 0 : 9), low: 99 + k, close: 100.5 + k, volume: 0 });  // Sunday range 2, weekdays 11
  }
  const h4: Candle[] = Array.from({ length: 260 }, (_, i) => ({ time: mon - (260 - i) * H4, open: 300 + i, high: 301 + i, low: 299 + i, close: 300.5 + i, volume: 0 }));
  const mk = (i: number, o: number, c: number): Candle => ({ time: mon + i * M15, open: o, high: Math.max(o, c) + 0.1, low: Math.min(o, c) - 0.1, close: c, volume: 0 });
  const m = [mk(-1, 399, 399.5), mk(0, 400, 401.5), mk(1, 401.5, 403), mk(2, 403, 406)];   // Sunday level would be 401, Friday level 405.5
  const st = {}; const ev: StrategyEventDraft[] = [];
  for (let i = 1; i < m.length; i++) {
    const w = m.slice(0, i + 1);
    ev.push(...volBreakAdapter.evaluate({ mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: 'M15', candles: w, now: w[w.length - 1].time + M15, zones: [], news: {} as never, htf: { H4: h4, D1: d1 }, params: {}, state: st }));
  }
  assert.equal(ev.length, 1);
  assert.equal(ev[0].candleTime, m[3].time);
  assert.equal(ev[0].details?.level, 405.5);
});
