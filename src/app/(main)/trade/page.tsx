'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, fmt, peek, px } from '@/components/client';
import { ErrorBox, Loading, PageHead, SecHead, Seg, Sheet, Spinner, toast } from '@/components/Status';
import Link from 'next/link';
import { MarketSwitch, useMarket } from '@/components/MarketSwitch';
import { JOURNAL_KEYS, marketOfJournal } from '@/lib/core/markets';
import { liveSignalFrom, lotFor, type JournalTrade, type JournalStats } from '@/lib/core/journal';
import TradeDashboard, { type CashFlow } from '@/components/TradeDashboard';
import LiveTradeChart from '@/components/LiveTradeChart';

/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`);
const tone = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
// Backtest reference (Exness Raw Spread costs + swap, 2004–2026, RR 1:2): what live results should be compared with.
// Internal journal key 'v2' = "v1 XAU" (volbreak-v5); 'v1' / 'v3' are older strategies, kept only for old journal rows.
const BT: Record<string, { win: number; perMonth: number; label: string }> = {
  v2: { win: 0.342, perMonth: 5.0, label: 'v1 XAU' },   // + ±15% impas (BE)
  nas: { win: 0.431, perMonth: 5.6, label: 'v1 NAS' },  // website engine M30 2013–2026
  btc: { win: 0.41, perMonth: 5.7, label: 'v1 BTC' },  // bot BUY part: 6 largest coins, max 2 open (research 9 Nov 2026), Binance costs
  alt: { win: 0.467, perMonth: 17.8, label: 'v2 ALT' },  // research portfolio (max 3 positions) 2020–2026
  snr: { win: 0.42, perMonth: 52.5, label: 'v1 SNR' },  // research portfolio (max 3 positions) 2020–2026
};
const NAME: Record<string, string> = { v2: 'v1 XAU', nas: 'v1 NAS', btc: 'v1 BTC', alt: 'v2 ALT', snr: 'v1 SNR', v1: 'v1 Level (lama)', v3: 'v3 BOS (lama)', lain: 'lain', all: 'Semua' };
interface Draft { strategy: string; side: 'BUY' | 'SELL'; entry: string; sl: string; tp: string; lot: string; note: string }
const EMPTY: Draft = { strategy: 'v2', side: 'BUY', entry: '', sl: '', tp: '', lot: '', note: '' };
// coin of a bot trade: the note is "Bot Binance SANDUSDT …"
const coinOf = (t: JournalTrade) => (/Bot Binance ([0-9A-Z]+)/.exec(t.note ?? '')?.[1] ?? '').replace(/USDT$/, '');
const RESULT: Record<string, string> = { tp: 'TP', sl: 'SL', be: 'Impas', manual: 'Manual' };

export default function TradePage() {
  const [d, setD] = useState<any>(() => peek('/api/live'));
  const [j, setJRaw] = useState<{ trades: JournalTrade[]; stats: Record<string, JournalStats>; binance?: { wallet: number; upnl: number; at: number } | null; mt5?: { wallet: number; upnl: number; at: number } | null; cashflow?: { crypto: CashFlow[]; forex: CashFlow[] } } | null>(() => peek('/api/journal'));
  // edits return the journal without the Binance balance: keep the last one
  const setJ = (v: any) => setJRaw((old) => (v && v.binance === undefined && old ? { ...v, binance: old.binance, mt5: old.mt5, cashflow: old.cashflow } : v));
  const [err, setErr] = useState<string | null>(null);
  const [market, setMarket] = useMarket();
  // history list: same look as the backtest trade list (hidden until opened, 10 at a time, tap a row for the detail sheet)
  const [showHist, setShowHist] = useState(false);
  const [histKind, setHistKind] = useState<'all' | 'pos' | 'cf'>('all');
  const [histLimit, setHistLimit] = useState(10);
  const [detail, setDetail] = useState<JournalTrade | null>(null);
  const load = useCallback(() => {
    setErr(null);
    call<any>('/api/live').then(setD).catch((e) => setErr(e.message));
    call<any>('/api/journal').then(setJ).catch((e) => setErr(e.message));
  }, []);
  // refresh every 30 s while the page is visible (balance / trades stay current)
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000); return () => clearInterval(t); }, [load]);

  const riskUsd = d?.risk ? (d.risk.capital * d.risk.riskPct) / 100 : NaN;

  // journal form
  const [draft, setDraft] = useState<Draft | null>(null);
  const [jErr, setJErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const openDraft = (x: Partial<Draft>) => { setJErr(null); setDraft({ ...EMPTY, ...x }); setTimeout(() => document.getElementById('jurnal')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const submit = async () => {
    if (!draft) return;
    setJErr(null); setSaving(true);
    try {
      const r = await call<any>('/api/journal', { method: 'POST', json: { ...draft, entry: num(draft.entry), sl: num(draft.sl), tp: num(draft.tp), lot: num(draft.lot), openedAt: Date.now(), result: 'open' } });
      setJ(r); setDraft(null); toast('Trade tersimpan');
    } catch (e) { setJErr((e as Error).message); } finally { setSaving(false); }
  };
  const close = async (t: JournalTrade, result: 'tp' | 'sl' | 'be' | 'manual') => {
    let exit: number | undefined;
    if (result === 'manual') {
      const v = window.prompt('Harga keluar?', String(t.entry));
      if (v == null) return;
      exit = num(v);
    }
    setBusyId(t.id);
    try { setJ(await call<any>('/api/journal', { method: 'PUT', json: { id: t.id, result, exit, closedAt: Date.now() } })); toast('Posisi ditutup'); }
    catch (e) { setJErr((e as Error).message); } finally { setBusyId(null); }
  };
  // correct a closed trade by hand (e.g. the broker shows TP but the bot reported it wrongly)
  const fix = async (t: JournalTrade) => {
    const r = window.prompt('Hasil sebenarnya? Ketik: tp, sl, be, atau manual', t.result === 'open' ? 'tp' : t.result);
    if (r == null) return;
    const result = r.trim().toLowerCase();
    if (!['tp', 'sl', 'be', 'manual'].includes(result)) { setJErr('Hasil harus tp, sl, be, atau manual'); return; }
    const en = window.prompt('Harga masuk (lihat di Binance / MT5)?', String(t.entry));
    if (en == null) return;
    const ex = window.prompt('Harga keluar (lihat di Binance / MT5)?', String(t.exit ?? t.entry));
    if (ex == null) return;
    const pl = window.prompt('Untung/rugi bersih dalam $ (pakai minus untuk rugi)?', t.pnl == null ? '' : String(t.pnl));
    if (pl == null) return;
    try { setJ(await call<any>('/api/journal', { method: 'PUT', json: { id: t.id, result, entry: num(en), exit: num(ex), pnl: num(pl), closedAt: t.closedAt ?? Date.now() } })); toast('Trade dikoreksi'); }
    catch (e) { setJErr((e as Error).message); }
  };
  const remove = async (t: JournalTrade) => {
    if (!window.confirm('Hapus trade ini dari jurnal?')) return;
    try { setJ(await call<any>(`/api/journal?id=${t.id}`, { method: 'DELETE' })); toast('Trade dihapus'); } catch (e) { setJErr((e as Error).message); }
  };

  if (err && !d) return <><PageHead title="Trade" /><ErrorBox error={err} retry={load} /></>;
  if (!d || !j) return <><PageHead title="Trade" /><Loading /></>;
  const tz = d.timezone;
  const signals = (d.events as any[]).map((e) => ({ e, s: liveSignalFrom(e.extra, e.price) })).filter((x) => x.s);
  // only the chosen market's journal (Forex: v1 XAU, v1 NAS · Crypto: v1 BTC, v1 ALT; 'lain' shows in both)
  const inMarket = (t: JournalTrade) => { const m = marketOfJournal(t.strategy); return m === 'both' || m === market; };
  const openT = j.trades.filter((t) => t.result === 'open' && inMarket(t));
  const closedT = j.trades.filter((t) => t.result !== 'open' && inMarket(t));
  const stratOf = (label: string) => (/^v1 ?snr|snr-sell/i.test(label) ? 'snr' : /^v[12] ?alt|alt-breakdown/i.test(label) ? 'alt' : /^v1 ?btc|crypto-donchian/i.test(label) ? 'btc' : /^v1 ?nas|nas-donchian/i.test(label) ? 'nas' : /^v1 ?xau|^v2\b|volbreak/i.test(label) ? 'v2' : 'lain');

  // history card in the style of Binance "Riwayat Posisi", simplified: coin, side, result, P&L, entry → exit, opened / closed, duration
  const holdTxt = (ms: number) => { const m = Math.round(ms / 60_000); return m < 60 ? `${m} mnt` : m < 2880 ? `${Math.floor(m / 60)} jam ${m % 60} mnt` : `${(m / 1440).toFixed(1)} hari`; };
  const tradeRow = (t: JournalTrade) => (
    <button key={t.id} className="hcard" onClick={() => setDetail(t)}>
      <span className="hc-top">
        <span className={`hc-side ${t.side === 'BUY' ? 'b' : 's'}`}>{t.side === 'BUY' ? 'B' : 'S'}</span>
        <strong className="hc-name">{coinOf(t) || (NAME[t.strategy] ?? t.strategy)}</strong>
        <span className="hc-tag">{coinOf(t) ? NAME[t.strategy] ?? t.strategy : t.side}</span>
        <span className={`hc-res ${t.result}`}>{RESULT[t.result] ?? 'Manual'}</span>
      </span>
      <span className="hc-mid">
        <span><span className="k">PNL</span><strong className={tone(t.pnl)}>{money(t.pnl)}</strong></span>
        <span><span className="k">Masuk</span><strong>{px(t.entry)}</strong></span>
        <span><span className="k">Keluar</span><strong>{t.exit != null ? px(t.exit) : '—'}</strong></span>
      </span>
      <span className="hc-foot">
        <span>{t.closedAt ? holdTxt(t.closedAt - t.openedAt) : 'masih terbuka'}</span>
      </span>
    </button>
  );
  // deposit / withdrawal / Spot transfer card (Binance "Riwayat Transfer" style)
  const flowsAll: CashFlow[] = (market === 'crypto' ? j.cashflow?.crypto : j.cashflow?.forex) ?? [];
  const firstAt = j.trades.filter(inMarket).reduce((m, t) => Math.min(m, t.openedAt), Infinity);
  const flowRow = (c: CashFlow) => {
    const inn = c.amount > 0, old = Number.isFinite(firstAt) && c.at <= firstAt;
    return (
      <div key={`cf-${c.id}`} className={`hcard cfcard${old ? ' is-old' : ''}`}>
        <span className="hc-top">
          <span className={`cf-ic ${inn ? 'in' : 'out'}`} aria-hidden>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{inn ? <path d="M12 5v14M5 12l7 7 7-7" /> : <path d="M12 19V5M5 12l7-7 7 7" />}</svg>
          </span>
          <span className="cf-title">
            <strong>{market === 'crypto' ? (inn ? 'Transfer masuk' : 'Transfer keluar') : (inn ? 'Deposit' : 'Penarikan')}</strong>
            <span className="cf-route">{market === 'crypto' ? (inn ? 'Spot → Futures' : 'Futures → Spot') : 'Akun MT5'}</span>
          </span>
          <span className={`cf-amt ${inn ? 'pos' : 'neg'}`}>{inn ? '+' : '−'}{Math.abs(c.amount).toFixed(2)}<small>{c.asset}</small></span>
        </span>
        <span className="hc-foot">
          <span>{fmt(c.at, tz)}</span>
          <span className="cf-ok">{old ? 'Termasuk saldo awal' : 'Selesai'}</span>
        </span>
      </div>
    );
  };
  const histItems = [
    ...(histKind === 'cf' ? [] : closedT.map((t) => ({ at: t.closedAt ?? t.openedAt, el: tradeRow(t) }))),
    ...(histKind === 'pos' ? [] : flowsAll.map((c) => ({ at: c.at, el: flowRow(c) }))),
  ].sort((a, b) => b.at - a.at);
  return (
    <div className="stack">
      <PageHead title="Trade"
 />
      <MarketSwitch value={market} onChange={(m) => { setMarket(m); setDraft(null); }} />

      <TradeDashboard trades={j.trades.filter(inMarket)} market={market} tz={tz} live={market === 'crypto' ? j.binance ?? null : j.mt5 ?? null}
        cashflow={(market === 'crypto' ? j.cashflow?.crypto : j.cashflow?.forex) ?? []}
        fallbackStart={market === 'crypto' ? 199.02 : 10000}
        groupOf={market === 'crypto' ? (t) => coinOf(t) || NAME[t.strategy] || t.strategy : (t) => NAME[t.strategy] ?? t.strategy}
        renderTrades={(list) => <div className="hcards">{list.map(tradeRow)}</div>} />


      {/* journal form (opens from a signal, the calculator, or the button above) */}
      {draft ? (
        <section className="group stack appear" id="jurnal" style={{ scrollMarginTop: 16 }}>
          <SecHead title="Catat trade" />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div className="picker"><span className="label">Metode</span>
              <Seg full label="Metode" options={[...JOURNAL_KEYS[market], 'lain'].map((s) => [s, NAME[s]] as const)} value={draft.strategy} onChange={(s) => setDraft({ ...draft, strategy: s })} /></div>
            <div className="picker"><span className="label">Arah</span>
              <Seg full label="Arah" options={[['BUY', 'BUY'], ['SELL', 'SELL']] as const} value={draft.side} onChange={(s) => setDraft({ ...draft, side: s })} /></div>
          </div>
          <div className="grid two">
            {(['entry', 'sl', 'tp', 'lot'] as const).map((k) => (
              <label key={k} className="field">{k === 'sl' ? 'Stop loss' : k === 'tp' ? 'Take profit' : k === 'lot' ? 'Lot' : 'Entry (harga isi)'}
                <input inputMode="decimal" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></label>
            ))}
          </div>
          <label className="field">Catatan<input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="opsional" /></label>
          {jErr ? <div className="error">{jErr}</div> : null}
          <div className="row"><button className="btn primary" onClick={submit} disabled={saving}>{saving ? <><Spinner />Menyimpan…</> : 'Simpan trade'}</button><button className="btn ghost" onClick={() => setDraft(null)} disabled={saving}>Batal</button></div>
        </section>
      ) : null}

      {market === 'forex' ? <section className="group">
        <SecHead title="Sinyal live" meta={signals.length ? `${Math.min(10, signals.length)} terbaru` : undefined} />
        {signals.length ? (
          <div className="list">
            {signals.slice(0, 10).map(({ e, s }) => {
              const l = lotFor(riskUsd, s!.entry, s!.sl);
              return (
                <div key={e.id} className="trow">
                  <div className="top">
                    <span><span className={`tag ${s!.side === 'BUY' ? 'buy' : 'sell'}`}>{s!.side}</span><span className="t">{e.strategy_version_label}</span></span>
                    <span className="mute small">{fmt(e.event_time, tz)}</span>
                  </div>
                  <div className="levels">
                    <span><span className="k">Entry ≈</span><strong>{px(s!.entry)}</strong></span>
                    <span><span className="k">SL</span><strong>{px(s!.sl)}</strong></span>
                    <span><span className="k">TP</span><strong>{px(s!.tp)}</strong></span>
                    <span><span className="k">Lot</span><strong>{l && l.lot > 0 ? l.lot.toFixed(2) : '—'}</strong></span>
                    {s!.be ? <span><span className="k">BE (SL → entry)</span><strong>{px(s!.be)}</strong></span> : null}
                  </div>
                  <div><button className="btn sm" onClick={() => openDraft({ strategy: stratOf(e.strategy_version_label), side: s!.side, entry: String(s!.entry), sl: String(s!.sl), tp: String(s!.tp), lot: l && l.lot > 0 ? l.lot.toFixed(2) : '' })}>Catat ke jurnal</button></div>
                </div>
              );
            })}
          </div>
        ) : <p className="empty-inline">Belum ada sinyal.</p>}
      </section> : null}

      {openT.length ? (
        <section className="group">
          <SecHead title="Posisi terbuka" meta={openT.length} />
          <div className="list">
            {openT.map((t) => (
              <div key={t.id} className={`trow${busyId === t.id ? ' refreshing' : ''}`}>
                <div className="top">
                  <span><span className={`tag ${t.side === 'BUY' ? 'buy' : 'sell'}`}>{t.side}</span><span className="t">{NAME[t.strategy] ?? t.strategy} · {['btc', 'alt', 'snr'].includes(t.strategy) ? `${t.note.replace(/^Bot Binance ?/, '') || 'koin'} · ${t.lot}` : `${t.lot.toFixed(2)} lot`}</span></span>
                  <span className="mute small">{fmt(t.openedAt, tz)}</span>
                </div>
                <div className="levels" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                  <span><span className="k">Entry</span><strong>{px(t.entry)}</strong></span>
                  <span><span className="k">SL</span><strong>{px(t.sl)}</strong></span>
                  <span><span className="k">TP</span><strong>{px(t.tp)}</strong></span>
                </div>
                <div className="actions">
                  <button className="btn sm" onClick={() => close(t, 'tp')} disabled={busyId === t.id}>Kena TP</button>
                  <button className="btn sm" onClick={() => close(t, 'sl')} disabled={busyId === t.id}>Kena SL</button>
                  <button className="btn sm" onClick={() => close(t, 'be')} disabled={busyId === t.id}>Impas</button>
                  <button className="btn sm" onClick={() => close(t, 'manual')} disabled={busyId === t.id}>Tutup manual</button>
                  <button className="btn sm ghost" onClick={() => remove(t)} disabled={busyId === t.id}>Hapus</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="group">
        <SecHead title="Performa per metode" />
        <div className="perf-cards">
          {JOURNAL_KEYS[market].map((k) => {
            const s = j.stats[k];
            if (!s) return null;
            const win = s.winRate == null ? null : s.winRate * 100, bt = BT[k] ? BT[k].win * 100 : null;
            return (
              <div key={k} className="perf-card">
                <div className="perf-head"><span className="perf-name">{NAME[k] ?? k}</span><span className={`perf-pnl ${tone(s.pnl)}`}>{money(s.pnl)}</span></div>
                <div className="perf-bar" aria-label={`Win ${win == null ? '—' : win.toFixed(0) + '%'}, backtest ${bt == null ? '—' : bt.toFixed(0) + '%'}`}>
                  <span className="fill" style={{ width: `${Math.min(100, win ?? 0)}%` }} />
                  {bt != null ? <span className="mark" style={{ left: `${bt}%` }} /> : null}
                </div>
                <div className="perf-facts">
                  <span><span className="k">Win</span><strong>{win == null ? '—' : `${win.toFixed(0)}%`}</strong></span>
                  <span><span className="k">Backtest</span><strong>{bt == null ? '—' : `${bt.toFixed(0)}%`}</strong></span>
                  <span><span className="k">Trade</span><strong>{s.closed}</strong></span>
                  <span><span className="k">Rata-rata</span><strong className={tone(s.closed ? s.pnl / s.closed : null)}>{s.closed ? money(s.pnl / s.closed) : '—'}</strong></span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="group">
        {closedT.length || flowsAll.length ? <>
          <button className={`hist-toggle${showHist ? ' is-open' : ''}`} onClick={() => setShowHist((v) => !v)} aria-expanded={showHist}>
            <span><strong>Riwayat lengkap</strong><span className="mute">{closedT.length} trade{flowsAll.length ? ` · ${flowsAll.length} transfer` : ''}</span></span>
            <span className="chev" aria-hidden>⌄</span>
          </button>
          {showHist ? <div className="appear" style={{ marginTop: 10 }}>
            {flowsAll.length ? <div style={{ marginBottom: 10 }}><Seg full options={[['all', 'Semua'], ['pos', 'Posisi'], ['cf', 'Transfer']] as const} value={histKind} onChange={setHistKind} label="Jenis riwayat" /></div> : null}
            <div className="hcards">{histItems.map((x) => x.el)}</div>
          </div> : null}
        </> : <p className="empty-inline">Belum ada trade.</p>}
        {detail ? (
          <Sheet title={`${detail.side} · ${fmt(detail.openedAt, tz)}`} onClose={() => setDetail(null)}>
            <div className="stack">
              {coinOf(detail) ? <LiveTradeChart symbol={`${coinOf(detail)}USDT`} t={detail} tz={tz} /> : null}
              <dl className="kv">
                <dt>Metode</dt><dd>{NAME[detail.strategy] ?? detail.strategy}{coinOf(detail) ? ` · ${coinOf(detail)}` : ''}</dd>
                <dt>{['btc', 'alt', 'snr'].includes(detail.strategy) ? 'Jumlah' : 'Lot'}</dt><dd>{['btc', 'alt', 'snr'].includes(detail.strategy) ? detail.lot : detail.lot.toFixed(2)}</dd>
                <dt>Entry</dt><dd>{px(detail.entry)}</dd>
                <dt>Stop loss</dt><dd>{px(detail.sl)}</dd>
                <dt>Take profit</dt><dd>{px(detail.tp)}</dd>
                <dt>Keluar</dt><dd>{px(detail.exit)} · {RESULT[detail.result] ?? 'Manual'}</dd>
                <dt>Hasil</dt><dd className={tone(detail.pnl)} style={{ fontWeight: 600 }}>{money(detail.pnl)}</dd>
                <dt>Dibuka</dt><dd>{fmt(detail.openedAt, tz)}</dd>
                <dt>Ditutup</dt><dd>{detail.closedAt ? fmt(detail.closedAt, tz) : '—'}</dd>
                {detail.closedAt ? <><dt>Durasi</dt><dd>{holdTxt(detail.closedAt - detail.openedAt)}</dd></> : null}
                {detail.note ? <><dt>Catatan</dt><dd>{detail.note}</dd></> : null}
              </dl>
              <button className="btn block" onClick={async () => { const t = detail; setDetail(null); await fix(t); }}>Koreksi hasil (TP / SL / harga / $)</button>
              <button className="btn block" onClick={async () => { const t = detail; setDetail(null); await remove(t); }}>Hapus trade ini</button>
            </div>
          </Sheet>
        ) : null}
        {jErr && !draft ? <div className="error" style={{ marginTop: 10 }}>{jErr}</div> : null}
      </section>

    </div>
  );
}
