'use client';
import { useEffect, useMemo, useState } from 'react';
import { call, peek } from './client';
import type { JournalTrade } from '@/lib/core/journal';
import {
  DEFAULT_COMPANY, addYm, companyReport, costIdrIn, dayName, dueAt, idrT, toIdr, usdT, ymName, ymOf,
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
    try { return companyReport({ ...data, settings: c?.settings ?? DEFAULT_COMPANY, fx: c?.fx ?? null, books: c?.books ?? {}, now, tz: deviceTz() }); } catch { return null; }
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
  const [slip, setSlip] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!r) return <div className="co"><p className="co-empty">Memuat…</p></div>;
  const tz = deviceTz(), S = c?.settings ?? DEFAULT_COMPANY, m = r.cur, rate = r.rate;
  const closedRows = r.months.filter((x) => x.closed).slice(-3).reverse();
  const slipRow = slip ? r.months.find((x) => x.ym === slip) : null;
  return (
    <div className="co">
      <div className="co-top"><h2>{tab === 'm' ? ymName(r.ym, true).split(' ')[0] : 'Minggu ini'}</h2><span className={`co-chip ${tab === 'm' ? 'open' : ''}`}>{tab === 'm' ? '● Buku terbuka' : `${dayName(r.week.from, tz)} – hari ini`}</span></div>
      <div className="co-seg" role="tablist">
        <button type="button" className={tab === 'w' ? 'on' : ''} onClick={() => setTab('w')}>Minggu</button>
        <button type="button" className={tab === 'm' ? 'on' : ''} onClick={() => setTab('m')}>Bulan</button>
      </div>

      {tab === 'w' ? <>
        <div className="co-card">
          <div className="co-k">{r.week.revenue < 0 ? 'Rugi minggu ini' : 'Untung minggu ini'}</div>
          <div className={`co-big ${cls(r.week.revenue)}`}>{usdT(r.week.revenue, true)}</div>
          <div className="co-rp">{toIdr(r.week.revenue, rate)}</div>
        </div>
        <div className="co-tiles">
          <div><span className="co-k">Trade</span><b>{r.week.trades}</b></div>
          <div><span className="co-k">TP / SL</span><b><span className="up">{r.week.tp}</span> <i>/</i> <span className="dn">{r.week.sl}</span></b></div>
        </div>
      </> : <>
        {r.noRate ? <p className="co-warn">Kurs Rupiah belum tersedia, biaya belum dihitung.</p> : null}
        <div className="co-card">
          <div className="co-k">Laba bersih</div>
          <div className={`co-big ${cls(m.net)}`}>{usdT(m.net, true)}</div>
          <div className="co-rp">{toIdr(m.net, rate)}</div>
        </div>
        <div className="co-tiles">
          <div><span className="co-k">Pendapatan</span><b className={cls(m.revenue)}>{usdT(m.revenue)}</b></div>
          <div><span className="co-k">Biaya</span><b className={m.costs + m.fees > 0 ? 'dn' : ''}>{usdT(m.costs + m.fees)}</b>
            {r.budget.pct != null ? <><span className="co-mini"><i style={{ width: `${Math.min(100, r.budget.pct)}%`, background: r.budget.pct > 100 ? 'var(--down, #e5484d)' : undefined }} /></span><small>{Math.round(r.budget.pct)}% anggaran</small></> : null}</div>
          <div><span className="co-k">Gaji · {S.salaryPct}%</span><b>{usdT(m.salary)}</b></div>
          <div><span className="co-k">Tambah modal</span><b className={cls(m.capital)}>{usdT(m.capital)}</b></div>
        </div>
        <div className="co-card co-dark">
          <div className="co-k">Sisa boleh ditarik</div>
          <div className="co-big gold">{usdT(r.owed.allowed)}</div>
          <div className="co-rp">{toIdr(r.owed.allowed, rate)}</div>
          <div className="co-rows">
            {r.owed.costs > 0.005 ? <div><span>Biaya</span><b>{usdT(r.owed.costs)}</b></div> : null}
            <div><span>Gaji bulan ini</span><b>{usdT(r.owed.salaryNow)}</b></div>
            {r.owed.salaryOld > 0.005 ? <div><span>Gaji belum diambil</span><b>{usdT(r.owed.salaryOld)}</b></div> : null}
            {r.owed.advance > 0.005 ? <div><span>Kasbon</span><b className="dn">−{usdT(r.owed.advance)}</b></div> : null}
            {r.owed.fee > 0.005 ? <div><span>Biaya penarikan</span><b>{usdT(r.owed.fee)}</b></div> : null}
            <div><span>Sudah ditarik bulan ini</span><b>{usdT(r.owed.takenNow)}</b></div>
          </div>
        </div>

        {closedRows[0] ? <>
          <h3 className="co-h">Slip gaji</h3>
          <button type="button" className="co-card co-sliprow" onClick={() => setSlip(closedRows[0].ym)}>
            <span className="co-ic in">💵</span>
            <span className="co-grow"><span className="co-k">Gaji bersih {ymName(closedRows[0].ym, true).split(' ')[0]}</span><b>{usdT(closedRows[0].salary - closedRows[0].deduct)}</b></span>
            <span className="co-chip closed">Ditutup ›</span>
          </button>
        </> : null}

        {r.moves.length ? <>
          <h3 className="co-h">Uang masuk & keluar {r.moves.length > 3 ? <button type="button" onClick={() => setAll((v) => !v)}>{all ? 'Ringkas' : 'Semua'}</button> : null}</h3>
          <div className="co-card co-list">
            {(all ? r.moves.slice(0, 40) : r.moves.slice(0, 3)).map((x) => (
              <div key={x.id} className="co-li">
                <span className={`co-ic ${x.kind === 'in' ? 'in' : 'out'}`}>{x.kind === 'in' ? '↓' : '↑'}</span>
                <span className="co-grow"><b>{x.kind === 'in' ? 'Deposit' : 'Penarikan'}</b><small>{dayName(x.at, tz)}{x.market === 'forex' ? ' · MT5' : ''}</small></span>
                <b className={x.kind === 'in' ? 'up' : ''}>{x.kind === 'in' ? '+' : '−'}{usdT(x.amount)}</b>
              </div>
            ))}
          </div>
        </> : null}

        {closedRows.length ? <>
          <h3 className="co-h">Bulan lalu</h3>
          <div className="co-months">
            {closedRows.map((x) => (
              <button type="button" key={x.ym} onClick={() => setSlip(x.ym)}>
                <small>{ymName(x.ym).toUpperCase()}</small>
                <b className={cls(x.net)}>{usdT(x.net, true).replace('.00', '')}</b>
                <i className={x.unclaimed > 0.005 ? 'warn' : x.salary > 0.005 ? 'up' : ''}>{x.unclaimed > 0.005 ? `${usdT(x.unclaimed)} belum diambil` : x.salary > 0.005 ? '✓ lunas' : 'tidak gajian'}</i>
              </button>
            ))}
          </div>
        </> : null}
      </>}

      {slipRow ? (
        <div className="co-slip-bg" onClick={() => setSlip(null)}>
          <div className="co-slip" onClick={(e) => e.stopPropagation()}>
            <div className="co-slip-hd"><small>SLIP GAJI</small><b>{ymName(slipRow.ym, true)}</b></div>
            <div className="co-rows light">
              <div><span>Laba bersih</span><b>{usdT(slipRow.net, true)}</b></div>
              <div><span>Gaji {S.salaryPct}%</span><b>{usdT(slipRow.salary)}</b></div>
              <div><span>Potongan kasbon</span><b>{usdT(slipRow.deduct)}</b></div>
            </div>
            <div className="co-slip-net">
              <span className="co-k">Gaji bersih</span>
              <div className="co-big">{usdT(slipRow.salary - slipRow.deduct)}</div>
              <div className="co-rp">{toIdr(slipRow.salary - slipRow.deduct, slipRow.rate ?? rate)}</div>
              <span className="co-stamp">BUKU DITUTUP · {ymName(slipRow.ym).toUpperCase()}</span>
            </div>
            <button type="button" className="co-btn" onClick={() => setSlip(null)}>Tutup</button>
          </div>
        </div>
      ) : null}
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
        <p className="cs-sl">Cara bayar</p>
        <div className="co-seg">
          {(['monthly', 'once', 'install'] as const).map((k) => <button type="button" key={k} className={e.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}>{k === 'monthly' ? 'Tiap bulan' : k === 'once' ? 'Sekali' : 'Dicicil'}</button>)}
        </div>
        <div className="cs-card">
          {e.kind === 'install' ? <label className="cs-field"><span>Lama cicilan</span><span className="cs-in"><input inputMode="numeric" value={e.months} onChange={(ev) => set({ months: Math.max(1, Math.min(120, Math.round(parseNum(ev.target.value) || 1))) })} /><i>bulan</i></span></label> : null}
          {e.kind !== 'once' ? <label className="cs-field"><span>Bayar tiap tanggal</span><span className="cs-in"><input inputMode="numeric" value={e.day} onChange={(ev) => set({ day: Math.max(1, Math.min(31, Math.round(parseNum(ev.target.value) || 1))) })} /></span></label> : null}
          <label className="cs-field"><span>{e.kind === 'once' ? 'Bulan bayar' : 'Mulai'}</span><input type="month" value={e.start} onChange={(ev) => set({ start: ev.target.value || e.start })} /></label>
          {e.kind !== 'once' ? <label className="cs-field"><span>Berhenti</span><input type="month" value={e.end ?? ''} onChange={(ev) => set({ end: ev.target.value || null })} /></label> : null}
        </div>
        {nd ? <p className="cs-note">⏰ Bayar berikutnya <b>{dayName(nd.d, tz)}</b> · {days(nd.d)}</p> : null}
        {err ? <p className="co-warn">{err}</p> : null}
        <button type="button" className="co-btn" disabled={busy || !ok} onClick={() => commit({ ...s, costs: exists ? s.costs.map((x) => (x.id === e.id ? e : x)) : [...s.costs, e] })}>{exists ? 'Simpan' : 'Tambah biaya'}</button>
        <div className="co-row2">
          <button type="button" className="co-btn ghost" onClick={() => setEdit(null)}>Batal</button>
          {exists ? <button type="button" className="co-btn ghost dn" onClick={() => commit({ ...s, costs: s.costs.filter((x) => x.id !== e.id) })}>Hapus</button> : null}
        </div>
      </div>
    );
  }

  /* ----- overview ----- */
  const totalIdr = s.costs.reduce((a, x) => a + perMonth(x), 0);
  const upcoming = s.costs.map((x) => ({ x, n: nextDue(x) })).filter((q) => q.n).sort((a, b) => a.n!.d - b.n!.d)[0];
  const ex = 100, gaji = (ex * s.salaryPct) / 100;
  return (
    <div className="co cs" key="list">
      <div className="cs-hero">
        <span className="co-k">Biaya bulan ini</span>
        <b>{idrT(totalIdr)}</b>
        <small>{rate && totalIdr ? `± ${usdT(totalIdr / rate)} · ` : ''}{s.costs.length} biaya</small>
        {upcoming ? <div className="cs-next">Berikutnya: <b>{cap(upcoming.x.name)}</b> · {dayName(upcoming.n!.d, tz)} ({days(upcoming.n!.d)})</div> : null}
      </div>

      <p className="cs-sl">Tagihan</p>
      <div className="cs-card">
        {s.costs.length ? s.costs.map((x) => {
          const due = unpaid(x);
          return (
            <div key={x.id} className="cs-cost">
              <button type="button" className="cs-cost-main" onClick={() => setEdit(x)}>
                <span className="cs-av" style={{ background: colorOf(x.id) }}>{cap(x.name).slice(0, 1)}</span>
                <span className="co-grow"><b>{cap(x.name)}</b><small>{kindTxt(x)}</small></span>
                <span className="cs-amt">{idrT(x.kind === 'install' ? x.idr / x.months : x.idr)}</span>
              </button>
              {due ? <div className="cs-due"><span>Jatuh tempo {days(due.d)}</span><button type="button" onClick={async () => { try { await setPaid(x.id, due.ym, true); } catch (e2) { setErr((e2 as Error).message); } }}>✓ Sudah bayar</button></div> : null}
            </div>
          );
        }) : <p className="cs-empty">Belum ada biaya. Tambahkan VPS, langganan, dan lainnya.</p>}
        <button type="button" className="cs-add" onClick={() => setEdit({ id: newId(), name: '', idr: 0, kind: 'monthly', months: 12, day: Number(new Date(now).getDate()), start: cur, end: null, created: now })}>＋ Tambah biaya</button>
      </div>

      <p className="cs-sl">Gaji</p>
      <div className="cs-tiles one">
        <div><span className="co-k">Gaji dari laba</span><Stepper value={s.salaryPct} step={5} min={0} max={100} fmt={(n) => `${n}%`} onChange={(n) => setS({ ...s, salaryPct: n })} /></div>
      </div>
      <p className="cs-note">Contoh: laba $100 → gaji <b>{usdT(gaji)}</b>, <b>{usdT(ex - gaji)}</b> jadi modal.</p>

      <p className="cs-sl">Notifikasi</p>
      <div className="cs-card">
        {([['officeBills', '🧾', 'Pengingat tagihan di kantor', '3 hari sebelum jatuh tempo'], ['bills', '✈️', 'Tagihan ke Telegram', 'Hari H, jam 09:00'], ['weekly', '📅', 'Ringkasan mingguan', 'Sabtu, jam 22:00'], ['monthly', '🗓️', 'Laporan bulanan', 'Hari terakhir, jam 22:00']] as const).map(([k, ic, t, sub]) => {
          const on = k === 'officeBills' ? s.officeBills : s.tg[k];
          return (
            <button type="button" key={k} className="cs-row" role="switch" aria-checked={on} onClick={() => setS(k === 'officeBills' ? { ...s, officeBills: !on } : { ...s, tg: { ...s.tg, [k]: !on } })}>
              <span className="cs-ic">{ic}</span><span className="co-grow"><b>{t}</b><small>{sub}</small></span><span className={`co-tg ${on ? 'on' : ''}`} />
            </button>
          );
        })}
      </div>

      <button type="button" className="cs-more" onClick={() => setMore((v) => !v)}>{more ? 'Sembunyikan' : 'Pengaturan lain'} <span>{more ? '▴' : '▾'}</span></button>
      {more ? <div className="cs-card">
        <label className="cs-field"><span>Perusahaan mulai<small>Data sebelum bulan ini tidak dihitung</small></span><input type="month" value={s.since} onChange={(ev) => ev.target.value && setS({ ...s, since: ev.target.value })} /></label>
        <label className="cs-field"><span>Batas biaya per bulan<small>0 = tanpa batas</small></span><span className="cs-in"><i>Rp</i><input inputMode="numeric" defaultValue={s.budgetIdr ? s.budgetIdr.toLocaleString('id-ID') : ''} placeholder="0" onBlur={(ev) => setS({ ...s, budgetIdr: Math.max(0, Math.round(parseNum(ev.target.value) || 0)) })} /></span></label>
        <label className="cs-field"><span>Perkiraan biaya tarik (tetap)<small>Biaya jaringan per penarikan</small></span><span className="cs-in"><input inputMode="decimal" defaultValue={String(s.wdFee.fixed)} onBlur={(ev) => { const n = parseNum(ev.target.value); if (Number.isFinite(n)) setS({ ...s, wdFee: { ...s.wdFee, fixed: Math.max(0, n) } }); }} /><i>USDT</i></span></label>
        <label className="cs-field"><span>Perkiraan biaya tarik (%)<small>Selisih kurs saat jual ke Rupiah</small></span><span className="cs-in"><input inputMode="decimal" defaultValue={String(s.wdFee.pct)} onBlur={(ev) => { const n = parseNum(ev.target.value); if (Number.isFinite(n)) setS({ ...s, wdFee: { ...s.wdFee, pct: Math.max(0, Math.min(20, n)) } }); }} /><i>%</i></span></label>
      </div> : null}

      {err ? <p className="co-warn">{err}</p> : null}
      {dirty ? <div className="cs-save"><button type="button" className="co-btn" disabled={busy} onClick={() => save(s, true)}>{busy ? 'Menyimpan…' : 'Simpan perubahan'}</button></div> : null}
    </div>
  );
}
