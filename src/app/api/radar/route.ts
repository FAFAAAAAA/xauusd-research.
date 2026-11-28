import { api } from '@/lib/server/api';
import * as repo from '@/lib/server/repo';
import { buildRadar, radarView, type RadarData } from '@/lib/server/radar';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const H4 = 4 * 3_600_000;

/** Coins close to a bot signal (public Binance data, bot rules). Levels rebuilt once per H4 candle; live prices on every call. */
export async function GET() {
  return api(async (db) => {
    const now = Date.now(), bar = Math.floor(now / H4) * H4;
    let data = await repo.getAppSetting<RadarData | null>(db, 'radar_cache', null);
    // a new H4 candle (or a stale / missing cache): rebuild. Wait a minute after the close so Binance has the closed candle.
    if (!data || (data.bar !== bar && now - bar > 60_000) || now - data.builtAt > H4 + 600_000) {
      // parts switched off in Kontrol bot are left out (values the website sends; unset = the bot's default: on)
      const ctl = await repo.getAppSetting<{ set?: Record<string, unknown> } | null>(db, 'bot_control', null);
      const on = (k: string) => ctl?.set?.[k] !== false;
      data = await buildRadar(now, { btc: on('buy_enabled'), mb: on('mb_enabled'), lst: on('lst_enabled') });
      await repo.setAppSetting(db, 'radar_cache', data);
    }
    return radarView(data, now);
  });
}
