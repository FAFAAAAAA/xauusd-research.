import { TIMEFRAME_MS, type Candle } from '../types';
import type { StrategyAdapter, StrategyContext, StrategyEventDraft } from './adapter';
import { atrPine, emaPine } from './snrsnd';

/**
 * RBR / DBD (supply & demand continuation).
 * RBR (BUY):  leg-in = big bullish candle (body ≥ legAtr × ATR) → base = 1..baseMax small candles (body ≤ baseBody × ATR)
 *             → leg-out = big bullish candle closing above the highest high of the base.
 *             Demand zone: proximal = highest body of the base, distal = lowest low of the base.
 * DBD (SELL): mirror (supply zone: proximal = lowest body, distal = highest high).
 * Zones are built from CLOSED candles of `zoneTf` only. A zone is "fresh" until a closed zoneTf candle after the leg-out
 * trades back into it; it dies when a candle closes beyond the distal side or after maxAge zoneTf candles.
 * Entry M15 (next open): candle touches the zone, closes back outside/inside on the right side of the distal, and
 *   entry='rejection': candle closes in the trade direction with close in the top (bottom) 60% of its range;
 *   entry='touch': no candle pattern needed.
 * One trade per zone. Optional H4 trend filter (EMA50 vs EMA200 and close vs EMA50).
 * SL = distal ∓ slBufferAtr × ATR(M15); skipped if risk > maxSlAtr × ATR(M15). TP = RR × risk (engine).
 */
export interface RbrParams {
  zoneTf: 'M15' | 'H1' | 'H4'; legAtr: number; baseMax: number; baseBody: number; fresh: boolean;
  entry: 'rejection' | 'touch'; trend: boolean; maxAge: number; slBufferAtr: number; maxSlAtr: number; legBars: number;
}
export const RBR_DEFAULTS: RbrParams = {
  zoneTf: 'H1', legAtr: 1.0, baseMax: 3, baseBody: 0.5, fresh: true, entry: 'rejection', trend: true, maxAge: 120, slBufferAtr: 0.1, maxSlAtr: 8, legBars: 3,
};
export const RBR_KEY = 'rbr_dbd_v1';

export function readRbrParams(p: Readonly<Record<string, unknown>> = {}): RbrParams {
  const o = { ...RBR_DEFAULTS };
  for (const k of Object.keys(o) as (keyof RbrParams)[]) if (typeof p[k] === typeof o[k]) (o as Record<string, unknown>)[k] = p[k];
  return o;
}

export interface SdZone { side: 1 | -1; proximal: number; distal: number; baseTime: number; outIndex: number; outTime: number }

/** All RBR (side 1) and DBD (side −1) zones in `c` (closed candles), ordered by leg-out completion. */
export function findRbrDbd(c: readonly Candle[], p: Pick<RbrParams, 'legAtr' | 'baseMax' | 'baseBody' | 'legBars'>): SdZone[] {
  const atr = atrPine(c, 14);
  const out: SdZone[] = [];
  const body = (k: number) => Math.abs(c[k].close - c[k].open);
  const L = Math.max(1, p.legBars);
  for (let e = 1; e < c.length - 1; e++) {            // e = last base candle
    const a = atr[e];
    if (!Number.isFinite(a) || body(e) > p.baseBody * a || body(e + 1) <= p.baseBody * a) continue;
    let b0 = e;                                       // extend base backwards while candles stay small
    while (b0 - 1 >= 0 && e - b0 + 1 < p.baseMax && body(b0 - 1) <= p.baseBody * a) b0--;
    const li = b0 - 1;
    if (li - L + 1 < 0 || body(li) <= p.baseBody * a) continue;   // base longer than baseMax, or no leg-in
    let hi = -Infinity, lo = Infinity, bHi = -Infinity, bLo = Infinity;
    for (let k = b0; k <= e; k++) {
      hi = Math.max(hi, c[k].high); lo = Math.min(lo, c[k].low);
      bHi = Math.max(bHi, c[k].open, c[k].close); bLo = Math.min(bLo, c[k].open, c[k].close);
    }
    for (const dir of [1, -1] as const) {
      if ((c[li].close - c[li].open) * dir <= 0 || (c[e + 1].close - c[e + 1].open) * dir <= 0) continue;
      const legIn = (c[li].close - c[li - L + 1].open) * dir;
      if (!(legIn >= p.legAtr * a)) continue;
      let j = -1;
      for (let k = e + 1; k <= Math.min(c.length - 1, e + L); k++) {
        if ((c[k].close - c[e + 1].open) * dir >= p.legAtr * a && (dir > 0 ? c[k].close > hi : c[k].close < lo)) { j = k; break; }
        if ((c[k].close - c[k].open) * dir < 0) break;            // leg-out must be one-directional
      }
      if (j < 0) continue;
      out.push(dir > 0
        ? { side: 1, proximal: bHi, distal: lo, baseTime: c[b0].time, outIndex: j, outTime: c[j].time }
        : { side: -1, proximal: bLo, distal: hi, baseTime: c[b0].time, outIndex: j, outTime: c[j].time });
    }
  }
  return out.sort((x, y) => x.outIndex - y.outIndex);
}

interface St { used?: Record<string, 1>; tk?: number; trend?: 'up' | 'down' | 'none'; zk?: number; zones?: SdZone[] }

function trendOf(ctx: StrategyContext, st: St, now: number): 'up' | 'down' | 'none' {
  const h4 = (ctx.htf?.H4 ?? []).filter((c) => c.time + TIMEFRAME_MS.H4 <= now);
  if (!h4.length) return 'none';
  const k = h4[h4.length - 1].time;
  if (st.tk !== k) {
    const cl = h4.map((c) => c.close), e50 = emaPine(cl, 50), e200 = emaPine(cl, 200), last = cl[cl.length - 1];
    st.trend = e50 > e200 && last > e50 ? 'up' : e50 < e200 && last < e50 ? 'down' : 'none';
    st.tk = k;
  }
  return st.trend ?? 'none';
}

/** Zones still alive (and fresh, if asked) after the last closed candle of `c`. */
function liveZones(c: readonly Candle[], p: RbrParams): SdZone[] {
  const all = findRbrDbd(c, p);
  const last = c.length - 1;
  return all.filter((z) => {
    if (last - z.outIndex > p.maxAge) return false;
    for (let k = z.outIndex + 1; k <= last; k++) {
      if (z.side * (c[k].close - z.distal) < 0) return false;                       // closed beyond distal → broken
      if (p.fresh && z.side * ((z.side > 0 ? c[k].low : c[k].high) - z.proximal) <= 0) return false; // already revisited
    }
    return true;
  });
}

export const rbrDbdAdapter: StrategyAdapter = {
  key: RBR_KEY,
  name: 'RBR / DBD (supply & demand lanjutan tren)',
  configured: true,
  testOnly: false,
  warmupCandles: 60,
  requiredTimeframes: ['H1', 'H4'],
  htfWindow: { H1: 400, H4: 1000 },
  evaluate(ctx) {
    const p = readRbrParams(ctx.params);
    const st = ctx.state as St;
    const m = ctx.candles;
    if (m.length < 40) return [];
    const bar = m[m.length - 1];
    // zone candles closed BEFORE this M15 candle opened (no lookahead)
    let zc: readonly Candle[];
    if (p.zoneTf === 'M15') zc = m.slice(-301, -1);
    else {
      const src = ctx.htf?.[p.zoneTf] ?? [];
      let e = src.length;
      while (e > 0 && src[e - 1].time + TIMEFRAME_MS[p.zoneTf] > bar.time) e--;
      zc = src.slice(Math.max(0, e - 300), e);
    }
    if (zc.length < 30) return [];
    const zk = zc[zc.length - 1].time;
    if (st.zk !== zk || !st.zones) { st.zones = liveZones(zc, p); st.zk = zk; }

    const atrArr = atrPine(m.slice(-120), 14), atr = atrArr[atrArr.length - 1];
    if (!Number.isFinite(atr)) return [];
    const trend = p.trend ? trendOf(ctx, st, bar.time) : 'none';
    const used = (st.used ??= {});
    const range = Math.max(bar.high - bar.low, 0.01);

    // newest zones first
    for (let q = st.zones.length - 1; q >= 0; q--) {
      const z: SdZone = st.zones[q];
      const key = `${z.side}:${z.baseTime}`;
      if (used[key]) continue;
      if (p.trend && trend !== (z.side > 0 ? 'up' : 'down')) continue;
      const touched = z.side > 0 ? bar.low <= z.proximal : bar.high >= z.proximal;
      if (!touched) continue;
      if (z.side * (bar.close - z.distal) <= 0) { used[key] = 1; continue; }  // closed through the zone → dead
      if (p.entry === 'rejection') {
        const rej = z.side > 0
          ? bar.close > bar.open && (bar.close - bar.low) / range >= 0.6
          : bar.close < bar.open && (bar.high - bar.close) / range >= 0.6;
        if (!rej) continue;
      }
      const sl = z.distal - z.side * p.slBufferAtr * atr;
      const risk = z.side * (bar.close - sl);
      used[key] = 1;
      if (!(risk > 0.01) || risk > p.maxSlAtr * atr) continue;
      const ev: StrategyEventDraft = {
        type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close,
        zone: { kind: z.side > 0 ? 'support' : 'resistance', low: Math.min(z.proximal, z.distal), high: Math.max(z.proximal, z.distal) },
        confirmations: { trend: trend === 'up' ? 'H4 naik' : trend === 'down' ? 'H4 turun' : 'tanpa filter tren' },
        status: `${z.side > 0 ? 'BUY RBR' : 'SELL DBD'} ${p.zoneTf}: harga kembali ke base ${Math.min(z.proximal, z.distal).toFixed(2)}–${Math.max(z.proximal, z.distal).toFixed(2)}`,
        details: { side: z.side > 0 ? 'long' : 'short', stop_loss: Number(sl.toFixed(4)), zone_tf: p.zoneTf, pattern: z.side > 0 ? 'RBR' : 'DBD' },
      };
      return [ev];
    }
    return [];
  },
};
