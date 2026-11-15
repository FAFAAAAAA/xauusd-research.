import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';
import { runWatchdog } from '@/lib/server/watchdog';
import { runCompanyTick } from '@/lib/server/company';
import { runNewsReminder } from '@/lib/server/news-cal';

export const dynamic = 'force-dynamic';

/** Scheduled check (GitHub Action every ~10 min): warns on Telegram when the bot / EA stops reporting. Reveals nothing; safe to call repeatedly. */
export async function GET() {
  try {
    const db = await getDb();
    await runWatchdog(db);
    try { await runCompanyTick(db); } catch { /* company messages are best effort */ }
    try { await runNewsReminder(db); } catch { /* news reminder is best effort */ }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
