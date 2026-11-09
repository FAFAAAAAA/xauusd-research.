'use client';
import { useMemo, useState } from 'react';
import { sessionOf, tzOffsetMinutes } from '@/lib/core/time';
import { SecHead, Seg } from './Status';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ClosedTrade { entry: number; exit: number; pnl: number; pnlR: number | null; side: string }

export function closedTrades(rows: any[]): ClosedTrade[] {
  return rows
    .filter((t) => t.pnl != null && t.exit_ms != null)
    .map((t) => ({ entry: Number(t.entry_ms), exit: Number(t.exit_ms), pnl: Number(t.pnl), pnlR: t.pnl_r == null ? null : Number(t.pnl_r), side: String(t.side) }))
    .sort((a, b) => a.exit - b.exit);
}

const money = (n: number) => `${Math.round(Math.abs(n)) === 0 ? '' : n > 0 ? '+' : '−'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const short = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n) >= 1000 ? `${Math.round(Math.abs(n) / 1000)}k` : Math.round(Math.abs(n))}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Wall-clock Date (read with getUTC*) in the display timezone. */
const wall = (ms: number, tz: string) => new Date(ms + tzOffsetMinutes(ms, tz) * 60_000);
const dmy = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/* ------------------------------------------------------------------ equity line */
/** start: starting capital (the line then shows the account balance); scale: multiply each trade's P&L (risk typed by the owner ÷ backtest risk). */
export function EquityChart({ trades, tz, start = 0, scale = 1 }: { trades: ClosedTrade[]; tz: string; start?: number; scale?: number }) {
  const pts = useMemo(() => {
    let eq = start;
    return [{ t: trades[0]?.entry ?? 0, v: start }, ...trades.map((x) => ({ t: x.exit, v: (eq += x.pnl * scale) }))];
  }, [trades, start, scale]);
  if (trades.length < 2) return <p className="mute small">Butuh minimal 2 trade untuk menggambar grafik.</p>;
  const W = 360, H = 190, P = { l: start ? 56 : 44, r: 8, t: 10, b: 22 };
  const vs = pts.map((p) => p.v);
  let lo = Math.min(start, ...vs), hi = Math.max(start, ...vs);
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const x = (i: number) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${y(start).toFixed(1)}L${x(0).toFixed(1)},${y(start).toFixed(1)}Z`;
  const end = pts[pts.length - 1].v;
  const color = end >= start ? 'var(--up)' : 'var(--down)';
  const bal = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad];
  // deepest drawdown segment (peak → trough)
  let peakI = 0, best = { from: 0, to: 0, dd: 0 }, curPeak = 0;
  pts.forEach((p, i) => { if (p.v > pts[curPeak].v) curPeak = i; const dd = pts[curPeak].v - p.v; if (dd > best.dd) { best = { from: curPeak, to: i, dd }; peakI = curPeak; } });
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Grafik saldo: akhir ${start ? bal(end) : money(end)}`} style={{ display: 'block' }}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--mute)">{start ? bal(v) : short(v)}</text>
          </g>
        ))}
        <line x1={P.l} x2={W - P.r} y1={y(start)} y2={y(start)} stroke="var(--mute)" strokeWidth="1" strokeDasharray="4 4" />
        {best.dd > 0 ? <rect x={x(peakI)} y={P.t} width={Math.max(1, x(best.to) - x(peakI))} height={H - P.t - P.b} fill="var(--down)" opacity="0.06" /> : null}
        <path d={area} fill={color} opacity="0.08" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx={x(pts.length - 1)} cy={y(end)} r="3" fill={color} />
        <text x={P.l} y={H - 6} fontSize="11" fill="var(--mute)">{dmy(wall(pts[0].t, tz))}</text>
        <text x={W - P.r} y={H - 6} fontSize="11" fill="var(--mute)" textAnchor="end">{dmy(wall(pts[pts.length - 1].t, tz))}</text>
      </svg>
      <figcaption className="mute small" style={{ marginTop: 6 }}>
        Merah tipis = penurunan terdalam ({money(-best.dd)})
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ periods */
type Mode = 'day' | 'week' | 'month' | 'year' | 'weekday' | 'session';
const MODES: Array<[Mode, string]> = [['day', 'Hari'], ['week', 'Minggu'], ['month', 'Bulan'], ['year', 'Tahun'], ['weekday', 'Sen–Jum'], ['session', 'Sesi']];
const SESSION: Record<string, string> = { asia: 'Asia', london: 'London', new_york: 'New York', off: 'Di luar sesi' };
const SESSION_ORDER = ['asia', 'london', 'new_york', 'off'];
const PERIOD_WORD: Record<Mode, string> = { day: 'hari', week: 'minggu', month: 'bulan', year: 'tahun', weekday: 'hari', session: 'sesi' };

interface Row { key: string; sort: number; label: string; trades: number; wins: number; losses: number; pnl: number }

function bucket(time: number, mode: Mode, tz: string): { key: string; sort: number; label: string } {
  const d = wall(time, tz);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate();
  switch (mode) {
    case 'day': return { key: `${Y}-${M}-${D}`, sort: Date.UTC(Y, M, D), label: `${DAYS[d.getUTCDay()].slice(0, 3)}, ${D} ${MONTHS[M]} ${Y}` };
    case 'week': {
      const back = (d.getUTCDay() + 6) % 7; // Monday start
      const m = new Date(Date.UTC(Y, M, D - back));
      return { key: `w${m.getTime()}`, sort: m.getTime(), label: `Minggu ${m.getUTCDate()} ${MONTHS[m.getUTCMonth()]} ${m.getUTCFullYear()}` };
    }
    case 'month': return { key: `${Y}-${M}`, sort: Date.UTC(Y, M, 1), label: `${MONTHS[M]} ${Y}` };
    case 'year': return { key: `${Y}`, sort: Y, label: String(Y) };
    case 'weekday': { const w = d.getUTCDay(); return { key: `d${w}`, sort: (w + 6) % 7, label: DAYS[w] }; }
    case 'session': { const s = sessionOf(time); return { key: s, sort: SESSION_ORDER.indexOf(s), label: SESSION[s] ?? s }; }
  }
}

type DrawdownPeriod = 'week' | 'month';

interface PeriodDrawdown {
  sort: number;
  label: string;
  totalR: number;
  peakR: number;
  drawdown: number;
}

/** Trades arrive in close-time order from closedTrades. Each period starts at its opening balance. */
export function periodDrawdowns(trades: readonly ClosedTrade[], mode: DrawdownPeriod | 'all', tz: string): PeriodDrawdown[] | null {
  const periods = new Map<string, PeriodDrawdown>();
  for (const trade of trades) {
    if (trade.pnlR == null || !Number.isFinite(trade.pnlR)) return null;   // drawdown as a multiple of the risk per trade (×)
    const period = mode === 'all' ? { key: 'all', sort: 0, label: 'Maksimum' } : bucket(trade.exit, mode, tz);
    let row = periods.get(period.key);
    if (!row) {
      row = { sort: period.sort, label: period.label, totalR: 0, peakR: 0, drawdown: 0 };
      periods.set(period.key, row);
    }
    row.totalR += trade.pnlR;
    row.peakR = Math.max(row.peakR, row.totalR);
    row.drawdown = Math.max(row.drawdown, row.peakR - row.totalR);
  }
  return [...periods.values()].sort((a, b) => b.sort - a.sort);
}

const formatDrawdown = (value: number | null) => value == null ? '—' : `${Math.round(value)}×`;

export function DrawdownBreakdown({ trades, tz }: { trades: ClosedTrade[]; tz: string }) {
  const [mode, setMode] = useState<DrawdownPeriod>('week');
  const [visible, setVisible] = useState(8);
  const weekly = useMemo(() => periodDrawdowns(trades, 'week', tz), [trades, tz]);
  const monthly = useMemo(() => periodDrawdowns(trades, 'month', tz), [trades, tz]);
  const maximum = useMemo(() => periodDrawdowns(trades, 'all', tz)?.[0]?.drawdown ?? null, [trades, tz]);
  const worst = (periods: PeriodDrawdown[] | null) => periods?.reduce((max, row) => Math.max(max, row.drawdown), 0) ?? null;
  const rows = (mode === 'week' ? weekly : monthly) ?? [];
  const summary: Array<[string, number | null]> = [['Maksimum', maximum], ['Mingguan terburuk', worst(weekly)], ['Bulanan terburuk', worst(monthly)]];

  return (
    <section className="group stack">
      <SecHead title="Drawdown" />
      <div className="hold3">
        {summary.map(([label, value]) => (
          <div key={label} title="Kelipatan risiko per trade" className={value != null && Math.round(value) > 0 ? 'neg' : undefined}>
            <span>{label}</span><strong>{formatDrawdown(value)}</strong>
          </div>
        ))}
      </div>
      {rows.length > 0 ? <>
        <Seg label="Periode drawdown" options={[['week', 'Mingguan'], ['month', 'Bulanan']]} value={mode} onChange={(value) => { setMode(value); setVisible(8); }} />
        <div className="tablewrap">
          <table className="num-r">
            <thead><tr><th scope="col">Periode</th><th scope="col">Drawdown</th></tr></thead>
            <tbody>
              {rows.slice(0, visible).map((row) => (
                <tr key={row.sort}><td>{row.label}</td><td className={Math.round(row.drawdown) > 0 ? 'neg' : undefined}>{formatDrawdown(row.drawdown)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > visible ? <button className="btn sm" onClick={() => setVisible(visible + 8)}>Tampilkan lebih banyak</button> : null}
      </> : null}
    </section>
  );
}

export function PeriodBreakdown({ trades, tz }: { trades: ClosedTrade[]; tz: string }) {
  const [mode, setMode] = useState<Mode>('week');
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    for (const t of trades) {
      const b = bucket(t.entry, mode, tz);
      const r = m.get(b.key) ?? { ...b, trades: 0, wins: 0, losses: 0, pnl: 0 };
      r.trades++; r.pnl += t.pnl;
      if (t.pnl > 0) r.wins++; else if (t.pnl < 0) r.losses++;
      m.set(b.key, r);
    }
    return [...m.values()].sort((a, b) => a.sort - b.sort);
  }, [trades, mode, tz]);

  const chrono = mode === 'day' || mode === 'week' || mode === 'month' || mode === 'year';
  const word = PERIOD_WORD[mode];
  const green = rows.filter((r) => r.pnl > 0).length;
  const red = rows.filter((r) => r.pnl < 0).length;
  const best = rows.reduce<Row | null>((a, r) => (!a || r.pnl > a.pnl ? r : a), null);
  const worst = rows.reduce<Row | null>((a, r) => (!a || r.pnl < a.pnl ? r : a), null);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
  const list = chrono ? [...rows].reverse() : rows;
  const shown = all ? list : list.slice(0, 12);

  return (
    <div className="stack">
      <div className="seg scroll" role="group" aria-label="Kelompokkan per">
        {MODES.map(([k, l]) => <button key={k} aria-pressed={mode === k} onClick={() => { setMode(k); setAll(false); }}>{l}</button>)}
      </div>

      {rows.length ? (
        <>
          <p className="small">
            {chrono
              ? <><strong className="pos">{green} {word} untung</strong>, <strong className="neg">{red} {word} rugi</strong>{rows.length - green - red ? `, ${rows.length - green - red} impas` : ''} dari {rows.length} {word} yang ada trade-nya. </>
              : null}
            {best && best.pnl > 0 ? <>Terbaik: <strong>{best.label}</strong> ({money(best.pnl)}). </> : null}
            {worst && worst.pnl < 0 ? <>Terburuk: <strong>{worst.label}</strong> ({money(worst.pnl)}).</> : null}
          </p>

          <PeriodBars rows={rows} />

          <div className="list">
            {shown.map((r) => (
              <div key={r.key} className="item" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 6 }}>
                <span style={{ minWidth: 0 }}>
                  <span className="t" style={{ display: 'block' }}>{r.label}</span>
                  <span className="d">{r.trades} trade · <span className="pos">{r.wins} menang</span> · <span className="neg">{r.losses} kalah</span></span>
                </span>
                <span className={`num ${r.pnl > 0 ? 'pos' : r.pnl < 0 ? 'neg' : ''}`} style={{ fontWeight: 700, textAlign: 'right' }}>{money(r.pnl)}</span>
                <span aria-hidden style={{ gridColumn: '1 / -1', height: 4, borderRadius: 2, background: 'var(--sunk)', position: 'relative', overflow: 'hidden' }}>
                  <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${(Math.abs(r.pnl) / maxAbs) * 100}%`, background: r.pnl >= 0 ? 'var(--up)' : 'var(--down)', borderRadius: 2 }} />
                </span>
              </div>
            ))}
          </div>
          {list.length > 12 ? <button className="btn sm" onClick={() => setAll(!all)}>{all ? 'Tampilkan lebih sedikit' : `Tampilkan semua (${list.length})`}</button> : null}
          {chrono ? <p className="mute small">Urutan terbaru di atas. Trade dihitung pada {word} saat entry.</p> : null}
        </>
      ) : <p className="mute">Belum ada trade yang selesai.</p>}
    </div>
  );
}

/** Column chart of P/L per period (green above zero, red below). */
function PeriodBars({ rows }: { rows: Row[] }) {
  if (rows.length < 2) return null;
  const W = 360, H = 110, P = { l: 4, r: 4, t: 6, b: 6 };
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
  const hasNeg = rows.some((r) => r.pnl < 0), hasPos = rows.some((r) => r.pnl > 0);
  const zeroY = hasNeg && hasPos ? P.t + (H - P.t - P.b) / 2 : hasNeg ? P.t : H - P.b;
  const span = hasNeg && hasPos ? (H - P.t - P.b) / 2 : H - P.t - P.b;
  const bw = (W - P.l - P.r) / rows.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Grafik untung rugi per periode" style={{ display: 'block' }}>
      <line x1={P.l} x2={W - P.r} y1={zeroY} y2={zeroY} stroke="var(--line)" />
      {rows.map((r, i) => {
        const h = (Math.abs(r.pnl) / maxAbs) * span;
        return <rect key={r.key} x={P.l + i * bw + bw * 0.15} width={Math.max(1, bw * 0.7)} y={r.pnl >= 0 ? zeroY - h : zeroY} height={Math.max(r.pnl === 0 ? 0 : 1, h)} rx={Math.min(3, bw * 0.2)}
          fill={r.pnl >= 0 ? 'var(--up)' : 'var(--down)'}><title>{`${r.label}: ${money(r.pnl)} (${r.wins} menang, ${r.losses} kalah)`}</title></rect>;
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ PnL calendar */
type CalTab = 'day' | 'week' | 'month';
type Metric = 'pnl' | 'wl' | 'count';
interface Cell { pnl: number; wins: number; losses: number; trades: number }
const DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const MONTHS_FULL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const compact = (n: number, dollar = true) => {
  const a = Math.abs(n);
  const v = a >= 1000 ? `${Math.round(a / 1000)}k` : Math.round(a);
  return `${Math.round(a) === 0 ? '' : n > 0 ? '+' : '−'}${dollar ? '$' : ''}${v}`;
};

/** simple: compact header (Trade page). renderSelection: what to show for a tapped day/week/month (gets a matcher for entry times). */
export function PnlCalendar({ trades, tz, simple = false, renderSelection }: { trades: ClosedTrade[]; tz: string; simple?: boolean;
  renderSelection?: (match: (entryMs: number) => boolean, label: string) => React.ReactNode }) {
  const [tab, setTab] = useState<CalTab>('day');
  const [metric, setMetric] = useState<Metric>('pnl');
  const [sel, setSel] = useState<string | null>(null);

  // aggregate by local day / Monday-week / month (entry time, display timezone)
  const agg = useMemo(() => {
    const day = new Map<string, Cell>(), week = new Map<string, Cell>(), month = new Map<string, Cell>();
    const add = (m: Map<string, Cell>, k: string, t: ClosedTrade) => {
      const c = m.get(k) ?? { pnl: 0, wins: 0, losses: 0, trades: 0 };
      c.pnl += t.pnl; c.trades++; if (t.pnl > 0) c.wins++; else if (t.pnl < 0) c.losses++;
      m.set(k, c);
    };
    for (const t of trades) {
      const d = wall(t.entry, tz);
      const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate();
      add(day, `${Y}-${M}-${D}`, t);
      add(week, String(Date.UTC(Y, M, D - ((d.getUTCDay() + 6) % 7))), t);
      add(month, `${Y}-${M}`, t);
    }
    return { day, week, month };
  }, [trades, tz]);

  const months = useMemo(() => [...agg.month.keys()].map((k) => k.split('-').map(Number) as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), [agg]);
  const years = useMemo(() => [...new Set(months.map((m) => m[0]))], [months]);
  const last = months[months.length - 1] ?? [new Date().getUTCFullYear(), new Date().getUTCMonth()];
  const [ym, setYm] = useState<[number, number] | null>(null);
  const [Y, M] = ym ?? last;
  const mi = months.findIndex((m) => m[0] === Y && m[1] === M);
  const yi = years.indexOf(Y);

  // simple mode: free month / year stepping between the first trade and today; full mode: only periods that have trades
  const nowW = wall(Date.now(), tz), first = months[0] ?? [nowW.getUTCFullYear(), nowW.getUTCMonth()];
  const lastYM = Math.max(nowW.getUTCFullYear() * 12 + nowW.getUTCMonth(), last[0] * 12 + last[1]);
  const lastY = Math.floor(lastYM / 12), lastM = lastYM % 12;
  const shift = (dir: -1 | 1) => {
    setSel(null);
    if (simple) {
      if (tab === 'day') { const t = Y * 12 + M + dir; setYm([Math.floor(t / 12), ((t % 12) + 12) % 12]); }
      else setYm([Y + dir, M]);
      return;
    }
    if (tab === 'day') { const n = months[mi + dir]; if (n) setYm(n); }
    else { const y = years[yi + dir]; if (y !== undefined) setYm([y, months.filter((m) => m[0] === y).slice(-1)[0][1]]); }
  };
  const canPrev = simple ? (tab === 'day' ? Y * 12 + M > first[0] * 12 + first[1] : Y > first[0]) : tab === 'day' ? mi > 0 : yi > 0;
  const canNext = simple ? (tab === 'day' ? Y * 12 + M < lastY * 12 + lastM : Y < lastY) : tab === 'day' ? mi >= 0 && mi < months.length - 1 : yi >= 0 && yi < years.length - 1;

  const value = (c: Cell | undefined) => {
    if (!c) return null;
    // small day/week boxes: short numbers so nothing is cut off on narrow phones (exact $ shows when tapped)
    if (metric === 'pnl') return compact(c.pnl, tab === 'month');
    if (metric === 'count') return tab === 'month' ? `${c.trades} trade` : String(c.trades);
    return <><span className="pos">{c.wins}</span>/<span className="neg">{c.losses}</span></>;
  };
  const tone = (c: Cell | undefined) => (!c ? 'empty' : c.pnl > 0 ? 'up' : c.pnl < 0 ? 'down' : 'flat');

  // cells for the current view
  type V = { key: string; title: string; label: string; cell?: Cell; blank?: boolean };
  let view: V[] = [];
  let periodCells: Cell[] = [];
  if (tab === 'day') {
    const first = new Date(Date.UTC(Y, M, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate();
    view = Array.from({ length: lead }, (_, i) => ({ key: `b${i}`, title: '', label: '', blank: true }));
    for (let d = 1; d <= days; d++) {
      const k = `${Y}-${M}-${d}`;
      const dow = DAYS[new Date(Date.UTC(Y, M, d)).getUTCDay()];
      view.push({ key: k, title: String(d), label: `${dow}, ${d} ${MONTHS_FULL[M]} ${Y}`, cell: agg.day.get(k) });
    }
  } else if (tab === 'week') {
    const start = Date.UTC(Y, 0, 1), end = Date.UTC(Y + 1, 0, 1);
    let w = start - (((new Date(start).getUTCDay() + 6) % 7) * 86_400_000);
    let n = 1;
    for (; w < end; w += 7 * 86_400_000, n++) {
      const d = new Date(w);
      view.push({ key: String(w), title: `M${n}`, label: `Minggu ${n} · mulai ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, cell: agg.week.get(String(w)) });
    }
  } else {
    for (let m = 0; m < 12; m++) view.push({ key: `${Y}-${m}`, title: MONTHS[m], label: `${MONTHS_FULL[m]} ${Y}`, cell: agg.month.get(`${Y}-${m}`) });
  }
  periodCells = view.map((v) => v.cell).filter((c): c is Cell => !!c);
  const tot = periodCells.reduce((a, c) => ({ pnl: a.pnl + c.pnl, wins: a.wins + c.wins, losses: a.losses + c.losses, trades: a.trades + c.trades }), { pnl: 0, wins: 0, losses: 0, trades: 0 });
  const upN = periodCells.filter((c) => c.pnl > 0).length, downN = periodCells.filter((c) => c.pnl < 0).length;
  const unit = tab === 'day' ? 'hari' : tab === 'week' ? 'minggu' : 'bulan';
  const selected = view.find((v) => v.key === sel);
  const heading = tab === 'day' ? `${MONTHS_FULL[M]} ${Y}` : String(Y);

  if (!trades.length) return <p className="mute">Belum ada trade yang selesai.</p>;
  return (
    <div className="stack">
      {simple ? <>
        <div className="cal-top"><h2>Kalender PnL</h2><strong className={tot.pnl > 0 ? 'pos' : tot.pnl < 0 ? 'neg' : 'mute'}>{`${tot.pnl < 0 ? '−' : tot.pnl > 0 ? '+' : ''}$${Math.abs(tot.pnl).toFixed(2)}`}</strong></div>
        <Seg full label="Periode" options={[['day', 'Harian'], ['week', 'Mingguan'], ['month', 'Bulanan']] as const} value={tab} onChange={(k) => { setTab(k as CalTab); setSel(null); }} />
        <div className="cal-nav">
          <button className="cal-arrow" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Sebelumnya">‹</button>
          <div className="cal-title"><strong>{heading}</strong></div>
          <button className="cal-arrow" onClick={() => shift(1)} disabled={!canNext} aria-label="Berikutnya">›</button>
        </div>
      </> : <>
      <div className="tabs" role="tablist">
        {([['day', simple ? 'Harian' : 'PnL Harian'], ['week', 'Mingguan'], ['month', 'Bulanan']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSel(null); }}>{l}</button>
        ))}
      </div>

      <div className="row between">
        <div className="row" style={{ gap: 4 }}>
          <button className="btn sm" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Sebelumnya">‹</button>
          {tab === 'day' ? (
            <select value={`${Y}-${M}`} onChange={(e) => { const [a, b] = e.target.value.split('-').map(Number); setYm([a, b]); setSel(null); }} style={{ width: 'auto', minHeight: 34, padding: '4px 30px 4px 10px', fontWeight: 700 }} aria-label="Bulan">
              {months.map(([a, b]) => <option key={`${a}-${b}`} value={`${a}-${b}`}>{MONTHS[b]} {a}</option>)}
            </select>
          ) : (
            <select value={Y} onChange={(e) => { const y = Number(e.target.value); setYm([y, months.filter((m) => m[0] === y).slice(-1)[0][1]]); setSel(null); }} style={{ width: 'auto', minHeight: 34, padding: '4px 30px 4px 10px', fontWeight: 700 }} aria-label="Tahun">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          <button className="btn sm" onClick={() => shift(1)} disabled={!canNext} aria-label="Berikutnya">›</button>
        </div>
        {<select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} style={{ width: 'auto', minHeight: 34, padding: '4px 30px 4px 10px' }} aria-label="Tampilkan">
          <option value="pnl">PnL</option>
          <option value="wl">Menang/Kalah</option>
          <option value="count">Jumlah trade</option>
        </select>}
      </div>

      </>}
      {simple ? null : <p className="small">
        <strong>{heading}:</strong> <span className={tot.pnl > 0 ? 'pos' : tot.pnl < 0 ? 'neg' : ''} style={{ fontWeight: 700 }}>{money(tot.pnl)}</span>
        {' '}· {tot.trades} trade · <span className="pos">{tot.wins} menang</span> · <span className="neg">{tot.losses} kalah</span>
      </p>}

      <div className={simple ? 'cal-simple' : undefined} style={{ display: 'contents' }}>
      {tab === 'day' ? <div className="cal dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div> : null}
      <div className={`cal ${tab}`}>
        {view.map((v) => v.blank ? <span key={v.key} /> : (
          <button key={v.key} className={`cell ${tone(v.cell)}`} aria-pressed={sel === v.key} onClick={() => setSel(sel === v.key ? null : v.key)} aria-label={v.label}>
            <span className="n">{v.title}</span>
            <span className="v">{value(v.cell) ?? ''}</span>
          </button>
        ))}
      </div>
      </div>

      {selected && renderSelection ? (
        <div className="cal-pick">
          <div className="cal-pick-head"><strong>{selected.label}</strong>{selected.cell ? <span className={selected.cell.pnl > 0 ? 'pos' : selected.cell.pnl < 0 ? 'neg' : 'mute'}>{`${selected.cell.pnl < 0 ? '−' : selected.cell.pnl > 0 ? '+' : ''}$${Math.abs(selected.cell.pnl).toFixed(2)}`}</span> : null}</div>
          {selected.cell ? renderSelection((ms) => {
            const d = wall(ms, tz), y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate();
            const k = tab === 'day' ? `${y}-${m}-${dd}` : tab === 'week' ? String(Date.UTC(y, m, dd - ((d.getUTCDay() + 6) % 7))) : `${y}-${m}`;
            return k === sel;
          }, selected.label) : <p className="mute small" style={{ margin: 0 }}>Tidak ada trade.</p>}
        </div>
      ) : selected ? (
        <div className="notice">
          <strong>{selected.label}</strong><br />
          {selected.cell
            ? <>{selected.cell.trades} trade · <span className="pos">{selected.cell.wins} menang</span> · <span className="neg">{selected.cell.losses} kalah</span> · <strong className={selected.cell.pnl >= 0 ? 'pos' : 'neg'}>{money(selected.cell.pnl)}</strong></>
            : 'Tidak ada trade.'}
        </div>
      ) : null}
    </div>
  );
}
