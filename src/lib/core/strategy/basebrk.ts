import { TIMEFRAME_MS, type Candle, type Timeframe } from '../types';
import type { StrategyAdapter, StrategyContext, StrategyEventDraft } from './adapter';
import { emaLast } from './breakout';
import { breakoutV07Adapter } from './npola';
import { METHODS } from './methods-meta';

/**
 * Breakout Base (B + C), README 5n. Bases on CLOSED H4 and H1 candles, each timeframe separately, entry confirmed by the close of
 * the base candle (M15).
 *  Base   : ≥ minN consecutive candles; every consecutive pair overlaps ≥ overlap × the smaller range (zero range fails);
 *           total height (max high − min low) ≤ mult × ATR14 of that timeframe (ATR at the last base candle).
 *           Active base = longest valid run ending at the latest closed candle; kept until a close breaks out (one breakout per base)
 *           or a newer valid base replaces it. Candles up to the breakout candle can't belong to the next base.
 *  BUY    : close above the top → SL = bottom − slAtr × ATR (the base's timeframe). SELL mirror. TP = RR × risk.
 *  Extras : H4 base — breakout only between 07:00 and 16:59 UTC (candle open time). H1 base — price moved ≥ impAtr × ATR in the
 *           trade direction over the 5 candles before the base (close before the base − close 5 candles earlier).
 *  Trend  : BUY EMA50(H4) > EMA200(H4); SELL EMA50 < EMA200 on H4 and D1.
 */
export interface BaseParams { minN: number; overlap: number; mult: number; slAtr: number; impAtr: number; useH4: boolean; useH1: boolean }
export const BASE_DEFAULTS: BaseParams = { minN: 3, overlap: 0.5, mult: 1.5, slAtr: 0.3, impAtr: 1, useH4: true, useH1: true };
export function readBaseParams(p: Readonly<Record<string, unknown>> = {}): BaseParams {
  const o = { ...BASE_DEFAULTS };
  const num = (k: string) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) : undefined);
  o.minN = Math.max(2, Math.round(num('baseMinN') ?? o.minN));
  o.overlap = num('baseOverlap') ?? o.overlap;
  o.mult = num('baseMult') ?? o.mult;
  o.slAtr = num('baseSlAtr') ?? o.slAtr;
  o.impAtr = num('baseImpAtr') ?? o.impAtr;
  if (typeof p.baseH4 === 'boolean') o.useH4 = p.baseH4;
  if (typeof p.baseH1 === 'boolean') o.useH1 = p.baseH1;
  return o;
}

interface Base { top: number; bot: number; atr: number; imp: number; n: number }
interface Tf { last: number; atr: number; prevClose: number; c: Candle[]; cur: Base | null; floor: number }
export interface BaseState { tf?: Partial<Record<Timeframe, Tf>>; tk?: string; up?: boolean; dn?: boolean }

function pairOk(a: Candle, b: Candle, ov: number): boolean {
  const small = Math.min(a.high - a.low, b.high - b.low);
  if (!(small > 0)) return false;
  return Math.max(0, Math.min(a.high, b.high) - Math.max(a.low, b.low)) >= ov * small;
}

/** Longest valid base ending at the last candle of `c` (all candles must start after `floor`). */
export function findBase(c: readonly Candle[], atr: number, p: Pick<BaseParams, 'minN' | 'overlap' | 'mult'>, floor = -Infinity): (Base & { start: number }) | null {
  const k = c.length - 1;
  if (k < 0 || !Number.isFinite(atr)) return null;
  let s = k, hi = c[k].high, lo = c[k].low, best: (Base & { start: number }) | null = null;
  while (s - 1 >= 0 && c[s - 1].time > floor && pairOk(c[s - 1], c[s], p.overlap) && k - s < 60) {
    const nh = Math.max(hi, c[s - 1].high), nl = Math.min(lo, c[s - 1].low);
    if (nh - nl > p.mult * atr) break;
    s--; hi = nh; lo = nl;
    if (k - s + 1 >= p.minN) best = { top: hi, bot: lo, atr, imp: 0, n: k - s + 1, start: s };
  }
  if (best && !(best.top > best.bot)) return null;
  if (best) best.imp = best.start >= 6 ? (c[best.start - 1].close - c[best.start - 6].close) / atr : 0;
  return best;
}

export function baseEvaluate(ctx: StrategyContext, st: BaseState, p: BaseParams): StrategyEventDraft[] {
  const m = ctx.candles, bar = m[m.length - 1];
  const h4 = ctx.htf?.H4, d1 = ctx.htf?.D1;
  if (!bar || !h4?.length || !d1?.length) return [];
  const tk = `${h4[h4.length - 1].time}|${d1[d1.length - 1].time}`;
  if (st.tk !== tk) {
    st.tk = tk;
    const h4c = h4.map((c) => c.close), d1c = d1.map((c) => c.close);
    const ok = h4c.length >= 200 && d1c.length >= 200;
    const e50 = emaLast(h4c, 50), e200 = emaLast(h4c, 200), d50 = emaLast(d1c, 50), d200 = emaLast(d1c, 200);
    st.up = ok && e50 > e200;
    st.dn = ok && e50 < e200 && d50 < d200;
  }
  const all = (st.tf ??= {});
  const out: StrategyEventDraft[] = [];
  const hour = new Date(bar.time).getUTCHours();
  for (const tf of ['H4', 'H1'] as const) {
    if ((tf === 'H4' && !p.useH4) || (tf === 'H1' && !p.useH1)) continue;
    const arr = ctx.htf?.[tf];
    if (!arr?.length) continue;
    const s = (all[tf] ??= { last: -Infinity, atr: NaN, prevClose: NaN, c: [], cur: null, floor: -Infinity });
    // 1) breakout of the active base by this candle's close
    if (s.cur) {
      const b = s.cur, side: 0 | 1 | -1 = bar.close > b.top ? 1 : bar.close < b.bot ? -1 : 0;
      if (side) {
        s.cur = null;
        s.floor = Math.floor(bar.time / TIMEFRAME_MS[tf]) * TIMEFRAME_MS[tf];   // the candle holding the breakout can't be in a new base
        const extra = tf === 'H4' ? hour >= 7 && hour <= 16 : side * b.imp >= p.impAtr;
        if (extra && (side > 0 ? st.up : st.dn)) {
          const sl = side > 0 ? b.bot - p.slAtr * b.atr : b.top + p.slAtr * b.atr;
          out.push({
            type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close,
            zone: { kind: side > 0 ? 'resistance' : 'support', low: b.bot, high: b.top },
            confirmations: { trend: side > 0 ? 'H4 EMA50 > EMA200' : 'H4 & D1 EMA50 < EMA200' },
            status: `${side > 0 ? 'BUY' : 'SELL'} — breakout base ${tf} (${b.n} candle, ${b.bot.toFixed(2)}–${b.top.toFixed(2)}); SL ${sl.toFixed(2)}`,
            details: { side: side > 0 ? 'long' : 'short', stop_loss: Number(sl.toFixed(4)), slot: `B${tf}`, component: `base_${tf}`, base_top: b.top, base_bottom: b.bot, base_candles: b.n },
          });
        }
      }
    }
    // 2) newly closed candles of this timeframe → ATR, then the base ending at the latest one
    const last = arr[arr.length - 1];
    if (last.time <= s.last || last.time + TIMEFRAME_MS[tf] > ctx.now) continue;
    for (const c of arr) {
      if (c.time <= s.last) continue;
      s.last = c.time;
      if (!Number.isNaN(s.prevClose)) {
        const tr = Math.max(c.high - c.low, Math.abs(c.high - s.prevClose), Math.abs(c.low - s.prevClose));
        s.atr = Number.isNaN(s.atr) ? tr : s.atr + (tr - s.atr) / 14;
      }
      s.prevClose = c.close;
      s.c.push(c);
    }
    if (s.c.length > 120) s.c.splice(0, s.c.length - 120);
    const nb = findBase(s.c, s.atr, p, s.floor);
    if (nb) s.cur = nb;
  }
  return out;
}

/** Breakout v0.8 = v0.7 unchanged + Breakout Base H4 and H1 (each its own slot). */
export const BREAKOUT_V08_KEY = 'breakout_v08';
export const breakoutV08Adapter: StrategyAdapter = {
  ...breakoutV07Adapter,
  key: BREAKOUT_V08_KEY,
  name: 'Breakout v0.8 (v0.7 + Base H4/H1)',
  htfWindow: { H1: 400, H4: 1000, D1: 1000 },
  evaluate(ctx) {
    const s = ctx.state as { v7?: Record<string, unknown>; b?: BaseState };
    const a = breakoutV07Adapter.evaluate({ ...ctx, state: (s.v7 ??= {}) });
    const evs = [...a, ...baseEvaluate(ctx, (s.b ??= {}), readBaseParams(ctx.params))];
    // oneSlot: every part shares one slot → at most one open position for the whole strategy
    if (ctx.params.oneSlot === true) return evs.map((e) => ({ ...e, details: { ...e.details, slot: 'one' } }));
    // noLimit: every signal gets its own slot → no cap on open positions
    if (ctx.params.noLimit === true) return evs.map((e) => ({ ...e, details: { ...e.details, slot: `${String(e.details?.slot ?? 'x')}@${e.candleTime}` } }));
    return evs;
  },
};

/** One adapter per single method (see methods-meta.ts): v0.8 with only that part switched on, no cap on open positions (owner's choice, 1 Nov 2026). */
export const methodAdapters: StrategyAdapter[] = METHODS.filter((m) => !m.custom).map((m) => ({
  ...breakoutV08Adapter,
  key: m.adapterKey,
  name: m.label,
  evaluate: (ctx) => {
    const p: Record<string, unknown> = { ...m.params, ...ctx.params, noLimit: true };
    const evs = breakoutV08Adapter.evaluate({ ...ctx, params: p });
    if (p.skipSecond !== true || !evs.length) return evs;
    // v1 level-v3 (2 Nov 2026): the 2nd signal of the same direction on the same UTC day is skipped (3rd+ allowed)
    const st = ctx.state as { dd?: { day: number; n: Record<string, number> } };
    return evs.filter((e) => {
      const day = Math.floor(e.candleTime / 86_400_000);
      if (st.dd?.day !== day) st.dd = { day, n: {} };
      const side = String(e.details?.side);
      const nth = (st.dd.n[side] = (st.dd.n[side] ?? 0) + 1);
      return nth !== 2;
    });
  },
}));
