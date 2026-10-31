'use client';
import { useMemo, useState } from 'react';
import { sessionOf, tzOffsetMinutes } from '@/lib/core/time';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ClosedTrade { entry: number; exit: number; pnl: number; side: string }

export function closedTrades(rows: any[]): ClosedTrade[] {
  return rows
    .filter((t) => t.pnl != null && t.exit_ms != null)
    .map((t) => ({ entry: Number(t.entry_ms), exit: Number(t.exit_ms), pnl: Number(t.pnl), side: String(t.side) }))
    .sort((a, b) => a.exit - b.exit);
}

const money = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n) >= 1000 ? `${(Math.abs(n) / 1000).toFixed(1)}k` : Math.round(Math.abs(n))}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Wall-clock Date (read with getUTC*) in the display timezone. */
const wall = (ms: number, tz: string) => new Date(ms + tzOffsetMinutes(ms, tz) * 60_000);
const dmy = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/* ------------------------------------------------------------------ equity line */
export function EquityChart({ trades, tz }: { trades: ClosedTrade[]; tz: string }) {
  const pts = useMemo(() => {
    let eq = 0;
    return [{ t: trades[0]?.entry ?? 0, v: 0 }, ...trades.map((x) => ({ t: x.exit, v: (eq += x.pnl) }))];
  }, [trades]);
  if (trades.length < 2) return <p className="mute small">Butuh minimal 2 trade untuk menggambar grafik.</p>;
  const W = 360, H = 190, P = { l: 44, r: 8, t: 10, b: 22 };
  const vs = pts.map((p) => p.v);
  let lo = Math.min(0, ...vs), hi = Math.max(0, ...vs);
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const x = (i: number) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const end = pts[pts.length - 1].v;
  const color = end >= 0 ? 'var(--up)' : 'var(--down)';
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad];
  // deepest drawdown segment (peak → trough)
  let peakI = 0, best = { from: 0, to: 0, dd: 0 }, curPeak = 0;
  pts.forEach((p, i) => { if (p.v > pts[curPeak].v) curPeak = i; const dd = pts[curPeak].v - p.v; if (dd > best.dd) { best = { from: curPeak, to: i, dd }; peakI = curPeak; } });
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Grafik saldo: akhir ${money(end)}`} style={{ display: 'block' }}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--mute)">{short(v)}</text>
          </g>
        ))}
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="var(--mute)" strokeWidth="1" strokeDasharray="4 4" />
        {best.dd > 0 ? <rect x={x(peakI)} y={P.t} width={Math.max(1, x(best.to) - x(peakI))} height={H - P.t - P.b} fill="var(--down)" opacity="0.06" /> : null}
        <path d={area} fill={color} opacity="0.08" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx={x(pts.length - 1)} cy={y(end)} r="3" fill={color} />
        <text x={P.l} y={H - 6} fontSize="11" fill="var(--mute)">{dmy(wall(pts[0].t, tz))}</text>
        <text x={W - P.r} y={H - 6} fontSize="11" fill="var(--mute)" textAnchor="end">{dmy(wall(pts[pts.length - 1].t, tz))}</text>
      </svg>
      <figcaption className="mute small" style={{ marginTop: 6 }}>
        Garis = saldo untung/rugi setelah setiap trade ditutup. Area merah tipis = penurunan terdalam ({money(-best.dd)}).
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

function bucket(t: ClosedTrade, mode: Mode, tz: string): { key: string; sort: number; label: string } {
  const d = wall(t.entry, tz);
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
    case 'session': { const s = sessionOf(t.entry); return { key: s, sort: SESSION_ORDER.indexOf(s), label: SESSION[s] ?? s }; }
  }
}

export function PeriodBreakdown({ trades, tz }: { trades: ClosedTrade[]; tz: string }) {
  const [mode, setMode] = useState<Mode>('week');
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    for (const t of trades) {
      const b = bucket(t, mode, tz);
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
