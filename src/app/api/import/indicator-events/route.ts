import { api, readJson, reqStr } from '@/lib/server/api';
import { importIndicatorEventsCsv } from '@/lib/server/import-service';

export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    return importIndicatorEventsCsv(db, reqStr(b.text, 'text', 4_000_000), { isTest: b.is_test === true });
  });
}
