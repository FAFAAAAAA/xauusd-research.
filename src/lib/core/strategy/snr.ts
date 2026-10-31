import type { Candle, SnrZone } from '../types';
import type { StrategyAdapter, StrategyEventDraft } from './adapter';

/**
 * SNR H4/H1 → M15, version h4h1m15-v0.1  (DRAFT — to be validated by backtest, not a proven edge)
 *
 *  TREND (H4)   swing structure from confirmed pivots: last two pivot highs AND last two pivot lows
 *               higher → bullish (only BUY); lower → bearish (only SELL); otherwise neutral (no signals).
 *  ZONES        every confirmed pivot (H4: n=2, H1: n=3) inside its lookback becomes a zone
 *               pivotPrice ± 0.25×ATR14(of that timeframe at the pivot bar); overlapping zones are merged.
 *               A pivot is only used after its n right-hand candles have CLOSED (no repaint / no future pivot).
 *  ALIGNMENT    bullish → zones at/below the previous M15 close (support); bearish → at/above it (resistance).
 *  EVENTS       SNR_NEAR        first time an aligned zone is within 1.0×ATR14(M15)
 *               SETUP_CONFIRMED first time an aligned zone is touched (M15 range overlaps zone) = the entry rule.
 *               Re-armed only after price moves away again (> near distance) or the trend turns neutral.
 *  ENTRY        open of the NEXT M15 candle (the engine fills it; this adapter only signals).
 *  STOP LOSS    BUY: zone.low − 0.5×ATR14(M15);  SELL: zone.high + 0.5×ATR14(M15).
 *  TAKE PROFIT  not decided here: the backtest runner tests RR 1:1, 1:2 and 1:3.
 *
 * Pure function of the context (candles / htf are closed-only) so LIVE (Pine) and BACKTEST can match.
 */
export interface SnrParams {
  h4Pivot: number; h1Pivot: number; atrLen: number; zoneHalfWidthAtr: number;
  h4Lookback: number; h1Lookback: number; nearAtr: number; slBufferAtr: number; rrList: number[];
}
export const SNR_DEFAULTS: SnrParams = {
  h4Pivot: 2, h1Pivot: 3, atrLen: 14, zoneHalfWidthAtr: 0.25, h4Lookback: 120, h1Lookback: 240,
  nearAtr: 1.0, slBufferAtr: 0.5, rrList: [1, 2, 3],
};
export const SNR_KEY = 'snr_h4h1_m15';
export const SNR_VERSION_LABEL = 'snr h4h1m15-v0.1';

export function readParams(p: Readonly<Record<string, unknown>> = {}): SnrParams {
  const o: SnrParams = { ...SNR_DEFAULTS, rrList: [...SNR_DEFAULTS.rrList] };
  for (const k of Object.keys(SNR_DEFAULTS) as (keyof SnrParams)[]) {
    const v = p[k];
    if (k === 'rrList') { if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'number' && x > 0)) o.rrList = v as number[]; }
    else if (typeof v === 'number' && Number.isFinite(v) && v > 0) (o[k] as number) = v;
  }
  return o;
}

/** Wilder ATR; NaN until `len` candles exist. */
export function atrSeries(c: readonly Candle[], len: number): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  if (c.length < len) return out;
  const tr = (i: number) => (i === 0 ? c[0].high - c[0].low
    : Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
  let sum = 0;
  for (let i = 0; i < len; i++) sum += tr(i);
  let atr = sum / len;
  out[len - 1] = atr;
  for (let i = len; i < c.length; i++) { atr = (atr * (len - 1) + tr(i)) / len; out[i] = atr; }
  return out;
}
export function atrLast(c: readonly Candle[], len: number): number {
  const tail = c.slice(-Math.max(len * 6, len + 2));
  const a = atrSeries(tail, len);
  return a[a.length - 1];
}

export interface Pivot { index: number; time: number; price: number; type: 'high' | 'low' }

/** Confirmed pivots only: index ≤ length-1-n, i.e. all n right-hand candles are closed. Strict on the left, non-strict on the right (no duplicate plateaus). */
export function findPivots(c: readonly Candle[], n: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = n; i <= c.length - 1 - n; i++) {
    let ph = true, pl = true;
    for (let k = 1; k <= n && (ph || pl); k++) {
      if (!(c[i].high > c[i - k].high && c[i].high >= c[i + k].high)) ph = false;
      if (!(c[i].low < c[i - k].low && c[i].low <= c[i + k].low)) pl = false;
    }
    if (ph) out.push({ index: i, time: c[i].time, price: c[i].high, type: 'high' });
    if (pl) out.push({ index: i, time: c[i].time, price: c[i].low, type: 'low' });
  }
  return out;
}

export type Trend = 'bullish' | 'bearish' | 'neutral';
export function trendFromPivots(p: readonly Pivot[]): { trend: Trend; detail: string } {
  const hs = p.filter((x) => x.type === 'high').slice(-2);
  const ls = p.filter((x) => x.type === 'low').slice(-2);
  if (hs.length < 2 || ls.length < 2) return { trend: 'neutral', detail: 'pivot H4 belum cukup' };
  const hh = hs[1].price > hs[0].price, lh = hs[1].price < hs[0].price;
  const hl = ls[1].price > ls[0].price, ll = ls[1].price < ls[0].price;
  if (hh && hl) return { trend: 'bullish', detail: 'HH + HL' };
  if (lh && ll) return { trend: 'bearish', detail: 'LH + LL' };
  return { trend: 'neutral', detail: 'struktur campuran' };
}

export interface SnrZoneView { low: number; high: number; mid: number; tfs: string[]; pivots: number; key: string }

function rawZones(c: readonly Candle[], n: number, lookback: number, atrLen: number, halfW: number, tf: string) {
  const atr = atrSeries(c, atrLen);
  return findPivots(c, n)
    .filter((p) => p.index >= c.length - lookback && Number.isFinite(atr[p.index]))
    .map((p) => ({ low: p.price - halfW * atr[p.index], high: p.price + halfW * atr[p.index], tf }));
}

export interface SnrView { trend: Trend; trendDetail: string; zones: SnrZoneView[]; h4Last: number; h1Last: number }

/** Deterministic SNR picture from CLOSED H4/H1 candles. Both windows are sliced to a fixed length so replay and backtest agree. */
export function computeSnrView(h4All: readonly Candle[], h1All: readonly Candle[], prm: SnrParams): SnrView {
  const h4 = h4All.slice(-(prm.h4Lookback + prm.atrLen * 3));
  const h1 = h1All.slice(-(prm.h1Lookback + prm.atrLen * 3));
  const t = trendFromPivots(findPivots(h4, prm.h4Pivot).filter((p) => p.index >= h4.length - prm.h4Lookback));
  const raw = [
    ...rawZones(h4, prm.h4Pivot, prm.h4Lookback, prm.atrLen, prm.zoneHalfWidthAtr, 'H4'),
    ...rawZones(h1, prm.h1Pivot, prm.h1Lookback, prm.atrLen, prm.zoneHalfWidthAtr, 'H1'),
  ].sort((a, b) => a.low - b.low);
  const zones: SnrZoneView[] = [];
  let cur: { low: number; high: number; tfs: Set<string>; n: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const mid = (cur.low + cur.high) / 2;
    zones.push({ low: cur.low, high: cur.high, mid, tfs: [...cur.tfs].sort(), pivots: cur.n, key: mid.toFixed(1) });
  };
  for (const z of raw) {
    if (cur && z.low <= cur.high) { cur.high = Math.max(cur.high, z.high); cur.tfs.add(z.tf); cur.n++; }
    else { flush(); cur = { low: z.low, high: z.high, tfs: new Set([z.tf]), n: 1 }; }
  }
  flush();
  return {
    trend: t.trend, trendDetail: t.detail, zones,
    h4Last: h4.length ? h4[h4.length - 1].time : 0, h1Last: h1.length ? h1[h1.length - 1].time : 0,
  };
}

const TREND_TEXT: Record<Trend, string> = { bullish: 'Bullish H4', bearish: 'Bearish H4', neutral: 'Netral H4' };

export const snrAdapter: StrategyAdapter = {
  key: SNR_KEY,
  name: 'SNR H4/H1 → M15 (v0.1, draf)',
  configured: true,
  testOnly: false,
  warmupCandles: 20,
  requiredTimeframes: ['H1', 'H4'],
  evaluate(ctx) {
    const prm = readParams(ctx.params);
    const h4 = ctx.htf?.H4, h1 = ctx.htf?.H1;
    const m = ctx.candles;
    if (!h4?.length || !h1?.length || m.length < 3) return [];
    const c = m[m.length - 1], prev = m[m.length - 2];

    const cacheKey = `${h4[h4.length - 1].time}|${h1[h1.length - 1].time}`;
    const st = ctx.state as { snr?: { k: string; view: SnrView }; zoneState?: Array<{ low: number; high: number; s: string }> };
    if (!st.snr || st.snr.k !== cacheKey) st.snr = { k: cacheKey, view: computeSnrView(h4, h1, prm) };
    const view = st.snr.view;

    const atr15 = atrLast(m, prm.atrLen);
    if (!Number.isFinite(atr15)) return [];
    // State is matched by price OVERLAP, not by key: when new pivots re-shape a merged zone, the area keeps its state
    // (otherwise a re-shaped zone the price is sitting in would fire again).
    const prevState = Array.isArray(st.zoneState) ? st.zoneState : [];
    const RANK: Record<string, number> = { near: 1, touch: 2 };
    const stateOf = (z: SnrZoneView) => prevState
      .filter((p) => p.low <= z.high && p.high >= z.low)
      .reduce<string | undefined>((acc, p) => ((RANK[p.s] ?? 0) > (RANK[acc ?? ''] ?? 0) ? p.s : acc), undefined);
    const next: Array<{ low: number; high: number; s: string }> = [];
    const out: StrategyEventDraft[] = [];

    if (view.trend !== 'neutral') {
      const bull = view.trend === 'bullish';
      const nearDist = prm.nearAtr * atr15;
      for (const z of view.zones) {
        const aligned = bull ? z.mid <= prev.close : z.mid >= prev.close;
        const was = stateOf(z);
        if (!aligned && !was) continue;
        const touching = c.low <= z.high && c.high >= z.low;
        const dist = c.close > z.high ? c.close - z.high : c.close < z.low ? z.low - c.close : 0;
        const now = touching ? 'touch' : dist <= nearDist ? 'near' : 'away';
        // after a touch the zone stays "used" until price moves away again
        const stored = was === 'touch' && now !== 'away' ? 'touch' : now;
        if (stored !== 'away') next.push({ low: z.low, high: z.high, s: stored });
        if (!aligned) continue;

        const zone: SnrZone = { kind: bull ? 'support' : 'resistance', low: z.low, high: z.high, validFrom: 0, origin: 'strategy' };
        const base = {
          candleTime: c.time, price: c.close, zone: { kind: zone.kind, low: z.low, high: z.high },
          confirmations: { trend: `${TREND_TEXT[view.trend]} (${view.trendDetail})` },
        };
        const where = `${z.tfs.join('/')}`;
        if (now === 'touch' && was !== 'touch') {
          const sl = bull ? z.low - prm.slBufferAtr * atr15 : z.high + prm.slBufferAtr * atr15;
          out.push({
            ...base, type: 'SETUP_CONFIRMED',
            status: `${bull ? 'BUY' : 'SELL'} setup — sentuh ${bull ? 'support' : 'resistance'} ${where}; entry di open M15 berikutnya`,
            details: { side: bull ? 'long' : 'short', stop_loss: Number(sl.toFixed(4)), atr_m15: Number(atr15.toFixed(4)), zone_tfs: z.tfs, zone_pivots: z.pivots, rr_tested: prm.rrList },
          });
        } else if (now === 'near' && was === undefined) {
          out.push({
            ...base, type: 'SNR_NEAR',
            status: `Mendekati ${bull ? 'support' : 'resistance'} ${where}; menunggu sentuhan zona`,
            details: { side: bull ? 'long' : 'short', distance: Number(dist.toFixed(4)), atr_m15: Number(atr15.toFixed(4)), zone_tfs: z.tfs },
          });
        }
      }
    }
    st.zoneState = view.trend === 'neutral' ? [] : next;
    return out;
  },
};
