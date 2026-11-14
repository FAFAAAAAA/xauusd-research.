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
export interface OfficeData {
  trades: JournalTrade[]; binance?: Live; mt5?: Live;
  market?: Array<{ name: string; move: number }>;          // % change of gold / BTC over the last 15 minutes
  cal?: Array<{ title: string; at: number }>;               // big US news coming up (CPI, FOMC, NFP…)
}
export type ScreenLine = { k: string; v: string; color?: string; sub?: string; subColor?: string };

/* ---------- geometry ---------- */
const W = 430, H = 292;
const NX = 15, NY = 12, TW = 15, TH = 7.5, WALL = 82;
const OX = 12 + NY * TW, OY = WALL + 12;
const iso = (x: number, y: number, z = 0): [number, number] => [OX + (x - y) * TW, OY + (x + y) * TH - z];
const SILENT = 35 * 60_000;
const TV = { x0: 4.4, x1: 10.3, z0: 34, z1: 92 };
const ROSTER = { x0: 0.8, x1: 4.0, z0: 26, z1: 74 };   // the team board hangs in the owner's room
const PS = 1.14;                                     // character scale
const RH = 290, ROOMS = 3;         // three rooms stacked (one scene height each)
/* building shape: 'tower' (3 floors in one glass tower), 'zigzag' (cantilevered floors around a glass lift tube), 'rooftop' (tower + roof deck) */
let SHAPE = 'tower', TOPM = 50, TOTAL = RH * ROOMS + TOPM, CW = W;
/* 'flat': one big open floor — the three rooms sit side by side (boss | trading | lobby) behind glass partitions */
let FLAT = false;
const FLATWH = 200;                          // wall height of the open floor
const ORDER = () => (FLAT ? [0, 1, 2] : [2, 1, 0]);      // back to front
const roomX = (r: number) => (FLAT ? r * NX * TW : SHAPE === 'zigzag' ? (r % 2 ? 34 : -34) : 0);
const roomY = (r: number) => (FLAT ? TOPM + r * NX * TH : r * RH + TOPM);
function setShape(sh: string) {
  SHAPE = sh; FLAT = sh === 'flat';
  TOPM = sh === 'rooftop' ? 50 + RH : FLAT ? FLATWH - OY + 30 : 50;
  TOTAL = FLAT ? roomY(2) + OY + (NX + NY) * TH + 60 : RH * ROOMS + TOPM;
  CW = FLAT ? roomX(2) + OX + NX * TW + 20 : W;
}
/* walking between the rooms of the open floor: through a gap in the glass partition */
const DOOR_Y = 5.5;
const hopRoom = (from: number, to: number) => (to > from ? from + 1 : from - 1);
const HOME = { z: 1, tx: 0, ty: 0 };   // replaced on the first resize (fit the three rooms)

type Face = 'px' | 'py' | 'nx' | 'ny';
type Pose = 'stand' | 'sit' | 'sleep' | 'bean' | 'stretch' | 'squat' | 'jump' | 'nap' | 'run';
type Prop = 'tablet' | 'cup' | 'phone' | 'hp' | 'book' | 'paper' | 'laptop' | 'food' | 'vanish' | 'trash' | 'can' | 'club' | 'dumbbell' | 'mop' | 'rag' | 'galon' | 'mic' | 'guitar' | 'box' | 'envelope' | 'paddle';
interface Spot { id: string; room: number; x: number; y: number; face: Face; pose: Pose; label: string; prop?: Prop; zone?: 'break' | 'meet' | 'lounge' | 'eat' | 'gym' | 'boss'; alt?: Array<{ label: string; pose?: Pose; prop?: Prop }>; whip?: string; say?: [string, string] }
interface Person {
  id: string; name: string; role: string; seat: Spot;
  hair: string; skin: string; shirt: string; pants: string; style: 'short' | 'long' | 'bun' | 'cap' | 'slick' | 'curly';
  cap?: string; glasses?: boolean; headset?: boolean; tie?: boolean;
}
const seat = (id: string, room: number, x: number, y: number, face: Face, label = 'MEMANTAU'): Spot => ({ id: `seat-${id}`, room, x, y, face, pose: 'sit', label });
const PEOPLE: Person[] = [
  { id: 'vet', name: 'Ny. Vetrycia', role: 'BIG BOS', seat: seat('vet', 0, 2.2, 3.4, 'px', 'NONTON DRAKOR'), hair: '#4a1422', skin: '#f3cfb0', shirt: '#8e2c48', pants: '#7a2440', style: 'long', glasses: true },
  { id: 'bos', name: 'Marcel', role: 'OWNER', seat: seat('bos', 0, 6.4, 4.0, 'py', 'NGITUNG CUAN'), hair: '#1a1a1a', skin: '#e9b98f', shirt: '#24262c', pants: '#1c1d22', style: 'slick', glasses: true, tie: true },
  { id: 'alt', name: 'Na', role: 'ALT', seat: seat('alt', 1, 2.35, 1.55, 'nx'), hair: '#5a3825', skin: '#f3cba5', shirt: '#e5484d', pants: '#2c3e66', style: 'short' },
  { id: 'big', name: 'Ni', role: 'BTC', seat: seat('big', 1, 2.35, 3.75, 'nx'), hair: '#1b1b1b', skin: '#d9a477', shirt: '#2fb67c', pants: '#34363c', style: 'cap', cap: '#1f2024' },
  { id: 'xau', name: 'Nu', role: 'XAU', seat: seat('xau', 1, 2.35, 5.95, 'nx'), hair: '#b8692b', skin: '#f5d2b3', shirt: '#f2c230', pants: '#4b4038', style: 'long' },
  { id: 'nas', name: 'Ne', role: 'NASDAQ', seat: seat('nas', 1, 2.35, 8.15, 'nx'), hair: '#3e2a1e', skin: '#ebbd94', shirt: '#4c7dff', pants: '#26272b', style: 'bun' },
  { id: 'tg', name: 'Noel', role: 'TELEGRAM', seat: seat('tg', 1, 2.35, 10.35, 'nx', 'BALAS CHAT'), hair: '#6b3e26', skin: '#f0c49c', shirt: '#229ed9', pants: '#2c2f36', style: 'curly', headset: true },
  { id: 'jaga', name: 'Pentoel', role: 'SECURITY', seat: seat('jaga', 2, 13.65, 3.2, 'px', 'CEK CCTV'), hair: '#222', skin: '#c99064', shirt: '#2f3b55', pants: '#1f2533', style: 'cap', cap: '#1f2a44' },
  { id: 'ob', name: 'Udin', role: 'OB', seat: { ...seat('ob', 2, 6.2, 1.9, 'ny', 'SIAP SEDIA'), pose: 'stand' }, hair: '#2a1d14', skin: '#d6a074', shirt: '#7fa7c4', pants: '#3b4a5a', style: 'short' },
  { id: 'tamu', name: 'Tamu', role: 'KLIEN', seat: { ...seat('tamu', 2, 13.5, 0.95, 'py', 'DATANG'), pose: 'stand' }, hair: '#3a2a20', skin: '#efc9a4', shirt: '#3b4a6b', pants: '#2a2f3a', style: 'slick', tie: true, glasses: true },
  { id: 'kurir', name: 'Kurir', role: 'KURIR', seat: { ...seat('kurir', 2, 11.65, 0.95, 'py', 'DATANG'), pose: 'stand' }, hair: '#222', skin: '#e2b48a', shirt: '#e5484d', pants: '#2a2b30', style: 'cap', cap: '#c0392b' },
];
const WORKERS = ['alt', 'big', 'xau', 'nas', 'tg'];
const LIFT = { x: 11.65, y: 0.6 };
const LIFT_WAIT = 1.6;             // where people wait in front of the lift doors
const CAB_Y = -0.7;                // the cabin runs in a shaft behind the back wall (seen through a glass panel)
const LW = { x0: 11.15, x1: 12.3, z: 92 };   // the glass panel in the back wall
const lwOf = (room: number) => (room === 2 ? { x0: 9.3, x1: 10.45, z: LW.z } : LW);     // in the lobby: left of the clock-in machine, clear of Pentoel's desk
const lwX = (room: number) => (lwOf(room).x0 + lwOf(room).x1) / 2;
/** one trip of the lift: call the cabin (A), doors open / walk in / doors close (B), travel (C), doors open / walk out / doors close (D) */
type Ride = { from: number; to: number; start: number; t0: number; dA: number; dB: number; dC: number; dD: number; dur: number };
const LIFTCTL: { busyUntil: number; ride: Ride | null; who: string } = { busyUntil: 0, ride: null, who: '' };

const S0: Array<Omit<Spot, 'room'>> = [
  { id: 'safe', x: 8.37, y: 1.45, face: 'ny', pose: 'stand', label: 'BUKA BRANKAS', zone: 'boss' },
  { id: 'trophy', x: 9.7, y: 1.2, face: 'ny', pose: 'stand', label: 'LIHAT PIALA', zone: 'boss' },
  { id: 'golf', x: 8.7, y: 5.3, face: 'px', pose: 'stand', label: 'MAIN GOLF', prop: 'club', zone: 'boss' },
  { id: 'meet1', x: 2.0, y: 7.6, face: 'px', pose: 'sit', label: 'RAPAT', zone: 'meet', alt: [{ label: 'BIKIN LAPORAN', prop: 'laptop' }] },
  { id: 'meet2', x: 4.0, y: 7.6, face: 'nx', pose: 'sit', label: 'RAPAT', zone: 'meet' },
  { id: 'meet3', x: 2.0, y: 8.5, face: 'px', pose: 'sit', label: 'RAPAT', zone: 'meet', alt: [{ label: 'PRESENTASI', prop: 'laptop' }] },
  { id: 'meet4', x: 4.0, y: 8.5, face: 'nx', pose: 'sit', label: 'RAPAT', zone: 'meet' },
  { id: 'bsofa1', x: 9.75, y: 9.55, face: 'ny', pose: 'sit', label: 'NUNGGU BOS', zone: 'lounge' },
  { id: 'bsofa2', x: 10.75, y: 9.55, face: 'ny', pose: 'sit', label: 'NUNGGU BOS', zone: 'lounge' },
  { id: 'bwin', x: 0.95, y: 4.6, face: 'nx', pose: 'stand', label: 'LIHAT LUAR' },
  { id: 'fish', x: 13.6, y: 1.25, face: 'ny', pose: 'stand', label: 'LIHAT IKAN', zone: 'boss', alt: [{ label: 'KASIH MAKAN IKAN' }] },
  { id: 'bsofa3', x: 13.6, y: 6.2, face: 'nx', pose: 'sit', label: 'SANTAI', zone: 'lounge', alt: [{ label: 'BACA KORAN', prop: 'paper' }] },
];
const S1: Array<Omit<Spot, 'room'>> = [
  { id: 'water', x: 7.6, y: 1.25, face: 'ny', pose: 'stand', label: 'MINUM', prop: 'cup', zone: 'break' },
  { id: 'trash', x: 3.3, y: 1.35, face: 'ny', pose: 'stand', label: 'BUANG SAMPAH', prop: 'trash' },
  { id: 'printer', x: 10.35, y: 1.35, face: 'ny', pose: 'stand', label: 'AMBIL PRINT', prop: 'paper', alt: [{ label: 'FOTOKOPI' }, { label: 'ISI KERTAS' }, { label: 'SCAN DOKUMEN' }] },
  { id: 'tv', x: 9.0, y: 2.6, face: 'ny', pose: 'stand', label: 'LIHAT CHART', zone: 'meet' },
  { id: 'win1', x: 0.75, y: 3.2, face: 'nx', pose: 'stand', label: 'LIHAT LUAR', alt: [{ label: 'MAIN HP', prop: 'hp' }] },
  { id: 'win2', x: 0.75, y: 5.45, face: 'nx', pose: 'stand', label: 'LIHAT LUAR', alt: [{ label: 'TELEPON', prop: 'phone' }] },
  { id: 'win3', x: 0.75, y: 7.7, face: 'nx', pose: 'stand', label: 'LIHAT LUAR', alt: [{ label: 'MAIN HP', prop: 'hp' }] },
  { id: 'hot1', x: 6.95, y: 4.2, face: 'py', pose: 'sit', label: 'KERJA BARENG', prop: 'laptop', zone: 'meet', alt: [{ label: 'ZOOM MEETING' }, { label: 'CEK EMAIL' }] },
  { id: 'hot2', x: 8.15, y: 4.2, face: 'py', pose: 'sit', label: 'KERJA BARENG', prop: 'laptop', zone: 'meet', alt: [{ label: 'BIKIN SLIDE' }, { label: 'ZOOM MEETING' }] },
  { id: 'hot3', x: 6.95, y: 6.0, face: 'ny', pose: 'sit', label: 'KERJA BARENG', zone: 'meet' },
  { id: 'hot4', x: 8.15, y: 6.0, face: 'ny', pose: 'sit', label: 'KERJA BARENG', zone: 'meet' },
  { id: 'phone', x: 8.6, y: 8.5, face: 'py', pose: 'stand', label: 'TELEPON', prop: 'phone', alt: [{ label: 'TELEPON KLIEN' }, { label: 'TELEPON MAMA' }] },
  { id: 'stretch', x: 6.2, y: 8.2, face: 'py', pose: 'stretch', label: 'PEREGANGAN' },
  { id: 'rest1', x: 13.05, y: 10.15, face: 'ny', pose: 'sit', label: 'ISTIRAHAT', zone: 'lounge', alt: [{ label: 'TIDUR SIANG', pose: 'nap' }, { label: 'MAIN HP', prop: 'hp' }] },
  { id: 'rest2', x: 14.05, y: 10.15, face: 'ny', pose: 'sit', label: 'ISTIRAHAT', zone: 'lounge', alt: [{ label: 'BACA BUKU', prop: 'book' }] },
];
const S2: Array<Omit<Spot, 'room'>> = [
  { id: 'coffee', x: 7.55, y: 1.3, face: 'ny', pose: 'stand', label: 'BIKIN KOPI', prop: 'cup', zone: 'break', alt: [{ label: 'BIKIN TEH' }, { label: 'SEDUH MIE' }] },
  { id: 'sink', x: 8.5, y: 1.3, face: 'ny', pose: 'stand', label: 'CUCI GELAS', zone: 'break', alt: [{ label: 'CUCI TANGAN' }, { label: 'ISI BOTOL' }] },
  { id: 'fridge', x: 12.62, y: 1.45, face: 'ny', pose: 'stand', label: 'AMBIL SNACK', prop: 'food', zone: 'break', alt: [{ label: 'AMBIL MINUMAN', prop: 'can' }] },
  { id: 'water2', x: 2.6, y: 1.25, face: 'ny', pose: 'stand', label: 'MINUM', prop: 'cup', zone: 'break' },
  { id: 'toilet', x: 4.7, y: 0.5, face: 'ny', pose: 'stand', label: 'KE TOILET', prop: 'vanish' },
  { id: 'tread', x: 1.0, y: 1.9, face: 'nx', pose: 'run', label: 'LARI TREADMILL', zone: 'gym' },
  { id: 'gym', x: 1.7, y: 4.2, face: 'px', pose: 'squat', label: 'OLAHRAGA', zone: 'gym' },
  { id: 'barbel', x: 1.55, y: 5.9, face: 'nx', pose: 'stand', label: 'ANGKAT BARBEL', prop: 'dumbbell', zone: 'gym' },
  { id: 'eat1', x: 6.7, y: 5.4, face: 'px', pose: 'sit', label: 'NGEMIL', prop: 'food', zone: 'eat' },
  { id: 'eat2', x: 8.5, y: 5.4, face: 'nx', pose: 'sit', label: 'NGEMIL', prop: 'food', zone: 'eat' },
  { id: 'eat3', x: 7.6, y: 6.3, face: 'ny', pose: 'sit', label: 'NGOPI', zone: 'eat' },
  { id: 'eat4', x: 7.6, y: 4.5, face: 'py', pose: 'sit', label: 'NGOPI', zone: 'eat' },
  { id: 'bean1', x: 3.75, y: 8.15, face: 'px', pose: 'bean', label: 'SANTAI', prop: 'laptop', zone: 'lounge', alt: [{ label: 'MAIN GAME', prop: 'hp' }] },
  { id: 'bean2', x: 5.75, y: 9.65, face: 'ny', pose: 'bean', label: 'SANTAI', prop: 'laptop', zone: 'lounge', alt: [{ label: 'MAIN HP', prop: 'hp' }] },
  { id: 'sofa1', x: 9.75, y: 9.55, face: 'ny', pose: 'sit', label: 'SANTAI', zone: 'lounge', alt: [{ label: 'TIDUR SIANG', pose: 'nap' }, { label: 'MAIN HP', prop: 'hp' }] },
  { id: 'sofa2', x: 10.75, y: 9.55, face: 'ny', pose: 'sit', label: 'SANTAI', zone: 'lounge', alt: [{ label: 'TIDUR SIANG', pose: 'nap' }] },
  { id: 'hp', x: 6.9, y: 9.4, face: 'py', pose: 'stand', label: 'MAIN HP', prop: 'hp' },
  { id: 'win4', x: 0.95, y: 7.6, face: 'nx', pose: 'stand', label: 'LIHAT LUAR' },
  { id: 'vend', x: 3.45, y: 1.3, face: 'ny', pose: 'stand', label: 'BELI MINUM', prop: 'can', zone: 'break', alt: [{ label: 'BELI SNACK', prop: 'food' }] },
  { id: 'arcade', x: 11.65, y: 1.35, face: 'ny', pose: 'stand', label: 'MAIN ARCADE', zone: 'lounge' },
  { id: 'pijat', x: 13.9, y: 5.2, face: 'nx', pose: 'sit', label: 'KURSI PIJAT', zone: 'lounge', alt: [{ label: 'PIJAT SANTAI', pose: 'nap' }] },
  { id: 'bench', x: 11.0, y: 11.0, face: 'ny', pose: 'sit', label: 'NUNGGU TAMU', zone: 'lounge', alt: [{ label: 'MAIN HP', prop: 'hp' }] },
];
const SPOTS: Spot[] = [...S0.map((q) => ({ ...q, room: 0 })), ...S1.map((q) => ({ ...q, room: 1 })), ...S2.map((q) => ({ ...q, room: 2 }))];
const PATROL: Spot[] = ([
  [2, 11.6, 4.2, 'nx'], [2, 8.6, 7.6, 'ny'], [2, 4.5, 6.4, 'nx'], [2, 3.0, 10.4, 'px'],
  [1, 11.6, 4.6, 'nx'], [1, 9.0, 3.6, 'nx'], [1, 3.7, 3.2, 'nx'], [1, 3.7, 7.7, 'nx'], [1, 7.0, 10.4, 'px'],
  [0, 9.6, 3.2, 'nx'], [0, 5.0, 7.4, 'px'], [0, 11.0, 8.0, 'ny'],
] as const).map(([r, x, y, f], i) => ({ id: `patrol${i}`, room: r, x, y, face: f, pose: 'stand', label: 'PATROLI' }));
const PACE: Array<[number, number, number]> = [[0, 4.0, 3.2], [0, 9.0, 3.6], [0, 8.0, 7.6], [1, 9.6, 3.6], [1, 5.6, 6.8], [1, 10.0, 8.6]];
/** Ny. Vetrycia's face while she watches a drama: changes every few seconds */
const vetMood = (t: number) => (['SEDIH', 'MAKAN POPCORN', 'NANGIS', 'KETAWA'] as const)[Math.floor(t / 4.5) % 4];
const VET_SORRY = ['Ampun bu!', 'Siap bu!', 'Maaf bu…', 'Iya bu bos!'];
const PARTNER: Record<string, string> = { alt: 'big', big: 'alt', xau: 'nas', nas: 'xau', tg: 'alt' };
const YELL = ['KERJA!!', 'PROFIT MANA?!', 'JANGAN SANTAI!', 'CEPAT!!', 'GAJI POTONG!', 'BALIK KE MEJA!', 'LEMBUR KAMU!'];
const SL_YELL = ['KENA SL LAGI?!', 'RUGI TERUS!', 'MAU DIPECAT?!'];
const SORRY = ['Ampun bos!', 'Iya bos!', 'Siap bos!', 'Maaf bos…'];
/** extra places that are not in the everyday roaming list */
const X = {
  absen: { id: 'absen', room: 2, x: 10.85, y: 1.2, face: 'ny', pose: 'stand', label: 'ABSEN' } as Spot,
  bowl: { id: 'bowl', room: 2, x: 5.75, y: 1.55, face: 'ny', pose: 'squat', label: 'KASIH MAKAN KUCING' } as Spot,
  karaoke: { id: 'karaoke', room: 2, x: 6.9, y: 8.0, face: 'py', pose: 'stand', label: 'KARAOKE', prop: 'mic' } as Spot,
  gitar: { id: 'gitar', room: 2, x: 5.75, y: 9.65, face: 'ny', pose: 'bean', label: 'MAIN GITAR', prop: 'guitar' } as Spot,
  ttd: { id: 'ttd', room: 0, x: 7.6, y: 3.45, face: 'nx', pose: 'stand', label: 'MINTA TTD', prop: 'paper', say: ['Pak, minta tanda tangan', '#1e1f23'] } as Spot,
  kopiBos: { id: 'kopibos', room: 0, x: 7.6, y: 3.45, face: 'nx', pose: 'stand', label: 'ANTAR KOPI', prop: 'cup', say: ['Kopinya pak', '#1e1f23'] } as Spot,
};
const CHAT: Record<string, string[]> = {
  GOSIP: ['Eh tau gak…', 'Serius?!', 'Wkwkwk', 'Jangan bilang bos ya', 'Gajian kapan sih', 'Marcel galak banget', 'Sstt…'],
  NGOBROL: ['Market lagi sepi ya', 'Entry di mana?', 'Hari ini cuan?', 'Wkwk', 'Nanti makan apa?', 'Capek euy'],
  KARAOKE: ['♪ La la la ♪', '♪ Cinta… ♪', '♪ Yeah! ♪'],
  'MAIN GITAR': ['♪ jreng ♪', '♪ ~ ♪'],
  'NONTON BERITA': ['Beritanya keluar!', 'Semoga aman…', 'Volatil banget!', 'Deg-degan…', 'Wah, gerak!'],
  'NYANYI ULTAH': ['♪ Selamat ulang tahun ♪', '♪ Panjang umurnya ♪', 'Tiup lilinnya!'],
  'MAKAN PIZZA': ['Enak banget!', 'Siapa yang traktir?', 'Nambah dong'],
  'RAPAT DARURAT': ['Maaf bos…', 'Market lagi aneh', 'Kita evaluasi'],
  'MAIN CATUR': ['Skak!', 'Hmm…', 'Giliranmu'],
  'MAIN PINGPONG': ['Smash!', 'Yes!', 'Out!'],
  'SENAM PAGI': ['Semangat!', 'Huft…', 'Satu, dua!'],
};
/* ---------- office events: several people do one thing together for a while ---------- */
type Step = { act: Spot; dwell: number };
type Ev = { kind: string; start: number; until: number; plans: Record<string, Step[]>; ids: string[]; random: boolean; courier?: boolean; guest?: boolean; items?: (room: number, wall: number) => Item[] };
const EV: { cur: Ev | null; next: number; done: Record<string, string> } = { cur: null, next: 0, done: {} };
const inEvent = (id: string, wall: number) => !!EV.cur && wall < EV.cur.until && EV.cur.ids.includes(id);
export const awayHours = (now: number) => { const h = new Date(now).getHours(); return h >= 23 || h < 7; };       // Marcel and Ny. Vetrycia go home
const sp = (id: string, room: number, x: number, y: number, face: Face, label: string, more: Partial<Spot> = {}): Spot => ({ id, room, x, y, face, pose: 'stand', label, ...more });
const shuffle = <T,>(a: T[]) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
type EvCtx = { agents: Record<string, Agent>; S: Record<string, Status>; wall: number; data: OfficeData };
function freeFor(ctx: EvCtx, id: string, busyOk = false) {
  const a = ctx.agents[id], s = ctx.S[id]; if (!a || !s) return false;
  if (s.sleep || s.label === 'BELUM AKTIF' || s.label === 'KIRIM PESAN' || s.label === 'ALARM') return false;
  if (!busyOk && s.label.startsWith('POSISI')) return false;
  if ((id === 'bos' || id === 'vet') && awayHours(ctx.wall)) return false;
  return ctx.wall >= a.scoldUntil;
}
const TABLE2 = { x: 7.6, y: 5.4, z: 15 };      // the round table in the pantry
function tableItem(room: number, x: number, y: number, z: number, draw: (c: C, t: number, sx: number, sy: number) => void): Item {
  return { x0: x - 0.1, y0: y - 0.1, x1: x + 0.2, y1: y + 0.2, draw: (c, t) => { if (room < 0) return; const [sx, sy] = iso(x, y, z); draw(c, t, sx, sy); } };
}
function confetti(c: C, x: number, y: number, t: number) {
  const [cx, cy] = iso(x, y, 40);
  const cols = ['#e5484d', '#f2c230', '#2ee59d', '#4c7dff', '#c792ea'];
  for (let k = 0; k < 26; k++) { const ph = (t * 0.35 + hash(`cf${k}`)) % 1, dx = (hash(`cx${k}`) - 0.5) * 70 + Math.sin(t * 2 + k) * 3; c.fillStyle = cols[k % 5]; c.fillRect(cx + dx, cy - 30 + ph * 60, 1.6, 1); }
}
function makeEvent(kind: string, ctx: EvCtx): Ev | null {
  const { wall } = ctx, W5 = ['alt', 'big', 'xau', 'nas', 'tg'];
  const ev = (plans: Record<string, Step[]>, dur: number, more: Partial<Ev> = {}): Ev => ({ kind, start: wall, until: wall + dur * 1000, plans, ids: Object.keys(plans), random: true, ...more });
  const workers = (busyOk = false) => shuffle(W5.filter((id) => freeFor(ctx, id, busyOk)));
  const S = (sec: number) => sec * 1000;
  if (kind === 'senam') {
    const who = [...workers(), ...(freeFor(ctx, 'ob') ? ['ob'] : [])]; if (who.length < 3) return null;
    const grid: Array<[number, number]> = [[7.0, 6.6], [8.2, 6.6], [9.4, 6.6], [7.0, 7.8], [8.2, 7.8], [9.4, 7.8]];
    const moves: Pose[] = ['stretch', 'squat', 'jump', 'stretch', 'squat', 'jump', 'stretch', 'squat'];
    const plans: Record<string, Step[]> = {};
    who.slice(0, 6).forEach((id, i) => { plans[id] = moves.map((m) => ({ act: sp(`ev-senam-${id}`, 2, grid[i][0], grid[i][1], 'px', 'SENAM PAGI', { pose: m }), dwell: S(7) })); });
    if (freeFor(ctx, 'bos')) plans.bos = moves.map((m, i) => ({ act: sp('ev-senam-bos', 2, 11.0, 7.2, 'nx', 'PIMPIN SENAM', { pose: m, say: i === 0 ? ['Ayo senam! 1, 2, 3!', '#1e1f23'] : undefined }), dwell: S(7) }));
    return ev(plans, 62);
  }
  if (kind === 'ultah' || kind === 'pizza') {
    const who = workers(); if (who.length < 2) return null;
    const all = [...who, ...['ob', 'bos', 'vet'].filter((id) => freeFor(ctx, id))];
    const seats = [sp('', 2, 7.6, 4.5, 'py', '', { pose: 'sit' }), sp('', 2, 7.6, 6.3, 'ny', '', { pose: 'sit' }), sp('', 2, 6.7, 5.4, 'px', '', { pose: 'sit' }), sp('', 2, 8.5, 5.4, 'nx', '', { pose: 'sit' }),
      sp('', 2, 6.1, 4.3, 'px', ''), sp('', 2, 6.1, 6.5, 'px', ''), sp('', 2, 8.95, 6.6, 'nx', ''), sp('', 2, 8.6, 3.95, 'py', '')];
    const plans: Record<string, Step[]> = {};
    const bday = who[0];
    // the birthday person and the big boss get chairs first
    const order = kind === 'ultah' ? [bday, ...all.filter((id) => id === 'vet'), ...all.filter((id) => id !== bday && id !== 'vet')] : [...all.filter((id) => id === 'vet'), ...all.filter((id) => id !== 'vet')];
    order.slice(0, seats.length).forEach((id, i) => {
      const at = (label: string, more: Partial<Spot> = {}) => ({ ...seats[i], id: `ev-${kind}-${id}`, label, ...more });
      if (kind === 'ultah') plans[id] = id === bday
        ? [{ act: at('ULANG TAHUN', { say: ['Wah, makasih semua!', '#c0392b'] }), dwell: S(26) }, { act: at('TIUP LILIN', { say: ['Fuuuh~', '#1e1f23'] }), dwell: S(5) }, { act: at('MAKAN KUE', { prop: 'food' }), dwell: S(20) }]
        : [{ act: at(id === 'vet' ? 'MAKAN KUE' : 'NYANYI ULTAH', id === 'vet' ? { prop: 'food' } : {}), dwell: S(31) }, { act: at('MAKAN KUE', { prop: 'food' }), dwell: S(20) }];
      else plans[id] = [{ act: at('NUNGGU PIZZA'), dwell: S(9) }, { act: at('MAKAN PIZZA', { prop: 'food' }), dwell: S(40) }];
    });
    const e = ev(plans, kind === 'ultah' ? 55 : 52);
    if (kind === 'pizza') {
      e.courier = true;
      e.plans.kurir = [{ act: sp('ev-kurir-in', 2, 7.6, 3.95, 'py', 'ANTAR PIZZA', { prop: 'box', say: ['Permisi, pizza datang!', '#c0392b'] }), dwell: S(5) }, { act: sp('ev-kurir-out', 2, 11.65, 0.6, 'ny', 'PULANG', { prop: 'vanish' }), dwell: S(60) }];
      e.ids.push('kurir');
    }
    e.items = (room, w) => room !== 2 ? [] : [tableItem(2, TABLE2.x, TABLE2.y, TABLE2.z, (c, t, sx, sy) => {
      const el = (w - e.start) / 1000;
      if (kind === 'ultah') {
        c.fillStyle = '#fbe3c4'; c.beginPath(); c.ellipse(sx, sy - 1, 5, 2.4, 0, 0, 7); c.fill();
        c.fillStyle = '#f7d0dd'; c.fillRect(sx - 5, sy - 5, 10, 4); c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(sx, sy - 5, 5, 2.4, 0, 0, 7); c.fill();
        c.fillStyle = '#e5484d'; for (const dx of [-2.5, 0, 2.5]) c.fillRect(sx + dx - 0.4, sy - 9, 0.8, 4);
        if (el < 31) for (const dx of [-2.5, 0, 2.5]) { c.fillStyle = Math.sin(t * 20 + dx) > 0 ? '#ffd23f' : '#ff9a3c'; c.beginPath(); c.ellipse(sx + dx, sy - 10, 0.7, 1.2, 0, 0, 7); c.fill(); }
        confetti(c, TABLE2.x, TABLE2.y, t);
      } else if (el > 5) {
        c.fillStyle = '#c8a26b'; c.beginPath(); c.moveTo(sx - 7, sy - 1); c.lineTo(sx, sy - 4.5); c.lineTo(sx + 7, sy - 1); c.lineTo(sx, sy + 2.5); c.closePath(); c.fill();
        c.fillStyle = '#f2b04a'; c.beginPath(); c.ellipse(sx, sy - 1, 5, 2.4, 0, 0, 7); c.fill();
        c.fillStyle = '#d9473b'; for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(sx + Math.cos(k) * 3, sy - 1 + Math.sin(k * 1.7) * 1.3, 0.7, 0, 7); c.fill(); }
      }
    })];
    return e;
  }
  if (kind === 'tamu') {
    // a client walks in through the exit door, signs in with Pentoel, takes the lift up and meets Marcel at the meeting table
    if (!freeFor(ctx, 'bos') || !freeFor(ctx, 'jaga')) return null;
    const gs = PEOPLE.find((q) => q.id === 'jaga')!.seat;
    const plans: Record<string, Step[]> = {
      tamu: [
        { act: sp('ev-tamu-in', 2, 13.6, 4.55, 'ny', 'LAPOR SATPAM', { say: ['Permisi, mau ketemu Pak Marcel', '#1e1f23'] }), dwell: S(7) },
        { act: sp('ev-tamu-meet', 0, 2.0, 6.7, 'px', 'MEETING KLIEN', { pose: 'sit' }), dwell: S(8) },
        { act: sp('ev-tamu-meet', 0, 2.0, 6.7, 'px', 'MEETING KLIEN', { pose: 'sit', say: ['Saya tertarik sama sistemnya!', '#1e1f23'] }), dwell: S(12) },
        { act: sp('ev-tamu-meet', 0, 2.0, 6.7, 'px', 'MEETING KLIEN', { pose: 'sit' }), dwell: S(12) },
        { act: sp('ev-tamu-meet', 0, 2.0, 6.7, 'px', 'SALAMAN', { say: ['Terima kasih, Pak!', '#2e9e5b'] }), dwell: S(5) },
        { act: sp('ev-tamu-out', 2, 13.5, 0.7, 'ny', 'PULANG', { prop: 'vanish' }), dwell: S(60) },
      ],
      jaga: [{ act: { ...gs, id: 'ev-tamu-jaga', label: 'TERIMA TAMU', say: ['Selamat datang! Silakan naik ke lantai 3', '#1e1f23'] }, dwell: S(14) }, { act: { ...gs, id: 'ev-tamu-jaga', label: 'CATAT TAMU', prop: 'paper' }, dwell: S(20) }],
      bos: [
        { act: sp('ev-tamu-bos', 0, 4.0, 6.7, 'nx', 'NUNGGU TAMU', { pose: 'sit' }), dwell: S(22) },
        { act: sp('ev-tamu-bos', 0, 4.0, 6.7, 'nx', 'MEETING KLIEN', { pose: 'sit', say: ['Selamat datang, silakan duduk!', '#1e1f23'] }), dwell: S(10) },
        { act: sp('ev-tamu-bos', 0, 4.0, 6.7, 'nx', 'PRESENTASI', { pose: 'sit', say: ['Kami disiplin: RR 1:2, keluar di TP/SL', '#1e1f23'] }), dwell: S(12) },
        { act: sp('ev-tamu-bos', 0, 4.0, 6.7, 'nx', 'PRESENTASI', { pose: 'sit', say: ['Semua tercatat di jurnal, transparan', '#1e1f23'] }), dwell: S(12) },
        { act: sp('ev-tamu-bos', 0, 4.0, 6.7, 'nx', 'SALAMAN', { say: ['Sama-sama, ditunggu kabarnya!', '#2e9e5b'] }), dwell: S(6) },
      ],
    };
    const e = ev(plans, 110, { random: false }); e.guest = true;
    return e;
  }
  if (kind === 'paket') {
    if (!freeFor(ctx, 'vet') || ctx.agents.vet.room !== 0) return null;
    const v = (label: string, more: Partial<Spot> = {}) => ({ ...PEOPLE[0].seat, id: 'ev-paket-vet', label, ...more });
    return ev({
      vet: [{ act: v('NUNGGU PAKET', { prop: 'hp' }), dwell: S(10) }, { act: v('BUKA PAKET', { prop: 'box', say: ['Yeay, paketku datang!', '#c0392b'] }), dwell: S(14) }, { act: v('BELANJA ONLINE', { prop: 'hp' }), dwell: S(16) }],
      kurir: [{ act: sp('ev-kurir-in', 0, 3.0, 3.9, 'nx', 'ANTAR PAKET', { prop: 'box', say: ['Paket buat Ny. Vetrycia!', '#c0392b'] }), dwell: S(4) }, { act: sp('ev-kurir-out', FLAT ? 2 : 0, 11.65, 0.6, 'ny', 'PULANG', { prop: 'vanish' }), dwell: S(60) }],
    }, 42, { courier: true });
  }
  if (kind === 'suruh') {
    if (!freeFor(ctx, 'vet') || !freeFor(ctx, 'bos') || ctx.agents.vet.room !== 0) return null;
    const v = (label: string, more: Partial<Spot> = {}) => ({ ...PEOPLE[0].seat, id: 'ev-suruh-vet', label, ...more });
    return ev({
      vet: [{ act: v('NYURUH MARCEL', { say: ['Marcel! Ambilin cemilan!', '#c0392b'] }), dwell: S(24) }, { act: v('MAKAN', { prop: 'food' }), dwell: S(16) }],
      bos: [{ act: sp('ev-suruh-1', 2, 12.62, 1.45, 'ny', 'AMBILIN CEMILAN', { prop: 'food', say: ['Iya bu… iya…', '#1e1f23'] }), dwell: S(3) }, { act: sp('ev-suruh-2', 0, 3.0, 3.9, 'nx', 'ANTAR CEMILAN', { prop: 'food', say: ['Ini bu cemilannya', '#1e1f23'] }), dwell: S(4) }],
    }, 44);
  }
  if (kind === 'foto') {
    const cam = freeFor(ctx, 'tg') ? 'tg' : freeFor(ctx, 'ob') ? 'ob' : null; if (!cam) return null;
    const who = [...['vet', 'bos'].filter((id) => freeFor(ctx, id)), ...workers().filter((id) => id !== cam), ...['ob', 'jaga'].filter((id) => id !== cam && freeFor(ctx, id))];
    if (who.length < 3) return null;
    const pos: Array<[number, number]> = [[6.4, 2.2], [5.4, 2.2], [7.4, 2.2], [4.4, 2.2], [8.4, 2.2], [5.9, 1.3], [6.9, 1.3], [4.9, 1.3], [7.9, 1.3]];
    const plans: Record<string, Step[]> = {};
    who.slice(0, pos.length).forEach((id, i) => { const at = (label: string, pose: Pose) => sp(`ev-foto-${id}`, 0, pos[i][0], pos[i][1], 'py', label, { pose }); plans[id] = [{ act: at('FOTO BARENG', 'stand'), dwell: S(14) }, { act: at('CHEESE!', 'jump'), dwell: S(5) }, { act: at('FOTO BARENG', 'stand'), dwell: S(9) }]; });
    plans[cam] = [{ act: sp('ev-foto-cam', 0, 6.4, 3.5, 'ny', 'FOTOIN', { prop: 'phone', say: ['Senyum… 1, 2, 3!', '#1e1f23'] }), dwell: S(30) }];
    const e = ev(plans, 32);
    e.items = (room, w) => room !== 0 ? [] : [{ x0: 6.3, y0: 3.4, x1: 6.5, y1: 3.6, draw: (c) => {
      const el = (w - e.start) / 1000, ph = el % 4; if (el < 8 || ph > 0.35) return;
      const [fx, fy] = iso(6.4, 3.5, 20), g = c.createRadialGradient(fx, fy, 0, fx, fy, 60); g.addColorStop(0, `rgba(255,255,255,${0.85 * (1 - ph / 0.35)})`); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(fx - 60, fy - 60, 120, 120);
    } }];
    return e;
  }
  if (kind === 'darurat') {
    const who = workers(true); if (!who.length) return null;
    const seats = [...[2.0, 4.0].flatMap((x) => [6.7, 7.6, 8.5, 9.4].map((y) => sp('', 0, x, y, x < 3 ? 'px' : 'nx', '', { pose: 'sit' }))), sp('', 0, 3.0, 10.4, 'ny', ''), sp('', 0, 2.2, 10.5, 'ny', '')];
    const plans: Record<string, Step[]> = {};
    who.forEach((id, i) => { plans[id] = [{ act: { ...seats[i], id: `ev-darurat-${id}`, label: 'RAPAT DARURAT' }, dwell: S(50) }]; });
    if (freeFor(ctx, 'bos')) plans.bos = [{ act: sp('ev-darurat-bos', 0, 3.0, 5.8, 'py', 'RAPAT DARURAT', { say: ['KENAPA SL TERUS?!', '#e5242b'] }), dwell: S(22) }, { act: sp('ev-darurat-bos', 0, 3.0, 5.8, 'py', 'EVALUASI', { say: ['Cek lagi aturannya!', '#e5242b'] }), dwell: S(26) }];
    return ev(plans, 52, { random: false });
  }
  if (kind === 'rapat') {
    // Monday morning: weekly meeting in the boss office, Marcel reads last week's result (Binance, same as the TV)
    if (!freeFor(ctx, 'bos')) return null;
    const who = workers(true); if (!who.length) return null;
    const wk = wall - 7 * 86_400_000;
    const done = ctx.data.trades.filter((t) => t.result !== 'open' && (t.closedAt ?? 0) >= wk && t.strategy !== 'v2' && t.strategy !== 'nas');
    const pnl = done.reduce((a, t) => a + Number(t.pnl ?? 0), 0), amt = `${pnl < 0 ? '−' : '+'}$${Math.abs(pnl).toFixed(2)}`;
    const seats = [2.0, 4.0].flatMap((x) => [6.7, 7.6, 8.5, 9.4].map((y) => sp('', 0, x, y, x < 3 ? 'px' : 'nx', '', { pose: 'sit' })));
    const plans: Record<string, Step[]> = {};
    who.slice(0, seats.length).forEach((id, i) => { plans[id] = [{ act: { ...seats[i], id: `ev-rapat-${id}`, label: 'RAPAT MINGGUAN' }, dwell: S(110) }]; });
    const at = (label: string, say?: [string, string]) => sp('ev-rapat-bos', 0, 3.0, 5.8, 'py', label, { say });
    plans.bos = [
      { act: at('RAPAT MINGGUAN', ['Rapat mingguan, mulai!', '#1e1f23']), dwell: S(6) },
      { act: at('EVALUASI', [done.length ? `Minggu lalu ${amt}, ${done.length} trade` : 'Minggu lalu belum ada trade selesai', pnl >= 0 ? '#2e9e5b' : '#e5242b']), dwell: S(8) },
      { act: at('EVALUASI', [pnl >= 0 ? 'Bagus, pertahankan!' : 'Evaluasi, jangan diulang!', '#1e1f23']), dwell: S(8) },
      { act: at('EVALUASI', ['Ingat: RR 1:2, keluar cuma di TP/SL!', '#1e1f23']), dwell: S(10) },
      { act: at('RAPAT MINGGUAN', ['Oke, kembali kerja!', '#1e1f23']), dwell: S(60) },
    ];
    return ev(plans, 115, { random: false });
  }
  if (kind === 'kucing') {
    // Udin fills the cat's bowl
    if (!freeFor(ctx, 'ob')) return null;
    CATCALL.at = wall;
    return ev({ ob: [{ act: { ...X.bowl, id: 'ev-kucing-ob', say: ['Pus, pus, makan dulu!', '#1e1f23'] }, dwell: S(10) }] }, 14, { random: false });
  }
  if (kind === 'dadakan') {
    // the owner tapped "Rapat": everybody comes to the meeting table in the boss office right now
    const lead = freeFor(ctx, 'bos', true) ? 'bos' : freeFor(ctx, 'vet', true) ? 'vet' : freeFor(ctx, 'jaga', true) ? 'jaga' : null; if (!lead) return null;   // at night the security guard leads
    const who = [...W5.filter((id) => freeFor(ctx, id, true)), ...['ob', 'jaga', 'vet'].filter((id) => id !== lead && freeFor(ctx, id, true))];
    if (!who.length) return null;
    const day0 = new Date(wall); day0.setHours(0, 0, 0, 0);
    const fin = ctx.data.trades.filter((t) => t.result !== 'open' && (t.closedAt ?? 0) >= day0.getTime() && t.strategy !== 'v2' && t.strategy !== 'nas');
    const pnl = fin.reduce((a, t) => a + Number(t.pnl ?? 0), 0), amt = `${pnl < 0 ? '−' : '+'}$${Math.abs(pnl).toFixed(2)}`;
    const openN = ctx.data.trades.filter((t) => t.result === 'open').length;
    const seats: Spot[] = [...[2.0, 4.0].flatMap((x) => [6.7, 7.6, 8.5, 9.4].map((y) => sp('', 0, x, y, x < 3 ? 'px' : 'nx', '', { pose: 'sit' }))), sp('', 0, 3.0, 10.4, 'ny', ''), sp('', 0, 2.2, 10.5, 'ny', '')];
    const plans: Record<string, Step[]> = {};
    who.slice(0, seats.length).forEach((id, i) => { plans[id] = [{ act: { ...seats[i], id: `ev-dadakan-${id}`, label: 'RAPAT DADAKAN' }, dwell: S(75) }]; });
    const at = (label: string, say?: [string, string]) => sp(`ev-dadakan-${lead}`, 0, 3.0, 5.8, 'py', label, { say });
    plans[lead] = [
      { act: at('PIMPIN RAPAT', ['Semua kumpul! Rapat dadakan!', '#1e1f23']), dwell: S(10) },
      { act: at('PIMPIN RAPAT', [fin.length ? `Hari ini ${amt} dari ${fin.length} trade` : 'Hari ini belum ada trade selesai', pnl >= 0 ? '#2e9e5b' : '#e5242b']), dwell: S(8) },
      { act: at('PIMPIN RAPAT', [openN ? `Posisi terbuka: ${openN}. Pantau terus!` : 'Belum ada posisi. Sabar tunggu setup!', '#1e1f23']), dwell: S(8) },
      { act: at('PIMPIN RAPAT', ['Ingat: RR 1:2, keluar cuma di TP/SL!', '#1e1f23']), dwell: S(8) },
      { act: at('PIMPIN RAPAT', ['Oke, bubar! Kembali kerja!', '#1e1f23']), dwell: S(40) },
    ];
    return ev(plans, 80, { random: false });
  }
  if (kind === 'pasar') {
    // gold or BTC moved 1% or more in 15 minutes: everybody stands in front of the TVs, warning lights flash
    const m = (ctx.data.market ?? []).filter((x) => Math.abs(x.move) >= 1).sort((a, b) => Math.abs(b.move) - Math.abs(a.move))[0]; if (!m) return null;
    const who = [...workers(true), ...['ob', 'jaga'].filter((id) => freeFor(ctx, id))]; if (!who.length) return null;
    const pos: Array<[number, number]> = [[7.4, 2.4], [8.4, 2.4], [9.4, 2.4], [10.4, 2.4], [7.9, 3.2], [8.9, 3.2], [9.9, 3.2]];
    const up = m.move > 0, col = up ? '#2e9e5b' : '#e5242b';
    const lines: Array<[string, string]> = [[`${m.name} ${up ? 'naik' : 'turun'} ${Math.abs(m.move).toFixed(1)}%!`, col], ['Cepat banget geraknya!', '#1e1f23'], [up ? 'Wih, terbang!' : 'Waduh, longsor!', col], ['Pantau terus!', '#1e1f23']];
    const plans: Record<string, Step[]> = {};
    who.slice(0, pos.length).forEach((id, i) => { plans[id] = [{ act: sp(`ev-pasar-${id}`, 1, pos[i][0], pos[i][1], 'ny', 'LIHAT TV', { say: lines[i] }), dwell: S(75) }]; });
    const e = ev(plans, 80, { random: false });
    e.items = (room) => [{ x0: NX - 0.01, y0: NY - 0.01, x1: NX, y1: NY, draw: (c, t) => {
      const on = Math.floor(t * 3) % 2 === 0, pulse = 0.5 + 0.5 * Math.sin(t * 6);
      for (const bx of [3.2, 9.8]) {       // two red rotating lamps high on the back wall
        const [lx, ly] = iso(bx, 0.05, WALL - 6);
        c.fillStyle = '#3a3b42'; c.fillRect(lx - 7, ly + 0.5, 14, 3.2);
        c.fillStyle = on ? '#ff3b3b' : '#7a1f1f'; c.beginPath(); c.ellipse(lx, ly + 0.6, 6.2, 7.5, 0, Math.PI, 0); c.fill(); if (on) { c.fillStyle = 'rgba(255,220,220,.9)'; c.beginPath(); c.ellipse(lx - 1.3, ly - 2, 1, 1.4, 0, 0, 7); c.fill(); }
        const g = c.createRadialGradient(lx, ly, 0, lx, ly, 80); g.addColorStop(0, `rgba(255,50,50,${0.65 * pulse})`); g.addColorStop(1, 'rgba(255,50,50,0)'); c.fillStyle = g; c.fillRect(lx - 80, ly - 80, 160, 160);
      }
      const [cx, cy] = iso(NX / 2, NY / 2, 30), g2 = c.createRadialGradient(cx, cy, 10, cx, cy, 190);
      g2.addColorStop(0, `rgba(255,40,40,${0.2 * pulse})`); g2.addColorStop(1, 'rgba(255,40,40,0)'); c.fillStyle = g2; c.fillRect(cx - 190, cy - 190, 380, 380);
      void room;
    } }];
    return e;
  }
  if (kind === 'rekap') {
    // 23:00: Marcel announces today's result (the same number as "PNL HARI INI" on the TV) before he goes home
    const who = ctx.agents.bos && ctx.S.bos && !ctx.S.bos.sleep ? 'bos' : null; if (!who) return null;
    const day0 = new Date(wall); day0.setHours(0, 0, 0, 0);
    const done = ctx.data.trades.filter((t) => t.result !== 'open' && (t.closedAt ?? 0) >= day0.getTime() && t.strategy !== 'v2' && t.strategy !== 'nas');
    const pnl = done.reduce((a, t) => a + Number(t.pnl ?? 0), 0);
    const amt = `${pnl < 0 ? '−' : '+'}$${Math.abs(pnl).toFixed(2)}`;
    const said: Array<[string, string]> = !done.length ? [['Rekap hari ini: belum ada trade selesai.', '#1e1f23'], ['Sabar, tunggu setup yang bagus!', '#1e1f23']]
      : pnl > 0 ? [[`Hari ini ${amt} dari ${done.length} trade!`, '#2e9e5b'], ['Kerja bagus semua!', '#2e9e5b']]
      : pnl < 0 ? [[`Hari ini ${amt} dari ${done.length} trade.`, '#e5242b'], ['Tetap ikut aturan, besok fokus!', '#1e1f23']]
      : [['Hari ini impas, $0.', '#1e1f23'], ['Besok lanjut lagi!', '#1e1f23']];
    const at = (label: string, say?: [string, string]) => sp('ev-rekap-bos', 1, 8.9, 3.6, 'nx', label, { say });
    return ev({ bos: [{ act: at('REKAP HARIAN', said[0]), dwell: S(3) }, { act: at('REKAP HARIAN', said[0]), dwell: S(5) }, { act: at('REKAP HARIAN', said[1]), dwell: S(5) }, { act: at('REKAP HARIAN', said[1]), dwell: S(4) }, { act: at('PAMIT PULANG', ['Saya pulang dulu ya!', '#1e1f23']), dwell: S(4) }] }, 120, { random: false });
  }
  if (kind === 'berita') {
    const who = [...workers(true), ...['bos', 'ob'].filter((id) => freeFor(ctx, id))]; if (who.length < 2) return null;
    const pos: Array<[number, number]> = [[7.4, 2.4], [8.4, 2.4], [9.4, 2.4], [10.4, 2.4], [7.9, 3.2], [8.9, 3.2], [9.9, 3.2]];
    const plans: Record<string, Step[]> = {};
    who.slice(0, pos.length).forEach((id, i) => { plans[id] = [{ act: sp(`ev-berita-${id}`, 1, pos[i][0], pos[i][1], 'ny', 'NONTON BERITA'), dwell: S(110) }]; });
    return ev(plans, 115, { random: false });
  }
  if (kind === 'bonus' || kind === 'gajian') {
    if (!freeFor(ctx, 'bos')) return null;
    const who = [...workers(true), ...['ob', 'jaga'].filter((id) => freeFor(ctx, id))]; if (!who.length) return null;
    const word = kind === 'bonus' ? 'BONUS' : 'GAJI';
    const plans: Record<string, Step[]> = { bos: [{ act: sp('ev-bonus-safe', 0, 8.37, 1.45, 'ny', 'BUKA BRANKAS'), dwell: S(5) }, { act: sp('ev-bonus-bos', 0, 8.6, 2.6, 'py', `BAGI ${word}`, { prop: 'envelope', say: [kind === 'bonus' ? 'Profit bagus, ini bonus kalian!' : 'Gajian, gajian!', '#2e9e5b'] }), dwell: S(36) }] };
    who.slice(0, 7).forEach((id, i) => { const at = (label: string, more: Partial<Spot> = {}) => sp(`ev-bonus-${id}`, 0, 8.6, 3.5 + i * 0.8, 'ny', label, more); plans[id] = [{ act: at(`ANTRI ${word}`), dwell: S(10 + i * 3) }, { act: at(`DAPAT ${word}!`, { pose: 'jump', prop: 'envelope', say: ['Makasih bos!', '#2e9e5b'] }), dwell: S(6) }]; });
    return ev(plans, 46, { random: false });
  }
  if (kind === 'kopi') {
    // Udin brings coffee to every trader at the desk
    if (!freeFor(ctx, 'ob')) return null;
    const at = W5.filter((id) => freeFor(ctx, id, true));
    if (!at.length) return null;
    const plans: Record<string, Step[]> = { ob: [{ act: { ...SPOTS.find((q) => q.id === 'coffee')!, id: 'ev-kopi-buat', label: 'BIKIN KOPI', prop: 'cup', say: ['Kopi buat semua!', '#1e1f23'] }, dwell: S(6) }] };
    for (const id of at) {
      const q = PEOPLE.find((x) => x.id === id)!.seat;
      plans.ob.push({ act: sp(`ev-kopi-${id}`, 1, 3.15, q.y + 0.6, 'nx', 'ANTAR KOPI', { prop: 'cup', say: ['Kopinya, mas/mbak', '#1e1f23'] }), dwell: S(4) });
      const k = plans.ob.length;
      plans[id] = [{ act: { ...q, id: `seat-${id}`, label: 'NUNGGU KOPI' }, dwell: S(12 + k * 6) }, { act: { ...q, id: `seat-${id}`, label: 'MINUM KOPI', prop: 'cup', say: [any1(['Makasih Din!', 'Mantap, pas ngantuk', 'Udin terbaik!']), '#2e9e5b'] }, dwell: S(15) }];
    }
    return ev(plans, 30 + at.length * 7, { random: false });
  }
  if (kind === 'tebak') {
    // guessing game in front of the LIVE board: will the next candle be green or red?
    const who = workers(true).slice(0, 4); if (who.length < 2) return null;
    const green = Math.random() < 0.5, plans: Record<string, Step[]> = {};
    who.forEach((id, i) => {
      const x = 6.6 + i * 1.0, mine = i % 2 === 0;
      plans[id] = [
        { act: sp(`ev-tebak-${id}`, 1, x, 2.9, 'ny', 'TEBAK CANDLE', { say: [mine ? 'Hijau pasti!' : 'Merah!', mine ? '#2e9e5b' : '#e5242b'] }), dwell: S(9) },
        { act: sp(`ev-tebak-${id}`, 1, x, 2.9, 'ny', 'TUNGGU CANDLE'), dwell: S(8) },
        { act: sp(`ev-tebak-${id}`, 1, x, 2.9, mine === green ? 'py' : 'ny', mine === green ? 'MENANG TEBAKAN' : 'KALAH TEBAKAN', { pose: mine === green ? 'jump' : 'stand', say: mine === green ? ['Yes! Aku benar!', '#2e9e5b'] : i < 2 ? ['Yah… traktir deh', '#1e1f23'] : undefined }), dwell: S(7) },
      ];
    });
    return ev(plans, 26);
  }
  if (kind === 'pushup') {
    // a push-up contest in the lobby, Marcel (or Udin) counting
    const who = workers().slice(0, 2); if (who.length < 2) return null;
    const plans: Record<string, Step[]> = {};
    who.forEach((id, i) => { plans[id] = [{ act: sp(`ev-pushup-${id}`, 2, 6.5 + i * 1.3, 8.6, 'py', 'LOMBA PUSH-UP', { pose: 'squat', say: i === 0 ? ['Ayo, siapa kuat!', '#1e1f23'] : undefined }), dwell: S(10) }, { act: sp(`ev-pushup-${id}`, 2, 6.5 + i * 1.3, 8.6, 'py', 'LOMBA PUSH-UP', { pose: 'stretch' }), dwell: S(3) }, { act: sp(`ev-pushup-${id}`, 2, 6.5 + i * 1.3, 8.6, 'py', 'LOMBA PUSH-UP', { pose: 'squat' }), dwell: S(8) }, { act: sp(`ev-pushup-${id}`, 2, 6.5 + i * 1.3, 8.6, 'py', i === 0 ? 'MENANG PUSH-UP' : 'CAPEK', { pose: i === 0 ? 'jump' : 'stand', say: i === 0 ? ['Juara!', '#2e9e5b'] : ['Hah… hah…', '#1e1f23'] }), dwell: S(6) }]; });
    const ref = freeFor(ctx, 'bos') ? 'bos' : freeFor(ctx, 'ob') ? 'ob' : null;
    if (ref) plans[ref] = [{ act: sp(`ev-pushup-${ref}`, 2, 7.15, 7.4, 'py', 'HITUNG PUSH-UP', { say: ['Satu! Dua! Tiga!', '#1e1f23'] }), dwell: S(12) }, { act: sp(`ev-pushup-${ref}`, 2, 7.15, 7.4, 'py', 'HITUNG PUSH-UP', { say: ['…dua puluh!', '#1e1f23'] }), dwell: S(14) }];
    return ev(plans, 30);
  }
  if (kind === 'jajan') {
    // two traders buy drinks together at the vending machine
    const who = workers().slice(0, 2); if (who.length < 2) return null;
    const vend = SPOTS.find((q) => q.id === 'vend')!;
    const plans: Record<string, Step[]> = {};
    who.forEach((id, i) => { plans[id] = [{ act: { ...vend, id: `ev-jajan-${id}`, x: vend.x + i * 0.7, label: 'JAJAN BARENG', prop: 'can', say: i === 0 ? ['Aku traktir!', '#2e9e5b'] : undefined }, dwell: S(7) }, { act: { ...vend, id: `ev-jajan-${id}`, x: vend.x + i * 0.7, label: 'NGOBROL', prop: 'can', say: i === 1 ? ['Asik, makasih!', '#2e9e5b'] : undefined }, dwell: S(10) }]; });
    return ev(plans, 20);
  }
  if (kind === 'tos' || kind === 'debat' || kind === 'lucu') {
    const who = workers().slice(0, 2); if (who.length < 2) return null;
    const lines: Record<string, Array<[string, string]>> = {
      tos: [['Tos dulu! Disiplin terus!', '#2e9e5b'], ['Yeay! RR 1:2!', '#2e9e5b']],
      debat: [['Menurutku bakal naik!', '#2e9e5b'], ['Ah, turun dulu!', '#e5242b']],
      lucu: [['Tau nggak kenapa chart sedih?', '#1e1f23'], ['Hahaha! Kena SL terus!', '#1e1f23']],
    };
    const pos: Array<[number, number, Face]> = kind === 'debat' ? [[8.6, 3.0, 'px'], [9.6, 3.0, 'nx']] : [[6.4, 6.8, 'px'], [7.25, 6.8, 'nx']];
    const lab = kind === 'tos' ? 'TOS' : kind === 'debat' ? 'DEBAT ARAH PASAR' : 'BERCANDA';
    const plans: Record<string, Step[]> = {};
    who.forEach((id, i) => {
      const [x, y, f] = pos[i];
      plans[id] = [
        { act: sp(`ev-${kind}-${id}`, 1, x, y, f, lab, { say: i === 0 ? lines[kind][0] : undefined }), dwell: S(5) },
        { act: sp(`ev-${kind}-${id}`, 1, x, y, f, lab, { pose: kind === 'debat' ? 'stand' : 'jump', say: i === 1 ? lines[kind][1] : undefined }), dwell: S(kind === 'debat' ? 8 : 4) },
        { act: sp(`ev-${kind}-${id}`, 1, x, y, f, kind === 'debat' ? 'DEBAT ARAH PASAR' : 'KETAWA'), dwell: S(6) },
      ];
    });
    return ev(plans, 18);
  }
  if (kind === 'catur' || kind === 'pingpong' || kind === 'gosip') {
    const who = [...workers(), ...(freeFor(ctx, 'ob') ? ['ob'] : [])].slice(0, 2); if (who.length < 2) return null;
    const pl: Array<[Spot, Spot]> = kind === 'catur' ? [[sp('', 2, 6.7, 5.4, 'px', 'MAIN CATUR', { pose: 'sit' }), sp('', 2, 8.5, 5.4, 'nx', 'MAIN CATUR', { pose: 'sit' })]]
      : kind === 'pingpong' ? [[sp('', 2, 1.8, 6.85, 'px', 'MAIN PINGPONG', { prop: 'paddle' }), sp('', 2, 4.8, 6.85, 'nx', 'MAIN PINGPONG', { prop: 'paddle' })]]
      : [[sp('', 2, 6.25, 2.35, 'px', 'GOSIP'), sp('', 2, 7.05, 2.35, 'nx', 'GOSIP')]];
    const plans: Record<string, Step[]> = {};
    who.forEach((id, i) => { plans[id] = [{ act: { ...pl[0][i], id: `ev-${kind}-${id}` }, dwell: S(kind === 'gosip' ? 30 : 48) }]; });
    const e = ev(plans, kind === 'gosip' ? 32 : 50);
    if (kind === 'catur') e.items = (room) => room !== 2 ? [] : [tableItem(2, TABLE2.x, TABLE2.y, TABLE2.z, (c, t, sx, sy) => {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { c.fillStyle = (i + j) % 2 ? '#3a2a1e' : '#f1e3c6'; const [ax, ay] = [sx + (i - j) * 1.3, sy - 1 + (i + j - 3) * 0.65]; c.beginPath(); c.moveTo(ax, ay - 0.65); c.lineTo(ax + 1.3, ay); c.lineTo(ax, ay + 0.65); c.lineTo(ax - 1.3, ay); c.closePath(); c.fill(); }
      const k = Math.floor(t / 3) % 4; c.fillStyle = '#ffffff'; c.fillRect(sx - 2 + k, sy - 4.5, 1.2, 2.8); c.fillStyle = '#1e1f23'; c.fillRect(sx + 1.5 - k * 0.6, sy - 4, 1.2, 2.8);
    })];
    if (kind === 'pingpong') e.items = (room) => room !== 2 ? [] : [{ x0: 2.45, y0: 6.9, x1: 4.15, y1: 7.0, draw: (c, t) => {
      const ph = (t * 0.9) % 2, u = ph < 1 ? ph : 2 - ph, x = 2.1 + u * 2.4, z = 13 + Math.abs(Math.sin(u * Math.PI * 2)) * 7;
      const [bx, by] = iso(x, 6.85, z); c.fillStyle = '#ffffff'; c.beginPath(); c.arc(bx, by, 0.9, 0, 7); c.fill();
    } }];
    return e;
  }
  return null;
}
/** the cat menu: asks scheduleEvents to start an event right now (res: 'ok' started, 'no' nobody free) */
const CALL = { kind: '', at: 0, res: '' };
const any1 = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const RANDOM_EVENTS: Array<[string, number]> = [['pizza', 1.2], ['ultah', 0.8], ['foto', 1], ['paket', 1], ['suruh', 1.2], ['catur', 1], ['pingpong', 1.2], ['gosip', 1.3], ['senam', 0.6], ['kopi', 1.1], ['tos', 0.9], ['debat', 1], ['lucu', 1], ['tamu', 0.9], ['tebak', 1], ['pushup', 0.8], ['jajan', 0.9]];
/** starts / ends office events: real-data ones (SL streak, NFP night, payday, bonus) first, otherwise a random one every few minutes */
function scheduleEvents(ctx: EvCtx) {
  const { wall, data, agents } = ctx;
  const kick = (ids: string[]) => { for (const id of ids) { const a = agents[id]; if (a) { a.kick = true; a.queue = []; a.run = false; } } };
  if (EV.cur && wall >= EV.cur.until) { kick(EV.cur.ids); EV.cur = null; EV.next = wall + (150 + Math.random() * 120) * 1000; }
  if (!EV.next) EV.next = wall + 40_000;
  const d = new Date(wall), day = d.toDateString(), h = d.getHours(), m = d.getMinutes();
  const want: string[] = [];
  const closed = data.trades.filter((t) => t.result !== 'open' && t.closedAt).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  if (closed.length >= 3 && closed.slice(0, 3).every((t) => t.result === 'sl') && wall - (closed[0].closedAt ?? 0) < 30 * 60_000 && EV.done.darurat !== String(closed[0].id)) want.push('darurat');
  const today = new Date(wall); today.setHours(0, 0, 0, 0);
  const tdy = closed.filter((t) => (t.closedAt ?? 0) >= today.getTime());
  if (tdy.filter((t) => t.result === 'tp').length >= 2 && tdy.reduce((s, t) => s + Number(t.pnl ?? 0), 0) > 0 && EV.done.bonus !== day && h >= 8 && h < 22) want.push('bonus');
  if (d.getDate() === 25 && h === 10 && EV.done.gajian !== day) want.push('gajian');
  // big US news on the calendar: watch the TV from 2 minutes before until 10 minutes after the release
  // (no calendar: the old rule, first Friday evening = US jobs report)
  const cal = data.cal ?? [];
  if (cal.length ? cal.some((e) => wall > e.at - 2 * 60_000 && wall < e.at + 10 * 60_000) : d.getDay() === 5 && d.getDate() <= 7 && (h === 21 && m >= 15 || h === 22)) want.push('berita');
  // gold / BTC moving 1% or more in 15 minutes (at most once every 30 minutes)
  if ((data.market ?? []).some((x) => Math.abs(x.move) >= 1) && wall - Number(EV.done.pasar ?? 0) > 30 * 60_000) want.unshift('pasar');
  if (h === 23 && m < 4 && EV.done.rekap !== day) want.unshift('rekap');
  if (CALL.at) {
    const k = CALL.kind, fresh = wall - CALL.at < 8000; CALL.at = 0;
    const e = fresh ? makeEvent(k, ctx) : null;
    if (e) { e.random = false; if (EV.cur) kick(EV.cur.ids); EV.cur = e; kick(e.ids); CALL.res = 'ok'; return; }
    CALL.res = 'no';
  }
  if (d.getDay() === 1 && h === 9 && m >= 30 && EV.done.rapat !== day) want.push('rapat');              // Monday weekly meeting
  if (h === 9 && m < 12 && d.getDay() > 0 && d.getDay() < 6 && EV.done.senam !== day) want.push('senam');
  for (const kind of want) {
    if (EV.cur && kind !== 'dadakan' && (!EV.cur.random || EV.cur.kind === kind)) break;
    const e = makeEvent(kind, ctx); if (!e) continue;
    if (kind !== 'senam') e.random = false;
    if (EV.cur) kick(EV.cur.ids);
    EV.cur = e; kick(e.ids);
    if (kind === 'dadakan') return;
    EV.done[kind] = kind === 'darurat' ? String(closed[0].id) : kind === 'pasar' ? String(wall) : day;
    return;
  }
  if (!EV.cur && wall >= EV.next) {
    const total = RANDOM_EVENTS.reduce((s, [, w]) => s + w, 0);
    for (let tries = 0; tries < 4; tries++) {
      let r = Math.random() * total, kind = RANDOM_EVENTS[0][0];
      for (const [k, w] of RANDOM_EVENTS) { r -= w; if (r <= 0) { kind = k; break; } }
      const e = makeEvent(kind, ctx);
      if (e) { EV.cur = e; kick(e.ids); return; }
    }
    EV.next = wall + 60_000;
  }
}

/* ---------- status from real data ---------- */
export type Status = { label: string; color: string; sleep: boolean; tag?: { text: string; color: string } | null; tp?: boolean; sl?: boolean };
const money = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`;
const weekendMt5 = (t: number) => { const d = new Date(t), wd = d.getUTCDay(), h = d.getUTCHours(); return wd === 6 || (wd === 0 && h < 22) || (wd === 5 && h >= 21); };
export function statuses(data: OfficeData, now: number): Record<string, Status> {
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
    vet: { label: 'SIAGA', color: '#58a6ff', sleep: false, tag: null },
    ob: { label: 'SIAGA', color: '#58a6ff', sleep: false, tag: null },
  };
}

/* ---------- drawing helpers ---------- */
type C = CanvasRenderingContext2D;
const sh = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k <= 1 ? v * k : v + (255 - v) * (k - 1))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
/** painted look: warm brown ink outlines instead of faint grey edges */
let INK: string | null = null;
let PSV = 1.14, OL = 'rgba(70,40,25,.6)';      // character scale + outline colour (set from the theme)      // character scale (set from the theme)
function poly(c: C, pts: Array<[number, number]>, fill: string | CanvasGradient, edge = false) {
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath(); c.fillStyle = fill; c.fill();
  if (edge) { c.strokeStyle = INK ?? 'rgba(0,0,0,.16)'; c.lineWidth = INK ? 0.5 : 0.4; c.stroke(); }
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
  // three layers that grow and fade = a soft contact shadow falling towards the room
  for (const [g, k] of [[0.34, 0.3], [0.2, 0.36], [0.06, 0.5]] as const)
    poly(c, [iso(x - g * 0.3, y - g * 0.3), iso(x + w + g, y - g * 0.3), iso(x + w + g, y + d + g), iso(x - g * 0.3, y + d + g)], `rgba(0,0,0,${a * k})`);
}
const hash = (str: string) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10_000) / 10_000; };
const wallL = (y0: number, y1: number, z0: number, z1: number): Array<[number, number]> => [iso(0, y0, z1), iso(0, y1, z1), iso(0, y1, z0), iso(0, y0, z0)];
const wallB = (x0: number, x1: number, z0: number, z1: number): Array<[number, number]> => [iso(x0, 0, z1), iso(x1, 0, z1), iso(x1, 0, z0), iso(x0, 0, z0)];

/* ---------- looks (themes) ---------- */
type Theme = { floor: string; floorN: string; line: string; back: string; backN: string; left: string; leftN: string; cap: string; base: string; sky?: [string, string, string]; paint?: boolean; planks?: boolean; ink?: string; pixel?: boolean; extra?: (c: C, night: boolean, room: number, wh: number) => void };
const THEMES: Record<string, Theme> = {
  modern: { floor: '#dcd9d3', floorN: '#b9b6b0', line: 'rgba(120,110,95,.13)', back: '#f5f4f1', backN: '#c9c7c2', left: '#eceae6', leftN: '#bdbbb6', cap: '#26272c', base: '#2b2c31' },
  kayu: {
    floor: '#c99a68', floorN: '#8f6a48', line: 'rgba(70,40,15,.28)', back: '#f1e6d6', backN: '#bfae98', left: '#eadbc6', leftN: '#b5a28a', cap: '#3b2a20', base: '#5a3a26',
    extra: (c, night, room, wh) => {          // exposed brick on the back wall
      const bh = 5.2;
      for (let z = 0, row = 0; z < wh - 2; z += bh, row++) for (let x = row % 2 ? -0.35 : 0; x < NX; x += 0.7) {
        const x0 = Math.max(0, x), x1 = Math.min(NX, x + 0.66); if (x1 <= x0) continue;
        const v = hash(`br${room}:${row}:${Math.round(x * 10)}`);
        poly(c, wallB(x0, x1, z + 0.5, z + bh - 0.4), night ? `rgb(${110 + v * 20},${55 + v * 10},${40 + v * 8})` : `rgb(${172 + v * 30},${84 + v * 18},${60 + v * 14})`);
      }
    },
  },
  neon: {
    floor: '#23252f', floorN: '#1b1d25', line: 'rgba(41,227,255,.10)', back: '#2c2f3c', backN: '#23252f', left: '#272a36', leftN: '#1f2129', cap: '#0e0f14', base: '#29e3ff',
    sky: ['#0c0520', '#2a0e4a', '#5a1a6e'],
    extra: (c, _n, _room, wh) => {             // neon strips along the floor and the ceiling line
      for (const [z, col] of [[2.2, '#29e3ff'], [wh - 6, '#ff3dbb']] as const) {
        c.save(); c.shadowColor = col; c.shadowBlur = 8; c.strokeStyle = col; c.lineWidth = 1.2;
        const a = iso(0, NY, z), b = iso(0, 0, z), d = iso(NX, 0, z); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.stroke(); c.restore();
      }
    },
  },
  hangat: {
    floor: '#b98a5e', floorN: '#7d5d40', line: 'rgba(70,40,15,.3)', back: '#efe7dc', backN: '#bdb3a6', left: '#e8dfd2', leftN: '#b2a898', cap: '#2a1f18', base: '#4a3324',
    extra: (c, night, room, wh) => {
      // colourful rugs like a design studio
      if (room === 0) poly(c, [iso(1.55, 5.95, 0.45), iso(4.45, 5.95, 0.45), iso(4.45, 10.05, 0.45), iso(1.55, 10.05, 0.45)], night ? '#3a3f4a' : '#5a6070');     // dark carpet under the long meeting table
      if (room === 1) poly(c, [iso(6.1, 3.9, 0.45), iso(8.9, 3.9, 0.45), iso(8.9, 6.3, 0.45), iso(6.1, 6.3, 0.45)], '#d9a33a');
      if (room === 2) { ell(c, 4.75, 8.85, 0.5, 1.5, '#e0b93e'); ell(c, 4.75, 8.85, 0.55, 1.15, '#ecc95a'); ell(c, 7.6, 5.4, 0.5, 1.3, '#b5503d'); }
      // living green wall + brand sign in the lobby, green wall behind the boss
      const green = (x0: number, x1: number, z0: number, z1: number, seed: string) => {
        poly(c, wallB(x0, x1, z0, z1), night ? '#1c3a24' : '#2c6a3a');
        for (let i = 0; i < (x1 - x0) * (z1 - z0) * 0.5; i++) { const x = x0 + 0.05 + hash(`${seed}x${i}`) * (x1 - x0 - 0.1), z = z0 + 2 + hash(`${seed}z${i}`) * (z1 - z0 - 4); const [px, py] = iso(x, 0, z); c.fillStyle = (night ? ['#24502f', '#2f6a3c', '#1c4226'] : ['#3d9a4f', '#58b765', '#2f7a3d', '#7fcf7a'])[i % (night ? 3 : 4)]; c.beginPath(); c.ellipse(px, py, 2.4, 1.5, i, 0, 7); c.fill(); }
      };
      void green;     // the green walls were removed (owner's choice)
    },
  },
  senja: {     // dark, cosy pixel-art office (like an isometric game): navy walls, warm wood, dark outlines, chunky pixels
    floor: '#8a5a3a', floorN: '#5a3a26', line: 'rgba(0,0,0,.22)', back: '#2f3747', backN: '#232a3a', left: '#2a3242', leftN: '#1f2534', cap: '#12151c', base: '#151922',
    sky: ['#5f8fc0', '#9cc0de', '#d6e6f1'], planks: true, ink: 'rgba(12,12,20,.85)', pixel: true,
    extra: (c, night, room, wh) => THEMES.hangat.extra!(c, night, room, wh),
  },
  lukis: {     // warm, hand-painted look (like a cosy animated film): honey wood, cream plaster, ink outlines
    floor: '#c38a57', floorN: '#6e4d34', line: 'rgba(110,65,35,.22)', back: '#f1e2c4', backN: '#8f7c63', left: '#ead6b2', leftN: '#85735a', cap: '#6b4429', base: '#8a5a36',
    sky: ['#8fc3e8', '#cfe6ef', '#f6e3c3'], paint: true,
    extra: (c, night, room, wh) => {
      // plaster texture: soft watercolour blotches
      for (let i = 0; i < 90; i++) {
        const x = hash(`px${room}${i}`) * NX, z = 6 + hash(`pz${room}${i}`) * (wh - 12), [qx, qy] = iso(x, 0, z);
        c.fillStyle = night ? 'rgba(40,25,15,.05)' : `rgba(${180 + hash(`pc${i}`) * 40},${140 + hash(`pd${i}`) * 30},100,.07)`;
        c.beginPath(); c.ellipse(qx, qy, 6 + hash(`pr${i}`) * 12, 3 + hash(`ps${i}`) * 6, 0.46, 0, 7); c.fill();
      }
      // wooden wainscot along the back wall
      poly(c, wallB(0, NX, 4, 30), night ? '#5a3b26' : '#a8724a');
      for (let x = 0.5; x < NX; x += 0.5) poly(c, wallB(x - 0.015, x + 0.015, 5, 29), 'rgba(70,40,20,.35)');
      poly(c, wallB(0, NX, 29, 32), night ? '#4a301f' : '#8a5a36');
      THEMES.hangat.extra!(c, night, room, wh);
    },
  },
  taman: {
    floor: '#e9e5da', floorN: '#bcb8ad', line: 'rgba(90,110,80,.14)', back: '#eef3ea', backN: '#c3cbbf', left: '#e6ede1', leftN: '#b9c1b4', cap: '#2f5d3a', base: '#3c6b46',
    sky: ['#79c0e8', '#bfe3f5', '#eef8ec'],
    extra: (c, night, room, wh) => {           // a living green wall + hanging vines
      poly(c, wallB(0.3, 2.4, 6, wh - 10), night ? '#1f3a26' : '#2f6b3c');
      for (let i = 0; i < 70; i++) { const x = 0.35 + hash(`gw${room}${i}`) * 2.0, z = 8 + hash(`gz${room}${i}`) * (wh - 20); const [px, py] = iso(x, 0, z); c.fillStyle = ['#3d9a4f', '#58b765', '#2f7a3d', '#7fcf7a'][i % 4]; c.beginPath(); c.ellipse(px, py, 2.2, 1.4, i, 0, 7); c.fill(); }
      for (let k = 0; k < 9; k++) { const x = 3 + k * 1.1, len = 10 + hash(`vn${room}${k}`) * 26; const a = iso(x, 0, wh - 2), b = iso(x, 0, wh - 2 - len); c.strokeStyle = night ? '#2a5a35' : '#3d9a4f'; c.lineWidth = 1; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); for (let j = 0; j < len; j += 4) { const q = iso(x, 0, wh - 2 - j); c.fillStyle = j % 8 ? '#58b765' : '#3d9a4f'; c.beginPath(); c.ellipse(q[0] + (j % 8 ? 1.5 : -1.5), q[1], 1.6, 1, 0, 0, 7); c.fill(); } }
    },
  },
};
let THEME: Theme = THEMES.modern;

/* zigzag: a round glass lift tube that ties the shifted floors together */
function drawLiftTube(c: C, night: boolean) {
  const cx = OX + (NX - NY) * TW * 0.5 + 6, top = TOPM - 30, bot = TOPM + RH * ROOMS - 10, r = 15;
  const g = c.createLinearGradient(cx - r, 0, cx + r, 0);
  g.addColorStop(0, night ? 'rgba(90,140,200,.35)' : 'rgba(160,210,240,.55)'); g.addColorStop(0.5, night ? 'rgba(160,200,255,.18)' : 'rgba(235,248,255,.7)'); g.addColorStop(1, night ? 'rgba(60,100,160,.4)' : 'rgba(120,170,210,.6)');
  c.fillStyle = g; c.fillRect(cx - r, top, 2 * r, bot - top);
  c.strokeStyle = '#26272c'; c.lineWidth = 1.2; c.strokeRect(cx - r, top, 2 * r, bot - top);
  for (let y = top + 20; y < bot; y += 34) { c.fillStyle = '#26272c'; c.fillRect(cx - r, y, 2 * r, 1.4); }
  c.fillStyle = '#f2c230'; c.fillRect(cx - 9, top + 120, 18, 22); c.fillStyle = '#26272c'; c.fillRect(cx - 7, top + 124, 14, 14);
}
/* rooftop: a deck with a pool, sun loungers, umbrellas and a helipad */
function drawRoofDeck(c: C, night: boolean) {
  box(c, 0, 0, NX, NY, -8, 8, night ? '#6b5440' : '#b88a5c', '#3a3b41', '#4a4b52', false);
  c.strokeStyle = 'rgba(70,40,15,.25)'; c.lineWidth = 0.4;
  for (let k = 0.5; k < NX; k += 0.5) { const a = iso(k, 0), b = iso(k, NY); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  ell(c, 3.4, 3.4, 0.2, 2.4, night ? '#3a3b42' : '#4a4c53'); ell(c, 3.4, 3.4, 0.3, 2.0, night ? '#2a2b30' : '#3a3b42');
  c.save(); const [hx, hy] = iso(3.4, 3.4, 0.4); c.translate(hx, hy); c.scale(1, 0.5); c.rotate(Math.PI / 4); c.fillStyle = '#f2c230'; c.font = '900 26px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('H', 0, 0); c.restore();
  // pool
  box(c, 6.6, 4.8, 5.4, 4.2, -8, 8.3, night ? '#1d4f7a' : '#3fb3e6', '#cfd8de', '#e2e8ec', false);
  poly(c, [iso(6.6, 4.8, 0.3), iso(12, 4.8, 0.3), iso(12, 9, 0.3), iso(6.6, 9, 0.3)], night ? '#2a6aa0' : '#5cc6f0');
  for (let k = 0; k < 7; k++) { const [wx, wy] = iso(7.2 + hash(`w${k}`) * 4.4, 5.2 + hash(`v${k}`) * 3.4, 0.4); c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(wx - 4, wy); c.quadraticCurveTo(wx, wy - 1.5, wx + 4, wy); c.stroke(); }
  // loungers + umbrellas
  for (const y of [5.0, 6.6, 8.2]) { box(c, 4.4, y, 1.4, 0.55, 0, 3, '#f4f4f2'); box(c, 4.4, y, 0.35, 0.55, 3, 4, '#f4f4f2'); }
  for (const [ux, uy, col] of [[3.7, 6.2, '#e5484d'], [3.7, 8.6, '#f2c230']] as const) {
    const [a0, a1] = iso(ux, uy, 0), [b0, b1] = iso(ux, uy, 26); c.strokeStyle = '#8b8f99'; c.lineWidth = 1; c.beginPath(); c.moveTo(a0, a1); c.lineTo(b0, b1); c.stroke();
    c.fillStyle = col; c.beginPath(); c.ellipse(b0, b1 + 2, 16, 7, 0, Math.PI, 0); c.fill(); c.fillStyle = 'rgba(0,0,0,.12)'; c.beginPath(); c.ellipse(b0, b1 + 2, 16, 2.5, 0, 0, Math.PI); c.fill();
  }
  // glass railing on the open edges + plants
  poly(c, [iso(0, NY, 0), iso(NX, NY, 0), iso(NX, NY, 12), iso(0, NY, 12)], 'rgba(190,225,245,.35)');
  poly(c, [iso(NX, 0, 0), iso(NX, NY, 0), iso(NX, NY, 12), iso(NX, 0, 12)], 'rgba(190,225,245,.3)');
  c.strokeStyle = '#26272c'; c.lineWidth = 0.9; for (const [a, b] of [[iso(0, NY, 12), iso(NX, NY, 12)], [iso(NX, 0, 12), iso(NX, NY, 12)]]) { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  for (const [px, py] of [[0.6, 0.6], [12.4, 0.6], [0.6, 10.4], [9.0, 0.7], [6.0, 0.7]]) plant(c, px, py, 1.2);
  for (const [x, y] of [[1.4, -1.1], [2.6, -1.1]]) box(c, x, y, 0.9, 0.8, 0, 9, '#d9dade', '#b5b7bd', '#c7c9ce');
}

/* ---------- the static room ---------- */
const CITY = Array.from({ length: 26 }, (_, i) => ({ y: 0.5 + i * 0.4 + hash(`b${i}`) * 0.15, w: 0.25 + hash(`w${i}`) * 0.3, h: 22 + hash(`h${i}`) * 42 }));
// the colour at the very top of the sky: also used above the drawing and behind the phone's clock, so there is no visible edge
const skyTop = (night: boolean) => (night ? '#03060f' : THEME.sky?.[0] ?? '#5aa8e0');
function drawBackdrop(c: C, night: boolean) {
  const y0 = -H, y1 = TOTAL + H;
  c.fillStyle = skyTop(night); c.fillRect(-W * 4, y0 - TOTAL * 4, CW + 8 * W, TOTAL * 4 + 1);
  const sky = c.createLinearGradient(0, y0, 0, TOTAL);
  if (night) { sky.addColorStop(0, '#03060f'); sky.addColorStop(0.6, '#0b1430'); sky.addColorStop(1, '#1a2550'); }
  else { const sk = THEME.sky ?? ['#5aa8e0', '#a9d5f2', '#e6f3fb']; sky.addColorStop(0, sk[0]); sky.addColorStop(0.55, sk[1]); sky.addColorStop(1, sk[2]); }
  c.fillStyle = sky; c.fillRect(-W * 4, y0, CW + 8 * W, y1 - y0);
  c.fillStyle = night ? '#1a2550' : THEME.sky?.[2] ?? '#e6f3fb'; c.fillRect(-W * 4, y1 - 1, CW + 8 * W, TOTAL * 4);
  if (night) {
    for (let i = 0; i < 140; i++) { c.fillStyle = `rgba(255,255,255,${0.25 + hash(`a${i}`) * 0.5})`; const r = hash(`r${i}`) > 0.9 ? 1.1 : 0.7; c.fillRect(-20 + hash(`st${i}`) * (CW + 40), -40 + hash(`sy${i}`) * TOTAL * 0.8, r, r); }
    const mg = c.createRadialGradient(60, 70, 2, 60, 70, 45); mg.addColorStop(0, 'rgba(255,248,220,.35)'); mg.addColorStop(1, 'rgba(255,248,220,0)'); c.fillStyle = mg; c.fillRect(15, 25, 90, 90);
    c.fillStyle = '#f4efd9'; c.beginPath(); c.arc(60, 70, 11, 0, 7); c.fill(); c.fillStyle = '#0b1430'; c.beginPath(); c.arc(65, 66, 10, 0, 7); c.fill();
  } else {
    const sg = c.createRadialGradient(CW - 55, 60, 4, CW - 55, 60, 70); sg.addColorStop(0, 'rgba(255,250,215,.95)'); sg.addColorStop(0.25, 'rgba(255,240,180,.45)'); sg.addColorStop(1, 'rgba(255,240,180,0)');
    c.fillStyle = sg; c.fillRect(CW - 140, -20, 170, 170);
    for (let i = 0; i < 9; i++) {      // soft clouds
      const cx = hash(`cx${i}`) * (CW + 60) - 30, cy = 30 + hash(`cy${i}`) * TOTAL * 0.62, sc = 0.6 + hash(`cs${i}`) * 0.9;
      c.fillStyle = 'rgba(255,255,255,.75)';
      for (const [dx, dy, r] of [[0, 0, 12], [13, -5, 14], [27, 0, 11], [8, 4, 10], [20, 5, 10]]) { c.beginPath(); c.ellipse(cx + dx * sc, cy + dy * sc, r * sc * 1.2, r * sc * 0.75, 0, 0, 7); c.fill(); }
    }
  }
  if (THEME.paint) {      // rolling hills and trees instead of a city
    for (const [base, col, amp, sd] of [[TOTAL - 120, night ? '#14213a' : '#b9d3b0', 40, 'h1'], [TOTAL - 30, night ? '#101b2c' : '#8fbc7f', 55, 'h2']] as const) {
      c.fillStyle = col; c.beginPath(); c.moveTo(-W, TOTAL + H);
      for (let x = -W; x <= CW + W; x += 20) c.lineTo(x, base - Math.sin(x / 90 + hash(sd) * 6) * amp * 0.5 - Math.sin(x / 37) * amp * 0.15);
      c.lineTo(CW + W, TOTAL + H); c.closePath(); c.fill();
    }
    for (let i = 0; i < 40; i++) { const x = -40 + hash(`bt${i}`) * (CW + 80), y = TOTAL - 60 + hash(`bu${i}`) * 80; c.fillStyle = night ? '#0d1626' : ['#6fa463', '#5e9a4c', '#86b874'][i % 3]; c.beginPath(); c.ellipse(x, y, 10 + hash(`bv${i}`) * 10, 7 + hash(`bw${i}`) * 6, 0, 0, 7); c.fill(); }
    return;
  }
  // two layers of city skyline behind the tower
  for (const [layer, base, hmax, col, win] of [[0, FLAT ? TOPM + 40 : TOTAL - 40, 260, night ? '#0f1730' : '#bdd0e2', night ? 'rgba(255,214,120,.55)' : 'rgba(255,255,255,.55)'], [1, FLAT ? TOPM + 90 : TOTAL + 10, 190, night ? '#141d38' : '#a3b8cd', night ? 'rgba(255,214,120,.8)' : 'rgba(255,255,255,.6)']] as const) {
    let x = -30;
    for (let i = 0; x < CW + 30; i++) {
      const w = 16 + hash(`w${layer}${i}`) * 28, h = 50 + hash(`h${layer}${i}`) * hmax, y = base - h;
      c.fillStyle = col; c.fillRect(x, y, w, h + 300);
      if (hash(`ant${layer}${i}`) > 0.75) c.fillRect(x + w / 2 - 0.5, y - 12, 1, 12);
      for (let ry = y + 6; ry < base - 6; ry += 8) for (let rx = x + 3; rx < x + w - 4; rx += 6) if (hash(`${layer}${i}:${rx}:${ry}`) > (night ? 0.55 : 0.75)) { c.fillStyle = win; c.fillRect(rx, ry, 2.4, 3); }
      c.fillStyle = col; x += w + 2 + hash(`g${layer}${i}`) * 6;
    }
  }
}
/** the framed photo on the owner's floor (loaded once; the background is re-rendered when it arrives) */
const PHOTO: { img: HTMLImageElement | null; ok: boolean } = { img: null, ok: false };
function loadPhoto(done: () => void) {
  if (PHOTO.img || typeof Image === 'undefined') return;
  const im = new Image(); PHOTO.img = im;
  im.onload = () => { PHOTO.ok = true; done(); };
  im.src = '/office/foto.jpg';
}
function drawFlatGround(c: C, night: boolean) {
  const L = -2 * NX;
  poly(c, [iso(L - 3, -3, -8), iso(NX + 40, -3, -8), iso(NX + 40, NY + 40, -8), iso(L - 3, NY + 40, -8)], night ? '#16231b' : '#86b96f');
  poly(c, [iso(L - 1.4, -1.4, -8), iso(NX + 1.4, -1.4, -8), iso(NX + 1.4, NY + 1.4, -8), iso(L - 1.4, NY + 1.4, -8)], night ? '#3a3b40' : '#d6d3cc');
  poly(c, [iso(NX + 3, -9, -8), iso(NX + 5.5, -9, -8), iso(NX + 5.5, NY + 60, -8), iso(NX + 3, NY + 60, -8)], night ? '#1c1d22' : '#4a4c53');
  poly(c, [iso(L - 9, NY + 3, -8), iso(NX + 9, NY + 3, -8), iso(NX + 9, NY + 5.5, -8), iso(L - 9, NY + 5.5, -8)], night ? '#1c1d22' : '#4a4c53');
  for (let k = -8; k < NY + 60; k += 1.6) poly(c, [iso(NX + 4.2, k, -7.9), iso(NX + 4.3, k, -7.9), iso(NX + 4.3, k + 0.8, -7.9), iso(NX + 4.2, k + 0.8, -7.9)], '#f2c230');
  for (let k = L - 8; k < NX + 8; k += 1.6) poly(c, [iso(k, NY + 4.2, -7.9), iso(k + 0.8, NY + 4.2, -7.9), iso(k + 0.8, NY + 4.3, -7.9), iso(k, NY + 4.3, -7.9)], '#f2c230');
  for (const [tx, ty, sc] of [[L - 2.6, 2, 1], [L - 2.6, 6, 1.15], [L - 2.6, 10, 0.95], [L + 4, NY + 2.0, 1.1], [L + 14, NY + 2.0, 1], [-6, NY + 2.0, 1.05], [5, NY + 2.0, 0.95], [NX + 2.0, 1.5, 0.9], [NX + 2.0, 6.5, 1]] as const) tree(c, tx, ty, sc, night);
}
function drawStatic(c: C, night: boolean, room: number) {
  // one building: the walls of a lower floor go all the way up to the floor slab of the room above (glass facade)
  const wh = FLAT ? FLATWH : SHAPE === 'zigzag' ? WALL + 26 : room === 0 && SHAPE !== 'rooftop' ? WALL + 26 : RH - 8;
  if (room === 2 && !FLAT) {    // the street level: lawn, pavement and a road around the tower
    poly(c, [iso(-9, -9, -8), iso(NX + 60, -9, -8), iso(NX + 60, NY + 60, -8), iso(-60, NY + 60, -8), iso(-60, 42, -8)], night ? '#16231b' : '#86b96f');      // lawn far past the screen edges, so a tall phone never sees sky under it
    poly(c, [iso(-1.4, -1.4, -8), iso(NX + 1.4, -1.4, -8), iso(NX + 1.4, NY + 1.4, -8), iso(-1.4, NY + 1.4, -8)], night ? '#3a3b40' : '#d6d3cc');
    poly(c, [iso(NX + 3, -9, -8), iso(NX + 5.5, -9, -8), iso(NX + 5.5, NY + 9, -8), iso(NX + 3, NY + 9, -8)], night ? '#1c1d22' : '#4a4c53');
    poly(c, [iso(-30, NY + 3, -8), iso(NX + 60, NY + 3, -8), iso(NX + 60, NY + 5.5, -8), iso(-30, NY + 5.5, -8)], night ? '#1c1d22' : '#4a4c53');
    for (let k = -8; k < NY + 8; k += 1.6) poly(c, [iso(NX + 4.2, k, -7.9), iso(NX + 4.3, k, -7.9), iso(NX + 4.3, k + 0.8, -7.9), iso(NX + 4.2, k + 0.8, -7.9)], '#f2c230');
    for (let k = -30; k < NX + 60; k += 1.6) poly(c, [iso(k, NY + 4.2, -7.9), iso(k + 0.8, NY + 4.2, -7.9), iso(k + 0.8, NY + 4.3, -7.9), iso(k, NY + 4.3, -7.9)], '#f2c230');
    for (const [tx, ty, sc] of [[-2.6, 2, 1], [-2.6, 6, 1.15], [-2.6, 10, 0.95], [3, -2.6, 1], [8, -2.6, 1.1], [NX + 2.0, 13.3, 1.05], [-4, NY + 2.0, 1.1], [NX + 2.0, 1.5, 0.9], [NX + 2.0, 6.5, 1]]) tree(c, tx, ty, sc, night);
    for (const [lx, ly] of [[NX + 2.7, 3.5], [NX + 2.7, 10], [4, NY + 2.7], [10, NY + 2.7]]) {      // street lamps
      const [a0, a1] = iso(lx, ly, -8), [b0, b1] = iso(lx, ly, 34);
      c.strokeStyle = '#3a3b42'; c.lineWidth = 1; c.beginPath(); c.moveTo(a0, a1); c.lineTo(b0, b1); c.lineTo(b0 + 5, b1 + 2); c.stroke();
      c.fillStyle = night ? '#ffe9a8' : '#d9dade'; c.beginPath(); c.ellipse(b0 + 5, b1 + 3, 2.4, 1.2, 0, 0, 7); c.fill();
      if (night) { const g = c.createRadialGradient(b0 + 5, b1 + 20, 2, b0 + 5, b1 + 20, 26); g.addColorStop(0, 'rgba(255,225,150,.3)'); g.addColorStop(1, 'rgba(255,225,150,0)'); c.fillStyle = g; c.fillRect(b0 - 25, b1 - 8, 60, 60); }
    }
  }
  if (room === 0 && SHAPE !== 'rooftop' && !FLAT) {    // roof: parapet, AC units, antenna and the black / yellow logo sign
    for (const [x, y] of [[1.4, -1.25], [2.6, -1.25], [8.8, -1.25]]) { box(c, x, y, 0.9, 0.8, wh + 8, 9, '#d9dade', '#b5b7bd', '#c7c9ce'); ell(c, x + 0.45, y + 0.4, wh + 17.2, 0.25, '#8b8f99'); }
    const [a0, a1] = iso(-0.15, -0.15, wh + 8), [b0, b1] = iso(-0.15, -0.15, wh + 48); c.strokeStyle = '#3a3b42'; c.lineWidth = 1; c.beginPath(); c.moveTo(a0, a1); c.lineTo(b0, b1); c.stroke();
    c.fillStyle = night ? '#ff4d4f' : '#c0392b'; c.beginPath(); c.arc(b0, b1, 1.5, 0, 7); c.fill();
    box(c, 5.6, -0.5, 1.6, 0.22, wh + 8, 22, '#141518', '#1e1f23', '#2a2b30');
    const [lx, ly] = iso(6.0, -0.28, wh + 13); c.fillStyle = '#f2c230'; c.beginPath(); c.ellipse(lx, ly + 0.5, 3.2, 3.2, 0, 0, 7); c.fill();
  }
  box(c, 0, 0, NX, NY, -8, 8, night ? THEME.floorN : THEME.floor, '#3a3b41', '#4a4b52', false);
  const [fcx, fcy] = iso(4, 5);
  const fg = c.createRadialGradient(fcx, fcy, 10, fcx, fcy, 240);
  fg.addColorStop(0, night ? 'rgba(255,240,210,.06)' : 'rgba(255,255,255,.25)'); fg.addColorStop(1, 'rgba(0,0,0,.08)');
  poly(c, [iso(0, 0), iso(NX, 0), iso(NX, NY), iso(0, NY)], fg);
  c.strokeStyle = night ? 'rgba(0,0,0,.08)' : THEME.line; c.lineWidth = 0.45;
  for (let k = 1; k < NX; k++) { const a = iso(k, 0), b = iso(k, NY); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  for (let k = 1; k < NY; k++) { const a = iso(0, k), b = iso(NX, k); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  if (THEME.paint || THEME.planks) for (let yy = 0; yy < NY; yy += 0.5) for (let xx = 0, i = 0; xx < NX; i++) {
    const l = 1.1 + hash(`pl${room}:${yy}:${i}`) * 2, x1 = Math.min(NX, xx + l), v = hash(`pv${room}:${yy}:${i}`);
    poly(c, [iso(xx, yy), iso(x1, yy), iso(x1, yy + 0.5), iso(xx, yy + 0.5)], night ? `rgba(0,0,0,${0.04 + v * 0.08})` : v < 0.33 ? 'rgba(120,70,30,.10)' : v < 0.66 ? 'rgba(255,230,190,.10)' : 'rgba(90,50,20,.05)');
    xx = x1;
  }
  // plank joints (staggered) so the floor reads as real flooring, plus a soft sheen
  c.strokeStyle = night ? 'rgba(0,0,0,.06)' : THEME.line; c.lineWidth = 0.35;
  for (let yy = 0; yy < NY; yy += 0.5) for (let xx = (yy * 2) % 2 ? 0.9 : 0.2; xx < NX; xx += 1.8) { const a = iso(xx, yy), b = iso(xx, yy + 0.5); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  for (let yy = 0.5; yy < NY; yy += 0.5) { const a = iso(0, yy), b = iso(NX, yy); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  const [gx0, gy0] = iso(0, NY * 0.5), [gx1, gy1] = iso(NX, NY * 0.5);
  const gl = c.createLinearGradient(gx0, gy0, gx1, gy1); gl.addColorStop(0, 'rgba(255,255,255,.16)'); gl.addColorStop(0.35, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,.05)');
  poly(c, [iso(0, 0), iso(NX, 0), iso(NX, NY), iso(0, NY)], gl);
  if (!night) for (const [y0, y1] of [[0.6, 3.1], [3.2, 5.7], [5.8, 8.3], [8.4, 10.6]]) {
    const lg = c.createLinearGradient(iso(0, y0)[0], iso(0, y0)[1], iso(4.2, y0 + 1.4)[0], iso(4.2, y0 + 1.4)[1]); lg.addColorStop(0, THEME.paint ? 'rgba(255,214,140,.42)' : 'rgba(255,250,235,.36)'); lg.addColorStop(1, THEME.paint ? 'rgba(255,214,140,0)' : 'rgba(255,250,235,0)');
    poly(c, [iso(0, y0), iso(0, y1), iso(4.2, Math.min(NY, y1 + 1.4)), iso(4.2, Math.min(NY, y0 + 1.4))], lg);
  }
  poly(c, [iso(0, 0), iso(NX, 0), iso(NX, 0.4), iso(0.4, 0.4)], 'rgba(0,0,0,.07)');
  poly(c, [iso(0, 0), iso(0.4, 0.4), iso(0.4, NY), iso(0, NY)], 'rgba(0,0,0,.07)');
  if (room === 2) {
    ell(c, 4.75, 8.85, 0.3, 1.75, '#2c2d33');
    for (let k = 0; k < 4; k++) ell(c, 4.75, 8.85, 0.4 + k * 0.05, 1.55 - k * 0.38, k % 2 ? '#3d3e46' : '#36373e');
    ell(c, 7.6, 5.4, 0.3, 1.35, night ? '#cfcac0' : '#ebe6dc');
    poly(c, [iso(0.45, 3.4, 0.3), iso(2.6, 3.4, 0.3), iso(2.6, 6.6, 0.3), iso(0.45, 6.6, 0.3)], '#2f3036');
  }
  if (room === 0) {
    poly(c, [iso(4.6, 3.3, 0.3), iso(8.2, 3.3, 0.3), iso(8.2, 6.3, 0.3), iso(4.6, 6.3, 0.3)], '#3a3b42');
    poly(c, [iso(4.75, 3.45, 0.4), iso(8.05, 3.45, 0.4), iso(8.05, 6.15, 0.4), iso(4.75, 6.15, 0.4)], '#43444c');
    ell(c, 3.0, 7.6, 0.3, 1.35, night ? '#cfcac0' : '#ebe6dc');
    poly(c, [iso(9.0, 4.95, 0.3), iso(12.3, 4.95, 0.3), iso(12.3, 5.65, 0.3), iso(9.0, 5.65, 0.3)], '#3f9a4f');
    poly(c, [iso(9.0, 5.55, 0.35), iso(12.3, 5.55, 0.35), iso(12.3, 5.65, 0.35), iso(9.0, 5.65, 0.35)], '#2f7a3d');
    ell(c, 11.9, 5.3, 0.4, 0.07, '#141518');
  }
  if (room === 1) poly(c, [iso(6.0, 3.8, 0.3), iso(9.0, 3.8, 0.3), iso(9.0, 6.4, 0.3), iso(6.0, 6.4, 0.3)], '#3a3b42');
  const cap = THEME.cap;
  box(c, -0.28, -0.28, NX + 0.28, 0.28, -8, wh + 8, cap, night ? THEME.backN : THEME.back, cap, false);
  const inner = FLAT && room > 0;      // a glass partition instead of the outer wall
  if (!inner) box(c, -0.28, -0.28, 0.28, NY + 0.28, -8, wh + 8, cap, cap, night ? THEME.leftN : THEME.left, false);
  THEME.extra?.(c, night, room, wh);
  const [w0] = iso(0, 0), [w1] = iso(2, 0);
  const wg = c.createLinearGradient(w0, 0, w1, 0); wg.addColorStop(0, 'rgba(0,0,0,.1)'); wg.addColorStop(1, 'rgba(0,0,0,0)');
  poly(c, wallB(0, 2, 0, wh), wg);
  poly(c, wallB(0, NX, 0, 4), THEME.base); if (!inner) poly(c, wallL(0, NY, 0, 4), THEME.base);
  for (const [y0, y1] of inner ? [] : [[0.55, NY - 0.3]]) {      // one big plain glass pane, no dividing lines
    const FR = THEME.paint ? (night ? '#3a2416' : '#6b4429') : '#1c1d21';
    poly(c, wallL(y0 - 0.06, y1 + 0.06, 10, wh - 4), FR);
    const sky = c.createLinearGradient(0, iso(0, y0, wh - 8)[1], 0, iso(0, y0, 14)[1]);
    if (night) { sky.addColorStop(0, '#0b1430'); sky.addColorStop(1, '#1a2550'); } else if (THEME.paint) { sky.addColorStop(0, '#9ccbe9'); sky.addColorStop(0.6, '#e1f0ee'); sky.addColorStop(1, '#f3e6c8'); } else { sky.addColorStop(0, '#8cc6ec'); sky.addColorStop(1, '#e7f4fb'); }
    c.save(); c.beginPath(); const p = wallL(y0, y1, 13, wh - 7); c.moveTo(p[0][0], p[0][1]); for (const q of p.slice(1)) c.lineTo(q[0], q[1]); c.closePath(); c.clip();
    c.fillStyle = sky; c.fill();
    if (THEME.paint) { /* plain glass: only the sky behind it */ }
    else for (const b of CITY) {
      if (b.y + b.w < y0 || b.y > y1) continue;
      poly(c, wallL(b.y, b.y + b.w, 13, 13 + b.h * 0.8), night ? '#1b2440' : '#c3ccd6');
      poly(c, wallL(b.y, b.y + b.w * 0.35, 13, 13 + b.h * 0.8), night ? '#151c34' : '#b0bac6');
      for (let k = 0; k < 8; k++) {
        const lit = hash(`${b.y}:${k}`);
        if (night ? lit > 0.45 : lit > 0.7) poly(c, wallL(b.y + 0.06 + (k % 2) * b.w * 0.45, b.y + 0.1 + (k % 2) * b.w * 0.45, 17 + Math.floor(k / 2) * 9, 20 + Math.floor(k / 2) * 9), night ? '#ffd27a' : '#e9eef3');
      }
    }
    poly(c, [iso(0, y0 + 0.2, wh - 7), iso(0, y0 + 0.55, wh - 7), iso(0, y0 + 1.3, 13), iso(0, y0 + 0.95, 13)], 'rgba(255,255,255,.08)');
    c.restore();
    poly(c, wallL(y0, y1, 13, 15), 'rgba(255,255,255,.18)');
    poly(c, wallL(y0 - 0.06, y1 + 0.06, 10, 13), THEME.paint ? '#8a5a36' : '#2f3036');
  }
  if (room > 0) { poly(c, wallL(0, NY, wh - 6, wh), '#2b2c31'); poly(c, wallB(0, NX, wh - 6, wh), '#2b2c31'); }
  if (inner) {      // glass partition with a gap (the way through) in the middle
    for (const [ya, yb] of [[0.05, DOOR_Y - 0.75], [DOOR_Y + 0.75, NY - 0.05]]) {
      poly(c, wallL(ya, yb, 0, 74), night ? 'rgba(120,160,210,.10)' : 'rgba(185,225,245,.22)');
      for (const z of [0, 74]) poly(c, wallL(ya, yb, z, z + 2.2), '#1a1d24');
      for (let y = ya; y <= yb + 0.01; y += (yb - ya) / Math.max(1, Math.round((yb - ya) / 1.6))) poly(c, wallL(y - 0.03, y + 0.03, 0, 74), '#1a1d24');
      poly(c, [iso(0, ya + 0.3, 70), iso(0, ya + 0.6, 70), iso(0, ya + 1.4, 6), iso(0, ya + 1.1, 6)], 'rgba(255,255,255,.08)');
    }
  }
  // everyday wall hardware: air conditioner, exit sign, camera, fire extinguisher, sockets
  if (room === 2) {      // exit: a wide glass double door with a big green KELUAR sign above it
    poly(c, wallB(13.0, 14.65, 0, 64), '#1e1f23');                                   // frame
    for (const [a, b] of [[13.1, 13.8], [13.85, 14.55]]) {
      poly(c, wallB(a, b, 0, 60), night ? 'rgba(120,150,185,.7)' : 'rgba(165,205,235,.9)');
      poly(c, wallB(a + 0.06, a + 0.22, 8, 56), 'rgba(255,255,255,.35)');           // glass shine
      poly(c, wallB(a + 0.08, b - 0.08, 27, 29.5), '#c9ccd2');                          // push bar
    }
    poly(c, wallB(13.8, 13.85, 0, 60), '#1e1f23');
    poly(c, wallB(13.05, 14.6, 67, 77), '#1f9d57'); poly(c, wallB(13.1, 14.55, 68, 76), '#22b062');
    const [ex, ey] = iso(13.825, 0, 72); c.save(); c.translate(ex, ey); c.transform(1, 0.5, 0, 1, 0, 0);
    c.fillStyle = '#ffffff'; let ef = 6; c.font = `900 ${ef}px ui-sans-serif, system-ui, sans-serif`; while (ef > 3 && c.measureText('KELUAR').width > 18) { ef -= 0.2; c.font = `900 ${ef}px ui-sans-serif, system-ui, sans-serif`; } c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('KELUAR', 0, 0.3);
    c.restore();
    poly(c, wallB(13.0, 14.65, 0, 1.2), '#8b8f99');                                    // threshold
  }
  { const [cx, cy] = iso(0.5, 0, wh - 14); c.fillStyle = '#26272c'; c.beginPath(); c.arc(cx, cy, 2.6, 0, Math.PI); c.fill(); c.fillStyle = night ? '#ff4d4f' : '#7a2a2a'; c.fillRect(cx - 0.5, cy + 0.6, 1, 1); }
  // lift on every floor (the way between the rooms); on the open floor: the entrance door in the lobby
  if ((!FLAT || room === 2) && SHAPE !== 'tower') {
  poly(c, wallB(11.1, 12.2, 0, 54), '#1e1f23');
  poly(c, wallB(11.2, 11.64, 0, 50), night ? '#8d939c' : '#b9bfc8'); poly(c, wallB(11.66, 12.1, 0, 50), night ? '#868c95' : '#aeb4bd');
  poly(c, wallB(11.5, 11.8, 57, 61), '#141518'); poly(c, wallB(11.6, 11.7, 58, 60), '#f2c230');
  poly(c, wallB(12.3, 12.42, 24, 30), '#2a2b30'); poly(c, wallB(12.33, 12.39, 25.5, 28.5), '#f2c230');
  }
  if (room === 1) {
    poly(c, wallB(TV.x0 - 0.1, TV.x1 + 0.1, TV.z0 - 3, TV.z1 + 2.5), '#111214');
  }
  if (room === 0) {     // the team board (names + roles), a clock, the framed photo
    const fx0 = 4.95, fx1 = 7.35, fz0 = 57, fz1 = 100;
    poly(c, wallB(fx0 + 0.05, fx1 + 0.18, fz0 - 5, fz1 + 1), 'rgba(0,0,0,.12)');
    poly(c, wallB(fx0 - 0.1, fx1 + 0.1, fz0 - 3, fz1 + 3), '#8a5a34');
    poly(c, wallB(fx0 - 0.04, fx1 + 0.04, fz0 - 1.2, fz1 + 1.2), '#c99a68');
    poly(c, wallB(fx0, fx1, fz0, fz1), '#fbf6ee');
    const img = PHOTO.img;
    if (img && PHOTO.ok) {
      const [ox, oy] = iso(fx0 + 0.08, 0, fz1 - 2.5), pw = (fx1 - fx0 - 0.16) * TW, ph = fz1 - fz0 - 5;
      c.save(); c.translate(ox, oy); c.transform(1, 0.5, 0, 1, 0, 0);
      const sz = Math.min(img.width, img.height * pw / ph), szh = sz * ph / pw;
      c.drawImage(img, (img.width - sz) / 2, (img.height - szh) / 2, sz, szh, 0, 0, pw, ph);
      c.restore();
    }
    poly(c, wallB(ROSTER.x0 - 0.08, ROSTER.x1 + 0.08, ROSTER.z0 - 3, ROSTER.z1 + 3), '#b8901a');
    poly(c, wallB(ROSTER.x0, ROSTER.x1, ROSTER.z0, ROSTER.z1), '#fbfaf6');
    const [cx, cy] = iso(10.6, 0, 64); c.save(); c.translate(cx, cy); c.transform(1, 0.5, 0, 1, 0, 0); c.beginPath(); c.arc(0, 0, 5.5, 0, 7); c.fillStyle = '#1e1f23'; c.fill(); c.beginPath(); c.arc(0, 0, 4.6, 0, 7); c.fillStyle = '#fff'; c.fill();
    c.strokeStyle = '#1e1f23'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -3.2); c.moveTo(0, 0); c.lineTo(2.4, 0.6); c.stroke(); c.restore();
  }
  if (room === 2) {     // toilet door with a sign, menu board above the kitchen
    poly(c, wallB(4.15, 5.25, 0, 52), '#1e1f23'); poly(c, wallB(4.25, 5.15, 0, 49), night ? '#5a4634' : '#7a5a3f');
    poly(c, wallB(4.45, 4.95, 38, 45), '#ffffff');
    for (const [x0, col] of [[4.55, '#3a7bd5'], [4.75, '#e5484d']] as const) { poly(c, wallB(x0, x0 + 0.1, 39, 42.5), col); poly(c, wallB(x0 + 0.02, x0 + 0.08, 43, 44.3), col); }
    poly(c, wallB(5.0, 5.06, 22, 26), '#f2c230');
    poly(c, wallB(7.05, 9.0, 38, 64), '#1e1f23'); poly(c, wallB(7.15, 8.9, 40, 62), '#26272c');
    for (let k = 0; k < 4; k++) { poly(c, wallB(7.3, 8.1 + (k % 2) * 0.3, 54 - k * 4, 55 - k * 4), '#e9e9e7'); poly(c, wallB(8.5, 8.75, 54 - k * 4, 55 - k * 4), '#f2c230'); }
  }
}

/* ---------- furniture ---------- */
type Item = { x0: number; y0: number; x1: number; y1: number; draw: (c: C, t: number) => void };
type ScreenMode = 'off' | 'idle' | 'pos';
const MODES: Record<string, ScreenMode> = {};
const BUSY: Record<string, boolean> = {};
/** what an employee's monitor shows: everyday stuff (web page, video, spreadsheet, chat, code, music), changing now and then */
function screenPlane(c: C, ax: (u: number, z: number) => [number, number], mode: ScreenMode, t: number, seed: number) {
  const r = (u0: number, u1: number, z0: number, z1: number, col: string) => poly(c, [ax(u0, z1), ax(u1, z1), ax(u1, z0), ax(u0, z0)], col);
  if (mode === 'off') { r(0, 1, 0, 1, '#0d1117'); return; }
  const kind = Math.floor(hash(`${seed}:${Math.floor(t / 25 + hash(`o${seed}`) * 7)}`) * 6);
  if (kind === 0) {            // web page
    r(0, 1, 0, 1, '#f4f5f7'); r(0, 1, 0.84, 1, '#4c7dff');
    r(0.08, 0.5, 0.42, 0.76, '#f2c230'); r(0.58, 0.92, 0.68, 0.74, '#9aa3b0'); r(0.58, 0.85, 0.56, 0.62, '#c3c9d2'); r(0.58, 0.9, 0.46, 0.52, '#c3c9d2');
    for (let k = 0; k < 3; k++) r(0.08, 0.92 - k * 0.15, 0.1 + k * 0.1, 0.15 + k * 0.1, '#c3c9d2');
  } else if (kind === 1) {     // a video: landscape + progress bar
    r(0, 1, 0, 1, '#111214'); r(0.04, 0.96, 0.18, 0.96, '#7cc0ef');
    poly(c, [ax(0.04, 0.18), ax(0.35, 0.7), ax(0.6, 0.18)], '#3d9a4f'); poly(c, [ax(0.4, 0.18), ax(0.7, 0.6), ax(0.96, 0.18)], '#2f7a3d');
    r(0.74, 0.86, 0.74, 0.88, '#ffd66b');
    const pr = (t * 0.02 + hash(`v${seed}`)) % 1; r(0.04, 0.96, 0.07, 0.1, '#3a3b42'); r(0.04, 0.04 + 0.92 * pr, 0.07, 0.1, '#e5484d');
  } else if (kind === 2) {     // spreadsheet
    r(0, 1, 0, 1, '#ffffff'); r(0, 1, 0.86, 1, '#2e9e5b');
    for (let k = 1; k < 6; k++) r(0, 1, k * 0.14, k * 0.14 + 0.02, '#d6dbe0');
    for (const u of [0.3, 0.55, 0.8]) r(u, u + 0.02, 0, 0.86, '#d6dbe0');
    r(0.32, 0.53, 0.44, 0.56, '#bfe6cc');
  } else if (kind === 3) {     // chat
    r(0, 1, 0, 1, '#e9eef3'); r(0, 1, 0.86, 1, '#229ed9');
    r(0.06, 0.55, 0.62, 0.76, '#ffffff'); r(0.42, 0.94, 0.42, 0.56, '#bfe7ff'); r(0.06, 0.45, 0.22, 0.36, '#ffffff');
    if (Math.floor(t * 2) % 2) r(0.5, 0.94, 0.06, 0.16, '#bfe7ff');
  } else if (kind === 4) {     // code editor
    r(0, 1, 0, 1, '#1e1f26'); r(0, 0.12, 0, 1, '#2a2b33');
    const cols = ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c', '#89ddff'];
    for (let k = 0; k < 6; k++) { const ind = (k % 3) * 0.08, len = 0.25 + hash(`c${seed}${k}`) * 0.45; r(0.18 + ind, Math.min(0.95, 0.18 + ind + len), 0.82 - k * 0.14, 0.88 - k * 0.14, cols[k % 5]); }
    if (Math.floor(t * 2) % 2) r(0.6, 0.62, 0.1, 0.18, '#ffffff');
  } else {                     // music player
    r(0, 1, 0, 1, '#191414'); r(0.08, 0.45, 0.3, 0.9, '#e5484d'); r(0.18, 0.35, 0.48, 0.72, '#f2c230');
    for (let k = 0; k < 6; k++) { const hgt = 0.15 + 0.6 * Math.abs(Math.sin(t * 3 + k * 1.3 + seed)); r(0.55 + k * 0.07, 0.6 + k * 0.07, 0.3, 0.3 + hgt * 0.6, '#1db954'); }
    r(0.08, 0.92, 0.1, 0.14, '#3a3b42'); r(0.08, 0.08 + 0.84 * ((t * 0.03) % 1), 0.1, 0.14, '#1db954');
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
/** a street tree: trunk, layered round canopy, soft ground shadow */
function tree(c: C, x: number, y: number, sc: number, night: boolean) {
  const [sx, sy] = iso(x, y, -8);
  c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(sx + 3 * sc, sy + 1, 13 * sc, 5.5 * sc, 0, 0, 7); c.fill();
  c.fillStyle = night ? '#3a2c22' : '#6b4a33'; c.fillRect(sx - 1.6 * sc, sy - 16 * sc, 3.2 * sc, 16 * sc);
  const cols = night ? ['#16382a', '#1c4633', '#22553d'] : ['#2f7a3d', '#3d9a4f', '#58b765'];
  const blobs: Array<[number, number, number, number]> = [[0, -24, 11, 0], [-7, -19, 8, 0], [7, -20, 8, 0], [-3, -30, 8, 1], [5, -29, 7, 1], [0, -35, 6.5, 2], [-6, -26, 5, 2], [4, -23, 5, 1]];
  for (const [dx, dy, r, k] of blobs) { c.fillStyle = cols[k]; c.beginPath(); c.arc(sx + dx * sc, sy + dy * sc, r * sc, 0, 7); c.fill(); }
  c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.arc(sx - 3 * sc, sy - 33 * sc, 4 * sc, 0, 7); c.fill();
}
/** traffic on the two streets in front of the tower */
const CARS = [
  { road: 'x', lane: NY + 3.55, speed: 2.6, off: 0, col: '#e5484d' }, { road: 'x', lane: NY + 3.55, speed: 2.6, off: 14, col: '#f4f4f2' },
  { road: 'x', lane: NY + 4.85, speed: -2.1, off: 5, col: '#f2c230' }, { road: 'y', lane: NX + 3.55, speed: -2.3, off: 3, col: '#4c7dff' },
  { road: 'y', lane: NX + 4.85, speed: 2.8, off: 11, col: '#2a2b30' }, { road: 'y', lane: NX + 4.85, speed: 2.8, off: 22, col: '#2fb67c' },
] as const;
/** the car park beside the lobby: Marcel's and Ny. Vetrycia's cars while they are at the office, the staff's motorbikes (the bots work overtime, so those stay) */
function drawParking(c: C, wall: number, night: boolean) {
  const h = new Date(wall).getHours(), bossIn = !(h >= 23 || h < 7);
  for (const y of [2.3, 3.2, 4.1]) poly(c, [iso(NX + 0.4, y, -7.9), iso(NX + 2.3, y, -7.9), iso(NX + 2.3, y + 0.05, -7.9), iso(NX + 0.4, y + 0.05, -7.9)], 'rgba(255,255,255,.7)');
  const car = (y: number, col: string) => {
    const x = NX + 0.55, w = 1.5, d = 0.7;
    poly(c, [iso(x - 0.1, y - 0.1, -8), iso(x + w + 0.2, y - 0.1, -8), iso(x + w + 0.2, y + d + 0.2, -8), iso(x - 0.1, y + d + 0.2, -8)], 'rgba(0,0,0,.22)');
    for (const wx of [x + 0.25, x + w - 0.25]) { const [a0, a1] = iso(wx, y + d, -6.5); c.fillStyle = '#141518'; c.beginPath(); c.ellipse(a0, a1, 1.6, 1.3, 0, 0, 7); c.fill(); }
    box(c, x, y, w, d, -6, 5.5, col); box(c, x + 0.3, y + 0.06, w - 0.62, d - 0.12, -0.5, 4.5, '#9cc6e6', '#5d86a8', '#7aa5c7'); box(c, x + 0.3, y + 0.06, w - 0.62, d - 0.12, 4, 0.8, sh(col, 0.92));
  };
  if (bossIn) { car(2.4, '#1e1f23'); car(3.3, '#d0568a'); }
  const bikes: Array<[number, string]> = [[7.9, '#e5484d'], [8.4, '#2fb67c'], [8.9, '#f2c230'], [9.4, '#4c7dff'], [10.6, '#229ed9']];
  for (const [y, col] of bikes) {
    const x = NX + 0.6; poly(c, [iso(x, y - 0.05, -8), iso(x + 1.0, y - 0.05, -8), iso(x + 1.0, y + 0.2, -8), iso(x, y + 0.2, -8)], 'rgba(0,0,0,.2)');
    for (const wx of [x + 0.12, x + 0.88]) { const [a0, a1] = iso(wx, y + 0.08, -6.8); c.fillStyle = '#141518'; c.beginPath(); c.ellipse(a0, a1, 1.3, 1.2, 0, 0, 7); c.fill(); }
    box(c, x + 0.15, y, 0.7, 0.16, -6.6, 2.6, col); box(c, x + 0.35, y + 0.01, 0.35, 0.14, -4, 0.9, '#1e1f23');
    const [hx, hy] = iso(x + 0.86, y + 0.08, -2.2); c.strokeStyle = '#2a2b30'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx + 1.5, hy - 2.5); c.stroke();
  }
  void night;
}
function drawCars(c: C, t: number, night: boolean) {
  const span = 34;                                       // tiles before a car loops around
  const list = CARS.map((car) => { const along = (((t * car.speed + car.off) % span) + span) % span - 10; return { car, along }; })
    .sort((a, b) => (a.along + a.car.lane) - (b.along + b.car.lane));
  for (const { car, along } of list) {
    const isX = car.road === 'x', L = 1.5, Wd = 0.72;
    const x = isX ? along : car.lane, y = isX ? car.lane : along, w = isX ? L : Wd, d = isX ? Wd : L;
    poly(c, [iso(x - 0.1, y - 0.1, -8), iso(x + w + 0.25, y - 0.1, -8), iso(x + w + 0.25, y + d + 0.25, -8), iso(x - 0.1, y + d + 0.25, -8)], 'rgba(0,0,0,.22)');
    for (const [wx, wy] of isX ? [[x + 0.25, y + d], [x + w - 0.25, y + d]] : [[x + w, y + 0.25], [x + w, y + d - 0.25]]) { const [a0, a1] = iso(wx, wy, -6.5); c.fillStyle = '#141518'; c.beginPath(); c.ellipse(a0, a1, 1.9, 2.3, 0, 0, 7); c.fill(); }
    box(c, x, y, w, d, -6, 5.5, car.col);
    const cx = isX ? x + 0.3 : x + 0.06, cy = isX ? y + 0.06 : y + 0.3, cw = isX ? w - 0.62 : w - 0.12, cd = isX ? d - 0.12 : d - 0.62;
    box(c, cx, cy, cw, cd, -0.5, 4.5, '#9cc6e6', '#5d86a8', '#7aa5c7');
    box(c, cx, cy, cw, cd, 4, 0.8, sh(car.col, 0.92));
    const fwd = car.speed > 0;
    const front = isX ? iso(fwd ? x + w : x, y + d / 2, -3) : iso(x + w / 2, fwd ? y + d : y, -3);
    c.fillStyle = night ? '#fff3c4' : '#f4f4f2'; c.beginPath(); c.arc(front[0], front[1], 1.1, 0, 7); c.fill();
    if (night) { const g = c.createRadialGradient(front[0], front[1], 0, front[0], front[1], 14); g.addColorStop(0, 'rgba(255,240,180,.45)'); g.addColorStop(1, 'rgba(255,240,180,0)'); c.fillStyle = g; c.fillRect(front[0] - 14, front[1] - 14, 28, 28); }
  }
}
/** two traders facing each other across one desk: the north one's monitors show their backs, the south one's screens face us */
/** one trader's desk by the window: the trader sits on the room side and looks at the window, the screens face the room (we see them) */
function windowDesk(y0: number, id: string): Item {
  const x0 = 1.0, w = 0.75, d = 1.3;
  return {
    x0, y0, x1: x0 + w, y1: y0 + d, draw: (c, t) => {
      shadow(c, x0, y0, w, d);
      box(c, x0 + 0.05, y0 + 0.05, w - 0.1, 0.08, 0, 15, '#1e1f23'); box(c, x0 + 0.05, y0 + d - 0.13, w - 0.1, 0.08, 0, 15, '#1e1f23');
      box(c, x0 + 0.1, y0 + 0.2, 0.45, 0.4, 0, 15, '#24252a', '#1b1c20', '#2d2e34');
      if (THEME.paint) box(c, x0, y0, w, d, 15, 2.2, '#d9ac7a', '#a8774c', '#bf8d5f'); else box(c, x0, y0, w, d, 15, 2.2, '#f7f7f5', '#d6d5d1', '#e7e6e2');
      for (const [ya, yb] of [[y0 + 0.1, y0 + 0.62], [y0 + 0.68, y0 + 1.2]]) {
        box(c, x0 + 0.18, (ya + yb) / 2 - 0.05, 0.1, 0.1, 17.2, 4, '#1e1f23');
        box(c, x0 + 0.24, ya, 0.07, yb - ya, 20, 12, '#1e1f23', '#141518', '#1e1f23');
        const A = ya + 0.04, B = yb - 0.04;
        screenPlane(c, (u, z) => iso(x0 + 0.315, A + u * (B - A), 21 + z * 10), MODES[id] ?? 'idle', t, Math.floor(y0 * 10 + ya * 3));
      }
      box(c, x0 + 0.42, y0 + 0.35, 0.2, 0.6, 17.2, 0.8, '#e3e3e1');
      cyl(c, x0 + 0.55, y0 + 1.15, 17.2, 0.05, 3, '#f2c230', '#d9a91c');
      if (id === 'tg' && MODES.tgSend === 'pos') for (let k = 0; k < 3; k++) {
        const ph = (t * 0.55 + k / 3) % 1, [px, py] = iso(x0 + 0.3, y0 + 0.6 - ph * 0.6, 32 + ph * 34);
        c.globalAlpha = 1 - ph; c.fillStyle = '#5ec2f2'; c.beginPath(); c.moveTo(px, py); c.lineTo(px + 6, py - 3); c.lineTo(px + 1.5, py + 2); c.closePath(); c.fill(); c.globalAlpha = 1;
      }
    },
  };
}
function clusterDesk(y0: number, north: string, south: string): Item {
  const x0 = 1.3, w = 1.8, d = 1.4, ym = y0 + d / 2;
  return {
    x0, y0, x1: x0 + w, y1: y0 + d, draw: (c, t) => {
      shadow(c, x0, y0, w, d);
      box(c, x0 + 0.04, y0 + 0.05, 0.08, d - 0.1, 0, 15, '#1e1f23');
      box(c, x0 + w - 0.12, y0 + 0.05, 0.08, d - 0.1, 0, 15, '#1e1f23');
      box(c, x0 + w - 0.66, ym + 0.08, 0.5, 0.55, 0, 15, '#24252a', '#1b1c20', '#2d2e34');
      if (THEME.paint) box(c, x0, y0, w, d, 15, 2.2, '#d9ac7a', '#a8774c', '#bf8d5f'); else box(c, x0, y0, w, d, 15, 2.2, '#f7f7f5', '#d6d5d1', '#e7e6e2');
      box(c, x0 + 0.06, ym - 0.03, w - 0.12, 0.06, 17.2, 6, '#d8cfc2', '#bfb6a9', '#cbc2b5');
      const pairs: Array<[number, number]> = [[x0 + 0.14, x0 + 0.86], [x0 + 0.94, x0 + 1.66]];
      for (const [xa, xb] of pairs) {      // north trader's monitors (we see their backs)
        box(c, (xa + xb) / 2 - 0.05, ym - 0.32, 0.1, 0.1, 17.2, 4, '#1e1f23');
        box(c, xa, ym - 0.24, xb - xa, 0.08, 20, 12, '#2a2b30', '#33343a', '#2a2b30');
      }
      for (const [xa, xb] of pairs) {      // south trader's monitors (screens towards us)
        box(c, (xa + xb) / 2 - 0.05, ym + 0.2, 0.1, 0.1, 17.2, 4, '#1e1f23');
        box(c, xa, ym + 0.12, xb - xa, 0.07, 20, 12, '#1e1f23', '#141518', '#1e1f23');
        const A = xa + 0.04, B = xb - 0.04;
        screenPlane(c, (u, z) => iso(A + u * (B - A), ym + 0.195, 21 + z * 10), MODES[south] ?? 'idle', t, Math.floor(y0 * 10 + xa * 3));
      }
      void north;
      box(c, x0 + 0.6, y0 + 0.12, 0.6, 0.2, 17.2, 0.8, '#e3e3e1');
      box(c, x0 + 0.6, y0 + d - 0.32, 0.6, 0.2, 17.2, 0.8, '#e3e3e1');
      cyl(c, x0 + 0.25, y0 + 0.22, 17.2, 0.05, 3, '#ffffff', '#eeeeee');
      cyl(c, x0 + w - 0.25, y0 + d - 0.22, 17.2, 0.05, 3, '#f2c230', '#d9a91c');
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
/** a soft armchair facing -x (its back on the +x side); 'massage' adds a head pillow and a remote */
function armchair(c: C, x: number, y: number, col: string, dark: string, massage = false) {
  ell(c, x + 0.15, y, 0, 0.45, 'rgba(0,0,0,.15)');
  box(c, x - 0.3, y - 0.38, 0.75, 0.76, 0, 8, col, dark, col);
  box(c, x + 0.3, y - 0.38, 0.18, 0.76, 8, massage ? 20 : 15, col, dark, col);
  box(c, x - 0.3, y - 0.42, 0.75, 0.1, 8, 6, dark); box(c, x - 0.3, y + 0.32, 0.75, 0.1, 8, 6, dark);
  if (massage) { box(c, x + 0.28, y - 0.22, 0.16, 0.44, 26, 5, '#3a3b42'); box(c, x - 0.25, y + 0.32, 0.12, 0.1, 14, 1.5, '#f2c230'); }
}
function baseItems(): Item[] {
  const it: Item[] = [];
  for (const [y0, id] of [[0.9, 'alt'], [3.1, 'big'], [5.3, 'xau'], [7.5, 'nas'], [9.7, 'tg']] as Array<[number, string]>) it.push(windowDesk(y0, id));
  for (const p of PEOPLE) { if (p.id === 'jaga' || p.id === 'bos' || p.id === 'vet' || p.id === 'kantin' || p.id === 'tamu') continue; it.push(...chair(p.seat.x, p.seat.y, p.seat.face)); }
  it.push(...chair(10.5, 5.3, 'py', '#1e1f23'), ...chair(13.65, 3.2, 'px', '#1e1f23'));
  for (const [x, y, f] of [[6.7, 5.4, 'px'], [8.5, 5.4, 'nx'], [7.6, 6.3, 'ny'], [7.6, 4.5, 'py']] as const) it.push(...chair(x, y, f, '#1e1f23'));
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
  for (const [px, py, s] of [[0.45, 0.45, 1.15], [0.45, 10.55, 1.2], [12.55, 10.5, 1.25], [12.6, 3.7, 0.95], [11.85, 6.35, 0.85]] as const)
    it.push({ x0: px - 0.25, y0: py - 0.25, x1: px + 0.25, y1: py + 0.25, draw: (c, t) => plant(c, px, py, s, t) });
  return it;
}

const moved = (it: Item, dx: number, dy: number): Item => ({
  x0: it.x0 + dx, y0: it.y0 + dy, x1: it.x1 + dx, y1: it.y1 + dy,
  draw: (c, t) => { c.save(); c.translate((dx - dy) * TW, (dx + dy) * TH); it.draw(c, t); c.restore(); },
});
const near = (it: Item, x: number, y: number) => Math.abs(it.x0 - x) < 0.06 && Math.abs(it.y0 - y) < 0.06;
/** the three rooms: 0 = boss office (top), 1 = trading floor (middle), 2 = lobby / pantry / gym / lounge (bottom) */
function furniture(theme = 'modern'): Item[][] {
  const all = baseItems(), R: Item[][] = [[], [], []];
  const take = (x: number, y: number) => all.filter((it) => near(it, x, y));
  // trading floor: trader desks + chairs, Noel's desk, rack, bin, bookshelf, printer, water
  for (const it of all) if (it.x0 >= 0.5 && it.x0 <= 2.6 && it.y0 >= 0.9 && it.y0 <= 10.2 && !(it.x0 > 2.25 && it.y0 < 0.8)) R[1].push(it);
  for (const [x, y] of [[3.15, 0.75], [9.95, 0.15]]) R[1].push(...take(x, y));
  R[1].push(...take(2.3, 0.15).map((it) => moved(it, 5.0, 0)));
  // lobby: security, kitchen, fridge, water, dining table + chairs, lounge, sofa
  for (const [x, y] of [[7.1, 0.1], [12.3, 0.1], [2.3, 0.15], [6.95, 4.8], [4.35, 8.4], [3.33, 7.73], [5.33, 9.23], [9.2, 9.4]]) R[2].push(...take(x, y));
  R[2].push(...all.filter((it) => it.x0 > 6.2 && it.x0 < 9.0 && it.y0 > 3.9 && it.y0 < 6.7 && it.x1 - it.x0 < 0.7));       // its chairs
  R[2].push(...all.filter((it) => it.x0 > 13.3 && it.x0 < 13.5 && it.y0 > 2.85 && it.y0 < 3.05));                             // Pentoel's chair
  // boss office: boss desk + chair, bookshelves, meeting table + chairs, sofa
  R[0].push(...take(9.6, 5.9).map((it) => moved(it, -4.1, -1.3)));
  R[0].push(...all.filter((it) => it.x0 > 10.1 && it.x0 < 10.4 && it.y0 > 4.9 && it.y0 < 5.2).map((it) => moved(it, -4.1, -1.3)));
  // long meeting table (like the Claude-Office one): wooden top on metal legs, grey office chairs along both sides
  R[0].push({ x0: 2.45, y0: 6.2, x1: 3.55, y1: 9.8, draw: (c) => {
    shadow(c, 2.45, 6.2, 1.1, 3.6);
    for (const y of [6.45, 9.45]) { box(c, 2.75, y, 0.5, 0.12, 0, 1.2, '#9aa0a8', '#7d838c', '#8b9199'); box(c, 2.96, y + 0.02, 0.08, 0.08, 1.2, 13, '#b8bec6', '#9aa0a8', '#a9afb7'); }
    box(c, 2.45, 6.2, 1.1, 3.6, 14.2, 1.8, '#7a4a2e', '#5c3622', '#6b3f27');
    poly(c, [iso(2.55, 6.3, 16.05), iso(3.45, 6.3, 16.05), iso(3.45, 9.7, 16.05), iso(2.55, 9.7, 16.05)], '#8a5636');
    poly(c, [iso(2.6, 6.5, 16.1), iso(2.75, 6.5, 16.1), iso(2.75, 9.5, 16.1), iso(2.6, 9.5, 16.1)], 'rgba(255,255,255,.12)');
    for (const y of [7.1, 8.0, 8.9]) { box(c, 2.62, y, 0.3, 0.22, 16, 0.4, '#f4f4f2'); box(c, 3.1, y + 0.1, 0.22, 0.16, 16, 0.6, '#2a2b30'); }
    cyl(c, 3.3, 6.6, 16, 0.07, 2.4, '#ffffff', '#eeeeee'); cyl(c, 2.7, 9.3, 16, 0.07, 2.4, '#ffffff', '#eeeeee');
  } });
  for (const y of [6.7, 7.6, 8.5, 9.4]) { R[0].push(...chair(2.0, y, 'px', '#55585f'), ...chair(4.0, y, 'nx', '#55585f')); }
  R[0].push(...take(9.2, 9.4));
  const pl = (r: number, list: Array<[number, number, number]>) => { for (const [px, py, sc] of list) R[r].push({ x0: px - 0.25, y0: py - 0.25, x1: px + 0.25, y1: py + 0.25, draw: (c, t) => plant(c, px, py, sc, t) }); };
  // lobby: ping-pong table, the cat's bowl, the fingerprint clock-in machine by the lift
  R[2].push({ x0: 2.4, y0: 6.4, x1: 4.2, y1: 7.3, draw: (c) => {
    shadow(c, 2.4, 6.4, 1.8, 0.9);
    for (const [x, y] of [[2.5, 6.5], [4.05, 6.5], [2.5, 7.15], [4.05, 7.15]]) box(c, x, y, 0.07, 0.07, 0, 11, '#1e1f23');
    box(c, 2.4, 6.4, 1.8, 0.9, 11, 1.2, '#1f6b4f', '#17543d', '#1b5f46');
    poly(c, [iso(2.45, 6.84, 12.25), iso(4.15, 6.84, 12.25), iso(4.15, 6.86, 12.25), iso(2.45, 6.86, 12.25)], '#ffffff');
    poly(c, [iso(3.29, 6.4, 12.2), iso(3.31, 6.4, 12.2), iso(3.31, 7.3, 12.2), iso(3.29, 7.3, 12.2)], 'rgba(255,255,255,.7)');
    poly(c, [iso(3.3, 6.35, 12.2), iso(3.3, 7.35, 12.2), iso(3.3, 7.35, 15), iso(3.3, 6.35, 15)], 'rgba(240,240,240,.55)');
  } });
  R[2].push({ x0: 5.75, y0: 0.95, x1: 5.95, y1: 1.15, draw: (c) => { ell(c, 5.85, 1.05, 0, 0.16, 'rgba(0,0,0,.12)'); cyl(c, 5.85, 1.05, 0, 0.13, 1.4, '#e5484d', '#c0392b'); ell(c, 5.85, 1.05, 1.4, 0.09, '#8a5a34'); } });
  R[2].push({ x0: 10.75, y0: 0.3, x1: 10.95, y1: 0.5, draw: (c) => {
    box(c, 10.78, 0.33, 0.14, 0.14, 0, 13, '#2a2b30'); box(c, 10.72, 0.3, 0.26, 0.2, 13, 5, '#33343a', '#26272c', '#2d2e34');
    poly(c, [iso(10.76, 0.505, 14.5), iso(10.94, 0.505, 14.5), iso(10.94, 0.505, 17), iso(10.76, 0.505, 17)], '#2ee59d');
  } });
  /* --- new pieces --- */
  R[0].push(...chair(2.2, 3.4, 'px', '#c9a227'));
  R[0].push({ x0: 2.0, y0: 2.45, x1: 2.45, y1: 2.9, draw: (c) => { ell(c, 2.22, 2.68, 0, 0.25, 'rgba(0,0,0,.14)'); cyl(c, 2.22, 2.68, 0, 0.05, 10, '#1e1f23', '#2b2c31'); cyl(c, 2.22, 2.68, 10, 0.24, 1.5, '#f2c230', '#c9a227'); cyl(c, 2.15, 2.62, 11.5, 0.05, 2.5, '#ffffff', '#eeeeee'); } });
  // boss office: safe with gold, trophy cabinet, putting green flag
  R[0].push({ x0: 8.0, y0: 0.15, x1: 8.75, y1: 0.85, draw: (c, t) => {
    shadow(c, 8.0, 0.15, 0.75, 0.7); box(c, 8.0, 0.15, 0.75, 0.7, 0, 24, '#2a2b30', '#1e1f23', '#33343a');
    const [hx, hy] = iso(8.4, 0.85, 13); c.strokeStyle = '#f2c230'; c.lineWidth = 1.2; c.beginPath(); c.arc(hx, hy, 2.6, 0, 7); c.stroke();
    if (BUSY.safe) { poly(c, [iso(8.0, 0.85, 22), iso(8.0, 1.45, 22), iso(8.0, 1.45, 2), iso(8.0, 0.85, 2)], '#3a3b42'); for (let k = 0; k < 3; k++) box(c, 8.1, 0.3 + k * 0.15, 0.5, 0.12, 3 + (k % 2) * 2.2, 2, '#f2c230'); }
    void t;
  } });
  R[0].push({ x0: 9.1, y0: 0.15, x1: 10.3, y1: 0.6, draw: (c) => {
    shadow(c, 9.1, 0.15, 1.2, 0.45); box(c, 9.1, 0.15, 1.2, 0.45, 0, 38, '#26272c', '#1e1f23', '#2d2e34');
    poly(c, [iso(9.16, 0.6, 35), iso(10.24, 0.6, 35), iso(10.24, 0.6, 4), iso(9.16, 0.6, 4)], 'rgba(170,210,240,.35)');
    for (const [x, z] of [[9.4, 22], [9.8, 22], [9.6, 8], [10.0, 8]]) { cyl(c, x, 0.38, z, 0.07, 6, '#f2c230', '#d9a91c'); ell(c, x, 0.38, z + 6, 0.11, '#f2c230'); }
  } });
  R[0].push({ x0: 11.85, y0: 5.25, x1: 11.95, y1: 5.35, draw: (c, t) => {
    const [a0, a1] = iso(11.9, 5.3, 0), [b0, b1] = iso(11.9, 5.3, 20); c.strokeStyle = '#e9e9e7'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(a0, a1); c.lineTo(b0, b1); c.stroke();
    const wv = Math.sin(t * 3) * 1; c.fillStyle = '#e5484d'; c.beginPath(); c.moveTo(b0, b1); c.lineTo(b0 + 7, b1 + 2 + wv); c.lineTo(b0, b1 + 4.5); c.closePath(); c.fill();
  } });
  // trading floor: shared hot desk with laptops, whiteboard
  R[1].push({ x0: 6.45, y0: 4.65, x1: 8.55, y1: 5.55, draw: (c) => {
    shadow(c, 6.45, 4.65, 2.1, 0.9);
    for (const [x, y] of [[6.5, 4.7], [8.4, 4.7], [6.5, 5.4], [8.4, 5.4]]) box(c, x, y, 0.1, 0.1, 0, 14, '#1e1f23');
    box(c, 6.45, 4.65, 2.1, 0.9, 14, 2, '#f7f7f5', '#d6d5d1', '#e7e6e2');
    for (const [x, y, f] of [[6.75, 4.75, 0], [7.95, 4.75, 0], [6.75, 5.2, 1], [7.95, 5.2, 1]] as const) {
      box(c, x, y, 0.45, 0.3, 16, 0.6, '#c9cbd1');
      if (f) box(c, x, y, 0.45, 0.04, 16.6, 6, '#2a2b30', '#9fd3f2', '#2a2b30'); else box(c, x, y + 0.26, 0.45, 0.04, 16.6, 6, '#2a2b30', '#3a3b42', '#2a2b30');
    }
    cyl(c, 7.5, 5.1, 16, 0.06, 2.5, '#ffffff', '#eeeeee');
  } });
  // lobby gym: treadmill + dumbbell rack
  R[2].push({ x0: 0.55, y0: 1.0, x1: 1.45, y1: 2.8, draw: (c, t) => {
    shadow(c, 0.55, 1.0, 0.9, 1.8);
    box(c, 0.6, 1.05, 0.8, 1.7, 0, 4, '#2a2b30', '#1e1f23', '#33343a');
    poly(c, [iso(0.68, 1.15, 4.1), iso(1.32, 1.15, 4.1), iso(1.32, 2.65, 4.1), iso(0.68, 2.65, 4.1)], '#141518');
    if (BUSY.tread) for (let k = 0; k < 6; k++) { const yy = 1.2 + ((k / 6 + t * 0.9) % 1) * 1.4; poly(c, [iso(0.7, yy, 4.2), iso(1.3, yy, 4.2), iso(1.3, yy + 0.03, 4.2), iso(0.7, yy + 0.03, 4.2)], '#3a3b42'); }
    for (const y of [1.08, 2.62]) box(c, 0.6, y, 0.06, 0.06, 4, 18, '#3a3b42');
    box(c, 0.56, 1.0, 0.18, 1.8, 22, 3, '#2a2b30', '#1e1f23', '#33343a');
    const [dx, dy] = iso(0.66, 1.9, 25.5); c.fillStyle = BUSY.tread ? '#2ee59d' : '#1d4d3a'; c.fillRect(dx - 2, dy - 1, 4, 1.6);
  } });
  R[2].push({ x0: 0.55, y0: 5.4, x1: 1.0, y1: 6.4, draw: (c) => {
    shadow(c, 0.55, 5.4, 0.45, 1.0); box(c, 0.6, 5.45, 0.35, 0.9, 0, 12, '#26272c', '#1e1f23', '#2d2e34');
    for (let k = 0; k < 4; k++) for (const z of [12.2, 6]) { const y = 5.55 + k * 0.2; cyl(c, 0.78, y, z, 0.07, 2, '#3a3b42', '#2b2c31'); }
  } });
  /* --- the wider floors (15 × 12): new pieces in the extra space --- */
  // boss office: a big aquarium on the back wall, an armchair by the window side
  R[0].push({ x0: 12.75, y0: 0.1, x1: 14.6, y1: 0.7, draw: (c, t) => {
    shadow(c, 12.75, 0.1, 1.85, 0.6); box(c, 12.75, 0.1, 1.85, 0.6, 0, 14, '#3a2a1e', '#2b1f16', '#4a3626');
    box(c, 12.78, 0.13, 1.79, 0.54, 14, 26, 'rgba(120,200,235,.35)', 'rgba(70,160,210,.55)', 'rgba(90,180,225,.5)');
    poly(c, [iso(12.8, 0.67, 15), iso(14.55, 0.67, 15), iso(14.55, 0.67, 17.5), iso(12.8, 0.67, 17.5)], '#d9c9a0');
    for (let k = 0; k < 4; k++) { const [wx, wy] = iso(13.0 + k * 0.45, 0.62, 18); c.strokeStyle = '#2f9a4f'; c.lineWidth = 1; c.beginPath(); c.moveTo(wx, wy); c.quadraticCurveTo(wx + Math.sin(t * 1.5 + k) * 2, wy - 6, wx + Math.sin(t + k) * 1.5, wy - 11 - k % 2 * 4); c.stroke(); }
    const fish: Array<[string, number]> = [['#ff8c2a', 0], ['#f2c230', 1.7], ['#e5484d', 3.1], ['#4c7dff', 4.4]];
    for (const [col, ph] of fish) { const u = (Math.sin(t * 0.45 + ph) + 1) / 2, dir = Math.cos(t * 0.45 + ph) > 0 ? 1 : -1; const [fx, fy] = iso(12.95 + u * 1.5, 0.62, 24 + ph * 3 + Math.sin(t * 1.3 + ph) * 1.5); c.fillStyle = col; c.beginPath(); c.ellipse(fx, fy, 2.2, 1.2, 0.46, 0, 7); c.fill(); c.beginPath(); c.moveTo(fx - dir * 2, fy - dir); c.lineTo(fx - dir * 3.6, fy - dir * 2.4); c.lineTo(fx - dir * 3.4, fy + 0.6); c.closePath(); c.fill(); }
    for (let k = 0; k < 3; k++) { const ph = (t * 0.4 + k / 3) % 1, [bx, by] = iso(14.3, 0.6, 17 + ph * 22); c.fillStyle = 'rgba(255,255,255,.6)'; c.beginPath(); c.arc(bx, by, 0.7, 0, 7); c.fill(); }
    box(c, 12.75, 0.1, 1.85, 0.6, 40, 2, '#3a2a1e', '#2b1f16', '#4a3626');
  } });
  R[0].push({ x0: 13.7, y0: 5.75, x1: 14.5, y1: 6.65, draw: (c) => armchair(c, 13.6, 6.2, '#8e2c48', '#6e2038') });
  R[0].push({ x0: 12.55, y0: 5.95, x1: 13.0, y1: 6.4, draw: (c, t) => { ell(c, 12.78, 6.18, 0, 0.25, 'rgba(0,0,0,.14)'); cyl(c, 12.78, 6.18, 0, 0.05, 10, '#1e1f23', '#2b2c31'); cyl(c, 12.78, 6.18, 10, 0.26, 1.5, '#3a2a1e', '#2b1f16'); cyl(c, 12.78, 6.18, 11.5, 0.07, 3, '#ffffff', '#eeeeee'); void t; } });
  // indoor trees in big pots (boss office + trading floor)
  const bigTree = (r: number, x: number, y: number) => R[r].push({ x0: x - 0.4, y0: y - 0.4, x1: x + 0.4, y1: y + 0.4, draw: (c, t) => {
    ell(c, x, y, 0, 0.5, 'rgba(0,0,0,.16)'); cyl(c, x, y, 0, 0.38, 9, THEME.paint ? '#c99a68' : '#e9e9e7', THEME.paint ? '#8f6a48' : '#c9c8c4'); ell(c, x, y, 9, 0.32, '#4a3a2c');
    const [bx, by] = iso(x, y, 9); c.fillStyle = '#6b4a33'; c.fillRect(bx - 1.3, by - 26, 2.6, 26);
    const sw = Math.sin(t * 0.8 + x) * 0.5;
    for (const [dx, dy, rr, col] of [[0, -32, 11, '#2f7a3d'], [-9, -26, 8, '#3d9a4f'], [9, -27, 8, '#3d9a4f'], [-4, -40, 8, '#58b765'], [5, -38, 7, '#58b765'], [0, -46, 6, '#7fcf7a']] as Array<[number, number, number, string]>) { c.fillStyle = col; c.beginPath(); c.arc(bx + dx + sw * (-dy / 40), by + dy, rr, 0, 7); c.fill(); }
  } });
  void bigTree;      // no trees inside the rooms (owner's choice)
  // trading floor: a drinks vending machine, and a rest corner (sofa + rug)
  R[2].push(moved({ x0: 12.75, y0: 0.1, x1: 13.65, y1: 0.75, draw: (c, t) => {
    shadow(c, 12.75, 0.1, 0.9, 0.65); box(c, 12.75, 0.1, 0.9, 0.65, 0, 50, '#e5484d', '#b8343a', '#cf3e44');
    poly(c, [iso(12.85, 0.75, 46), iso(13.35, 0.75, 46), iso(13.35, 0.75, 14), iso(12.85, 0.75, 14)], 'rgba(20,30,40,.85)');
    for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) { const [bx, by] = iso(12.92 + k * 0.15, 0.75, 18 + r * 7.5); c.fillStyle = ['#2ee59d', '#f2c230', '#5ec2f2', '#ffffff'][(r + k) % 4]; c.fillRect(bx, by - 4, 2, 4); }
    poly(c, [iso(13.42, 0.75, 40), iso(13.58, 0.75, 40), iso(13.58, 0.75, 30), iso(13.42, 0.75, 30)], '#1e1f23');
    const [lx, ly] = iso(13.5, 0.75, 27); c.fillStyle = Math.floor(t * 1.2) % 2 ? '#2ee59d' : '#1d4d3a'; c.fillRect(lx - 0.6, ly, 1.2, 1.2);
    poly(c, [iso(12.85, 0.75, 9), iso(13.35, 0.75, 9), iso(13.35, 0.75, 5), iso(12.85, 0.75, 5)], '#141518');
  } }, -9.75, 0));
  R[1].push({ x0: 12.2, y0: 8.6, x1: 12.3, y1: 8.7, draw: (c) => { poly(c, [iso(12.2, 8.6, 0.2), iso(14.6, 8.6, 0.2), iso(14.6, 11.0, 0.2), iso(12.2, 11.0, 0.2)], THEME.paint ? '#c9a46a' : '#4a5568'); } });
  R[1].push(...take(9.2, 9.4).map((it) => moved(it, 3.3, 0.6)));
  R[1].push({ x0: 13.2, y0: 9.0, x1: 13.9, y1: 9.5, draw: (c) => { box(c, 13.2, 9.0, 0.7, 0.45, 0, 6, '#3a2a1e', '#2b1f16', '#4a3626'); cyl(c, 13.4, 9.2, 6, 0.06, 2.5, '#ffffff', '#eeeeee'); } });
  // lobby: an arcade cabinet, a massage chair, a waiting bench by the entrance
  R[2].push(moved({ x0: 13.2, y0: 0.1, x1: 13.9, y1: 0.8, draw: (c, t) => {
    shadow(c, 13.2, 0.1, 0.7, 0.7); box(c, 13.2, 0.1, 0.7, 0.7, 0, 46, '#4c3dff', '#3a2fc4', '#4536e0');
    poly(c, [iso(13.28, 0.8, 42), iso(13.82, 0.8, 42), iso(13.82, 0.8, 26), iso(13.28, 0.8, 26)], '#0b1220');
    const busy = BUSY.arcade; for (let k = 0; k < 5; k++) { const [px, py] = iso(13.33 + ((k * 0.11 + (busy ? t * 0.3 : 0)) % 0.45), 0.8, 29 + k * 2.6); c.fillStyle = ['#ff5a5a', '#f2c230', '#2ee59d', '#5ec2f2', '#c792ea'][k]; c.fillRect(px, py, 1.6, 1.2); }
    box(c, 13.25, 0.8, 0.6, 0.18, 20, 3, '#2a2b30'); const [jx, jy] = iso(13.4, 0.9, 23); c.fillStyle = '#e5484d'; c.beginPath(); c.arc(jx, jy - 2, 1.2, 0, 7); c.fill();
    poly(c, [iso(13.28, 0.8, 48), iso(13.82, 0.8, 48), iso(13.82, 0.8, 44), iso(13.28, 0.8, 44)], '#f2c230');
  } }, -1.9, 0));
  // Pentoel's security desk beside the exit door (CCTV monitors face him, so we see their backs)
  R[2].push({ x0: 14.15, y0: 2.45, x1: 14.8, y1: 4.05, draw: (c) => {
    shadow(c, 14.15, 2.45, 0.65, 1.6); box(c, 14.15, 2.45, 0.65, 1.6, 0, 15, '#26272c', '#1e1f23', '#2d2e34');
    box(c, 14.1, 2.4, 0.75, 1.7, 15, 2, '#f4f4f2', '#d4d3cf', '#e6e5e1');
    for (const ya of [2.6, 3.3]) { box(c, 14.5, ya + 0.25, 0.1, 0.1, 17, 3, '#1e1f23'); box(c, 14.42, ya, 0.07, 0.6, 20, 10, '#2a2b30', '#33343a', '#2a2b30'); }
    poly(c, [iso(14.15, 4.05, 9), iso(14.8, 4.05, 9), iso(14.8, 4.05, 11), iso(14.15, 4.05, 11)], '#f2c230');
  } });
  R[2].push({ x0: 13.95, y0: 4.75, x1: 14.6, y1: 5.65, draw: (c) => armchair(c, 13.9, 5.2, '#2a2b30', '#1e1f23', true) });
  R[2].push({ x0: 10.3, y0: 11.25, x1: 11.7, y1: 11.6, draw: (c) => {
    shadow(c, 10.3, 11.25, 1.4, 0.35); for (const x of [10.35, 11.55]) box(c, x, 11.3, 0.08, 0.25, 0, 7, '#1e1f23');
    box(c, 10.3, 11.25, 1.4, 0.38, 7, 1.6, THEME.paint ? '#c99a68' : '#8b8f99', THEME.paint ? '#8f6a48' : '#6b6f78', THEME.paint ? '#a87b52' : '#7b7f88');
    box(c, 10.3, 11.55, 1.4, 0.07, 8.6, 9, THEME.paint ? '#c99a68' : '#8b8f99', THEME.paint ? '#8f6a48' : '#6b6f78', THEME.paint ? '#a87b52' : '#7b7f88');
  } });
  if (theme === 'hangat' || theme === 'lukis') {
    // glass partitions (blocking, with a door gap)
    const glassX = (r: number, x: number, ya: number, yb: number) => R[r].push({ x0: x - 0.06, y0: ya, x1: x + 0.12, y1: yb, draw: (c) => {
      poly(c, [iso(x + 0.03, ya, 0), iso(x + 0.03, yb, 0), iso(x + 0.03, yb, 36), iso(x + 0.03, ya, 36)], 'rgba(185,225,245,.28)');
      c.strokeStyle = '#1e1f23'; c.lineWidth = 0.8; for (const z of [0.5, 36]) { const a = iso(x + 0.03, ya, z), b = iso(x + 0.03, yb, z); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
      for (let y = ya; y <= yb + 0.01; y += Math.max(0.6, (yb - ya) / Math.max(1, Math.round((yb - ya) / 1.2)))) { const a = iso(x + 0.03, y, 0), b = iso(x + 0.03, y, 36); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
      const g = iso(x + 0.03, ya + 0.2, 30), h = iso(x + 0.03, ya + 0.9, 8); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(g[0], g[1]); c.lineTo(h[0], h[1]); c.stroke();
    } });
    const glassY = (r: number, y: number, xa: number, xb: number) => R[r].push({ x0: xa, y0: y - 0.06, x1: xb, y1: y + 0.12, draw: (c) => {
      poly(c, [iso(xa, y + 0.03, 0), iso(xb, y + 0.03, 0), iso(xb, y + 0.03, 36), iso(xa, y + 0.03, 36)], 'rgba(185,225,245,.28)');
      c.strokeStyle = '#1e1f23'; c.lineWidth = 0.8; for (const z of [0.5, 36]) { const a = iso(xa, y + 0.03, z), b = iso(xb, y + 0.03, z); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
      for (let x = xa; x <= xb + 0.01; x += Math.max(0.6, (xb - xa) / Math.max(1, Math.round((xb - xa) / 1.2)))) { const a = iso(x, y + 0.03, 0), b = iso(x, y + 0.03, 36); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
      const g = iso(xa + 0.2, y + 0.03, 30), h = iso(xa + 0.9, y + 0.03, 8); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(g[0], g[1]); c.lineTo(h[0], h[1]); c.stroke();
    } });
    // lobby: a big tree in a round wooden planter, and tribune stairs with cushions
  }
  return R;
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
  room: number; pending: Spot | null; hiddenUntil: number; fx?: number; sit?: number; lt?: number; fidget?: number; arms?: Record<string, [number, number]>;
  x: number; y: number; vx: number; vy: number; face: Face; path: Array<[number, number]>; act: Spot; until: number; dist: number; speed: number;
  carry: Prop | null; carryUntil: number; patrol: number; last: string; run: boolean;
  scoldUntil: number; scoldBy: string; bubble: { text: string; until: number; color: string } | null; chase: number; celebrated: string; angryAt: number;
  queue?: Array<{ act: Spot; dwell: number }>; kick?: boolean; talkAt?: number;
  ride?: Ride;      // riding the glass lift
}
/** two-bone limb (thigh + shin, upper arm + forearm): finds the joint so both bones keep their length */
function limb(c: C, x0: number, y0: number, x1: number, y1: number, l1: number, l2: number, bend: number, w: number, col: string, col2?: string) {
  let dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
  const max = l1 + l2 - 0.02;
  if (d > max) { dx *= max / d; dy *= max / d; x1 = x0 + dx; y1 = y0 + dy; d = max; }
  if (d < 0.01) d = 0.01;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const jx = x0 + (dx * a) / d - (dy * h * bend) / d, jy = y0 + (dy * a) / d + (dx * h * bend) / d;
  if (INK) {         // tapered limb: thick at the hip / shoulder, thinner at the knee / elbow, thinnest at the ankle / wrist
    const seg = (ax: number, ay: number, bx: number, by: number, wa: number, wb: number, fill: string) => {
      const L = Math.hypot(bx - ax, by - ay) || 0.01, nx = -(by - ay) / L, ny = (bx - ax) / L;
      c.beginPath(); c.moveTo(ax + nx * wa / 2, ay + ny * wa / 2); c.lineTo(bx + nx * wb / 2, by + ny * wb / 2); c.lineTo(bx - nx * wb / 2, by - ny * wb / 2); c.lineTo(ax - nx * wa / 2, ay - ny * wa / 2); c.closePath(); c.fillStyle = fill; c.fill();
      c.beginPath(); c.arc(ax, ay, wa / 2, 0, 7); c.arc(bx, by, wb / 2, 0, 7); c.fill();
    };
    const w1 = w * 1.08, wk = w * 0.82, w2 = w * 0.62, o = 0.75, ink = OL;
    seg(x0, y0, jx, jy, w1 + o, wk + o, ink); seg(jx, jy, x1, y1, wk + o, w2 + o, ink);
    seg(x0, y0, jx, jy, w1, wk, col); seg(jx, jy, x1, y1, wk, w2, col2 ?? col);
    c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 0.35; c.beginPath(); c.moveTo(jx - 0.3, jy - 0.2); c.lineTo(jx + 0.3, jy + 0.2); c.stroke();
    return [x1, y1] as const;
  }
  c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
  if (INK) { c.lineWidth = w + 0.7; c.strokeStyle = OL; c.beginPath(); c.moveTo(x0, y0); c.lineTo(jx, jy); c.lineTo(x1, y1); c.stroke(); c.lineWidth = w; }
  c.strokeStyle = col; c.beginPath(); c.moveTo(x0, y0); c.lineTo(jx, jy); c.stroke();
  c.strokeStyle = col2 ?? col; c.beginPath(); c.moveTo(jx, jy); c.lineTo(x1, y1); c.stroke();
  return [x1, y1] as const;
}
const faceTo = (dx: number, dy: number): Face => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'px' : 'nx') : (dy > 0 ? 'py' : 'ny'));

/** the face of the moment, from real data and what the person is doing */
type Expr = 'senang' | 'ketawa' | 'sedih' | 'cemas' | 'fokus' | 'kaget' | 'ngantuk' | 'ngomong' | 'cinta' | 'bingung' | 'malu' | 'kesal' | 'biasa';
function exprOf(p: Person, a: Agent, st: Status, t: number): Expr {
  const L = a.act.label ?? '', walking = a.path.length > 0;
  if (a.act.pose === 'jump' || /SELEBRASI|BONUS|GAJIAN|ULTAH|TIUP LILIN|FOTO/.test(L) || st.tp) return 'ketawa';
  if (/DIMARAHI|SL!/.test(L) || st.sl) return 'sedih';
  if (/LIHAT TV|ALARM|KAGET/.test(L) || (EV.cur?.kind === 'pasar' && L === 'LIHAT TV')) return 'kaget';
  if (/NGANTUK|TIDUR SIANG|REBAHAN/.test(L)) return 'ngantuk';
  if (/KUCING|PIZZA|KUE|MAKAN|KOPI|DRAKOR/.test(L) && !/BIKIN/.test(L)) return Math.sin(t * 0.5 + hash(p.id) * 4) > 0.3 ? 'cinta' : 'senang';
  if (/SALAMAN|DIPUJI|TERIMA KASIH/.test(L)) return 'malu';
  if (/ANTRI|TUNGGU LIFT|NUNGGU/.test(L)) return Math.sin(t * 0.4 + hash(p.id) * 6) > 0 ? 'kesal' : 'biasa';
  if (/DEBAT|TEBAK|BACA BERITA|ANALISA/.test(L) && Math.sin(t * 0.6 + hash(p.id) * 3) > 0.4) return 'bingung';
  if (a.bubble && Date.now() < a.bubble.until) return 'ngomong';
  if (/GOSIP|NGOBROL|KARAOKE|PIZZA|MAIN|NGOPI|BIKIN KOPI|ELUS KUCING|NONTON/.test(L)) return Math.sin(t * 0.7 + hash(p.id) * 9) > 0.2 ? 'ketawa' : 'senang';
  if (!walking && a.act.id.startsWith('seat-') && st.tag) {
    const neg = /−|-\$/.test(st.tag.text) || st.tag.color === '#ff6b6b' || st.tag.color === '#e5242b';
    return neg ? 'cemas' : 'senang';
  }
  if (/MEMANTAU|ANALISA|CHART|POSISI|CEK CCTV|CATAT|LAPORAN|NGITUNG/.test(L) || st.label.startsWith('POSISI')) return 'fokus';
  return 'biasa';
}
function drawPerson(c: C, p: Person, a: Agent, t: number, st: Status, whipT: number | null) {
  const walking = a.path.length > 0;
  const [sx, sy] = iso(a.x, a.y);
  const shaking = Date.now() < a.scoldUntil;
  const face: Face = walking || shaking || whipT != null ? a.face : a.act.face;
  let pose: Pose = walking ? 'stand' : st.sleep && a.act.id.startsWith('seat-') ? 'sleep' : a.act.pose;
  if (pose === 'run') pose = 'stand';
  if (shaking && (pose === 'bean' || pose === 'nap' || pose === 'squat' || pose === 'stretch' || pose === 'jump')) pose = 'stand';
  const front = face === 'px' || face === 'py', flip = face === 'py' || face === 'nx';
  const spd = Math.hypot(a.vx, a.vy), amp = Math.min(1, spd / 1.3);
  const running = !walking && a.act.pose === 'run';
  const anim = walking || running, ph = running ? t * 13 : a.dist * 8, am = running ? 1.3 : amp;
  const swing = anim ? Math.sin(ph) * am : 0, bob = anim ? Math.abs(Math.cos(ph)) * 1.2 * am : 0;
  const breathe = Math.sin(t * 2 + hash(p.id) * 6) * 0.35;
  const typing = !walking && pose === 'sit' && a.act.id.startsWith('seat-') && !st.sleep && !shaking;
  const sitting = pose === 'sit' || pose === 'sleep' || pose === 'nap', bean = pose === 'bean';
  const jump = pose === 'jump' ? Math.abs(Math.sin(t * 6)) * 5 : 0;
  const squat = pose === 'squat' ? (1 + Math.sin(t * 3.2)) * 1.6 : 0;
  const prop = !walking ? a.act.prop : a.carry;
  const drama = p.id === 'vet' && !walking && prop === 'tablet', mood = vetMood(t), eatSit = !walking && prop === 'food' && (a.act.pose === 'sit');
  // smoothing: turning (the body squashes through the turn instead of flipping), sitting down / standing up
  const dtp = Math.min(0.05, Math.max(0, t - (a.lt ?? t))); a.lt = t;
  a.fx = (a.fx ?? (flip ? -1 : 1)) + ((flip ? -1 : 1) - (a.fx ?? (flip ? -1 : 1))) * Math.min(1, dtp * 13);
  const seatedNow = pose === 'sit' || pose === 'sleep' || pose === 'nap' || pose === 'bean';
  a.sit = (a.sit ?? (seatedNow ? 1 : 0)) + ((seatedNow ? 1 : 0) - (a.sit ?? (seatedNow ? 1 : 0))) * Math.min(1, dtp * 6);
  const fxs = Math.abs(a.fx) < 0.18 ? (a.fx < 0 ? -0.18 : 0.18) : a.fx;
  // idle life: shifting weight, a look around every few seconds
  const idle = !anim && pose === 'stand' && !shaking && whipT == null;
  const sway = idle ? Math.sin(t * 0.9 + hash(p.id) * 7) * 0.45 : 0;
  const lookT = (t * 0.22 + hash(p.id + 'l')) % 1, look2 = idle && lookT < 0.18 ? Math.sin((lookT / 0.18) * Math.PI) * 1.3 * (hash(p.id + Math.floor(t * 0.22)) > 0.5 ? 1 : -1) : 0;
  c.save(); c.translate(sx + (shaking ? Math.sin(t * 60) * 0.5 : 0) + (drama && mood === 'KETAWA' ? Math.sin(t * 30) * 0.35 : 0), sy); c.scale(PSV, PSV); c.scale(fxs, 1);
  if (!sitting && !bean) {
    const sg = c.createRadialGradient(0, 0, 0.5, 0, 0, 7); sg.addColorStop(0, 'rgba(0,0,0,.3)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    c.save(); c.scale(1, 0.42); c.fillStyle = sg; c.beginPath(); c.arc(0, 0, 7 - jump * 0.4, 0, 7); c.fill(); c.restore();
  }
  c.translate(0, -jump);
  const LEG = INK ? 3.7 : 3.3, standHip = (INK ? -8.4 : -6.9) - bob * 0.8 + squat, seatHip = (bean ? -4.56 : -8.2) / PSV;
  const hip = seatedNow ? standHip + (seatHip - standHip) * a.sit : seatHip + (standHip - seatHip) * (1 - a.sit), torso = INK ? 8.8 : 8.4;
  const shoe = '#26272c', pantsD = sh(p.pants, 0.8), shirtD = sh(p.shirt, 0.82);
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (sitting || bean) {
    const fx = (front ? 4.5 : 3.5) + (INK ? 1.2 : 0);
    if (INK) { c.strokeStyle = OL; c.lineWidth = 3.5; for (const o of [-1.4, 1.4]) { c.beginPath(); c.moveTo(o, hip); c.lineTo(fx + o * 0.4, hip + (bean ? 0.5 : 1)); c.lineTo(fx + 1 + o * 0.4, bean ? hip + 2.5 : 0); c.stroke(); } }
    c.strokeStyle = p.pants; c.lineWidth = 2.8;
    for (const o of [-1.4, 1.4]) { c.beginPath(); c.moveTo(o, hip); c.lineTo(fx + o * 0.4, hip + (bean ? 0.5 : 1)); c.lineTo(fx + 1 + o * 0.4, bean ? hip + 2.5 : 0); c.stroke(); }
    c.fillStyle = shoe; for (const o of [-1.4, 1.4]) { c.beginPath(); c.ellipse(fx + 1.8 + o * 0.4, bean ? hip + 3 : -0.5, 1.9, 1.1, 0, 0, 7); c.fill(); if (INK) { c.strokeStyle = OL; c.lineWidth = 0.45; c.stroke(); } }
  } else {
    for (const [o, k] of [[-1.5, 0], [1.5, Math.PI]] as const) {
      const f = ph + k, stride = 2.7 * am;
      const footX = o * (INK ? 1.0 : 0.9) + (anim ? -Math.cos(f) * stride : 0) + sway * 0.3;
      const lift = anim ? Math.max(0, Math.sin(f)) * (INK ? 3.0 : 2.4) * am : 0;
      const footY = -1.1 - lift;
      const hx0 = o + sway * 0.6, col = o < 0 ? pantsD : p.pants;
      limb(c, hx0, hip, footX, footY, LEG, LEG, squat ? 1 : 0.9, INK ? 3.0 : 2.8, col);
      // shoe: toes point down while the foot swings forward, heel strikes first
      const pitch = anim ? (Math.sin(f) > 0 ? -0.35 * Math.cos(f) : 0) : 0;
      c.save(); c.translate(footX + (front ? 0.7 : -0.2), footY + 0.5); c.rotate(pitch); c.fillStyle = shoe; c.beginPath(); c.ellipse(0, 0, 2.0, 1.15, 0, 0, 7); c.fill(); if (INK) { c.strokeStyle = OL; c.lineWidth = 0.45; c.stroke(); } c.restore();
    }
  }
  const gT = (t + hash(p.id + 'g') * 40) % 26;
  const gesture = typing && !drama ? (gT < 2.4 ? 'stretch' : gT > 12 && gT < 13.8 ? 'sip' : gT > 19 && gT < 21.6 ? 'chin' : null)
    : idle && !prop && pose === 'stand' ? (gT < 4 ? 'hips' : gT > 10 && gT < 14 ? 'cross' : gT > 18 && gT < 19.8 ? 'scratch' : null) : null;
  const lean = (anim ? 0.7 * am : 0) + sway * 0.5 + (typing && gesture !== 'stretch' ? 0.45 : 0), twist = anim ? Math.sin(ph) * 0.5 * am : 0;
  const hy = hip - torso - 5.6 + breathe * 0.5 + (typing ? Math.sin(t * 1.7 + hash(p.id) * 9) * 0.22 : 0) + (gesture === 'stretch' ? -0.6 : 0) + (pose === 'sleep' ? 3.5 : pose === 'nap' ? 1.5 : 0) + (prop === 'hp' && !walking ? 0.6 : 0);
  const hx = (pose === 'sleep' ? 2.5 : pose === 'nap' ? -1.5 : 0) + lean * 1.2 + look2 + (anim ? Math.cos(ph - 0.6) * 0.25 * am : 0);
  const R = 6.2;
  const big = p.id === 'vet', HS = INK ? (big ? 1.5 : 1.3) : big ? 1.6 : 1.2, NECK = INK ? 0.5 : 0;     // head scale (Ny. Vetrycia keeps her big head)
  const headOn = () => { c.save(); c.translate(hx, hy + 5 - NECK); c.scale(HS, HS); c.translate(-hx, -(hy + 5)); };
  if (p.style === 'long') { headOn(); c.fillStyle = sh(p.hair, 0.9); c.beginPath(); if (INK) { c.moveTo(hx - 5.9, hy - 1.2); c.bezierCurveTo(hx - 7.2, hy + 9, hx - 4.2, hy + 10.5, hx, hy + 10.5); c.bezierCurveTo(hx + 4.2, hy + 10.5, hx + 7.2, hy + 9, hx + 5.9, hy - 1.2); c.closePath(); } else c.roundRect(hx - 6.2, hy - 1, 12.4, front ? 9.5 : 12, 3); c.fill(); if (INK) { c.strokeStyle = OL; c.lineWidth = 0.5; c.stroke(); } c.restore(); }
  const ty = hip - torso + breathe * 0.3;
  const tg = c.createLinearGradient(-4.6, 0, 4.6, 0); tg.addColorStop(0, sh(p.shirt, front ? 1.08 : 0.9)); tg.addColorStop(1, shirtD);
  if (!INK) { c.fillStyle = tg; c.beginPath(); c.roundRect(-4.6 + lean * 0.5, ty, 9.2, torso + 0.6, [3.2, 3.2, 1.6, 1.6]); c.fill(); }
  else {
    const cx = lean * 0.5, shW = 5.0, wW = p.id === 'vet' ? 4.8 : 4.1, bot = ty + torso + 0.6;
    c.fillStyle = sh(p.skin, 0.9); c.fillRect(hx * 0.5 - 1.1, ty - NECK - 0.6, 2.2, NECK + 1.2);              // neck
    c.strokeStyle = OL; c.lineWidth = 0.4; c.strokeRect(hx * 0.5 - 1.1, ty - NECK - 0.6, 2.2, NECK + 1.2);
    const shirt = () => { c.beginPath(); c.moveTo(cx - 1.8, ty); c.quadraticCurveTo(cx - shW, ty + 0.1, cx - shW, ty + 2.3); c.lineTo(cx - wW, bot); c.lineTo(cx + wW, bot); c.lineTo(cx + shW, ty + 2.3); c.quadraticCurveTo(cx + shW, ty + 0.1, cx + 1.8, ty); c.closePath(); };
    c.fillStyle = tg; shirt(); c.fill();
    c.save(); shirt(); c.clip(); c.fillStyle = 'rgba(60,30,30,.15)'; c.fillRect(cx + 1.2, ty, 6, torso + 1); c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(cx - shW, ty, 1.6, torso + 1);
    if (front) {
      if (p.id === 'bos') {        // dark suit: white shirt, red tie, lapels
        c.fillStyle = '#f4f2ee'; c.beginPath(); c.moveTo(cx - 1.7, ty); c.lineTo(cx + 1.7, ty); c.lineTo(cx, ty + 5); c.closePath(); c.fill();
        c.fillStyle = '#b8322a'; c.beginPath(); c.moveTo(cx - 0.5, ty + 0.6); c.lineTo(cx + 0.5, ty + 0.6); c.lineTo(cx + 0.7, ty + 4.6); c.lineTo(cx, ty + 5.4); c.lineTo(cx - 0.7, ty + 4.6); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(cx - 1.9, ty); c.lineTo(cx - 0.4, ty + 5.6); c.moveTo(cx + 1.9, ty); c.lineTo(cx + 0.4, ty + 5.6); c.stroke();
      } else if (p.id === 'jaga') {   // security uniform: epaulettes, badge, pocket
        c.fillStyle = '#1b2233'; c.fillRect(cx - shW, ty + 0.4, 2.2, 0.9); c.fillRect(cx + shW - 2.2, ty + 0.4, 2.2, 0.9);
        c.fillStyle = '#f2c230'; c.beginPath(); c.arc(cx - 2.2, ty + 3, 0.8, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 0.35; c.strokeRect(cx + 0.8, ty + 2.4, 2, 1.6);
      } else if (p.id === 'ob' || p.id === 'kantin') {     // office boy / canteen lady: apron + name patch
        c.fillStyle = '#e9e2d3'; c.beginPath(); c.moveTo(cx - 3, ty + 3.2); c.lineTo(cx + 3, ty + 3.2); c.lineTo(cx + 3.4, bot); c.lineTo(cx - 3.4, bot); c.closePath(); c.fill();
        c.fillStyle = '#ffffff'; c.fillRect(cx - 2.6, ty + 1.2, 1.8, 0.9);
      } else if (p.id === 'vet') {    // a dress with a soft V neck and a belt
        c.fillStyle = sh(p.skin, 0.95); c.beginPath(); c.moveTo(cx - 1.4, ty); c.lineTo(cx + 1.4, ty); c.lineTo(cx, ty + 2.2); c.closePath(); c.fill();
        c.fillStyle = sh(p.shirt, 0.7); c.fillRect(cx - wW, ty + torso - 2.4, 2 * wW, 0.8);
      } else if (p.id === 'kurir') {
        c.fillStyle = '#ffffff'; c.fillRect(cx - 3, ty + 3, 6, 1); c.fillStyle = '#1e1f23'; c.fillRect(cx - shW, ty + torso - 0.8, 2 * shW, 0.9);
      } else {                         // shirt with a collar and buttons
        c.fillStyle = sh(p.shirt, 1.3); c.beginPath(); c.moveTo(cx - 1.9, ty); c.lineTo(cx, ty + 1.6); c.lineTo(cx - 0.9, ty + 2.2); c.closePath(); c.fill(); c.beginPath(); c.moveTo(cx + 1.9, ty); c.lineTo(cx, ty + 1.6); c.lineTo(cx + 0.9, ty + 2.2); c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,255,255,.7)'; for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(cx, ty + 3 + k * 2, 0.32, 0, 7); c.fill(); }
      }
    }
    c.restore();
    c.strokeStyle = OL; c.lineWidth = 0.5; shirt(); c.stroke();
    if (p.id === 'vet' && !sitting && !bean) {      // the skirt of her dress over the legs
      c.fillStyle = sh(p.shirt, 0.92); c.beginPath(); c.moveTo(cx - wW, bot - 0.4); c.lineTo(cx + wW, bot - 0.4); c.lineTo(cx + wW + 1.2, hip + 3.6); c.lineTo(cx - wW - 1.2, hip + 3.6); c.closePath(); c.fill(); c.strokeStyle = OL; c.stroke();
    }
  }
  if (!INK && p.tie && front) { c.fillStyle = '#f4f4f2'; c.beginPath(); c.moveTo(-1.6, ty); c.lineTo(1.6, ty); c.lineTo(0, ty + 3); c.fill(); c.fillStyle = '#c0392b'; c.fillRect(-0.6, ty + 1.5, 1.3, 5); }
  if (!INK && p.id === 'jaga' && front) { c.fillStyle = '#f2c230'; c.fillRect(-3, ty + 2, 1.6, 1.8); }
  const arm = (side: number, back: boolean) => {
    c.strokeStyle = back ? shirtD : p.shirt; c.lineWidth = 2.4;
    const sxh = side * (INK ? 4.5 : 4.4) + lean * 0.5, syh = ty + 1.6;
    const ARM = INK ? 4.0 : 3.4;
    let ex = INK ? sxh + side * 0.15 + swing * side * -2 : sxh + side * 0.6 + swing * side * -2, ey = INK ? syh + 7.7 : syh + 6.2;
    if (typing) { ex = sxh + (side > 0 ? 3.4 : 2.2); ey = syh + 4.6 + (Math.sin(t * 17 + side * 2) > 0 ? -0.8 : 0); }
    if (sitting && !typing) { ex = sxh + 2.4; ey = syh + 5.2; }
    if (gesture === 'stretch') { ex = sxh + side * 1.4; ey = syh - 8.5 - Math.sin(t * 3) * 0.6; }
    if (gesture === 'sip' && side > 0) { ex = 2.8; ey = hy + 3.8; }
    if (gesture === 'chin' && side > 0) { ex = 2.3; ey = hy + 5.2; }
    if (gesture === 'hips') { ex = sxh + side * 2.6; ey = syh + 5.4; }
    if (gesture === 'cross') { ex = sxh - side * 4.6 + 1; ey = syh + 4.6 + side * 0.5; }
    if (gesture === 'scratch' && side > 0) { ex = hx + 1 + Math.sin(t * 14) * 0.5; ey = hy - 3; }
    if (bean) { ex = sxh + 3; ey = syh + 4.4 + (prop === 'hp' ? Math.sin(t * 9 + side) * 0.5 : 0); }
    if (pose === 'stretch') { ex = sxh + side * 1.2; ey = syh - 7 - Math.sin(t * 2.4) * 1.2; }
    if (pose === 'jump') { ex = sxh + side * 2; ey = syh - 7; }
    if (pose === 'squat') { ex = sxh + 4.5; ey = syh + 1; }
    if (pose === 'sleep') { ex = sxh + 4; ey = syh + 2.5; }
    if (pose === 'nap') { ex = sxh + 1.5; ey = syh + 5.5; }
    if (shaking) { ex = sxh + side * 1.5; ey = syh - 4.5 + Math.sin(t * 30) * 0.6; }
    if (!walking && prop === 'phone' && side > 0 && !shaking) { ex = 3.6; ey = hy + 1.5; }
    if (!walking && prop === 'hp' && !bean && !shaking) { ex = 3.2 - side * 0.4; ey = syh + 3.2; }
    if (drama) { ex = 5.6 - side * 1.3; ey = hip - 2.2; if (mood === 'MAKAN POPCORN' && side > 0) { const k = (Math.sin(t * 5) + 1) / 2; ex = 4.2 + k * 1.5; ey = hy + 3.5 + (1 - k) * 6; } }
    if (eatSit && side > 0) { const k = (Math.sin(t * 4) + 1) / 2; ex = 3.6 + k * 1.2; ey = hy + 3.5 + (1 - k) * 6; }
    if (!walking && (prop === 'book' || prop === 'paper') && !shaking) { ex = 3.8 - side * 0.3; ey = syh + 3.5; }
    if (!walking && prop === 'can' && a.act.id === 'plant' && side > 0) { ex = 7; ey = syh + 3; }
    if (!walking && prop === 'club' && !shaking) { const w = Math.sin(t * 2.2); ex = 2.5 + w * 2.5 - side * 0.5; ey = syh + 6 - Math.abs(w) * 1.5; }
    if (!walking && prop === 'dumbbell' && !shaking) { ex = sxh + 1; ey = syh + 5 - Math.max(0, Math.sin(t * 3 + (side > 0 ? 0 : 3.14))) * 8; }
    if (!walking && !shaking && prop === 'mop') { ex = 3.4 + Math.sin(t * 4) * 1.4 - side * 0.6; ey = syh + 4.2; }
    if (!walking && !shaking && prop === 'rag' && side > 0) { ex = 5.2 + Math.cos(t * 6) * 1.4; ey = syh - 3 + Math.sin(t * 6) * 1.4; }
    if (!walking && !shaking && prop === 'galon') { ex = sxh + side * 0.8 + 1.5; ey = syh - 6.5; }
    if (!walking && !shaking && prop === 'mic' && side > 0) { ex = 2.8; ey = hy + 3.4; }
    if (!walking && !shaking && prop === 'paddle' && side > 0) { const w = Math.sin(t * 0.9 * Math.PI * 2); ex = 3 + w * 2.6; ey = syh + 2.5 - Math.abs(w) * 1.2; }
    if (!walking && !shaking && prop === 'guitar') { ex = side > 0 ? 3.4 : 7.5; ey = side > 0 ? hip - 3 + Math.sin(t * 12) * 0.7 : hip - 6; }
    if (!walking && !shaking && prop === 'box' && !sitting) { ex = sxh + 2.6; ey = syh + 3.6; }
    if (whipT != null && side > 0) { const w = (whipT % 0.9) / 0.9; ex = sxh + 2 + Math.cos(w * 6.28) * 1.5; ey = syh - 7 + (w < 0.25 ? 6 * (w / 0.25) : 6 - 6 * ((w - 0.25) / 0.75)); }
    if (anim && !shaking && whipT == null && !a.carry) { const f = ph + (side > 0 ? 0 : Math.PI); ex = sxh + Math.cos(f) * 2.6 * am; ey = syh + (INK ? 7.5 : 6.3) - Math.abs(Math.cos(f)) * 1.1 * am; }
    else if (anim && a.carry && side < 0) { const f = ph + Math.PI; ex = sxh + Math.cos(f) * 2.6 * am; ey = syh + 6.3 - Math.abs(Math.cos(f)) * 1.1 * am; }
    else if (anim && a.carry && side > 0) { ex = sxh + 2.2; ey = syh + 3.6; }
    { const key = side > 0 ? 'r' : 'l'; a.arms ??= {}; const pr = a.arms[key];
      if (pr && whipT == null && !shaking && Math.hypot(ex - pr[0], ey - pr[1]) > 1.0) { const kk = Math.min(1, dtp * (anim ? 16 : 8)); ex = pr[0] + (ex - pr[0]) * kk; ey = pr[1] + (ey - pr[1]) * kk; }
      a.arms[key] = [ex, ey]; }
    limb(c, sxh + twist * side * 0.3, syh, ex, ey, ARM, ARM, ey < syh ? -0.6 : -0.8, 2.4, back ? shirtD : p.shirt);
    if (gesture === 'sip' && side > 0) { c.fillStyle = '#ffffff'; c.fillRect(ex - 0.4, ey - 2.6, 2.4, 3.2); c.fillStyle = '#6b4a2b'; c.fillRect(ex - 0.4, ey - 2.6, 2.4, 0.7); }
    if (INK) { c.fillStyle = p.skin; c.beginPath(); c.ellipse(ex, ey + 0.9, 1.0, 1.35, 0, 0, 7); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.35; c.stroke(); c.beginPath(); c.ellipse(ex + side * 0.0 + 0.85, ey + 0.4, 0.42, 0.7, -0.5, 0, 7); c.fill(); c.stroke(); }
    else { c.fillStyle = p.skin; c.beginPath(); c.arc(ex, ey + 0.6, 1.35, 0, 7); c.fill(); }
    if (!walking && prop === 'dumbbell' && !shaking) { c.fillStyle = '#26272c'; c.fillRect(ex - 2.4, ey - 0.4, 4.8, 1.4); c.fillRect(ex - 3, ey - 1.2, 1.4, 3); c.fillRect(ex + 1.6, ey - 1.2, 1.4, 3); }
    if (side > 0) {
      if ((prop === 'cup' || prop === 'can') && pose === 'stand' && a.act.id !== 'plant') { c.fillStyle = prop === 'can' ? '#e5484d' : '#ffffff'; c.fillRect(ex - 0.5, ey - 2.2, 2.6, 3.4); if (prop === 'cup') { c.fillStyle = '#6b4a2b'; c.fillRect(ex - 0.5, ey - 2.2, 2.6, 0.8); } }
      if (prop === 'food' && pose === 'stand') { c.fillStyle = '#f2a33a'; c.beginPath(); c.arc(ex + 0.8, ey - 0.8, 1.8, 0, 7); c.fill(); }
      if (prop === 'trash' && pose === 'stand') { c.fillStyle = '#1e1f23'; c.beginPath(); c.ellipse(ex + 0.5, ey + 2.5, 2.2, 2.8, 0, 0, 7); c.fill(); }
      if (prop === 'club' && !walking) { const w = Math.sin(t * 2.2); c.strokeStyle = '#d8d8d8'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex + 1 + w * 4, -1.2); c.stroke(); c.fillStyle = '#9aa0a8'; c.fillRect(ex + w * 4, -2, 3, 1.4); if (w > 0.85) { c.fillStyle = '#ffffff'; c.beginPath(); c.arc(ex + 9 + (t * 20) % 12, -1.2, 0.9, 0, 7); c.fill(); } }
      if (prop === 'phone' && !walking) { c.fillStyle = '#1e1f23'; c.fillRect(ex + 0.3, ey - 2.5, 1.4, 3.6); }
      if (prop === 'mop' && !walking) { const mx = 7 + Math.sin(t * 4) * 3.2; c.strokeStyle = '#a07a4a'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(ex - 1, ey - 3); c.lineTo(mx, -0.8); c.stroke(); c.fillStyle = '#e4ded0'; c.beginPath(); c.ellipse(mx, -0.6, 2.8, 0.9, 0, 0, 7); c.fill(); }
      if (prop === 'rag' && !walking) { c.fillStyle = '#f2c230'; c.fillRect(ex - 1.2, ey - 1.2, 2.6, 2.2); }
      if (prop === 'galon' && !walking) { c.fillStyle = 'rgba(150,210,245,.92)'; c.beginPath(); c.roundRect(-0.5, syh - 16, 6.5, 9.5, 2.2); c.fill(); c.fillStyle = '#4c7dff'; c.fillRect(2, syh - 7, 1.6, 1.6); c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(0.6, syh - 14.5, 1, 6); }
      if (prop === 'galon' && walking) { c.fillStyle = 'rgba(150,210,245,.92)'; c.beginPath(); c.roundRect(ex - 1, ey - 5, 5, 7, 1.8); c.fill(); }
      if (prop === 'mic' && !walking) {
        c.fillStyle = '#1e1f23'; c.fillRect(ex - 0.4, ey - 2.8, 0.9, 3.2); c.beginPath(); c.arc(ex, ey - 3.2, 1.1, 0, 7); c.fill();
        for (let k = 0; k < 2; k++) { const w = (t * 0.6 + k * 0.5) % 1; c.fillStyle = `rgba(242,194,48,${1 - w})`; const nx = 6 + k * 3 + w * 3, ny = hy - 7 - w * 9; c.beginPath(); c.ellipse(nx, ny, 1, 0.8, -0.4, 0, 7); c.fill(); c.fillRect(nx + 0.6, ny - 3.2, 0.5, 3.2); }
      }
      if (prop === 'guitar' && !walking) { c.strokeStyle = '#5a3a1e'; c.lineWidth = 1; c.beginPath(); c.moveTo(4.5, hip - 3); c.lineTo(10.5, hip - 6.5); c.stroke(); c.fillStyle = '#c47a2c'; c.beginPath(); c.ellipse(3.6, hip - 2.4, 3.1, 2.3, -0.5, 0, 7); c.fill(); c.fillStyle = '#3a2412'; c.beginPath(); c.arc(4, hip - 2.7, 0.8, 0, 7); c.fill(); }
      if (prop === 'box') { const bx = sitting && !walking ? 2.2 : ex - 1.5, by = sitting && !walking ? hip - 6.5 : ey - 4.2; c.fillStyle = '#c8a26b'; c.fillRect(bx, by, 6, 4.4); c.fillStyle = '#a8844e'; c.fillRect(bx, by, 6, 0.9); c.fillStyle = '#e9d9b0'; c.fillRect(bx + 2.6, by, 0.8, 4.4);
        if (sitting && !walking) { c.fillStyle = '#f3a6c8'; c.beginPath(); c.arc(bx + 3, by - 0.8 - Math.abs(Math.sin(t * 2)) * 0.8, 1.6, 0, 7); c.fill(); } }
      if (prop === 'envelope' && !walking) { c.fillStyle = '#ffffff'; c.fillRect(ex - 1.7, ey - 2.6, 3.6, 2.4); c.fillStyle = '#e5484d'; c.fillRect(ex - 0.3, ey - 2.6, 0.8, 2.4); }
      if (prop === 'paddle' && !walking) { c.fillStyle = '#5a3a1e'; c.fillRect(ex - 0.3, ey - 0.6, 0.8, 2); c.fillStyle = '#d7262c'; c.beginPath(); c.arc(ex + 0.9, ey - 1.6, 1.9, 0, 7); c.fill(); }
      if (drama) {        // laptop on her lap with a Korean drama playing
        const sc = ['#f3a6c8', '#a6d8f3', '#f7d89a', '#c5b3f0'][Math.floor(t * 0.7) % 4];
        c.fillStyle = '#b9bcc4'; c.beginPath(); c.moveTo(4.2, hip - 2.6); c.lineTo(10.2, hip - 2.6); c.lineTo(9.4, hip - 0.9); c.lineTo(3.6, hip - 0.9); c.closePath(); c.fill();
        c.fillStyle = '#9a9ea8'; c.fillRect(3.6, hip - 0.9, 5.8, 0.6);
        c.fillStyle = '#2a2b30'; c.beginPath(); c.moveTo(4.6, hip - 2.6); c.lineTo(10.4, hip - 2.6); c.lineTo(11.4, hip - 9.8); c.lineTo(5.6, hip - 9.8); c.closePath(); c.fill();
        c.fillStyle = sc; c.beginPath(); c.moveTo(5.2, hip - 3.1); c.lineTo(9.9, hip - 3.1); c.lineTo(10.75, hip - 9.2); c.lineTo(6.05, hip - 9.2); c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,255,255,.65)'; c.beginPath(); c.arc(7.2, hip - 6.6, 0.8, 0, 7); c.arc(9.0, hip - 6.3, 0.8, 0, 7); c.fill();
        c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(6.6, hip - 4.3, 3.0, 0.5);
      }
      if (drama || eatSit) {
        const bx = drama ? 1.2 : 4.6, by = hip - 1.5;
        c.fillStyle = '#e5242b'; c.beginPath(); c.moveTo(bx - 3, by - 2.2); c.lineTo(bx + 3, by - 2.2); c.lineTo(bx + 2.2, by + 1.6); c.lineTo(bx - 2.2, by + 1.6); c.closePath(); c.fill();
        c.fillStyle = '#ffffff'; c.fillRect(bx - 1.2, by - 2.2, 0.9, 3.8); c.fillRect(bx + 0.6, by - 2.2, 0.9, 3.8);
        c.fillStyle = '#fff6d8'; for (const [dx, dy] of [[-2, -2.6], [-0.8, -3.2], [0.6, -2.8], [1.8, -3.1], [0, -3.8], [2.4, -2.4], [-1.6, -3.6]]) { c.beginPath(); c.arc(bx + dx, by + dy, 0.75, 0, 7); c.fill(); }
        if ((mood === 'MAKAN POPCORN' || eatSit) && Math.sin(t * 5) > 0.6) { c.fillStyle = '#fff6d8'; c.beginPath(); c.arc(ex, ey - 0.6, 0.7, 0, 7); c.fill(); }
      }
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
  headOn();
  if (!INK) { c.fillStyle = sh(p.skin, 0.9); c.fillRect(hx - 1.4, hy + R - 2.2, 2.8, 3); }
  const hg = c.createRadialGradient(hx + 1.5, hy - 2, 1, hx, hy, R + 1); hg.addColorStop(0, sh(p.skin, 1.08)); hg.addColorStop(1, sh(p.skin, 0.9));
  const head = () => {
    c.beginPath();
    if (INK) { c.moveTo(hx - R * 0.88, hy - R * 0.2); c.bezierCurveTo(hx - R * 0.9, hy - R * 1.02, hx + R * 0.9, hy - R * 1.02, hx + R * 0.88, hy - R * 0.2); c.bezierCurveTo(hx + R * 0.84, hy + R * 0.62, hx + R * 0.3, hy + R * 0.98, hx, hy + R * 0.98); c.bezierCurveTo(hx - R * 0.3, hy + R * 0.98, hx - R * 0.84, hy + R * 0.62, hx - R * 0.88, hy - R * 0.2); c.closePath(); }
    else c.arc(hx, hy, R, 0, 7);
  };
  if (INK && front) { c.fillStyle = sh(p.skin, 0.93); c.beginPath(); c.ellipse(hx - R * 0.86, hy + 1, 1.1, 1.6, 0, 0, 7); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.45; c.stroke(); }
  c.fillStyle = hg; head(); c.fill();
  if (INK) { c.strokeStyle = OL; c.lineWidth = 0.55; c.stroke(); c.save(); head(); c.clip(); c.fillStyle = 'rgba(150,80,60,.12)'; c.beginPath(); c.ellipse(hx - 3.5, hy + 3, 3, 4.5, 0, 0, 7); c.fill(); c.restore(); }
  const angry = (p.id === 'bos' && whipT != null) || (p.id === 'vet' && !!a.act.whip && !walking && !!a.bubble && Date.now() < a.bubble.until);
  if (angry) { c.fillStyle = 'rgba(255,60,40,.28)'; c.beginPath(); c.arc(hx, hy, R, 0, 7); c.fill(); }
  c.save(); c.beginPath(); if (INK) c.rect(hx - 3 * R, hy - 3 * R, 6 * R, 6 * R); else c.arc(hx, hy, R + 0.7, 0, 7); c.clip();
  c.fillStyle = p.hair;
  if (INK && p.style === 'cap') {
    const cc = p.cap ?? '#1e1f23';
    c.fillStyle = cc; c.beginPath(); c.moveTo(hx - R * 1.0, hy - R * 0.2); c.bezierCurveTo(hx - R * 1.05, hy - R * 1.45, hx + R * 1.05, hy - R * 1.45, hx + R * 1.0, hy - R * 0.2); c.closePath(); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.5; c.stroke();
    c.fillStyle = sh(cc, 0.75); c.beginPath(); c.moveTo(hx - R * 0.3, hy - R * 0.32); c.quadraticCurveTo(hx + (front ? R * 1.5 : -R * 1.5), hy - R * 0.38, hx + (front ? R * 1.4 : -R * 1.4), hy - R * 0.1); c.lineTo(hx - R * 0.1, hy - R * 0.12); c.closePath(); c.fill(); c.stroke();
    if (front && p.id === 'jaga') { c.fillStyle = '#f2c230'; c.beginPath(); c.arc(hx + 0.4, hy - R * 0.7, R * 0.12, 0, 7); c.fill(); }
  } else if (INK) {
    const hg2 = c.createLinearGradient(0, hy - R * 1.2, 0, hy); hg2.addColorStop(0, sh(p.hair, 1.25)); hg2.addColorStop(1, sh(p.hair, 0.9)); c.fillStyle = hg2;
    const side = p.style === 'long' ? R * 0.55 : R * 0.05, f = front ? 0.6 : 0;
    c.beginPath(); c.moveTo(hx - R * 1.0, hy + side); c.bezierCurveTo(hx - R * 1.18, hy - R * 1.55, hx + R * 1.18, hy - R * 1.55, hx + R * 1.0, hy + side);
    if (!front) c.lineTo(hx + R * 0.98, hy + R * 0.7), c.lineTo(hx - R * 0.98, hy + R * 0.7);
    else if (p.style === 'slick') { c.bezierCurveTo(hx + R * 0.85, hy - R * 0.45, hx + f, hy - R * 0.55, hx - R * 0.2, hy - R * 0.52); c.bezierCurveTo(hx - R * 0.7, hy - R * 0.5, hx - R * 0.95, hy - R * 0.2, hx - R * 1.0, hy + side); }
    else { c.bezierCurveTo(hx + R * 0.75, hy - R * 0.55, hx + R * 0.5, hy - R * 0.45, hx + R * 0.3 + f, hy - R * 0.28); c.bezierCurveTo(hx + R * 0.08, hy - R * 0.6, hx - R * 0.12, hy - R * 0.48, hx - R * 0.28 + f, hy - R * 0.3); c.bezierCurveTo(hx - R * 0.62, hy - R * 0.6, hx - R * 0.95, hy - R * 0.3, hx - R * 1.0, hy + side); }
    c.closePath(); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.5; c.stroke();
    if (p.style === 'curly') for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(hx - R * 0.85 + k * R * 0.34, hy - R * 0.62 - Math.sin(k) * 0.4, R * 0.24, 0, 7); c.fill(); }
    c.strokeStyle = sh(p.hair, 0.68); c.lineWidth = 0.32;
    for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(hx + k * R * 0.2, hy - R * 1.02); c.quadraticCurveTo(hx + k * R * 0.28, hy - R * 0.8, hx + k * R * 0.24, hy - R * 0.5); c.stroke(); }
  } else if (front) {
    if (p.style === 'cap') { c.fillStyle = p.cap ?? '#1e1f23'; c.fillRect(hx - R - 1, hy - R - 1, 2 * R + 2, R - 0.5); }
    else {
      c.beginPath(); c.ellipse(hx - 0.6, hy - 3.2, R + 1, R - 1.6, -0.12, 0, 7); c.fill();
      c.beginPath(); c.ellipse(hx - R + 0.6, hy, 2.2, 3.6, 0, 0, 7); c.fill();
      if (p.style === 'curly') for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(hx - 4 + k * 2.1, hy - 3.6, 1.7, 0, 7); c.fill(); }
      if (p.style === 'slick') { c.fillStyle = sh(p.hair, 1.5); c.fillRect(hx - 2, hy - 6.5, 4, 0.8); }
    }
  } else { c.fillRect(hx - R - 1, hy - R - 1, 2 * R + 2, 2 * R - (p.style === 'cap' ? 2.5 : 1.3)); if (p.style === 'cap') { c.fillStyle = p.cap ?? '#1e1f23'; c.fillRect(hx - R - 1, hy - R - 1, 2 * R + 2, R - 0.5); } }
  c.restore();
  if (INK && p.style !== 'cap') { c.fillStyle = 'rgba(255,255,255,.22)'; c.beginPath(); c.ellipse(hx - 1.5, hy - 4.6, 2.8, 0.8, -0.25, 0, 7); c.fill(); }      // hair shine
  if (p.style === 'cap' && !INK) { c.fillStyle = p.cap ?? '#1e1f23'; c.beginPath(); c.ellipse(hx + (front ? 4.5 : -4.5), hy - 1.4, 3.6, 1.1, 0, 0, 7); c.fill(); }
  if (p.style === 'bun') { c.fillStyle = p.hair; c.beginPath(); c.arc(hx - 1, hy - R - (INK ? 2.2 : 0.6), 2.6, 0, 7); c.fill(); if (INK) { c.strokeStyle = OL; c.lineWidth = 0.5; c.stroke(); } }
  if (p.headset) { c.strokeStyle = '#1e1f23'; c.lineWidth = 1; c.beginPath(); c.arc(hx, hy, R + 0.6, Math.PI * 1.05, Math.PI * 1.95); c.stroke(); c.fillStyle = '#1e1f23'; c.beginPath(); c.arc(hx - R + 0.4, hy + 0.5, 1.8, 0, 7); c.fill(); }
  if (front && pose !== 'sleep' && pose !== 'nap') {
    const blink = (t * 1000 + hash(p.id) * 4000) % 4000 < 120;
    const look = prop === 'hp' && !walking ? 0.8 : 0;
    c.fillStyle = '#1e1f23';
    const xp = drama || angry || shaking ? 'biasa' : exprOf(p, a, st, t);
    const closed = drama && (mood === 'KETAWA' || mood === 'NANGIS');
    for (const ex of [hx - 0.6, hx + 3.2]) {
      if (xp === 'cinta' && !closed) { c.fillStyle = '#e5242b'; c.beginPath(); c.moveTo(ex, hy + 2.2); c.bezierCurveTo(ex - 2.2, hy + 0.6, ex - 1.2, hy - 1, ex, hy + 0.1); c.bezierCurveTo(ex + 1.2, hy - 1, ex + 2.2, hy + 0.6, ex, hy + 2.2); c.fill(); }
      else if ((xp === 'ketawa' || xp === 'malu') && !closed) { c.strokeStyle = '#1e1f23'; c.lineWidth = 0.75; c.beginPath(); c.arc(ex, hy + 1.3, 0.95, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); }
      else if (xp === 'ngantuk' && !closed) { c.strokeStyle = '#1e1f23'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(ex - 1, hy + 1); c.quadraticCurveTo(ex, hy + 1.6, ex + 1, hy + 1); c.stroke(); }
      else if (closed) { c.strokeStyle = '#1e1f23'; c.lineWidth = 0.7; c.beginPath(); if (mood === 'KETAWA') c.arc(ex, hy + 1.2, 0.9, Math.PI * 1.1, Math.PI * 1.9); else c.arc(ex, hy + 0.2, 0.9, Math.PI * 0.1, Math.PI * 0.9); c.stroke(); }
      else if (blink) c.fillRect(ex - 0.9, hy + 0.6 + look, 1.8, 0.5); else {
        if (INK) {
          const ey0 = hy + 0.7 + look + (drama && mood === 'SEDIH' ? 0.3 : 0) + (xp === 'sedih' ? 0.3 : 0), ew = xp === 'kaget' ? 1.3 : xp === 'fokus' ? 0.95 : 1.05;
          c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(ex, ey0, ew * 1.2, ew * (shaking ? 1.25 : 0.98), 0, 0, 7); c.fill();
          c.fillStyle = '#4a2c1a'; c.beginPath(); c.ellipse(ex + 0.25, ey0 + 0.1, ew * 0.78, ew * 0.9, 0, 0, 7); c.fill();
          c.fillStyle = '#120c08'; c.beginPath(); c.arc(ex + 0.25, ey0 + 0.2, ew * 0.42, 0, 7); c.fill();
          c.fillStyle = '#ffffff'; c.beginPath(); c.arc(ex + 0.55, ey0 - 0.25, ew * 0.27, 0, 7); c.fill();
          c.strokeStyle = '#2a1a12'; c.lineWidth = 0.42; c.beginPath(); c.moveTo(ex - ew * 1.25, ey0 - ew * 0.7); c.quadraticCurveTo(ex, ey0 - ew * 1.3, ex + ew * 1.25, ey0 - ew * 0.75); c.stroke();
          c.fillStyle = '#1e1f23';
        } else { c.fillStyle = '#1e1f23'; c.beginPath(); c.ellipse(ex, hy + 0.6 + look, 0.85, shaking ? 1.5 : 1.15, 0, 0, 7); c.fill(); }
      }
    }
    c.fillStyle = 'rgba(255,120,120,.35)'; c.beginPath(); c.arc(hx - 1.6, hy + 2.8, 1.1, 0, 7); c.arc(hx + 4.3, hy + 2.8, 1.1, 0, 7); c.fill();
    if (INK && !angry && !drama && !closed) { c.strokeStyle = sh(p.hair, 0.8); c.lineWidth = 0.5; c.beginPath();
      const up = xp === 'kaget' ? -0.9 : xp === 'senang' || xp === 'ketawa' ? -0.3 : 0;
      for (const ex of [hx - 0.6, hx + 3.2]) {
        const inner = ex < hx ? 1 : -1;          // +1: the inner end is on the right
        const tilt = xp === 'sedih' || xp === 'cemas' || xp === 'malu' ? 0.6 : xp === 'fokus' || xp === 'kesal' ? -0.55 : xp === 'bingung' ? (ex < hx ? 0.5 : -0.5) : 0;    // sad: inner ends up; focused: inner ends down
        const a0 = hy - 1.3 + up + (p.id === 'bos' ? (ex < hx ? -0.3 : 0.3) : 0) + (inner > 0 ? 0 : -tilt), a1 = hy - 1.3 + up + (p.id === 'bos' ? (ex < hx ? 0.3 : -0.3) : 0) + (inner > 0 ? -tilt : 0);
        c.moveTo(ex - 1.2, a0); c.quadraticCurveTo(ex, hy - 1.9 + up, ex + 1.2, a1);
      }
      c.stroke();
      c.strokeStyle = 'rgba(120,70,50,.5)'; c.lineWidth = 0.35; c.beginPath(); c.moveTo(hx + 1.6, hy + 1.6); c.quadraticCurveTo(hx + 1.9, hy + 2.4, hx + 1.4, hy + 2.5); c.stroke(); }
    if (drama) {
      if (mood === 'KETAWA') { c.fillStyle = '#7a1f1f'; c.beginPath(); c.moveTo(hx - 0.6, hy + 2.6); c.lineTo(hx + 3.4, hy + 2.6); c.quadraticCurveTo(hx + 1.4, hy + 6.2 + Math.abs(Math.sin(t * 14)) * 0.6, hx - 0.6, hy + 2.6); c.fill(); c.fillStyle = '#ff8a8a'; c.beginPath(); c.arc(hx + 1.4, hy + 4.4, 0.8, 0, 7); c.fill(); }
      else if (mood === 'MAKAN POPCORN') { c.fillStyle = '#7a3b2e'; c.beginPath(); c.ellipse(hx + 1.4, hy + 3.2, 0.9, Math.sin(t * 10) > 0 ? 0.7 : 0.3, 0, 0, 7); c.fill(); }
      else {
        c.strokeStyle = '#1e1f23'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(hx - 2, hy - 1.2); c.lineTo(hx + 0.4, hy - 2); c.moveTo(hx + 4.6, hy - 1.2); c.lineTo(hx + 2.2, hy - 2); c.stroke();
        c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.7; c.beginPath(); c.arc(hx + 1.4, hy + 4.6, 1.1, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
        const tears = mood === 'NANGIS' ? 2 : 1;
        for (let k = 0; k < tears; k++) for (const ex of mood === 'NANGIS' ? [hx - 0.6, hx + 3.2] : [hx + 3.2]) {
          const w = (t * 1.3 + k * 0.5 + ex) % 1; c.fillStyle = `rgba(110,180,255,${0.9 - w * 0.6})`;
          if (mood === 'NANGIS') c.fillRect(ex - 0.45, hy + 1.2, 0.9, 1.5 + w * 4.5); else { c.beginPath(); c.ellipse(ex, hy + 1.8 + w * 4, 0.6, 0.9, 0, 0, 7); c.fill(); }
        }
      }
    } else if (angry) {
      c.strokeStyle = '#1e1f23'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(hx - 2, hy - 1.6); c.lineTo(hx + 0.6, hy - 0.6); c.moveTo(hx + 4.6, hy - 1.6); c.lineTo(hx + 2.1, hy - 0.6); c.stroke();
      c.fillStyle = '#5a1a1a'; c.beginPath(); c.ellipse(hx + 1.4, hy + 3.4, 1.4, 1.1 + Math.abs(Math.sin(t * 9)) * 0.7, 0, 0, 7); c.fill();
    } else if (shaking) { c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(hx, hy + 3.6); for (let k = 1; k <= 4; k++) c.lineTo(hx + k * 0.7, hy + 3.6 + (k % 2 ? -0.5 : 0)); c.stroke(); }
    else if (pose === 'jump') { c.fillStyle = '#5a1a1a'; c.beginPath(); c.arc(hx + 1.4, hy + 2.8, 1.3, 0, Math.PI); c.fill(); }
    else if (xp === 'ketawa') { c.fillStyle = '#7a1f1f'; c.beginPath(); c.moveTo(hx - 0.2, hy + 2.6); c.lineTo(hx + 3, hy + 2.6); c.quadraticCurveTo(hx + 1.4, hy + 5.4 + Math.abs(Math.sin(t * 12)) * 0.4, hx - 0.2, hy + 2.6); c.fill(); c.fillStyle = '#ff8a8a'; c.beginPath(); c.arc(hx + 1.4, hy + 3.9, 0.6, 0, 7); c.fill(); }
    else if (xp === 'cinta') { c.fillStyle = '#7a1f1f'; c.beginPath(); c.arc(hx + 1.4, hy + 3, 1.1, 0, Math.PI); c.fill(); }
    else if (xp === 'malu') { c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(hx + 0.5, hy + 3.4); c.quadraticCurveTo(hx + 1.4, hy + 4, hx + 2.3, hy + 3.4); c.stroke(); c.fillStyle = 'rgba(255,90,90,.45)'; c.beginPath(); c.ellipse(hx - 1.6, hy + 2.6, 1.9, 1.1, 0, 0, 7); c.ellipse(hx + 4.4, hy + 2.6, 1.9, 1.1, 0, 0, 7); c.fill(); }
    else if (xp === 'bingung') { c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(hx + 0.4, hy + 3.6); c.lineTo(hx + 2.4, hy + 3.1); c.stroke(); }
    else if (xp === 'kesal') { c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.7; c.beginPath(); c.arc(hx + 1.4, hy + 4.4, 1, Math.PI * 1.2, Math.PI * 1.8); c.stroke(); }
    else if (xp === 'senang') { c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.7; c.beginPath(); c.arc(hx + 1.4, hy + 2.6, 1.3, 0.15, Math.PI - 0.15); c.stroke(); }
    else if (xp === 'sedih') { c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.65; c.beginPath(); c.arc(hx + 1.4, hy + 4.6, 1.1, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
    else if (xp === 'cemas') { c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.55; c.beginPath(); c.moveTo(hx + 0.2, hy + 3.6); for (let k = 1; k <= 4; k++) c.lineTo(hx + 0.2 + k * 0.6, hy + 3.6 + (k % 2 ? -0.35 : 0)); c.stroke(); }
    else if (xp === 'kaget') { c.fillStyle = '#5a1a1a'; c.beginPath(); c.ellipse(hx + 1.4, hy + 3.5, 0.8, 1.1, 0, 0, 7); c.fill(); }
    else if (xp === 'ngomong') { const o = Math.abs(Math.sin(t * 11)); c.fillStyle = '#5a1a1a'; c.beginPath(); c.ellipse(hx + 1.4, hy + 3.2, 1.0, 0.25 + o * 0.75, 0, 0, 7); c.fill(); }
    else if (xp === 'fokus') { c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(hx + 0.5, hy + 3.3); c.lineTo(hx + 2.3, hy + 3.2); c.stroke(); }
    else if (xp === 'ngantuk') { const y = Math.sin(t * 0.9 + hash(p.id) * 5); c.fillStyle = '#5a1a1a'; c.beginPath(); c.ellipse(hx + 1.4, hy + 3.4, 0.6 + Math.max(0, y) * 0.5, 0.4 + Math.max(0, y) * 0.9, 0, 0, 7); c.fill(); }
    else { c.strokeStyle = '#7a3b2e'; c.lineWidth = 0.6; c.beginPath(); c.arc(hx + 1.4, hy + 3, 0.9, 0.2, Math.PI - 0.2); c.stroke(); }
    // little signs next to the head: sweat when worried, sparkles when happy, "!" when surprised, z when sleepy
    if (xp === 'cemas') { const w = (t * 0.8 + hash(p.id)) % 1; c.fillStyle = `rgba(120,190,255,${1 - w * 0.6})`; c.beginPath(); c.ellipse(hx - 4.2, hy - 1 + w * 3, 0.7, 1.1, 0, 0, 7); c.fill(); }
    if (xp === 'ketawa' || (xp === 'senang' && Math.sin(t * 1.3 + hash(p.id) * 7) > 0.6)) for (let k = 0; k < 2; k++) { const w = (t * 0.9 + k * 0.5) % 1, sx2 = hx + 6.5 + k * 1.6, sy2 = hy - 4 - w * 3; c.fillStyle = `rgba(255,210,60,${1 - w})`; c.beginPath(); for (let q = 0; q < 4; q++) { const ang = (q * Math.PI) / 2; c.lineTo(sx2 + Math.cos(ang) * 1.3, sy2 + Math.sin(ang) * 1.3); c.lineTo(sx2 + Math.cos(ang + Math.PI / 4) * 0.4, sy2 + Math.sin(ang + Math.PI / 4) * 0.4); } c.closePath(); c.fill(); }
    if (xp === 'cinta') for (let k = 0; k < 2; k++) { const w = (t * 0.6 + k * 0.5) % 1, hx2 = hx + 6 + k * 2, hy2 = hy - 4 - w * 6; c.fillStyle = `rgba(229,36,43,${1 - w})`; c.beginPath(); c.moveTo(hx2, hy2 + 1.2); c.bezierCurveTo(hx2 - 1.4, hy2, hx2 - 0.8, hy2 - 1, hx2, hy2 - 0.3); c.bezierCurveTo(hx2 + 0.8, hy2 - 1, hx2 + 1.4, hy2, hx2, hy2 + 1.2); c.fill(); }
    if (xp === 'bingung') { c.fillStyle = '#4c7dff'; c.font = 'bold 5.5px system-ui, sans-serif'; c.fillText('?', hx + 6, hy - 5 - Math.abs(Math.sin(t * 3)) * 1); }
    if (xp === 'kesal') { const w = (t * 1.2) % 1; c.fillStyle = `rgba(160,160,170,${0.8 - w * 0.8})`; c.beginPath(); c.arc(hx + 6 + w * 3, hy - 3 - w * 4, 1 + w * 1.4, 0, 7); c.fill(); }
    if (xp === 'kaget') { c.fillStyle = '#e5242b'; c.font = 'bold 6px system-ui, sans-serif'; c.fillText('!', hx + 6, hy - 5 - Math.abs(Math.sin(t * 6)) * 1.2); }
    if (xp === 'ngantuk') for (let k = 0; k < 2; k++) { const w = (t * 0.45 + k / 2) % 1; c.fillStyle = `rgba(90,110,160,${0.9 - w * 0.9})`; c.font = `bold ${2.6 + k}px system-ui, sans-serif`; c.fillText('z', hx + 5 + w * 3 + k, hy - 4 - w * 6); }
    if (p.glasses) { c.strokeStyle = '#1e1f23'; c.lineWidth = 0.6; c.strokeRect(hx - 2.3, hy - 0.6, 3.2, 2.4); c.strokeRect(hx + 1.6, hy - 0.6, 3.2, 2.4); c.beginPath(); c.moveTo(hx + 0.9, hy + 0.2); c.lineTo(hx + 1.6, hy + 0.2); c.stroke(); }
    if (a.act.label === 'MASKERAN' && !walking) {      // green face mask + cucumber slices
      c.fillStyle = 'rgba(150,215,160,.94)'; c.beginPath(); c.ellipse(hx + 1.2, hy + 1.4, R * 0.8, R * 0.66, 0, 0, 7); c.fill();
      for (const ex of [hx - 0.6, hx + 3.2]) { c.fillStyle = '#e3f5cf'; c.beginPath(); c.arc(ex, hy + 0.6, 1.45, 0, 7); c.fill(); c.strokeStyle = '#6fb35e'; c.lineWidth = 0.45; c.stroke(); }
    }
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
  c.restore();
  arm(1, false);
  c.restore();
}

/* ---------- planning ---------- */
const lunch = (now: number) => { const h = new Date(now).getHours(); return h >= 12 && h < 13; };
function variant(s: Spot, now: number): Spot {
  if (s.zone === 'eat' && lunch(now)) return { ...s, label: 'MAKAN SIANG', prop: 'food' };
  if (s.label === 'LIHAT LUAR' && WEATHER.kind && Math.random() < 0.7) return { ...s, label: WEATHER.kind === 'snow' ? 'LIHAT SALJU' : 'LIHAT HUJAN' };
  if (!s.alt || Math.random() < 0.45) return s;
  const v = s.alt[Math.floor(Math.random() * s.alt.length)];
  return { ...s, label: v.label, pose: v.pose ?? s.pose, prop: v.prop ?? s.prop };
}
const ROAM = SPOTS.filter((q) => q.zone !== 'boss' && !q.id.startsWith('bsofa'));
function choose(p: Person, S: Record<string, Status>, a: Agent, taken: Set<string>, now: number, all: Record<string, Agent>): { act: Spot; dwell: number } {
  const s = S[p.id], r = Math.random(), rnd = (lo: number, hi: number) => (lo + Math.random() * (hi - lo)) * 1000;
  const pick = (list: Spot[]) => { const f = list.filter((q) => !taken.has(q.id)); return f.length ? variant(f[Math.floor(Math.random() * f.length)], now) : p.seat; };
  const near = (id: string, label: string): Spot => {
    const q = PEOPLE.find((x) => x.id === id)!.seat;
    if (q.room === 1 && q.x < 3) return { id: `near-${id}-${p.id}`, room: 1, x: 3.15, y: q.y + 0.6, face: 'nx', pose: 'stand', label };
    return q.face === 'ny' ? { id: `near-${id}-${p.id}`, room: q.room, x: q.x + 0.75, y: q.y + 0.6, face: 'ny', pose: 'stand', label } : { id: `near-${id}-${p.id}`, room: q.room, x: q.x + 0.8, y: q.y + 0.65, face: 'nx', pose: 'stand', label };
  };
  const ev = EV.cur;
  if (ev && now < ev.until && ev.plans[p.id]?.length) return ev.plans[p.id].shift()!;
  if (a.queue?.length) return a.queue.shift()!;
  if (p.id === 'tamu') return { act: sp('ev-tamu-out', 2, 13.5, 0.7, 'ny', 'PULANG', { prop: 'vanish' }), dwell: 60_000 };
  if (p.id === 'kurir') return { act: sp('ev-kurir-out', FLAT ? 2 : a.room, LIFT.x, LIFT.y, 'ny', 'PULANG', { prop: 'vanish' }), dwell: 60_000 };
  // Marcel and Ny. Vetrycia go home at night (the bots keep working overtime), and clock in again in the morning
  if ((p.id === 'bos' || p.id === 'vet') && awayHours(now)) return { act: sp(`pulang-${p.id}`, 2, LIFT.x, LIFT.y, 'ny', 'PULANG', { prop: 'vanish' }), dwell: 120_000 };
  if ((p.id === 'bos' || p.id === 'vet') && a.act.id === `pulang-${p.id}`) { a.queue = [{ act: { ...p.seat, label: p.id === 'vet' ? 'NONTON DRAKOR' : 'NGITUNG CUAN', prop: p.id === 'vet' ? 'tablet' : undefined }, dwell: rnd(20, 30) }]; return { act: { ...X.absen, id: `absen-${p.id}`, label: 'ABSEN PAGI' }, dwell: rnd(2.5, 4) }; }
  if (p.id === 'ob') {           // Udin the office boy: cleaning, coffee for the boss, water gallons, feeding the cat
    const h = new Date(now).getHours(), late = h >= 21 || h < 6, bos = all.bos;
    if (a.act.id !== p.seat.id && r < 0.25) return { act: p.seat, dwell: rnd(8, 16) };
    const job = Math.random();
    if (job < (late ? 0.45 : 0.22)) { const rm = Math.floor(Math.random() * 3); return { act: sp(`pel-${rm}`, rm, 1.5 + Math.random() * 9.5, 1.6 + Math.random() * 8, 'px', 'NGEPEL', { prop: 'mop' }), dwell: rnd(9, 15) }; }
    if (job < (late ? 0.6 : 0.34)) { const rm = Math.floor(Math.random() * 3); return { act: sp(`lap-${rm}`, rm, 0.8, 2 + Math.random() * 6.5, 'nx', 'LAP JENDELA', { prop: 'rag' }), dwell: rnd(7, 12) }; }
    if (job < 0.48 && bos && bos.act.id === 'seat-bos' && !bos.path.length && !taken.has('kopibos')) { a.queue = [{ act: { ...X.kopiBos }, dwell: rnd(3.5, 5) }]; return { act: { ...SPOTS.find((q) => q.id === 'coffee')!, id: 'ob-kopi', label: 'BIKIN KOPI BOS' }, dwell: rnd(4, 6) }; }
    if (job < 0.58) { const rm = Math.random() < 0.5 ? 1 : 2; return { act: sp(`galon-${rm}`, rm, rm === 1 ? 7.6 : 2.6, 1.25, 'ny', 'GANTI GALON', { prop: 'galon' }), dwell: rnd(5, 8) }; }
    if (job < 0.68) { CATCALL.at = now; return { act: { ...X.bowl }, dwell: rnd(5, 8) }; }
    if (job < 0.76) return { act: { ...SPOTS.find((q) => q.id === 'trash')!, id: 'ob-trash' }, dwell: rnd(4, 6) };
    if (job < 0.92) return { act: { ...SPOTS.find((q) => q.id === 'eat3')!, id: 'ob-rest', label: 'ISTIRAHAT', prop: 'cup' }, dwell: rnd(10, 18) };
    return { act: { ...SPOTS.find((q) => q.id === 'sink')!, id: 'ob-sink', label: 'CUCI PIRING' }, dwell: rnd(6, 10) };
  }
  if (p.id === 'jaga') {
    if (s.label === 'ALARM') return { act: { ...p.seat, label: 'ALARM' }, dwell: 4000 };
    if (a.patrol > 0 && a.patrol <= PATROL.length) { const w = PATROL[a.patrol - 1]; a.patrol++; return { act: w, dwell: rnd(1.2, 3) }; }
    if (a.act.id === p.seat.id) {
      if (r < 0.2) return { act: sp('cekpintu', 2, 13.9, 1.1, 'ny', 'CEK PINTU'), dwell: rnd(3, 6) };
      a.patrol = 2; return { act: PATROL[0], dwell: rnd(1.5, 3) };
    }
    a.patrol = 0; return { act: { ...p.seat, label: Math.random() < 0.5 ? 'CEK CCTV' : 'JAGA' }, dwell: rnd(18, 35) };
  }
  if (p.id === 'vet') {      // the big boss only eats, sleeps and watches Korean dramas, and breaks it up when Marcel yells at someone
    const m = all.bos;
    if (m && m.act.whip && m.room >= 0) return { act: { id: 'melerai', room: m.room, x: m.x, y: m.y, face: 'px', pose: 'stand', label: 'MAU MELERAI', whip: 'bos' }, dwell: 9000 };
    if (r < 0.42) return { act: { ...p.seat, label: 'NONTON DRAKOR', prop: 'tablet' }, dwell: rnd(25, 45) };
    if (r < 0.52) return { act: { ...p.seat, label: 'MASKERAN', prop: 'tablet' }, dwell: rnd(18, 30) };
    if (r < 0.6) return { act: { ...p.seat, label: 'BELANJA ONLINE', prop: 'hp' }, dwell: rnd(12, 20) };
    if (r < 0.72) return { act: { ...p.seat, label: 'MAKAN', prop: 'food' }, dwell: rnd(10, 18) };
    if (r < 0.88) return { act: { ...p.seat, label: 'TIDUR', pose: 'nap' }, dwell: rnd(15, 30) };
    if (r < 0.95 && !taken.has('bsofa1')) return { act: { ...SPOTS.find((q) => q.id === 'bsofa1')!, label: 'TIDUR', pose: 'nap' }, dwell: rnd(15, 30) };
    return { act: { ...SPOTS.find((q) => q.id === 'fridge')!, id: 'vet-snack', label: 'AMBIL CEMILAN' }, dwell: rnd(4, 7) };
  }
  if (p.id === 'bos') {
    const victims = WORKERS.filter((id) => all[id] && !inEvent(id, now) && !S[id]?.sleep && S[id]?.label !== 'LIBUR' && !(all[id].act.prop === 'vanish' && !all[id].path.length) && !all[id].pending);
    const sl = victims.filter((id) => S[id]?.sl);
    const slack = victims.filter((id) => { const v = all[id]; return !v.act.id.startsWith('seat-') && !v.path.length; });
    const mad = sl.length ? sl : r < 0.45 && slack.length ? slack : r < 0.55 ? victims : [];
    if (mad.length && now - a.angryAt > 15_000) {
      const id = mad[Math.floor(Math.random() * mad.length)];
      a.angryAt = now; a.chase = 0;
      return { act: { id: `whip-${id}`, room: all[id].room, x: all[id].x, y: all[id].y, face: 'px', pose: 'stand', label: sl.includes(id) ? 'MARAH (SL!)' : 'MARAH', whip: id }, dwell: rnd(9, 12) };
    }
    if (a.act.id !== p.seat.id && r < 0.72) return { act: { ...p.seat, label: ['NGITUNG CUAN', 'CEK LAPORAN', 'BACA KORAN', 'NGOPI SANTAI'][Math.floor(Math.random() * 4)] }, dwell: rnd(12, 25) };
    if (r < 0.82) { const [rm, x, y] = PACE[Math.floor(Math.random() * PACE.length)]; return { act: { id: `pace-${rm}-${x}`, room: rm, x, y, face: 'py', pose: 'stand', label: rm === 1 ? 'INSPEKSI' : 'MONDAR-MANDIR' }, dwell: rnd(2, 4) }; }
    return { act: pick(SPOTS.filter((q) => ['golf', 'safe', 'trophy', 'tv', 'coffee', 'bwin'].includes(q.id))), dwell: rnd(6, 11) };
  }
  if (s.sleep || s.label === 'KIRIM PESAN') return { act: p.seat, dwell: 4000 };
  if (s.tp && a.celebrated !== (s.tag?.text ?? '')) { a.celebrated = s.tag?.text ?? ''; return { act: { ...p.seat, pose: 'jump', label: 'SELEBRASI TP' }, dwell: 7000 }; }
  if (a.run) { a.run = false; return { act: p.seat, dwell: rnd(25, 45) }; }
  if (s.label.startsWith('POSISI')) {
    if (!a.act.id.startsWith('seat-') && r < 0.9) return { act: p.seat, dwell: rnd(25, 50) };
    return r < 0.8 ? { act: p.seat, dwell: rnd(25, 50) } : { act: pick(SPOTS.filter((q) => ['water', 'win1', 'win2', 'win3', 'tv', 'stretch', 'trash', 'board', 'printer'].includes(q.id))), dwell: rnd(5, 9) };
  }
  if (s.label === 'LIBUR' && r < 0.3) { const f = [X.karaoke, X.gitar].filter((q) => !taken.has(q.id)); if (f.length) return { act: { ...f[Math.floor(Math.random() * f.length)] }, dwell: rnd(15, 25) }; }
  if (s.label === 'LIBUR') return { act: pick(ROAM.filter((q) => q.zone === 'lounge' || q.zone === 'break' || q.zone === 'eat' || q.zone === 'gym' || q.id === 'hp')), dwell: rnd(10, 22) };
  if (!a.act.id.startsWith('seat-') && r < 0.4) {
    const h = new Date(now).getHours(), late = h >= 22 || h < 6;
    if (p.id === 'tg') return { act: { ...p.seat, label: any1(['BALAS CHAT', 'BALAS CHAT', 'KIRIM SINYAL', 'CEK GRUP']) }, dwell: rnd(15, 35) };
    if (late && Math.random() < 0.4) return { act: { ...p.seat, label: 'NGANTUK' }, dwell: rnd(15, 30) };
    const v = any1<Partial<Spot>>([{ label: 'MEMANTAU' }, { label: 'MEMANTAU' }, { label: 'ANALISA CHART' }, { label: 'CATAT JURNAL', prop: 'paper' }, { label: 'MINUM KOPI', prop: 'cup' },
      { label: 'MAIN HP', prop: 'hp' }, { label: 'NGEMIL', prop: 'food' }, { label: 'BACA BERITA' }, { label: 'TELPON', prop: 'hp' }]);
    return { act: { ...p.seat, ...v }, dwell: rnd(15, 35) };
  }
  if (r < 0.5 && PARTNER[p.id]) return { act: near(PARTNER[p.id], Math.random() < 0.5 ? 'NGOBROL' : 'LIHAT CHART TEMAN'), dwell: rnd(6, 12) };
  const x = Math.random(), cat = CATREF;
  if (x < 0.14 && cat && cat.mode !== 'walk' && !cat.hop && cat.z < 8 && !taken.has('elus')) {
    const tx = cat.x + 0.55, ty = cat.y + 0.45; cat.until = Math.max(cat.until, now + 14_000);
    return { act: sp('elus', cat.room, tx, ty, faceTo(cat.x - tx, cat.y - ty), 'ELUS KUCING', { pose: cat.z < 1 ? 'squat' : 'stand', say: ['Pus, pus~', '#1e1f23'] }), dwell: rnd(6, 10) };
  }
  if (x < 0.22 && taken.has('toilet')) return { act: sp(`antri-${p.id}`, 2, 4.7, 1.45 + Math.random() * 0.4, 'ny', 'ANTRI TOILET', { say: ['Lama banget sih…', '#1e1f23'] }), dwell: rnd(5, 8) };
  if (x < 0.3 && all.bos && all.bos.act.id === 'seat-bos' && !all.bos.path.length && !taken.has('ttd')) return { act: { ...X.ttd }, dwell: rnd(5, 8) };
  if (x < 0.36 && new Date(now).getHours() >= 7 && new Date(now).getHours() < 10 && !taken.has('absen')) return { act: { ...X.absen }, dwell: rnd(2.5, 4) };
  return { act: pick(ROAM), dwell: rnd(7, 16) };
}
const liftSpot = (room: number, id: string, up: boolean): Spot => (FLAT
  ? { id: `lift-${id}`, room, x: up ? 0.6 : NX - 0.6, y: DOOR_Y, face: up ? 'nx' : 'px', pose: 'stand', label: 'JALAN' }
  : { id: `lift-${id}`, room, x: lwX(room), y: LIFT_WAIT, face: 'ny', pose: 'stand', label: 'TUNGGU LIFT' });

/** a smiling portrait (head + shoulders) of one of the team, drawn with the same code as in the office; cached as a data URL */
const PORTRAIT: Record<string, string> = {};
function portrait(id: string): string {
  if (PORTRAIT[id] !== undefined) return PORTRAIT[id];
  const p = PEOPLE.find((q) => q.id === id); if (!p || typeof document === 'undefined') return '';
  try {
    // 1) draw the whole person big on a clear canvas, 2) find the head (top of the drawing), 3) frame head + shoulders on a sunburst
    const B = 700, big = document.createElement('canvas'); big.width = B; big.height = B;
    const b = big.getContext('2d')!;
    const spot: Spot = { ...p.seat, id: 'portrait', pose: 'stand', label: 'SELEBRASI TP', prop: undefined, face: 'py' };
    const a = { room: 0, pending: null, hiddenUntil: 0, x: 5, y: 5, vx: 0, vy: 0, face: 'py', path: [], act: spot, until: 0, dist: 0, speed: 1, carry: null, carryUntil: 0, patrol: 0, last: '', run: false,
      scoldUntil: 0, scoldBy: '', bubble: null, chase: 0, celebrated: '', angryAt: 0 } as unknown as Agent;
    const [sx, sy] = iso(5, 5), k = 4;
    b.setTransform(k, 0, 0, k, B / 2 - sx * k, B * 0.95 - sy * k);
    drawPerson(b, p, a, 1.3, { label: 'SELEBRASI', color: '#2ee59d', sleep: false, tp: true, tag: null }, null);
    const px = b.getImageData(0, 0, B, B).data;
    let top = -1, l = B, r = 0;
    for (let y = 0; y < B && top < 0; y++) for (let x = 0; x < B; x++) if (px[(y * B + x) * 4 + 3] > 40) { top = y; break; }
    if (top < 0) throw new Error('empty');
    const band = Math.min(B, top + 120);
    for (let y = top; y < band; y++) for (let x = 0; x < B; x++) if (px[(y * B + x) * 4 + 3] > 40) { if (x < l) l = x; if (x > r) r = x; }
    const side = Math.max(r - l, 120) * 1.25, cx = (l + r) / 2, y0 = top - side * 0.08;
    const W0 = 240, cv = document.createElement('canvas'); cv.width = W0; cv.height = W0;
    const c = cv.getContext('2d')!;
    const g = c.createLinearGradient(0, 0, 0, W0); g.addColorStop(0, '#fff3d6'); g.addColorStop(1, '#ffd98a'); c.fillStyle = g; c.fillRect(0, 0, W0, W0);
    c.fillStyle = 'rgba(255,255,255,.55)'; for (let q = 0; q < 12; q++) { const an = (q / 12) * Math.PI * 2; c.beginPath(); c.moveTo(W0 / 2, W0 * 0.4); c.arc(W0 / 2, W0 * 0.4, W0, an, an + 0.18); c.closePath(); c.fill(); }
    c.drawImage(big, cx - side / 2, y0, side, side, 0, 0, W0, W0);
    PORTRAIT[id] = cv.toDataURL('image/png');
  } catch { PORTRAIT[id] = ''; }
  return PORTRAIT[id];
}
/** a group selfie for one TP: the trader in front holding the phone, the team crowding in behind.
 *  Every TP gets its own picture (scene, who stands where, poses) from its id, so they all look different. */
const SELFIE: Record<string, string> = {};
function selfie(key: string, title: string, when: string, pid: string): string {
  if (SELFIE[key]) return SELFIE[key];
  if (typeof document === 'undefined') return '';
  try {
    const R = (k: string) => hash(`${key}:${k}`);
    const Q = 2.4, Wd = 560, Hd = 420, cv = document.createElement('canvas'); cv.width = Wd * Q; cv.height = Hd * Q;
    const c = cv.getContext('2d')!; c.scale(Q, Q); c.imageSmoothingQuality = 'high';
    // the scene behind them
    const scene = Math.floor(R('scene') * 4);
    if (scene === 0) {            // office wall with wood panels and the LIVE board
      c.fillStyle = '#f1e3c8'; c.fillRect(0, 0, Wd, Hd); c.fillStyle = '#a8774c'; c.fillRect(0, Hd * 0.62, Wd, Hd);
      for (let x = 0; x < Wd; x += 34) { c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(x, Hd * 0.62, 2, Hd); }
      c.fillStyle = '#0d1424'; c.fillRect(Wd * 0.55, Hd * 0.08, Wd * 0.38, Hd * 0.3); c.fillStyle = '#2ee59d'; c.font = '800 22px ui-monospace, Menlo, monospace'; c.fillText(title, Wd * 0.58, Hd * 0.27);
      c.fillStyle = '#ff4d4f'; c.beginPath(); c.arc(Wd * 0.585, Hd * 0.14, 5, 0, 7); c.fill(); c.fillStyle = '#fff'; c.font = '800 13px ui-monospace, Menlo, monospace'; c.fillText('LIVE', Wd * 0.605, Hd * 0.155);
    } else if (scene === 1) {     // big window, city in the sky
      const g = c.createLinearGradient(0, 0, 0, Hd); g.addColorStop(0, '#7fb6e6'); g.addColorStop(1, '#d6ecfb'); c.fillStyle = g; c.fillRect(0, 0, Wd, Hd);
      for (let k = 0; k < 14; k++) { const h = 60 + R(`b${k}`) * 160; c.fillStyle = k % 2 ? '#9fb7cf' : '#b7c9db'; c.fillRect(k * 42 - 10, Hd * 0.75 - h, 36, h + 200); }
      c.fillStyle = '#4a5160'; for (const x of [0, Wd / 3, (2 * Wd) / 3]) c.fillRect(x - 4, 0, 8, Hd); c.fillRect(0, Hd * 0.45, Wd, 6);
    } else if (scene === 2) {     // party: confetti and a banner
      const g = c.createLinearGradient(0, 0, Wd, Hd); g.addColorStop(0, '#ffd2e5'); g.addColorStop(1, '#ffe9a8'); c.fillStyle = g; c.fillRect(0, 0, Wd, Hd);
      const cols = ['#e5484d', '#f2c230', '#2ee59d', '#4c7dff', '#c792ea'];
      for (let k = 0; k < 90; k++) { c.fillStyle = cols[k % 5]; c.save(); c.translate(R(`cx${k}`) * Wd, R(`cy${k}`) * Hd); c.rotate(R(`cr${k}`) * 6); c.fillRect(-4, -2, 8, 4); c.restore(); }
      c.strokeStyle = '#a8774c'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 30); c.quadraticCurveTo(Wd / 2, 70, Wd, 30); c.stroke();
      for (let k = 0; k < 12; k++) { const x = 20 + k * 45, y = 30 + Math.sin((k / 11) * Math.PI) * 38; c.fillStyle = cols[k % 5]; c.beginPath(); c.moveTo(x - 12, y); c.lineTo(x + 12, y); c.lineTo(x, y + 22); c.closePath(); c.fill(); }
    } else {                      // night: the city lights behind the glass
      const g = c.createLinearGradient(0, 0, 0, Hd); g.addColorStop(0, '#0b1430'); g.addColorStop(1, '#25335c'); c.fillStyle = g; c.fillRect(0, 0, Wd, Hd);
      for (let k = 0; k < 14; k++) { const h = 80 + R(`n${k}`) * 180, x = k * 42 - 10; c.fillStyle = '#18213d'; c.fillRect(x, Hd * 0.8 - h, 36, h + 200); for (let w = 0; w < 18; w++) if (R(`w${k}${w}`) > 0.55) { c.fillStyle = '#ffd979'; c.fillRect(x + 5 + (w % 3) * 10, Hd * 0.8 - h + 8 + Math.floor(w / 3) * 16, 5, 7); } }
    }
    // who: two neat rows, nobody hiding anybody; the TP trader in the middle in front, biggest
    const others = ['alt', 'big', 'xau', 'nas', 'tg', 'bos', 'vet', 'ob', 'jaga'].filter((id) => id !== pid).sort((a, b) => R(`o${a}`) - R(`o${b}`));
    const back = others.slice(0, 4), front = others.slice(4, 8);
    const draw = (id: string, X: number, Y: number, k: number, face: Face) => {
      const p = PEOPLE.find((q) => q.id === id); if (!p) return;
      const pose: Pose = R(`p${id}`) > 0.8 ? 'jump' : 'stand';
      const spot: Spot = { ...p.seat, id: 'selfie', pose, label: R(`l${id}`) > 0.35 ? 'SELEBRASI' : 'NGOBROL', prop: undefined, face };
      const a = { room: 0, pending: null, hiddenUntil: 0, x: 5, y: 5, vx: 0, vy: 0, face, path: [], act: spot, until: 0, dist: 0, speed: 1, carry: null, carryUntil: 0, patrol: 0, last: '', run: false,
        scoldUntil: 0, scoldBy: '', bubble: null, chase: 0, celebrated: '', angryAt: 0 } as unknown as Agent;
      const [sx, sy] = iso(5, 5);
      c.save(); c.translate(X, Y); c.scale(k, k); c.translate(-sx, -sy);
      drawPerson(c, p, a, 0.4 + R(`t${id}`) * 3, { label: 'SELEBRASI', color: '#2ee59d', sleep: false, tp: true, tag: null }, null);
      c.restore();
    };
    back.forEach((id, i) => draw(id, Wd * (0.2 + i * 0.2), Hd * 0.74, 3.0, i < 2 ? 'px' : 'py'));
    [0.1, 0.27, 0.73, 0.9].forEach((x, i) => front[i] && draw(front[i], Wd * x, Hd * 0.98, 3.6, x < 0.5 ? 'px' : 'py'));
    draw(pid || 'alt', Wd * 0.5, Hd * 1.16, 4.6, R('tf') > 0.5 ? 'px' : 'py');
    // the selfie arm going to the camera, a flash and the caption
    c.strokeStyle = '#2a1d14'; c.lineWidth = 3;
    const fl = c.createRadialGradient(Wd * 0.1, Hd * 0.1, 0, Wd * 0.1, Hd * 0.1, Wd * 0.5); fl.addColorStop(0, 'rgba(255,255,255,.45)'); fl.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = fl; c.fillRect(0, 0, Wd, Hd);
    c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(0, Hd - 46, Wd, 46);
    c.fillStyle = '#fff'; c.font = '800 20px system-ui, sans-serif'; c.textBaseline = 'middle'; c.fillText(`🎉 ${title}`, 14, Hd - 23);
    c.textAlign = 'right'; c.font = '600 13px system-ui, sans-serif'; c.fillText(when, Wd - 14, Hd - 23);
    SELFIE[key] = cv.toDataURL('image/jpeg', 0.9);
  } catch { SELFIE[key] = ''; }
  return SELFIE[key];
}
const fmtDay = (t: number) => { const d = new Date(t); return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][d.getMonth()]} ${d.getFullYear()} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/* ---------- component ---------- */
export default function Office({ data, now, screen = [], full = false, onSwipe, theme = 'lukis', shape = 'tower' }: { data: OfficeData; now: number; screen?: ScreenLine[]; full?: boolean; onSwipe?: () => void; theme?: string; shape?: string }) {
  THEME = THEMES[theme] ?? THEMES.modern; setShape(shape); INK = THEME.ink ?? (THEME.paint ? 'rgba(80,45,25,.42)' : null); OL = THEME.pixel ? 'rgba(10,10,18,.9)' : OL; PSV = INK ? 1.62 : PS;
  const themeRef = useRef(theme); themeRef.current = theme;
  const lhRef = useRef(H), homeRef = useRef({ ...HOME });
  const swipeRef = useRef(onSwipe); swipeRef.current = onSwipe;
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useMemo(() => statuses(data, now), [data, now]);
  const dataRef = useRef(data); dataRef.current = data;
  const stRef = useRef(st); stRef.current = st;
  const scrRef = useRef(screen); scrRef.current = screen;
  const positions = useMemo(() => openPositions(data), [data]);
  const posRef = useRef(positions); posRef.current = positions;
  const items = useMemo(() => furniture(theme), [theme]);
  const grids = useMemo(() => items.map((list) => buildGrid(list)), [items]);
  const night = (() => { const h = new Date(now).getHours(); return h >= 18 || h < 6; })();
  const nightRef = useRef(night); nightRef.current = night;
  const view = useRef({ ...HOME });
  const fullRef = useRef(full); fullRef.current = full;
  const driftRef = useRef(false);
  const [zoomed, setZoomed] = useState(false);
  // ---- gallery of moments: a photo of the office at every take-profit (and on demand), kept on this device ----
  type Shot = { id: string; at: number; text: string; img: string };
  const [shots, setShots] = useState<Shot[]>([]);
  const [gallery, setGallery] = useState(false);
  const [big, setBig] = useState<Shot | null>(null);
  // every TP in the journal is in the gallery as a team selfie (drawn, a different one for every TP)
  const moments = useMemo(() => {
    const coin = (t: JournalTrade) => (/Bot Binance ([0-9A-Z]+)/.exec(t.note ?? '')?.[1] ?? '').replace(/USDT$/, '');
    return data.trades.filter((t) => t.result === 'tp' && t.closedAt).map((t) => {
      const pnl = Number(t.pnl ?? 0), name = t.strategy === 'v2' ? 'XAU' : t.strategy === 'nas' ? 'NAS' : coin(t) || 'TP';
      const pid = ({ snr: 'alt', btc: 'big', v2: 'xau', nas: 'nas' } as Record<string, string>)[t.strategy] ?? 'alt';
      const who = PEOPLE.find((q) => q.id === pid)?.name ?? '';
      return { id: `tp-${t.id}`, at: Number(t.closedAt), text: `TP ${name} ${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`, who, side: String(t.side ?? ''), pid };
    }).sort((a, b) => b.at - a.at);
  }, [data.trades]);
  const photos = useMemo(() => shots.filter((x) => !x.id.startsWith('tp-')), [shots]);
  // selfies are drawn a few at a time while the gallery is open (so it opens at once)
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!gallery) return;
    let off = false;
    const todo = moments.filter((m) => !thumbs[m.id]);
    const step = () => {
      if (off || !todo.length) return;
      const m = todo.shift()!, img = selfie(m.id, m.text, fmtDay(m.at), m.pid);
      setThumbs((t) => ({ ...t, [m.id]: img }));
      window.setTimeout(step, 30);
    };
    step();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gallery, moments]);
  const [bigI, setBigI] = useState(-1);
  const GKEY = 'office-galeri';
  useEffect(() => { try { setShots(JSON.parse(localStorage.getItem(GKEY) ?? '[]')); } catch { /* storage off */ } }, []);
  const snap = (id: string, text: string) => {
    const cv = ref.current; if (!cv) return;
    try {
      const w = 420, h = Math.round((cv.height / cv.width) * w), o = document.createElement('canvas'); o.width = w; o.height = h;
      const oc = o.getContext('2d')!; oc.drawImage(cv, 0, 0, w, h);
      oc.fillStyle = 'rgba(0,0,0,.55)'; oc.fillRect(0, h - 34, w, 34); oc.fillStyle = '#fff'; oc.font = '700 15px system-ui, sans-serif'; oc.textBaseline = 'middle';
      oc.fillText(text, 12, h - 17);
      const d = new Date(); oc.textAlign = 'right'; oc.font = '600 12px system-ui, sans-serif';
      oc.fillText(`${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, w - 12, h - 17);
      const shot: Shot = { id, at: Date.now(), text, img: o.toDataURL('image/jpeg', 0.72) };
      setShots((prev) => {
        if (prev.some((x) => x.id === id)) return prev;
        const next = [shot, ...prev].slice(0, 40);
        for (let n = next.length; n > 0; n--) { try { localStorage.setItem(GKEY, JSON.stringify(next.slice(0, n))); break; } catch { /* full: keep fewer */ } }
        return next;
      });
    } catch { /* drawing not allowed: skip */ }
  };
  const snapRef = useRef(snap); snapRef.current = snap;
  // ---- the cat menu (top right): one button, many actions ----
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const say = (t: string) => { setToast(t); window.setTimeout(() => setToast(''), 2600); };
  const MENU: Array<[string, string, string]> = [
    ['dadakan', '📢', 'Panggil rapat'], ['galeri', '🖼️', 'Galeri momen'], ['foto', '📷', 'Foto kantor'], ['kopi', '☕', 'Udin bagi kopi'],
    ['pizza', '🍕', 'Pesan pizza'], ['senam', '🤸', 'Senam bareng'], ['kucing', '🐟', 'Kasih makan kucing'], ['ultah', '🎂', 'Pesta kejutan'], ['trade', '📈', 'Buka Trade'],
  ];
  const act = (k: string) => {
    setMenu(false);
    if (k === 'galeri') { setGallery(true); return; }
    if (k === 'foto') { window.setTimeout(() => { snapRef.current(`foto-${Date.now()}`, 'Foto kantor'); say('📷 Tersimpan di Galeri momen'); }, 300); return; }
    if (k === 'trade') { swipeRef.current?.(); return; }
    CALL.kind = k; CALL.at = Date.now(); CALL.res = '';
    const started: Record<string, string> = { dadakan: '📢 Semua dipanggil rapat!', kopi: '☕ Udin bikin kopi buat semua', pizza: '🍕 Pizza dipesan!', senam: '🤸 Ayo senam!', kucing: '🐟 Udin kasih makan kucing', ultah: '🎂 Pesta kejutan!' };
    let n = 0;
    const wait = window.setInterval(() => {
      n++;
      if (CALL.res === 'ok') { window.clearInterval(wait); say(started[k] ?? 'Oke!'); }
      else if (CALL.res === 'no' || n > 10) { window.clearInterval(wait); say('Belum bisa, orangnya sibuk/pulang'); }
    }, 300);
  };
  useEffect(() => {
    let off = false;
    const load = () => fetch('https://api.open-meteo.com/v1/forecast?latitude=37.57&longitude=126.98&current=weather_code').then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (off || !j) return; const w = Number(j?.current?.weather_code);
      WEATHER.kind = (w >= 71 && w <= 77) || w === 85 || w === 86 ? 'snow' : (w >= 51 && w <= 67) || (w >= 80 && w <= 82) || w >= 95 ? 'rain' : null;
    }).catch(() => {});
    load(); const id = window.setInterval(load, 20 * 60_000);
    return () => { off = true; window.clearInterval(id); };
  }, []);

  // pinch / pan / double tap / wheel zoom (page scroll keeps working while not zoomed)
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const V = view.current;
    const HOMEz = () => homeRef.current.z;
    const MINz = () => (FLAT ? Math.min(HOMEz(), (W / CW) * 0.98) : HOMEz());
    const clamp = () => { const LH = lhRef.current; V.z = Math.max(MINz(), Math.min(4, V.z)); V.tx = CW * V.z <= W ? (W - CW * V.z) / 2 : Math.min(0, Math.max(W - CW * V.z, V.tx)); V.ty = TOTAL * V.z <= LH ? (LH - TOTAL * V.z) / 2 : Math.min(0, Math.max(LH - TOTAL * V.z, V.ty)); setZoomed(V.z > HOMEz() + 0.01); cv.style.touchAction = fullRef.current || V.z > HOMEz() + 0.01 ? 'none' : 'pan-y'; };
    const pt = (cx: number, cy: number) => { const r = cv.getBoundingClientRect(); return [(cx - r.left) * W / r.width, (cy - r.top) * W / r.width] as const; };
    const zoomAt = (lx: number, ly: number, nz: number) => { const wx = (lx - V.tx) / V.z, wy = (ly - V.ty) / V.z; V.z = Math.max(MINz(), Math.min(4, nz)); V.tx = lx - wx * V.z; V.ty = ly - wy * V.z; clamp(); };
    let vpan = false, pinch: { d: number; z: number; wx: number; wy: number } | null = null, pan: { x: number; y: number } | null = null, lastTap = 0, sw: { x: number; y: number } | null = null;
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault(); sw = null;
        const a = e.touches[0], b = e.touches[1], [mx, my] = pt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z: V.z, wx: (mx - V.tx) / V.z, wy: (my - V.ty) / V.z }; pan = null;
      } else if (e.touches.length === 1) {
        const [x, y] = pt(e.touches[0].clientX, e.touches[0].clientY);
        const nowT = Date.now();
        const atHome = Math.abs(V.z - HOMEz()) < 0.01 && Math.abs(V.tx - homeRef.current.tx) < 1 && Math.abs(V.ty - homeRef.current.ty) < 1;
        if (nowT - lastTap < 300) { e.preventDefault(); if (!atHome) Object.assign(V, homeRef.current); else zoomAt(x, y, 2.4); clamp(); lastTap = 0; return; }
        lastTap = nowT;
        sw = !FLAT && V.z <= HOMEz() + 0.01 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
        if (FLAT || V.z > HOMEz() + 0.01) { e.preventDefault(); pan = { x, y }; } else { pan = { x, y }; vpan = true; }
      }
    };
    const tm = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const a = e.touches[0], b = e.touches[1], [mx, my] = pt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        V.z = Math.max(MINz(), Math.min(4, pinch.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d));
        V.tx = mx - pinch.wx * V.z; V.ty = my - pinch.wy * V.z; clamp();
      } else if (pan && e.touches.length === 1) {
        if (e.cancelable) e.preventDefault();
        const [x, y] = pt(e.touches[0].clientX, e.touches[0].clientY);
        if (vpan) { if (sw && Math.abs(e.touches[0].clientY - sw.y) > Math.abs(e.touches[0].clientX - sw.x)) { V.ty += y - pan.y; clamp(); } }
        else { V.tx += x - pan.x; V.ty += y - pan.y; clamp(); }
        pan = { x, y };
      }
    };
    const pick = (clientX: number, clientY: number) => {
      const r = cv.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
      let best = '', bd = 1e9;
      for (const tg of TAGHIT) { const inTag = x >= tg.x && x <= tg.x + tg.w && y >= tg.y && y <= tg.y + tg.h; const d = inTag ? 0 : Math.hypot(x - tg.ax, y - (tg.ay - 22)); if (d < bd) { bd = d; best = tg.id; } }
      if (best && bd < 34) { SEL.id = best; SEL.until = Date.now() + 5000; }
    };
    let tap: { x: number; y: number; t: number } | null = null;
    cv.addEventListener('touchstart', (e) => { tap = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null; }, { passive: true });
    cv.addEventListener('touchend', (e) => { const c0 = e.changedTouches[0]; if (tap && c0 && Date.now() - tap.t < 300 && Math.hypot(c0.clientX - tap.x, c0.clientY - tap.y) < 8) pick(c0.clientX, c0.clientY); tap = null; });
    cv.addEventListener('click', (e) => pick(e.clientX, e.clientY));
    const te = (e: TouchEvent) => {
      if (sw && !e.touches.length && e.changedTouches[0]) {      // horizontal swipe on the full-screen office opens Trade
        const dx = e.changedTouches[0].clientX - sw.x, dy = e.changedTouches[0].clientY - sw.y;
        if (Math.abs(dx) > 55 && Math.abs(dy) < Math.abs(dx) * 0.7) swipeRef.current?.();
      }
      if (e.touches.length) sw = null;
      if (e.touches.length < 2) pinch = null; if (!e.touches.length) { pan = null; vpan = false; }
    };
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey && V.z <= HOMEz() + 0.01 && e.deltaY > 0) return; e.preventDefault(); const [x, y] = pt(e.clientX, e.clientY); zoomAt(x, y, V.z * Math.exp(-e.deltaY * 0.0025)); };
    let drag: { x: number; y: number } | null = null;
    const md = (e: MouseEvent) => { if (FLAT || V.z > HOMEz() + 0.01) drag = { x: e.clientX, y: e.clientY }; };
    const mm = (e: MouseEvent) => { if (!drag) return; const r = cv.getBoundingClientRect(); V.tx += (e.clientX - drag.x) * W / r.width; V.ty += (e.clientY - drag.y) * W / r.width; drag = { x: e.clientX, y: e.clientY }; clamp(); };
    const mu = () => { drag = null; };
    const dbl = (e: MouseEvent) => { const [x, y] = pt(e.clientX, e.clientY); if (V.z > HOMEz() + 0.01) { Object.assign(V, homeRef.current); clamp(); } else zoomAt(x, y, 2.4); };
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
    let bgV: { z: number; tx: number; ty: number } | null = null, bgM = 0, bgW = 0, bgH = 0, lastView = '', viewMoved = 0;
    let k = 1, css = 1, dpr = 1, bg: HTMLCanvasElement | null = null, bgKey = '', raf = 0, last = performance.now(), visible = true;
    loadPhoto(() => { bgKey = ''; });
    const agents: Record<string, Agent> = {};
    let evAt = 0, mopAt = 0, shooAt = 0, skyCol = '';
    const cat: Cat = { room: 1, x: 7.5, y: 5.1, z: 0, vx: 0, vy: 0, dx: 1, dy: 0, path: [], spot: CAT_SPOTS[6], mode: 'sleep', until: Date.now() + 8000, hidden: 0, pending: null, hop: null, meow: 0 };
    CATREF = cat;
    const resize = () => {
      const w = box0.clientWidth || W; dpr = THEME.pixel ? 1 : Math.min(3, window.devicePixelRatio || 1); cv.style.imageRendering = THEME.pixel ? 'pixelated' : '';
      const h = fullRef.current ? box0.clientHeight || w * TOTAL / W : w * TOTAL / W;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); k = cv.width / W; css = w / W; bgKey = '';
      const LH = W * h / w, z = FLAT ? Math.min(1.2, LH / TOTAL) : SHAPE === 'zigzag' ? Math.min(W / (W + 76), (LH / TOTAL) * 1.1) : fullRef.current ? Math.min(1.12, (LH / TOTAL) * 0.99) : Math.min(1, LH / TOTAL);
      const atHome = Math.abs(view.current.z - homeRef.current.z) < 0.01;
      const cx1 = roomX(1) + OX + (NX - NY) * TW * 0.5;
      lhRef.current = LH; homeRef.current = { z, tx: FLAT ? Math.min(0, Math.max(W - CW * z, W / 2 - cx1 * z)) : (W - W * z) / 2, ty: (LH - TOTAL * z) / 2 + (fullRef.current && !FLAT ? 0 : 0) };   // full screen: a little lower
      if (atHome) Object.assign(view.current, homeRef.current);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(box0);
    const frame = (tm: number) => {
      if (!visible) return;
      raf = requestAnimationFrame(frame);
      if (document.visibilityState !== 'visible') { last = tm; return; }
      const dt = Math.min(0.05, (tm - last) / 1000); last = tm;
      const t = tm / 1000, wall = Date.now(), S0 = stRef.current;
      const S: Record<string, Status> = { ...S0, ...(EV.cur?.courier && wall < EV.cur.until ? { kurir: { label: 'TAMU', color: '#f2c230', sleep: false, tag: null } } : {}), ...(EV.cur?.guest && wall < EV.cur.until ? { tamu: { label: 'TAMU', color: '#f2c230', sleep: false, tag: null } } : {}) };
      CAL = dataRef.current.cal ?? [];
      if (wall - evAt > 500) { evAt = wall; scheduleEvents({ agents, S, wall, data: dataRef.current }); }
      for (const id of WORKERS) { const s = S[id]; MODES[id] = !s || s.label === 'BELUM AKTIF' || s.sleep ? 'off' : s.label.startsWith('POSISI') ? 'pos' : 'idle'; }
      MODES.tgSend = S.tg?.label === 'KIRIM PESAN' ? 'pos' : 'off';
      MODES.alarm = S.jaga?.label === 'ALARM' ? 'pos' : 'off';
      /* ---- simulate ---- */
      const taken = new Set<string>(Object.values(agents).map((a) => a.act.id));
      for (const p of PEOPLE) {
        const s = S[p.id];
        if (!s || s.label === 'BELUM AKTIF') { delete agents[p.id]; continue; }
        let a = agents[p.id];
        const fresh = !a;
        if (!a) a = agents[p.id] = { room: p.seat.room, pending: null, hiddenUntil: 0, x: p.seat.x, y: p.seat.y, vx: 0, vy: 0, face: p.seat.face, path: [], act: p.id === 'vet' ? { ...p.seat, prop: 'tablet' } : p.seat, until: wall + 2000 + Math.random() * 9000, dist: 0, speed: 1.45, carry: null, carryUntil: 0, patrol: 0, last: s.label, run: false, scoldUntil: 0, scoldBy: '', bubble: null, chase: 0, celebrated: s.tp ? s.tag?.text ?? '' : '', angryAt: wall - 6000 };
        if (fresh && p.id === 'tamu') { a.hiddenUntil = wall + 1200; a.until = 0; a.face = 'py'; }
        if (fresh && p.id === 'kurir') { a.hiddenUntil = wall + 1200; a.carry = 'box'; a.carryUntil = wall + 14_000; a.until = 0; a.face = 'py'; }
        if (wall < a.hiddenUntil) continue;                                          // riding the lift
        if (wall < a.scoldUntil) { a.path = []; a.vx = a.vy = 0; continue; }          // frozen while being yelled at
        // arrived at the lift with somewhere to go: ride to the other floor, step out, walk on
        if (FLAT && a.pending && !a.path.length && a.act.id.startsWith('lift-')) {      // through the partition into the next room
          const nx = a.pending, next = hopRoom(a.room, nx.room), right = next > a.room;
          a.room = next; a.x = right ? 0.6 : NX - 0.6; a.y = DOOR_Y;
          if (next === nx.room) { a.pending = null; a.act = nx; } else a.act = liftSpot(next, p.id, nx.room < next);
          a.path = findPath(grids[a.room], a.x, a.y, a.act.x, a.act.y);
          continue;
        }
        if (a.pending && !a.path.length && a.act.id.startsWith('lift-')) {
          if (SHAPE === 'tower' && wall < LIFTCTL.busyUntil) { a.face = 'ny'; a.vx = a.vy = 0; continue; }      // the lift is busy: wait for it
          const nx = a.pending; a.pending = null;
          const from = a.room, dA = Math.abs(LIFTPOS.r - from) * 1100, dB = 1700, dC = Math.abs(nx.room - from) * 1400, dD = 1700;
          const ride: Ride = { from, to: nx.room, start: LIFTPOS.r, t0: wall, dA, dB, dC, dD, dur: dA + dB + dC + dD };
          const dur = ride.dur;
          a.ride = ride; LIFTCTL.busyUntil = wall + dur; LIFTCTL.ride = ride; LIFTCTL.who = p.id;
          a.room = nx.room; a.x = lwX(nx.room); a.y = LIFT_WAIT; a.vx = a.vy = 0; a.hiddenUntil = wall + dur; a.face = 'py';
          a.act = nx; a.until = Math.max(a.until, wall + dur); a.path = findPath(grids[a.room], a.x, a.y, nx.x, nx.y);
          continue;
        }
        const bosYelling = p.id === 'vet' && !!agents.bos?.act.whip && a.act.id !== 'melerai';
        const forced = ((s.sleep || s.label === 'KIRIM PESAN' || s.label === 'ALARM') && a.act.id !== p.seat.id) || bosYelling;
        const changed = a.last !== s.label; a.last = s.label;
        if ((!a.path.length && wall > a.until) || forced || a.kick || (changed && s.label.startsWith('POSISI'))) {
          a.kick = false;
          taken.delete(a.act.id);
          if (a.act.prop && ['cup', 'food', 'can', 'paper', 'book'].includes(a.act.prop) && a.act.id !== 'plant') { a.carry = a.act.prop; a.carryUntil = wall + 20_000; }
          const nx = choose(p, S, a, taken, wall, agents);
          a.act = nx.act; a.until = wall + nx.dwell; taken.add(a.act.id); a.pending = null;
          if (a.act.room !== a.room) { a.pending = a.act; a.act = liftSpot(a.room, p.id, a.pending.room < a.room); }
          a.speed = a.run ? 2.7 : p.id === 'jaga' && s.label === 'ALARM' ? 2.6 : p.id === 'vet' && a.act.whip ? 2.5 : p.id === 'bos' && a.act.whip ? 2.1 : 1.35 + hash(p.id) * 0.25;
          a.path = Math.hypot(a.act.x - a.x, a.act.y - a.y) > 0.02 ? findPath(grids[a.room], a.x, a.y, a.act.x, a.act.y) : [];
          if (!a.path.length && a.act.say) a.bubble = { text: a.act.say[0], until: wall + 3800, color: a.act.say[1] };
          if (p.id === 'kurir' && a.act.id === 'ev-kurir-out') a.carry = null;
        }
        if (wall > a.carryUntil) a.carry = null;
        // the boss chases his victim, then yells and cracks the whip
        if ((p.id === 'bos' || p.id === 'vet') && a.act.whip) {
          const v = agents[a.act.whip];
          if (!v) a.until = 0;
          else if (v.room !== a.room || wall < v.hiddenUntil) {
            if (wall - a.chase > 800) { a.chase = wall; const target = { ...a.act, room: v.room, x: v.x, y: v.y }; a.pending = target; a.act = liftSpot(a.room, p.id, v.room < a.room); a.path = findPath(grids[a.room], a.x, a.y, a.act.x, a.act.y); a.until = Math.max(a.until, wall + 4000); }
          } else {
            const d = Math.hypot(v.x - a.x, v.y - a.y);
            if (d > 0.95 && wall - a.chase > 600 && wall >= v.scoldUntil) {
              a.chase = wall;
              const ang = Math.atan2(a.y - v.y, a.x - v.x), tx = v.x + Math.cos(ang) * 0.7, ty = v.y + Math.sin(ang) * 0.7;
              a.path = findPath(grids[a.room], a.x, a.y, tx, ty); a.act = { ...a.act, label: p.id === 'vet' ? 'MAU MELERAI' : 'NGEJAR' }; a.until = Math.max(a.until, wall + 3000);
            } else if (d <= 0.95) {
              a.path = []; a.vx = a.vy = 0; a.face = faceTo(v.x - a.x, v.y - a.y);
              if (p.id === 'vet') {
                if (!(a.bubble && wall < a.bubble.until)) {
                  const victim = v.act.whip ? agents[v.act.whip] : undefined;
                  a.bubble = { text: ['SUDAH, SUDAH!', 'JANGAN MARAH-MARAH!', 'MARCEL, STOP!', 'KASIHAN DIA…'][Math.floor(Math.random() * 4)], until: wall + 3500, color: '#2e9e5b' };
                  a.act = { ...a.act, label: 'MELERAI' }; a.until = wall + 3800;
                  v.bubble = { text: VET_SORRY[Math.floor(Math.random() * 4)], until: wall + 3500, color: '#1e1f23' };
                  v.act = { ...v.act, whip: undefined, label: 'DIMARAHI BIG BOS' }; v.until = wall + 3600; v.angryAt = wall; v.path = [];
                  if (victim) { victim.scoldUntil = wall; victim.bubble = { text: 'Makasih bu!', until: wall + 2500, color: '#1e1f23' }; }
                }
              } else if (wall >= v.scoldUntil && !(a.bubble && wall < a.bubble.until)) {
                const dur = 5500;
                a.until = wall + dur + 600;
                const sl = !!S[a.act.whip]?.sl;
                a.act = { ...a.act, label: sl ? 'MARAH (SL!)' : 'MARAH' };
                v.scoldUntil = wall + dur; v.scoldBy = p.id; v.path = []; v.face = faceTo(a.x - v.x, a.y - v.y);
                const yell = sl ? SL_YELL : YELL;
                a.bubble = { text: yell[Math.floor(Math.random() * yell.length)], until: wall + dur, color: '#e5242b' };
                v.bubble = { text: SORRY[Math.floor(Math.random() * 4)], until: wall + dur, color: '#1e1f23' };
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
            if (q === a || q.room !== a.room) continue; const ox = a.x - q.x, oy = a.y - q.y, od = Math.hypot(ox, oy);
            if (od > 0.001 && od < 0.42) { ax += (ox / od) * (0.42 - od) * 3; ay += (oy / od) * (0.42 - od) * 3; }
          }
          const kk = Math.min(1, dt * 7); a.vx += (ax - a.vx) * kk; a.vy += (ay - a.vy) * kk;
          const sp = Math.hypot(a.vx, a.vy);
          a.x += a.vx * dt; a.y += a.vy * dt; a.dist += sp * dt;
          if (sp > 0.25) { const nf = faceTo(a.vx, a.vy); if (nf !== a.face && (Math.abs(a.vx) > Math.abs(a.vy) * 1.25 || Math.abs(a.vy) > Math.abs(a.vx) * 1.25)) a.face = nf; }
          if ((!lastPt && d < 0.28) || (lastPt && d < 0.025)) {
            a.path.shift();
            if (!a.path.length) { a.x = gx; a.y = gy; a.vx = a.vy = 0; a.until = Math.max(a.until, wall + 2500); if (a.act.say) a.bubble = { text: a.act.say[0], until: wall + 3800, color: a.act.say[1] }; }
          }
        } else { a.vx *= 0.8; a.vy *= 0.8; }
      }
      // small talk: people chatting / singing / watching the news say something now and then
      for (const p of PEOPLE) {
        const a = agents[p.id]; if (!a || a.path.length || wall < a.scoldUntil || (a.bubble && wall < a.bubble.until + 1500)) continue;
        const lines = CHAT[a.act.label]; if (!lines) continue;
        if (wall - (a.talkAt ?? 0) > 3500 + hash(p.id + Math.floor(wall / 4000)) * 5000) { a.talkAt = wall; a.bubble = { text: lines[Math.floor(Math.random() * lines.length)], until: wall + 2600, color: '#1e1f23' }; }
      }
      // Udin's wet floor
      const ob = agents.ob;
      if (ob && !ob.path.length && ob.act.prop === 'mop' && wall - mopAt > 350) { mopAt = wall; MOPS.push({ room: ob.room, x: ob.x + 0.35 + (Math.random() - 0.5) * 0.7, y: ob.y + (Math.random() - 0.5) * 0.7, t: wall }); }
      while (MOPS.length && wall - MOPS[0].t > 25_000) MOPS.shift();
      const catAt = stepCat(cat, grids, dt, wall);
      // the cat lies down on a keyboard: the trader is not amused
      if (catAt && catAt.room === 1 && catAt.z > 10) {
        const ids = catAt.y < 5 ? ['alt', 'big'] : ['xau', 'nas'];
        for (const id of ids) { const a = agents[id]; if (a && a.act.id.startsWith('seat-') && !a.path.length) { a.bubble = { text: ['Kucing, minggir dong…', 'Eh, itu keyboard aku!', 'Aduh, chartnya ketutup'][Math.floor(Math.random() * 3)], until: wall + 4000, color: '#1e1f23' }; break; } }
      }
      // the cat in the boss room: Pentoel shoos it out
      const jg = agents.jaga;
      if (jg && cat.room === 0 && cat.mode !== 'walk' && !cat.hop && wall - shooAt > 40_000 && S.jaga?.label === 'AMAN' && !inEvent('jaga', wall)) {
        shooAt = wall; jg.queue = [{ act: sp('usir', 0, cat.x + 0.6, cat.y + 0.4, faceTo(-0.6, -0.4), 'USIR KUCING', { say: ['Hus! Hus! Keluar!', '#1e1f23'] }), dwell: 3500 }]; jg.kick = true;
      }
      if (jg && jg.act.id === 'usir' && jg.room === cat.room && Math.hypot(jg.x - cat.x, jg.y - cat.y) < 1.3 && !(cat.flee && wall < cat.flee)) { cat.flee = wall + 7000; cat.until = 0; cat.meow = wall + 1500; cat.meowText = 'MEONG!'; }
      BUSY.coffee = Object.values(agents).some((a) => a.act.id === 'coffee' && !a.path.length);
      BUSY.sink = Object.values(agents).some((a) => a.act.id === 'sink' && !a.path.length);
      BUSY.printer = Object.values(agents).some((a) => a.act.id === 'printer' && !a.path.length);
      BUSY.fridge = Object.values(agents).some((a) => a.act.id === 'fridge' && !a.path.length);
      BUSY.safe = Object.values(agents).some((a) => a.act.id === 'safe' && !a.path.length);
      BUSY.arcade = Object.values(agents).some((a) => a.act.id === 'arcade' && !a.path.length);
      BUSY.tread = Object.values(agents).some((a) => a.act.id === 'tread' && !a.path.length);
      /* ---- draw world: three rooms stacked ---- */
      const V = view.current, nightNow = nightRef.current;
      // the static rooms are painted into a picture the size of the screen (+ a margin). While you pinch or pan the
      // picture is only moved / scaled (cheap); once the view rests (or runs out of margin) it is painted sharp again.
      const viewKey = `${V.z.toFixed(4)}:${V.tx.toFixed(2)}:${V.ty.toFixed(2)}`;
      if (viewKey !== lastView) { lastView = viewKey; viewMoved = tm; }
      const base = `${cv.width}x${cv.height}:${nightNow}:${themeRef.current}:${SHAPE}:${PHOTO.ok}`;
      const sNow = bgV ? V.z / bgV.z : 1;
      const offX = bgV ? k * V.tx - sNow * (bgM + k * bgV.tx) : 0, offY = bgV ? k * V.ty - sNow * (bgM + k * bgV.ty) : 0;
      const outside = !bgV || offX > 0 || offY > 0 || offX + bgW * sNow < cv.width || offY + bgH * sNow < cv.height;
      const settled = tm - viewMoved > 160;
      if (!bg || base !== bgKey || ((outside || (settled && (bgV!.z !== V.z || bgV!.tx !== V.tx || bgV!.ty !== V.ty))))) {
        bgM = Math.round(Math.max(cv.width, cv.height) * 0.25); bgW = cv.width + 2 * bgM; bgH = cv.height + 2 * bgM;
        if (!bg || bg.width !== bgW || bg.height !== bgH) { bg = document.createElement('canvas'); bg.width = bgW; bg.height = bgH; }
                const b = bg.getContext('2d')!; b.setTransform(1, 0, 0, 1, 0, 0); b.fillStyle = skyTop(nightNow); b.fillRect(0, 0, bgW, bgH);
        b.setTransform(k * V.z, 0, 0, k * V.z, bgM + k * V.tx, bgM + k * V.ty); drawBackdrop(b, nightNow);
        if (SHAPE === 'zigzag') drawLiftTube(b, nightNow);
        if (FLAT) { b.save(); b.translate(roomX(2), roomY(2)); drawFlatGround(b, nightNow); b.restore(); }
        for (const r of ORDER()) { b.save(); b.translate(roomX(r), roomY(r)); drawStatic(b, nightNow, r); b.restore(); }
        if (SHAPE === 'rooftop') { b.save(); b.translate(0, TOPM - RH); drawRoofDeck(b, nightNow); b.restore(); }
        bgKey = base; bgV = { z: V.z, tx: V.tx, ty: V.ty };
      }
      c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = skyTop(nightNow); c.fillRect(0, 0, cv.width, cv.height);
      if (bg && bgV) { const s2 = V.z / bgV.z; c.drawImage(bg, k * V.tx - s2 * (bgM + k * bgV.tx), k * V.ty - s2 * (bgM + k * bgV.ty), bgW * s2, bgH * s2); }
      // the top edge of the screen fades into one flat sky colour, and the phone's status bar gets exactly that colour: no visible edge under the clock
      if (fullRef.current) {
        const top = skyTop(nightNow), fh = 70 * dpr, fg = c.createLinearGradient(0, 0, 0, fh);
        fg.addColorStop(0, top); fg.addColorStop(0.35, top);
        const r = parseInt(top.slice(1, 3), 16), g = parseInt(top.slice(3, 5), 16), b = parseInt(top.slice(5, 7), 16);
        fg.addColorStop(1, `rgba(${r},${g},${b},0)`); c.fillStyle = fg; c.fillRect(0, 0, cv.width, fh);
        if (top !== skyCol) { skyCol = top; document.documentElement.style.setProperty('--office-sky', top); document.documentElement.style.setProperty('--office-ground', nightNow ? '#16231b' : '#86b96f'); document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', top)); }
      }
      // the glass lift: the cabin comes, the doors open, the rider walks in, rides, walks out
      let liftPos = LIFTPOS.r, liftDoor = 0, rider: { p: Person; a: Agent; room: number; y: number; walk: number; inCab: boolean; out: boolean } | null = null;
      const ez = (x: number) => { const m = Math.min(1, Math.max(0, x)); return m * m * (3 - 2 * m); };
      const R0 = LIFTCTL.ride, who = LIFTCTL.who && agents[LIFTCTL.who];
      if (R0 && wall < R0.t0 + R0.dur) {
        const tt = wall - R0.t0, door = (b: number) => (b < 0.25 ? b / 0.25 : b > 0.75 ? (1 - b) / 0.25 : 1), walkIn = (b: number) => ez((b - 0.25) / 0.5);
        let ry = LIFT_WAIT, room = R0.from, walk = 0;
        if (tt < R0.dA) liftPos = R0.start + (R0.from - R0.start) * ez(tt / R0.dA);
        else if (tt < R0.dA + R0.dB) { const b = (tt - R0.dA) / R0.dB; liftPos = R0.from; liftDoor = door(b); ry = LIFT_WAIT + (CAB_Y - LIFT_WAIT) * walkIn(b); walk = b > 0.25 && b < 0.75 ? 1 : 0; }
        else if (tt < R0.dA + R0.dB + R0.dC) { liftPos = R0.from + (R0.to - R0.from) * ez((tt - R0.dA - R0.dB) / R0.dC); ry = CAB_Y; }
        else { const b = (tt - R0.dA - R0.dB - R0.dC) / R0.dD; liftPos = R0.to; room = R0.to; liftDoor = door(b); ry = CAB_Y + (LIFT_WAIT - CAB_Y) * walkIn(b); walk = b > 0.25 && b < 0.75 ? 1 : 0; }
        if (tt >= R0.dA + R0.dB) room = tt < R0.dA + R0.dB + R0.dC ? Math.round(liftPos) : R0.to;
        LIFTPOS.r = liftPos;
        const pp = PEOPLE.find((q) => q.id === LIFTCTL.who);
        if (who && pp) rider = { p: pp, a: who, room, y: ry, walk, inCab: ry < 0.05, out: tt >= R0.dA + R0.dB + R0.dC };
      }
      const ghostOf = (rd: NonNullable<typeof rider>, rm = rd.room): Agent => ({ ...rd.a, arms: undefined, x: lwX(rm), y: rd.y, path: rd.walk ? [[LIFT.x, 0]] : [], vx: 0, vy: rd.walk ? 1.2 : 0, dist: wall / 700, face: rd.walk && !rd.out ? 'ny' : 'py', act: { ...rd.a.act, pose: 'stand', prop: undefined, face: 'py', whip: undefined }, scoldUntil: 0, bubble: null, carry: null });
      const drawRiders = (cc: C, tt: number, rm: number) => { if (rider && rider.inCab) drawPerson(cc, rider.p, ghostOf(rider, rm), tt, S[rider.p.id] ?? { label: '', color: '#58a6ff', sleep: false, tag: null }, null); };
      for (const r of ORDER()) {
        c.setTransform(k * V.z, 0, 0, k * V.z, k * (V.tx + roomX(r) * V.z), k * (V.ty + roomY(r) * V.z));
        if (r === 2) { drawParking(c, wall, nightNow); drawCars(c, t, nightNow); }
        if (r <= 1) drawWallText(c, scrRef.current, r, t);
        if (r === 1) drawPositions(c, posRef.current, t);
        drawBoards(c, r, wall, t);
        drawWeather(c, r, t);
        if (SHAPE === 'tower') drawLift(c, r, Math.abs(r - liftPos) < 0.999 ? liftPos : null, liftDoor, nightNow, t, rider?.inCab ? drawRiders : null);
        for (const m of MOPS) if (m.room === r) { const k = 1 - (wall - m.t) / 25_000; ell(c, m.x, m.y, 0.2, 0.32, `rgba(205,232,255,${0.22 * k})`); ell(c, m.x - 0.08, m.y - 0.05, 0.25, 0.1, `rgba(255,255,255,${0.35 * k})`); }
        const list: Item[] = items[r].slice();
        if (EV.cur?.items && wall < EV.cur.until) list.push(...EV.cur.items(r, wall));
        if (SHAPE === 'tower' && rider && !rider.inCab && rider.room === r) { const rd = rider, g = ghostOf(rd); list.push({ x0: g.x - 0.2, y0: g.y - 0.2, x1: g.x + 0.2, y1: g.y + 0.2, draw: (cc, tt) => drawPerson(cc, rd.p, g, tt, S[rd.p.id] ?? { label: '', color: '#58a6ff', sleep: false, tag: null }, null) }); }
        for (const p of PEOPLE) {
          const a = agents[p.id]; if (!a || a.room !== r || wall < a.hiddenUntil) continue;
          if (!a.path.length && a.act.prop === 'vanish') continue;          // in the toilet
          const s = S[p.id];
          const whipT = p.id === 'bos' && a.act.whip && !a.path.length && a.bubble && wall < a.bubble.until ? t : null;
          list.push({ x0: a.x - 0.2, y0: a.y - 0.2, x1: a.x + 0.2, y1: a.y + 0.2, draw: (cc, tt) => drawPerson(cc, p, a, tt, s, whipT) });
        }
        if (cat.room === r && wall >= cat.hidden) {
          const up = cat.z > 3;      // on a desk / sofa: draw after the furniture it sits on
          list.push({ x0: cat.x - 0.15 + (up ? 0.5 : 0), y0: cat.y - 0.15 + (up ? 0.5 : 0), x1: cat.x + 0.15 + (up ? 0.5 : 0), y1: cat.y + 0.15 + (up ? 0.5 : 0), draw: (cc, tt) => {
            drawCat(cc, cat, tt);
            if (wall < cat.meow) { const [mx, my] = iso(cat.x, cat.y, cat.z); cc.font = '800 5px system-ui, sans-serif'; cc.textAlign = 'center'; cc.fillStyle = '#ffffff'; cc.strokeStyle = 'rgba(30,31,35,.8)'; cc.lineWidth = 1.6; const mt = cat.meowText ?? 'meong~'; cc.strokeText(mt, mx, my - 14); cc.fillText(mt, mx, my - 14); cc.textAlign = 'start'; }
          } });
        }
        for (const it of isoSort(list)) it.draw(c, t);
        for (const p of PEOPLE) {
          const a = agents[p.id], s = S[p.id]; if (!a || a.room !== r || wall < a.hiddenUntil) continue;
          const [sx, sy] = iso(a.x, a.y);
          const zz = (s?.sleep && !a.path.length) || (a.act.pose === 'nap' && !a.path.length);
          if (zz) { const ph = (t * 0.5) % 1; c.fillStyle = `rgba(150,170,215,${1 - ph})`; c.font = 'bold 6px sans-serif'; c.fillText('z', sx + 5 + ph * 4, sy - 28 - ph * 8); c.font = 'bold 4.5px sans-serif'; c.fillText('z', sx + 9 + ph * 3, sy - 33 - ph * 6); }
          if (p.id === 'bos' && a.act.whip && !a.path.length && a.bubble && wall < a.bubble.until) {
            const w = (t % 0.9) / 0.9;
            if (w > 0.2 && w < 0.42) { const dir = a.face === 'py' || a.face === 'nx' ? -1 : 1; c.fillStyle = '#ffd23f'; c.strokeStyle = '#1e1f23'; c.lineWidth = 1.2; c.font = '900 7px system-ui, sans-serif'; c.textAlign = 'center'; c.strokeText('CTAR!', sx + dir * 24, sy - 12); c.fillText('CTAR!', sx + dir * 24, sy - 12); c.textAlign = 'start'; }
          }
        }
      }
      if (nightNow) {
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = 'rgba(6,10,28,.26)'; c.fillRect(0, 0, cv.width, cv.height); c.restore();
        c.globalCompositeOperation = 'lighter';
        const glow = (x: number, y: number, z: number, r: number, col: string) => { const [gx, gy] = iso(x, y, z); const g = c.createRadialGradient(gx, gy, 0, gx, gy, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(gx - r, gy - r, 2 * r, 2 * r); };
        for (let r = 0; r < ROOMS; r++) {
          c.setTransform(k * V.z, 0, 0, k * V.z, k * (V.tx + roomX(r) * V.z), k * (V.ty + roomY(r) * V.z));
          glow(6, 5, 70, 120, 'rgba(255,220,150,.07)');
          if (r === 1) { for (const y0 of [1.0, 3.4, 6.0, 8.4]) { glow(0.9, y0 + 0.1, 22, 26, 'rgba(255,200,90,.26)'); glow(0.8, y0 + 0.9, 26, 16, 'rgba(90,170,255,.15)'); } glow(5.25, 0.4, 22, 24, 'rgba(255,200,90,.24)'); glow(8.9, 0, 56, 40, 'rgba(80,160,255,.16)'); }
          if (r === 0) { glow(7.1, 4.0, 22, 26, 'rgba(255,200,90,.26)'); glow(2.2, 0, 50, 30, 'rgba(242,194,48,.14)'); }
          if (r === 2) { glow(8.0, 0.4, 30, 30, 'rgba(255,200,90,.18)'); glow(4.8, 8.8, 20, 34, 'rgba(255,200,90,.12)'); }
        }
        c.globalCompositeOperation = 'source-over';
      }
      /* ---- name tags (screen space, never overlapping) ---- */
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawTags(c, agents, S, wall, (x, y, r) => [((x + roomX(r)) * V.z + V.tx) * css, ((y + roomY(r)) * V.z + V.ty) * css], css * W, css * V.z, 1.15);
    };
    const io = new IntersectionObserver(([e]) => { const was = visible; visible = e.isIntersecting; if (visible && !was) { last = performance.now(); raf = requestAnimationFrame(frame); } }, { threshold: 0 });
    io.observe(box0);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); visible = false; ro.disconnect(); io.disconnect(); };
  }, [items, grids]);

  const d = new Date(now);
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'][d.getDay()];
  const active = PEOPLE.filter((p) => st[p.id] && st[p.id].label !== 'BELUM AKTIF' && !st[p.id].sleep).length;
  return (
    <div className={'office' + (full ? ' office-full' : '')} ref={wrap}>
      <canvas ref={ref} className="office-canvas" style={full ? { width: '100%', height: '100%', touchAction: 'none' } : { aspectRatio: `${W} / ${TOTAL}`, touchAction: 'pan-y' }} aria-label="Kantor virtual: status bot dan EA" />
      {full ? null : <><div className="office-clock"><b>{clock}</b><span>{day}</span></div>
      <div className="office-count"><i />{active} karyawan aktif</div></>}
      {full && FLAT && onSwipe ? <button type="button" className="office-trade" onClick={() => swipeRef.current?.()}>Trade ›</button> : null}
      {full ? <>
        <button type="button" className={'office-cat' + (menu ? ' on' : '')} onClick={() => setMenu((v) => !v)} aria-label="Menu kantor" aria-expanded={menu}>
          <svg viewBox="0 0 64 64" width="36" height="36" aria-hidden>
            <path d="M12 30 L10 8 L26 19 Z" fill="#f29a3a" stroke="#5a3a24" strokeWidth="2" strokeLinejoin="round" /><path d="M15 25 L14 14 L22 20 Z" fill="#ffc9b5" />
            <path d="M52 30 L54 8 L38 19 Z" fill="#f29a3a" stroke="#5a3a24" strokeWidth="2" strokeLinejoin="round" /><path d="M49 25 L50 14 L42 20 Z" fill="#ffc9b5" />
            <ellipse cx="32" cy="37" rx="23" ry="19" fill="#f6a94a" stroke="#5a3a24" strokeWidth="2" />
            <path d="M24 20 q2 6 0 10 M32 18 v10 M40 20 q-2 6 0 10" stroke="#d9782a" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            <ellipse cx="32" cy="45" rx="11" ry="7.5" fill="#fff4e6" />
            {menu ? <><path d="M19 35 q4 -4 8 0" stroke="#2a1d14" strokeWidth="2.4" fill="none" strokeLinecap="round" /><path d="M37 35 q4 -4 8 0" stroke="#2a1d14" strokeWidth="2.4" fill="none" strokeLinecap="round" /></>
              : <><ellipse className="cat-eye" cx="23" cy="35" rx="3.6" ry="4.4" fill="#2a1d14" /><ellipse className="cat-eye" cx="41" cy="35" rx="3.6" ry="4.4" fill="#2a1d14" /><circle cx="24.3" cy="33.4" r="1.3" fill="#fff" /><circle cx="42.3" cy="33.4" r="1.3" fill="#fff" /></>}
            <path d="M30 41 h4 l-2 2.4 Z" fill="#e86a7a" /><path d="M32 43.5 q-2.5 3 -5 1 M32 43.5 q2.5 3 5 1" stroke="#5a3a24" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <ellipse cx="17" cy="42" rx="3.4" ry="2" fill="#ff9a9a" opacity=".6" /><ellipse cx="47" cy="42" rx="3.4" ry="2" fill="#ff9a9a" opacity=".6" />
            <path d="M8 40 h8 M8 44 l8 -1.5 M56 40 h-8 M56 44 l-8 -1.5" stroke="#5a3a24" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        {menu ? <div className="office-menu" data-noswipe>
          {MENU.map(([k, icon, label]) => (
            <button type="button" key={k} onClick={() => act(k)}><span>{icon}</span>{label}{k === 'galeri' && moments.length ? <em>{moments.length}</em> : null}</button>
          ))}
        </div> : null}
        {toast ? <div className="office-toast">{toast}</div> : null}
      </> : null}
      {gallery ? (
        <div className="office-gallery" onClick={() => { setGallery(false); setBig(null); setBigI(-1); }} data-noswipe>
          <div className="og-box" onClick={(e) => e.stopPropagation()}>
            <div className="og-head">
              <div><b>Galeri momen</b><small>{moments.length} TP sejak awal · total {(() => { const v = data.trades.filter((t) => t.result === 'tp').reduce((a, t) => a + Number(t.pnl ?? 0), 0); return `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)}`; })()}</small></div>
              <button type="button" onClick={() => { setGallery(false); setBig(null); setBigI(-1); }} aria-label="Tutup">✕</button>
            </div>
            {bigI >= 0 && moments[bigI] ? (
              <div className="og-big">
                <img src={thumbs[moments[bigI].id] || selfie(moments[bigI].id, moments[bigI].text, fmtDay(moments[bigI].at), moments[bigI].pid)} alt={moments[bigI].text} />
                <div className="og-nav">
                  <button type="button" disabled={bigI <= 0} onClick={() => setBigI(bigI - 1)}>‹</button>
                  <span><b>{moments[bigI].text}</b><small>{moments[bigI].who} & tim · {fmtDay(moments[bigI].at)}</small></span>
                  <button type="button" disabled={bigI >= moments.length - 1} onClick={() => setBigI(bigI + 1)}>›</button>
                </div>
                <button type="button" className="og-back" onClick={() => setBigI(-1)}>← Semua foto</button>
              </div>
            ) : big ? (
              <div className="og-big"><img src={big.img} alt={big.text} /><button type="button" className="og-back" onClick={() => setBig(null)}>← Semua foto</button></div>
            ) : (
              <>
                {moments.length ? <div className="og-grid">{moments.map((m, i) => (
                  <button type="button" key={m.id} className="og-tile" onClick={() => setBigI(i)}>
                    <div className="og-img">{thumbs[m.id] ? <img src={thumbs[m.id]} alt={m.text} /> : <i />}</div>
                    <b>{m.text}</b><small>{m.who} · {fmtDay(m.at)}</small>
                  </button>
                ))}</div> : <p className="og-empty">Belum ada TP. Setiap TP nanti jadi foto selfie bareng tim di sini.</p>}
                {photos.length ? <>
                  <h5 className="og-sub">Foto kantor</h5>
                  <div className="og-grid">{photos.map((x) => (
                    <button type="button" key={x.id} className="og-tile" onClick={() => setBig(x)}><div className="og-img"><img src={x.img} alt={x.text} /></div><b>{x.text}</b><small>{fmtDay(x.at)}</small></button>
                  ))}</div>
                </> : null}
              </>
            )}
          </div>
        </div>
      ) : null}
      {zoomed ? <button type="button" className="office-reset" onClick={() => { Object.assign(view.current, homeRef.current); driftRef.current = fullRef.current; setZoomed(false); if (ref.current) ref.current.style.touchAction = 'pan-y'; }}>1×</button>
        : null}
    </div>
  );
}

/* the live numbers on the wall TV and the team board, drawn in perspective on the back wall */
function drawWallText(c: C, lines: ScreenLine[], room: number, t: number) {
  const onWall = (x0: number, z1: number, fn: () => void) => { const [ox, oy] = iso(x0, 0, z1); c.save(); c.translate(ox, oy); c.transform(1, 0.5, 0, 1, 0, 0); fn(); c.restore(); };
  const tw = (TV.x1 - TV.x0) * TW, th = TV.z1 - TV.z0;
  if (room === 1) onWall(TV.x0, TV.z1, () => {
    const g = c.createLinearGradient(0, 0, 0, th); g.addColorStop(0, '#0d2340'); g.addColorStop(1, '#081626');
    c.fillStyle = g; c.fillRect(0, 0, tw, th);
    c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(0, 0, tw, 7.5);
    const live = Math.floor(t * 2) % 2 === 0;
    c.fillStyle = live ? '#ff4d4f' : '#7a2a2a'; c.beginPath(); c.arc(4, 3.9, 1.4, 0, 7); c.fill();
    c.textBaseline = 'middle';
    c.font = '800 6px ui-monospace, Menlo, monospace'; c.fillStyle = '#ffffff'; c.fillText('LIVE', 7, 4.2);
    // 2 × 2 tiles: small label on top, big number below (shrunk to fit its tile, never outside it)
    const rows = lines.slice(0, 4), top = 9, cw = tw / 2, ch = (th - top) / 2;
    rows.forEach((l, i) => {
      const cx = (i % 2) * cw, cy = top + Math.floor(i / 2) * ch;
      c.save(); c.beginPath(); c.rect(cx, cy, cw, ch); c.clip();
      { let lf = 6.2; c.font = `800 ${lf}px ui-monospace, Menlo, monospace`; while (lf > 4 && c.measureText(l.k).width > cw - 8) { lf -= 0.2; c.font = `800 ${lf}px ui-monospace, Menlo, monospace`; } } c.fillStyle = '#9cc3ea'; c.fillText(l.k, cx + 4, cy + ch * 0.27);
      let fs = 13; c.font = `800 ${fs}px ui-monospace, Menlo, monospace`;
      while (fs > 3.5 && c.measureText(l.v).width > cw - 9) { fs -= 0.25; c.font = `800 ${fs}px ui-monospace, Menlo, monospace`; }
      c.fillStyle = l.color ?? '#ffffff'; c.fillText(l.v, cx + 4, cy + ch * 0.68);
      c.restore();
    });
    c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(cw - 0.2, top + 2, 0.4, th - top - 4); c.fillRect(3, top + ch - 0.2, tw - 6, 0.4);
    c.textBaseline = 'alphabetic';
  });
  const rw = (ROSTER.x1 - ROSTER.x0) * TW, rh2 = ROSTER.z1 - ROSTER.z0;
  if (room === 0) onWall(ROSTER.x0, ROSTER.z1, () => {
    c.textBaseline = 'middle';
    c.font = '900 6px system-ui, sans-serif'; c.fillStyle = '#b8901a'; c.textAlign = 'center'; c.fillText('T I M', rw / 2, 5); c.textAlign = 'left';
    const team = PEOPLE.filter((p) => p.id !== 'kurir' && p.id !== 'tamu'), lh = (rh2 - 10) / team.length;
    team.forEach((p, i) => {
      const y = 10 + lh * (i + 0.5);
      c.font = '600 4px ui-monospace, Menlo, monospace'; const roleW = c.measureText(p.role).width;
      let fs = 5; c.font = `800 ${fs}px system-ui, sans-serif`; while (fs > 3 && c.measureText(p.name).width + roleW + 9 > rw) { fs -= 0.25; c.font = `800 ${fs}px system-ui, sans-serif`; }
      c.fillStyle = '#1e1f23'; c.fillText(p.name, 3, y);
      c.font = '600 4px ui-monospace, Menlo, monospace'; c.fillStyle = p.id === 'bos' || p.id === 'vet' ? '#c0392b' : '#6b6f78'; c.textAlign = 'right'; c.fillText(p.role, rw - 3, y); c.textAlign = 'left';
    });
    c.textBaseline = 'alphabetic';
  });
}

/* ---------- the open positions, on a screen high on the trading-floor wall ---------- */
export type Pos = { name: string; side: string; who: string; pnl: number | null };
export function openPositions(data: OfficeData): Pos[] {
  const coin = (t: JournalTrade) => (/Bot Binance ([0-9A-Z]+)/.exec(t.note ?? '')?.[1] ?? '').replace(/USDT$/, '');
  const who: Record<string, string> = { snr: 'Na', btc: 'Ni', v2: 'Nu', nas: 'Ne' };
  return data.trades.filter((t) => t.result === 'open').map((t) => {
    const mt5 = t.strategy === 'v2' || t.strategy === 'nas', name = mt5 ? (t.strategy === 'nas' ? 'NAS' : 'XAU') : coin(t) || '—';
    const live = mt5 ? data.mt5 : data.binance, key = mt5 ? (t.strategy === 'nas' ? 'nas' : 'xau') : `${coin(t)}USDT`;
    const v = live?.pos?.[key];
    return { name, side: t.side === 'BUY' ? 'BUY' : 'SELL', who: who[t.strategy] ?? '', pnl: Number.isFinite(v) ? Number(v) : null };
  });
}
function drawPositions(c: C, list: Pos[], t: number) {
  const usd = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`;
  const x0 = 6.2, x1 = TV.x1, z0 = TV.z1 + 6, z1 = TV.z1 + 52;      // right above the LIVE TV, kept under the floor above
  const [ox, oy] = iso(x0, 0, z1), w = (x1 - x0) * TW, h = z1 - z0;
  const mono = (wt: number, px: number) => `${wt} ${px}px ui-monospace, Menlo, monospace`;
  c.save(); c.translate(ox, oy); c.transform(1, 0.5, 0, 1, 0, 0);
  c.fillStyle = '#111214'; c.fillRect(-2.5, -2.5, w + 5, h + 5);
  const bg = c.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#0f2640'); bg.addColorStop(1, '#07121f'); c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.textBaseline = 'middle';
  // header: dot + title + count, then a thin rule
  c.fillStyle = list.length ? (Math.floor(t * 2) % 2 ? '#2ee59d' : '#1d6b4c') : '#4a5566'; c.beginPath(); c.arc(6, 7, 1.5, 0, 7); c.fill();
  { let hf = 6.8; c.font = mono(800, hf); while (hf > 3.5 && c.measureText('POSISI SEKARANG').width > w - 14) { hf -= 0.2; c.font = mono(800, hf); } } c.fillStyle = '#ffffff'; c.fillText('POSISI SEKARANG', 10, 7.2);
  c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(4, 13, w - 8, 0.6);
  if (!list.length) {
    { let nf = 6.6; c.font = mono(700, nf); while (nf > 4 && c.measureText('tidak ada posisi').width > w - 8) { nf -= 0.2; c.font = mono(700, nf); } } c.fillStyle = '#6f93b8'; c.textAlign = 'center'; c.fillText('tidak ada posisi', w / 2, 13 + (h - 13) / 2); c.textAlign = 'left';
  } else {
    // one line per position: side, name, floating P&L
    const top = 15, max = list.length * 8 <= h - top - 2 ? list.length : Math.max(1, Math.floor((h - top - 7) / 7.8)), rows = list.slice(0, max), rh = Math.min(11, (h - top - (list.length > max ? 8 : 2)) / rows.length);
    rows.forEach((p, i) => {
      const y = top + rh * (i + 0.5);
      if (i % 2 === 0) { c.fillStyle = 'rgba(255,255,255,.045)'; c.fillRect(3, y - rh / 2, w - 6, rh); }
      c.font = mono(800, 6.4); c.fillStyle = p.side === 'BUY' ? '#2ee59d' : '#ff6b6b'; c.fillText(p.side === 'BUY' ? 'B' : 'S', 4, y);
      const pnlTxt = p.pnl == null ? '—' : usd(p.pnl); c.font = mono(800, 6.2); const pw = c.measureText(pnlTxt).width;
      c.font = mono(800, 6.4); c.fillStyle = '#ffffff';
      let name = p.name; while (name.length > 2 && c.measureText(name).width > w - 10 - pw - 6) name = name.slice(0, -1);
      c.fillText(name, 10, y);
      c.textAlign = 'right'; c.font = mono(800, 6.2); c.fillStyle = p.pnl == null ? '#6f93b8' : p.pnl >= 0 ? '#2ee59d' : '#ff6b6b'; c.fillText(p.pnl == null ? '—' : usd(p.pnl), w - 4, y); c.textAlign = 'left';
    });
    if (list.length > max) { c.font = mono(600, 4.4); c.fillStyle = '#6f93b8'; c.textAlign = 'center'; c.fillText(`+${list.length - max} lagi`, w / 2, h - 4); c.textAlign = 'left'; }
  }
  c.textBaseline = 'alphabetic'; c.restore();
}

/* small wall boards: the H4 candle countdown (trading floor) and the clock + date (lobby) */
let CAL: Array<{ title: string; at: number }> = [];
const inTime = (ms: number) => { const mn = Math.ceil(ms / 60_000); if (mn < 60) return `${mn} MENIT LAGI`; const hr = Math.floor(mn / 60); if (hr < 48) return `${hr} JAM LAGI`; return `${Math.floor(hr / 24)} HARI LAGI`; };
function drawBoards(c: C, room: number, wall: number, t: number) {
  const board = (x0: number, x1: number, z0: number, z1: number, fn: (w: number, h: number) => void) => {
    const [ox, oy] = iso(x0, 0, z1), w = (x1 - x0) * TW, h = z1 - z0;
    c.save(); c.translate(ox, oy); c.transform(1, 0.5, 0, 1, 0, 0);
    c.fillStyle = '#111214'; c.fillRect(-2.5, -2.5, w + 5, h + 5); c.fillStyle = '#0b1220'; c.fillRect(0, 0, w, h);
    c.textBaseline = 'middle'; c.textAlign = 'center'; fn(w, h); c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.restore();
  };
  if (room === 2) {
    const d = new Date(wall);
    const hm = `${String(d.getHours()).padStart(2, '0')}${d.getSeconds() % 2 ? ':' : ' '}${String(d.getMinutes()).padStart(2, '0')}`;
    const day = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'][d.getDay()];
    const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'][d.getMonth()];
    // small board above the kitchen: countdown to the next big US news (only within 3 days; otherwise the menu stays)
    const nx = CAL.find((e) => e.at > wall - 10 * 60_000);
    if (nx && nx.at - wall < 3 * 86_400_000) board(7.15, 8.9, 40, 62, (w, h) => {
      const left = nx.at - wall, soon = left < 15 * 60_000, live = left <= 0;
      c.font = '700 3.4px ui-monospace, Menlo, monospace'; c.fillStyle = '#86aed3'; c.fillText('BERITA', w / 2, 4.5);
      c.font = '800 7.4px ui-monospace, Menlo, monospace'; c.fillStyle = soon && Math.floor(t * 3) % 2 ? '#ff5a5a' : '#f2c230'; c.fillText(nx.title, w / 2, h * 0.48);
      c.font = '700 3.5px ui-monospace, Menlo, monospace'; c.fillStyle = live ? '#ff5a5a' : '#ffffff'; c.fillText(live ? 'SEDANG RILIS' : inTime(left), w / 2, h * 0.82);
    });
    const H4 = 4 * 3_600_000, left = H4 - (wall % H4);
    const h4 = `${Math.floor(left / 3_600_000)}:${String(Math.floor((left % 3_600_000) / 60_000)).padStart(2, '0')}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`;
    board(7.2, 11.8, 98, 150, (w, h) => {
      c.font = '800 17px ui-monospace, Menlo, monospace'; c.fillStyle = '#ffffff'; c.fillText(hm, w / 2, h * 0.3);
      c.font = '700 5.2px ui-monospace, Menlo, monospace'; c.fillStyle = '#f2c230'; c.fillText(`${day}, ${d.getDate()} ${mon} ${d.getFullYear()}`, w / 2, h * 0.58);
      c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(6, h * 0.7, w - 12, 0.6);
      c.font = '700 4.6px ui-monospace, Menlo, monospace'; c.fillStyle = '#86aed3'; c.fillText('H4', w * 0.24, h * 0.84);
      c.font = '800 7px ui-monospace, Menlo, monospace'; c.fillStyle = left < 60_000 && Math.floor(t * 4) % 2 ? '#ffffff' : '#f2c230'; c.fillText(h4, w * 0.62, h * 0.84);
    });
  }
}

/** name tags are small (name only); tap a person to see what they are doing. Important moments always show in full. */
const SEL = { id: '', until: 0 };
let TAGHIT: Array<{ id: string; x: number; y: number; w: number; h: number; ax: number; ay: number }> = [];
function drawTags(c: C, agents: Record<string, Agent>, S: Record<string, Status>, wall: number, toScreen: (x: number, y: number, room: number) => [number, number], cw: number, unit: number, ts = 1) {
  type Tag = { id: string; full: boolean; x: number; y: number; w: number; h: number; ax: number; ay: number; name: string; label: string; color: string; extra?: { text: string; color: string } | null; bubble?: Agent['bubble'] };
  const tags: Tag[] = [];
  const nameF = `700 ${7.2 * ts}px -apple-system, system-ui, sans-serif`, stF = `700 ${5.6 * ts}px ui-monospace, Menlo, monospace`, smallF = `700 ${5.2 * ts}px ui-monospace, Menlo, monospace`;
  for (const p of PEOPLE) {
    const a = agents[p.id], s = S[p.id]; if (!a || !s) continue;
    const walking = a.path.length > 0, hidden = !walking && a.act.prop === 'vanish';
    if (hidden && a.act.label === 'PULANG') continue;            // gone home / left the building
    // big group events: one name tag tells the story, the others only show up when they say something
    if (EV.cur && wall < EV.cur.until && EV.cur.ids.length >= 4 && EV.cur.ids.includes(p.id) && p.id !== EV.cur.ids[0] && !(a.bubble && wall < a.bubble.until) && a.act.id.startsWith('ev-')) continue;
    const busy = wall < a.scoldUntil;
    let what = walking ? (a.run ? 'LARI KE MEJA' : (p.id === 'bos' || p.id === 'vet') && a.act.whip ? (p.id === 'vet' ? 'NYARI MARCEL' : 'NGEJAR') : 'JALAN') : a.act.label;
    if (busy) what = 'DIMARAHI BOS';
    if (p.id === 'vet' && !walking && a.act.label === 'NONTON DRAKOR') what = `DRAKOR · ${vetMood(wall / 1000)}`;
    let label = s.label, color = s.color;
    if (busy) { label = what; color = '#ff6b6b'; }
    else if (s.label === 'MEMANTAU' || p.id === 'bos' || p.id === 'vet' || p.id === 'ob' || p.id === 'kantin' || p.id === 'kurir' || (p.id === 'jaga' && s.label === 'AMAN')) {
      label = what; color = what === 'MEMANTAU' || what === 'BALAS CHAT' ? s.color : what.startsWith('MARAH') || what === 'NGEJAR' ? '#ff6b6b' : what.startsWith('MELERAI') || what === 'MAU MELERAI' ? '#2ee59d' : what.startsWith('NGOMEL') ? '#ff6b6b' : ['JAGA', 'PATROLI', 'CEK CCTV', 'CEK PINTU'].includes(what) ? '#2ee59d' : '#f5b83d';
    } else if (s.label === 'LIBUR') label = `LIBUR · ${what}`;
    else if (s.label.startsWith('POSISI') && what === 'SELEBRASI TP') label = what;
    else if (s.label.startsWith('POSISI') && !a.act.id.startsWith('seat-')) label = `${s.label} · ${what}`;
    if (wall < a.hiddenUntil) continue;                     // inside the lift
    const [ix, iy] = iso(a.x, a.y), [ax, ay0] = toScreen(ix, iy, a.room);
    const seated = !walking && ['sit', 'bean', 'sleep', 'nap'].includes(a.act.pose);
    const ay = hidden ? ay0 - 4 : ay0 - ((seated ? (INK ? 31 : 27) : INK ? 37 : 32) + (p.id === 'vet' ? 7 : 0)) * PSV * unit;
    const important = busy || /^(MARAH|NGEJAR|SELEBRASI|DIMARAHI|MELERAI|ALARM|KIRIM PESAN|POSISI)/.test(label) || !!(s.tag && !busy);
    const full = important || p.id === 'bos' || p.id === 'vet' || (SEL.id === p.id && wall < SEL.until);      // the bosses always show name + activity
    c.font = full ? nameF : smallF; const nw = c.measureText(full ? p.name : label).width;
    c.font = stF; const extraTxt = s.tag && !busy ? ` ${s.tag.text}` : ''; const lw = full ? c.measureText(label + extraTxt).width + 6 * ts : 0;
    const w = full ? Math.max(nw, lw) + 7 * ts : nw + 10 * ts, h = full ? 17 * ts : 9.5 * ts;
    tags.push({ id: p.id, full, x: ax - w / 2, y: ay - h - 2, w, h, ax, ay, name: p.name, label, color, extra: busy ? null : s.tag, bubble: a.bubble && wall < a.bubble.until ? a.bubble : null });
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
  TAGHIT = tags.map((tg) => ({ id: tg.id, x: tg.x, y: tg.y, w: tg.w, h: tg.h, ax: tg.ax, ay: tg.ay }));
  for (const tg of tags) {
    if (!tg.full) {      // small name pill with a status dot
      c.fillStyle = THEME.paint ? 'rgba(255,247,232,.88)' : 'rgba(18,19,23,.72)'; c.beginPath(); c.roundRect(tg.x, tg.y, tg.w, tg.h, tg.h / 2); c.fill();
      c.fillStyle = tg.color; c.beginPath(); c.arc(tg.x + 4.2 * ts, tg.y + tg.h / 2, 1.5 * ts, 0, 7); c.fill();
      c.font = smallF; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = THEME.paint ? '#4a2e1e' : '#ffffff'; c.fillText(tg.label, tg.x + 7 * ts, tg.y + tg.h / 2 + 0.3);
      if (tg.bubble) {
        c.font = `800 ${7 * ts}px -apple-system, system-ui, sans-serif`;
        const bw = c.measureText(tg.bubble.text).width + 10 * ts, right = tg.x + tg.w + 3 + bw <= cw, bx = right ? tg.x + tg.w + 3 : tg.x - bw - 3, by = tg.y - 2;
        c.fillStyle = '#ffffff'; c.beginPath(); c.roundRect(bx, by, bw, 13 * ts, 6.5 * ts); c.fill();
        c.fillStyle = tg.bubble.color; c.textAlign = 'center'; c.fillText(tg.bubble.text, bx + bw / 2, by + 6.8 * ts); c.textAlign = 'left';
      }
      c.textBaseline = 'alphabetic';
      continue;
    }
    if (tg.y + tg.h < tg.ay - 4 || Math.abs(tg.x + tg.w / 2 - tg.ax) > tg.w / 2) { c.strokeStyle = THEME.paint ? 'rgba(110,70,40,.6)' : 'rgba(255,255,255,.55)'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(Math.max(tg.x + 3, Math.min(tg.x + tg.w - 3, tg.ax)), tg.y + tg.h); c.lineTo(tg.ax, tg.ay - 1); c.stroke(); }
    c.fillStyle = THEME.paint ? 'rgba(255,247,232,.93)' : 'rgba(18,19,23,.86)'; c.beginPath(); c.roundRect(tg.x, tg.y, tg.w, tg.h, 4.5); c.fill();
    c.strokeStyle = THEME.paint ? 'rgba(110,70,40,.55)' : 'rgba(255,255,255,.12)'; c.lineWidth = INK ? 0.8 : 0.6; c.stroke();
    c.textBaseline = 'middle'; c.textAlign = 'center';
    c.font = nameF; c.fillStyle = THEME.paint ? '#4a2e1e' : '#ffffff'; c.fillText(tg.name, tg.x + tg.w / 2, tg.y + 5.2 * ts);
    c.font = stF; c.textAlign = 'left';
    const extra = tg.extra ? ` ${tg.extra.text}` : '', full = c.measureText(tg.label + extra).width + 6 * ts;
    let x = tg.x + (tg.w - full) / 2;
    c.fillStyle = tg.color; c.beginPath(); c.roundRect(x, tg.y + 11 * ts, 3.6 * ts, 3.6 * ts, 1); c.fill(); x += 6 * ts;
    c.fillStyle = THEME.paint ? '#7a5a40' : '#f1f3f6'; c.fillText(tg.label, x, tg.y + 12.9 * ts); x += c.measureText(tg.label).width;
    if (tg.extra) { c.fillStyle = tg.extra.color; c.fillText(extra, x, tg.y + 12.9 * ts); }
    if (tg.bubble) {
      c.font = `800 ${7.5 * ts}px -apple-system, system-ui, sans-serif`;
      const bw = c.measureText(tg.bubble.text).width + 10 * ts, right = tg.x + tg.w + 3 + bw <= cw, bx = right ? tg.x + tg.w + 3 : tg.x - bw - 3, by = tg.y + 1;
      c.fillStyle = '#ffffff'; c.beginPath(); c.roundRect(bx, by, bw, 14 * ts, 7 * ts); c.fill();
      c.beginPath(); const tx = right ? bx + 6 : bx + bw - 6; c.moveTo(tx - 3, by + 13 * ts); c.lineTo(tx + 3, by + 13 * ts); c.lineTo(tx + (right ? -5 : 5), by + 18 * ts); c.fill();
      c.fillStyle = tg.bubble.color; c.textAlign = 'center'; c.fillText(tg.bubble.text, bx + bw / 2, by + 7.3 * ts); c.textAlign = 'left';
    }
    c.textBaseline = 'alphabetic';
  }
}

/** draw order for an isometric scene: a box is in front of another when it is fully past it on x or on y */
/* ---------- the office cat ---------- */
type CatMode = 'walk' | 'sit' | 'sleep' | 'groom' | 'loaf';
type CatSpot = { room: number; x: number; y: number; z: number; mode: CatMode; dwell: [number, number] };
type Cat = { room: number; x: number; y: number; z: number; vx: number; vy: number; dx: number; dy: number; path: Array<[number, number]>; spot: CatSpot | null; mode: CatMode;
  until: number; hidden: number; pending: CatSpot | null; hop: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t0: number } | null; meow: number; flee?: number; meowText?: string };
let CATREF: Cat | null = null;
const CATCALL = { at: 0, seen: 0 };
const WEATHER: { kind: 'rain' | 'snow' | null } = { kind: null };
const MOPS: Array<{ room: number; x: number; y: number; t: number }> = [];
const CAT_SPOTS: CatSpot[] = [
  { room: 2, x: 10.2, y: 9.8, z: 7, mode: 'sleep', dwell: [25, 50] },        // lobby sofa
  { room: 2, x: 4.75, y: 8.85, z: 0.5, mode: 'loaf', dwell: [12, 25] },      // lounge rug
  { room: 2, x: 7.6, y: 1.35, z: 0, mode: 'sit', dwell: [8, 15] },           // begging at the kitchen
  { room: 2, x: 12.3, y: 1.4, z: 0, mode: 'sit', dwell: [6, 12] },           // by the fridge
  { room: 1, x: 1.75, y: 3.2, z: 17.2, mode: 'loaf', dwell: [15, 30] },      // on Na / Ni's desk
  { room: 1, x: 2.75, y: 7.7, z: 17.2, mode: 'groom', dwell: [10, 20] },     // on Nu / Ne's desk
  { room: 1, x: 7.5, y: 5.1, z: 0, mode: 'sleep', dwell: [20, 40] },         // under the hot desk
  { room: 1, x: 0.7, y: 5.4, z: 0, mode: 'sit', dwell: [8, 16] },            // watching birds at the window
  { room: 0, x: 10.2, y: 9.8, z: 7, mode: 'sleep', dwell: [25, 50] },        // boss sofa
  { room: 0, x: 3.0, y: 4.2, z: 0, mode: 'sit', dwell: [8, 15] },            // next to Ny. Vetrycia
  { room: 0, x: 6.4, y: 4.75, z: 0, mode: 'groom', dwell: [8, 15] },         // at Marcel's feet
];
const BOWL: CatSpot = { room: 2, x: 5.85, y: 1.1, z: 0, mode: 'loaf', dwell: [10, 16] };
function catPick(c: Cat, wall: number) {
  if (CATCALL.at > CATCALL.seen) { CATCALL.seen = CATCALL.at; return BOWL; }
  if (c.flee && wall < c.flee) { const away = CAT_SPOTS.filter((q) => q.room !== c.room); return away[Math.floor(Math.random() * away.length)]; }
  if (Math.random() < 0.35) { c.spot = null; c.mode = 'walk'; c.until = wall + 4000 + Math.random() * 5000; return { room: c.room, x: 1 + Math.random() * 10.5, y: 1.2 + Math.random() * 9, z: 0, mode: 'sit' as CatMode, dwell: [3, 7] as [number, number] }; }
  return CAT_SPOTS[Math.floor(Math.random() * CAT_SPOTS.length)];
}
function stepCat(c: Cat, grids: boolean[][][], dt: number, wall: number): CatSpot | null {
  if (wall < c.hidden) return null;
  if (CATCALL.at > CATCALL.seen && !c.hop && c.mode !== 'walk') c.until = 0;     // food! (Udin is filling the bowl)
  if (c.hop) {                                       // jumping up onto / down from furniture
    const k = Math.min(1, (wall - c.hop.t0) / 450), h = c.hop;
    c.x = h.x0 + (h.x1 - h.x0) * k; c.y = h.y0 + (h.y1 - h.y0) * k; c.z = h.z0 + (h.z1 - h.z0) * k + Math.sin(k * Math.PI) * (h.z0 !== h.z1 ? 9 : 1.5);
    if (k >= 1) { c.hop = null; c.z = h.z1; }
    return null;
  }
  if (c.path.length) {
    const [gx, gy] = c.path[0], dx = gx - c.x, dy = gy - c.y, d = Math.hypot(dx, dy), sp = c.flee && wall < c.flee ? 2.4 : 1.1;
    if (d > 1e-4) { c.vx = (dx / d) * sp; c.vy = (dy / d) * sp; c.dx = dx / d; c.dy = dy / d; }
    c.x += c.vx * dt; c.y += c.vy * dt; c.mode = 'walk';
    if (d < 0.08) { c.path.shift(); if (!c.path.length) { c.vx = c.vy = 0; } }
    return null;
  }
  c.vx = c.vy = 0;
  // arrived at the lift: ride to the other floor
  const door = (room: number, to: number) => (FLAT ? { x: to < room ? 0.6 : NX - 0.6, y: DOOR_Y } : { x: LIFT.x, y: LIFT.y + 0.15 });
  if (FLAT && c.pending) { const d = door(c.room, c.pending.room); if (Math.hypot(c.x - d.x, c.y - d.y) < 0.6) {
    const next = hopRoom(c.room, c.pending.room), right = next > c.room; c.room = next; c.x = right ? 0.6 : NX - 0.6; c.y = DOOR_Y;
    if (next === c.pending.room) { c.spot = c.pending; c.pending = null; c.path = findPath(grids[c.room], c.x, c.y, c.spot.x, c.spot.y); }
    else { const d2 = door(next, c.pending.room); c.path = findPath(grids[c.room], c.x, c.y, d2.x, d2.y); }
    return null;
  } }
  if (!FLAT && c.pending && Math.hypot(c.x - LIFT.x, c.y - LIFT.y - 0.15) < 0.6) {
    const nx = c.pending; c.pending = null; c.room = nx.room; c.x = LIFT.x; c.y = LIFT.y + 0.4; c.hidden = wall + 1500;
    c.spot = nx; c.path = findPath(grids[c.room], c.x, c.y, nx.x, nx.y); return null;
  }
  if (c.spot && Math.hypot(c.spot.x - c.x, c.spot.y - c.y) > 0.05) { c.hop = { x0: c.x, y0: c.y, z0: c.z, x1: c.spot.x, y1: c.spot.y, z1: c.spot.z, t0: wall }; return null; }
  if (c.spot && c.mode === 'walk') { c.mode = c.spot.mode; c.until = wall + (c.spot.dwell[0] + Math.random() * (c.spot.dwell[1] - c.spot.dwell[0])) * 1000; if (Math.random() < 0.4) c.meow = wall + 1800; c.meowText = c.spot === BOWL ? 'nyam nyam~' : 'meong~'; return c.spot; }
  if (wall < c.until) return null;
  // time to move on: first hop down if we are up on something
  if (c.z > 0.6) { const [fx, fy] = findPath(grids[c.room], c.x, c.y, c.x + 0.8, c.y + 0.8).slice(-1)[0] ?? [c.x + 0.8, c.y]; c.hop = { x0: c.x, y0: c.y, z0: c.z, x1: fx, y1: fy, z1: 0, t0: wall }; c.spot = null; c.mode = 'walk'; return null; }
  const nx = catPick(c, wall); c.mode = 'walk';
  if (nx.room !== c.room) { c.pending = nx; c.spot = null; const d = door(c.room, nx.room); c.path = findPath(grids[c.room], c.x, c.y, d.x, d.y); }
  else { c.spot = nx; c.path = findPath(grids[c.room], c.x, c.y, nx.x, nx.y); }
  return null;
}
function drawCat(c: C, k: Cat, t: number) {
  const [px, py] = iso(k.x, k.y, k.z);
  c.save(); c.translate(px, py); c.scale(1.35, 1.35); c.translate(-px, -py); drawCatBody(c, k, t); c.restore();
}
function drawCatBody(c: C, k: Cat, t: number) {
  const fur = '#e8913a', dark = '#b8641f', light = '#fbe3c4';
  ell(c, k.x, k.y, k.z, 0.22, 'rgba(0,0,0,.18)');
  const [sx, sy0] = iso(k.x, k.y, k.z), sy = sy0;
  // screen direction of the cat's heading
  let ux = (k.dx - k.dy) * TW, uy = (k.dx + k.dy) * TH; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
  const blob = (x: number, y: number, rx: number, ry: number, rot: number, col: string) => { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, 7); c.fill(); };
  const ears = (hx: number, hy: number, r: number) => {
    c.fillStyle = fur;
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(hx + s * r * 0.95, hy - r * 0.3); c.lineTo(hx + s * r * 0.75, hy - r * 1.55); c.lineTo(hx + s * r * 0.1, hy - r * 0.85); c.closePath(); c.fill(); }
    c.fillStyle = '#f2a7a7'; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(hx + s * r * 0.75, hy - r * 0.55); c.lineTo(hx + s * r * 0.7, hy - r * 1.2); c.lineTo(hx + s * r * 0.35, hy - r * 0.8); c.closePath(); c.fill(); }
  };
  const eyes = (hx: number, hy: number, r: number, closed: boolean) => {
    c.strokeStyle = '#1e1f23'; c.fillStyle = '#1e1f23'; c.lineWidth = 0.45;
    for (const s of [-1, 1]) { if (closed) { c.beginPath(); c.arc(hx + s * r * 0.4, hy - r * 0.05, r * 0.2, 0.2, Math.PI - 0.2); c.stroke(); } else { c.beginPath(); c.arc(hx + s * r * 0.4, hy - r * 0.1, r * 0.17, 0, 7); c.fill(); } }
    c.fillStyle = '#e5848c'; c.beginPath(); c.arc(hx, hy + r * 0.25, r * 0.12, 0, 7); c.fill();
  };
  const tail = (bx: number, by: number, dirx: number, len: number, curl: number) => {
    c.strokeStyle = fur; c.lineWidth = 1.3; c.lineCap = 'round'; c.beginPath(); c.moveTo(bx, by);
    c.quadraticCurveTo(bx + dirx * len * 0.6, by + curl * 0.3, bx + dirx * len, by - len * 0.5 + curl); c.stroke();
    c.strokeStyle = dark; c.lineWidth = 1.3; c.beginPath(); const tx = bx + dirx * len, ty = by - len * 0.5 + curl; c.moveTo(tx - dirx * 0.8, ty + 0.4); c.lineTo(tx, ty); c.stroke(); c.lineCap = 'butt';
  };
  if (k.mode === 'sleep') {                                  // curled up donut
    blob(sx, sy - 2.4, 4.4, 2.8, 0, fur); blob(sx + 0.8, sy - 3.2, 2.2, 1.1, 0, dark);
    tail(sx + 3.6, sy - 1.2, -1, 4.5, 2.2);
    blob(sx - 2.6, sy - 2.6, 2.1, 1.8, 0, fur); ears(sx - 2.6, sy - 3, 1.7); eyes(sx - 2.6, sy - 2.4, 1.7, true);
    const ph = (t * 0.45) % 1; c.fillStyle = `rgba(150,170,215,${1 - ph})`; c.font = 'bold 4px sans-serif'; c.fillText('z', sx + 3 + ph * 3, sy - 8 - ph * 6);
    return;
  }
  const walking = k.mode === 'walk' && (Math.abs(k.vx) + Math.abs(k.vy) > 0.05);
  const back = uy < -0.2;                                    // walking away from us
  const side = ux >= 0 ? 1 : -1;
  if (walking) {
    const ph = t * 11, bob = Math.abs(Math.sin(ph)) * 0.5;
    c.strokeStyle = dark; c.lineWidth = 0.9;
    for (const [o, f] of [[-2.2, 0], [2.2, Math.PI]] as const) for (const q of [0, Math.PI / 2]) { const sw = Math.sin(ph + f + q) * 1.1; c.beginPath(); c.moveTo(sx + ux * o + side * q * 0.3, sy - 2.5); c.lineTo(sx + ux * o + sw * ux, sy - 0.2); c.stroke(); }
    blob(sx, sy - 3.3 - bob, 4.2, 2.1, Math.atan(uy / (Math.abs(ux) < 0.05 ? 0.05 * side : ux)) * 0.35, fur);
    blob(sx - ux * 0.5, sy - 4.2 - bob, 2.6, 0.9, Math.atan(uy / (Math.abs(ux) < 0.05 ? 0.05 * side : ux)) * 0.35, dark);
    tail(sx - ux * 3.8, sy - 3.8 - bob, -side, 4.2, Math.sin(t * 5) * 1.2);
    const hx = sx + ux * 4.2, hy = sy - 5 - bob;
    blob(hx, hy, 2.1, 1.85, 0, fur); ears(hx, hy - 0.2, 1.75);
    if (!back) { blob(hx, hy + 0.5, 1.2, 0.8, 0, light); eyes(hx, hy, 1.75, false); }
    return;
  }
  // sitting / grooming / loaf: upright (or loaf = tucked in)
  const loaf = k.mode === 'loaf';
  tail(sx + side * 2.4, sy - 1, side, 4, Math.sin(t * 1.6) * 1.4);
  if (loaf) { blob(sx, sy - 2.6, 4, 2.4, 0, fur); blob(sx + side * 0.8, sy - 3.6, 2.4, 1, 0, dark); }
  else { blob(sx, sy - 3.8, 2.8, 3.6, 0, fur); blob(sx - side * 0.3, sy - 3.2, 1.4, 2.3, 0, light); blob(sx + side * 1.2, sy - 5.6, 1.4, 0.7, 0.4, dark); }
  const groom = k.mode === 'groom' && Math.floor(t * 1.2) % 3 !== 0;
  const hx = sx - side * (loaf ? 3 : 0.4), hy = sy - (loaf ? 4.4 : 8.2) + (groom ? 1 : 0) + Math.sin(t * 0.9) * 0.2;
  blob(hx, hy, 2.3, 2, 0, fur); ears(hx, hy - 0.2, 1.9); blob(hx, hy + 0.6, 1.3, 0.85, 0, light);
  const blink = Math.floor(t * 0.7 + k.x) % 6 === 0;
  eyes(hx, hy, 1.9, groom || blink || loaf && Math.floor(t / 4) % 2 === 1);
  if (groom) { c.fillStyle = light; c.beginPath(); c.ellipse(hx + side * 1.6, hy + 1.2 + Math.sin(t * 9) * 0.6, 0.9, 0.7, 0, 0, 7); c.fill(); }
}

/** rain or snow behind the big window wall of each floor (Seoul weather) */
function drawWeather(c: C, room: number, t: number) {
  const kind = WEATHER.kind; if (!kind || (FLAT && room > 0)) return;
  const wh = FLAT ? FLATWH - 8 : room === 0 ? WALL + 22 : RH - 14;
  // the floor above hides the top of the glass towards the back: keep the drops below it
  const top = (y: number) => (FLAT ? wh : Math.min(wh, RH - 2 * TH * (NY - y) - 12));
  c.save(); c.beginPath(); const pts = [iso(0, 0.2, 2), iso(0, NY - 0.2, 2), iso(0, NY - 0.2, top(NY - 0.2)), iso(0, 0.2, top(0.2))]; c.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) c.lineTo(q[0], q[1]); c.closePath(); c.clip();
  const n = kind === 'rain' ? 70 : 55;
  for (let i = 0; i < n; i++) {
    const y = 0.2 + hash(`wy${room}${i}`) * (NY - 0.4), sp2 = kind === 'rain' ? 140 : 18, z = wh - ((t * sp2 + hash(`wz${room}${i}`) * wh) % wh);
    const [x0, y0] = iso(0, y + (kind === 'snow' ? Math.sin(t + i) * 0.15 : 0), z);
    if (kind === 'rain') { c.strokeStyle = 'rgba(200,220,255,.35)'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 - 1.2, y0 + 6); c.stroke(); }
    else { c.fillStyle = 'rgba(255,255,255,.8)'; c.beginPath(); c.arc(x0, y0, 0.9, 0, 7); c.fill(); }
  }
  c.restore();
}

/* ---------- the glass lift (against the back wall, through all floors) ---------- */
const LIFTPOS = { r: 1 };          // where the cabin is (room index, fractional while moving)
function drawLift(c: C, room: number, pos: number | null, door: number, night: boolean, t: number, riders: ((c: C, t: number, room: number) => void) | null) {
  const { x0, x1, z: wz } = lwOf(room), sy0 = -1.35, sy1 = -0.05, frame = '#2a2b30';
  const win = wallB(x0, x1, 0, wz);
  c.save(); c.beginPath(); c.moveTo(win[0][0], win[0][1]); for (const q of win.slice(1)) c.lineTo(q[0], q[1]); c.closePath(); c.clip();
  // the shaft behind the glass
  const g = c.createLinearGradient(...iso(x0, sy0, wz), ...iso(x0, sy0, 0)); g.addColorStop(0, night ? '#1a1e27' : '#9aa6b2'); g.addColorStop(1, night ? '#262b36' : '#c4ccd4'); c.fillStyle = g; c.fillRect(-2000, -2000, 4000, 4000);
  c.strokeStyle = night ? '#3a3f4a' : '#7d8894'; c.lineWidth = 0.8; for (const x of [x0 + 0.2, x1 - 0.2]) { const a = iso(x, sy0, -400), b = iso(x, sy0, 400); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  if (pos != null) {
    const zc = (room - pos) * RH, hC = 54, ix0 = x0 + 0.08, ix1 = x1 - 0.08;
    c.translate(0, -zc);
    box(c, ix0, sy0, ix1 - ix0, sy1 - sy0, -3, 3, '#4a4c53', '#2a2b30', '#3a3b42');
    poly(c, [iso(ix0, sy0, 0), iso(ix1, sy0, 0), iso(ix1, sy0, hC), iso(ix0, sy0, hC)], night ? '#5b5446' : '#e9e4da');
    poly(c, [iso(ix0, sy0, 0), iso(ix0, sy1, 0), iso(ix0, sy1, hC), iso(ix0, sy0, hC)], night ? '#4d473c' : '#ddd7cc');
    c.strokeStyle = '#8b8f99'; c.lineWidth = 0.7; { const a = iso(ix0 + 0.05, sy0 + 0.2, 24), b = iso(ix0 + 0.05, sy1 - 0.1, 24); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
    if (night) { const [lx, ly] = iso((ix0 + ix1) / 2, (sy0 + sy1) / 2, hC - 3); const gl = c.createRadialGradient(lx, ly, 0, lx, ly, 26); gl.addColorStop(0, 'rgba(255,225,160,.45)'); gl.addColorStop(1, 'rgba(255,225,160,0)'); c.fillStyle = gl; c.fillRect(lx - 26, ly - 26, 52, 52); }
    riders?.(c, t, room);
    box(c, ix0, sy0, ix1 - ix0, sy1 - sy0, hC, 4, '#3a3b42', '#2a2b30', '#33343a');
  }
  c.restore();
  // the glass panel + sliding glass doors in the wall
  poly(c, win, night ? 'rgba(150,190,240,.16)' : 'rgba(210,235,255,.3)');
  const dx0 = x0 + 0.12, dx1 = x1 - 0.12, half = (dx1 - dx0) / 2, gap = half * door;
  for (const [a, b] of [[dx0, dx0 + half - gap], [dx0 + half + gap, dx1]] as const) if (b - a > 0.01) {
    poly(c, wallB(a, b, 0, 56), night ? 'rgba(160,200,245,.2)' : 'rgba(220,240,255,.35)');
    c.strokeStyle = frame; c.lineWidth = 0.5; c.beginPath(); for (const x of [a, b]) { const p0 = iso(x, 0, 0), p1 = iso(x, 0, 56); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); } c.stroke();
  }
  c.strokeStyle = frame; c.lineWidth = 1; c.beginPath(); for (const q of [...win, win[0]]) c.lineTo(q[0], q[1]); c.stroke();
  { const a = iso(x0, 0, 58), b = iso(x1, 0, 58); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  const [nx, ny] = iso((x0 + x1) / 2, 0, 70); c.fillStyle = '#141518'; c.fillRect(nx - 5, ny - 4, 10, 6); c.fillStyle = '#f2c230'; c.font = '700 4.5px ui-monospace, monospace'; c.textAlign = 'center'; c.fillText(`L${3 - room}`, nx, ny + 0.6); c.textAlign = 'start';
}

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
