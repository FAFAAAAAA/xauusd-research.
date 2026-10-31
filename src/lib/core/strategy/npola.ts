import { TIMEFRAME_MS, type Candle, type Timeframe } from '../types';
import type { StrategyAdapter, StrategyContext, StrategyEventDraft } from './adapter';
import { breakoutV06Adapter, emaLast } from './breakout';

/**
 * Pola N — user rules (README 5m). Pattern on H1 and/or H4, entry confirmed by the CLOSE of a base candle (M15).
 *  Swings: zigzag on CLOSED candles of the pattern timeframe — a high/low becomes a swing once price has reversed
 *          k × ATR14 (Wilder) of that timeframe from it. No candle counts, no pattern age limit.
 *  BUY  : A low, B high, C low with C > A. The pattern is visible when C is confirmed. Signal = first base candle that closes
 *         above B (previous close ≤ B) after that; cancelled if a base candle closes below C first. SL = C exactly, TP = RR × risk.
 *  SELL : mirror (A high, B low, C high with C < A).
 *  Trend: BUY only if EMA50(H4) > EMA200(H4); SELL only if EMA50(H4) < EMA200(H4) AND EMA50(D1) < EMA200(D1). Closed candles only.
 */
export interface NPolaParams { k: number; useH1: boolean; useH4: boolean }
export const NPOLA_DEFAULTS: NPolaParams = { k: 3, useH1: true, useH4: true };
export function readNPolaParams(p: Readonly<Record<string, unknown>> = {}): NPolaParams {
  const o = { ...NPOLA_DEFAULTS };
  if (typeof p.nK === 'number' && p.nK > 0) o.k = p.nK;
  if (typeof p.nH1 === 'boolean') o.useH1 = p.nH1;
  if (typeof p.nH4 === 'boolean') o.useH4 = p.nH4;
  return o;
}

interface Piv { type: 1 | -1; price: number }
interface Zz { last: number; atr: number; prevClose: number; dirn: 0 | 1 | -1; ext: number; seen: number; piv: Piv[] }
interface Pat { side: 1 | -1; b: number; c: number; tf: Timeframe; prev: number }
export interface NPolaState { zz?: Partial<Record<Timeframe, Zz>>; pats?: Pat[]; tk?: string; up?: boolean; dn?: boolean }

/** Advance the zigzag of one timeframe over its newly closed candles; returns patterns that became visible. */
function stepZigzag(z: Zz, candles: readonly Candle[], k: number, tf: Timeframe, closeNow: number): Pat[] {
  const out: Pat[] = [];
  for (const c of candles) {
    if (c.time <= z.last) continue;
    z.last = c.time;
    const tr = Number.isNaN(z.prevClose) ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - z.prevClose), Math.abs(c.low - z.prevClose));
    z.atr = Number.isNaN(z.atr) ? tr : z.atr + (tr - z.atr) / 14;
    z.prevClose = c.close;
    if (++z.seen < 15) continue;                       // ATR warm-up
    if (z.dirn === 0) { z.dirn = 1; z.ext = c.high; continue; }
    let conf: Piv | null = null;
    if (z.dirn === 1) {
      if (c.high > z.ext) z.ext = c.high;
      else if (c.low <= z.ext - k * z.atr) { conf = { type: 1, price: z.ext }; z.dirn = -1; z.ext = c.low; }
    } else {
      if (c.low < z.ext) z.ext = c.low;
      else if (c.high >= z.ext + k * z.atr) { conf = { type: -1, price: z.ext }; z.dirn = 1; z.ext = c.high; }
    }
    if (!conf) continue;
    z.piv.push(conf);
    if (z.piv.length > 3) z.piv.shift();
    if (z.piv.length < 3) continue;
    const [a, b, cc] = z.piv;
    const side: 1 | -1 = cc.type === -1 ? 1 : -1;
    if (side * (cc.price - a.price) > 0) out.push({ side, b: b.price, c: cc.price, tf, prev: closeNow });
  }
  return out;
}

/** Pola N signals for the current base candle. `st` must be a state object owned by this component. */
export function nPolaEvaluate(ctx: StrategyContext, st: NPolaState, p: NPolaParams): StrategyEventDraft[] {
  const m = ctx.candles, bar = m[m.length - 1];
  const h4 = ctx.htf?.H4, d1 = ctx.htf?.D1;
  if (!bar || !h4?.length || !d1?.length) return [];
  const pats = (st.pats ??= []);
  const zz = (st.zz ??= {});

  const tk = `${h4[h4.length - 1].time}|${d1[d1.length - 1].time}`;
  if (st.tk !== tk) {
    st.tk = tk;
    const h4c = h4.map((c) => c.close), d1c = d1.map((c) => c.close);
    const ok = h4c.length >= 200 && d1c.length >= 200;
    const e50 = emaLast(h4c, 50), e200 = emaLast(h4c, 200), d50 = emaLast(d1c, 50), d200 = emaLast(d1c, 200);
    st.up = ok && e50 > e200;
    st.dn = ok && e50 < e200 && d50 < d200;
  }

  // 1) patterns already visible: trigger / cancel on this candle's close
  const out: StrategyEventDraft[] = [];
  const close = bar.close;
  for (let i = 0; i < pats.length; i++) {
    const q = pats[i];
    let done = false;
    if (q.side * (close - q.c) < 0) done = true;                                  // closed beyond C → cancelled
    else if (q.side * (close - q.b) > 0 && q.side * (q.prev - q.b) <= 0) {       // first close through B
      done = true;
      if ((q.side > 0 ? st.up : st.dn) && !out.length) {
        out.push({
          type: 'SETUP_CONFIRMED', candleTime: bar.time, price: close, zone: null,
          confirmations: { trend: q.side > 0 ? 'H4 EMA50 > EMA200' : 'H4 & D1 EMA50 < EMA200' },
          status: `${q.side > 0 ? 'BUY' : 'SELL'} — Pola N ${q.tf}: close menembus B ${q.b.toFixed(2)}; SL di C ${q.c.toFixed(2)}`,
          details: { side: q.side > 0 ? 'long' : 'short', stop_loss: Number(q.c.toFixed(4)), slot: 'N', component: 'N', level: q.b, pattern_tf: q.tf, point_c: q.c },
        });
      }
    }
    if (done) { pats.splice(i, 1); i--; } else q.prev = close;
  }

  // 2) swings on pattern timeframes whose candle closed at this candle's close
  for (const tf of ['H1', 'H4'] as const) {
    if ((tf === 'H1' && !p.useH1) || (tf === 'H4' && !p.useH4)) continue;
    const arr = ctx.htf?.[tf];
    if (!arr?.length) continue;
    const z = (zz[tf] ??= { last: -Infinity, atr: NaN, prevClose: NaN, dirn: 0, ext: NaN, seen: 0, piv: [] });
    const last = arr[arr.length - 1];
    if (last.time <= z.last || last.time + TIMEFRAME_MS[tf] > ctx.now) continue;
    pats.push(...stepZigzag(z, arr, p.k, tf, close));
  }
  if (pats.length > 400) pats.splice(0, pats.length - 400);
  return out;
}

/**
 * Breakout v0.7 = v0.6 unchanged + Pola N (H1 + H4, swing = 3 × ATR reversal) as an extra part with its own slot.
 * v0.6 and Pola N may each hold a position at the same time (so up to about 2× risk at once).
 */
export const BREAKOUT_V07_KEY = 'breakout_v07';
export const breakoutV07Adapter: StrategyAdapter = {
  ...breakoutV06Adapter,
  key: BREAKOUT_V07_KEY,
  name: 'Breakout v0.7 (v0.6 + Pola N H1/H4)',
  htfWindow: { H1: 400, H4: 1000, D1: 1000 },
  evaluate(ctx) {
    const s = ctx.state as { v6?: Record<string, unknown>; n?: NPolaState };
    const a = breakoutV06Adapter.evaluate({ ...ctx, state: (s.v6 ??= {}) });
    const b = nPolaEvaluate(ctx, (s.n ??= {}), readNPolaParams(ctx.params));
    return [...a, ...b];
  },
};
