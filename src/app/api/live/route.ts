import { api, readJson } from '@/lib/server/api';
import * as repo from '@/lib/server/repo';
import { readLiveRisk } from '@/lib/core/journal';
import { getConfig } from '@/lib/server/config';

export const dynamic = 'force-dynamic';

/** Live trading page data: risk plan (used for the lot in Telegram signals) + latest LIVE signals from TradingView. */
export async function GET() {
  return api(async (db) => {
    const cfg = getConfig();
    const [risk, events, tz, hook] = await Promise.all([
      repo.getAppSetting(db, 'live_risk', null), repo.listEvents(db, { mode: 'LIVE', limit: 20 }),
      repo.getAppSetting<string>(db, 'display_timezone', 'UTC'), repo.lastWebhook(db),
    ]);
    return {
      risk: readLiveRisk(risk), events, timezone: tz,
      webhook: { configured: !!cfg.webhookSecret, url: cfg.appBaseUrl ? `${cfg.appBaseUrl}/api/webhooks/tradingview` : null, last: hook ? { status: hook.status, error: hook.error } : null },
    };
  });
}

export async function PUT(req: Request) {
  return api(async (db) => {
    const r = readLiveRisk(await readJson(req));
    await repo.setAppSetting(db, 'live_risk', r);
    return { risk: r };
  });
}
