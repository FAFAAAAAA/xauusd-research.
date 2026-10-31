'use client';
import { useCallback, useEffect, useState } from 'react';
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
  const [session, setSession] = useState('');
  const [d, setD] = useState<any>(() => peek('/api/analytics'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tz, setTz] = useState('UTC');
  const [detail, setDetail] = useState<any>(null);
  const [tradeLimit, setTradeLimit] = useState(10);
  const load = useCallback(() => {
    setErr(null);
    const url = `/api/analytics${session ? `?session=${session}` : ''}`;
    const cached = peek(url);
    if (cached) setD(cached);
    setBusy(true);
    call<any>(url).then(setD).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  }, [session]);
  useEffect(() => { load(); call<any>('/api/settings').then((s) => setTz(s.timezone)).catch(() => {}); }, [load]);

  const rows = d?.sessions?.length ? yearRows(d.sessions) : [];
  const cur = d?.sessions?.find((x: any) => String(x.id) === session) ?? null;
  const curYear = cur ? periodLabel(cur.period_start ?? null, cur.period_end ?? null) : null;
  const curRr = cur ? rrNum(cur) : null;
  const row = rows.find((r) => r.label === curYear) ?? rows[0];
  // pick a result automatically: newest year, RR 1:2 if it exists
  useEffect(() => {
    if (rows.length && !cur) {
      const r0 = rows[0];
      const s0 = r0.cells.find((c: any) => rrNum(c) === 2) ?? r0.cells[0];
      if (s0) setSession(String(s0.id));
    }
  }, [rows.length, cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (year: string, rr: number) => {
    const r = rows.find((x) => x.label === year);
    const s = r?.cells.find((c: any) => rrNum(c) === rr) ?? r?.cells[0];
    if (s) { setSession(String(s.id)); setDetail(null); setTradeLimit(10); }
  };
  const open = async (id: string) => { setDetail({ loading: true }); try { setDetail(await call<any>(`/api/trades/${id}`)); } catch (e) { setDetail({ error: (e as Error).message }); } };

  const m = d?.overall;
  const hasRuns = rows.length > 0;
  return (
    <div className="stack">
      <PageHead title="Hasil backtest" />

      {err ? <ErrorBox error={err} retry={load} /> : !d ? <Loading what="hasil" /> : !hasRuns ? (
        <RunBacktest onDone={(id) => { setSession(id); load(); }} />
      ) : (
        <>
          <section className="group stack">
            <div className="stack tight">
              <span className="label">Tahun</span>
              <div className="seg scroll" role="group" aria-label="Tahun">
                {rows.map((r) => <button key={r.label} aria-pressed={r.label === row?.label} onClick={() => choose(r.label, curRr ?? 2)}>{r.label}</button>)}
              </div>
            </div>
            <div className="stack tight">
              <span className="label">Risk : Reward</span>
              <div className="rr3">
                {[1, 2, 3].map((rr) => {
                  const c = row?.cells.find((x: any) => rrNum(x) === rr);
                  const p = c ? Number(c.pnl ?? 0) : null;
                  return (
                    <button key={rr} className={`rrbtn ${p == null ? '' : p > 0 ? 'up' : p < 0 ? 'down' : ''}`} aria-pressed={curRr === rr && cur != null} disabled={!c} onClick={() => row && choose(row.label, rr)}>
                      <span className="k">1:{rr}</span>
                      <span className="p">{p == null ? '—' : `${p > 0 ? '+' : p < 0 ? '−' : ''}$${Math.round(Math.abs(p)).toLocaleString('en-US')}`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <div className={`stack${busy ? ' refreshing' : ''}`}>
            {!d.hasData || !m ? (
              <section className="group empty-state"><h2>Belum ada trade</h2><p>Backtest ini tidak menghasilkan trade yang selesai.</p></section>
            ) : (
              <>
                <section className="hero verdict">
                  <span className="label">{curYear} · RR 1:{curRr} · risiko {cur?.cost_config?.risk_usd ? `$${cur.cost_config.risk_usd}` : 'lot tetap'} per trade</span>
                  <span className={`price ${tone(m.totalPnl)}`}>{money(m.totalPnl)}</span>
                  <p>{m.totalPnl > 0 ? 'Untung' : m.totalPnl < 0 ? 'Rugi' : 'Impas'} dari <strong>{m.totalTrades} trade</strong>: <strong className="pos">{m.wins} menang</strong>, <strong className="neg">{m.losses} kalah</strong>.</p>
                  <div className="wlbar" aria-hidden><span style={{ width: `${(m.wins / Math.max(1, m.totalTrades)) * 100}%` }} /></div>
                  <div className="row between small mute"><span>Win rate {pct(m.winRate)}</span><span>Butuh ≥ {curRr ? Math.round(100 / (1 + curRr)) : '—'}% agar impas</span></div>
                  <div className="facts">
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
                  </details>
                </section>

                <section className="group">
                  <h2>Grafik saldo</h2>
                  <EquityChart trades={closedTrades(d.trades)} tz={tz} />
                </section>

                <section className="group">
                  <PnlCalendar key={session} trades={closedTrades(d.trades)} tz={tz} />
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
                    <a className="btn sm" href={`/api/analytics/export?kind=trades${session ? `&session=${session}` : ''}`}>Unduh CSV</a>
                  </div>
                </section>
              </>
            )}
          </div>

          <details className="group">
            <summary><span><h2>Backtest baru</h2><span className="s">Jalankan tahun lain atau ubah risiko</span></span></summary>
            <div className="body"><RunBacktest bare onDone={(id) => { setSession(id); load(); window.scrollTo({ top: 0 }); }} /></div>
          </details>
          <details className="group">
            <summary><span><h2>Kelola hasil</h2><span className="s">Hapus backtest lama atau dobel</span></span></summary>
            <div className="body">
              <RunPicker sessions={d.sessions} selected={session} tz={tz}
                onSelect={(id) => { setSession(id); setDetail(null); window.scrollTo({ top: 0 }); }}
                onDeleted={(ids) => { if (ids.includes(session)) setSession(''); load(); }} />
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

function RunBacktest({ onDone, bare = false }: { onDone: (sessionId: string) => void; bare?: boolean }) {
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
    <section className={bare ? 'stack' : 'group stack'}>
      <div className="stack tight">
        {bare ? null : <h2>Jalankan backtest</h2>}
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
  const fullYear = a.getUTCMonth() === 0 && a.getUTCDate() === 1 && b.getUTCMonth() === 0 && b.getUTCDate() === 1 && b.getUTCFullYear() === a.getUTCFullYear() + 1;
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
