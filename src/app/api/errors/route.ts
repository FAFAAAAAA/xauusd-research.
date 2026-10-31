import { api } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  return api(async (db) => db.query('select id, occurred_at, scope, message from system_errors order by occurred_at desc limit 50'));
}
