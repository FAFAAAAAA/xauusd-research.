import { TIMEFRAME_MS, type Candle, type ConfirmationStatus, type EventType, type Mode, type SnrZone, type Timeframe } from '../types';

/**
 * Context handed to a strategy on every closed candle.
 * The engine guarantees (and `runStrategyGuarded` enforces):
 *  - `candles` contains ONLY candles whose close time <= `now` (no forming / future candles)
 *  - `zones` contains ONLY zones with validFrom <= now (and not expired)
 *  - `news` contains ONLY information whose availability time <= now
 * Strategies must be pure functions of this context so LIVE (Pine Script) and
 * BACKTEST (this engine) produce the same events for the same inputs.
 */
export interface StrategyContext {
  mode: Mode;
  symbol: string;
  timeframe: Timeframe;
  candles: readonly Candle[];
  /** epoch ms — market time = close time of the latest candle */
  now: number;
  zones: readonly SnrZone[];
  news: NewsSnapshot;
  /** Higher-timeframe candles (only when the adapter lists them in requiredTimeframes). The guard keeps CLOSED candles only. */
  htf?: Partial<Record<Timeframe, readonly Candle[]>>;
  params: Readonly<Record<string, unknown>>;
  /** State carried between calls within one replay run (e.g. last zone state for edge-triggering). */
  state: Record<string, unknown>;
}

export interface NewsSnapshot {
  /** false when no news/calendar archive exists for this period → DATA UNAVAILABLE */
  archiveAvailable: boolean;
  items: Array<{
    kind: 'economic' | 'article';
    id: string;
    title: string;
    category: string;
    impact?: string;
    /** epoch ms the information became available (never > now) */
    availableAt: number;
    sentiment?: { label: string; confidence: number | null; reasoning: string } | null;
  }>;
  upcoming: Array<{ id: string; title: string; category: string; impact: string; scheduledAt: number }>;
}

export interface StrategyEventDraft {
  type: EventType;
  /** open time of the candle on which the event became true (must be <= last candle) */
  candleTime: number;
  price: number;
  zone?: { id?: string; kind: SnrZone['kind']; low: number; high: number } | null;
  confirmations?: Partial<ConfirmationStatus>;
  status?: string;
  details?: Record<string, unknown>;
}

export interface StrategyAdapter {
  key: string;
  name: string;
  /** false → UI shows "Strategy Not Configured" and no events are produced */
  configured: boolean;
  testOnly: boolean;
  /** Minimum history the strategy needs before it can evaluate. */
  warmupCandles: number;
  /** Extra timeframes the strategy reads (must exist in the same data source). */
  requiredTimeframes?: Timeframe[];
  /** How many closed candles per higher timeframe the strategy needs (default 400). */
  htfWindow?: Partial<Record<Timeframe, number>>;
  evaluate(ctx: StrategyContext): StrategyEventDraft[];
}

export interface GuardResult {
  events: StrategyEventDraft[];
  violations: string[];
}

/** Runs a strategy on a defensively copied, frozen context and drops any look-ahead output. */
export function runStrategyGuarded(adapter: StrategyAdapter, ctx: StrategyContext): GuardResult {
  const violations: string[] = [];
  const last = ctx.candles[ctx.candles.length - 1];
  if (!last) return { events: [], violations };
  const frozen: StrategyContext = {
    ...ctx,
    candles: Object.freeze(ctx.candles.slice()),
    zones: Object.freeze(ctx.zones.filter((z) => z.validFrom <= ctx.now && (z.validUntil == null || z.validUntil > ctx.now))),
    news: {
      ...ctx.news,
      items: ctx.news.items.filter((n) => n.availableAt <= ctx.now),
    },
    htf: ctx.htf
      ? (Object.fromEntries(
          Object.entries(ctx.htf).map(([tf, arr]) => [
            tf, Object.freeze((arr ?? []).filter((c) => c.time + TIMEFRAME_MS[tf as Timeframe] <= ctx.now)),
          ]),
        ) as StrategyContext['htf'])
      : undefined,
  };
  let raw: StrategyEventDraft[] = [];
  try {
    raw = adapter.evaluate(frozen) ?? [];
  } catch (e) {
    violations.push(`Strategy error: ${(e as Error).message}`);
    return { events: [], violations };
  }
  const events = raw.filter((ev) => {
    if (ev.candleTime > last.time) {
      violations.push(`Look-ahead: event ${ev.type} pada ${new Date(ev.candleTime).toISOString()} melewati candle terakhir`);
      return false;
    }
    return true;
  });
  return { events, violations };
}
