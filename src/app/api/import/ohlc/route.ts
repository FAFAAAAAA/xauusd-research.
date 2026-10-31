import { api, readJson, reqUuid, optStr } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import { importOhlcChunk } from '@/lib/server/import-service';
import { isTimeframe } from '@/lib/core/types';

export const maxDuration = 60;

/** One chunk of a CSV file (the browser splits large files, ~5k lines per request). */
export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    if (!isTimeframe(b.timeframe)) throw new HttpError(422, 'timeframe tidak valid');
    if (typeof b.text !== 'string' || b.text.length > 4_000_000) throw new HttpError(422, 'text wajib (maks 4MB per chunk)');
    return importOhlcChunk(db, {
      sourceId: reqUuid(b.source_id, 'source_id'), timeframe: b.timeframe, text: b.text,
      header: optStr(b.header, 1000) ?? undefined, lineOffset: Number(b.line_offset) || undefined,
      batchId: b.batch_id ? reqUuid(b.batch_id, 'batch_id') : null, filename: optStr(b.filename, 200),
    });
  });
}
