// Framework-free domain types. No imports from Next.js, React or DB drivers,
// so everything in src/lib/core can be unit-tested in isolation.

export const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  M30: 1_800_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D1: 86_400_000,
};

export const EVENT_TYPES = [
  'SNR_NEAR',
  'SNR_TOUCH',
  'SNR_BREAKOUT',
  'SNR_RETEST',
  'SETUP_CONFIRMED',
  'SETUP_INVALIDATED',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type Mode = 'LIVE' | 'BACKTEST';
export type ZoneKind = 'support' | 'resistance' | 'unknown';

/** All times are epoch milliseconds, UTC. `time` is the candle OPEN time. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface SnrZone {
  id?: string;
  kind: ZoneKind;
  low: number;
  high: number;
  timeframe?: Timeframe | null;
  /** epoch ms: when this zone became known. Zones with validFrom > now are invisible. */
  validFrom: number;
  validUntil?: number | null;
  origin: 'manual' | 'tradingview' | 'strategy' | 'test';
}

export type SentimentLabel = 'Bullish' | 'Bearish' | 'Neutral' | 'Mixed' | 'Unknown';

export interface ConfirmationStatus {
  /** 'not_configured' means the owner hasn't defined the rule yet. */
  trend: string;
  momentum: string;
  news: string;
  sentiment: string;
}

export const NOT_CONFIGURED = 'Not configured';
export const DATA_UNAVAILABLE = 'DATA UNAVAILABLE';

export function isTimeframe(v: unknown): v is Timeframe {
  return typeof v === 'string' && (TIMEFRAMES as readonly string[]).includes(v);
}
export function isEventType(v: unknown): v is EventType {
  return typeof v === 'string' && (EVENT_TYPES as readonly string[]).includes(v);
}
