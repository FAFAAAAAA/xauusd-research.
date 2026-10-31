import { api } from '@/lib/server/api';
import * as repo from '@/lib/server/repo';
import { resolveCredentials } from '@/lib/server/telegram';
import { getConfig } from '@/lib/server/config';
import { toMs } from '@/lib/server/db';
import { eventAsOf } from '@/lib/core/news';

export const dynamic = 'force-dynamic';

export async function GET() {
  return api(async (db) => {
    const now = Date.now();
    const cfg = getConfig();
    const [counts, live, backtest, deliveries, lastHook, latest, tz, coverage] = await Promise.all([
      repo.countEvents(db), repo.listEvents(db, { mode: 'LIVE', limit: 8 }), repo.listEvents(db, { mode: 'BACKTEST', limit: 8 }),
      repo.listDeliveries(db, 5), repo.lastWebhook(db), repo.latestCandle(db),
      repo.getAppSetting<string>(db, 'display_timezone', 'UTC'), repo.dataCoverage(db),
    ]);
    const tgCreds = await resolveCredentials(db, cfg);
    const upcoming = (await repo.economicEventsInWindow(db, now, now + 7 * 86_400_000))
      .map((e) => eventAsOf(e, now)).filter(Boolean).slice(0, 6);
    const replays = await repo.listReplays(db, 5);
    return {
      timezone: tz,
      tradingview: {
        configured: !!cfg.webhookSecret,
        lastStatus: lastHook ? { status: lastHook.status, at: toMs(lastHook.received_at), error: lastHook.error } : null,
      },
      telegram: {
        tokenConfigured: !!tgCreds.token, tokenSource: tgCreds.tokenSource, chatConfigured: !!tgCreds.chatId,
        liveEnabled: tgCreds.settings.live_enabled, backtestEnabled: tgCreds.settings.backtest_enabled,
        lastTest: tgCreds.settings.last_test_at ? { at: tgCreds.settings.last_test_at, ok: tgCreds.settings.last_test_ok, error: tgCreds.settings.last_test_error } : null,
      },
      latestCandle: latest,
      eventCounts: { LIVE: counts.LIVE ?? 0, BACKTEST: counts.BACKTEST ?? 0 },
      liveEvents: live, backtestEvents: backtest,
      lastDeliveries: deliveries,
      upcomingNews: upcoming,
      coverage,
      replays,
    };
  });
}
