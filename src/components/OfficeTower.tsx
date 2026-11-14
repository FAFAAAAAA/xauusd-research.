'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { awayHours, openPositions, statuses, type OfficeData, type ScreenLine, type Status } from '@/components/Office';

/* Kantor, gaya Claude-Office (14 Nov 2026): three floors stacked into a tower that fills the phone screen.
 *   L3 Ruang Bos  — Marcel and Ny. Vetrycia; the TV shows the open positions
 *   L2 Trading    — Na (ALT), Ni (BTC), Nu (XAU), Ne (NASDAQ) and Noel (Telegram) at their desks; the LIVE board
 *   L1 Lobby      — lift, clock, vending machine; Pentoel (security), Udin (OB) and now and then a courier
 * People follow the same real data as before (statuses() in Office.tsx), walk with a 4-frame cycle and change floors by lift.
 * Rooms, furniture and characters: Claude-Office pixel art (MIT, see public/office/tower/LICENSE-Claude-Office.txt). */

const ROOM_AR = 747 / 1000;          // room picture height / width
const PITCH = 0.56;                  // floor-to-floor: the slab above stops right behind the back of the room below
const FLOORS = ['bos', 'trading', 'lobby'] as const;
type Floor = (typeof FLOORS)[number];
const ZBASE: Record<Floor, number> = { lobby: 1000, trading: 2000, bos: 3000 };   // lower floors underneath, everything in one stacking context
const FLOOR_NAME: Record<Floor, string> = { bos: 'L3 · RUANG BOS', trading: 'L2 · TRADING', lobby: 'L1 · LOBBY' };
type Dir = 'front-left' | 'front-right' | 'rear-left' | 'rear-right';
const SEASON = (m: number) => (m <= 1 || m === 11 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn');

// furniture: [sprite (with '*' for the season), x %, y %, width in the 800-px room units of Claude-Office, z]
const FURN: Record<Floor, Array<[string, number, number, number, number?]>> = {
  bos: [['whiteboard-mobile', 42.4, 44.5, 62, 31], ['meeting-chair-front-right', 32.8, 63.9, 34, 30], ['meeting-chair-front-right', 38.1, 60.2, 34, 31], ['meeting-chair-front-right', 43.4, 56.6, 34, 32], ['meeting-chair-front-right', 48.7, 53, 34, 33],
    ['meeting-table', 47.9, 74.3, 234, 50], ['meeting-chair-rear-left', 46.8, 75, 36, 70], ['meeting-chair-rear-left', 52.3, 71.2, 36, 71], ['meeting-chair-rear-left', 57.8, 67.3, 36, 72], ['meeting-chair-rear-left', 63.3, 63.5, 36, 73], ['monstera-plant-*', 88, 62, 50, 62]],
  trading: [['standing-desk-left-rear-*', 42.4, 50.4, 84], ['standing-desk-left-front-*', 46.7, 53, 84], ['standing-desk-right-front-*', 39.9, 55.2, 84],
    ['standing-desk-left-rear-*', 31.4, 64.8, 84], ['standing-desk-left-front-*', 35.4, 67.5, 84], ['standing-desk-right-front-*', 27.9, 70, 84],
    ['standing-desk-left-rear-*', 59, 73.7, 84], ['standing-desk-left-front-*', 62.6, 76, 84], ['standing-desk-right-front-*', 55.4, 78.7, 84], ['standing-desk-right-rear-*', 66.6, 71.1, 84],
    ['coffee-on', 78.5, 50.2, 40], ['filling-closed', 45, 56.5, 42], ['monstera-plant-*', 91.9, 64.7, 50], ['snake-plant-*', 43.2, 37.9, 40], ['money-tree-*', 32, 71.2, 42], ['monstera-plant-*', 60.2, 80.4, 50], ['printer-working', 85.4, 56.8, 55]],
  lobby: [['vending-machine', 37, 46, 56, 30], ['water-cooler', 43.5, 42.5, 24, 31], ['coffee-on', 47.5, 40.5, 40, 29], ['monstera-plant-*', 92, 66, 50], ['money-tree-*', 22, 70, 42]],
};
// each floor's door / lift: people vanish here to change floors
const DOOR: Record<Floor, [number, number]> = { bos: [66, 47], trading: [67.5, 48.9], lobby: [14, 58] };
// named places: [x %, y %, facing, z]
type Place = [number, number, Dir, number?];
const PLACES: Record<Floor, Record<string, Place>> = {
  bos: { m1: [33.3, 64.4, 'front-right'], m4: [49.2, 53.5, 'front-right'], m6: [52, 70.3, 'rear-left'], m8: [63, 62.6, 'rear-left'], board: [47, 47, 'rear-left'], tv: [72, 50, 'rear-right'], win: [25, 55, 'rear-left'] },
  trading: { s1: [25.8, 71, 'rear-left', 85], s2: [37.9, 68.2, 'rear-right', 85], s4: [38.5, 55.2, 'rear-left', 58], s5: [48.9, 52.9, 'rear-right', 70], s7: [52.7, 78.8, 'rear-left', 95],
    coffee: [73.5, 56.7, 'rear-left'], coffee2: [76.2, 58.4, 'front-right'], water: [53.3, 46.6, 'rear-left'], printer: [81, 63, 'rear-left'], walkway: [50, 64, 'front-left'] },
  lobby: { desk: [72, 62, 'front-left'], lift: [16, 60, 'rear-left'], door1: [30, 56, 'rear-right'], door3: [62, 52, 'rear-right'], mid: [50, 66, 'front-right'], street: [97, 82, 'front-left'],
    vend: [40, 52, 'rear-left'], water: [46, 48, 'rear-left'], coffee: [50.5, 46, 'rear-right'], bench: [58, 70, 'front-left'] },
};
const ACT: Record<string, string> = { coffee: 'NGOPI', coffee2: 'NGOPI', water: 'MINUM', printer: 'PRINT', vend: 'JAJAN', board: 'CORAT-CORET', tv: 'NONTON', win: 'LIHAT JENDELA', door1: 'PATROLI', door3: 'PATROLI', mid: 'PATROLI', bench: 'NGEPEL', walkway: 'JALAN' };

type Person = { id: string; name: string; role: string; sprite: string; color: string; floor: Floor; home: string; roam: string[]; visit: Array<[Floor, string, string]>; trader?: boolean };
const TEAM: Person[] = [
  { id: 'bos', name: 'Marcel', role: 'OWNER', sprite: 'Marcel', color: '#c9a227', floor: 'bos', home: 'm4', roam: ['board', 'tv', 'm6', 'win'], visit: [['trading', 'walkway', 'MARAHIN TRADER'], ['lobby', 'coffee', 'NGOPI']] },
  { id: 'vet', name: 'Ny. Vetrycia', role: 'BIG BOS', sprite: 'Frontend-dev-1', color: '#c2557a', floor: 'bos', home: 'm1', roam: ['m8', 'win', 'tv'], visit: [['lobby', 'vend', 'JAJAN']] },
  { id: 'alt', name: 'Na', role: 'ALT', sprite: 'explore-1', color: '#e5484d', floor: 'trading', home: 's1', roam: ['coffee', 'water'], visit: [['lobby', 'water', 'AMBIL MINUM']], trader: true },
  { id: 'big', name: 'Ni', role: 'BTC', sprite: 'dev-1', color: '#2fb67c', floor: 'trading', home: 's2', roam: ['printer', 'coffee2'], visit: [['lobby', 'coffee', 'NGOPI']], trader: true },
  { id: 'xau', name: 'Nu', role: 'XAU', sprite: 'dev-2', color: '#d4a514', floor: 'trading', home: 's4', roam: ['water', 'coffee'], visit: [], trader: true },
  { id: 'nas', name: 'Ne', role: 'NASDAQ', sprite: 'employee-2', color: '#4c7dff', floor: 'trading', home: 's5', roam: ['printer', 'water'], visit: [['lobby', 'vend', 'JAJAN']], trader: true },
  { id: 'tg', name: 'Noel', role: 'TELEGRAM', sprite: 'Claude-1', color: '#229ed9', floor: 'trading', home: 's7', roam: ['coffee2', 'printer'], visit: [['lobby', 'desk', 'AMBIL PAKET']], trader: true },
  { id: 'ob', name: 'Udin', role: 'OB', sprite: 'employee-1', color: '#5f86a6', floor: 'lobby', home: 'coffee', roam: ['water', 'mid', 'vend', 'bench'], visit: [['trading', 'coffee2', 'ANTAR KOPI'], ['bos', 'm6', 'ANTAR KOPI']] },
  { id: 'jaga', name: 'Pentoel', role: 'SECURITY', sprite: 'security-audit-1', color: '#56607a', floor: 'lobby', home: 'desk', roam: ['door1', 'door3', 'mid', 'lift'], visit: [['trading', 'walkway', 'PATROLI']] },
  { id: 'kurir', name: 'Kurir', role: 'KURIR', sprite: 'employee-3', color: '#c0392b', floor: 'lobby', home: 'street', roam: [], visit: [] },
];

type Agent = {
  p: Person; floor: Floor; x: number; y: number; face: Dir; path: Array<[number, number]>; at: string | null; until: number; dwell: number;
  label: string; dist: number; hiddenUntil: number; plan: Array<() => void>; gone: boolean; src: string; tx: number; ty: number;
};
const usd = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`;
const asset = (n: string, season: string) => `/office/tower/${n.replace('*', season)}.webp`;

export default function OfficeTower({ data, now, screen = [], onSwipe }: { data: OfficeData; now: number; screen?: ScreenLine[]; onSwipe?: () => void }) {
  const d = new Date(now), hour = d.getHours();
  const night = hour >= 18 || hour < 6;
  const season = SEASON(d.getMonth());
  const tod = night ? 'night' : 'day';
  const S = useMemo(() => statuses(data, now), [data, now]);
  const pos = useMemo(() => openPositions(data), [data]);
  const sRef = useRef<Record<string, Status>>(S); sRef.current = S;
  const away = awayHours(now);
  const awayRef = useRef(away); awayRef.current = away;

  // ---------- layout: as wide as the screen, as tall as fits ----------
  const [box, setBox] = useState({ W: 0, H: 0, top: 0, left: 0, u: 1, cx: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fit = () => {
      const el = rootRef.current; if (!el) return;
      const vw = el.clientWidth, vh = el.clientHeight;
      const top = Math.max(env(), vh * 0.03), bottom = Math.max(26, vh * 0.04);
      // a little wider than the screen (the outer edges of the rooms are only wall), as tall as fits
      const W = Math.min(vw * (vw < 700 ? 1.15 : 1), (vh - top - bottom) / (ROOM_AR * (1 + PITCH * (FLOORS.length - 1))), 900);
      const H = W * ROOM_AR, total = H * (1 + PITCH * (FLOORS.length - 1));
      setBox({ W, H, top: vh - bottom - total, left: (vw - W) / 2, u: W / 300, cx: Math.max(0, (W - vw) / 2) });
    };
    const env = () => { const t = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat') || '0'); return Number.isFinite(t) && t > 0 ? t : 24; };
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

  // ---------- people ----------
  const elRefs = useRef<Record<string, { el: HTMLDivElement | null; img: HTMLImageElement | null; tag: HTMLDivElement | null; sub: HTMLElement | null }>>({});
  const agents = useRef<Agent[]>([]);
  useEffect(() => {
    // preload every frame once
    for (const p of TEAM) for (const dir of ['front-left', 'front-right', 'rear-left', 'rear-right']) {
      new Image().src = `/office/chars/${p.sprite}-${dir}.webp`;
      if (dir !== 'rear-right') for (let k = 1; k <= 4; k++) new Image().src = `/office/chars/${p.sprite}-${dir}-walk${k}.webp`;
    }
    const t0 = performance.now();
    agents.current = TEAM.map((p) => {
      const [x, y, face] = PLACES[p.floor][p.home];
      return { p, floor: p.floor, x, y, face, path: [], at: p.home, until: t0 + 3000 + Math.random() * 9000, dwell: 0, label: '', dist: 0, hiddenUntil: 0, plan: [], gone: p.id === 'kurir', src: '', tx: 0, ty: 0 };
    });
    const kurirNext = { at: t0 + 60_000 + Math.random() * 120_000 };

    const place = (f: Floor, k: string) => PLACES[f][k];
    const walkTo = (a: Agent, key: string, label: string, dwell: number) => {
      const [tx, ty] = place(a.floor, key);
      const mx = (a.x + tx) / 2 + (Math.random() - 0.5) * 6, my = Math.max(a.y, ty) + 2 + Math.random() * 3;     // a slight detour, not ruler-straight
      a.path = Math.hypot(tx - a.x, ty - a.y) > 14 ? [[mx, my], [tx, ty]] : [[tx, ty]];
      a.at = key; a.dwell = dwell; a.label = label;
    };
    const goFloor = (a: Agent, floor: Floor, key: string, label: string) => {
      a.path = [DOOR[a.floor]]; a.at = null; a.dwell = 0;
      a.plan = [() => {
        a.hiddenUntil = performance.now() + 1800;           // riding the lift
        a.plan = [() => { a.floor = floor; [a.x, a.y] = DOOR[floor]; walkTo(a, key, label, floor === a.p.floor ? 9000 + Math.random() * 12000 : 6000 + Math.random() * 6000); }];
      }];
    };
    const next = (a: Agent) => {
      const p = a.p, st = sRef.current[p.id];
      if (a.plan.length) { a.plan.shift()!(); return; }
      if (p.id === 'kurir') {                                // the courier walks in, leaves a parcel at security and goes
        if (a.at === 'desk') { walkTo(a, 'street', 'PULANG', 0); a.plan = [() => { a.gone = true; kurirNext.at = performance.now() + 4 * 60_000 + Math.random() * 6 * 60_000; }]; }
        return;
      }
      if (a.floor !== p.floor) { goFloor(a, p.floor, p.home, ''); return; }
      const stay = p.trader && st && (st.sleep || st.label.startsWith('POSISI') || st.label === 'KIRIM PESAN');   // busy traders stay at the desk
      const r = Math.random();
      if (stay || (a.at !== p.home && r < 0.55)) { walkTo(a, p.home, '', 9000 + Math.random() * 14000); return; }
      if (p.visit.length && r < 0.72) { const [f, k, label] = p.visit[Math.floor(Math.random() * p.visit.length)]; goFloor(a, f, k, label); return; }
      if (!p.roam.length) { a.until = performance.now() + 8000; return; }
      const k = p.roam[Math.floor(Math.random() * p.roam.length)];
      walkTo(a, k, ACT[k] ?? 'JALAN', 4000 + Math.random() * 6000);
    };
    const dirOf = (dx: number, dy: number): Dir => `${dy >= 0 ? 'front' : 'rear'}-${dx >= 0 ? 'right' : 'left'}` as Dir;

    let raf = 0, last = performance.now();
    const frame = (nowT: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (nowT - last) / 1000); last = nowT;
      const { W, H } = boxRef.current;
      if (!W) return;
      const speed = W * 0.07;
      const tags: Array<{ a: Agent; w: number; h: number }> = [];
      for (const a of agents.current) {
        const r = elRefs.current[a.p.id]; if (!r?.el || !r.img || !r.tag) continue;
        const st = sRef.current[a.p.id];
        // who is in today: traders show up once their bot has reported, the owners go home at night, the courier comes now and then
        let absent = a.gone || (a.p.trader && (!st || st.label === 'BELUM AKTIF')) || ((a.p.id === 'bos' || a.p.id === 'vet') && awayRef.current);
        if (a.p.id === 'kurir' && a.gone && nowT > kurirNext.at && !awayRef.current) {
          a.gone = false; absent = false; a.floor = 'lobby'; [a.x, a.y] = PLACES.lobby.street; walkTo(a, 'desk', 'ANTAR PAKET', 5000);
        }
        if (absent || nowT < a.hiddenUntil) { r.el.style.display = 'none'; r.tag.style.display = 'none'; continue; }
        if (a.hiddenUntil) { a.hiddenUntil = 0; next(a); }
        let moving = false;
        if (a.path.length) {
          const [tx, ty] = a.path[0];
          const dxp = ((tx - a.x) * W) / 100, dyp = ((ty - a.y) * H) / 100, dd = Math.hypot(dxp, dyp), step = speed * dt;
          if (dd <= step) {
            a.x = tx; a.y = ty; a.path.shift(); a.dist += dd;
            if (!a.path.length) { if (a.at) { a.face = place(a.floor, a.at)[2]; a.until = nowT + a.dwell; } else next(a); }
          } else { a.x += ((dxp / dd) * step * 100) / W; a.y += ((dyp / dd) * step * 100) / H; a.dist += step; a.face = dirOf(dxp, dyp); moving = true; }
        } else if (nowT > a.until) next(a);
        // picture: the walk cycle follows the distance walked, so the feet don't slide; there is no rear-right walk art, so mirror rear-left
        let name = `${a.p.sprite}-${a.face}`, flip = false;
        const stride = W * 0.016;
        if (moving) { let dir = a.face; if (dir === 'rear-right') { dir = 'rear-left'; flip = true; } name = `${a.p.sprite}-${dir}-walk${(Math.floor(a.dist / stride) % 4) + 1}`; }
        const src = `/office/chars/${name}.webp`;
        if (a.src !== src) { r.img.src = src; a.src = src; }
        const bob = moving ? Math.abs(Math.sin(((a.dist / stride) * Math.PI) / 2)) * 1.2 : Math.sin(nowT / 900 + a.p.id.length) * 0.35;
        const spot = a.at && !moving && !a.path.length ? place(a.floor, a.at)[3] : undefined;
        const es = r.el.style;
        const ftop = FLOORS.indexOf(a.floor) * PITCH * H;
        es.display = ''; es.left = `${a.x}%`; es.top = `${ftop + (a.y / 100) * H}px`; es.zIndex = String(ZBASE[a.floor] + (spot ?? Math.round(a.y) + 1));
        es.transform = `translate(-50%, calc(-100% - ${bob.toFixed(2)}px))${flip ? ' scaleX(-1)' : ''}`;
        // name tag: activity while walking or away from the desk, the bot status at home
        const atHome = !moving && !a.path.length && a.at === a.p.home && a.floor === a.p.floor;
        const what = moving || a.path.length ? (a.label && a.floor !== a.p.floor ? a.label : 'JALAN') : atHome ? (st?.label ?? '') : a.label;
        const extra = st?.tag && (a.p.trader || a.p.id === 'jaga') ? st.tag : null;
        const html = `${extra ? `<b style="color:${extra.color}">${extra.text}</b> · ` : ''}${what}`;
        if (r.sub && r.sub.innerHTML !== html) r.sub.innerHTML = html;
        if (r.sub) r.sub.style.color = atHome && st ? st.color : a.p.color;
        a.tx = (a.x / 100) * W; a.ty = ftop + (a.y / 100) * H - H * 0.13 - bob;
        r.tag.style.display = ''; r.tag.style.left = `${a.tx}px`;
        tags.push({ a, w: r.tag.offsetWidth, h: r.tag.offsetHeight });
      }
      // name tags never cover each other: one that would overlap a tag below it moves up
      tags.sort((p, q) => q.a.ty - p.a.ty);
      const done: Array<{ x: number; y: number; w: number; h: number }> = [];
      for (const t of tags) {
        let y = t.a.ty;
        for (let pass = 0; pass < 6; pass++) {
          const hit = done.find((o) => Math.abs(o.x - t.a.tx) < (o.w + t.w) / 2 + 1 && y > o.y - o.h - 1 && y - t.h < o.y + 1);
          if (!hit) break;
          y = hit.y - hit.h - 1;
        }
        done.push({ x: t.a.tx, y, w: t.w, h: t.h });
        const tg = elRefs.current[t.a.p.id]?.tag; if (tg) tg.style.top = `${y}px`;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------- swipe sideways: Trade ----------
  const sw = useRef<{ x: number; y: number } | null>(null);
  const swipeRef = useRef(onSwipe); swipeRef.current = onSwipe;

  const { W, H, top, left, u, cx } = box;
  // the server has no idea of the viewer's clock or screen: draw only in the browser
  if (!W) return <div ref={rootRef} className="tower-root" data-noswipe />;
  const clock = d.toTimeString().slice(0, 5);
  const day = ['MIN', 'SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB'][d.getDay()];
  const tile = (i: number) => screen[i] ?? { k: '—', v: '—' };
  return (
    <div
      ref={rootRef} className="tower-root" data-noswipe
      style={{ background: `linear-gradient(${sky}, ${night ? '#1c2747' : '#cfe6f7'} ${Math.round(((top + H * 1.5) / Math.max(1, rootRef.current?.clientHeight ?? 1)) * 100)}%, ${ground} 0)` }}
      onTouchStart={(e) => { sw.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }}
      onTouchEnd={(e) => {
        const s = sw.current, c = e.changedTouches[0]; sw.current = null;
        if (s && c && Math.abs(c.clientX - s.x) > 55 && Math.abs(c.clientY - s.y) < Math.abs(c.clientX - s.x) * 0.7) swipeRef.current?.();
      }}
    >
      {night ? <div className="tower-stars" /> : <><div className="tower-cloud" style={{ top: '6%' }} /><div className="tower-cloud" style={{ top: '14%', animationDelay: '-35s', scale: '.8' }} /></>}
      <div className="tower-road" />
      {(
        <div className="tower" style={{ width: W, height: H * (1 + PITCH * (FLOORS.length - 1)), top, left, ['--u' as string]: u.toFixed(3), ['--cx' as string]: `${cx.toFixed(1)}px` }}>
          {[...FLOORS].reverse().map((f) => (
            <div key={f} className="tower-floor" style={{ top: FLOORS.indexOf(f) * PITCH * H, width: W, height: H }}>
              <img className="tower-room" style={{ zIndex: ZBASE[f] }} src={`/office/tower/${f === 'trading' ? `trading-${tod}-${season}` : `${f}-${tod}`}.webp`} alt="" draggable={false} />
              {FURN[f].map(([s, x, y, w, z], i) => (
                <div key={i} className="tower-it" style={{ left: `${x}%`, top: `${y}%`, width: `${w / 8}%`, zIndex: ZBASE[f] + (z ?? Math.round(y)) }}>
                  <img src={asset(s, season)} alt="" draggable={false} />
                </div>
              ))}
              <span className="tower-label" style={{ zIndex: ZBASE[f] + 500 }}>{FLOOR_NAME[f]}</span>
              {f === 'trading' && (
                <div className="tower-wall" style={{ left: '74%', top: '24.5%', width: '19.5%', height: '18%', transform: 'skewY(23deg)', zIndex: ZBASE[f] + 5 }}>
                  <h4><i className="tower-dot" />LIVE</h4>
                  <div className="tower-tiles">
                    {[0, 1, 2, 3].map((i) => <div key={i}>{tile(i).k}<b style={{ color: tile(i).color }}>{tile(i).v}</b></div>)}
                  </div>
                </div>
              )}
              {f === 'bos' && (
                <div className="tower-wall" style={{ left: '74.3%', top: '26.3%', width: '12%', height: '13%', transform: 'skewY(23deg)', zIndex: ZBASE[f] + 5 }}>
                  <h4>POSISI</h4>
                  {pos.length ? pos.slice(0, 4).map((p, i) => (
                    <div key={i} style={{ color: p.pnl == null ? '#9fb2e6' : p.pnl >= 0 ? '#2ee59d' : '#ff6b6b' }}>{p.side === 'BUY' ? 'B' : 'S'} {p.name} {p.pnl == null ? '' : usd(p.pnl)}</div>
                  )) : <div style={{ color: '#6f93b8' }}>tidak ada posisi</div>}
                </div>
              )}
              {f === 'lobby' && (
                <div className="tower-wall tower-clock" style={{ left: '8%', top: '25.5%', width: '11%', height: '8.5%', transform: 'skewY(-20deg)', zIndex: ZBASE[f] + 5 }}>
                  <b>{clock}</b><span>{day} {d.getDate()}</span>
                </div>
              )}
            </div>
          ))}
          {TEAM.map((p) => (
            <div key={p.id} className="tower-ch" style={{ width: `${(78 * 0.49) / 8}%`, display: 'none' }}
              ref={(el) => { const r = (elRefs.current[p.id] ??= { el: null, img: null, tag: null, sub: null }); r.el = el; r.img = el?.querySelector('img') ?? null; }}>
              <img alt={p.name} draggable={false} />
            </div>
          ))}
          <div className="tower-tags">
            {TEAM.map((p) => (
              <div key={p.id} className="tower-tag" style={{ display: 'none' }}
                ref={(el) => { const r = (elRefs.current[p.id] ??= { el: null, img: null, tag: null, sub: null }); r.tag = el; r.sub = el?.querySelector('small') ?? null; }}>
                {p.name}<small />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
