import { api } from '@/lib/server/api';
import * as repo from '@/lib/server/repo';
import { botChanges, cleanBotControl, DEFAULT_BOT_CONTROL, type BotControl, type BotLogEntry, type BotSeen } from '@/lib/core/bot-control';

export const dynamic = 'force-dynamic';
type Db = Parameters<Parameters<typeof api>[0]>[0];

async function state(db: Db) {
  return {
    control: cleanBotControl(await repo.getAppSetting<BotControl | null>(db, 'bot_control', null) ?? DEFAULT_BOT_CONTROL),
    seen: await repo.getAppSetting<BotSeen | null>(db, 'bot_control_seen', null),
    balance: (await repo.getAppSetting<{ wallet?: number } | null>(db, 'binance_balance', null))?.wallet ?? null,
    log: await repo.getAppSetting<BotLogEntry[]>(db, 'bot_control_log', []),
  };
}

/** Remote settings for the Binance bot (the bot fetches them itself; nothing is sent to Binance from here). */
export async function GET() {
  return api((db) => state(db));
}
export async function PUT(req: Request) {
  return api(async (db) => {
    const body = await req.json().catch(() => ({}));
    const c = cleanBotControl(body, Date.now());
    c.updatedAt = Date.now();
    const prev = cleanBotControl(await repo.getAppSetting<BotControl | null>(db, 'bot_control', null) ?? DEFAULT_BOT_CONTROL);
    c.resetAt = prev.resetAt; c.closeAllAt = prev.closeAllAt;                       // one-shot commands only change through their own flag
    const b = (body ?? {}) as Record<string, unknown>;
    if (b.reset === true) c.resetAt = Date.now();                                       // reset the loss-streak brake once
    // emergency: the bot closes all ITS positions at market and pauses (two confirmations in the app; the bot itself sends the orders)
    if (b.closeAll === true && b.confirm === 'TUTUP SEMUA') { c.closeAllAt = Date.now(); c.paused = true; }
    await repo.setAppSetting(db, 'bot_control', c);
    const items = botChanges(prev, c);
    if (items.length) {
      const log = await repo.getAppSetting<BotLogEntry[]>(db, 'bot_control_log', []);
      await repo.setAppSetting(db, 'bot_control_log', [{ at: c.updatedAt, items }, ...(Array.isArray(log) ? log : [])].slice(0, 40));
    }
    return state(db);
  });
}
