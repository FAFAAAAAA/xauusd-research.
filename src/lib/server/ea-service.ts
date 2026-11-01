import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';
import * as repo from './repo';
import { sendTelegram, type FetchLike } from './telegram';
import { safeEqual } from '../core/webhook';
import { cleanTrade, type JournalTrade } from '../core/journal';
import { escapeHtml } from '../core/telegram-format';
import { formatInTz } from '../core/time';

/**
 * Reports from the owner's MetaTrader 5 Expert Advisor (v2). The EA places the orders at the broker itself;
 * the website only RECEIVES what happened (entry / exit) and writes it to the journal + Telegram. No order is ever sent from here.
 * Auth: a key generated in Atur → EA (only its SHA-256 is stored).
 */
const KEY = 'ea_key_hash';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function newEaKey(db: Db): Promise<string> {
  const k = randomBytes(24).toString('hex');
  await repo.setAppSetting(db, KEY, { hash: sha(k), createdAt: Date.now() });
  return k;
}
export async function eaKeyInfo(db: Db): Promise<{ configured: boolean; createdAt: number | null; lastReport: unknown }> {
  const v = await repo.getAppSetting<{ hash?: string; createdAt?: number } | null>(db, KEY, null);
  return { configured: !!v?.hash, createdAt: v?.createdAt ?? null, lastReport: await repo.getAppSetting(db, 'ea_last_report', null) };
}

export interface EaResponse { status: number; body: Record<string, unknown> }
const num = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN);

export async function handleEaReport(db: Db, raw: string, opts: { fetchImpl?: FetchLike; now?: number } = {}): Promise<EaResponse> {
  const now = opts.now ?? Date.now();
  if (raw.length > 8192) return { status: 413, body: { ok: false, error: 'Payload too large' } };
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return { status: 400, body: { ok: false, error: 'Invalid JSON' } }; }
  const stored = await repo.getAppSetting<{ hash?: string } | null>(db, KEY, null);
  if (!stored?.hash) return { status: 503, body: { ok: false, error: 'Kunci EA belum dibuat (Atur → EA)' } };
  if (typeof b.key !== 'string' || !safeEqual(sha(b.key), stored.hash)) return { status: 401, body: { ok: false, error: 'Unauthorized' } };

  const ticket = String(b.ticket ?? '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 40);
  if (!ticket) return { status: 422, body: { ok: false, error: 'ticket wajib' } };
  const id = `ea-${ticket}`;
  const all = await repo.getAppSetting<JournalTrade[]>(db, 'live_journal', []);
  const list = Array.isArray(all) ? all : [];
  const i = list.findIndex((x) => x.id === id);
  const event = b.event === 'close' ? 'close' : b.event === 'open' ? 'open' : null;
  if (!event) return { status: 422, body: { ok: false, error: 'event harus open atau close' } };
  const timeMs = num(b.time) > 0 ? num(b.time) * (num(b.time) < 1e12 ? 1000 : 1) : now;

  let trade: JournalTrade | string;
  if (event === 'open') {
    if (i >= 0) return { status: 200, body: { ok: true, duplicate: true } };
    trade = cleanTrade({ strategy: 'v2', side: b.side, entry: num(b.price), sl: num(b.sl), tp: num(b.tp), lot: num(b.lot), openedAt: timeMs, result: 'open', note: 'EA' }, id);
  } else {
    const prev = i >= 0 ? list[i] : null;
    if (prev && prev.result !== 'open') return { status: 200, body: { ok: true, duplicate: true } };
    const reason = b.reason === 'tp' ? 'tp' : b.reason === 'sl' ? 'sl' : 'manual';
    const base = prev ?? { strategy: 'v2', side: b.side, entry: num(b.entry), sl: num(b.sl), tp: num(b.tp), lot: num(b.lot), openedAt: timeMs, note: 'EA' };
    // keep the broker's real exit price and net result (incl. commission & swap)
    trade = cleanTrade({ ...base, result: reason === 'tp' ? 'manual' : reason, exit: num(b.price), pnl: num(b.profit), closedAt: timeMs }, id);
    if (typeof trade !== 'string' && reason === 'tp') trade = { ...trade, result: 'tp' };
  }
  if (typeof trade === 'string') return { status: 422, body: { ok: false, error: trade } };
  if (i >= 0) list[i] = trade; else list.push(trade);
  await repo.setAppSetting(db, 'live_journal', list.slice(-3000));
  await repo.setAppSetting(db, 'ea_last_report', { at: now, event, ticket });

  // Telegram (same switch as live signals)
  const tg = await repo.getTelegramSettings(db);
  let telegram = 'disabled';
  if (tg.live_enabled) {
    const tz = await repo.getAppSetting<string>(db, 'display_timezone', 'UTC');
    const t = trade;
    const text = event === 'open'
      ? [`🤖 <b>EA v2 — ${t.side} terbuka</b>`, '', `<b>Entry:</b> ${t.entry.toFixed(2)}`, `<b>SL:</b> ${t.sl.toFixed(2)}`, `<b>TP:</b> ${t.tp.toFixed(2)}`, `<b>Lot:</b> ${t.lot.toFixed(2)}`,
        `<b>Waktu:</b> ${escapeHtml(formatInTz(t.openedAt, tz))}`].join('\n')
      : [`${(t.pnl ?? 0) >= 0 ? '✅' : '❌'} <b>EA v2 — ${t.side} ditutup (${t.result === 'tp' ? 'TP' : t.result === 'sl' ? 'SL' : 'manual'})</b>`, '',
        `<b>Entry → keluar:</b> ${t.entry.toFixed(2)} → ${(t.exit ?? 0).toFixed(2)}`, `<b>Hasil:</b> ${(t.pnl ?? 0) >= 0 ? '+' : '−'}$${Math.abs(t.pnl ?? 0).toFixed(2)}`,
        `<b>Waktu:</b> ${escapeHtml(formatInTz(t.closedAt ?? now, tz))}`].join('\n');
    const r = await sendTelegram(db, { deliveryKey: `ea:${event}:${ticket}`, mode: 'LIVE', text }, { fetchImpl: opts.fetchImpl });
    telegram = r.status;
  }
  return { status: 200, body: { ok: true, id, telegram } };
}
