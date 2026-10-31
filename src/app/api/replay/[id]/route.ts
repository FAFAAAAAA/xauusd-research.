import { api, readJson, reqUuid } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  return api(async (db) => {
    const s = await repo.getReplay(db, reqUuid(params.id, 'id'));
    if (!s) throw new HttpError(404, 'Tidak ditemukan');
    return s;
  });
}

/** Play / Pause / speed / Telegram toggle / resend policy. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return api(async (db) => {
    const b = await readJson(req);
    const patch: Parameters<typeof repo.updateReplayControls>[2] = {};
    if (b.status !== undefined) {
      if (!['playing', 'paused'].includes(String(b.status))) throw new HttpError(422, 'status hanya playing|paused');
      patch.status = String(b.status);
    }
    if (b.speed !== undefined) {
      if (![1, 2, 5, 10].includes(Number(b.speed))) throw new HttpError(422, 'speed hanya 1,2,5,10');
      patch.speed = Number(b.speed);
    }
    if (b.telegram_enabled !== undefined) patch.telegram_enabled = b.telegram_enabled === true;
    if (b.resend_policy !== undefined) patch.resend_policy = b.resend_policy === 'new_run' ? 'new_run' : 'never';
    const cur = await repo.getReplay(db, reqUuid(params.id, 'id'));
    if (!cur) throw new HttpError(404, 'Tidak ditemukan');
    if (cur.status === 'finished' && patch.status === 'playing') throw new HttpError(409, 'Replay selesai — tekan Reset');
    return repo.updateReplayControls(db, cur.id, patch);
  });
}
