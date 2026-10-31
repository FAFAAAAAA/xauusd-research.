import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Public liveness probe — reveals nothing beyond up/down. */
export async function GET() {
  try {
    const db = await getDb();
    await db.query('select 1 as ok');
    return NextResponse.json({ ok: true, db: 'up' });
  } catch {
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 });
  }
}
