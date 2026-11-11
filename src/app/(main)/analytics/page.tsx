'use client';
import { BROKER } from '@/lib/core/broker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { call, fmt, peek, pct, px } from '@/components/client';
import { CountUp, EmptyState, ErrorBox, Loading, PageHead, SecHead, Seg, Sheet, Spinner } from '@/components/Status';
import { DrawdownBreakdown, EquityChart, PnlCalendar, closedTrades, type ClosedTrade } from '@/components/ResultCharts';
import { StatsBento, useResultStats } from '@/components/StatsBento';
import { ReportButton } from '@/components/ReportImage';
import { MarketSwitch, useMarket } from '@/components/MarketSwitch';
import { marketOfAdapter, marketOfStrategy, marketOfSymbol, type Market } from '@/lib/core/markets';
import { INSTRUMENTS, instrumentLabel } from '@/lib/core/instruments';
import { METHODS, methodByKey, methodByStrategy } from '@/lib/core/strategy/methods-meta';

const CandleChart = dynamic(() => import('@/components/CandleChart'), { ssr: false });
/* eslint-disable @typescript-eslint/no-explicit-any */

const PROFILE: Record<string, string> = {
  snr_only: 'SNR saja', snr_news: 'SNR + berita', snr_trend_momentum: 'SNR + tren', snr_all: 'SNR + semua konfirmasi',
};
const EXIT: Record<string, string> = { tp: 'Kena TP', sl: 'Kena SL', ambiguous_worst: 'TP & SL 1 candle (dihitung SL)', ambiguous_best: 'TP & SL 1 candle (dihitung TP)', ambiguous_skipped: 'Dilewati', time: 'Waktu habis', open: 'Masih terbuka', imported: 'Impor' };
const money = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? `${Math.round(Math.abs(n)) === 0 ? '' : n > 0 ? '+' : '−'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—');
/** 0.75 → "45 mnt", 16.4 → "16 jam", 50 → "2 hari 2 jam" */
/** ms from a DB timestamp (number, ISO, or Postgres text like "2025-01-01 00:00:00+00", which Safari can't parse). */
const tsMs = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const s = String(v ?? '').trim().replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
};
const hrs = (h: unknown) => {
  if (typeof h !== 'number' || !Number.isFinite(h)) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} mnt`;
  if (h < 48) return `${h < 10 ? h.toFixed(1).replace('.', ',') : Math.round(h)} jam`;
  const d = Math.floor(h / 24), r = Math.round(h - d * 24);
  return r ? `${d} hari ${r} jam` : `${d} hari`;
};
const tone = (n: unknown) => (typeof n === 'number' ? (n > 0 ? 'pos' : n < 0 ? 'neg' : '') : '');

const UI_ICON_PATH = {
  options: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  calendar: 'M5 5h14v15H5zM8 3v4M16 3v4M5 10h14',
  risk: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM12 8v5M12 16h.01',
  trades: 'M4 19V5M4 19h16M8 15l4-5 4 2 4-7',
  win: 'm5 12 4 4L19 6',
  loss: 'm6 6 12 12M18 6 6 18',
  drawdown: 'm4 6 6 6 4-4 6 10M14 18h6v-6',
  streak: 'M5 5v4h4M10 10v4h4M15 15v4h4',
  ratio: 'M5 19V11M12 19V5M19 19v-9',
  average: 'M4 12h16M7 6h10M7 18h10',
} as const;
function ResearchIcon({ name }: { name: keyof typeof UI_ICON_PATH }) {
  return <svg className="research-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={UI_ICON_PATH[name]} /></svg>;
}

export default function Analytics() {
  const [dRaw, setD] = useState<any>(() => peek('/api/analytics'));
  const [market, setMarket] = useMarket();
  // only the chosen market's results (Forex = MT5 strategies, Crypto = Binance strategies)
  const d = useMemo(() => (dRaw?.sessions ? { ...dRaw, sessions: dRaw.sessions.filter((s: any) => marketOfStrategy(String(s.strategy ?? '')) === market) } : dRaw), [dRaw, market]);
  const [busy, setBusy] = useState(false);
  const loadSequence = useRef(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tz, setTz] = useState('UTC');
  const [detail, setDetail] = useState<any>(null);
  const [tradeLimit, setTradeLimit] = useState(10);
  const [showTrades, setShowTrades] = useState(false);
  const [year, setYear] = useState<string | null>(null); // null = newest, 'ALL' = all years
  const [rr, setRr] = useState(2);

  const configs = d?.sessions?.length ? strategyConfigs(d.sessions) : [];
  const [cfg, setCfg] = useState<string | null>(null);
  const [tab, setTab] = useState<'hasil' | 'jalan' | 'kelola'>('hasil');
  const cfgSel = cfg && configs.some((c) => c.key === cfg) ? cfg : configs[0]?.key ?? null;
  const cfgSessions: any[] = d?.sessions?.length ? d.sessions.filter((s: any) => configKey(s) === cfgSel) : [];
  const pairs = pairSummaries(cfgSessions, rr);
  const [pair, setPair] = useState<string | null>(null);
  const pairSel = pair && pairs.some((p) => p.symbol === pair) ? pair : pairs[0]?.symbol ?? null;
  const rows = yearRows(cfgSessions.filter((s: any) => symOf(s) === pairSel));
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
  // calendar months covered by the chosen results (sum of their tested periods) → average result per month
  const monthsTested = picked.reduce((a: number, c: any) => a + Math.max(0, (tsMs(c.period_end) - tsMs(c.period_start)) / 86_400_000 || 0), 0) / 30.44;
  const perMonth = monthsTested > 0 ? sum.pnl / monthsTested : null;

  const load = useCallback(() => {
    const sequence = ++loadSequence.current;
    setErr(null);
    const url = urlFor(key);
    const cached = peek(url);
    if (cached) { setD(onlyVisible(cached)); setLoadedKey(key); }
    setBusy(!cached);
    call<any>(url).then((x) => {
      if (sequence !== loadSequence.current) return;
      setD(onlyVisible(x)); setLoadedKey(key);
    }).catch((e) => { if (sequence === loadSequence.current) setErr(e.message); })
      .finally(() => { if (sequence === loadSequence.current) setBusy(false); });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => { call<any>('/api/settings').then((s) => setTz(s.timezone)).catch(() => {}); }, []);
  const choose = (y: string | null, x: number) => { setYear(y); setRr(x); setDetail(null); setTradeLimit(10); };
  const open = async (id: string) => { setDetail({ loading: true }); try { setDetail(await call<any>(`/api/trades/${id}`)); } catch (e) { setDetail({ error: (e as Error).message }); } };
  const reloadAll = () => { setYear(null); call<any>('/api/analytics').then(setD).catch(() => {}); };
  const pickPair = (sym: string) => {
    setPair(sym); setYear(pairs.length > 1 ? 'ALL' : null); setDetail(null); setTradeLimit(10);
    setTimeout(() => document.getElementById('pair-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const pairLabel = instrumentLabel(pairSel);

  const m = d?.overall;
  const trades = useMemo(() => closedTrades(d?.trades ?? []), [d?.trades]);
  const bs = useResultStats(trades, 0);
  const hasRuns = rows.length > 0;
  const winRate = sum.trades ? sum.wins / sum.trades : null;
  const breakEven = 1 / (1 + curRr);
  const winRateTone = winRate == null ? '' : winRate + 1e-10 >= breakEven ? 'pos' : 'neg';
  return (
    <div className="stack">
      <PageHead title="Backtest" />
      <MarketSwitch value={market} onChange={(m) => { setMarket(m); setCfg(null); setPair(null); setYear(null); }} />
      {hasRuns ? <div className="backtest-controls">
        <button className="research-filter" onClick={() => { setTab('hasil'); setFilterOpen(true); }} aria-haspopup="dialog" aria-label="Pilih strategi, tahun dan risk reward">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--surface)"/><circle cx="15" cy="17" r="3" fill="var(--surface)"/></svg>
          <span>{pairSel ?? 'XAUUSD'} <i>·</i> {curYear} <i>·</i> 1:{curRr}</span>
        </button>
        <button className="research-view icon-only" onClick={() => setActionsOpen(true)} aria-haspopup="dialog" aria-label="Opsi backtest" title="Hasil, jalankan, dan kelola"><ResearchIcon name="options" /></button>
      </div> : null}
      {actionsOpen ? <Sheet title="Backtest" onClose={() => setActionsOpen(false)}>
        <div className="research-options">
          {([['hasil', 'Hasil', 'Lihat performa strategi'], ['jalan', 'Jalankan', 'Mulai pengujian baru'], ['kelola', 'Kelola', 'Hasil yang tersimpan']] as const).map(([value, label, description]) => <button key={value} className="research-option" onClick={() => { setTab(value); setActionsOpen(false); document.getElementById('backtest')?.scrollIntoView({ behavior: 'smooth' }); }} aria-pressed={tab === value}><span><strong>{label}</strong><small>{description}</small></span><span>{tab === value ? <ResearchIcon name="win" /> : null}</span></button>)}
        </div>
      </Sheet> : null}

      {err ? <ErrorBox error={err} retry={load} /> : !d ? <Loading what="hasil" variant="dashboard" /> : !hasRuns ? (
        <RunBacktest market={market} existingFor={() => []} onDone={(k) => { setCfg(k); setPair(null); reloadAll(); }} />
      ) : (
        <>
          {tab === 'jalan' ? (
            <section className="group"><RunBacktest market={market} bare existingFor={(k, sym) => yearRows(d.sessions.filter((s: any) => configKey(s) === k && symOf(s) === sym)).map((r) => r.label)} onDone={(k) => { setCfg(k); setPair(null); reloadAll(); setTab('hasil'); window.scrollTo({ top: 0 }); }} /></section>
          ) : tab === 'kelola' ? (
            <section className="group stack">
              <SecHead title="Hasil tersimpan" meta={`${d.sessions.length} hasil`} />
              <DeleteAll sessions={d.sessions} current={d.sessions.filter((s: any) => configKey(s) === cfgSel)} currentLabel={configs.find((c) => c.key === cfgSel)?.label ?? ''} onDeleted={() => { setCfg(null); reloadAll(); window.scrollTo({ top: 0 }); }} />
              <span className="section-title" style={{ margin: '4px 0 -4px' }}>Riwayat backtest · {pairLabel}</span>
              <RunPicker sessions={cfgSessions.filter((s: any) => symOf(s) === pairSel)} selected={cur ? String(cur.id) : ''} tz={tz}
                onSelect={(id) => { const s0 = d.sessions.find((x: any) => String(x.id) === id); if (s0) choose(periodLabel(s0.period_start ?? null, s0.period_end ?? null), rrNum(s0)); window.scrollTo({ top: 0 }); }}
                onDeleted={() => reloadAll()} />
            </section>
          ) : (
          <>
          {filterOpen ? <Sheet title="Pilih hasil" onClose={() => setFilterOpen(false)}>
          <section className="filter-content stack" aria-label="Pilih hasil">
            {configs.length > 1 ? (
              <label className="field">Strategi
                <select value={cfgSel ?? ''} onChange={(e) => { setCfg(e.target.value); setPair(null); setYear(null); setDetail(null); }}>
                  {configs.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
            ) : configs[0] ? <div className="picker"><span className="label">Strategi</span><strong>{configs[0].label}</strong></div> : null}
            {pairs.length > 1 ? <PairTable pairs={pairs} selected={pairSel} rr={rr} onPick={pickPair} /> : null}
            <div className="picker" id="pair-detail" style={{ scrollMarginTop: 64 }}>
              <span className="label">{pairs.length > 1 ? <>Tahun · <strong className="ink">{pairLabel}</strong></> : 'Tahun'}</span>
              <Seg scroll label="Tahun" options={[...(rows.length > 1 ? [['ALL', 'Semua'] as const] : []), ...rows.map((r) => [r.label, r.label] as const)]} value={yearSel} onChange={(y) => choose(y, curRr)} />
            </div>
            <div className="picker">
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
          <button className="btn primary filter-apply" onClick={() => setFilterOpen(false)}>Tampilkan hasil</button>
          </Sheet> : null}

          <div className={`stack${busy ? ' refreshing' : ''}`}>
            {!picked.length || (fresh && (!d.hasData || !m)) ? (
              <section className="group"><EmptyState title="Belum ada trade">Backtest ini tidak menghasilkan trade yang selesai.</EmptyState></section>
            ) : (
              <>
                <section className="hero verdict flagship-verdict">
                  <div className="summary-meta"><span className="label verdict-context summary-risk" aria-label="Risiko per trade"><ResearchIcon name="risk" />{picked[0]?.cost_config?.risk_usd ? `$${Math.round(Number(picked[0].cost_config.risk_usd))}` : 'Lot tetap'}</span><span className="summary-trades">{sum.trades} trade</span></div>
                  <span className="profit-caption">Hasil bersih</span>
                  <span className={`price ${tone(sum.pnl)}`}><CountUp value={sum.pnl} format={money} /></span>
                  <div className="hero-winrate"><span>Win rate</span><strong className={winRateTone}>{winRate == null ? '—' : `${(winRate * 100).toFixed(1)}%`}</strong></div>
                </section>
                {m && fresh ? (() => {
                  // trade frequency over the tested calendar time of the chosen results (sum of their periods)
                  const days = picked.reduce((a: number, s: any) => a + Math.max(0, (tsMs(s.period_end) - tsMs(s.period_start)) / 86_400_000 || 0), 0);
                  const f = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1).replace('.', ','));
                  return <StatsBento s={bs} extra={<>
                    <div className="b-tile"><span className="b-k">Rata-rata / bulan</span><span className={`b-v ${tone(perMonth)}`}>{perMonth == null ? '—' : money(perMonth)}</span></div>
                    <div className="b-tile"><span className="b-k">Rata-rata / trade</span><span className={`b-v ${tone(m.expectancy ?? 0)}`}>{money(m.expectancy ?? 0)}</span></div>
                    {days > 0 && sum.trades ? <div className="b-tile b-wide b-three-t">
                      <span className="b-k">Jumlah trade</span>
                      <div className="b-three">
                        <div className="b-stat"><span className="b-v">{f(sum.trades / (days * 5 / 7))}</span><span className="b-h">per hari bursa</span></div>
                        <div className="b-stat"><span className="b-v">{f(sum.trades / (days / 7))}</span><span className="b-h">per minggu</span></div>
                        <div className="b-stat"><span className="b-v">{f(sum.trades / (days / 30.44))}</span><span className="b-h">per bulan</span></div>
                      </div>
                    </div> : null}
                    <div className="b-tile b-wide b-pair">
                      <div><span className="b-k">Total profit</span><span className="b-v pos">{money(m.grossProfit)}</span></div>
                      <div><span className="b-k">Total rugi</span><span className="b-v neg">{money(-m.grossLoss)}</span></div>
                    </div>
                    <div className="b-tile"><span className="b-k">Posisi bersamaan</span><span className="b-v">{m.maxOpenPositions}</span></div>
                    <div className="b-tile"><span className="b-k">Durasi median</span><span className="b-v">{hrs(m.medianHoldHours)}</span></div>
                  </>} />;
                })() : <section className="group"><span className="label row" style={{ gap: 8 }}><Spinner />Memuat detail…</span></section>}

                {fresh ? <>
                {m ? <DrawdownBreakdown key={key} trades={trades} tz={tz} /> : null}
                <CapitalGrowth key={key} months={monthsTested} trades={trades} tz={tz} baseRisk={Number(picked[0]?.cost_config?.risk_usd) || null} startCapital={Number(picked[0]?.cost_config?.capital) || null} />

                <section className="group calcard">
                  <PnlCalendar key={key} trades={trades} tz={tz} simple />
                </section>

                {fresh && d.byRegime?.length ? (
                  <section className="group">
                    <SecHead title="Hasil per kondisi pasar" />
                    <div className="tablewrap">
                      <table className="num-r" style={{ marginTop: 8 }}><thead><tr><th>Kondisi</th><th>Trade</th><th>Win rate</th><th>Untung/rugi</th><th>Profit factor</th><th>Per trade</th></tr></thead>
                        <tbody>{(['up', 'down', 'sideways'] as const).map((k) => {
                          const g = d.byRegime.find((x: any) => x.key === k)?.metrics;
                          const lab = k === 'up' ? 'Uptrend' : k === 'down' ? 'Downtrend' : 'Sideways';
                          return g ? (
                            <tr key={k}><td>{lab}</td><td>{g.totalTrades}</td><td>{(g.winRate * 100).toFixed(1)}%</td><td className={tone(g.totalPnl)}>{money(g.totalPnl)}</td><td>{g.profitFactor == null ? '—' : g.profitFactor.toFixed(2)}</td><td className={tone(g.expectancy)}>{money(g.expectancy ?? 0)}</td></tr>
                          ) : <tr key={k}><td>{lab}</td><td>0</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>;
                        })}</tbody></table>
                    </div>
                  </section>
                ) : null}
                {detail ? <TradeDetail d={detail} tz={tz} onClose={() => setDetail(null)} /> : null}

                <section className="group">
                  <button className={`hist-toggle${showTrades ? ' is-open' : ''}`} onClick={() => setShowTrades((v) => !v)} aria-expanded={showTrades}>
                    <span><strong>Riwayat</strong></span>
                    <span className="chev" aria-hidden>⌄</span>
                  </button>
                  {showTrades ? <>
                  <div className="group" style={{ marginTop: 10, paddingTop: 6, paddingBottom: 6 }}><div className="hcards appear">
                    {d.trades.slice(-tradeLimit).reverse().map((t: any) => {
                      const held = t.exit_ms ? Math.max(0, Number(t.exit_ms) - Number(t.entry_ms)) : null;
                      const r = t.pnl_r != null ? Number(t.pnl_r) : null;
                      return (
                        <button key={t.id} className="hcard opencard histrow" onClick={() => open(t.id)}>
                          <span className={`hc-side op-badge ${t.side === 'long' ? 'b' : 's'}`}>{t.side === 'long' ? 'B' : 'S'}</span>
                          <span className="op-left">
                            <strong className="hc-name">{pairLabel}</strong>
                            <span className="op-strat">{fmt(Number(t.entry_ms), tz).slice(0, 10)}{held != null ? ` · ${hm(held)}` : ''}</span>
                          </span>
                          <span className="op-right">
                            <span className={`op-pnl ${tone(t.pnl)}`}>{money(t.pnl)}</span>
                            {r != null ? <span className="op-strat">{r > 0 ? '+' : ''}{r.toFixed(2)}R</span> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div></div>
                  <div className="row" style={{ marginTop: 12 }}>
                    {d.trades.length > tradeLimit ? <button className="btn sm" onClick={() => setTradeLimit((n) => n + 30)}>Tampilkan lebih banyak</button> : null}
                    {d.trades.length > tradeLimit ? <button className="btn sm" onClick={() => setTradeLimit(d.trades.length)}>Tampilkan semua</button> : null}
                  </div>
                  </> : null}
                </section>
                <section className="group stack">
                  <SecHead title="Ekspor" />
                  <a className="btn block" href={`/api/analytics/export?kind=trades${key ? `&session=${key}` : ''}`}>Unduh trade (CSV)</a>
                <ReportButton filename={`backtest-${String(pairSel ?? 'xauusd').toLowerCase()}-${yearSel === 'ALL' ? 'semua-tahun' : yearSel}-rr1-${curRr}.png`} make={() => (m ? {
                  title: `${curYear} · RR 1:${curRr}`, symbol: pairLabel, strategyLabel: configs.find((c) => c.key === cfgSel)?.label ?? 'Strategi',
                  rules: methodByStrategy(String(cfgSel ?? '').split('|')[0])?.rules ?? (String(cfgSel ?? '').startsWith('breakout v0.8')
                    ? 'v0.7 (v0.6 + Pola N H1/H4) + Breakout Base: base ≥ 3 candle (overlap ≥ 50%, tinggi ≤ 1,5×ATR) di H4 (breakout jam 07–17 UTC) dan H1 (harga sudah bergerak ≥ 1×ATR searah sebelum base) · entry setelah close M15 keluar base · SL batas base ∓ 0,3×ATR · BUY: EMA50 H4 > EMA200 · SELL: EMA50 < EMA200 di H4 & D1 · tiap bagian slot sendiri'
                    : String(cfgSel ?? '').startsWith('breakout v0.7')
                    ? 'v0.6 (breakout H1 40 candle, range New York, level H1 2–3×, candle momentum, searah tren H4 & D1) + Pola N: A-B-C di H1/H4 (swing = pantulan 3×ATR, C di atas A untuk BUY), entry setelah close M15 menembus B · BUY: EMA50 H4 > EMA200 · SELL: EMA50 < EMA200 di H4 & D1 · SL di C · v0.6 dan Pola N punya slot sendiri'
                    : String(cfgSel ?? '').startsWith('breakout v0.6')
                    ? 'Entry: open candle berikutnya setelah breakout H1 (40 candle), range New York, atau tembus level H1 yang disentuh 2–3× · candle penembus harus candle momentum (badan ≥ 1×ATR) · searah tren H4 & D1; SELL hanya saat EMA50 D1 < EMA200 D1 · SL: ATR atau sisi lain range'
                    : String(cfgSel ?? '').startsWith('ob_fvg')
                    ? 'Entry: harga M15 pertama kali kembali ke FVG H1 (dengan break of structure) searah tren H4 & D1 · SL: di luar order block + 0,1×ATR H1'
                    : String(cfgSel ?? '').startsWith('breakout v0.5')
                    ? 'Entry: open M15 berikutnya setelah breakout H1 (40 candle), range New York, atau tembus level H1 yang disentuh 2–3× · searah tren H4 & D1; SELL hanya saat EMA50 D1 < EMA200 D1 · SL: ATR atau sisi lain range'
                    : String(cfgSel ?? '').startsWith('breakout v0.4')
                    ? 'Entry: open M15 berikutnya setelah breakout H1/London/New York/M30 atau tembus level H1 yang disentuh 2–3× · searah tren H4 & D1; SELL hanya saat EMA50 D1 < EMA200 D1 · SL: ATR atau sisi lain range'
                    : String(cfgSel ?? '').startsWith('breakout v0.3')
                    ? 'Entry: open M15 berikutnya setelah breakout H1/London/New York/M30 searah tren H4 & D1; SELL hanya saat EMA50 D1 < EMA200 D1 · SL: ATR atau sisi lain range'
                    : String(cfgSel ?? '').startsWith('snr_break')
                    ? 'Entry: open M15 berikutnya setelah candle H1 close menembus swing high/low H1 terakhir · tanpa filter tren · SL: level ∓ 1,5×ATR H1'
                    : String(cfgSel ?? '').startsWith('rbr_dbd')
                    ? 'Entry: candle penolakan M15 saat harga kembali ke base RBR/DBD H1 (zona segar) searah tren H4 EMA50/200 · SL: di luar base + 0,1×ATR'
                    : String(cfgSel ?? '').startsWith('pola_n')
                    ? 'Entry: close M15 tembus B pada pola A-B-C (koreksi 30–79%) searah tren H4 EMA50/200 · SL: di luar C + 0,1×ATR'
                    : String(cfgSel ?? '').startsWith('snr_snd_tv v2')
                    ? 'Entry: rejection / sweep / break-retest M15 di zona SND H4/H1 searah EMA50/200 H4 · SL: luar candle/zona + 0,15×ATR M15 · maks 1 posisi, tutup setelah 96 candle'
                    : String(cfgSel ?? '').startsWith('custom ')
                    ? 'Strategi buatan sendiri (aturan di menu Strategi) · entry di open M15 berikutnya'
                    : String(cfgSel ?? '').startsWith('snr_snd_tv')
                    ? 'Entry: rejection M15 di zona supply/demand H4/H1 dekat SNR H4, searah EMA50/200 H4 · SL: luar zona + 0,15×ATR M15'
                    : String(cfgSel ?? '').startsWith('breakout')
                    ? 'Entry: open M15 berikutnya setelah breakout H1/London/New York/M30 searah tren H4 & D1 · SL: ATR atau sisi lain range'
                    : 'Entry: open M15 berikutnya setelah harga menyentuh zona SNR · SL: luar zona + 0,5×ATR(14) M15'),
                  rr: curRr, riskUsd: picked[0]?.cost_config?.risk_usd ?? null, costs: picked[0]?.cost_config ?? null,
                  metrics: m, trades: d.trades, yearRows: rows, rrOf: rrNum, tz,
                } : null)} />
                </section>
                </> : <Loading what="grafik" />}
              </>
            )}
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

/** duration as hours.minutes (5.12 = 5 h 12 min), same as the Trade page */
const hm = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return `${Math.floor(m / 60)}.${String(m % 60).padStart(2, '0')}`; };

function TradeDetail({ d, tz, onClose }: { d: any; tz: string; onClose: () => void }) {
  const t = d.trade;
  return (
    <Sheet title={t ? fmt(t.entry, tz) : 'Detail trade'} onClose={onClose}>
      {d.loading ? <div className="stack"><div className="chartbox" style={{ height: 300, minHeight: 0 }}><div className="empty"><Spinner /></div></div><Loading what="trade" variant="list" /></div>
        : d.error ? <ErrorBox error={d.error} /> : <TradeDetailBody d={d} tz={tz} />}
    </Sheet>
  );
}
const TFS = [['M5', 'M5'], ['M15', 'M15'], ['H1', 'H1'], ['H4', 'H4'], ['D1', 'D1']] as const;
const TF_MS: Record<string, number> = { M5: 300_000, M15: 900_000, M30: 1_800_000, H1: 3_600_000, H4: 14_400_000, D1: 86_400_000 };
function TradeDetailBody({ d, tz }: { d: any; tz: string }) {
  const t = d.trade;
  // timeframe switch like the live trade chart; default picked from the trade length, never below the data's timeframe
  const baseMs = TF_MS[d.chartTimeframe] ?? 900_000;
  const held = t.exit ? t.exit - t.entry : 0;
  const auto = held < 6 * 3_600_000 ? 'M5' : held < 2 * 86_400_000 ? 'M15' : held < 7 * 86_400_000 ? 'H1' : 'H4';
  const opts = TFS.filter(([k]) => TF_MS[k] >= baseMs);
  const [iv, setIv] = useState<string>(() => (TF_MS[auto] >= baseMs ? auto : opts[0]?.[0] ?? d.chartTimeframe));
  const [candles, setCandles] = useState<any[] | null>(null);
  useEffect(() => {
    let off = false; setCandles(null);
    call<any>(`/api/trades/${t.id}?tf=${iv}`).then((x) => { if (!off) setCandles(x.candles ?? []); }).catch(() => { if (!off) setCandles(d.candles); });
    return () => { off = true; };
  }, [t.id, iv]);   // eslint-disable-line react-hooks/exhaustive-deps
  const res = t.exitReason === 'tp' || t.exitReason === 'ambiguous_best' ? 'tp' : t.exitReason === 'sl' || t.exitReason === 'ambiguous_worst' ? 'sl' : '';
  // R from the prices (+ = win): (exit − entry) / (entry − stop), signed by side
  const risk = Math.abs(Number(t.entryPrice) - Number(t.stopLoss));
  const r = risk > 0 && t.exitPrice != null ? (t.side === 'long' ? 1 : -1) * (Number(t.exitPrice) - Number(t.entryPrice)) / risk : null;
  return (
    <div className="stack dt-sheet">
      <div className="dt-head">
        <span className={`hc-side op-badge ${t.side === 'long' ? 'b' : 's'}`}>{t.side === 'long' ? 'B' : 'S'}</span>
        <span className="op-left">
          <strong className="hc-name">{t.side === 'long' ? 'Buy' : 'Sell'}</strong>
          <span className="op-strat">{r != null ? `${Number(r) > 0 ? '+' : ''}${Number(r).toFixed(2)}R` : 'Backtest'}</span>
        </span>
        <span className="dt-pnl">
          <strong className={tone(t.pnl)}>{money(t.pnl)}</strong>
          <span className={`hc-res ${res}`}>{res ? res.toUpperCase() : (EXIT[t.exitReason] ?? t.exitReason)}</span>
        </span>
      </div>
      {opts.length > 1 ? <Seg full label="Timeframe" options={opts} value={iv as any} onChange={(v) => setIv(v)} /> : null}
      <div className="chartbox trade-review-chart">
        {!candles ? <div className="empty"><Spinner /></div>
          : candles.length ? <CandleChart candles={candles} timezone={tz} fitKey={`${t.id}-${iv}`} position={{ side: t.side, entry: t.entry, exit: t.exit, entryPrice: t.entryPrice, stopLoss: t.stopLoss, takeProfit: t.takeProfit, exitPrice: t.exitPrice }} />
          : <div className="empty">Candle untuk trade ini tidak ditemukan.</div>}
      </div>
      <div className="dt-grid">
        <span><span className="k">Entry</span><strong>{px(t.entryPrice)}</strong></span>
        <span><span className="k">Keluar</span><strong>{px(t.exitPrice)}</strong></span>
        <span><span className="k">Stop loss</span><strong className="neg">{px(t.stopLoss)}</strong></span>
        <span><span className="k">Take profit</span><strong className="pos">{px(t.takeProfit)}</strong></span>
        <span><span className="k">Dibuka</span><strong>{fmt(t.entry, tz)}</strong></span>
        <span><span className="k">Ditutup</span><strong>{t.exit ? fmt(t.exit, tz) : '—'}</strong></span>
        <span><span className="k">Durasi</span><strong>{t.exit ? hm(t.exit - t.entry) : '—'}</strong></span>
        <span><span className="k">Risiko</span><strong>{t.setupReason?.risk_usd != null ? `$${Math.round(Number(t.setupReason.risk_usd))}${t.setupReason.lot != null ? ` · ${t.setupReason.lot} lot` : ''}` : '—'}</strong></span>
      </div>
      <details className="more">
        <summary>Alasan entry & berita</summary>
        {t.setupReason?.trend ? <p className="small">{t.setupReason.trend}</p> : null}
        <p className="small">{!d.newsAtEntry.archiveAvailable ? 'Data berita tidak tersedia untuk tanggal ini.' : d.newsAtEntry.items.length
          ? d.newsAtEntry.items.map((n: any) => `${n.title} (${n.sentiment?.label ?? 'Unknown'})`).join(' · ')
          : 'Tidak ada rilis 24 jam sebelum entry.'}</p>
        <pre>{JSON.stringify(t.setupReason, null, 2)}</pre>
      </details>
    </div>
  );
}

type PairStatus = { symbol: string; label: string; years: number[]; done: number; fail: number; skip: number; state: 'wait' | 'run' | 'done'; cur?: number; note?: string; proc?: number };
// Website cleaned up (owner's choice, 7 Nov 2026): only the best gold strategy is offered and shown, named "v1 XAU"
// (= metode volbreak-v5, internal key v2). All other strategies stay in the code and their results stay in the
// database, they are only hidden (other pairs get their own best strategy later).
const STRAT_ORDER = ['metode_volbreak', 'metode_nas_donchian', 'metode_snr_sell', 'metode_crypto_donchian'];
// crypto: only v1 SNR for now (owner, 7 Nov 2026); v1 BTC / v2 ALT stay in the code
const VISIBLE_STRATEGIES = new Set(['metode volbreak-v5', 'metode nas-donchian-v1', 'metode snr-sell-v1', 'metode crypto-donchian-v1']);
const onlyVisible = (x: any) => (x?.sessions ? { ...x, sessions: x.sessions.filter((s: any) => VISIBLE_STRATEGIES.has(String(s.strategy ?? ''))) } : x);
const STRAT_LABEL: Record<string, string> = {
  ...Object.fromEntries(METHODS.map((m) => [m.adapterKey, m.label])),
  breakout_v08: 'Breakout v0.8 (v0.7 + Base H4/H1)', breakout_v07: 'Breakout v0.7 (v0.6 + Pola N H1/H4)', breakout_v06: 'Breakout v0.6 (v0.5 + candle momentum)', breakout_v05: 'Breakout v0.5 inti', breakout_v04: 'Breakout v0.4 (lebih sering trade)', breakout_v03: 'Breakout v0.3',
  ob_fvg_v1: 'Order Block + FVG (SMC)', n_pattern_v1: 'Pola N (M15, searah tren H4)', snr_break_h1_v1: 'SNR breakout H1 (tanpa tren H4)',
  rbr_dbd_v1: 'RBR / DBD (zona base H1, searah tren H4)', snr_snd_mtf_v2: 'SNR + SND v2 (strategy Pine kamu)', snr_snd_mtf_v1: 'SNR + SND v1 (indikator Pine kamu)',
  breakout_v02: 'Breakout v0.2 (hasil riset)',
};
const FORM_KEY = 'xau.backtestForm.v3';
const FORM_SAVED = ['spread', 'slippage', 'commission', 'swapLong', 'swapShort', 'risk', 'capital', 'ambiguity', 'be', 'nocost'] as const;
const yearOf = (ms: number) => new Date(ms).getUTCFullYear();

/** One strategy → every chosen pair, one year per request (sequential), RR 1:1/1:2/1:3 each. */
function RunBacktest({ onDone, bare = false, existingFor, market }: { onDone: (configKey: string) => void; bare?: boolean; existingFor: (configKey: string, symbol: string) => string[]; market: Market }) {
  const [markets, setMarkets] = useState<any[]>([]);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [f, setF] = useState({ strategy: '', tf: 'M15', y1: '', y2: '', from: '2019-01-01', to: '2020-01-01', spread: String(BROKER.spread), slippage: String(BROKER.slippage), commission: String(BROKER.commissionPerLot), swapLong: String(BROKER.swapLong), swapShort: String(BROKER.swapShort), risk: '10', capital: '1000', ambiguity: 'worst', be: 'strategy', nocost: '0' });
  const noCost = f.nocost === '1';
  const crypto = market === 'crypto';   // crypto pairs use the fixed Binance Futures costs (instruments.ts); the editable fields are Exness (forex/gold)
  // Remember costs / risk / capital in this browser (convenience only; falls back to defaults if storage is unavailable).
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(FORM_KEY) ?? 'null');
      // old website defaults (average broker, before 2 Nov 2026) → replaced by the owner's Exness Raw Spread costs
      if (v && v.commission === '5' && v.swapLong === '67' && v.swapShort === '-25') { delete v.commission; delete v.swapLong; delete v.swapShort; }
      if (v && typeof v === 'object') setF((cur) => ({ ...cur, ...Object.fromEntries(FORM_SAVED.filter((k) => typeof v[k] === 'string').map((k) => [k, v[k]])) }));
    } catch { /* ignore */ }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(FORM_KEY, JSON.stringify(Object.fromEntries(FORM_SAVED.map((k) => [k, (f as any)[k]])))); } catch { /* ignore */ }
  }, [f]);
  const [sel, setSel] = useState<string[] | null>(null); // null = all pairs
  const [custom, setCustom] = useState(false);
  const [skipDone, setSkipDone] = useState(true);
  const [busy, setBusy] = useState(false);
  const loadSequence = useRef(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [prog, setProg] = useState<PairStatus[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const stop = useRef(false);
  useEffect(() => {
    call<any[]>('/api/markets').then(setMarkets).catch((e) => setErr(e.message));
    call<any[]>('/api/strategies').then((s) => {
      const usable = s.filter((x: any) => x.configured && !x.testOnly && x.status === 'active' && STRAT_ORDER.includes(x.adapter_key) && marketOfAdapter(x.adapter_key) === market)
        .sort((a: any, b: any) => STRAT_ORDER.indexOf(a.adapter_key) - STRAT_ORDER.indexOf(b.adapter_key));
      setStrategies(usable);
      setSel(null);
      if (usable[0]) setF((x) => ({ ...x, strategy: usable.some((u: any) => u.id === x.strategy) ? x.strategy : usable[0].id }));
    }).catch(() => {});
  }, [market]);
  const strat = strategies.find((x: any) => x.id === f.strategy);
  const baseTf: string = (strat && methodByKey(strat.adapter_key)?.baseTf) || 'M15';   // the strategy decides its own base timeframe
  const sets = markets.filter((m) => m.tf === baseTf && m.source_id && marketOfSymbol(m.symbol) === market);
  const chosen = sets.filter((m) => sel == null || sel.includes(m.symbol));
  // each strategy starts with its own pair(s) selected (v1 XAU → XAUUSD, v1 NAS → US100); the user can still pick others
  const stratPairs: string[] | null = (strat ? methodByKey(String(strat.adapter_key))?.pairs : undefined) ?? null;
  useEffect(() => {
    if (!stratPairs || !sets.length) return;
    const ok = stratPairs.filter((x: string) => sets.some((m: any) => m.symbol === x));
    if (ok.length) setSel(ok.length === sets.length ? null : ok);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.strategy, sets.length]);
  const firstY = chosen.length ? Math.min(...chosen.map((m) => yearOf(m.first))) : 2018;
  const lastY = chosen.length ? Math.max(...chosen.map((m) => yearOf(m.last))) : new Date().getUTCFullYear();
  const years = Array.from({ length: Math.max(0, lastY - firstY + 1) }, (_, i) => firstY + i);
  const y1 = Math.max(Number(f.y1) || firstY, firstY), y2 = Math.min(Number(f.y2) || lastY, lastY);
  const list = years.filter((y) => y >= y1 && y <= y2);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const params: Record<string, boolean> = {};
  const cfgKey = `${strat ? `${strat.strategy_key} ${strat.version}` : '?'}|${Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join(',')}${baseTf !== 'M15' ? `|${baseTf}` : ''}${noCost || crypto ? '' : swapTag(Number(f.swapLong) || 0, Number(f.swapShort) || 0)}${optTag(f.be, noCost)}`;
  const yearsFor = (m: any) => list.filter((y) => y >= yearOf(m.first) && y <= yearOf(m.last));
  const togglePair = (sym: string) => setSel((cur) => {
    const base = cur ?? sets.map((m) => m.symbol);
    const next = base.includes(sym) ? base.filter((x) => x !== sym) : [...base, sym];
    return next.length === sets.length ? null : next;
  });
  const body = (m: any, from: string, to: string) => ({ params,
    source_id: m.source_id, strategy_version_id: f.strategy || null, from, to, rr: [1, 2, 3], risk_usd: f.risk.trim() ? Number(f.risk) : null, capital: f.capital.trim() ? Number(f.capital) : null,
    costs: { spread: Number(f.spread), slippage: Number(f.slippage), commissionPerUnit: Number(f.commission), swapLong: Number(f.swapLong) || 0, swapShort: Number(f.swapShort) || 0, ambiguityPolicy: f.ambiguity },
    breakeven: f.be, no_costs: noCost,
  });

  const run = async () => {
    setBusy(true); setErr(null); stop.current = false;
    const st: PairStatus[] = chosen.map((m) => {
      const ys = custom ? [0] : yearsFor(m);
      const have = existingFor(cfgKey, m.symbol);
      const todo = custom ? ys : ys.filter((y) => !(skipDone && have.includes(String(y))));
      return { symbol: m.symbol, label: m.label, years: todo, done: 0, fail: 0, skip: ys.length - todo.length, state: 'wait' };
    });
    setProg(st.map((x) => ({ ...x })));
    // 4 pairs at a time (each pair's years stay in order) — many-coin crypto runs were too slow one request at a time
    const queue = [...st];
    const worker = async () => { for (let p = queue.shift(); p; p = queue.shift()) await runPair(p); };
    const runPair = async (p: PairStatus) => {
      const m = chosen.find((x) => x.symbol === p.symbol)!;
      if (stop.current) return;
      p.state = 'run';
      for (const y of p.years) {
        if (stop.current) break;
        p.cur = y; setProg(st.map((x) => ({ ...x })));
        try {
          await call<any>('/api/backtest/run', { method: 'POST', json: custom ? body(m, `${f.from}T00:00:00Z`, `${f.to}T00:00:00Z`) : body(m, `${y}-01-01T00:00:00Z`, `${y + 1}-01-01T00:00:00Z`) });
          p.done++;
        } catch (e) {
          const msg = (e as Error).message;
          if (/Tidak ada candle/.test(msg)) p.skip++; else { p.fail++; p.note = msg; }
        }
        p.proc = (p.proc ?? 0) + 1;
      }
      p.cur = undefined; p.state = 'done'; setProg(st.map((x) => ({ ...x })));
    };
    await Promise.all(Array.from({ length: Math.min(4, st.length) }, worker));
    setBusy(false);
    onDone(cfgKey);
  };
  const total = prog?.reduce((a, p) => a + p.years.length, 0) ?? 0;
  const finished = prog?.reduce((a, p) => a + (p.proc ?? 0), 0) ?? 0;
  const allSel = sel == null;

  return (
    <section className={bare ? 'stack' : 'group stack'}>
      <SecHead title="Jalankan backtest" meta="RR 1:1 · 1:2 · 1:3" />
      <div className="form-sec">
      <h3><span className="n">1</span>Strategi</h3>
      {strategies.length ? (
        <label className="field"><span className="sr-only">Strategi</span><select value={f.strategy} onChange={set('strategy')} aria-label="Strategi">
          {strategies.map((s) => <option key={s.id} value={s.id}>{STRAT_LABEL[s.adapter_key] ?? `${s.strategy_key} ${s.version}`}</option>)}
        </select></label>
      ) : <Loading what="strategi" variant="list" />}
      </div>
      <div className="form-sec">
        <div className="row between"><h3><span className="n">2</span>Pair <span className="mute" style={{ fontWeight: 400 }}>{chosen.length}/{sets.length}</span></h3>
          <button className="btn sm ghost" onClick={() => setSel(allSel ? [] : null)}>{allSel ? 'Kosongkan' : 'Pilih semua'}</button></div>
        <div className="chips wide">
          {sets.map((m) => (
            <button key={m.symbol} className="chip" aria-pressed={allSel || (sel ?? []).includes(m.symbol)} onClick={() => togglePair(m.symbol)}>
              <span className="k">{m.label.replace(/ \(.*\)$/, '')}</span><span className="v">{yearOf(m.first)}–{yearOf(m.last)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="form-sec">
      <h3><span className="n">3</span>Periode</h3>
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
      <label className="switch">Lewati tahun yang sudah ada hasilnya<input type="checkbox" checked={skipDone} onChange={(e) => setSkipDone(e.target.checked)} /></label>
      </div>
      <div className="form-sec">
      <h3><span className="n">4</span>Modal & risiko</h3>
      <div className="grid two">
        <label className="field">Modal awal ($)<input inputMode="decimal" value={f.capital} onChange={set('capital')} placeholder="1000" /></label>
        <label className="field">Risiko per trade ($)<input inputMode="decimal" value={f.risk} onChange={set('risk')} placeholder="10" /></label>
      </div>
      </div>
      <div className="form-sec">
      <h3><span className="n">5</span>Aturan trade</h3>
      <div className="picker"><span className="label">Pindah SL ke entry setelah +1R</span>
        <Seg full label="SL ke entry" options={[['strategy', 'Bawaan'], ['on', 'Ya'], ['off', 'Tidak']] as const} value={f.be as 'strategy' | 'on' | 'off'} onChange={(v) => setF((x) => ({ ...x, be: v }))} /></div>
      <label className="switch">{crypto ? 'Tanpa biaya (fee, slippage, funding = 0)' : 'Tanpa biaya (spread, komisi, swap = 0)'}<input type="checkbox" checked={noCost} onChange={(e) => setF((x) => ({ ...x, nocost: e.target.checked ? '1' : '0' }))} /></label>
      <details className="more">
        <summary>{noCost ? 'Lainnya' : 'Biaya & lainnya'}</summary>
        {!noCost && crypto ? <p className="mute small">Biaya Binance Futures (tetap, sama untuk semua koin): fee taker 0,05% per sisi + slippage ≈ 0,12% pulang-pergi dari nilai posisi; funding BUY ±0,03% per hari selama posisi terbuka (SELL tidak dihitung).</p> : null}
        {!noCost && !crypto ? <p className="mute small">Default = akun {BROKER.name} kamu: komisi ${BROKER.commissionPerLot}/lot (buka + tutup), swap BUY ${BROKER.swapLong} / SELL ${BROKER.swapShort} per lot per malam (Rabu ×3). Spread {BROKER.spread} sampai diukur di akunmu. <button type="button" className="btn sm ghost" onClick={() => setF((x) => ({ ...x, spread: String(BROKER.spread), slippage: String(BROKER.slippage), commission: String(BROKER.commissionPerLot), swapLong: String(BROKER.swapLong), swapShort: String(BROKER.swapShort) }))}>Pakai biaya Exness</button></p> : null}
        <label className="switch">Pakai rentang tanggal sendiri<input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /></label>
        <div className="grid two">
          {!noCost && !crypto ? <>
          <label className="field">Spread ($)<input inputMode="decimal" value={f.spread} onChange={set('spread')} /></label>
          <label className="field">Slippage ($)<input inputMode="decimal" value={f.slippage} onChange={set('slippage')} /></label>
          <label className="field">Komisi per lot ($)<input inputMode="decimal" value={f.commission} onChange={set('commission')} /></label>
          <label className="field">Swap BUY per lot per malam ($, + bayar · − dapat)<input inputMode="decimal" value={f.swapLong} onChange={set('swapLong')} /></label>
          <label className="field">Swap SELL per lot per malam ($, + bayar · − dapat)<input inputMode="decimal" value={f.swapShort} onChange={set('swapShort')} /></label>
          </> : null}
          <label className="field">TP & SL kena di 1 candle<select value={f.ambiguity} onChange={set('ambiguity')}><option value="worst">Hitung sebagai SL</option><option value="best">Hitung sebagai TP</option><option value="skip">Lewati</option></select></label>
        </div>
      </details>
      </div>
      {!sets.length ? <div className="notice">{markets.length ? 'Data belum siap.' : 'Memuat daftar pair…'}</div> : null}
      {busy
        ? <button className="btn block" onClick={() => { stop.current = true; }}><Spinner />Berhenti setelah tahun ini</button>
        : <button className="btn primary block" onClick={run} disabled={!f.strategy || !chosen.length || (!custom && !list.length)}>
            {custom ? `Jalankan ${chosen.length} pair` : `Jalankan ${chosen.length} pair · ${y1 === y2 ? y1 : `${y1}–${y2}`}`}
          </button>}
      {err ? <div className="error">{err}</div> : null}
      {prog ? (
        <div className="stack tight appear" role="status" aria-live="polite">
          <div className="row between small"><strong className={busy ? '' : 'pos'}>{busy ? 'Sedang berjalan… biarkan halaman ini terbuka' : '✓ Selesai'}</strong><span className="mute num">{finished}/{total} tahun</span></div>
          <div className="wlbar progress" aria-hidden><span style={{ width: `${(finished / Math.max(1, total)) * 100}%` }} /></div>
          <div className="list">
            {prog.map((p) => (
              <div key={p.symbol} className="item">
                <span className="t">{p.label}</span>
                <span className={`end small ${p.fail ? 'neg' : p.state === 'done' ? 'pos' : 'mute'}`} style={{ flex: '1 1 auto', minWidth: 0 }}>
                  {p.state === 'wait' ? (p.years.length ? `Menunggu · ${p.years.length} tahun` : 'Sudah ada, dilewati')
                    : p.state === 'run' ? `Menghitung ${custom ? '' : p.cur ?? ''}… ${p.done}/${p.years.length}`
                    : `✓ ${p.done} tahun${p.skip ? ` · ${p.skip} dilewati` : ''}${p.fail ? ` · ${p.fail} gagal: ${p.note}` : ''}`}
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
  const loadSequence = useRef(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
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

/* ---------------------------------------------------------------- delete many results at once */
function DeleteAll({ sessions, current, currentLabel, onDeleted }: { sessions: any[]; current: any[]; currentLabel: string; onDeleted: () => void }) {
  const [ask, setAsk] = useState<'current' | 'all' | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSequence = useRef(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const del = async (list: any[]) => {
    setBusy(true); setErr(null);
    try {
      const ids = list.map((s) => String(s.id));
      for (let i = 0; i < ids.length; i += 500) await call('/api/backtest/sessions', { method: 'DELETE', json: { ids: ids.slice(i, i + 500) } });
      setAsk(null); onDeleted();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const target = ask === 'all' ? sessions : current;
  return (
    <div className="stack tight">
      {ask ? (
        <div className="error stack tight">
          <strong>Hapus {target.length} hasil {ask === 'all' ? 'dari SEMUA strategi' : `"${currentLabel}"`}?</strong>
          <span>Trade dan sinyal backtest-nya ikut terhapus. Tidak bisa dibatalkan. Data harga tidak terhapus.</span>
          <div className="row">
            <button className="btn sm" onClick={() => setAsk(null)} disabled={busy}>Batal</button>
            <button className="btn sm danger" onClick={() => del(target)} disabled={busy}>{busy ? 'Menghapus…' : 'Ya, hapus'}</button>
          </div>
        </div>
      ) : (
        <div className="row">
          {current.length && current.length < sessions.length ? <button className="btn sm" onClick={() => setAsk('current')}>Hapus semua hasil strategi ini</button> : null}
          <button className="btn sm" onClick={() => setAsk('all')}>Hapus semua hasil ({sessions.length})</button>
        </div>
      )}
      {err ? <div className="error">{err}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- strategy configurations (strategy + switches) */
const PART: Record<string, string> = { donchianH1: 'H1', london: 'London', newYork: 'New York', donchianM30: 'M30' };
function paramsOf(s: any): Record<string, boolean> { return (s.cost_config?.strategy_params ?? {}) as Record<string, boolean>; }
const dataTf = (s: any) => String(s.cost_config?.data_tf ?? 'M15');
const symOf = (s: any) => String(s.symbol ?? s.cost_config?.symbol ?? 'XAUUSD');
function configKey(s: any) {
  const p = paramsOf(s);
  return `${s.strategy ?? '?'}|${Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join(',')}${dataTf(s) !== 'M15' ? `|${dataTf(s)}` : ''}${swapTag(s.cost_config?.swapLong, s.cost_config?.swapShort)}${optTag(s.cost_config?.breakeven_mode, s.cost_config?.no_costs === true)}`;
}
/** Runs with SL → entry forced on/off, or without costs, are their own result set too. */
function optTag(be: unknown, noCost: boolean) { return `${be === 'on' ? '|be on' : be === 'off' ? '|be off' : ''}${noCost ? '|tanpa biaya' : ''}`; }
/** Runs with swap are a separate result set (so they never mix with no-swap years). */
function swapTag(a: unknown, b: unknown) { const x = Number(a) || 0, y = Number(b) || 0; return x || y ? `|swap ${x}/${y}` : ''; }
function configLabel(s: any) {
  const base = configLabelBase(s);
  const x = Number(s.cost_config?.swapLong) || 0, y = Number(s.cost_config?.swapShort) || 0;
  const sw = x || y ? ` · swap $${x}/$${y}` : '';
  const be = s.cost_config?.breakeven_mode === 'on' ? ' · SL→entry' : s.cost_config?.breakeven_mode === 'off' ? ' · tanpa SL→entry' : '';
  const nc = s.cost_config?.no_costs === true ? ' · tanpa biaya' : '';
  return (dataTf(s) !== 'M15' ? `${base} · data ${dataTf(s)}` : base) + sw + be + nc;
}
function configLabelBase(s: any) {
  const strat = String(s.strategy ?? 'strategi');
  const mm = methodByStrategy(strat);
  if (mm) return mm.label;
  if (strat === 'pola_n v1') return 'Pola N (M15, searah tren H4)';
  if (strat === 'ob_fvg v1') return 'Order Block + FVG (SMC)';
  if (strat === 'breakout v0.8') return 'Breakout v0.8 (v0.7 + Base H4/H1)';
  if (strat === 'breakout v0.7') return 'Breakout v0.7 (v0.6 + Pola N)';
  if (strat === 'breakout v0.6') return 'Breakout v0.6 (v0.5 + momentum)';
  if (strat === 'breakout v0.5') return 'Breakout v0.5 inti (H1 + NY + level)';
  if (strat === 'breakout v0.4') return 'Breakout v0.4 (v0.3 + level 2–3×)';
  if (strat === 'breakout v0.3') return 'Breakout v0.3 (H1+London+NY+M30)';
  if (strat === 'snr_break h1-v1') return 'SNR breakout H1 (tanpa tren H4)';
  if (strat === 'rbr_dbd v1') return 'RBR / DBD (zona base H1, searah tren H4)';
  if (strat === 'snr_snd_tv v2') return 'SNR + SND v2 (strategy Pine kamu)';
  if (strat === 'snr_snd_tv v1') return 'SNR + SND v1 (indikator Pine kamu)';
  if (strat.startsWith('custom ')) return strat.slice(7);
  if (!strat.startsWith('breakout')) return strat === 'snr h4h1m15-v0.1' ? 'SNR v0.1 (sentuh zona)' : strat;
  const p = { donchianH1: true, london: true, newYork: true, donchianM30: false, allowBuy: true, allowSell: true, ...paramsOf(s) };
  const parts = Object.entries(PART).filter(([k]) => (p as any)[k]).map(([, v]) => v).join(' + ');
  const sides = p.allowBuy && p.allowSell ? 'BUY+SELL' : p.allowBuy ? 'BUY saja' : 'SELL saja';
  return `Breakout v0.2 · ${parts} · ${sides}`;
}
function strategyConfigs(sessions: any[]) {
  const m = new Map<string, { key: string; label: string; created: number }>();
  for (const s of sessions) {
    const k = configKey(s);
    const c = Number(s.created_ms) || 0;
    const cur = m.get(k);
    if (!cur || c > cur.created) m.set(k, { key: k, label: configLabel(s), created: c });
  }
  return [...m.values()].sort((a, b) => b.created - a.created);
}

/* ---------------------------------------------------------------- one row per pair (all years, chosen RR) */
interface PairSum { symbol: string; label: string; pnl: number; trades: number; wins: number; years: number; first: string | null; last: string | null }
function pairSummaries(sessions: any[], rr: number): PairSum[] {
  const syms = [...new Set(sessions.map(symOf))];
  const order = (s: string) => { const i = INSTRUMENTS.findIndex((x) => x.symbol === s); return i < 0 ? 99 : i; };
  return syms.map((sym) => {
    const rows = yearRows(sessions.filter((s) => symOf(s) === sym));
    const cells = rows.map((r) => r.cells.find((c: any) => rrNum(c) === rr)).filter(Boolean);
    const labels = rows.map((r) => r.label).sort();
    return { symbol: sym, label: instrumentLabel(sym), years: rows.length, first: labels[0] ?? null, last: labels[labels.length - 1] ?? null,
      pnl: cells.reduce((a: number, c: any) => a + Number(c.pnl ?? 0), 0), trades: cells.reduce((a: number, c: any) => a + Number(c.trades ?? 0), 0),
      wins: cells.reduce((a: number, c: any) => a + Number(c.wins ?? 0), 0) };
  }).sort((a, b) => b.pnl - a.pnl || order(a.symbol) - order(b.symbol));
}
function PairTable({ pairs, selected, rr, onPick }: { pairs: PairSum[]; selected: string | null; rr: number; onPick: (sym: string) => void }) {
  const max = Math.max(1, ...pairs.map((p) => Math.abs(p.pnl)));
  const total = pairs.reduce((a, p) => a + p.pnl, 0);
  const plus = pairs.filter((p) => p.pnl > 0).length;
  return (
    <div className="stack tight">
      <div className="row between"><span className="label">Hasil per pair · RR 1:{rr} · semua tahun</span>
        <span className={`small ${total > 0 ? 'pos' : total < 0 ? 'neg' : 'mute'}`}><strong>{plus}/{pairs.length} untung</strong></span></div>
      <div className="pairs" role="list">
        {pairs.map((p, i) => (
          <button key={p.symbol} role="listitem" className={`pairrow ${p.pnl > 0 ? 'up' : p.pnl < 0 ? 'down' : ''}`} aria-pressed={p.symbol === selected} onClick={() => onPick(p.symbol)}>
            <span className="rank">{i + 1}</span>
            <span className="nm"><strong>{p.label}</strong><span className="mute small">{p.trades} trade · win {p.trades ? Math.round((p.wins / p.trades) * 100) : 0}% · {p.years} th</span></span>
            <span className="pl">
              <span className="v">{`${p.pnl > 0 ? '+' : p.pnl < 0 ? '−' : ''}$${Math.round(Math.abs(p.pnl)).toLocaleString('en-US')}`}</span>
              <span className="bar" aria-hidden><span style={{ width: `${(Math.abs(p.pnl) / max) * 100}%` }} /></span>
            </span>
          </button>
        ))}
      </div>
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


/** Capital growth from the backtest trades: fixed $ risk per trade (as simulated), scaled to the risk the owner types here. */
function CapitalGrowth({ trades, tz, baseRisk, startCapital, months }: { trades: ClosedTrade[]; tz: string; baseRisk: number | null; startCapital: number | null; months: number }) {
  const [cap, setCap] = useState(String(startCapital ?? 1000));
  const [risk, setRisk] = useState(String(baseRisk ?? 10));
  const c0 = Number(cap.replace(',', '.')), r = Number(risk.replace(',', '.'));
  if (!trades.length) return null;
  const ok = c0 > 0 && r > 0 && !!baseRisk;
  const chart = (
    <section className="group stack">
      <SecHead title="Grafik saldo" meta={`${trades.length} trade`} />
      <EquityChart trades={trades} tz={tz} start={ok ? c0 : 0} scale={ok ? r / baseRisk! : 1} />
    </section>
  );
  const k = ok ? r / baseRisk! : 1;
  const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
  const usd = (x: number) => `${x < 0 ? '−' : ''}$${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  let eq = c0, peak = c0, ddPct = 0, ddUsd = 0;
  const years = new Map<number, { start: number; pnl: number; n: number }>();
  for (const t of trades) {
    const y = new Date(t.exit).getUTCFullYear();
    if (!years.has(y)) years.set(y, { start: eq, pnl: 0, n: 0 });
    const p = t.pnl * k; eq += p;
    const row = years.get(y)!; row.pnl += p; row.n++;
    if (eq > peak) peak = eq;
    if (peak - eq > ddUsd) { ddUsd = peak - eq; ddPct = (peak - eq) / peak * 100; }
  }
  const total = eq - c0, rows = [...years.entries()].sort((a, b) => a[0] - b[0]);
  const nYears = Math.max(1, (trades[trades.length - 1].exit - trades[0].entry) / (365.25 * 86_400_000));
  return (<>
    {chart}
    <section className="group stack">
      <SecHead title="Perkembangan modal" />
      <div className="grid two">
        <label className="field">Modal awal ($)<input id="cg-capital" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
        <label className="field">Risiko per trade ($)<input id="cg-risk" inputMode="decimal" value={risk} onChange={(e) => setRisk(e.target.value)} /></label>
      </div>
      {!baseRisk ? <p className="mute small">Backtest ini memakai lot tetap, jadi perkembangan modal tidak bisa dihitung ulang.</p> : !ok ? <p className="mute small">Isi modal dan risiko lebih dari 0.</p> : <>
        <div className="facts" style={{ marginTop: 0 }}>
          <div><span className="label">Modal akhir</span><strong className={total >= 0 ? 'pos' : 'neg'}>{usd(eq)}</strong></div>
          <div><span className="label">Kenaikan modal</span><strong className={total >= 0 ? 'pos' : 'neg'}>{pct(total / c0 * 100)}</strong></div>
          {months > 0 ? <div><span className="label">Rata-rata per bulan</span><strong className={total >= 0 ? 'pos' : 'neg'}>{money(total / months)} ({pct(total / c0 * 100 / months)})</strong></div> : null}
          <div><span className="label">Rata-rata per tahun</span><strong className={total >= 0 ? 'pos' : 'neg'}>{pct(total / c0 * 100 / nYears)}</strong></div>
          <div><span className="label">Turun terdalam</span><strong className="neg">−{ddPct.toLocaleString('id-ID', { maximumFractionDigits: 1 })}% ({usd(ddUsd)})</strong></div>
        </div>
        <div className="tablewrap" style={{ overflowX: 'auto' }}>
          <table className="tbl num-r"><thead><tr><th>Tahun</th><th>Trade</th><th>Modal awal tahun</th><th>Untung/rugi</th><th>% tahun itu</th></tr></thead>
            <tbody>{rows.map(([y, v]) => (
              <tr key={y}><td>{y}</td><td>{v.n}</td><td>{usd(v.start)}</td><td className={v.pnl >= 0 ? 'pos' : 'neg'}>{v.pnl >= 0 ? '+' : ''}{usd(v.pnl)}</td><td className={v.pnl >= 0 ? 'pos' : 'neg'}>{pct(v.pnl / v.start * 100)}</td></tr>
            ))}</tbody></table>
        </div>
      </>}
    </section>
  </>);
}
