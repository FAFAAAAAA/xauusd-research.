import type { Db } from './db';
import { getConfig, type ServerConfig } from './config';
import { decryptSecret } from '../core/crypto';
import * as repo from './repo';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ status: number; json(): Promise<unknown> }>;

export interface SendRequest {
  deliveryKey: string;
  mode: 'LIVE' | 'BACKTEST' | 'TEST';
  marketEventId?: string | null;
  replaySessionId?: string | null;
  text: string;
  button?: { text: string; url: string };
  allowRetryFailed?: boolean;
}

export interface SendResult {
  status: 'sent' | 'failed' | 'skipped' | 'duplicate';
  messageId?: number;
  error?: string;
  attempts: number;
}

export async function resolveCredentials(db: Db, cfg: ServerConfig = getConfig()) {
  const s = await repo.getTelegramSettings(db);
  let token = cfg.telegramBotTokenEnv;
  let tokenSource: 'env' | 'database' | null = token ? 'env' : null;
  if (!token && s.bot_token_encrypted && cfg.encryptionKey) {
    try { token = await decryptSecret(s.bot_token_encrypted, cfg.encryptionKey); tokenSource = 'database'; }
    catch { token = null; }
  }
  const chatId = s.chat_id || cfg.telegramChatIdEnv;
  return { token, chatId, tokenSource, settings: s };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends one message with idempotency (delivery_key), bounded retries and full logging.
 * A message is reported as `sent` ONLY when Telegram answers `ok: true` with a message_id.
 */
export async function sendTelegram(db: Db, req: SendRequest, opts: { fetchImpl?: FetchLike; cfg?: ServerConfig; maxRetryWaitMs?: number } = {}): Promise<SendResult> {
  const cfg = opts.cfg ?? getConfig();
  const fetchImpl: FetchLike = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const logId = await repo.claimDelivery(db, {
    key: req.deliveryKey, mode: req.mode, marketEventId: req.marketEventId ?? null,
    replaySessionId: req.replaySessionId ?? null, text: req.text, allowRetryFailed: !!req.allowRetryFailed,
  });
  if (!logId) return { status: 'duplicate', attempts: 0 };

  const { token, chatId, settings } = await resolveCredentials(db, cfg);
  if (!token || !chatId) {
    const error = !token ? 'Bot token belum dikonfigurasi' : 'Chat ID belum dikonfigurasi';
    await repo.finishDelivery(db, logId, { status: 'failed', attempts: 0, httpStatus: null, messageId: null, error });
    return { status: 'failed', error, attempts: 0 };
  }
  if (req.mode !== 'TEST' && (await repo.sentInLastMinute(db)) >= settings.max_per_minute) {
    await repo.finishDelivery(db, logId, { status: 'skipped', attempts: 0, httpStatus: null, messageId: null, error: null, skipReason: 'rate_limit_per_minute' });
    return { status: 'skipped', error: 'Batas pesan per menit tercapai', attempts: 0 };
  }

  const body: Record<string, unknown> = { chat_id: chatId, text: req.text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (req.button) body.reply_markup = { inline_keyboard: [[{ text: req.button.text, url: req.button.url }]] };
  const url = `${cfg.telegramApiBase}/bot${token}/sendMessage`;
  const scrub = (s: string) => s.split(token).join('[TOKEN]');

  let attempts = 0;
  let lastErr = 'unknown';
  let lastStatus: number | null = null;
  const maxWait = opts.maxRetryWaitMs ?? 5_000;
  while (attempts < 3) {
    attempts++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      lastStatus = res.status;
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number }; description?: string; parameters?: { retry_after?: number } };
      if (data.ok === true && typeof data.result?.message_id === 'number') {
        await repo.finishDelivery(db, logId, { status: 'sent', attempts, httpStatus: res.status, messageId: data.result.message_id, error: null });
        return { status: 'sent', messageId: data.result.message_id, attempts };
      }
      lastErr = scrub(data.description ?? `HTTP ${res.status}`);
      if (res.status === 429) {
        const wait = (data.parameters?.retry_after ?? 1) * 1000;
        if (wait > maxWait) break; // don't block a request for long; manual retry is available
        await sleep(wait);
        continue;
      }
      if (res.status >= 500) { await sleep(400 * 2 ** attempts); continue; }
      break; // 4xx: bad token / chat id / message → retrying won't help
    } catch (e) {
      lastErr = scrub((e as Error).name === 'AbortError' ? 'Timeout menghubungi Telegram' : (e as Error).message);
      // Network failure: the message MAY have been delivered. Only retry if nothing was received at all.
      await sleep(400 * 2 ** attempts);
    } finally {
      clearTimeout(timer);
    }
  }
  await repo.finishDelivery(db, logId, { status: 'failed', attempts, httpStatus: lastStatus, messageId: null, error: lastErr });
  return { status: 'failed', error: lastErr, attempts };
}
