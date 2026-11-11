'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JournalTrade } from '@/lib/core/journal';

/* Kantor (11 Nov 2026): an isometric pixel-art office where every "employee" is one of our bots / EA methods.
 * Everything they do follows real data from /api/journal:
 *  - ALT (bot SELL alts) and BIG (bot BUY big coins): at the desk with open positions (P&L tag), monitoring, short coffee
 *    breaks when nothing is open, asleep at the desk when the bot stopped reporting (> 35 min).
 *  - XAU and NAS (MT5 EA): same, and off on weekends (MT5 closed).
 *  - Penjaga (watchdog): "AMAN" or "ALARM" when something is silent. Bos (you): the owner.
 * Drawn on a small canvas (pixel art, scaled up) with crisp HTML name tags on top. */

type Live = { wallet: number; upnl: number; at: number; pos?: Record<string, number> } | null | undefined;
export interface OfficeData { trades: JournalTrade[]; binance?: Live; mt5?: Live }

const W = 252, H = 196, TW = 16, TH = 8;           // logical canvas (shown ~1.4x on a phone), half tile sizes
const NX = 8, NY = 7;                               // room size in tiles
const OX = 4 + NY * TW, OY = 72;                    // screen position of tile (0,0)
const iso = (x: number, y: number, z = 0) => [OX + (x - y) * TW, OY + (x + y) * TH - z] as const;
const SILENT = 35 * 60_000;

type Spot = { x: number; y: number };
interface Person {
  id: string; name: string; role: string; desk: Spot; rest: Spot;
  hair: string; skin: string; shirt: string; pants: string; hairStyle: 'short' | 'long' | 'cap' | 'bun';
}
const PEOPLE: Person[] = [
  { id: 'alt', name: 'ALT', role: 'SELL ALTCOIN', desk: { x: 0.9, y: 1.0 }, rest: { x: 5.7, y: 3.3 }, hair: '#3b2a1f', skin: '#f1c7a0', shirt: '#e5484d', pants: '#2c3e66', hairStyle: 'short' },
  { id: 'big', name: 'BIG', role: 'BUY KOIN BESAR', desk: { x: 4.1, y: 0.9 }, rest: { x: 5.9, y: 3.9 }, hair: '#1b1b1b', skin: '#d9a477', shirt: '#2fb67c', pants: '#3d3d3d', hairStyle: 'cap' },
  { id: 'xau', name: 'XAU', role: 'EA EMAS', desk: { x: 0.9, y: 4.0 }, rest: { x: 5.6, y: 5.4 }, hair: '#c9772f', skin: '#f3cfae', shirt: '#f0b429', pants: '#5b4a3a', hairStyle: 'long' },
  { id: 'nas', name: 'NAS', role: 'EA NASDAQ', desk: { x: 4.1, y: 3.9 }, rest: { x: 6.1, y: 5.8 }, hair: '#4a3426', skin: '#e8b98f', shirt: '#4c7dff', pants: '#2a2a2a', hairStyle: 'bun' },
  { id: 'jaga', name: 'Penjaga', role: 'WATCHDOG', desk: { x: 6.6, y: 1.3 }, rest: { x: 6.6, y: 1.3 }, hair: '#222', skin: '#c99064', shirt: '#33415c', pants: '#1f2a3a', hairStyle: 'cap' },
  { id: 'bos', name: 'Bos', role: 'PEMILIK', desk: { x: 1.0, y: 6.3 }, rest: { x: 1.0, y: 6.3 }, hair: '#111', skin: '#e2b088', shirt: '#f5f5f5', pants: '#30343b', hairStyle: 'short' },
];

type Status = { label: string; color: string; atDesk: boolean; sleep: boolean; tag?: { text: string; color: string } | null };
const money = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`;
const weekendMt5 = (t: number) => { const d = new Date(t), wd = d.getUTCDay(), h = d.getUTCHours(); return wd === 6 || (wd === 0 && h < 22) || (wd === 5 && h >= 21); };

function statuses(data: OfficeData, now: number, breakPhase: boolean): Record<string, Status> {
  const open = data.trades.filter((t) => t.result === 'open');
  const coin = (t: JournalTrade) => (/Bot Binance ([0-9A-Z]+)/.exec(t.note ?? '')?.[1] ?? '').replace(/USDT$/, '');
  const bOn = !!data.binance && now - data.binance.at < SILENT, mOn = !!data.mt5 && now - data.mt5.at < SILENT;
  const recent = (key: string) => data.trades.filter((t) => t.strategy === key && t.result !== 'open' && t.closedAt && now - t.closedAt < 15 * 60_000).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0];
  const one = (key: string, online: boolean, live: Live, closed: boolean, posKey: (t: JournalTrade) => string): Status => {
    const mine = open.filter((t) => t.strategy === key);
    const r = recent(key);
    const flash = r ? { text: `${r.result === 'tp' ? '🎉 TP' : r.result === 'sl' ? 'SL' : 'TUTUP'} ${coin(r)} ${money(Number(r.pnl ?? 0))}`, color: Number(r.pnl) >= 0 ? '#2ee59d' : '#ff6b6b' } : null;
    if (!live) return { label: 'BELUM AKTIF', color: '#8a8f98', atDesk: false, sleep: false, tag: null };
    if (!online) return { label: 'OFFLINE', color: '#ff5a5f', atDesk: true, sleep: true, tag: flash };
    if (mine.length) {
      const sum = mine.reduce((a, t) => a + (live.pos?.[posKey(t)] ?? 0), 0);
      return { label: `POSISI ×${mine.length}`, color: '#2ee59d', atDesk: true, sleep: false, tag: flash ?? { text: `${mine.map((t) => coin(t) || (t.side === 'BUY' ? 'BUY' : 'SELL')).join(' · ')}  ${money(sum)}`, color: sum >= 0 ? '#2ee59d' : '#ff6b6b' } };
    }
    if (closed) return { label: 'LIBUR', color: '#a78bfa', atDesk: false, sleep: false, tag: flash };
    return breakPhase ? { label: 'ISTIRAHAT', color: '#f5b83d', atDesk: false, sleep: false, tag: flash } : { label: 'MEMANTAU', color: '#58a6ff', atDesk: true, sleep: false, tag: flash };
  };
  const altS = one('snr', bOn, data.binance, false, (t) => `${coin(t)}USDT`);
  const bigS = one('btc', bOn, data.binance, false, (t) => `${coin(t)}USDT`);
  const wk = weekendMt5(now);
  const xauS = one('v2', mOn, data.mt5, wk, () => 'xau');
  const nasS = one('nas', mOn, data.mt5, wk, () => 'nas');
  const silent = (data.binance && !bOn) || (data.mt5 && !mOn && !wk);
  return {
    alt: altS, big: bigS, xau: xauS, nas: nasS,
    jaga: silent ? { label: 'ALARM', color: '#ff5a5f', atDesk: true, sleep: false, tag: { text: '⚠ ada yang diam', color: '#ff6b6b' } } : { label: 'AMAN', color: '#2ee59d', atDesk: true, sleep: false, tag: null },
    bos: { label: 'SIAGA', color: '#58a6ff', atDesk: true, sleep: false, tag: null },
  };
}

/* ---------- pixel drawing ---------- */
function poly(c: CanvasRenderingContext2D, pts: ReadonlyArray<readonly [number, number]>, fill: string) {
  c.fillStyle = fill; c.beginPath(); c.moveTo(Math.round(pts[0][0]), Math.round(pts[0][1]));
  for (const p of pts.slice(1)) c.lineTo(Math.round(p[0]), Math.round(p[1]));
  c.closePath(); c.fill();
}
/** iso box: x,y tile position, w,d size in tiles, z bottom height, h height in px */
function box(c: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, z: number, h: number, top: string, left: string, right: string) {
  const a = iso(x, y, z + h), b = iso(x + w, y, z + h), cc = iso(x + w, y + d, z + h), dd = iso(x, y + d, z + h);
  const b0 = iso(x + w, y, z), c0 = iso(x + w, y + d, z), d0 = iso(x, y + d, z);
  poly(c, [dd, cc, c0, d0], left);
  poly(c, [b, cc, c0, b0], right);
  poly(c, [a, b, cc, dd], top);
}
function desk(c: CanvasRenderingContext2D, x: number, y: number, glow: string) {
  box(c, x, y, 1.8, 0.9, 0, 14, '#eef1f4', '#c9ced6', '#dde1e7');                   // desk
  box(c, x + 0.25, y + 0.15, 0.55, 0.1, 14, 10, '#2a2f38', '#1f232a', '#2a2f38');     // monitor 1
  box(c, x + 0.95, y + 0.15, 0.55, 0.1, 14, 10, '#2a2f38', '#1f232a', '#2a2f38');     // monitor 2
  const s1 = iso(x + 0.3, y + 0.25, 22), s2 = iso(x + 1.0, y + 0.25, 22);
  c.fillStyle = glow; c.fillRect(Math.round(s1[0]) - 1, Math.round(s1[1]), 7, 5); c.fillRect(Math.round(s2[0]) - 1, Math.round(s2[1]), 7, 5);
  box(c, x + 0.5, y + 0.55, 0.7, 0.2, 14, 1, '#3a404a', '#30353e', '#30353e');        // keyboard
}
function plant(c: CanvasRenderingContext2D, x: number, y: number) {
  box(c, x, y, 0.45, 0.45, 0, 7, '#d8d8d8', '#b5b5b5', '#c7c7c7');
  const p = iso(x + 0.22, y + 0.22, 8);
  c.fillStyle = '#2f8f46'; c.fillRect(p[0] - 5, p[1] - 12, 10, 12); c.fillStyle = '#3fb35b'; c.fillRect(p[0] - 3, p[1] - 16, 6, 6); c.fillRect(p[0] - 7, p[1] - 8, 3, 4); c.fillRect(p[0] + 4, p[1] - 9, 3, 4);
}
function person(c: CanvasRenderingContext2D, p: Person, x: number, y: number, frame: number, walking: boolean, sleep: boolean, typing: boolean) {
  const [sx, sy] = iso(x, y, 0); const X = Math.round(sx), Y = Math.round(sy);
  const R = (dx: number, dy: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(X + dx, Y + dy, w, h); };
  R(-4, -1, 9, 2, 'rgba(0,0,0,.18)');                                   // shadow
  const step = walking ? (frame % 2 ? 1 : -1) : 0;
  R(-3, -7 + (step > 0 ? -1 : 0), 3, 7, p.pants); R(1, -7 + (step < 0 ? -1 : 0), 3, 7, p.pants);   // legs
  R(-3, -1, 3, 1, '#222'); R(1, -1, 3, 1, '#222');                       // shoes
  const bob = sleep ? 2 : 0;
  R(-4, -15 + bob, 9, 9, p.shirt);                                       // body
  R(-5, -14 + bob, 1, 6, p.shirt); R(5, -14 + bob, 1, 6, p.shirt);       // arms
  const arm = typing ? (frame % 2 ? -1 : 0) : 0;
  R(-5, -8 + bob + arm, 1, 1, p.skin); R(5, -8 + bob - arm, 1, 1, p.skin);
  const hy = -22 + bob * 2;
  R(-3, hy, 7, 7, p.skin);                                               // head
  if (!sleep) { R(-2, hy + 3, 1, 1, '#1b1b1b'); R(2, hy + 3, 1, 1, '#1b1b1b'); } else { R(-2, hy + 4, 2, 1, '#1b1b1b'); R(1, hy + 4, 2, 1, '#1b1b1b'); }
  if (p.hairStyle === 'cap') { R(-4, hy - 1, 9, 3, p.hair); R(4, hy + 1, 2, 1, p.hair); }
  else if (p.hairStyle === 'long') { R(-4, hy - 1, 9, 3, p.hair); R(-4, hy + 1, 2, 7, p.hair); R(3, hy + 1, 2, 7, p.hair); }
  else if (p.hairStyle === 'bun') { R(-3, hy - 1, 7, 2, p.hair); R(-1, hy - 4, 3, 3, p.hair); }
  else { R(-3, hy - 1, 7, 3, p.hair); R(-4, hy, 1, 3, p.hair); }
}

function drawRoom(c: CanvasRenderingContext2D, glow: string) {
  c.fillStyle = '#20232b'; c.fillRect(0, 0, W, H);
  // floor 10 x 9 tiles, wood planks
  for (let x = 0; x < NX; x++) for (let y = 0; y < NY; y++) {
    const a = iso(x, y), b = iso(x + 1, y), cc = iso(x + 1, y + 1), d = iso(x, y + 1);
    poly(c, [a, b, cc, d], (x + y) % 2 ? '#e8d6b5' : '#e2cfac');
  }
  // back walls (left: along y at x=0, right: along x at y=0)
  const WALL = 70;
  poly(c, [iso(0, 0, WALL), iso(0, NY, WALL), iso(0, NY), iso(0, 0)], '#d7dde6');
  poly(c, [iso(0, 0, WALL), iso(NX, 0, WALL), iso(NX, 0), iso(0, 0)], '#e9edf2');
  // windows on the left wall (city outside)
  for (const y0 of [0.6, 3.8]) {
    poly(c, [iso(0, y0, 62), iso(0, y0 + 2.4, 62), iso(0, y0 + 2.4, 14), iso(0, y0, 14)], '#8fc7ef');
    for (let k = 0; k < 4; k++) { const t = iso(0, y0 + 0.3 + k * 0.55, 18 + (k % 2) * 8); c.fillStyle = '#6b8fb3'; c.fillRect(Math.round(t[0]) - 3, Math.round(t[1]) - 14, 5, 22 - (k % 2) * 6); }
    poly(c, [iso(0, y0 + 1.15, 62), iso(0, y0 + 1.25, 62), iso(0, y0 + 1.25, 14), iso(0, y0 + 1.15, 14)], '#f4f6f8');
  }
  // door on the right wall
  poly(c, [iso(6.0, 0, 54), iso(7.4, 0, 54), iso(7.4, 0), iso(6.0, 0)], '#8a5a3b');
  poly(c, [iso(6.15, 0, 50), iso(7.25, 0, 50), iso(7.25, 0, 2), iso(6.15, 0, 2)], '#9c6a47');
  // kanban board on the right wall
  poly(c, [iso(2.6, 0, 60), iso(5.2, 0, 60), iso(5.2, 0, 34), iso(2.6, 0, 34)], '#fbfbfb');
  const notes = ['#ffd23f', '#5ad1ff', '#ff7aa2', '#7ee081', '#ffd23f', '#ff7aa2'];
  notes.forEach((col, i) => { const p = iso(2.9 + (i % 3) * 0.8, 0, 56 - Math.floor(i / 3) * 10); c.fillStyle = col; c.fillRect(Math.round(p[0]), Math.round(p[1]), 5, 5); });
  // water dispenser + coffee bar near the right wall
  box(c, 7.2, 3.1, 0.6, 0.6, 0, 16, '#f0f0f0', '#cfcfcf', '#e0e0e0');
  box(c, 7.3, 3.2, 0.4, 0.4, 16, 12, '#7cc5f5', '#5aa9dd', '#6bb7ea');
  box(c, 7.0, 5.0, 0.9, 1.2, 0, 14, '#c79a6b', '#a77b51', '#b88a5d');
  box(c, 7.2, 5.2, 0.45, 0.4, 14, 10, '#3a3f47', '#2b2f35', '#33373e');
  plant(c, 0.25, 0.25); plant(c, 7.4, 0.3); plant(c, 3.0, 6.4);
  void glow;
}

export default function Office({ data, now }: { data: OfficeData; now: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);
  // coffee breaks: 45 s at the desk, 15 s away (only when nothing is open and the bot is online)
  const breakPhase = Math.floor(now / 1000) % 60 >= 45;
  const st = useMemo(() => statuses(data, now, breakPhase), [data, now, breakPhase]);
  // positions move smoothly towards their target (desk or rest spot)
  const pos = useRef<Record<string, Spot>>({});
  const [, force] = useState(0);
  useEffect(() => {
    let raf = 0, last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 110) return;                       // ~9 fps, pixel-art pace
      last = t;
      for (const p of PEOPLE) {
        const s = st[p.id], goal = s?.atDesk || s?.sleep ? { x: p.desk.x + 0.9, y: p.desk.y + 1.25 } : p.rest;
        const cur = pos.current[p.id] ?? { ...goal };
        const dx = goal.x - cur.x, dy = goal.y - cur.y, dist = Math.hypot(dx, dy), v = 0.12;
        pos.current[p.id] = dist <= v ? goal : { x: cur.x + (dx / dist) * v, y: cur.y + (dy / dist) * v };
      }
      setFrame((f) => f + 1); force((n) => n + 1);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [st]);

  useEffect(() => {
    const c = ref.current?.getContext('2d'); if (!c) return;
    c.imageSmoothingEnabled = false;
    drawRoom(c, '#5ad1ff');
    // draw desks and people sorted by depth (x + y)
    const items: Array<{ depth: number; draw: () => void }> = [];
    for (const p of PEOPLE) {
      if (p.id === 'bos' || p.id === 'jaga') continue;
      const s = st[p.id];
      items.push({ depth: p.desk.x + p.desk.y + 0.9, draw: () => desk(c, p.desk.x, p.desk.y, s?.sleep ? '#1c2a3a' : s?.label.startsWith('POSISI') ? '#2ee59d' : '#5ad1ff') });
    }
    for (const p of PEOPLE) {
      const s = st[p.id]; if (!s || s.label === 'BELUM AKTIF') continue;
      const q = pos.current[p.id]; if (!q) continue;
      const goal = s.atDesk || s.sleep ? { x: p.desk.x + 0.9, y: p.desk.y + 1.25 } : p.rest;
      const walking = Math.hypot(goal.x - q.x, goal.y - q.y) > 0.01;
      items.push({ depth: q.x + q.y, draw: () => person(c, p, q.x, q.y, frame, walking, s.sleep, s.atDesk && !walking && !s.sleep) });
    }
    items.sort((a, b) => a.depth - b.depth).forEach((i) => i.draw());
    // zZ for sleepers
    for (const p of PEOPLE) {
      const s = st[p.id], q = pos.current[p.id]; if (!s?.sleep || !q) continue;
      const [sx, sy] = iso(q.x, q.y); c.fillStyle = '#8fa2c2'; c.font = '7px monospace'; c.fillText(frame % 6 < 3 ? 'z' : 'zZ', sx + 4, sy - 26);
    }
  });

  // name tags in HTML (crisp text) over the canvas
  const tags = PEOPLE.map((p) => {
    const s = st[p.id], q = pos.current[p.id]; if (!s || !q || s.label === 'BELUM AKTIF') return null;
    const [sx, sy] = iso(q.x, q.y);
    return { p, s, left: (sx / W) * 100, top: ((sy - 25) / H) * 100 };
  }).filter(Boolean) as Array<{ p: Person; s: Status; left: number; top: number }>;

  return (
    <div className="office">
      <canvas ref={ref} width={W} height={H} className="office-canvas" aria-label="Kantor virtual: status bot dan EA" />
      {tags.map(({ p, s, left, top }) => (
        <div key={p.id} className="office-tag" style={{ left: `${left}%`, top: `${top}%` }}>
          <span className="ot-card">
            <strong>{p.name}</strong>
            {s.tag ? <span className="ot-role" style={{ color: s.tag.color, fontWeight: 700 }}>{s.tag.text}</span> : <span className="ot-role">{p.role}</span>}
            <span className="ot-st"><i style={{ background: s.color }} />{s.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
