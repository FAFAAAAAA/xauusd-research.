'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Toaster } from '@/components/Status';

const I = {
  home: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  calc: <><rect x="6" y="3.5" width="12" height="17" rx="2" /><path d="M9 7.5h6M9 12h.01M12 12h.01M15 12h.01M9 15.5h.01M12 15.5h.01M15 15.5h.01" /></>,
  trade: <path d="M7 17V5M4 8l3-3 3 3M17 7v12M14 16l3 3 3-3" />,
  results: <path d="M5 19V11M10 19V6M15 19v-5M20 19V9" />,
  news: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 12h8M8 15h5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
};
const MOBILE_ITEMS = [
  { href: '/', label: 'Beranda', icon: I.home },
  { href: '/trade', label: 'Trade', icon: I.trade },
  { href: '/calculator', label: 'Kalkulator', icon: I.calc },
  { href: '/analytics', label: 'Backtest', icon: I.results },
  { href: '/settings', label: 'Atur', icon: I.settings },
];
const LINKS = [
  MOBILE_ITEMS[0], MOBILE_ITEMS[1], MOBILE_ITEMS[2], MOBILE_ITEMS[3],
  { href: '/news', label: 'Berita', icon: I.news }, MOBILE_ITEMS[4],
];
const Icon = ({ d }: { d: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);

export default function Shell({ children, showLogout = false }: { children: React.ReactNode; showLogout?: boolean }) {
  const path = usePathname();
  const [pending, setPending] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setPending(null); setMenuOpen(false); }, [path]);
  const cur = pending ?? path;
  const active = (href: string) => href === '/' ? cur === '/' : cur.startsWith(href);
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
          <Link href="/" className="apple-brand" onClick={go('/')}>
            <span className="apple-brand-symbol" aria-hidden>Au</span>
            <span>XAUUSD <strong>Research</strong></span>
          </Link>
          <nav className="apple-nav-links" aria-label="Navigasi utama">
            {LINKS.map((item) => (
              <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined} onClick={go(item.href)}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="apple-nav-actions">
            <Link href="/analytics" className="apple-nav-cta" onClick={go('/analytics')}>Mulai backtest <span aria-hidden>↗</span></Link>
            <button
              type="button"
              className={'apple-menu-toggle' + (menuOpen ? ' is-open' : '')}
              aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'}
              aria-expanded={menuOpen}
              aria-controls="apple-mobile-menu"
              onClick={() => setMenuOpen((v) => !v)}
            ><span /><span /></button>
          </div>
        </div>
        <nav id="apple-mobile-menu" className={'apple-mobile-menu' + (menuOpen ? ' is-open' : '')} aria-label="Menu mobile" hidden={!menuOpen}>
          {LINKS.map((item) => <Link key={item.href} href={item.href} onClick={go(item.href)} aria-current={active(item.href) ? 'page' : undefined}>{item.label}<span aria-hidden>↗</span></Link>)}
        </nav>
      </header>
      <main className="main" aria-busy={pending ? true : undefined}>
        <div key={path} className="page">{children}</div>
        {showLogout ? <div className="mobile-only-logout"><button className="btn sm ghost" onClick={logout}>Keluar</button></div> : null}
      </main>
      <footer className="apple-site-footer">
        <span>© XAUUSD Research</span>
        <span>Riset perdagangan dan backtest. Bukan nasihat keuangan.</span>
        {showLogout ? <button className="apple-logout" onClick={logout}>Keluar</button> : null}
      </footer>
      <nav className="tabbar" aria-label="Navigasi cepat">
        {MOBILE_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} onClick={go(item.href)} aria-current={active(item.href) ? 'page' : undefined}>
            <span className="ic"><Icon d={item.icon} /></span>{item.label}
          </Link>
        ))}
      </nav>
      <Toaster />
    </div>
  );
}
