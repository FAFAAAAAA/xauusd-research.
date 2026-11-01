import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';
import { handleEaReport } from '@/lib/server/ea-service';

export const dynamic = 'force-dynamic';

/** Called by the MetaTrader 5 EA (WebRequest) after an entry or an exit. Authenticated by the EA key. */
export async function POST(req: Request) {
  try {
    const db = await getDb();
    const r = await handleEaReport(db, await req.text());
    return NextResponse.json(r.body, { status: r.status });
  } catch {
    return NextResponse.json({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }
}
