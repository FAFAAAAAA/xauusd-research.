import type { Candle } from '../types';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import { atrLastEwm, emaLast } from './breakout';

/**
 * v3 · BOS H1 (README 5w). Closed candles only, UTC.
 *  Swings H1: pivot 3 candles left & right (ties count), used once confirmed (3 H1 candles later). Consecutive swings of the
 *  same type are merged (the more extreme one is kept), so the sequence alternates high / low.
 *  BUY : swing low A → swing high B → swing low C with C > A (higher low); the first M15 candle that CLOSES above B
 *        (previous M15 close ≤ B) with the trend up. SL = C − 0.1 × ATR14(H1) at the confirmation of C. One trade per level B.
 *  SELL: mirror — high A → low B → high C with C < A, M15 close below B, SL = C + 0.1 × ATR.
 *  Trend (aturan 1): BUY if H4 close > EMA50 > EMA200 (H4) and D1 close > EMA50 (D1);
 *                    SELL if H4 close < EMA50 < EMA200, D1 close < EMA50 and EMA50 (D1) < EMA200 (D1).
 *  Entry at the next M15 open; TP = RR × risk (engine); exits only at TP or SL; no cap on open positions.
 *  H1 swings are taken from H1 candles closed by the OPEN of the M15 signal candle (same timing as the research script).
 */
const H1 = 3_600_000;
const P = 3;
type Swing = { ty: 1 | -1; px: number; atr: number };
interface St { lastH1?: number; seq?: Swing[]; used?: Record<string, 1>; tk?: string; up?: boolean; dn?: boolean }

/** Feed one newly closed H1 candle (index j of `h`) into the swing sequence: the pivot candidate is j − P. */
function addPivots(h: readonly Candle[], j: number, st: St) {
  const k = j - P;
  if (k < P) return;
  let mx = -Infinity, mn = Infinity;
  for (let x = k - P; x <= k + P; x++) { if (h[x].high > mx) mx = h[x].high; if (h[x].low < mn) mn = h[x].low; }
  const atr = atrLastEwm(h.slice(Math.max(0, j - 399), j + 1), 14);
  const seq = (st.seq ??= []);
  const push = (ty: 1 | -1, px: number) => {
    if (!Number.isFinite(atr)) return;
    const last = seq[seq.length - 1];
    if (last && last.ty === ty) { if ((ty === 1 && px > last.px) || (ty === -1 && px < last.px)) seq[seq.length - 1] = { ty, px, atr }; }
    else seq.push({ ty, px, atr });
    if (seq.length > 6) seq.splice(0, seq.length - 6);
  };
  if (h[k].high === mx) push(1, h[k].high);
  if (h[k].low === mn) push(-1, h[k].low);
}

export const BOSH1_KEY = 'metode_bos_h1';
export const bosH1Adapter: StrategyAdapter = {
  key: BOSH1_KEY,
  name: 'v3 BOS',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H1', 'H4', 'D1'],
  htfWindow: { H1: 1000, H4: 1000, D1: 1000 },
  evaluate(ctx) {
    const m = ctx.candles, bar = m[m.length - 1], prev = m[m.length - 2];
    const h4 = ctx.htf?.H4, d1 = ctx.htf?.D1, h1all = ctx.htf?.H1;
    if (!bar || !prev || !h4?.length || !d1?.length || !h1all?.length || d1.length < 210 || h4.length < 210) return [];
    const st = ctx.state as St;

    // trend from closed H4/D1 candles (same as v1/v2)
    const tk = `${h4[h4.length - 1].time}|${d1[d1.length - 1].time}`;
    if (st.tk !== tk) {
      st.tk = tk;
      const h4c = h4.map((c) => c.close), d1c = d1.map((c) => c.close);
      const e50 = emaLast(h4c, 50), e200 = emaLast(h4c, 200), d50 = emaLast(d1c, 50), d200 = emaLast(d1c, 200);
      const lc4 = h4c[h4c.length - 1], lcd = d1c[d1c.length - 1];
      st.up = lc4 > e50 && e50 > e200 && lcd > d50;
      st.dn = lc4 < e50 && e50 < e200 && lcd < d50 && d50 < d200;
    }

    // swings from H1 candles closed by the open of this M15 candle
    let n = h1all.length;
    while (n > 0 && h1all[n - 1].time + H1 > bar.time) n--;
    const h = n === h1all.length ? h1all : h1all.slice(0, n);
    if (h.length < 2 * P + 2) return [];
    const lastT = h[h.length - 1].time;
    if (st.lastH1 !== lastT) {
      let from = h.length - 1;
      if (st.lastH1 !== undefined) { while (from > 0 && h[from - 1].time > st.lastH1) from--; }
      else { from = 2 * P; st.seq = []; }
      for (let j = from; j < h.length; j++) addPivots(h, j, st);
      st.lastH1 = lastT;
    }
    const seq = st.seq ?? [];
    if (seq.length < 3) return [];
    const [a, b, c] = seq.slice(-3);
    const used = (st.used ??= {});
    const out: StrategyEventDraft[] = [];
    for (const side of [1, -1] as const) {
      const ok = side > 0
        ? c.ty === -1 && b.ty === 1 && a.ty === -1 && c.px > a.px && bar.close > b.px && prev.close <= b.px && st.up
        : c.ty === 1 && b.ty === -1 && a.ty === 1 && c.px < a.px && bar.close < b.px && prev.close >= b.px && st.dn;
      if (!ok) continue;
      const key = `${side}:${b.px}`;
      if (used[key]) continue;
      used[key] = 1;
      const sl = c.px - side * 0.1 * c.atr;
      out.push({
        type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close, zone: null,
        confirmations: { trend: side > 0 ? 'Naik (H4 & D1)' : 'Turun (H4 & D1)' },
        status: `${side > 0 ? 'BUY' : 'SELL'} — close M15 menembus swing ${side > 0 ? 'high' : 'low'} B H1 (${b.px.toFixed(2)}) setelah ${side > 0 ? 'higher low' : 'lower high'} C (${c.px.toFixed(2)}); SL C ${side > 0 ? '−' : '+'} 0,1×ATR H1`,
        details: { side: side > 0 ? 'long' : 'short', stop_loss: Number(sl.toFixed(4)), slot: `bos:${side}@${bar.time}`, component: 'bos_h1', level: b.px, swing_a: a.px, swing_c: c.px },
      });
    }
    return out.slice(0, 1);
  },
};
