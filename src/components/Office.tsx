'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JournalTrade } from '@/lib/core/journal';

/* Kantor (12 Nov 2026): a smooth isometric 3D office (black / white / yellow, day and night) shown on top of every page.
 * Every "employee" is one of our bots / EA methods and follows real data from /api/journal:
 *  - Na (ALT) and Ni (BTC / BIG): at the desk with open positions, otherwise normal office life
 *    (coffee, water, snacks, window, phone, beanbag, sofa nap, meeting, exercise, toilet …), asleep when the bot is silent.
 *  - Nu (XAU) and Ne (NASDAQ): same for the MT5 EA, off on weekends (MT5 closed).
 *  - Noel (Telegram): at his desk sending messages when a trade opened / closed in the last 3 minutes.
 *  - Pentoel (security = watchdog) patrols, ALARM when something is silent.
 *  - Marcel (owner): a grumpy boss with a whip who chases slackers and yells at whoever just hit a stop loss.
 * Everything (scene, wall screen, name tags) is drawn on one hi-DPI canvas at 60 fps; pinch / double tap to zoom. */

type Live = { wallet: number; upnl: number; at: number; pos?: Record<string, number> } | null | undefined;
export interface OfficeData { trades: JournalTrade[]; binance?: Live; mt5?: Live }
export type ScreenLine = { k: string; v: string; color?: string };

/* ---------- geometry ---------- */
const W = 380, H = 292;
const NX = 13, NY = 11, TW = 15, TH = 7.5, WALL = 82;
const OX = 12 + NY * TW, OY = WALL + 12;
const iso = (x: number, y: number, z = 0): [number, number] => [OX + (x - y) * TW, OY + (x + y) * TH - z];
const SILENT = 35 * 60_000;
const TV = { x0: 6.85, x1: 11.0, z0: 34, z1: 79 };
const ROSTER = { x0: 2.7, x1: 5.75, z0: 37, z1: 77 };
const PS = 1.14;                                     // character scale
const HOME = { z: 1.18, tx: (W - W * 1.18) / 2, ty: (H - H * 1.18) / 2 + 6 };   // default view: a bit closer than the whole room

type Face = 'px' | 'py' | 'nx' | 'ny';
type Pose = 'stand' | 'sit' | 'sleep' | 'bean' | 'stretch' | 'squat' | 'jump' | 'nap';
type Prop = 'cup' | 'phone' | 'hp' | 'book' | 'paper' | 'laptop' | 'food' | 'vanish' | 'trash' | 'can';
interface Spot { id: string; x: number; y: number; face: Face; pose: Pose; label: string; prop?: Prop; zone?: 'break' | 'meet' | 'lounge'; alt?: Array<{ label: string; pose?: Pose; prop?: Prop }>; whip?: string }
interface Person {
  id: string; name: string; role: string; seat: Spot;
  hair: string; skin: string; shirt: string; pants: string; style: 'short' | 'long' | 'bun' | 'cap' | 'slick' | 'curly';
  cap?: string; glasses?: boolean; headset?: boolean; tie?: boolean;
}
const seat = (id: string, x: number, y: number, face: Face, label = 'MEMANTAU'): Spot => ({ id: `seat-${id}`, x, y, face, pose: 'sit', label });
const PEOPLE: Person[] = [
  { id: 'bos', name: 'Marcel', role: 'OWNER', seat: seat('bos', 10.5, 5.3, 'py', 'NGITUNG CUAN'), hair: '#1a1a1a', skin: '#e9b98f', shirt: '#24262c', pants: '#1c1d22', style: 'slick', glasses: true, tie: true },
  { id: 'alt', name: 'Na', role: 'ALT', seat: seat('alt', 2.3, 1.9, 'nx'), hair: '#5a3825', skin: '#f3cba5', shirt: '#e5484d', pants: '#2c3e66', style: 'short' },
  { id: 'big', name: 'Ni', role: 'BTC', seat: seat('big', 2.3, 4.3, 'nx'), hair: '#1b1b1b', skin: '#d9a477', shirt: '#2fb67c', pants: '#34363c', style: 'cap', cap: '#1f2024' },
  { id: 'xau', name: 'Nu', role: 'XAU', seat: seat('xau', 2.3, 6.9, 'nx'), hair: '#b8692b', skin: '#f5d2b3', shirt: '#f2c230', pants: '#4b4038', style: 'long' },
  { id: 'nas', name: 'Ne', role: 'NASDAQ', seat: seat('nas', 2.3, 9.3, 'nx'), hair: '#3e2a1e', skin: '#ebbd94', shirt: '#4c7dff', pants: '#26272b', style: 'bun' },
  { id: 'tg', name: 'Noel', role: 'TELEGRAM', seat: seat('tg', 4.5, 1.85, 'ny', 'BALAS CHAT'), hair: '#6b3e26', skin: '#f0c49c', shirt: '#229ed9', pants: '#2c2f36', style: 'curly', headset: true },
  { id: 'jaga', name: 'Pentoel', role: 'SECURITY', seat: seat('jaga', 11.75, 2.0, 'py', 'CEK CCTV'), hair: '#222', skin: '#c99064', shirt: '#2f3b55', pants: '#1f2533', style: 'cap', cap: '#1f2a44' },
];
const WORKERS = ['alt', 'big', 'xau', 'nas', 'tg'];

const SPOTS: Spot[] = [
  { id: 'coffee', x: 7.55, y: 1.3, face: 'ny', pose: 'stand', label: 'BIKIN KOPI', prop: 'cup', zone: 'break' },
  { id: 'sink', x: 8.5, y: 1.3, face: 'ny', pose: 'stand', label: 'CUCI GELAS', zone: 'break' },
  { id: 'fridge', x: 12.62, y: 1.45, face: 'ny', pose: 'stand', label: 'AMBIL SNACK', prop: 'food', zone: 'break', alt: [{ label: 'AMBIL MINUMAN', prop: 'can' }] },
  { id: 'water', x: 2.6, y: 1.25, face: 'ny', pose: 'stand', label: 'MINUM', prop: 'cup', zone: 'break' },
  { id: 'trash', x: 3.3, y: 1.35, face: 'ny', pose: 'stand', label: 'BUANG SAMPAH', prop: 'trash' },
  { id: 'shelf', x: 6.35, y: 1.1, face: 'ny', pose: 'stand', label: 'BACA BUKU', prop: 'book' },
  { id: 'printer', x: 10.35, y: 1.35, face: 'ny', pose: 'stand', label: 'AMBIL PRINT', prop: 'paper', alt: [{ label: 'FOTOKOPI' }] },
  { id: 'toilet', x: 11.65, y: 0.5, face: 'ny', pose: 'stand', label: 'KE TOILET', prop: 'vanish' },
  { id: 'tv', x: 8.9, y: 2.6, face: 'ny', pose: 'stand', label: 'LIHAT CHART', zone: 'meet' },
  { id: 'win1', x: 0.95, y: 3.1, face: 'nx', pose: 'stand', label: 'LIHAT LUAR', alt: [{ label: 'MAIN HP', prop: 'hp' }] },
  { id: 'win2', x: 0.95, y: 5.6, face: 'nx', pose: 'stand', label: 'LIHAT LUAR', alt: [{ label: 'TELEPON', prop: 'phone' }] },
  { id: 'win3', x: 0.95, y: 8.1, face: 'nx', pose: 'stand', label: 'LIHAT LUAR', alt: [{ label: 'MAIN HP', prop: 'hp' }] },
  { id: 'bean1', x: 3.75, y: 8.15, face: 'px', pose: 'bean', label: 'SANTAI', prop: 'laptop', zone: 'lounge', alt: [{ label: 'MAIN GAME', prop: 'hp' }] },
  { id: 'bean2', x: 5.75, y: 9.65, face: 'ny', pose: 'bean', label: 'SANTAI', prop: 'laptop', zone: 'lounge', alt: [{ label: 'MAIN HP', prop: 'hp' }] },
  { id: 'sofa1', x: 9.75, y: 9.55, face: 'ny', pose: 'sit', label: 'SANTAI', zone: 'lounge', alt: [{ label: 'TIDUR SIANG', pose: 'nap' }, { label: 'MAIN HP', prop: 'hp' }] },
  { id: 'sofa2', x: 10.75, y: 9.55, face: 'ny', pose: 'sit', label: 'SANTAI', zone: 'lounge', alt: [{ label: 'TIDUR SIANG', pose: 'nap' }] },
  { id: 'meet1', x: 6.7, y: 5.4, face: 'px', pose: 'sit', label: 'RAPAT', zone: 'meet', alt: [{ label: 'BIKIN LAPORAN', prop: 'laptop' }] },
  { id: 'meet2', x: 8.5, y: 5.4, face: 'nx', pose: 'sit', label: 'RAPAT', zone: 'meet' },
  { id: 'meet3', x: 7.6, y: 6.3, face: 'ny', pose: 'sit', label: 'RAPAT', zone: 'meet', alt: [{ label: 'BIKIN LAPORAN', prop: 'laptop' }] },
  { id: 'meet4', x: 7.6, y: 4.5, face: 'py', pose: 'sit', label: 'RAPAT', zone: 'meet' },
  { id: 'plant', x: 11.95, y: 10.45, face: 'px', pose: 'stand', label: 'SIRAM TANAMAN', prop: 'can' },
  { id: 'phone', x: 8.4, y: 8.4, face: 'py', pose: 'stand', label: 'TELEPON', prop: 'phone' },
  { id: 'stretch', x: 6.2, y: 7.6, face: 'py', pose: 'stretch', label: 'PEREGANGAN' },
  { id: 'gym', x: 3.3, y: 10.1, face: 'px', pose: 'squat', label: 'OLAHRAGA' },
  { id: 'hp', x: 6.9, y: 9.4, face: 'py', pose: 'stand', label: 'MAIN HP', prop: 'hp' },
];
const PATROL: Spot[] = [
  [11.6, 4.2, 'nx'], [9.0, 3.6, 'nx'], [5.0, 3.4, 'nx'], [3.2, 3.1, 'nx'], [3.2, 5.6, 'nx'], [3.2, 8.0, 'nx'],
  [3.0, 10.4, 'px'], [7.0, 10.4, 'px'], [8.6, 7.6, 'ny'], [11.9, 8.2, 'ny'], [12.2, 4.6, 'ny'],
].map(([x, y, f], i) => ({ id: `patrol${i}`, x: x as number, y: y as number, face: f as Face, pose: 'stand', label: 'PATROLI' }));
const PACE: Array<[number, number]> = [[6.0, 3.6], [9.3, 3.8], [8.8, 7.6], [5.5, 6.6], [10.4, 8.4], [4.5, 4.6]];
const PARTNER: Record<string, string> = { alt: 'big', big: 'alt', xau: 'nas', nas: 'xau', tg: 'alt' };
const YELL = ['KERJA!!', 'PROFIT MANA?!', 'JANGAN SANTAI!', 'CEPAT!!', 'GAJI POTONG!', 'BALIK KE MEJA!', 'LEMBUR KAMU!'];
const SL_YELL = ['KENA SL LAGI?!', 'RUGI TERUS!', 'MAU DIPECAT?!'];
const SORRY = ['Ampun bos!', 'Iya bos!', 'Siap bos!', 'Maaf bos…'];

/* ---------- status from real data ---------- */
type Status = { label: string; color: string; sleep: boolean; tag?: { text: string; color: string } | null; tp?: boolean; sl?: boolean };
const money = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`;
const weekendMt5 = (t: number) => { const d = new Date(t), wd = d.getUTCDay(), h = d.getUTCHours(); return wd === 6 || (wd === 0 && h < 22) || (wd === 5 && h >= 21); };
function statuses(data: OfficeData, now: number): Record<string, Status> {
  const open = data.trades.filter((t) => t.result === 'open');
  const coin = (t: JournalTrade) => (/Bot Binance ([0-9A-Z]+)/.exec(t.note ?? '')?.[1] ?? '').replace(/USDT$/, '');
  const bOn = !!data.binance && now - data.binance.at < SILENT, mOn = !!data.mt5 && now - data.mt5.at < SILENT;
  const recent = (key: string) => data.trades.filter((t) => t.strategy === key && t.result !== 'open' && t.closedAt && now - t.closedAt < 15 * 60_000).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0];
  const one = (key: string, online: boolean, live: Live, closed: boolean, posKey: (t: JournalTrade) => string): Status => {
    const mine = open.filter((t) => t.strategy === key);
    const r = recent(key);
    const flash = r ? { text: `${r.result === 'tp' ? '🎉 TP' : r.result === 'sl' ? 'SL' : 'TUTUP'} ${coin(r)} ${money(Number(r.pnl ?? 0))}`, color: Number(r.pnl) >= 0 ? '#2ee59d' : '#ff6b6b' } : null;
    const extra = { tp: r?.result === 'tp', sl: r?.result === 'sl' };
    if (!live) return { label: 'BELUM AKTIF', color: '#8a8f98', sleep: false, tag: null };
    if (!online) return { label: 'OFFLINE', color: '#ff5a5f', sleep: true, tag: flash, ...extra };
    if (mine.length) {
      const sum = mine.reduce((a, t) => a + (live.pos?.[posKey(t)] ?? 0), 0);
      return { label: `POSISI ×${mine.length}`, color: '#2ee59d', sleep: false, tag: flash ?? { text: `${mine.map((t) => coin(t) || (t.side === 'BUY' ? 'BUY' : 'SELL')).join('·')} ${money(sum)}`, color: sum >= 0 ? '#2ee59d' : '#ff6b6b' }, ...extra };
    }
    if (closed) return { label: 'LIBUR', color: '#a78bfa', sleep: false, tag: flash, ...extra };
    return { label: 'MEMANTAU', color: '#58a6ff', sleep: false, tag: flash, ...extra };
  };
  const wk = weekendMt5(now);
  const silent = (data.binance && !bOn) || (data.mt5 && !mOn && !wk);
  const lastMsg = data.trades.map((t) => ({ t, at: Math.max(t.openedAt ?? 0, t.closedAt ?? 0) })).filter((x) => now - x.at < 3 * 60_000).sort((a, b) => b.at - a.at)[0];
  return {
    alt: one('snr', bOn, data.binance, false, (t) => `${coin(t)}USDT`),
    big: one('btc', bOn, data.binance, false, (t) => `${coin(t)}USDT`),
    xau: one('v2', mOn, data.mt5, wk, () => 'xau'),
    nas: one('nas', mOn, data.mt5, wk, () => 'nas'),
    tg: !data.binance && !data.mt5 ? { label: 'BELUM AKTIF', color: '#8a8f98', sleep: false, tag: null }
      : lastMsg ? { label: 'KIRIM PESAN', color: '#229ed9', sleep: false, tag: { text: `📨 ${coin(lastMsg.t) || (lastMsg.t.strategy === 'nas' ? 'NAS' : 'XAU')} ${lastMsg.t.result === 'open' ? 'BUKA' : (lastMsg.t.result ?? '').toUpperCase()}`, color: '#7cc8f0' } }
      : { label: 'MEMANTAU', color: '#58a6ff', sleep: false, tag: null },
    jaga: silent ? { label: 'ALARM', color: '#ff5a5f', sleep: false, tag: { text: '⚠ ada yang diam', color: '#ff6b6b' } } : { label: 'AMAN', color: '#2ee59d', sleep: false, tag: null },
    bos: { label: 'SIAGA', color: '#58a6ff', sleep: false, tag: null },
  };
}

/* ---------- drawing helpers ---------- */
type C = CanvasRenderingContext2D;
const sh = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k <= 1 ? v * k : v + (255 - v) * (k - 1))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
function poly(c: C, pts: Array<[number, number]>, fill: string | CanvasGradient, edge = false) {
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath(); c.fillStyle = fill; c.fill();
  if (edge) { c.strokeStyle = 'rgba(0,0,0,.16)'; c.lineWidth = 0.4; c.stroke(); }
}
/** iso box: floor rect x..x+w, y..y+d, from height z up h px. left = the +y face, right = the +x face */
function box(c: C, x: number, y: number, w: number, d: number, z: number, h: number, top: string, left?: string, right?: string, edge = true) {
  const L = left ?? sh(top, 0.74), R = right ?? sh(top, 0.88);
  poly(c, [iso(x, y + d, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x, y + d, z)], L, edge);
  poly(c, [iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x + w, y, z)], R, edge);
  poly(c, [iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)], top, edge);
  if (h > 3) {   // soft highlight on the top front edges (gives the "rendered" look)
    const a = iso(x, y + d, z + h), b = iso(x + w, y + d, z + h), e = iso(x + w, y, z + h);
    c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(e[0], e[1]); c.stroke();
  }
}
function ell(c: C, cx: number, cy: number, z: number, r: number, fill: string) {
  const [sx, sy] = iso(cx, cy, z); c.beginPath(); c.ellipse(sx, sy, r * TW * 1.414, r * TH * 1.414, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
}
function cyl(c: C, cx: number, cy: number, z: number, r: number, h: number, top: string, side?: string) {
  const [sx, sy] = iso(cx, cy, z), rx = r * TW * 1.414, ry = r * TH * 1.414;
  const base = side ?? top, g = c.createLinearGradient(sx - rx, 0, sx + rx, 0);
  g.addColorStop(0, sh(base, 0.86)); g.addColorStop(0.55, sh(base, 1.0)); g.addColorStop(1, sh(base, 0.68));
  c.fillStyle = g;
  c.beginPath(); c.ellipse(sx, sy, rx, ry, 0, 0, Math.PI); c.lineTo(sx - rx, sy - h); c.ellipse(sx, sy - h, rx, ry, 0, Math.PI, 0, true); c.closePath(); c.fill();
  c.beginPath(); c.ellipse(sx, sy - h, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = top; c.fill();
}
function shadow(c: C, x: number, y: number, w: number, d: number, a = 0.14) {
  poly(c, [iso(x - 0.05, y - 0.05), iso(x + w + 0.16, y - 0.05), iso(x + w + 0.16, y + d + 0.16), iso(x - 0.05, y + d + 0.16)], `rgba(0,0,0,${a})`);
}
const hash = (str: string) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10_000) / 10_000; };
const wallL = (y0: number, y1: number, z0: number, z1: number): Array<[number, number]> => [iso(0, y0, z1), iso(0, y1, z1), iso(0, y1, z0), iso(0, y0, z0)];
const wallB = (x0: number, x1: number, z0: number, z1: number): Array<[number, number]> => [iso(x0, 0, z1), iso(x1, 0, z1), iso(x1, 0, z0), iso(x0, 0, z0)];

/* ---------- the static room ---------- */
const CITY = Array.from({ length: 26 }, (_, i) => ({ y: 0.5 + i * 0.4 + hash(`b${i}`) * 0.15, w: 0.25 + hash(`w${i}`) * 0.3, h: 22 + hash(`h${i}`) * 42 }));
function drawStatic(c: C, night: boolean) {
  c.fillStyle = night ? '#0a0f1e' : '#2b2c31'; c.fillRect(-W, -H, 3 * W, 3 * H);
  if (night) {
    for (let i = 0; i < 46; i++) {
      const x = hash(`sx${i}`) * W * 1.2 - 20, w = 8 + hash(`sw${i}`) * 18, h = 20 + hash(`sh${i}`) * 90, y = H - h;
      c.fillStyle = '#121a2e'; c.fillRect(x, y, w, h + 40);
      for (let k = 0; k < 8; k++) if (hash(`l${i}${k}`) > 0.55) { c.fillStyle = 'rgba(255,214,120,.75)'; c.fillRect(x + 2 + (k % 2) * (w / 2), y + 4 + Math.floor(k / 2) * 9, 2, 2.5); }
    }
    for (let i = 0; i < 30; i++) { c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(hash(`st${i}`) * W, hash(`sy${i}`) * 80, 0.8, 0.8); }
  }
  box(c, 0, 0, NX, NY, -8, 8, night ? '#b9b6b0' : '#dcd9d3', '#3a3b41', '#4a4b52', false);
  const [fcx, fcy] = iso(4, 5);
  const fg = c.createRadialGradient(fcx, fcy, 10, fcx, fcy, 240);
  fg.addColorStop(0, night ? 'rgba(255,240,210,.06)' : 'rgba(255,255,255,.25)'); fg.addColorStop(1, 'rgba(0,0,0,.08)');
  poly(c, [iso(0, 0), iso(NX, 0), iso(NX, NY), iso(0, NY)], fg);
  c.strokeStyle = night ? 'rgba(0,0,0,.07)' : 'rgba(120,110,95,.13)'; c.lineWidth = 0.45;
  for (let k = 1; k < NX; k++) { const a = iso(k, 0), b = iso(k, NY); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  for (let k = 1; k < NY; k++) { const a = iso(0, k), b = iso(NX, k); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  if (!night) for (const [y0, y1] of [[0.6, 3.1], [3.2, 5.7], [5.8, 8.3], [8.4, 10.6]]) poly(c, [iso(0, y0), iso(0, y1), iso(3.4, Math.min(NY, y1 + 1.2)), iso(3.4, Math.min(NY, y0 + 1.2))], 'rgba(255,250,235,.24)');
  poly(c, [iso(0, 0), iso(NX, 0), iso(NX, 0.4), iso(0.4, 0.4)], 'rgba(0,0,0,.07)');
  poly(c, [iso(0, 0), iso(0.4, 0.4), iso(0.4, NY), iso(0, NY)], 'rgba(0,0,0,.07)');
  ell(c, 4.75, 8.85, 0.3, 1.75, '#2c2d33');
  for (let k = 0; k < 4; k++) ell(c, 4.75, 8.85, 0.4 + k * 0.05, 1.55 - k * 0.38, k % 2 ? '#3d3e46' : '#36373e');
  ell(c, 7.6, 5.4, 0.3, 1.35, night ? '#cfcac0' : '#ebe6dc');
  poly(c, [iso(9.2, 4.6, 0.3), iso(11.9, 4.6, 0.3), iso(11.9, 7.3, 0.3), iso(9.2, 7.3, 0.3)], '#3a3b42');
  poly(c, [iso(9.35, 4.75, 0.4), iso(11.75, 4.75, 0.4), iso(11.75, 7.15, 0.4), iso(9.35, 7.15, 0.4)], '#43444c');
  const cap = '#26272c';
  box(c, -0.28, -0.28, NX + 0.28, 0.28, -8, WALL + 8, cap, night ? '#c9c7c2' : '#f5f4f1', cap, false);
  box(c, -0.28, -0.28, 0.28, NY + 0.28, -8, WALL + 8, cap, cap, night ? '#bdbbb6' : '#eceae6', false);
  const [w0] = iso(0, 0), [w1] = iso(2, 0);
  const wg = c.createLinearGradient(w0, 0, w1, 0); wg.addColorStop(0, 'rgba(0,0,0,.1)'); wg.addColorStop(1, 'rgba(0,0,0,0)');
  poly(c, wallB(0, 2, 0, WALL), wg);
  poly(c, wallB(0, NX, 0, 4), '#2b2c31'); poly(c, wallL(0, NY, 0, 4), '#2b2c31');
  for (const [y0, y1] of [[0.55, 3.05], [3.15, 5.65], [5.75, 8.25], [8.35, 10.75]]) {
    poly(c, wallL(y0 - 0.06, y1 + 0.06, 10, WALL - 4), '#1c1d21');
    const sky = c.createLinearGradient(0, iso(0, y0, WALL - 8)[1], 0, iso(0, y0, 14)[1]);
    if (night) { sky.addColorStop(0, '#0b1430'); sky.addColorStop(1, '#1a2550'); } else { sky.addColorStop(0, '#8cc6ec'); sky.addColorStop(1, '#e7f4fb'); }
    c.save(); c.beginPath(); const p = wallL(y0, y1, 13, WALL - 7); c.moveTo(p[0][0], p[0][1]); for (const q of p.slice(1)) c.lineTo(q[0], q[1]); c.closePath(); c.clip();
    c.fillStyle = sky; c.fill();
    for (const b of CITY) {
      if (b.y + b.w < y0 || b.y > y1) continue;
      poly(c, wallL(b.y, b.y + b.w, 13, 13 + b.h * 0.8), night ? '#1b2440' : '#c3ccd6');
      poly(c, wallL(b.y, b.y + b.w * 0.35, 13, 13 + b.h * 0.8), night ? '#151c34' : '#b0bac6');
      for (let k = 0; k < 8; k++) {
        const lit = hash(`${b.y}:${k}`);
        if (night ? lit > 0.45 : lit > 0.7) poly(c, wallL(b.y + 0.06 + (k % 2) * b.w * 0.45, b.y + 0.1 + (k % 2) * b.w * 0.45, 17 + Math.floor(k / 2) * 9, 20 + Math.floor(k / 2) * 9), night ? '#ffd27a' : '#e9eef3');
      }
    }
    if (!night) for (let k = 0; k < 10; k++) { const yy = y0 + (k / 10) * (y1 - y0); const [sx, sy] = iso(0, yy, 16); c.fillStyle = k % 2 ? '#6fa86a' : '#5c9558'; c.beginPath(); c.ellipse(sx, sy, 4.5, 4, 0, 0, 7); c.fill(); }
    poly(c, [iso(0, y0 + 0.2, WALL - 7), iso(0, y0 + 0.55, WALL - 7), iso(0, y0 + 1.3, 13), iso(0, y0 + 0.95, 13)], 'rgba(255,255,255,.08)');
    c.restore();
    for (let k = 1; k < 3; k++) { const yy = y0 + (k / 3) * (y1 - y0); poly(c, wallL(yy - 0.03, yy + 0.03, 13, WALL - 7), '#1c1d21'); }
    poly(c, wallL(y0 - 0.06, y1 + 0.06, 10, 13), '#2f3036');
  }
  poly(c, wallB(0.7, 2.1, 40, 64), '#1e1f23'); poly(c, wallB(0.8, 2.0, 42, 62), '#f7f4ec');
  poly(c, wallB(1.05, 1.75, 46, 58), '#f2c230'); poly(c, wallB(1.25, 1.55, 49, 55), '#26272c');
  poly(c, wallB(ROSTER.x0 - 0.08, ROSTER.x1 + 0.08, ROSTER.z0 - 3, ROSTER.z1 + 3), '#1e1f23');
  poly(c, wallB(ROSTER.x0, ROSTER.x1, ROSTER.z0, ROSTER.z1), '#fbfaf6');
  poly(c, wallB(TV.x0 - 0.1, TV.x1 + 0.1, TV.z0 - 3, TV.z1 + 2.5), '#111214');
  poly(c, wallB(11.15, 12.15, 0, 52), '#1e1f23'); poly(c, wallB(11.25, 12.05, 0, 49), night ? '#5a4634' : '#7a5a3f');
  poly(c, wallB(11.3, 12.0, 30, 46), night ? '#4d3b2c' : '#6b4e36'); poly(c, wallB(11.3, 12.0, 5, 27), night ? '#4d3b2c' : '#6b4e36');
  poly(c, wallB(11.88, 11.96, 22, 26), '#f2c230');
  poly(c, wallB(11.3, 12.0, 55, 63), '#1e1f23');
}

/* ---------- furniture ---------- */
type Item = { x0: number; y0: number; x1: number; y1: number; draw: (c: C, t: number) => void };
type ScreenMode = 'off' | 'idle' | 'pos';
const MODES: Record<string, ScreenMode> = {};
const BUSY: Record<string, boolean> = {};
function screenPlane(c: C, ax: (u: number, z: number) => [number, number], mode: ScreenMode, t: number, seed: number) {
  poly(c, [ax(0, 1), ax(1, 1), ax(1, 0), ax(0, 0)], mode === 'off' ? '#0d1117' : mode === 'pos' ? '#0e2f25' : '#0f2338');
  if (mode === 'off') return;
  for (let i = 0; i < 7; i++) {
    const u = (i + 0.5) / 7, v = hash(`${seed}:${Math.floor(t * 1.3) + i}`);
    const up = mode === 'pos' ? v > 0.3 : v > 0.5, mid = 0.35 + 0.3 * hash(`${seed}m${i}`), len = 0.12 + v * 0.35;
    const [a0, a1] = ax(u, mid - len / 2), [b0, b1] = ax(u, mid + len / 2);
    c.strokeStyle = up ? '#2ee59d' : '#ff6b6b'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(a0, a1); c.lineTo(b0, b1); c.stroke();
  }
}
function lamp(c: C, x: number, y: number) {
  box(c, x - 0.08, y - 0.08, 0.16, 0.16, 15, 1, '#1e1f23');
  const [a0, a1] = iso(x, y, 16), [b0, b1] = iso(x + 0.05, y + 0.05, 27);
  c.strokeStyle = '#1e1f23'; c.lineWidth = 1; c.beginPath(); c.moveTo(a0, a1); c.lineTo(b0, b1); c.lineTo(b0 + 4, b1 + 1); c.stroke();
  c.fillStyle = '#f2c230'; c.beginPath(); c.moveTo(b0 + 2, b1 - 1); c.lineTo(b0 + 7, b1 + 1); c.lineTo(b0 + 5, b1 + 4); c.lineTo(b0 + 1, b1 + 2); c.closePath(); c.fill();
}
function plant(c: C, x: number, y: number, s = 1, t = 0) {
  ell(c, x, y, 0, 0.32 * s, 'rgba(0,0,0,.14)');
  cyl(c, x, y, 0, 0.2 * s, 9 * s, '#f1f1ef', '#dddcd8');
  ell(c, x, y, 9 * s, 0.16 * s, '#4a3a2c');
  const [sx, sy] = iso(x, y, 9 * s), sway = Math.sin(t * 1.3 + x * 3) * 0.04;
  const leaves: Array<[number, number, number, number, string]> = [
    [-5, -6, 4.5, 2.2, '#2f7a3d'], [5, -7, 4.5, 2.2, '#2f7a3d'], [-3, -12, 4.5, 2.4, '#3d9a4f'], [4, -13, 4.5, 2.4, '#3d9a4f'],
    [0, -17, 4, 2.4, '#4fb15f'], [-6, -14, 3.6, 2, '#4fb15f'], [6, -18, 3.4, 2, '#62c06e'], [-1, -9, 4, 2.2, '#2a6d37'],
  ];
  for (const [dx, dy, rx, ry, col] of leaves) { c.save(); c.translate(sx + dx * s, sy + dy * s); c.rotate(dx * 0.08 + sway * (-dy / 6)); c.beginPath(); c.ellipse(0, 0, rx * s, ry * s, 0, 0, 7); c.fillStyle = col; c.fill(); c.restore(); }
}
function traderDesk(y0: number, owner: string): Item {
  const x0 = 0.55, w = 0.95, d = 1.8;
  return {
    x0, y0, x1: x0 + w, y1: y0 + d, draw: (c, t) => {
      shadow(c, x0, y0, w, d);
      box(c, x0 + 0.05, y0 + 0.05, w - 0.1, 0.08, 0, 15, '#1e1f23');
      box(c, x0 + 0.02, y0 + d - 0.62, w - 0.04, 0.6, 0, 15, '#24252a', '#1b1c20', '#2d2e34');
      for (const k of [0, 1, 2]) poly(c, [iso(x0 + w - 0.02, y0 + d - 0.55, 13 - k * 4.5), iso(x0 + w - 0.02, y0 + d - 0.07, 13 - k * 4.5), iso(x0 + w - 0.02, y0 + d - 0.07, 13.4 - k * 4.5), iso(x0 + w - 0.02, y0 + d - 0.55, 13.4 - k * 4.5)], '#3a3b42');
      box(c, x0, y0, w, d, 15, 2.2, '#f7f7f5', '#d6d5d1', '#e7e6e2');
      const mode = MODES[owner] ?? 'idle';
      for (const [ya, yb] of [[y0 + 0.18, y0 + 0.86], [y0 + 0.94, y0 + 1.62]]) {
        box(c, x0 + 0.16, (ya + yb) / 2 - 0.05, 0.12, 0.1, 17.2, 4, '#1e1f23');
        box(c, x0 + 0.14, ya, 0.07, yb - ya, 20, 12, '#1e1f23', '#141518', '#1e1f23');
        const X = x0 + 0.215, A = ya + 0.04, B = yb - 0.04;
        screenPlane(c, (u, z) => iso(X, A + u * (B - A), 21 + z * 10), mode, t, Math.floor(y0 * 10 + ya * 3));
      }
      box(c, x0 + 0.45, y0 + 0.55, 0.22, 0.7, 17.2, 0.8, '#e3e3e1');
      box(c, x0 + 0.5, y0 + 1.42, 0.1, 0.08, 17.2, 0.8, '#e3e3e1');
      box(c, x0 + 0.62, y0 + 0.1, 0.22, 0.28, 17.2, 0.8, '#f2c230');
      cyl(c, x0 + 0.72, y0 + 1.62, 17.2, 0.05, 3, '#ffffff', '#eeeeee');
      lamp(c, x0 + 0.3, y0 + 0.08);
    },
  };
}
function chair(x: number, y: number, face: Face, color = '#f2c230'): Item[] {
  const seatItem: Item = {
    x0: face === 'nx' ? x - 0.32 : x - 0.26, y0: face === 'ny' ? y - 0.32 : y - 0.26,
    x1: face === 'nx' ? x - 0.27 : face === 'px' ? x - 0.22 : x + 0.26, y1: face === 'ny' ? y - 0.27 : face === 'py' ? y - 0.22 : y + 0.26,
    draw: (c) => {
      ell(c, x, y, 0, 0.26, 'rgba(0,0,0,.14)');
      const [a0, a1] = iso(x, y, 0), [b0, b1] = iso(x, y, 7);
      c.strokeStyle = '#1e1f23'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(a0, a1); c.lineTo(b0, b1); c.stroke();
      c.lineWidth = 1; for (const [dx, dy] of [[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]]) { const e = iso(x + dx, y + dy, 0.5); c.beginPath(); c.moveTo(a0, a1 - 0.5); c.lineTo(e[0], e[1]); c.stroke(); }
      box(c, x - 0.22, y - 0.22, 0.44, 0.44, 7, 2.2, color);
      if (face === 'py') box(c, x - 0.22, y - 0.3, 0.44, 0.08, 9, 11, color);
      if (face === 'px') box(c, x - 0.3, y - 0.22, 0.08, 0.44, 9, 11, color);
    },
  };
  const back: Item[] = face === 'nx' ? [{ x0: x + 0.21, y0: y - 0.22, x1: x + 0.3, y1: y + 0.22, draw: (c) => box(c, x + 0.21, y - 0.22, 0.08, 0.44, 9, 10, color) }]
    : face === 'ny' ? [{ x0: x - 0.22, y0: y + 0.21, x1: x + 0.22, y1: y + 0.3, draw: (c) => box(c, x - 0.22, y + 0.21, 0.44, 0.08, 9, 10, color) }] : [];
  return [seatItem, ...back];
}
function furniture(): Item[] {
  const it: Item[] = [];
  it.push(traderDesk(1.0, 'alt'), traderDesk(3.4, 'big'), traderDesk(6.0, 'xau'), traderDesk(8.4, 'nas'));
  for (const p of PEOPLE) { if (p.id === 'jaga' || p.id === 'bos') continue; it.push(...chair(p.seat.x, p.seat.y, p.seat.face)); }
  it.push(...chair(10.5, 5.3, 'py', '#1e1f23'), ...chair(11.75, 2.0, 'py', '#1e1f23'));
  for (const id of ['meet1', 'meet2', 'meet3', 'meet4']) { const s = SPOTS.find((q) => q.id === id)!; it.push(...chair(s.x, s.y, s.face, '#1e1f23')); }
  it.push({ x0: 3.6, y0: 0.2, x1: 5.4, y1: 1.15, draw: (c, t) => {
    shadow(c, 3.6, 0.2, 1.8, 0.95);
    box(c, 3.62, 0.25, 0.6, 0.85, 0, 15, '#24252a', '#1b1c20', '#2d2e34'); box(c, 5.25, 0.25, 0.08, 0.85, 0, 15, '#1e1f23');
    box(c, 3.6, 0.2, 1.8, 0.95, 15, 2.2, '#f7f7f5', '#d6d5d1', '#e7e6e2');
    for (const [xa, xb] of [[3.8, 4.45], [4.55, 5.2]]) {
      box(c, (xa + xb) / 2 - 0.05, 0.3, 0.1, 0.1, 17.2, 4, '#1e1f23');
      box(c, xa, 0.36, xb - xa, 0.07, 20, 12, '#1e1f23', '#141518', '#1e1f23');
      const A = xa + 0.04, B = xb - 0.04;
      screenPlane(c, (u, z) => iso(A + u * (B - A), 0.435, 21 + z * 10), MODES.tg ?? 'idle', t, Math.floor(xa * 10));
    }
    box(c, 4.2, 0.62, 0.62, 0.2, 17.2, 0.8, '#e3e3e1');
    if (MODES.tgSend === 'pos') for (let k = 0; k < 3; k++) {
      const ph = (t * 0.55 + k / 3) % 1, [px, py] = iso(4.5 + ph * 0.8, 0.4, 32 + ph * 34);
      c.globalAlpha = 1 - ph; c.fillStyle = '#5ec2f2'; c.beginPath(); c.moveTo(px, py); c.lineTo(px + 6, py - 3); c.lineTo(px + 1.5, py + 2); c.closePath(); c.fill(); c.globalAlpha = 1;
    }
    lamp(c, 5.25, 0.35);
  } });
  it.push({ x0: 3.0, y0: 0.15, x1: 3.45, y1: 0.6, draw: (c, t) => {
    box(c, 3.0, 0.15, 0.45, 0.45, 0, 34, '#1e1f23', '#17181b', '#24252a');
    for (let k = 0; k < 9; k++) { const on = hash(`led${k}:${Math.floor(t * 5 + k)}`) > 0.4; const [lx, ly] = iso(3.08 + (k % 3) * 0.1, 0.6, 6 + Math.floor(k / 3) * 9 + 6); c.fillStyle = on ? '#2ee59d' : '#1d4d3a'; c.fillRect(lx, ly, 1.2, 1.2); }
  } });
  it.push({ x0: 3.15, y0: 0.75, x1: 3.45, y1: 1.05, draw: (c) => { cyl(c, 3.3, 0.9, 0, 0.13, 7, '#2b2c31', '#3a3b42'); ell(c, 3.3, 0.9, 7, 0.1, '#111111'); } });
  it.push({ x0: 2.3, y0: 0.15, x1: 2.9, y1: 0.75, draw: (c) => {
    shadow(c, 2.3, 0.15, 0.6, 0.6); box(c, 2.32, 0.18, 0.55, 0.55, 0, 22, '#f4f4f2', '#d4d3cf', '#e6e5e1');
    box(c, 2.6, 0.73, 0.04, 0.1, 13, 2, '#3a7bd5'); cyl(c, 2.6, 0.45, 22, 0.22, 12, '#7cc0ef', '#5aa6dd');
  } });
  it.push({ x0: 5.8, y0: 0.1, x1: 6.9, y1: 0.6, draw: (c) => {
    shadow(c, 5.8, 0.1, 1.1, 0.5); box(c, 5.8, 0.1, 1.1, 0.5, 0, 52, '#26272c', '#1e1f23', '#2d2e34');
    for (let s = 0; s < 4; s++) {
      const z = 4 + s * 12.5;
      poly(c, [iso(5.86, 0.6, z + 10), iso(6.84, 0.6, z + 10), iso(6.84, 0.6, z), iso(5.86, 0.6, z)], '#141518');
      for (let k = 0; k < 7; k++) {
        const h = hash(`bk${s}${k}`); if (h < 0.18) continue;
        const xa = 5.9 + k * 0.13, col = h > 0.85 ? '#f2c230' : h > 0.6 ? '#f4f4f2' : h > 0.4 ? '#8b8f99' : '#3d3f46';
        poly(c, [iso(xa, 0.6, z + 5 + h * 4), iso(xa + 0.1, 0.6, z + 5 + h * 4), iso(xa + 0.1, 0.6, z), iso(xa, 0.6, z)], col);
      }
    }
  } });
  it.push({ x0: 7.1, y0: 0.1, x1: 8.9, y1: 0.8, draw: (c, t) => {
    shadow(c, 7.1, 0.1, 1.8, 0.7); box(c, 7.1, 0.1, 1.8, 0.7, 0, 15, '#26272c', '#1e1f23', '#2d2e34');
    poly(c, [iso(8.0, 0.8, 13), iso(8.02, 0.8, 13), iso(8.02, 0.8, 2), iso(8.0, 0.8, 2)], '#3a3b42');
    box(c, 7.1, 0.1, 1.8, 0.7, 15, 1.6, '#f4f4f2', '#d4d3cf', '#e6e5e1');
    box(c, 7.3, 0.18, 0.5, 0.42, 16.6, 13, '#1e1f23', '#141518', '#2a2b30'); box(c, 7.42, 0.6, 0.26, 0.04, 21, 3, '#f2c230');
    cyl(c, 7.55, 0.5, 16.6, 0.07, 3, '#ffffff', '#eeeeee');
    if (BUSY.coffee) for (let k = 0; k < 3; k++) { const ph = (t * 0.8 + k / 3) % 1, [sx, sy] = iso(7.55, 0.5, 21 + ph * 12); c.fillStyle = `rgba(255,255,255,${0.55 * (1 - ph)})`; c.beginPath(); c.arc(sx + Math.sin(ph * 6 + k) * 1.5, sy, 1.4, 0, 7); c.fill(); }
    poly(c, [iso(8.2, 0.25, 16.7), iso(8.7, 0.25, 16.7), iso(8.7, 0.6, 16.7), iso(8.2, 0.6, 16.7)], '#aab4bf');
    if (BUSY.sink) for (let k = 0; k < 3; k++) { const ph = (t * 2 + k / 3) % 1, [wx, wy] = iso(8.45, 0.35, 21 - ph * 4); c.fillStyle = 'rgba(140,200,255,.8)'; c.fillRect(wx, wy, 0.8, 1.4); }
    const [fx, fy] = iso(8.45, 0.2, 17); c.strokeStyle = '#8b8f99'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx, fy - 6); c.lineTo(fx + 3, fy - 4.5); c.stroke();
  } });
  it.push({ x0: 12.3, y0: 0.1, x1: 12.95, y1: 0.85, draw: (c) => {
    shadow(c, 12.3, 0.1, 0.65, 0.75); box(c, 12.3, 0.1, 0.65, 0.75, 0, 46, '#f1f1ef', '#d2d1cd', '#e4e3df');
    poly(c, [iso(12.3, 0.85, 30), iso(12.95, 0.85, 30), iso(12.95, 0.85, 29.3), iso(12.3, 0.85, 29.3)], '#b8b7b3');
    box(c, 12.37, 0.85, 0.04, 0.03, 33, 9, '#8b8f99'); box(c, 12.37, 0.85, 0.04, 0.03, 18, 8, '#8b8f99');
    if (BUSY.fridge) poly(c, [iso(12.3, 0.85, 28), iso(12.3, 1.35, 28), iso(12.3, 1.35, 2), iso(12.3, 0.85, 2)], 'rgba(230,240,250,.85)');
  } });
  it.push({ x0: 9.95, y0: 0.15, x1: 10.75, y1: 0.75, draw: (c, t) => {
    shadow(c, 9.95, 0.15, 0.8, 0.6); box(c, 9.95, 0.15, 0.8, 0.6, 0, 13, '#26272c', '#1e1f23', '#2d2e34');
    box(c, 10.02, 0.2, 0.66, 0.5, 13, 7, '#e9e9e7', '#c9c8c4', '#dad9d5'); box(c, 10.15, 0.25, 0.4, 0.3, 20, 0.6, '#ffffff');
    if (BUSY.printer) { const ph = (t * 0.7) % 1; box(c, 10.2, 0.65 + ph * 0.25, 0.3, 0.2, 15, 0.4, '#ffffff'); }
    const [lx, ly] = iso(10.6, 0.7, 17); c.fillStyle = Math.floor(t * 2) % 2 ? '#2ee59d' : '#1d4d3a'; c.fillRect(lx, ly, 1.2, 1.2);
  } });
  it.push({ x0: 11.0, y0: 2.45, x1: 12.55, y1: 3.05, draw: (c, t) => {
    shadow(c, 11.0, 2.45, 1.55, 0.6); box(c, 11.0, 2.45, 1.55, 0.6, 0, 16, '#26272c', '#1e1f23', '#2d2e34');
    poly(c, [iso(11.1, 3.05, 12), iso(12.45, 3.05, 12), iso(12.45, 3.05, 10.8), iso(11.1, 3.05, 10.8)], '#f2c230');
    box(c, 11.0, 2.45, 1.55, 0.6, 16, 1.6, '#f4f4f2', '#d4d3cf', '#e6e5e1');
    box(c, 11.3, 2.55, 0.5, 0.07, 19, 11, '#1e1f23', '#141518', '#2a2b30');
    box(c, 11.95, 2.55, 0.4, 0.07, 19, 9, '#1e1f23', '#141518', '#2a2b30');
    const [rx, ry] = iso(12.35, 2.85, 17.6); c.fillStyle = '#1e1f23'; c.fillRect(rx, ry - 6, 2, 6);
    c.fillStyle = MODES.alarm === 'pos' ? (Math.floor(t * 4) % 2 ? '#ff3b3b' : '#5a2020') : (Math.floor(t * 1.5) % 2 ? '#ff6b6b' : '#5a2020'); c.fillRect(rx, ry - 7, 1.2, 1.2);
    if (MODES.alarm === 'pos') { const [gx, gy] = iso(11.8, 2.7, 30); const g = c.createRadialGradient(gx, gy, 0, gx, gy, 30); g.addColorStop(0, `rgba(255,40,40,${0.25 + 0.2 * Math.sin(t * 8)})`); g.addColorStop(1, 'rgba(255,40,40,0)'); c.fillStyle = g; c.fillRect(gx - 30, gy - 30, 60, 60); }
  } });
  it.push({ x0: 6.95, y0: 4.8, x1: 8.25, y1: 6.0, draw: (c) => {
    ell(c, 7.6, 5.4, 0, 0.5, 'rgba(0,0,0,.12)'); cyl(c, 7.6, 5.4, 0, 0.12, 13, '#1e1f23', '#2b2c31'); cyl(c, 7.6, 5.4, 13, 0.62, 2, '#f7f7f5', '#dcdbd7');
    box(c, 7.35, 5.15, 0.3, 0.22, 15, 0.6, '#ffffff'); box(c, 7.75, 5.45, 0.26, 0.2, 15, 0.6, '#f2c230'); cyl(c, 7.85, 5.2, 15, 0.05, 2.5, '#ffffff', '#eeeeee');
  } });
  it.push({ x0: 4.35, y0: 8.4, x1: 5.25, y1: 9.3, draw: (c, t) => {
    ell(c, 4.8, 8.85, 0, 0.45, 'rgba(0,0,0,.14)'); cyl(c, 4.8, 8.85, 0, 0.1, 6, '#1e1f23', '#2b2c31'); cyl(c, 4.8, 8.85, 6, 0.48, 2, '#2a2b30', '#1e1f23');
    box(c, 4.6, 8.7, 0.32, 0.22, 8, 0.8, '#f2c230'); cyl(c, 5.0, 8.95, 8, 0.06, 2.5, '#ffffff', '#eeeeee'); plant(c, 4.75, 9.15, 0.45, t);
  } });
  for (const [bx, by] of [[3.75, 8.15], [5.75, 9.65]]) it.push({ x0: bx - 0.42, y0: by - 0.42, x1: bx - 0.25, y1: by - 0.25, draw: (c) => {
    ell(c, bx, by, 0, 0.5, 'rgba(0,0,0,.16)');
    const [sx, sy] = iso(bx, by, 0);
    c.fillStyle = '#d9a91c'; c.beginPath(); c.ellipse(sx, sy - 4, 10.5, 6.5, 0, 0, 7); c.fill();
    const g = c.createRadialGradient(sx - 3, sy - 9, 1, sx, sy - 6, 11); g.addColorStop(0, '#ffdc5a'); g.addColorStop(1, '#e8b520');
    c.fillStyle = g; c.beginPath(); c.ellipse(sx - 0.5, sy - 6, 9.5, 5.5, 0, 0, 7); c.fill();
  } });
  it.push({ x0: 5.6, y0: 7.55, x1: 6.3, y1: 8.2, draw: (c) => { ell(c, 5.95, 7.9, 0, 0.36, 'rgba(0,0,0,.12)'); box(c, 5.65, 7.6, 0.6, 0.55, 0, 4, '#f4f4f2', '#d4d3cf', '#e6e5e1'); } });
  it.push({ x0: 9.2, y0: 9.4, x1: 11.3, y1: 10.4, draw: (c) => {
    shadow(c, 9.2, 9.45, 2.1, 0.95);
    box(c, 9.25, 9.45, 2.0, 0.75, 0, 7, '#2f3036', '#26272c', '#34353b');
    box(c, 9.25, 10.05, 2.0, 0.25, 7, 10, '#3a3b42', '#2b2c31', '#3f4047');
    box(c, 9.1, 9.45, 0.18, 0.85, 0, 12, '#3a3b42'); box(c, 11.22, 9.45, 0.18, 0.85, 0, 12, '#3a3b42');
    box(c, 9.4, 9.95, 0.45, 0.12, 9, 6, '#f2c230');
  } });
  it.push({ x0: 9.6, y0: 5.9, x1: 11.4, y1: 6.75, draw: (c) => {
    shadow(c, 9.6, 5.9, 1.8, 0.85);
    box(c, 9.6, 6.55, 1.8, 0.18, 0, 15, '#26272c', '#1e1f23', '#2d2e34');
    poly(c, [iso(10.2, 6.73, 11), iso(10.8, 6.73, 11), iso(10.8, 6.73, 7), iso(10.2, 6.73, 7)], '#f2c230');
    box(c, 9.62, 5.92, 0.12, 0.65, 0, 15, '#1e1f23'); box(c, 11.26, 5.92, 0.12, 0.65, 0, 15, '#1e1f23');
    box(c, 9.6, 5.9, 1.8, 0.85, 15, 2.4, '#f7f7f5', '#d6d5d1', '#e7e6e2');
    box(c, 10.2, 6.25, 0.6, 0.06, 18, 12, '#2a2b30', '#1e1f23', '#33343a');
    box(c, 10.45, 6.3, 0.1, 0.1, 17.4, 2, '#1e1f23');
    box(c, 10.25, 6.0, 0.5, 0.18, 17.4, 0.6, '#e3e3e1');
    for (let k = 0; k < 3; k++) box(c, 9.75, 6.4, 0.32, 0.18, 17.4 + k * 1.1, 1, k % 2 ? '#2e9e5b' : '#38b56b');
    cyl(c, 11.15, 6.1, 17.4, 0.06, 3, '#ffffff', '#eeeeee');
    lamp(c, 11.2, 6.55);
  } });
  for (const [px, py, s] of [[0.45, 0.45, 1.15], [0.45, 10.55, 1.2], [12.55, 10.5, 1.25], [12.6, 3.7, 0.95], [11.85, 6.35, 0.85], [8.75, 8.9, 0.7]] as const)
    it.push({ x0: px - 0.25, y0: py - 0.25, x1: px + 0.25, y1: py + 0.25, draw: (c, t) => plant(c, px, py, s, t) });
  return it;
}

/* ---------- walking grid (half tiles) and paths ---------- */
const GS = 0.5, GX = NX / GS, GY = NY / GS;
function buildGrid(items: Item[]) {
  const free: boolean[][] = [];
  for (let gy = 0; gy < GY; gy++) {
    free.push([]);
    for (let gx = 0; gx < GX; gx++) {
      const cx = (gx + 0.5) * GS, cy = (gy + 0.5) * GS;
      let ok = cx > 0.3 && cy > 0.3 && cx < NX - 0.2 && cy < NY - 0.2;
      for (const it of items) if (it.x1 - it.x0 > 0.2 && it.y1 - it.y0 > 0.2 && cx > it.x0 - 0.12 && cx < it.x1 + 0.12 && cy > it.y0 - 0.12 && cy < it.y1 + 0.12) ok = false;
      free[gy].push(ok);
    }
  }
  return free;
}
function findPath(free: boolean[][], fx: number, fy: number, tx: number, ty: number): Array<[number, number]> {
  const cell = (x: number, y: number): [number, number] => [Math.max(0, Math.min(GX - 1, Math.floor(x / GS))), Math.max(0, Math.min(GY - 1, Math.floor(y / GS)))];
  const nearest = ([cx, cy]: [number, number]): [number, number] => {
    if (free[cy][cx]) return [cx, cy];
    for (let r = 1; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < GX && y < GY && free[y][x]) return [x, y];
    }
    return [cx, cy];
  };
  const s = nearest(cell(fx, fy)), g = nearest(cell(tx, ty));
  const prev = new Map<number, number>(), key = (x: number, y: number) => y * GX + x;
  const q: Array<[number, number]> = [s]; prev.set(key(s[0], s[1]), -1);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (q.length) {
    const [x, y] = q.shift()!;
    if (x === g[0] && y === g[1]) break;
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GX || ny >= GY || !free[ny][nx] || prev.has(key(nx, ny))) continue;
      if (dx && dy && (!free[y][nx] || !free[ny][x])) continue;
      prev.set(key(nx, ny), key(x, y)); q.push([nx, ny]);
    }
  }
  const out: Array<[number, number]> = [];
  let k = key(g[0], g[1]);
  if (!prev.has(k)) return [[tx, ty]];
  while (k !== -1) { const x = k % GX, y = Math.floor(k / GX); out.unshift([(x + 0.5) * GS, (y + 0.5) * GS]); k = prev.get(k)!; }
  out.shift();
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < out.length; i++) {
    const a = pts[pts.length - 1] ?? [fx, fy], b = out[i], n = out[i + 1];
    if (n && Math.abs((b[0] - a[0]) * (n[1] - b[1]) - (b[1] - a[1]) * (n[0] - b[0])) < 1e-6) continue;
    pts.push(b);
  }
  pts.push([tx, ty]);
  return pts;
}

/* ---------- people ---------- */
interface Agent {
  x: number; y: number; vx: number; vy: number; face: Face; path: Array<[number, number]>; act: Spot; until: number; dist: number; speed: number;
  carry: Prop | null; carryUntil: number; patrol: number; last: string; run: boolean;
  scoldUntil: number; bubble: { text: string; until: number; color: string } | null; chase: number; celebrated: string; angryAt: number;
}
const faceTo = (dx: number, dy: number): Face => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'px' : 'nx') : (dy > 0 ? 'py' : 'ny'));
function drawPerson(c: C, p: Person, a: Agent, t: number, st: Status, whipT: number | null) {
  const walking = a.path.length > 0;
  const [sx, sy] = iso(a.x, a.y);
  const shaking = Date.now() < a.scoldUntil;
  const face: Face = walking || shaking || whipT != null ? a.face : a.act.face;
  let pose: Pose = walking ? 'stand' : st.sleep && a.act.id.startsWith('seat-') ? 'sleep' : a.act.pose;
  if (shaking && (pose === 'bean' || pose === 'nap' || pose === 'squat' || pose === 'stretch' || pose === 'jump')) pose = 'stand';
  const front = face === 'px' || face === 'py', flip = face === 'py' || face === 'nx';
  const spd = Math.hypot(a.vx, a.vy), amp = Math.min(1, spd / 1.3);
  const ph = a.dist * 5.2, swing = walking ? Math.sin(ph) * amp : 0, bob = walking ? Math.abs(Math.cos(ph)) * 1.2 * amp : 0;
  const breathe = Math.sin(t * 2 + hash(p.id) * 6) * 0.35;
  const typing = !walking && pose === 'sit' && a.act.id.startsWith('seat-') && !st.sleep && !shaking;
  const sitting = pose === 'sit' || pose === 'sleep' || pose === 'nap', bean = pose === 'bean';
  const jump = pose === 'jump' ? Math.abs(Math.sin(t * 6)) * 5 : 0;
  const squat = pose === 'squat' ? (1 + Math.sin(t * 3.2)) * 1.6 : 0;
  const prop = !walking ? a.act.prop : a.carry;
  c.save(); c.translate(sx + (shaking ? Math.sin(t * 60) * 0.5 : 0), sy); c.scale(PS, PS); if (flip) c.scale(-1, 1);
  if (!sitting && !bean) { c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(0, 0, 5.5 - jump * 0.3, 2.4 - jump * 0.15, 0, 0, 7); c.fill(); }
  c.translate(0, -jump);
  const hip = sitting ? -7.2 : bean ? -4 : -6.6 - bob + squat, torso = 8.4;
  const shoe = '#26272c', pantsD = sh(p.pants, 0.8), shirtD = sh(p.shirt, 0.82);
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (sitting || bean) {
    const fx = front ? 4.5 : 3.5;
    c.strokeStyle = p.pants; c.lineWidth = 2.8;
    for (const o of [-1.4, 1.4]) { c.beginPath(); c.moveTo(o, hip); c.lineTo(fx + o * 0.4, hip + (bean ? 0.5 : 1)); c.lineTo(fx + 1 + o * 0.4, bean ? hip + 2.5 : 0); c.stroke(); }
    c.fillStyle = shoe; for (const o of [-1.4, 1.4]) { c.beginPath(); c.ellipse(fx + 1.8 + o * 0.4, bean ? hip + 3 : -0.5, 1.9, 1.1, 0, 0, 7); c.fill(); }
  } else {
    for (const [o, k] of [[-1.5, 1], [1.5, -1]] as const) {
      const lift = walking ? Math.max(0, Math.sin(ph) * k) * 1.8 * amp : 0, fwd = swing * k * 1.8;
      const knee = squat ? 2.2 + squat : lift * 0.8;
      c.strokeStyle = o < 0 ? pantsD : p.pants; c.lineWidth = 2.8;
      c.beginPath(); c.moveTo(o, hip); c.lineTo(o + fwd * 0.6 + knee * 0.9, (hip - 1.3 - lift) / 2); c.lineTo(o + fwd, -1.3 - lift); c.stroke();
      c.fillStyle = shoe; c.beginPath(); c.ellipse(o + fwd + (front ? 0.8 : -0.3), -0.8 - lift, 1.9, 1.15, 0, 0, 7); c.fill();
    }
  }
  const lean = walking ? 0.6 * amp : 0;
  const hy = hip - torso - 5.6 + breathe * 0.5 + (pose === 'sleep' ? 3.5 : pose === 'nap' ? 1.5 : 0) + (prop === 'hp' && !walking ? 0.6 : 0);
  const hx = (pose === 'sleep' ? 2.5 : pose === 'nap' ? -1.5 : 0) + lean + (!walking && pose === 'stand' && !shaking ? Math.sin(t * 0.6 + hash(p.id) * 9) * 0.5 : 0);
  const R = 6.2;
  if (p.style === 'long') { c.fillStyle = sh(p.hair, 0.9); c.beginPath(); c.roundRect(hx - 6.2, hy - 1, 12.4, front ? 9.5 : 12, 3); c.fill(); }
  const ty = hip - torso + breathe * 0.3;
  const tg = c.createLinearGradient(-4.6, 0, 4.6, 0); tg.addColorStop(0, sh(p.shirt, front ? 1.08 : 0.9)); tg.addColorStop(1, shirtD);
  c.fillStyle = tg; c.beginPath(); c.roundRect(-4.6 + lean * 0.5, ty, 9.2, torso + 0.6, [3.2, 3.2, 1.6, 1.6]); c.fill();
  if (p.tie && front) { c.fillStyle = '#f4f4f2'; c.beginPath(); c.moveTo(-1.6, ty); c.lineTo(1.6, ty); c.lineTo(0, ty + 3); c.fill(); c.fillStyle = '#c0392b'; c.fillRect(-0.6, ty + 1.5, 1.3, 5); }
  if (p.id === 'jaga' && front) { c.fillStyle = '#f2c230'; c.fillRect(-3, ty + 2, 1.6, 1.8); }
  const arm = (side: number, back: boolean) => {
    c.strokeStyle = back ? shirtD : p.shirt; c.lineWidth = 2.4;
    const sxh = side * 4.4 + lean * 0.5, syh = ty + 1.6;
    let ex = sxh + side * 0.6 + swing * side * -2, ey = syh + 6.2;
    if (typing) { ex = sxh + (side > 0 ? 3.4 : 2.2); ey = syh + 4.6 + (Math.sin(t * 17 + side * 2) > 0 ? -0.8 : 0); }
    if (sitting && !typing) { ex = sxh + 2.4; ey = syh + 5.2; }
    if (bean) { ex = sxh + 3; ey = syh + 4.4 + (prop === 'hp' ? Math.sin(t * 9 + side) * 0.5 : 0); }
    if (pose === 'stretch') { ex = sxh + side * 1.2; ey = syh - 7 - Math.sin(t * 2.4) * 1.2; }
    if (pose === 'jump') { ex = sxh + side * 2; ey = syh - 7; }
    if (pose === 'squat') { ex = sxh + 4.5; ey = syh + 1; }
    if (pose === 'sleep') { ex = sxh + 4; ey = syh + 2.5; }
    if (pose === 'nap') { ex = sxh + 1.5; ey = syh + 5.5; }
    if (shaking) { ex = sxh + side * 1.5; ey = syh - 4.5 + Math.sin(t * 30) * 0.6; }
    if (!walking && prop === 'phone' && side > 0 && !shaking) { ex = 3.6; ey = hy + 1.5; }
    if (!walking && prop === 'hp' && !bean && !shaking) { ex = 3.2 - side * 0.4; ey = syh + 3.2; }
    if (!walking && (prop === 'book' || prop === 'paper') && !shaking) { ex = 3.8 - side * 0.3; ey = syh + 3.5; }
    if (!walking && prop === 'can' && a.act.id === 'plant' && side > 0) { ex = 7; ey = syh + 3; }
    if (whipT != null && side > 0) { const w = (whipT % 0.9) / 0.9; ex = sxh + 2 + Math.cos(w * 6.28) * 1.5; ey = syh - 7 + (w < 0.25 ? 6 * (w / 0.25) : 6 - 6 * ((w - 0.25) / 0.75)); }
    c.beginPath(); c.moveTo(sxh, syh); c.lineTo((sxh + ex) / 2 + (side > 0 ? 0.4 : -0.4), (syh + ey) / 2 + 0.3); c.lineTo(ex, ey); c.stroke();
    c.fillStyle = p.skin; c.beginPath(); c.arc(ex, ey + 0.6, 1.35, 0, 7); c.fill();
    if (side > 0) {
      if ((prop === 'cup' || prop === 'can') && pose === 'stand' && a.act.id !== 'plant') { c.fillStyle = prop === 'can' ? '#e5484d' : '#ffffff'; c.fillRect(ex - 0.5, ey - 2.2, 2.6, 3.4); if (prop === 'cup') { c.fillStyle = '#6b4a2b'; c.fillRect(ex - 0.5, ey - 2.2, 2.6, 0.8); } }
      if (prop === 'food' && pose === 'stand') { c.fillStyle = '#f2a33a'; c.beginPath(); c.arc(ex + 0.8, ey - 0.8, 1.8, 0, 7); c.fill(); }
      if (prop === 'trash' && pose === 'stand') { c.fillStyle = '#1e1f23'; c.beginPath(); c.ellipse(ex + 0.5, ey + 2.5, 2.2, 2.8, 0, 0, 7); c.fill(); }
      if (prop === 'phone' && !walking) { c.fillStyle = '#1e1f23'; c.fillRect(ex + 0.3, ey - 2.5, 1.4, 3.6); }
      if (prop === 'hp' && !walking) { c.fillStyle = '#1e1f23'; c.fillRect(ex - 1.8, ey - 2.4, 3.4, 2.4); c.fillStyle = '#7cc8f0'; c.fillRect(ex - 1.4, ey - 2.1, 2.6, 1.6); }
      if ((prop === 'book' || prop === 'paper') && !walking) { c.fillStyle = prop === 'book' ? '#f2c230' : '#ffffff'; c.fillRect(ex - 2.5, ey - 3, 4.6, 3.4); }
      if (prop === 'can' && a.act.id === 'plant' && !walking) {
        c.fillStyle = '#4c7dff'; c.fillRect(ex - 1, ey - 1, 4, 3.5); c.strokeStyle = '#4c7dff'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(ex + 3, ey); c.lineTo(ex + 5.5, ey - 1.5); c.stroke();
        for (let k = 0; k < 3; k++) { const w = (t * 2 + k / 3) % 1; c.fillStyle = 'rgba(120,190,255,.8)'; c.fillRect(ex + 5.5 + w * 1.5, ey - 1 + w * 6, 0.7, 1.2); }
      }
      if (whipT != null) {     // the whip: handle + a lash that cracks every 0.9 s
        const w = (whipT % 0.9) / 0.9, crack = w > 0.2 && w < 0.36;
        c.strokeStyle = '#5a3a1e'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex + 2.2, ey - 2.2); c.stroke();
        const tipX = ex + 2.2 + 13 * (crack ? 1.25 : 0.55 + w * 0.5), tipY = ey - 2.2 + (crack ? 7 : -7 + w * 9);
        c.strokeStyle = '#3a2412'; c.lineWidth = 0.75; c.beginPath(); c.moveTo(ex + 2.2, ey - 2.2);
        c.quadraticCurveTo(ex + 8, ey - 11 + w * 6, tipX, tipY); c.stroke();
        if (crack) { c.fillStyle = '#ffd23f'; c.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 1.4 : 3.6, an = (k / 10) * 6.283; c.lineTo(tipX + Math.cos(an) * r, tipY + Math.sin(an) * r); } c.closePath(); c.fill(); }
      }
    }
  };
  arm(-1, true);
  if (bean && !walking && prop === 'laptop') { c.fillStyle = '#c9cbd1'; c.beginPath(); c.moveTo(1, hip - 1.5); c.lineTo(8, hip - 0.5); c.lineTo(8, hip + 1); c.lineTo(1, hip); c.fill(); c.fillStyle = '#9fd3f2'; c.fillRect(2.5, hip - 6, 5, 4.5); }
  if (sitting && !walking && prop === 'laptop') { c.fillStyle = '#c9cbd1'; c.fillRect(3, hip - 5.5, 5.5, 4); }
  c.fillStyle = sh(p.skin, 0.9); c.fillRect(hx - 1.4, hy + R - 2.2, 2.8, 3);
  const hg = c.createRadialGradient(hx + 1.5, hy - 2, 1, hx, hy, R + 1); hg.addColorStop(0, sh(p.skin, 1.08)); hg.addColorStop(1, sh(p.skin, 0.9));
  c.fillStyle = hg; c.beginPath(); c.arc(hx, hy, R, 0, 7); c.fill();
  const angry = p.id === 'bos' && whipT != null;
  if (angry) { c.fillStyle = 'rgba(255,60,40,.28)'; c.beginPath(); c.arc(hx, hy, R, 0, 7); c.fill(); }
  c.save(); c.beginPath(); c.arc(hx, hy, R + 0.7, 0, 7); c.clip();
  c.fillStyle = p.hair;
  if (front) {
    if (p.style === 'cap') { c.fillStyle = p.cap ?? '#1e1f23'; c.fillRect(hx - R - 1, hy - R - 1, 2 * R + 2, R - 0.5); }
    else {
      c.beginPath(); c.ellipse(hx - 0.6, hy - 3.2, R + 1, R - 1.6, -0.12, 0, 7); c.fill();
      c.beginPath(); c.ellipse(hx - R + 0.6, hy, 2.2, 3.6, 0, 0, 7); c.fill();
      if (p.style === 'curly') for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(hx - 4 + k * 2.1, hy - 3.6, 1.7, 0, 7); c.fill(); }
      if (p.style === 'slick') { c.fillStyle = sh(p.hair, 1.5); c.fillRect(hx - 2, hy - 6.5, 4, 0.8); }
    }
  } else { c.fillRect(hx - R - 1, hy - R - 1, 2 * R + 2, 2 * R - (p.style === 'cap' ? 2.5 : 1.3)); if (p.style === 'cap') { c.fillStyle = p.cap ?? '#1e1f23'; c.fillRect(hx - R - 1, hy - R - 1, 2 * R + 2, R - 0.5); } }
  c.restore();
  if (p.style === 'cap') { c.fillStyle = p.cap ?? '#1e1f23'; c.beginPath(); c.ellipse(hx + (front ? 4.5 : -4.5), hy - 1.4, 3.6, 1.1, 0, 0, 7); c.fill(); }
  if (p.style === 'bun') { c.fillStyle = p.hair; c.beginPath(); c.arc(hx - 1, hy - R - 0.6, 2.6, 0, 7); c.fill(); }
  if (p.headset) { c.strokeStyle = '#1e1f23'; c.lineWidth = 1; c.beginPath(); c.arc(hx, hy, R + 0.6, Math.PI * 1.05, Math.PI * 1.95); c.stroke(); c.fillStyle = '#1e1f23'; c.beginPath(); c.arc(hx - R + 0.4, hy + 0.5, 1.8, 0, 7); c.fill(); }
  if (front && pose !== 'sleep' && pose !== 'nap') {
    const blink = (t * 1000 + hash(p.id) * 4000) % 4000 < 120;
    const look = prop === 'hp' && !walking ? 0.8 : 0;
    c.fillStyle = '#1e1f23';
    for (const ex of [hx - 0.6, hx + 3.2]) { if (blink) c.fillRect(ex - 0.9, hy + 0.6 + look, 1.8, 0.5); else { c.beginPath(); c.ellipse(ex, hy + 0.6 + look, 0.85, shaking ? 1.5 : 1.15, 0, 0, 7); c.fill(); } }
    c.fillStyle = 'rgba(255,120,120,.35)'; c.beginPath(); c.arc(hx - 1.6, hy + 2.8, 1.1, 0, 7); c.arc(hx + 4.3, hy + 2.8, 1.1, 0, 7); c.fill();
    if (angry) {
      c.strokeStyle = '#1e1f23'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(hx - 2, hy - 1.6); c.lineTo(hx + 0.6, hy - 0.6); c.moveTo(hx + 4.6, hy - 1.6); c.lineTo(hx + 2.1, hy - 0.6); c.stroke();
      c.fillStyle = '#5a1a1a'; c.beginPath(); c.ellipse(hx + 1.4, hy + 3.4, 1.4, 1.1 + Math.abs(Math.sin(t * 9)) * 0.7, 0, 0, 7); c.fill();
    } else if (shaking) { c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(hx, hy + 3.6); for (let k = 1; k <= 4; k++) c.lineTo(hx + k * 0.7, hy + 3.6 + (k % 2 ? -0.5 : 0)); c.stroke(); }
    else if (pose === 'jump') { c.fillStyle = '#5a1a1a'; c.beginPath(); c.arc(hx + 1.4, hy + 2.8, 1.3, 0, Math.PI); c.fill(); }
    else { c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.6; c.beginPath(); c.arc(hx + 1.4, hy + 3, 0.9, 0.2, Math.PI - 0.2); c.stroke(); }
    if (p.glasses) { c.strokeStyle = '#1e1f23'; c.lineWidth = 0.6; c.strokeRect(hx - 2.3, hy - 0.6, 3.2, 2.4); c.strokeRect(hx + 1.6, hy - 0.6, 3.2, 2.4); c.beginPath(); c.moveTo(hx + 0.9, hy + 0.2); c.lineTo(hx + 1.6, hy + 0.2); c.stroke(); }
  }
  if (angry) {
    const ax = hx + 4.5, ay = hy - 7 - Math.abs(Math.sin(t * 5)) * 0.8;
    c.strokeStyle = '#e5242b'; c.lineWidth = 1.1;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.beginPath(); c.moveTo(ax + dx * 0.6, ay + dy * 2.2); c.quadraticCurveTo(ax + dx * 0.6, ay + dy * 0.6, ax + dx * 2.2, ay + dy * 0.6); c.stroke(); }
  }
  if (shaking) for (let k = 0; k < 2; k++) {
    const w = (t * 1.6 + k * 0.5) % 1; c.fillStyle = `rgba(110,180,255,${1 - w})`;
    c.beginPath(); c.ellipse(hx - 6 - k * 1.5, hy - 3 + w * 6, 0.8, 1.3, 0, 0, 7); c.fill();
  }
  arm(1, false);
  c.restore();
}

/* ---------- planning ---------- */
const lunch = (now: number) => { const h = new Date(now).getHours(); return h >= 12 && h < 13; };
function variant(s: Spot, now: number): Spot {
  if (s.zone === 'meet' && s.id.startsWith('meet') && lunch(now)) return { ...s, label: 'MAKAN SIANG', prop: 'food' };
  if (!s.alt || Math.random() < 0.45) return s;
  const v = s.alt[Math.floor(Math.random() * s.alt.length)];
  return { ...s, label: v.label, pose: v.pose ?? s.pose, prop: v.prop ?? s.prop };
}
function choose(p: Person, S: Record<string, Status>, a: Agent, taken: Set<string>, now: number, all: Record<string, Agent>): { act: Spot; dwell: number } {
  const s = S[p.id], r = Math.random(), rnd = (lo: number, hi: number) => (lo + Math.random() * (hi - lo)) * 1000;
  const pick = (list: Spot[]) => { const f = list.filter((q) => !taken.has(q.id)); return f.length ? variant(f[Math.floor(Math.random() * f.length)], now) : p.seat; };
  const near = (id: string, label: string): Spot => {
    const q = PEOPLE.find((x) => x.id === id)!.seat;
    return q.face === 'ny' ? { id: `near-${id}-${p.id}`, x: q.x + 0.75, y: q.y + 0.6, face: 'ny', pose: 'stand', label } : { id: `near-${id}-${p.id}`, x: q.x + 0.8, y: q.y + 0.65, face: 'nx', pose: 'stand', label };
  };
  if (p.id === 'jaga') {
    if (s.label === 'ALARM') return { act: { ...p.seat, label: 'ALARM' }, dwell: 4000 };
    if (a.patrol > 0 && a.patrol <= PATROL.length) { const w = PATROL[a.patrol - 1]; a.patrol++; return { act: w, dwell: rnd(1.2, 3) }; }
    if (a.act.id === p.seat.id) {
      if (r < 0.2) return { act: { ...SPOTS.find((q) => q.id === 'toilet')!, label: 'CEK PINTU', prop: undefined }, dwell: rnd(3, 6) };
      a.patrol = 2; return { act: PATROL[0], dwell: rnd(1.5, 3) };
    }
    a.patrol = 0; return { act: { ...p.seat, label: Math.random() < 0.5 ? 'CEK CCTV' : 'JAGA' }, dwell: rnd(18, 35) };
  }
  if (p.id === 'bos') {
    const victims = WORKERS.filter((id) => all[id] && !S[id]?.sleep && S[id]?.label !== 'LIBUR' && !(all[id].act.prop === 'vanish' && !all[id].path.length));
    const sl = victims.filter((id) => S[id]?.sl);
    const slack = victims.filter((id) => { const v = all[id]; return !v.act.id.startsWith('seat-') && !v.path.length; });
    const mad = sl.length ? sl : r < 0.5 && slack.length ? slack : r < 0.62 ? victims : [];
    if (mad.length && now - a.angryAt > 12_000) {
      const id = mad[Math.floor(Math.random() * mad.length)];
      a.angryAt = now; a.chase = 0;
      return { act: { id: `whip-${id}`, x: all[id].x, y: all[id].y, face: 'px', pose: 'stand', label: sl.includes(id) ? 'MARAH (SL!)' : 'MARAH', whip: id }, dwell: rnd(9, 12) };
    }
    if (a.act.id !== p.seat.id && r < 0.75) return { act: { ...p.seat, label: ['NGITUNG CUAN', 'CEK LAPORAN', 'BACA KORAN', 'NGOPI SANTAI'][Math.floor(Math.random() * 4)] }, dwell: rnd(12, 25) };
    if (r < 0.85) { const [x, y] = PACE[Math.floor(Math.random() * PACE.length)]; return { act: { id: `pace-${x}`, x, y, face: 'py', pose: 'stand', label: 'MONDAR-MANDIR' }, dwell: rnd(2, 4) }; }
    return { act: pick(SPOTS.filter((q) => ['coffee', 'tv', 'win2', 'phone'].includes(q.id))), dwell: rnd(6, 10) };
  }
  if (s.sleep || s.label === 'KIRIM PESAN') return { act: p.seat, dwell: 4000 };
  if (s.tp && a.celebrated !== (s.tag?.text ?? '')) { a.celebrated = s.tag?.text ?? ''; return { act: { ...p.seat, pose: 'jump', label: 'SELEBRASI TP' }, dwell: 7000 }; }
  if (a.run) { a.run = false; return { act: p.seat, dwell: rnd(25, 45) }; }
  if (s.label.startsWith('POSISI')) {
    if (!a.act.id.startsWith('seat-') && r < 0.9) return { act: p.seat, dwell: rnd(25, 50) };
    return r < 0.8 ? { act: p.seat, dwell: rnd(25, 50) } : { act: pick(SPOTS.filter((q) => ['coffee', 'water', 'win1', 'win2', 'win3', 'tv', 'stretch', 'trash'].includes(q.id))), dwell: rnd(5, 9) };
  }
  if (s.label === 'LIBUR') return { act: pick(SPOTS.filter((q) => q.zone === 'lounge' || q.zone === 'break' || q.zone === 'meet' || q.id === 'gym' || q.id === 'hp')), dwell: rnd(10, 22) };
  if (!a.act.id.startsWith('seat-') && r < 0.42) {
    const h = new Date(now).getHours(), late = h >= 22 || h < 6;
    return { act: { ...p.seat, label: p.id === 'tg' ? 'BALAS CHAT' : late && Math.random() < 0.4 ? 'NGANTUK' : 'MEMANTAU' }, dwell: rnd(15, 35) };
  }
  if (r < 0.52 && PARTNER[p.id]) return { act: near(PARTNER[p.id], Math.random() < 0.5 ? 'NGOBROL' : 'LIHAT CHART TEMAN'), dwell: rnd(6, 12) };
  return { act: pick(SPOTS), dwell: rnd(7, 16) };
}

/* ---------- component ---------- */
export default function Office({ data, now, screen = [] }: { data: OfficeData; now: number; screen?: ScreenLine[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useMemo(() => statuses(data, now), [data, now]);
  const stRef = useRef(st); stRef.current = st;
  const scrRef = useRef(screen); scrRef.current = screen;
  const items = useMemo(() => furniture(), []);
  const grid = useMemo(() => buildGrid(items), [items]);
  const night = (() => { const h = new Date(now).getHours(); return h >= 18 || h < 6; })();
  const nightRef = useRef(night); nightRef.current = night;
  const view = useRef({ ...HOME });
  const [zoomed, setZoomed] = useState(false);

  // pinch / pan / double tap / wheel zoom (page scroll keeps working while not zoomed)
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const V = view.current;
    const clamp = () => { V.z = Math.max(HOME.z, Math.min(4, V.z)); V.tx = Math.min(0, Math.max(W - W * V.z, V.tx)); V.ty = Math.min(0, Math.max(H - H * V.z, V.ty)); setZoomed(V.z > HOME.z + 0.01); cv.style.touchAction = V.z > HOME.z + 0.01 ? 'none' : 'pan-y'; };
    const pt = (cx: number, cy: number) => { const r = cv.getBoundingClientRect(); return [(cx - r.left) * W / r.width, (cy - r.top) * H / r.height] as const; };
    const zoomAt = (lx: number, ly: number, nz: number) => { const wx = (lx - V.tx) / V.z, wy = (ly - V.ty) / V.z; V.z = Math.max(HOME.z, Math.min(4, nz)); V.tx = lx - wx * V.z; V.ty = ly - wy * V.z; clamp(); };
    let pinch: { d: number; z: number; wx: number; wy: number } | null = null, pan: { x: number; y: number } | null = null, lastTap = 0;
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const a = e.touches[0], b = e.touches[1], [mx, my] = pt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z: V.z, wx: (mx - V.tx) / V.z, wy: (my - V.ty) / V.z }; pan = null;
      } else if (e.touches.length === 1) {
        const [x, y] = pt(e.touches[0].clientX, e.touches[0].clientY);
        const nowT = Date.now();
        if (nowT - lastTap < 300) { e.preventDefault(); if (V.z > HOME.z + 0.01) Object.assign(V, HOME); else zoomAt(x, y, 2.4); clamp(); lastTap = 0; return; }
        lastTap = nowT;
        if (V.z > HOME.z + 0.01) { e.preventDefault(); pan = { x, y }; }
      }
    };
    const tm = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const a = e.touches[0], b = e.touches[1], [mx, my] = pt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        V.z = Math.max(HOME.z, Math.min(4, pinch.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d));
        V.tx = mx - pinch.wx * V.z; V.ty = my - pinch.wy * V.z; clamp();
      } else if (pan && e.touches.length === 1) {
        e.preventDefault();
        const [x, y] = pt(e.touches[0].clientX, e.touches[0].clientY); V.tx += x - pan.x; V.ty += y - pan.y; pan = { x, y }; clamp();
      }
    };
    const te = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; if (!e.touches.length) pan = null; };
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey && V.z <= HOME.z + 0.01 && e.deltaY > 0) return; e.preventDefault(); const [x, y] = pt(e.clientX, e.clientY); zoomAt(x, y, V.z * Math.exp(-e.deltaY * 0.0025)); };
    let drag: { x: number; y: number } | null = null;
    const md = (e: MouseEvent) => { if (V.z > HOME.z + 0.01) drag = { x: e.clientX, y: e.clientY }; };
    const mm = (e: MouseEvent) => { if (!drag) return; const r = cv.getBoundingClientRect(); V.tx += (e.clientX - drag.x) * W / r.width; V.ty += (e.clientY - drag.y) * H / r.height; drag = { x: e.clientX, y: e.clientY }; clamp(); };
    const mu = () => { drag = null; };
    const dbl = (e: MouseEvent) => { const [x, y] = pt(e.clientX, e.clientY); if (V.z > HOME.z + 0.01) { Object.assign(V, HOME); clamp(); } else zoomAt(x, y, 2.4); };
    cv.addEventListener('touchstart', ts, { passive: false }); cv.addEventListener('touchmove', tm, { passive: false }); cv.addEventListener('touchend', te); cv.addEventListener('touchcancel', te);
    cv.addEventListener('wheel', wheel, { passive: false }); cv.addEventListener('mousedown', md); window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu); cv.addEventListener('dblclick', dbl);
    clamp();
    return () => {
      cv.removeEventListener('touchstart', ts); cv.removeEventListener('touchmove', tm); cv.removeEventListener('touchend', te); cv.removeEventListener('touchcancel', te);
      cv.removeEventListener('wheel', wheel); cv.removeEventListener('mousedown', md); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); cv.removeEventListener('dblclick', dbl);
    };
  }, []);

  useEffect(() => {
    const cv = ref.current, box0 = wrap.current; if (!cv || !box0) return;
    const c = cv.getContext('2d'); if (!c) return;
    let k = 1, css = 1, dpr = 1, bg: HTMLCanvasElement | null = null, bgKey = '', raf = 0, last = performance.now(), visible = true;
    const agents: Record<string, Agent> = {};
    const resize = () => {
      const w = box0.clientWidth || W; dpr = Math.min(3, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr); cv.height = Math.round((w * H / W) * dpr); k = cv.width / W; css = w / W; bgKey = '';
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(box0);
    const frame = (tm: number) => {
      if (!visible) return;
      raf = requestAnimationFrame(frame);
      if (document.visibilityState !== 'visible') { last = tm; return; }
      const dt = Math.min(0.05, (tm - last) / 1000); last = tm;
      const t = tm / 1000, wall = Date.now(), S = stRef.current;
      for (const id of WORKERS) { const s = S[id]; MODES[id] = !s || s.label === 'BELUM AKTIF' || s.sleep ? 'off' : s.label.startsWith('POSISI') ? 'pos' : 'idle'; }
      MODES.tgSend = S.tg?.label === 'KIRIM PESAN' ? 'pos' : 'off';
      MODES.alarm = S.jaga?.label === 'ALARM' ? 'pos' : 'off';
      /* ---- simulate ---- */
      const taken = new Set<string>(Object.values(agents).map((a) => a.act.id));
      for (const p of PEOPLE) {
        const s = S[p.id];
        if (!s || s.label === 'BELUM AKTIF') { delete agents[p.id]; continue; }
        let a = agents[p.id];
        if (!a) a = agents[p.id] = { x: p.seat.x, y: p.seat.y, vx: 0, vy: 0, face: p.seat.face, path: [], act: p.seat, until: wall + 2000 + Math.random() * 9000, dist: 0, speed: 1.45, carry: null, carryUntil: 0, patrol: 0, last: s.label, run: false, scoldUntil: 0, bubble: null, chase: 0, celebrated: s.tp ? s.tag?.text ?? '' : '', angryAt: wall - 6000 };
        if (wall < a.scoldUntil) { a.path = []; a.vx = a.vy = 0; continue; }          // frozen while being yelled at
        const forced = (s.sleep || s.label === 'KIRIM PESAN' || s.label === 'ALARM') && a.act.id !== p.seat.id;
        const changed = a.last !== s.label; a.last = s.label;
        if ((!a.path.length && wall > a.until) || forced || (changed && s.label.startsWith('POSISI'))) {
          taken.delete(a.act.id);
          if (a.act.prop && ['cup', 'food', 'can', 'paper', 'book'].includes(a.act.prop) && a.act.id !== 'plant') { a.carry = a.act.prop; a.carryUntil = wall + 20_000; }
          const nx = choose(p, S, a, taken, wall, agents);
          a.act = nx.act; a.until = wall + nx.dwell; taken.add(a.act.id);
          a.speed = a.run ? 2.7 : p.id === 'jaga' && s.label === 'ALARM' ? 2.6 : p.id === 'bos' && a.act.whip ? 2.1 : 1.35 + hash(p.id) * 0.25;
          a.path = Math.hypot(a.act.x - a.x, a.act.y - a.y) > 0.02 ? findPath(grid, a.x, a.y, a.act.x, a.act.y) : [];
        }
        if (wall > a.carryUntil) a.carry = null;
        // the boss chases his victim, then yells and cracks the whip
        if (p.id === 'bos' && a.act.whip) {
          const v = agents[a.act.whip];
          if (!v) a.until = 0;
          else {
            const d = Math.hypot(v.x - a.x, v.y - a.y);
            if (d > 0.95 && wall - a.chase > 600 && wall >= v.scoldUntil) {
              a.chase = wall;
              const ang = Math.atan2(a.y - v.y, a.x - v.x), tx = v.x + Math.cos(ang) * 0.7, ty = v.y + Math.sin(ang) * 0.7;
              a.path = findPath(grid, a.x, a.y, tx, ty); a.act = { ...a.act, label: 'NGEJAR' }; a.until = Math.max(a.until, wall + 3000);
            } else if (d <= 0.95) {
              a.path = []; a.vx = a.vy = 0; a.face = faceTo(v.x - a.x, v.y - a.y);
              if (wall >= v.scoldUntil && !(a.bubble && wall < a.bubble.until)) {
                const dur = 5500;
                a.until = wall + dur + 600;
                const sl = !!S[a.act.whip]?.sl;
                a.act = { ...a.act, label: sl ? 'MARAH (SL!)' : 'MARAH' };
                v.scoldUntil = wall + dur; v.path = []; v.face = faceTo(a.x - v.x, a.y - v.y);
                const yell = sl ? SL_YELL : YELL;
                a.bubble = { text: yell[Math.floor(Math.random() * yell.length)], until: wall + dur, color: '#e5242b' };
                v.bubble = { text: SORRY[Math.floor(Math.random() * SORRY.length)], until: wall + dur, color: '#1e1f23' };
                if (!v.act.id.startsWith('seat-')) { v.run = true; v.until = 0; }
              }
            }
          }
        }
        // steering: smooth curves along the path, slow down at the end, keep a little distance from others
        if (a.path.length) {
          const [gx, gy] = a.path[0], dx = gx - a.x, dy = gy - a.y, d = Math.hypot(dx, dy), lastPt = a.path.length === 1;
          const want = lastPt ? Math.min(a.speed, d * 3.2 + 0.15) : a.speed;
          let ax = d > 1e-4 ? (dx / d) * want : 0, ay = d > 1e-4 ? (dy / d) * want : 0;
          if (!(lastPt && d < 0.7)) for (const q of Object.values(agents)) {
            if (q === a) continue; const ox = a.x - q.x, oy = a.y - q.y, od = Math.hypot(ox, oy);
            if (od > 0.001 && od < 0.42) { ax += (ox / od) * (0.42 - od) * 3; ay += (oy / od) * (0.42 - od) * 3; }
          }
          const kk = Math.min(1, dt * 7); a.vx += (ax - a.vx) * kk; a.vy += (ay - a.vy) * kk;
          const sp = Math.hypot(a.vx, a.vy);
          a.x += a.vx * dt; a.y += a.vy * dt; a.dist += sp * dt;
          if (sp > 0.25) { const nf = faceTo(a.vx, a.vy); if (nf !== a.face && (Math.abs(a.vx) > Math.abs(a.vy) * 1.25 || Math.abs(a.vy) > Math.abs(a.vx) * 1.25)) a.face = nf; }
          if ((!lastPt && d < 0.28) || (lastPt && d < 0.025)) {
            a.path.shift();
            if (!a.path.length) { a.x = gx; a.y = gy; a.vx = a.vy = 0; a.until = Math.max(a.until, wall + 2500); }
          }
        } else { a.vx *= 0.8; a.vy *= 0.8; }
      }
      BUSY.coffee = Object.values(agents).some((a) => a.act.id === 'coffee' && !a.path.length);
      BUSY.sink = Object.values(agents).some((a) => a.act.id === 'sink' && !a.path.length);
      BUSY.printer = Object.values(agents).some((a) => a.act.id === 'printer' && !a.path.length);
      BUSY.fridge = Object.values(agents).some((a) => a.act.id === 'fridge' && !a.path.length);
      /* ---- draw world ---- */
      const V = view.current, nightNow = nightRef.current;
      const key = `${cv.width}x${cv.height}:${nightNow}:${V.z.toFixed(3)}:${V.tx.toFixed(2)}:${V.ty.toFixed(2)}`;
      if (key !== bgKey) {
        if (!bg || bg.width !== cv.width || bg.height !== cv.height) { bg = document.createElement('canvas'); bg.width = cv.width; bg.height = cv.height; }
        const b = bg.getContext('2d')!; b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, bg.width, bg.height);
        b.setTransform(k * V.z, 0, 0, k * V.z, k * V.tx, k * V.ty); drawStatic(b, nightNow); bgKey = key;
      }
      c.setTransform(1, 0, 0, 1, 0, 0); if (bg) c.drawImage(bg, 0, 0);
      c.setTransform(k * V.z, 0, 0, k * V.z, k * V.tx, k * V.ty);
      drawWallText(c, scrRef.current, wall, t);
      const list: Item[] = items.slice();
      for (const p of PEOPLE) {
        const a = agents[p.id]; if (!a) continue;
        if (!a.path.length && a.act.prop === 'vanish') continue;          // in the toilet
        const s = S[p.id];
        const whipT = p.id === 'bos' && a.act.whip && !a.path.length && a.bubble && wall < a.bubble.until ? t : null;
        list.push({ x0: a.x - 0.2, y0: a.y - 0.2, x1: a.x + 0.2, y1: a.y + 0.2, draw: (cc, tt) => drawPerson(cc, p, a, tt, s, whipT) });
      }
      for (const it of isoSort(list)) it.draw(c, t);
      for (const p of PEOPLE) {
        const a = agents[p.id], s = S[p.id]; if (!a) continue;
        const [sx, sy] = iso(a.x, a.y);
        const zz = (s?.sleep && !a.path.length) || (a.act.pose === 'nap' && !a.path.length);
        if (zz) { const ph = (t * 0.5) % 1; c.fillStyle = `rgba(150,170,215,${1 - ph})`; c.font = 'bold 6px sans-serif'; c.fillText('z', sx + 5 + ph * 4, sy - 28 - ph * 8); c.font = 'bold 4.5px sans-serif'; c.fillText('z', sx + 9 + ph * 3, sy - 33 - ph * 6); }
        if (p.id === 'bos' && a.act.whip && !a.path.length && a.bubble && wall < a.bubble.until) {
          const w = (t % 0.9) / 0.9;
          if (w > 0.2 && w < 0.42) { const dir = a.face === 'py' || a.face === 'nx' ? -1 : 1; c.fillStyle = '#ffd23f'; c.strokeStyle = '#1e1f23'; c.lineWidth = 1.2; c.font = '900 7px system-ui, sans-serif'; c.textAlign = 'center'; c.strokeText('CTAR!', sx + dir * 24, sy - 12); c.fillText('CTAR!', sx + dir * 24, sy - 12); c.textAlign = 'start'; }
        }
      }
      if (nightNow) {
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = 'rgba(6,10,28,.28)'; c.fillRect(0, 0, cv.width, cv.height); c.restore();
        c.globalCompositeOperation = 'lighter';
        const glow = (x: number, y: number, z: number, r: number, col: string) => { const [gx, gy] = iso(x, y, z); const g = c.createRadialGradient(gx, gy, 0, gx, gy, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(gx - r, gy - r, 2 * r, 2 * r); };
        for (const y0 of [1.0, 3.4, 6.0, 8.4]) { glow(0.9, y0 + 0.1, 22, 26, 'rgba(255,200,90,.26)'); glow(0.8, y0 + 0.9, 26, 16, 'rgba(90,170,255,.15)'); }
        glow(5.25, 0.4, 22, 24, 'rgba(255,200,90,.24)'); glow(11.2, 6.55, 22, 24, 'rgba(255,200,90,.24)'); glow(8.9, 0, 56, 40, 'rgba(80,160,255,.16)');
        c.globalCompositeOperation = 'source-over';
      }
      /* ---- name tags (screen space, never overlapping) ---- */
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawTags(c, agents, S, wall, (x, y) => [(x * V.z + V.tx) * css, (y * V.z + V.ty) * css], css * W, css * V.z);
    };
    const io = new IntersectionObserver(([e]) => { const was = visible; visible = e.isIntersecting; if (visible && !was) { last = performance.now(); raf = requestAnimationFrame(frame); } }, { threshold: 0 });
    io.observe(box0);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); visible = false; ro.disconnect(); io.disconnect(); };
  }, [items, grid]);

  const d = new Date(now);
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'][d.getDay()];
  const active = PEOPLE.filter((p) => st[p.id] && st[p.id].label !== 'BELUM AKTIF' && !st[p.id].sleep).length;
  return (
    <div className="office" ref={wrap}>
      <canvas ref={ref} className="office-canvas" style={{ aspectRatio: `${W} / ${H}`, touchAction: 'pan-y' }} aria-label="Kantor virtual: status bot dan EA" />
      <div className="office-clock"><b>{clock}</b><span>{day}</span></div>
      <div className="office-count"><i />{active} karyawan aktif</div>
      {zoomed ? <button type="button" className="office-reset" onClick={() => { Object.assign(view.current, HOME); setZoomed(false); if (ref.current) ref.current.style.touchAction = 'pan-y'; }}>1×</button>
        : null}
    </div>
  );
}

/* the live numbers on the wall TV and the team board, drawn in perspective on the back wall */
function drawWallText(c: C, lines: ScreenLine[], wall: number, t: number) {
  const H4 = 4 * 3_600_000, left = H4 - (wall % H4);
  const h4 = `${Math.floor(left / 3_600_000)}:${String(Math.floor((left % 3_600_000) / 60_000)).padStart(2, '0')}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`;
  const onWall = (x0: number, z1: number, fn: () => void) => { const [ox, oy] = iso(x0, 0, z1); c.save(); c.translate(ox, oy); c.transform(1, 0.5, 0, 1, 0, 0); fn(); c.restore(); };
  const tw = (TV.x1 - TV.x0) * TW, th = TV.z1 - TV.z0;
  onWall(TV.x0, TV.z1, () => {
    const g = c.createLinearGradient(0, 0, 0, th); g.addColorStop(0, '#0d2340'); g.addColorStop(1, '#081626');
    c.fillStyle = g; c.fillRect(0, 0, tw, th);
    c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(0, 0, tw, 7.5);
    const live = Math.floor(t * 2) % 2 === 0;
    c.fillStyle = live ? '#ff4d4f' : '#7a2a2a'; c.beginPath(); c.arc(4, 3.9, 1.4, 0, 7); c.fill();
    c.textBaseline = 'middle';
    c.font = '800 5px ui-monospace, Menlo, monospace'; c.fillStyle = '#ffffff'; c.fillText('LIVE', 7, 4);
    c.fillStyle = '#9ec3e6'; c.textAlign = 'right'; c.fillText(`H4 ${h4}`, tw - 2.5, 4); c.textAlign = 'left';
    const rows = lines.slice(0, 4), rh = (th - 8) / Math.max(1, rows.length);
    rows.forEach((l, i) => {
      const y = 8 + rh * (i + 0.5);
      c.font = '600 5.2px ui-monospace, Menlo, monospace'; c.fillStyle = '#86aed3'; c.fillText(l.k, 2.5, y);
      const kw = c.measureText(l.k).width;
      let fs = 7.6; c.font = `800 ${fs}px ui-monospace, Menlo, monospace`;
      while (fs > 4.5 && c.measureText(l.v).width > tw - 7 - kw) { fs -= 0.3; c.font = `800 ${fs}px ui-monospace, Menlo, monospace`; }
      c.fillStyle = l.color ?? '#ffffff'; c.textAlign = 'right'; c.fillText(l.v, tw - 2.5, y); c.textAlign = 'left';
      if (i < rows.length - 1) { c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(2, y + rh / 2, tw - 4, 0.4); }
    });
    c.textBaseline = 'alphabetic';
  });
  const rw = (ROSTER.x1 - ROSTER.x0) * TW, rh2 = ROSTER.z1 - ROSTER.z0;
  onWall(ROSTER.x0, ROSTER.z1, () => {
    c.textBaseline = 'middle';
    c.font = '900 5.2px system-ui, sans-serif'; c.fillStyle = '#b8901a'; c.textAlign = 'center'; c.fillText('T I M', rw / 2, 4); c.textAlign = 'left';
    const lh = (rh2 - 8) / PEOPLE.length;
    PEOPLE.forEach((p, i) => {
      const y = 8 + lh * (i + 0.5);
      c.font = '800 4.6px system-ui, sans-serif'; c.fillStyle = '#1e1f23'; c.fillText(p.name, 2.5, y);
      c.font = '600 3.9px ui-monospace, Menlo, monospace'; c.fillStyle = p.id === 'bos' ? '#c0392b' : '#6b6f78'; c.textAlign = 'right'; c.fillText(p.role, rw - 2.5, y); c.textAlign = 'left';
    });
    c.textBaseline = 'alphabetic';
  });
}

function drawTags(c: C, agents: Record<string, Agent>, S: Record<string, Status>, wall: number, toScreen: (x: number, y: number) => [number, number], cw: number, unit: number) {
  type Tag = { x: number; y: number; w: number; h: number; ax: number; ay: number; name: string; label: string; color: string; extra?: { text: string; color: string } | null; bubble?: Agent['bubble'] };
  const tags: Tag[] = [];
  const nameF = '700 7.2px -apple-system, system-ui, sans-serif', stF = '700 5.6px ui-monospace, Menlo, monospace';
  for (const p of PEOPLE) {
    const a = agents[p.id], s = S[p.id]; if (!a || !s) continue;
    const walking = a.path.length > 0, hidden = !walking && a.act.prop === 'vanish';
    const busy = wall < a.scoldUntil;
    let what = walking ? (a.run ? 'LARI KE MEJA' : p.id === 'bos' && a.act.whip ? 'NGEJAR' : 'JALAN') : a.act.label;
    if (busy) what = 'DIMARAHI BOS';
    let label = s.label, color = s.color;
    if (busy) { label = what; color = '#ff6b6b'; }
    else if (s.label === 'MEMANTAU' || p.id === 'bos' || (p.id === 'jaga' && s.label === 'AMAN')) {
      label = what; color = what === 'MEMANTAU' || what === 'BALAS CHAT' ? s.color : what.startsWith('MARAH') || what === 'NGEJAR' ? '#ff6b6b' : ['JAGA', 'PATROLI', 'CEK CCTV', 'CEK PINTU'].includes(what) ? '#2ee59d' : '#f5b83d';
    } else if (s.label === 'LIBUR') label = `LIBUR · ${what}`;
    else if (s.label.startsWith('POSISI') && what === 'SELEBRASI TP') label = what;
    else if (s.label.startsWith('POSISI') && !a.act.id.startsWith('seat-')) label = `${s.label} · ${what}`;
    const [ax, ay0] = toScreen(...iso(a.x, a.y));
    const seated = !walking && ['sit', 'bean', 'sleep', 'nap'].includes(a.act.pose);
    const ay = hidden ? ay0 - 4 : ay0 - (seated ? 27 : 32) * PS * unit;
    c.font = nameF; const nw = c.measureText(p.name).width;
    c.font = stF; const extraTxt = s.tag && !busy ? ` ${s.tag.text}` : ''; const lw = c.measureText(label + extraTxt).width + 6;
    const w = Math.max(nw, lw) + 7, h = 17;
    tags.push({ x: ax - w / 2, y: ay - h - 2, w, h, ax, ay, name: p.name, label, color, extra: busy ? null : s.tag, bubble: a.bubble && wall < a.bubble.until ? a.bubble : null });
  }
  // place from the bottom up, pushing tags upward / sideways until nothing overlaps
  tags.sort((a, b) => b.ay - a.ay);
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const hit = (r: { x: number; y: number; w: number; h: number }) => placed.find((q) => r.x < q.x + q.w + 2 && r.x + r.w + 2 > q.x && r.y < q.y + q.h + 2 && r.y + r.h + 2 > q.y);
  for (const tg of tags) {
    tg.x = Math.max(2, Math.min(cw - tg.w - 2, tg.x));
    for (let i = 0; i < 12; i++) { const q = hit(tg); if (!q) break; tg.y = q.y - tg.h - 2; }
    if (tg.y < 2) {
      tg.y = Math.max(2, tg.ay - tg.h - 2);
      for (let i = 0; i < 6; i++) { const q = hit(tg); if (!q) break; tg.x = tg.ax < q.x + q.w / 2 ? q.x - tg.w - 2 : q.x + q.w + 2; tg.x = Math.max(2, Math.min(cw - tg.w - 2, tg.x)); }
    }
    placed.push(tg);
  }
  for (const tg of tags) {
    if (tg.y + tg.h < tg.ay - 4 || Math.abs(tg.x + tg.w / 2 - tg.ax) > tg.w / 2) { c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(Math.max(tg.x + 3, Math.min(tg.x + tg.w - 3, tg.ax)), tg.y + tg.h); c.lineTo(tg.ax, tg.ay - 1); c.stroke(); }
    c.fillStyle = 'rgba(18,19,23,.86)'; c.beginPath(); c.roundRect(tg.x, tg.y, tg.w, tg.h, 4.5); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 0.6; c.stroke();
    c.textBaseline = 'middle'; c.textAlign = 'center';
    c.font = nameF; c.fillStyle = '#ffffff'; c.fillText(tg.name, tg.x + tg.w / 2, tg.y + 5.2);
    c.font = stF; c.textAlign = 'left';
    const extra = tg.extra ? ` ${tg.extra.text}` : '', full = c.measureText(tg.label + extra).width + 6;
    let x = tg.x + (tg.w - full) / 2;
    c.fillStyle = tg.color; c.beginPath(); c.roundRect(x, tg.y + 11, 3.6, 3.6, 1); c.fill(); x += 6;
    c.fillStyle = '#f1f3f6'; c.fillText(tg.label, x, tg.y + 12.9); x += c.measureText(tg.label).width;
    if (tg.extra) { c.fillStyle = tg.extra.color; c.fillText(extra, x, tg.y + 12.9); }
    if (tg.bubble) {
      c.font = '800 7.5px -apple-system, system-ui, sans-serif';
      const bw = c.measureText(tg.bubble.text).width + 10, right = tg.x + tg.w + 3 + bw <= cw, bx = right ? tg.x + tg.w + 3 : tg.x - bw - 3, by = tg.y + 1;
      c.fillStyle = '#ffffff'; c.beginPath(); c.roundRect(bx, by, bw, 14, 7); c.fill();
      c.beginPath(); const tx = right ? bx + 6 : bx + bw - 6; c.moveTo(tx - 3, by + 13); c.lineTo(tx + 3, by + 13); c.lineTo(tx + (right ? -5 : 5), by + 18); c.fill();
      c.fillStyle = tg.bubble.color; c.textAlign = 'center'; c.fillText(tg.bubble.text, bx + bw / 2, by + 7.3); c.textAlign = 'left';
    }
    c.textBaseline = 'alphabetic';
  }
}

/** draw order for an isometric scene: a box is in front of another when it is fully past it on x or on y */
function isoSort(list: Item[]): Item[] {
  const n = list.length, behind: number[][] = list.map(() => []);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = list[i], b = list[j];
    let f = 0;
    if (a.x0 >= b.x1 - 1e-6) f = 1; else if (b.x0 >= a.x1 - 1e-6) f = -1;
    else if (a.y0 >= b.y1 - 1e-6) f = 1; else if (b.y0 >= a.y1 - 1e-6) f = -1;
    else f = (a.x0 + a.x1 + a.y0 + a.y1) > (b.x0 + b.x1 + b.y0 + b.y1) ? 1 : -1;
    if (f > 0) behind[i].push(j); else behind[j].push(i);
  }
  const out: Item[] = [], mark = new Uint8Array(n);
  const visit = (i: number) => { if (mark[i]) return; mark[i] = 1; for (const j of behind[i]) visit(j); out.push(list[i]); };
  for (let i = 0; i < n; i++) visit(i);
  return out;
}
