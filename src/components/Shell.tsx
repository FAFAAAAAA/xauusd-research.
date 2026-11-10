'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { warm } from '@/components/client';
import { Toaster } from '@/components/Status';

/* 9 Nov 2026: Trade is the main page; the other pages live in the three-line menu (one page at a time, so nothing else loads
   in the background). The news page is no longer in the menu. */
const LINKS = [
  { href: '/trade', label: 'Trade' },
  { href: '/analytics', label: 'Backtest' },
  { href: '/calculator', label: 'Kalkulator' },
  { href: '/settings', label: 'Atur' },
] as const;

export default function Shell({ children, showLogout = false }: { children: React.ReactNode; showLogout?: boolean }) {
  const path = usePathname();
  const [pending, setPending] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setPending(null); setMenuOpen(false); }, [path]);
  // after the first page shows: prepare the other pages and their data, so switching is instant
  const router = useRouter();
  useEffect(() => {
    const id = window.setTimeout(() => {
      for (const l of LINKS) router.prefetch(l.href);
      warm(['/api/journal', '/api/live', '/api/settings', '/api/analytics']);
    }, 1200);
    return () => window.clearTimeout(id);
  }, [router]);
  // installed app (home screen) has no browser back gesture: swipe right from the left edge = back (the page follows the finger)
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (!standalone) return;
    let x0 = 0, y0 = 0, dx = 0, on = false, locked = false;
    const el = () => pageRef.current;
    const set = (v: number, anim: boolean) => { const e = el(); if (!e) return; e.style.transition = anim ? 'transform .22s ease, opacity .22s ease' : 'none'; e.style.transform = v ? `translateX(${v}px)` : ''; e.style.opacity = v ? String(1 - Math.min(0.4, v / 600)) : ''; };
    const start = (e: TouchEvent) => { const t = e.touches[0]; on = t.clientX < 28 && e.touches.length === 1; locked = false; x0 = t.clientX; y0 = t.clientY; dx = 0; };
    const move = (e: TouchEvent) => {
      if (!on) return;
      const t = e.touches[0], mx = t.clientX - x0, my = Math.abs(t.clientY - y0);
      if (!locked) { if (my > 12 && my > mx) { on = false; return; } if (mx > 10) locked = true; else return; }
      dx = Math.max(0, mx); set(dx * 0.7, false); e.preventDefault();
    };
    const end = () => {
      if (!on) return; on = false;
      if (locked && dx > 90) {
        set(window.innerWidth, true);
        window.setTimeout(() => { if (window.history.length > 1 && location.pathname !== '/trade') router.back(); else if (location.pathname !== '/trade') router.push('/trade'); set(0, false); }, 180);
      } else set(0, true);
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);
    return () => { document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', end); };
  }, [router]);
  const cur = pending ?? path;
  const active = (href: string) => cur.startsWith(href);
  const go = (href: string) => () => {
    setMenuOpen(false);
    if (href !== path) setPending(href);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };
  return (
    <div className="shell apple-shell">
      <header className="apple-topbar">
        <div className="apple-topbar-inner">
          <Link href="/trade" className="apple-brand" aria-label="Trade" onClick={go('/trade')}>
            <span className="apple-brand-symbol" aria-hidden>Au</span>
          </Link>
          <nav className="apple-nav-links" aria-label="Navigasi utama">
            {LINKS.map((item) => (
              <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined} onClick={go(item.href)}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="apple-nav-actions">
            <button
              type="button"
              className={'apple-menu-toggle' + (menuOpen ? ' is-open' : '')}
              aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'}
              aria-expanded={menuOpen}
              aria-controls="apple-mobile-menu"
              onClick={() => setMenuOpen((v) => !v)}
            ><span /><span /><span /></button>
          </div>
        </div>
        <nav id="apple-mobile-menu" className={'apple-mobile-menu' + (menuOpen ? ' is-open' : '')} aria-label="Menu mobile" hidden={!menuOpen}>
          {LINKS.map((item) => <Link key={item.href} href={item.href} onClick={go(item.href)} aria-current={active(item.href) ? 'page' : undefined}>{item.label}<span aria-hidden>↗</span></Link>)}
        </nav>
      </header>
      <main className="main" aria-busy={pending ? true : undefined}>
        {/* the research-flow / research-section wrappers carry the page styles (pills, cards, radii) */}
        <div className="page" ref={pageRef}><div className="research-flow"><section className="research-section"><div className="tool-content">{children}</div></section></div></div>
        {showLogout ? <div className="mobile-only-logout"><button className="btn sm ghost" onClick={logout}>Keluar</button></div> : null}
      </main>
      <footer className="apple-site-footer">
        <span>© XAUUSD Research</span>
        {showLogout ? <button className="apple-logout" onClick={logout}>Keluar</button> : null}
      </footer>
      <Toaster />
    </div>
  );
}
