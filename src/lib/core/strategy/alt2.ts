import type { Candle } from '../types';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import { atrLastEwm, emaLast } from './breakout';
import LIQ from '../alt-liquid-days.json';

/**
 * v2 ALT · deep breakdown SELL for every liquid Binance Futures coin (research 7 Nov 2026, README 6e). Closed candles only, UTC days.
 *  Level = today's UTC open − 1.5 × the previous completed D1 range (high − low).
 *  SELL: the first H1 candle of the day that CLOSES below the level while the H1 candle before it (same day) closed at or above it,
 *        the coin's last completed D1 close is below EMA50 (D1), and the coin was liquid yesterday (30-day average futures volume
 *        ≥ $20 jt/hari, precomputed per day in alt-liquid-days.json; params.altAll = true ignores it).
 *  SL = level + 0.35 × ATR14(D1); TP = RR × risk (engine, 1:2); exits only at TP or SL. No BUY. One signal per coin per day.
 *  Research (1h Binance data, 430 coins, 2020 – Nov 2026, fee+slippage 0.12%): pooled PF 1.26; portfolio max 3 positions,
 *  1 per coin: 17.8 trades/month, win 47%, PF 1.68, DD 35×, every year positive; 77% of coins PF > 1.
 */
const H1 = 3_600_000, DAY = 86_400_000;
const K = 1.5, SLK = 0.35;
const LIQ_DAYS = LIQ as unknown as Record<string, Array<[number, number]>>;
/** was `symbol` liquid (30-day average volume ≥ $20 jt) at the end of UTC day number `d`? Website BTCUSD/ETHUSD map to the USDT pairs. */
export function altLiquid(symbol: string, d: number): boolean {
  const s = symbol.toUpperCase(), r = LIQ_DAYS[s.endsWith('USD') ? `${s}T` : s];
  if (!r) return false;
  let lo = 0, hi = r.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (d < r[m][0]) hi = m - 1; else if (d > r[m][1]) lo = m + 1; else return true; }
  return false;
}
interface St { lastH1?: number; done?: number; dk?: number; rng?: number; atrD?: number; down?: boolean }

export const ALT_BREAKDOWN_KEY = 'metode_alt_breakdown';
export const altBreakdownAdapter: StrategyAdapter = {
  key: ALT_BREAKDOWN_KEY,
  name: 'v2 ALT',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H1', 'D1'],
  htfWindow: { H1: 30, D1: 400 },
  evaluate(ctx) {
    const m = ctx.candles, bar = m[m.length - 1];
    const h1 = ctx.htf?.H1, d1 = ctx.htf?.D1;
    if (!bar || !h1 || h1.length < 3 || !d1 || d1.length < 60) return [];
    const k = h1.length - 1, last = h1[k], prev = h1[k - 1];
    if (last.time + H1 !== ctx.now) return [];
    const st = ctx.state as St;
    if (st.lastH1 === last.time) return [];
    st.lastH1 = last.time;
    const day = Math.floor(last.time / DAY) * DAY;
    if (prev.time < day || st.done === day) return [];
    const dk = d1[d1.length - 1].time;
    if (st.dk !== dk) {
      st.dk = dk; const y: Candle = d1[d1.length - 1];
      st.rng = y.high - y.low; st.atrD = atrLastEwm(d1.slice(-400), 14);
      const c = d1.map((x: Candle) => x.close); st.down = c[c.length - 1] < emaLast(c, 50);
    }
    if (!(st.rng! > 0) || !(st.atrD! > 0) || d1[d1.length - 1].time + DAY !== day) return [];
    let open = NaN;
    for (let j = k; j >= 0 && h1[j].time >= day; j--) open = h1[j].open;
    const level = open - K * st.rng!;
    if (!(last.close < level && prev.close >= level)) return [];
    st.done = day;
    if (!st.down) return [];
    if (ctx.params.altAll !== true && !altLiquid(String(ctx.symbol ?? ''), day / DAY - 1)) return [];
    const sl = level + SLK * st.atrD!;
    const out: StrategyEventDraft[] = [{
      type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close, zone: null,
      confirmations: { trend: 'Turun (close D1 < EMA50 D1)' },
      status: `SELL — close H1 menembus ke bawah open hari ini − 1,5 × range kemarin (${level})`,
      details: { side: 'short', stop_loss: sl, slot: `alt2:-1@${bar.time}`, component: 'alt_breakdown', level },
    }];
    return out;
  },
};
