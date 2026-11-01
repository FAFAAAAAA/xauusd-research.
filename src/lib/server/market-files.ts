import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Db } from './db';
import { aggregateCandles } from '../core/timeframes';
import { INSTRUMENTS, instrumentSpec } from '../core/instruments';
import { TIMEFRAME_MS, type Candle, type Timeframe } from '../core/types';

/**
 * Price data bundled with the website (data/market/<SYMBOL>_<TF>.bin.gz, packed by scripts/pack-market-data.mjs).
 * Each dataset is one base timeframe (M15 or M30); higher timeframes are aggregated in memory with the same
 * UTC alignment the database path uses. Datasets appear in the app as market_data_sources rows whose
 * broker_symbol is "file:<SYMBOL>:<TF>" so backtest sessions keep their usual foreign keys.
 */
export type BaseTf = 'M1' | 'M5' | 'M15' | 'M30';
/** `chunks`: large datasets (M1) are stored as one file per UTC year: <SYMBOL>_<TF>_<YEAR>.bin.gz */
export interface DatasetInfo { key: string; symbol: string; tf: BaseTf; first: number; last: number; candles: number; chunks?: Record<string, { first: number; last: number; candles: number }> }

const DIR = join(process.cwd(), 'data', 'market');
let manifest: Record<string, DatasetInfo> | null = null;
export function datasets(): DatasetInfo[] {
  if (!manifest) {
    try {
      const raw = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as Record<string, Omit<DatasetInfo, 'key'>>;
      manifest = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, { key: k, ...v }]));
    } catch { manifest = {}; }
  }
  const order = (s: string) => { const i = INSTRUMENTS.findIndex((x) => x.symbol === s); return i < 0 ? 99 : i; };
  const tfOrder = (t: string) => ['M1', 'M5', 'M15', 'M30'].indexOf(t);
  return Object.values(manifest).sort((a, b) => order(a.symbol) - order(b.symbol) || tfOrder(a.tf) - tfOrder(b.tf));
}

const cache = new Map<string, Candle[]>();
function decode(file: string, symbol: string): Candle[] {
  const buf = gunzipSync(readFileSync(join(DIR, file)));
  const n = buf.readInt32LE(0);
  const times = new Int32Array(buf.buffer.slice(buf.byteOffset + 4, buf.byteOffset + 4 + 4 * n));
  const px = new Float32Array(buf.buffer.slice(buf.byteOffset + 4 + 4 * n, buf.byteOffset + 4 + 20 * n));
  const d = instrumentSpec(symbol)?.digits ?? 5;
  const f = 10 ** d, r = (x: number) => Math.round(x * f) / f;   // undo float32 noise (1.1479300260 → 1.14793)
  const out: Candle[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = { time: times[i] * 60_000, open: r(px[4 * i]), high: r(px[4 * i + 1]), low: r(px[4 * i + 2]), close: r(px[4 * i + 3]), volume: null };
  }
  return out;
}
function cached(key: string, load: () => Candle[], keep: number): Candle[] {
  const hit = cache.get(key);
  if (hit) return hit;
  const out = load();
  while (cache.size >= keep) cache.delete(cache.keys().next().value as string);  // keep memory bounded on small instances
  cache.set(key, out);
  return out;
}
/** All base candles of a (non-chunked) dataset (decoded once per server instance). */
export function datasetCandles(symbol: string, tf: string): Candle[] {
  return cached(`${symbol}_${tf}`, () => decode(`${symbol}_${tf}.bin.gz`, symbol), 5);
}
const YEAR = 365.25 * 86_400_000;
/** Base candles with time in [from, to). Chunked datasets load only the years that overlap. */
export function datasetRange(symbol: string, tf: string, from: number, to: number): Candle[] {
  const info = datasets().find((d) => d.symbol === symbol && d.tf === tf);
  if (!info?.chunks) { const a = datasetCandles(symbol, tf); return a.slice(lowerBound(a, from), lowerBound(a, to)); }
  const y0 = new Date(Math.max(from, info.first)).getUTCFullYear(), y1 = new Date(Math.min(to, info.last + 1)).getUTCFullYear();
  const parts: Candle[][] = [];
  for (let y = y0; y <= y1; y++) {
    if (!info.chunks[String(y)]) continue;
    const a = cached(`${symbol}_${tf}_${y}`, () => decode(`${symbol}_${tf}_${y}.bin.gz`, symbol), 4);
    parts.push(a.slice(lowerBound(a, from), lowerBound(a, to)));
  }
  return parts.length === 1 ? parts[0] : ([] as Candle[]).concat(...parts);
}

const lowerBound = (a: readonly Candle[], t: number) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].time < t) lo = m + 1; else hi = m; } return lo; };

/**
 * Candle access with the same contract as the database helpers (closed candles only, ascending).
 * Small bases (M1/M5): M15 and higher are built from the symbol's M15 dataset when it exists (longer, gap-filled
 * and much cheaper than aggregating years of M1); M5 on an M1 base is aggregated from M1.
 */
export function fileProvider(symbol: string, base: BaseTf) {
  const tfCache = new Map<string, Candle[]>();
  const m15 = base !== 'M15' && base !== 'M30' && datasets().some((d) => d.symbol === symbol && d.tf === 'M15') ? 'M15' : null;
  const series = (tf: Timeframe, from: number, to: number): Candle[] => {
    if (tf === base) return datasetRange(symbol, base, from, to);
    const k = `${tf}|${from}|${to}`;
    const hit = tfCache.get(k);
    if (hit) return hit;
    const src: BaseTf = m15 && TIMEFRAME_MS[tf] >= TIMEFRAME_MS.M15 ? 'M15' : base;
    // aggregate a little wider than asked so the first/last buckets are complete
    const raw = datasetRange(symbol, src, from - 86_400_000, to);
    const agg = (tf === src ? raw : aggregateCandles(raw, src, tf, 'utc', false)).filter((c) => c.time >= from && c.time < to);
    tfCache.set(k, agg);
    return agg;
  };
  return {
    has: (tf: Timeframe) => tf === base || (['M5', 'M15', 'M30', 'H1', 'H4', 'D1'].includes(tf) && TIMEFRAME_MS[tf] > TIMEFRAME_MS[base]),
    upTo: (tf: Timeframe, t: number, limit: number) => {
      if (tf !== base) return [];
      const a = datasetRange(symbol, base, t - Math.max(limit * TIMEFRAME_MS[base] * 4, 30 * 86_400_000), t + 1);
      return a.slice(Math.max(0, a.length - limit));
    },
    between: (tf: Timeframe, from: number, to: number) => series(tf, from, to),
  };
}

/** Makes sure every bundled dataset has an instrument row and a market_data_sources row. Returns key → source id. */
let ensured: Promise<Map<string, string>> | null = null;
export function ensureDatasetSources(db: Db): Promise<Map<string, string>> {
  if (ensured) return ensured;
  ensured = (async () => {
    const out = new Map<string, string>();
    for (const d of datasets()) {
      const spec = instrumentSpec(d.symbol);
      await db.query(`insert into instruments (symbol, description, price_digits) values ($1, $2, $3) on conflict (symbol) do nothing returning id`,
        [d.symbol, spec?.label ?? d.symbol, spec?.digits ?? 5]);
      const name = `forexsb ${d.symbol} ${d.tf} (file website)`;
      const r = await db.query<{ id: string }>(
        `insert into market_data_sources (name, provider, kind, broker_symbol, file_timezone, price_basis, notes, is_test)
         values ($1, 'forexsb.com (file bawaan website)', 'csv_import', $2, 'UTC', 'unknown', $3, false)
         on conflict (name) do update set broker_symbol = excluded.broker_symbol returning id`,
        [name, `file:${d.symbol}:${d.tf}`, `Data ${d.tf} ${d.symbol} dari forexsb.com, disimpan sebagai file di website (bukan di database).`]);
      out.set(d.key, r[0].id);
    }
    return out;
  })().catch((e) => { ensured = null; throw e; });
  return ensured;
}

export function parseFileSource(brokerSymbol: string | null | undefined): { symbol: string; tf: BaseTf } | null {
  const m = /^file:([A-Z0-9]+):(M1|M5|M15|M30)$/.exec(brokerSymbol ?? '');
  return m ? { symbol: m[1], tf: m[2] as BaseTf } : null;
}
