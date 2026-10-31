import { TIMEFRAME_MS, type Candle } from '../types';
import type { StrategyAdapter, StrategyContext } from './adapter';
import { atrPine, emaPine } from './snrsnd';
import { findPivots, type Pivot } from './snr';

/**
 * Pola N (N pattern).
 * BUY:  confirmed swing low A → swing high B → swing low C with C above A,
 *       impulse A→B ≥ impulseAtr × ATR, pull-back (B−C)/(B−A) inside [rMin, rMax],
 *       then the FIRST candle close above B (within maxBars after C, while C still holds) → entry next M15 open.
 *       SL = C − slBufferAtr × ATR. TP = RR × risk (engine). SELL is the mirror.
 * Optional trend filter: H4 EMA50 > EMA200 and close > EMA50 for BUY (mirror for SELL).
 * Swings are pivots that are already CONFIRMED (n candles to the right closed) — no repainting.
 */
export interface NParams {
  tf: 'M15' | 'H1'; pivot: number; rMin: number; rMax: number; impulseAtr: number; trend: boolean; maxBars: number; slBufferAtr: number;
}
// Defaults chosen on 2018-2022 only (12 preset variants), then checked on 2023-2026 — see README.
export const N_DEFAULTS: NParams = { tf: 'M15', pivot: 5, rMin: 0.3, rMax: 0.786, impulseAtr: 1.5, trend: true, maxBars: 48, slBufferAtr: 0.1 };
export const NPATTERN_KEY = 'n_pattern_v1';

export function readNParams(p: Readonly<Record<string, unknown>> = {}): NParams {
  const o = { ...N_DEFAULTS };
  for (const k of Object.keys(o) as (keyof NParams)[]) if (typeof p[k] === typeof o[k]) (o as Record<string, unknown>)[k] = p[k];
  return o;
}

const lastBefore = (ps: Pivot[], type: 'high' | 'low', idx: number) => {
  for (let k = ps.length - 1; k >= 0; k--) if (ps[k].type === type && ps[k].index < idx) return ps[k];
  return null;
};

interface St { used?: Record<string, 1>; tk?: number; trend?: 'up' | 'down' | 'none' }

function trendOf(ctx: StrategyContext, st: St): 'up' | 'down' | 'none' {
  const h4 = (ctx.htf?.H4 ?? []).filter((c) => c.time + TIMEFRAME_MS.H4 <= ctx.candles[ctx.candles.length - 1].time);
  if (!h4.length) return 'none';
  const k = h4[h4.length - 1].time;
  if (st.tk !== k) {
    const cl = h4.map((c) => c.close), e50 = emaPine(cl, 50), e200 = emaPine(cl, 200), last = cl[cl.length - 1];
    st.trend = e50 > e200 && last > e50 ? 'up' : e50 < e200 && last < e50 ? 'down' : 'none';
    st.tk = k;
  }
  return st.trend ?? 'none';
}

export const nPatternAdapter: StrategyAdapter = {
  key: NPATTERN_KEY,
  name: 'Pola N (A-B-C, tembus B)',
  configured: true,
  testOnly: false,
  warmupCandles: 60,
  requiredTimeframes: ['H1', 'H4'],
  htfWindow: { H1: 400, H4: 1000 },
  evaluate(ctx) {
    const p = readNParams(ctx.params);
    const st = ctx.state as St;
    const m = ctx.candles;
    const bar = m[m.length - 1];
    let c: readonly Candle[];
    if (p.tf === 'M15') c = m.slice(-300);
    else {
      const h1 = ctx.htf?.H1 ?? [];
      if (!h1.length || h1[h1.length - 1].time + TIMEFRAME_MS.H1 !== ctx.now) return []; // act once per closed H1 candle
      c = h1.slice(-300);
    }
    if (c.length < 40) return [];
    const i = c.length - 1, cur = c[i], prev = c[i - 1];
    const atrArr = atrPine(c, 14), atr = atrArr[i];
    if (!Number.isFinite(atr)) return [];
    const piv = findPivots(c, p.pivot);
    const trend = p.trend ? trendOf(ctx, st) : 'none';
    const used = (st.used ??= {});
    const out = [];

    for (const side of [1, -1] as const) {
      if (p.trend && trend !== (side > 0 ? 'up' : 'down')) continue;
      const lowT = side > 0 ? 'low' : 'high', highT = side > 0 ? 'high' : 'low';
      const C = lastBefore(piv, lowT, i + 1);
      if (!C) continue;
      const B = lastBefore(piv, highT, C.index);
      if (!B) continue;
      const A = lastBefore(piv, lowT, B.index);
      if (!A) continue;
      const leg = side * (B.price - A.price);              // impulse size
      const pull = side * (B.price - C.price);             // pull-back size
      if (!(leg >= p.impulseAtr * atr) || !(side * (C.price - A.price) > 0)) continue;
      const r = pull / leg;
      if (r < p.rMin || r > p.rMax) continue;
      if (i - C.index > p.maxBars) continue;
      const key = `${side}:${A.time}:${B.time}:${C.time}`;
      if (used[key]) continue;
      // C must still hold and B must not have been closed through before this candle
      let held = true, early = false;
      for (let k = C.index + 1; k < i; k++) {
        const extreme = side > 0 ? c[k].low : c[k].high;          // price must not trade beyond C
        if (side * (extreme - C.price) < 0) { held = false; break; }
        if (side * (c[k].close - B.price) > 0) { early = true; break; }
      }
      if (!held || early) { used[key] = 1; continue; }
      if (!(side * (cur.close - B.price) > 0 && side * (prev.close - B.price) <= 0)) continue;
      used[key] = 1;
      const sl = C.price - side * p.slBufferAtr * atr;
      if (!(side * (bar.close - sl) > 0)) continue;
      out.push({
        type: 'SETUP_CONFIRMED' as const, candleTime: bar.time, price: bar.close,
        zone: { kind: side > 0 ? 'support' as const : 'resistance' as const, low: Math.min(B.price, C.price), high: Math.max(B.price, C.price) },
        confirmations: { trend: trend === 'up' ? 'H4 naik' : trend === 'down' ? 'H4 turun' : 'tanpa filter tren' },
        status: `${side > 0 ? 'BUY' : 'SELL'} pola N ${p.tf}: tembus B ${B.price.toFixed(2)} (koreksi ${(r * 100).toFixed(0)}%)`,
        details: { side: side > 0 ? 'long' : 'short', stop_loss: Number(sl.toFixed(4)), A: A.price, B: B.price, C: C.price, retrace: Number(r.toFixed(3)) },
      });
    }
    return out.slice(0, 1);
  },
};

