import type { Candle } from '../types';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import { atrLastEwm, emaLast } from './breakout';

/**
 * v1 NAS · Donchian H1 20 breakout on US100 (research 7 Nov 2026, README 6b). Closed candles only, UTC data.
 *  BUY : an H1 candle CLOSES above the highest high of the 20 H1 candles before it, aturan 1 trend up
 *        (H4 close > EMA50 > EMA200 & D1 close > EMA50), AND the previous trend-aligned breakout of the same side happened at
 *        most 2 H1 candles earlier ("breakout lanjutan"), AND the entry (next base-candle open = the H1 close) falls between
 *        10:00 and 16:00 New York time (US cash session; DST handled).
 *  SELL: mirror (close below the 20-candle low, trend down incl. EMA50 D1 < EMA200 D1).
 *  SL = H1 close ∓ 0.2 × ATR14(D1, completed weekdays); TP = RR × risk (engine, 1:2); exits only at TP or SL; no position cap.
 *  Website base timeframe M30 (data from May 2013). Backtest 2013–2026 (M30, Exness USTEC costs): ±5.6 trades/month, win 46%, PF 1.52, +20R/yr, max DD 15R, 1 losing year.
 */
const H1 = 3_600_000;
const N = 20, GAP = 2, SLK = 0.2, NY_FROM = 10, NY_TO = 16;
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
/** New York wall-clock hour (fractional) of a UTC timestamp. */
export function nyHour(ms: number): number {
  const p = nyFmt.formatToParts(new Date(ms));
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? NaN), m = Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  return (h % 24) + m / 60;
}
interface St { lastH1?: number; last?: Record<string, number>; tk?: string; up?: boolean; dn?: boolean; atrD?: number }

export const NAS_DONCHIAN_KEY = 'metode_nas_donchian';
export const nasDonchianAdapter: StrategyAdapter = {
  key: NAS_DONCHIAN_KEY,
  name: 'v1 NAS',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H1', 'H4', 'D1'],
  htfWindow: { H1: 60, H4: 1000, D1: 1000 },
  evaluate(ctx) {
    const m = ctx.candles, bar = m[m.length - 1];
    const h1 = ctx.htf?.H1, h4 = ctx.htf?.H4, d1all = ctx.htf?.D1;
    if (!bar || !h1 || h1.length < N + 2 || !h4 || h4.length < 210 || !d1all?.length) return [];
    const k = h1.length - 1, last = h1[k];
    // act only on the base candle (M15 or M30) that closes together with a new H1 candle
    if (last.time + H1 !== ctx.now) return [];
    const st = ctx.state as St;
    if (st.lastH1 === last.time) return [];
    st.lastH1 = last.time;

    // trend (aturan 1) and ATR D1 from completed weekday D1 candles; recomputed when a new H4 / D1 candle closes
    const tk = `${h4[h4.length - 1].time}|${d1all[d1all.length - 1].time}`;
    if (st.tk !== tk) {
      st.tk = tk;
      const d1: Candle[] = d1all.filter((c) => { const wd = new Date(c.time).getUTCDay(); return wd >= 1 && wd <= 5; });
      if (d1.length < 210) { st.up = st.dn = false; st.atrD = NaN; }
      else {
        const h4c = h4.map((c) => c.close), d1c = d1.map((c) => c.close);
        const e50 = emaLast(h4c, 50), e200 = emaLast(h4c, 200), d50 = emaLast(d1c, 50), d200 = emaLast(d1c, 200);
        const lc4 = h4c[h4c.length - 1], lcd = d1c[d1c.length - 1];
        st.up = lc4 > e50 && e50 > e200 && lcd > d50;
        st.dn = lc4 < e50 && e50 < e200 && lcd < d50 && d50 < d200;
        st.atrD = atrLastEwm(d1.slice(-400), 14);
      }
    }

    let hh = -Infinity, ll = Infinity;
    for (let x = k - N; x < k; x++) { if (h1[x].high > hh) hh = h1[x].high; if (h1[x].low < ll) ll = h1[x].low; }
    const lastSig = (st.last ??= {});
    const entryTime = ctx.now, nyh = nyHour(entryTime);   // entry = next base candle open = the H1 close
    const out: StrategyEventDraft[] = [];
    for (const side of [1, -1] as const) {
      if (!(side > 0 ? last.close > hh : last.close < ll)) continue;
      if (!(side > 0 ? st.up : st.dn)) continue;
      // gap (in H1 candles) to the previous trend-aligned breakout of this side
      const prev = lastSig[side];
      lastSig[side] = last.time;
      let gap = Infinity;
      if (prev !== undefined) for (let j = k - 1; j >= Math.max(0, k - GAP); j--) if (h1[j].time === prev) { gap = k - j; break; }
      if (!(gap <= GAP)) continue;
      if (!(nyh >= NY_FROM && nyh < NY_TO)) continue;
      if (!Number.isFinite(st.atrD) || !(st.atrD! > 0)) continue;
      const sl = last.close - side * SLK * st.atrD!;
      out.push({
        type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close, zone: null,
        confirmations: { trend: side > 0 ? 'Naik (H4 & D1)' : 'Turun (H4 & D1)' },
        status: `${side > 0 ? 'BUY' : 'SELL'} — close H1 menembus ${side > 0 ? 'high' : 'low'} 20 candle (${(side > 0 ? hh : ll).toFixed(2)}), breakout lanjutan (${gap} jam), sesi New York ${Math.floor(nyh)}:00`,
        details: { side: side > 0 ? 'long' : 'short', stop_loss: Number(sl.toFixed(2)), slot: `nas:${side}@${bar.time}`, component: 'nas_donchian', level: side > 0 ? hh : ll, gap_h1: gap },
      });
    }
    return out.slice(0, 1);
  },
};
