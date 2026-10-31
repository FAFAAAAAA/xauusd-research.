import { api } from '@/lib/server/api';
import * as repo from '@/lib/server/repo';
import { eventAsOf } from '@/lib/core/news';
import { parseTimestamp } from '@/lib/core/time';

export const dynamic = 'force-dynamic';

/**
 * Calendar view. With ?as_of=ISO the list is filtered exactly as a replay at that
 * moment would see it: unpublished actuals are hidden, unknown schedules are hidden.
 */
export async function GET(req: Request) {
  return api(async (db) => {
    const u = new URL(req.url);
    const asOf = parseTimestamp(u.searchParams.get('as_of')) ?? Date.now();
    const from = parseTimestamp(u.searchParams.get('from')) ?? asOf - 7 * 86_400_000;
    const to = parseTimestamp(u.searchParams.get('to')) ?? asOf + 7 * 86_400_000;
    const raw = await repo.economicEventsInWindow(db, from, to);
    const sentiments = await repo.sentimentsFor(db, raw.map((e) => e.id));
    const events = raw.map((e) => {
      const v = eventAsOf(e, asOf);
      if (!v) return null;
      const s = sentiments.get(e.id);
      return { ...v, sentiment: s && s.availableAt <= asOf ? s : null };
    }).filter(Boolean);
    const articles = await repo.articlesAvailableInWindow(db, from, Math.min(to, asOf));
    const archive = await repo.newsArchiveCoverage(db, asOf, Math.ceil((to - from) / 86_400_000));
    return { asOf, from, to, archiveAvailable: archive, events, articles };
  });
}
