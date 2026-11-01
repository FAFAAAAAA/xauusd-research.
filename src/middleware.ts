import { NextResponse, type NextRequest } from 'next/server';
import { verifySession } from './lib/core/crypto';

// Login is OFF by default (owner's choice). Set REQUIRE_LOGIN=true in Vercel to turn it back on.
// The TradingView webhook is always protected by its own shared secret.
const PUBLIC = [/^\/login$/, /^\/api\/auth\/login$/, /^\/api\/webhooks\/tradingview$/, /^\/api\/ea\/report$/, /^\/api\/health$/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (process.env.REQUIRE_LOGIN !== 'true') {
    if (pathname === '/login') {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  const ok = await verifySession(req.cookies.get('xau_session')?.value, process.env.SESSION_SECRET ?? '', Date.now());
  if (ok) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|apple-touch-icon.png|icon-192.png|icon-512.png|pine/).*)'] };
