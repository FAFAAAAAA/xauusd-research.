import { api, readJson, reqUuid } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';

export const dynamic = 'force-dynamic';

/** DELETE { ids: [...] } — removes backtest sessions, their trades and their signal events. */
export async function DELETE(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 2000) throw new HttpError(422, 'ids wajib (1–2000)');
    const ids = (b.ids as unknown[]).map((x) => reqUuid(x, 'id'));
    return { deleted: await repo.deleteBacktestSessions(db, ids) };
  });
}
