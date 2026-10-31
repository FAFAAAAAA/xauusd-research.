import { api, readJson, reqUuid } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import { deriveTimeframes } from '@/lib/server/import-service';
import { isTimeframe, type Timeframe } from '@/lib/core/types';

export const maxDuration = 300;

export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    if (!isTimeframe(b.from)) throw new HttpError(422, 'from timeframe tidak valid');
    const targets = Array.isArray(b.targets) ? (b.targets.filter(isTimeframe) as Timeframe[]) : null;
    const alignment = b.alignment === 'ny_close' ? 'ny_close' : 'utc';
    return deriveTimeframes(db, reqUuid(b.source_id, 'source_id'), b.from, targets, alignment);
  });
}
