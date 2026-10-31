import { api, reqUuid } from '@/lib/server/api';
import { resetReplaySession } from '@/lib/server/replay-service';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  return api(async (db) => resetReplaySession(db, reqUuid(params.id, 'id')));
}
