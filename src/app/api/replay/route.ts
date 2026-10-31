import { api, readJson, reqUuid } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { createReplaySession } from '@/lib/server/replay-service';
import { parseTimestamp } from '@/lib/core/time';
import { isTimeframe } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  return api(async (db) => repo.listReplays(db, 30));
}

export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    if (!isTimeframe(b.timeframe)) throw new HttpError(422, 'timeframe tidak valid');
    const start = parseTimestamp(b.start_time);
    if (start === null) throw new HttpError(422, 'start_time wajib (ISO dengan zona waktu)');
    const params = b.params && typeof b.params === 'object' ? (b.params as Record<string, unknown>) : {};
    return createReplaySession(db, {
      sourceId: reqUuid(b.source_id, 'source_id'), timeframe: b.timeframe, startTime: start,
      strategyVersionId: b.strategy_version_id ? reqUuid(b.strategy_version_id, 'strategy_version_id') : null,
      params, resendPolicy: b.resend_policy === 'new_run' ? 'new_run' : 'never',
    });
  });
}
