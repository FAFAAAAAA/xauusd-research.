import { TIMEFRAME_MS, type Candle } from '../types';
import type { StrategyAdapter, StrategyContext, StrategyEventDraft } from './adapter';
import { atrPine } from './snrsnd';
import { emaLast } from './breakout';
import { findPivots } from './snr';

/**
 * Order Block + Imbalance (FVG), SMC style. All zones come from CLOSED candles of `zoneTf`.
 * BUY setup (SELL mirrored):
 *   FVG    3 candles a, b, c with high(a) < low(c) and gap ≥ fvgAtr × ATR(zoneTf); b is the displacement candle.
 *   BOS    b or c closes above the last confirmed swing high (pivot 3) that existed before a.
 *   OB     last bearish candle among the 5 candles up to and including a; zone = its low … high.
 *   Entry  first return of price (M15) to the entry area after c closed:
 *          entry='fvg' → touch of the FVG top (low of c); entry='ob' → touch of the OB top.
 *          confirm=true needs an M15 rejection candle (bullish, close in top 60% of range); the candle must close above the OB low.
 *   SL     OB low − slBufferAtr × ATR(zoneTf). Skipped if risk > maxSlAtr × ATR(zoneTf). TP = RR × risk (engine).
 *   One trade per setup; setup dies on a close below the OB low or after maxAge zoneTf candles.
 * Trend filter (same as Breakout v0.3): H4 close > EMA50 > EMA200 and D1 close > EMA50 for BUY; SELL also needs EMA50(D1) < EMA200(D1).
 */
export interface ObFvgParams {
  zoneTf: 'M15' | 'H1'; fvgAtr: number; entry: 'fvg' | 'ob'; confirm: boolean; trend: boolean; maxAge: number; slBufferAtr: number; maxSlAtr: number;
}
export const OBFVG_DEFAULTS: ObFvgParams = { zoneTf: 'H1', fvgAtr: 0.3, entry: 'fvg', confirm: false, trend: true, maxAge: 120, slBufferAtr: 0.1, maxSlAtr: 4 };
export const OBFVG_KEY = 'ob_fvg_v1';

export function readObFvgParams(p: Readonly<Record<string, unknown>> = {}): ObFvgParams {
  const o = { ...OBFVG_DEFAULTS };
  for (const k of Object.keys(o) as (keyof ObFvgParams)[]) if (typeof p[k] === typeof o[k]) (o as Record<string, unknown>)[k] = p[k];
  return o;
}

export interface ObFvgSetup { side: 1 | -1; entry: number; obFar: number; obNear: number; fvgNear: number; fvgFar: number; cIndex: number; key: string; atr: number }

/** All OB+FVG setups with BOS in closed candles `c`, oldest first. */
export function findObFvg(c: readonly Candle[], p: Pick<ObFvgParams, 'fvgAtr' | 'entry'>): ObFvgSetup[] {
  const atr = atrPine(c, 14);
  const piv = findPivots(c, 3);
  const out: ObFvgSetup[] = [];
  for (let k = 2; k < c.length; k++) {
    const a = k - 2, b = k - 1, A = atr[k];
    if (!Number.isFinite(A)) continue;
    for (const s of [1, -1] as const) {
      const gap = s > 0 ? c[k].low - c[a].high : c[a].low - c[k].high;
      if (!(gap >= p.fvgAtr * A) || s * (c[b].close - c[b].open) <= 0) continue;
      // last confirmed swing before a (confirmed = pivot index + 3 < a)
      let sw: number | null = null;
      for (let q = piv.length - 1; q >= 0; q--) if (piv[q].index + 3 < a && piv[q].type === (s > 0 ? 'high' : 'low')) { sw = piv[q].price; break; }
      if (sw == null || !(s * (Math.max(s * c[b].close, s * c[k].close) * s - sw) > 0)) continue;
      // order block: last opposite candle among a-4 … a
      let ob = -1;
      for (let q = a; q >= Math.max(0, a - 4); q--) if (s * (c[q].close - c[q].open) < 0) { ob = q; break; }
      if (ob < 0) continue;
      const obFar = s > 0 ? c[ob].low : c[ob].high, obNear = s > 0 ? c[ob].high : c[ob].low;
      const fvgNear = s > 0 ? c[k].low : c[k].high, fvgFar = s > 0 ? c[a].high : c[a].low;
      out.push({ side: s, entry: p.entry === 'fvg' ? fvgNear : obNear, obFar, obNear, fvgNear, fvgFar, cIndex: k, key: `${s}:${c[k].time}`, atr: A });
    }
  }
  return out;
}

interface St { used?: Record<string, 1>; zk?: number; live?: ObFvgSetup[]; tk?: string; trend?: 'up' | 'down' | 'none'; d1bear?: boolean }

function trendOf(ctx: StrategyContext, st: St, t: number) {
  const h4 = (ctx.htf?.H4 ?? []).filter((c) => c.time + TIMEFRAME_MS.H4 <= t);
  const d1 = (ctx.htf?.D1 ?? []).filter((c) => c.time + TIMEFRAME_MS.D1 <= t);
  if (!h4.length || !d1.length) return 'none' as const;
  const k = `${h4[h4.length - 1].time}|${d1[d1.length - 1].time}`;
  if (st.tk !== k) {
    const h4c = h4.map((c) => c.close), d1c = d1.map((c) => c.close);
    const e50 = emaLast(h4c, 50), e200 = emaLast(h4c, 200), d50 = emaLast(d1c, 50), d200 = emaLast(d1c, 200);
    const lc4 = h4c[h4c.length - 1], lcd = d1c[d1c.length - 1];
    st.trend = lc4 > e50 && e50 > e200 && lcd > d50 ? 'up' : lc4 < e50 && e50 < e200 && lcd < d50 ? 'down' : 'none';
    st.d1bear = d50 < d200;
    st.tk = k;
  }
  return st.trend ?? 'none';
}

export const obFvgAdapter: StrategyAdapter = {
  key: OBFVG_KEY,
  name: 'Order Block + FVG (SMC, searah tren)',
  configured: true,
  testOnly: false,
  warmupCandles: 60,
  requiredTimeframes: ['H1', 'H4', 'D1'],
  htfWindow: { H1: 400, H4: 1000, D1: 1000 },
  evaluate(ctx) {
    const p = readObFvgParams(ctx.params);
    const st = ctx.state as St;
    const m = ctx.candles;
    if (m.length < 40) return [];
    const bar = m[m.length - 1];
    let zc: readonly Candle[];
    if (p.zoneTf === 'M15') zc = m.slice(-301, -1);
    else {
      const src = ctx.htf?.H1 ?? [];
      let e = src.length;
      while (e > 0 && src[e - 1].time + TIMEFRAME_MS.H1 > bar.time) e--;
      zc = src.slice(Math.max(0, e - 300), e);
    }
    if (zc.length < 40) return [];
    const used = (st.used ??= {});
    const zk = zc[zc.length - 1].time;
    if (st.zk !== zk || !st.live) {
      const last = zc.length - 1;
      st.live = findObFvg(zc, p).filter((z) => {
        if (used[z.key] || last - z.cIndex > p.maxAge) return false;
        for (let q = z.cIndex + 1; q <= last; q++) {
          if (z.side * (zc[q].close - z.obFar) < 0) return false;                                   // broken
          if (z.side * ((z.side > 0 ? zc[q].low : zc[q].high) - z.entry) <= 0) return false;        // already revisited
        }
        return true;
      });
      st.zk = zk;
    }
    const trend = p.trend ? trendOf(ctx, st, bar.time) : 'none';
    const range = Math.max(bar.high - bar.low, 1e-9);
    for (let q = st.live.length - 1; q >= 0; q--) {
      const z = st.live[q];
      if (used[z.key]) continue;
      if (p.trend && (z.side > 0 ? trend !== 'up' : trend !== 'down' || !st.d1bear)) continue;
      const touched = z.side > 0 ? bar.low <= z.entry : bar.high >= z.entry;
      if (!touched) continue;
      if (z.side * (bar.close - z.obFar) <= 0) { used[z.key] = 1; continue; }
      if (p.confirm) {
        const rej = z.side > 0 ? bar.close > bar.open && (bar.close - bar.low) / range >= 0.6 : bar.close < bar.open && (bar.high - bar.close) / range >= 0.6;
        if (!rej) continue;
      }
      used[z.key] = 1;
      const sl = z.obFar - z.side * p.slBufferAtr * z.atr;
      const risk = z.side * (bar.close - sl);
      if (!(risk > Math.min(0.01, 0.01 * z.atr)) || risk > p.maxSlAtr * z.atr) continue;
      const lo = Math.min(z.obFar, z.fvgNear, z.obNear), hi = Math.max(z.obFar, z.fvgNear, z.obNear);
      const ev: StrategyEventDraft = {
        type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close,
        zone: { kind: z.side > 0 ? 'support' : 'resistance', low: lo, high: hi },
        confirmations: { trend: trend === 'up' ? 'Naik (H4 & D1)' : trend === 'down' ? 'Turun (H4 & D1)' : 'tanpa filter tren' },
        status: `${z.side > 0 ? 'BUY' : 'SELL'} OB+FVG ${p.zoneTf}: harga kembali ke ${p.entry === 'fvg' ? 'FVG' : 'order block'}`,
        details: { side: z.side > 0 ? 'long' : 'short', stop_loss: Number(sl.toFixed(4)), zone_tf: p.zoneTf, pattern: p.entry },
      };
      return [ev];
    }
    return [];
  },
};
