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
          {S.target > 0 ? <>
            <div className="co-bar"><i style={{ width: `${Math.max(0, Math.min(100, (m.net / S.target) * 100))}%` }} /></div>
            <div className="co-barl"><span>Target {usdT(S.target)}</span><span>{Math.max(0, Math.round((m.net / S.target) * 100))}%</span></div>
          </> : null}
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

        <h3 className="co-h">Neraca</h3>
        <div className="co-card">
          <div className="co-eq">
            <div><small>Aset</small><b>{usdT(r.sheet.assets)}</b></div><em>=</em>
            <div><small>Kewajiban</small><b>{usdT(r.sheet.liabilities)}</b></div><em>+</em>
            <div><small>Ekuitas</small><b>{usdT(r.sheet.equity)}</b></div>
          </div>
          {r.sheet.diff == null ? null : Math.abs(r.sheet.diff) <= Math.max(1, Math.abs(r.sheet.expected ?? 0) * 0.005)
            ? <div className="co-ok">✓ Seimbang</div>
            : <div className="co-ok warn">Selisih {usdT(r.sheet.diff, true)} dengan saldo Binance</div>}
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
export function CompanySettingsView({ now, onDone }: { now: number; onDone: () => void }) {
  const c = useCompany();
  const [s, setS] = useState<CompanySettings>(() => c?.settings ?? DEFAULT_COMPANY);
  const [edit, setEdit] = useState<Cost | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  useEffect(() => { if (c?.settings) setS(c.settings); }, [c?.settings]);
  const tz = deviceTz(), cur = ymOf(now, tz), rate = c?.fx?.rate ?? null;
  const save = async (next = s) => { setBusy(true); setErr(''); try { await saveCompany(next); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const nextDue = (x: Cost) => { for (let i = 0; i < 14; i++) { const ym = addYm(cur, i); if (!costIdrIn(x, ym)) continue; const d = dueAt(x, ym, tz); if (d >= now - 86_400_000) return { ym, d }; } return null; };
  const unpaid = (x: Cost) => { for (const ym of [addYm(cur, -1), cur, addYm(cur, 1)]) { if (!costIdrIn(x, ym) || (s.paid[x.id] ?? []).includes(ym)) continue; const d = dueAt(x, ym, tz); if (now >= d - 3 * 86_400_000 && d >= x.created - 86_400_000) return ym; } return null; };
  const kindTxt = (x: Cost) => (x.kind === 'once' ? 'Sekali' : x.kind === 'install' ? `Dicicil ${x.months} bln` : 'Bulanan');

  if (edit) {
    const e = edit, set = (p: Partial<Cost>) => setEdit({ ...e, ...p });
    const exists = s.costs.some((x) => x.id === e.id);
    const nd = e.idr > 0 ? nextDue(e) : null;
    return (
      <div className="co co-set" key="edit">
        <div className="co-grp">
          <label className="co-it"><span>Nama</span><input value={e.name} maxLength={40} placeholder="mis. VPS" onChange={(ev) => set({ name: ev.target.value })} /></label>
          <label className="co-it"><span>Jumlah (Rp)</span><input inputMode="numeric" value={e.idr ? e.idr.toLocaleString('id-ID') : ''} placeholder="320.000" onChange={(ev) => set({ idr: Math.max(0, Math.round(parseNum(ev.target.value) || 0)) })} /></label>
          {e.idr > 0 && rate ? <div className="co-it sub"><span /><small>± {usdT(e.idr / rate)} (kurs hari ini)</small></div> : null}
        </div>
        <div className="co-seg">
          {(['monthly', 'once', 'install'] as const).map((k) => <button type="button" key={k} className={e.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}>{k === 'monthly' ? 'Tiap bulan' : k === 'once' ? 'Sekali' : 'Dicicil'}</button>)}
        </div>
        <div className="co-grp">
          {e.kind === 'install' ? <label className="co-it"><span>Berapa bulan</span><input inputMode="numeric" value={e.months} onChange={(ev) => set({ months: Math.max(1, Math.min(120, Math.round(parseNum(ev.target.value) || 1))) })} /></label> : null}
          <label className="co-it"><span>Tanggal bayar</span><input inputMode="numeric" value={e.day} onChange={(ev) => set({ day: Math.max(1, Math.min(31, Math.round(parseNum(ev.target.value) || 1))) })} /></label>
          <label className="co-it"><span>Mulai</span><input type="month" value={e.start} onChange={(ev) => set({ start: ev.target.value || e.start })} /></label>
          {e.kind !== 'once' ? <label className="co-it"><span>Berhenti</span><input type="month" value={e.end ?? ''} onChange={(ev) => set({ end: ev.target.value || null })} /></label> : null}
        </div>
        {nd ? <div className="co-card co-sliprow"><span className="co-ic out">⏰</span><span className="co-grow"><span className="co-k">Bayar berikutnya</span><b>{dayName(nd.d, tz)} · {Math.max(0, Math.ceil((nd.d - now) / 86_400_000))} hari lagi</b></span></div> : null}
        {err ? <p className="co-warn">{err}</p> : null}
        <button type="button" className="co-btn" disabled={busy || !e.name.trim() || !(e.idr > 0)} onClick={() => { const next = { ...s, costs: exists ? s.costs.map((x) => (x.id === e.id ? e : x)) : [...s.costs, e] }; setS(next); setEdit(null); save(next); }}>Simpan</button>
        <div className="co-row2">
          <button type="button" className="co-btn ghost" onClick={() => setEdit(null)}>Batal</button>
          {exists ? <button type="button" className="co-btn ghost dn" onClick={() => { const next = { ...s, costs: s.costs.filter((x) => x.id !== e.id) }; setS(next); setEdit(null); save(next); }}>Hapus biaya</button> : null}
        </div>
      </div>
    );
  }
  const numIn = (v: number, on: (n: number) => void, suffix = '') => <input inputMode="decimal" defaultValue={String(v)} onBlur={(ev) => { const n = parseNum(ev.target.value); if (Number.isFinite(n)) on(n); }} aria-label={suffix} />;
  return (
    <div className="co co-set" key="list">
      <div className="co-grp">
        <label className="co-it"><span>Target laba bersih ($/bulan)</span>{numIn(s.target, (n) => setS({ ...s, target: Math.max(0, n) }), 'target')}</label>
        <label className="co-it"><span>Gaji (% laba)</span>{numIn(s.salaryPct, (n) => setS({ ...s, salaryPct: Math.max(0, Math.min(100, n)) }), 'gaji')}</label>
        <label className="co-it"><span>Anggaran biaya (Rp/bulan)</span><input inputMode="numeric" defaultValue={s.budgetIdr ? s.budgetIdr.toLocaleString('id-ID') : ''} placeholder="0" onBlur={(ev) => setS({ ...s, budgetIdr: Math.max(0, Math.round(parseNum(ev.target.value) || 0)) })} /></label>
        <div className="co-it"><span>Biaya penarikan</span><span className="co-pair">{numIn(s.wdFee.fixed, (n) => setS({ ...s, wdFee: { ...s.wdFee, fixed: Math.max(0, n) } }), 'usdt')}<i>USDT +</i>{numIn(s.wdFee.pct, (n) => setS({ ...s, wdFee: { ...s.wdFee, pct: Math.max(0, Math.min(20, n)) } }), 'persen')}<i>%</i></span></div>
      </div>
      <p className="co-sl">Biaya</p>
      <div className="co-grp">
        {s.costs.map((x) => {
          const due = unpaid(x);
          return (
            <div key={x.id} className="co-it cost">
              <button type="button" className="co-grow" onClick={() => setEdit(x)}><b>{x.name}</b><small>{kindTxt(x)} · tgl {x.day} · sejak {ymName(x.start)} {x.start.slice(2, 4)}{x.end ? ` – ${ymName(x.end)} ${x.end.slice(2, 4)}` : ''}</small></button>
              {due ? <button type="button" className="co-paid" onClick={async () => { try { await setPaid(x.id, due, true); } catch (e) { setErr((e as Error).message); } }}>Sudah bayar</button>
                : <button type="button" className="co-val" onClick={() => setEdit(x)}>{idrT(x.kind === 'install' ? x.idr / x.months : x.idr)}</button>}
            </div>
          );
        })}
        <button type="button" className="co-add" onClick={() => setEdit({ id: newId(), name: '', idr: 0, kind: 'monthly', months: 12, day: Number(new Date(now).getDate()), start: cur, end: null, created: now })}>＋ Tambah biaya</button>
      </div>
      <p className="co-sl">Pengingat & Telegram</p>
      <div className="co-grp">
        {([['officeBills', 'Pengingat tagihan di kantor', '3 hari sebelum sampai sudah bayar'], ['bills', 'Tagihan ke Telegram', 'Hari H · 09:00'], ['monthly', 'Ringkasan bulanan', 'Hari terakhir · 22:00'], ['weekly', 'Ringkasan mingguan', 'Sabtu · 22:00']] as const).map(([k, t, sub]) => {
          const on = k === 'officeBills' ? s.officeBills : s.tg[k];
          return (
            <button type="button" key={k} className="co-it" onClick={() => setS(k === 'officeBills' ? { ...s, officeBills: !on } : { ...s, tg: { ...s.tg, [k]: !on } })}>
              <span className="co-grow"><b>{t}</b><small>{sub}</small></span><span className={`co-tg ${on ? 'on' : ''}`} aria-checked={on} role="switch" />
            </button>
          );
        })}
      </div>
      <p className="co-sl">Akun MT5</p>
      <div className="co-seg">
        <button type="button" className={s.mt5 === 'prop' ? 'on' : ''} onClick={() => setS({ ...s, mt5: 'prop' })}>Akun prop</button>
        <button type="button" className={s.mt5 === 'own' ? 'on' : ''} onClick={() => setS({ ...s, mt5: 'own' })}>Uang sendiri</button>
      </div>
      {err ? <p className="co-warn">{err}</p> : null}
      <button type="button" className="co-btn" disabled={busy} onClick={() => save()}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
    </div>
  );
}
