import { api, reqUuid } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { loadNewsWindow, snapshotAt, summarizeNews } from '@/lib/server/news-service';
import { TIMEFRAME_MS } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

/** News as it was known at the replay's current market time (anti-lookahead). */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  return api(async (db) => {
    const s = await repo.getReplay(db, reqUuid(params.id, 'id'));
    if (!s) throw new HttpError(404, 'Tidak ditemukan');
    const now = (s.cursor_time ?? s.start_time) + (s.cursor_time != null ? TIMEFRAME_MS[s.timeframe] : 0);
    const w = await loadNewsWindow(db, now, now);
    const snap = snapshotAt(w, now);
    return { marketTime: now, ...snap, summary: summarizeNews(snap) };
  });
}
