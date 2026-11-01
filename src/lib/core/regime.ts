import type { Candle } from './types';

export type Regime = 'up' | 'down' | 'sideways';
/**
 * Market condition from closed D1 candles (Wilder ADX14 with +DI/−DI):
 *   ADX < 20 → sideways; otherwise +DI > −DI → uptrend, else downtrend.
 * Returns, for every D1 candle i, the condition known at its close.
 */
export function regimeSeries(d1: readonly Candle[], n = 14, flat = 20): (Regime | null)[] {
  const out: (Regime | null)[] = new Array(d1.length).fill(null);
  let tr = NaN, pdm = NaN, ndm = NaN, adx = NaN, cnt = 0;
  for (let i = 1; i < d1.length; i++) {
    const c = d1[i], p = d1[i - 1];
    const up = c.high - p.high, dn = p.low - c.low;
    const t = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    const pd = up > dn && up > 0 ? up : 0, nd = dn > up && dn > 0 ? dn : 0;
    if (Number.isNaN(tr)) { tr = t; pdm = pd; ndm = nd; } else { tr += (t - tr) / n; pdm += (pd - pdm) / n; ndm += (nd - ndm) / n; }
    const pdi = tr > 0 ? (100 * pdm) / tr : 0, ndi = tr > 0 ? (100 * ndm) / tr : 0;
    const dx = pdi + ndi > 0 ? (100 * Math.abs(pdi - ndi)) / (pdi + ndi) : 0;
    adx = Number.isNaN(adx) ? dx : adx + (dx - adx) / n;
    if (++cnt < 2 * n) continue;                       // warm-up
    out[i] = adx < flat ? 'sideways' : pdi > ndi ? 'up' : 'down';
  }
  return out;
}

/** Condition at time `t` = that of the last D1 candle closed at or before t. */
export function regimeAt(d1: readonly Candle[], series: readonly (Regime | null)[], t: number): Regime | null {
  let lo = 0, hi = d1.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (d1[m].time + 86_400_000 <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  return k >= 0 ? series[k] : null;
}
