import { TIMEFRAME_MS, type Candle } from '../types';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';
import { atrPine } from './snrsnd';
import { findPivots } from './snr';

/**
 * SNR breakout H1 — no trend filter, BUY and SELL.
 * SNR = last CONFIRMED H1 swing high (resistance) / swing low (support), pivot `pivot` candles each side.
 * A level counts once: the first closed H1 candle that closes beyond it (no earlier close beyond it since the pivot) is the breakout.
 *  mode 'break':  entry at the next M15 open after that H1 candle closes.
 *  mode 'retest': after the breakout, wait up to retestBars H1 candles for an M15 candle that comes back to the level
 *                 (low ≤ level for BUY) and closes back above it as a bullish candle; a close back through the level cancels.
 * SL 'candle': beyond the breakout H1 candle (break) / the retest M15 candle (retest), plus slBufferAtr × ATR(H1).
 * SL 'level':  the level ∓ slAtr × ATR(H1).
 * Trades with risk > maxSlAtr × ATR(H1) are skipped. TP = RR × risk (engine).
 */
export interface SnrBreakParams {
  pivot: number; mode: 'break' | 'retest'; sl: 'candle' | 'level'; slAtr: number; slBufferAtr: number; maxSlAtr: number; retestBars: number; minBodyAtr: number;
}
export const SNRBREAK_DEFAULTS: SnrBreakParams = { pivot: 3, mode: 'break', sl: 'level', slAtr: 1.5, slBufferAtr: 0.1, maxSlAtr: 3, retestBars: 12, minBodyAtr: 0 };
export const SNRBREAK_KEY = 'snr_break_h1_v1';

export function readSnrBreakParams(p: Readonly<Record<string, unknown>> = {}): SnrBreakParams {
  const o = { ...SNRBREAK_DEFAULTS };
  for (const k of Object.keys(o) as (keyof SnrBreakParams)[]) if (typeof p[k] === typeof o[k]) (o as Record<string, unknown>)[k] = p[k];
  return o;
}

interface Pending { side: 1 | -1; level: number; atr: number; until: number; key: string }
interface St { used?: Record<string, 1>; k?: number; pend?: Pending[] }

export const snrBreakAdapter: StrategyAdapter = {
  key: SNRBREAK_KEY,
  name: 'SNR breakout H1 (tanpa tren H4)',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H1'],
  htfWindow: { H1: 400 },
  evaluate(ctx) {
    const p = readSnrBreakParams(ctx.params);
    const st = ctx.state as St;
    const used = (st.used ??= {});
    const pend = (st.pend ??= []);
    const m = ctx.candles, bar = m[m.length - 1];
    const all = ctx.htf?.H1 ?? [];
    let e = all.length;
    while (e > 0 && all[e - 1].time + TIMEFRAME_MS.H1 > ctx.now) e--;
    const h1: readonly Candle[] = all.slice(Math.max(0, e - 300), e);
    if (h1.length < 40) return [];
    const out: StrategyEventDraft[] = [];
    const ev = (side: 1 | -1, level: number, sl: number, how: string): StrategyEventDraft => ({
      type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close,
      zone: { kind: side > 0 ? 'resistance' : 'support', low: Math.min(level, bar.close), high: Math.max(level, bar.close) },
      confirmations: { trend: 'tanpa filter tren' },
      status: `${side > 0 ? 'BUY' : 'SELL'} ${how} ${side > 0 ? 'resistance' : 'support'} H1 ${level.toFixed(2)}`,
      details: { side: side > 0 ? 'long' : 'short', stop_loss: Number(sl.toFixed(4)), level },
    });

    // 1) a new H1 candle has just closed → look for a breakout
    const i = h1.length - 1, cur = h1[i];
    if (cur.time + TIMEFRAME_MS.H1 === ctx.now && st.k !== cur.time) {
      st.k = cur.time;
      const atr = atrPine(h1, 14)[i];
      if (Number.isFinite(atr)) {
        const piv = findPivots(h1, p.pivot).filter((x) => x.index + p.pivot < i);   // confirmed before this candle
        for (const side of [1, -1] as const) {
          const type = side > 0 ? 'high' : 'low';
          let lv = null as null | (typeof piv)[number];
          for (let k = piv.length - 1; k >= 0; k--) if (piv[k].type === type) { lv = piv[k]; break; }
          if (!lv) continue;
          const key = `${side}:${lv.time}`;
          if (used[key]) continue;
          if (!(side * (cur.close - lv.price) > 0)) continue;
          let early = false;
          for (let k = lv.index + 1; k < i; k++) if (side * (h1[k].close - lv.price) > 0) { early = true; break; }
          used[key] = 1;
          if (early) continue;
          if (side * (cur.close - cur.open) < p.minBodyAtr * atr) continue;
          if (p.mode === 'retest') { pend.push({ side, level: lv.price, atr, until: ctx.now + p.retestBars * TIMEFRAME_MS.H1, key }); continue; }
          const sl = p.sl === 'level' ? lv.price - side * p.slAtr * atr : (side > 0 ? cur.low : cur.high) - side * p.slBufferAtr * atr;
          const risk = side * (bar.close - sl);
          if (risk > 0.01 && risk <= p.maxSlAtr * atr) out.push(ev(side, lv.price, sl, 'tembus'));
        }
      }
    }
    if (out.length) return out.slice(0, 1);

    // 2) retest mode: M15 candle back at the level
    for (let q = pend.length - 1; q >= 0; q--) {
      const d = pend[q];
      if (ctx.now > d.until) { pend.splice(q, 1); continue; }
      if (bar.time < d.until - p.retestBars * TIMEFRAME_MS.H1) continue;
      if (d.side * (bar.close - d.level) < 0) { pend.splice(q, 1); continue; }           // closed back through → cancelled
      const touched = d.side > 0 ? bar.low <= d.level : bar.high >= d.level;
      const turn = d.side * (bar.close - bar.open) > 0;
      if (!touched || !turn) continue;
      pend.splice(q, 1);
      const sl = p.sl === 'level' ? d.level - d.side * p.slAtr * d.atr : (d.side > 0 ? bar.low : bar.high) - d.side * p.slBufferAtr * d.atr;
      const risk = d.side * (bar.close - sl);
      if (risk > 0.01 && risk <= p.maxSlAtr * d.atr) return [ev(d.side, d.level, sl, 'retest')];
    }
    return [];
  },
};
