'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const I = {
  home: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  trade: <path d="M7 17V5M4 8l3-3 3 3M17 7v12M14 16l3 3 3-3" />,
  replay: <><circle cx="12" cy="12" r="8" /><path d="M10.5 9v6l4.5-3z" fill="currentColor" stroke="none" /></>,
  results: <path d="M5 19V11M10 19V6M15 19v-5M20 19V9" />,
  news: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 12h8M8 15h5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
};
const ITEMS = [
  { href: '/', label: 'Beranda', icon: I.home },
  { href: '/trade', label: 'Trade', icon: I.trade },
  { href: '/analytics', label: 'Hasil', icon: I.results },
  { href: '/news', label: 'Berita', icon: I.news },
  { href: '/settings', label: 'Atur', icon: I.settings },
];

export default function Shell({ children, showLogout = false }: { children: React.ReactNode; showLogout?: boolean }) {
  const path = usePathname();
  // Highlight the tapped tab immediately, before the new page has finished loading.
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => { setPending(null); }, [path]);
  const cur = pending ?? path;
  const active = (h: string) => (h === '/' ? cur === '/' : cur.startsWith(h));
  const go = (h: string) => () => { if (h !== path) setPending(h); window.scrollTo({ top: 0 }); };
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; };
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-in">
          <Link href="/" className="brand"><span className="brand-mark" aria-hidden>Au</span>XAUUSD Research</Link>
          <nav className="topnav" aria-label="Menu">
            {ITEMS.map((i) => <Link key={i.href} href={i.href} onClick={go(i.href)} aria-current={active(i.href) ? 'page' : undefined}>{i.label}</Link>)}
          </nav>
          {showLogout ? <button className="btn sm" onClick={logout}>Keluar</button> : null}
        </div>
      </header>
      <main className="main" aria-busy={pending ? true : undefined}>
        <div key={path} className="page">{children}</div>
      </main>
      <nav className="tabbar" aria-label="Menu utama">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} onClick={go(i.href)} aria-current={active(i.href) ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{i.icon}</svg>
            {i.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
