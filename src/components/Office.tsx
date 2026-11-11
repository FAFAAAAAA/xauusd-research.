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
  { id: 'alt', name: 'Na', role: 'ALT · SELL ALTCOIN', desk: { x: 0.9, y: 1.0 }, rest: { x: 5.7, y: 3.3 }, hair: '#3b2a1f', skin: '#f1c7a0', shirt: '#e5484d', pants: '#2c3e66', hairStyle: 'short' },
  { id: 'big', name: 'Ni', role: 'BIG · BUY KOIN BESAR', desk: { x: 4.1, y: 0.9 }, rest: { x: 5.9, y: 3.9 }, hair: '#1b1b1b', skin: '#d9a477', shirt: '#2fb67c', pants: '#3d3d3d', hairStyle: 'cap' },
  { id: 'xau', name: 'Nu', role: 'XAU · EA EMAS', desk: { x: 0.9, y: 4.0 }, rest: { x: 5.6, y: 5.4 }, hair: '#c9772f', skin: '#f3cfae', shirt: '#f0b429', pants: '#5b4a3a', hairStyle: 'long' },
  { id: 'nas', name: 'Noel', role: 'NAS · EA NASDAQ', desk: { x: 4.1, y: 3.9 }, rest: { x: 6.1, y: 5.8 }, hair: '#4a3426', skin: '#e8b98f', shirt: '#4c7dff', pants: '#2a2a2a', hairStyle: 'bun' },
  { id: 'jaga', name: 'Penjaga', role: 'WATCHDOG', desk: { x: 6.6, y: 1.3 }, rest: { x: 6.6, y: 1.3 }, hair: '#222', skin: '#c99064', shirt: '#33415c', pants: '#1f2a3a', hairStyle: 'cap' },
  { id: 'bos', name: 'Marcel', role: 'OWNER', desk: { x: 1.0, y: 6.3 }, rest: { x: 1.0, y: 6.3 }, hair: '#111', skin: '#e2b088', shirt: '#f5f5f5', pants: '#30343b', hairStyle: 'short' },
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
/* ---------- sprites: 12 x 24 pixel maps with a dark outline and 2-tone shading ---------- */
const FRONT = [
  '...oooooo...', '..ohhhhhhho.', '.ohhhhhhhhho', '.ohhsssssho.', '.ohsessesho.', '.ohsssssssho', '..ossSSssso.', '...ossssso..',
  '..ootttttoo.', '.ottttttttto', 'ottTttttTtto', 'otTttttttTto', 'osTttttttTso', 'osottttttoso', '.ooTTTTTTTo.',
  '..opppPpppo.', '..oppPoPppo.', '..oppo.oppo.', '..oppo.oppo.', '..oppo.oppo.', '..oPPo.oPPo.', '.obbbo.obbbo', '.ooooo.ooooo', '............',
];
const BACK = [
  '...oooooo...', '..ohhhhhhho.', '.ohhhhhhhhho', '.ohhhhhhhhho', '.ohhHhhhHhho', '.ohhhhhhhhho', '..ohhhhhhho.', '...oSSSSSo..',
  '..ootttttoo.', '.ottttttttto', 'ottTttttTtto', 'otTttttttTto', 'osTttttttTso', 'osottttttoso', '.oTTTTTTTTo.',
  '..opppPpppo.', '..oppPoPppo.', '..oppo.oppo.', '..oppo.oppo.', '..oppo.oppo.', '..oPPo.oPPo.', '.obbbo.obbbo', '.ooooo.ooooo', '............',
];
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16), f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
function sprite(c: CanvasRenderingContext2D, X: number, Y: number, map: string[], pal: Record<string, string>, legShift = 0, cut = 99) {
  for (let r = 0; r < map.length && r < cut; r++) {
    const row = map[r];
    for (let k = 0; k < row.length; k++) {
      const ch = row[k]; if (ch === '.') continue;
      // walking: left leg (cols 2-5) and right leg (cols 7-10) move up/down on the lower rows
      const dy = r >= 17 ? (k < 6 ? legShift : -legShift) : 0;
      c.fillStyle = pal[ch] ?? '#ff00ff'; c.fillRect(X + k, Y + r + dy, 1, 1);
    }
  }
}
function person(c: CanvasRenderingContext2D, p: Person, x: number, y: number, frame: number, walking: boolean, sleep: boolean, back: boolean) {
  const [sx, sy] = iso(x, y, 0); const X = Math.round(sx) - 6, Y = Math.round(sy) - 23;
  c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(X + 1, Y + 22, 10, 2); c.fillRect(X + 3, Y + 24, 6, 1);   // shadow
  const pal: Record<string, string> = {
    o: '#1b1d24', h: p.hair, H: shade(p.hair, 0.75), s: p.skin, S: shade(p.skin, 0.85), e: '#1b1d24',
    t: p.shirt, T: shade(p.shirt, 0.78), p: p.pants, P: shade(p.pants, 0.75), b: '#2a2a2a',
  };
  const map = (back ? BACK : FRONT).slice();
  if (p.hairStyle === 'cap') { map[0] = '..oooooooo..'; map[1] = '.ohhhhhhhhho'; map[2] = 'oHHHHHHHHHHo'; }
  if (p.hairStyle === 'long') for (const r of [7, 8, 9]) map[r] = 'h' + map[r].slice(1, 11) + 'h';
  if (p.hairStyle === 'bun') map[0] = '....ohho....';
  if (sleep) map[4] = back ? map[4] : '.ohsSSsSSsho';
  const legs = walking ? (frame % 2 ? 1 : -1) : 0;
  const typing = back && !walking && !sleep;
  // when seated at the desk the chair hides the legs (drawn after), head bobs a little while typing, sleeping head drops
  sprite(c, X, Y + (sleep ? 2 : typing && frame % 4 === 0 ? 1 : 0), map, pal, legs);
}
function chair(c: CanvasRenderingContext2D, x: number, y: number) {
  box(c, x - 0.22, y + 0.05, 0.44, 0.38, 6, 2, '#3b3f48', '#2b2e35', '#33363e');       // seat
  box(c, x - 0.24, y + 0.38, 0.48, 0.07, 8, 11, '#4a4f5a', '#2b2e35', '#3a3e47');      // backrest (in front of the person)
  const f = iso(x, y + 0.25, 0); c.fillStyle = '#23252b'; c.fillRect(Math.round(f[0]) - 1, Math.round(f[1]) - 6, 2, 6); c.fillRect(Math.round(f[0]) - 5, Math.round(f[1]) - 1, 10, 1);
}
function shadowTile(c: CanvasRenderingContext2D, x: number, y: number, w: number, d: number) {
  poly(c, [iso(x + 0.15, y + 0.15), iso(x + w + 0.25, y + 0.15), iso(x + w + 0.25, y + d + 0.25), iso(x + 0.15, y + d + 0.25)], 'rgba(60,40,20,.16)');
}
function desk(c: CanvasRenderingContext2D, x: number, y: number, glow: string) {
  shadowTile(c, x, y, 1.8, 0.9);
  // legs / side panels
  box(c, x + 0.05, y + 0.1, 0.08, 0.7, 0, 13, '#b8bec8', '#9aa1ac', '#aab0ba');
  box(c, x + 1.67, y + 0.1, 0.08, 0.7, 0, 13, '#b8bec8', '#9aa1ac', '#aab0ba');
  box(c, x + 1.2, y + 0.1, 0.45, 0.65, 0, 11, '#d5d9e0', '#b3b9c3', '#c4c9d1');      // drawer
  box(c, x, y, 1.8, 0.9, 13, 2, '#f4f6f8', '#c9ced6', '#dde1e7');                     // top
  for (const mx of [0.2, 0.95]) {
    box(c, x + mx + 0.22, y + 0.2, 0.1, 0.08, 15, 4, '#30343c', '#202329', '#2a2e35');   // stand
    box(c, x + mx, y + 0.12, 0.6, 0.07, 19, 11, '#3a3f48', '#1d2026', '#2b2f36');       // monitor (back side towards the viewer)
    const g = iso(x + mx + 0.05, y + 0.12, 29); c.fillStyle = glow; c.globalAlpha = 0.35; c.fillRect(Math.round(g[0]) - 1, Math.round(g[1]) - 2, 9, 2); c.globalAlpha = 1;
  }
  box(c, x + 0.45, y + 0.5, 0.65, 0.18, 15, 1, '#2f343c', '#262a30', '#262a30');      // keyboard
  box(c, x + 1.2, y + 0.55, 0.12, 0.1, 15, 1, '#2f343c', '#262a30', '#262a30');       // mouse
  const mug = iso(x + 1.5, y + 0.45, 15); c.fillStyle = '#ffffff'; c.fillRect(Math.round(mug[0]), Math.round(mug[1]) - 4, 3, 4); c.fillStyle = '#6b4a2b'; c.fillRect(Math.round(mug[0]), Math.round(mug[1]) - 4, 3, 1);
}
function plant(c: CanvasRenderingContext2D, x: number, y: number) {
  shadowTile(c, x, y, 0.45, 0.45);
  box(c, x, y, 0.45, 0.45, 0, 8, '#eaeaea', '#bdbdbd', '#d0d0d0');
  const p = iso(x + 0.22, y + 0.22, 9), X = Math.round(p[0]), Y = Math.round(p[1]);
  const leaf = (dx: number, dy: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(X + dx, Y + dy, w, h); };
  leaf(-6, -12, 12, 10, '#1f6b36'); leaf(-4, -18, 8, 8, '#2f8f46'); leaf(-8, -9, 4, 5, '#2f8f46'); leaf(5, -10, 4, 5, '#2f8f46'); leaf(-2, -21, 4, 4, '#3fb35b'); leaf(1, -14, 3, 3, '#56c96f'); leaf(-5, -15, 3, 3, '#56c96f');
}

function drawRoom(c: CanvasRenderingContext2D, glow: string) {
  c.fillStyle = '#20232b'; c.fillRect(0, 0, W, H);
  // floor 10 x 9 tiles, wood planks
  for (let x = 0; x < NX; x++) for (let y = 0; y < NY; y++) {
    const a = iso(x, y), b = iso(x + 1, y), cc = iso(x + 1, y + 1), d = iso(x, y + 1);
    poly(c, [a, b, cc, d], (x + y) % 2 ? '#ead8b8' : '#e4d1ae');
    c.fillStyle = 'rgba(120,90,50,.18)'; c.fillRect(Math.round(a[0]), Math.round(a[1]), 1, 1);
  }
  for (let k = 0; k <= NX; k++) { c.strokeStyle = 'rgba(140,105,60,.18)'; c.beginPath(); const p0 = iso(k, 0), p1 = iso(k, NY); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); }
  for (let k = 0; k <= NY; k++) { c.strokeStyle = 'rgba(140,105,60,.18)'; c.beginPath(); const p0 = iso(0, k), p1 = iso(NX, k); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); }
  // back walls (left: along y at x=0, right: along x at y=0)
  const WALL = 70;
  poly(c, [iso(0, 0, WALL), iso(0, NY, WALL), iso(0, NY), iso(0, 0)], '#d7dde6');
  poly(c, [iso(0, 0, WALL), iso(NX, 0, WALL), iso(NX, 0), iso(0, 0)], '#e9edf2');
  // wall top edge and baseboards
  poly(c, [iso(0, 0, WALL + 3), iso(0, NY, WALL + 3), iso(0, NY, WALL), iso(0, 0, WALL)], '#f7f9fb');
  poly(c, [iso(0, 0, WALL + 3), iso(NX, 0, WALL + 3), iso(NX, 0, WALL), iso(0, 0, WALL)], '#ffffff');
  poly(c, [iso(0, 0, 4), iso(0, NY, 4), iso(0, NY), iso(0, 0)], '#b9a588');
  poly(c, [iso(0, 0, 4), iso(NX, 0, 4), iso(NX, 0), iso(0, 0)], '#c8b495');
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
      const seated = (s.atDesk || s.sleep) && !walking && p.id !== 'bos' && p.id !== 'jaga';
      items.push({ depth: q.x + q.y, draw: () => person(c, p, q.x, q.y, frame, walking, s.sleep, seated) });
      if (seated) items.push({ depth: q.x + q.y + 0.01, draw: () => chair(c, q.x, q.y) });
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
