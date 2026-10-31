'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { call, fmt, peek, px } from '@/components/client';
import { ErrorBox, Loading, ModeTag, PageHead, Status } from '@/components/Status';
import { CATEGORY_LABEL } from '@/lib/core/news';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dash = any;

const EVENT_LABEL: Record<string, string> = {
  SNR_NEAR: 'Mendekati zona', SNR_TOUCH: 'Menyentuh zona', SNR_BREAKOUT: 'Breakout', SNR_RETEST: 'Retest',
  SETUP_CONFIRMED: 'Setup entry', SETUP_INVALIDATED: 'Setup batal',
};

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
  const real = (d.coverage as any[]).filter((c) => !c.is_test);
  const tfOf = (tf: string) => real.some((c) => c.timeframe === tf);
  const tgOk = tg.tokenConfigured && tg.chatConfigured && tg.lastTest?.ok;
  const steps = [
    { t: 'Impor data M15', d: 'File CSV harga emas per 15 menit', done: tfOf('M15'), href: '/settings#data' },
    { t: 'Bentuk H1, H4 dan D1', d: 'Satu tombol di Atur → Data harga', done: tfOf('H1') && tfOf('H4') && tfOf('D1'), href: '/settings#data' },
    { t: 'Jalankan backtest', d: 'Lihat hasil RR 1:1, 1:2, 1:3', done: d.eventCounts.BACKTEST > 0, href: '/analytics' },
    { t: 'Hubungkan Telegram', d: 'Supaya bot bisa kirim sinyal', done: !!tgOk, href: '/settings#telegram' },
  ];
  const allDone = steps.every((s) => s.done);
  const events = [...d.liveEvents, ...d.backtestEvents].sort((a: any, b: any) => b.event_time - a.event_time).slice(0, 5);

  return (
    <div className="stack">
      <PageHead title="Beranda" />

      {d.latestCandle ? (
        <section className="hero">
          <span className="label">Harga terakhir di data kamu</span>
          <span className="price">{px(d.latestCandle.close)}</span>
          <span className="mute small">{fmt(d.latestCandle.time, tz)} · {d.latestCandle.timeframe} · {d.latestCandle.source}</span>
        </section>
      ) : null}

      {!allDone ? (
        <section className="group">
          <h2>Langkah memulai</h2>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.t} className={s.done ? 'done' : ''}>
                <span className="check" aria-hidden>{s.done ? '✓' : i + 1}</span>
                <span><span className="t" style={{ fontWeight: 600, display: 'block' }}>{s.t}</span><span className="mute small">{s.d}</span></span>
                {s.done ? <span className="mute small">Selesai</span> : <Link className="btn sm" href={s.href}>Buka</Link>}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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
        <h2>Sinyal terbaru</h2>
        {events.length ? (
          <div className="list">
            {events.map((e: any) => (
              <div key={e.id} className="item">
                <span style={{ minWidth: 0 }}>
                  <span className="t" style={{ display: 'block' }}>{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                  <span className="d">{fmt(e.event_time, tz)} · {px(e.price)}</span>
                </span>
                <ModeTag mode={e.mode} test={e.is_test} />
              </div>
            ))}
          </div>
        ) : <p className="mute">Belum ada sinyal. Sinyal muncul dari replay, backtest, atau alert TradingView.</p>}
      </section>

      <section className="group">
        <h2>Berita penting minggu ini</h2>
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
    </div>
  );
}
