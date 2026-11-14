'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { awayHours, openPositions, statuses, type OfficeData, type ScreenLine, type Status } from '@/components/Office';

/* Kantor, gaya Claude-Office, dengan isi kantor lama (14 Nov 2026):
 *   L3 Ruang Bos  — Marcel (meja rapat) dan Ny. Vetrycia (mejanya sendiri), lift
 *   L2 Trading    — paling lebar: Na, Ni, Nu, Ne, Noel di meja; dinding: papan POSISI SEKARANG di atas papan LIVE; lift
 *   L1 Lobby      — lift, pintu KELUAR + meja satpam (Pentoel), jam besar dengan H4, mesin minuman, dispenser, mesin kopi
 * Bisa di-zoom (cubit dua jari / roda mouse), digeser saat di-zoom, ketuk dua kali = kembali.
 * Orang mengikuti data asli (statuses() di Office.tsx); kegiatan dan acara sama dengan kantor lama (rekap 23:00, rapat Senin,
 * alarm pasar, berita besar). Gambar: Claude-Office (MIT, public/office/tower/LICENSE-Claude-Office.txt), diubah:
 * dinding lebih tinggi, pintu diganti lift, jendela sama semua, hiasan meja dibuang. */

const OLD_H = 747, D = 110, IMG_H = OLD_H + D;     // room pictures: walls made D px taller
const AR = IMG_H / 1000;
const fy = (y: number) => ((y * OLD_H) / 100 + D) / IMG_H * 100;   // a y % on the original picture -> on the taller picture
const FLOORS = ['bos', 'trading', 'lobby'] as const;
type Floor = (typeof FLOORS)[number];
const SC: Record<Floor, number> = { bos: 1, trading: 1.2, lobby: 1 };   // the trading floor is the widest (its wall carries the boards)
const ZBASE: Record<Floor, number> = { lobby: 1000, trading: 2000, bos: 3000 };
type Dir = 'front-left' | 'front-right' | 'rear-left' | 'rear-right';
const SKEW = 'skewY(21.8deg)';                     // the right-hand walls rise 0.4 px per px

// furniture: [sprite, x %, y % (original picture), width (800-px units), z, screens?]
type Furn = [string, number, number, number, number?, boolean?];
const FURN: Record<Floor, Furn[]> = {
  bos: [['whiteboard-mobile', 42.4, 44.5, 62, 31], ['meeting-chair-front-right', 32.8, 63.9, 34, 30], ['meeting-chair-front-right', 38.1, 60.2, 34, 31], ['meeting-chair-front-right', 43.4, 56.6, 34, 32], ['meeting-chair-front-right', 48.7, 53, 34, 33],
    ['meeting-table', 47.9, 74.3, 234, 50], ['meeting-chair-rear-left', 46.8, 75, 36, 70], ['meeting-chair-rear-left', 52.3, 71.2, 36, 71], ['meeting-chair-rear-left', 57.8, 67.3, 36, 72], ['meeting-chair-rear-left', 63.3, 63.5, 36, 73],
    ['desk-left-front', 20.5, 61, 84, 58, true]],
  trading: [['desk-left-rear', 42.4, 50.4, 84], ['desk-left-front', 46.7, 53, 84, undefined, true], ['desk-right-front', 39.9, 55.2, 84, undefined, true],
    ['desk-left-rear', 31.4, 64.8, 84], ['desk-left-front', 35.4, 67.5, 84, undefined, true], ['desk-right-front', 27.9, 70, 84, undefined, true],
    ['desk-left-rear', 59, 73.7, 84], ['desk-left-front', 62.6, 76, 84, undefined, true], ['desk-right-front', 55.4, 78.7, 84, undefined, true], ['desk-right-rear', 66.6, 71.1, 84],
    ['water-cooler', 56.5, 46.5, 24, 40], ['coffee-on', 78.5, 50.2, 40], ['filling-closed', 45, 56.5, 42], ['printer-working', 85.4, 56.8, 55]],
  lobby: [['vending-machine', 37, 46, 56, 30], ['water-cooler', 43.5, 42.5, 24, 31], ['coffee-on', 47.5, 40.5, 40, 29], ['desk-right-front', 79, 67, 76, 67, true]],
};
// the screens of a desk picture (front-facing ones), as fractions of the picture: [x, y] corners
const SCREENS: Record<string, Array<Array<[number, number]>>> = {
  'desk-left-front': [[[115, 25], [196, 10], [196, 59], [115, 73]], [[31, 64], [99, 32], [99, 81], [31, 113]]].map((q) => q.map(([x, y]) => [x / 260, y / 326] as [number, number])),
  'desk-right-front': [[[62, 10], [144, 25], [144, 73], [62, 59]], [[160, 32], [228, 64], [228, 113], [160, 82]]].map((q) => q.map(([x, y]) => [x / 260, y / 326] as [number, number])),
};
// each floor's lift: people fade out / in here
const LIFT: Record<Floor, [number, number]> = { bos: [70.5, 51], trading: [70.5, 51], lobby: [14, 58] };
type Place = [number, number, Dir, number?];
const PLACES: Record<Floor, Record<string, Place>> = {
  bos: { m1: [33.3, 64.4, 'front-right'], m2: [38.6, 60.7, 'front-right'], m3: [43.9, 57.1, 'front-right'], m4: [49.2, 53.5, 'front-right'], m5: [47.3, 74.3, 'rear-left'], m6: [52, 70.3, 'rear-left'], m7: [57.5, 66.5, 'rear-left'], m8: [63, 62.6, 'rear-left'],
    vet: [15.2, 66.6, 'rear-left', 70], board: [47, 47, 'rear-left'], tv: [74, 52, 'rear-right'], win: [22, 52, 'rear-left'], win2: [36, 44, 'rear-left'], pace1: [60, 78, 'front-left'], pace2: [72, 66, 'front-right'], head: [41, 80, 'rear-right'] },
  trading: { s1: [25.8, 71, 'rear-left', 85], s2: [37.9, 68.2, 'rear-right', 85], s4: [38.5, 55.2, 'rear-left', 58], s5: [48.9, 52.9, 'rear-right', 70], s7: [52.7, 78.8, 'rear-left', 95],
    coffee: [73.5, 56.7, 'rear-left'], coffee2: [76.2, 58.4, 'front-right'], water: [55, 50.5, 'rear-left'], printer: [81, 63, 'rear-left'], walkway: [50, 64, 'front-left'],
    win: [18, 56, 'rear-left'], win2: [30, 48, 'rear-left'], tv1: [72, 64, 'rear-right'], tv2: [76, 62, 'rear-right'], tv3: [80, 64, 'rear-right'], tv4: [70, 68, 'rear-right'], tv5: [75, 69, 'rear-right'], tv6: [80, 69, 'rear-right'], stretch: [60, 62, 'front-left'] },
  lobby: { desk: [83.5, 71, 'rear-left', 72], exit: [84, 63, 'rear-right'], lift: [16, 60, 'rear-left'], mid: [50, 66, 'front-right'], street: [97, 84, 'front-left'],
    vend: [40, 52, 'rear-left'], water: [46, 48, 'rear-left'], coffee: [50.5, 46, 'rear-right'], clock: [62, 52, 'rear-right'], left: [28, 64, 'front-left'], front: [55, 80, 'front-right'], corner: [70, 58, 'rear-right'] },
};

type Person = { id: string; sprite: string; color: string; floor: Floor; home: string; trader?: boolean };
const TEAM: Person[] = [
  { id: 'bos', sprite: 'Marcel', color: '#c9a227', floor: 'bos', home: 'm4' },
  { id: 'vet', sprite: 'Frontend-dev-1', color: '#c2557a', floor: 'bos', home: 'vet' },
  { id: 'alt', sprite: 'explore-1', color: '#e5484d', floor: 'trading', home: 's1', trader: true },
  { id: 'big', sprite: 'dev-1', color: '#2fb67c', floor: 'trading', home: 's2', trader: true },
  { id: 'xau', sprite: 'dev-2', color: '#d4a514', floor: 'trading', home: 's4', trader: true },
  { id: 'nas', sprite: 'employee-2', color: '#4c7dff', floor: 'trading', home: 's5', trader: true },
  { id: 'tg', sprite: 'Claude-1', color: '#229ed9', floor: 'trading', home: 's7', trader: true },
  { id: 'ob', sprite: 'employee-1', color: '#5f86a6', floor: 'lobby', home: 'coffee' },
  { id: 'jaga', sprite: 'security-audit-1', color: '#56607a', floor: 'lobby', home: 'desk' },
  { id: 'kurir', sprite: 'employee-3', color: '#c0392b', floor: 'lobby', home: 'street' },
];
const TRADERS = TEAM.filter((p) => p.trader).map((p) => p.id);

/** one thing to do: go to a floor's place, do `label` there for `ms`, optionally saying something */
type Job = { floor: Floor; at: string; label: string; ms: number; say?: [string, string]; face?: Dir };
type Agent = {
  p: Person; floor: Floor; x: number; y: number; face: Dir; path: Array<[number, number]>; seg0: number; at: string | null; until: number;
  label: string; dist: number; v: number; fade: number; fadeTo: number; liftAt: number; jobs: Job[]; gone: boolean; src: string;
  tx: number; ty: number; sayText: string; sayColor: string; sayUntil: number; glance: number; event: boolean;
};
const usd = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`;
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const rnd = (a: number, b: number) => (a + Math.random() * (b - a)) * 1000;

/** what each person does when free, like the old office */
function plan(p: Person, st: Status | undefined, all: Record<string, Agent>): Job[] {
  const r = Math.random(), home = (label: string, ms: number, say?: [string, string]): Job => ({ floor: p.floor, at: p.home, label, ms, say });
  switch (p.id) {
    case 'bos': {
      const slack = TRADERS.filter((id) => all[id] && !all[id].gone && sTo(all[id]) !== 'home');
      if (r < 0.14 && slack.length) { const v = all[pick(slack)]; return [{ floor: 'trading', at: v.p.home, label: 'MARAHIN TRADER', ms: rnd(6, 9), say: [pick(['Kerja! Jangan santai!', 'Chart-nya dipantau!', 'Disiplin, RR 1:2!']), '#c0392b'] }]; }
      if (r < 0.2) return [{ floor: 'trading', at: 'walkway', label: 'SIDAK', ms: rnd(8, 12), say: ['Gimana posisi hari ini?', '#1e1f23'] }];
      if (r < 0.28) return [{ floor: 'lobby', at: 'coffee', label: 'NGOPI', ms: rnd(8, 12) }];
      if (r < 0.38) return [{ floor: 'bos', at: 'tv', label: 'NONTON BERITA', ms: rnd(10, 16) }];
      if (r < 0.46) return [{ floor: 'bos', at: pick(['win', 'win2']), label: 'LIHAT LUAR', ms: rnd(6, 10) }];
      if (r < 0.54) return [{ floor: 'bos', at: 'board', label: 'CORAT-CORET', ms: rnd(8, 12) }];
      if (r < 0.62) return [{ floor: 'bos', at: pick(['pace1', 'pace2', 'head']), label: 'MONDAR-MANDIR', ms: rnd(3, 5) }, { floor: 'bos', at: pick(['pace1', 'pace2']), label: 'MONDAR-MANDIR', ms: rnd(3, 5) }];
      return [home(pick(['NGITUNG CUAN', 'CEK LAPORAN', 'BACA KORAN', 'NGOPI SANTAI', 'TELPON KLIEN']), rnd(14, 26))];
    }
    case 'vet': {
      if (r < 0.1) return [{ floor: 'lobby', at: 'vend', label: 'AMBIL CEMILAN', ms: rnd(5, 8) }];
      if (r < 0.18) return [{ floor: 'bos', at: pick(['win', 'win2']), label: 'LIHAT LUAR', ms: rnd(6, 10) }];
      if (r < 0.24) return [{ floor: 'bos', at: 'm8', label: 'NGOBROL', ms: rnd(8, 12) }];
      return [home(pick(['NONTON DRAKOR', 'NONTON DRAKOR', 'DRAKOR · NANGIS', 'MASKERAN', 'BELANJA ONLINE', 'MAKAN', 'TIDUR']), rnd(20, 40))];
    }
    case 'ob': {
      const fl = pick<Floor>(['bos', 'trading', 'lobby']);
      if (r < 0.22) return [{ floor: fl, at: fl === 'lobby' ? pick(['mid', 'left', 'front']) : fl === 'bos' ? pick(['pace1', 'head']) : pick(['walkway', 'stretch']), label: 'NGEPEL', ms: rnd(9, 14) }];
      if (r < 0.34) return [{ floor: fl === 'lobby' ? 'trading' : fl, at: pick(['win', 'win2']), label: 'LAP JENDELA', ms: rnd(7, 11) }];
      if (r < 0.48) return [{ floor: 'lobby', at: 'coffee', label: 'BIKIN KOPI BOS', ms: rnd(4, 6) }, { floor: 'bos', at: 'm3', label: 'ANTAR KOPI', ms: rnd(3, 5), say: ['Kopinya pak', '#1e1f23'] }];
      if (r < 0.58) return [{ floor: 'trading', at: 'water', label: 'GANTI GALON', ms: rnd(5, 8) }];
      if (r < 0.66) return [{ floor: 'trading', at: 'coffee2', label: 'ANTAR KOPI', ms: rnd(4, 6) }];
      if (r < 0.76) return [{ floor: 'trading', at: 'printer', label: 'BUANG SAMPAH', ms: rnd(4, 6) }];
      return [home(pick(['SIAP SEDIA', 'ISTIRAHAT', 'MAIN HP']), rnd(10, 18))];
    }
    case 'jaga': {
      if (st?.label === 'ALARM') return [home('ALARM', 4000)];
      if (r < 0.25) return [{ floor: 'lobby', at: 'exit', label: 'CEK PINTU', ms: rnd(3, 6) }];
      if (r < 0.45) return ['mid', 'left', 'front', 'corner'].sort(() => Math.random() - 0.5).slice(0, 3).map((at) => ({ floor: 'lobby' as Floor, at, label: 'PATROLI', ms: rnd(1.5, 3) }));
      if (r < 0.55) return [{ floor: 'trading', at: 'walkway', label: 'PATROLI', ms: rnd(3, 5) }];
      return [home(pick(['CEK CCTV', 'JAGA', 'JAGA']), rnd(18, 32))];
    }
    case 'kurir': return [];
    default: {          // traders: busy ones stay at the desk; free ones get up now and then
      const busy = st && (st.sleep || st.label.startsWith('POSISI') || st.label === 'KIRIM PESAN');
      if (busy || r < 0.5) return [home('', rnd(14, 28))];
      const mates = TRADERS.filter((id) => id !== p.id && all[id] && !all[id].gone);
      if (r < 0.58 && mates.length) return [{ floor: 'trading', at: all[pick(mates)].p.home, label: 'LIHAT CHART TEMAN', ms: rnd(6, 10) }];
      if (r < 0.66) return [{ floor: 'trading', at: pick(['coffee', 'coffee2']), label: pick(['BIKIN KOPI', 'BIKIN TEH', 'SEDUH MIE']), ms: rnd(6, 10) }];
      if (r < 0.72) return [{ floor: 'trading', at: 'water', label: pick(['MINUM', 'ISI BOTOL']), ms: rnd(4, 7) }];
      if (r < 0.78) return [{ floor: 'trading', at: 'printer', label: 'PRINT LAPORAN', ms: rnd(5, 8) }];
      if (r < 0.84) return [{ floor: 'trading', at: pick(['win', 'win2']), label: pick(['LIHAT LUAR', 'LIHAT HUJAN', 'MELAMUN']), ms: rnd(6, 10) }];
      if (r < 0.9) return [{ floor: 'trading', at: 'stretch', label: 'PEREGANGAN', ms: rnd(5, 8) }];
      if (r < 0.96) return [{ floor: 'lobby', at: pick(['vend', 'water']), label: pick(['BELI MINUM', 'BELI SNACK']), ms: rnd(5, 8) }];
      return [{ floor: 'trading', at: 'walkway', label: 'MAIN HP', ms: rnd(6, 10) }];
    }
  }
}
const sTo = (a: Agent) => (!a.path.length && a.at === a.p.home && a.floor === a.p.floor ? 'home' : 'away');

export default function OfficeTower({ data, now, screen = [], onSwipe }: { data: OfficeData; now: number; screen?: ScreenLine[]; onSwipe?: () => void }) {
  const d = new Date(now), hour = d.getHours();
  const night = hour >= 18 || hour < 6;
  const tod = night ? 'night' : 'day';
  const S = useMemo(() => statuses(data, now), [data, now]);
  const pos = useMemo(() => openPositions(data), [data]);
  const sRef = useRef<Record<string, Status>>(S); sRef.current = S;
  const dataRef = useRef(data); dataRef.current = data;
  const away = awayHours(now);
  const awayRef = useRef(away); awayRef.current = away;

  // ---------- layout: the tower as tall as fits, the trading floor the widest ----------
  const [box, setBox] = useState({ W: 0, top: 0, left: 0, TW: 0, TH: 0, u: 1 });
  const rootRef = useRef<HTMLDivElement>(null);
  const geo = (W: number) => {
    const g = {} as Record<Floor, { left: number; top: number; w: number; h: number }>;
    const TWd = W * SC.trading;
    let top = 0, prev: { top: number; h: number } | null = null;
    for (const f of FLOORS) {
      const w = W * SC[f], h = w * AR;
      if (prev) top = prev.top + ((433 + D) / IMG_H) * prev.h - (15 / IMG_H) * h;    // the floor below starts just behind the floor above
      g[f] = { left: (TWd - w) / 2, top, w, h }; prev = { top, h };
    }
    return g;
  };
  useEffect(() => {
    const fit = () => {
      const el = rootRef.current; if (!el) return;
      const vw = el.clientWidth, vh = el.clientHeight;
      const g1 = geo(1), total1 = g1.lobby.top + g1.lobby.h;
      const topM = Math.max(vh * 0.05, 30), botM = Math.max(vh * 0.03, 20);
      const W = Math.min((vh - topM - botM) / total1, (vw * 1.0) / SC.trading, 820);    // the widest floor (trading) fits the screen: its wall boards stay in view
      const TW = W * SC.trading, TH = total1 * W;
      setBox({ W, top: topM + (vh - topM - botM - TH) / 2, left: (vw - TW) / 2, TW, TH, u: W / 300 });
    };
    fit(); const ro = new ResizeObserver(fit); if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);
  const boxRef = useRef(box); boxRef.current = box;

  // sky and ground colours (also the iPhone status bar)
  const sky = night ? '#0b1022' : '#7fb6e6', ground = night ? '#1f3a26' : '#7dbb6a';
  useEffect(() => {
    document.documentElement.style.setProperty('--office-sky', sky);
    document.documentElement.style.setProperty('--office-ground', ground);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', sky));
  }, [sky, ground]);

  // ---------- zoom (pinch / wheel), pan when zoomed, double tap = back ----------
  const view = useRef({ z: 1, x: 0, y: 0 });
  const zoomEl = useRef<HTMLDivElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const applyView = () => {
    const v = view.current, el = zoomEl.current, root = rootRef.current; if (!el || !root) return;
    const vw = root.clientWidth, vh = root.clientHeight;
    v.z = Math.min(4, Math.max(1, v.z));
    v.x = Math.min(0, Math.max(vw - vw * v.z, v.x)); v.y = Math.min(0, Math.max(vh - vh * v.z, v.y));
    if (v.z === 1) { v.x = 0; v.y = 0; }
    el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    setZoomed(v.z > 1.02);
  };
  const zoomAt = (cx: number, cy: number, k: number) => {
    const v = view.current, nz = Math.min(4, Math.max(1, v.z * k));
    v.x = cx - ((cx - v.x) * nz) / v.z; v.y = cy - ((cy - v.y) * nz) / v.z; v.z = nz; applyView();
  };
  const reset = () => { view.current = { z: 1, x: 0, y: 0 }; if (zoomEl.current) { zoomEl.current.style.transition = 'transform .25s ease'; applyView(); setTimeout(() => { if (zoomEl.current) zoomEl.current.style.transition = ''; }, 260); } };
  const touch = useRef<{ mode: 'none' | 'pan' | 'pinch' | 'swipe'; x: number; y: number; d: number; t: number; lastTap: number; sx: number; sy: number }>({ mode: 'none', x: 0, y: 0, d: 0, t: 0, lastTap: 0, sx: 0, sy: 0 });
  const swipeRef = useRef(onSwipe); swipeRef.current = onSwipe;
  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    const rel = (x: number, y: number) => { const r = el.getBoundingClientRect(); return [x - r.left, y - r.top] as const; };
    const start = (e: TouchEvent) => {
      const T = touch.current;
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        T.mode = 'pinch'; T.d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        [T.x, T.y] = rel((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      } else if (e.touches.length === 1) {
        const t = e.touches[0]; [T.x, T.y] = rel(t.clientX, t.clientY); T.sx = T.x; T.sy = T.y; T.t = Date.now();
        T.mode = view.current.z > 1.02 ? 'pan' : 'swipe';
      }
    };
    const move = (e: TouchEvent) => {
      const T = touch.current;
      if (T.mode === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = [e.touches[0], e.touches[1]];
        const dd = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), [mx, my] = rel((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        view.current.x += mx - T.x; view.current.y += my - T.y; T.x = mx; T.y = my;
        zoomAt(mx, my, dd / Math.max(1, T.d)); T.d = dd;
      } else if (T.mode === 'pan' && e.touches.length === 1) {
        e.preventDefault();
        const [x, y] = rel(e.touches[0].clientX, e.touches[0].clientY);
        view.current.x += x - T.x; view.current.y += y - T.y; T.x = x; T.y = y; applyView();
      }
    };
    const end = (e: TouchEvent) => {
      const T = touch.current;
      if (T.mode === 'swipe' && e.changedTouches[0]) {
        const [x, y] = rel(e.changedTouches[0].clientX, e.changedTouches[0].clientY), dx = x - T.sx, dy = y - T.sy;
        if (Math.abs(dx) > 55 && Math.abs(dy) < Math.abs(dx) * 0.7) swipeRef.current?.();
        else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
          const nowT = Date.now();
          if (nowT - T.lastTap < 300) { zoomAt(x, y, 2.2); T.lastTap = 0; } else T.lastTap = nowT;     // double tap: zoom in there
        }
      } else if (T.mode === 'pan' && e.changedTouches[0]) {
        const [x, y] = rel(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        if (Math.abs(x - T.sx) < 8 && Math.abs(y - T.sy) < 8) { const nowT = Date.now(); if (nowT - T.lastTap < 300) { reset(); T.lastTap = 0; } else T.lastTap = nowT; }
      }
      if (e.touches.length === 0) T.mode = 'none';
      else if (e.touches.length === 1) { const t = e.touches[0]; [T.x, T.y] = rel(t.clientX, t.clientY); T.mode = view.current.z > 1.02 ? 'pan' : 'none'; }
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const [x, y] = rel(e.clientX, e.clientY); zoomAt(x, y, Math.exp(-e.deltaY * 0.0015)); };
    let drag: { x: number; y: number } | null = null;
    const md = (e: MouseEvent) => { if (view.current.z > 1.02) drag = { x: e.clientX, y: e.clientY }; };
    const mm = (e: MouseEvent) => { if (!drag) return; view.current.x += e.clientX - drag.x; view.current.y += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; applyView(); };
    const mu = () => { drag = null; };
    const dbl = () => reset();
    el.addEventListener('touchstart', start, { passive: true }); el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end); el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('mousedown', md); window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu); el.addEventListener('dblclick', dbl);
    return () => {
      el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end);
      el.removeEventListener('wheel', wheel); el.removeEventListener('mousedown', md); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); el.removeEventListener('dblclick', dbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.W > 0]);

  // ---------- people + events ----------
  const elRefs = useRef<Record<string, { el: HTMLDivElement | null; img: HTMLImageElement | null; tag: HTMLDivElement | null; sub: HTMLElement | null; bub: HTMLDivElement | null }>>({});
  const screenRefs = useRef<HTMLCanvasElement[]>([]);
  const alarmRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const p of TEAM) for (const dir of ['front-left', 'front-right', 'rear-left', 'rear-right']) {
      new Image().src = `/office/chars/${p.sprite}-${dir}.webp`;
      if (dir !== 'rear-right') for (let k = 1; k <= 4; k++) new Image().src = `/office/chars/${p.sprite}-${dir}-walk${k}.webp`;
    }
    const t0 = performance.now();
    const A: Record<string, Agent> = {};
    for (const p of TEAM) {
      const [x, y, face] = PLACES[p.floor][p.home];
      A[p.id] = { p, floor: p.floor, x, y, face, path: [], seg0: 0, at: p.home, until: t0 + 2000 + Math.random() * 8000, label: '', dist: 0, v: 0, fade: 1, fadeTo: 1, liftAt: 0, jobs: [],
        gone: p.id === 'kurir', src: '', tx: 0, ty: 0, sayText: '', sayColor: '#1e1f23', sayUntil: 0, glance: t0 + 4000, event: false };
    }
    const kurirNext = { at: t0 + 60_000 + Math.random() * 120_000 };
    const done: Record<string, string> = {};
    let alarmUntil = 0, evCheck = 0;

    const say = (a: Agent, s?: [string, string]) => { if (s) { a.sayText = s[0]; a.sayColor = s[1]; a.sayUntil = performance.now() + 4200; } };
    /** a gentle curved path to (tx, ty) on the current floor */
    const route = (a: Agent, tx: number, ty: number) => {
      const dx = tx - a.x, dy = ty - a.y, len = Math.hypot(dx, dy);
      if (len < 1) { a.path = []; return; }
      const bend = (Math.random() - 0.5) * Math.min(10, len * 0.35), nx = -dy / len, ny = dx / len;
      const cx = (a.x + tx) / 2 + nx * bend, cy = (a.y + ty) / 2 + ny * bend, pts: Array<[number, number]> = [];
      const n = Math.max(2, Math.round(len / 7));
      for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; pts.push([u * u * a.x + 2 * u * t * cx + t * t * tx, u * u * a.y + 2 * u * t * cy + t * t * ty]); }
      a.path = pts; a.seg0 = performance.now();
    };
    const start = (a: Agent) => {
      const j = a.jobs[0]; if (!j) return;
      if (j.floor !== a.floor) { const [lx, ly] = LIFT[a.floor]; a.at = null; a.label = 'KE LIFT'; route(a, lx, ly); a.liftAt = -1; return; }
      const [tx, ty] = PLACES[a.floor][j.at] ?? PLACES[a.floor][a.p.home];
      a.at = j.at; a.label = j.label; route(a, tx, ty);
    };
    const next = (a: Agent) => {
      if (a.jobs.length && a.jobs[0].floor === a.floor && a.at === a.jobs[0].at && !a.path.length) a.jobs.shift();
      if (!a.jobs.length) {
        a.event = false;
        const st = sRef.current[a.p.id];
        if (a.p.id === 'kurir') { a.gone = true; kurirNext.at = performance.now() + 4 * 60_000 + Math.random() * 6 * 60_000; return; }
        a.jobs = a.floor !== a.p.floor ? [{ floor: a.p.floor, at: a.p.home, label: '', ms: rnd(8, 14) }] : plan(a.p, st, A);
        if (!a.jobs.length) { a.until = performance.now() + 8000; return; }
      }
      start(a);
    };
    const arrive = (a: Agent, nowT: number) => {
      if (a.liftAt === -1) {                      // at the lift: fade out, ride, fade in on the other floor
        a.fadeTo = 0; a.liftAt = nowT + 2200; a.label = 'NAIK LIFT';
        return;
      }
      const j = a.jobs[0], pl = a.at ? PLACES[a.floor][a.at] : null;
      if (pl) a.face = j?.face ?? pl[2];
      a.until = nowT + (j?.ms ?? 8000); say(a, j?.say);
    };
    /** events like the old office */
    const event = (nowT: number) => {
      const dd = new Date(), h = dd.getHours(), m = dd.getMinutes(), day = dd.toDateString(), wall = Date.now(), data = dataRef.current;
      const here = (ids: string[]) => ids.filter((id) => A[id] && !A[id].gone && !(TEAM.find((p) => p.id === id)?.trader && (!sRef.current[id] || sRef.current[id].label === 'BELUM AKTIF')));
      const give = (id: string, jobs: Job[]) => { const a = A[id]; if (!a) return; a.jobs = jobs; a.event = true; a.path = []; a.until = 0; start(a); };
      const big = (data.market ?? []).filter((x) => Math.abs(x.move) >= 1).sort((a, b) => Math.abs(b.move) - Math.abs(a.move))[0];
      if (big && wall - Number(done.pasar ?? 0) > 30 * 60_000) {
        done.pasar = String(wall); alarmUntil = nowT + 70_000;
        const up = big.move > 0, spots = ['tv1', 'tv2', 'tv3', 'tv4', 'tv5', 'tv6'];
        here([...TRADERS, 'ob']).slice(0, 6).forEach((id, i) => give(id, [{ floor: 'trading', at: spots[i], label: 'LIHAT TV', ms: 60_000, face: 'rear-right', say: i === 0 ? [`${big.name} ${up ? 'naik' : 'turun'} ${Math.abs(big.move).toFixed(1)}%!`, up ? '#2e9e5b' : '#e5242b'] : i === 1 ? ['Cepat banget geraknya!', '#1e1f23'] : undefined }]));
        return;
      }
      const cal = data.cal ?? [];
      const nw = cal.find((e) => wall > e.at - 2 * 60_000 && wall < e.at + 10 * 60_000);
      if (nw && done.berita !== `${nw.title}${nw.at}`) {
        done.berita = `${nw.title}${nw.at}`;
        here(TRADERS).slice(0, 6).forEach((id, i) => give(id, [{ floor: 'trading', at: ['tv1', 'tv2', 'tv3', 'tv4', 'tv5', 'tv6'][i], label: 'NONTON BERITA', ms: 120_000, face: 'rear-right', say: i === 0 ? [`${nw.title} keluar!`, '#1e1f23'] : undefined }]));
        return;
      }
      if (h === 23 && m < 4 && done.rekap !== day && here(['bos']).length) {
        done.rekap = day;
        const day0 = new Date(); day0.setHours(0, 0, 0, 0);
        const fin = data.trades.filter((t) => t.result !== 'open' && (t.closedAt ?? 0) >= day0.getTime() && t.strategy !== 'v2' && t.strategy !== 'nas');
        const pnl = fin.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
        const l1: [string, string] = !fin.length ? ['Rekap hari ini: belum ada trade selesai.', '#1e1f23'] : [`Hari ini ${usd(pnl)} dari ${fin.length} trade${pnl >= 0 ? '!' : '.'}`, pnl >= 0 ? '#2e9e5b' : '#e5242b'];
        const l2: [string, string] = !fin.length ? ['Sabar, tunggu setup yang bagus!', '#1e1f23'] : pnl > 0 ? ['Kerja bagus semua!', '#2e9e5b'] : pnl < 0 ? ['Tetap ikut aturan, besok fokus!', '#1e1f23'] : ['Impas. Besok lanjut!', '#1e1f23'];
        give('bos', [{ floor: 'trading', at: 'walkway', label: 'REKAP HARIAN', ms: 5000, say: l1 }, { floor: 'trading', at: 'stretch', label: 'REKAP HARIAN', ms: 5000, say: l2 }, { floor: 'trading', at: 'walkway', label: 'PAMIT PULANG', ms: 4000, say: ['Saya pulang dulu ya!', '#1e1f23'] }]);
        return;
      }
      if (dd.getDay() === 1 && h === 9 && m >= 30 && done.rapat !== day && here(['bos']).length) {
        done.rapat = day;
        const wk = wall - 7 * 86_400_000;
        const fin = data.trades.filter((t) => t.result !== 'open' && (t.closedAt ?? 0) >= wk && t.strategy !== 'v2' && t.strategy !== 'nas');
        const pnl = fin.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
        const seats = ['m1', 'm2', 'm3', 'm5', 'm6', 'm7'];
        here(TRADERS).forEach((id, i) => give(id, [{ floor: 'bos', at: seats[i % seats.length], label: 'RAPAT MINGGUAN', ms: 90_000 }]));
        give('bos', [{ floor: 'bos', at: 'board', label: 'RAPAT MINGGUAN', ms: 8000, say: ['Rapat mingguan, mulai!', '#1e1f23'] },
          { floor: 'bos', at: 'board', label: 'EVALUASI', ms: 8000, say: [fin.length ? `Minggu lalu ${usd(pnl)}, ${fin.length} trade` : 'Minggu lalu belum ada trade selesai', pnl >= 0 ? '#2e9e5b' : '#e5242b'] },
          { floor: 'bos', at: 'board', label: 'EVALUASI', ms: 8000, say: ['Ingat: RR 1:2, keluar cuma di TP/SL!', '#1e1f23'] },
          { floor: 'bos', at: 'board', label: 'RAPAT MINGGUAN', ms: 40_000, say: ['Oke, kembali kerja!', '#1e1f23'] }]);
      }
    };
    const dirOf = (dx: number, dy: number): Dir => `${dy >= 0 ? 'front' : 'rear'}-${dx >= 0 ? 'right' : 'left'}` as Dir;

    let raf = 0, last = performance.now();
    const frame = (nowT: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (nowT - last) / 1000); last = nowT;
      const { W } = boxRef.current; if (!W) return;
      const G = geo(W);
      if (nowT - evCheck > 1000) { evCheck = nowT; event(nowT); }
      if (alarmRef.current) alarmRef.current.style.opacity = nowT < alarmUntil ? String(0.18 + 0.14 * Math.sin(nowT / 160)) : '0';
      // screens on the desks: a little live chart
      for (const cv of screenRefs.current) {
        if (!cv) continue; const c = cv.getContext('2d'); if (!c) continue;
        const polys = SCREENS[cv.dataset.desk ?? ''] ?? [];
        const w = cv.width, h = cv.height; c.clearRect(0, 0, w, h);
        polys.forEach((q, qi) => {
          c.save(); c.beginPath(); q.forEach(([x, y], i) => (i ? c.lineTo(x * w, y * h) : c.moveTo(x * w, y * h))); c.closePath(); c.clip();
          const xs = q.map((p) => p[0] * w), ys = q.map((p) => p[1] * h), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
          c.fillStyle = '#0d1a2b'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
          const seed = Number(cv.dataset.seed ?? 0) + qi * 7, n = 9, cw = (x1 - x0) / n, tt = nowT / 900;
          for (let k = 0; k < n; k++) {
            const v = Math.sin((k + tt + seed) * 0.9) * 0.3 + Math.sin((k + tt * 0.6 + seed) * 2.1) * 0.15, o = Math.sin((k - 1 + tt + seed) * 0.9) * 0.3 + Math.sin((k - 1 + tt * 0.6 + seed) * 2.1) * 0.15;
            const mid = (y0 + y1) / 2 + Math.sin(((x0 + k * cw) / (x1 - x0)) * 0.6) * 2, top = mid - Math.max(v, o) * (y1 - y0), bot = mid - Math.min(v, o) * (y1 - y0);
            c.fillStyle = v >= o ? '#2ee59d' : '#ff6b6b'; c.fillRect(x0 + k * cw + cw * 0.25, top, cw * 0.5, Math.max(1, bot - top));
          }
          c.restore();
        });
      }
      const tags: Array<{ a: Agent; w: number; h: number }> = [];
      for (const a of Object.values(A)) {
        const r = elRefs.current[a.p.id]; if (!r?.el || !r.img || !r.tag) continue;
        const st = sRef.current[a.p.id];
        let absent = a.gone || (a.p.trader && (!st || st.label === 'BELUM AKTIF')) || ((a.p.id === 'bos' || a.p.id === 'vet') && awayRef.current && !a.event);
        if (a.p.id === 'kurir' && a.gone && nowT > kurirNext.at && !awayRef.current) {
          a.gone = false; absent = false; a.floor = 'lobby'; [a.x, a.y] = PLACES.lobby.street;
          a.jobs = [{ floor: 'lobby', at: 'desk', label: 'ANTAR PAKET', ms: 5000, say: ['Paket, pak!', '#1e1f23'] }, { floor: 'lobby', at: 'street', label: 'PULANG', ms: 500 }]; start(a);
        }
        if (absent) { r.el.style.display = 'none'; r.tag.style.display = 'none'; if (r.bub) r.bub.style.display = 'none'; continue; }
        // the lift ride
        if (a.liftAt > 0 && nowT > a.liftAt) {
          const j = a.jobs[0]; a.liftAt = 0;
          if (j) { a.floor = j.floor; [a.x, a.y] = LIFT[a.floor]; a.fade = 0; a.fadeTo = 1; a.face = 'front-right'; start(a); }
        }
        a.fade += Math.sign(a.fadeTo - a.fade) * Math.min(Math.abs(a.fadeTo - a.fade), dt * 2.5);
        let moving = false;
        const g = G[a.floor], sc = SC[a.floor];
        if (a.liftAt === 0 && a.path.length) {
          // walking: speeds up, cruises, slows down at the end (no robot start / stop)
          const remain = a.path.reduce((s, p, i) => s + Math.hypot(((p[0] - (i ? a.path[i - 1][0] : a.x)) * g.w) / 100, ((p[1] - (i ? a.path[i - 1][1] : a.y)) * g.h) / 100), 0);
          const vmax = W * 0.052 * sc, acc = vmax * 2.2;
          a.v = Math.min(vmax, a.v + acc * dt, Math.sqrt(2 * acc * Math.max(remain, 0.5)) + vmax * 0.15);
          let step = a.v * dt;
          while (step > 0 && a.path.length) {
            const [tx, ty] = a.path[0];
            const dxp = ((tx - a.x) * g.w) / 100, dyp = ((ty - a.y) * g.h) / 100, dd = Math.hypot(dxp, dyp);
            if (dd <= step) { a.x = tx; a.y = ty; a.path.shift(); a.dist += dd; step -= dd; if (dd > 0.3) a.face = dirOf(dxp, dyp); }
            else { a.x += ((dxp / dd) * step * 100) / g.w; a.y += ((dyp / dd) * step * 100) / g.h; a.dist += step; a.face = dirOf(dxp, dyp); step = 0; }
          }
          moving = true;
          if (!a.path.length) { a.v = 0; arrive(a, nowT); }
        } else if (a.liftAt === 0 && nowT > a.until) next(a);
        // standing still: now and then a glance to the other side (not at a desk)
        const atDesk = !moving && a.at === a.p.home && a.floor === a.p.floor && a.p.home !== 'street';
        if (!moving && !atDesk && a.liftAt === 0 && nowT > a.glance) {
          a.glance = nowT + 3000 + Math.random() * 5000;
          if (a.face.startsWith('front')) a.face = a.face === 'front-left' ? 'front-right' : 'front-left';
        }
        // picture: the walk cycle follows the distance walked (feet don't slide); rear-right has no walk art: mirror rear-left
        let name = `${a.p.sprite}-${a.face}`, flip = false;
        const stride = W * 0.017 * sc;
        const ph = a.dist / stride;
        if (moving) { let dir = a.face; if (dir === 'rear-right') { dir = 'rear-left'; flip = true; } name = `${a.p.sprite}-${dir}-walk${(Math.floor(ph) % 4) + 1}`; }
        const src = `/office/chars/${name}.webp`;
        if (a.src !== src) { r.img.src = src; a.src = src; }
        const breathe = 1 + Math.sin(nowT / 700 + a.p.id.length * 1.7) * 0.012;
        const typing = atDesk && a.p.trader ? Math.max(0, Math.sin(nowT / 120 + a.p.id.length)) * 0.5 : 0;
        const bob = moving ? Math.abs(Math.sin((ph * Math.PI) / 2)) * 1.6 * sc : typing;
        const sway = moving ? Math.sin((ph * Math.PI) / 2) * 1.6 : 0;
        const pl = a.at && !moving ? PLACES[a.floor][a.at] : undefined;
        const es = r.el.style;
        const px = g.left + (a.x / 100) * g.w, py = g.top + (fy(a.y) / 100) * g.h;
        es.display = ''; es.left = `${px}px`; es.top = `${py}px`; es.width = `${W * 0.0478 * sc}px`;
        es.zIndex = String(ZBASE[a.floor] + (pl?.[3] ?? Math.round(a.y) + 1)); es.opacity = a.fade.toFixed(2);
        es.transform = `translate(-50%, calc(-100% - ${bob.toFixed(2)}px)) rotate(${sway.toFixed(2)}deg) scaleY(${moving ? 1 : breathe.toFixed(4)})${flip ? ' scaleX(-1)' : ''}`;
        // tag: only the activity (busy traders: their bot status), coloured dot
        const home = atDesk;
        let what = moving ? (a.label && a.label !== '' ? a.label : 'JALAN') : home ? (a.label || st?.label || '') : a.label || 'SANTAI';
        if (home && a.p.trader && st) what = st.label;
        if (!home && st?.label === 'LIBUR') what = `LIBUR · ${what}`;
        const extra = st?.tag && (a.p.trader || a.p.id === 'jaga') ? st.tag : null;
        const dot = home && st ? st.color : a.p.color;
        const html = `<i style="background:${dot}"></i>${extra ? `<b style="color:${extra.color}">${extra.text}</b> · ` : ''}${what}`;
        if (r.sub && r.sub.innerHTML !== html) r.sub.innerHTML = html;
        a.tx = px; a.ty = py - W * 0.11 * sc - bob;
        r.tag.style.display = ''; r.tag.style.left = `${a.tx}px`; r.tag.style.opacity = a.fade.toFixed(2);
        if (r.bub) {
          if (nowT < a.sayUntil) { r.bub.style.display = ''; r.bub.textContent = a.sayText; r.bub.style.color = a.sayColor; r.bub.style.left = `${a.tx}px`; }
          else r.bub.style.display = 'none';
        }
        tags.push({ a, w: r.tag.offsetWidth, h: r.tag.offsetHeight });
      }
      // tags never cover each other: one that would overlap a tag below it moves up; speech bubbles sit above the tag
      tags.sort((p, q) => q.a.ty - p.a.ty);
      const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
      for (const t of tags) {
        let y = t.a.ty;
        for (let pass = 0; pass < 6; pass++) {
          const hit = placed.find((o) => Math.abs(o.x - t.a.tx) < (o.w + t.w) / 2 + 1 && y > o.y - o.h - 1 && y - t.h < o.y + 1);
          if (!hit) break;
          y = hit.y - hit.h - 1;
        }
        placed.push({ x: t.a.tx, y, w: t.w, h: t.h });
        const rr = elRefs.current[t.a.p.id]; if (rr?.tag) rr.tag.style.top = `${y}px`;
        if (rr?.bub) rr.bub.style.top = `${y - t.h - 2}px`;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { W, top, left, TW, TH, u } = box;
  if (!W) return <div ref={rootRef} className="tower-root" data-noswipe />;
  const G = geo(W);
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'][d.getDay()];
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'][d.getMonth()];
  const H4 = 4 * 3_600_000, leftH4 = H4 - (now % H4);
  const h4 = `${Math.floor(leftH4 / 3_600_000)}:${pad(Math.floor((leftH4 % 3_600_000) / 60_000))}:${pad(Math.floor((leftH4 % 60_000) / 1000))}`;
  const news = (data.cal ?? []).find((e) => e.at > now - 10 * 60_000 && e.at - now < 3 * 86_400_000);
  const inTime = (ms: number) => { if (ms <= 0) return 'SEDANG RILIS'; const mn = Math.ceil(ms / 60_000); if (mn < 60) return `${mn} MENIT LAGI`; const hr = Math.floor(mn / 60); return hr < 48 ? `${hr} JAM LAGI` : `${Math.floor(hr / 24)} HARI LAGI`; };
  const tile = (i: number) => screen[i] ?? { k: '—', v: '—' };
  let seed = 0;
  return (
    <div ref={rootRef} className="tower-root" data-noswipe
      style={{ background: `linear-gradient(${sky}, ${night ? '#1c2747' : '#cfe6f7'} 55%, ${ground} 55%)` }}>
      {night ? <div className="tower-stars" /> : <><div className="tower-cloud" style={{ top: '4%' }} /><div className="tower-cloud" style={{ top: '11%', animationDelay: '-35s', scale: '.8' }} /></>}
      <div ref={zoomEl} className="tower-zoom">
        <div className="tower-road" />
        <div className="tower" style={{ width: TW, height: TH, top, left, ['--u' as string]: u.toFixed(3) }}>
          {[...FLOORS].reverse().map((f) => {
            const g = G[f], uf = (u * SC[f]).toFixed(3);
            return (
              <div key={f} className="tower-floor" style={{ top: g.top, left: g.left, width: g.w, height: g.h, ['--uf' as string]: uf }}>
                <img className="tower-room" style={{ zIndex: ZBASE[f] }} src={`/office/tower/v2-${f}-${tod}.webp`} alt="" draggable={false} />
                {FURN[f].map(([s, x, y, w, z, scr], i) => (
                  <div key={i} className="tower-it" style={{ left: `${x}%`, top: `${fy(y)}%`, width: `${w / 8}%`, zIndex: ZBASE[f] + (z ?? Math.round(y)) }}>
                    <img src={`/office/tower/${s}.webp`} alt="" draggable={false} />
                    {scr ? <canvas className="tower-scr" width={130} height={163} data-desk={s} data-seed={seed++} ref={(el) => { if (el) screenRefs.current[Number(el.dataset.seed)] = el; }} /> : null}
                  </div>
                ))}
                {f === 'trading' && <>
                  <div className="tower-board" style={{ left: '78.2%', top: `${fy(10.5)}%`, width: '17%', height: '12.5%', transform: SKEW, zIndex: ZBASE[f] + 5 }}>
                    <h4><i className="tower-dot tower-dot-g" />POSISI SEKARANG</h4>
                    {pos.length ? <>
                      {pos.slice(0, 3).map((p, i) => (
                        <div key={i} className="tower-row"><span style={{ color: p.side === 'BUY' ? '#2ee59d' : '#ff6b6b' }}>{p.side === 'BUY' ? 'B' : 'S'}</span><span className="tower-nm">{p.name}</span>
                          <b style={{ color: p.pnl == null ? '#6f93b8' : p.pnl >= 0 ? '#2ee59d' : '#ff6b6b' }}>{p.pnl == null ? '—' : usd(p.pnl)}</b></div>
                      ))}
                      {pos.length > 3 ? <div className="tower-more">+{pos.length - 3} lagi</div> : null}
                    </> : <div className="tower-none">tidak ada posisi</div>}
                  </div>
                  <div className="tower-board" style={{ left: '78.2%', top: `${fy(24.5)}%`, width: '17%', height: '16%', transform: SKEW, zIndex: ZBASE[f] + 5 }}>
                    <h4><i className="tower-dot" />LIVE</h4>
                    <div className="tower-lines">{[0, 1, 2, 3].map((i) => <div key={i}><small>{tile(i).k}</small><b style={{ color: tile(i).color }}>{tile(i).v}</b></div>)}</div>
                  </div>
                  <div ref={alarmRef} className="tower-alarm" style={{ zIndex: ZBASE[f] + 900 }} />
                </>}
                {f === 'lobby' && <>
                  <div className="tower-board tower-clock" style={{ left: '55%', top: `${fy(27)}%`, width: '22%', height: '15.5%', transform: SKEW, zIndex: ZBASE[f] + 5 }}>
                    <b>{clock}</b>
                    <span>{day}, {d.getDate()} {mon} {d.getFullYear()}</span>
                    <em><small>H4</small> {h4}</em>
                    {news ? <strong className={news.at - now < 15 * 60_000 ? 'soon' : ''}>{news.title} · {inTime(news.at - now)}</strong> : null}
                  </div>
                </>}
              </div>
            );
          })}
          {TEAM.map((p) => (
            <div key={p.id} className="tower-ch" style={{ display: 'none' }}
              ref={(el) => { const r = (elRefs.current[p.id] ??= { el: null, img: null, tag: null, sub: null, bub: null }); r.el = el; r.img = el?.querySelector('img') ?? null; }}>
              <img alt="" draggable={false} />
            </div>
          ))}
          <div className="tower-tags">
            {TEAM.map((p) => (
              <div key={p.id}>
                <div className="tower-tag" style={{ display: 'none' }}
                  ref={(el) => { const r = (elRefs.current[p.id] ??= { el: null, img: null, tag: null, sub: null, bub: null }); r.tag = el; r.sub = el?.querySelector('small') ?? null; }}>
                  <small />
                </div>
                <div className="tower-say" style={{ display: 'none' }} ref={(el) => { const r = (elRefs.current[p.id] ??= { el: null, img: null, tag: null, sub: null, bub: null }); r.bub = el; }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      {zoomed ? <button type="button" className="office-reset tower-reset" onClick={reset}>1×</button> : null}
    </div>
  );
}
