'use client';
import { useEffect, useMemo, useState } from 'react';
import { CountUp, SecHead, Sheet } from './Status';
import { StatsBento, useResultStats } from './StatsBento';
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

export default function TradeDashboard({ trades, market, tz, fallbackStart, groupOf, renderTrades, live = null }: {
  trades: JournalTrade[]; market: string; tz: string; fallbackStart: number; live?: { wallet: number; upnl: number; at: number } | null;
  groupOf: (t: JournalTrade) => string; groupLabel?: string; renderTrades: (list: JournalTrade[]) => React.ReactNode;
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
      groups: [...groups.entries()].sort((a, b) => b[1].pnl - a[1].pnl), closed, form: pnl.slice(-24),
    };
  }, [trades, start, tz, groupOf]);

  const rs = useResultStats(s.closed, start);
  // crypto: the real Binance balance sent by the bot (wallet); otherwise starting balance + journal results
  const bal = live && Number.isFinite(live.wallet) ? live.wallet : s.bal;
  const growth = start > 0 ? (bal - start) / start * 100 : 0;
  const ago = live ? Math.max(0, Math.round((Date.now() - live.at) / 60_000)) : 0;
  return (
    <div className="stack td">
      <section className="td-hero">
        <span className="td-k">Saldo</span>
        <span className="td-bal"><CountUp value={bal} format={(n) => usd(n, false)} /></span>
        <span className="td-row">
          <span className={`td-chip ${tone(growth)}`}>{pct(growth)}</span>
          <span className={tone(s.total)}>{usd(s.total)}</span>
          <span className="td-sub">dari saldo awal {usd(start, false)} · <button className="td-link" onClick={() => setEdit(String(start))}>ubah</button></span>
        </span>
        {live ? <span className="td-sub">Saldo Binance Futures · {ago < 1 ? 'baru saja' : ago < 60 ? `${ago} mnt lalu` : `${Math.round(ago / 60)} jam lalu`}{Math.abs(live.upnl) >= 0.01 ? <> · posisi terbuka <span className={tone(live.upnl)}>{usd(live.upnl)}</span></> : null}</span> : null}
        <div className="td-period">
          <span><span className="td-k">Hari ini</span><strong className={tone(s.today)}>{usd(s.today)}</strong></span>
          <span><span className="td-k">Minggu ini</span><strong className={tone(s.week)}>{usd(s.week)}</strong></span>
          <span><span className="td-k">Bulan ini</span><strong className={tone(s.month)}>{usd(s.month)}</strong></span>
        </div>
      </section>

      {s.n ? <>
        <StatsBento s={rs} />

        <section className="group">
          <SecHead title="Pertumbuhan saldo" />
          <EquityChart trades={s.closed} tz={tz} start={start} />
        </section>


        <section className="group">
          <PnlCalendar trades={s.closed} tz={tz} simple
            renderSelection={(match) => renderTrades(trades.filter((t) => t.result !== 'open' && t.pnl != null && match(t.openedAt)).sort((a, b) => b.openedAt - a.openedAt))} />
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
