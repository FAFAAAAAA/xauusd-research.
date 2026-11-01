'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { call, fmt, pct } from '@/components/client';
import { ErrorBox, Loading } from '@/components/Status';
import { EquityChart, closedTrades, PeriodBreakdown } from '@/components/ResultCharts';
import { methodByStrategy } from '@/lib/core/strategy/methods-meta';
import type { computeMetrics } from '@/lib/core/metrics';

type Session = {
  id: string; name: string; strategy: string; status: string; is_test: boolean;
  symbol: string; timeframe: string; created_ms: number; period_start: number; period_end: number;
  trades: number; pnl: number; cost_config?: { rr?: number; symbol?: string };
};
type AnalyticsData = { sessions: Session[]; overall: ReturnType<typeof computeMetrics>; trades: Parameters<typeof closedTrades>[0] };
const supported = new Set(['metode level-v2', 'metode volbreak-v4']);
const money = (n: number | null | undefined) => n == null ? '—' : `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const stateLabel = (state: string) => ({ completed: 'Selesai', done: 'Selesai', failed: 'Gagal', running: 'Berjalan', pending: 'Menunggu' }[state] ?? state);

export function EmptyResearch({ title, children, action = false }: { title: string; children: React.ReactNode; action?: boolean }) {
  return <div className="chart-empty"><span className="empty-symbol" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4v16h16M8 15l4-5 4 2 4-7" /></svg></span><h3>{title}</h3><p>{children}</p>{action ? <Link href="/analytics?view=run" className="btn sm">Buka Backtest <span aria-hidden="true">→</span></Link> : null}</div>;
}

export default function ResearchOverview({ timezone }: { timezone: string }) {
  const list = useSWR<AnalyticsData>('/api/analytics', call, { shouldRetryOnError: false, refreshInterval: 60_000 });
  const sessions = list.data?.sessions.filter((s) => !s.is_test && supported.has(s.strategy)) ?? [];
  const latest = sessions.find((s) => ['completed', 'done'].includes(s.status)) ?? sessions[0];
  const result = useSWR<AnalyticsData>(latest ? `/api/analytics?session=${encodeURIComponent(latest.id)}` : null, call, { shouldRetryOnError: false });
  const metrics = result.data?.overall;
  const trades = closedTrades(result.data?.trades ?? []);
  const total = list.data?.sessions.filter((s) => !s.is_test).length;
  const report = latest ? `/analytics?session=${encodeURIComponent(latest.id)}` : '/analytics';
  const stats = [
    { label: 'Total backtest', value: total == null ? '—' : total.toLocaleString('id-ID'), note: 'Sesi tersimpan · semua strategi' },
    { label: 'Win rate', value: pct(metrics?.winRate), note: 'Trade menang / trade selesai' },
    { label: 'Net profit', value: money(metrics?.totalPnl), note: 'USD · setelah biaya', tone: metrics ? metrics.totalPnl > 0 ? 'pos' : metrics.totalPnl < 0 ? 'neg' : '' : '' },
    { label: 'Profit factor', value: metrics?.profitFactor == null ? '—' : `${metrics.profitFactor.toFixed(2)}×`, note: 'Gross profit / gross loss' },
    { label: 'Max. drawdown', value: money(metrics ? -metrics.maxDrawdown : null), note: 'USD · penurunan dari puncak', tone: metrics?.maxDrawdown ? 'neg' : '' },
  ];
  return <>
    <section className="stack" aria-labelledby="performance-heading">
      <div className="data-context"><h2 id="performance-heading">Ringkasan performa</h2><span>{latest ? <>Metrik: <strong>{methodByStrategy(latest.strategy)?.label ?? latest.strategy} · {latest.cost_config?.symbol ?? latest.symbol} · {new Date(latest.period_start).getUTCFullYear()} · RR 1:{latest.cost_config?.rr ?? '—'}</strong></> : 'Metrik sesi backtest terbaru'}</span></div>
      <dl className="overview-grid" aria-busy={list.isLoading || result.isLoading}>{stats.map((s) => <div key={s.label} className="metric"><dt>{s.label}</dt><dd className={s.tone}>{s.value}</dd><small>{s.note}</small></div>)}</dl>
      {list.error || result.error ? <ErrorBox error={(list.error ?? result.error).message} retry={() => { void list.mutate(); void result.mutate(); }} /> : null}
    </section>
    <div className="dashboard-columns">
      <section className="group">
        <div className="section-heading"><div><h2>Equity curve</h2><p>Akumulasi P/L · sesi terbaru · USD</p></div><Link className="btn sm ghost" href={report}>Detail <span aria-hidden="true">→</span></Link></div>
        {result.isLoading || list.isLoading ? <Loading what="grafik performa" /> : trades.length ? <EquityChart trades={trades} tz={timezone} /> : <EmptyResearch title={list.error || result.error ? 'Grafik belum tersedia' : 'Belum ada hasil untuk ditampilkan'} action={!list.error && !result.error}>{list.error || result.error ? 'Grafik akan tampil setelah data asli berhasil dimuat. Tidak ada data simulasi pengganti.' : 'Jalankan backtest untuk melihat perkembangan hasil strategi dari waktu ke waktu.'}</EmptyResearch>}
        {trades.length ? <details className="more"><summary>Performa berdasarkan periode</summary><PeriodBreakdown trades={trades} tz={timezone} /></details> : null}
      </section>
      <section className="group">
        <div className="section-heading"><div><h2>Aktivitas terbaru</h2><p>Backtest strategi aktif</p></div><Link className="btn sm ghost" href="/analytics">Semua <span aria-hidden="true">→</span></Link></div>
        {list.isLoading ? <Loading what="aktivitas" /> : sessions.length ? <div className="activity-list">{sessions.slice(0, 3).map((s) => <article key={s.id} className="activity-item"><div className="row between"><h3>{methodByStrategy(s.strategy)?.label ?? s.strategy} · {s.cost_config?.symbol ?? s.symbol}</h3><span className={`tag ${['completed', 'done'].includes(s.status) ? 'live' : s.status === 'failed' ? 'sell' : ''}`}>{stateLabel(s.status)}</span></div><div className="row between mute"><span>{fmt(Number(s.created_ms), timezone)}</span><span>RR 1:{s.cost_config?.rr ?? '—'}</span></div><div className="row between"><span className={Number(s.pnl) >= 0 ? 'pos' : 'neg'}>{money(Number(s.pnl))}</span><Link href={`/analytics?session=${encodeURIComponent(s.id)}`}>Lihat laporan <span aria-hidden="true"> →</span></Link></div></article>)}</div> : <EmptyResearch title={list.error ? 'Aktivitas belum dapat dimuat' : 'Belum ada backtest'}>{list.error ? 'Riwayat tetap tersimpan di sumber data. Coba muat ulang untuk melihat aktivitas.' : 'Sesi dan status proses akan tampil di sini setelah backtest dijalankan.'}</EmptyResearch>}
      </section>
    </div>
  </>;
}
