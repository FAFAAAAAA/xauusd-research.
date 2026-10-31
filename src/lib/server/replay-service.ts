import type { Db } from './db';
import { HttpError } from './db';
import * as repo from './repo';
import { getConfig } from './config';
import { loadNewsWindow, snapshotAt, summarizeNews } from './news-service';
import { sendTelegram, type FetchLike, type SendResult } from './telegram';
import { getAdapter } from '../core/strategy/registry';
import { runStrategyGuarded } from '../core/strategy/adapter';
import { buildEventMessage } from '../core/telegram-format';
import { SNR_KEY, computeSnrView, readParams } from '../core/strategy/snr';
import { NOT_CONFIGURED, TIMEFRAME_MS, type Candle, type Timeframe } from '../core/types';

export const MAX_STEP = 50;
const HISTORY_WINDOW = 500;
const HTF_WINDOW = 400;

export async function createReplaySession(db: Db, v: {
  sourceId: string; timeframe: Timeframe; startTime: number; strategyVersionId?: string | null;
  params?: Record<string, unknown>; resendPolicy?: 'never' | 'new_run';
}) {
  const instrumentId = await repo.getInstrumentId(db);
  const sources = await repo.listSources(db);
  const source = sources.find((s) => s.id === v.sourceId);
  if (!source) throw new HttpError(404, 'Sumber data tidak ditemukan');
  const first = await repo.candlesAfter(db, v.sourceId, v.timeframe, v.startTime - 1, 1);
  if (!first.length) throw new HttpError(422, 'Tidak ada candle pada/ setelah waktu mulai untuk sumber & timeframe ini');
  await repo.ensureBuiltinStrategies(db);
  const sv = v.strategyVersionId ? await repo.getStrategyVersion(db, v.strategyVersionId) : await repo.defaultStrategyVersion(db);
  const adapter = getAdapter(sv?.adapter_key);
  for (const t of adapter.requiredTimeframes ?? []) {
    if (!(await repo.hasCandles(db, v.sourceId, t))) {
      throw new HttpError(422, `Strategi ini butuh data ${t}. Buka Atur → Data harga → tekan "Bentuk H1, H4 & D1" dulu.`);
    }
  }
  let params = v.params ?? {};
  if (adapter.key === 'custom_v1' && sv) params = { definition: await repo.strategyDefinition(db, sv.id) };
  // Candles strictly before the start are history (visible, not processed). Processing begins at the start candle.
  const initialCursor = await repo.lastCandleBefore(db, v.sourceId, v.timeframe, v.startTime);
  return repo.insertReplay(db, {
    sourceId: v.sourceId, instrumentId, strategyVersionId: sv?.id ?? null, timeframe: v.timeframe, startTime: v.startTime,
    cursorTime: initialCursor, resendPolicy: v.resendPolicy ?? 'never', params,
    isTest: source.is_test || !!sv?.is_test,
  });
}

export interface StepOutcome {
  session: repo.ReplayRow;
  revealed: Candle[];
  events: Array<repo.EventRow & { telegram?: SendResult | { status: 'not_requested' | 'cooldown' } }>;
  strategy: { configured: boolean; name: string; label: string; testOnly: boolean };
  violations: string[];
  conflict: boolean;
  marketTime: number | null;
}

/**
 * Advance the replay by `count` closed candles.
 * - Rejected while paused/ready unless `manual` (the "Next Candle" button).
 * - Only candles up to the new cursor are ever returned (future stays hidden).
 * - Events are deduplicated by (session, run, strategy, type, candle, zone).
 */
export async function stepReplay(db: Db, sessionId: string, opts: { count: number; manual: boolean; expectedCursor?: number | null; fetchImpl?: FetchLike }): Promise<StepOutcome> {
  const s = await repo.getReplay(db, sessionId);
  if (!s) throw new HttpError(404, 'Replay session tidak ditemukan');
  const sv = await repo.getStrategyVersion(db, s.strategy_version_id);
  const adapter = getAdapter(sv?.adapter_key);
  const strategy = { configured: adapter.configured, name: adapter.name, label: sv ? `${sv.strategy_key} ${sv.version}` : 'none', testOnly: adapter.testOnly };
  const base = { strategy, violations: [] as string[] };

  if (s.status === 'finished') return { ...base, session: s, revealed: [], events: [], conflict: false, marketTime: closeTime(s.cursor_time, s.timeframe) };
  if (!opts.manual && s.status !== 'playing') throw new HttpError(409, `Replay sedang ${s.status}; tekan Play atau Next Candle`);
  if (opts.expectedCursor !== undefined && opts.expectedCursor !== s.cursor_time) {
    return { ...base, session: s, revealed: [], events: [], conflict: true, marketTime: closeTime(s.cursor_time, s.timeframe) };
  }

  const count = Math.max(1, Math.min(MAX_STEP, Math.floor(opts.count)));
  const next = await repo.candlesAfter(db, s.source_id, s.timeframe, s.cursor_time, count + 1);
  const batch = next.slice(0, count);
  const finished = next.length <= count;
  if (!batch.length) {
    const done = await repo.advanceReplayCursor(db, s.id, s.cursor_time, s.cursor_time ?? s.start_time, 0, s.strategy_state, true);
    return { ...base, session: done ?? s, revealed: [], events: [], conflict: !done, marketTime: closeTime(s.cursor_time, s.timeframe) };
  }

  const tfMs = TIMEFRAME_MS[s.timeframe];
  const lastClose = batch[batch.length - 1].time + tfMs;
  const history = s.cursor_time != null ? await repo.candlesUpTo(db, s.source_id, s.timeframe, s.cursor_time, HISTORY_WINDOW) : [];
  const news = await loadNewsWindow(db, batch[0].time, lastClose);
  const tg = await repo.getTelegramSettings(db);
  const cfg = getConfig();
  const tz = await repo.getAppSetting<string>(db, 'display_timezone', 'UTC');

  const htfList = adapter.requiredTimeframes ?? [];
  const htfAll: Partial<Record<Timeframe, Candle[]>> = {};
  const winOf = (t: Timeframe) => adapter.htfWindow?.[t] ?? HTF_WINDOW;
  for (const t of htfList) htfAll[t] = await repo.candlesUpTo(db, s.source_id, t, lastClose - 1, winOf(t) + 50);

  const state = { ...s.strategy_state };
  const violations: string[] = [];
  const window: Candle[] = history.slice();
  const created: StepOutcome['events'] = [];

  for (const c of batch) {
    window.push(c);
    if (window.length > HISTORY_WINDOW) window.shift();
    const now = c.time + tfMs; // event becomes known at candle CLOSE
    if (!adapter.configured || window.length < adapter.warmupCandles) continue;
    const zones = await repo.zonesAsOf(db, s.instrument_id, 'BACKTEST', now, s.id);
    const snap = snapshotAt(news, now);
    let htf: Partial<Record<Timeframe, readonly Candle[]>> | undefined;
    if (htfList.length) {
      htf = {};
      for (const t of htfList) {
        const closed = htfAll[t]!.filter((h) => h.time + TIMEFRAME_MS[t] <= now);
        htf[t] = closed.slice(-winOf(t));
      }
    }
    const res = runStrategyGuarded(adapter, {
      mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: s.timeframe, candles: window, now, zones, news: snap,
      htf, params: s.strategy_params, state,
    });
    violations.push(...res.violations);
    const newsSummary = summarizeNews(snap);
    for (const ev of res.events) {
      const zoneKey = ev.details?.slot ? String(ev.details.slot) : ev.zone ? `${ev.zone.id ?? ''}${ev.zone.low}-${ev.zone.high}` : 'nozone';
      const runPart = s.resend_policy === 'new_run' ? `r${s.run_number}` : 'r*';
      const uid = `${ev.type}:${ev.candleTime}:${zoneKey}`;
      const confirmations = {
        trend: ev.confirmations?.trend ?? NOT_CONFIGURED,
        momentum: ev.confirmations?.momentum ?? NOT_CONFIGURED,
        news: ev.confirmations?.news ?? newsSummary.news,
        sentiment: ev.confirmations?.sentiment ?? newsSummary.sentiment,
      };
      const id = await repo.insertEvent(db, {
        mode: 'BACKTEST', eventUid: uid, dedupeKey: `bt:${s.id}:${runPart}:${sv?.id ?? 'none'}:${uid}`,
        instrumentId: s.instrument_id, timeframe: s.timeframe, eventType: ev.type, eventTime: now, price: ev.price,
        zoneLow: ev.zone?.low ?? null, zoneHigh: ev.zone?.high ?? null, zoneKind: ev.zone?.kind ?? null, zoneId: ev.zone?.id ?? null,
        strategyVersionId: sv?.id ?? null, strategyLabel: strategy.label, source: 'replay_engine', replaySessionId: s.id,
        runNumber: s.run_number, confirmations, payload: { status: ev.status ?? null, details: ev.details ?? {}, candle_open_time: ev.candleTime },
        isTest: s.is_test || adapter.testOnly,
      });
      if (!id) continue; // duplicate → never re-notify
      for (const item of snap.items) await repo.linkEventNews(db, id, item, now);

      const row: StepOutcome['events'][number] = {
        id, mode: 'BACKTEST', event_type: ev.type, timeframe: s.timeframe, event_time: now, price: ev.price,
        zone_low: ev.zone?.low ?? null, zone_high: ev.zone?.high ?? null, zone_kind: ev.zone?.kind ?? null, source: 'replay_engine',
        strategy_version_label: strategy.label, confirmations, replay_session_id: s.id, is_test: s.is_test || adapter.testOnly,
      };
      if (!(s.telegram_enabled && tg.backtest_enabled)) {
        row.telegram = { status: 'not_requested' };
      } else if (await repo.recentlySentSimilar(db, { mode: 'BACKTEST', replaySessionId: s.id, eventType: ev.type, zoneLow: row.zone_low, zoneHigh: row.zone_high, eventTime: now, seconds: tg.cooldown_seconds, excludeEventId: id })) {
        row.telegram = { status: 'cooldown' };
      } else {
        const msg = buildEventMessage({
          mode: 'BACKTEST', eventType: ev.type, timeframe: s.timeframe, eventTime: now, price: ev.price,
          zoneLow: row.zone_low, zoneHigh: row.zone_high, zoneKind: row.zone_kind, confirmations, status: ev.status ?? 'Event terdeteksi',
          displayTimezone: tz, replaySessionId: s.id, strategyLabel: strategy.label, isTest: row.is_test,
          linkUrl: cfg.appBaseUrl ? `${cfg.appBaseUrl}/replay?session=${s.id}` : null,
        });
        row.telegram = await sendTelegram(db, { deliveryKey: `bt-event:${id}`, mode: 'BACKTEST', marketEventId: id, replaySessionId: s.id, text: msg.text, button: msg.button }, { fetchImpl: opts.fetchImpl });
      }
      created.push(row);
    }
  }

  const newCursor = batch[batch.length - 1].time;
  const updated = await repo.advanceReplayCursor(db, s.id, s.cursor_time, newCursor, batch.length, state, finished);
  if (violations.length) await repo.logSystemError(db, 'replay.lookahead_guard', 'Strategy output dropped', { sessionId: s.id, violations });
  return {
    session: updated ?? (await repo.getReplay(db, s.id))!, revealed: updated ? batch : [], events: created, strategy,
    violations, conflict: !updated, marketTime: updated ? lastClose : closeTime(s.cursor_time, s.timeframe),
  };
}

function closeTime(cursor: number | null, tf: Timeframe) {
  return cursor == null ? null : cursor + TIMEFRAME_MS[tf];
}

export async function resetReplaySession(db: Db, id: string) {
  const s = await repo.getReplay(db, id);
  if (!s) throw new HttpError(404, 'Replay session tidak ditemukan');
  const initial = await repo.lastCandleBefore(db, s.source_id, s.timeframe, s.start_time);
  return repo.resetReplay(db, id, initial, s.resend_policy === 'new_run');
}

/** Visible history for the chart: never beyond the cursor. */
export async function visibleCandles(db: Db, id: string, limit = 1500) {
  const s = await repo.getReplay(db, id);
  if (!s) throw new HttpError(404, 'Replay session tidak ditemukan');
  if (s.cursor_time == null) return { session: s, candles: [] as Candle[] };
  return { session: s, candles: await repo.candlesUpTo(db, s.source_id, s.timeframe, s.cursor_time, Math.min(limit, 5000)) };
}

/** Current SNR picture (H4 trend + zones) as of the replay cursor — closed candles only. */
export async function replaySnrView(db: Db, id: string) {
  const s = await repo.getReplay(db, id);
  if (!s) throw new HttpError(404, 'Replay session tidak ditemukan');
  const sv = await repo.getStrategyVersion(db, s.strategy_version_id);
  if (sv?.adapter_key !== SNR_KEY) return { available: false as const, reason: 'Strategi replay ini bukan SNR H4/H1' };
  if (s.cursor_time == null) return { available: false as const, reason: 'Belum ada candle yang dibuka' };
  const now = s.cursor_time + TIMEFRAME_MS[s.timeframe];
  const closed = async (t: Timeframe) => (await repo.candlesUpTo(db, s.source_id, t, now - 1, HTF_WINDOW + 50))
    .filter((c) => c.time + TIMEFRAME_MS[t] <= now).slice(-HTF_WINDOW);
  const view = computeSnrView(await closed('H4'), await closed('H1'), readParams(s.strategy_params));
  const price = (await repo.candlesUpTo(db, s.source_id, s.timeframe, s.cursor_time, 1))[0]?.close ?? null;
  return { available: true as const, asOf: now, price, ...view };
}
