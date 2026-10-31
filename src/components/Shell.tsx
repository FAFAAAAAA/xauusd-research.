'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/replay', label: 'Replay' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/news', label: 'News' },
  { href: '/settings', label: 'Settings' },
];

export default function Shell({ children, showLogout = false }: { children: React.ReactNode; showLogout?: boolean }) {
  const path = usePathname();
  const active = (h: string) => (h === '/' ? path === '/' : path.startsWith(h));
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; };
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">XAUUSD Research<small>SNR · replay · Telegram</small></div>
        <nav className="nav">
          {ITEMS.map((i) => <Link key={i.href} href={i.href} aria-current={active(i.href) ? 'page' : undefined}>{i.label}</Link>)}
        </nav>
        <div className="spacer" />
        {showLogout ? <button className="btn" onClick={logout}>Keluar</button> : null}
      </aside>
      <main className="main">{children}</main>
      <nav className="tabbar" aria-label="Menu utama">
        {ITEMS.map((i) => <Link key={i.href} href={i.href} aria-current={active(i.href) ? 'page' : undefined}>{i.label}</Link>)}
      </nav>
    </div>
  );
}
