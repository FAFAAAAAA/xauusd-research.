import { NextResponse } from 'next/server';
import { signSession } from '@/lib/core/crypto';
import { safeEqual, SlidingWindowLimiter } from '@/lib/core/webhook';
import { getConfig } from '@/lib/server/config';

const limiter = new SlidingWindowLimiter(10, 15 * 60_000);
const TTL = 7 * 24 * 3_600_000;

export async function POST(req: Request) {
  const cfg = getConfig();
  if (!cfg.adminPassword || !cfg.sessionSecret || cfg.sessionSecret.length < 32) {
    return NextResponse.json({ ok: false, error: 'ADMIN_PASSWORD dan SESSION_SECRET (≥32 karakter) belum diatur di server' }, { status: 503 });
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!limiter.allow(ip, Date.now())) return NextResponse.json({ ok: false, error: 'Terlalu banyak percobaan, coba lagi nanti' }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (typeof body.password !== 'string' || !safeEqual(body.password, cfg.adminPassword)) {
    return NextResponse.json({ ok: false, error: 'Password salah' }, { status: 401 });
  }
  const exp = Date.now() + TTL;
  const res = NextResponse.json({ ok: true });
  res.cookies.set('xau_session', await signSession(exp, cfg.sessionSecret), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires: new Date(exp),
  });
  return res;
}
