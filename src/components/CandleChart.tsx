'use client';
import { useEffect, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type SeriesMarker, type IPriceLine, type Logical,
} from 'lightweight-charts';
import { TradePositionOverlay, type TradePosition } from '@/components/TradePositionOverlay';
import { DrawingsPrimitive, EMPTY, FIB, fibPrice, loadDraw, saveDraw, type Drawings, type Kind, type T4 } from '@/components/ChartDrawings';
import type { Candle } from '@/lib/core/types';
import { tzOffsetMinutes } from '@/lib/core/time';

export interface ChartZone { id: string; low: number; high: number; kind: string }
export interface ChartMarker { time: number; text: string; position: 'above' | 'below'; shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown' }

/* Candle colours like TradingView (owner's choice, 14 Nov 2026): blue up, red down, on every chart of the website. */
export const CANDLE_UP = '#2962FF', CANDLE_DOWN = '#F23645';

/* Indicators (29 Nov 2026, TradingView-like tools): choice remembered on this device for every chart. */
type Ind = { vol: boolean; e20: boolean; e50: boolean; e200: boolean; rsi: boolean };
const IND0: Ind = { vol: false, e20: false, e50: false, e200: false, rsi: false };
const loadInd = (): Ind => { try { return { ...IND0, ...JSON.parse(localStorage.getItem('chart-ind') || '{}') }; } catch { return IND0; } };
const emaOf = (v: number[], n: number) => { const k = 2 / (n + 1), o: number[] = []; let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o.push(e); } return o; };
const rsiOf = (v: number[], n = 14) => {
  const o: Array<number | null> = [null]; let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; o.push(i === n ? (l === 0 ? 100 : 100 - 100 / (1 + g / l)) : null); }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o.push(l === 0 ? 100 : 100 - 100 / (1 + g / l)); }
  }
  return o;
};
const digitsOf = (p: number) => (p >= 1000 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.01 ? 5 : 7);

type Tool = '' | 'trend' | 'hline' | 'rect' | 'fib' | 'long' | 'short' | 'erase';
type Hit = { kind: Kind; i: number; end: number };
const NO_ZONES: ChartZone[] = [], NO_MARKERS: ChartMarker[] = [];   // stable defaults: a new [] each render would re-run the data effects

/**
 * Candlestick chart. lightweight-charts renders in UTC, so times are
 * shifted by the display timezone offset (DST-aware per candle) for the axis only.
 * With drawKey or position: TradingView-like tools (drawings, indicators, full screen).
 */
export default function CandleChart({ candles, zones = NO_ZONES, markers = NO_MARKERS, timezone = 'UTC', fitKey, position, drawKey, initialBars }:
  { candles: Candle[]; zones?: ChartZone[]; markers?: ChartMarker[]; timezone?: string; fitKey?: string; position?: TradePosition; drawKey?: string; initialBars?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const focus = useRef<() => void>(() => {});
  const lastFit = useRef<string | undefined>(undefined);
  const tools = !!(drawKey || position);
  const candlesRef = useRef(candles); candlesRef.current = candles;

  useEffect(() => {
    if (!box.current) return;
    // colours follow the theme tokens (light / dark)
    const css = getComputedStyle(box.current);
    const v = (k: string, d: string) => css.getPropertyValue(k).trim() || d;
    const up = CANDLE_UP, dn = CANDLE_DOWN;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: v('--surface', '#ffffff') }, textColor: v('--mute', '#8a94a6'), fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif" },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },   // plain background (owner's choice, 9 Nov 2026)
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { scaleMargins: { top: 0.14, bottom: 0.14 }, borderColor: v('--line', '#e4e7ec') },
      timeScale: { borderColor: v('--line', '#e4e7ec'), timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 9, minBarSpacing: 0.4 },   // allow zooming far out (years of candles)
      // like TradingView: drag the price or time axis to stretch it, double-tap the axis to reset
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true },
    });
    series.current = c.addCandlestickSeries({
      upColor: up, borderUpColor: up, wickUpColor: up,
      downColor: dn, borderDownColor: dn, wickDownColor: dn,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      priceLineVisible: !position, lastValueVisible: true,
    });
    chart.current = c;
    return () => { c.remove(); chart.current = null; series.current = null; lines.current = []; };
  }, []);

  const shift = (t: number) => ((t + tzOffsetMinutes(t, timezone) * 60_000) / 1000) as UTCTimestamp;
  const digits = digitsOf(candles[candles.length - 1]?.close ?? 1);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    s.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove: 10 ** -digits } });   // small alt prices keep their decimals
    s.setData(candles.map((c) => ({ time: shift(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    const m: SeriesMarker<UTCTimestamp>[] = markers
      .map((x) => ({ time: shift(x.time), position: x.position === 'above' ? 'aboveBar' as const : 'belowBar' as const, shape: x.shape, color: box.current ? (getComputedStyle(box.current).getPropertyValue('--ink').trim() || '#1b2433') : '#1b2433', text: x.text }))
      .sort((a, b) => a.time - b.time);
    s.setMarkers(m);
    if (!position && fitKey !== lastFit.current) {
      // open on the latest candles (zoomed in); older history stays a swipe away
      if (initialBars && candles.length > initialBars) chart.current?.timeScale().setVisibleLogicalRange({ from: candles.length - initialBars, to: candles.length + 4 });
      else chart.current?.timeScale().fitContent();
      lastFit.current = fitKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, markers, timezone, fitKey]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    lines.current.forEach((l) => s.removePriceLine(l));
    lines.current = zones.flatMap((z) => [
      s.createPriceLine({ price: z.high, color: z.kind === 'resistance' ? '#c2410c' : '#a87a1f', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: z.kind === 'resistance' ? 'R' : z.kind === 'support' ? 'S' : 'Z' }),
      s.createPriceLine({ price: z.low, color: z.kind === 'resistance' ? '#c2410c' : '#a87a1f', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' }),
    ]);
  }, [zones]);

  useEffect(() => {
    const c = chart.current, s = series.current;
    if (!c || !s || !position || !candles.length) return;
    if (![position.entryPrice, position.stopLoss, position.takeProfit].every((value) => Number.isFinite(value) && value > 0)) { c.timeScale().fitContent(); return; }
    const indexAt = (time: number) => {
      let index = candles.findIndex((bar) => bar.time >= time);
      if (index < 0) index = candles.length - 1;
      if (index > 0 && candles[index].time > time) index--;
      return index;
    };
    const entryIndex = indexAt(position.entry);
    // open trade: entry / SL / TP boxes run up to the newest candle (and a little past it) until one is hit
    const exitIndex = position.exit == null ? candles.length - 1 + 3 : indexAt(position.exit);
    const overlay = new TradePositionOverlay(position, entryIndex, exitIndex);
    s.attachPrimitive(overlay);
    focus.current = () => {
      const span = Math.min(100, Math.max(55, exitIndex - entryIndex + 24));
      c.priceScale('right').applyOptions({ autoScale: true });
      c.timeScale().setVisibleLogicalRange({ from: entryIndex - 16, to: entryIndex + span - 16 });
    };
    // focus once per trade / timeframe; live candle updates keep the view where the person left it
    if (lastFit.current !== fitKey) { focus.current(); lastFit.current = fitKey; }
    return () => { s.detachPrimitive(overlay); };
  }, [position, candles, fitKey]);

  /* ---- indicators: volume, EMA 20/50/200, RSI 14 (bottom band) ---- */
  const [ind, setInd] = useState<Ind>(() => (typeof window !== 'undefined' ? loadInd() : IND0));
  const [menu, setMenu] = useState(false);
  const indSeries = useRef<ISeriesApi<any>[]>([]);
  const toggleInd = (k: keyof Ind) => setInd((cur) => { const n = { ...cur, [k]: !cur[k] }; try { localStorage.setItem('chart-ind', JSON.stringify(n)); } catch { /* storage off */ } return n; });
  useEffect(() => {
    const c = chart.current, s = series.current; if (!c || !s) return;
    for (const x of indSeries.current) { try { c.removeSeries(x); } catch { /* gone */ } }
    indSeries.current = [];
    const hasVol = tools && ind.vol && candles.some((k) => (k.volume ?? 0) > 0), rsiOn = tools && ind.rsi;
    s.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: rsiOn ? 0.4 : hasVol ? 0.26 : 0.14 } });   // the bottom 10% stays clear for the view toolbar
    if (!tools || !candles.length) return;
    const ink = (box.current && getComputedStyle(box.current).getPropertyValue('--ink').trim()) || '#1b2433';
    const mute = (box.current && getComputedStyle(box.current).getPropertyValue('--mute').trim()) || '#8a94a6';
    const cl = candles.map((k) => k.close), T = candles.map((k) => shift(k.time));
    if (hasVol) {
      const v = c.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false });
      v.priceScale().applyOptions({ scaleMargins: { top: rsiOn ? 0.5 : 0.76, bottom: rsiOn ? 0.38 : 0.11 } });
      v.setData(candles.map((k, i) => ({ time: T[i], value: k.volume ?? 0, color: k.close >= k.open ? 'rgba(41, 98, 255, .28)' : 'rgba(242, 54, 69, .28)' })));
      indSeries.current.push(v);
    }
    for (const [key, n, color, width, style] of [['e20', 20, ink, 1, LineStyle.Solid], ['e50', 50, mute, 1, LineStyle.Dashed], ['e200', 200, ink, 2, LineStyle.Solid]] as const) {
      if (!ind[key]) continue;
      const e = emaOf(cl, n);
      const l = c.addLineSeries({ color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
      l.setData(e.map((value, i) => ({ time: T[i], value })).slice(Math.min(n, e.length - 1)));
      indSeries.current.push(l);
    }
    if (rsiOn) {
      const r = rsiOf(cl);
      const l = c.addLineSeries({ priceScaleId: 'rsi', color: ink, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
      l.priceScale().applyOptions({ scaleMargins: { top: 0.66, bottom: 0.12 } });
      l.setData(r.flatMap((value, i) => (value == null ? [] : [{ time: T[i], value }])));
      for (const p of [70, 30]) l.createPriceLine({ price: p, color: mute, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
      indSeries.current.push(l);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ind, candles, timezone, tools]);

  const autoScale = () => { chart.current?.priceScale('right').applyOptions({ autoScale: true }); };

  /* ---- full screen (inside a sheet too: the sheet's transform is switched off while full, see CSS) ---- */
  const [full, setFull] = useState(false);
  useEffect(() => {
    const el = box.current?.closest('.chartbox'); if (!el) return;
    el.classList.toggle('chart-full', full);
    if (!full) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setFull(false); } };
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('keydown', esc, true); el.classList.remove('chart-full'); };
  }, [full]);

  /* ---- drawing tools ----
   * Like TradingView: tap a drawing to select it (handles appear), then drag a handle or the drawing itself straight away.
   * Long press also picks a drawing up. Tap empty chart to finish. Everything is painted by one canvas primitive. */
  const [mode, setMode] = useState<Tool>('');
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<{ kind: Kind; i: number } | null>(null);
  const [grab, setGrab] = useState(false);
  const store = drawKey;
  const [draw, setDraw] = useState<Drawings>(() => (store && typeof window !== 'undefined' ? loadDraw(store) : { ...EMPTY }));
  useEffect(() => { if (store) { setDraw(loadDraw(store)); setSel(null); } }, [store]);
  const drawRef = useRef(draw); drawRef.current = draw;
  const selRef = useRef(sel); selRef.current = sel;
  const modeRef = useRef(mode); modeRef.current = mode;
  const anchorRef = useRef(anchor); anchorRef.current = anchor;
  const update = (d: Drawings) => { drawRef.current = d; setDraw(d); if (store) saveDraw(store, d); };
  const css = (k: string, d: string) => (box.current ? getComputedStyle(box.current).getPropertyValue(k).trim() : '') || d;
  // bar grid of the current timeframe: points snap to it so drawings sit on real candles
  const barMs = () => { const cs = candlesRef.current, n = cs.length; if (n < 2) return 60_000; const g: number[] = []; for (let i = Math.max(1, n - 50); i < n; i++) g.push(cs[i].time - cs[i - 1].time); g.sort((a, b) => a - b); return g[g.length >> 1] || 60_000; };
  const snap = (ms: number) => { const b = barMs(), first = candlesRef.current[0]?.time ?? ms; return first + Math.round((ms - first) / b) * b; };
  /** logical bar index of a real time (before the first / past the newest candle: extrapolated on the bar grid) */
  const logicalOf = (ms: number) => {
    const cs = candlesRef.current, n = cs.length; if (!n) return null;
    const b = barMs();
    if (ms >= cs[n - 1].time) return n - 1 + Math.round((ms - cs[n - 1].time) / b);
    if (ms <= cs[0].time) return Math.round((ms - cs[0].time) / b);
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cs[mid].time <= ms) lo = mid; else hi = mid; }
    return ms - cs[lo].time < cs[hi].time - ms ? lo : hi;
  };
  const xOf = (ms: number) => { const lg = logicalOf(ms); return lg == null ? null : chart.current?.timeScale().logicalToCoordinate(lg as Logical) ?? null; };
  const atrNow = () => { const cs = candlesRef.current, n = cs.length; let a = 0, k = 0; for (let i = Math.max(1, n - 14); i < n; i++) { a += Math.max(cs[i].high - cs[i].low, Math.abs(cs[i].high - cs[i - 1].close), Math.abs(cs[i].low - cs[i - 1].close)); k++; } return k ? a / k : 0; };
  // a point of the chart (px) -> real time (ms) and price
  const timeAt = (x: number) => { const c = chart.current, cs = candlesRef.current; const lg = c?.timeScale().coordinateToLogical(x); if (lg == null || !cs.length) return null; const i = Math.round(lg), last = cs.length - 1; return i <= last ? cs[Math.max(0, i)].time : cs[last].time + (i - last) * barMs(); };
  const priceAt = (y: number) => { const v = series.current?.coordinateToPrice(y); return v == null ? null : Number(v); };
  // the primitive paints every drawing and reads the newest state on every frame
  const prim = useRef<DrawingsPrimitive | null>(null);
  useEffect(() => {
    const s = series.current; if (!s || !store) return;
    const p = new DrawingsPrimitive(() => ({ d: drawRef.current, xOf, barMs: barMs(), ink: css('--ink', '#000000'), surface: css('--surface', '#ffffff'), digits: digitsOf(candlesRef.current[candlesRef.current.length - 1]?.close ?? 1), sel: selRef.current, width: chart.current?.timeScale().width() ?? 0 }));
    s.attachPrimitive(p); prim.current = p;
    return () => { try { s.detachPrimitive(p); } catch { /* chart gone */ } prim.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  useEffect(() => { prim.current?.update(); }, [draw, sel, candles, timezone]);

  /** the drawing under a point. end = which handle (-1 = the whole drawing). Touch gets a bigger reach than a mouse. */
  function hitTest(px: number, py: number): Hit | null {
    const s = series.current, d0 = drawRef.current; if (!s) return null;
    const R = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 22 : 12, RH = R + 6;
    const X = (ms: number) => xOf(ms), Y = (pr: number) => s.priceToCoordinate(pr), cur = selRef.current;
    let best: (Hit & { d: number }) | null = null;
    // the selected drawing wins ties, so its handles are easy to grab even where drawings overlap
    const take = (d: number, kind: Kind, i: number, end: number, lim = R) => { const dd = cur && cur.kind === kind && cur.i === i ? d - 6 : d; if (d <= lim && dd < (best?.d ?? Infinity)) best = { d: dd, kind, i, end }; };
    const segDist = (x1: number, y1: number, x2: number, y2: number) => { const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)); return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy)); };
    d0.h.forEach((pr, i) => { const y = Y(pr); if (y != null) take(Math.abs(y - py), 'h', i, -1); });
    for (const kind of ['t', 'f'] as const) (kind === 't' ? d0.t : d0.f).forEach(([a, pa, b, pb], i) => {
      const x1 = X(a), y1 = Y(pa), x2 = X(b), y2 = Y(pb); if (x1 == null || x2 == null || y1 == null || y2 == null) return;
      const e1 = Math.hypot(px - x1, py - y1), e2 = Math.hypot(px - x2, py - y2);
      take(e1 - 4, kind, i, 0, RH); take(e2 - 4, kind, i, 1, RH);
      if (kind === 't') take(segDist(x1, y1, x2, y2), 't', i, -1);
      else { const L = Math.min(x1, x2), Rr = Math.max(x1, x2, L + 40); if (px >= L && px <= Rr) for (const lv of FIB) { const y = Y(fibPrice(pa, pb, lv)); if (y != null) take(Math.abs(y - py), 'f', i, -1); } }
    });
    d0.r.forEach(([a, pa, b, pb], i) => {
      const x1 = X(a), y1 = Y(pa), x2 = X(b), y2 = Y(pb); if (x1 == null || x2 == null || y1 == null || y2 == null) return;
      ([[x1, y1], [x2, y2], [x1, y2], [x2, y1]] as const).forEach(([x, y], k) => take(Math.hypot(px - x, py - y) - 4, 'r', i, k, RH));
      if (px >= Math.min(x1, x2) - 4 && px <= Math.max(x1, x2) + 4 && py >= Math.min(y1, y2) - 4 && py <= Math.max(y1, y2) + 4) take(R - 2, 'r', i, -1);
    });
    d0.p.forEach(([tm, e, sl, tp, w], i) => {
      const x1 = X(tm), x2 = X(tm + w * barMs()), ye = Y(e), ys = Y(sl), yt = Y(tp); if (x1 == null || x2 == null || ys == null || yt == null || ye == null) return;
      const W = Math.max(8, x2 - x1), xr = x1 + W, inX = px >= x1 - 6 && px <= xr + 6, inY = py >= Math.min(ys, yt) - 4 && py <= Math.max(ys, yt) + 4;
      take(Math.hypot(px - (x1 + W / 2), py - yt) - 4, 'p', i, 0, RH); take(Math.hypot(px - (x1 + W / 2), py - ys) - 4, 'p', i, 1, RH);
      take(Math.hypot(px - xr, py - ye) - 4, 'p', i, 2, RH);
      if (inX) { take(Math.abs(yt - py), 'p', i, 0); take(Math.abs(ys - py), 'p', i, 1); }
      if (inX && inY) take(R - 2, 'p', i, -1);
    });
    return best;
  }
  /** the drawings with one handle (or the whole drawing) moved from the drag start */
  function moved(o: Drawings, g: Hit, t0: number, p0: number, t1: number, p1: number): Drawings {
    const dt = t1 - t0, dp = p1 - p0;
    const d: Drawings = { t: o.t.map((q) => [...q] as T4), h: [...o.h], r: o.r.map((q) => [...q] as T4), f: o.f.map((q) => [...q] as T4), p: o.p.map((q) => [...q] as Drawings['p'][number]) };
    if (g.kind === 'h') d.h[g.i] = o.h[g.i] + dp;
    else if (g.kind === 't' || g.kind === 'f') {
      const q = (g.kind === 't' ? d.t : d.f)[g.i], q0 = (g.kind === 't' ? o.t : o.f)[g.i];
      if (g.end === 0) { q[0] = q0[0] + dt; q[1] = q0[1] + dp; } else if (g.end === 1) { q[2] = q0[2] + dt; q[3] = q0[3] + dp; }
      else { q[0] = q0[0] + dt; q[1] = q0[1] + dp; q[2] = q0[2] + dt; q[3] = q0[3] + dp; }
    } else if (g.kind === 'r') {
      const q = d.r[g.i], q0 = o.r[g.i];
      // corner k: 0 = (t1,p1), 1 = (t2,p2), 2 = (t1,p2), 3 = (t2,p1)
      if (g.end === 0 || g.end === 2 || g.end < 0) q[0] = q0[0] + dt;
      if (g.end === 1 || g.end === 3 || g.end < 0) q[2] = q0[2] + dt;
      if (g.end === 0 || g.end === 3 || g.end < 0) q[1] = q0[1] + dp;
      if (g.end === 1 || g.end === 2 || g.end < 0) q[3] = q0[3] + dp;
    } else {
      const q = d.p[g.i], q0 = o.p[g.i], long = q0[3] > q0[1];
      if (g.end === 0) q[3] = long ? Math.max(q0[3] + dp, q0[1] * 1.0001) : Math.min(q0[3] + dp, q0[1] * 0.9999);   // target stays on its side of the entry
      else if (g.end === 1) q[2] = long ? Math.min(q0[2] + dp, q0[1] * 0.9999) : Math.max(q0[2] + dp, q0[1] * 1.0001);
      else if (g.end === 2) q[4] = Math.max(3, Math.round(q0[4] + dt / barMs()));
      else { q[0] = q0[0] + dt; q[1] = q0[1] + dp; q[2] = q0[2] + dp; q[3] = q0[3] + dp; }
    }
    return d;
  }
  // a tap while a tool is active: place the drawing, then select it so it can be adjusted right away
  function placeAt(x: number, y: number, tries = 0): void {
    const t = timeAt(x), pr = priceAt(y);
    // right after the chart changes it can answer null for a frame: try again on the next frames
    if (t == null || pr == null) { if (tries < 4) requestAnimationFrame(() => placeAt(x, y, tries + 1)); return; }
    const d = drawRef.current, m = modeRef.current, a = anchorRef.current;
    const done = (nd: Drawings, kind: Kind, i: number) => { update(nd); setMode(''); setAnchor(null); setSel({ kind, i }); };
    if (m === 'hline') return done({ ...d, h: [...d.h, pr] }, 'h', d.h.length);
    if (m === 'long' || m === 'short') {
      // starts like TradingView's tool: stop 1.5 ATR away, target 2R, 24 bars wide; drag the handles to adjust
      const dist = Math.max(atrNow() * 1.5, pr * 0.002), sd = m === 'long' ? 1 : -1;
      return done({ ...d, p: [...d.p, [snap(t), pr, pr - sd * dist, pr + sd * 2 * dist, 24]] }, 'p', d.p.length);
    }
    if (m === 'trend' || m === 'rect' || m === 'fib') {
      if (!a) { setAnchor([t, pr]); return; }
      const seg: T4 = [a[0], a[1], t, pr];
      if (m === 'trend') return done({ ...d, t: [...d.t, seg] }, 't', d.t.length);
      if (m === 'rect') return done({ ...d, r: [...d.r, seg] }, 'r', d.r.length);
      return done({ ...d, f: [...d.f, seg] }, 'f', d.f.length);
    }
    if (m === 'erase') { const h = hitTest(x, y); if (h) removeOne(h); }
  }
  function removeOne(h: { kind: Kind; i: number }) {
    const d = drawRef.current, drop = <T,>(a: T[]) => a.filter((_, i) => i !== h.i);
    update({ h: h.kind === 'h' ? drop(d.h) : d.h, t: h.kind === 't' ? drop(d.t) : d.t, r: h.kind === 'r' ? drop(d.r) : d.r, f: h.kind === 'f' ? drop(d.f) : d.f, p: h.kind === 'p' ? drop(d.p) : d.p });
    setSel(null);
  }
  // pointer handling on the chart: taps (place / select), drags of drawings. The chart's own pan is stopped while a drawing is held.
  useEffect(() => {
    const el = box.current, c = chart.current; if (!el || !c || !store) return;
    const at = (e: { clientX: number; clientY: number }) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
    let start: { x: number; y: number; t: number; id: number } | null = null;
    let drag: (Hit & { x0: number; y0: number; t0: number; p0: number; orig: Drawings; movedPx: number }) | null = null;
    let timer = 0;
    const lock = (on: boolean) => c.applyOptions({ handleScroll: !on, handleScale: !on });
    const begin = (h: Hit, x: number, y: number, id: number) => {
      const t0 = timeAt(x), p0 = priceAt(y); if (t0 == null || p0 == null) return;
      drag = { ...h, x0: x, y0: y, t0, p0, orig: JSON.parse(JSON.stringify(drawRef.current)), movedPx: 0 };
      lock(true); try { el.setPointerCapture(id); } catch { /* pointer gone */ }
      setSel({ kind: h.kind, i: h.i }); setGrab(true);
    };
    const down = (e: PointerEvent) => {
      window.clearTimeout(timer);
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const [x, y] = at(e); start = { x, y, t: Date.now(), id: e.pointerId };
      if (modeRef.current) return;
      const h = hitTest(x, y); if (!h) return;
      const cur = selRef.current;
      // the selected drawing (or any drawing with a mouse) moves at once; on touch an unselected one needs a short hold
      if ((cur && cur.kind === h.kind && cur.i === h.i) || e.pointerType === 'mouse') { begin(h, x, y, e.pointerId); e.stopPropagation(); return; }
      timer = window.setTimeout(() => { try { navigator.vibrate?.(12); } catch { /* not supported */ } begin(h, x, y, e.pointerId); }, 280);
    };
    const move = (e: PointerEvent) => {
      if (!drag) {
        if (start && Math.hypot(at(e)[0] - start.x, at(e)[1] - start.y) > 8) window.clearTimeout(timer);   // a swipe: the chart pans
        return;
      }
      e.stopPropagation(); e.preventDefault();
      const [x, y] = at(e); drag.movedPx = Math.max(drag.movedPx, Math.hypot(x - drag.x0, y - drag.y0));
      const t1 = timeAt(x), p1 = priceAt(y); if (t1 == null || p1 == null) return;
      drawRef.current = moved(drag.orig, drag, drag.t0, drag.p0, t1, p1);
      prim.current?.update();   // repaint only; React state is set once on release
    };
    const up = (e: PointerEvent) => {
      window.clearTimeout(timer);
      const s0 = start; start = null;
      if (drag) {
        e.stopPropagation(); drag = null; lock(false); setGrab(false);
        update(drawRef.current);
        return;
      }
      if (!s0 || s0.id !== e.pointerId) return;
      const [x, y] = at(e);
      if (Math.hypot(x - s0.x, y - s0.y) > 8 || Date.now() - s0.t > 700) return;              // a swipe or a hold, not a tap
      if (x > c.timeScale().width() || y > el.clientHeight - c.timeScale().height()) return;   // price / time axis
      if (modeRef.current) { placeAt(x, y); return; }
      const h = hitTest(x, y); setSel(h ? { kind: h.kind, i: h.i } : null);
    };
    // the chart listens to mouse / touch events: stop them while a drawing is held so it does not pan
    const block = (e: Event) => { if (drag) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); } };
    el.addEventListener('pointerdown', down, true); el.addEventListener('pointermove', move, true); el.addEventListener('pointerup', up, true); el.addEventListener('pointercancel', up, true);
    for (const k of ['mousedown', 'mousemove', 'touchstart', 'touchmove']) el.addEventListener(k, block, { capture: true, passive: false });
    return () => {
      window.clearTimeout(timer); if (drag) lock(false);
      el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointermove', move, true); el.removeEventListener('pointerup', up, true); el.removeEventListener('pointercancel', up, true);
      for (const k of ['mousedown', 'mousemove', 'touchstart', 'touchmove']) el.removeEventListener(k, block, { capture: true } as EventListenerOptions);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  const pick = (m: Tool) => { setAnchor(null); setSel(null); setMode((cur) => (cur === m ? '' : m)); };
  const count = draw.t.length + draw.h.length + draw.r.length + draw.f.length + draw.p.length;
  const hint = grab ? '' : mode === 'trend' || mode === 'rect' || mode === 'fib' ? (anchor ? 'Ketuk titik kedua' : 'Ketuk titik pertama')
    : mode === 'hline' ? 'Ketuk harga untuk garis' : mode === 'long' || mode === 'short' ? 'Ketuk harga entry' : mode === 'erase' ? 'Ketuk gambar yang mau dihapus' : '';

  const icon = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
  const TOOLS: Array<[Tool, string, string]> = [
    ['trend', 'Garis tren', 'M5 19L19 5M4 20h2v-2H4zM18 6h2V4h-2z'],
    ['hline', 'Garis horizontal', 'M3 12h18'],
    ['rect', 'Kotak', 'M4 6h16v12H4z'],
    ['fib', 'Fibonacci retracement', 'M4 5h16M4 9.5h16M4 13h16M4 19h16'],
    ['long', 'Posisi long', 'M4 13h16M8 21V5M5 8l3-3 3 3'],
    ['short', 'Posisi short', 'M4 11h16M8 3v16M5 16l3 3 3-3'],
    ['erase', 'Hapus satu gambar', 'M16 4l4 4-10 10H6l-2-2L16 4zM6 18h14'],
  ];

  return <>
    <div ref={box} style={{ position: 'absolute', inset: 0 }} />
    {store ? <div className="draw-tools" role="toolbar" aria-label="Alat gambar">
      <button type="button" className={open ? 'on' : ''} aria-label={open ? 'Tutup alat gambar' : 'Buka alat gambar'} aria-expanded={open} title="Alat gambar" onClick={() => { setOpen((o) => !o); setAnchor(null); setMode(''); }}>
        {icon('M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3')}
      </button>
      {open ? <>
        {TOOLS.map(([k, label, d]) => <button key={k} type="button" className={mode === k ? 'on' : ''} aria-label={label} aria-pressed={mode === k} title={label} disabled={k === 'erase' && !count} onClick={() => pick(k)}>{icon(d)}</button>)}
        <button type="button" aria-label="Hapus semua gambar" title="Hapus semua gambar" disabled={!count} onClick={() => { if (window.confirm('Hapus semua gambar di chart ini?')) { update({ ...EMPTY }); setMode(''); setSel(null); } }}>{icon('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13')}</button>
      </> : null}
    </div> : null}
    {store && sel && !mode ? <div className="draw-sel" role="toolbar" aria-label="Gambar terpilih">
      <span>{grab ? 'Geser…' : 'Geser untuk ubah'}</span>
      <button type="button" onClick={() => removeOne(sel)}>Hapus</button>
      <button type="button" onClick={() => setSel(null)}>Selesai</button>
    </div> : null}
    {tools ? <div className="cv-tools" role="toolbar" aria-label="Tampilan chart">
      {menu ? <div className="cv-menu" role="group" aria-label="Indikator">
        {([['vol', 'Volume'], ['e20', 'EMA 20'], ['e50', 'EMA 50 · putus-putus'], ['e200', 'EMA 200 · tebal'], ['rsi', 'RSI 14']] as const).map(([k, label]) =>
          <button key={k} type="button" role="switch" aria-checked={ind[k]} onClick={() => toggleInd(k)}><span className="cv-box" aria-hidden>{ind[k] ? icon('M5 12l5 5 9-10') : null}</span>{label}</button>)}
      </div> : null}
      <div className="cv-row">
        <button type="button" className={menu ? 'on' : ''} aria-label="Indikator" aria-expanded={menu} title="Indikator" onClick={() => setMenu((m) => !m)}><span className="cv-txt">ƒx</span></button>
        {position ? <button type="button" aria-label="Fokus entry trade" title="Fokus entry" onClick={() => focus.current()}>{icon('M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 12h8M12 8v8')}</button> : null}
        <button type="button" aria-label="Tampilkan seluruh candle" title="Semua candle" onClick={() => { chart.current?.timeScale().fitContent(); autoScale(); }}>{icon('M4 5v14M20 5v14M8 9l-3 3 3 3M16 9l3 3-3 3M5 12h14')}</button>
        <button type="button" className={full ? 'on' : ''} aria-label={full ? 'Keluar layar penuh' : 'Layar penuh'} aria-pressed={full} title="Layar penuh" onClick={() => setFull((v) => !v)}>{icon(full ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5')}</button>
      </div>
    </div> : null}
    {hint ? <div className="draw-hint">{hint}</div> : null}
  </>;
}
