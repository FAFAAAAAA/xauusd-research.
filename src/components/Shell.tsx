'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ResearchFlow, { RESEARCH_LINKS } from '@/components/ResearchFlow';
import { Toaster } from '@/components/Status';

const LINKS = RESEARCH_LINKS;

export default function Shell({ children, showLogout = false }: { children: React.ReactNode; showLogout?: boolean }) {
  const path = usePathname();
  const [pending, setPending] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setPending(null); setMenuOpen(false); }, [path]);
  const [section, setSection] = useState(path);
  const isFlow = path === '/' || LINKS.some((item) => item.href === path);
  const cur = isFlow ? section : pending ?? path;
  const active = (href: string) => href === '/' ? cur === '/' : cur.startsWith(href);
  const go = (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (isFlow && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
      const item = LINKS.find((item) => item.href === href);
      const target = item && document.getElementById(item.id);
      if (target) {
        event.preventDefault();
        setMenuOpen(false);
        target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' as ScrollBehavior : 'smooth', block: 'start' });
        return;
      }
    }
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
          <Link href="/analytics" className="apple-brand" aria-label="Backtest" onClick={go('/analytics')}>
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
            ><span /><span /></button>
          </div>
        </div>
        <nav id="apple-mobile-menu" className={'apple-mobile-menu' + (menuOpen ? ' is-open' : '')} aria-label="Menu mobile" hidden={!menuOpen}>
          {LINKS.map((item) => <Link key={item.href} href={item.href} onClick={go(item.href)} aria-current={active(item.href) ? 'page' : undefined}>{item.label}<span aria-hidden>↗</span></Link>)}
        </nav>
      </header>
      <main className="main" aria-busy={pending ? true : undefined}>
        <div className="page">{isFlow ? <ResearchFlow onActive={setSection} /> : children}</div>
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
