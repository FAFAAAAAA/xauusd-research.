'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { call, fmt, peek, pct, px } from '@/components/client';
import { ErrorBox, Loading, PageHead } from '@/components/Status';
import { EquityChart, PnlCalendar, closedTrades } from '@/components/ResultCharts';

const CandleChart = dynamic(() => import('@/components/CandleChart'), { ssr: false });
/* eslint-disable @typescript-eslint/no-explicit-any */

const PROFILE: Record<string, string> = {
  snr_only: 'SNR saja', snr_news: 'SNR + berita', snr_trend_momentum: 'SNR + tren', snr_all: 'SNR + semua konfirmasi',
};
const EXIT: Record<string, string> = { tp: 'Kena TP', sl: 'Kena SL', ambiguous_worst: 'TP & SL 1 candle (dihitung SL)', ambiguous_best: 'TP & SL 1 candle (dihitung TP)', ambiguous_skipped: 'Dilewati', time: 'Waktu habis', open: 'Masih terbuka', imported: 'Impor' };
const money = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}` : '—');
const tone = (n: unknown) => (typeof n === 'number' ? (n > 0 ? 'pos' : n < 0 ? 'neg' : '') : '');

export default function Analytics() {
  const [d, setD] = useState<any>(() => peek('/api/analytics'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tz, setTz] = useState('UTC');
  const [detail, setDetail] = useState<any>(null);
  const [tradeLimit, setTradeLimit] = useState(10);
  const [year, setYear] = useState<string | null>(null); // null = newest, 'ALL' = all years
  const [rr, setRr] = useState(2);

  const rows = d?.sessions?.length ? yearRows(d.sessions) : [];
  const yearSel = year && (year === 'ALL' || rows.some((r) => r.label === year)) ? year : rows[0]?.label ?? null;
  const cellOf = (r: { cells: any[] }, x: number) => r.cells.find((c: any) => rrNum(c) === x);
  const pick = (y: string | null, x: number): any[] => y === 'ALL' ? rows.map((r) => cellOf(r, x)).filter(Boolean)
    : (() => { const r = rows.find((q) => q.label === y); const c = r ? cellOf(r, x) ?? r.cells[0] : null; return c ? [c] : []; })();
  const picked = pick(yearSel, rr);
  const key = picked.map((c) => String(c.id)).join(',');
  const urlFor = (k: string) => `/api/analytics${k ? `?session=${k}` : ''}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const fresh = loadedKey === key;
  // instant numbers from the session summaries (no waiting for the server)
  const sum = picked.reduce((a, c) => ({ pnl: a.pnl + Number(c.pnl ?? 0), wins: a.wins + Number(c.wins ?? 0), losses: a.losses + Number(c.losses ?? 0), trades: a.trades + Number(c.trades ?? 0) }), { pnl: 0, wins: 0, losses: 0, trades: 0 });
  const cur = picked.length === 1 ? picked[0] : null;
  const curRr = picked.length ? rrNum(picked[0]) : rr;
  const curYear = yearSel === 'ALL' ? `Semua tahun (${picked.length})` : yearSel;

  const load = useCallback(() => {
    setErr(null);
    const url = urlFor(key);
    const cached = peek(url);
    if (cached) { setD(cached); setLoadedKey(key); }
    setBusy(!cached);
    call<any>(url).then((x) => { setD(x); setLoadedKey(key); }).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // warm the cache for the other RR buttons and "Semua" so the next tap is instant
  useEffect(() => {
    if (!fresh || !rows.length) return;
    const t = setTimeout(() => {
      const keys = [1, 2, 3].map((x) => pick(yearSel, x)).concat(rows.length > 1 ? [pick('ALL', rr)] : [])
        .map((p) => p.map((c: any) => String(c.id)).join(',')).filter((k) => k && k !== key && !peek(urlFor(k)));
      keys.forEach((k) => { call(urlFor(k)).catch(() => {}); });
    }, 400);
    return () => clearTimeout(t);
  }, [fresh, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => { call<any>('/api/settings').then((s) => setTz(s.timezone)).catch(() => {}); }, []);
  const choose = (y: string | null, x: number) => { setYear(y); setRr(x); setDetail(null); setTradeLimit(10); };
  const open = async (id: string) => { setDetail({ loading: true }); try { setDetail(await call<any>(`/api/trades/${id}`)); } catch (e) { setDetail({ error: (e as Error).message }); } };
  const reloadAll = () => { setYear(null); call<any>('/api/analytics').then(setD).catch(() => {}); };

  const m = d?.overall;
  const hasRuns = rows.length > 0;
  return (
    <div className="stack">
      <PageHead title="Hasil backtest" />

      {err ? <ErrorBox error={err} retry={load} /> : !d ? <Loading what="hasil" /> : !hasRuns ? (
        <RunBacktest existing={[]} onDone={reloadAll} />
      ) : (
        <>
          <section className="group stack">
            <div className="stack tight">
              <span className="label">Tahun</span>
              <div className="seg scroll" role="group" aria-label="Tahun">
                {rows.length > 1 ? <button aria-pressed={yearSel === 'ALL'} onClick={() => choose('ALL', curRr)}>Semua</button> : null}
                {rows.map((r) => <button key={r.label} aria-pressed={r.label === yearSel} onClick={() => choose(r.label, curRr)}>{r.label}</button>)}
              </div>
            </div>
            <div className="stack tight">
              <span className="label">Risk : Reward</span>
              <div className="rr3">
                {[1, 2, 3].map((x) => {
                  const cells = yearSel === 'ALL' ? rows.map((r) => cellOf(r, x)).filter(Boolean) : rows.filter((r) => r.label === yearSel).map((r) => cellOf(r, x)).filter(Boolean);
                  const p = cells.length ? cells.reduce((a: number, c: any) => a + Number(c.pnl ?? 0), 0) : null;
                  return (
                    <button key={x} className={`rrbtn ${p == null ? '' : p > 0 ? 'up' : p < 0 ? 'down' : ''}`} aria-pressed={curRr === x && picked.length > 0} disabled={!cells.length} onClick={() => choose(yearSel, x)}>
                      <span className="k">1:{x}</span>
                      <span className="p">{p == null ? '—' : `${p > 0 ? '+' : p < 0 ? '−' : ''}$${Math.round(Math.abs(p)).toLocaleString('en-US')}`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <div className={`stack${busy ? ' refreshing' : ''}`}>
            {!picked.length || (fresh && (!d.hasData || !m)) ? (
              <section className="group empty-state"><h2>Belum ada trade</h2><p>Backtest ini tidak menghasilkan trade yang selesai.</p></section>
            ) : (
              <>
                <section className="hero verdict">
                  <span className="label">{curYear} · RR 1:{curRr} · risiko {picked[0]?.cost_config?.risk_usd ? `$${picked[0].cost_config.risk_usd}` : 'lot tetap'} per trade</span>
                  <span className={`price ${tone(sum.pnl)}`}>{money(sum.pnl)}</span>
                  <p>{sum.pnl > 0 ? 'Untung' : sum.pnl < 0 ? 'Rugi' : 'Impas'} dari <strong>{sum.trades} trade</strong>: <strong className="pos">{sum.wins} menang</strong>, <strong className="neg">{sum.losses} kalah</strong>.</p>
                  <div className="wlbar" aria-hidden><span style={{ width: `${(sum.wins / Math.max(1, sum.trades)) * 100}%` }} /></div>
                  <div className="row between small mute"><span>Win rate {sum.trades ? `${((sum.wins / sum.trades) * 100).toFixed(1)}%` : '—'}</span><span>Butuh ≥ {curRr ? Math.round(100 / (1 + curRr)) : '—'}% agar impas</span></div>
                  {m && fresh ? <><div className="facts">
                    <div><span className="label">Rata-rata menang</span><strong className="pos">{m.wins ? money(m.grossProfit / m.wins) : '—'}</strong></div>
                    <div><span className="label">Rata-rata kalah</span><strong className="neg">{m.losses ? money(-m.grossLoss / m.losses) : '—'}</strong></div>
                    <div><span className="label">Turun terdalam</span><strong className="neg">{money(-m.maxDrawdown)}</strong></div>
                    <div><span className="label">Kalah beruntun</span><strong>{m.maxConsecutiveLosses}×</strong></div>
                  </div>
                  <details className="more">
                    <summary>Angka lain</summary>
                    <dl className="kv">
                      <dt>Total dari trade menang</dt><dd className="pos">{money(m.grossProfit)}</dd>
                      <dt>Total dari trade kalah</dt><dd className="neg">{money(-m.grossLoss)}</dd>
                      <dt>Profit factor</dt><dd>{m.profitFactor == null ? '—' : m.profitFactor.toFixed(2)}</dd>
                      <dt>Rata-rata per trade</dt><dd>{money(m.expectancy)}</dd>
                      <dt>Menang beruntun</dt><dd>{m.maxConsecutiveWins}×</dd>
                      <dt>Zona bertahan / jebol</dt><dd>{d.zoneOutcomes.respect} / {d.zoneOutcomes.breakout}</dd>
                    </dl>
                  </details></> : <div className="facts"><div><span className="label">Memuat detail…</span></div></div>}
                </section>

                {fresh ? <>
                <section className="group">
                  <h2>Grafik saldo</h2>
                  <EquityChart trades={closedTrades(d.trades)} tz={tz} />
                </section>

                <section className="group">
                  <PnlCalendar key={key} trades={closedTrades(d.trades)} tz={tz} />
                </section>

                {detail ? <TradeDetail d={detail} tz={tz} onClose={() => setDetail(null)} /> : null}

                <section className="group">
                  <div className="row between"><h2>Trade terakhir</h2><span className="mute small">{d.trades.length} total</span></div>
                  <div className="list" style={{ marginTop: 8 }}>
                    {d.trades.slice(-tradeLimit).reverse().map((t: any) => (
                      <button key={t.id} className="item btnrow" onClick={() => open(t.id)}>
                        <span style={{ minWidth: 0 }}>
                          <span className="t" style={{ display: 'block' }}>{fmt(Number(t.entry_ms), tz)}</span>
                          <span className="d">{EXIT[t.exit_reason] ?? t.exit_reason}</span>
                        </span>
                        <span className="row" style={{ gap: 8, flex: 'none' }}>
                          <span className={`tag ${t.side === 'long' ? 'buy' : 'sell'}`}>{t.side === 'long' ? 'BUY' : 'SELL'}</span>
                          <span className={`num ${tone(t.pnl)}`} style={{ fontWeight: 700, minWidth: 72, textAlign: 'right' }}>{money(t.pnl)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    {d.trades.length > tradeLimit ? <button className="btn sm" onClick={() => setTradeLimit((n) => n + 30)}>Tampilkan lebih banyak</button> : null}
                    <a className="btn sm" href={`/api/analytics/export?kind=trades${key ? `&session=${key}` : ''}`}>Unduh CSV</a>
                  </div>
                </section>
                </> : <Loading what="grafik" />}
              </>
            )}
          </div>

          <details className="group">
            <summary><span><h2>Backtest baru</h2><span className="s">Jalankan tahun lain atau ubah risiko</span></span></summary>
            <div className="body"><RunBacktest bare existing={rows.map((r) => r.label)} onDone={() => { reloadAll(); window.scrollTo({ top: 0 }); }} /></div>
          </details>
          <details className="group">
            <summary><span><h2>Kelola hasil</h2><span className="s">Hapus backtest lama atau dobel</span></span></summary>
            <div className="body">
              <RunPicker sessions={d.sessions} selected={cur ? String(cur.id) : ''} tz={tz}
                onSelect={(id) => { const s0 = d.sessions.find((x: any) => String(x.id) === id); if (s0) choose(periodLabel(s0.period_start ?? null, s0.period_end ?? null), rrNum(s0)); window.scrollTo({ top: 0 }); }}
                onDeleted={() => reloadAll()} />
            </div>
          </details>
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

type YearStatus = { year: number; state: 'wait' | 'run' | 'done' | 'skip' | 'fail'; note?: string };

function RunBacktest({ onDone, bare = false, existing }: { onDone: () => void; bare?: boolean; existing: string[] }) {
  const [sources, setSources] = useState<any[]>([]);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [cov, setCov] = useState<any[]>([]);
  const now = new Date().getUTCFullYear();
  const [f, setF] = useState({ source: '', strategy: '', y1: '', y2: '', from: '2019-01-01', to: '2020-01-01', spread: '0.30', slippage: '0.10', commission: '7', size: '0.01', risk: '10', ambiguity: 'worst' });
  const [custom, setCustom] = useState(false);
  const [skipDone, setSkipDone] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<YearStatus[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const stop = useRef(false);
  useEffect(() => {
    call<any[]>('/api/sources').then((s) => { setSources(s); if (s[0]) setF((x) => ({ ...x, source: x.source || s.find((y: any) => !y.is_test)?.id || s[0].id })); }).catch(() => {});
    call<any[]>('/api/strategies').then((s) => {
      const usable = s.filter((x: any) => x.configured && !x.testOnly && x.status === 'active');
      setStrategies(usable);
      if (usable.length) setF((x) => ({ ...x, strategy: x.strategy || usable[usable.length - 1].id }));
    }).catch(() => {});
    call<any[]>('/api/sources/coverage').then(setCov).catch(() => {});
  }, []);
  // years that have M15 data for the chosen source
  const m15 = cov.find((c) => c.source_id === f.source && c.timeframe === 'M15');
  const firstY = m15 ? new Date(m15.first).getUTCFullYear() : 2018;
  const lastY = m15 ? new Date(m15.last).getUTCFullYear() : now;
  const years = Array.from({ length: Math.max(0, lastY - firstY + 1) }, (_, i) => firstY + i);
  const y1 = Number(f.y1) || firstY, y2 = Number(f.y2) || lastY;
  const list = years.filter((y) => y >= y1 && y <= y2);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const body = (from: string, to: string) => ({
    source_id: f.source, strategy_version_id: f.strategy || null, from, to, rr: [1, 2, 3],
    size: Number(f.size), risk_usd: f.risk.trim() ? Number(f.risk) : null,
    costs: { spread: Number(f.spread), slippage: Number(f.slippage), commissionPerUnit: Number(f.commission), ambiguityPolicy: f.ambiguity },
  });

  const run = async () => {
    setBusy(true); setErr(null); stop.current = false;
    if (custom) {
      setProg(null);
      try { await call<any>('/api/backtest/run', { method: 'POST', json: body(`${f.from}T00:00:00Z`, `${f.to}T00:00:00Z`) }); onDone(); }
      catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      return;
    }
    const st: YearStatus[] = list.map((y) => ({ year: y, state: skipDone && existing.includes(String(y)) ? 'skip' : 'wait' }));
    setProg([...st]);
    for (const it of st) {
      if (it.state === 'skip') continue;
      if (stop.current) { it.state = 'skip'; it.note = 'dibatalkan'; setProg([...st]); continue; }
      it.state = 'run'; setProg([...st]);
      try {
        const r = await call<any>('/api/backtest/run', { method: 'POST', json: body(`${it.year}-01-01T00:00:00Z`, `${it.year + 1}-01-01T00:00:00Z`) });
        it.state = 'done';
        it.note = r.sessions.map((x: any) => `1:${x.rr} ${x.trades}`).join(' · ') + ' trade';
      } catch (e) {
        const msg = (e as Error).message;
        it.state = 'fail'; it.note = /Tidak ada candle/.test(msg) ? 'tidak ada data tahun ini' : msg;
      }
      setProg([...st]);
    }
    setBusy(false);
    onDone();
  };
  const done = prog?.filter((p) => p.state === 'done' || p.state === 'fail' || p.state === 'skip').length ?? 0;

  return (
    <section className={bare ? 'stack' : 'group stack'}>
      <div className="stack tight">
        {bare ? null : <h2>Jalankan backtest</h2>}
        <p className="mute small">Strategi SNR: tren H4, zona H4/H1, entry M15. Setiap tahun diuji dengan RR 1:1, 1:2, dan 1:3.</p>
      </div>
      {sources.length > 1 ? (
        <label className="field">Data<select value={f.source} onChange={set('source')}>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_test ? ' (tes)' : ''}</option>)}</select></label>
      ) : null}
      {!custom ? (
        <div className="grid two">
          <label className="field">Dari tahun<select value={y1} onChange={set('y1')}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
          <label className="field">Sampai tahun<select value={y2} onChange={set('y2')}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        </div>
      ) : (
        <div className="grid two">
          <label className="field">Dari tanggal<input type="date" value={f.from} onChange={set('from')} /></label>
          <label className="field">Sampai tanggal<input type="date" value={f.to} onChange={set('to')} /></label>
        </div>
      )}
      <label className="field">Risiko per trade ($)<input inputMode="decimal" value={f.risk} onChange={set('risk')} placeholder="10" /></label>
      {!custom && existing.some((y) => list.includes(Number(y))) ? (
        <label className="switch">Lewati tahun yang sudah ada hasilnya<input type="checkbox" checked={skipDone} onChange={(e) => setSkipDone(e.target.checked)} /></label>
      ) : null}
      <details className="more">
        <summary>Biaya & lainnya</summary>
        <label className="switch">Pakai rentang tanggal sendiri<input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /></label>
        <div className="grid two">
          {strategies.length > 1 ? <label className="field">Strategi<select value={f.strategy} onChange={set('strategy')}>{strategies.map((s) => <option key={s.id} value={s.id}>{s.strategy_key} {s.version}</option>)}</select></label> : null}
          <label className="field">Spread ($)<input inputMode="decimal" value={f.spread} onChange={set('spread')} /></label>
          <label className="field">Slippage ($)<input inputMode="decimal" value={f.slippage} onChange={set('slippage')} /></label>
          <label className="field">Komisi per lot ($)<input inputMode="decimal" value={f.commission} onChange={set('commission')} /></label>
          <label className="field">Lot tetap (kalau risiko dikosongkan)<input inputMode="decimal" value={f.size} onChange={set('size')} /></label>
          <label className="field">TP & SL kena di 1 candle<select value={f.ambiguity} onChange={set('ambiguity')}><option value="worst">Hitung sebagai SL</option><option value="best">Hitung sebagai TP</option><option value="skip">Lewati</option></select></label>
        </div>
      </details>
      {!sources.length ? <div className="notice">Impor data M15 dulu di Atur → Data harga.</div> : null}
      {busy && !custom
        ? <button className="btn block" onClick={() => { stop.current = true; }}>Berhenti setelah tahun ini</button>
        : <button className="btn primary block" onClick={run} disabled={busy || !f.source || !f.strategy || (!custom && !list.length)}>
            {busy ? 'Menghitung…' : custom ? 'Jalankan backtest' : list.length > 1 ? `Jalankan ${y1}–${y2} (${list.length} tahun)` : `Jalankan ${y1}`}
          </button>}
      {err ? <div className="error">{err}</div> : null}
      {prog ? (
        <div className="stack tight">
          <div className="row between small"><strong>{busy ? 'Sedang berjalan… biarkan halaman ini terbuka' : 'Selesai'}</strong><span className="mute">{done}/{prog.length}</span></div>
          <div className="wlbar progress" aria-hidden><span style={{ width: `${(done / Math.max(1, prog.length)) * 100}%` }} /></div>
          <div className="list">
            {prog.map((p) => (
              <div key={p.year} className="item">
                <span className="t">{p.year}</span>
                <span className={`end small ${p.state === 'fail' ? 'neg' : p.state === 'done' ? 'pos' : 'mute'}`} style={{ flex: '1 1 auto', minWidth: 0 }}>
                  {p.state === 'wait' ? 'Menunggu' : p.state === 'run' ? 'Menghitung…' : p.state === 'done' ? `✓ ${p.note}` : p.state === 'skip' ? (p.note ?? 'Sudah ada, dilewati') : `Gagal: ${p.note}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------- runs (one backtest press = 1 run = up to 3 RR sessions) */
interface Run { key: string; from: number | null; to: number | null; created: number; risk: number | null; sessions: any[] }

function groupRuns(sessions: any[]): Run[] {
  const m = new Map<string, Run>();
  for (const s of sessions) {
    const cc = s.cost_config ?? {};
    // new runs carry run_id; older ones are grouped by period + creation minute
    const key = cc.run_id ?? `${s.period_start}|${s.period_end}|${Math.floor(Number(s.created_ms) / 60_000)}|${s.name?.replace(/RR 1:\d+(\.\d+)?/, '')}`;
    const r: Run = m.get(key) ?? { key, from: s.period_start ?? null, to: s.period_end ?? null, created: Number(s.created_ms) || 0, risk: cc.risk_usd ?? null, sessions: [] };
    r.sessions.push(s);
    m.set(key, r);
  }
  const rr = (s: any) => Number(s.cost_config?.rr ?? /RR 1:(\d+(\.\d+)?)/.exec(s.name ?? '')?.[1] ?? 0);
  return [...m.values()].map((r) => ({ ...r, sessions: r.sessions.sort((a, b) => rr(a) - rr(b)) })).sort((a, b) => b.created - a.created);
}

function RunPicker({ sessions, selected, tz, onSelect, onDeleted }: {
  sessions: any[]; selected: string; tz: string; onSelect: (id: string) => void; onDeleted: (ids: string[]) => void;
}) {
  const runs = groupRuns(sessions);
  const [all, setAll] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = all ? runs : runs.slice(0, 3);
  const day = (ms: number | null) => (ms == null ? '—' : fmt(ms, 'UTC').slice(0, 10));
  const del = async (r: Run) => {
    setBusy(true);
    try {
      const ids = r.sessions.map((s) => String(s.id));
      await call('/api/backtest/sessions', { method: 'DELETE', json: { ids } });
      setConfirm(null); onDeleted(ids);
    } catch { /* stays visible; user can retry */ } finally { setBusy(false); }
  };
  return (
    <div className="stack tight">
      <div className="list">
        {shown.map((r) => {
          const rrOf = (s: any) => s.cost_config?.rr ?? /RR 1:(\d+(\.\d+)?)/.exec(s.name ?? '')?.[1] ?? '?';
          return (
            <div key={r.key} className="item run">
              <div className="run-head">
                <span style={{ minWidth: 0 }}>
                  <span className="t" style={{ display: 'block' }}>{day(r.from)} – {day(r.to)}</span>
                  <span className="d">Dijalankan {fmt(r.created, tz)}{r.risk ? ` · risiko $${r.risk}` : ''}{r.sessions[0]?.is_test ? ' · tes' : ''}</span>
                </span>
                {confirm === r.key
                  ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap', flex: 'none' }}><button className="btn sm" onClick={() => setConfirm(null)}>Batal</button><button className="btn sm danger" onClick={() => del(r)} disabled={busy}>{busy ? '…' : 'Hapus'}</button></span>
                  : <button className="btn sm ghost" onClick={() => setConfirm(r.key)} aria-label="Hapus backtest ini">Hapus</button>}
              </div>
              <div className="chips">
                {r.sessions.map((s) => (
                  <button key={s.id} className="chip" aria-pressed={selected === String(s.id)} onClick={() => onSelect(String(s.id))}>
                    <span className="k">RR 1:{rrOf(s)}</span><span className="v">{s.trades} trade</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {runs.length > 3 ? <button className="btn sm" onClick={() => setAll(!all)}>{all ? 'Tampilkan lebih sedikit' : `Lihat semua (${runs.length})`}</button> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- year × RR table (newest run per period wins) */
const RRS = [1, 2, 3];
const rrNum = (s: any) => Number(s.cost_config?.rr ?? /RR 1:(\d+(\.\d+)?)/.exec(s.name ?? '')?.[1] ?? 0);
function periodLabel(from: number | null, to: number | null) {
  if (from == null || to == null) return 'Lainnya';
  const a = new Date(from), b = new Date(to);
  const fullYear = a.getUTCMonth() === 0 && a.getUTCDate() === 1 && b.getTime() <= Date.UTC(a.getUTCFullYear() + 1, 0, 1) && b.getUTCFullYear() >= a.getUTCFullYear();
  if (fullYear) return String(a.getUTCFullYear());
  const f = (x: Date) => `${x.getUTCDate()}/${x.getUTCMonth() + 1}/${String(x.getUTCFullYear()).slice(2)}`;
  return `${f(a)}–${f(b)}`;
}
function yearRows(sessions: any[]) {
  const rows = new Map<string, { label: string; sort: number; cells: any[] }>();
  for (const r of groupRuns(sessions)) { // newest first → first run seen per period is kept
    const label = periodLabel(r.from, r.to);
    if (rows.has(label)) continue;
    rows.set(label, { label, sort: r.from ?? 0, cells: RRS.map((rr) => r.sessions.find((s) => rrNum(s) === rr)).filter(Boolean) });
  }
  return [...rows.values()].sort((a, b) => b.sort - a.sort);
}

function YearTable({ sessions, selected, tz, onSelect, onDeleted }: {
  sessions: any[]; selected: string; tz: string; onSelect: (id: string) => void; onDeleted: (ids: string[]) => void;
}) {
  const rows = yearRows(sessions);
  const runs = groupRuns(sessions);
  const cell = (s: any | undefined) => {
    if (!s) return <span className="ycell empty">—</span>;
    const pnl = Number(s.pnl ?? 0);
    const wr = s.trades ? Math.round((Number(s.wins ?? 0) / Number(s.trades)) * 100) : 0;
    return (
      <button className={`ycell ${pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}`} aria-pressed={selected === String(s.id)} onClick={() => onSelect(String(s.id))}>
        <span className="p">{`${pnl > 0 ? '+' : pnl < 0 ? '−' : ''}$${Math.round(Math.abs(pnl)).toLocaleString('en-US')}`}</span>
        <span className="m">{s.trades} trade</span>
        <span className="m">win {wr}%</span>
      </button>
    );
  };
  return (
    <section className="group stack tight">
      <h2>Hasil per tahun</h2>
      <div className="ytable" role="table">
        <div className="yrow head" role="row"><span role="columnheader">Tahun</span>{RRS.map((rr) => <span key={rr} role="columnheader">RR 1:{rr}</span>)}</div>
        {rows.map((r) => (
          <div key={r.label} className="yrow" role="row">
            <span className="ylabel" role="rowheader">{r.label}</span>
            {RRS.map((rr) => <span key={rr} role="cell">{cell(r.cells.find((s: any) => rrNum(s) === rr))}</span>)}
          </div>
        ))}
      </div>
      <p className="mute small">Tekan kotak untuk melihat detailnya di bawah. Angka = untung/rugi bersih · jumlah trade · win rate.</p>
      {runs.length > rows.length || runs.length > 1 ? (
        <details className="more">
          <summary>Kelola / hapus backtest ({runs.length})</summary>
          <RunPicker sessions={sessions} selected={selected} tz={tz} onSelect={onSelect} onDeleted={onDeleted} />
        </details>
      ) : null}
    </section>
  );
}
