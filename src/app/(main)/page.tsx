'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { call, fmt, peek, px } from '@/components/client';
import { ErrorBox, Loading, PageHead, Status } from '@/components/Status';
import { CATEGORY_LABEL } from '@/lib/core/news';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dash = any;


export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(() => peek<Dash>('/api/dashboard'));
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); call<Dash>('/api/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  if (err) return <><PageHead title="Beranda" /><ErrorBox error={err} retry={load} /></>;
  if (!d) return <><PageHead title="Beranda" /><Loading /></>;
  const tz = d.timezone;
  const tg = d.telegram;
  const tv = d.tradingview;
  const tgOk = tg.tokenConfigured && tg.chatConfigured && tg.lastTest?.ok;
  const tr = d.trading;
  const sig = tr.lastSignal;
  const money = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`;
  return (
    <div className="stack">
      <PageHead title="Beranda" />

      <section className="hero">
        <span className="label">Bulan ini (jurnal live)</span>
        <span className={`price ${tr.month.pnl > 0 ? 'pos' : tr.month.pnl < 0 ? 'neg' : ''}`}>{money(tr.month.pnl)}</span>
        <span className="mute small">{tr.month.closed} trade selesai{tr.month.winRate != null ? ` · win ${(tr.month.winRate * 100).toFixed(0)}%` : ''} · {tr.open} posisi terbuka</span>
        <div className="row" style={{ marginTop: 10 }}><Link className="btn sm primary" href="/trade">Buka Trade</Link><Link className="btn sm" href="/analytics">Hasil backtest</Link></div>
      </section>

      <section className="group">
        <h2>Sinyal live terakhir</h2>
        {sig ? (
          <div className="item" style={{ marginTop: 8 }}>
            <span style={{ minWidth: 0 }}>
              <span className="t" style={{ display: 'block' }}>{sig.label}</span>
              <span className="d">{fmt(sig.time, tz)} · Entry ≈ {px(sig.entry)} · SL {px(sig.sl)} · TP {px(sig.tp)}</span>
            </span>
            <span className={`tag ${sig.side === 'BUY' ? 'buy' : 'sell'}`}>{sig.side}</span>
          </div>
        ) : <p className="mute" style={{ marginTop: 8 }}>Belum ada. Pasang indikator v1/v2 di TradingView (menu Trade).</p>}
      </section>

      <section className="group">
        <h2>Koneksi</h2>
        <div className="list">
          <div className="item">
            <span className="t">Bot Telegram</span>
            <span className="end"><Status on={!!tgOk} error={tg.lastTest && !tg.lastTest.ok}>
              {!tg.tokenConfigured ? 'Belum diatur' : !tg.chatConfigured ? 'Chat ID kosong' : !tg.lastTest ? 'Belum dites' : tg.lastTest.ok ? 'Terhubung' : 'Gagal'}
            </Status></span>
          </div>
          <div className="item">
            <span className="t">TradingView (live)</span>
            <span className="end"><Status on={tv.configured && tv.lastStatus?.status === 'accepted'} error={tv.lastStatus && !['accepted', 'duplicate'].includes(tv.lastStatus.status)}>
              {!tv.configured ? 'Belum diatur' : tv.lastStatus ? (tv.lastStatus.status === 'accepted' ? `Alert ${fmt(tv.lastStatus.at, tz)}` : 'Alert ditolak') : 'Menunggu alert'}
            </Status></span>
          </div>
        </div>
      </section>

      <section className="group">
        <div className="row between"><h2>Berita penting minggu ini</h2><Link className="btn sm ghost" href="/news">Semua</Link></div>
        {d.upcomingNews.length ? (
          <div className="list">
            {d.upcomingNews.slice(0, 4).map((n: any) => (
              <div key={n.id} className="item">
                <span style={{ minWidth: 0 }}><span className="t" style={{ display: 'block' }}>{n.title}</span>
                  <span className="d">{fmt(n.scheduledAt, tz)} · {CATEGORY_LABEL[n.category as keyof typeof CATEGORY_LABEL] ?? n.category}</span></span>
                {n.impact === 'high' ? <span className="tag sell">Tinggi</span> : <span className="tag">{n.impact}</span>}
              </div>
            ))}
          </div>
        ) : <p className="mute">Kalender belum diisi. <Link href="/news">Impor di Berita</Link></p>}
      </section>

      <p className="mute small" style={{ textAlign: 'center' }}><Link href="/replay">Replay historis</Link></p>
    </div>
  );
}
