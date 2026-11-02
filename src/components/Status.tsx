'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/* Shared UI building blocks. Every page uses these so the app looks like one product. */

export function Status({ on, error, children }: { on: boolean; error?: boolean; children: React.ReactNode }) {
  return <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className={`dot ${error ? 'err' : on ? 'on' : ''}`} aria-hidden />{children}</span>;
}
export function ModeTag({ mode, test }: { mode: string; test?: boolean }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className={`tag ${mode === 'LIVE' ? 'live' : 'bt'}`}>{mode === 'LIVE' ? 'Live' : 'Simulasi'}</span>
      {test ? <span className="tag test">Tes</span> : null}
    </span>
  );
}

export function PageHead({ title, sub, eyebrow, actions, children }: { title: string; sub?: string; eyebrow?: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <div className="ph-top"><h1>{title}</h1>{actions ? <div className="ph-actions">{actions}</div> : null}</div>
      {sub ? <p className="sub">{sub}</p> : null}
      {children}
    </header>
  );
}

/** Section header inside a card: title on the left, optional meta / action on the right. */
export function SecHead({ title, meta, children }: { title: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode }) {
  return <div className="sec-head"><h2>{title}</h2>{children ?? (meta != null ? <span className="meta">{meta}</span> : null)}</div>;
}

/** One number with its label. `tone` colours profit / loss. */
export function Metric({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: string; hint?: React.ReactNode }) {
  return (
    <div className="metric">
      <span className="k">{label}</span>
      <span className={`v ${tone ?? ''}`}>{value}</span>
      {hint ? <span className="h">{hint}</span> : null}
    </div>
  );
}
export function Metrics({ cols = 4, children }: { cols?: 2 | 3 | 4; children: React.ReactNode }) {
  return <div className={`metrics m${cols}`}>{children}</div>;
}

const EMPTY_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 13h4l2 3h4l2-3h4" /><path d="M5.5 6.5 4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5l-1.5-6.5A1 1 0 0 0 17.5 5.7h-11a1 1 0 0 0-1 .8z" /></svg>;
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span className="ei">{EMPTY_ICON}</span>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );
}

/** Loading placeholder shaped like the content it stands in for (no layout jump when data arrives). */
export function Loading({ what = 'data', variant = 'page' }: { what?: string; variant?: 'page' | 'dashboard' | 'list' | 'block' }) {
  return (
    <div className="skeleton" role="status" aria-label={`Memuat ${what}`}>
      {variant === 'dashboard' ? <>
        <span className="sk sk-lg" />
        <div className="sk-row m4"><span className="sk" /><span className="sk" /><span className="sk" /><span className="sk" /></div>
        <span className="sk sk-md" />
      </> : variant === 'list' ? <>
        <span className="sk sk-line" style={{ width: '60%' }} /><span className="sk sk-line" style={{ width: '85%' }} /><span className="sk sk-line" style={{ width: '45%' }} />
      </> : variant === 'block' ? <span className="sk sk-md" /> : <>
        <span className="sk sk-lg" /><span className="sk sk-md" /><span className="sk sk-sm" />
      </>}
    </div>
  );
}
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="error row between" role="alert"><span style={{ minWidth: 0 }}>{error}</span>{retry ? <button className="btn sm" onClick={retry}>Coba lagi</button> : null}</div>;
}
export function Spinner() { return <span className="spin" aria-hidden />; }

/* --------------------------------------------------------------- segmented control with a sliding indicator */
export function Seg<T extends string | number>({ options, value, onChange, label, scroll = false, full = false }: {
  options: ReadonlyArray<readonly [T, React.ReactNode]>; value: T | null; onChange: (v: T) => void; label?: string; scroll?: boolean; full?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const ind = useRef<HTMLSpanElement>(null);
  const ready = useRef(false);
  const place = useCallback(() => {
    const b = box.current, i = ind.current;
    if (!b || !i) return;
    const el = b.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (!el) { i.style.opacity = '0'; return; }
    i.dataset.ready = String(ready.current);
    i.style.opacity = '1';
    i.style.width = `${el.offsetWidth}px`;
    i.style.transform = `translateX(${el.offsetLeft}px)`;
    if (scroll) {
      const l = el.offsetLeft, r = l + el.offsetWidth;
      if (l < b.scrollLeft || r > b.scrollLeft + b.clientWidth) b.scrollTo({ left: Math.max(0, l - 24), behavior: ready.current ? 'smooth' : 'auto' });
    }
    ready.current = true;
  }, [scroll]);
  useLayoutEffect(place, [place, value, options.length]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !box.current) return;
    const ro = new ResizeObserver(() => { const was = ready.current; ready.current = false; place(); ready.current = was; });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [place]);
  return (
    <div ref={box} className={`seg has-ind${scroll ? ' scroll' : ''}${full ? ' full' : ''}`} role="group" aria-label={label}>
      <span ref={ind} className="seg-ind" data-ready="false" aria-hidden />
      {options.map(([v, l]) => <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

/* --------------------------------------------------------------- bottom sheet (phone) / modal (desktop) */
export function Sheet({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const done = useRef(onClose);
  done.current = onClose;
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = prev; };
  }, []);
  const close = useCallback(() => {
    setClosing(true);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => { try { ref.current?.close(); } catch { /* already closed */ } done.current(); }, reduce ? 0 : 190);
  }, []);
  return (
    <dialog ref={ref} className="sheet" data-closing={closing} onCancel={(e) => { e.preventDefault(); close(); }} aria-label={typeof title === 'string' ? title : undefined}>
      <div className="scrim" onClick={close} />
      <div className="panel-s">
        <span className="grab" aria-hidden />
        <div className="s-head"><h2 style={{ minWidth: 0 }}>{title}</h2><button className="btn sm" onClick={close}>Tutup</button></div>
        <div className="s-body">{children}</div>
      </div>
    </dialog>
  );
}

/* --------------------------------------------------------------- toasts */
type ToastMsg = { id: number; text: string; kind: 'ok' | 'err'; out?: boolean };
let toastId = 0;
/** Short confirmation at the bottom of the screen (e.g. "Tersalin"). */
export function toast(text: string, kind: 'ok' | 'err' = 'ok') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('xau-toast', { detail: { id: ++toastId, text, kind } }));
}
export function Toaster() {
  const [list, setList] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<ToastMsg>).detail;
      setList((l) => [...l.slice(-2), m]);
      setTimeout(() => setList((l) => l.map((x) => (x.id === m.id ? { ...x, out: true } : x))), 2400);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== m.id)), 2650);
    };
    window.addEventListener('xau-toast', on);
    return () => window.removeEventListener('xau-toast', on);
  }, []);
  return (
    <div className="toasts" aria-live="polite" role="status">
      {list.map((t) => <div key={t.id} className={`toast ${t.kind}`} data-out={!!t.out}><span className="ti" aria-hidden>{t.kind === 'ok' ? '✓' : '!'}</span>{t.text}</div>)}
    </div>
  );
}

/** Copies text and confirms with a toast. */
export async function copyText(text: string, done = 'Tersalin') {
  try { await navigator.clipboard.writeText(text); toast(done); return true; }
  catch { toast('Gagal menyalin — salin manual', 'err'); return false; }
}
export function CopyButton({ text, label = 'Salin', done }: { text: string; label?: string; done?: string }) {
  const [ok, setOk] = useState(false);
  return <button className="btn sm" onClick={async () => { if (await copyText(text, done)) { setOk(true); setTimeout(() => setOk(false), 1600); } }}>{ok ? '✓ Tersalin' : label}</button>;
}
