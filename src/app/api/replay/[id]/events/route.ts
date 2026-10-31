import { api, reqUuid } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { TIMEFRAME_MS } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  return api(async (db) => {
    const s = await repo.getReplay(db, reqUuid(params.id, 'id'));
    if (!s) throw new HttpError(404, 'Tidak ditemukan');
    if (s.cursor_time == null) return [];
    return repo.listEvents(db, { replaySessionId: s.id, upTo: s.cursor_time + TIMEFRAME_MS[s.timeframe], limit: 500 });
  });
}
