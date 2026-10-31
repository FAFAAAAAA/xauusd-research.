import { api, reqUuid } from '@/lib/server/api';
import { visibleCandles } from '@/lib/server/replay-service';

export const dynamic = 'force-dynamic';

/** Only candles up to the replay cursor — the future is never sent to the browser. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return api(async (db) => visibleCandles(db, reqUuid(params.id, 'id'), Number(new URL(req.url).searchParams.get('limit')) || 1500));
}
