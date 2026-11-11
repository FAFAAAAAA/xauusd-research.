import type { Candle } from '../types';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import { emaLast } from './breakout';
import { altLiquid } from './alt2';

/**
 * v1 SNR · support break SELL for Binance Futures altcoins (research 7 Nov 2026, README 6f). Closed candles only, UTC.
 *  Support = an H4 low that is the lowest of the 5 H4 candles on each side (known only after the 5 candles to its right closed).
 *  The 10 most recent supports are watched; each is used once.
 *  SELL: an H4 candle CLOSES below a watched support while the H4 candle before it closed at or above it,
 *        the coin's last completed D1 close is below EMA50 (D1), and the coin was liquid yesterday (30-day average futures
 *        volume ≥ $20 jt/hari, alt-liquid-days.json; params.altAll = true ignores it).
 *  SL = support + 0.5 × ATR14(H4); TP = RR × risk (engine, 1:2); exits only at TP or SL. No BUY.
 *  Research (440 liquid coins, 1h Binance data 2020 – 6 Nov 2026, fee+slippage 0.12%): portfolio max 3 open positions, 1 per coin:
 *  ±54 trades/month, win 43%, PF 1.41, DD 41×, every year profitable, median hold 8 h. Works on altcoins, not on BTC.
 *  Levels are rebuilt from the last 600 H4 candles at every H4 close (same walk as the research).
 */
const H4 = 4 * 3_600_000, DAY = 86_400_000;
const PV = 5, KEEP = 10, SLK = 0.5, WIN = 600;
interface St { lastH4?: number; dk?: number; down?: boolean }

export const SNR_SELL_KEY = 'metode_snr_sell';
export const snrSellAdapter: StrategyAdapter = {
  key: SNR_SELL_KEY,
  name: 'ALT',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H4', 'D1'],
  htfWindow: { H4: WIN, D1: 400 },
  evaluate(ctx) {
    const m = ctx.candles, bar = m[m.length - 1];
    const h4 = ctx.htf?.H4, d1 = ctx.htf?.D1;
    if (!bar || !h4 || h4.length < 40 || !d1 || d1.length < 60) return [];
    const n = h4.length, last = h4[n - 1];
    if (last.time + H4 !== ctx.now) return [];
    const st = ctx.state as St;
    if (st.lastH4 === last.time) return [];
    st.lastH4 = last.time;
    const dk = d1[d1.length - 1].time;
    if (st.dk !== dk) { st.dk = dk; const c = d1.map((x: Candle) => x.close); st.down = c[c.length - 1] < emaLast(c, 50); }
    // ATR14 of H4 (Wilder EWM) at the last candle
    let atr = -1;
    for (let i = 1; i < n; i++) {
      const pc = h4[i - 1].close, tr = Math.max(h4[i].high - h4[i].low, Math.abs(h4[i].high - pc), Math.abs(h4[i].low - pc));
      atr = atr < 0 ? tr : atr + (tr - atr) / 14;
    }
    // walk the window: confirm pivots, keep the last 10 supports, mark them used when broken; act only on the last candle
    const sup: Array<{ p: number; used: boolean }> = [];
    let hit: number | null = null;
    for (let k = 2 * PV; k < n; k++) {
      const q = k - PV; let isLow = true;
      for (let j = q - PV; j <= q + PV; j++) if (h4[j].low < h4[q].low) { isLow = false; break; }
      if (isLow) { sup.push({ p: h4[q].low, used: false }); if (sup.length > KEEP) sup.shift(); }
      const c = h4[k].close, pc = h4[k - 1].close;
      for (const lv of sup) {
        if (!lv.used && c < lv.p && pc >= lv.p) { lv.used = true; if (k === n - 1 && hit === null) hit = lv.p; }
      }
    }
    if (hit === null || !st.down || !(atr > 0)) return [];
    if (ctx.params.altAll !== true && !altLiquid(String(ctx.symbol ?? ''), Math.floor(ctx.now / DAY) - 1)) return [];
    const sl = hit + SLK * atr;
    const out: StrategyEventDraft[] = [{
      type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close, zone: null,
      confirmations: { trend: 'Turun (close D1 < EMA50 D1)' },
      status: `SELL — close H4 menembus support ${hit}`,
      details: { side: 'short', stop_loss: sl, slot: `snrs:-1@${bar.time}`, component: 'snr_sell', level: hit },
    }];
    return out;
  },
};
