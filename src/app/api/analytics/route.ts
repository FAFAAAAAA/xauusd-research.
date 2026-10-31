import { api, reqUuid } from '@/lib/server/api';
import { analytics } from '@/lib/server/analytics-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return api(async (db) => {
    const s = new URL(req.url).searchParams.get('session');
    return analytics(db, s ? reqUuid(s, 'session') : null);
  });
}
