import type { Candle } from '../types';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import { atrLastEwm, emaLast } from './breakout';

/**
 * v1 BTC · Donchian H4 50 breakout, BUY only, for Binance USDT-M futures (BTC / ETH). Research 7 Nov 2026 (README 6c).
 * Closed candles only, UTC data, crypto trades 7 days a week (weekend D1 candles count).
 *  BUY : an H4 candle CLOSES above the highest high of the 50 H4 candles before it, and the H4 candle before it did not
 *        (first close beyond), AND the last completed D1 close is above EMA200 (D1).
 *  No SELL (shorts lost money on BTC and ETH in every variant tested).
 *  SL = H4 close − 1.0 × ATR14(D1); TP = RR × risk (engine, 1:2); exits only at TP or SL; no position cap.
 *  Website base timeframe M30 (BTC data from May 2017, ETH from 2018).
 *  Research (M30, Binance taker fee 0.05%/side + slippage + funding): BTC 3.1 trades/month, win 45%, PF 1.56, DD 17.5R;
 *  ETH 2.7/month, win 45%, PF 1.56, DD 17.5R. Median holding ±2.5 days.
 */
const H4 = 4 * 3_600_000;
const N = 50, SLK = 1.0;
interface St { lastH4?: number; tk?: number; up?: boolean; atrD?: number }

export const CRYPTO_DONCHIAN_KEY = 'metode_crypto_donchian';
export const cryptoDonchianAdapter: StrategyAdapter = {
  key: CRYPTO_DONCHIAN_KEY,
  name: 'BIG',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H4', 'D1'],
  htfWindow: { H4: 60, D1: 1000 },
  evaluate(ctx) {
    const m = ctx.candles, bar = m[m.length - 1];
    const h4 = ctx.htf?.H4, d1 = ctx.htf?.D1;
    if (!bar || !h4 || h4.length < N + 2 || !d1 || d1.length < 210) return [];
    const k = h4.length - 1, last = h4[k];
    // act only on the base candle that closes together with a new H4 candle
    if (last.time + H4 !== ctx.now) return [];
    const st = ctx.state as St;
    if (st.lastH4 === last.time) return [];
    st.lastH4 = last.time;

    const dk = d1[d1.length - 1].time;
    if (st.tk !== dk) {
      st.tk = dk;
      const c = d1.map((x: Candle) => x.close);
      st.up = c[c.length - 1] > emaLast(c, 200);
      st.atrD = atrLastEwm(d1.slice(-400), 14);
    }
    const hh = (j: number) => { let v = -Infinity; for (let x = j - N; x < j; x++) if (h4[x].high > v) v = h4[x].high; return v; };
    const lvl = hh(k);
    if (!(last.close > lvl)) return [];
    if (h4[k - 1].close > hh(k - 1)) return [];          // not the first close beyond the channel
    if (!st.up) return [];
    if (!Number.isFinite(st.atrD) || !(st.atrD! > 0)) return [];
    const sl = last.close - SLK * st.atrD!;
    const out: StrategyEventDraft[] = [{
      type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close, zone: null,
      confirmations: { trend: 'Naik (close D1 > EMA200 D1)' },
      status: `BUY — close H4 menembus high 50 candle H4 (${lvl.toFixed(2)}), tren D1 naik`,
      details: { side: 'long', stop_loss: Number(sl.toFixed(2)), slot: `crypto:1@${bar.time}`, component: 'crypto_donchian', level: lvl },
    }];
    return out;
  },
};
