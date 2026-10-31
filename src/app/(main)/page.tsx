'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { call, fmt, px, tzShort } from '@/components/client';
import { ErrorBox, Loading, ModeTag, Status } from '@/components/Status';
import { CATEGORY_LABEL } from '@/lib/core/news';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dash = any;

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); call<Dash>('/api/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  if (err) return <><h1>Dashboard</h1><ErrorBox error={err} retry={load} /></>;
  if (!d) return <><h1>Dashboard</h1><Loading /></>;
  const tz = d.timezone;
  const tv = d.tradingview;
  const tg = d.telegram;
  return (
    <div className="stack">
      <div>
        <h1>Dashboard</h1>
        <p className="sub">Waktu ditampilkan dalam zona {tzShort(tz)}. Data LIVE dan BACKTEST dipisah.</p>
      </div>

      <div className="grid">
        <section className="panel">
          <h2>TradingView webhook</h2>
          <Status on={tv.configured && tv.lastStatus?.status === 'accepted'} error={tv.lastStatus && tv.lastStatus.status !== 'accepted' && tv.lastStatus.status !== 'duplicate'}>
            {!tv.configured ? 'Secret belum diatur' : tv.lastStatus ? `Terakhir: ${tv.lastStatus.status}` : 'Belum pernah menerima alert'}
          </Status>
          {tv.lastStatus ? <p className="mute small">{fmt(tv.lastStatus.at, tz, true)}{tv.lastStatus.error ? ` — ${tv.lastStatus.error}` : ''}</p> : null}
        </section>
        <section className="panel">
          <h2>Telegram</h2>
          <Status on={tg.tokenConfigured && tg.chatConfigured && tg.lastTest?.ok} error={tg.lastTest && !tg.lastTest.ok}>
            {!tg.tokenConfigured ? 'Bot token belum diatur' : !tg.chatConfigured ? 'Chat ID belum diatur'
              : !tg.lastTest ? 'Belum diuji — kirim Test di Settings' : tg.lastTest.ok ? 'Terverifikasi oleh Telegram' : `Gagal: ${tg.lastTest.error}`}
          </Status>
          <p className="mute small">Live {tg.liveEnabled ? 'aktif' : 'nonaktif'} · Backtest {tg.backtestEnabled ? 'aktif' : 'nonaktif'}</p>
        </section>
        <section className="panel">
          <h2>Data XAUUSD terakhir</h2>
          {d.latestCandle ? (
            <>
              <div className="clock" style={{ fontSize: 32 }}>{px(d.latestCandle.close)}</div>
              <p className="mute small">{d.latestCandle.timeframe} · {fmt(d.latestCandle.time, tz)} · {d.latestCandle.source}
                {d.latestCandle.is_test ? ' · TEST' : ''}<br />Data historis tersimpan, bukan harga live.</p>
            </>
          ) : <p className="mute">Belum ada data. Impor CSV OHLC di Settings.</p>}
        </section>
        <section className="panel">
          <h2>Kejadian SNR</h2>
          <dl className="kv"><dt>LIVE</dt><dd className="num">{d.eventCounts.LIVE}</dd><dt>BACKTEST</dt><dd className="num">{d.eventCounts.BACKTEST}</dd></dl>
        </section>
      </div>

      <div className="grid">
        <EventsPanel title="Aktivitas LIVE" events={d.liveEvents} tz={tz} empty="Belum ada event dari TradingView." />
        <EventsPanel title="Aktivitas BACKTEST" events={d.backtestEvents} tz={tz} empty="Belum ada event replay." />
      </div>

      <div className="grid">
        <section className="panel">
          <h2>Berita ekonomi terdekat</h2>
          {d.upcomingNews.length ? d.upcomingNews.map((n: any) => (
            <div key={n.id} className="event"><div className="row between"><strong>{n.title}</strong><span className="tag">{n.impact}</span></div>
              <span className="mute">{fmt(n.scheduledAt, tz)} · {CATEGORY_LABEL[n.category as keyof typeof CATEGORY_LABEL] ?? n.category}</span></div>
          )) : <p className="mute">DATA UNAVAILABLE — belum ada kalender untuk 7 hari ke depan. Impor di menu News.</p>}
        </section>
        <section className="panel">
          <h2>Notifikasi terakhir</h2>
          {d.lastDeliveries.length ? d.lastDeliveries.map((x: any) => (
            <div key={x.id} className="event row between"><span><span className="tag">{x.mode}</span> {x.status}{x.skip_reason ? ` (${x.skip_reason})` : ''}</span>
              <span className="mute">{fmt(Date.parse(x.created_at), tz)}</span></div>
          )) : <p className="mute">Belum ada pengiriman.</p>}
        </section>
      </div>

      <section className="panel">
        <h2>Rentang data historis yang tersedia</h2>
        {d.coverage.length ? (
          <div className="tablewrap"><table><thead><tr><th>Sumber</th><th>TF</th><th>Dari</th><th>Sampai</th><th>Candle</th></tr></thead>
            <tbody>{d.coverage.map((c: any) => <tr key={c.source_id + c.timeframe}><td>{c.source_name}{c.is_test ? ' (TEST)' : ''}</td><td>{c.timeframe}</td><td>{fmt(c.first, tz)}</td><td>{fmt(c.last, tz)}</td><td className="num">{c.candles.toLocaleString()}</td></tr>)}</tbody>
          </table></div>
        ) : <p className="mute">Belum ada. <Link href="/settings">Impor CSV OHLC</Link>.</p>}
      </section>
    </div>
  );
}

function EventsPanel({ title, events, tz, empty }: { title: string; events: any[]; tz: string; empty: string }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {events.length ? events.map((e) => (
        <div key={e.id} className="event">
          <div className="row between"><strong>{e.event_type} {e.timeframe}</strong><ModeTag mode={e.mode} test={e.is_test} /></div>
          <span className="mute">{fmt(e.event_time, tz)} · {px(e.price)} · zona {px(e.zone_low)}–{px(e.zone_high)}</span>
        </div>
      )) : <p className="mute">{empty}</p>}
    </section>
  );
}
