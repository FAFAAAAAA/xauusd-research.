import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';
import * as repo from './repo';
import { sendTelegram, type FetchLike } from './telegram';
import { safeEqual } from '../core/webhook';
import { buildEventMessage } from '../core/telegram-format';
import { lotFor, readLiveRisk } from '../core/journal';
import { volBreakAdapter } from '../core/strategy/volbreak';
import { runStrategyGuarded } from '../core/strategy/adapter';
import { aggregateCandles } from '../core/timeframes';
import { TIMEFRAME_MS, type Candle } from '../core/types';

/**
 * Free live signals for v2 without TradingView: an external scheduler (cron-job.org) calls /api/live/tick every 15 minutes,
 * the website downloads recent XAU/USD candles from Twelve Data (free API key) and runs the SAME v2 adapter as the backtest
 * on the last closed M15 candle. New signals → LIVE event + Telegram (entry ≈ close, SL, TP 1:2, lot from the risk plan).
 * H4 is built from H1 in UTC (like the backtest); D1 comes from Twelve Data daily candles (UTC).
 * Nothing is ever sent to a broker.
 */
const DAY = 86_400_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface FeedSettings { apiKey?: string | null }
export async function feedApiKey(db: Db): Promise<{ key: string | null; source: 'env' | 'database' | null }> {
  if (process.env.TWELVEDATA_API_KEY?.trim()) return { key: process.env.TWELVEDATA_API_KEY.trim(), source: 'env' };
  const s = await repo.getAppSetting<FeedSettings>(db, 'feed', {});
  return s.apiKey ? { key: s.apiKey, source: 'database' } : { key: null, source: null };
}
export async function newCronKey(db: Db): Promise<string> {
  const k = randomBytes(18).toString('hex');
  await repo.setAppSetting(db, 'cron_key_hash', { hash: sha(k), createdAt: Date.now() });
  return k;
}
export async function checkCronKey(db: Db, k: string | null): Promise<boolean> {
  const v = await repo.getAppSetting<{ hash?: string } | null>(db, 'cron_key_hash', null);
  return !!(v?.hash && k && safeEqual(sha(k), v.hash));
}

/** Twelve Data time_series → closed candles (UTC, ascending). */
async function series(fetchImpl: FetchLike, apiKey: string, interval: '15min' | '1h' | '1day', size: number, now: number, tfMs: number): Promise<Candle[]> {
  const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${size}&timezone=UTC&order=ASC&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(url, { method: 'GET', headers: {}, body: undefined as unknown as string });
  const j = (await res.json()) as { status?: string; message?: string; values?: Array<Record<string, string>> };
  if (j.status !== 'ok' || !Array.isArray(j.values)) throw new Error(`Twelve Data: ${j.message ?? `HTTP ${res.status}`}`.replace(apiKey, '[KEY]'));
  const out: Candle[] = [];
  for (const v of j.values) {
    const t = Date.parse(`${v.datetime.length <= 10 ? `${v.datetime}T00:00:00` : v.datetime.replace(' ', 'T')}Z`);
    const c: Candle = { time: t, open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close), volume: null };
    if (Number.isFinite(t) && c.open > 0 && c.high >= c.low && t + tfMs <= now) out.push(c);
  }
  return out.sort((a, b) => a.time - b.time);
}

export interface TickResult { ok: boolean; lastBar: number | null; signals: Array<{ side: string; entry: number; sl: number; tp: number; telegram: string }>; error?: string }

export async function runFeedTick(db: Db, opts: { now?: number; fetchImpl?: FetchLike } = {}): Promise<TickResult> {
  const now = opts.now ?? Date.now();
  const fetchImpl: FetchLike = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const { key } = await feedApiKey(db);
  const save = (r: TickResult) => repo.setAppSetting(db, 'feed_status', { at: now, ...r }).then(() => r);
  if (!key) return save({ ok: false, lastBar: null, signals: [], error: 'API key Twelve Data belum diisi (Atur → Sinyal otomatis)' });
  try {
    const [m15, h1, d1] = await Promise.all([
      series(fetchImpl, key, '15min', 400, now, TIMEFRAME_MS.M15),
      series(fetchImpl, key, '1h', 5000, now, TIMEFRAME_MS.H1),
      series(fetchImpl, key, '1day', 1100, now, DAY),
    ]);
    if (m15.length < 50) return save({ ok: false, lastBar: null, signals: [], error: 'Data M15 terlalu sedikit' });
    const h4 = aggregateCandles(h1, 'H1', 'H4', 'utc', false).filter((c) => c.time + TIMEFRAME_MS.H4 <= now);
    const last = m15[m15.length - 1];
    // replay today's closed M15 candles through the v2 adapter (so "today's open" and the 4-hour block rule are right)
    const dayStart = Math.floor(last.time / DAY) * DAY;
    const state: Record<string, unknown> = {};
    const found: Array<{ side: 'long' | 'short'; sl: number; time: number; close: number; level: number }> = [];
    for (let i = 1; i < m15.length; i++) {
      if (m15[i].time < dayStart) continue;
      const nowI = m15[i].time + TIMEFRAME_MS.M15;
      const res = runStrategyGuarded(volBreakAdapter, {
        mode: 'LIVE', symbol: 'XAUUSD', timeframe: 'M15', candles: m15.slice(Math.max(0, i - 200), i + 1), now: nowI, zones: [],
        news: { archiveAvailable: false, items: [], upcoming: [] },
        htf: { H4: h4.filter((c) => c.time + TIMEFRAME_MS.H4 <= nowI).slice(-1000), D1: d1.filter((c) => c.time + DAY <= nowI).slice(-1000) },
        params: {}, state,
      });
      for (const ev of res.events) {
        if (ev.type !== 'SETUP_CONFIRMED' || ev.candleTime !== last.time) continue;
        found.push({ side: ev.details?.side as 'long' | 'short', sl: Number(ev.details?.stop_loss), time: ev.candleTime, close: ev.price, level: Number(ev.details?.level) });
      }
    }
    const out: TickResult = { ok: true, lastBar: last.time, signals: [] };
    if (!found.length) return save(out);
    const instrumentId = await repo.getInstrumentId(db);
    const tg = await repo.getTelegramSettings(db);
    const tz = await repo.getAppSetting<string>(db, 'display_timezone', 'UTC');
    const risk = readLiveRisk(await repo.getAppSetting(db, 'live_risk', null));
    for (const f of found) {
      const s = f.side === 'long' ? 1 : -1;
      const side = s > 0 ? 'BUY' : 'SELL';
      const entry = f.close, sl = f.sl, tp = entry + s * 2 * Math.abs(entry - sl);
      if (!(s * (entry - sl) > 0)) continue;
      const uid = `feed-v2-${f.time}-${side}`;
      const id = await repo.insertEvent(db, {
        mode: 'LIVE', eventUid: uid, dedupeKey: `live:${uid}`, instrumentId, timeframe: 'M15', eventType: 'SETUP_CONFIRMED',
        eventTime: f.time + TIMEFRAME_MS.M15, price: entry, zoneLow: f.level, zoneHigh: f.level, zoneKind: s > 0 ? 'resistance' : 'support', zoneId: null,
        strategyVersionId: null, strategyLabel: 'v2 Volatilitas', source: 'tradingview_webhook' /* DB allows only existing sources; payload.source = twelvedata */, replaySessionId: null, runNumber: null,
        confirmations: { trend: s > 0 ? 'Naik (H4 & D1)' : 'Turun (H4 & D1)' }, payload: { symbol: 'XAUUSD', source: 'twelvedata', extra: { side, sl, tp, be: entry + s * Math.abs(entry - sl) } }, isTest: false,
      });
      if (!id) continue;                                     // already sent (scheduler called twice)
      let telegram = 'disabled';
      if (tg.live_enabled) {
        const l = lotFor((risk.capital * risk.riskPct) / 100, entry, sl);
        const msg = buildEventMessage({
          mode: 'LIVE', eventType: 'SETUP_CONFIRMED', timeframe: 'M15', eventTime: f.time + TIMEFRAME_MS.M15, price: entry, zoneLow: f.level, zoneHigh: f.level,
          zoneKind: null, confirmations: {}, status: '', displayTimezone: tz, strategyLabel: 'v2 Volatilitas (Twelve Data)',
          trade: { side, entry, sl, tp, lot: l ? l.lot : null, riskUsd: l ? l.risk : null, riskPct: risk.riskPct, be: entry + s * Math.abs(entry - sl) },
        });
        telegram = (await sendTelegram(db, { deliveryKey: `live-event:${id}`, mode: 'LIVE', marketEventId: id, text: msg.text, copy: msg.copy }, { fetchImpl: opts.fetchImpl })).status;
      }
      out.signals.push({ side, entry, sl, tp, telegram });
    }
    return save(out);
  } catch (e) {
    return save({ ok: false, lastBar: null, signals: [], error: (e as Error).message.slice(0, 300) });
  }
}
