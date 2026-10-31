import type { Db } from './db';
import { HttpError } from './db';
import * as repo from './repo';
import { parseOhlcCsv, parseWallDateTime, readCsvObjects } from '../core/csv';
import { aggregateCandles, bucketStart, higherTimeframes, type Alignment } from '../core/timeframes';
import { NEWS_CATEGORIES, type NewsCategory } from '../core/news';
import { normalizeTimeframe, parseTimestamp, sessionOf } from '../core/time';
import { isEventType, isTimeframe, type Timeframe } from '../core/types';
import { refreshSentiment } from './news-service';

export async function importOhlcChunk(db: Db, v: {
  sourceId: string; timeframe: Timeframe; text: string; header?: string; lineOffset?: number; batchId?: string | null; filename?: string | null;
}) {
  const sources = await repo.listSources(db);
  const src = sources.find((s) => s.id === v.sourceId);
  if (!src) throw new HttpError(404, 'Sumber data tidak ditemukan');
  const instrumentId = await repo.getInstrumentId(db);
  const batchId = v.batchId ?? (await repo.createImportBatch(db, 'ohlc', src.id, v.filename ?? null));
  const parsed = parseOhlcCsv(v.text, { fileTimezone: src.file_timezone, header: v.header, lineOffset: v.lineOffset });
  const inserted = await repo.insertCandles(db, src.id, instrumentId, v.timeframe, parsed.candles, batchId);
  const skipped = parsed.candles.length - inserted;
  await repo.bumpImportBatch(db, batchId, parsed.candles.length + parsed.issues.length, inserted, skipped + parsed.issues.length, parsed.issues);
  return { batchId, parsed: parsed.candles.length, inserted, existing: skipped, issues: parsed.issues.slice(0, 50), issueCount: parsed.issues.length, format: parsed.detectedFormat };
}

/** Build higher timeframes from an imported lower timeframe of the SAME source (provenance preserved). */
export async function deriveTimeframes(db: Db, sourceId: string, from: Timeframe, targets: Timeframe[] | null, alignment: Alignment) {
  const instrumentId = await repo.getInstrumentId(db);
  const allowed = higherTimeframes(from);
  const tfs = (targets ?? allowed).filter((t) => allowed.includes(t));
  const results: Record<string, number> = {};
  for (const tf of tfs) results[tf] = 0;
  let cursor: number | null = null;
  // Stream the source in chunks. Each pass only aggregates candles before a D1-aligned cutoff,
  // so every bucket is built from one pass; the remainder is carried to the next pass.
  let carry: Awaited<ReturnType<typeof repo.candlesAfter>> = [];
  for (;;) {
    const chunk = await repo.candlesAfter(db, sourceId, from, cursor, 20_000);
    const done = chunk.length < 20_000;
    const all = carry.concat(chunk);
    if (!all.length) break;
    const cutoff = done ? Infinity : bucketStart(all[all.length - 1].time, 'D1', alignment);
    const ready = all.filter((c) => c.time < cutoff);
    carry = all.filter((c) => c.time >= cutoff);
    for (const tf of tfs) {
      // Buckets before the cutoff are closed (keepTail); on the final pass an incomplete tail is dropped.
      const agg = aggregateCandles(ready, from, tf, alignment, !done);
      results[tf] += await repo.insertCandles(db, sourceId, instrumentId, tf, agg, null);
    }
    if (done) break;
    cursor = chunk[chunk.length - 1].time;
  }
  return results;
}

const num = (s: string | undefined) => (s === undefined || s.trim() === '' ? null : Number(s.replace(/[%\s]/g, '')));
const ts = (s: string | undefined) => (s && s.trim() ? parseTimestamp(s.trim()) : null);

export async function importEconomicEventsCsv(db: Db, text: string, opts: { provider: string; isTest: boolean }) {
  const { rows } = readCsvObjects(text);
  const issues: { line: number; message: string }[] = [];
  let inserted = 0, updated = 0;
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 2;
    const category = (r.category || 'OTHER').toUpperCase() as NewsCategory;
    const scheduledAt = ts(r.scheduled_at);
    const actual = num(r.actual);
    const actualAvailableAt = ts(r.actual_available_at);
    if (!r.external_id || !r.title) { issues.push({ line, message: 'external_id dan title wajib' }); continue; }
    if (!(NEWS_CATEGORIES as readonly string[]).includes(category)) { issues.push({ line, message: `category tidak dikenal: ${r.category}` }); continue; }
    if (scheduledAt === null) { issues.push({ line, message: 'scheduled_at wajib ISO-8601 dengan zona waktu' }); continue; }
    if (actual !== null && actualAvailableAt === null) { issues.push({ line, message: 'actual ada tetapi actual_available_at kosong — tidak bisa dipakai tanpa waktu ketersediaan' }); continue; }
    if (actualAvailableAt !== null && actualAvailableAt < scheduledAt) { issues.push({ line, message: 'actual_available_at lebih awal dari scheduled_at' }); continue; }
    const impact = ['low', 'medium', 'high'].includes((r.impact || '').toLowerCase()) ? r.impact.toLowerCase() : 'unknown';
    const res = await repo.upsertEconomicEvent(db, {
      provider: r.provider || opts.provider, externalId: r.external_id, title: r.title, category, currency: r.currency || null, impact,
      scheduledAt, scheduleAvailableAt: ts(r.schedule_available_at), forecast: num(r.forecast), previous: num(r.previous), actual,
      actualAvailableAt, unit: r.unit || null, sourceUrl: r.source_url || null, isTest: opts.isTest,
    });
    ids.push(res.id);
    if (res.inserted) inserted++; else updated++;
  }
  // sentiment for rows with actual+forecast
  const sentiments = await refreshSentiment(db, await repo.economicEventsByIds(db, ids));
  return { rows: rows.length, inserted, updated, sentiments, issues };
}

export async function importNewsCsv(db: Db, text: string, opts: { provider: string; isTest: boolean }) {
  const { rows } = readCsvObjects(text);
  const issues: { line: number; message: string }[] = [];
  let saved = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 2;
    const publishedAt = ts(r.published_at);
    const category = (r.category || 'OTHER').toUpperCase() as NewsCategory;
    if (!r.external_id || !r.title || !r.source_name) { issues.push({ line, message: 'external_id, title, source_name wajib' }); continue; }
    if (publishedAt === null) { issues.push({ line, message: 'published_at wajib ISO-8601 dengan zona waktu' }); continue; }
    if (!(NEWS_CATEGORIES as readonly string[]).includes(category)) { issues.push({ line, message: `category tidak dikenal: ${r.category}` }); continue; }
    await repo.upsertArticle(db, {
      provider: r.provider || opts.provider, externalId: r.external_id, title: r.title, sourceName: r.source_name, category,
      publishedAt, firstSeenAt: ts(r.first_seen_at), url: r.url || null, summary: r.summary || null, isTest: opts.isTest,
    });
    saved++;
  }
  return { rows: rows.length, saved, issues };
}

/** Indicator events exported from TradingView (format documented in README / pine template). */
export async function importIndicatorEventsCsv(db: Db, text: string, opts: { isTest: boolean }) {
  const { rows } = readCsvObjects(text);
  const instrumentId = await repo.getInstrumentId(db);
  const issues: { line: number; message: string }[] = [];
  let inserted = 0, duplicates = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 2;
    const t = ts(r.timestamp);
    const tf = normalizeTimeframe(r.timeframe);
    const price = num(r.price);
    if (!r.event_id || t === null || !tf || !isEventType(r.event_type) || price === null) {
      issues.push({ line, message: 'Wajib: event_id, timestamp (ISO+zona/unix), timeframe, event_type, price' }); continue;
    }
    const id = await repo.insertEvent(db, {
      mode: 'BACKTEST', eventUid: r.event_id, dedupeKey: `tvcsv:${r.event_id}`, instrumentId, timeframe: tf, eventType: r.event_type,
      eventTime: t, price, zoneLow: num(r.zone_low), zoneHigh: num(r.zone_high),
      zoneKind: ['support', 'resistance'].includes(r.zone_kind) ? r.zone_kind : 'unknown', zoneId: null, strategyVersionId: null,
      strategyLabel: r.strategy_version || 'tradingview_csv', source: 'tradingview_csv', replaySessionId: null, runNumber: null,
      confirmations: {}, payload: { imported: true }, isTest: opts.isTest,
    });
    if (id) inserted++; else duplicates++;
  }
  return { rows: rows.length, inserted, duplicates, issues };
}

/**
 * TradingView Strategy Tester → "List of trades" CSV. Column names vary between TradingView
 * versions, so columns are matched by keyword. Times are in the CHART timezone → pass it.
 */
export async function importStrategyReportCsv(db: Db, text: string, opts: { name: string; chartTimezone: string; timeframe: string | null; isTest: boolean }) {
  const { rows, header } = readCsvObjects(text);
  const find = (...keys: string[]) => header.find((h) => keys.every((k) => h.includes(k)));
  const cTrade = find('trade'), cType = find('type'), cDate = find('date'), cPrice = find('price'), cProfit = header.find((h) => h.startsWith('profit') || h.startsWith('net_p'));
  if (!cTrade || !cType || !cDate || !cPrice) throw new HttpError(422, `Kolom laporan TradingView tidak dikenali. Header: ${header.join(', ')}`);
  const trades = new Map<string, { side?: 'long' | 'short'; entry?: { t: number; p: number }; exit?: { t: number; p: number }; pnl?: number | null }>();
  const issues: { line: number; message: string }[] = [];
  rows.forEach((r, i) => {
    const t = parseTimestamp(r[cDate]) ?? parseWallDateTime(r[cDate], undefined, opts.chartTimezone);
    const p = num(r[cPrice]);
    if (t === null || p === null) { issues.push({ line: i + 2, message: 'Tanggal/harga tidak valid' }); return; }
    const k = r[cTrade];
    const cur = trades.get(k) ?? {};
    const type = r[cType].toLowerCase();
    cur.side = type.includes('short') ? 'short' : 'long';
    if (type.includes('entry')) cur.entry = { t, p };
    else if (type.includes('exit')) { cur.exit = { t, p }; cur.pnl = cProfit ? num(r[cProfit]) : null; }
    trades.set(k, cur);
  });
  const instrumentId = await repo.getInstrumentId(db);
  const sessionId = await repo.createBacktestSession(db, {
    name: opts.name, strategyVersionId: null, sourceId: null, instrumentId, timeframe: isTimeframe(opts.timeframe) ? opts.timeframe : null,
    profile: 'snr_only', costConfig: { note: 'Biaya mengikuti pengaturan Strategy Tester TradingView' }, isTest: opts.isTest,
    notes: 'Diimpor dari laporan TradingView Strategy Tester',
  });
  let n = 0;
  for (const [k, tr] of trades) {
    if (!tr.entry) { issues.push({ line: 0, message: `Trade ${k} tanpa entry` }); continue; }
    await repo.insertTrade(db, {
      backtest_session_id: sessionId, origin: 'tradingview_import', side: tr.side ?? 'long',
      timeframe: isTimeframe(opts.timeframe) ? opts.timeframe : null, entry_time: tr.entry.t, entry_price: tr.entry.p,
      exit_time: tr.exit?.t ?? null, exit_price: tr.exit?.p ?? null, exit_reason: tr.exit ? 'imported' : 'open', pnl: tr.pnl ?? null,
      session_label: sessionOf(tr.entry.t), setup_reason: { imported_trade_no: k }, costs: {}, is_test: opts.isTest,
    });
    n++;
  }
  return { backtestSessionId: sessionId, trades: n, issues };
}
