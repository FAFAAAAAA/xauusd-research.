'use client';
import { useEffect, useMemo, useState } from 'react';
import { CountUp, Metric, Metrics, SecHead, Sheet } from './Status';
import { EquityChart, PnlCalendar, type ClosedTrade } from './ResultCharts';
import { tzOffsetMinutes } from '@/lib/core/time';
import type { JournalTrade } from '@/lib/core/journal';

/* Trade page dashboard (9 Nov 2026): balance, growth, complete P&L figures, balance chart, P&L calendar and P&L per coin / method.
 * Everything comes from the closed journal trades of the selected market (bot / EA reports = Binance / MT5 numbers).
 * The starting balance is a per-browser setting (localStorage, guarded); default crypto 199.02 USDT (first bot balance). */

const usd = (n: number, sign = true) => `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (n: number) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const pct = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n).toFixed(1)}%`;
const dur = (ms: number) => { const h = ms / 3_600_000; return h < 1 ? `${Math.round(h * 60)} mnt` : h < 48 ? `${h.toFixed(1)} jam` : `${(h / 24).toFixed(1)} hari`; };
const key = (m: string) => `start_balance_${m}`;
const readStart = (m: string, fallback: number) => { try { const v = Number(localStorage.getItem(key(m))); return v > 0 ? v : fallback; } catch { return fallback; } };

export default function TradeDashboard({ trades, market, tz, fallbackStart, groupOf, groupLabel }: {
  trades: JournalTrade[]; market: string; tz: string; fallbackStart: number;
  groupOf: (t: JournalTrade) => string; groupLabel: string;
}) {
  const [start, setStart] = useState(fallbackStart);
  useEffect(() => { setStart(readStart(market, fallbackStart)); }, [market, fallbackStart]);
  // starting balance editor (bottom sheet, not a browser prompt)
  const [edit, setEdit] = useState<string | null>(null);
  const saveStart = () => {
    const n = Number(String(edit ?? '').replace(',', '.'));
    if (!(n > 0)) return;
    try { localStorage.setItem(key(market), String(n)); } catch { /* ignore */ }
    setStart(n); setEdit(null);
  };

  const s = useMemo(() => {
    const T = trades.filter((t) => t.result !== 'open' && t.pnl != null).slice().sort((a, b) => (a.closedAt ?? a.openedAt) - (b.closedAt ?? b.openedAt));
    const pnl = T.map((t) => Number(t.pnl));
    const total = pnl.reduce((a, b) => a + b, 0);
    const W = pnl.filter((x) => x > 0), L = pnl.filter((x) => x < 0);
    const gw = W.reduce((a, b) => a + b, 0), gl = -L.reduce((a, b) => a + b, 0);
    // balance, peak and deepest drop
    let bal = start, peak = start, dd = 0, ddPct = 0;
    for (const x of pnl) { bal += x; if (bal > peak) peak = bal; if (peak - bal > dd) { dd = peak - bal; ddPct = (peak - bal) / peak * 100; } }
    // streaks
    let cur = 0, bestW = 0, bestL = 0, run = 0;
    for (const x of pnl) {
      if (x > 0) { run = run > 0 ? run + 1 : 1; bestW = Math.max(bestW, run); } else if (x < 0) { run = run < 0 ? run - 1 : -1; bestL = Math.max(bestL, -run); }
      cur = run;
    }
    // today / this week / this month in the display timezone
    const wall = (ms: number) => new Date(ms + tzOffsetMinutes(ms, tz) * 60_000);
    const now = wall(Date.now());
    const dayK = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    const monK = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const monday = new Date(now); monday.setUTCHours(0, 0, 0, 0); monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
    let today = 0, week = 0, month = 0;
    for (const t of T) {
      const w = wall(t.closedAt ?? t.openedAt), x = Number(t.pnl);
      if (dayK(w) === dayK(now)) today += x;
      if (w.getTime() >= monday.getTime()) week += x;
      if (monK(w) === monK(now)) month += x;
    }
    const holds = T.filter((t) => t.closedAt).map((t) => (t.closedAt as number) - t.openedAt);
    // per coin / method
    const groups = new Map<string, { n: number; w: number; l: number; pnl: number }>();
    for (const t of T) {
      const g = groupOf(t) || '—', c = groups.get(g) ?? { n: 0, w: 0, l: 0, pnl: 0 };
      c.n++; c.pnl += Number(t.pnl); if (Number(t.pnl) > 0) c.w++; else if (Number(t.pnl) < 0) c.l++;
      groups.set(g, c);
    }
    const closed: ClosedTrade[] = T.map((t) => ({ entry: t.openedAt, exit: t.closedAt ?? t.openedAt, pnl: Number(t.pnl), pnlR: null, side: t.side }));
    return {
      n: T.length, total, bal, wins: W.length, losses: L.length, be: T.length - W.length - L.length,
      winRate: W.length + L.length ? W.length / (W.length + L.length) : null, pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : null,
      avgW: W.length ? gw / W.length : null, avgL: L.length ? -gl / L.length : null, best: pnl.length ? Math.max(...pnl) : null, worst: pnl.length ? Math.min(...pnl) : null,
      dd, ddPct, cur, bestW, bestL, today, week, month, hold: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null,
      groups: [...groups.entries()].sort((a, b) => b[1].pnl - a[1].pnl), closed,
    };
  }, [trades, start, tz, groupOf]);

  const growth = start > 0 ? (s.bal - start) / start * 100 : 0;
  return (
    <div className="stack td">
      <section className="td-hero">
        <span className="td-k">Saldo</span>
        <span className="td-bal"><CountUp value={s.bal} format={(n) => usd(n, false)} /></span>
        <span className="td-row">
          <span className={`td-chip ${tone(growth)}`}>{pct(growth)}</span>
          <span className={tone(s.total)}>{usd(s.total)}</span>
          <span className="td-sub">dari saldo awal {usd(start, false)} · <button className="td-link" onClick={() => setEdit(String(start))}>ubah</button></span>
        </span>
        <div className="td-period">
          <span><span className="td-k">Hari ini</span><strong className={tone(s.today)}>{usd(s.today)}</strong></span>
          <span><span className="td-k">Minggu ini</span><strong className={tone(s.week)}>{usd(s.week)}</strong></span>
          <span><span className="td-k">Bulan ini</span><strong className={tone(s.month)}>{usd(s.month)}</strong></span>
        </div>
      </section>

      {s.n ? <>
        <Metrics cols={3}>
          <Metric label="Trade selesai" value={s.n} hint={`${s.wins} menang · ${s.losses} kalah${s.be ? ` · ${s.be} impas` : ''}`} />
          <Metric label="Win rate" value={s.winRate == null ? '—' : `${(s.winRate * 100).toFixed(0)}%`} />
          <Metric label="Profit factor" value={s.pf == null ? '—' : s.pf === Infinity ? '∞' : s.pf.toFixed(2)} />
          <Metric label="Rata-rata menang" value={s.avgW == null ? '—' : usd(s.avgW)} tone="pos" />
          <Metric label="Rata-rata kalah" value={s.avgL == null ? '—' : usd(s.avgL)} tone="neg" />
          <Metric label="Drawdown terdalam" value={s.dd ? `−$${s.dd.toFixed(2)}` : '$0.00'} tone={s.dd ? 'neg' : ''} hint={s.dd ? `${s.ddPct.toFixed(1)}% dari puncak` : undefined} />
        </Metrics>

        <section className="group">
          <SecHead title="Detail" />
          <dl className="kv td-kv">
            <dt>Trade terbaik</dt><dd className={tone(s.best ?? 0)}>{s.best == null ? '—' : usd(s.best)}</dd>
            <dt>Trade terburuk</dt><dd className={tone(s.worst ?? 0)}>{s.worst == null ? '—' : usd(s.worst)}</dd>
            <dt>Sekarang</dt><dd>{s.cur > 0 ? `${s.cur}× menang beruntun` : s.cur < 0 ? `${-s.cur}× kalah beruntun` : '—'}</dd>
            <dt>Beruntun terpanjang</dt><dd>{s.bestW}× menang · {s.bestL}× kalah</dd>
            <dt>Lama posisi rata-rata</dt><dd>{s.hold != null ? dur(s.hold) : '—'}</dd>
          </dl>
        </section>

        <section className="group">
          <SecHead title="Pertumbuhan saldo" />
          <EquityChart trades={s.closed} tz={tz} start={start} />
        </section>


        <section className="group">
          <SecHead title="Kalender PnL" />
          <PnlCalendar trades={s.closed} tz={tz} simple />
        </section>
      </> : <p className="empty-inline">Belum ada trade selesai di pasar ini.</p>}

      {edit != null ? (
        <Sheet title="Saldo awal" onClose={() => setEdit(null)}>
          <div className="stack">
            <p className="mute small" style={{ margin: 0 }}>Dipakai untuk menghitung saldo sekarang dan pertumbuhannya ({market === 'crypto' ? 'Crypto' : 'Forex'}).</p>
            <label className="field">Saldo awal (USD)
              <input inputMode="decimal" autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveStart(); }} />
            </label>
            <button className="btn primary block" onClick={saveStart} disabled={!(Number(String(edit).replace(',', '.')) > 0)}>Simpan</button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
