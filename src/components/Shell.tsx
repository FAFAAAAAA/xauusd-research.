'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
        <div className="page"><div className="research-flow"><section className="research-section"><div className="tool-content">{children}</div></section></div></div>
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
