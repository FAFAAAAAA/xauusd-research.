'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { warm } from '@/components/client';
import { useMarket } from '@/components/MarketSwitch';
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
  // swipe gestures (anywhere on the screen, not only the edge):
  //  - Trade page: swipe left = Forex, swipe right = Crypto (the page follows the finger)
  //  - other pages: swipe right = back (the installed iPhone app has no browser back gesture)
  // Not started on charts, the calendar, inputs, open sheets or anything that scrolls sideways.
  const pageRef = useRef<HTMLDivElement>(null);
  const [market, setMarket] = useMarket();
  const gesture = useRef({ path, market, setMarket });
  gesture.current = { path, market, setMarket };
  useEffect(() => {
    let x0 = 0, y0 = 0, t0 = 0, dx = 0, on = false, locked = false;
    const set = (v: number, anim: boolean) => {
      const e = pageRef.current; if (!e) return;
      e.style.transition = anim ? 'transform .2s cubic-bezier(.2,.8,.2,1), opacity .2s ease' : 'none';
      e.style.transform = v ? `translateX(${v}px)` : ''; e.style.opacity = v ? String(1 - Math.min(0.35, Math.abs(v) / 700)) : '';
    };
    const blocked = (n: EventTarget | null) => {
      for (let el = n as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        if (el.matches('canvas, input, textarea, select, dialog, [data-noswipe], .tv-lightweight-charts')) return true;
        if (el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true;
      }
      return false;
    };
    const start = (e: TouchEvent) => {
      // in Safari (not the installed app) the very left edge belongs to Safari's own back gesture
      const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
      on = e.touches.length === 1 && (standalone || e.touches[0].clientX > 30) && !document.querySelector('dialog[open]') && !blocked(e.target);
      locked = false; dx = 0; const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    };
    const move = (e: TouchEvent) => {
      if (!on) return;
      const t = e.touches[0], mx = t.clientX - x0, my = Math.abs(t.clientY - y0);
      if (!locked) {
        if (my > 10 && my > Math.abs(mx)) { on = false; return; }    // vertical scroll wins
        if (Math.abs(mx) < 8) return;
        locked = true;
      }
      const g = gesture.current, onTrade = g.path.startsWith('/trade');
      // allowed directions: Trade = towards the other market; elsewhere = right (back)
      const ok = onTrade ? (g.market === 'crypto' ? mx < 0 : mx > 0) : mx > 0;
      dx = mx; set(ok ? mx * 0.9 : mx * 0.15, false); e.preventDefault();
    };
    const end = () => {
      if (!on) return; on = false;
      if (!locked) return;
      const g = gesture.current, onTrade = g.path.startsWith('/trade');
      const fast = Math.abs(dx) > 30 && Math.abs(dx) / Math.max(1, Date.now() - t0) > 0.35;
      const far = Math.abs(dx) > Math.min(110, window.innerWidth * 0.28);
      if (!(fast || far)) { set(0, true); return; }
      if (onTrade) {
        const next = dx < 0 ? 'forex' : 'crypto';
        if (next === g.market) { set(0, true); return; }
        g.setMarket(next);
        set(dx < 0 ? 40 : -40, false); requestAnimationFrame(() => set(0, true));   // new market slides in from the swipe side
        return;
      }
      if (dx <= 0) { set(0, true); return; }
      set(window.innerWidth, true);
      if (window.history.length > 1) router.back(); else router.push('/trade');
      window.setTimeout(() => set(0, false), 260);
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
