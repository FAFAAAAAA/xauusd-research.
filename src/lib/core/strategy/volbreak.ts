import type { Candle } from '../types';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import { atrLastEwm, emaLast } from './breakout';

/**
 * v2 · Breakout volatilitas (README 5q). UTC days, closed candles only.
 *  Levels for today: up = today's open + 0.5 × yesterday's range (D1 high − low), down = today's open − 0.5 × that range.
 *  BUY : the first base candle (M15) of the day that CLOSES above `up` (previous base close ≤ up), with the trend up.
 *  SELL: mirror below `down`. One signal per direction per day (the first one the trend allows).
 *  SL = level ∓ 1 × ATR14(D1). Entry at the next base open; TP = RR × risk (engine). One position (slot 'one').
 *  Trend (aturan 1): BUY if H4 close > EMA50 > EMA200 (H4) and D1 close > EMA50 (D1);
 *                    SELL if H4 close < EMA50 < EMA200, D1 close < EMA50 and EMA50 (D1) < EMA200 (D1).
 * Parameters (numbers, optional): volK (0.5), volSlAtr (1).
 */
interface St { tk?: string; up?: boolean; dn?: boolean; day?: number; open?: number; used?: Record<string, 1> }
const DAY = 86_400_000;

export const VOLBREAK_KEY = 'metode_volbreak';
export const volBreakAdapter: StrategyAdapter = {
  key: VOLBREAK_KEY,
  name: 'v2 · Breakout volatilitas',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H4', 'D1'],
  htfWindow: { H4: 1000, D1: 1000 },
  evaluate(ctx) {
    const m = ctx.candles, bar = m[m.length - 1], prev = m[m.length - 2];
    const h4 = ctx.htf?.H4, d1 = ctx.htf?.D1;
    if (!bar || !prev || !h4?.length || !d1?.length || d1.length < 210 || h4.length < 210) return [];
    const st = ctx.state as St;
    const k = typeof ctx.params.volK === 'number' ? (ctx.params.volK as number) : 0.5;
    const slAtr = typeof ctx.params.volSlAtr === 'number' ? (ctx.params.volSlAtr as number) : 1;

    // trend from closed H4/D1 candles
    const tk = `${h4[h4.length - 1].time}|${d1[d1.length - 1].time}`;
    if (st.tk !== tk) {
      st.tk = tk;
      const h4c = h4.map((c) => c.close), d1c = d1.map((c) => c.close);
      const e50 = emaLast(h4c, 50), e200 = emaLast(h4c, 200), d50 = emaLast(d1c, 50), d200 = emaLast(d1c, 200);
      const lc4 = h4c[h4c.length - 1], lcd = d1c[d1c.length - 1];
      st.up = lc4 > e50 && e50 > e200 && lcd > d50;
      st.dn = lc4 < e50 && e50 < e200 && lcd < d50 && d50 < d200;
    }
    // today's open = open of the first base candle of the UTC day
    const day = Math.floor(bar.time / DAY) * DAY;
    if (st.day !== day) { st.day = day; st.open = bar.open; st.used = {}; }
    const y: Candle = d1[d1.length - 1];
    if (y.time + DAY > day) return [];                      // yesterday's D1 candle must be closed (it always is at day start)
    const range = y.high - y.low, atr = atrLastEwm(d1.slice(-400), 14);
    if (!(range > 0) || !Number.isFinite(atr)) return [];
    const upL = st.open! + k * range, dnL = st.open! - k * range;
    const used = (st.used ??= {});
    const out: StrategyEventDraft[] = [];
    for (const side of [1, -1] as const) {
      const lv = side > 0 ? upL : dnL;
      if (!(side * (bar.close - lv) > 0 && side * (prev.close - lv) <= 0)) continue;
      if (!(side > 0 ? st.up : st.dn)) continue;
      if (used[side]) continue;
      used[side] = 1;
      const sl = lv - side * slAtr * atr;
      out.push({
        type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close, zone: null,
        confirmations: { trend: side > 0 ? 'Naik (H4 & D1)' : 'Turun (H4 & D1)' },
        status: `${side > 0 ? 'BUY' : 'SELL'} — close menembus open hari ini ${side > 0 ? '+' : '−'} ${k} × range kemarin (${lv.toFixed(2)}); SL ${slAtr}×ATR D1`,
        details: { side: side > 0 ? 'long' : 'short', stop_loss: Number(sl.toFixed(4)), slot: 'one', component: 'volbreak', level: lv, day_open: st.open, prev_range: range },
      });
    }
    return out.slice(0, 1);
  },
};
