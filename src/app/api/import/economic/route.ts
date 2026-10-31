import { api, readJson, reqStr } from '@/lib/server/api';
import { importEconomicEventsCsv } from '@/lib/server/import-service';

export async function POST(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    return importEconomicEventsCsv(db, reqStr(b.text, 'text', 4_000_000), { provider: reqStr(b.provider, 'provider', 80), isTest: b.is_test === true });
  });
}
