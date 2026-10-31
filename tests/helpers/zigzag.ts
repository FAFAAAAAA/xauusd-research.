// SYNTHETIC test candles (year 2030). Not market history.
import type { Candle } from '../../src/lib/core/types';

const M15 = 15 * 60_000;
const T0 = Date.UTC(2030, 0, 7, 0, 0);

/** Zigzag with a drift: `dir` = +1 uptrend (higher highs/lows), -1 downtrend. Period 48h, swing ±15. */
export function zigzag(n: number, dir: 1 | -1, start = 1500): Candle[] {
  const out: Candle[] = [];
  const tri = (x: number) => { const f = x - Math.floor(x); return f < 0.5 ? 4 * f - 1 : 3 - 4 * f; };
  let prev = start;
  for (let k = 0; k < n; k++) {
    const px = start + dir * 0.02 * k + 15 * tri(k / 192 + 0.25);
    const o = prev, c = +px.toFixed(2);
    out.push({ time: T0 + k * M15, open: o, high: Math.max(o, c) + 0.3, low: Math.min(o, c) - 0.3, close: c, volume: 1 });
    prev = c;
  }
  return out;
}

