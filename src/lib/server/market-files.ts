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
export type BaseTf = 'M5' | 'M15' | 'M30';
export interface DatasetInfo { key: string; symbol: string; tf: BaseTf; first: number; last: number; candles: number }

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
  return Object.values(manifest).sort((a, b) => order(a.symbol) - order(b.symbol) || a.tf.localeCompare(b.tf));
}

const cache = new Map<string, Candle[]>();
/** All base candles of a dataset (decoded once per server instance). */
export function datasetCandles(symbol: string, tf: string): Candle[] {
  const key = `${symbol}_${tf}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const buf = gunzipSync(readFileSync(join(DIR, `${key}.bin.gz`)));
  const n = buf.readInt32LE(0);
  const times = new Int32Array(buf.buffer.slice(buf.byteOffset + 4, buf.byteOffset + 4 + 4 * n));
  const px = new Float32Array(buf.buffer.slice(buf.byteOffset + 4 + 4 * n, buf.byteOffset + 4 + 20 * n));
  const d = instrumentSpec(symbol)?.digits ?? 5;
  const f = 10 ** d, r = (x: number) => Math.round(x * f) / f;   // undo float32 noise (1.1479300260 → 1.14793)
  const out: Candle[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = { time: times[i] * 60_000, open: r(px[4 * i]), high: r(px[4 * i + 1]), low: r(px[4 * i + 2]), close: r(px[4 * i + 3]), volume: null };
  }
  if (cache.size > 4) cache.delete(cache.keys().next().value as string);  // keep memory bounded on small instances
  cache.set(key, out);
  return out;
}

const lowerBound = (a: readonly Candle[], t: number) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].time < t) lo = m + 1; else hi = m; } return lo; };

/** Candle access with the same contract as the database helpers (closed candles only, ascending). */
export function fileProvider(symbol: string, base: BaseTf) {
  const all = () => datasetCandles(symbol, base);
  const tfCache = new Map<string, Candle[]>();
  const series = (tf: Timeframe, from: number, to: number): Candle[] => {
    if (tf === base) { const a = all(); return a.slice(lowerBound(a, from), lowerBound(a, to)); }
    // aggregate from base a little wider than asked so the first/last buckets are complete
    const k = `${tf}|${from}|${to}`;
    const hit = tfCache.get(k);
    if (hit) return hit;
    const a = all();
    const src = a.slice(lowerBound(a, from - 86_400_000), lowerBound(a, to));
    const agg = aggregateCandles(src, base, tf, 'utc', false).filter((c) => c.time >= from && c.time < to);
    tfCache.set(k, agg);
    return agg;
  };
  return {
    has: (tf: Timeframe) => tf === base || (['M15', 'M30', 'H1', 'H4', 'D1'].includes(tf) && TIMEFRAME_MS[tf] > TIMEFRAME_MS[base]),
    upTo: (tf: Timeframe, t: number, limit: number) => { const a = all(); const e = lowerBound(a, t + 1); return tf === base ? a.slice(Math.max(0, e - limit), e) : []; },
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
  const m = /^file:([A-Z0-9]+):(M5|M15|M30)$/.exec(brokerSymbol ?? '');
  return m ? { symbol: m[1], tf: m[2] as BaseTf } : null;
}
