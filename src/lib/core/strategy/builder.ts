import { aggregateCandles } from '../timeframes';
import { TIMEFRAME_MS, type Candle, type Timeframe } from '../types';
import type { StrategyAdapter, StrategyContext, StrategyEventDraft } from './adapter';

/**
 * Custom strategies without code. A strategy is a JSON "definition" (stored in strategy_settings.params)
 * made in the website builder, uploaded as a .json file (e.g. written by another AI), or a list of signals (CSV).
 * The engine handles entry at the next M15 open, costs, risk per trade and TP = RR × risk.
 */
export type TF = 'M15' | 'M30' | 'H1' | 'H4' | 'D1';
export const TFS: TF[] = ['M15', 'M30', 'H1', 'H4', 'D1'];

export type Entry =
  | { type: 'donchian'; tf: TF; length: number }
  | { type: 'ema_cross'; tf: TF; fast: number; slow: number }
  | { type: 'price_ema'; tf: TF; length: number }
  | { type: 'rsi'; tf: TF; length: number; low: number; high: number }
  | { type: 'bollinger'; tf: TF; length: number; mult: number }
  | { type: 'macd'; tf: TF; fast: number; slow: number; signal: number }
  | { type: 'session_breakout'; rangeStart: string; rangeEnd: string; windowEnd: string }
  | { type: 'candle'; tf: TF; pattern: 'rejection' | 'engulfing'; wickRatio?: number };

export type Filter =
  | { type: 'ema_trend'; tf: TF; fast: number; slow: number; priceAbove?: boolean }
  | { type: 'price_vs_ema'; tf: TF; length: number }
  | { type: 'rsi_range'; tf: TF; length: number; buyMin?: number; buyMax?: number; sellMin?: number; sellMax?: number }
  | { type: 'session'; from: string; to: string }
  | { type: 'weekdays'; days: number[] };

export type Stop =
  | { type: 'atr'; tf: TF; length?: number; mult: number }
  | { type: 'swing'; lookback: number; bufferAtr?: number }
  | { type: 'range'; bufferAtr?: number }
  | { type: 'fixed'; distance: number };

export interface RuleDefinition {
  kind: 'rules';
  name: string;
  description?: string;
  sides: 'both' | 'long' | 'short';
  entry: Entry;
  filters?: Filter[];
  stop: Stop;
  cooldownBars?: number;
  maxStopAtr?: number;
}
export interface SignalDefinition {
  kind: 'signals';
  name: string;
  description?: string;
  /** [signal candle open time (ms UTC, M15), +1 BUY / −1 SELL, stop-loss price] */
  signals: Array<[number, number, number]>;
}
export type Definition = RuleDefinition | SignalDefinition;
export const CUSTOM_KEY = 'custom_v1';

// ------------------------------------------------------------------ validation (messages in Indonesian)
const isNum = (v: unknown, min = -Infinity, max = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isInt = (v: unknown, min: number, max: number) => isNum(v, min, max) && Number.isInteger(v);
const isTf = (v: unknown): v is TF => typeof v === 'string' && (TFS as string[]).includes(v);
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const toMin = (s: string) => { const m = HHMM.exec(s)!; return +m[1] * 60 + +m[2]; };

export function validateDefinition(d: unknown): { ok: true; def: Definition } | { ok: false; errors: string[] } {
  const e: string[] = [];
  const o = d as Record<string, any>;
  if (!o || typeof o !== 'object') return { ok: false, errors: ['File bukan objek JSON'] };
  if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 60) e.push('name wajib (1–60 huruf)');
  if (o.kind === 'signals') {
    if (!Array.isArray(o.signals) || !o.signals.length) e.push('signals wajib berisi minimal 1 sinyal');
    else if (o.signals.length > 50_000) e.push('signals maksimal 50.000');
    else o.signals.forEach((s: unknown, i: number) => {
      if (e.length > 10) return;
      const ok = Array.isArray(s) && isNum(s[0], 946684800000) && (s[1] === 1 || s[1] === -1) && isNum(s[2], 0.0001);
      if (!ok) e.push(`signals[${i}] harus [waktu_ms, 1 atau -1, harga_SL]`);
    });
    return e.length ? { ok: false, errors: e } : { ok: true, def: o as SignalDefinition };
  }
  if (o.kind !== 'rules') e.push('kind harus "rules" atau "signals"');
  if (!['both', 'long', 'short'].includes(o.sides)) e.push('sides harus "both", "long", atau "short"');
  const en = o.entry ?? {};
  switch (en.type) {
    case 'donchian': if (!isTf(en.tf) || !isInt(en.length, 2, 300)) e.push('entry donchian: tf dan length (2–300)'); break;
    case 'ema_cross': if (!isTf(en.tf) || !isInt(en.fast, 1, 400) || !isInt(en.slow, 2, 400) || en.fast >= en.slow) e.push('entry ema_cross: tf, fast < slow (≤400)'); break;
    case 'price_ema': if (!isTf(en.tf) || !isInt(en.length, 2, 400)) e.push('entry price_ema: tf dan length (2–400)'); break;
    case 'rsi': if (!isTf(en.tf) || !isInt(en.length, 2, 100) || !isNum(en.low, 1, 99) || !isNum(en.high, 1, 99) || en.low >= en.high) e.push('entry rsi: tf, length, low < high'); break;
    case 'bollinger': if (!isTf(en.tf) || !isInt(en.length, 2, 200) || !isNum(en.mult, 0.5, 5)) e.push('entry bollinger: tf, length, mult (0.5–5)'); break;
    case 'macd': if (!isTf(en.tf) || !isInt(en.fast, 1, 100) || !isInt(en.slow, 2, 200) || !isInt(en.signal, 1, 100) || en.fast >= en.slow) e.push('entry macd: tf, fast < slow, signal'); break;
    case 'session_breakout': if (![en.rangeStart, en.rangeEnd, en.windowEnd].every((x) => typeof x === 'string' && HHMM.test(x)) || toMin(en.rangeStart) >= toMin(en.rangeEnd) || toMin(en.rangeEnd) >= toMin(en.windowEnd)) e.push('entry session_breakout: rangeStart < rangeEnd < windowEnd (format "HH:MM" UTC)'); break;
    case 'candle': if (!isTf(en.tf) || !['rejection', 'engulfing'].includes(en.pattern) || (en.wickRatio != null && !isNum(en.wickRatio, 0.5, 0.95))) e.push('entry candle: tf, pattern rejection/engulfing, wickRatio 0.5–0.95'); break;
    default: e.push('entry.type tidak dikenal (donchian, ema_cross, price_ema, rsi, bollinger, macd, session_breakout, candle)');
  }
  const fs = o.filters ?? [];
  if (!Array.isArray(fs) || fs.length > 8) e.push('filters harus daftar (maks 8)');
  else fs.forEach((f: any, i: number) => {
    switch (f?.type) {
      case 'ema_trend': if (!isTf(f.tf) || !isInt(f.fast, 1, 400) || !isInt(f.slow, 2, 400) || f.fast >= f.slow) e.push(`filters[${i}] ema_trend: tf, fast < slow`); break;
      case 'price_vs_ema': if (!isTf(f.tf) || !isInt(f.length, 2, 400)) e.push(`filters[${i}] price_vs_ema: tf, length`); break;
      case 'rsi_range': if (!isTf(f.tf) || !isInt(f.length, 2, 100)) e.push(`filters[${i}] rsi_range: tf, length`); break;
      case 'session': if (!HHMM.test(f.from ?? '') || !HHMM.test(f.to ?? '')) e.push(`filters[${i}] session: from/to "HH:MM" UTC`); break;
      case 'weekdays': if (!Array.isArray(f.days) || !f.days.length || !f.days.every((x: unknown) => isInt(x, 0, 6))) e.push(`filters[${i}] weekdays: days 0–6 (0 = Minggu)`); break;
      default: e.push(`filters[${i}].type tidak dikenal (ema_trend, price_vs_ema, rsi_range, session, weekdays)`);
    }
  });
  const st = o.stop ?? {};
  switch (st.type) {
    case 'atr': if (!isTf(st.tf) || !isNum(st.mult, 0.1, 20) || (st.length != null && !isInt(st.length, 2, 100))) e.push('stop atr: tf, mult (0.1–20)'); break;
    case 'swing': if (!isInt(st.lookback, 2, 200) || (st.bufferAtr != null && !isNum(st.bufferAtr, 0, 5))) e.push('stop swing: lookback (2–200), bufferAtr'); break;
    case 'range': if (en.type !== 'session_breakout') e.push('stop range hanya untuk entry session_breakout'); break;
    case 'fixed': if (!isNum(st.distance, 0.05, 500)) e.push('stop fixed: distance dalam $ (0.05–500)'); break;
    default: e.push('stop.type tidak dikenal (atr, swing, range, fixed)');
  }
  if (o.cooldownBars != null && !isInt(o.cooldownBars, 0, 500)) e.push('cooldownBars 0–500');
  if (o.maxStopAtr != null && !isNum(o.maxStopAtr, 0.1, 50)) e.push('maxStopAtr 0.1–50');
  return e.length ? { ok: false, errors: e } : { ok: true, def: o as RuleDefinition };
}

// ------------------------------------------------------------------ indicators (pandas/Pine-compatible)
function ema(v: readonly number[], n: number): number[] {
  const a = 2 / (n + 1), out = new Array<number>(v.length);
  let e = v[0];
  for (let i = 0; i < v.length; i++) { e = i ? a * v[i] + (1 - a) * e : v[0]; out[i] = e; }
  return out;
}
function sma(v: readonly number[], n: number, i: number) { let s = 0; for (let k = i - n + 1; k <= i; k++) s += v[k]; return s / n; }
function rsi(v: readonly number[], n: number): number[] {
  const out = new Array<number>(v.length).fill(NaN);
  let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); continue; }
    g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
export function atrLast(c: readonly Candle[], n = 14): number {
  if (c.length < n + 1) return NaN;
  let rma = NaN, sum = 0;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    if (i <= n) { sum += tr; if (i === n) rma = sum / n; } else rma = (rma * (n - 1) + tr) / n;
  }
  return rma;
}

// ------------------------------------------------------------------ adapter
const DAY = 86_400_000;
interface St { last?: number; n?: number; day?: number; brk?: Record<string, number>; sig?: Map<number, [number, number]>; sigKey?: number }

function series(ctx: StrategyContext, tf: TF): Candle[] {
  if (tf === 'M15') return ctx.candles as Candle[];
  if (tf === 'M30') return aggregateCandles(ctx.candles, 'M15', 'M30', 'utc', false);
  return (ctx.htf?.[tf as Timeframe] ?? []) as Candle[];
}
/** true when the last candle of `tf` closed exactly at ctx.now (so a HTF rule fires once per HTF candle) */
function justClosed(ctx: StrategyContext, tf: TF, c: readonly Candle[]) {
  if (tf === 'M15') return true;
  const last = c[c.length - 1];
  return !!last && last.time + TIMEFRAME_MS[tf as Timeframe] === ctx.now;
}

function entrySignal(ctx: StrategyContext, en: Entry, st: St): { side: 1 | -1; why: string; range?: [number, number] } | null {
  if (en.type === 'session_breakout') {
    const bar = ctx.candles[ctx.candles.length - 1];
    const d0 = Math.floor(bar.time / DAY) * DAY;
    if (st.day !== d0) { st.day = d0; st.brk = {}; }
    const min = (bar.time - d0) / 60_000;
    if (min < toMin(en.rangeEnd) || min >= toMin(en.windowEnd)) return null;
    const rng = ctx.candles.filter((c) => c.time >= d0 + toMin(en.rangeStart) * 60_000 && c.time < d0 + toMin(en.rangeEnd) * 60_000);
    if (!rng.length) return null;
    const hi = Math.max(...rng.map((c) => c.high)), lo = Math.min(...rng.map((c) => c.low));
    const b = (st.brk ??= {});
    if (bar.close > hi && !b.u) { b.u = 1; return { side: 1, why: `tembus high range ${en.rangeStart}–${en.rangeEnd}`, range: [lo, hi] }; }
    if (bar.close < lo && !b.d) { b.d = 1; return { side: -1, why: `tembus low range ${en.rangeStart}–${en.rangeEnd}`, range: [lo, hi] }; }
    return null;
  }
  const c = series(ctx, en.tf);
  if (c.length < 3 || !justClosed(ctx, en.tf, c)) return null;
  const cl = c.map((x) => x.close), i = c.length - 1;
  switch (en.type) {
    case 'donchian': {
      if (c.length <= en.length) return null;
      const prev = c.slice(-en.length - 1, -1);
      if (cl[i] > Math.max(...prev.map((x) => x.high))) return { side: 1, why: `${en.tf} tembus high ${en.length} candle` };
      if (cl[i] < Math.min(...prev.map((x) => x.low))) return { side: -1, why: `${en.tf} tembus low ${en.length} candle` };
      return null;
    }
    case 'ema_cross': {
      const f = ema(cl, en.fast), s = ema(cl, en.slow);
      if (f[i - 1] <= s[i - 1] && f[i] > s[i]) return { side: 1, why: `EMA${en.fast} memotong ke atas EMA${en.slow} ${en.tf}` };
      if (f[i - 1] >= s[i - 1] && f[i] < s[i]) return { side: -1, why: `EMA${en.fast} memotong ke bawah EMA${en.slow} ${en.tf}` };
      return null;
    }
    case 'price_ema': {
      const e = ema(cl, en.length);
      if (cl[i - 1] <= e[i - 1] && cl[i] > e[i]) return { side: 1, why: `close ${en.tf} naik melewati EMA${en.length}` };
      if (cl[i - 1] >= e[i - 1] && cl[i] < e[i]) return { side: -1, why: `close ${en.tf} turun melewati EMA${en.length}` };
      return null;
    }
    case 'rsi': {
      const r = rsi(cl, en.length);
      if (r[i - 1] < en.low && r[i] >= en.low) return { side: 1, why: `RSI ${en.tf} keluar dari ${en.low}` };
      if (r[i - 1] > en.high && r[i] <= en.high) return { side: -1, why: `RSI ${en.tf} turun dari ${en.high}` };
      return null;
    }
    case 'bollinger': {
      if (c.length < en.length + 2) return null;
      const band = (k: number) => {
        const m = sma(cl, en.length, k);
        let v = 0; for (let q = k - en.length + 1; q <= k; q++) v += (cl[q] - m) ** 2;
        const sd = Math.sqrt(v / (en.length - 1));
        return [m - en.mult * sd, m + en.mult * sd];
      };
      const [lo0, hi0] = band(i - 1), [lo1, hi1] = band(i);
      if (cl[i - 1] < lo0 && cl[i] > lo1) return { side: 1, why: `${en.tf} kembali masuk Bollinger bawah` };
      if (cl[i - 1] > hi0 && cl[i] < hi1) return { side: -1, why: `${en.tf} kembali masuk Bollinger atas` };
      return null;
    }
    case 'macd': {
      const f = ema(cl, en.fast), s = ema(cl, en.slow), m = f.map((x, k) => x - s[k]), sg = ema(m, en.signal);
      if (m[i - 1] <= sg[i - 1] && m[i] > sg[i]) return { side: 1, why: `MACD ${en.tf} memotong ke atas` };
      if (m[i - 1] >= sg[i - 1] && m[i] < sg[i]) return { side: -1, why: `MACD ${en.tf} memotong ke bawah` };
      return null;
    }
    case 'candle': {
      const x = c[i], p = c[i - 1], range = Math.max(x.high - x.low, 0.01), w = en.wickRatio ?? 0.6;
      if (en.pattern === 'rejection') {
        if (x.close > x.open && x.close > p.close && (x.close - x.low) / range >= w) return { side: 1, why: `rejection bullish ${en.tf}` };
        if (x.close < x.open && x.close < p.close && (x.high - x.close) / range >= w) return { side: -1, why: `rejection bearish ${en.tf}` };
      } else {
        if (p.close < p.open && x.close > x.open && x.close >= p.open && x.open <= p.close) return { side: 1, why: `bullish engulfing ${en.tf}` };
        if (p.close > p.open && x.close < x.open && x.close <= p.open && x.open >= p.close) return { side: -1, why: `bearish engulfing ${en.tf}` };
      }
      return null;
    }
  }
}

function passFilters(ctx: StrategyContext, fs: Filter[], side: 1 | -1): boolean {
  const bar = ctx.candles[ctx.candles.length - 1];
  for (const f of fs) {
    if (f.type === 'session') {
      const min = (bar.time % DAY) / 60_000, a = toMin(f.from), b = toMin(f.to);
      const inside = a <= b ? min >= a && min < b : min >= a || min < b;
      if (!inside) return false;
      continue;
    }
    if (f.type === 'weekdays') { if (!f.days.includes(new Date(bar.time).getUTCDay())) return false; continue; }
    const c = series(ctx, f.tf);
    if (c.length < 3) return false;
    const cl = c.map((x) => x.close), i = cl.length - 1;
    if (f.type === 'ema_trend') {
      const fa = ema(cl, f.fast)[i], sl = ema(cl, f.slow)[i];
      const up = fa > sl && (!f.priceAbove || cl[i] > fa), dn = fa < sl && (!f.priceAbove || cl[i] < fa);
      if (side > 0 ? !up : !dn) return false;
    } else if (f.type === 'price_vs_ema') {
      const e = ema(cl, f.length)[i];
      if (side > 0 ? !(cl[i] > e) : !(cl[i] < e)) return false;
    } else if (f.type === 'rsi_range') {
      const r = rsi(cl, f.length)[i];
      if (!Number.isFinite(r)) return false;
      const [mn, mx] = side > 0 ? [f.buyMin ?? 0, f.buyMax ?? 100] : [f.sellMin ?? 0, f.sellMax ?? 100];
      if (r < mn || r > mx) return false;
    }
  }
  return true;
}

function stopPrice(ctx: StrategyContext, d: RuleDefinition, side: 1 | -1, range?: [number, number]): number {
  const m = ctx.candles, bar = m[m.length - 1], a15 = atrLast(m.slice(-120), 14);
  const s = d.stop;
  switch (s.type) {
    case 'atr': { const a = atrLast(series(ctx, s.tf).slice(-200), s.length ?? 14); return bar.close - side * s.mult * a; }
    case 'swing': {
      const w = m.slice(-s.lookback), buf = (s.bufferAtr ?? 0.1) * a15;
      return side > 0 ? Math.min(...w.map((x) => x.low)) - buf : Math.max(...w.map((x) => x.high)) + buf;
    }
    case 'range': { if (!range) return NaN; const buf = (s.bufferAtr ?? 0) * a15; return side > 0 ? range[0] - buf : range[1] + buf; }
    case 'fixed': return bar.close - side * s.distance;
  }
}

export const customAdapter: StrategyAdapter = {
  key: CUSTOM_KEY,
  name: 'Strategi buatan sendiri',
  configured: true,
  testOnly: false,
  warmupCandles: 30,
  requiredTimeframes: ['H1', 'H4', 'D1'],
  htfWindow: { H1: 600, H4: 600, D1: 300 },
  evaluate(ctx) {
    const v = validateDefinition(ctx.params?.definition);
    if (!v.ok) return [];
    const d = v.def;
    const st = ctx.state as St;
    const bar = ctx.candles[ctx.candles.length - 1];
    const ev = (side: 1 | -1, sl: number, why: string): StrategyEventDraft => ({
      type: 'SETUP_CONFIRMED', candleTime: bar.time, price: bar.close, zone: null,
      confirmations: {}, status: `${side > 0 ? 'BUY' : 'SELL'} — ${why}; entry di open M15 berikutnya`,
      details: { side: side > 0 ? 'long' : 'short', stop_loss: Number(sl.toFixed(4)) },
    });

    if (d.kind === 'signals') {
      // signals are looked up by the CURRENT candle only — a signal can never act before its candle has closed
      if (!st.sig || st.sigKey !== d.signals.length) { st.sig = new Map(d.signals.map(([t, s, sl]) => [t, [s, sl]])); st.sigKey = d.signals.length; }
      const s = st.sig.get(bar.time);
      if (!s) return [];
      const [side, sl] = s;
      if (side > 0 ? !(sl < bar.close) : !(sl > bar.close)) return [];
      return [ev(side as 1 | -1, sl, 'sinyal dari file')];
    }

    st.n = (st.n ?? 0) + 1;
    if (st.last != null && st.n - st.last < (d.cooldownBars ?? 0)) { entrySignal(ctx, d.entry, st); return []; }
    const sig = entrySignal(ctx, d.entry, st);
    if (!sig) return [];
    if ((d.sides === 'long' && sig.side < 0) || (d.sides === 'short' && sig.side > 0)) return [];
    if (!passFilters(ctx, d.filters ?? [], sig.side)) return [];
    const sl = stopPrice(ctx, d, sig.side, sig.range);
    if (!Number.isFinite(sl) || (sig.side > 0 ? sl >= bar.close : sl <= bar.close)) return [];
    if (d.maxStopAtr != null) {
      const a15 = atrLast(ctx.candles.slice(-120), 14);
      if (Math.abs(bar.close - sl) > d.maxStopAtr * a15) return [];
    }
    st.last = st.n;
    return [ev(sig.side, sl, sig.why)];
  },
};

/** Text the owner can paste into any AI so it writes a valid strategy file for this website. */
export const AI_GUIDE = `Buatkan file strategi JSON untuk website backtest XAUUSD saya. Aturan format (wajib persis):
{
  "kind": "rules",
  "name": "nama pendek (maks 60 huruf)",
  "description": "penjelasan singkat (opsional)",
  "sides": "both" | "long" | "short",
  "entry": SATU dari:
    {"type":"donchian","tf":TF,"length":20}                      // close tembus high/low N candle
    {"type":"ema_cross","tf":TF,"fast":9,"slow":21}              // EMA cepat memotong EMA lambat
    {"type":"price_ema","tf":TF,"length":50}                     // close memotong EMA
    {"type":"rsi","tf":TF,"length":14,"low":30,"high":70}       // RSI keluar dari oversold/overbought
    {"type":"bollinger","tf":TF,"length":20,"mult":2}            // close kembali masuk Bollinger
    {"type":"macd","tf":TF,"fast":12,"slow":26,"signal":9}       // MACD memotong signal
    {"type":"session_breakout","rangeStart":"00:00","rangeEnd":"07:00","windowEnd":"11:00"}  // jam UTC
    {"type":"candle","tf":TF,"pattern":"rejection"|"engulfing","wickRatio":0.6}
  "filters": daftar opsional (semua harus terpenuhi):
    {"type":"ema_trend","tf":TF,"fast":50,"slow":200,"priceAbove":true}   // BUY hanya jika EMA cepat > lambat
    {"type":"price_vs_ema","tf":TF,"length":200}
    {"type":"rsi_range","tf":TF,"length":14,"buyMin":50,"sellMax":50}
    {"type":"session","from":"07:00","to":"17:00"}                         // jam UTC
    {"type":"weekdays","days":[1,2,3,4,5]}                                 // 0=Minggu
  "stop": SATU dari:
    {"type":"atr","tf":TF,"mult":2}            // SL = close ∓ mult × ATR14
    {"type":"swing","lookback":10,"bufferAtr":0.1}
    {"type":"range","bufferAtr":0}             // hanya untuk session_breakout
    {"type":"fixed","distance":5}              // SL $5 dari entry
  "cooldownBars": 0,          // opsional, jeda minimal antar sinyal (candle M15)
  "maxStopAtr": 4             // opsional, lewati sinyal jika SL > 4 × ATR M15
}
TF = "M15" | "M30" | "H1" | "H4" | "D1". Take profit TIDAK diisi: website menguji RR 1:1, 1:2, 1:3 otomatis.
Entry selalu di open candle M15 berikutnya setelah sinyal. Balas HANYA dengan JSON yang valid, tanpa komentar.`;
