import { api, reqUuid } from '@/lib/server/api';
import { replaySnrView } from '@/lib/server/replay-service';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return api((db) => replaySnrView(db, reqUuid(params.id, 'id')));
}
