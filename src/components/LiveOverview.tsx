'use client';
import Link from 'next/link';
import { fmt, px } from '@/components/client';
import { Status } from '@/components/Status';
import { CATEGORY_LABEL } from '@/lib/core/news';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function LiveOverview({ data: d }: { data: any }) {
  const tz = d.timezone, tr = d.trading, tg = d.telegram, tv = d.tradingview;
  const sig = tr.lastSignal;
  const tgOk = tg.tokenConfigured && tg.chatConfigured && tg.lastTest?.ok;
  const money = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`;
  return <>
    <div className="data-context"><h2>Trading live</h2><span>Terpisah dari hasil backtest</span></div>
    <div className="support-grid">
      <section className="group">
        <div className="section-heading"><div><h2>Jurnal bulan ini</h2><p>P/L posisi yang sudah ditutup</p></div><Link href="/trade" className="btn sm ghost">Detail →</Link></div>
        <div className="live-summary"><span className={`price ${tr.month.pnl > 0 ? 'pos' : tr.month.pnl < 0 ? 'neg' : ''}`}>{money(tr.month.pnl)}</span><span className="label">USD</span></div>
        <dl className="kv"><dt>Trade selesai</dt><dd>{tr.month.closed}</dd><dt>Win rate</dt><dd>{tr.month.winRate != null ? `${(tr.month.winRate * 100).toFixed(0)}%` : '—'}</dd><dt>Posisi terbuka</dt><dd>{tr.open}</dd></dl>
        <Link href="/calculator" className="section-link">Kalkulator risiko <span aria-hidden="true"> →</span></Link>
      </section>
      <section className="group"><div className="section-heading"><div><h2>Sinyal terakhir</h2><p>TradingView · live</p></div></div>{sig ? <><div className="row between"><h3>{sig.label}</h3><span className={`tag ${sig.side === 'BUY' ? 'buy' : 'sell'}`}>{sig.side}</span></div><p className="mute small" style={{ margin: '12px 0' }}>{fmt(sig.time, tz)}</p><dl className="kv"><dt>Entry (perkiraan)</dt><dd>{px(sig.entry)}</dd><dt>Stop loss</dt><dd>{px(sig.sl)}</dd><dt>Take profit</dt><dd>{px(sig.tp)}</dd></dl></> : <div className="stack"><p className="mute small">Belum ada sinyal. Pasang indikator v1/v2 di TradingView melalui menu Trade.</p><Link className="section-link" href="/trade">Buka Trade →</Link></div>}</section>
      <section className="group"><div className="section-heading"><div><h2>Status koneksi</h2><p>Integrasi workspace</p></div><Link href="/settings" className="btn sm ghost">Detail →</Link></div><div className="list"><div className="item"><span className="t">Telegram</span><span className="end"><Status on={!!tgOk} error={tg.lastTest && !tg.lastTest.ok}>{!tg.tokenConfigured ? 'Belum diatur' : !tg.chatConfigured ? 'Chat ID kosong' : !tg.lastTest ? 'Belum dites' : tg.lastTest.ok ? 'Terhubung' : 'Gagal'}</Status></span></div><div className="item"><span className="t">TradingView</span><span className="end"><Status on={tv.configured && tv.lastStatus?.status === 'accepted'} error={tv.lastStatus && !['accepted', 'duplicate'].includes(tv.lastStatus.status)}>{!tv.configured ? 'Belum diatur' : tv.lastStatus ? (tv.lastStatus.status === 'accepted' ? `Alert ${fmt(tv.lastStatus.at, tz)}` : 'Alert ditolak') : 'Menunggu alert'}</Status></span></div></div></section>
    </div>
    <section className="group"><div className="section-heading"><div><h2>Agenda ekonomi</h2><p>Berita penting · 7 hari mendatang</p></div><Link className="btn sm ghost" href="/news">Semua →</Link></div>{d.upcomingNews.length ? <div className="list">{d.upcomingNews.slice(0, 4).map((n: any) => <div key={n.id} className="item"><span><span className="t" style={{ display: 'block' }}>{n.title}</span><span className="d">{fmt(n.scheduledAt, tz)} · {CATEGORY_LABEL[n.category as keyof typeof CATEGORY_LABEL] ?? n.category}</span></span><span className={`tag ${n.impact === 'high' ? 'sell' : ''}`}>{n.impact === 'high' ? 'Tinggi' : n.impact}</span></div>)}</div> : <p className="mute small">Kalender belum diisi. <Link href="/news" className="section-link">Impor di Berita →</Link></p>}</section>
  </>;
}
