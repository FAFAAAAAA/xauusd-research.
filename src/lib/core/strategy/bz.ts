import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import { altLiquid } from './alt2';

/**
 * BZ · Bollinger squeeze SELL for every liquid Binance Futures coin (research 15 Nov 2026; bot part 'bz', snr_bot.py bz_signal).
 * Closed candles only, UTC.
 *  Squeeze: the H4 Bollinger band width (4 × std20 / SMA20, sample std) of the candle BEFORE the last one is at or below the
 *           20% quantile (linear) of the band widths of the last 120 H4 candles ending at that candle.
 *  SELL:    the last closed H4 candle closes below the lower band (SMA20 − 2 × std20). No trend filter.
 *  Liquid:  30-day average futures volume ≥ $20 jt/hari yesterday (alt-liquid-days.json; params.altAll = true ignores it).
 *  SL = close + 1.5 × ATR14(H4); TP = RR × risk (engine, 1:2); exits only at TP or SL. No BUY.
 *  Research (≈440 coins, 1h Binance data Jul 2020 – Nov 2026, fee+slippage 0.12%): 15,703 trades, win 39%, +0.15R/trade;
 *  portfolio max 2 open: ±16 trades/month, DD 31R, one weak year (2023). Each pair here runs on its own (no position cap).
 */
const H4 = 4 * 3_600_000, DAY = 86_400_000;
const N = 20, K = 2, Q = 0.2, W = 120, SLK = 1.5;
interface St { lastH4?: number }

export const BZ_KEY = 'metode_bz';
export const bzAdapter: StrategyAdapter = {
  key: BZ_KEY,
  name: 'BZ',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H4'],
  htfWindow: { H4: 200 },
  evaluate(ctx) {
    const m = ctx.candles, bar = m[m.length - 1];
    const h4 = ctx.htf?.H4;
    if (!bar || !h4 || h4.length < N + W + 1) return [];
    const n = h4.length, last = h4[n - 1];
    if (last.time + H4 !== ctx.now) return [];
    const st = ctx.state as St;
    if (st.lastH4 === last.time) return [];
    st.lastH4 = last.time;
    const c = h4.map((x) => x.close);
    const band = (j: number) => {
      let s = 0; for (let i = j - N + 1; i <= j; i++) s += c[i];
      const mid = s / N; let v = 0; for (let i = j - N + 1; i <= j; i++) v += (c[i] - mid) ** 2;
      return { mid, sd: Math.sqrt(v / (N - 1)) };
    };
    const k = n - 1, b = band(k);
    if (!(c[k] < b.mid - K * b.sd)) return [];
    const bw: number[] = [];
    for (let j = k - W; j < k; j++) { const x = band(j); bw.push(x.mid > 0 ? (4 * x.sd) / x.mid : Infinity); }
    const srt = [...bw].sort((a, z) => a - z), pos = Q * (srt.length - 1), lo = Math.floor(pos);
    const q = srt[lo] + (srt[Math.min(lo + 1, srt.length - 1)] - srt[lo]) * (pos - lo);
    if (!(bw[bw.length - 1] <= q)) return [];
    if (ctx.params.altAll !== true && !altLiquid(String(ctx.symbol ?? ''), Math.floor(ctx.now / DAY) - 1)) return [];
    let atr = -1;
    for (let i = 1; i < n; i++) {
      const pc = h4[i - 1].close, tr = Math.max(h4[i].high - h4[i].low, Math.abs(h4[i].high - pc), Math.abs(h4[i].low - pc));
      atr = atr < 0 ? tr : atr + (tr - atr) / 14;
    }
    if (!(atr > 0)) return [];
    const out: StrategyEventDraft[] = [{
      type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close, zone: null,
      confirmations: { momentum: 'Squeeze Bollinger H4 (lebar di 20% terendah dari 120 candle) lalu jebol ke bawah' },
      status: `SELL — close H4 di bawah band bawah Bollinger (${(b.mid - K * b.sd).toPrecision(6)}) setelah squeeze`,
      details: { side: 'short', stop_loss: c[k] + SLK * atr, slot: `bz:-1@${bar.time}`, component: 'bz', level: b.mid - K * b.sd },
    }];
    return out;
  },
};
