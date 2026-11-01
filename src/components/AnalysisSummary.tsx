import type { computeMetrics } from '@/lib/core/metrics';

type Metrics = NonNullable<ReturnType<typeof computeMetrics>>;
const money = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`;
const tone = (n: number) => n > 0 ? 'pos' : n < 0 ? 'neg' : '';

export default function AnalysisSummary({ sum, metrics: m, context, rr, days, hours, zoneOutcomes }: {
  sum: { pnl: number; trades: number; wins: number; losses: number };
  metrics: Metrics | null; context: string; rr: number; days: number;
  hours: (n: unknown) => string; zoneOutcomes: { respect: number; breakout: number } | null;
}) {
  const frequency = (n: number) => n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace('.', ',');
  return <>
    <section className="hero verdict"><span className="eyebrow">PERFORMANCE OVERVIEW</span><h2>Net profit</h2><span className={`price ${tone(sum.pnl)}`}>{money(sum.pnl)}</span><p className="mute small">USD · {context}</p>{m ? <div className="facts"><div><span className="label">Profit factor</span><strong className={m.profitFactor != null && m.profitFactor >= 1 ? 'pos' : 'neg'}>{m.profitFactor == null ? '—' : `${m.profitFactor.toFixed(2)}×`}</strong></div><div><span className="label">Rata-rata per trade</span><strong className={tone(m.expectancy ?? 0)}>{money(m.expectancy ?? 0)}</strong></div></div> : <p className="mute small" role="status">Memuat detail…</p>}</section>
    <section className="group stack"><div><span className="eyebrow">WIN / LOSS ANALYSIS</span><h2>Distribusi hasil perdagangan</h2></div><div className="row between"><span className="pos">{sum.wins} menang</span><span className="neg">{sum.losses} kalah</span></div><div className="wlbar" aria-hidden="true"><span style={{ width: `${sum.wins / Math.max(1, sum.trades) * 100}%` }} /></div><div className="row between small"><span>Win rate <strong>{sum.trades ? `${(sum.wins / sum.trades * 100).toFixed(1)}%` : '—'}</strong></span><span className="mute">{sum.trades} trade</span></div><p className="mute small">Butuh ≥ {rr ? Math.round(100 / (1 + rr)) : '—'}% agar impas, sebelum biaya.</p>{m ? <div className="facts"><div><span className="label">Rata-rata menang</span><strong className="pos">{m.wins ? money(m.grossProfit / m.wins) : '—'}</strong></div><div><span className="label">Rata-rata kalah</span><strong className="neg">{m.losses ? money(-m.grossLoss / m.losses) : '—'}</strong></div></div> : null}</section>
    {m ? <>
      <section className="group"><span className="eyebrow">RISK & DRAWDOWN</span><h2>Risiko historis</h2><div className="facts"><div><span className="label">Maximum drawdown</span><strong className="neg">{money(-m.maxDrawdown)}</strong></div><div><span className="label">Kalah beruntun</span><strong>{m.maxConsecutiveLosses}×</strong></div><div><span className="label">Posisi bersamaan terbanyak</span><strong>{m.maxOpenPositions} posisi</strong></div><div><span className="label">Menang beruntun</span><strong>{m.maxConsecutiveWins}×</strong></div></div></section>
      <details className="group"><summary><span><h2>Statistik lanjutan</h2><span className="s">Durasi, frekuensi, dan total hasil perdagangan</span></span></summary><div className="body">
        {m.avgHoldHours != null ? <div className="hold"><h3>Rata-rata durasi posisi</h3><div className="hold3"><div><strong>{hours(m.avgHoldHours)}</strong><span>semua trade</span></div><div className="pos"><strong>{hours(m.avgHoldWinHours)}</strong><span>sampai TP</span></div><div className="neg"><strong>{hours(m.avgHoldLossHours)}</strong><span>sampai SL</span></div></div></div> : null}
        {days > 0 && sum.trades ? <div className="hold"><h3>Frekuensi perdagangan</h3><div className="hold3"><div><strong>{frequency(sum.trades / (days * 5 / 7))}</strong><span>per hari bursa</span></div><div><strong>{frequency(sum.trades / (days / 7))}</strong><span>per minggu</span></div><div><strong>{frequency(sum.trades / (days / 30.44))}</strong><span>per bulan</span></div></div></div> : null}
        <dl className="kv"><dt>Total trade menang</dt><dd className="pos">{money(m.grossProfit)}</dd><dt>Total trade kalah</dt><dd className="neg">{money(-m.grossLoss)}</dd><dt>Durasi posisi (median)</dt><dd>{hours(m.medianHoldHours)}</dd>{zoneOutcomes ? <><dt>Zona bertahan / jebol</dt><dd>{zoneOutcomes.respect} / {zoneOutcomes.breakout}</dd></> : null}</dl>
      </div></details>
    </> : null}
  </>;
}
