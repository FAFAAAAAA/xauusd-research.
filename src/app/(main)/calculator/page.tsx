'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { call, peek, px } from '@/components/client';
import { ErrorBox, Loading, PageHead, SecHead, Seg, toast } from '@/components/Status';
import { RiskCalculator } from '@/components/RiskCalculator';
import { lotFor } from '@/lib/core/journal';

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

/** Calculators: risk plan (saved; used for the lot in signals), lot per trade, and the capital & lot risk calculator. */
export default function CalculatorPage() {
  const [d, setD] = useState<any>(() => peek('/api/live'));
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); call<any>('/api/live').then(setD).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);

  const [cap, setCap] = useState(''); const [rp, setRp] = useState(''); const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { if (d?.risk && cap === '' && rp === '') { setCap(String(d.risk.capital)); setRp(String(d.risk.riskPct)); } }, [d, cap, rp]);
  const riskUsd = (num(cap) * num(rp)) / 100;
  const saveRisk = async () => {
    setSaved(null);
    try { const r = await call<any>('/api/live', { method: 'PUT', json: { capital: num(cap), riskPct: num(rp) } }); setD((x: any) => ({ ...x, risk: r.risk })); toast('Rencana risiko tersimpan'); }
    catch (e) { setSaved((e as Error).message); }
  };
  const [cSide, setCSide] = useState<'BUY' | 'SELL'>('BUY'); const [cEntry, setCEntry] = useState(''); const [cSl, setCSl] = useState('');
  const ce = num(cEntry), cs = num(cSl);
  const cOk = ce > 0 && cs > 0 && (cSide === 'BUY' ? cs < ce : cs > ce);
  const calc = cOk && riskUsd > 0 ? lotFor(riskUsd, ce, cs) : null;
  const cTp = cOk ? ce + (cSide === 'BUY' ? 2 : -2) * Math.abs(ce - cs) : NaN;
  const [jMsg, setJMsg] = useState<string | null>(null);
  const openDraft = async (x: { side: 'BUY' | 'SELL'; entry: string; sl: string; tp: string; lot: string }) => {
    setJMsg(null);
    try {
      await call('/api/journal', { method: 'POST', json: { strategy: 'lain', side: x.side, entry: num(x.entry), sl: num(x.sl), tp: num(x.tp), lot: num(x.lot), openedAt: Date.now(), result: 'open', note: '' } });
      setJMsg('Tercatat di jurnal (menu Trade).'); toast('Tercatat di jurnal');
    } catch (e) { setJMsg((e as Error).message); }
  };

  if (err && !d) return <><PageHead title="Kalkulator" /><ErrorBox error={err} retry={load} /></>;
  if (!d) return <><PageHead title="Kalkulator" /><Loading /></>;
  return (
    <div className="stack">
      <PageHead title="Kalkulator" />

      <section className="group stack">
        <SecHead title="Rencana risiko" />
        <div className="grid two">
          <label className="field">Modal ($)<input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
          <label className="field">Risiko per trade (%)<input inputMode="decimal" value={rp} onChange={(e) => setRp(e.target.value)} /></label>
        </div>
        <div className="row between">
          <span className="mute">Risiko per trade <strong className="ink" style={{ fontSize: 18, marginLeft: 6 }}>{Number.isFinite(riskUsd) ? `$${riskUsd.toFixed(2)}` : '—'}</strong></span>
          <button className="btn sm primary" onClick={saveRisk}>Simpan</button>
        </div>
        {saved ? <div className="error">{saved}</div> : null}
      </section>

      <section className="group stack">
        <SecHead title="Lot per trade" meta="TP = RR 1:2" />
        <div style={{ maxWidth: 260 }}><Seg full label="Arah" options={[['BUY', 'BUY'], ['SELL', 'SELL']] as const} value={cSide} onChange={setCSide} /></div>
        <div className="grid two">
          <label className="field">Entry<input inputMode="decimal" value={cEntry} onChange={(e) => setCEntry(e.target.value)} placeholder="mis. 2650.50" /></label>
          <label className="field">Stop loss<input inputMode="decimal" value={cSl} onChange={(e) => setCSl(e.target.value)} placeholder="mis. 2642.00" /></label>
        </div>
        {cEntry && cSl && !cOk ? <p className="error">SL harus {cSide === 'BUY' ? 'di bawah' : 'di atas'} entry.</p> : null}
        {calc ? (
          <div className="facts" style={{ marginTop: 0 }}>
            <div><span className="mute small">Lot</span><strong>{calc.lot > 0 ? calc.lot.toFixed(2) : '< 0,01'}</strong></div>
            <div><span className="mute small">Risiko sebenarnya</span><strong>${calc.risk.toFixed(2)}</strong></div>
            <div><span className="mute small">TP (RR 1:2)</span><strong>{px(cTp)}</strong></div>
            <div><span className="mute small">Jarak SL</span><strong>{calc.dist.toFixed(2)}</strong></div>
          </div>
        ) : null}
        {jMsg ? <p className="mute small">{jMsg} <Link href="/trade">Buka</Link></p> : null}
        {calc && calc.lot > 0 ? (
          <div><button className="btn sm" onClick={() => openDraft({ side: cSide, entry: cEntry, sl: cSl, tp: cTp.toFixed(2), lot: calc.lot.toFixed(2) })}>Catat ke jurnal</button></div>
        ) : null}
      </section>

      <RiskCalculator />
    </div>
  );
}
