import { api, readJson, reqUuid } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import { sendTelegram } from '@/lib/server/telegram';

/** Explicit, user-initiated retry of a FAILED delivery (same idempotency key). */
export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    const id = reqUuid(b.id, 'id');
    const r = await db.query<{ delivery_key: string; mode: 'LIVE' | 'BACKTEST' | 'TEST'; message_text: string; market_event_id: string | null; replay_session_id: string | null; status: string }>(
      'select delivery_key, mode, message_text, market_event_id, replay_session_id, status from telegram_delivery_logs where id=$1', [id]);
    const d = r[0];
    if (!d) throw new HttpError(404, 'Log tidak ditemukan');
    if (d.status !== 'failed') throw new HttpError(409, 'Hanya pengiriman berstatus failed yang bisa diulang');
    return sendTelegram(db, { deliveryKey: d.delivery_key, mode: d.mode, text: d.message_text, marketEventId: d.market_event_id, replaySessionId: d.replay_session_id, allowRetryFailed: true });
  });
}
