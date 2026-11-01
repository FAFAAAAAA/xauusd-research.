'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const I = {
  home: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  calc: <><rect x="6" y="3.5" width="12" height="17" rx="2" /><path d="M9 7.5h6M9 12h.01M12 12h.01M15 12h.01M9 15.5h.01M12 15.5h.01M15 15.5h.01" /></>,
  trade: <path d="M7 17V5M4 8l3-3 3 3M17 7v12M14 16l3 3 3-3" />,
  replay: <><circle cx="12" cy="12" r="8" /><path d="m10 8 6 4-6 4z" /></>,
  results: <><path d="M4 4v16h16M8 15l4-5 4 2 4-7" /></>,
  news: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 12h8M8 15h5" /></>,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--surface)" /><circle cx="15" cy="17" r="3" fill="var(--surface)" /></>,
};
const ITEMS = [
  { href: '/', label: 'Dashboard', icon: I.home },
  { href: '/analytics?view=run', label: 'Backtest', icon: I.replay },
  { href: '/analytics', label: 'Analytics', icon: I.results },
  { href: '/settings', label: 'Settings', icon: I.settings },
];
const TOOLS = [
  { href: '/trade', label: 'Trade & jurnal', icon: I.trade },
  { href: '/calculator', label: 'Kalkulator risiko', icon: I.calc },
  { href: '/news', label: 'Berita ekonomi', icon: I.news },
];
function Icon({ children }: { children: React.ReactNode }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
export default function Shell({ children, showLogout = false }: { children: React.ReactNode; showLogout?: boolean }) {
  const path = usePathname();
  const search = useSearchParams();
  const current = path === '/analytics' && search.get('view') === 'run' ? '/analytics?view=run' : path;
  // Highlight the tapped tab immediately, before the new page has finished loading.
  const [pending, setPending] = useState<string | null>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  useEffect(() => { setPending(null); sheet.current?.close(); }, [path, search]);
  const active = (href: string) => (pending ?? current) === href;
  const go = (href: string) => () => { if (href !== current) setPending(href); sheet.current?.close(); window.scrollTo({ top: 0 }); };
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; };
  const links = (items: typeof ITEMS) => items.map((i) => <Link key={i.href} href={i.href} onClick={go(i.href)} aria-current={active(i.href) ? 'page' : undefined}><Icon>{i.icon}</Icon><span>{i.label}</span></Link>);
  const title = [...ITEMS, ...TOOLS].find((i) => i.href === current)?.label ?? 'Workspace';
  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">Lewati ke konten</a>
      <aside className="sidebar">
        <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">Au</span><span>XAUUSD<span className="brand-sub">RESEARCH WORKSPACE</span></span></Link>
        <div className="workspace-label"><span className="workspace-avatar">XR</span><span>Personal workspace<small>Riset & analisis strategi</small></span></div>
        <span className="nav-caption">WORKSPACE</span>
        <nav className="side-nav" aria-label="Navigasi workspace">{links(ITEMS)}</nav>
        <span className="nav-caption">TRADING TOOLS</span>
        <nav className="side-nav" aria-label="Alat trading">{links(TOOLS)}</nav>
        <div className="sidebar-foot"><span className="research-note">Riset, bukan rekomendasi.</span><p>Hasil historis tidak menjamin performa di masa depan.</p>{showLogout ? <button className="btn block" onClick={logout}>Keluar</button> : null}</div>
      </aside>
      <header className="topbar">
        <div className="topbar-in">
          <Link href="/" className="brand mobile-brand"><span className="brand-mark" aria-hidden="true">Au</span><span>XAUUSD<span className="brand-sub">RESEARCH</span></span></Link>
          <div className="breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>{title}</strong></div>
          <span className="workspace-badge">Research workspace</span>
          <button className="btn icon-button mobile-menu" aria-label="Buka alat trading" onClick={() => sheet.current?.showModal()}><Icon><path d="M5 7h14M5 12h14M5 17h14" /></Icon></button>
        </div>
      </header>
      <main id="main-content" className="main" aria-busy={pending ? true : undefined}>
        <div key={path} className="page">{children}</div>
        <footer className="page-footer"><span>XAUUSD Research</span><span>Data historis. Keputusan independen.</span></footer>
      </main>
      <nav className="tabbar" aria-label="Menu utama">{links(ITEMS)}</nav>
      <dialog ref={sheet} className="tools-sheet" aria-labelledby="tools-title" onClick={(e) => { if (e.target === e.currentTarget) sheet.current?.close(); }}>
        <div className="row between"><div><span className="eyebrow">WORKSPACE</span><h2 id="tools-title">Alat trading</h2></div><button className="btn icon-button" aria-label="Tutup menu" onClick={() => sheet.current?.close()}>×</button></div>
        <nav className="side-nav" aria-label="Alat trading mobile">{links(TOOLS)}</nav>
        {showLogout ? <button className="btn block" onClick={logout}>Keluar</button> : null}
        <p className="mute small">Riset, bukan rekomendasi investasi.</p>
      </dialog>
    </div>
  );
}
