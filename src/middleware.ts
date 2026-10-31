import { NextResponse, type NextRequest } from 'next/server';
import { verifySession } from './lib/core/crypto';

// Everything is admin-only except the login page/endpoint, the TradingView webhook
// (authenticated by its own shared secret) and a minimal health probe.
const PUBLIC = [/^\/login$/, /^\/api\/auth\/login$/, /^\/api\/webhooks\/tradingview$/, /^\/api\/health$/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  const ok = await verifySession(req.cookies.get('xau_session')?.value, process.env.SESSION_SECRET ?? '', Date.now());
  if (ok) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'] };
