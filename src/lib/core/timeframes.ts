import { tzOffsetMinutes } from './time';
import { TIMEFRAME_MS, TIMEFRAMES, type Candle, type Timeframe } from './types';

/**
 * Bucket alignment for aggregated candles.
 *  - 'utc':      buckets aligned to 00:00 UTC (common for many data vendors)
 *  - 'ny_close': buckets aligned to 17:00 America/New_York (FX/metal daily close convention, DST aware)
 * The chosen alignment is stored with the derived data source so results stay reproducible.
 */
export type Alignment = 'utc' | 'ny_close';

export function bucketStart(t: number, tf: Timeframe, alignment: Alignment): number {
  const size = TIMEFRAME_MS[tf];
  if (alignment === 'utc' || size < TIMEFRAME_MS.H1) return Math.floor(t / size) * size;
  const offMs = tzOffsetMinutes(t, 'America/New_York') * 60_000;
  const anchor = 17 * 3_600_000; // 17:00 NY wall clock
  const wall = t + offMs;
  const startWall = Math.floor((wall - anchor) / size) * size + anchor;
  return startWall - offMs;
}

/**
 * Aggregate ascending lower-timeframe candles into `target`.
 * The trailing bucket is dropped unless the input provably covers it to the end,
 * so a half-built candle is never stored as if it were complete.
 */
export function aggregateCandles(
  input: readonly Candle[], source: Timeframe, target: Timeframe, alignment: Alignment = 'utc', keepTail = false,
): Candle[] {
  if (TIMEFRAME_MS[target] <= TIMEFRAME_MS[source]) throw new Error('Target timeframe harus lebih besar dari sumber');
  if (TIMEFRAME_MS[target] % TIMEFRAME_MS[source] !== 0) throw new Error('Timeframe tidak kelipatan');
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curEndCovered = 0;
  for (const c of input) {
    const b = bucketStart(c.time, target, alignment);
    if (!cur || cur.time !== b) {
      if (cur) out.push(cur);
      cur = { time: b, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? null };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      if (c.volume != null) cur.volume = (cur.volume ?? 0) + c.volume;
    }
    curEndCovered = c.time + TIMEFRAME_MS[source];
  }
  if (cur && (keepTail || curEndCovered >= cur.time + TIMEFRAME_MS[target])) out.push(cur);
  return out;
}

export function higherTimeframes(tf: Timeframe): Timeframe[] {
  return TIMEFRAMES.filter((t) => TIMEFRAME_MS[t] > TIMEFRAME_MS[tf] && TIMEFRAME_MS[t] % TIMEFRAME_MS[tf] === 0);
}
