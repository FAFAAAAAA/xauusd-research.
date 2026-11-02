'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, fmt, peek, px } from '@/components/client';
import { ErrorBox, Loading, PageHead, SecHead, Seg, Spinner, toast } from '@/components/Status';
import Link from 'next/link';
import { liveSignalFrom, lotFor, type JournalTrade, type JournalStats } from '@/lib/core/journal';

/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`);
const tone = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
// Backtest reference (Exness Raw Spread costs + swap, 2004–2026, RR 1:2): what live results should be compared with.
const BT: Record<string, { win: number; perMonth: number; label: string }> = {
  v1: { win: 0.411, perMonth: 3.1, label: 'v1 · Level H1' },
  v2: { win: 0.342, perMonth: 5.0, label: 'v2 · Breakout volatilitas' },   // + ±15% impas (BE)
  v3: { win: 0.404, perMonth: 4.1, label: 'v3 · BOS H1' },
};
interface Draft { strategy: string; side: 'BUY' | 'SELL'; entry: string; sl: string; tp: string; lot: string; note: string }
const EMPTY: Draft = { strategy: 'v2', side: 'BUY', entry: '', sl: '', tp: '', lot: '', note: '' };
const RESULT: Record<string, string> = { tp: 'TP', sl: 'SL', be: 'Impas', manual: 'Manual' };

export default function TradePage() {
  const [d, setD] = useState<any>(() => peek('/api/live'));
  const [j, setJ] = useState<{ trades: JournalTrade[]; stats: Record<string, JournalStats> } | null>(() => peek('/api/journal'));
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setErr(null);
    call<any>('/api/live').then(setD).catch((e) => setErr(e.message));
    call<any>('/api/journal').then(setJ).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const riskUsd = d?.risk ? (d.risk.capital * d.risk.riskPct) / 100 : NaN;

  // journal form
  const [draft, setDraft] = useState<Draft | null>(null);
  const [jErr, setJErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const openDraft = (x: Partial<Draft>) => { setJErr(null); setDraft({ ...EMPTY, ...x }); setTimeout(() => document.getElementById('jurnal')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const submit = async () => {
    if (!draft) return;
    setJErr(null); setSaving(true);
    try {
      const r = await call<any>('/api/journal', { method: 'POST', json: { ...draft, entry: num(draft.entry), sl: num(draft.sl), tp: num(draft.tp), lot: num(draft.lot), openedAt: Date.now(), result: 'open' } });
      setJ(r); setDraft(null); toast('Trade tersimpan');
    } catch (e) { setJErr((e as Error).message); } finally { setSaving(false); }
  };
  const close = async (t: JournalTrade, result: 'tp' | 'sl' | 'be' | 'manual') => {
    let exit: number | undefined;
    if (result === 'manual') {
      const v = window.prompt('Harga keluar?', String(t.entry));
      if (v == null) return;
      exit = num(v);
    }
    setBusyId(t.id);
    try { setJ(await call<any>('/api/journal', { method: 'PUT', json: { id: t.id, result, exit, closedAt: Date.now() } })); toast('Posisi ditutup'); }
    catch (e) { setJErr((e as Error).message); } finally { setBusyId(null); }
  };
  const remove = async (t: JournalTrade) => {
    if (!window.confirm('Hapus trade ini dari jurnal?')) return;
    try { setJ(await call<any>(`/api/journal?id=${t.id}`, { method: 'DELETE' })); toast('Trade dihapus'); } catch (e) { setJErr((e as Error).message); }
  };

  if (err && !d) return <><PageHead title="Trade" /><ErrorBox error={err} retry={load} /></>;
  if (!d || !j) return <><PageHead title="Trade" /><Loading /></>;
  const tz = d.timezone;
  const signals = (d.events as any[]).map((e) => ({ e, s: liveSignalFrom(e.extra, e.price) })).filter((x) => x.s);
  const openT = j.trades.filter((t) => t.result === 'open');
  const closedT = j.trades.filter((t) => t.result !== 'open');
  const stratOf = (label: string) => (label.startsWith('v1') ? 'v1' : label.startsWith('v2') ? 'v2' : label.startsWith('v3') ? 'v3' : 'lain');

  return (
    <div className="stack">
      <PageHead title="Trade"
        actions={!draft ? <button className="btn sm primary" onClick={() => openDraft({})}>+ Catat trade</button> : null} />

      <div className="riskbar">
        <span>Modal <strong>${d.risk.capital}</strong></span>
        <span>Risiko <strong>{d.risk.riskPct}%</strong></span>
        <span><strong>${riskUsd.toFixed(2)}</strong> per trade</span>
        <Link href="/calculator">Ubah</Link>
      </div>

      {/* journal form (opens from a signal, the calculator, or the button above) */}
      {draft ? (
        <section className="group stack appear" id="jurnal" style={{ scrollMarginTop: 16 }}>
          <SecHead title="Catat trade" />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div className="picker"><span className="label">Metode</span>
              <Seg full label="Metode" options={(['v1', 'v2', 'v3', 'lain'] as const).map((s) => [s, s] as const)} value={draft.strategy} onChange={(s) => setDraft({ ...draft, strategy: s })} /></div>
            <div className="picker"><span className="label">Arah</span>
              <Seg full label="Arah" options={[['BUY', 'BUY'], ['SELL', 'SELL']] as const} value={draft.side} onChange={(s) => setDraft({ ...draft, side: s })} /></div>
          </div>
          <div className="grid two">
            {(['entry', 'sl', 'tp', 'lot'] as const).map((k) => (
              <label key={k} className="field">{k === 'sl' ? 'Stop loss' : k === 'tp' ? 'Take profit' : k === 'lot' ? 'Lot' : 'Entry (harga isi)'}
                <input inputMode="decimal" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></label>
            ))}
          </div>
          <label className="field">Catatan<input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="opsional" /></label>
          {jErr ? <div className="error">{jErr}</div> : null}
          <div className="row"><button className="btn primary" onClick={submit} disabled={saving}>{saving ? <><Spinner />Menyimpan…</> : 'Simpan trade'}</button><button className="btn ghost" onClick={() => setDraft(null)} disabled={saving}>Batal</button></div>
        </section>
      ) : null}

      <section className="group">
        <SecHead title="Sinyal live" meta={signals.length ? `${Math.min(10, signals.length)} terbaru` : undefined} />
        {signals.length ? (
          <div className="list">
            {signals.slice(0, 10).map(({ e, s }) => {
              const l = lotFor(riskUsd, s!.entry, s!.sl);
              return (
                <div key={e.id} className="trow">
                  <div className="top">
                    <span><span className={`tag ${s!.side === 'BUY' ? 'buy' : 'sell'}`}>{s!.side}</span><span className="t">{e.strategy_version_label}</span></span>
                    <span className="mute small">{fmt(e.event_time, tz)}</span>
                  </div>
                  <div className="levels">
                    <span><span className="k">Entry ≈</span><strong>{px(s!.entry)}</strong></span>
                    <span><span className="k">SL</span><strong>{px(s!.sl)}</strong></span>
                    <span><span className="k">TP</span><strong>{px(s!.tp)}</strong></span>
                    <span><span className="k">Lot</span><strong>{l && l.lot > 0 ? l.lot.toFixed(2) : '—'}</strong></span>
                    {s!.be ? <span><span className="k">BE (SL → entry)</span><strong>{px(s!.be)}</strong></span> : null}
                  </div>
                  <div><button className="btn sm" onClick={() => openDraft({ strategy: stratOf(e.strategy_version_label), side: s!.side, entry: String(s!.entry), sl: String(s!.sl), tp: String(s!.tp), lot: l && l.lot > 0 ? l.lot.toFixed(2) : '' })}>Catat ke jurnal</button></div>
                </div>
              );
            })}
          </div>
        ) : <p className="empty-inline">Belum ada sinyal.</p>}
      </section>

      {openT.length ? (
        <section className="group">
          <SecHead title="Posisi terbuka" meta={openT.length} />
          <div className="list">
            {openT.map((t) => (
              <div key={t.id} className={`trow${busyId === t.id ? ' refreshing' : ''}`}>
                <div className="top">
                  <span><span className={`tag ${t.side === 'BUY' ? 'buy' : 'sell'}`}>{t.side}</span><span className="t">{t.strategy} · {t.lot.toFixed(2)} lot</span></span>
                  <span className="mute small">{fmt(t.openedAt, tz)}</span>
                </div>
                <div className="levels" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                  <span><span className="k">Entry</span><strong>{px(t.entry)}</strong></span>
                  <span><span className="k">SL</span><strong>{px(t.sl)}</strong></span>
                  <span><span className="k">TP</span><strong>{px(t.tp)}</strong></span>
                </div>
                <div className="actions">
                  <button className="btn sm" onClick={() => close(t, 'tp')} disabled={busyId === t.id}>Kena TP</button>
                  <button className="btn sm" onClick={() => close(t, 'sl')} disabled={busyId === t.id}>Kena SL</button>
                  <button className="btn sm" onClick={() => close(t, 'be')} disabled={busyId === t.id}>Impas</button>
                  <button className="btn sm" onClick={() => close(t, 'manual')} disabled={busyId === t.id}>Tutup manual</button>
                  <button className="btn sm ghost" onClick={() => remove(t)} disabled={busyId === t.id}>Hapus</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="group">
        <SecHead title="Performa" />
        <div className="tablewrap">
          <table className="num-r">
            <thead><tr><th>Metode</th><th>Selesai</th><th>Win</th><th>Win backtest</th><th>Hasil</th><th>Rata-rata</th></tr></thead>
            <tbody>
              {(['v1', 'v2', 'v3', 'all'] as const).map((k) => {
                const s = j.stats[k];
                return (
                  <tr key={k} className={k === 'all' ? 'total' : undefined}>
                    <td>{k === 'all' ? 'Semua' : k}</td><td>{s.closed}</td>
                    <td>{s.winRate == null ? '—' : `${(s.winRate * 100).toFixed(0)}%`}</td>
                    <td className="mute">{BT[k] ? `${(BT[k].win * 100).toFixed(0)}%` : '—'}</td>
                    <td className={tone(s.pnl)}>{money(s.pnl)}</td><td className={tone(s.avgR)}>{s.avgR == null ? '—' : `${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="group">
        <SecHead title="Riwayat" meta={closedT.length ? `${closedT.length} trade` : undefined} />
        {closedT.length ? (
          <div className="list">
            {closedT.slice(0, 50).map((t) => (
              <div key={t.id} className="item">
                <span style={{ minWidth: 0 }}>
                  <span className="t" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className={`tag ${t.side === 'BUY' ? 'buy' : 'sell'}`}>{t.side}</span>{t.strategy} · {RESULT[t.result] ?? 'Manual'}</span>
                  <span className="d" style={{ display: 'block', marginTop: 2 }}>{fmt(t.openedAt, tz)} · {px(t.entry)} → {px(t.exit)}{t.note ? ` · ${t.note}` : ''}</span>
                </span>
                <span className="row" style={{ gap: 4, flex: 'none', flexWrap: 'nowrap' }}>
                  <span className={`num ${tone(t.pnl)}`} style={{ fontWeight: 600 }}>{money(t.pnl)}</span>
                  <button className="btn sm ghost icon" onClick={() => remove(t)} aria-label="Hapus">✕</button>
                </span>
              </div>
            ))}
          </div>
        ) : <p className="empty-inline">Belum ada trade.</p>}
        {jErr && !draft ? <div className="error" style={{ marginTop: 10 }}>{jErr}</div> : null}
      </section>

    </div>
  );
}
