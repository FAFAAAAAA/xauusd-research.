import { api } from '@/lib/server/api';
import * as repo from '@/lib/server/repo';
import { sendTelegram } from '@/lib/server/telegram';
import { buildTestMessage } from '@/lib/core/telegram-format';

/** Sends a REAL message. Reports success only if Telegram returns ok:true with a message_id. */
export async function POST() {
  return api(async (db) => {
    const tz = await repo.getAppSetting<string>(db, 'display_timezone', 'UTC');
    const r = await sendTelegram(db, { deliveryKey: `test:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, mode: 'TEST', text: buildTestMessage(Date.now(), tz) });
    await repo.updateTelegramSettings(db, { last_test_ok: r.status === 'sent', last_test_error: r.status === 'sent' ? null : r.error ?? r.status });
    return r;
  });
}
