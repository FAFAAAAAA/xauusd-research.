import { aggregateCandles } from '../timeframes';
import type { Candle } from '../types';
import { findPivots, trendFromPivots } from './snr';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';

/**
 * Breakout v0.2 — chosen from research on XAUUSD M15 2018-2026 (see README "Strategi v0.2").
 * Three independent parts (each may hold one BUY and one SELL position at a time), all only WITH the big trend:
 *   TREND   BUY only if H4 close > EMA50(H4) > EMA200(H4) AND D1 close > EMA50(D1); SELL is the mirror.
 *   A  H1 Donchian: an H1 candle closes above the highest high of the previous 40 H1 candles (below the lowest low for SELL).
 *                   SL = close ∓ 2.5 × ATR14(H1).
 *   B  London breakout: range = 00:00–07:00 UTC; first M15 close above/below it between 07:00–11:00 UTC. SL = other side of range.
 *   C  New York breakout: range = 12:00–13:30 UTC; first M15 close above/below it between 13:30–16:00 UTC. SL = other side of range.
 *   D  (optional, more trades) M30 Donchian 10 with SL 2.5 × ATR14(M30).
 * Range breakouts only count when the range is 0.2–1.5 × ATR14(D1). TP = RR × risk (set by the backtest runner).
 * Entry happens at the next M15 open (engine). Only CLOSED candles are used.
 */
export interface BreakoutParams {
  donchianH1: boolean; london: boolean; newYork: boolean; donchianM30: boolean; allowSell: boolean; allowBuy: boolean;
  /** v0.3: SELL only while the long-term D1 trend is down too (EMA50(D1) < EMA200(D1)). */
  sellD1Bear: boolean;
  /** H4 trend from swing structure (last 2 confirmed pivot highs/lows, pivot 3: HH+HL up, LH+LL down) instead of EMA50/200. */
  swingTrend: boolean;
  /** Also require D1 close vs EMA50(D1) in the trade direction. */
  d1Filter: boolean;
  /** Optional M15 Donchian part (20 candles, or 10 with m15Fast), SL 2.5 × ATR14(M15). Research only. */
  donchianM15: boolean;
  m15Fast: boolean;
  /** Level part: an H1 swing level (pivot 3) that price came back to 2–3 times (within 0.25×ATR, ≥ 3 candles apart) is
   *  closed through for the first time (≤ 120 H1 candles after the pivot). SL = level ∓ 1.5 × ATR14(H1). */
  levelTouch: boolean;
  /** Simple trend: only H4 close vs EMA50(H4) (no EMA200, no D1). */
  ema50Only: boolean;
}
export const BREAKOUT_DEFAULTS: BreakoutParams = { donchianH1: true, london: true, newYork: true, donchianM30: false, allowSell: true, allowBuy: true, sellD1Bear: false, swingTrend: false, d1Filter: true, donchianM15: false, m15Fast: false, levelTouch: false, ema50Only: false };
export const BREAKOUT_KEY = 'breakout_v02';

export function readBreakoutParams(p: Readonly<Record<string, unknown>> = {}): BreakoutParams {
  const o = { ...BREAKOUT_DEFAULTS };
  for (const k of Object.keys(o) as (keyof BreakoutParams)[]) if (typeof p[k] === 'boolean') o[k] = p[k] as boolean;
  return o;
}

const H = 3_600_000;
/** pandas ewm(span=n, adjust=False) */
export function emaLast(v: readonly number[], n: number): number {
  if (!v.length) return NaN;
  const a = 2 / (n + 1);
  let e = v[0];
  for (let i = 1; i < v.length; i++) e = a * v[i] + (1 - a) * e;
  return e;
}
/** Wilder ATR as pandas ewm(alpha=1/n, adjust=False) over true range (first bar skipped like NaN). */
export function atrLastEwm(c: readonly Candle[], n: number): number {
  if (c.length < 2) return NaN;
  const a = 1 / n;
  let e = NaN;
  for (let i = 1; i < c.length; i++) {
    const pc = c[i - 1].close;
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - pc), Math.abs(c[i].low - pc));
    e = Number.isNaN(e) ? tr : a * tr + (1 - a) * e;
  }
  return e;
}

/** Wilder ATR series (same recursion as atrLastEwm). */
export function atrSeriesEwm(c: readonly Candle[], n: number): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  const a = 1 / n;
  let e = NaN;
  for (let i = 1; i < c.length; i++) {
    const pc = c[i - 1].close;
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - pc), Math.abs(c[i].low - pc));
    e = Number.isNaN(e) ? tr : a * tr + (1 - a) * e;
    out[i] = e;
  }
  return out;
}

type Trend = 'up' | 'down' | 'none';

export const breakoutAdapter: StrategyAdapter = {
  key: BREAKOUT_KEY,
  name: 'Breakout v0.2 (H1 + London + New York, searah tren)',
  configured: true,
  testOnly: false,
  warmupCandles: 60,
  requiredTimeframes: ['H1', 'H4', 'D1'],
  htfWindow: { H1: 400, H4: 1000, D1: 300 },
  evaluate(ctx) {
    const p = readBreakoutParams(ctx.params);
    const h1 = ctx.htf?.H1, h4 = ctx.htf?.H4, d1 = ctx.htf?.D1;
    const m = ctx.candles;
    if (!h1?.length || !h4?.length || !d1?.length || m.length < 30) return [];
    const bar = m[m.length - 1];
    const now = ctx.now;
    const st = ctx.state as { tk?: string; trend?: Trend; d1bear?: boolean; d1atr?: number; day?: string; brk?: Record<string, number> };

    // trend + D1 ATR: recompute only when a new H4 or D1 candle has closed
    const tk = `${h4[h4.length - 1].time}|${d1[d1.length - 1].time}`;
    if (st.tk !== tk) {
      const h4c = h4.map((c) => c.close), d1c = d1.map((c) => c.close);
      const e50 = emaLast(h4c, 50), e200 = emaLast(h4c, 200), d50 = emaLast(d1c, 50);
      const lc4 = h4c[h4c.length - 1], lcd = d1c[d1c.length - 1];
      const d1up = !p.d1Filter || lcd > d50, d1dn = !p.d1Filter || lcd < d50;
      if (p.ema50Only) st.trend = lc4 > e50 ? 'up' : lc4 < e50 ? 'down' : 'none';
      else if (p.swingTrend) {
        const sw = trendFromPivots(findPivots(h4.slice(-300), 3)).trend;
        st.trend = sw === 'bullish' && d1up ? 'up' : sw === 'bearish' && d1dn ? 'down' : 'none';
      } else st.trend = lc4 > e50 && e50 > e200 && d1up ? 'up' : lc4 < e50 && e50 < e200 && d1dn ? 'down' : 'none';
      st.d1bear = emaLast(d1c, 50) < emaLast(d1c, 200);
      st.d1atr = atrLastEwm(d1, 14);
      st.tk = tk;
    }
    const trend = st.trend ?? 'none';
    const out: StrategyEventDraft[] = [];
    const emit = (slot: string, side: 'long' | 'short', sl: number, why: string, extra: Record<string, unknown> = {}) => {
      if (side === 'long' && (!p.allowBuy || trend !== 'up')) return;
      if (side === 'short' && (!p.allowSell || trend !== 'down' || (p.sellD1Bear && !st.d1bear))) return;
      out.push({
        type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close,
        zone: null,
        confirmations: { trend: trend === 'up' ? 'Naik (H4 & D1)' : 'Turun (H4 & D1)' },
        status: `${side === 'long' ? 'BUY' : 'SELL'} — ${why}; entry di open M15 berikutnya`,
        details: { side, stop_loss: Number(sl.toFixed(4)), slot: `${slot}:${side}`, component: slot, ...extra },
      });
    };

    // ---- A: H1 Donchian 40 (on the M15 bar that completes an H1 candle)
    if (p.donchianH1 && now % H === 0 && h1[h1.length - 1].time + H === now && h1.length > 41) {
      const last = h1[h1.length - 1];
      const prev = h1.slice(-41, -1);
      const hh = Math.max(...prev.map((c) => c.high)), ll = Math.min(...prev.map((c) => c.low));
      const a = atrLastEwm(h1, 14);
      if (last.close > hh) emit('H1', 'long', bar.close - 2.5 * a, 'H1 tembus high 40 candle');
      if (last.close < ll) emit('H1', 'short', bar.close + 2.5 * a, 'H1 tembus low 40 candle');
    }

    // ---- L (optional): breakout of an H1 swing level that was touched 2–3 times
    if (p.levelTouch && now % H === 0 && h1[h1.length - 1].time + H === now && h1.length > 60) {
      const c = h1.slice(-200), n = c.length, i = n - 1, P = 3;
      const at = atrSeriesEwm(c, 14);
      for (const side of [1, -1] as const) {
        const ext = (k: number) => (side > 0 ? c[k].high : c[k].low);
        for (let k = Math.max(P, i - 119); k + P < i; k++) {          // oldest pivot first
          let isPiv = true;
          for (let q = k - P; q <= k + P && isPiv; q++) if (side * (ext(q) - ext(k)) > 0) isPiv = false;
          if (!isPiv) continue;
          const lv = ext(k);
          if (!(side * (c[i].close - lv) > 0)) continue;
          let early = false, touches = 1, last = k;
          for (let j = k + P + 1; j < i; j++) {
            if (side * (c[j].close - lv) > 0) { early = true; break; }
            const near = side > 0 ? c[j].high >= lv - 0.25 * at[j] : c[j].low <= lv + 0.25 * at[j];
            if (near) { if (j - last >= 3) touches++; last = j; }
          }
          if (early) continue;
          if (touches >= 2 && touches <= 3) emit('LVL', side > 0 ? 'long' : 'short', lv - side * 1.5 * at[i], `tembus level H1 yang disentuh ${touches}×`, { level: lv, touches });
          break;                                                         // only the oldest level broken on this candle
        }
      }
    }

    // ---- D (optional): M30 Donchian 10, built from M15 candles
    if (p.donchianM30 && now % (H / 2) === 0) {
      const m30 = aggregateCandles(m.slice(-160), 'M15', 'M30', 'utc', false);
      if (m30.length > 16 && m30[m30.length - 1].time + H / 2 === now) {
        const last = m30[m30.length - 1];
        const prev = m30.slice(-11, -1);
        const hh = Math.max(...prev.map((c) => c.high)), ll = Math.min(...prev.map((c) => c.low));
        const a = atrLastEwm(aggregateCandles(m, 'M15', 'M30', 'utc', false), 14);
        if (last.close > hh) emit('M30', 'long', bar.close - 2.5 * a, 'M30 tembus high 10 candle');
        if (last.close < ll) emit('M30', 'short', bar.close + 2.5 * a, 'M30 tembus low 10 candle');
      }
    }

    // ---- E (optional): M15 Donchian
    if (p.donchianM15 && m.length > 25) {
      const n = p.m15Fast ? 10 : 20;
      const prev = m.slice(-(n + 1), -1);
      const hh = Math.max(...prev.map((c) => c.high)), ll = Math.min(...prev.map((c) => c.low));
      const a = atrLastEwm(m.slice(-200), 14);
      if (bar.close > hh) emit('M15', 'long', bar.close - 2.5 * a, `M15 tembus high ${n} candle`);
      if (bar.close < ll) emit('M15', 'short', bar.close + 2.5 * a, `M15 tembus low ${n} candle`);
    }

    // ---- B/C: session range breakouts (first break per side per UTC day)
    const d = new Date(bar.time);
    const day = d.toISOString().slice(0, 10);
    if (st.day !== day) { st.day = day; st.brk = {}; }
    const hr = d.getUTCHours() + d.getUTCMinutes() / 60;
    const sessions: Array<[string, boolean, number, number, number, number, string]> = [
      ['LON', p.london, 0, 7, 7, 11, 'London'], ['NY', p.newYork, 12, 13.5, 13.5, 16, 'New York'],
    ];
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    for (const [slot, on, r0, r1, w0, w1, label] of sessions) {
      if (!on || hr < w0 || hr >= w1) continue;
      const rng = m.filter((c) => c.time >= dayStart + r0 * H && c.time < dayStart + r1 * H);
      if (!rng.length) continue;
      const hi = Math.max(...rng.map((c) => c.high)), lo = Math.min(...rng.map((c) => c.low));
      const width = hi - lo, da = st.d1atr ?? NaN;
      if (!(width > 0.2 * da && width < 1.5 * da)) continue;
      const brk = (st.brk ??= {});
      if (bar.close > hi) {
        brk[`${slot}u`] = (brk[`${slot}u`] ?? 0) + 1;
        if (brk[`${slot}u`] === 1) emit(slot, 'long', lo, `tembus high range ${label}`, { range_high: hi, range_low: lo });
      }
      if (bar.close < lo) {
        brk[`${slot}d`] = (brk[`${slot}d`] ?? 0) + 1;
        if (brk[`${slot}d`] === 1) emit(slot, 'short', hi, `tembus low range ${label}`, { range_high: hi, range_low: lo });
      }
    }
    return out;
  },
};

/**
 * Breakout v0.3 = v0.2 + M30 Donchian part + SELL only when D1 EMA50 < EMA200 (long-term downtrend).
 * Chosen on 2018-2022 among 14 pre-set variants, checked on 2023-2026 (README 5g).
 */
export const BREAKOUT_V03_KEY = 'breakout_v03';
export const breakoutV03Adapter: StrategyAdapter = {
  ...breakoutAdapter,
  key: BREAKOUT_V03_KEY,
  name: 'Breakout v0.3 (H1 + London + New York + M30, SELL hanya saat tren D1 turun)',
  htfWindow: { H1: 400, H4: 1000, D1: 1000 },
  evaluate: (ctx) => breakoutAdapter.evaluate({ ...ctx, params: { donchianM30: true, sellD1Bear: true, ...ctx.params } }),
};

/**
 * Breakout v0.4 = v0.3 + level part (breakout of an H1 swing level that was touched 2–3 times).
 * Chosen on 2018-2022 (6 pre-set variants), checked on 2023-2026 (README 5h).
 */
export const BREAKOUT_V04_KEY = 'breakout_v04';
export const breakoutV04Adapter: StrategyAdapter = {
  ...breakoutAdapter,
  key: BREAKOUT_V04_KEY,
  name: 'Breakout v0.4 (v0.3 + tembus level yang disentuh 2–3×)',
  htfWindow: { H1: 400, H4: 1000, D1: 1000 },
  evaluate: (ctx) => breakoutAdapter.evaluate({ ...ctx, params: { donchianM30: true, sellD1Bear: true, levelTouch: true, ...ctx.params } }),
};

/**
 * Breakout v0.5 "inti" = the three strongest parts of v0.4: H1 Donchian 40 + New York range + level touched 2–3×,
 * with the same trend filter (H4 EMA50/200 + D1; SELL only when D1 EMA50 < EMA200). London and M30 removed (weakest per trade).
 */
export const BREAKOUT_V05_KEY = 'breakout_v05';
export const breakoutV05Adapter: StrategyAdapter = {
  ...breakoutAdapter,
  key: BREAKOUT_V05_KEY,
  name: 'Breakout v0.5 inti (H1 + New York + level 2–3×)',
  htfWindow: { H1: 400, H4: 1000, D1: 1000 },
  evaluate: (ctx) => breakoutAdapter.evaluate({ ...ctx, params: { london: false, donchianM30: false, sellD1Bear: true, levelTouch: true, ...ctx.params } }),
};
