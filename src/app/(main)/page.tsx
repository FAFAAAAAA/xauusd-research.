'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { call, fmt, peek, px } from '@/components/client';
import { CountUp, ErrorBox, Loading, Metric, Metrics, PageHead, Status } from '@/components/Status';
import { CATEGORY_LABEL } from '@/lib/core/news';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dash = any;
const money = (n: number) => (n < 0 ? '−' : n > 0 ? '+' : '') + '$' + Math.abs(n).toFixed(2);
const tone = (n: number | null | undefined) => n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '';
const winPct = (w: number | null | undefined) => w == null ? '—' : (w * 100).toFixed(0) + '%';

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(() => peek<Dash>('/api/dashboard'));
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); call<Dash>('/api/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);
  useEffect(() => {
    if (!d || !('IntersectionObserver' in window)) return;
    const root = document.querySelector<HTMLElement>('.apple-home');
    if (!root) return;
    const elements = root.querySelectorAll<HTMLElement>('[data-reveal]');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    elements.forEach((element) => observer.observe(element));
    root.classList.add('apple-motion-ready');
    return () => { observer.disconnect(); root.classList.remove('apple-motion-ready'); };
  }, [d]);

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
    <div className="apple-home">
      {err ? <div className="apple-content-wrap"><ErrorBox error={err} retry={load} /></div> : null}

      <section className="apple-hero-intro" aria-labelledby="research-intro">
        <div className="apple-hero-glow" aria-hidden />
        <div className="apple-hero-copy">
          <p className="apple-kicker">XAUUSD RESEARCH</p>
          <h1 id="research-intro">Bukan sekadar trading.<br /><span>Riset sebelum keputusan.</span></h1>
          <p className="apple-hero-description">Jurnal, backtest, risiko, dan sinyal XAUUSD — dirancang untuk membuat setiap keputusan lebih terukur.</p>
          <div className="apple-hero-actions">
            <Link className="apple-pill primary" href="/analytics">Jelajahi backtest <span aria-hidden>↗</span></Link>
            <Link className="apple-pill secondary" href="/trade">Lihat perdagangan <span aria-hidden>›</span></Link>
          </div>
        </div>
        <div className="apple-hero-visual" aria-label="Pratinjau performa jurnal">
          <div className="apple-preview-halo" aria-hidden />
          <div className="apple-device">
            <div className="apple-device-top"><span className="apple-device-brand">Au <b>Research</b></span><span className="apple-device-live"><i /> Jurnal</span></div>
            <div className="apple-device-body">
              <span className="apple-preview-eyebrow">Hasil perdagangan bulan ini</span>
              <strong className={'apple-preview-value ' + tone(tr.month.pnl)}>{money(tr.month.pnl)}</strong>
              <div className="apple-wave" aria-hidden><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
              <div className="apple-preview-details">
                <span><small>Trade selesai</small><strong>{tr.month.closed}</strong></span>
                <span><small>Win rate</small><strong>{winPct(tr.month.winRate)}</strong></span>
                <span><small>Posisi terbuka</small><strong>{tr.open}</strong></span>
              </div>
            </div>
          </div>
          <p className="apple-visual-note">Nilai berasal dari jurnal aktual • Grafis gelombang hanya ilustrasi</p>
        </div>
        <a className="apple-scroll-hint" href="#apple-overview">Gulir untuk menjelajah <span aria-hidden>↓</span></a>
      </section>

      <section id="apple-overview" className="apple-story-section" aria-labelledby="apple-story-heading">
        <div className="apple-story-layout">
          <div className="apple-story-copy" data-reveal>
            <p className="apple-kicker">PERFORMA NYATA</p>
            <h2 id="apple-story-heading">Setiap angka.<br /><span>Punya makna.</span></h2>
            <p>Performa disajikan dengan jelas, tanpa angka perkiraan. Pantau hasil trading dan kenali pola sebelum mengambil keputusan berikutnya.</p>
            <Link className="apple-text-link" href="/trade">Buka jurnal <span aria-hidden>↗</span></Link>
          </div>
          <div className="apple-performance-stage" data-reveal>
            <div className="apple-performance-card">
              <span className="apple-performance-label">Performa bulan ini</span>
              <div className={'apple-performance-pnl ' + tone(tr.month.pnl)}><CountUp value={tr.month.pnl} format={money} /></div>
              <div className="apple-performance-divider" />
              <div className="apple-performance-grid">
                <div><span>Trade selesai</span><strong>{tr.month.closed}</strong></div>
                <div><span>Win rate</span><strong>{winPct(tr.month.winRate)}</strong></div>
                <div><span>Posisi terbuka</span><strong>{tr.open}</strong></div>
              </div>
            </div>
            <span className="apple-performance-caption">Data diperbarui otomatis dari jurnal.</span>
          </div>
        </div>
      </section>

      <section className="apple-feature-section" aria-labelledby="apple-feature-heading">
        <div className="apple-section-heading" data-reveal>
          <p className="apple-kicker">SATU TEMPAT UNTUK RISET</p>
          <h2 id="apple-feature-heading">Alat yang tepat.<br /><span>Untuk strategi yang teruji.</span></h2>
        </div>
        <div className="apple-feature-grid">
          <Link href="/analytics" className="apple-feature-tile apple-feature-tile-dark" data-reveal>
            <span className="apple-tile-overline">01 / BACKTEST</span>
            <h3>Uji strateginya.<br />Bukan tebakannya.</h3>
            <p>Eksplorasi hasil historis, statistik, dan perbandingan strategi trading.</p>
            <span className="apple-tile-cta">Buka backtest <b aria-hidden>↗</b></span>
            <div className="apple-tile-decoration apple-bars" aria-hidden><i /><i /><i /><i /><i /><i /><i /><i /></div>
          </Link>
          <Link href="/calculator" className="apple-feature-tile apple-feature-tile-light" data-reveal>
            <span className="apple-tile-overline">02 / MANAJEMEN RISIKO</span>
            <h3>Risiko terukur.<br />Pikiran lebih jernih.</h3>
            <p>Hitung ukuran posisi, stop loss, dan target berdasarkan rencana kamu.</p>
            <span className="apple-tile-cta">Buka kalkulator <b aria-hidden>↗</b></span>
            <div className="apple-tile-decoration apple-orbits" aria-hidden><i /><i /><i /></div>
          </Link>
        </div>
      </section>

      {all ? (
        <section className="apple-journal-section" aria-label="Performa jurnal sepanjang waktu">
          <div className="apple-section-heading" data-reveal>
            <p className="apple-kicker">JURNAL PERDAGANGAN</p>
            <h2>Seluruh perjalanan.<br /><span>Dalam satu pandangan.</span></h2>
          </div>
          <div className="apple-journal-metrics" data-reveal>
            <Metrics cols={4}>
              <Metric label="Total trade" value={all.closed} />
              <Metric label="Win rate" value={winPct(all.winRate)} />
              <Metric label="Hasil bersih" value={money(all.pnl)} tone={tone(all.pnl)} />
              <Metric label="Rata-rata per trade" value={all.avgR == null ? '—' : (all.avgR >= 0 ? '+' : '') + all.avgR.toFixed(2) + 'R'} tone={tone(all.avgR)} />
            </Metrics>
          </div>
        </section>
      ) : null}

      <section className="apple-intelligence-section" aria-labelledby="apple-intelligence-heading">
        <div className="apple-section-heading" data-reveal>
          <p className="apple-kicker">TERHUBUNG DENGAN RISETMU</p>
          <h2 id="apple-intelligence-heading">Informasi penting.<br /><span>Tanpa kebisingan.</span></h2>
        </div>
        <div className="apple-intelligence-grid">
          <article className="apple-info-tile" data-reveal>
            <div className="apple-info-top"><span className="apple-info-label">Sinyal live terakhir</span><Link href="/trade" className="apple-text-link">Semua <span aria-hidden>↗</span></Link></div>
            {sig ? <>
              <div className="apple-signal-title"><span className={'tag ' + (sig.side === 'BUY' ? 'buy' : 'sell')}>{sig.side}</span><strong>{sig.label}</strong></div>
              <p className="apple-info-subline">{fmt(sig.time, tz)}</p>
              <div className="apple-signal-grid">
                <span><small>Entry ≈</small><b>{px(sig.entry)}</b></span>
                <span><small>Stop loss</small><b>{px(sig.sl)}</b></span>
                <span><small>Take profit</small><b>{px(sig.tp)}</b></span>
              </div>
            </> : <p className="apple-info-empty">Belum ada sinyal live.</p>}
          </article>
          <article className="apple-info-tile" data-reveal>
            <div className="apple-info-top"><span className="apple-info-label">Koneksi sistem</span><Link href="/settings" className="apple-text-link">Atur <span aria-hidden>↗</span></Link></div>
            <div className="apple-connection-row"><span>Bot Telegram</span><Status on={!!tgOk} error={tg.lastTest && !tg.lastTest.ok}>
              {!tg.tokenConfigured ? 'Belum diatur' : !tg.chatConfigured ? 'Chat ID kosong' : !tg.lastTest ? 'Belum dites' : tg.lastTest.ok ? 'Terhubung' : 'Gagal'}
            </Status></div>
            <div className="apple-connection-row"><span>TradingView (live)</span><Status on={tv.configured && tv.lastStatus?.status === 'accepted'} error={tv.lastStatus && !['accepted', 'duplicate'].includes(tv.lastStatus.status)}>
              {!tv.configured ? 'Belum diatur' : tv.lastStatus ? (tv.lastStatus.status === 'accepted' ? 'Alert ' + fmt(tv.lastStatus.at, tz) : 'Alert ditolak') : 'Menunggu alert'}
            </Status></div>
          </article>
          <article className="apple-info-tile apple-info-tile-wide" data-reveal>
            <div className="apple-info-top"><span className="apple-info-label">Berita minggu ini</span><Link href="/news" className="apple-text-link">Lihat semua <span aria-hidden>↗</span></Link></div>
            {d.upcomingNews.length ? d.upcomingNews.slice(0, 4).map((n: any) => (
              <div key={n.id} className="apple-news-row">
                <span><strong>{n.title}</strong><small>{fmt(n.scheduledAt, tz)} · {CATEGORY_LABEL[n.category as keyof typeof CATEGORY_LABEL] ?? n.category}</small></span>
                <span className={'tag ' + (n.impact === 'high' ? 'sell' : '')}>{n.impact === 'high' ? 'Tinggi' : n.impact}</span>
              </div>
            )) : <p className="apple-info-empty">Belum ada jadwal berita.</p>}
          </article>
        </div>
      </section>

      <section className="apple-final-section" data-reveal>
        <p className="apple-kicker">RESEARCH FIRST</p>
        <h2>Strategi yang lebih baik<br /><span>dimulai dari data.</span></h2>
        <Link href="/analytics" className="apple-pill primary">Mulai riset <span aria-hidden>↗</span></Link>
      </section>
    </div>
  );
}
