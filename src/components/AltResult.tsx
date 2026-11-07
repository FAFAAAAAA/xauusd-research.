'use client';
import { SecHead } from '@/components/Status';
import R from '@/lib/core/alt-result.json';

/* v1 ALT — Binance Futures: SELL volatility breakout on fast & crowded coins. The website engine backtests one pair from bundled
 * files; this strategy trades a daily-changing set of ±20 coins out of 440+, so its result comes from the research run
 * (scratch scripts, 7 Nov 2026) and is shown here as a fixed summary. */
type Res = { stats: Record<string, number>; pf: number; from_: string; to: string; coins: number; holdMedianH: number;
  years: Record<string, [number, number, number]>; equity: [string, number][]; topCoins: [string, number, number][] };
const d = R as unknown as Res;
const n1 = (x: number) => x.toLocaleString('id-ID', { maximumFractionDigits: 1 });
const sg = (x: number) => `${x >= 0 ? '+' : '−'}${n1(Math.abs(x))}R`;

function Curve() {
  const pts = d.equity.map((e) => e[1]); const W = 600, H = 120, P = 4;
  const lo = Math.min(0, ...pts), hi = Math.max(...pts);
  const x = (i: number) => P + (i / Math.max(1, pts.length - 1)) * (W - 2 * P), y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const path = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const yrs = d.equity.map((e, i) => [e[0], i] as const).filter(([p]) => p.endsWith('-01'));
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Kurva hasil kumulatif v1 ALT (R)">
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="var(--line)" />
      <path d={path} fill="none" stroke="var(--up)" strokeWidth="2" />
      {yrs.map(([p, i]) => <text key={p} x={x(i)} y={H + 12} fontSize="10" fill="var(--mute)" textAnchor="middle">{p.slice(0, 4)}</text>)}
    </svg>
  );
}

export function AltResult() {
  const s = d.stats;
  return (
    <details className="group more">
      <summary><strong>v1 ALT — Binance Futures, SELL di koin cepat &amp; ramai</strong> <span className="mute small">hasil riset · PF {d.pf.toFixed(2)} · {n1(s.perMonth)} trade/bln</span></summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <p className="small">
          <strong>Koin:</strong> setiap hari dipilih ulang dari semua koin USDT-M — volume rata-rata 30 hari ≥ $100 jt/hari <em>dan</em> gerak harian (ATR14 D1 %)
          di atas median koin-koin ramai itu (±20 koin per hari). <strong>SELL</strong> saat candle 1 jam close menembus ke bawah <em>open hari ini (UTC) − 0,5 × range kemarin</em>
          (sekali per hari per koin). SL = level + 0,35 × ATR14 D1, TP 2× jarak SL, keluar hanya di TP/SL. Maks 3 posisi terbuka, 1 per koin. Tanpa BUY (semua varian BUY di koin ini rugi).
        </p>
        <div className="facts" style={{ marginTop: 0 }}>
          <div><span className="mute small">Periode</span><strong>{d.from_} – {d.to}</strong></div>
          <div><span className="mute small">Trade · per bulan</span><strong>{s.trades} · {n1(s.perMonth)}</strong></div>
          <div><span className="mute small">Win · PF</span><strong>{n1(s.winRate * 100)}% · {d.pf.toFixed(2)}</strong></div>
          <div><span className="mute small">Hasil per bulan</span><strong className="pos">{sg(s.perMonthR)}</strong></div>
          <div><span className="mute small">Drawdown terburuk</span><strong className="neg">{n1(s.maxDdR)}R</strong></div>
          <div><span className="mute small">Rugi beruntun terpanjang</span><strong>{s.maxLossStreak}×</strong></div>
          <div><span className="mute small">Hold median · SL median</span><strong>{n1(d.holdMedianH)} jam · {n1(s.medianSl)}%</strong></div>
          <div><span className="mute small">Koin yang pernah ditradingkan</span><strong>{d.coins}</strong></div>
        </div>
        <SecHead title="Kurva hasil (R)" />
        <Curve />
        <div className="tablewrap">
          <table className="num-r">
            <thead><tr><th>Tahun</th><th>Trade</th><th>Hasil</th><th>PF</th></tr></thead>
            <tbody>{Object.entries(d.years).map(([y, [n, r, pf]]) => <tr key={y}><td>{y}</td><td>{n}</td><td className={r >= 0 ? 'pos' : 'neg'}>{sg(r)}</td><td>{pf.toFixed(2)}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mute small">Paling sering: {d.topCoins.map(([c, n, r]) => `${c} ${n}× (${sg(r)})`).join(' · ')}</p>
        <p className="mute small">
          Hasil riset, bukan mesin backtest website: data 1 jam Binance (data.binance.vision) 448 koin termasuk yang delisting; biaya fee + slippage 0,12% pulang-pergi;
          funding short dianggap 0. Aturan dipilih dari banyak tes dan belum dibedah — perlakukan sebagai kandidat, uji di Testnet dulu. Bukan nasihat keuangan.
        </p>
      </div>
    </details>
  );
}
