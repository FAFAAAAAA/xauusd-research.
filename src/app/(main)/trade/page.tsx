'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, fmt, peek, px } from '@/components/client';
import { ErrorBox, Loading, PageHead } from '@/components/Status';
import { liveSignalFrom, lotFor, type JournalTrade, type JournalStats } from '@/lib/core/journal';

/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`);
const tone = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
// Backtest reference (average broker costs + swap, 2004–2026, RR 1:2): what live results should be compared with.
const BT: Record<string, { win: number; perMonth: number; label: string }> = {
  v1: { win: 0.406, perMonth: 3.5, label: 'v1 · Level H1' },
  v2: { win: 0.404, perMonth: 10.1, label: 'v2 · Breakout volatilitas' },
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

  // risk plan (saved on the server: Telegram signals use it for the lot)
  const [cap, setCap] = useState(''); const [rp, setRp] = useState(''); const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { if (d?.risk && cap === '' && rp === '') { setCap(String(d.risk.capital)); setRp(String(d.risk.riskPct)); } }, [d, cap, rp]);
  const riskUsd = (num(cap) * num(rp)) / 100;
  const saveRisk = async () => {
    setSaved(null);
    try { const r = await call<any>('/api/live', { method: 'PUT', json: { capital: num(cap), riskPct: num(rp) } }); setD((x: any) => ({ ...x, risk: r.risk })); setSaved('Tersimpan'); }
    catch (e) { setSaved((e as Error).message); }
  };

  // calculator
  const [cSide, setCSide] = useState<'BUY' | 'SELL'>('BUY'); const [cEntry, setCEntry] = useState(''); const [cSl, setCSl] = useState('');
  const ce = num(cEntry), cs = num(cSl);
  const cOk = ce > 0 && cs > 0 && (cSide === 'BUY' ? cs < ce : cs > ce);
  const calc = cOk && riskUsd > 0 ? lotFor(riskUsd, ce, cs) : null;
  const cTp = cOk ? ce + (cSide === 'BUY' ? 2 : -2) * Math.abs(ce - cs) : NaN;

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
  const stratOf = (label: string) => (label.startsWith('v1') ? 'v1' : label.startsWith('v2') ? 'v2' : 'lain');

  return (
    <div className="stack">
      <PageHead title="Trade" sub="Sinyal live, lot, dan jurnal. Order tetap kamu pasang sendiri." />

      <section className="group">
        <h2>Rencana risiko</h2>
        <div className="grid two" style={{ marginTop: 8 }}>
          <label className="field">Modal ($)<input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
          <label className="field">Risiko per trade (%)<input inputMode="decimal" value={rp} onChange={(e) => setRp(e.target.value)} /></label>
        </div>
        <div className="row between" style={{ marginTop: 10 }}>
          <span>Risiko per trade: <strong>{Number.isFinite(riskUsd) ? `$${riskUsd.toFixed(2)}` : '—'}</strong></span>
          <button className="btn sm primary" onClick={saveRisk}>Simpan</button>
        </div>
        {saved ? <p className="mute small">{saved}</p> : null}
        <p className="mute small">Dipakai untuk menghitung lot di sinyal Telegram dan di bawah.</p>
      </section>

      <section className="group">
        <h2>Kalkulator lot</h2>
        <div className="seg" style={{ marginTop: 8 }}>
          {(['BUY', 'SELL'] as const).map((s) => <button key={s} aria-pressed={cSide === s} onClick={() => setCSide(s)}>{s}</button>)}
        </div>
        <div className="grid two" style={{ marginTop: 10 }}>
          <label className="field">Entry<input inputMode="decimal" value={cEntry} onChange={(e) => setCEntry(e.target.value)} placeholder="mis. 2650.50" /></label>
          <label className="field">Stop loss<input inputMode="decimal" value={cSl} onChange={(e) => setCSl(e.target.value)} placeholder="mis. 2642.00" /></label>
        </div>
        {cEntry && cSl && !cOk ? <p className="error" style={{ marginTop: 10 }}>SL harus {cSide === 'BUY' ? 'di bawah' : 'di atas'} entry.</p> : null}
        {calc ? (
          <div className="facts">
            <div><span className="mute small">Lot</span><strong>{calc.lot > 0 ? calc.lot.toFixed(2) : '< 0,01'}</strong></div>
            <div><span className="mute small">Risiko sebenarnya</span><strong>${calc.risk.toFixed(2)}</strong></div>
            <div><span className="mute small">TP (RR 1:2)</span><strong>{px(cTp)}</strong></div>
            <div><span className="mute small">Jarak SL</span><strong>{calc.dist.toFixed(2)}</strong></div>
          </div>
        ) : null}
        {calc && calc.lot > 0 ? (
          <button className="btn sm" style={{ marginTop: 12 }} onClick={() => openDraft({ side: cSide, entry: cEntry, sl: cSl, tp: cTp.toFixed(2), lot: calc.lot.toFixed(2) })}>Catat ke jurnal</button>
        ) : null}
      </section>

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
              <div className="seg">{(['v1', 'v2', 'lain'] as const).map((s) => <button key={s} aria-pressed={draft.strategy === s} onClick={() => setDraft({ ...draft, strategy: s })}>{s}</button>)}</div>
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
              {(['v1', 'v2', 'all'] as const).map((k) => {
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

      <TradingViewSetup webhook={d.webhook} />
    </div>
  );
}

function TradingViewSetup({ webhook }: { webhook: { configured: boolean; url: string | null; last: { status: string; error: string | null } | null } }) {
  const [msg, setMsg] = useState<string | null>(null);
  const copy = async (file: string, label: string) => {
    try {
      const txt = await (await fetch(`/pine/${file}`, { cache: 'no-store' })).text();
      await navigator.clipboard.writeText(txt);
      setMsg(`${label} tersalin. Tempel di TradingView → Pine Editor.`);
    } catch { setMsg('Gagal menyalin. Buka tautan file lalu salin manual.'); }
  };
  return (
    <details className="group">
      <summary><span><h2>Pasang sinyal di TradingView</h2><span className="s">Indikator v1 & v2, notifikasi HP atau Telegram</span></span></summary>
      <div className="body">
        <div className="row">
          <button className="btn sm primary" onClick={() => copy('xau_v1.pine', 'Indikator v1')}>Salin indikator v1</button>
          <button className="btn sm primary" onClick={() => copy('xau_v2.pine', 'Indikator v2')}>Salin indikator v2</button>
        </div>
        <p className="mute small">Atau buka: <a href="/pine/xau_v1.pine" target="_blank" rel="noreferrer">xau_v1.pine</a> · <a href="/pine/xau_v2.pine" target="_blank" rel="noreferrer">xau_v2.pine</a></p>
        {msg ? <div className="notice">{msg}</div> : null}
        <ol className="small" style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>Buka TradingView, chart <strong>XAUUSD</strong> broker kamu. v1 di timeframe <strong>1 jam</strong>, v2 di <strong>15 menit</strong>.</li>
          <li>Pine Editor → tempel kode → <strong>Add to chart</strong>. Label BUY/SELL dengan SL & TP muncul di candle yang sudah tutup.</li>
          <li>Buat alert: kondisi = nama indikator → <strong>Any alert() function call</strong> → aktifkan notifikasi aplikasi.</li>
          <li><strong>Opsional (Telegram + lot otomatis):</strong> butuh paket TradingView yang punya webhook. Di pengaturan indikator isi Secret, centang &quot;format JSON&quot;, lalu di alert isi Webhook URL di bawah.</li>
        </ol>
        <div className="list">
          <div className="item"><span className="t">Webhook URL</span><span className="end" style={{ wordBreak: 'break-all' }}>{webhook.url ?? 'Isi APP_BASE_URL di Vercel'}</span></div>
          <div className="item"><span className="t">Secret di server</span><span className="end">{webhook.configured ? 'Sudah diatur' : 'Belum (TRADINGVIEW_WEBHOOK_SECRET di Vercel)'}</span></div>
          <div className="item"><span className="t">Alert terakhir</span><span className="end">{webhook.last ? (webhook.last.status === 'accepted' ? 'Diterima' : `${webhook.last.status}${webhook.last.error ? ` · ${webhook.last.error}` : ''}`) : '—'}</span></div>
        </div>
        <p className="mute small">Secret sama dengan nilai TRADINGVIEW_WEBHOOK_SECRET di Vercel. Jangan bagikan ke siapa pun.</p>
      </div>
    </details>
  );
}
