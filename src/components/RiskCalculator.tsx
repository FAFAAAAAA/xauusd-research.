'use client';
import { useState } from 'react';
import { IDEAL_DD_SHARE, RISK_LABEL, RISK_STATS } from '@/lib/core/risk-stats';

/* Capital & lot risk calculator: scales the historical backtest of v1/v2 (in R) to the owner's capital and risk. */
type Key = keyof typeof RISK_STATS;
const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: n !== 0 && Math.abs(n) < 100 ? 2 : 0 })}`;
const pc = (n: number) => `${(n * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

export function RiskCalculator() {
  const [k, setK] = useState<Key>('v1v2');
  const [cap, setCap] = useState('1000');
  const [unit, setUnit] = useState<'usd' | 'cent'>('usd');
  const [mode, setMode] = useState<'pct' | 'lot'>('pct');
  const [val, setVal] = useState('0.5');
  const [go, setGo] = useState(false);
  const s = RISK_STATS[k];
  const modal = num(cap) / (unit === 'cent' ? 100 : 1);
  const v = num(val);
  // dollar risk per trade: percent of capital, or a fixed lot at the strategy's median SL distance
  const r = mode === 'pct' ? (modal * v) / 100 : v * s.medianSl * 100 / (unit === 'cent' ? 100 : 1);
  const ok = modal > 0 && r > 0 && Number.isFinite(r);
  const dd = s.maxDdR * r, ddShare = dd / modal;
  const status = ddShare <= IDEAL_DD_SHARE ? { t: 'Sesuai modal ideal', c: 'pos', bg: 'var(--up-tint)' }
    : ddShare < 0.7 ? { t: 'Berisiko — di atas batas ideal', c: '', bg: 'var(--gold-tint)' }
    : ddShare < 1 ? { t: 'Terlalu berisiko', c: 'neg', bg: 'var(--down-tint)' }
    : { t: 'Akun bisa habis — drawdown historis melebihi modal', c: 'neg', bg: 'var(--down-tint)' };
  const idealR = (IDEAL_DD_SHARE * modal) / s.maxDdR;                         // $ risk per trade that keeps DD ≤ 40%
  const lotAt = (risk: number) => Math.floor((risk / (s.medianSl * 100)) * 100 * (unit === 'cent' ? 100 : 1) + 1e-9) / 100;
  const idealModal = (s.maxDdR * r) / IDEAL_DD_SHARE;
  const streaks = [5, 10, s.maxLossStreak].filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b);
  const blow = Math.floor(modal / r);
  const bar = Math.min(1, ddShare);

  return (
    <>
    <section className="group">
      <h2>Kalkulator risiko modal &amp; lot</h2>
      <p className="mute small">Masukkan modal dan risiko, lalu lihat perkiraan drawdown, ketahanan rugi beruntun, dan hasil — dari backtest 2004–2026.</p>
      <div className="seg scroll" style={{ marginTop: 8 }}>
        {(Object.keys(RISK_STATS) as Key[]).map((x) => <button key={x} aria-pressed={k === x} onClick={() => setK(x)}>{RISK_LABEL[x]}</button>)}
      </div>
      <div className="grid two" style={{ marginTop: 10 }}>
        <label className="field">Modal<input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
        <label className="field">Satuan modal<select value={unit} onChange={(e) => setUnit(e.target.value as 'usd' | 'cent')}><option value="usd">Dolar (USD)</option><option value="cent">Cent (akun cent)</option></select></label>
        <label className="field">Hitung dari<select value={mode} onChange={(e) => { setMode(e.target.value as 'pct' | 'lot'); setVal(e.target.value === 'lot' ? '0.01' : '0.5'); }}>
          <option value="pct">Risiko % per trade</option><option value="lot">Lot tetap</option></select></label>
        <label className="field">{mode === 'pct' ? 'Risiko per trade (%)' : `Lot${unit === 'cent' ? ' (akun cent)' : ''}`}<input inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} /></label>
      </div>
      {unit === 'cent' && Number.isFinite(modal) ? <p className="mute small">= {usd(modal)} (100 cent = $1)</p> : null}
      <button className="btn primary block" style={{ marginTop: 10 }} onClick={() => setGo(true)} disabled={!ok}>Hitung risiko</button>

    </section>
      {go && ok ? (
        <>
        <section className="group stack">
          <h2>Eksposur risiko</h2>
          <div className="notice" style={{ background: status.bg }}>
            <strong className={status.c}>{status.t}</strong>
            <div className="small" style={{ marginTop: 4 }}>
              Risiko per trade ≈ <strong>{usd(r)}</strong> ({pc(r / modal)} modal){mode === 'lot' ? ` · dihitung dari jarak SL median ${s.medianSl.toFixed(2)} (SL biasanya ${s.p25Sl.toFixed(0)}–${s.p75Sl.toFixed(0)})` : ` · lot ${lotAt(r) >= 0.01 ? `±${lotAt(r).toFixed(2)}` : '< 0,01 (di bawah lot minimum broker)'} di SL median ${s.medianSl.toFixed(2)}`}.
            </div>
            <div className="small" style={{ marginTop: 6 }}>Drawdown historis terburuk: <strong>{s.maxDdR}R = {usd(-dd)}</strong> = <strong>{pc(ddShare)}</strong> dari modal.</div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--sunk)', marginTop: 6, overflow: 'hidden' }}>
              <div style={{ width: `${bar * 100}%`, height: '100%', background: ddShare <= IDEAL_DD_SHARE ? 'var(--up)' : ddShare < 0.7 ? 'var(--gold)' : 'var(--down)' }} />
            </div>
            <div className="small mute" style={{ marginTop: 4 }}>Batas ideal: drawdown historis ≤ {pc(IDEAL_DD_SHARE)} modal.</div>
          </div>

          <div className="facts">
            <div><span className="mute small">Risiko ideal per trade</span><strong>{usd(idealR)} ({pc(idealR / modal)})</strong></div>
            <div><span className="mute small">Lot ideal (SL median)</span><strong>{lotAt(idealR) >= 0.01 ? lotAt(idealR).toFixed(2) : '< 0,01'}</strong></div>
            <div><span className="mute small">Modal ideal untuk risiko ini</span><strong>{usd(idealModal)}</strong></div>
            <div><span className="mute small">Posisi terbuka maks (historis)</span><strong>{s.maxOpen} = {usd(s.maxOpen * r)}</strong></div>
          </div>

        </section>
        <section className="group">
          <h2>Perkiraan hasil (rata-rata backtest)</h2>
          <div className="facts">
            <div><span className="mute small">Per bulan</span><strong className="pos">+{usd(s.perMonthR * r)} ({pc((s.perMonthR * r) / modal)})</strong></div>
            <div><span className="mute small">Per tahun</span><strong className="pos">+{usd(s.perMonthR * 12 * r)} ({pc((s.perMonthR * 12 * r) / modal)})</strong></div>
            <div><span className="mute small">Trade per bulan · win</span><strong>{s.perMonth} · {pc(s.winRate)}</strong></div>
            <div><span className="mute small">Bulan yang minus</span><strong>{pc(s.negMonthsPct)}</strong></div>
            <div><span className="mute small">Bulan terburuk</span><strong className="neg">{usd(s.worstMonthR * r)} ({pc((s.worstMonthR * r) / modal)})</strong></div>
            <div><span className="mute small">12 bulan terburuk</span><strong className="neg">{usd(s.worst12mR * r)} ({pc((s.worst12mR * r) / modal)})</strong></div>
          </div>

        </section>
        <section className="group stack">
          <h2>Ketahanan rugi beruntun</h2>
          <div className="tablewrap" tabIndex={0} role="region" aria-label="Ketahanan modal">
            <table>
              <thead><tr><th>Kena SL berturut-turut</th><th>Total rugi</th><th>% modal</th></tr></thead>
              <tbody>
                {streaks.map((n) => <tr key={n}><td>{n}×{n === s.maxLossStreak ? ' (terpanjang historis)' : ''}</td><td>{usd(-n * r)}</td><td className={n * r >= modal ? 'neg' : ''}>{pc((n * r) / modal)}</td></tr>)}
                <tr><td>Drawdown historis ({s.maxDdR}R)</td><td>{usd(-dd)}</td><td className={ddShare >= 1 ? 'neg' : ''}>{pc(ddShare)}</td></tr>
                <tr><td>Modal habis</td><td>{usd(-modal)}</td><td>100% · setelah ±{blow} SL</td></tr>
              </tbody>
            </table>
          </div>

          <div className="notice">
            <strong>Kesimpulan</strong>
            <div className="small" style={{ marginTop: 4 }}>
              {ddShare <= IDEAL_DD_SHARE
                ? `Risiko ${usd(r)} per trade sesuai modal ideal: drawdown terburuk historis menghabiskan ${pc(ddShare)} modal, masih menyisakan ${pc(1 - ddShare)}.`
                : `Risiko ${usd(r)} per trade terlalu besar untuk modal ${usd(modal)}: drawdown terburuk historis = ${pc(ddShare)} modal. Turunkan risiko ke ±${usd(idealR)} per trade, atau naikkan modal ke ±${usd(idealModal)}.`}
              {' '}Drawdown historis adalah kejadian terburuk di backtest, bukan batas maksimal — di masa depan bisa lebih besar.
            </div>
          </div>
          <p className="mute small">Dihitung dari backtest website (2004–2026, RR 1:2, biaya rata-rata broker + swap). Hasil nyata bisa berbeda; bukan jaminan dan bukan nasihat keuangan.</p>
        </section>
        </>
      ) : null}
    </>
  );
}
