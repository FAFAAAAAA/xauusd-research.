import type { Candle } from '../types';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import { atrLastEwm, emaLast } from './breakout';

/**
 * Strategies found in the multi-pair study (3 Nov 2026, README 5z). Closed candles only, UTC, base timeframe M15,
 * aturan 1 trend filter, TP via RR (engine), no cap on open positions.
 *
 * Trendline H4: pivots H4 (5 candles left & right, confirmed). BUY when an H4 candle CLOSES above the line through the last
 *   two LOWER pivot highs (previous H4 close at/below the line); SELL mirror with the last two HIGHER pivot lows.
 *   SL = last opposite pivot ∓ 0.1 × ATR14(H4). One trade per line. Best on US100 (2013–2026: PF 1.68), weak elsewhere.
 * Asia → London: range = M15 candles 00:00–06:59 UTC of the day; the first M15 close beyond the range between 07:00 and
 *   11:59 UTC (each side once per day) → entry; SL = other side of the range ∓ 0.1 × ATR14(M15). Best on USDJPY.
 */
const H4 = 4 * 3_600_000, DAY = 86_400_000;
interface Trend { tk?: string; up?: boolean; dn?: boolean }
function trend(st: Trend, h4: readonly Candle[], d1: readonly Candle[]) {
  const tk = `${h4[h4.length - 1].time}|${d1[d1.length - 1].time}`;
  if (st.tk === tk) return;
  st.tk = tk;
  const h4c = h4.map((c) => c.close), d1c = d1.map((c) => c.close);
  const e50 = emaLast(h4c, 50), e200 = emaLast(h4c, 200), d50 = emaLast(d1c, 50), d200 = emaLast(d1c, 200);
  const lc4 = h4c[h4c.length - 1], lcd = d1c[d1c.length - 1];
  st.up = lc4 > e50 && e50 > e200 && lcd > d50;
  st.dn = lc4 < e50 && e50 < e200 && lcd < d50 && d50 < d200;
}

const P = 5;
interface TlSt extends Trend { lastH4?: number; used?: Record<string, 1> }
export const TRENDLINE_H4_KEY = 'metode_trendline_h4';
export const trendlineH4Adapter: StrategyAdapter = {
  key: TRENDLINE_H4_KEY,
  name: 'Trendline H4',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H4', 'D1'],
  htfWindow: { H4: 1000, D1: 1000 },
  evaluate(ctx) {
    const m = ctx.candles, bar = m[m.length - 1];
    const h4 = ctx.htf?.H4, d1 = ctx.htf?.D1;
    if (!bar || !h4?.length || !d1?.length || h4.length < 210 || d1.length < 210) return [];
    const st = ctx.state as TlSt;
    const k = h4.length - 1, last = h4[k];
    // act only on the M15 candle that closes together with a new H4 candle
    if (last.time + H4 !== bar.time + 15 * 60_000 || st.lastH4 === last.time) return [];
    st.lastH4 = last.time;
    trend(st, h4, d1);
    const piv = (hi: boolean): number[] => {
      const out: number[] = [];
      for (let x = P; x <= k - P; x++) {
        let ok = true;
        for (let y = x - P; y <= x + P && ok; y++) if (hi ? h4[y].high > h4[x].high : h4[y].low < h4[x].low) ok = false;
        if (ok) out.push(x);
      }
      return out;
    };
    const ph = piv(true), pl = piv(false);
    const used = (st.used ??= {});
    const atr = atrLastEwm(h4.slice(-400), 14);
    const out: StrategyEventDraft[] = [];
    for (const side of [1, -1] as const) {
      const idx = side > 0 ? ph : pl, opp = side > 0 ? pl : ph;
      if (idx.length < 2 || !opp.length) continue;
      const p1 = idx[idx.length - 2], p2 = idx[idx.length - 1];
      const v = (x: number) => (side > 0 ? h4[x].high : h4[x].low);
      if (!(side * (v(p2) - v(p1)) < 0)) continue;                       // lower highs (BUY) / higher lows (SELL)
      const key = `${side}:${h4[p1].time}:${h4[p2].time}`;
      if (used[key]) continue;
      const slope = (v(p2) - v(p1)) / (p2 - p1);
      const lineNow = v(p2) + slope * (k - p2), linePrev = v(p2) + slope * (k - 1 - p2);
      if (!(side * (last.close - lineNow) > 0 && side * (h4[k - 1].close - linePrev) <= 0)) continue;
      used[key] = 1;
      if (!(side > 0 ? st.up : st.dn)) continue;
      const o = opp[opp.length - 1];
      const sl = (side > 0 ? h4[o].low : h4[o].high) - side * 0.1 * atr;
      out.push({
        type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close, zone: null,
        confirmations: { trend: side > 0 ? 'Naik (H4 & D1)' : 'Turun (H4 & D1)' },
        status: `${side > 0 ? 'BUY' : 'SELL'} — close H4 menembus trendline (${lineNow.toFixed(2)})`,
        details: { side: side > 0 ? 'long' : 'short', stop_loss: Number(sl.toFixed(4)), slot: `tl:${side}@${bar.time}`, component: 'trendline_h4', level: lineNow },
      });
    }
    return out.slice(0, 1);
  },
};

interface AlSt extends Trend { day?: number; done?: Record<string, 1> }
export const ASIA_LONDON_KEY = 'metode_asia_london';
export const asiaLondonAdapter: StrategyAdapter = {
  key: ASIA_LONDON_KEY,
  name: 'Asia → London',
  configured: true,
  testOnly: false,
  warmupCandles: 60,
  requiredTimeframes: ['H4', 'D1'],
  htfWindow: { H4: 1000, D1: 1000 },
  evaluate(ctx) {
    const m = ctx.candles, bar = m[m.length - 1], prev = m[m.length - 2];
    const h4 = ctx.htf?.H4, d1 = ctx.htf?.D1;
    if (!bar || !prev || !h4?.length || !d1?.length || h4.length < 210 || d1.length < 210) return [];
    const day = Math.floor(bar.time / DAY) * DAY, mins = (bar.time - day) / 60_000;
    if (mins < 420 || mins >= 720) return [];                           // breakout window 07:00–11:59 UTC
    const st = ctx.state as AlSt;
    if (st.day !== day) { st.day = day; st.done = {}; }
    let rh = -Infinity, rl = Infinity;
    for (let i = m.length - 1; i >= 0 && m[i].time >= day; i--) {
      if (m[i].time < day + 420 * 60_000) { rh = Math.max(rh, m[i].high); rl = Math.min(rl, m[i].low); }
    }
    if (!Number.isFinite(rh) || !Number.isFinite(rl)) return [];
    trend(st, h4, d1);
    const atr = atrLastEwm(m.slice(-200), 14);
    const out: StrategyEventDraft[] = [];
    for (const side of [1, -1] as const) {
      const lv = side > 0 ? rh : rl;
      if (st.done![side] || !(side * (bar.close - lv) > 0 && side * (prev.close - lv) <= 0)) continue;
      st.done![side] = 1;
      if (!(side > 0 ? st.up : st.dn)) continue;
      const sl = (side > 0 ? rl : rh) - side * 0.1 * atr;
      out.push({
        type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close, zone: null,
        confirmations: { trend: side > 0 ? 'Naik (H4 & D1)' : 'Turun (H4 & D1)' },
        status: `${side > 0 ? 'BUY' : 'SELL'} — close M15 keluar range Asia (${rl.toFixed(3)}–${rh.toFixed(3)})`,
        details: { side: side > 0 ? 'long' : 'short', stop_loss: Number(sl.toFixed(5)), slot: `al:${side}@${bar.time}`, component: 'asia_london', level: lv },
      });
    }
    return out.slice(0, 1);
  },
};
