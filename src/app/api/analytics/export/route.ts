import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { toCsv } from '@/lib/core/csv';
import { UUID } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const kind = u.searchParams.get('kind') ?? 'trades';
  const session = u.searchParams.get('session');
  if (session && !UUID.test(session)) return NextResponse.json({ ok: false, error: 'session tidak valid' }, { status: 422 });
  const db = await getDb();
  let rows: Record<string, unknown>[] = [];
  if (kind === 'trades') {
    rows = (await repo.listTrades(db, session)).map((r) => ({
      ...r, entry_time: new Date(Number(r.entry_ms)).toISOString(), exit_time: r.exit_ms ? new Date(Number(r.exit_ms)).toISOString() : null,
      entry_ms: undefined, exit_ms: undefined,
    }));
  } else if (kind === 'events') {
    rows = (await repo.listEvents(db, { limit: 50_000 })).map((e) => ({ ...e, event_time: new Date(e.event_time).toISOString() }));
  } else {
    return NextResponse.json({ ok: false, error: 'kind: trades|events' }, { status: 422 });
  }
  const cols = rows[0] ? Object.keys(rows[0]).filter((k) => rows[0][k] !== undefined) : ['empty'];
  return new NextResponse(toCsv(rows, cols), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="xauusd-${kind}.csv"` },
  });
}
