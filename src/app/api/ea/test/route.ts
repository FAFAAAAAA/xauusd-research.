import { api } from '@/lib/server/api';
import { sendBotTest } from '@/lib/server/ea-service';

export const dynamic = 'force-dynamic';

/** Owner button (Atur → EA): sends sample v1 SNR bot messages to Telegram. Also adds one TEST trade to the journal (deletable). */
export async function POST() {
  return api(async (db) => sendBotTest(db));
}
