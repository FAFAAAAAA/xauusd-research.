import { api, readJson, reqUuid } from '@/lib/server/api';
import { stepReplay } from '@/lib/server/replay-service';

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return api(async (db) => {
    const b = await readJson(req);
    const expected = b.expected_cursor === null ? null : typeof b.expected_cursor === 'number' ? b.expected_cursor : undefined;
    return stepReplay(db, reqUuid(params.id, 'id'), { count: Number(b.count) || 1, manual: b.manual === true, expectedCursor: expected });
  });
}
