'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { call, fmt, px, tzShort } from '@/components/client';
import { ErrorBox, Loading, ModeTag } from '@/components/Status';
import type { ChartMarker, ChartZone } from '@/components/CandleChart';
import { TIMEFRAMES, TIMEFRAME_MS, type Candle, type Timeframe } from '@/lib/core/types';
import { zonedWallTimeToUtc } from '@/lib/core/time';

const CandleChart = dynamic(() => import('@/components/CandleChart'), { ssr: false });

/* eslint-disable @typescript-eslint/no-explicit-any */
type Session = any;
const SPEEDS = [1, 2, 5, 10] as const;
const tickMs = (speed: number) => Math.max(200, 1000 / speed);

export default function ReplayPage() {
  return <Suspense fallback={<Loading what="replay" />}><Replay /></Suspense>;
}

function Replay() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get('session');
  const [tz, setTz] = useState('UTC');
  const [boot, setBoot] = useState<{ sources: any[]; coverage: any[]; strategies: any[]; sessions: Session[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadBoot = useCallback(async () => {
    try {
      setErr(null);
      const [sources, coverage, strategies, sessions, settings] = await Promise.all([
        call<any[]>('/api/sources'), call<any[]>('/api/sources/coverage'), call<any[]>('/api/strategies'),
        call<Session[]>('/api/replay'), call<any>('/api/settings'),
      ]);
      setTz(settings.timezone ?? 'UTC');
      setBoot({ sources, coverage, strategies, sessions });
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { loadBoot(); }, [loadBoot]);

  if (err) return <><h1>Replay</h1><ErrorBox error={err} retry={loadBoot} /></>;
  if (!boot) return <><h1>Replay</h1><Loading what="replay" /></>;
  return sessionId
    ? <Player key={sessionId} id={sessionId} tz={tz} strategies={boot.strategies} onClose={() => router.push('/replay')} />
    : <Setup boot={boot} tz={tz} onCreated={(id) => router.push(`/replay?session=${id}`)} />;
}

function Setup({ boot, tz, onCreated }: { boot: any; tz: string; onCreated: (id: string) => void }) {
  const cov: any[] = boot.coverage;
  const [sourceId, setSourceId] = useState<string>(cov[0]?.source_id ?? '');
  const tfs = cov.filter((c) => c.source_id === sourceId).map((c) => c.timeframe as Timeframe);
  const [tf, setTf] = useState<Timeframe>((tfs.includes('H1') ? 'H1' : tfs[0]) ?? 'H1');
  const range = cov.find((c) => c.source_id === sourceId && c.timeframe === tf);
  const years = useMemo(() => {
    if (!range) return [] as number[];
    const a = new Date(range.first).getUTCFullYear(), b = new Date(range.last).getUTCFullYear();
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }, [range]);
  const [year, setYear] = useState<number | null>(null);
  const [dt, setDt] = useState('');
  const realDefault = [...boot.strategies].reverse().find((s: any) => s.status === 'active' && !s.is_test && s.configured)
    ?? boot.strategies.find((s: any) => s.status === 'active' && !s.is_test);
  const [strategyId, setStrategyId] = useState<string>(realDefault?.id ?? '');
  const [near, setNear] = useState('');
  const [resend, setResend] = useState<'never' | 'new_run'>('never');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const strategy = boot.strategies.find((s: any) => s.id === strategyId);

  useEffect(() => { if (years.length && (year === null || !years.includes(year))) setYear(years[0]); }, [years, year]);
  useEffect(() => {
    if (!range || year === null) return;
    const start = Math.max(range.first, Date.UTC(year, 0, 1));
    const d = new Date(start + 0);
    const local = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    setDt(local.replace(' ', 'T'));
  }, [range, year, tz]);

  const create = async () => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(dt);
    if (!m) return setErr('Tanggal & jam tidak valid');
    const startUtc = zonedWallTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], 0, tz);
    setBusy(true); setErr(null);
    try {
      const s = await call<Session>('/api/replay', { method: 'POST', json: {
        source_id: sourceId, timeframe: tf, start_time: new Date(startUtc).toISOString(), strategy_version_id: strategyId || null,
        params: strategy?.testOnly && near ? { near_distance: Number(near) } : {}, resend_policy: resend,
      } });
      onCreated(s.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div>
        <h1>Replay</h1>
        <p className="sub">Replay berjalan di website ini dengan waktu pasar historis. Candle masa depan tidak pernah dikirim ke browser. Replay ini tidak mengendalikan Bar Replay di TradingView.</p>
      </div>
      {!cov.length ? (
        <div className="notice"><strong>Belum ada data historis.</strong> Impor CSV OHLC di Settings → Data historis. Data tidak akan dibuat-buat.</div>
      ) : (
        <section className="panel stack">
          <h2>Sesi baru</h2>
          <div className="grid">
            <label className="field">Sumber data
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                {[...new Map(cov.map((c) => [c.source_id, c])).values()].map((c) => <option key={c.source_id} value={c.source_id}>{c.source_name}{c.is_test ? ' (TEST)' : ''}</option>)}
              </select>
            </label>
            <label className="field">Timeframe
              <select value={tf} onChange={(e) => setTf(e.target.value as Timeframe)}>
                {TIMEFRAMES.filter((t) => tfs.includes(t)).map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className="field">Tahun
              <select value={year ?? ''} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>
            </label>
            <label className="field">Tanggal & jam mulai ({tzShort(tz)})
              <input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} />
            </label>
          </div>
          {range ? <p className="mute small" style={{ margin: 0 }}>Data tersedia: {fmt(range.first, tz)} → {fmt(range.last, tz)} ({range.candles.toLocaleString()} candle)</p> : null}
          <div className="grid">
            <label className="field">Versi strategi
              <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
                {boot.strategies.map((s: any) => <option key={s.id} value={s.id}>{s.strategy_key} {s.version}{s.testOnly ? ' — TEST' : ''}{!s.configured ? ' — belum dikonfigurasi' : ''}</option>)}
              </select>
            </label>
            {strategy?.testOnly ? (
              <label className="field">Jarak “dekat” (TEST, satuan harga)
                <input inputMode="decimal" value={near} onChange={(e) => setNear(e.target.value)} placeholder="mis. 1.5" />
              </label>
            ) : null}
            <label className="field">Saat Reset, event yang sudah tercatat
              <select value={resend} onChange={(e) => setResend(e.target.value as 'never' | 'new_run')}>
                <option value="never">tidak dikirim ulang ke Telegram</option>
                <option value="new_run">dicatat & dikirim ulang (run baru)</option>
              </select>
            </label>
          </div>
          {strategy && !strategy.configured ? <div className="notice"><strong>Strategy Not Configured.</strong> Replay tetap berjalan, tetapi tidak ada event atau sinyal sampai aturan SNR Anda ditambahkan.</div> : null}
          {strategy?.testOnly ? <div className="notice"><strong>Fixture TEST.</strong> Hanya untuk uji teknis pipeline (zona manual → event → Telegram). Bukan strategi trading, tanpa BUY/SELL.</div> : null}
          {err ? <div className="error small">{err}</div> : null}
          <div><button className="btn primary" onClick={create} disabled={busy || !sourceId || !dt}>{busy ? 'Menyiapkan…' : 'Mulai sesi replay'}</button></div>
        </section>
      )}
      {boot.sessions.length ? (
        <section className="panel">
          <h2>Sesi sebelumnya</h2>
          <div className="tablewrap"><table><thead><tr><th>Dibuat</th><th>TF</th><th>Mulai</th><th>Posisi</th><th>Status</th></tr></thead>
            <tbody>{boot.sessions.map((s: Session) => (
              <tr key={s.id} className="click" onClick={() => onCreated(s.id)}>
                <td>{fmt(s.created_at, tz)}</td><td>{s.timeframe}</td><td>{fmt(s.start_time, tz)}</td>
                <td>{s.cursor_time ? fmt(s.cursor_time + TIMEFRAME_MS[s.timeframe as Timeframe], tz) : '—'}</td>
                <td>{s.status}{s.is_test ? ' · TEST' : ''}</td>
              </tr>))}</tbody></table></div>
        </section>
      ) : null}
    </div>
  );
}

function Player({ id, tz, strategies, onClose }: { id: string; tz: string; strategies: any[]; onClose: () => void }) {
  const [s, setS] = useState<Session | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [news, setNews] = useState<any | null>(null);
  const [snr, setSnr] = useState<any | null>(null);
  const [showSnr, setShowSnr] = useState(true);
  const [showNews, setShowNews] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tgNote, setTgNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const sRef = useRef<Session | null>(null);
  sRef.current = s;

  const strategy = strategies.find((x) => x.id === s?.strategy_version_id);
  const marketTime = s?.cursor_time != null ? s.cursor_time + TIMEFRAME_MS[s.timeframe as Timeframe] : null;

  const reloadAll = useCallback(async () => {
    try {
      const [c, ev, z] = await Promise.all([
        call<{ session: Session; candles: Candle[] }>(`/api/replay/${id}/candles`),
        call<any[]>(`/api/replay/${id}/events`), call<any[]>('/api/zones'),
      ]);
      setS(c.session); setCandles(c.candles); setEvents(ev); setZones(z);
      setNews(await call<any>(`/api/replay/${id}/news`));
      call<any>(`/api/replay/${id}/snr`).then(setSnr).catch(() => {});
    } catch (e) { setErr((e as Error).message); }
  }, [id]);
  useEffect(() => { reloadAll(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [reloadAll]);

  const lastNews = useRef(0);
  const step = useCallback(async (manual: boolean) => {
    const cur = sRef.current;
    if (!cur || inflight.current) return null;
    inflight.current = true;
    try {
      const count = manual ? 1 : Math.max(1, Math.round((cur.speed * tickMs(cur.speed)) / 1000));
      const r = await call<any>(`/api/replay/${id}/step`, { method: 'POST', json: { count, manual, expected_cursor: cur.cursor_time } });
      if (r.conflict) { await reloadAll(); return r; }
      setS(r.session);
      if (r.revealed.length) setCandles((p) => [...p, ...r.revealed].slice(-3000));
      if (r.events.length) {
        setEvents((p) => [...r.events.slice().reverse(), ...p]);
        const failed = r.events.filter((e: any) => e.telegram?.status === 'failed');
        if (failed.length) setTgNote(`Telegram gagal: ${failed[0].telegram.error}`);
      }
      if (Date.now() - lastNews.current > 1500) { lastNews.current = Date.now(); call<any>(`/api/replay/${id}/news`).then(setNews).catch(() => {}); call<any>(`/api/replay/${id}/snr`).then(setSnr).catch(() => {}); }
      return r;
    } finally { inflight.current = false; }
  }, [id, reloadAll]);

  // Play loop: 1× = 1 candle/s, 10× = 10 candles/s (ticks ≥200ms; faster speeds step 2 candles per tick).
  useEffect(() => {
    if (s?.status !== 'playing') return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await step(false);
        if (r?.session?.status !== 'playing') return;
      } catch (e) { setErr((e as Error).message); return; }
      const interval = tickMs(sRef.current?.speed ?? 1);
      timer.current = setTimeout(tick, interval);
    };
    timer.current = setTimeout(tick, 50);
    return () => { stop = true; if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.status, step]);

  const patch = async (json: Record<string, unknown>) => {
    try { setErr(null); setS(await call<Session>(`/api/replay/${id}`, { method: 'PATCH', json })); }
    catch (e) { setErr((e as Error).message); }
  };
  const reset = async () => {
    if (timer.current) clearTimeout(timer.current);
    try { await call(`/api/replay/${id}/reset`, { method: 'POST' }); setEvents([]); await reloadAll(); } catch (e) { setErr((e as Error).message); }
  };

  const visibleZones: ChartZone[] = useMemo(() => !showSnr || marketTime == null ? [] : zones
    .filter((z) => z.mode === 'BACKTEST' && Date.parse(z.valid_from) <= marketTime && (!z.valid_until || Date.parse(z.valid_until) > marketTime)
      && (!z.replay_session_id || z.replay_session_id === id))
    .map((z) => ({ id: z.id, low: z.low, high: z.high, kind: z.kind }))
    .concat(snr?.available && snr.price != null ? [...snr.zones]
      .sort((a: any, b: any) => Math.abs(a.mid - snr.price) - Math.abs(b.mid - snr.price)).slice(0, 6)
      .map((z: any) => ({ id: `snr-${z.key}`, low: z.low, high: z.high, kind: z.mid <= snr.price ? 'support' : 'resistance' })) : []),
  [zones, showSnr, marketTime, id, snr]);

  const markers: ChartMarker[] = useMemo(() => {
    if (!s) return [];
    const tfMs = TIMEFRAME_MS[s.timeframe as Timeframe];
    const evm: ChartMarker[] = showSnr ? events.map((e) => ({ time: e.event_time - tfMs, text: e.event_type.replace('SNR_', ''), position: e.zone_kind === 'resistance' ? 'above' : 'below', shape: 'circle' })) : [];
    const nm: ChartMarker[] = showNews && news?.items ? news.items.filter((n: any) => n.kind === 'economic').map((n: any) => ({
      time: Math.floor(n.availableAt / tfMs) * tfMs, text: n.title.slice(0, 18), position: 'above', shape: 'square',
    })) : [];
    const first = candles[0]?.time ?? 0;
    return [...evm, ...nm].filter((m) => m.time >= first);
  }, [events, news, showSnr, showNews, s, candles]);

  if (err && !s) return <><h1>Replay</h1><ErrorBox error={err} retry={reloadAll} /></>;
  if (!s) return <><h1>Replay</h1><Loading what="sesi replay" /></>;
  const playing = s.status === 'playing';
  const finished = s.status === 'finished';
  const [dPart, tPart] = marketTime ? fmt(marketTime, tz).split(' ') : ['—', '—'];

  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="row" style={{ marginBottom: 10 }}>
            <ModeTag mode="BACKTEST" test={s.is_test} />
            <span className="tag">{s.timeframe}</span>
            <span className="tag">{finished ? 'selesai' : playing ? 'berjalan' : s.status === 'paused' ? 'dijeda' : 'siap'}</span>
          </div>
          <div className="clock num" aria-live="polite">{tPart}<span className="date">{dPart} · waktu pasar {tzShort(tz)}</span></div>
        </div>
        <button className="btn" onClick={onClose}>Semua sesi</button>
      </div>

      {strategy && !strategy.configured ? <div className="notice"><strong>Strategy Not Configured.</strong> Candle diputar, tetapi tidak ada event dan tidak ada sinyal BUY/SELL.</div> : null}
      {strategy?.testOnly ? <div className="notice"><strong>Fixture TEST aktif.</strong> Event berasal dari aturan uji teknis terhadap zona manual, bukan strategi trading.</div> : null}

      {snr?.available ? (
        <section className="panel">
          <div className="row between">
            <strong>Tren H4: {snr.trend === 'bullish' ? 'BULLISH → hanya BUY' : snr.trend === 'bearish' ? 'BEARISH → hanya SELL' : 'NETRAL → tidak ada entry'}</strong>
            <span className="mute small">{snr.trendDetail} · {snr.zones.length} zona H4/H1</span>
          </div>
          <p className="mute small" style={{ marginBottom: 0 }}>Chart menampilkan 6 zona terdekat. Dihitung hanya dari candle H4/H1 yang sudah tutup pada waktu replay.</p>
        </section>
      ) : null}

      <div className="chartbox">
        {candles.length ? <CandleChart candles={candles} zones={visibleZones} markers={markers} timezone={tz} fitKey={`${id}-${s.run_number}`} />
          : <div className="empty">Belum ada candle sebelum waktu mulai. Tekan Next Candle atau Play.</div>}
      </div>

      <div className="controls">
        {playing
          ? <button className="btn primary" onClick={() => patch({ status: 'paused' })}>Pause</button>
          : <button className="btn primary" onClick={() => patch({ status: 'playing' })} disabled={finished}>Play</button>}
        <button className="btn" onClick={() => step(true).catch((e) => setErr(e.message))} disabled={playing || finished}>Next candle</button>
        <button className="btn" onClick={reset}>Reset</button>
        <div className="seg" role="group" aria-label="Kecepatan">
          {SPEEDS.map((x) => <button key={x} aria-pressed={s.speed === x} onClick={() => patch({ speed: x })}>{x}×</button>)}
        </div>
        <label className="switch"><input type="checkbox" checked={showSnr} onChange={(e) => setShowSnr(e.target.checked)} />SNR</label>
        <label className="switch"><input type="checkbox" checked={showNews} onChange={(e) => setShowNews(e.target.checked)} />Berita</label>
      </div>

      <section className="panel stack">
        <label className="switch"><input type="checkbox" checked={s.telegram_enabled} onChange={(e) => patch({ telegram_enabled: e.target.checked })} />
          Kirim notifikasi SIMULASI ke Telegram</label>
        <p className="mute small" style={{ margin: 0 }}>
          Default mati. Pesan berlabel “SIMULASI HISTORIS — BUKAN SINYAL LIVE”, dikirim saat replay melewati event, mengikuti kecepatan replay, dan berhenti saat Pause.
          Pengiriman juga memerlukan “Notifikasi Backtest” aktif di Settings. Saat Reset: {s.resend_policy === 'never' ? 'event yang sudah tercatat tidak dikirim ulang.' : 'setiap Reset membuat run baru dan event dikirim ulang.'}
          {' '}<button className="btn" style={{ minHeight: 0, padding: '2px 8px' }} onClick={() => patch({ resend_policy: s.resend_policy === 'never' ? 'new_run' : 'never' })}>Ubah</button>
        </p>
        {tgNote ? <div className="error small">{tgNote}</div> : null}
      </section>

      {err ? <ErrorBox error={err} /> : null}

      <div className="grid">
        <section className="panel">
          <h2>Event pada replay ini</h2>
          <div className="eventlist">
            {events.length ? events.map((e) => (
              <div key={e.id} className="event">
                <div className="row between"><strong>{e.event_type} {e.timeframe}</strong>
                  <span className="mute">{e.telegram?.status ? `Telegram: ${e.telegram.status}` : ''}</span></div>
                <div className="mute">{fmt(e.event_time, tz)} · {px(e.price)} · zona {px(e.zone_low)}–{px(e.zone_high)}</div>
                <div className="small">Trend: {e.confirmations?.trend} · News: {e.confirmations?.news} · Sentiment: {e.confirmations?.sentiment}</div>
              </div>)) : <p className="mute">Belum ada event sampai waktu ini.</p>}
          </div>
        </section>
        <section className="panel">
          <h2>Berita yang sudah tersedia</h2>
          {!news ? <Loading what="berita" /> : !news.archiveAvailable ? <p><strong>DATA UNAVAILABLE</strong><br /><span className="mute small">Arsip berita/kalender untuk periode ini belum diimpor.</span></p> : (
            <div className="eventlist">
              {news.items.length ? news.items.map((n: any) => (
                <div key={n.id} className="event"><strong>{n.title}</strong>
                  <div className="mute">tersedia {fmt(n.availableAt, tz)}{n.impact ? ` · ${n.impact}` : ''}</div>
                  {n.sentiment ? <div className="small">{n.sentiment.label} ({n.sentiment.confidence ?? '–'}): {n.sentiment.reasoning}</div> : null}
                </div>)) : <p className="mute">Tidak ada rilis dalam 24 jam terakhir.</p>}
              {news.upcoming.map((u: any) => <div key={u.id} className="event mute">Terjadwal: {u.title} · {fmt(u.scheduledAt, tz)} (actual belum diketahui)</div>)}
            </div>)}
        </section>
      </div>
      <p className="mute small">Diproses: {s.candles_processed} candle · Run #{s.run_number} · Session ID <span className="num">{s.id}</span></p>
    </div>
  );
}
