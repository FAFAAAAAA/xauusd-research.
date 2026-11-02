'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { call, fmt, peek, px } from '@/components/client';
import { CountUp, ErrorBox, Loading, Metric, Metrics, PageHead, SecHead, Status } from '@/components/Status';
import { CATEGORY_LABEL } from '@/lib/core/news';
import DimensionalScene from '@/components/DimensionalScene';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dash = any;

const money = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`;
const tone = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const winPct = (w: number | null | undefined) => (w == null ? '—' : `${(w * 100).toFixed(0)}%`);

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(() => peek<Dash>('/api/dashboard'));
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); call<Dash>('/api/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  if (err && !d) return <><PageHead title="Beranda" /><ErrorBox error={err} retry={load} /></>;
  if (!d) return <><PageHead title="Beranda" /><Loading variant="dashboard" /></>;
  const tz = d.timezone;
  const tg = d.telegram;
  const tv = d.tradingview;
  const tgOk = tg.tokenConfigured && tg.chatConfigured && tg.lastTest?.ok;
  const tr = d.trading;
  const all = tr.all;
  const sig = tr.lastSignal;
  return (
    <div className="stack dashboard-3d">
      <PageHead title="Beranda" actions={<><Link className="btn sm" href="/calculator">Kalkulator</Link><Link className="btn sm primary" href="/trade">Buka Trade</Link></>} />
      {err ? <ErrorBox error={err} retry={load} /> : null}

      {/* what matters most: this month's live result */}
      <section className="hero hero-3d" aria-labelledby="h-month" data-tilt="true">
        <span className="label" id="h-month">Bulan ini</span>
        <span className={`price ${tone(tr.month.pnl)}`}><CountUp value={tr.month.pnl} format={money} /></span>
        <div className="inline-stats">
          <span><span className="k">Trade selesai</span><strong>{tr.month.closed}</strong></span>
          <span><span className="k">Win rate</span><strong>{winPct(tr.month.winRate)}</strong></span>
          <span><span className="k">Posisi terbuka</span><strong>{tr.open}</strong></span>
        </div>
        <DimensionalScene />
      </section>

      {/* all-time journal performance (real numbers from the journal only) */}
      {all ? (
        <section className="stack tight" aria-label="Performa jurnal">
          <span className="section-title">Sepanjang waktu</span>
          <Metrics cols={4}>
            <Metric label="Total trade" value={all.closed} />
            <Metric label="Win rate" value={winPct(all.winRate)} />
            <Metric label="Hasil bersih" value={money(all.pnl)} tone={tone(all.pnl)} />
            <Metric label="Rata-rata per trade" value={all.avgR == null ? '—' : `${all.avgR >= 0 ? '+' : ''}${all.avgR.toFixed(2)}R`} tone={tone(all.avgR)} />
          </Metrics>
        </section>
      ) : null}

      <div className="cols">
        <section className="group">
          <SecHead title="Sinyal live terakhir">{sig ? <Link className="btn sm ghost" href="/trade">Semua</Link> : <span />}</SecHead>
          {sig ? (
            <div className="trow">
              <div className="top">
                <span><span className={`tag ${sig.side === 'BUY' ? 'buy' : 'sell'}`}>{sig.side}</span><span className="t">{sig.label}</span></span>
                <span className="mute small">{fmt(sig.time, tz)}</span>
              </div>
              <div className="levels" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                <span><span className="k">Entry ≈</span><strong>{px(sig.entry)}</strong></span>
                <span><span className="k">Stop loss</span><strong>{px(sig.sl)}</strong></span>
                <span><span className="k">Take profit</span><strong>{px(sig.tp)}</strong></span>
              </div>
            </div>
          ) : <p className="empty-inline">Belum ada sinyal.</p>}
        </section>

        <section className="group">
          <SecHead title="Koneksi" />
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

        <section className="group span">
          <SecHead title="Berita minggu ini"><Link className="btn sm ghost" href="/news">Semua</Link></SecHead>
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
          ) : <p className="empty-inline">Belum ada jadwal.</p>}
        </section>
      </div>
    </div>
  );
}

