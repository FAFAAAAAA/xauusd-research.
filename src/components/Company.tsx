'use client';
import { useEffect, useMemo, useState } from 'react';
import { call, peek } from './client';
import type { JournalTrade } from '@/lib/core/journal';
import {
  DEFAULT_COMPANY, cleanCompany, wdFeeOf, addYm, companyReport, costIdrIn, dayName, dueAt, idrT, toIdr, usdT, ymName, ymOf,
  type CashMove, type CompanyReport as Report, type CompanySettings, type Cost, type Fx, type MonthBook,
} from '@/lib/core/company';

/* Office accountant (15 Nov 2026): the company report (tap the Accountant) and its settings (cat menu → Perusahaan).
 * Settings live on the server (/api/company); every number is computed from the journal, the bot's money moves and the costs. */
type Co = { settings: CompanySettings; fx: Fx | null; books: Record<string, MonthBook> };
let co: Co | null = null;
const subs = new Set<(c: Co | null) => void>();
let timer = 0;
const emit = () => { for (const f of subs) f(co); };
async function load() { try { co = await call<Co>('/api/company'); emit(); } catch { /* keep the last one */ } }
export function useCompany(): Co | null {
  const [v, setV] = useState<Co | null>(() => co ?? peek<Co>('/api/company'));
  useEffect(() => {
    subs.add(setV);
    if (subs.size === 1) { load(); timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5 * 60_000); }
    else if (co) setV(co);
    return () => { subs.delete(setV); if (!subs.size) { window.clearInterval(timer); timer = 0; } };
  }, []);
  return v;
}
export async function saveCompany(s: CompanySettings) { co = await call<Co>('/api/company', { method: 'PUT', json: s }); emit(); }
export async function setPaid(id: string, ym: string, paid: boolean) { co = await call<Co>('/api/company', { method: 'POST', json: { action: paid ? 'paid' : 'unpaid', id, ym } }); emit(); }

export type CompanyData = { trades: JournalTrade[]; cashflow?: { crypto?: CashMove[]; forex?: CashMove[] } | null; binance?: { wallet: number } | null; mt5?: { wallet: number } | null };
export const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
export function useReport(data: CompanyData | null, now: number): Report | null {
  const c = useCompany();
  return useMemo(() => {
    if (!data) return null;
    try { return companyReport({ ...data, settings: cleanCompany(c?.settings ?? DEFAULT_COMPANY), fx: c?.fx ?? null, books: c?.books ?? {}, now, tz: deviceTz() }); } catch { return null; }
    // the minute is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, c, Math.floor(now / 60_000)]);
}

const cls = (n: number) => (n > 0.005 ? 'up' : n < -0.005 ? 'dn' : '');

/* ---------------- the report ---------------- */
export function CompanyReport({ data, now }: { data: CompanyData; now: number }) {
  const r = useReport(data, now);
  const c = useCompany();
  const [tab, setTab] = useState<'w' | 'm'>('m');
  const [info, setInfo] = useState(false);
  if (!r) return <div className="co"><p className="co-empty">Memuat…</p></div>;
  const tz = deviceTz(), S = c?.settings ?? DEFAULT_COMPANY, m = r.cur, rate = r.rate;
  const capPct = Math.round(100 - S.salaryPct);
  const ops = m.costs + m.fees;
  const names = S.costs.filter((x) => costIdrIn(x, m.ym) > 0).map((x) => x.name).slice(0, 3).join(', ');
  return (
    <div className="co">
      <div className="co-seg" role="tablist">
        <button type="button" className={tab === 'w' ? 'on' : ''} onClick={() => setTab('w')}>Minggu</button>
        <button type="button" className={tab === 'm' ? 'on' : ''} onClick={() => setTab('m')}>Bulan</button>
      </div>
      {r.noRate ? <p className="co-warn">Kurs Rupiah belum tersedia, operasional belum dihitung.</p> : null}
      {tab === 'w' ? (() => {
        const W = data.trades.filter((t) => t.result !== 'open' && t.pnl != null && t.closedAt != null && t.closedAt >= r.week.from && t.closedAt <= now && (S.mt5 !== 'off' || (t.strategy !== 'v2' && t.strategy !== 'nas')));
        const days = Array.from({ length: 7 }, (_, d) => W.filter((t) => Math.floor((t.closedAt! - r.week.from) / 86_400_000) === d).reduce((a, t) => a + Number(t.pnl), 0));
        const today = Math.min(6, Math.floor((now - r.week.from) / 86_400_000));
        const top = Math.max(1, ...days.map(Math.abs));
        const end = new Date(r.week.from + 6 * 86_400_000);
        return (
          <div className="wkc">
            <div className="wkc-top"><span>Minggu ini</span><span>{dayName(r.week.from, tz)} – {dayName(end.getTime(), tz)}</span></div>
            <b className={`wkc-big ${r.week.revenue < 0 ? 'dn' : 'up'}`}>{usdT(r.week.revenue, true)}</b>
            <div className="wkc-rp">{toIdr(r.week.revenue, rate)}</div>
            <div className="wkc-sep" />
            {days.map((v, d) => (
              <div key={d} className={`wkc-li ${d > today ? 'future' : ''} ${d === today ? 'today' : ''}`}>
                <span>{['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'][d]}</span>
                <div className="wkc-bar">{d <= today && Math.abs(v) > 0.005 ? <i className={v > 0 ? 'p' : 'n'} style={{ width: `${(Math.abs(v) / top) * 50}%` }} /> : null}</div>
                <b className={d > today || Math.abs(v) < 0.005 ? 'mu' : v > 0 ? 'up' : 'dn'}>{d > today ? '—' : usdT(v, true)}</b>
              </div>
            ))}
          </div>
        );
      })() : (<>
        <div className="inv-hero">
          <span className="inv-hero-m">{ymName(m.ym, true).toUpperCase()}</span>
          <small>Tarik bulan ini</small>
          <b>{usdT(r.owed.allowed)}</b>
          <div className="inv-hero-sub">
            <div><small>Pendapatan</small><b className="inc">{usdT(m.revenue)}</b></div>
            <div><small>Pengembangan modal</small><b>{usdT(Math.max(0, m.net - m.salary))}</b></div>
            <div><small>Gaji</small><b className="sal">{usdT(m.salary)}</b><i>{toIdr(m.salary, rate)}</i></div>
            <div><small>Operasional</small><b>{usdT(ops)}</b></div>
          </div>
          {(() => {
            const opsFee = ops > 0 ? wdFeeOf(S, ops) : 0;
            const parts: Array<[string, number]> = [['Operasional', ops], ['Biaya penarikan', opsFee], ['Kasbon', r.owed.advance], ['Rugi belum ketutup', m.deficit]];
            const target = parts.reduce((a, [, v]) => a + v, 0), rev = m.revenue;
            const done = rev >= target && target > 0;
            const max = Math.max(done ? rev : target, 0.01);                       // passed: the bar is full and the yellow line marks where the target was
            const tx = Math.min(100, Math.max(0, (target / max) * 100)), rx = Math.min(100, Math.max(0, (Math.max(0, rev) / max) * 100));
            return (
              <button type="button" className="trk-card" onClick={() => setInfo(true)} aria-label="Kenapa targetnya segini">
                <div className="trk">
                  <span className="trk-base" /><span className={`trk-fill ${done ? 'good' : 'low'}`} style={{ width: `${rx}%` }} />
                  <span className="trk-flag" style={{ left: `${tx}%` }}><i /></span>
                  <span className={`trk-dot ${done ? 'good' : 'low'}`} style={{ left: `${rx}%` }} />
                </div>
                <div className="trk-f"><span className={rev >= target ? 'pos' : 'neg'}>{usdT(rev - target, true)}</span></div>
              </button>
            );
          })()}
          <div className="inv-hero-foot">
            <span>{r.owed.takenNow > 0.005 ? `Sudah ditarik ${usdT(r.owed.takenNow)}` : 'Belum ada penarikan'}</span>
            <button type="button" className="inv-info" aria-label="Lihat rumus hitungan" onClick={() => setInfo(true)}>i</button>
          </div>
        </div>


        {info ? (() => {
          const fee = ops > 0 ? wdFeeOf(S, ops) : 0, mod = Math.max(0, m.net - m.salary);
          const target = ops + fee + r.owed.advance + m.deficit;
          const flow: Array<[string, string, number, string]> = [
            ['in', 'Pendapatan', m.revenue, '+'], ['out', 'Operasional', ops, '−'], ['eq', 'Laba bersih', m.net, '='], ['cap', `Modal ${capPct}%`, mod, '−'], ['sal', 'Gaji', m.salary, '='],
          ];
          return (
            <div className="ip-bg" onClick={() => setInfo(false)}>
              <div className="ip" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Cara hitung">
                <div className="ip-grab" />
                <div className="ip-h"><b>Cara hitung</b><button type="button" onClick={() => setInfo(false)} aria-label="Tutup">✕</button></div>
                <div className="ip-scroll">
                  {m.revenue > 0 && m.net > 0 ? (() => {
                    const seg: Array<[string, string, number]> = [['out', 'Operasional', ops], ['cap', 'Modal', mod], ['sal', 'Gaji', m.salary]];
                    return (
                      <div className="ip-split">
                        <div className="ip-bar">{seg.map(([k, l, v]) => v > 0 ? <i key={l} className={k} style={{ flexGrow: v }} /> : null)}</div>
                        <div className="ip-leg">{seg.map(([k, l, v]) => <span key={l}><em className={k} />{l}<b>{Math.round((v / m.revenue) * 100)}%</b></span>)}</div>
                      </div>
                    );
                  })() : null}
                  <div className="ip-flow">
                    {flow.map(([k, label, v, op]) => (
                      <div key={label} className={`ip-step ${k}`}><span className="ip-op">{op}</span><span className="ip-l">{label}</span><b>{usdT(v)}</b></div>
                    ))}
                  </div>
                  <div className="ip-sum">
                    <small>Tarik bulan ini</small>
                    <div className="ip-chips"><span>Gaji</span><i>+</i><span>Operasional</span><i>+</i><span>Biaya tarik</span></div>
                    <b>{usdT(r.owed.allowed)}</b>
                  </div>
                  <div className="ip-card">
                    <div className="ip-row head"><span>Target bulan ini</span><b>{usdT(target)}</b></div>
                    <div className="ip-row"><span>Operasional</span><b>{usdT(ops)}</b></div>
                    <div className="ip-row"><span>Biaya penarikan</span><b>{usdT(fee)}</b></div>
                    {r.owed.advance > 0.005 ? <div className="ip-row"><span>Kasbon</span><b>{usdT(r.owed.advance)}</b></div> : null}
                    {m.deficit > 0.005 ? <div className="ip-row"><span>Rugi belum ketutup</span><b>{usdT(m.deficit)}</b></div> : null}
                  </div>
                  <div className="ip-tips">
                    <div><span><svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg></span><p>Ubah operasional di <b>Menu → Perusahaan</b></p></div>
                    <div><span><svg viewBox="0 0 24 24"><path d="M4 9h13l-3-3M20 15H7l3 3" /></svg></span><p>Kurs otomatis{rate ? <> <b>{idrT(rate)}</b> / $1</> : ''}</p></div>
                    <div><span><svg viewBox="0 0 24 24"><path d="M12 4v16M5 11l7-7 7 7" /></svg></span><p>Rugi bulan lalu ditutup dulu sebelum gaji</p></div>
                  </div>
                </div>
              </div>
            </div>
          );
        })() : null}
      </>      )}
    </div>
  );
}

/* ---------------- settings (cat menu → Perusahaan) ---------------- */
const newId = () => Math.random().toString(36).slice(2, 10);
const parseNum = (s: string) => Number(String(s).replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.'));
const COLORS = ['#5b5bd6', '#e5484d', '#16a35a', '#f2a33a', '#0a84ff', '#bf5af2', '#14b8a6'];
const colorOf = (id: string) => COLORS[[...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORS.length];
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function Stepper({ value, step, min, max, fmt, onChange }: { value: number; step: number; min: number; max: number; fmt: (n: number) => string; onChange: (n: number) => void }) {
  return (
    <div className="cs-step">
      <button type="button" aria-label="Kurangi" onClick={() => onChange(Math.max(min, Math.round((value - step) / step) * step))}>−</button>
      <b>{fmt(value)}</b>
      <button type="button" aria-label="Tambah" onClick={() => onChange(Math.min(max, Math.round((value + step) / step) * step))}>+</button>
    </div>
  );
}

export function CompanySettingsView({ now, onDone }: { now: number; onDone: () => void }) {
  const c = useCompany();
  const [s, setS] = useState<CompanySettings>(() => c?.settings ?? DEFAULT_COMPANY);
  const [edit, setEdit] = useState<Cost | null>(null);
  const [more, setMore] = useState(false);
  const [bills, setBills] = useState(false);
  const [pm, setPm] = useState(false);
  const [nt, setNt] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  useEffect(() => { if (c?.settings) setS(c.settings); }, [c?.settings]);
  const tz = deviceTz(), cur = ymOf(now, tz), rate = c?.fx?.rate ?? null;
  const dirty = !!c && JSON.stringify(c.settings) !== JSON.stringify(s);
  const save = async (next = s, close = false) => { setBusy(true); setErr(''); try { await saveCompany(next); if (close) onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const nextDue = (x: Cost) => { for (let i = 0; i < 14; i++) { const ym = addYm(cur, i); if (!costIdrIn(x, ym)) continue; const d = dueAt(x, ym, tz); if (d >= now - 86_400_000) return { ym, d }; } return null; };
  const unpaid = (x: Cost) => { for (const ym of [addYm(cur, -1), cur, addYm(cur, 1)]) { if (!costIdrIn(x, ym) || (s.paid[x.id] ?? []).includes(ym)) continue; const d = dueAt(x, ym, tz); if (now >= d - 3 * 86_400_000 && d >= x.created - 86_400_000) return { ym, d }; } return null; };
  const days = (d: number) => { const n = Math.ceil((d - now) / 86_400_000); return n > 1 ? `${n} hari lagi` : n === 1 ? 'besok' : n === 0 ? 'hari ini' : 'lewat'; };
  const kindTxt = (x: Cost) => (x.kind === 'once' ? `Sekali · ${ymName(x.start)}` : x.kind === 'install' ? `Cicilan ${x.months} bln · tgl ${x.day}` : `Tiap tanggal ${x.day}`);
  const perMonth = (x: Cost) => costIdrIn(x, cur);

  /* ----- add / edit one cost ----- */
  if (edit) {
    const e = edit, set = (p: Partial<Cost>) => setEdit({ ...e, ...p });
    const exists = s.costs.some((x) => x.id === e.id);
    const nd = e.idr > 0 ? nextDue(e) : null;
    const ok = !!e.name.trim() && e.idr > 0;
    const commit = (next: CompanySettings) => { setS(next); setEdit(null); save(next); };
    return (
      <div className="co cs" key="edit">
        <div className="cs-amount">
          <span>Rp</span>
          <input inputMode="numeric" autoFocus={!exists} value={e.idr ? e.idr.toLocaleString('id-ID') : ''} placeholder="0" aria-label="Jumlah dalam Rupiah" onChange={(ev) => set({ idr: Math.max(0, Math.round(parseNum(ev.target.value) || 0)) })} />
          <small>{e.idr > 0 && rate ? `± ${usdT(e.idr / rate)}` : 'Jumlah yang kamu bayar'}</small>
        </div>
        <div className="cs-card">
          <label className="cs-field"><span>Nama</span><input value={e.name} maxLength={40} placeholder="mis. VPS, Claude, Internet" onChange={(ev) => set({ name: ev.target.value })} /></label>
        </div>
        <div className="cs-head"><b>Cara bayar</b></div>
        <div className="co-seg">
          {(['monthly', 'once', 'install'] as const).map((k) => <button type="button" key={k} className={e.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}>{k === 'monthly' ? 'Tiap bulan' : k === 'once' ? 'Sekali' : 'Dicicil'}</button>)}
        </div>
        <div className="cs-card">
          {e.kind === 'install' ? <label className="cs-field"><span>Lama cicilan</span><span className="cs-in"><input inputMode="numeric" value={e.months} onChange={(ev) => set({ months: Math.max(1, Math.min(120, Math.round(parseNum(ev.target.value) || 1))) })} /><i>bulan</i></span></label> : null}
          {e.kind !== 'once' ? <label className="cs-field"><span>Bayar tiap tanggal</span><span className="cs-in"><input inputMode="numeric" value={e.day} onChange={(ev) => set({ day: Math.max(1, Math.min(31, Math.round(parseNum(ev.target.value) || 1))) })} /></span></label> : null}
          <label className="cs-field"><span>{e.kind === 'once' ? 'Bulan bayar' : 'Mulai'}</span><input type="month" value={e.start} onChange={(ev) => set({ start: ev.target.value || e.start })} /></label>
          {e.kind !== 'once' ? <label className="cs-field"><span>Berhenti</span><input type="month" value={e.end ?? ''} onChange={(ev) => set({ end: ev.target.value || null })} /></label> : null}
        </div>
        {nd ? <p className="cs-note">Bayar berikutnya <b>{dayName(nd.d, tz)}</b> · {days(nd.d)}</p> : null}
        {err ? <p className="co-warn">{err}</p> : null}
        <button type="button" className="co-btn" disabled={busy || !ok} onClick={() => commit({ ...s, costs: exists ? s.costs.map((x) => (x.id === e.id ? e : x)) : [...s.costs, e] })}>{exists ? 'Simpan' : 'Tambah operasional'}</button>
        <div className="co-row2">
          <button type="button" className="co-btn ghost" onClick={() => setEdit(null)}>Batal</button>
          {exists ? <button type="button" className="co-btn ghost dn" onClick={() => commit({ ...s, costs: s.costs.filter((x) => x.id !== e.id) })}>Hapus</button> : null}
        </div>
      </div>
    );
  }

  /* ----- all bills ----- */
  if (bills) {
    return (
      <div className="co cs" key="bills">
        <div className="cs-head"><b>Tagihan</b><button type="button" onClick={() => setEdit({ id: newId(), name: '', idr: 0, kind: 'monthly', months: 12, day: Number(new Date(now).getDate()), start: cur, end: null, created: now })}>＋ Tambah</button></div>
        <div className="cs-card">
          {s.costs.length ? s.costs.map((x) => {
            const due = unpaid(x), v = x.kind === 'install' ? x.idr / x.months : x.idr;
            return (
              <div key={x.id} className="cs-cost">
                <button type="button" className="cs-cost-main" onClick={() => setEdit(x)}>
                  <span className="cs-av" style={{ background: colorOf(x.id) }}>{cap(x.name).slice(0, 1)}</span>
                  <span className="co-grow"><b>{cap(x.name)}</b><small className={due ? 'warn' : ''}>{due ? `Jatuh tempo ${days(due.d)}` : kindTxt(x)}</small></span>
                  <span className="cs-amt">{idrT(v)}{rate ? <small>{usdT(v / rate)}</small> : null}</span>
                </button>
              </div>
            );
          }) : <p className="cs-empty">Belum ada tagihan.</p>}
        </div>
        <button type="button" className="co-btn ghost" onClick={() => setBills(false)}>Kembali</button>
      </div>
    );
  }

  /* ----- overview ----- */
  const totalIdr = s.costs.reduce((a, x) => a + perMonth(x), 0);
  const upcoming = s.costs.map((x) => ({ x, n: nextDue(x) })).filter((q) => q.n).sort((a, b) => a.n!.d - b.n!.d)[0];
  const ex = 100, gaji = (ex * s.salaryPct) / 100;
  return (
    <div className="co cs" key="list">
      {(() => {
        const usd = (idr: number) => (rate && idr ? usdT(idr / rate) : '');
        const dueNow = s.costs.map((x) => ({ x, d: unpaid(x) })).find((q) => q.d);
        const nx = dueNow ? { x: dueNow.x, d: dueNow.d!.d } : upcoming ? { x: upcoming.x, d: upcoming.n!.d } : null;
        const modal = Math.round(100 - s.salaryPct);
        const step = (n: number) => setS({ ...s, salaryPct: 100 - Math.max(0, Math.min(100, n)) });
        return (
          <div className="wg">
            <div className="wg-t wide dk">
              <small>Operasional / bulan</small>
              <b className="y">{idrT(totalIdr)}</b>
              {usd(totalIdr) ? <i>± {usd(totalIdr)}</i> : null}
            </div>
            <div className={`wg-t wg-mod ${pm ? 'open' : ''}`} role="button" tabIndex={0} onClick={() => setPm((v) => !v)}>
              <small>Modal</small>
              <b className="m">{modal}%</b>
              <div className="wg-foot"><i>Gaji {100 - modal}%</i>
                {pm ? <span className="wg-pm"><button type="button" aria-label="Kurangi" onClick={(ev) => { ev.stopPropagation(); step(modal - 5); }}>−</button><button type="button" aria-label="Tambah" onClick={(ev) => { ev.stopPropagation(); step(modal + 5); }}>+</button></span> : null}
              </div>
            </div>
            <div className={`wg-t wg-bill ${dueNow ? 'warn' : ''}`} role="button" tabIndex={0} onClick={() => setBills(true)}>
              <button type="button" className="wg-add" aria-label="Tambah tagihan" onClick={(ev) => { ev.stopPropagation(); setEdit({ id: newId(), name: '', idr: 0, kind: 'monthly', months: 12, day: Number(new Date(now).getDate()), start: cur, end: null, created: now }); }}>＋</button>
              <small>Tagihan</small>
              {nx ? <>
                <b className="nm">{cap(nx.x.name)}</b>
                <i>{dayName(nx.d, tz)} · {days(nx.d)}</i>
                <i className="amt">{usd(perMonth(nx.x)) || idrT(perMonth(nx.x))}</i>
                {dueNow ? <button type="button" className="wg-paid" onClick={async (ev) => { ev.stopPropagation(); try { await setPaid(dueNow.x.id, dueNow.d!.ym, true); } catch (e2) { setErr((e2 as Error).message); } }}>✓ Sudah bayar</button> : null}
              </> : <b className="nm">—</b>}
            </div>
            <button type="button" className={`wg-t wg-sq ${nt ? 'open' : ''}`} onClick={() => { setNt((v) => !v); setMore(false); }}>
              <span className="wg-ico"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" /></svg></span>
              <small>Notifikasi</small><b className="nm">{[s.officeBills, s.tg.bills, s.tg.weekly, s.tg.monthly].filter(Boolean).length} aktif</b>
            </button>
            <button type="button" className={`wg-t wg-sq ${more ? 'open' : ''}`} onClick={() => { setMore((v) => !v); setNt(false); }}>
              <span className="wg-ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg></span>
              <small>Pengaturan</small><b className="nm">Lainnya</b>
            </button>
            {nt ? <div className="wg-t wide">
              <div className="wg-chips lt" style={{ marginTop: 0 }}>
                {([['officeBills', '🔔', 'Kantor'], ['bills', '✈️', 'Telegram'], ['weekly', '📅', 'Mingguan'], ['monthly', '📊', 'Bulanan']] as const).map(([k, ic, t]) => {
                  const on = k === 'officeBills' ? s.officeBills : s.tg[k];
                  return <button type="button" key={k} role="switch" aria-checked={on} className={on ? 'on' : ''} onClick={() => setS(k === 'officeBills' ? { ...s, officeBills: !on } : { ...s, tg: { ...s.tg, [k]: !on } })}>{ic} {t}</button>;
                })}
              </div>
            </div> : null}
          </div>
        );
      })()}

      {more ? <div className="cs-card">
        <label className="cs-field"><span>Mulai hitung</span><input type="month" value={s.since} onChange={(ev) => ev.target.value && setS({ ...s, since: ev.target.value })} /></label>
        <label className="cs-field"><span>Batas operasional</span><span className="cs-in"><i>Rp</i><input inputMode="numeric" defaultValue={s.budgetIdr ? s.budgetIdr.toLocaleString('id-ID') : ''} placeholder="Bebas" onBlur={(ev) => setS({ ...s, budgetIdr: Math.max(0, Math.round(parseNum(ev.target.value) || 0)) })} /></span></label>
        <label className="cs-field"><span>Biaya tarik tetap</span><span className="cs-in"><input inputMode="decimal" defaultValue={String(s.wdFee.fixed)} onBlur={(ev) => { const n = parseNum(ev.target.value); if (Number.isFinite(n)) setS({ ...s, wdFee: { ...s.wdFee, fixed: Math.max(0, n) } }); }} /><i>USDT</i></span></label>
        <label className="cs-field"><span>Biaya tarik</span><span className="cs-in"><input inputMode="decimal" defaultValue={String(s.wdFee.pct)} onBlur={(ev) => { const n = parseNum(ev.target.value); if (Number.isFinite(n)) setS({ ...s, wdFee: { ...s.wdFee, pct: Math.max(0, Math.min(20, n)) } }); }} /><i>%</i></span></label>
      </div> : null}

      {err ? <p className="co-warn">{err}</p> : null}
      {dirty ? <div className="cs-save"><button type="button" className="co-btn" disabled={busy} onClick={() => save(s, true)}>{busy ? 'Menyimpan…' : 'Simpan perubahan'}</button></div> : null}
    </div>
  );
}
