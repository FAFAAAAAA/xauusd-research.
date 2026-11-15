import { api } from '@/lib/server/api';
import { bigNews } from '@/lib/server/news-cal';

export const dynamic = 'force-dynamic';

/** The big US news coming up, for the office (see src/lib/server/news-cal.ts). */
export async function GET() {
  return api(async (db) => ({ events: await bigNews(db) }));
}
