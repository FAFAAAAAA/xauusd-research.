import { api, readJson, reqNum, reqUuid, optStr } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { parseTimestamp } from '@/lib/core/time';
import { isTimeframe } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  return api(async (db) => repo.listZones(db));
}

/** Manually entered zones (the owner's own levels) or TEST zones. Never auto-generated. */
export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    const low = reqNum(b.low, 'low'), high = reqNum(b.high, 'high');
    if (low <= 0 || high < low) throw new HttpError(422, 'Zona harus 0 < low ≤ high');
    const validFrom = parseTimestamp(b.valid_from);
    if (validFrom === null) throw new HttpError(422, 'valid_from wajib (kapan zona ini diketahui, ISO+zona)');
    const mode = b.mode === 'LIVE' ? 'LIVE' : 'BACKTEST';
    const kind = ['support', 'resistance'].includes(String(b.kind)) ? String(b.kind) : 'unknown';
    return {
      id: await repo.createZone(db, {
        instrumentId: await repo.getInstrumentId(db), mode, kind, low, high, timeframe: isTimeframe(b.timeframe) ? b.timeframe : null,
        origin: b.is_test === true ? 'test' : 'manual', validFrom, validUntil: parseTimestamp(b.valid_until),
        replaySessionId: b.replay_session_id ? reqUuid(b.replay_session_id, 'replay_session_id') : null,
        isTest: b.is_test === true, notes: optStr(b.notes, 500),
      }),
    };
  });
}

export async function DELETE(req: Request) {
  return api(async (db) => {
    const id = reqUuid(new URL(req.url).searchParams.get('id'), 'id');
    await repo.deleteZone(db, id);
    return { deleted: id };
  });
}
