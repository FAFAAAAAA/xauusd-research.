import type { Candle } from '../types';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import { atrLastEwm } from './breakout';
import FAST from '../alt-fast-days.json';

/**
 * v1 ALT · SELL volatility breakout for Binance Futures coins (README 6d). Closed candles only, UTC days (crypto: 7 days a week).
 *  Level = today's UTC open − 0.5 × the previous completed D1 range (high − low).
 *  SELL: the first H1 candle of the day that CLOSES below the level while the H1 candle before it (same day) closed at or above it.
 *  SL = level + 0.35 × ATR14(D1); TP = RR × risk (engine, 1:2); exits only at TP or SL. No BUY. One signal per coin per day.
 *  Coin filter (as in the research): trade a coin only on days after it was "fast & crowded" — 30-day average volume ≥ $100 jt/hari
 *  and ATR14 D1 % ≥ the median of those coins — precomputed per day from Binance 1h data (alt-fast-days.json, up to 6 Nov 2026).
 *  params.altAll = true switches the filter off. The research portfolio also caps open positions at 3 (not applied per pair).
 *  Website base timeframe M30 (Binance 30m data).
 */
const H1 = 3_600_000, DAY = 86_400_000;
const K = 0.5, SLK = 0.35;
const FAST_DAYS = FAST as unknown as Record<string, Array<[number, number]>>;
/** was `symbol` fast & crowded at the end of UTC day number `d`? */
export function altFast(symbol: string, d: number): boolean {
  const r = FAST_DAYS[symbol.toUpperCase()];
  if (!r) return false;
  let lo = 0, hi = r.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (d < r[m][0]) hi = m - 1; else if (d > r[m][1]) lo = m + 1; else return true; }
  return false;
}
interface St { lastH1?: number; done?: number; dk?: number; rng?: number; atrD?: number }

export const ALT_VOLBREAK_KEY = 'metode_alt_volbreak';
export const altVolbreakAdapter: StrategyAdapter = {
  key: ALT_VOLBREAK_KEY,
  name: 'v1 ALT (lama)',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H1', 'D1'],
  htfWindow: { H1: 30, D1: 400 },
  evaluate(ctx) {
    const m = ctx.candles, bar = m[m.length - 1];
    const h1 = ctx.htf?.H1, d1 = ctx.htf?.D1;
    if (!bar || !h1 || h1.length < 3 || !d1 || d1.length < 20) return [];
    const k = h1.length - 1, last = h1[k], prev = h1[k - 1];
    if (last.time + H1 !== ctx.now) return [];                 // act on the base candle that closes with a new H1 candle
    const st = ctx.state as St;
    if (st.lastH1 === last.time) return [];
    st.lastH1 = last.time;
    const day = Math.floor(last.time / DAY) * DAY;
    if (prev.time < day || st.done === day) return [];           // first H1 of the day has no same-day previous close; once per day
    const dk = d1[d1.length - 1].time;
    if (st.dk !== dk) { st.dk = dk; const y: Candle = d1[d1.length - 1]; st.rng = y.high - y.low; st.atrD = atrLastEwm(d1.slice(-400), 14); }
    if (!(st.rng! > 0) || !(st.atrD! > 0) || d1[d1.length - 1].time + DAY !== day) return [];   // yesterday must be the last completed day
    let open = NaN;
    for (let j = k; j >= 0 && h1[j].time >= day; j--) open = h1[j].open;   // open of the first H1 candle of the UTC day
    const level = open - K * st.rng!;
    if (!(last.close < level && prev.close >= level)) return [];
    st.done = day;
    if (ctx.params.altAll !== true && !altFast(String(ctx.symbol ?? ''), day / DAY - 1)) return [];   // coin not fast & crowded yesterday
    const sl = level + SLK * st.atrD!;
    const out: StrategyEventDraft[] = [{
      type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close, zone: null,
      confirmations: { trend: '-' },
      status: `SELL — close H1 menembus ke bawah open hari ini − 0,5 × range kemarin (${level})`,
      details: { side: 'short', stop_loss: sl, slot: `alt:-1@${bar.time}`, component: 'alt_volbreak', level },
    }];
    return out;
  },
};
