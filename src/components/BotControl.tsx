'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, peek } from './client';
import { Loading, Spinner, toast } from './Status';

/* eslint-disable @typescript-eslint/no-explicit-any */

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} dtk lalu` : s < 3600 ? `${Math.round(s / 60)} mnt lalu` : s < 86400 ? `${Math.round(s / 3600)} jam lalu` : `${Math.round(s / 86400)} hari lalu`;
}

/** Remote settings for the Binance bot: the bot fetches them every ~60 s and applies them itself (no order is sent from here). */
export function BotControlCard() {
  const [d, setD] = useState<any>(() => peek('/api/bot-control'));
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(() => call<any>('/api/bot-control').then((x) => { setD(x); setNow(Date.now()); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  const c = d?.control, seen = d?.seen, ap = seen?.applied;
  useEffect(() => { if (c && !f) setF({ ...c }); }, [c, f]);
  if (!d || !f) return <div className="bc"><div className="bc-top"><b>Kontrol bot</b></div><Loading what="kontrol bot" /></div>;
  const online = seen && now - seen.at < 5 * 60_000, fresh = !!ap;
  const val = (k: 'riskPercent' | 'maxSell' | 'maxBuy') => (f[k] ?? (ap ? ap[k] : null));
  const dirty = ['riskPercent', 'maxSell', 'maxBuy'].some((k) => f[k] !== c[k]);
  const pending = !dirty && ap && c.updatedAt > seen.at;
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const step = (k: 'riskPercent' | 'maxSell' | 'maxBuy', delta: number, lo: number, hi: number, dp = 0) => {
    const cur = val(k) ?? (k === 'riskPercent' ? 1 : k === 'maxSell' ? 3 : 2);
    set(k, Math.round(Math.min(hi, Math.max(lo, cur + delta)) * 10 ** dp) / 10 ** dp);
  };
  const save = async (next = f, keep?: any) => {
    setBusy(true); setErr(null);
    try { const r = await call<any>('/api/bot-control', { method: 'PUT', json: next }); setD(r); setF(keep ? { ...keep, paused: r.control.paused } : { ...r.control }); toast('Terkirim — bot memakai setelan baru dalam ±1 menit'); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const Row = ({ k, label, unit, d1, lo, hi, dp }: { k: 'riskPercent' | 'maxSell' | 'maxBuy'; label: string; unit: string; d1: number; lo: number; hi: number; dp?: number }) => (
    <div className="bc-row">
      <span className="bc-l">{label}{f[k] == null ? <small>dari config VPS</small> : null}</span>
      <span className="bc-step">
        <button type="button" aria-label="Kurangi" onClick={() => step(k, -d1, lo, hi, dp)}>−</button>
        <b>{val(k) == null ? '—' : `${String(val(k)).replace('.', ',')}${unit}`}</b>
        <button type="button" aria-label="Tambah" onClick={() => step(k, d1, lo, hi, dp)}>+</button>
      </span>
    </div>
  );
  return (
    <div className="bc">
      <div className="bc-top">
        <b>Kontrol bot</b>
        <span className={`bc-dot ${online ? (c.paused ? 'pause' : 'on') : 'off'}`}>{online ? (ap?.paused ? 'Jeda' : 'Aktif') : seen ? 'Tidak ada kabar' : 'Belum terhubung'}</span>
      </div>
      <p className="bc-sub">{seen ? `Bot cek ${ago(now - seen.at)}${ap?.version ? ` · versi ${ap.version}` : ''}` : 'Ganti snr_bot.py di VPS dengan versi terbaru (Atur → EA MT5 & bot Binance) agar bot bisa diatur dari sini.'}</p>
      <button type="button" className={`bc-pause ${f.paused ? 'is' : ''}`} role="switch" aria-checked={!f.paused} onClick={() => save({ ...c, paused: !c.paused }, f)} disabled={busy}>
        <span><b>{f.paused ? 'Trading dijeda' : 'Trading berjalan'}</b><small>{f.paused ? 'Tidak buka posisi baru. Posisi terbuka tetap jalan dengan SL/TP.' : 'Bot boleh membuka posisi baru.'}</small></span>
        <i className={`co-tg ${f.paused ? '' : 'on'}`} />
      </button>
      <div className="bc-card">
        <Row k="riskPercent" label="Risiko per trade" unit="%" d1={0.5} lo={0.5} hi={5} dp={1} />
        <Row k="maxSell" label="Maks posisi SELL" unit="" d1={1} lo={1} hi={6} />
        <Row k="maxBuy" label="Maks posisi BUY" unit="" d1={1} lo={0} hi={4} />
      </div>
      {ap ? <p className="bc-now">Dipakai bot sekarang: risiko {ap.riskMode === 'usdt' ? `${ap.riskUsdt} USDT` : `${String(ap.riskPercent).replace('.', ',')}%`} · {ap.maxSell} SELL · {ap.maxBuy} BUY{ap.paused ? ' · jeda' : ''}{pending ? ' — menunggu bot memakai setelan baru…' : ''}</p> : null}
      {err ? <div className="error">{err}</div> : null}
      {dirty ? <div className="row"><button className="btn primary" disabled={busy} onClick={() => save()}>{busy ? <><Spinner />Mengirim…</> : 'Kirim ke bot'}</button><button className="btn" onClick={() => setF({ ...c })}>Batal</button></div> : null}
      {!dirty && (c.riskPercent != null || c.maxSell != null || c.maxBuy != null) ? <button type="button" className="bc-reset" onClick={() => save({ ...f, riskPercent: null, maxSell: null, maxBuy: null })}>Kembalikan ke config VPS</button> : null}
      {!fresh && seen ? <p className="bc-sub">Bot versi lama belum mengirim setelannya.</p> : null}
    </div>
  );
}

