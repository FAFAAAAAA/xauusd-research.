'use client';
import { useMemo } from 'react';
import type { ClosedTrade } from './ResultCharts';

/* Shared result tiles (Trade page and Backtest, 9 Nov 2026): bento tiles of different sizes + the streak run chart.
 * Input: closed trades in time order (pnl in $). */

export const usd = (n: number, sign = true) => {
  const a = Math.abs(n), s = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${s}$${a >= 1000 ? Math.round(a).toLocaleString('en-US') : a.toFixed(2)}`;
};
const tone = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const dur = (ms: number) => { const h = ms / 3_600_000; return h < 1 ? `${Math.round(h * 60)} mnt` : h < 48 ? `${h.toFixed(1)} jam` : `${(h / 24).toFixed(1)} hari`; };

export function useResultStats(trades: readonly ClosedTrade[], start = 0) {
  return useMemo(() => {
    const T = [...trades].sort((a, b) => a.exit - b.exit), pnl = T.map((t) => t.pnl);
    const W = pnl.filter((x) => x > 0), L = pnl.filter((x) => x < 0);
    const gw = W.reduce((a, b) => a + b, 0), gl = -L.reduce((a, b) => a + b, 0);
    let bal = start, peak = start, dd = 0, ddPct = 0;
    for (const x of pnl) { bal += x; if (bal > peak) peak = bal; if (peak - bal > dd) { dd = peak - bal; ddPct = start > 0 && peak > 0 ? (peak - bal) / peak * 100 : 0; } }
    // runs of consecutive wins (+n) / losses (−n); break-even trades end a run
    const runs: number[] = [];
    for (const x of pnl) {
      const s = x > 0 ? 1 : x < 0 ? -1 : 0, last = runs[runs.length - 1] ?? 0;
      if (s === 0) { runs.push(0); continue; }
      if (last !== 0 && Math.sign(last) === s) runs[runs.length - 1] += s; else runs.push(s);
    }
    const nz = runs.filter((r) => r !== 0);
    const hold = T.length ? T.reduce((a, t) => a + Math.max(0, t.exit - t.entry), 0) / T.length : null;
    const avgOf = (xs: ClosedTrade[]) => (xs.length ? xs.reduce((a, t) => a + Math.max(0, t.exit - t.entry), 0) / xs.length : null);
    const holdW = avgOf(T.filter((t) => t.pnl > 0)), holdL = avgOf(T.filter((t) => t.pnl < 0));
    // how long positions stay open: share of trades per bucket
    const EDGES = [3_600_000, 4 * 3_600_000, 12 * 3_600_000, 86_400_000, 3 * 86_400_000];
    const buckets = [0, 0, 0, 0, 0, 0];
    for (const t of T) { const d = Math.max(0, t.exit - t.entry); let i = 0; while (i < EDGES.length && d >= EDGES[i]) i++; buckets[i]++; }
    return {
      n: T.length, total: gw - gl, wins: W.length, losses: L.length, be: T.length - W.length - L.length,
      winRate: W.length + L.length ? W.length / (W.length + L.length) : null, pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : null,
      avgW: W.length ? gw / W.length : null, avgL: L.length ? -gl / L.length : null,
      best: pnl.length ? Math.max(...pnl) : null, worst: pnl.length ? Math.min(...pnl) : null, gw, gl,
      dd, ddPct, hold, holdW, holdL, buckets, runs: nz, maxW: Math.max(0, ...nz), maxL: Math.max(0, ...nz.map((r) => -r)), cur: runs[runs.length - 1] ?? 0,
    };
  }, [trades, start]);
}
export type ResultStats = ReturnType<typeof useResultStats>;

/** Streak tile: header with the current streak, a run chart (green bars up = win runs, red bars down = loss runs) and the two records. */
export function StreakTile({ s }: { s: ResultStats }) {
  const runs = s.runs.slice(-48), mx = Math.max(1, s.maxW, s.maxL);
  return (
    <div className="b-tile b-wide streak2">
      <div className="b-top">
        <span className="b-k">Beruntun</span>
        {s.cur ? <span className={`st-pill ${s.cur > 0 ? 'w' : 'l'}`}>{Math.abs(s.cur)}× {s.cur > 0 ? 'menang' : 'kalah'} sekarang</span> : null}
      </div>
      <div className="st-chart" role="img" aria-label={`Rangkaian menang dan kalah, terpanjang ${s.maxW} menang dan ${s.maxL} kalah`}>
        {runs.map((r, i) => (
          <span key={i} className="st-col" title={`${Math.abs(r)}× ${r > 0 ? 'menang' : 'kalah'}`}>
            <span className="st-up">{r > 0 ? <span className="st-bar w" style={{ height: `${(r / mx) * 100}%` }} /> : null}</span>
            <span className="st-dn">{r < 0 ? <span className="st-bar l" style={{ height: `${(-r / mx) * 100}%` }} /> : null}</span>
          </span>
        ))}
      </div>
      <div className="st-recs">
        <span><i className="w" />Menang terpanjang <strong>{s.maxW}×</strong></span>
        <span><i className="l" />Kalah terpanjang <strong>{s.maxL}×</strong></span>
      </div>
    </div>
  );
}

const HOLD_LABELS = ['< 1 jam', '1–4 jam', '4–12 jam', '12–24 jam', '1–3 hari', '> 3 hari'];
const HOLD_SHORT = ['<1j', '1–4j', '4–12j', '12–24j', '1–3h', '>3h'];
/** Holding time: average, win vs loss, and how trades spread over duration buckets (mini bar chart). */
export function HoldTile({ s }: { s: ResultStats }) {
  return (
    <div className="b-tile b-wide">
      <span className="b-k">Lama posisi rata-rata</span>
      <div className="b-three">
        <div className="b-stat"><span className="hc-res">ALL</span><span className="b-v">{s.hold != null ? dur(s.hold) : '—'}</span></div>
        <div className="b-stat"><span className="hc-res tp">TP</span><span className="b-v">{s.holdW != null ? dur(s.holdW) : '—'}</span></div>
        <div className="b-stat"><span className="hc-res sl">SL</span><span className="b-v">{s.holdL != null ? dur(s.holdL) : '—'}</span></div>
      </div>
    </div>
  );
}

/** The common tiles. `extra` adds more tiles at the end (same .b-tile markup). */
export function StatsBento({ s, extra }: { s: ResultStats; extra?: React.ReactNode }) {
  return (
    <div className="bento">
      <div className="b-tile b-wide b-win">
        <div className="b-top"><span className="b-k">Win rate</span><span className="b-k">{s.n} trade</span></div>
        <div className="b-big">{s.winRate == null ? '—' : `${(s.winRate * 100).toFixed(s.n >= 100 ? 1 : 0)}%`}</div>
        <div className="b-split" aria-hidden>
          <span className="w" style={{ flex: s.wins || 0.0001 }} /><span className="l" style={{ flex: s.losses || 0.0001 }} />{s.be ? <span className="e" style={{ flex: s.be }} /> : null}
        </div>
        <div className="b-legend"><span className="pos">{s.wins} menang</span><span className="neg">{s.losses} kalah</span>{s.be ? <span className="mute">{s.be} impas</span> : null}</div>
      </div>
      <div className="b-tile">
        <span className="b-k">Profit factor</span>
        <span className={`b-v ${s.pf != null && s.pf !== Infinity ? (s.pf >= 1 ? '' : 'neg') : ''}`}>{s.pf == null ? '—' : s.pf === Infinity ? '∞' : s.pf.toFixed(2)}</span>
      </div>
      <div className="b-tile">
        <span className="b-k">Drawdown</span>
        <span className={`b-v ${s.dd ? 'neg' : ''}`}>{s.dd ? `−${usd(s.dd, false)}` : '$0.00'}</span>
        {s.dd && s.ddPct ? <span className="b-h">{s.ddPct.toFixed(1)}% dari puncak</span> : null}
      </div>
      <div className="b-tile b-wide b-pair">
        <div><span className="b-k">Rata-rata menang</span><span className="b-v pos">{s.avgW == null ? '—' : usd(s.avgW)}</span></div>
        <div><span className="b-k">Rata-rata kalah</span><span className="b-v neg">{s.avgL == null ? '—' : usd(s.avgL)}</span></div>
      </div>
      <div className="b-tile b-wide b-pair">
        <div><span className="b-k">Terbaik</span><span className={`b-v ${tone(s.best)}`}>{s.best == null ? '—' : usd(s.best)}</span></div>
        <div><span className="b-k">Terburuk</span><span className={`b-v ${tone(s.worst)}`}>{s.worst == null ? '—' : usd(s.worst)}</span></div>
      </div>
      <StreakTile s={s} />
      <HoldTile s={s} />
      {extra}
    </div>
  );
}
