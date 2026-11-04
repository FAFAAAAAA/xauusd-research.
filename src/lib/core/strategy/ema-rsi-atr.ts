import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import type { Candle } from '../types';
import { emaLast } from './breakout';
import { atrLast } from './builder';

/**
 * XAUUSD research baseline: D1 + H4 EMA trend, M15 EMA50 pullback,
 * RSI14 crossover of 50 and ATR14 stop = 1.5 x ATR. TP is set by the
 * backtest engine at RR 1:2 using the actual next-open fill.
 *
 * Candle data is already closed and HTFs are filtered by the engine.
 * No discretionary filters, intrabar signal fills, trailing, or break-even.
 */
const EMA_FAST = 50;
const EMA_SLOW = 200;
const RSI_PERIOD = 14;
const ATR_PERIOD = 14;

type TrendState = { key?: string; buy?: boolean; sell?: boolean };

function emaSeries(values: readonly number[], length: number): number[] {
  const a = 2 / (length + 1);
  const out = new Array<number>(values.length);
  let v = values[0];
  for (let i = 0; i < values.length; i++) {
    if (i > 0) v = a * values[i] + (1 - a) * v;
    out[i] = v;
  }
  return out;
}

/** Wilder RSI (SMA seeded, then Wilder smoothing); returns last and previous. */
function rsiPair(values: readonly number[], length: number): [number, number] {
  if (values.length < length + 2) return [NaN, NaN];
  let avgUp = 0, avgDown = 0;
  for (let k = 1; k <= length; k++) {
    const diff = values[k] - values[k - 1];
    avgUp += Math.max(0, diff) / length;
    avgDown += Math.max(0, -diff) / length;
  }
  const score = () => avgDown === 0 ? (avgUp === 0 ? 50 : 100)
    : 100 - 100 / (1 + avgUp / avgDown);
  let prev = NaN, cur = score();
  for (let k = length + 1; k < values.length; k++) {
    prev = cur;
    const diff = values[k] - values[k - 1];
    avgUp = ((length - 1) * avgUp + Math.max(diff, 0)) / length;
    avgDown = ((length - 1) * avgDown + Math.max(-diff, 0)) / length;
    cur = score();
  }
  return [prev, cur];
}

function emaTrend(c: readonly Candle[], positive: boolean): boolean {
  if (c.length < EMA_SLOW + 10) return false;
  const closes = c.map((x) => x.close);
  const f = emaLast(closes, EMA_FAST), s = emaLast(closes, EMA_SLOW);
  return positive ? f > s : f < s;
}

export const emaRsiAtrAdapter: StrategyAdapter = {
  key: 'metode_ema_rsi_atr',
  name: 'EMA 50/200 + RSI + ATR',
  configured: true,
  testOnly: false,
  warmupCandles: 220,
  requiredTimeframes: ['D1', 'H4'],
  htfWindow: { D1: 600, H4: 600 },
  evaluate(ctx): StrategyEventDraft[] {
    if (ctx.symbol !== 'XAUUSD' || ctx.timeframe !== 'M15') return [];
    const m = ctx.candles, n = m.length, signal = m[n - 1];
    const d = ctx.htf?.D1, h = ctx.htf?.H4;
    if (!signal || n < 220 || !d || !h || d.length < 210 || h.length < 210) return [];

    const trend = ctx.state as TrendState;
    const trendKey = String(d[d.length - 1].time) + '|' + String(h[h.length - 1].time);
    if (trend.key !== trendKey) {
      trend.key = trendKey;
      const dc = d.map((x) => x.close), hc = h.map((x) => x.close);
      const d50 = emaLast(dc, EMA_FAST), d200 = emaLast(dc, EMA_SLOW);
      const h50 = emaLast(hc, EMA_FAST), h200 = emaLast(hc, EMA_SLOW);
      trend.buy = d50 > d200 && d[d.length - 1].close > d200
        && h50 > h200 && h[h.length - 1].close > h50;
      trend.sell = d50 < d200 && d[d.length - 1].close < d200
        && h50 < h200 && h[h.length - 1].close < h50;
    }
    if (!trend.buy && !trend.sell) return [];

    const close = m.map((x) => x.close);
    const e50 = emaSeries(close, EMA_FAST), e200 = emaSeries(close, EMA_SLOW);
    const rsi = rsiPair(close, RSI_PERIOD);
    const atr = atrLast(m, ATR_PERIOD);
    if (!(atr > 0) || !Number.isFinite(rsi[0]) || !Number.isFinite(rsi[1])) return [];

    const i = n - 1;
    const range = signal.high - signal.low;
    if (!(range > 0) || Math.abs(signal.close - signal.open) / range < 0.4 || range > 2 * atr) return [];
    const m15Up = e50[i] > e200[i], m15Down = e50[i] < e200[i];
    const pullbackBuy = m.slice(i - 4, i).some((c, k) => {
      const j = i - 4 + k;
      return c.low <= e50[j] + 0.25 * atr && c.close >= e200[j];
    });
    const pullbackSell = m.slice(i - 4, i).some((c, k) => {
      const j = i - 4 + k;
      return c.high >= e50[j] - 0.25 * atr && c.close <= e200[j];
    });
    const buy = trend.buy && m15Up && pullbackBuy && signal.close > signal.open
      && signal.close > e50[i] && signal.close > e200[i]
      && rsi[0] <= 50 && rsi[1] > 50;
    const sell = trend.sell && m15Down && pullbackSell && signal.close < signal.open
      && signal.close < e50[i] && signal.close < e200[i]
      && rsi[0] >= 50 && rsi[1] < 50;
    if (!buy && !sell) return [];
    const side = buy ? 'long' : 'short';
    return [{
      type: 'SETUP_CONFIRMED',
      candleTime: signal.time,
      price: signal.close,
      confirmations: { trend: buy ? 'Bullish EMA D1 + H4' : 'Bearish EMA D1 + H4' },
      status: (buy ? 'BUY' : 'SELL') + ' M15: pullback EMA50 + RSI14 menembus level 50; SL 1.5 ATR, RR 1:2',
      details: {
        side, slot: 'all', component: 'ema_rsi_atr_v1',
        stop_distance: 1.5 * atr,
        max_spread: 0.1 * atr,
        atr: Number(atr.toFixed(5)), rsi: Number(rsi[1].toFixed(2)),
        ema50: Number(e50[i].toFixed(5)), ema200: Number(e200[i].toFixed(5)),
      },
    }];
  },
};
