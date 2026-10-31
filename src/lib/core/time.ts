import { TIMEFRAMES, type Timeframe } from './types';

export const DISPLAY_TIMEZONES = {
  UTC: 'UTC',
  NEW_YORK: 'America/New_York',
  SEOUL: 'Asia/Seoul',
} as const;
export type DisplayTz = (typeof DISPLAY_TIMEZONES)[keyof typeof DISPLAY_TIMEZONES];

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, timeZone: string) {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(timeZone, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `timeZone` from UTC at instant `ms`, in minutes (DST-aware via Intl). */
export function tzOffsetMinutes(ms: number, timeZone: string): number {
  if (timeZone === 'UTC') return 0;
  const p = parts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC epoch.
 * Used when a broker CSV is written in server/local time.
 * For the ambiguous hour at DST fall-back the earlier instant is returned.
 */
export function zonedWallTimeToUtc(
  y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string,
): number {
  const fixed = /^(?:UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(timeZone);
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  if (timeZone === 'UTC') return naive;
  if (fixed) {
    const sign = fixed[1] === '-' ? -1 : 1;
    const off = sign * (Number(fixed[2]) * 60 + Number(fixed[3] ?? 0));
    return naive - off * 60_000;
  }
  // Candidate offsets: the zone's offset a day before and a day after.
  const offs = [...new Set([
    tzOffsetMinutes(naive - 86_400_000, timeZone),
    tzOffsetMinutes(naive + 86_400_000, timeZone),
  ])];
  const valid = offs
    .map((o) => naive - o * 60_000)
    .filter((c) => naive - tzOffsetMinutes(c, timeZone) * 60_000 === c)
    .sort((a, b) => a - b);
  if (valid.length) return valid[0]; // earliest on fall-back overlap
  // Spring-forward gap (non-existent wall time): interpret with the pre-transition offset.
  return naive - offs[0] * 60_000;
}

export function formatInTz(ms: number, timeZone: string, withSeconds = false): string {
  const p = parts(ms, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
  return withSeconds ? `${base}:${pad(p.second)}` : base;
}

export function tzLabel(timeZone: string, ms: number): string {
  if (timeZone === 'UTC') return 'UTC';
  const off = tzOffsetMinutes(ms, timeZone);
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  const name = timeZone === 'America/New_York' ? 'New York' : timeZone === 'Asia/Seoul' ? 'Seoul' : timeZone;
  return `${name} (UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')})`;
}

/**
 * Trading-session classification (convention, documented in README):
 *  - new_york: 08:00–17:00 America/New_York
 *  - london:   08:00–17:00 Europe/London
 *  - asia:     09:00–18:00 Asia/Tokyo
 * Overlaps resolve with priority new_york > london > asia. DST handled by Intl.
 */
export type SessionLabel = 'asia' | 'london' | 'new_york' | 'off';
export function sessionOf(ms: number): SessionLabel {
  const inWindow = (tz: string, from: number, to: number) => {
    const h = parts(ms, tz).hour;
    return h >= from && h < to;
  };
  if (inWindow('America/New_York', 8, 17)) return 'new_york';
  if (inWindow('Europe/London', 8, 17)) return 'london';
  if (inWindow('Asia/Tokyo', 9, 18)) return 'asia';
  return 'off';
}

/** Normalize TradingView `{{interval}}` values ("1","60","240","D","1D") and our labels. */
export function normalizeTimeframe(raw: unknown): Timeframe | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim().toUpperCase();
  if ((TIMEFRAMES as readonly string[]).includes(s)) return s as Timeframe;
  const map: Record<string, Timeframe> = {
    '1': 'M1', '5': 'M5', '15': 'M15', '30': 'M30', '60': 'H1', '240': 'H4',
    D: 'D1', '1D': 'D1', '1H': 'H1', '4H': 'H4', '1M': 'M1', '5M': 'M5', '15M': 'M15', '30M': 'M30',
  };
  return map[s] ?? null;
}

/** Parse ISO-8601 (with zone) or unix seconds / milliseconds into epoch ms. */
export function parseTimestamp(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e11 ? Math.round(raw * 1000) : Math.round(raw);
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^\d{9,13}(\.\d+)?$/.test(s)) return parseTimestamp(Number(s));
  // Require an explicit zone for ISO strings: ambiguity is a data-quality bug.
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
