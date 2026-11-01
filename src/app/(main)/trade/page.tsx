'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, fmt, peek, px } from '@/components/client';
import { ErrorBox, Loading, PageHead } from '@/components/Status';
import Link from 'next/link';
import { liveSignalFrom, lotFor, type JournalTrade, type JournalStats } from '@/lib/core/journal';

/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`);
const tone = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
// Backtest reference (average broker costs + swap, 2004–2026, RR 1:2): what live results should be compared with.
const BT: Record<string, { win: number; perMonth: number; label: string }> = {
  v1: { win: 0.406, perMonth: 3.5, label: 'v1 · Level H1' },
  v2: { win: 0.395, perMonth: 8.0, label: 'v2 · Breakout volatilitas' },
  v3: { win: 0.404, perMonth: 4.1, label: 'v3 · BOS H1' },
};
interface Draft { strategy: string; side: 'BUY' | 'SELL'; entry: string; sl: string; tp: string; lot: string; note: string }
const EMPTY: Draft = { strategy: 'v2', side: 'BUY', entry: '', sl: '', tp: '', lot: '', note: '' };

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
  const openDraft = (x: Partial<Draft>) => { setJErr(null); setDraft({ ...EMPTY, ...x }); setTimeout(() => document.getElementById('jurnal')?.scrollIntoView({ behavior: 'smooth' }), 50); };
  const submit = async () => {
    if (!draft) return;
    setJErr(null);
    try {
      const r = await call<any>('/api/journal', { method: 'POST', json: { ...draft, entry: num(draft.entry), sl: num(draft.sl), tp: num(draft.tp), lot: num(draft.lot), openedAt: Date.now(), result: 'open' } });
      setJ(r); setDraft(null);
    } catch (e) { setJErr((e as Error).message); }
  };
  const close = async (t: JournalTrade, result: 'tp' | 'sl' | 'be' | 'manual') => {
    let exit: number | undefined;
    if (result === 'manual') {
      const v = window.prompt('Harga keluar?', String(t.entry));
      if (v == null) return;
      exit = num(v);
    }
    try { setJ(await call<any>('/api/journal', { method: 'PUT', json: { id: t.id, result, exit, closedAt: Date.now() } })); }
    catch (e) { setJErr((e as Error).message); }
  };
  const remove = async (t: JournalTrade) => {
    if (!window.confirm('Hapus trade ini dari jurnal?')) return;
    try { setJ(await call<any>(`/api/journal?id=${t.id}`, { method: 'DELETE' })); } catch (e) { setJErr((e as Error).message); }
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
      <PageHead title="Trade" sub="Sinyal live dan jurnal. Order tetap kamu pasang sendiri." />

      <div className="notice small">
        Rencana risiko: modal <strong>${d.risk.capital}</strong> · risiko <strong>{d.risk.riskPct}%</strong> (${riskUsd.toFixed(2)} per trade) · <Link href="/calculator">ubah di Kalkulator</Link>
      </div>

      <section className="group">
        <h2>Sinyal live</h2>
        {signals.length ? (
          <div className="list" style={{ marginTop: 8 }}>
            {signals.slice(0, 10).map(({ e, s }) => {
              const l = lotFor(riskUsd, s!.entry, s!.sl);
              return (
                <div key={e.id} className="item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                  <div className="row between">
                    <span className="row" style={{ gap: 8 }}><span className={`tag ${s!.side === 'BUY' ? 'buy' : 'sell'}`}>{s!.side}</span><span className="t">{e.strategy_version_label}</span></span>
                    <span className="mute small">{fmt(e.event_time, tz)}</span>
                  </div>
                  <span className="small">Entry ≈ <strong>{px(s!.entry)}</strong> · SL <strong>{px(s!.sl)}</strong> · TP <strong>{px(s!.tp)}</strong> · Lot <strong>{l && l.lot > 0 ? l.lot.toFixed(2) : '—'}</strong></span>
                  <div><button className="btn sm" onClick={() => openDraft({ strategy: stratOf(e.strategy_version_label), side: s!.side, entry: String(s!.entry), sl: String(s!.sl), tp: String(s!.tp), lot: l && l.lot > 0 ? l.lot.toFixed(2) : '' })}>Catat ke jurnal</button></div>
                </div>
              );
            })}
          </div>
        ) : <p className="mute" style={{ marginTop: 8 }}>Belum ada sinyal dari TradingView. Lihat cara memasang di bawah.</p>}
      </section>

      <section className="group" id="jurnal">
        <div className="row between"><h2>Jurnal</h2>{!draft ? <button className="btn sm" onClick={() => openDraft({})}>+ Trade</button> : null}</div>
        {draft ? (
          <div className="stack tight" style={{ marginTop: 10 }}>
            <div className="row">
              <div className="seg">{(['v1', 'v2', 'v3', 'lain'] as const).map((s) => <button key={s} aria-pressed={draft.strategy === s} onClick={() => setDraft({ ...draft, strategy: s })}>{s}</button>)}</div>
              <div className="seg">{(['BUY', 'SELL'] as const).map((s) => <button key={s} aria-pressed={draft.side === s} onClick={() => setDraft({ ...draft, side: s })}>{s}</button>)}</div>
            </div>
            <div className="grid two">
              {(['entry', 'sl', 'tp', 'lot'] as const).map((k) => (
                <label key={k} className="field">{k === 'sl' ? 'Stop loss' : k === 'tp' ? 'Take profit' : k === 'lot' ? 'Lot' : 'Entry (harga isi)'}
                  <input inputMode="decimal" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></label>
              ))}
            </div>
            <label className="field">Catatan<input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="opsional" /></label>
            {jErr ? <div className="error">{jErr}</div> : null}
            <div className="row"><button className="btn primary sm" onClick={submit}>Simpan trade</button><button className="btn sm" onClick={() => setDraft(null)}>Batal</button></div>
          </div>
        ) : null}

        <div className="tablewrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th></th><th>Trade selesai</th><th>Win</th><th>Win backtest</th><th>Hasil</th><th>Rata-rata</th></tr></thead>
            <tbody>
              {(['v1', 'v2', 'v3', 'all'] as const).map((k) => {
                const s = j.stats[k];
                return (
                  <tr key={k}>
                    <td>{k === 'all' ? 'Semua' : k}</td><td>{s.closed}</td>
                    <td>{s.winRate == null ? '—' : `${(s.winRate * 100).toFixed(0)}%`}</td>
                    <td>{BT[k] ? `${(BT[k].win * 100).toFixed(0)}%` : '—'}</td>
                    <td className={tone(s.pnl)}>{money(s.pnl)}</td><td>{s.avgR == null ? '—' : `${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {closedT.length > 0 && closedT.length < 30 ? <p className="mute small">Belum bisa dibandingkan: butuh minimal ±30 trade selesai per metode.</p> : null}

        {openT.length ? <h3 style={{ marginTop: 14 }}>Posisi terbuka</h3> : null}
        <div className="list">
          {openT.map((t) => (
            <div key={t.id} className="item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row between">
                <span className="row" style={{ gap: 8 }}><span className={`tag ${t.side === 'BUY' ? 'buy' : 'sell'}`}>{t.side}</span><span className="t">{t.strategy} · {t.lot.toFixed(2)} lot</span></span>
                <span className="mute small">{fmt(t.openedAt, tz)}</span>
              </div>
              <span className="small">Entry {px(t.entry)} · SL {px(t.sl)} · TP {px(t.tp)}</span>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => close(t, 'tp')}>Kena TP</button>
                <button className="btn sm" onClick={() => close(t, 'sl')}>Kena SL</button>
                <button className="btn sm" onClick={() => close(t, 'be')}>Impas</button>
                <button className="btn sm" onClick={() => close(t, 'manual')}>Tutup manual</button>
                <button className="btn sm ghost" onClick={() => remove(t)}>Hapus</button>
              </div>
            </div>
          ))}
        </div>

        {closedT.length ? <h3 style={{ marginTop: 14 }}>Riwayat</h3> : null}
        <div className="list">
          {closedT.slice(0, 50).map((t) => (
            <div key={t.id} className="item">
              <span style={{ minWidth: 0 }}>
                <span className="t" style={{ display: 'block' }}>{t.strategy} · {t.side} · {t.result === 'tp' ? 'TP' : t.result === 'sl' ? 'SL' : t.result === 'be' ? 'Impas' : 'Manual'}</span>
                <span className="d">{fmt(t.openedAt, tz)} · {px(t.entry)} → {px(t.exit)}{t.note ? ` · ${t.note}` : ''}</span>
              </span>
              <span className="row" style={{ gap: 6, flex: 'none' }}>
                <span className={`num ${tone(t.pnl)}`} style={{ fontWeight: 700 }}>{money(t.pnl)}</span>
                <button className="btn sm ghost" onClick={() => remove(t)} aria-label="Hapus">✕</button>
              </span>
            </div>
          ))}
        </div>
        {!j.trades.length && !draft ? <p className="mute" style={{ marginTop: 8 }}>Belum ada trade. Catat dari sinyal, kalkulator, atau tombol + Trade.</p> : null}
        {jErr && !draft ? <div className="error">{jErr}</div> : null}
        <p className="mute small" style={{ marginTop: 8 }}>Hasil trade dihitung dari harga keluar × lot × 100 (belum termasuk komisi & swap broker).</p>
      </section>

      <p className="mute small" style={{ textAlign: 'center' }}>Sinyal datang dari indikator TradingView v1/v2 (v3 belum punya indikator) — cara pasang di <Link href="/settings#tradingview">Atur → TradingView</Link>.</p>
    </div>
  );
}
