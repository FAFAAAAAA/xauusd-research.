'use client';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { call, fmt, pct, px } from '@/components/client';
import { ErrorBox, Loading } from '@/components/Status';

const CandleChart = dynamic(() => import('@/components/CandleChart'), { ssr: false });
/* eslint-disable @typescript-eslint/no-explicit-any */

const PROFILE: Record<string, string> = {
  snr_only: 'A · SNR saja', snr_news: 'B · SNR + berita', snr_trend_momentum: 'C · SNR + trend/momentum', snr_all: 'D · SNR + semua konfirmasi',
};
const SESSION: Record<string, string> = { asia: 'Asia', london: 'London', new_york: 'New York', off: 'Di luar sesi' };

export default function Analytics() {
  const [session, setSession] = useState('');
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tz, setTz] = useState('UTC');
  const [detail, setDetail] = useState<any>(null);
  const load = useCallback(() => {
    setErr(null);
    call<any>(`/api/analytics${session ? `?session=${session}` : ''}`).then(setD).catch((e) => setErr(e.message));
  }, [session]);
  useEffect(() => { load(); call<any>('/api/settings').then((s) => setTz(s.timezone)).catch(() => {}); }, [load]);
  const open = async (id: string) => { setDetail({ loading: true }); try { setDetail(await call<any>(`/api/trades/${id}`)); } catch (e) { setDetail({ error: (e as Error).message }); } };

  if (err) return <><h1>Backtest analytics</h1><ErrorBox error={err} retry={load} /></>;
  if (!d) return <><h1>Backtest analytics</h1><Loading /></>;
  const m = d.overall;
  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>Backtest analytics</h1>
          <p className="sub" style={{ marginBottom: 0 }}>Semua angka dihitung dari trade yang benar-benar tercatat. Tanpa data, tidak ada statistik.</p>
        </div>
        <div className="row">
          <select value={session} onChange={(e) => setSession(e.target.value)} style={{ width: 'auto' }} aria-label="Sesi backtest">
            <option value="">Semua sesi</option>
            {d.sessions.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.is_test ? ' (TEST)' : ''} · {s.trades} trade</option>)}
          </select>
          <a className="btn" href={`/api/analytics/export?kind=trades${session ? `&session=${session}` : ''}`}>Ekspor trade CSV</a>
          <a className="btn" href="/api/analytics/export?kind=events">Ekspor event CSV</a>
        </div>
      </div>

      {!d.hasData ? (
        <div className="notice"><strong>Belum ada hasil backtest.</strong> Statistik akan muncul setelah strategi SNR dikonfigurasi dan dijalankan, atau setelah Anda mengimpor laporan “List of trades” dari TradingView Strategy Tester (Settings → Impor).</div>
      ) : (
        <>
          <div className="grid">
            <Metric label="Total trade" v={m.totalTrades} />
            <Metric label="Win rate" v={pct(m.winRate)} />
            <Metric label="Total P/L" v={px(m.totalPnl)} />
            <Metric label="Profit factor" v={m.profitFactor == null ? '— (tanpa loss)' : m.profitFactor.toFixed(2)} />
            <Metric label="Expectancy" v={`${px(m.expectancy)}${m.expectancyR != null ? ` · ${m.expectancyR.toFixed(2)}R` : ''}`} />
            <Metric label="Max drawdown" v={px(m.maxDrawdown)} />
            <Metric label="Rata-rata R:R rencana" v={m.avgPlannedRr == null ? '—' : `1:${m.avgPlannedRr.toFixed(2)}`} />
            <Metric label="Beruntun menang / kalah" v={`${m.maxConsecutiveWins} / ${m.maxConsecutiveLosses}`} />
          </div>
          <div className="grid">
            <Breakdown title="Per tahun" rows={d.byYear} />
            <Breakdown title="Per timeframe" rows={d.byTimeframe} />
            <Breakdown title="Per sesi" rows={d.bySession} label={(k) => SESSION[k] ?? k} />
            <Breakdown title="Dengan / tanpa konfirmasi berita" rows={d.byNews} label={(k) => (k === 'with_news' ? 'Dengan berita' : 'Tanpa berita')} />
          </div>
          <section className="panel">
            <h2>Hasil di zona SNR</h2>
            <dl className="kv"><dt>Respect</dt><dd>{d.zoneOutcomes.respect}</dd><dt>Breakout</dt><dd>{d.zoneOutcomes.breakout}</dd><dt>Tidak diketahui</dt><dd>{d.zoneOutcomes.unknown}</dd></dl>
          </section>
        </>
      )}

      <section className="panel">
        <h2>Perbandingan konfirmasi</h2>
        <p className="mute small">Setiap baris hanya terisi dari sesi backtest yang benar-benar dijalankan dengan profil tersebut.</p>
        <div className="tablewrap"><table><thead><tr><th>Profil</th><th>Sesi</th><th>Trade</th><th>Win rate</th><th>Expectancy</th><th>Profit factor</th><th>Max DD</th></tr></thead>
          <tbody>{d.comparison.map((c: any) => (
            <tr key={c.profile}><td>{PROFILE[c.profile]}</td>{c.metrics ? <>
              <td>{c.sessions}</td><td>{c.metrics.totalTrades}</td><td>{pct(c.metrics.winRate)}</td><td>{px(c.metrics.expectancy)}</td>
              <td>{c.metrics.profitFactor?.toFixed(2) ?? '—'}</td><td>{px(c.metrics.maxDrawdown)}</td></> : <td colSpan={6} className="mute">Belum dijalankan</td>}</tr>))}</tbody></table></div>
      </section>

      {d.trades.length ? (
        <section className="panel">
          <h2>Daftar transaksi</h2>
          <div className="tablewrap"><table><thead><tr><th>Entry</th><th>Arah</th><th>TF</th><th>Harga entry</th><th>Exit</th><th>Alasan exit</th><th>P/L</th><th></th></tr></thead>
            <tbody>{d.trades.map((t: any) => (
              <tr key={t.id} className="click" onClick={() => open(t.id)}>
                <td>{fmt(Number(t.entry_ms), tz)}</td><td>{t.side}</td><td>{t.timeframe ?? '—'}</td><td>{px(t.entry_price)}</td>
                <td>{px(t.exit_price)}</td><td>{t.exit_reason}</td><td className="num">{px(t.pnl)}</td><td>{t.is_test ? 'TEST' : ''}</td>
              </tr>))}</tbody></table></div>
        </section>
      ) : null}

      {detail ? <TradeDetail d={detail} tz={tz} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function Metric({ label, v }: { label: string; v: React.ReactNode }) {
  return <div className="panel"><div className="mute small">{label}</div><div className="num" style={{ fontSize: 24, fontWeight: 800 }}>{v}</div></div>;
}
function Breakdown({ title, rows, label = (k: string) => k }: { title: string; rows: any[]; label?: (k: string) => string }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {rows.length ? <table><thead><tr><th></th><th>Trade</th><th>Win</th><th>P/L</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><td>{label(r.key)}</td><td>{r.metrics.totalTrades}</td><td>{pct(r.metrics.winRate)}</td><td className="num">{px(r.metrics.totalPnl)}</td></tr>)}</tbody></table>
        : <p className="mute small">Tidak ada data untuk pengelompokan ini.</p>}
    </section>
  );
}
function TradeDetail({ d, tz, onClose }: { d: any; tz: string; onClose: () => void }) {
  if (d.loading) return <section className="panel"><Loading what="detail trade" /></section>;
  if (d.error) return <ErrorBox error={d.error} />;
  const t = d.trade;
  const markers = [
    { time: t.entry, text: `Entry ${t.side}`, position: t.side === 'long' ? 'below' : 'above', shape: t.side === 'long' ? 'arrowUp' : 'arrowDown' },
    ...(t.exit ? [{ time: t.exit, text: `Exit ${t.exitReason}`, position: 'above', shape: 'square' }] : []),
  ] as any;
  return (
    <section className="panel stack">
      <div className="row between"><h2 style={{ margin: 0 }}>Trade {fmt(t.entry, tz)} {t.isTest ? '(TEST)' : ''}</h2><button className="btn" onClick={onClose}>Tutup</button></div>
      <div className="chartbox" style={{ height: 340 }}>
        {d.candles.length ? <CandleChart candles={d.candles} markers={markers} timezone={tz} fitKey={t.id} /> : <div className="empty">Tidak ada data candle yang tertaut ke trade ini.</div>}
      </div>
      <div className="grid">
        <dl className="kv"><dt>Arah</dt><dd>{t.side}</dd><dt>Entry</dt><dd>{px(t.entryPrice)}</dd><dt>SL / TP</dt><dd>{px(t.stopLoss)} / {px(t.takeProfit)}</dd>
          <dt>Exit</dt><dd>{px(t.exitPrice)} ({t.exitReason})</dd><dt>P/L</dt><dd>{px(t.pnl)}</dd><dt>Asal</dt><dd>{t.origin}</dd></dl>
        <div><div className="mute small">Alasan setup</div><pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(t.setupReason, null, 2)}</pre></div>
        <div>
          <div className="mute small">Berita yang tersedia saat entry</div>
          {!d.newsAtEntry.archiveAvailable ? <strong>DATA UNAVAILABLE</strong> : d.newsAtEntry.items.length
            ? d.newsAtEntry.items.map((n: any) => <div key={n.id} className="small">{n.title} — {n.sentiment?.label ?? 'Unknown'}</div>)
            : <span className="small">Tidak ada rilis 24 jam sebelumnya.</span>}
        </div>
      </div>
    </section>
  );
}
