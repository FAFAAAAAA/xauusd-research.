import type { Candle, Timeframe } from '../types';
import { TIMEFRAME_MS } from '../types';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';

/**
 * Port of the owner's TradingView indicator "XAUUSD | SNR H4 + SND H4/H1 | Entry M15 RR 1:2" (Pine v6).
 * Same rules and default inputs:
 *  - HTF values come from the last CLOSED H4/H1 candle before the M15 candle opened
 *    (Pine: expression[1] inside request.security(..., lookahead_on)).
 *  - Trend H4: EMA50 > EMA200 and close > EMA50 (bullish), mirror for bearish.
 *  - SNR H4: last confirmed pivot high/low (pivot 3/3) → resistance/support.
 *  - SND H4 & H1: demand = last bearish candle before a bullish displacement (body ≥ 0.8×ATR, close > highest high of 5 prior,
 *    previous candle bearish): bottom = its low, top = its open. Supply mirrored (bottom = open, top = high).
 *    A zone disappears when a HTF candle closes beyond it; a new impulse replaces it.
 *  - Entry M15: rejection candle (bullish, close > previous close, close in top 60% of range) touching a demand zone,
 *    within 1×ATR(H4) above H4 support; SELL mirrored. SL = min(zone bottom, low) − 0.15×ATR(M15); risk ≤ 4×ATR(M15).
 *  - Cooldown 8 M15 candles between signals. TP = 2× SL distance (the engine applies the RR).
 */
export interface SnrSndParams {
  fastLen: number; slowLen: number; pivotLen: number; impulseATR: number; breakLen: number; useSNR: boolean; snrRadius: number;
  wickRatio: number; slBuffer: number; maxSlATR: number; cooldown: number;
}
export const SNRSND_DEFAULTS: SnrSndParams = {
  fastLen: 50, slowLen: 200, pivotLen: 3, impulseATR: 0.8, breakLen: 5, useSNR: true, snrRadius: 1.0,
  wickRatio: 0.6, slBuffer: 0.15, maxSlATR: 4.0, cooldown: 8,
};
export const SNRSND_KEY = 'snr_snd_mtf_v1';
const MINTICK = 0.01;

export function readSnrSndParams(p: Readonly<Record<string, unknown>> = {}): SnrSndParams {
  const o = { ...SNRSND_DEFAULTS };
  for (const k of Object.keys(o) as (keyof SnrSndParams)[]) {
    const v = p[k];
    if (typeof v === typeof o[k]) (o as Record<string, unknown>)[k] = v;
  }
  return o;
}

/** Pine ta.atr(14): RMA of true range seeded with the SMA of the first `n` values; first TR = high − low. */
function atrPine(c: readonly Candle[], n: number): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  let sum = 0, rma = NaN;
  for (let i = 0; i < c.length; i++) {
    const tr = i === 0 ? c[i].high - c[i].low
      : Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    if (i < n) { sum += tr; if (i === n - 1) { rma = sum / n; out[i] = rma; } }
    else { rma = (rma * (n - 1) + tr) / n; out[i] = rma; }
  }
  return out;
}
/** Pine ta.ema: alpha = 2/(n+1), seeded with the first value. */
function emaPine(v: readonly number[], n: number): number {
  if (!v.length) return NaN;
  const a = 2 / (n + 1);
  let e = v[0];
  for (let i = 1; i < v.length; i++) e = a * v[i] + (1 - a) * e;
  return e;
}

export interface Levels {
  resistance: number; support: number; dBot: number; dTop: number; sBot: number; sTop: number;
  emaFast: number; emaSlow: number; close: number; atr: number;
}

/** f_levels() evaluated over CLOSED candles; returns the state after the last one (= Pine's [1] inside security). */
export function htfLevels(c: readonly Candle[], p: SnrSndParams): Levels {
  const n = c.length;
  const atr = atrPine(c, 14);
  let resistance = NaN, support = NaN, dBot = NaN, dTop = NaN, sBot = NaN, sTop = NaN;
  const L = p.pivotLen;
  for (let j = 0; j < n; j++) {
    // pivot confirmed at bar j for bar k = j - L (strict left, non-strict right)
    const k = j - L;
    if (k >= L) {
      let ph = true, pl = true;
      for (let q = 1; q <= L && (ph || pl); q++) {
        if (!(c[k].high > c[k - q].high && c[k].high >= c[k + q].high)) ph = false;
        if (!(c[k].low < c[k - q].low && c[k].low <= c[k + q].low)) pl = false;
      }
      if (ph) resistance = c[k].high;
      if (pl) support = c[k].low;
    }
    // zone invalidation by close, then new zones from displacement candles
    const cl = c[j].close;
    if (!Number.isNaN(dBot) && cl < dBot) { dBot = NaN; dTop = NaN; }
    if (!Number.isNaN(sTop) && cl > sTop) { sBot = NaN; sTop = NaN; }
    if (j >= p.breakLen && j >= 1 && Number.isFinite(atr[j])) {
      let hh = -Infinity, ll = Infinity;
      for (let q = j - p.breakLen; q < j; q++) { hh = Math.max(hh, c[q].high); ll = Math.min(ll, c[q].low); }
      const prev = c[j - 1], cur = c[j];
      const bull = cur.close > cur.open && prev.close < prev.open && cur.close - cur.open >= atr[j] * p.impulseATR && cur.close > hh;
      const bear = cur.close < cur.open && prev.close > prev.open && cur.open - cur.close >= atr[j] * p.impulseATR && cur.close < ll;
      if (bull) { dBot = prev.low; dTop = prev.open; }
      if (bear) { sBot = prev.open; sTop = prev.high; }
    }
  }
  const closes = c.map((x) => x.close);
  return {
    resistance, support, dBot, dTop, sBot, sTop,
    emaFast: emaPine(closes, p.fastLen), emaSlow: emaPine(closes, p.slowLen),
    close: n ? c[n - 1].close : NaN, atr: n ? atr[n - 1] : NaN,
  };
}

const closedBefore = (arr: readonly Candle[], tf: Timeframe, t: number) => {
  let e = arr.length;
  while (e > 0 && arr[e - 1].time + TIMEFRAME_MS[tf] > t) e--;
  return arr.slice(0, e);
};

export const snrSndAdapter: StrategyAdapter = {
  key: SNRSND_KEY,
  name: 'SNR H4 + SND H4/H1, entry M15 (indikator TradingView kamu)',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H1', 'H4'],
  htfWindow: { H1: 600, H4: 1000 },
  evaluate(ctx) {
    const p = readSnrSndParams(ctx.params);
    const m = ctx.candles;
    if (m.length < 20 || !ctx.htf?.H4?.length || !ctx.htf?.H1?.length) return [];
    const bar = m[m.length - 1], prevBar = m[m.length - 2];
    const st = ctx.state as { n?: number; last?: number; k4?: number; k1?: number; L4?: Levels; L1?: Levels };
    st.n = (st.n ?? 0) + 1;

    // HTF candles closed before this M15 candle OPENED (Pine lookahead_on + [1])
    const h4 = closedBefore(ctx.htf.H4, 'H4', bar.time), h1 = closedBefore(ctx.htf.H1, 'H1', bar.time);
    if (!h4.length || !h1.length) return [];
    if (st.k4 !== h4[h4.length - 1].time) { st.L4 = htfLevels(h4, p); st.k4 = h4[h4.length - 1].time; }
    if (st.k1 !== h1[h1.length - 1].time) { st.L1 = htfLevels(h1, p); st.k1 = h1[h1.length - 1].time; }
    const L4 = st.L4!, L1 = st.L1!;

    const bullish = L4.emaFast > L4.emaSlow && L4.close > L4.emaFast;
    const bearish = L4.emaFast < L4.emaSlow && L4.close < L4.emaFast;

    const atr15arr = atrPine(m.slice(-120), 14);
    const atr15 = atr15arr[atr15arr.length - 1];
    if (!Number.isFinite(atr15)) return [];
    const { open: o, high: h, low: l, close: c } = bar;
    const range = Math.max(h - l, MINTICK);
    const rejBuy = c > o && c > prevBar.close && (c - l) / range >= p.wickRatio;
    const rejSell = c < o && c < prevBar.close && (h - c) / range >= p.wickRatio;

    const has = (x: number) => !Number.isNaN(x);
    const inD4 = has(L4.dBot) && l <= L4.dTop && h >= L4.dBot && c > L4.dBot;
    const inD1 = has(L1.dBot) && l <= L1.dTop && h >= L1.dBot && c > L1.dBot;
    const inS4 = has(L4.sTop) && h >= L4.sBot && l <= L4.sTop && c < L4.sTop;
    const inS1 = has(L1.sTop) && h >= L1.sBot && l <= L1.sTop && c < L1.sTop;
    const dBot = inD4 && inD1 ? Math.max(L4.dBot, L1.dBot) : inD4 ? L4.dBot : inD1 ? L1.dBot : NaN;
    const sTop = inS4 && inS1 ? Math.min(L4.sTop, L1.sTop) : inS4 ? L4.sTop : inS1 ? L1.sTop : NaN;

    const nearSup = has(L4.support) && c >= L4.support && c - L4.support <= L4.atr * p.snrRadius;
    const nearRes = has(L4.resistance) && c <= L4.resistance && L4.resistance - c <= L4.atr * p.snrRadius;
    const snrBuy = !p.useSNR || nearSup, snrSell = !p.useSNR || nearRes;

    const slBuy = Math.min(dBot, l) - atr15 * p.slBuffer, slSell = Math.max(sTop, h) + atr15 * p.slBuffer;
    const riskBuy = c - slBuy, riskSell = slSell - c;
    const okBuy = Number.isFinite(riskBuy) && riskBuy > MINTICK && riskBuy <= atr15 * p.maxSlATR;
    const okSell = Number.isFinite(riskSell) && riskSell > MINTICK && riskSell <= atr15 * p.maxSlATR;

    const canSignal = st.last == null || st.n - st.last >= p.cooldown;
    const buy = canSignal && bullish && (inD4 || inD1) && snrBuy && rejBuy && okBuy;
    const sell = canSignal && bearish && (inS4 || inS1) && snrSell && rejSell && okSell;
    if (!buy && !sell) return [];
    st.last = st.n;

    const side = buy ? 'long' : 'short';
    const sl = buy ? slBuy : slSell;
    const zoneTf = buy ? (inD4 && inD1 ? 'H4+H1' : inD4 ? 'H4' : 'H1') : (inS4 && inS1 ? 'H4+H1' : inS4 ? 'H4' : 'H1');
    const zone = buy
      ? { kind: 'support' as const, low: dBot, high: inD4 && inD1 ? Math.min(L4.dTop, L1.dTop) : inD4 ? L4.dTop : L1.dTop }
      : { kind: 'resistance' as const, low: inS4 && inS1 ? Math.max(L4.sBot, L1.sBot) : inS4 ? L4.sBot : L1.sBot, high: sTop };
    const ev: StrategyEventDraft = {
      type: 'SETUP_CONFIRMED', candleTime: bar.time, price: c, zone,
      confirmations: { trend: buy ? 'Bullish H4 (EMA50 > EMA200)' : 'Bearish H4 (EMA50 < EMA200)' },
      status: `${buy ? 'BUY' : 'SELL'} — rejection M15 di zona ${buy ? 'demand' : 'supply'} ${zoneTf}, dekat ${buy ? 'support' : 'resistance'} H4`,
      details: { side, stop_loss: Number(sl.toFixed(4)), atr_m15: Number(atr15.toFixed(4)), zone_tf: zoneTf },
    };
    return [ev];
  },
};
