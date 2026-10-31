import type { Db } from './db';
import { HttpError } from './db';
import * as repo from './repo';
import { loadNewsWindow, snapshotAt, summarizeNews } from './news-service';
import { getAdapter } from '../core/strategy/registry';
import { runStrategyGuarded, type NewsSnapshot } from '../core/strategy/adapter';
import { simulateTrade, fillPrice, type CostConfig } from '../core/tradesim';
import { sessionOf } from '../core/time';
import { TIMEFRAME_MS, type Candle, type Timeframe } from '../core/types';

const DAY = 86_400_000;
export const MAX_RANGE_DAYS = 370;
const M15_WINDOW = 500;
const HTF_WINDOW = 400;
const WARMUP_M15 = 500;          // M15 candles before `from` used only as history
const HTF_WARMUP_DAYS = 120;     // H4/H1 history before `from` (pivots/trend need it)
const EXIT_TAIL_DAYS = 21;       // candles after `to` used only to resolve open trades
const MAX_ENTRY_GAP_MS = 60 * 60_000; // signal close → next open further apart (weekend) → skip, the setup is stale

export const BACKTEST_DEFAULT_COSTS: CostConfig = {
  spread: 0.30, slippage: 0.10, commissionPerUnit: 7, ambiguityPolicy: 'worst', contractSize: 100,
};

export interface BacktestInput {
  sourceId: string; from: number; to: number; strategyVersionId?: string | null;
  rrList?: number[]; costs?: Partial<CostConfig>; size?: number; name?: string | null;
  /** Strategy switches (e.g. breakout parts, allowSell). */
  params?: Record<string, unknown>;
  /** Fixed dollar risk per trade (entry→SL). When set, the lot is computed per trade; `size` is ignored. */
  riskUsd?: number | null;
}

const EMPTY_NEWS: NewsSnapshot = { archiveAvailable: false, items: [], upcoming: [] };

/**
 * Historical backtest of an M15 strategy that reads H1/H4.
 * Walks M15 candles in time order; at each candle CLOSE the strategy only sees closed M15/H1/H4 candles.
 * A SETUP_CONFIRMED event opens one trade per RR at the NEXT M15 open. One backtest session per RR.
 */
export async function runBacktest(db: Db, v: BacktestInput) {
  if (!(v.to > v.from)) throw new HttpError(422, 'Tanggal selesai harus setelah tanggal mulai');
  if (v.to - v.from > MAX_RANGE_DAYS * DAY) throw new HttpError(422, `Maksimal ${MAX_RANGE_DAYS} hari per run — jalankan per tahun`);
  const rrList = (v.rrList?.length ? v.rrList : [1, 2, 3]).filter((x) => x > 0 && x <= 20).slice(0, 5);
  const size = v.size && v.size > 0 ? v.size : 0.01;
  const riskUsd = v.riskUsd && v.riskUsd > 0 ? v.riskUsd : null;
  const costs: CostConfig = { ...BACKTEST_DEFAULT_COSTS, ...(v.costs ?? {}) };

  await repo.ensureBuiltinStrategies(db);
  const source = (await repo.listSources(db)).find((s) => s.id === v.sourceId);
  if (!source) throw new HttpError(404, 'Sumber data tidak ditemukan');
  const sv = v.strategyVersionId ? await repo.getStrategyVersion(db, v.strategyVersionId) : await repo.defaultStrategyVersion(db);
  const adapter = getAdapter(sv?.adapter_key);
  if (!sv || !adapter.configured) throw new HttpError(422, 'Strategi belum dikonfigurasi');
  const tf: Timeframe = 'M15';
  // custom strategies keep their rules in the database; they are passed to the adapter as params.definition
  let runParams: Record<string, unknown> = v.params ?? {};
  if (adapter.key === 'custom_v1') {
    const definition = await repo.strategyDefinition(db, sv.id);
    if (!definition) throw new HttpError(422, 'Definisi strategi tidak ditemukan');
    runParams = { definition };
  }
  const htfList = adapter.requiredTimeframes ?? [];
  for (const t of [tf, ...htfList]) {
    if (!(await repo.hasCandles(db, v.sourceId, t))) {
      throw new HttpError(422, `Data ${t} belum ada untuk sumber ini. Impor M15 lalu buka Atur → Data harga → tekan "Bentuk H1, H4 & D1".`);
    }
  }

  const tfMs = TIMEFRAME_MS[tf];
  const history = await repo.candlesUpTo(db, v.sourceId, tf, v.from - 1, WARMUP_M15);
  const body = await repo.candlesBetween(db, v.sourceId, tf, v.from, v.to + EXIT_TAIL_DAYS * DAY);
  const m15 = history.concat(body);
  const firstIdx = history.length;
  const signalEnd = v.to; // only candles with open_time < to may produce signals
  if (!body.length || body[0].time >= signalEnd) throw new HttpError(422, 'Tidak ada candle M15 pada rentang ini');

  const htf: Partial<Record<Timeframe, Candle[]>> = {};
  for (const t of htfList) {
    // enough closed history for the strategy's window (weekends ≈ ×1.5), at least HTF_WARMUP_DAYS
    const days = Math.max(HTF_WARMUP_DAYS, Math.ceil(((adapter.htfWindow?.[t] ?? HTF_WINDOW) * TIMEFRAME_MS[t] * 1.5) / DAY));
    htf[t] = await repo.candlesBetween(db, v.sourceId, t, v.from - days * DAY, v.to);
  }
  const ptr: Partial<Record<Timeframe, number>> = {};
  for (const t of htfList) ptr[t] = 0;

  const instrumentId = await repo.getInstrumentId(db);
  const label = `${sv.strategy_key} ${sv.version}`;
  const isTest = source.is_test || adapter.testOnly;
  const news = await loadNewsWindow(db, v.from, v.to);

  // ---- 1. walk candles, collect signals (pure; nothing persisted yet)
  const state: Record<string, unknown> = {};
  const signals: Array<{ i: number; now: number; ev: ReturnType<typeof runStrategyGuarded>['events'][number] }> = [];
  let nearCount = 0, violations = 0;
  for (let i = firstIdx; i < m15.length && m15[i].time < signalEnd; i++) {
    const now = m15[i].time + tfMs;
    const ctxHtf: Partial<Record<Timeframe, readonly Candle[]>> = {};
    for (const t of htfList) {
      const arr = htf[t]!;
      let p = ptr[t]!;
      while (p < arr.length && arr[p].time + TIMEFRAME_MS[t] <= now) p++; // closed HTF candles only
      ptr[t] = p;
      ctxHtf[t] = arr.slice(Math.max(0, p - (adapter.htfWindow?.[t] ?? HTF_WINDOW)), p);
    }
    const window = m15.slice(Math.max(0, i + 1 - M15_WINDOW), i + 1);
    if (window.length < adapter.warmupCandles) continue;
    const res = runStrategyGuarded(adapter, {
      mode: 'BACKTEST', symbol: 'XAUUSD', timeframe: tf, candles: window, now, zones: [], news: EMPTY_NEWS,
      htf: ctxHtf, params: runParams, state,
    });
    violations += res.violations.length;
    for (const ev of res.events) {
      if (ev.type === 'SNR_NEAR') nearCount++;
      if (ev.type === 'SETUP_CONFIRMED') signals.push({ i, now, ev });
    }
  }

  // ---- 2. sessions (one per RR), linked by run_id so the UI can group them
  const runId = globalThis.crypto.randomUUID();
  const sessions: Array<{ rr: number; id: string }> = [];
  for (const rr of rrList) {
    const id = await repo.createBacktestSession(db, {
      name: v.name?.trim() || `SNR ${new Date(v.from).toISOString().slice(0, 10)} → ${new Date(v.to).toISOString().slice(0, 10)} RR 1:${rr}`,
      strategyVersionId: sv.id, sourceId: v.sourceId, instrumentId, timeframe: tf, profile: 'snr_trend_momentum',
      costConfig: { run_id: runId, strategy_params: v.params ?? {}, ...costs, ...(riskUsd ? { risk_usd: riskUsd, lot: 'dihitung per trade dari jarak SL' } : { size }), rr, entry: 'open M15 berikutnya', max_entry_gap_minutes: MAX_ENTRY_GAP_MS / 60_000 },
      isTest, notes: `Mesin backtest website. Strategi ${label}. RR 1:${rr}.`,
    });
    sessions.push({ rr, id });
  }

  // ---- 3. persist events (one row per RR session so each session is self-contained)
  const eventRows: repo.NewEvent[] = [];
  const meta = signals.map((s) => {
    const snap = snapshotAt(news, s.now);
    const sum = summarizeNews(snap);
    const side = (s.ev.details?.side as 'long' | 'short') ?? 'long';
    const sent = snap.items.find((x) => x.sentiment && x.sentiment.label !== 'Unknown')?.sentiment?.label ?? null;
    const highNews = snap.items.some((x) => x.kind === 'economic' && x.impact === 'high') || snap.upcoming.some((u) => u.impact === 'high');
    return {
      ...s, side, sum,
      newsConfirmed: snap.archiveAvailable ? highNews : null,
      sentimentConfirmed: !snap.archiveAvailable || !sent || sent === 'Neutral' ? null : (sent === 'Bullish') === (side === 'long'),
      newsItems: snap.items.length,
    };
  });
  for (const ses of sessions) {
    for (const m of meta) {
      const uid = `${m.ev.type}:${m.ev.candleTime}:${m.ev.details?.slot ?? `${m.ev.zone?.low}-${m.ev.zone?.high}`}`;
      eventRows.push({
        mode: 'BACKTEST', eventUid: uid, dedupeKey: `btrun:${ses.id}:${uid}`, instrumentId, timeframe: tf, eventType: m.ev.type,
        eventTime: m.now, price: m.ev.price, zoneLow: m.ev.zone?.low ?? null, zoneHigh: m.ev.zone?.high ?? null, zoneKind: m.ev.zone?.kind ?? null,
        zoneId: null, strategyVersionId: sv.id, strategyLabel: label, source: 'replay_engine', replaySessionId: null, runNumber: null,
        confirmations: { trend: m.ev.confirmations?.trend ?? '-', momentum: 'tidak dipakai (v0.1)', news: m.sum.news, sentiment: m.sum.sentiment },
        payload: { status: m.ev.status ?? null, details: m.ev.details ?? {}, candle_open_time: m.ev.candleTime, rr: ses.rr },
        isTest, backtestSessionId: ses.id,
      });
    }
  }
  const eventIds = await repo.insertEventsBulk(db, eventRows);

  // ---- 4. simulate trades
  const summary: Array<{ rr: number; backtestSessionId: string; trades: number; skipped: Record<string, number> }> = [];
  for (const ses of sessions) {
    const trades: repo.TradeInsert[] = [];
    const skipped: Record<string, number> = { posisi_masih_terbuka: 0, gap_weekend: 0, sl_tidak_valid: 0, tanpa_candle_berikut: 0 };
    // one open position per slot (SNR: a single slot; breakout: one BUY + one SELL per part); value = exit candle time
    const busy = new Map<string, number>();
    for (const m of meta) {
      const entryIdx = m.i + 1;
      const entryBar = m15[entryIdx];
      if (!entryBar) { skipped.tanpa_candle_berikut++; continue; }
      const slot = String(m.ev.details?.slot ?? 'all');
      if (entryBar.time <= (busy.get(slot) ?? -Infinity)) { skipped.posisi_masih_terbuka++; continue; }
      if (entryBar.time - m.now > MAX_ENTRY_GAP_MS) { skipped.gap_weekend++; continue; }
      const sl = Number(m.ev.details?.stop_loss);
      const entry = fillPrice(m.side, entryBar.open, costs);
      const risk = m.side === 'long' ? entry - sl : sl - entry;
      if (!Number.isFinite(sl) || risk <= 0) { skipped.sl_tidak_valid++; continue; }
      const tp = m.side === 'long' ? entry + ses.rr * risk : entry - ses.rr * risk;
      // Fixed $ risk: lot so that (entry fill → SL) × lot × contract = riskUsd. Not rounded to broker lot steps.
      const lot = riskUsd ? Math.round((riskUsd / (risk * costs.contractSize)) * 1e4) / 1e4 : size;
      if (!(lot > 0)) { skipped.sl_tidak_valid++; continue; }
      const r = simulateTrade(m15, { side: m.side, entryBarIndex: entryIdx, stopLoss: sl, takeProfit: tp, size: lot }, costs);
      busy.set(slot, r.exitTime ?? Infinity);
      const uid = `${m.ev.type}:${m.ev.candleTime}:${m.ev.details?.slot ?? `${m.ev.zone?.low}-${m.ev.zone?.high}`}`;
      trades.push({
        backtest_session_id: ses.id, strategy_version_id: sv.id, entry_event_id: eventIds.get(`btrun:${ses.id}:${uid}`) ?? null,
        origin: 'engine', side: m.side, timeframe: tf, entry_time: r.entryTime, entry_price: r.entryPrice, stop_loss: sl, take_profit: tp,
        exit_time: r.exitTime, exit_price: r.exitPrice, exit_reason: r.exitReason, pnl: r.pnl, pnl_r: r.pnlR, planned_rr: ses.rr,
        session_label: sessionOf(r.entryTime), news_confirmed: m.newsConfirmed, sentiment_confirmed: m.sentimentConfirmed,
        zone_outcome: r.exitReason === 'tp' ? 'respect' : r.exitReason === 'sl' ? 'breakout' : 'unknown',
        setup_reason: { lot, risk_usd: Number((risk * lot * costs.contractSize).toFixed(2)), signal_close: new Date(m.now).toISOString(), status: m.ev.status, trend: m.ev.confirmations?.trend, zone: m.ev.zone, details: m.ev.details, news: m.sum.news, sentiment: m.sum.sentiment },
        costs: r.costs, is_test: isTest,
      });
    }
    await repo.insertTradesBulk(db, trades);
    await repo.finishBacktestSession(db, ses.id, { periodStart: v.from, periodEnd: v.to, status: 'completed' });
    summary.push({ rr: ses.rr, backtestSessionId: ses.id, trades: trades.length, skipped });
  }

  return {
    strategy: label, candlesProcessed: m15.filter((c, i) => i >= firstIdx && c.time < signalEnd).length,
    setups: signals.length, nearEvents: nearCount, guardViolations: violations,
    newsArchive: news.archiveAvailable, costs, size: riskUsd ? null : size, riskUsd, sessions: summary,
    note: 'Hasil simulasi historis, bukan jaminan profit. Strategi v0.1 masih draf.',
  };
}
