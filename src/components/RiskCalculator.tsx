'use client';
import { useState } from 'react';
import { SecHead, Seg } from '@/components/Status';
import { IDEAL_DD_SHARE, RISK_LABEL, RISK_META, RISK_STATS } from '@/lib/core/risk-stats';

/* Capital & lot risk calculator: scales the historical backtest of v1 XAU / v1 NAS / v1 BTC (in R) to the owner's capital and risk. */
type Key = keyof typeof RISK_STATS;
// Only the strategies the owner trades are offered (7 Nov 2026: "v1 XAU" = key v2, "v1 NAS" = key nas); the other stats stay in risk-stats.ts.
const SHOWN: Key[] = ['v2', 'nas', 'btc'];
const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: n !== 0 && Math.abs(n) < 100 ? 2 : 0 })}`;
const pc = (n: number) => `${(n * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

export function RiskCalculator() {
  const [k, setK] = useState<Key>('v2');
  const [cap, setCap] = useState('1000');
  const [unit, setUnit] = useState<'usd' | 'cent'>('usd');
  const [mode, setMode] = useState<'pct' | 'lot'>('pct');
  const [val, setVal] = useState('0.5');
  const [go, setGo] = useState(false);
  const s = RISK_STATS[k], meta = RISK_META[k];
  const modal = num(cap) / (unit === 'cent' ? 100 : 1);
  const v = num(val);
  // dollar risk per trade: percent of capital, or a fixed lot at the strategy's median SL distance
  const r = mode === 'pct' ? (modal * v) / 100 : v * s.medianSl * meta.contract / (unit === 'cent' ? 100 : 1);
  const ok = modal > 0 && r > 0 && Number.isFinite(r);
  const dd = s.maxDdR * r, ddShare = dd / modal;
  const status = ddShare <= IDEAL_DD_SHARE ? { t: 'Sesuai modal ideal', c: 'pos', bg: 'var(--up-tint)' }
    : ddShare < 0.7 ? { t: 'Berisiko — di atas batas ideal', c: 'warn', bg: 'var(--warn-tint)' }
    : ddShare < 1 ? { t: 'Terlalu berisiko', c: 'neg', bg: 'var(--down-tint)' }
    : { t: 'Akun bisa habis — drawdown historis melebihi modal', c: 'neg', bg: 'var(--down-tint)' };
  const idealR = (IDEAL_DD_SHARE * modal) / s.maxDdR;                         // $ risk per trade that keeps DD ≤ 40%
  const dp = meta.dp ?? 2, f10 = 10 ** dp;   // lot decimals (Binance BTC quantity: 0.001)
  const lotAt = (risk: number) => Math.floor((risk / (s.medianSl * meta.contract)) * f10 * (unit === 'cent' ? 100 : 1) + 1e-9) / f10;
  const minLot = meta.minLot, lotTxt = (l: number) => (l >= minLot ? l.toFixed(dp) : `< ${minLot.toFixed(dp).replace('.', ',')}`);
  const idealModal = (s.maxDdR * r) / IDEAL_DD_SHARE;
  const streaks = [5, 10, s.maxLossStreak].filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b);
  const blow = Math.floor(modal / r);
  const bar = Math.min(1, ddShare);

  return (
    <section className="group stack">
      <SecHead title="Risiko modal & lot" meta={`backtest ${meta.period}`} />
      {SHOWN.length > 1 ? <Seg scroll label="Strategi" options={SHOWN.map((x) => [x, RISK_LABEL[x]] as const)} value={k} onChange={setK} /> : <p className="mute small">Strategi: <strong>{RISK_LABEL[k]}</strong></p>}
      <div className="grid two">
        <label className="field">Modal<input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
        <label className="field">Satuan modal<select value={unit} onChange={(e) => setUnit(e.target.value as 'usd' | 'cent')}><option value="usd">Dolar (USD)</option><option value="cent">Cent (akun cent)</option></select></label>
        <label className="field">Hitung dari<select value={mode} onChange={(e) => { setMode(e.target.value as 'pct' | 'lot'); setVal(e.target.value === 'lot' ? String(minLot) : '0.5'); }}>
          <option value="pct">Risiko % per trade</option><option value="lot">Lot tetap</option></select></label>
        <label className="field">{mode === 'pct' ? 'Risiko per trade (%)' : `Lot${unit === 'cent' ? ' (akun cent)' : ''}`}<input inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} /></label>
        {mode === 'lot' && minLot > 0.01 ? <p className="mute small" style={{ gridColumn: '1 / -1' }}>Lot minimum {RISK_LABEL[k]} di {meta.broker ?? 'Exness'}: {minLot}</p> : null}
      </div>
      {unit === 'cent' && Number.isFinite(modal) ? <p className="mute small">= {usd(modal)} (100 cent = $1)</p> : null}
      <button className="btn primary block" onClick={() => setGo(true)} disabled={!ok}>Hitung risiko</button>

      {go && ok ? (
        <div className="stack appear">
          <div className="notice" style={{ background: status.bg, borderColor: 'transparent' }}>
            <strong className={status.c}>{status.t}</strong>
            <div className="small" style={{ marginTop: 4 }}>
              Risiko <strong>{usd(r)}</strong>/trade{mode === 'pct' ? ` · lot ${lotAt(r) >= minLot ? `±${lotAt(r).toFixed(dp)}` : `< ${minLot.toFixed(dp).replace('.', ',')} (minimum broker)`}` : ''} · drawdown terburuk <strong>{pc(ddShare)}</strong> modal ({usd(-dd)})
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--line)', marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: `${bar * 100}%`, height: '100%', borderRadius: 3, transition: 'width .5s var(--ease)', background: ddShare <= IDEAL_DD_SHARE ? 'var(--up)' : ddShare < 0.7 ? 'var(--warn)' : 'var(--down)' }} />
            </div>
          </div>

          <div className="facts" style={{ marginTop: 0 }}>
            <div><span className="mute small">Risiko ideal per trade</span><strong>{usd(idealR)} ({pc(idealR / modal)})</strong></div>
            <div><span className="mute small">Lot ideal (SL median {meta.unit === '$' ? `$${s.medianSl}` : `${s.medianSl} poin`})</span><strong>{lotTxt(lotAt(idealR))}</strong></div>
            <div><span className="mute small">Modal ideal untuk risiko ini</span><strong>{usd(idealModal)}</strong></div>
            <div><span className="mute small">Posisi terbuka maks (historis)</span><strong>{s.maxOpen} = {usd(s.maxOpen * r)}</strong></div>
          </div>

          <h3 style={{ marginTop: 6 }}>Perkiraan hasil</h3>
          <div className="facts" style={{ marginTop: 0 }}>
            <div><span className="mute small">Per bulan</span><strong className="pos">+{usd(s.perMonthR * r)} ({pc((s.perMonthR * r) / modal)})</strong></div>
            <div><span className="mute small">Per tahun</span><strong className="pos">+{usd(s.perMonthR * 12 * r)} ({pc((s.perMonthR * 12 * r) / modal)})</strong></div>
            <div><span className="mute small">Trade per bulan · win</span><strong>{s.perMonth} · {pc(s.winRate)}</strong></div>
            <div><span className="mute small">Bulan yang minus</span><strong>{pc(s.negMonthsPct)}</strong></div>
            <div><span className="mute small">Bulan terburuk</span><strong className="neg">{usd(s.worstMonthR * r)} ({pc((s.worstMonthR * r) / modal)})</strong></div>
            <div><span className="mute small">12 bulan terburuk</span><strong className="neg">{usd(s.worst12mR * r)} ({pc((s.worst12mR * r) / modal)})</strong></div>
          </div>

          <details className="more">
          <summary>Rugi beruntun</summary>
          <div className="tablewrap">
            <table className="num-r">
              <thead><tr><th>Kena SL berturut-turut</th><th>Total rugi</th><th>% modal</th></tr></thead>
              <tbody>
                {streaks.map((n) => <tr key={n}><td>{n}×{n === s.maxLossStreak ? ' (terpanjang historis)' : ''}</td><td>{usd(-n * r)}</td><td className={n * r >= modal ? 'neg' : ''}>{pc((n * r) / modal)}</td></tr>)}
                <tr><td>Drawdown historis ({s.maxDdR}R)</td><td>{usd(-dd)}</td><td className={ddShare >= 1 ? 'neg' : ''}>{pc(ddShare)}</td></tr>
                <tr><td>Modal habis</td><td>{usd(-modal)}</td><td>100% · setelah ±{blow} SL</td></tr>
              </tbody>
            </table>
          </div>
          </details>
          <p className="mute small">Dari backtest, bukan jaminan. Drawdown di masa depan bisa lebih besar.</p>
        </div>
      ) : null}
    </section>
  );
}
