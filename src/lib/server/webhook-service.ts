import type { Db } from './db';
import * as repo from './repo';
import { getConfig, TRADINGVIEW_IPS, type ServerConfig } from './config';
import { loadNewsWindow, snapshotAt, summarizeNews } from './news-service';
import { sendTelegram, type FetchLike, type SendResult } from './telegram';
import { redactSecret, safeEqual, SlidingWindowLimiter, validateWebhookPayload } from '../core/webhook';
import { buildEventMessage } from '../core/telegram-format';
import { NOT_CONFIGURED } from '../core/types';
import { liveSignalFrom, lotFor, readLiveRisk } from '../core/journal';

const memLimiter = new SlidingWindowLimiter(60, 60_000);
export const MAX_BODY_BYTES = 16_384;
export const DB_RATE_LIMIT_PER_MINUTE = 120;

export interface WebhookResponse { status: number; body: Record<string, unknown> }

export async function handleTradingViewWebhook(db: Db, rawBody: string, ip: string | null, opts: { now?: number; cfg?: ServerConfig; fetchImpl?: FetchLike } = {}): Promise<WebhookResponse> {
  const now = opts.now ?? Date.now();
  const cfg = opts.cfg ?? getConfig();
  const log = (status: string, http: number, error: string | null, payload: unknown, eventUid: string | null = null, marketEventId: string | null = null) =>
    repo.logWebhook(db, { ip, status, http, eventUid, marketEventId, error, payload: redactSecret(payload) });

  if (!cfg.webhookSecret) {
    await log('error', 503, 'TRADINGVIEW_WEBHOOK_SECRET belum diatur', null);
    return { status: 503, body: { ok: false, error: 'Webhook belum dikonfigurasi di server' } };
  }
  if (cfg.enforceTvIpAllowlist && (!ip || !TRADINGVIEW_IPS.includes(ip))) {
    await log('rejected_auth', 403, `IP ${ip} tidak ada di allowlist TradingView`, null);
    return { status: 403, body: { ok: false, error: 'Forbidden' } };
  }
  if (!memLimiter.allow(ip ?? 'unknown', now) || (await repo.webhookHitsLastMinute(db, ip)) >= DB_RATE_LIMIT_PER_MINUTE) {
    await log('rate_limited', 429, 'Rate limit', null);
    return { status: 429, body: { ok: false, error: 'Too many requests' } };
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    await log('rejected_validation', 413, 'Payload terlalu besar', null);
    return { status: 413, body: { ok: false, error: 'Payload too large' } };
  }
  let body: unknown;
  try { body = JSON.parse(rawBody); }
  catch {
    await log('rejected_validation', 400, 'Body bukan JSON valid', { raw: rawBody.slice(0, 500) });
    return { status: 400, body: { ok: false, error: 'Invalid JSON' } };
  }
  const secret = (body as Record<string, unknown>)?.secret;
  if (typeof secret !== 'string' || !safeEqual(secret, cfg.webhookSecret)) {
    await log('rejected_auth', 401, 'Secret tidak cocok', body);
    return { status: 401, body: { ok: false, error: 'Unauthorized' } };
  }
  const v = validateWebhookPayload(body, now);
  if (!v.ok) {
    await log('rejected_validation', 422, v.errors.join('; '), body);
    return { status: 422, body: { ok: false, errors: v.errors } };
  }
  const p = v.value;
  try {
    const instrumentId = await repo.getInstrumentId(db);
    const news = summarizeNews(snapshotAt(await loadNewsWindow(db, p.timestamp, p.timestamp), p.timestamp));
    const confirmations = {
      trend: p.confirmations?.trend ?? NOT_CONFIGURED,
      momentum: p.confirmations?.momentum ?? NOT_CONFIGURED,
      news: p.confirmations?.news ?? news.news,
      sentiment: p.confirmations?.sentiment ?? news.sentiment,
    };
    const id = await repo.insertEvent(db, {
      mode: 'LIVE', eventUid: p.event_id, dedupeKey: `live:${p.event_id}`, instrumentId, timeframe: p.timeframe, eventType: p.event_type,
      eventTime: p.timestamp, price: p.price, zoneLow: p.zone.low, zoneHigh: p.zone.high, zoneKind: p.zone.kind, zoneId: null,
      strategyVersionId: null, strategyLabel: p.strategy_version, source: 'tradingview_webhook', replaySessionId: null, runNumber: null,
      confirmations, payload: { symbol: p.symbol, source: p.source, extra: p.extra ?? {} }, isTest: p.source.toUpperCase().includes('TEST'),
    });
    if (!id) {
      await log('duplicate', 200, null, body, p.event_id);
      return { status: 200, body: { ok: true, duplicate: true } };
    }

    let telegram: SendResult | { status: 'disabled' | 'cooldown' } = { status: 'disabled' };
    const tg = await repo.getTelegramSettings(db);
    if (tg.live_enabled) {
      const cooling = await repo.recentlySentSimilar(db, { mode: 'LIVE', replaySessionId: null, eventType: p.event_type, zoneLow: p.zone.low, zoneHigh: p.zone.high, eventTime: p.timestamp, seconds: tg.cooldown_seconds, excludeEventId: id });
      if (cooling) telegram = { status: 'cooldown' };
      else {
        const tz = await repo.getAppSetting<string>(db, 'display_timezone', 'UTC');
        const sig = liveSignalFrom(p.extra, p.price);
        let trade;
        if (sig) {
          const r = readLiveRisk(await repo.getAppSetting(db, 'live_risk', null));
          const l = lotFor((r.capital * r.riskPct) / 100, sig.entry, sig.sl);
          trade = { ...sig, lot: l ? l.lot : null, riskUsd: l ? l.risk : null, riskPct: r.riskPct };
        }
        const msg = buildEventMessage({ trade,
          mode: 'LIVE', eventType: p.event_type, timeframe: p.timeframe, eventTime: p.timestamp, price: p.price,
          zoneLow: p.zone.low, zoneHigh: p.zone.high, zoneKind: p.zone.kind, confirmations,
          status: p.event_type === 'SETUP_CONFIRMED' ? 'Setup terkonfirmasi (menurut indikator)' : 'Menunggu konfirmasi entry',
          displayTimezone: tz, strategyLabel: p.strategy_version, isTest: p.source.toUpperCase().includes('TEST'),
          linkUrl: cfg.appBaseUrl ? (sig ? `${cfg.appBaseUrl}/trade` : `${cfg.appBaseUrl}/?event=${id}`) : null,
        });
        telegram = await sendTelegram(db, { deliveryKey: `live-event:${id}`, mode: 'LIVE', marketEventId: id, text: msg.text, button: msg.button }, { fetchImpl: opts.fetchImpl, cfg });
      }
    }
    await log('accepted', 200, null, body, p.event_id, id);
    return { status: 200, body: { ok: true, event_id: id, telegram: telegram.status } };
  } catch (e) {
    await repo.logSystemError(db, 'webhook.tradingview', (e as Error).message, { event_id: p.event_id });
    await log('error', 500, (e as Error).message, body, p.event_id);
    return { status: 500, body: { ok: false, error: 'Internal error' } };
  }
}
