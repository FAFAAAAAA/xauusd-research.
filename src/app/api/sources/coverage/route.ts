import { api } from '@/lib/server/api';
import * as repo from '@/lib/server/repo';

export const dynamic = 'force-dynamic';

/** The date ranges that ACTUALLY exist in the database, per source and timeframe. */
export async function GET() {
  return api(async (db) => repo.dataCoverage(db));
}
