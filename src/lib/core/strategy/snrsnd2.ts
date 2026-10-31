import { TIMEFRAME_MS, type Candle, type Timeframe } from '../types';
import type { StrategyAdapter } from './adapter';
import { atrPine, emaPine } from './snrsnd';

/**
 * Port of the owner's TradingView strategy "XAUUSD SNR + SND v2 | STRATEGY | RR 1:2" (Pine v6),
 * file pine/owner_XAUUSD_SNR_SND_v2_STRATEGY.pine. Default inputs, mode "Semua".
 *  - HTF (H4, H1) values from the last CLOSED candle before the M15 candle opened (Pine: [1] + lookahead_on).
 *  - Trend H4: EMA50 > EMA200 and close > EMA50 (structure HH+HL optional, off by default).
 *  - Zones H4/H1: opposite candle before a displacement (body ≥ 0.8×ATR, breaks 5-bar high/low).
 *    A zone dies when a candle closes through it, when older than 90 (H4) / 120 (H1) bars, or after more than 2 touches.
 *  - Entry M15 (close in the top/bottom 30%): Rejection (wick ≥ 0.6×body), Sweep (takes the 8-bar low/high and closes back),
 *    or Break-Retest (12-bar break in trend, retest within 8 bars, tolerance 0.25×ATR).
 *  - Zone “near” = within 0.5×ATR(M15). SL = beyond candle/zone + 0.15×ATR(M15); risk ≤ 4×ATR(M15). Cooldown 8 bars.
 *  - TP = RR × risk (engine). Max 1 position (engine). Time exit after 96 M15 candles (details.max_bars).
 * Difference: Pine fills at the signal close (process_orders_on_close); the website fills at the next M15 open (more realistic).
 */
export const SNRSND2_KEY = 'snr_snd_mtf_v2';
const P = {
  fastLen: 50, slowLen: 200, pivotLen: 3, requireStructure: false, impulseATR: 0.8, structureBreak: 5, maxTouches: 2,
  maxAge4: 90, maxAge1: 120, useSNR: false, snrATR: 1.0, proximityATR: 0.5, closeStrength: 0.7, wickBodyMin: 0.6,
  sweepLookback: 8, breakLookback: 12, retestBars: 8, retestTolerance: 0.25, slBufferATR: 0.15, maxStopATR: 4.0, cooldownBars: 8, maxHoldBars: 96,
};
const MINTICK = 0.01;

interface Lv { r: number; sup: number; dLo: number; dHi: number; sLo: number; sHi: number; ef: number; es: number; c: number; atr: number; hhhl: boolean; lhll: boolean }

/** f_htf(ageLimit) over CLOSED candles; returns the state after the last one. */
export function htfLevels2(c: readonly Candle[], ageLimit: number): Lv {
  const n = c.length, L = P.pivotLen, atr = atrPine(c, 14);
  let r = NaN, sup = NaN, prevPH = NaN, prevPL = NaN;
  let dLo = NaN, dHi = NaN, sLo = NaN, sHi = NaN, dBorn = -1, sBorn = -1, dT = 0, sT = 0, dWas = false, sWas = false;
  for (let j = 0; j < n; j++) {
    const k = j - L;
    if (k >= L) {
      let ph = true, pl = true;
      for (let q = 1; q <= L && (ph || pl); q++) {
        if (!(c[k].high > c[k - q].high && c[k].high >= c[k + q].high)) ph = false;
        if (!(c[k].low < c[k - q].low && c[k].low <= c[k + q].low)) pl = false;
      }
      if (ph) { prevPH = r; r = c[k].high; }
      if (pl) { prevPL = sup; sup = c[k].low; }
    }
    const b = c[j];
    if (!Number.isNaN(dLo)) {
      const ov = b.low <= dHi && b.high >= dLo;
      if (j > dBorn && ov && !dWas) dT++;
      dWas = ov;
      if (b.close < dLo || j - dBorn > ageLimit || dT > P.maxTouches) { dLo = dHi = NaN; dBorn = -1; dT = 0; dWas = false; }
    }
    if (!Number.isNaN(sHi)) {
      const ov = b.high >= sLo && b.low <= sHi;
      if (j > sBorn && ov && !sWas) sT++;
      sWas = ov;
      if (b.close > sHi || j - sBorn > ageLimit || sT > P.maxTouches) { sLo = sHi = NaN; sBorn = -1; sT = 0; sWas = false; }
    }
    if (j >= P.structureBreak && j >= 1 && Number.isFinite(atr[j])) {
      let hh = -Infinity, ll = Infinity;
      for (let q = j - P.structureBreak; q < j; q++) { hh = Math.max(hh, c[q].high); ll = Math.min(ll, c[q].low); }
      const pv = c[j - 1];
      if (b.close > b.open && pv.close < pv.open && b.close - b.open >= atr[j] * P.impulseATR && b.close > hh) { dLo = pv.low; dHi = pv.open; dBorn = j; dT = 0; dWas = false; }
      if (b.close < b.open && pv.close > pv.open && b.open - b.close >= atr[j] * P.impulseATR && b.close < ll) { sLo = pv.open; sHi = pv.high; sBorn = j; sT = 0; sWas = false; }
    }
  }
  const cl = c.map((x) => x.close);
  const ok = !Number.isNaN(r) && !Number.isNaN(prevPH) && !Number.isNaN(sup) && !Number.isNaN(prevPL);
  return { r, sup, dLo, dHi, sLo, sHi, ef: emaPine(cl, P.fastLen), es: emaPine(cl, P.slowLen), c: n ? cl[n - 1] : NaN, atr: n ? atr[n - 1] : NaN,
    hhhl: ok && r > prevPH && sup > prevPL, lhll: ok && r < prevPH && sup < prevPL };
}

const closedBefore = (arr: readonly Candle[], tf: Timeframe, t: number) => {
  let e = arr.length;
  while (e > 0 && arr[e - 1].time + TIMEFRAME_MS[tf] > t) e--;
  return arr.slice(0, e);
};

interface St { n?: number; last?: number; k4?: number; k1?: number; L4?: Lv; L1?: Lv; pLL?: number; pLB?: number; pSL?: number; pSB?: number }

export const snrSnd2Adapter: StrategyAdapter = {
  key: SNRSND2_KEY,
  name: 'SNR + SND v2 (strategy Pine kamu)',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H1', 'H4'],
  htfWindow: { H1: 600, H4: 1000 },
  evaluate(ctx) {
    const m = ctx.candles;
    if (m.length < 20 || !ctx.htf?.H4?.length || !ctx.htf?.H1?.length) return [];
    const i = m.length - 1, bar = m[i], prev = m[i - 1];
    const st = ctx.state as St;
    st.n = (st.n ?? 0) + 1;
    const n = st.n;

    const h4 = closedBefore(ctx.htf.H4, 'H4', bar.time), h1 = closedBefore(ctx.htf.H1, 'H1', bar.time);
    if (!h4.length || !h1.length) return [];
    if (st.k4 !== h4[h4.length - 1].time) { st.L4 = htfLevels2(h4, P.maxAge4); st.k4 = h4[h4.length - 1].time; }
    if (st.k1 !== h1[h1.length - 1].time) { st.L1 = htfLevels2(h1, P.maxAge1); st.k1 = h1[h1.length - 1].time; }
    const A = st.L4!, B = st.L1!;
    const bullTrend = !Number.isNaN(A.es) && A.ef > A.es && A.c > A.ef && (!P.requireStructure || A.hhhl);
    const bearTrend = !Number.isNaN(A.es) && A.ef < A.es && A.c < A.ef && (!P.requireStructure || A.lhll);

    const a15arr = atrPine(m.slice(-150), 14), atr15 = a15arr[a15arr.length - 1];
    if (!Number.isFinite(atr15)) return [];
    const { open: o, high: h, low: l, close: c } = bar;
    const size = Math.max(h - l, MINTICK), body = Math.max(Math.abs(c - o), MINTICK);
    const lowerWick = Math.min(o, c) - l, upperWick = h - Math.max(o, c);
    const strongBuy = c > o && (c - l) / size >= P.closeStrength;
    const strongSell = c < o && (h - c) / size >= P.closeStrength;

    const has = (x: number) => !Number.isNaN(x);
    const px = atr15 * P.proximityATR;
    const nD4 = has(A.dLo) && l <= A.dHi + px && h >= A.dLo && c > A.dLo;
    const nD1 = has(B.dLo) && l <= B.dHi + px && h >= B.dLo && c > B.dLo;
    const nS4 = has(A.sHi) && h >= A.sLo - px && l <= A.sHi && c < A.sHi;
    const nS1 = has(B.sHi) && h >= B.sLo - px && l <= B.sHi && c < B.sHi;
    const buyBase = nD4 && nD1 ? Math.max(A.dLo, B.dLo) : nD1 ? B.dLo : nD4 ? A.dLo : NaN;
    const sellCap = nS4 && nS1 ? Math.min(A.sHi, B.sHi) : nS1 ? B.sHi : nS4 ? A.sHi : NaN;
    const zBuy = has(buyBase), zSell = has(sellCap);
    const snrBuy = !P.useSNR || (has(A.sup) && Math.abs(c - A.sup) <= A.atr * P.snrATR);
    const snrSell = !P.useSNR || (has(A.r) && Math.abs(c - A.r) <= A.atr * P.snrATR);

    const rejBuy = zBuy && strongBuy && lowerWick >= body * P.wickBodyMin;
    const rejSell = zSell && strongSell && upperWick >= body * P.wickBodyMin;
    const win = (k: number) => m.slice(Math.max(0, i - k), i);
    const sw = win(P.sweepLookback), prevLow = Math.min(...sw.map((x) => x.low)), prevHigh = Math.max(...sw.map((x) => x.high));
    const sweepBuy = zBuy && strongBuy && l < prevLow && c > prevLow;
    const sweepSell = zSell && strongSell && h > prevHigh && c < prevHigh;

    // break → retest state machine (runs on every candle, like the Pine vars)
    const bw = win(P.breakLookback), breakHigh = Math.max(...bw.map((x) => x.high)), breakLow = Math.min(...bw.map((x) => x.low));
    if (c > breakHigh && prev.close <= breakHigh && strongBuy && bullTrend) { st.pLL = breakHigh; st.pLB = n; }
    if (c < breakLow && prev.close >= breakLow && strongSell && bearTrend) { st.pSL = breakLow; st.pSB = n; }
    if (st.pLB != null && n - st.pLB > P.retestBars) { st.pLL = undefined; st.pLB = undefined; }
    if (st.pSB != null && n - st.pSB > P.retestBars) { st.pSL = undefined; st.pSB = undefined; }
    const tol = atr15 * P.retestTolerance;
    const retestBuy = zBuy && st.pLB != null && n > st.pLB && l <= st.pLL! + tol && c > st.pLL! && strongBuy;
    const retestSell = zSell && st.pSB != null && n > st.pSB && h >= st.pSL! - tol && c < st.pSL! && strongSell;
    if (retestBuy || (st.pLL != null && c < st.pLL - tol)) { st.pLL = undefined; st.pLB = undefined; }
    if (retestSell || (st.pSL != null && c > st.pSL + tol)) { st.pSL = undefined; st.pSB = undefined; }

    const longPattern = sweepBuy || retestBuy || rejBuy, shortPattern = sweepSell || retestSell || rejSell;
    const longType = sweepBuy ? 'SWEEP' : retestBuy ? 'RETEST' : 'REJECTION';
    const shortType = sweepSell ? 'SWEEP' : retestSell ? 'RETEST' : 'REJECTION';
    const buySL = Math.min(l, buyBase) - atr15 * P.slBufferATR, sellSL = Math.max(h, sellCap) + atr15 * P.slBufferATR;
    const riskBuy = c - buySL, riskSell = sellSL - c;
    const okB = Number.isFinite(riskBuy) && riskBuy > MINTICK && riskBuy <= atr15 * P.maxStopATR;
    const okS = Number.isFinite(riskSell) && riskSell > MINTICK && riskSell <= atr15 * P.maxStopATR;
    const cooldownOK = st.last == null || n - st.last >= P.cooldownBars;
    const buy = cooldownOK && bullTrend && snrBuy && longPattern && okB;
    const sell = cooldownOK && bearTrend && snrSell && shortPattern && okS;
    if (!buy && !sell) return [];
    st.last = n;
    const side = buy ? 'long' : 'short', type = buy ? longType : shortType, sl = buy ? buySL : sellSL;
    return [{
      type: 'SETUP_CONFIRMED', candleTime: bar.time, price: c,
      zone: buy ? { kind: 'support', low: buyBase, high: nD4 && nD1 ? Math.min(A.dHi, B.dHi) : nD1 ? B.dHi : A.dHi }
        : { kind: 'resistance', low: nS4 && nS1 ? Math.max(A.sLo, B.sLo) : nS1 ? B.sLo : A.sLo, high: sellCap },
      confirmations: { trend: buy ? 'Bullish H4 (EMA50 > EMA200)' : 'Bearish H4 (EMA50 < EMA200)' },
      status: `${buy ? 'BUY' : 'SELL'} ${type} di zona ${buy ? 'demand' : 'supply'}`,
      details: { side, stop_loss: Number(sl.toFixed(4)), pattern: type, max_bars: P.maxHoldBars },
    }];
  },
};
