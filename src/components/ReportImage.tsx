'use client';
import { useState } from 'react';
import { sessionOf, tzOffsetMinutes } from '@/lib/core/time';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Builds a long PNG report of a backtest result entirely in the browser (Canvas 2D, no libraries),
 * so it can be saved to Photos and shared. Every number is computed from the same trades/sessions the page shows.
 */
export interface ReportInput {
  title: string;               // e.g. "2019 · RR 1:2" or "Semua tahun · RR 1:2"
  symbol?: string;             // pair label, e.g. "EURUSD" (default XAUUSD)
  strategyLabel: string;       // e.g. "Breakout v0.2 · H1 + London + New York · BUY+SELL"
  rules: string;               // one line describing entry/SL
  rr: number;
  riskUsd: number | null;
  costs: Record<string, any> | null;
  metrics: any;                // computeMetrics() result
  trades: Array<{ entry_ms: any; exit_ms: any; pnl: any; side: any; exit_reason: any }>;
  yearRows: Array<{ label: string; cells: any[] }>; // all years × RR summaries
  rrOf: (s: any) => number;
  tz: string;
}

const C = { bg: '#f2f4f7', card: '#ffffff', ink: '#1b2433', ink2: '#475467', mute: '#8a94a6', line: '#e4e7ec', up: '#12805c', upT: '#e7f5ef', down: '#c2410c', downT: '#fdeee6', gold: '#a87a1f', sunk: '#f7f8fa' };
const FONT = "-apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', sans-serif";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const money = (n: number, dec = 2) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
const tone = (n: number) => (n > 0 ? C.up : n < 0 ? C.down : C.ink2);
const tint = (n: number) => (n > 0 ? C.upT : n < 0 ? C.downT : C.sunk);
const wall = (ms: number, tz: string) => new Date(ms + tzOffsetMinutes(ms, tz) * 60_000);

const fmtH = (h: number | null | undefined) => (h == null ? '—' : h < 48 ? `${h < 10 ? h.toFixed(1).replace('.', ',') : Math.round(h)} jam` : `${(h / 24).toFixed(1).replace('.', ',')} hari`);

export function buildReport(r: ReportInput): HTMLCanvasElement {
  const W = 1080, P = 56, IW = W - P * 2;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = 9000;
  const g = cv.getContext('2d')!;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, cv.height);
  g.textBaseline = 'alphabetic';
  let y = P;

  const font = (size: number, weight = 500) => { g.font = `${weight} ${size}px ${FONT}`; };
  const text = (s: string, x: number, yy: number, size: number, color = C.ink, weight = 500, align: CanvasTextAlign = 'left') => {
    font(size, weight); g.fillStyle = color; g.textAlign = align; g.fillText(s, x, yy);
  };
  const rrect = (x: number, yy: number, w: number, h: number, rad: number, fill: string, stroke?: string) => {
    g.beginPath();
    g.moveTo(x + rad, yy); g.arcTo(x + w, yy, x + w, yy + h, rad); g.arcTo(x + w, yy + h, x, yy + h, rad);
    g.arcTo(x, yy + h, x, yy, rad); g.arcTo(x, yy, x + w, yy, rad); g.closePath();
    g.fillStyle = fill; g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
  };
  const card = (h: number) => { rrect(P, y, IW, h, 24, C.card, C.line); };
  const heading = (s: string) => { text(s, P + 32, y + 52, 30, C.ink, 700); };

  const closed = r.trades.filter((t) => t.pnl != null && t.exit_ms != null)
    .map((t) => ({ entry: Number(t.entry_ms), exit: Number(t.exit_ms), pnl: Number(t.pnl), side: String(t.side), reason: String(t.exit_reason) }))
    .sort((a, b) => a.exit - b.exit);
  const m = r.metrics;

  // ---------- header
  rrect(P, y, 52, 52, 12, C.gold);
  text('Au', P + 26, y + 34, 22, '#fff', 800, 'center');
  text(`Laporan Backtest ${r.symbol ?? 'XAUUSD'}`, P + 72, y + 38, 40, C.ink, 700);
  y += 92;
  text(r.strategyLabel, P, y, 26, C.ink2, 600);
  y += 36;
  text(r.title, P, y, 26, C.ink2, 600);
  y += 38;
  const made = wall(Date.now(), r.tz);
  text(`Risiko ${r.riskUsd ? `$${r.riskUsd}` : 'lot tetap'} per trade  ·  dibuat ${made.getUTCDate()} ${MONTHS[made.getUTCMonth()]} ${made.getUTCFullYear()}`, P, y, 22, C.mute);
  y += 36;

  // ---------- verdict
  const total = m?.totalPnl ?? 0;
  card(330);
  text('Hasil bersih', P + 32, y + 52, 24, C.mute, 600);
  text(money(total), P + 32, y + 150, 96, tone(total), 800);
  text(`${m.totalTrades} trade  ·  ${m.wins} menang  ·  ${m.losses} kalah`, P + 32, y + 206, 30, C.ink, 600);
  const barY = y + 236, bw = IW - 64;
  rrect(P + 32, barY, bw, 18, 9, C.down);
  if (m.wins) rrect(P + 32, barY, Math.max(18, bw * (m.wins / Math.max(1, m.totalTrades))), 18, 9, C.up);
  const be = Math.round(100 / (1 + r.rr));
  text(`Win rate ${(m.winRate * 100).toFixed(1)}%`, P + 32, y + 294, 24, C.ink2, 600);
  text(`RR 1:${r.rr} butuh ≥ ${be}% agar impas`, P + IW - 32, y + 294, 24, (m.winRate * 100) >= be ? C.up : C.down, 600, 'right');
  y += 330 + 24;

  // ---------- facts
  const facts: Array<[string, string, string]> = [
    ['Rata-rata menang', m.wins ? money(m.grossProfit / m.wins) : '—', C.up],
    ['Rata-rata kalah', m.losses ? money(-m.grossLoss / m.losses) : '—', C.down],
    ['Turun terdalam', money(-m.maxDrawdown), C.down],
    ['Profit factor', m.profitFactor == null ? '—' : m.profitFactor.toFixed(2), C.ink],
    ['Menang beruntun', `${m.maxConsecutiveWins}×`, C.ink],
    ['Kalah beruntun', `${m.maxConsecutiveLosses}×`, C.ink],
  ];
  card(250);
  facts.forEach(([k, v, col], i) => {
    const cx = P + 32 + (i % 3) * ((IW - 64) / 3), cy = y + 60 + Math.floor(i / 3) * 104;
    text(k, cx, cy, 22, C.mute, 600);
    text(v, cx, cy + 44, 34, col, 700);
  });
  y += 250 + 24;

  // ---------- equity curve
  if (closed.length > 1) {
    card(470);
    heading('Grafik saldo');
    const cx = P + 110, cw = IW - 150, cy = y + 90, ch = 300;
    let eq = 0;
    const pts = [0, ...closed.map((t) => (eq += t.pnl))];
    let lo = Math.min(0, ...pts), hi = Math.max(0, ...pts);
    if (hi - lo < 1) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const X = (i: number) => cx + (i / (pts.length - 1)) * cw;
    const Y = (v: number) => cy + (1 - (v - lo) / (hi - lo)) * ch;
    [hi - pad, (hi + lo) / 2, lo + pad].forEach((v) => {
      g.strokeStyle = C.line; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, Y(v)); g.lineTo(cx + cw, Y(v)); g.stroke();
      text(money(v, 0), cx - 14, Y(v) + 8, 20, C.mute, 500, 'right');
    });
    g.setLineDash([8, 8]); g.strokeStyle = C.mute; g.beginPath(); g.moveTo(cx, Y(0)); g.lineTo(cx + cw, Y(0)); g.stroke(); g.setLineDash([]);
    const col = eq >= 0 ? C.up : C.down;
    g.beginPath(); pts.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.lineTo(X(pts.length - 1), Y(0)); g.lineTo(X(0), Y(0)); g.closePath();
    g.fillStyle = eq >= 0 ? 'rgba(18,128,92,.08)' : 'rgba(194,65,12,.08)'; g.fill();
    g.beginPath(); pts.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.strokeStyle = col; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();
    const d0 = wall(closed[0].entry, r.tz), d1 = wall(closed[closed.length - 1].exit, r.tz);
    text(`${d0.getUTCDate()} ${MONTHS[d0.getUTCMonth()]} ${d0.getUTCFullYear()}`, cx, cy + ch + 40, 20, C.mute);
    text(`${d1.getUTCDate()} ${MONTHS[d1.getUTCMonth()]} ${d1.getUTCFullYear()}`, cx + cw, cy + ch + 40, 20, C.mute, 500, 'right');
    y += 470 + 24;
  }

  // ---------- all years × RR
  if (r.yearRows.length) {
    const rows = [...r.yearRows].sort((a, b) => a.label.localeCompare(b.label));
    const rowH = 76, h = 120 + rows.length * rowH + 24;
    card(h);
    heading('Semua hasil per tahun');
    const colX = [P + 32, P + 220, P + 220 + (IW - 252) / 3, P + 220 + ((IW - 252) / 3) * 2];
    const colW = (IW - 252) / 3 - 12;
    ['Tahun', 'RR 1:1', 'RR 1:2', 'RR 1:3'].forEach((s, i) => text(s, i ? colX[i] + colW / 2 : colX[i], y + 100, 22, C.mute, 700, i ? 'center' : 'left'));
    rows.forEach((row, ri) => {
      const ry = y + 116 + ri * rowH;
      text(row.label, colX[0], ry + 46, 28, C.ink, 700);
      [1, 2, 3].forEach((x, ci) => {
        const s = row.cells.find((c: any) => r.rrOf(c) === x);
        const bx = colX[ci + 1];
        if (!s) { text('—', bx + colW / 2, ry + 46, 26, C.mute, 500, 'center'); return; }
        const p = Number(s.pnl ?? 0), tr = Number(s.trades ?? 0), wr = tr ? Math.round((Number(s.wins ?? 0) / tr) * 100) : 0;
        rrect(bx, ry + 4, colW, rowH - 10, 14, tint(p), x === r.rr ? C.ink : undefined);
        text(money(p, 0), bx + colW / 2, ry + 36, 26, tone(p), 700, 'center');
        text(`${tr} trade · ${wr}%`, bx + colW / 2, ry + 60, 18, C.ink2, 500, 'center');
      });
    });
    y += h + 24;
  }

  // ---------- monthly heatmap (years × months) for this result
  if (closed.length) {
    const byYM = new Map<string, number>();
    const years = new Set<number>();
    for (const t of closed) { const d = wall(t.entry, r.tz); years.add(d.getUTCFullYear()); const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`; byYM.set(k, (byYM.get(k) ?? 0) + t.pnl); }
    const ys = [...years].sort();
    const rowH = 62, h = 130 + ys.length * rowH + 24;
    card(h);
    heading('Untung/rugi per bulan');
    const x0 = P + 120, cw = (IW - 120 - 32 - 110) / 12;
    MONTHS.forEach((mm, i) => text(mm, x0 + i * cw + cw / 2, y + 104, 18, C.mute, 700, 'center'));
    text('Total', P + IW - 32, y + 104, 18, C.mute, 700, 'right');
    ys.forEach((yy, ri) => {
      const ry = y + 118 + ri * rowH;
      text(String(yy), P + 32, ry + 38, 24, C.ink, 700);
      let tot = 0;
      for (let mi = 0; mi < 12; mi++) {
        const v = byYM.get(`${yy}-${mi}`);
        const bx = x0 + mi * cw;
        if (v == null) { rrect(bx + 2, ry + 4, cw - 4, rowH - 10, 10, C.sunk); continue; }
        tot += v;
        rrect(bx + 2, ry + 4, cw - 4, rowH - 10, 10, tint(v));
        text(Math.abs(v) >= 1000 ? `${v < 0 ? '−' : '+'}${(Math.abs(v) / 1000).toFixed(1)}k` : `${v < 0 ? '−' : '+'}${Math.round(Math.abs(v))}`, bx + cw / 2, ry + 36, 17, tone(v), 700, 'center');
      }
      text(money(tot, 0), P + IW - 32, ry + 38, 22, tone(tot), 700, 'right');
    });
    y += h + 24;
  }

  // ---------- weekday & session
  if (closed.length) {
    const group = (keyOf: (t: typeof closed[number]) => string, order: string[]) => order.map((k) => {
      const ts = closed.filter((t) => keyOf(t) === k);
      const w = ts.filter((t) => t.pnl > 0).length;
      return { k, n: ts.length, w, l: ts.filter((t) => t.pnl < 0).length, p: ts.reduce((a, t) => a + t.pnl, 0) };
    }).filter((x) => x.n);
    const wd = group((t) => DAYS[wall(t.entry, r.tz).getUTCDay()], ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']);
    const SES: Record<string, string> = { asia: 'Asia', london: 'London', new_york: 'New York', off: 'Di luar sesi' };
    const se = group((t) => SES[sessionOf(t.entry)] ?? 'Lainnya', ['Asia', 'London', 'New York', 'Di luar sesi']);
    const sideG = group((t) => (t.side === 'long' ? 'BUY' : 'SELL'), ['BUY', 'SELL']);
    const block = (title: string, rows: typeof wd) => {
      const rowH = 54, h = 120 + rows.length * rowH + 16;
      card(h);
      heading(title);
      const cols = [P + 32, P + 330, P + 520, P + 700, P + IW - 32];
      ['', 'Trade', 'Menang', 'Kalah', 'Untung/rugi'].forEach((s, i) => text(s, cols[i], y + 100, 20, C.mute, 700, i === 4 ? 'right' : 'left'));
      rows.forEach((x, i) => {
        const ry = y + 112 + i * rowH;
        g.fillStyle = C.line; g.fillRect(P + 32, ry, IW - 64, 2);
        text(x.k, cols[0], ry + 38, 24, C.ink, 700);
        text(String(x.n), cols[1], ry + 38, 24, C.ink2);
        text(`${x.w} (${Math.round((x.w / x.n) * 100)}%)`, cols[2], ry + 38, 24, C.up, 600);
        text(String(x.l), cols[3], ry + 38, 24, C.down, 600);
        text(money(x.p), cols[4], ry + 38, 24, tone(x.p), 700, 'right');
      });
      y += h + 24;
    };
    block('Per hari', wd);
    block('Per sesi pasar', se);
    block('BUY vs SELL', sideG);
  }

  // ---------- settings & footer
  const cc = r.costs ?? {};
  card(236);
  heading('Pengaturan backtest');
  const lines = [
    r.rules,
    `Spread ${cc.spread ?? '—'} · slippage ${cc.slippage ?? '—'} · komisi $${cc.commissionPerUnit ?? '—'}/lot · swap BUY $${cc.swapLong ?? 0} / SELL $${cc.swapShort ?? 0} per lot per malam · TP & SL di 1 candle: ${cc.ambiguityPolicy === 'best' ? 'dihitung TP' : cc.ambiguityPolicy === 'skip' ? 'dilewati' : 'dihitung SL'}`,
    r.metrics?.avgHoldHours != null ? `Lama posisi rata-rata ${fmtH(r.metrics.avgHoldHours)} · sampai TP ${fmtH(r.metrics.avgHoldWinHours)} · sampai SL ${fmtH(r.metrics.avgHoldLossHours)}` : '',
    r.metrics?.maxOpenPositions != null ? `Posisi terbuka bersamaan paling banyak ${r.metrics.maxOpenPositions}` : '',
    `Waktu ditampilkan dalam zona ${r.tz}. Hasil simulasi historis, bukan jaminan profit.`,
  ];
  lines.forEach((s, i) => text(s, P + 32, y + 100 + i * 34, 19, i === lines.length - 1 ? C.mute : C.ink2));
  y += 236 + P;

  const out = document.createElement('canvas');
  out.width = W; out.height = Math.min(y, cv.height);
  out.getContext('2d')!.drawImage(cv, 0, 0);
  return out;
}

/** Button: builds the PNG and opens the iOS share sheet ("Simpan Gambar"), or downloads it elsewhere. */
export function ReportButton({ make, filename }: { make: () => ReportInput | null; filename: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    const input = make();
    if (!input) return;
    setBusy(true); setMsg(null);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const canvas = buildReport(input);
      const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Gagal membuat gambar'))), 'image/png'));
      const file = new File([blob], filename, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: 'Laporan backtest' }).catch(() => {});
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      setMsg('Gambar siap. Pilih "Simpan Gambar" untuk menyimpan ke Foto.');
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="stack tight">
      <button className="btn block" onClick={go} disabled={busy}>{busy ? 'Membuat gambar…' : 'Unduh laporan (gambar)'}</button>
      {msg ? <p className="mute small">{msg}</p> : null}
    </div>
  );
}
