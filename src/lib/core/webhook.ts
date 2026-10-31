import { normalizeTimeframe, parseTimestamp } from './time';
import { EVENT_TYPES, isEventType, type EventType, type Timeframe, type ZoneKind } from './types';

/**
 * TradingView alert payload contract (JSON in the alert "Message" box).
 * TradingView cannot send custom HTTP headers, so the shared secret travels in the body
 * and is redacted before logging.
 */
export interface WebhookEvent {
  event_id: string;
  symbol: string;
  timeframe: Timeframe;
  event_type: EventType;
  timestamp: number; // epoch ms (market time of the bar close that triggered the alert)
  price: number;
  zone: { low: number; high: number; kind: ZoneKind };
  strategy_version: string;
  source: string;
  mode: 'LIVE';
  confirmations?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export type ValidationResult =
  | { ok: true; value: WebhookEvent }
  | { ok: false; errors: string[] };

const ALLOWED_SYMBOLS = /^(?:[A-Z0-9_]+:)?XAUUSD$/;
export const MAX_EVENT_AGE_MS = 15 * 60_000; // live alerts older than this are rejected
export const MAX_FUTURE_SKEW_MS = 2 * 60_000;

export function validateWebhookPayload(body: unknown, now: number): ValidationResult {
  const errors: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: ['Body harus objek JSON'] };
  const b = body as Record<string, unknown>;

  const str = (k: string, max = 128) => {
    const v = b[k];
    if (typeof v !== 'string' || !v.trim()) { errors.push(`${k} wajib (string)`); return ''; }
    if (v.length > max) { errors.push(`${k} terlalu panjang`); return ''; }
    return v.trim();
  };
  const event_id = str('event_id');
  if (event_id && !/^[A-Za-z0-9_.:\-]+$/.test(event_id)) errors.push('event_id hanya boleh huruf, angka, _ . : -');
  const symbolRaw = str('symbol', 40).toUpperCase();
  if (symbolRaw && !ALLOWED_SYMBOLS.test(symbolRaw)) errors.push('symbol harus XAUUSD (boleh berprefiks broker, mis. OANDA:XAUUSD)');
  const tf = normalizeTimeframe(b.timeframe);
  if (!tf) errors.push('timeframe tidak valid (M1,M5,M15,M30,H1,H4,D1 atau nilai TradingView 1,5,15,30,60,240,D)');
  const et = b.event_type;
  if (!isEventType(et)) errors.push(`event_type harus salah satu: ${EVENT_TYPES.join(', ')}`);
  const ts = parseTimestamp(b.timestamp);
  if (ts === null) errors.push('timestamp wajib: ISO-8601 dengan zona waktu atau unix (detik/ms)');
  else {
    if (ts > now + MAX_FUTURE_SKEW_MS) errors.push('timestamp berada di masa depan');
    if (ts < now - MAX_EVENT_AGE_MS) errors.push('timestamp terlalu lama untuk mode LIVE (webhook tidak dipakai untuk data historis)');
  }
  const price = typeof b.price === 'string' ? Number(b.price) : b.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) errors.push('price harus angka > 0');

  let zone: WebhookEvent['zone'] | null = null;
  const z = b.zone as Record<string, unknown> | undefined;
  if (!z || typeof z !== 'object') errors.push('zone wajib {low, high, kind}');
  else {
    const low = Number(z.low), high = Number(z.high);
    const kind = (z.kind ?? 'unknown') as string;
    if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0) errors.push('zone.low/zone.high harus angka > 0');
    else if (low > high) errors.push('zone.low harus <= zone.high');
    if (!['support', 'resistance', 'unknown'].includes(kind)) errors.push('zone.kind harus support|resistance|unknown');
    zone = { low, high, kind: kind as ZoneKind };
  }
  const strategy_version = str('strategy_version', 64);
  const source = str('source', 64);
  if (b.mode !== 'LIVE') errors.push('mode harus "LIVE"');

  let confirmations: Record<string, string> | undefined;
  if (b.confirmations !== undefined) {
    if (typeof b.confirmations !== 'object' || b.confirmations === null) errors.push('confirmations harus objek');
    else {
      confirmations = {};
      for (const [k, v] of Object.entries(b.confirmations as Record<string, unknown>)) {
        if (['trend', 'momentum', 'news', 'sentiment'].includes(k) && typeof v === 'string') confirmations[k] = v.slice(0, 80);
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      event_id, symbol: symbolRaw, timeframe: tf!, event_type: et as EventType, timestamp: ts!,
      price: price as number, zone: zone!, strategy_version, source, mode: 'LIVE', confirmations,
      extra: typeof b.extra === 'object' && b.extra ? (b.extra as Record<string, unknown>) : undefined,
    },
  };
}

export function redactSecret(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const copy = { ...(body as Record<string, unknown>) };
  if ('secret' in copy) copy.secret = '[REDACTED]';
  return copy;
}

/** Constant-time string comparison (prevents timing attacks on the shared secret). */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Simple sliding-window limiter (per instance). The DB-backed check in the service covers multi-instance deployments. */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}
  allow(key: string, now: number): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (arr.length >= this.limit) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}
