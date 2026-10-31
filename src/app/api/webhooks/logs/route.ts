import { api } from '@/lib/server/api';
import * as repo from '@/lib/server/repo';

export const dynamic = 'force-dynamic';

export async function GET() {
  return api(async (db) => repo.listWebhookLogs(db, 100));
}
