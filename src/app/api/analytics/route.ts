import { api, reqUuid } from '@/lib/server/api';
import { analytics } from '@/lib/server/analytics-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return api(async (db) => {
    // session=<id> or several ids joined by commas (e.g. one RR across all years)
    const s = new URL(req.url).searchParams.get('session');
    const ids = s ? s.split(',').slice(0, 40).map((x) => reqUuid(x.trim(), 'session')) : null;
    return analytics(db, ids && ids.length === 1 ? ids[0] : ids);
  });
}
