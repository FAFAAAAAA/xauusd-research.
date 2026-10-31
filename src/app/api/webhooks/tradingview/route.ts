import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';
import { handleTradingViewWebhook, MAX_BODY_BYTES } from '@/lib/server/webhook-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? null;
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });
  try {
    const db = await getDb();
    const res = await handleTradingViewWebhook(db, await req.text(), ip);
    return NextResponse.json(res.body, { status: res.status });
  } catch {
    return NextResponse.json({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }
}
