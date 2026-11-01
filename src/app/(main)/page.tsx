'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { call } from '@/components/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ErrorBox, Loading, PageHead } from '@/components/Status';
import ResearchOverview from '@/components/ResearchOverview';
import LiveOverview from '@/components/LiveOverview';

export default function Dashboard() {
  const { data, error, mutate, isValidating } = useSWR('/api/dashboard', call<any>, { refreshInterval: 30_000, shouldRetryOnError: false });
  return <div className="stack">
    <div className="page-heading-row"><PageHead title="Dashboard" sub="Satu tempat untuk memahami performa strategi Anda." /><div className="page-actions"><button className="btn icon-button" aria-label="Muat ulang ringkasan live" disabled={isValidating} onClick={() => void mutate()}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12 0l2 5M4 12l2 5a7 7 0 0 0 12 0" /></svg></button><Link href="/analytics?view=run" className="btn primary"><span aria-hidden="true">+</span> Backtest baru</Link></div></div>
    <div className="row"><span className="tag">Overview</span><span className="small mute">XAUUSD & multi-asset</span></div>
    <ResearchOverview timezone={data?.timezone ?? 'UTC'} />
    {data ? <LiveOverview data={data} /> : error ? <section className="group"><div className="section-heading"><div><h2>Trading live & integrasi</h2><p>Jurnal, sinyal, koneksi, dan agenda ekonomi</p></div></div><ErrorBox error={error.message} retry={() => void mutate()} /></section> : <Loading what="jurnal dan integrasi" />}
  </div>;
}
