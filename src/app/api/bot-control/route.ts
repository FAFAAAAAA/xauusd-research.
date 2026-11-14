import { api } from '@/lib/server/api';
import * as repo from '@/lib/server/repo';
import { cleanBotControl, DEFAULT_BOT_CONTROL, type BotControl, type BotSeen } from '@/lib/core/bot-control';

export const dynamic = 'force-dynamic';

/** Remote settings for the Binance bot (the bot fetches them itself; nothing is sent to Binance from here). */
export async function GET() {
  return api(async (db) => ({
    control: cleanBotControl(await repo.getAppSetting<BotControl | null>(db, 'bot_control', null) ?? DEFAULT_BOT_CONTROL),
    seen: await repo.getAppSetting<BotSeen | null>(db, 'bot_control_seen', null),
  }));
}
export async function PUT(req: Request) {
  return api(async (db) => {
    const body = await req.json().catch(() => ({}));
    const c = cleanBotControl(body, Date.now());
    c.updatedAt = Date.now();
    if (body && (body as Record<string, unknown>).reset === true) c.resetAt = Date.now();   // reset the loss-streak brake once
    await repo.setAppSetting(db, 'bot_control', c);
    return { control: c, seen: await repo.getAppSetting<BotSeen | null>(db, 'bot_control_seen', null) };
  });
}
