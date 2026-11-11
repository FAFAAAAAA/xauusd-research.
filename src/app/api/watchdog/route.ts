import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';
import { runWatchdog } from '@/lib/server/watchdog';

export const dynamic = 'force-dynamic';

/** Scheduled check (GitHub Action every ~10 min): warns on Telegram when the bot / EA stops reporting. Reveals nothing; safe to call repeatedly. */
export async function GET() {
  try {
    await runWatchdog(await getDb());
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
