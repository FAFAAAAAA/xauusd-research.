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
export interface CashFlow { id: string; at: number; amount: number; asset: string; type: string }
const num = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN);

export async function handleEaReport(db: Db, raw: string, opts: { fetchImpl?: FetchLike; now?: number } = {}): Promise<EaResponse> {
  const now = opts.now ?? Date.now();
  if (raw.length > 8192) return { status: 413, body: { ok: false, error: 'Payload too large' } };
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return { status: 400, body: { ok: false, error: 'Invalid JSON' } }; }
  const stored = await repo.getAppSetting<{ hash?: string } | null>(db, KEY, null);
  if (!stored?.hash) return { status: 503, body: { ok: false, error: 'Kunci EA belum dibuat (Atur → EA)' } };
  if (typeof b.key !== 'string' || !safeEqual(sha(b.key), stored.hash)) return { status: 401, body: { ok: false, error: 'Unauthorized' } };

  // Binance bot: real Futures balance (wallet + unrealized P&L), shown on the Trade page
  if (b.event === 'balance') {
    const wallet = num(b.wallet), upnl = num(b.upnl);
    if (!Number.isFinite(wallet)) return { status: 422, body: { ok: false, error: 'wallet wajib' } };
    // source "mt5" = the MetaTrader EA (Forex); otherwise the Binance bot (Crypto)
    // per position floating P&L: Binance {SYMBOL: upnl}, MT5 {xau, nas}
    const pos: Record<string, number> = {};
    if (b.pos && typeof b.pos === 'object') for (const [k, v] of Object.entries(b.pos as Record<string, unknown>).slice(0, 40)) {
      const key = String(k).replace(/[^0-9A-Za-z_]/g, '').slice(0, 30), x = num(v);
      if (key && Number.isFinite(x)) pos[key] = x;
    }
    await repo.setAppSetting(db, b.source === 'mt5' ? 'mt5_balance' : 'binance_balance', { wallet, upnl: Number.isFinite(upnl) ? upnl : 0, pos, at: now });
    return { status: 200, body: { ok: true } };
  }
  // deposits / withdrawals / transfers (Binance: Spot <-> Futures transfers from /fapi/v1/income; MT5: balance deals).
  // Stored per market, deduplicated by id; each new one is announced once on Telegram.
  if (b.event === 'cashflow') {
    const mt5 = b.source === 'mt5', k = mt5 ? 'cashflow_mt5' : 'cashflow_binance';
    const items = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]).slice(0, 60) : [];
    const have = await repo.getAppSetting<CashFlow[]>(db, k, []), ids = new Set(have.map((c) => c.id));
    const fresh: CashFlow[] = [];
    for (const it of items) {
      const id = String(it.id ?? '').replace(/[^0-9A-Za-z:_-]/g, '').slice(0, 64), at = num(it.at), amount = num(it.amount);
      const asset = String(it.asset ?? 'USD').replace(/[^0-9A-Za-z]/g, '').slice(0, 12) || 'USD';
      if (!id || ids.has(id) || !Number.isFinite(at) || !Number.isFinite(amount) || amount === 0) continue;
      ids.add(id);
      fresh.push({ id, at: at < 1e12 ? at * 1000 : at, amount, asset, type: String(it.type ?? '').replace(/[^0-9A-Za-z_]/g, '').slice(0, 40) });
    }
    if (!fresh.length) return { status: 200, body: { ok: true, added: 0 } };
    await repo.setAppSetting(db, k, [...have, ...fresh].sort((a, c) => a.at - c.at).slice(-500));
    const tg = await repo.getTelegramSettings(db);
    if (tg.live_enabled) {
      const tz = await repo.getAppSetting<string>(db, 'display_timezone', 'UTC');
      for (const c of fresh) {
        const inn = c.amount > 0, amt = `${inn ? '+' : '−'}${Math.abs(c.amount).toFixed(2)} ${c.asset}`;
        const where = mt5 ? 'akun MT5' : 'Binance Futures';
        const text = `💸 <b>${inn ? 'Dana masuk' : 'Dana keluar'}</b> · ${escapeHtml(where)}\n\n${escapeHtml(amt)}\n${escapeHtml(formatInTz(c.at, tz))}\n\nTercatat di website; tidak dihitung sebagai profit/rugi.`;
        await sendTelegram(db, { deliveryKey: `ea:cf:${k}:${c.id}`, mode: 'LIVE', text }, { fetchImpl: opts.fetchImpl });
      }
    }
    return { status: 200, body: { ok: true, added: fresh.length } };
  }
  // bot status messages (daily summary, warnings): Telegram only, no journal row
  if (b.event === 'info') {
    const txt = String(b.text ?? '').slice(0, 800);
    if (!txt.trim()) return { status: 422, body: { ok: false, error: 'text wajib' } };
    const sym = typeof b.symbol === 'string' ? b.symbol.replace(/[^0-9A-Za-z]/g, '').slice(0, 24) : '';
    await repo.setAppSetting(db, 'ea_last_report', { at: now, event: 'info', ticket: sym || 'bot' });
    const tg = await repo.getTelegramSettings(db);
    if (!tg.live_enabled) return { status: 200, body: { ok: true, telegram: 'disabled' } };
    const head = b.strategy === 'snr' || b.strategy === 'btc' ? 'Bot Binance' : 'EA';
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
  // the Binance bot also sends "strategy":"btc" for its BUY part (v1 BTC rules on the largest coins)
  const strat = b.strategy === 'nas' ? 'nas' : b.strategy === 'snr' ? 'snr' : b.strategy === 'btc' ? 'btc' : 'v2';
  const bot = strat === 'snr' || strat === 'btc';
  const lbl = strat === 'nas' ? 'v1 NAS' : strat === 'snr' ? 'ALT' : strat === 'btc' ? 'BIG' : 'v1 XAU';
  const symbol = typeof b.symbol === 'string' ? b.symbol.replace(/[^0-9A-Za-z]/g, '').slice(0, 24).toUpperCase() : '';
  const src = bot ? `Bot Binance${symbol ? ` ${symbol}` : ''}` : 'EA';
  const who = bot ? `Bot ${lbl}${symbol ? ` ${symbol}` : ''}` : `EA ${lbl}`;
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
    const base = prev ? { ...prev } : { strategy: strat, side: b.side, entry: num(b.entry), sl: num(b.sl), tp: num(b.tp), lot: num(b.lot), openedAt: timeMs, note: src };
    // the Binance bot sends its real average entry price with the close (the open report could carry the signal close price)
    if (prev && bot && num(b.entry) > 0) base.entry = num(b.entry);
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
    const snrText = snrMessage(t, symbol, event, tz, now, lbl);
    const text = bot ? snrText : event === 'open'
      ? [`🤖 <b>${escapeHtml(who)} — ${t.side} terbuka</b>`, '', `<b>Entry:</b> <code>${fp(t.entry)}</code>`, `<b>SL:</b> <code>${fp(t.sl)}</code>`, `<b>TP:</b> <code>${fp(t.tp)}</code>`, `<b>Lot:</b> <code>${t.lot.toFixed(2)}</code>`,
        `<b>Waktu:</b> ${escapeHtml(formatInTz(t.openedAt, tz))}`].join('\n')
      : [`${(t.pnl ?? 0) >= 0 ? '✅' : '❌'} <b>${escapeHtml(who)} — ${t.side} ditutup (${t.result === 'tp' ? 'TP' : t.result === 'sl' ? 'SL' : t.result === 'be' ? 'BE — SL di entry' : 'manual'})</b>`, '',
        `<b>Entry → keluar:</b> ${fp(t.entry)} → ${fp(t.exit ?? 0)}`, `<b>Hasil:</b> ${(t.pnl ?? 0) >= 0 ? '+' : '−'}$${Math.abs(t.pnl ?? 0).toFixed(2)}`,
        `<b>Waktu:</b> ${escapeHtml(formatInTz(t.closedAt ?? now, tz))}`].join('\n');
    const copy = event === 'open' && !bot ? [{ text: 'Salin entry', value: fp(t.entry) }, { text: 'Salin SL', value: fp(t.sl) }, { text: 'Salin TP', value: fp(t.tp) }] : undefined;
    const r = await sendTelegram(db, { deliveryKey: `ea:${event}:${ticket}`, mode: 'LIVE', text, copy }, { fetchImpl: opts.fetchImpl });
    telegram = r.status;
  }
  return { status: 200, body: { ok: true, id, telegram } };
}

/** Telegram layout of the Binance v1 SNR bot: coin, SL/TP distance in %, risk in USDT, result in R and duration. */
export function snrMessage(t: JournalTrade, symbol: string, event: 'open' | 'close', tz: string, now: number, label = 'ALT'): string {
  const fp = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : Math.abs(x) >= 1 ? x.toFixed(4) : x.toPrecision(5));
    const pctOf = (x: number) => `${x >= t.entry ? '+' : '−'}${(Math.abs(x / t.entry - 1) * 100).toFixed(2)}%`;
  const riskUsd = Math.abs(t.entry - t.sl) * t.lot;
  const dur = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 1440 ? `${Math.floor(m / 1440)}h ${Math.floor((m % 1440) / 60)}j` : `${Math.floor(m / 60)}j ${m % 60}m`; };
  const coin = escapeHtml(symbol.replace(/USDT$/, '') || 'koin');
  return event === 'open'
    ? [`${t.side === 'SELL' ? '🔴' : '🟢'} <b>${t.side} ${coin}</b> · ${escapeHtml(label)}`, '━━━━━━━━━━━━',
      `Entry   <code>${fp(t.entry)}</code>`, `SL      <code>${fp(t.sl)}</code>  (${pctOf(t.sl)})`, `TP      <code>${fp(t.tp)}</code>  (${pctOf(t.tp)})`,
      `Risiko  <b>${riskUsd.toFixed(2)} USDT</b> · ${t.lot} ${coin}`, '', `🕐 ${escapeHtml(formatInTz(t.openedAt, tz))}`].join('\n')
    : [`${t.result === 'tp' ? '✅ <b>TP</b>' : t.result === 'sl' ? '❌ <b>SL</b>' : '⚪ <b>Ditutup manual</b>'} · <b>${coin}</b> · ${escapeHtml(label)}`, '━━━━━━━━━━━━',
      `Hasil   <b>${(t.pnl ?? 0) >= 0 ? '+' : '−'}${Math.abs(t.pnl ?? 0).toFixed(2)} USDT</b>${riskUsd > 0 ? `  (${(t.pnl ?? 0) >= 0 ? '+' : '−'}${(Math.abs(t.pnl ?? 0) / riskUsd).toFixed(1)}R)` : ''}`,
      `Harga   ${fp(t.entry)} → ${fp(t.exit ?? 0)}`, `Durasi  ${dur((t.closedAt ?? now) - t.openedAt)}`, '', `🕐 ${escapeHtml(formatInTz(t.closedAt ?? now, tz))}`].join('\n');
}

/** Sends sample bot messages (open, close at TP, info) to Telegram and adds one TEST trade (closed at TP) to the journal. */
export async function sendBotTest(db: Db, opts: { fetchImpl?: FetchLike; now?: number } = {}): Promise<{ sent: string[] }> {
  const now = opts.now ?? Date.now();
  const tz = await repo.getAppSetting<string>(db, 'display_timezone', 'UTC');
  const t: JournalTrade = { id: 'test', strategy: 'snr', side: 'SELL', openedAt: now - 7 * 3_600_000 - 20 * 60_000, entry: 0.2345, sl: 0.2412, tp: 0.2211, lot: 597,
    closedAt: now, exit: 0.2211, result: 'tp', pnl: 7.95, note: 'Bot Binance SANDUSDT' };
  const msgs = [snrMessage({ ...t, result: 'open', exit: null, closedAt: null, pnl: null }, 'SANDUSDT', 'open', tz, now), snrMessage(t, 'SANDUSDT', 'close', tz, now),
    `ℹ️ <b>Bot Binance</b>\n\nRingkasan 08:00 (waktu Korea) — bot aktif.\nSaldo Futures: 207.95 USDT\nSejak ringkasan terakhir: 1 trade selesai (TP 1, SL 0), hasil +7.95 USDT\nPosisi terbuka: tidak ada`];
  // a TEST row in the journal (closed at TP) so the owner can see how bot trades look there; deletable like any trade
  const all = await repo.getAppSetting<JournalTrade[]>(db, 'live_journal', []);
  const list = Array.isArray(all) ? all : [];
  list.push({ ...t, id: `ea-TEST-${now}`, note: 'Bot Binance SANDUSDT (TES — boleh dihapus)' });
  await repo.setAppSetting(db, 'live_journal', list.slice(-3000));
  const sent: string[] = [];
  for (const [i, text] of msgs.entries()) {
    const r = await sendTelegram(db, { deliveryKey: `ea:test:${now}:${i}`, mode: 'LIVE', text: `🧪 <i>CONTOH (tes)</i>\n${text}` }, { fetchImpl: opts.fetchImpl });
    sent.push(r.status);
  }
  return { sent };
}
