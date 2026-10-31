import type { Db } from './db';
import { iso, toMs, toNum } from './db';
import type { Candle, EventType, Mode, SnrZone, Timeframe } from '../core/types';
import type { EconomicEventRecord, NewsCategory } from '../core/news';

// ----------------------------------------------------------------- settings
export async function getAppSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const r = await db.query<{ value: T }>('select value from app_settings where key = $1', [key]);
  return r[0]?.value ?? fallback;
}
export async function setAppSetting(db: Db, key: string, value: unknown) {
  await db.query(
    `insert into app_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now() returning key`,
    [key, JSON.stringify(value)],
  );
}

export async function getInstrumentId(db: Db, symbol = 'XAUUSD'): Promise<string> {
  const r = await db.query<{ id: string }>('select id from instruments where symbol = $1', [symbol]);
  if (!r[0]) throw new Error(`Instrument ${symbol} tidak ada — jalankan migrasi`);
  return r[0].id;
}

export async function logSystemError(db: Db, scope: string, message: string, details: unknown = {}) {
  try {
    await db.query('insert into system_errors (scope, message, details) values ($1,$2,$3::jsonb) returning id',
      [scope, message.slice(0, 2000), JSON.stringify(details ?? {})]);
  } catch { /* never throw from the error logger */ }
}

// ------------------------------------------------------------------ sources
export interface SourceRow {
  id: string; name: string; provider: string; kind: string; broker_symbol: string | null;
  file_timezone: string; price_basis: string; spread_spec: Record<string, unknown>; notes: string | null; is_test: boolean;
}
export async function listSources(db: Db): Promise<SourceRow[]> {
  return db.query<SourceRow>('select id, name, provider, kind, broker_symbol, file_timezone, price_basis, spread_spec, notes, is_test from market_data_sources order by created_at');
}
export async function createSource(db: Db, s: Omit<SourceRow, 'id'>): Promise<SourceRow> {
  const r = await db.query<SourceRow>(
    `insert into market_data_sources (name, provider, kind, broker_symbol, file_timezone, price_basis, spread_spec, notes, is_test)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     returning id, name, provider, kind, broker_symbol, file_timezone, price_basis, spread_spec, notes, is_test`,
    [s.name, s.provider, s.kind, s.broker_symbol, s.file_timezone, s.price_basis, JSON.stringify(s.spread_spec ?? {}), s.notes, s.is_test],
  );
  return r[0];
}

export interface CoverageRow { source_id: string; source_name: string; timeframe: Timeframe; first: number; last: number; candles: number; is_test: boolean }
export async function dataCoverage(db: Db): Promise<CoverageRow[]> {
  const r = await db.query<Record<string, unknown>>(
    `select c.source_id, s.name as source_name, s.is_test, c.timeframe, min(c.open_time) as first, max(c.open_time) as last, count(*)::int as candles
     from historical_candles c join market_data_sources s on s.id = c.source_id
     group by c.source_id, s.name, s.is_test, c.timeframe order by s.name, c.timeframe`,
  );
  return r.map((x) => ({
    source_id: String(x.source_id), source_name: String(x.source_name), timeframe: x.timeframe as Timeframe,
    first: toMs(x.first)!, last: toMs(x.last)!, candles: Number(x.candles), is_test: Boolean(x.is_test),
  }));
}

// ------------------------------------------------------------------ candles
export async function createImportBatch(db: Db, kind: string, sourceId: string | null, filename: string | null): Promise<string> {
  const r = await db.query<{ id: string }>(
    'insert into import_batches (kind, source_id, filename) values ($1,$2,$3) returning id', [kind, sourceId, filename]);
  return r[0].id;
}
export async function bumpImportBatch(db: Db, id: string, total: number, inserted: number, skipped: number, errors: unknown[]) {
  await db.query(
    `update import_batches set rows_total = rows_total + $2, rows_inserted = rows_inserted + $3, rows_skipped = rows_skipped + $4,
       errors = (errors || $5::jsonb) where id = $1 returning id`,
    [id, total, inserted, skipped, JSON.stringify(errors.slice(0, 50))],
  );
}

/** Idempotent bulk insert. Existing (source, timeframe, open_time) rows are left untouched. */
export async function insertCandles(
  db: Db, sourceId: string, instrumentId: string, tf: Timeframe, candles: readonly Candle[], batchId: string | null,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < candles.length; i += 2000) {
    const chunk = candles.slice(i, i + 2000);
    const r = await db.query<{ open_time: string }>(
      `insert into historical_candles (source_id, instrument_id, timeframe, open_time, open, high, low, close, volume, import_batch_id)
       select $1::uuid, $2::uuid, $3, t, o, h, l, c, v, $9::uuid
       from unnest($4::timestamptz[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $10::numeric[]) as u(t, o, h, l, c, v)
       on conflict (source_id, timeframe, open_time) do nothing
       returning open_time`,
      [sourceId, instrumentId, tf,
        chunk.map((c) => iso(c.time)), chunk.map((c) => c.open), chunk.map((c) => c.high), chunk.map((c) => c.low),
        chunk.map((c) => c.close), batchId, chunk.map((c) => c.volume ?? null)],
    );
    inserted += r.length;
  }
  return inserted;
}

const CANDLE_COLS = `extract(epoch from open_time)*1000 as t, open::float8 as o, high::float8 as h, low::float8 as l, close::float8 as c, volume::float8 as v`;
const mapCandle = (r: Record<string, unknown>): Candle => ({
  time: Number(r.t), open: Number(r.o), high: Number(r.h), low: Number(r.l), close: Number(r.c), volume: toNum(r.v),
});

/** Candles with open_time in (afterExclusive, ...] ascending, limited. */
export async function candlesAfter(db: Db, sourceId: string, tf: Timeframe, afterExclusive: number | null, limit: number): Promise<Candle[]> {
  const r = await db.query<Record<string, unknown>>(
    `select ${CANDLE_COLS} from historical_candles
     where source_id = $1 and timeframe = $2 and ($3::timestamptz is null or open_time > $3::timestamptz)
     order by open_time asc limit $4`,
    [sourceId, tf, iso(afterExclusive), limit],
  );
  return r.map(mapCandle);
}

/** The `limit` most recent candles with open_time <= upToInclusive, returned ascending. Never returns future candles. */
export async function candlesUpTo(db: Db, sourceId: string, tf: Timeframe, upToInclusive: number, limit: number): Promise<Candle[]> {
  const r = await db.query<Record<string, unknown>>(
    `select * from (
       select ${CANDLE_COLS}, open_time from historical_candles
       where source_id = $1 and timeframe = $2 and open_time <= $3::timestamptz
       order by open_time desc limit $4) x order by open_time asc`,
    [sourceId, tf, iso(upToInclusive), limit],
  );
  return r.map(mapCandle);
}

/** Candles with open_time in [from, to) ascending (backtest loader; caller bounds the range). */
export async function candlesBetween(db: Db, sourceId: string, tf: Timeframe, from: number, toExclusive: number, limit = 400_000): Promise<Candle[]> {
  const r = await db.query<Record<string, unknown>>(
    `select ${CANDLE_COLS} from historical_candles
     where source_id = $1 and timeframe = $2 and open_time >= $3::timestamptz and open_time < $4::timestamptz
     order by open_time asc limit $5`,
    [sourceId, tf, iso(from), iso(toExclusive), limit],
  );
  return r.map(mapCandle);
}

export async function hasCandles(db: Db, sourceId: string, tf: Timeframe): Promise<boolean> {
  const r = await db.query<{ x: number }>('select 1 as x from historical_candles where source_id=$1 and timeframe=$2 limit 1', [sourceId, tf]);
  return r.length > 0;
}

export async function lastCandleBefore(db: Db, sourceId: string, tf: Timeframe, beforeExclusive: number): Promise<number | null> {
  const r = await db.query<{ t: unknown }>(
    `select extract(epoch from max(open_time))*1000 as t from historical_candles where source_id=$1 and timeframe=$2 and open_time < $3::timestamptz`,
    [sourceId, tf, iso(beforeExclusive)]);
  return toNum(r[0]?.t);
}

export async function latestCandle(db: Db): Promise<(Candle & { timeframe: string; source: string; is_test: boolean }) | null> {
  const r = await db.query<Record<string, unknown>>(
    `select ${CANDLE_COLS}, c.timeframe, s.name as source, s.is_test from historical_candles c join market_data_sources s on s.id=c.source_id
     order by open_time desc limit 1`);
  return r[0] ? { ...mapCandle(r[0]), timeframe: String(r[0].timeframe), source: String(r[0].source), is_test: Boolean(r[0].is_test) } : null;
}

// -------------------------------------------------------------------- zones
export async function zonesAsOf(db: Db, instrumentId: string, mode: Mode, asOf: number, replaySessionId: string | null): Promise<SnrZone[]> {
  const r = await db.query<Record<string, unknown>>(
    `select id, kind, price_low::float8 as low, price_high::float8 as high, timeframe, origin,
            extract(epoch from valid_from)*1000 as vf, extract(epoch from valid_until)*1000 as vu
     from snr_zones where instrument_id=$1 and mode=$2 and valid_from <= $3::timestamptz
       and (valid_until is null or valid_until > $3::timestamptz)
       and (replay_session_id is null or replay_session_id = $4::uuid)
     order by price_low`,
    [instrumentId, mode, iso(asOf), replaySessionId]);
  return r.map((z) => ({
    id: String(z.id), kind: z.kind as SnrZone['kind'], low: Number(z.low), high: Number(z.high),
    timeframe: (z.timeframe as Timeframe) ?? null, origin: z.origin as SnrZone['origin'],
    validFrom: Number(z.vf), validUntil: toNum(z.vu),
  }));
}
export async function listZones(db: Db) {
  return db.query<Record<string, unknown>>(
    `select id, mode, kind, timeframe, origin, price_low::float8 as low, price_high::float8 as high, valid_from, valid_until, replay_session_id, is_test, notes
     from snr_zones order by created_at desc limit 200`);
}
export async function createZone(db: Db, z: {
  instrumentId: string; mode: Mode; kind: string; low: number; high: number; timeframe: string | null;
  origin: 'manual' | 'test'; validFrom: number; validUntil: number | null; replaySessionId: string | null; isTest: boolean; notes: string | null;
}) {
  const r = await db.query<{ id: string }>(
    `insert into snr_zones (instrument_id, mode, kind, price_low, price_high, timeframe, origin, valid_from, valid_until, replay_session_id, is_test, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10,$11,$12) returning id`,
    [z.instrumentId, z.mode, z.kind, z.low, z.high, z.timeframe, z.origin, iso(z.validFrom), iso(z.validUntil), z.replaySessionId, z.isTest, z.notes]);
  return r[0].id;
}
export async function deleteZone(db: Db, id: string) {
  await db.query('delete from snr_zones where id=$1 returning id', [id]);
}

// --------------------------------------------------------------- strategies
export interface StrategyVersionRow { id: string; strategy_key: string; version: string; adapter_key: string; status: string; is_test: boolean; description: string | null }
export async function listStrategyVersions(db: Db): Promise<StrategyVersionRow[]> {
  return db.query<StrategyVersionRow>('select id, strategy_key, version, adapter_key, status, is_test, description from strategy_versions order by is_test, created_at');
}
export async function getStrategyVersion(db: Db, id: string | null): Promise<StrategyVersionRow | null> {
  if (!id) return null;
  const r = await db.query<StrategyVersionRow>('select id, strategy_key, version, adapter_key, status, is_test, description from strategy_versions where id=$1', [id]);
  return r[0] ?? null;
}
/** Strategies implemented in code that must exist in the DB (idempotent; also shipped as a migration). */
export async function ensureBuiltinStrategies(db: Db) {
  await db.query(
    `insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
     values ('snr', 'h4h1m15-v0.1', 'snr_h4h1_m15', 'active', false,
       'DRAF v0.1: tren H4 (struktur swing), zona SNR H4+H1, entry M15 saat sentuh zona, SL luar zona + 0.5 ATR(14) M15, TP diuji RR 1/2/3. Belum terbukti profit.')
     on conflict (strategy_key, version) do nothing returning id`);
  await db.query(
    `insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
     values ('breakout', 'v0.2', 'breakout_v02', 'active', false,
       'v0.2 hasil riset 2018-2026: breakout H1 (40 candle) + breakout sesi London & New York, hanya searah tren H4 & D1, BUY dan SELL. SL ATR/range, TP sesuai RR.')
     on conflict (strategy_key, version) do nothing returning id`);
  await db.query(
    `insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
     values ('snr_snd_tv', 'v1', 'snr_snd_mtf_v1', 'active', false,
       'Indikator TradingView pemilik: tren H4 EMA50/200, SNR pivot H4, zona supply/demand H4 & H1, entry rejection M15, SL luar zona + 0.15 ATR, TP 2x.')
     on conflict (strategy_key, version) do nothing returning id`);
}
// ---- custom strategies (definition stored in strategy_settings.params.definition, mode BACKTEST)
export async function createCustomStrategy(db: Db, def: { name: string; description?: string; kind: string }, definition: unknown): Promise<StrategyVersionRow> {
  const base = def.name.trim().slice(0, 60);
  for (let k = 0; k < 20; k++) {
    const version = k ? `${base} (${k + 1})` : base;
    const r = await db.query<StrategyVersionRow>(
      `insert into strategy_versions (strategy_key, version, adapter_key, status, is_test, description)
       values ('custom', $1, 'custom_v1', 'active', false, $2)
       on conflict (strategy_key, version) do nothing
       returning id, strategy_key, version, adapter_key, status, is_test, description`,
      [version, (def.description ?? '').slice(0, 500) || (def.kind === 'signals' ? 'Sinyal dari file' : 'Strategi buatan sendiri')]);
    if (r[0]) {
      await db.query(`insert into strategy_settings (strategy_version_id, mode, params, active) values ($1, 'BACKTEST', $2::jsonb, true) returning id`,
        [r[0].id, JSON.stringify({ definition })]);
      return r[0];
    }
  }
  throw new Error('Nama strategi sudah dipakai terlalu banyak kali');
}
export async function strategyDefinition(db: Db, strategyVersionId: string): Promise<unknown | null> {
  const r = await db.query<{ params: { definition?: unknown } }>(
    `select params from strategy_settings where strategy_version_id = $1 and mode = 'BACKTEST'`, [strategyVersionId]);
  return r[0]?.params?.definition ?? null;
}
/** Short info per custom strategy for the UI (never the full signal list). */
export async function customStrategySummaries(db: Db) {
  return db.query<{ id: string; kind: string | null; signals: number | null; definition: unknown }>(
    `select sv.id, ss.params->'definition'->>'kind' as kind,
            case when ss.params->'definition'->>'kind' = 'signals' then jsonb_array_length(ss.params->'definition'->'signals') end as signals,
            case when ss.params->'definition'->>'kind' = 'rules' then ss.params->'definition' end as definition
     from strategy_versions sv join strategy_settings ss on ss.strategy_version_id = sv.id and ss.mode = 'BACKTEST'
     where sv.adapter_key = 'custom_v1'`);
}
export async function setStrategyStatus(db: Db, id: string, status: 'active' | 'retired') {
  const r = await db.query<{ id: string }>('update strategy_versions set status = $2 where id = $1 returning id', [id, status]);
  return r.length > 0;
}
/** Deletes a custom strategy (optionally with its backtest results). Built-in strategies are only hidden. */
export async function deleteCustomStrategy(db: Db, id: string, withResults: boolean) {
  if (withResults) {
    const ids = (await db.query<{ id: string }>('select id from backtest_sessions where strategy_version_id = $1', [id])).map((x) => x.id);
    if (ids.length) await deleteBacktestSessions(db, ids);
  }
  const r = await db.query<{ id: string }>(`delete from strategy_versions where id = $1 and adapter_key = 'custom_v1' returning id`, [id]);
  return r.length > 0;
}
export async function defaultStrategyVersion(db: Db): Promise<StrategyVersionRow | null> {
  const r = await db.query<StrategyVersionRow>(
    `select id, strategy_key, version, adapter_key, status, is_test, description from strategy_versions
     where status='active' and is_test=false order by created_at desc limit 1`);
  return r[0] ?? null;
}

// ------------------------------------------------------------------- replay
export interface ReplayRow {
  id: string; source_id: string; instrument_id: string; strategy_version_id: string | null; timeframe: Timeframe;
  start_time: number; cursor_time: number | null; status: 'ready' | 'playing' | 'paused' | 'finished'; speed: number;
  telegram_enabled: boolean; resend_policy: 'never' | 'new_run'; run_number: number; candles_processed: number;
  strategy_params: Record<string, unknown>; strategy_state: Record<string, unknown>; is_test: boolean;
  created_at: number;
}
const REPLAY_COLS = `id, source_id, instrument_id, strategy_version_id, timeframe, extract(epoch from start_time)*1000 as start_ms,
  extract(epoch from cursor_time)*1000 as cursor_ms, status, speed, telegram_enabled, resend_policy, run_number, candles_processed,
  strategy_params, strategy_state, is_test, extract(epoch from created_at)*1000 as created_ms`;
const mapReplay = (r: Record<string, unknown>): ReplayRow => ({
  id: String(r.id), source_id: String(r.source_id), instrument_id: String(r.instrument_id),
  strategy_version_id: (r.strategy_version_id as string) ?? null, timeframe: r.timeframe as Timeframe,
  start_time: Number(r.start_ms), cursor_time: toNum(r.cursor_ms), status: r.status as ReplayRow['status'],
  speed: Number(r.speed), telegram_enabled: Boolean(r.telegram_enabled), resend_policy: r.resend_policy as ReplayRow['resend_policy'],
  run_number: Number(r.run_number), candles_processed: Number(r.candles_processed),
  strategy_params: (r.strategy_params as Record<string, unknown>) ?? {}, strategy_state: (r.strategy_state as Record<string, unknown>) ?? {},
  is_test: Boolean(r.is_test), created_at: Number(r.created_ms),
});

export async function insertReplay(db: Db, v: {
  sourceId: string; instrumentId: string; strategyVersionId: string | null; timeframe: Timeframe; startTime: number;
  cursorTime: number | null; resendPolicy: string; params: Record<string, unknown>; isTest: boolean;
}): Promise<ReplayRow> {
  const r = await db.query<Record<string, unknown>>(
    `insert into replay_sessions (source_id, instrument_id, strategy_version_id, timeframe, start_time, cursor_time, resend_policy, strategy_params, is_test)
     values ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8::jsonb,$9) returning ${REPLAY_COLS}`,
    [v.sourceId, v.instrumentId, v.strategyVersionId, v.timeframe, iso(v.startTime), iso(v.cursorTime), v.resendPolicy, JSON.stringify(v.params), v.isTest]);
  return mapReplay(r[0]);
}
export async function getReplay(db: Db, id: string): Promise<ReplayRow | null> {
  const r = await db.query<Record<string, unknown>>(`select ${REPLAY_COLS} from replay_sessions where id=$1`, [id]);
  return r[0] ? mapReplay(r[0]) : null;
}
export async function listReplays(db: Db, limit = 20): Promise<ReplayRow[]> {
  const r = await db.query<Record<string, unknown>>(`select ${REPLAY_COLS} from replay_sessions order by created_at desc limit $1`, [limit]);
  return r.map(mapReplay);
}
export async function updateReplayControls(db: Db, id: string, patch: {
  status?: string; speed?: number; telegram_enabled?: boolean; resend_policy?: string;
}): Promise<ReplayRow | null> {
  const r = await db.query<Record<string, unknown>>(
    `update replay_sessions set
       status = coalesce($2, status), speed = coalesce($3::int, speed),
       telegram_enabled = coalesce($4::boolean, telegram_enabled), resend_policy = coalesce($5, resend_policy),
       updated_at = now()
     where id=$1 returning ${REPLAY_COLS}`,
    [id, patch.status ?? null, patch.speed ?? null, patch.telegram_enabled ?? null, patch.resend_policy ?? null]);
  return r[0] ? mapReplay(r[0]) : null;
}
/** Optimistic-lock advance: succeeds only if nobody else moved the cursor since `expected`. */
export async function advanceReplayCursor(db: Db, id: string, expected: number | null, next: number, processed: number,
  state: Record<string, unknown>, finished: boolean): Promise<ReplayRow | null> {
  const r = await db.query<Record<string, unknown>>(
    `update replay_sessions set cursor_time = $3::timestamptz, candles_processed = candles_processed + $4,
       strategy_state = $5::jsonb, status = case when $6::boolean then 'finished' else status end, updated_at = now()
     where id = $1 and cursor_time is not distinct from $2::timestamptz returning ${REPLAY_COLS}`,
    [id, iso(expected), iso(next), processed, JSON.stringify(state), finished]);
  return r[0] ? mapReplay(r[0]) : null;
}
export async function resetReplay(db: Db, id: string, initialCursor: number | null, newRun: boolean): Promise<ReplayRow | null> {
  const r = await db.query<Record<string, unknown>>(
    `update replay_sessions set cursor_time = $2::timestamptz, status='ready', candles_processed=0, strategy_state='{}'::jsonb,
       run_number = run_number + case when $3::boolean then 1 else 0 end, updated_at = now()
     where id=$1 returning ${REPLAY_COLS}`, [id, iso(initialCursor), newRun]);
  return r[0] ? mapReplay(r[0]) : null;
}

// ------------------------------------------------------------------- events
export interface NewEvent {
  mode: Mode; eventUid: string; dedupeKey: string; instrumentId: string; timeframe: Timeframe; eventType: EventType;
  eventTime: number; price: number; zoneLow: number | null; zoneHigh: number | null; zoneKind: string | null; zoneId: string | null;
  strategyVersionId: string | null; strategyLabel: string; source: 'tradingview_webhook' | 'replay_engine' | 'tradingview_csv';
  replaySessionId: string | null; runNumber: number | null; confirmations: Record<string, unknown>; payload: Record<string, unknown>; isTest: boolean;
  backtestSessionId?: string | null;
}
/** Returns the id when inserted, null when the dedupe key already existed. */
export async function insertEvent(db: Db, e: NewEvent): Promise<string | null> {
  const r = await db.query<{ id: string }>(
    `insert into market_events (mode, event_uid, dedupe_key, instrument_id, timeframe, event_type, event_time, price, zone_low, zone_high, zone_kind,
       zone_id, strategy_version_id, strategy_version_label, source, replay_session_id, run_number, confirmations, payload, is_test, backtest_session_id)
     values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21)
     on conflict (dedupe_key) do nothing returning id`,
    [e.mode, e.eventUid, e.dedupeKey, e.instrumentId, e.timeframe, e.eventType, iso(e.eventTime), e.price, e.zoneLow, e.zoneHigh,
      e.zoneKind, e.zoneId, e.strategyVersionId, e.strategyLabel, e.source, e.replaySessionId, e.runNumber,
      JSON.stringify(e.confirmations), JSON.stringify(e.payload), e.isTest, e.backtestSessionId ?? null]);
  return r[0]?.id ?? null;
}

/** Bulk insert (chunks of 200). Returns dedupe_key → id for rows actually inserted. */
export async function insertEventsBulk(db: Db, events: NewEvent[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < events.length; i += 200) {
    const chunk = events.slice(i, i + 200);
    const params: unknown[] = [];
    const rows = chunk.map((e) => {
      const b = params.length;
      params.push(e.mode, e.eventUid, e.dedupeKey, e.instrumentId, e.timeframe, e.eventType, iso(e.eventTime), e.price, e.zoneLow, e.zoneHigh,
        e.zoneKind, e.zoneId, e.strategyVersionId, e.strategyLabel, e.source, e.replaySessionId, e.runNumber,
        JSON.stringify(e.confirmations), JSON.stringify(e.payload), e.isTest, e.backtestSessionId ?? null);
      const p = (k: number) => `$${b + k}`;
      return `(${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)}::timestamptz,${p(8)},${p(9)},${p(10)},${p(11)},${p(12)}::uuid,${p(13)}::uuid,${p(14)},${p(15)},${p(16)}::uuid,${p(17)}::int,${p(18)}::jsonb,${p(19)}::jsonb,${p(20)}::boolean,${p(21)}::uuid)`;
    });
    const r = await db.query<{ id: string; dedupe_key: string }>(
      `insert into market_events (mode, event_uid, dedupe_key, instrument_id, timeframe, event_type, event_time, price, zone_low, zone_high, zone_kind,
         zone_id, strategy_version_id, strategy_version_label, source, replay_session_id, run_number, confirmations, payload, is_test, backtest_session_id)
       values ${rows.join(',')} on conflict (dedupe_key) do nothing returning id, dedupe_key`, params);
    for (const x of r) out.set(x.dedupe_key, x.id);
  }
  return out;
}

export interface EventRow {
  id: string; mode: Mode; event_type: EventType; timeframe: Timeframe; event_time: number; price: number;
  zone_low: number | null; zone_high: number | null; zone_kind: string | null; source: string; strategy_version_label: string;
  confirmations: Record<string, string>; replay_session_id: string | null; is_test: boolean;
}
const EVENT_COLS = `id, mode, event_type, timeframe, extract(epoch from event_time)*1000 as et, price::float8 as price,
  zone_low::float8 as zone_low, zone_high::float8 as zone_high, zone_kind, source, strategy_version_label, confirmations, replay_session_id, is_test`;
const mapEvent = (r: Record<string, unknown>): EventRow => ({
  id: String(r.id), mode: r.mode as Mode, event_type: r.event_type as EventType, timeframe: r.timeframe as Timeframe,
  event_time: Number(r.et), price: Number(r.price), zone_low: toNum(r.zone_low), zone_high: toNum(r.zone_high),
  zone_kind: (r.zone_kind as string) ?? null, source: String(r.source), strategy_version_label: String(r.strategy_version_label),
  confirmations: (r.confirmations as Record<string, string>) ?? {}, replay_session_id: (r.replay_session_id as string) ?? null, is_test: Boolean(r.is_test),
});
export async function listEvents(db: Db, opts: { mode?: Mode; replaySessionId?: string; upTo?: number; limit?: number }): Promise<EventRow[]> {
  const r = await db.query<Record<string, unknown>>(
    `select ${EVENT_COLS} from market_events
     where ($1::text is null or mode = $1) and ($2::uuid is null or replay_session_id = $2::uuid)
       and ($3::timestamptz is null or event_time <= $3::timestamptz)
     order by event_time desc limit $4`,
    [opts.mode ?? null, opts.replaySessionId ?? null, iso(opts.upTo ?? null), opts.limit ?? 100]);
  return r.map(mapEvent);
}
export async function countEvents(db: Db) {
  const r = await db.query<{ mode: Mode; n: number }>(`select mode, count(*)::int as n from market_events group by mode`);
  return Object.fromEntries(r.map((x) => [x.mode, Number(x.n)])) as Partial<Record<Mode, number>>;
}

// --------------------------------------------------------------------- news
const ECON_COLS = `id, provider, title, category, currency, impact, extract(epoch from scheduled_at)*1000 as s_ms,
  extract(epoch from schedule_available_at)*1000 as sa_ms, forecast::float8 as forecast, previous::float8 as previous,
  actual::float8 as actual, extract(epoch from actual_available_at)*1000 as aa_ms, source_url, unit, is_test`;
export const mapEcon = (r: Record<string, unknown>): EconomicEventRecord & { unit: string | null; isTest: boolean } => ({
  id: String(r.id), provider: String(r.provider), title: String(r.title), category: r.category as NewsCategory,
  currency: (r.currency as string) ?? null, impact: r.impact as EconomicEventRecord['impact'],
  scheduledAt: Number(r.s_ms), scheduleAvailableAt: toNum(r.sa_ms), forecast: toNum(r.forecast), previous: toNum(r.previous),
  actual: toNum(r.actual), actualAvailableAt: toNum(r.aa_ms), sourceUrl: (r.source_url as string) ?? null,
  unit: (r.unit as string) ?? null, isTest: Boolean(r.is_test),
});
/** Raw rows in a window. Callers MUST pass them through eventAsOf() before showing them for a replay time. */
export async function economicEventsInWindow(db: Db, from: number, to: number) {
  const r = await db.query<Record<string, unknown>>(
    `select ${ECON_COLS} from economic_events where scheduled_at between $1::timestamptz and $2::timestamptz order by scheduled_at`,
    [iso(from), iso(to)]);
  return r.map(mapEcon);
}
export async function economicEventsByIds(db: Db, ids: string[]) {
  if (!ids.length) return [];
  const r = await db.query<Record<string, unknown>>(`select ${ECON_COLS} from economic_events where id = any($1::uuid[])`, [ids]);
  return r.map(mapEcon);
}
export async function newsArchiveCoverage(db: Db, at: number, marginDays = 7): Promise<boolean> {
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from (
       select 1 from economic_events where scheduled_at between $1::timestamptz - ($2 || ' days')::interval and $1::timestamptz + ($2 || ' days')::interval
       union all
       select 1 from news_articles where published_at between $1::timestamptz - ($2 || ' days')::interval and $1::timestamptz + ($2 || ' days')::interval
       limit 1) x`, [iso(at), String(marginDays)]);
  return Number(r[0]?.n ?? 0) > 0;
}
export async function articlesAvailableInWindow(db: Db, from: number, asOf: number) {
  const r = await db.query<Record<string, unknown>>(
    `select id, provider, title, source_name, category, url, summary, is_test,
            extract(epoch from published_at)*1000 as p_ms, extract(epoch from available_at)*1000 as a_ms
     from news_articles where available_at > $1::timestamptz and available_at <= $2::timestamptz order by available_at desc limit 200`,
    [iso(from), iso(asOf)]);
  return r.map((x) => ({
    id: String(x.id), provider: String(x.provider), title: String(x.title), sourceName: String(x.source_name),
    category: x.category as NewsCategory, url: (x.url as string) ?? null, summary: (x.summary as string) ?? null,
    publishedAt: Number(x.p_ms), availableAt: Number(x.a_ms), isTest: Boolean(x.is_test),
  }));
}
export async function upsertEconomicEvent(db: Db, e: {
  provider: string; externalId: string; title: string; category: NewsCategory; currency: string | null; impact: string;
  scheduledAt: number; scheduleAvailableAt: number | null; forecast: number | null; previous: number | null; actual: number | null;
  actualAvailableAt: number | null; unit: string | null; sourceUrl: string | null; isTest: boolean;
}): Promise<{ id: string; inserted: boolean }> {
  const r = await db.query<{ id: string; inserted: boolean }>(
    `insert into economic_events (provider, external_id, title, category, currency, impact, scheduled_at, schedule_available_at,
        forecast, previous, actual, actual_available_at, unit, source_url, is_test)
     values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11,$12::timestamptz,$13,$14,$15)
     on conflict (provider, external_id) do update set title=excluded.title, category=excluded.category, currency=excluded.currency,
        impact=excluded.impact, scheduled_at=excluded.scheduled_at, schedule_available_at=excluded.schedule_available_at,
        forecast=excluded.forecast, previous=excluded.previous, actual=excluded.actual, actual_available_at=excluded.actual_available_at,
        unit=excluded.unit, source_url=excluded.source_url
     returning id, (xmax = 0) as inserted`,
    [e.provider, e.externalId, e.title, e.category, e.currency, e.impact, iso(e.scheduledAt), iso(e.scheduleAvailableAt),
      e.forecast, e.previous, e.actual, iso(e.actualAvailableAt), e.unit, e.sourceUrl, e.isTest]);
  return { id: r[0].id, inserted: Boolean(r[0].inserted) };
}
export async function upsertArticle(db: Db, a: {
  provider: string; externalId: string; title: string; sourceName: string; category: NewsCategory; publishedAt: number;
  firstSeenAt: number | null; url: string | null; summary: string | null; isTest: boolean;
}) {
  const r = await db.query<{ id: string }>(
    `insert into news_articles (provider, external_id, title, source_name, category, published_at, first_seen_at, url, summary, is_test)
     values ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10)
     on conflict (provider, external_id) do update set title=excluded.title, category=excluded.category, url=excluded.url, summary=excluded.summary
     returning id`,
    [a.provider, a.externalId, a.title, a.sourceName, a.category, iso(a.publishedAt), iso(a.firstSeenAt), a.url, a.summary, a.isTest]);
  return r[0].id;
}
export async function upsertSentiment(db: Db, s: { economicEventId: string; label: string; confidence: number | null; reasoning: string; method: string; availableAt: number }) {
  await db.query(
    `insert into sentiment_analyses (economic_event_id, label, confidence, reasoning, method, available_at)
     values ($1,$2,$3,$4,$5,$6::timestamptz)
     on conflict (economic_event_id, method) where economic_event_id is not null
     do update set label=excluded.label, confidence=excluded.confidence, reasoning=excluded.reasoning, available_at=excluded.available_at
     returning id`,
    [s.economicEventId, s.label, s.confidence, s.reasoning, s.method, iso(s.availableAt)]);
}
export async function sentimentsFor(db: Db, econIds: string[]) {
  if (!econIds.length) return new Map<string, { label: string; confidence: number | null; reasoning: string; availableAt: number }>();
  const r = await db.query<Record<string, unknown>>(
    `select economic_event_id, label, confidence::float8 as confidence, reasoning, extract(epoch from available_at)*1000 as a_ms
     from sentiment_analyses where economic_event_id = any($1::uuid[])`, [econIds]);
  return new Map(r.map((x) => [String(x.economic_event_id), {
    label: String(x.label), confidence: toNum(x.confidence), reasoning: String(x.reasoning), availableAt: Number(x.a_ms),
  }]));
}
export async function linkEventNews(db: Db, marketEventId: string, item: { kind: 'economic' | 'article'; id: string; availableAt: number }, eventTime: number) {
  await db.query(
    `insert into event_news_links (market_event_id, economic_event_id, news_article_id, info_available_at, time_delta_seconds)
     values ($1, $2, $3, $4::timestamptz, $5) on conflict do nothing returning id`,
    [marketEventId, item.kind === 'economic' ? item.id : null, item.kind === 'article' ? item.id : null, iso(item.availableAt),
      Math.round((eventTime - item.availableAt) / 1000)]);
}

// ----------------------------------------------------------------- telegram
export interface TelegramSettingsRow {
  chat_id: string | null; bot_token_encrypted: string | null; bot_token_hint: string | null; live_enabled: boolean; backtest_enabled: boolean;
  cooldown_seconds: number; max_per_minute: number; last_test_at: number | null; last_test_ok: boolean | null; last_test_error: string | null;
}
export async function getTelegramSettings(db: Db): Promise<TelegramSettingsRow> {
  const r = await db.query<Record<string, unknown>>(
    `select chat_id, bot_token_encrypted, bot_token_hint, live_enabled, backtest_enabled, cooldown_seconds, max_per_minute,
            extract(epoch from last_test_at)*1000 as lt, last_test_ok, last_test_error from telegram_settings where id = 1`);
  const x = r[0] ?? {};
  return {
    chat_id: (x.chat_id as string) ?? null, bot_token_encrypted: (x.bot_token_encrypted as string) ?? null,
    bot_token_hint: (x.bot_token_hint as string) ?? null, live_enabled: Boolean(x.live_enabled), backtest_enabled: Boolean(x.backtest_enabled),
    cooldown_seconds: Number(x.cooldown_seconds ?? 300), max_per_minute: Number(x.max_per_minute ?? 20),
    last_test_at: toNum(x.lt), last_test_ok: (x.last_test_ok as boolean) ?? null, last_test_error: (x.last_test_error as string) ?? null,
  };
}
export async function updateTelegramSettings(db: Db, p: Partial<{
  chat_id: string | null; bot_token_encrypted: string | null; bot_token_hint: string | null; live_enabled: boolean;
  backtest_enabled: boolean; cooldown_seconds: number; max_per_minute: number; last_test_ok: boolean; last_test_error: string | null;
}>) {
  const ALLOWED = ['chat_id', 'bot_token_encrypted', 'bot_token_hint', 'live_enabled', 'backtest_enabled', 'cooldown_seconds', 'max_per_minute', 'last_test_ok', 'last_test_error'];
  const keys = (Object.keys(p) as (keyof typeof p)[]).filter((k) => ALLOWED.includes(k) && p[k] !== undefined);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  if ('last_test_ok' in p) sets.push('last_test_at = now()');
  await db.query(`update telegram_settings set ${sets.join(', ')}, updated_at = now() where id = 1 returning id`, keys.map((k) => p[k]));
}

/** Claims a delivery slot. Returns the log id, or null if this key was already delivered/in-flight. */
export async function claimDelivery(db: Db, v: { key: string; mode: string; marketEventId: string | null; replaySessionId: string | null; text: string; allowRetryFailed: boolean }): Promise<string | null> {
  const r = await db.query<{ id: string }>(
    `insert into telegram_delivery_logs (delivery_key, mode, market_event_id, replay_session_id, status, message_text)
     values ($1,$2,$3,$4,'pending',$5) on conflict (delivery_key) do nothing returning id`,
    [v.key, v.mode, v.marketEventId, v.replaySessionId, v.text]);
  if (r[0]) return r[0].id;
  if (!v.allowRetryFailed) return null;
  const r2 = await db.query<{ id: string }>(
    `update telegram_delivery_logs set status='pending', updated_at=now() where delivery_key=$1 and status='failed' returning id`, [v.key]);
  return r2[0]?.id ?? null;
}
export async function finishDelivery(db: Db, id: string, v: { status: 'sent' | 'failed' | 'skipped'; attempts: number; httpStatus: number | null; messageId: number | null; error: string | null; skipReason?: string | null }) {
  await db.query(
    `update telegram_delivery_logs set status=$2, attempts=attempts+$3, http_status=$4, telegram_message_id=$5, error=$6, skip_reason=$7,
       sent_at = case when $2='sent' then now() else sent_at end, updated_at=now() where id=$1 returning id`,
    [id, v.status, v.attempts, v.httpStatus, v.messageId, v.error, v.skipReason ?? null]);
}
export async function sentInLastMinute(db: Db): Promise<number> {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from telegram_delivery_logs where status='sent' and sent_at > now() - interval '1 minute'`);
  return Number(r[0]?.n ?? 0);
}
/** Cooldown in MARKET time: was an equivalent event (same type + zone) already sent within `seconds` before eventTime? */
export async function recentlySentSimilar(db: Db, v: { mode: Mode; replaySessionId: string | null; eventType: string; zoneLow: number | null; zoneHigh: number | null; eventTime: number; seconds: number; excludeEventId: string }) {
  if (v.seconds <= 0) return false;
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from telegram_delivery_logs d join market_events e on e.id = d.market_event_id
     where d.status = 'sent' and e.mode = $1 and e.replay_session_id is not distinct from $2::uuid and e.event_type = $3
       and e.zone_low is not distinct from $4::numeric and e.zone_high is not distinct from $5::numeric
       and e.event_time > $6::timestamptz - ($7 || ' seconds')::interval and e.event_time <= $6::timestamptz and e.id <> $8::uuid`,
    [v.mode, v.replaySessionId, v.eventType, v.zoneLow, v.zoneHigh, iso(v.eventTime), String(v.seconds), v.excludeEventId]);
  return Number(r[0]?.n ?? 0) > 0;
}
export async function listDeliveries(db: Db, limit = 50) {
  return db.query<Record<string, unknown>>(
    `select id, delivery_key, mode, status, skip_reason, attempts, http_status, telegram_message_id::text as telegram_message_id, error,
            created_at, sent_at, market_event_id, replay_session_id from telegram_delivery_logs order by created_at desc limit $1`, [limit]);
}

// ------------------------------------------------------------------ webhook
export async function logWebhook(db: Db, v: { ip: string | null; status: string; http: number; eventUid: string | null; marketEventId: string | null; error: string | null; payload: unknown }) {
  await db.query(
    `insert into tradingview_webhook_logs (remote_ip, status, http_status, event_uid, market_event_id, error, payload)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb) returning id`,
    [v.ip, v.status, v.http, v.eventUid, v.marketEventId, v.error?.slice(0, 2000) ?? null, JSON.stringify(v.payload ?? null)]);
}
export async function webhookHitsLastMinute(db: Db, ip: string | null): Promise<number> {
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from tradingview_webhook_logs where remote_ip is not distinct from $1 and received_at > now() - interval '1 minute'`, [ip]);
  return Number(r[0]?.n ?? 0);
}
export async function lastWebhook(db: Db) {
  const r = await db.query<Record<string, unknown>>(
    `select status, http_status, error, received_at, event_uid from tradingview_webhook_logs order by received_at desc limit 1`);
  return r[0] ?? null;
}
export async function listWebhookLogs(db: Db, limit = 30) {
  return db.query<Record<string, unknown>>(
    `select id, received_at, remote_ip, status, http_status, event_uid, error from tradingview_webhook_logs order by received_at desc limit $1`, [limit]);
}

// ------------------------------------------------------------------- trades
export async function listTrades(db: Db, backtestSessionId: string | string[] | null, opts: { light?: boolean } = {}) {
  const ids = backtestSessionId == null ? null : Array.isArray(backtestSessionId) ? backtestSessionId : [backtestSessionId];
  return db.query<Record<string, unknown>>(
    opts.light
      ? `select id, side, extract(epoch from entry_time)*1000 as entry_ms, extract(epoch from exit_time)*1000 as exit_ms, exit_reason,
            pnl::float8 as pnl, pnl_r::float8 as pnl_r, planned_rr::float8 as planned_rr, timeframe, session_label, news_confirmed, zone_outcome
     from simulated_trades where ($1::uuid[] is null or backtest_session_id = any($1::uuid[])) order by entry_time asc limit 50000`
      : `select id, backtest_session_id, origin, side, timeframe, extract(epoch from entry_time)*1000 as entry_ms, entry_price::float8 as entry_price,
            stop_loss::float8 as stop_loss, take_profit::float8 as take_profit, extract(epoch from exit_time)*1000 as exit_ms,
            exit_price::float8 as exit_price, exit_reason, pnl::float8 as pnl, pnl_r::float8 as pnl_r, planned_rr::float8 as planned_rr,
            session_label, news_confirmed, sentiment_confirmed, zone_outcome, setup_reason, costs, is_test, entry_event_id, strategy_version_id
     from simulated_trades where ($1::uuid[] is null or backtest_session_id = any($1::uuid[])) order by entry_time asc limit 50000`,
    [ids]);
}
export async function listBacktestSessions(db: Db) {
  return db.query<Record<string, unknown>>(
    `select b.id, b.name, b.confirmation_profile, b.status, b.timeframe, b.period_start, b.period_end, b.is_test, b.cost_config,
            extract(epoch from b.created_at)*1000 as created_ms,
            sv.strategy_key || ' ' || sv.version as strategy,
            coalesce(a.trades, 0) as trades, coalesce(a.pnl, 0) as pnl, coalesce(a.wins, 0) as wins, coalesce(a.losses, 0) as losses
     from backtest_sessions b
     left join strategy_versions sv on sv.id=b.strategy_version_id
     left join (select backtest_session_id, count(*)::int as trades, coalesce(sum(pnl), 0)::float8 as pnl,
                       count(*) filter (where pnl > 0)::int as wins, count(*) filter (where pnl < 0)::int as losses
                from simulated_trades group by backtest_session_id) a on a.backtest_session_id = b.id
     order by b.created_at desc`);
}
/** Deletes backtest sessions with their trades and the signal events they produced. Returns deleted ids. */
export async function deleteBacktestSessions(db: Db, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  await db.query('delete from market_events where backtest_session_id = any($1::uuid[]) returning id', [ids]);
  const r = await db.query<{ id: string }>('delete from backtest_sessions where id = any($1::uuid[]) returning id', [ids]);
  return r.map((x) => x.id);
}
export async function insertTrade(db: Db, t: Record<string, unknown>) {
  const cols = Object.keys(t);
  const r = await db.query<{ id: string }>(
    `insert into simulated_trades (${cols.join(',')}) values (${cols.map((c, i) => (/_time$/.test(c) ? `$${i + 1}::timestamptz` : /(reason|costs)$/.test(c) && c !== 'exit_reason' ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(',')}) returning id`,
    cols.map((c) => (/_time$/.test(c) ? iso(t[c] as number) : (c === 'setup_reason' || c === 'costs') ? JSON.stringify(t[c]) : t[c])));
  return r[0].id;
}
const TRADE_COLS = ['backtest_session_id', 'strategy_version_id', 'entry_event_id', 'origin', 'side', 'timeframe', 'entry_time', 'entry_price',
  'stop_loss', 'take_profit', 'exit_time', 'exit_price', 'exit_reason', 'pnl', 'pnl_r', 'planned_rr', 'session_label', 'news_confirmed',
  'sentiment_confirmed', 'zone_outcome', 'setup_reason', 'costs', 'is_test'] as const;
const TRADE_CAST: Record<string, string> = { entry_time: '::timestamptz', exit_time: '::timestamptz', setup_reason: '::jsonb', costs: '::jsonb',
  backtest_session_id: '::uuid', strategy_version_id: '::uuid', entry_event_id: '::uuid', news_confirmed: '::boolean', sentiment_confirmed: '::boolean', is_test: '::boolean',
  entry_price: '::numeric', stop_loss: '::numeric', take_profit: '::numeric', exit_price: '::numeric', pnl: '::numeric', pnl_r: '::numeric', planned_rr: '::numeric' };
export type TradeInsert = { [K in (typeof TRADE_COLS)[number]]: unknown };
export async function insertTradesBulk(db: Db, trades: TradeInsert[]) {
  let n = 0;
  for (let i = 0; i < trades.length; i += 200) {
    const chunk = trades.slice(i, i + 200);
    const params: unknown[] = [];
    const rows = chunk.map((t) => `(${TRADE_COLS.map((c) => {
      const v = t[c];
      params.push(c.endsWith('_time') ? iso(v as number | null) : (c === 'setup_reason' || c === 'costs') ? JSON.stringify(v ?? {}) : v ?? null);
      return `$${params.length}${TRADE_CAST[c] ?? ''}`;
    }).join(',')})`);
    await db.query(`insert into simulated_trades (${TRADE_COLS.join(',')}) values ${rows.join(',')} returning id`, params);
    n += chunk.length;
  }
  return n;
}
export async function finishBacktestSession(db: Db, id: string, v: { periodStart: number; periodEnd: number; status: 'completed' | 'failed'; notes?: string | null }) {
  await db.query(`update backtest_sessions set period_start=$2::timestamptz, period_end=$3::timestamptz, status=$4, completed_at=now(),
    notes = coalesce($5, notes) where id=$1 returning id`, [id, iso(v.periodStart), iso(v.periodEnd), v.status, v.notes ?? null]);
}
export async function createBacktestSession(db: Db, v: { name: string; strategyVersionId: string | null; sourceId: string | null; instrumentId: string; timeframe: string | null; profile: string; costConfig: unknown; isTest: boolean; notes: string | null }) {
  const r = await db.query<{ id: string }>(
    `insert into backtest_sessions (name, strategy_version_id, source_id, instrument_id, timeframe, confirmation_profile, cost_config, is_test, notes, status)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,'completed') returning id`,
    [v.name, v.strategyVersionId, v.sourceId, v.instrumentId, v.timeframe, v.profile, JSON.stringify(v.costConfig ?? {}), v.isTest, v.notes]);
  return r[0].id;
}
