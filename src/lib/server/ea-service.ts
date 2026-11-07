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

  // bot status messages (daily summary, warnings): Telegram only, no journal row
  if (b.event === 'info') {
    const txt = String(b.text ?? '').slice(0, 800);
    if (!txt.trim()) return { status: 422, body: { ok: false, error: 'text wajib' } };
    const sym = typeof b.symbol === 'string' ? b.symbol.replace(/[^0-9A-Za-z]/g, '').slice(0, 24) : '';
    await repo.setAppSetting(db, 'ea_last_report', { at: now, event: 'info', ticket: sym || 'bot' });
    const tg = await repo.getTelegramSettings(db);
    if (!tg.live_enabled) return { status: 200, body: { ok: true, telegram: 'disabled' } };
    const head = b.strategy === 'snr' ? 'Bot v1 SNR' : 'EA';
    const level = b.level === 'error' ? '⚠️' : 'ℹ️';
    const key = createHash('sha256').update(`${now}:${txt}`).digest('hex').slice(0, 16);
    const r = await sendTelegram(db, { deliveryKey: `ea:info:${key}`, mode: 'LIVE', text: `${level} <b>${escapeHtml(head)}</b>\n\n${escapeHtml(txt)}` }, { fetchImpl: opts.fetchImpl });
    return { status: 200, body: { ok: true, telegram: r.status } };
  }
  const ticket = String(b.ticket ?? '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 40);
  if (!ticket) return { status: 422, body: { ok: false, error: 'ticket wajib' } };
  const id = `ea-${ticket}`;
  const all = await repo.getAppSetting<JournalTrade[]>(db, 'live_journal', []);
  const list = Array.isArray(all) ? all : [];
  const i = list.findIndex((x) => x.id === id);
  const event = b.event === 'close' ? 'close' : b.event === 'open' ? 'open' : null;
  if (!event) return { status: 422, body: { ok: false, error: 'event harus open atau close' } };
  const timeMs = num(b.time) > 0 ? num(b.time) * (num(b.time) < 1e12 ? 1000 : 1) : now;

  // which EA / bot: v1 XAU (journal key v2, default), v1 NAS ("strategy":"nas") or the Binance v1 SNR bot ("strategy":"snr", sends "symbol")
  const strat = b.strategy === 'nas' ? 'nas' : b.strategy === 'snr' ? 'snr' : 'v2';
  const lbl = strat === 'nas' ? 'v1 NAS' : strat === 'snr' ? 'v1 SNR' : 'v1 XAU';
  const symbol = typeof b.symbol === 'string' ? b.symbol.replace(/[^0-9A-Za-z]/g, '').slice(0, 24).toUpperCase() : '';
  const src = strat === 'snr' ? `Bot Binance${symbol ? ` ${symbol}` : ''}` : 'EA';
  const who = strat === 'snr' ? `Bot ${lbl}${symbol ? ` ${symbol}` : ''}` : `EA ${lbl}`;
  // prices of small coins need more than 2 decimals
  const fp = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : Math.abs(x) >= 1 ? x.toFixed(4) : x.toPrecision(5));
  let trade: JournalTrade | string;
  if (event === 'open') {
    if (i >= 0) return { status: 200, body: { ok: true, duplicate: true } };
    trade = cleanTrade({ strategy: strat, side: b.side, entry: num(b.price), sl: num(b.sl), tp: num(b.tp), lot: num(b.lot), openedAt: timeMs, result: 'open', note: src }, id);
  } else {
    const prev = i >= 0 ? list[i] : null;
    if (prev && prev.result !== 'open') return { status: 200, body: { ok: true, duplicate: true } };
    const reason = b.reason === 'tp' ? 'tp' : b.reason === 'sl' ? 'sl' : 'manual';
    const base = prev ?? { strategy: strat, side: b.side, entry: num(b.entry), sl: num(b.sl), tp: num(b.tp), lot: num(b.lot), openedAt: timeMs, note: src };
    // keep the broker's real exit price and net result (incl. commission & swap)
    // v2 breakeven: a stop that closes at (about) the entry price is the moved SL → record as BE, not SL
    const isBe = strat === 'v2' && reason === 'sl' && Math.abs(num(b.price) - Number(base.entry)) < 0.25 * Math.abs(Number(base.entry) - Number(base.sl));
    trade = cleanTrade({ ...base, result: reason === 'tp' ? 'manual' : isBe ? 'be' : reason, exit: num(b.price), pnl: num(b.profit), closedAt: timeMs }, id);
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
    // Binance bot (v1 SNR): own layout — coin, % distance of SL/TP, risk in USDT, result in R and duration
    const pctOf = (x: number) => `${x >= t.entry ? '+' : '−'}${(Math.abs(x / t.entry - 1) * 100).toFixed(2)}%`;
    const riskUsd = Math.abs(t.entry - t.sl) * t.lot;
    const dur = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 1440 ? `${Math.floor(m / 1440)}h ${Math.floor((m % 1440) / 60)}j` : `${Math.floor(m / 60)}j ${m % 60}m`; };
    const coin = escapeHtml(symbol.replace(/USDT$/, '') || 'koin');
    const snrText = event === 'open'
      ? [`${t.side === 'SELL' ? '🔴' : '🟢'} <b>${t.side} ${coin}</b> · v1 SNR`, '━━━━━━━━━━━━',
        `Entry   <code>${fp(t.entry)}</code>`, `SL      <code>${fp(t.sl)}</code>  (${pctOf(t.sl)})`, `TP      <code>${fp(t.tp)}</code>  (${pctOf(t.tp)})`,
        `Risiko  <b>${riskUsd.toFixed(2)} USDT</b> · ${t.lot} ${coin}`, '', `🕐 ${escapeHtml(formatInTz(t.openedAt, tz))}`].join('\n')
      : [`${t.result === 'tp' ? '✅ <b>TP</b>' : t.result === 'sl' ? '❌ <b>SL</b>' : '⚪ <b>Ditutup manual</b>'} · <b>${coin}</b> · v1 SNR`, '━━━━━━━━━━━━',
        `Hasil   <b>${(t.pnl ?? 0) >= 0 ? '+' : '−'}${Math.abs(t.pnl ?? 0).toFixed(2)} USDT</b>${riskUsd > 0 ? `  (${(t.pnl ?? 0) >= 0 ? '+' : '−'}${(Math.abs(t.pnl ?? 0) / riskUsd).toFixed(1)}R)` : ''}`,
        `Harga   ${fp(t.entry)} → ${fp(t.exit ?? 0)}`, `Durasi  ${dur((t.closedAt ?? now) - t.openedAt)}`, '', `🕐 ${escapeHtml(formatInTz(t.closedAt ?? now, tz))}`].join('\n');
    const text = strat === 'snr' ? snrText : event === 'open'
      ? [`🤖 <b>${escapeHtml(who)} — ${t.side} terbuka</b>`, '', `<b>Entry:</b> <code>${fp(t.entry)}</code>`, `<b>SL:</b> <code>${fp(t.sl)}</code>`, `<b>TP:</b> <code>${fp(t.tp)}</code>`, `<b>Lot:</b> <code>${t.lot.toFixed(2)}</code>`,
        `<b>Waktu:</b> ${escapeHtml(formatInTz(t.openedAt, tz))}`].join('\n')
      : [`${(t.pnl ?? 0) >= 0 ? '✅' : '❌'} <b>${escapeHtml(who)} — ${t.side} ditutup (${t.result === 'tp' ? 'TP' : t.result === 'sl' ? 'SL' : t.result === 'be' ? 'BE — SL di entry' : 'manual'})</b>`, '',
        `<b>Entry → keluar:</b> ${fp(t.entry)} → ${fp(t.exit ?? 0)}`, `<b>Hasil:</b> ${(t.pnl ?? 0) >= 0 ? '+' : '−'}$${Math.abs(t.pnl ?? 0).toFixed(2)}`,
        `<b>Waktu:</b> ${escapeHtml(formatInTz(t.closedAt ?? now, tz))}`].join('\n');
    const copy = event === 'open' && strat !== 'snr' ? [{ text: 'Salin entry', value: fp(t.entry) }, { text: 'Salin SL', value: fp(t.sl) }, { text: 'Salin TP', value: fp(t.tp) }] : undefined;
    const r = await sendTelegram(db, { deliveryKey: `ea:${event}:${ticket}`, mode: 'LIVE', text, copy }, { fetchImpl: opts.fetchImpl });
    telegram = r.status;
  }
  return { status: 200, body: { ok: true, id, telegram } };
}
