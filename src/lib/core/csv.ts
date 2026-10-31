import { parseTimestamp, zonedWallTimeToUtc } from './time';
import type { Candle } from './types';

export interface ParseIssue { line: number; message: string }

/** Minimal RFC-4180-ish line splitter (supports quotes). */
export function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function detectDelimiter(sample: string): string {
  const first = sample.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

function normHeader(h: string) {
  return h.toLowerCase().replace(/[<>"']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Parse "2019-07-15", "2019.07.15", "2019/07/15", "15.07.2019" + optional "HH:MM[:SS[.mmm]]". */
export function parseWallDateTime(dateStr: string, timeStr: string | undefined, timeZone: string): number | null {
  const ds = dateStr.trim();
  let y: number, mo: number, d: number;
  let rest = timeStr?.trim() ?? '';
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](.*))?$/.exec(ds);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; if (m[4]) rest = m[4]; }
  else {
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](.*))?$/.exec(ds);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3]; if (m[4]) rest = m[4];
  }
  let h = 0, mi = 0, s = 0;
  if (rest) {
    const t = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(rest);
    if (!t) return null;
    h = +t[1]; mi = +t[2]; s = +(t[3] ?? 0);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return zonedWallTimeToUtc(y, mo, d, h, mi, s, timeZone);
}

export interface OhlcParseOptions {
  /** IANA zone or fixed offset ("UTC+2") the file's wall-clock times are written in. Ignored for unix/ISO-with-zone values. */
  fileTimezone: string;
  /** Line number of the first data line in `text` (for chunked uploads). */
  lineOffset?: number;
  /** Explicit header when `text` is a chunk without a header line. */
  header?: string;
}

export interface OhlcParseResult {
  candles: Candle[];
  issues: ParseIssue[];
  detectedFormat: string;
}

const num = (s: string | undefined) => {
  if (s === undefined || s === '') return NaN;
  return Number(s.replace(/\s/g, ''));
};

/**
 * Parses OHLC CSV from TradingView chart export ("time,open,high,low,close,Volume"),
 * MetaTrader ("<DATE>,<TIME>,<OPEN>,...", or headerless "2019.07.15,00:00,o,h,l,c,v"),
 * Dukascopy ("Gmt time,Open,High,Low,Close,Volume") and generic "datetime/timestamp" files.
 * Rows that fail validation are reported, never silently "fixed".
 */
export function parseOhlcCsv(text: string, opts: OhlcParseOptions): OhlcParseResult {
  const delim = detectDelimiter(opts.header ?? text);
  const rawLines = text.split(/\r?\n/);
  const issues: ParseIssue[] = [];
  const candles: Candle[] = [];
  let lineNo = (opts.lineOffset ?? 1) - 1;

  let headerCells: string[] | null = opts.header ? splitCsvLine(opts.header, delim).map(normHeader) : null;
  let startIdx = 0;
  if (!headerCells) {
    const firstIdx = rawLines.findIndex((l) => l.trim());
    if (firstIdx < 0) return { candles, issues, detectedFormat: 'empty' };
    const cells = splitCsvLine(rawLines[firstIdx], delim);
    const looksHeader = cells.some((c) => /[a-zA-Z]/.test(c) && !/^\d{4}[-./]/.test(c) && !/\d{4}-\d{2}-\d{2}T/.test(c));
    if (looksHeader) {
      headerCells = cells.map(normHeader);
      startIdx = firstIdx + 1;
      lineNo += firstIdx + 1;
    } else {
      // Headerless MetaTrader: date,time,open,high,low,close[,volume]
      headerCells = cells.length >= 7 || (cells.length === 6 && /:/.test(cells[1]))
        ? ['date', 'time', 'open', 'high', 'low', 'close', 'volume']
        : ['time', 'open', 'high', 'low', 'close', 'volume'];
      startIdx = firstIdx;
      lineNo += firstIdx;
    }
  }

  const idx = (...names: string[]) => headerCells!.findIndex((h) => names.includes(h));
  const iDate = idx('date', 'day');
  const iTime = idx('time', 'gmt_time', 'local_time', 'datetime', 'timestamp', 'date_time', 'open_time');
  const iO = idx('open', 'o'), iH = idx('high', 'h'), iL = idx('low', 'l'), iC = idx('close', 'c');
  const iV = idx('volume', 'vol', 'tickvol', 'tick_volume', 'real_volume');
  if (iO < 0 || iH < 0 || iL < 0 || iC < 0 || (iTime < 0 && iDate < 0)) {
    issues.push({ line: lineNo, message: `Kolom wajib tidak ditemukan. Header terbaca: ${headerCells.join(', ')}` });
    return { candles, issues, detectedFormat: 'unknown' };
  }
  const format = iDate >= 0 && iTime >= 0 && headerCells[iTime] === 'time' ? 'date+time columns' : 'single time column';

  for (let i = startIdx; i < rawLines.length; i++) {
    lineNo++;
    const line = rawLines[i];
    if (!line.trim()) continue;
    const c = splitCsvLine(line, delim);
    let t: number | null = null;
    if (iDate >= 0 && iTime >= 0 && headerCells[iTime] === 'time') {
      t = parseWallDateTime(c[iDate], c[iTime], opts.fileTimezone);
    } else {
      const raw = c[iTime >= 0 ? iTime : iDate];
      t = parseTimestamp(raw);
      if (t === null && raw) t = parseWallDateTime(raw, undefined, opts.fileTimezone);
    }
    const o = num(c[iO]), h = num(c[iH]), l = num(c[iL]), cl = num(c[iC]);
    const v = iV >= 0 ? num(c[iV]) : NaN;
    if (t === null) { issues.push({ line: lineNo, message: 'Waktu tidak valid' }); continue; }
    if (![o, h, l, cl].every(Number.isFinite)) { issues.push({ line: lineNo, message: 'Nilai OHLC bukan angka' }); continue; }
    if (!(h >= l && h >= o && h >= cl && l <= o && l <= cl && l > 0)) {
      issues.push({ line: lineNo, message: `OHLC tidak konsisten (O=${o} H=${h} L=${l} C=${cl})` });
      continue;
    }
    candles.push({ time: t, open: o, high: h, low: l, close: cl, volume: Number.isFinite(v) ? v : null });
  }

  candles.sort((a, b) => a.time - b.time);
  const dedup: Candle[] = [];
  for (const cd of candles) {
    if (dedup.length && dedup[dedup.length - 1].time === cd.time) {
      issues.push({ line: 0, message: `Duplikat waktu ${new Date(cd.time).toISOString()} — baris pertama dipakai` });
      continue;
    }
    dedup.push(cd);
  }
  return { candles: dedup, issues, detectedFormat: format };
}

/** Generic header-mapped row reader for small CSVs (economic calendar, news, indicator events). */
export function readCsvObjects(text: string): { rows: Record<string, string>[]; header: string[] } {
  const delim = detectDelimiter(text);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], header: [] };
  const header = splitCsvLine(lines[0], delim).map(normHeader);
  const rows = lines.slice(1).map((l) => {
    const cells = splitCsvLine(l, delim);
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = cells[i] ?? ''; });
    return o;
  });
  return { rows, header };
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
