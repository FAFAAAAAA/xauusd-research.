import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';
import { checkCronKey, runFeedTick } from '@/lib/server/live-feed';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Called every 15 minutes by an external scheduler (cron-job.org): /api/live/tick?key=… */
async function handle(req: Request) {
  try {
    const db = await getDb();
    if (!(await checkCronKey(db, new URL(req.url).searchParams.get('key')))) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    const r = await runFeedTick(db);
    return NextResponse.json({ ok: r.ok, lastBar: r.lastBar, signals: r.signals.length, error: r.error ?? null }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }
}
export const GET = handle;
export const POST = handle;
