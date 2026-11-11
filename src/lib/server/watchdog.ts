import type { Db } from './db';
import * as repo from './repo';
import { sendTelegram, type FetchLike } from './telegram';
import { formatInTz } from '../core/time';

/**
 * Watchdog (11 Nov 2026): the Binance bot and the MT5 EA report their balance at least every 15 minutes
 * (every minute while positions are open). If one of them has been silent for longer than LIMIT, send ONE Telegram warning;
 * when it reports again, send ONE "back online" message. Only sources that have reported before are watched.
 * Called every ~10 minutes by a scheduled GitHub Action (GET /api/watchdog). Idempotent: repeated calls do not repeat messages.
 */
const LIMIT = 35 * 60_000;
const SRC = [
  { key: 'binance_balance', name: 'Bot Binance (ALT + BIG)', fix: 'Cek VPS: buka Command Prompt → cd C:\\snrbot → python snr_bot.py --status' },
  { key: 'mt5_balance', name: 'EA MT5 (FundingPips)', fix: 'Cek VPS: MT5 masih terbuka, tombol Algo Trading hijau, ikon topi biru di chart XAUUSD.' },
] as const;

export async function runWatchdog(db: Db, now = Date.now(), fetchImpl?: FetchLike) {
  const state = await repo.getAppSetting<Record<string, number | null>>(db, 'watchdog_state', {});
  const tz = await repo.getAppSetting<string>(db, 'display_timezone', 'UTC');
  const tg = await repo.getTelegramSettings(db);
  const out: Record<string, string> = {};
  let changed = false;
  for (const s of SRC) {
    const last = await repo.getAppSetting<{ at?: number } | null>(db, s.key, null);
    if (!last?.at) { out[s.key] = 'never'; continue; }
    const age = now - last.at, alerted = state[s.key] ?? null;
    if (age > LIMIT && !alerted) {
      const min = Math.round(age / 60_000);
      const text = `⚠️ <b>${s.name} tidak melapor</b>\n\nLaporan terakhir ${formatInTz(last.at, tz)} (${min} menit lalu).\nMungkin VPS mati/restart, internet putus, atau program berhenti.\n\n${s.fix}`;
      if (tg.live_enabled) await sendTelegram(db, { deliveryKey: `watchdog:${s.key}:${last.at}`, mode: 'LIVE', text }, { fetchImpl });
      state[s.key] = now; changed = true; out[s.key] = 'alert';
    } else if (age <= LIMIT && alerted) {
      const text = `✅ <b>${s.name} kembali melapor</b>\n\nLaporan terbaru ${formatInTz(last.at, tz)}.`;
      if (tg.live_enabled) await sendTelegram(db, { deliveryKey: `watchdog:${s.key}:ok:${last.at}`, mode: 'LIVE', text }, { fetchImpl });
      state[s.key] = null; changed = true; out[s.key] = 'recovered';
    } else out[s.key] = alerted ? 'still-silent' : 'ok';
  }
  if (changed) await repo.setAppSetting(db, 'watchdog_state', state);
  return out;
}
