'use client';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { call, fmt, pct, px } from '@/components/client';
import { ErrorBox, Loading, PageHead } from '@/components/Status';
import { EquityChart, PeriodBreakdown, closedTrades } from '@/components/ResultCharts';

const CandleChart = dynamic(() => import('@/components/CandleChart'), { ssr: false });
/* eslint-disable @typescript-eslint/no-explicit-any */

const PROFILE: Record<string, string> = {
  snr_only: 'SNR saja', snr_news: 'SNR + berita', snr_trend_momentum: 'SNR + tren', snr_all: 'SNR + semua konfirmasi',
};
const EXIT: Record<string, string> = { tp: 'Kena TP', sl: 'Kena SL', ambiguous_worst: 'TP & SL 1 candle (dihitung SL)', ambiguous_best: 'TP & SL 1 candle (dihitung TP)', ambiguous_skipped: 'Dilewati', time: 'Waktu habis', open: 'Masih terbuka', imported: 'Impor' };
const money = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}` : '—');
const tone = (n: unknown) => (typeof n === 'number' ? (n > 0 ? 'pos' : n < 0 ? 'neg' : '') : '');

export default function Analytics() {
  const [session, setSession] = useState('');
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tz, setTz] = useState('UTC');
  const [detail, setDetail] = useState<any>(null);
  const [tradeLimit, setTradeLimit] = useState(20);
  const load = useCallback(() => {
    setErr(null);
    call<any>(`/api/analytics${session ? `?session=${session}` : ''}`).then(setD).catch((e) => setErr(e.message));
  }, [session]);
  useEffect(() => { load(); call<any>('/api/settings').then((s) => setTz(s.timezone)).catch(() => {}); }, [load]);
  const [picked, setPicked] = useState(false);
  useEffect(() => { if (!picked && d?.sessions?.length && !session) { setPicked(true); setSession(String(d.sessions[0].id)); } }, [d, picked, session]);
  const open = async (id: string) => { setDetail({ loading: true }); try { setDetail(await call<any>(`/api/trades/${id}`)); } catch (e) { setDetail({ error: (e as Error).message }); } };

  const m = d?.overall;
  return (
    <div className="stack">
      <PageHead title="Hasil backtest" />

      <RunBacktest onDone={(id) => { setSession(id); setDetail(null); }} />

      {err ? <ErrorBox error={err} retry={load} /> : !d ? <Loading what="hasil" /> : (
        <>
          {d.sessions.length ? (
            <label className="field">Tampilkan hasil
              <select value={session} onChange={(e) => { setPicked(true); setSession(e.target.value); setDetail(null); }}>
                <option value="">Semua backtest digabung</option>
                {d.sessions.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.is_test ? ' (tes)' : ''} · {s.trades} trade</option>)}
              </select>
            </label>
          ) : null}

          {!d.hasData ? (
            <section className="group empty-state">
              <h2>Belum ada hasil</h2>
              <p>Jalankan backtest di atas. Hasilnya muncul di sini.</p>
            </section>
          ) : (
            <>
              <div className="grid two">
                <Stat label="Total P/L" v={money(m.totalPnl)} cls={tone(m.totalPnl)} />
                <Stat label="Win rate" v={pct(m.winRate)} />
                <Stat label="Menang / kalah" v={<><span className="pos">{m.wins}</span> / <span className="neg">{m.losses}</span></>} />
                <Stat label="Turun terdalam" v={`$${Number(m.maxDrawdown).toFixed(2)}`} cls="neg" />
              </div>
              <section className="group stack tight">
                <h2>Ringkasan</h2>
                <p>Dari <strong>{m.totalTrades} trade</strong>, <span className="pos"><strong>{m.wins} menang</strong></span> dan <span className="neg"><strong>{m.losses} kalah</strong></span>{m.breakeven ? `, ${m.breakeven} impas` : ''}.</p>
                <dl className="kv">
                  <dt>Total dari trade menang</dt><dd className="pos">{money(m.grossProfit)}</dd>
                  <dt>Total dari trade kalah</dt><dd className="neg">{money(-m.grossLoss)}</dd>
                  <dt>Rata-rata sekali menang</dt><dd className="pos">{m.wins ? money(m.grossProfit / m.wins) : '—'}</dd>
                  <dt>Rata-rata sekali kalah</dt><dd className="neg">{m.losses ? money(-m.grossLoss / m.losses) : '—'}</dd>
                  <dt>Hasil bersih</dt><dd className={tone(m.totalPnl)}>{money(m.totalPnl)}</dd>
                </dl>
                {!session && d.sessions.length > 1 ? <p className="mute small">Ini gabungan semua backtest (RR berbeda ikut tercampur). Pilih satu hasil di atas supaya angkanya jelas.</p> : null}
              </section>

              <section className="group"><details className="more">
                <summary>Angka lain</summary>
                <dl className="kv">
                  <dt>Profit factor</dt><dd>{m.profitFactor == null ? '—' : m.profitFactor.toFixed(2)}</dd>
                  <dt>Rata-rata per trade</dt><dd>{money(m.expectancy)}{m.expectancyR != null ? ` (${m.expectancyR.toFixed(2)}R)` : ''}</dd>
                  <dt>RR rencana</dt><dd>{m.avgPlannedRr == null ? '—' : `1:${m.avgPlannedRr.toFixed(1)}`}</dd>
                  <dt>Menang beruntun</dt><dd>{m.maxConsecutiveWins}</dd>
                  <dt>Kalah beruntun</dt><dd>{m.maxConsecutiveLosses}</dd>
                  <dt>Zona bertahan / jebol</dt><dd>{d.zoneOutcomes.respect} / {d.zoneOutcomes.breakout}</dd>
                </dl>
              </details></section>

              <section className="group">
                <h2>Grafik saldo</h2>
                <EquityChart trades={closedTrades(d.trades)} tz={tz} />
              </section>

              <section className="group">
                <h2>Menang & kalah per waktu</h2>
                <PeriodBreakdown trades={closedTrades(d.trades)} tz={tz} />
              </section>

              <section className="group"><details className="more">
                <summary>Rincian berita dan konfirmasi</summary>
                <Breakdown title="Ada berita besar atau tidak" rows={d.byNews} label={(k) => (k === 'with_news' ? 'Ada berita' : 'Tanpa berita')} plain />
                <div>
                  <h3>Per jenis konfirmasi</h3>
                  <div className="tablewrap"><table><thead><tr><th>Konfirmasi</th><th>Trade</th><th>Win</th><th>Rata-rata</th></tr></thead>
                    <tbody>{d.comparison.map((c: any) => (
                      <tr key={c.profile}><td>{PROFILE[c.profile]}</td>{c.metrics
                        ? <><td>{c.metrics.totalTrades}</td><td>{pct(c.metrics.winRate)}</td><td className={tone(c.metrics.expectancy)}>{money(c.metrics.expectancy)}</td></>
                        : <td colSpan={3} className="mute">Belum diuji</td>}</tr>))}</tbody></table></div>
                </div>
              </details></section>

              {detail ? <TradeDetail d={detail} tz={tz} onClose={() => setDetail(null)} /> : null}

              <section className="group">
                <h2>Daftar trade</h2>
                <div className="list">
                  {d.trades.slice(-tradeLimit).reverse().map((t: any) => (
                    <button key={t.id} className="item btnrow" onClick={() => open(t.id)}>
                      <span style={{ minWidth: 0 }}>
                        <span className="t" style={{ display: 'block' }}>{fmt(Number(t.entry_ms), tz)}</span>
                        <span className="d">{EXIT[t.exit_reason] ?? t.exit_reason}{t.planned_rr ? ` · RR 1:${Number(t.planned_rr)}` : ''}</span>
                      </span>
                      <span className="row" style={{ gap: 8, flex: 'none' }}>
                        <span className={`tag ${t.side === 'long' ? 'buy' : 'sell'}`}>{t.side === 'long' ? 'BUY' : 'SELL'}</span>
                        <span className={`num ${tone(t.pnl)}`} style={{ fontWeight: 700, minWidth: 72, textAlign: 'right' }}>{money(t.pnl)}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {d.trades.length > tradeLimit ? <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setTradeLimit((n) => n + 50)}>Tampilkan lebih banyak ({d.trades.length - tradeLimit} lagi)</button> : null}
              </section>

              <div className="row">
                <a className="btn sm" href={`/api/analytics/export?kind=trades${session ? `&session=${session}` : ''}`}>Unduh trade (CSV)</a>
                <a className="btn sm" href="/api/analytics/export?kind=events">Unduh sinyal (CSV)</a>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, v, cls = '' }: { label: string; v: React.ReactNode; cls?: string }) {
  return <div className="stat"><div className="label">{label}</div><div className={`v ${cls}`}>{v}</div></div>;
}

function Breakdown({ title, rows, label = (k: string) => k, plain = false }: { title: string; rows: any[]; label?: (k: string) => string; plain?: boolean }) {
  const body = rows.length ? (
    <div className="tablewrap"><table><thead><tr><th></th><th>Trade</th><th>Menang</th><th>Kalah</th><th>Win</th><th>P/L</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key}><td>{label(r.key)}</td><td>{r.metrics.totalTrades}</td><td className="pos">{r.metrics.wins}</td><td className="neg">{r.metrics.losses}</td><td>{pct(r.metrics.winRate)}</td><td className={tone(r.metrics.totalPnl)}>{money(r.metrics.totalPnl)}</td></tr>)}</tbody></table></div>
  ) : <p className="mute small">Belum ada data.</p>;
  if (plain) return <div className="stack tight"><h3>{title}</h3>{body}</div>;
  return <section className="group"><h2>{title}</h2>{body}</section>;
}

function TradeDetail({ d, tz, onClose }: { d: any; tz: string; onClose: () => void }) {
  if (d.loading) return <section className="group"><Loading what="trade" /></section>;
  if (d.error) return <ErrorBox error={d.error} />;
  const t = d.trade;
  const markers = [
    { time: t.entry, text: t.side === 'long' ? 'BUY' : 'SELL', position: t.side === 'long' ? 'below' : 'above', shape: t.side === 'long' ? 'arrowUp' : 'arrowDown' },
    ...(t.exit ? [{ time: t.exit, text: EXIT[t.exitReason] ?? t.exitReason, position: 'above', shape: 'square' }] : []),
  ] as any;
  return (
    <section className="group stack">
      <div className="row between">
        <h2>{t.side === 'long' ? 'BUY' : 'SELL'} · {fmt(t.entry, tz)}</h2>
        <button className="btn sm" onClick={onClose}>Tutup</button>
      </div>
      <div className="chartbox" style={{ height: 300, minHeight: 0 }}>
        {d.candles.length ? <CandleChart candles={d.candles} markers={markers} timezone={tz} fitKey={t.id} /> : <div className="empty">Candle untuk trade ini tidak ditemukan.</div>}
      </div>
      <dl className="kv">
        {t.setupReason?.risk_usd != null ? <><dt>Risiko</dt><dd>${Number(t.setupReason.risk_usd).toFixed(2)} · lot {t.setupReason.lot}</dd></> : null}
        <dt>Entry</dt><dd>{px(t.entryPrice)}</dd>
        <dt>Stop loss</dt><dd>{px(t.stopLoss)}</dd>
        <dt>Take profit</dt><dd>{px(t.takeProfit)}</dd>
        <dt>Keluar</dt><dd>{px(t.exitPrice)} · {EXIT[t.exitReason] ?? t.exitReason}</dd>
        <dt>Hasil</dt><dd className={tone(t.pnl)}>{money(t.pnl)}</dd>
      </dl>
      <details className="more">
        <summary>Alasan entry & berita</summary>
        {t.setupReason?.trend ? <p className="small">{t.setupReason.trend}</p> : null}
        <p className="small">{!d.newsAtEntry.archiveAvailable ? 'Data berita tidak tersedia untuk tanggal ini.' : d.newsAtEntry.items.length
          ? d.newsAtEntry.items.map((n: any) => `${n.title} (${n.sentiment?.label ?? 'Unknown'})`).join(' · ')
          : 'Tidak ada rilis 24 jam sebelum entry.'}</p>
        <pre>{JSON.stringify(t.setupReason, null, 2)}</pre>
      </details>
    </section>
  );
}

function RunBacktest({ onDone }: { onDone: (sessionId: string) => void }) {
  const [sources, setSources] = useState<any[]>([]);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [f, setF] = useState({ source: '', strategy: '', from: '2019-01-01', to: '2020-01-01', spread: '0.30', slippage: '0.10', commission: '7', size: '0.01', risk: '10', ambiguity: 'worst' });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    call<any[]>('/api/sources').then((s) => { setSources(s); if (s[0]) setF((x) => ({ ...x, source: x.source || s.find((y: any) => !y.is_test)?.id || s[0].id })); }).catch(() => {});
    call<any[]>('/api/strategies').then((s) => {
      const usable = s.filter((x: any) => x.configured && !x.testOnly && x.status === 'active');
      setStrategies(usable);
      if (usable.length) setF((x) => ({ ...x, strategy: x.strategy || usable[usable.length - 1].id }));
    }).catch(() => {});
  }, []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    try {
      setRes(await call<any>('/api/backtest/run', { method: 'POST', json: {
        source_id: f.source, strategy_version_id: f.strategy || null, from: `${f.from}T00:00:00Z`, to: `${f.to}T00:00:00Z`, rr: [1, 2, 3],
        size: Number(f.size), risk_usd: f.risk.trim() ? Number(f.risk) : null, costs: { spread: Number(f.spread), slippage: Number(f.slippage), commissionPerUnit: Number(f.commission), ambiguityPolicy: f.ambiguity },
      } }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="group stack">
      <div className="stack tight">
        <h2>Jalankan backtest</h2>
        <p className="mute small">Strategi SNR: tren H4, zona H4/H1, entry M15. Diuji dengan RR 1:1, 1:2, dan 1:3.</p>
      </div>
      <div className="grid two">
        {sources.length > 1 ? (
          <label className="field">Data<select value={f.source} onChange={set('source')}>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_test ? ' (tes)' : ''}</option>)}</select></label>
        ) : null}
        <label className="field">Dari<input type="date" value={f.from} onChange={set('from')} /></label>
        <label className="field">Sampai<input type="date" value={f.to} onChange={set('to')} /></label>
        <label className="field">Risiko per trade ($)<input inputMode="decimal" value={f.risk} onChange={set('risk')} placeholder="10" /></label>
      </div>
      <p className="mute small">Kena SL = rugi sekitar ${f.risk || '—'}. RR 1:2 kena TP = untung sekitar ${f.risk ? Number(f.risk) * 2 : '—'}. Belum termasuk biaya.</p>
      <details className="more">
        <summary>Biaya & lainnya</summary>
        <div className="grid two">
          {strategies.length > 1 ? <label className="field">Strategi<select value={f.strategy} onChange={set('strategy')}>{strategies.map((s) => <option key={s.id} value={s.id}>{s.strategy_key} {s.version}</option>)}</select></label> : null}
          <label className="field">Spread ($)<input inputMode="decimal" value={f.spread} onChange={set('spread')} /></label>
          <label className="field">Slippage ($)<input inputMode="decimal" value={f.slippage} onChange={set('slippage')} /></label>
          <label className="field">Komisi per lot ($)<input inputMode="decimal" value={f.commission} onChange={set('commission')} /></label>
          <label className="field">Lot tetap (dipakai kalau risiko dikosongkan)<input inputMode="decimal" value={f.size} onChange={set('size')} /></label>
          <label className="field">TP & SL kena di 1 candle<select value={f.ambiguity} onChange={set('ambiguity')}><option value="worst">Hitung sebagai SL</option><option value="best">Hitung sebagai TP</option><option value="skip">Lewati</option></select></label>
        </div>
      </details>
      {!sources.length ? <div className="notice">Impor data M15 dulu di Atur → Data harga.</div> : null}
      <button className="btn primary block" onClick={run} disabled={busy || !f.source || !f.strategy}>{busy ? 'Menghitung… (±1 menit)' : 'Jalankan backtest'}</button>
      {err ? <div className="error">{err}</div> : null}
      {res ? (
        <div className="stack tight">
          <p className="small mute">{res.setups} setup ditemukan{res.newsArchive ? '' : ' · tanpa data berita'}</p>
          <div className="grid two">
            {res.sessions.map((s: any) => (
              <button key={s.backtestSessionId} className="stat btnrow" style={{ border: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => onDone(s.backtestSessionId)}>
                <div className="label">RR 1:{s.rr}</div><div className="v">{s.trades} trade</div><div className="small" style={{ color: 'var(--gold)', fontWeight: 700 }}>Lihat hasil</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
