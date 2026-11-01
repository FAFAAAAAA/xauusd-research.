import { api, readJson } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { getConfig } from '@/lib/server/config';
import { feedApiKey, newCronKey, runFeedTick } from '@/lib/server/live-feed';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Settings & status of the free live-signal feed (Twelve Data + external scheduler). The API key is never sent back. */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return api(async (db) => {
    const k = await feedApiKey(db);
    const cron = await repo.getAppSetting<{ createdAt?: number } | null>(db, 'cron_key_hash', null);
    return {
      apiKeySource: k.source, apiKeyHint: k.key ? `••••${k.key.slice(-4)}` : null,
      cronConfigured: !!cron, status: await repo.getAppSetting(db, 'feed_status', null),
      tickUrlBase: `${getConfig().appBaseUrl ?? origin}/api/live/tick`,
    };
  });
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  return api(async (db) => {
    const b = await readJson(req);
    if (b.action === 'apikey') {
      const v = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
      if (v && !/^[A-Za-z0-9]{8,80}$/.test(v)) throw new HttpError(422, 'API key tidak valid');
      await repo.setAppSetting(db, 'feed', { apiKey: v || null });
      return { saved: true };
    }
    if (b.action === 'cronkey') {
      const key = await newCronKey(db);
      return { key, url: `${getConfig().appBaseUrl ?? origin}/api/live/tick?key=${key}` };
    }
    if (b.action === 'test') return runFeedTick(db);
    throw new HttpError(422, 'action tidak dikenal');
  });
}
