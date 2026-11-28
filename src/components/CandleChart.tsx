'use client';
import { useEffect, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle, PriceScaleMode,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type SeriesMarker, type IPriceLine, type MouseEventParams, type Time, type Logical,
} from 'lightweight-charts';
import { TradePositionOverlay, type TradePosition } from '@/components/TradePositionOverlay';
import { DrawingsPrimitive, EMPTY, FIB, fibPrice, loadDraw, saveDraw, type Drawings, type T4 } from '@/components/ChartDrawings';
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
type Hit = { kind: 'h' | 't' | 'r' | 'f' | 'p'; i: number; end: number };

/**
 * Candlestick chart. lightweight-charts renders in UTC, so times are
 * shifted by the display timezone offset (DST-aware per candle) for the axis only.
 * With drawKey or position: TradingView-like tools (legend, drawings, indicators, scale, full screen).
 */
const NO_ZONES: ChartZone[] = [], NO_MARKERS: ChartMarker[] = [];   // stable defaults: a new [] each render would re-run the data effects

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
  const [indVals, setIndVals] = useState<{ e20?: number[]; e50?: number[]; e200?: number[]; rsi?: Array<number | null> }>({});
  const toggleInd = (k: keyof Ind) => setInd((cur) => { const n = { ...cur, [k]: !cur[k] }; try { localStorage.setItem('chart-ind', JSON.stringify(n)); } catch { /* storage off */ } return n; });
  useEffect(() => {
    const c = chart.current, s = series.current; if (!c || !s) return;
    for (const x of indSeries.current) { try { c.removeSeries(x); } catch { /* gone */ } }
    indSeries.current = [];
    const vals: typeof indVals = {};
    const hasVol = tools && ind.vol && candles.some((k) => (k.volume ?? 0) > 0), rsiOn = tools && ind.rsi;
    s.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: rsiOn ? 0.4 : hasVol ? 0.26 : 0.14 } });   // the bottom 10% stays clear for the view toolbar
    if (!tools || !candles.length) { setIndVals(vals); return; }
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
      const e = emaOf(cl, n); vals[key] = e;
      const l = c.addLineSeries({ color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
      l.setData(e.map((value, i) => ({ time: T[i], value })).slice(Math.min(n, e.length - 1)));
      indSeries.current.push(l);
    }
    if (rsiOn) {
      const r = rsiOf(cl); vals.rsi = r;
      const l = c.addLineSeries({ priceScaleId: 'rsi', color: ink, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
      l.priceScale().applyOptions({ scaleMargins: { top: 0.66, bottom: 0.12 } });
      l.setData(r.flatMap((value, i) => (value == null ? [] : [{ time: T[i], value }])));
      for (const p of [70, 30]) l.createPriceLine({ price: p, color: mute, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
      indSeries.current.push(l);
    }
    setIndVals(vals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ind, candles, timezone, tools]);

  /* ---- legend: O H L C of the candle under the crosshair (newest candle otherwise) ---- */
  const [hov, setHov] = useState<number | null>(null);
  useEffect(() => {
    const c = chart.current; if (!c || !tools) return;
    const on = (p: MouseEventParams<Time>) => setHov(p.logical == null || p.point == null ? null : Math.round(p.logical as number));
    c.subscribeCrosshairMove(on);
    return () => c.unsubscribeCrosshairMove(on);
  }, [tools]);

  /* ---- price scale: auto / logarithmic ---- */
  const [logScale, setLogScale] = useState(false);
  const autoScale = () => { chart.current?.priceScale('right').applyOptions({ autoScale: true }); };
  useEffect(() => { chart.current?.priceScale('right').applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal }); }, [logScale]);

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

  /* ---- drawing tools ---- */
  const [mode, setMode] = useState<Tool>('');
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  const [open, setOpen] = useState(false);
  const store = drawKey;
  const [draw, setDraw] = useState<Drawings>(() => (store && typeof window !== 'undefined' ? loadDraw(store) : { ...EMPTY }));
  useEffect(() => { if (store) setDraw(loadDraw(store)); }, [store]);
  const drawn = useRef<{ lines: ISeriesApi<'Line'>[]; hl: IPriceLine[] }>({ lines: [], hl: [] });
  const drawRef = useRef(draw); drawRef.current = draw;
  const update = (d: Drawings) => { drawRef.current = d; setDraw(d); if (store) saveDraw(store, d); };
  // drawings use the theme's ink colour: black in light mode, white in dark mode so they stay visible
  const ink = () => (box.current ? getComputedStyle(box.current).getPropertyValue('--ink').trim() : '') || '#000000';
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
  // a tap on the chart -> real time (ms) and price
  const pointOf = (p: MouseEventParams<Time>): [number, number] | null => {
    const s = series.current, c = chart.current, cs = candlesRef.current; if (!s || !c || !p.point || !cs.length) return null;
    const price = s.coordinateToPrice(p.point.y); if (price == null) return null;
    const lg = c.timeScale().coordinateToLogical(p.point.x); if (lg == null) return null;
    const i = Math.round(lg), last = cs.length - 1;
    const ms = i <= last ? cs[Math.max(0, i)].time : cs[last].time + (i - last) * barMs();
    return [ms, Number(price)];
  };
  // rectangles, fibonacci and position tools are painted by one primitive; it reads the newest state on every frame
  const prim = useRef<DrawingsPrimitive | null>(null);
  useEffect(() => {
    const s = series.current; if (!s || !store) return;
    const p = new DrawingsPrimitive(() => ({ d: drawRef.current, xOf, barMs: barMs(), ink: ink(), digits: digitsOf(candlesRef.current[candlesRef.current.length - 1]?.close ?? 1) }));
    s.attachPrimitive(p); prim.current = p;
    return () => { try { s.detachPrimitive(p); } catch { /* chart gone */ } prim.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  // trend and horizontal lines (clipped to the loaded candles' time range)
  useEffect(() => {
    prim.current?.update();
    const c = chart.current, s = series.current; if (!c || !s || !store || !candles.length) return;
    for (const l of drawn.current.lines) c.removeSeries(l);
    for (const l of drawn.current.hl) s.removePriceLine(l);
    drawn.current = { lines: [], hl: [] };
    const t0 = candles[0].time;
    for (const [a, pa, b, pb] of draw.t) {
      let [x1, y1, x2, y2] = a <= b ? [a, pa, b, pb] : [b, pb, a, pa];
      if (x2 < t0) continue;
      if (x1 < t0) { y1 = y1 + ((y2 - y1) * (t0 - x1)) / (x2 - x1); x1 = t0; }
      const s1 = snap(x1), s2 = snap(x2); if (s1 === s2) continue;
      const l = c.addLineSeries({ color: ink(), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, pointMarkersVisible: false, autoscaleInfoProvider: () => null });
      l.setData([{ time: shift(s1), value: y1 }, { time: shift(s2), value: y2 }]);
      drawn.current.lines.push(l);
    }
    for (const p of draw.h) drawn.current.hl.push(s.createPriceLine({ price: p, color: ink(), lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' }));
    return () => {
      const cc = chart.current, ss = series.current;
      if (cc) for (const l of drawn.current.lines) { try { cc.removeSeries(l); } catch { /* chart gone */ } }
      if (ss) for (const l of drawn.current.hl) { try { ss.removePriceLine(l); } catch { /* chart gone */ } }
      drawn.current = { lines: [], hl: [] };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, candles, timezone, store]);
  // taps while a tool is active. Read from pointer events directly: the chart's own click event swallows a quick second tap (double-tap detection)
  useEffect(() => {
    const c = chart.current, el = box.current; if (!c || !el || !store || !mode) return;
    const onTap = (x: number, y: number, tries = 0): void => {
      const p = { point: { x, y } } as unknown as MouseEventParams<Time>;
      const pt = pointOf(p);
      // right after a drawing changes the chart can answer null for one frame: try again on the next frames
      if (!pt) { if (tries < 4) requestAnimationFrame(() => onTap(x, y, tries + 1)); return; }
      if (!p.point) return;
      const d = drawRef.current;
      if (mode === 'hline') { update({ ...d, h: [...d.h, pt[1]] }); setMode(''); return; }
      if (mode === 'long' || mode === 'short') {
        // starts like TradingView's tool: stop 1.5 ATR away, target 2R, 24 bars wide; drag the lines to adjust
        const dist = Math.max(atrNow() * 1.5, pt[1] * 0.002), sd = mode === 'long' ? 1 : -1;
        update({ ...d, p: [...d.p, [snap(pt[0]), pt[1], pt[1] - sd * dist, pt[1] + sd * 2 * dist, 24]] }); setMode(''); return;
      }
      if (mode === 'trend' || mode === 'rect' || mode === 'fib') {
        if (!anchor) { setAnchor(pt); return; }
        const seg: T4 = [anchor[0], anchor[1], pt[0], pt[1]];
        update(mode === 'trend' ? { ...d, t: [...d.t, seg] } : mode === 'rect' ? { ...d, r: [...d.r, seg] } : { ...d, f: [...d.f, seg] });
        setAnchor(null); setMode(''); return;
      }
      // eraser: the drawing nearest to the tap goes
      const best = hitTest(p.point.x, p.point.y); if (!best) return;
      const drop = <T,>(a: T[]) => a.filter((_, i) => i !== best.i);
      update({ h: best.kind === 'h' ? drop(d.h) : d.h, t: best.kind === 't' ? drop(d.t) : d.t, r: best.kind === 'r' ? drop(d.r) : d.r, f: best.kind === 'f' ? drop(d.f) : d.f, p: best.kind === 'p' ? drop(d.p) : d.p });
    };
    let start: { x: number; y: number; t: number; id: number } | null = null;
    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => { if (e.pointerType === 'mouse' && e.button !== 0) return; const q = local(e); start = { ...q, t: Date.now(), id: e.pointerId }; };
    const up = (e: PointerEvent) => {
      const s0 = start; start = null; if (!s0 || s0.id !== e.pointerId) return;
      const q = local(e);
      if (Math.hypot(q.x - s0.x, q.y - s0.y) > 8 || Date.now() - s0.t > 700) return;          // a swipe or a hold, not a tap
      if (q.x > c.timeScale().width() || q.y > el.clientHeight - c.timeScale().height()) return;   // price / time axis
      onTap(q.x, q.y);
    };
    el.addEventListener('pointerdown', down, true); el.addEventListener('pointerup', up, true);
    return () => { el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointerup', up, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, anchor, candles, store]);
  /** the drawing under a point of the chart. end = which handle (-1 = the whole drawing) */
  function hitTest(px: number, py: number): Hit | null {
    const c = chart.current, s = series.current, d0 = drawRef.current; if (!c || !s) return null;
    const X = (ms: number) => xOf(ms), Y = (pr: number) => s.priceToCoordinate(pr);
    let best: (Hit & { d: number }) | null = null;
    const take = (d: number, kind: Hit['kind'], i: number, end: number, lim = 14) => { if (d < Math.min(best?.d ?? lim, lim)) best = { d, kind, i, end }; };
    const segDist = (x1: number, y1: number, x2: number, y2: number) => { const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)); return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy)); };
    d0.h.forEach((pr, i) => { const y = Y(pr); if (y != null) take(Math.abs(y - py), 'h', i, -1); });
    d0.t.forEach(([a, pa, b, pb], i) => {
      const x1 = X(a), y1 = Y(pa), x2 = X(b), y2 = Y(pb); if (x1 == null || x2 == null || y1 == null || y2 == null) return;
      const e1 = Math.hypot(px - x1, py - y1), e2 = Math.hypot(px - x2, py - y2);
      if (Math.min(e1, e2) < 16) { take(Math.min(e1, e2) - 2, 't', i, e1 <= e2 ? 0 : 1, 16); return; }
      take(segDist(x1, y1, x2, y2), 't', i, -1);
    });
    d0.r.forEach(([a, pa, b, pb], i) => {
      const x1 = X(a), y1 = Y(pa), x2 = X(b), y2 = Y(pb); if (x1 == null || x2 == null || y1 == null || y2 == null) return;
      const cs: Array<[number, number]> = [[x1, y1], [x2, y2], [x1, y2], [x2, y1]];
      const k = cs.map(([x, y]) => Math.hypot(px - x, py - y)), m = Math.min(...k);
      if (m < 16) { take(m - 2, 'r', i, k.indexOf(m), 16); return; }
      if (px >= Math.min(x1, x2) && px <= Math.max(x1, x2) && py >= Math.min(y1, y2) && py <= Math.max(y1, y2)) take(12, 'r', i, -1, 13);
    });
    d0.f.forEach(([a, pa, b, pb], i) => {
      const x1 = X(a), x2 = X(b), y1 = Y(pa), y2 = Y(pb); if (x1 == null || x2 == null || y1 == null || y2 == null) return;
      const e1 = Math.hypot(px - x1, py - y1), e2 = Math.hypot(px - x2, py - y2);
      if (Math.min(e1, e2) < 16) { take(Math.min(e1, e2) - 2, 'f', i, e1 <= e2 ? 0 : 1, 16); return; }
      const L = Math.min(x1, x2), R = Math.max(x1, x2, L + 40);
      if (px >= L && px <= R) for (const lv of FIB) { const y = Y(fibPrice(pa, pb, lv)); if (y != null) take(Math.abs(y - py), 'f', i, -1); }
    });
    d0.p.forEach(([tm, e, sl, tp, w], i) => {
      const x1 = X(tm), x2 = X(tm + w * barMs()), ys = Y(sl), yt = Y(tp); if (x1 == null || x2 == null || ys == null || yt == null || Y(e) == null) return;
      const R = Math.max(x1 + 8, x2); if (px < x1 - 6 || px > R + 10) return;
      const inY = py >= Math.min(ys, yt) - 6 && py <= Math.max(ys, yt) + 6;
      if (Math.abs(px - R) < 10 && inY) { take(Math.abs(px - R), 'p', i, 2, 10); return; }
      take(Math.abs(yt - py), 'p', i, 0, 10); take(Math.abs(ys - py), 'p', i, 1, 10);
      if (inY) take(12, 'p', i, -1, 13);
    });
    return best;
  }
  // drag a drawing: long press on it (0.45 s without moving; mouse 0.15 s), then move; a normal swipe scrolls the chart as usual
  const drag = useRef<(Hit & { x0: number; y0: number; orig: Drawings }) | null>(null);
  const pend = useRef<{ timer: number; x0: number; y0: number } | null>(null);
  const [grab, setGrab] = useState(false);
  useEffect(() => {
    const el = box.current; if (!el || !store) return;
    const at = (e: { clientX: number; clientY: number }) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
    const timeAt = (x: number) => { const c = chart.current, cs = candlesRef.current; const lg = c?.timeScale().coordinateToLogical(x); if (lg == null || !cs.length) return null; const i = Math.round(lg), last = cs.length - 1; return i <= last ? cs[Math.max(0, i)].time : cs[last].time + (i - last) * barMs(); };
    const priceAt = (y: number) => { const v = series.current?.coordinateToPrice(y); return v == null ? null : Number(v); };
    const cancelPend = () => { if (pend.current) { window.clearTimeout(pend.current.timer); pend.current = null; } };
    const down = (e: PointerEvent) => {
      cancelPend();
      if (mode || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const [x, y] = at(e); const h = hitTest(x, y); if (!h) return;
      const id = e.pointerId;
      pend.current = { x0: x, y0: y, timer: window.setTimeout(() => {
        pend.current = null;
        drag.current = { ...h, x0: x, y0: y, orig: JSON.parse(JSON.stringify(drawRef.current)) };
        chart.current?.applyOptions({ handleScroll: false, handleScale: false });
        try { el.setPointerCapture(id); } catch { /* old browser / pointer gone */ }
        try { navigator.vibrate?.(15); } catch { /* not supported */ }
        setGrab(true);
      }, e.pointerType === 'mouse' ? 150 : 450) };
    };
    const move = (e: PointerEvent) => {
      if (pend.current) { const [x, y] = at(e); if (Math.hypot(x - pend.current.x0, y - pend.current.y0) > 8) cancelPend(); }     // moved: it is a swipe
      const g = drag.current; if (!g) return;
      e.stopPropagation(); e.preventDefault();
      const [x, y] = at(e); const p1 = priceAt(y), p0 = priceAt(g.y0), t1 = timeAt(x), t0 = timeAt(g.x0); if (p1 == null || p0 == null || t1 == null || t0 == null) return;
      const o = g.orig, dt = t1 - t0, dp = p1 - p0;
      const d: Drawings = { t: o.t.map((q) => [...q] as T4), h: [...o.h], r: o.r.map((q) => [...q] as T4), f: o.f.map((q) => [...q] as T4), p: o.p.map((q) => [...q] as Drawings['p'][number]) };
      if (g.kind === 'h') d.h[g.i] = p1;
      else if (g.kind === 't' || g.kind === 'f') {
        const q = (g.kind === 't' ? d.t : d.f)[g.i], q0 = (g.kind === 't' ? o.t : o.f)[g.i];
        if (g.end === 0) { q[0] = t1; q[1] = p1; } else if (g.end === 1) { q[2] = t1; q[3] = p1; } else { q[0] = q0[0] + dt; q[1] = q0[1] + dp; q[2] = q0[2] + dt; q[3] = q0[3] + dp; }
      } else if (g.kind === 'r') {
        const q = d.r[g.i], q0 = o.r[g.i];
        if (g.end === 0) { q[0] = t1; q[1] = p1; } else if (g.end === 1) { q[2] = t1; q[3] = p1; } else if (g.end === 2) { q[0] = t1; q[3] = p1; } else if (g.end === 3) { q[2] = t1; q[1] = p1; }
        else { q[0] = q0[0] + dt; q[1] = q0[1] + dp; q[2] = q0[2] + dt; q[3] = q0[3] + dp; }
      } else {
        const q = d.p[g.i], q0 = o.p[g.i], long = q0[3] > q0[1];
        if (g.end === 0) q[3] = long ? Math.max(p1, q0[1] * 1.0001) : Math.min(p1, q0[1] * 0.9999);   // target stays on its side of the entry
        else if (g.end === 1) q[2] = long ? Math.min(p1, q0[1] * 0.9999) : Math.max(p1, q0[1] * 1.0001);
        else if (g.end === 2) q[4] = Math.max(3, Math.round((t1 - q0[0]) / barMs()));
        else { q[0] = q0[0] + dt; q[1] = q0[1] + dp; q[2] = q0[2] + dp; q[3] = q0[3] + dp; }
      }
      drawRef.current = d; setDraw(d); prim.current?.update();
    };
    const up = (e: PointerEvent) => {
      cancelPend();
      if (!drag.current) return;
      drag.current = null; e.stopPropagation(); setGrab(false);
      chart.current?.applyOptions({ handleScroll: true, handleScale: true });
      if (store) saveDraw(store, drawRef.current);
    };
    // the chart listens to mouse / touch events: stop them while a drawing is held so it does not pan
    const block = (e: Event) => { if (drag.current) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); } };
    el.addEventListener('pointerdown', down, true); el.addEventListener('pointermove', move, true); el.addEventListener('pointerup', up, true); el.addEventListener('pointercancel', up, true);
    for (const k of ['mousedown', 'mousemove', 'touchstart', 'touchmove']) el.addEventListener(k, block, { capture: true, passive: false });
    return () => {
      cancelPend();
      el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointermove', move, true); el.removeEventListener('pointerup', up, true); el.removeEventListener('pointercancel', up, true);
      for (const k of ['mousedown', 'mousemove', 'touchstart', 'touchmove']) el.removeEventListener(k, block, { capture: true } as EventListenerOptions);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, candles, store, timezone]);
  const pick = (m: Tool) => { setAnchor(null); setMode((cur) => (cur === m ? '' : m)); };
  const count = draw.t.length + draw.h.length + draw.r.length + draw.f.length + draw.p.length;
  const hint = grab ? 'Geser, lepas untuk simpan' : mode === 'trend' || mode === 'rect' || mode === 'fib' ? (anchor ? 'Ketuk titik kedua' : 'Ketuk titik pertama')
    : mode === 'hline' ? 'Ketuk harga untuk garis' : mode === 'long' || mode === 'short' ? 'Ketuk harga entry' : mode === 'erase' ? 'Ketuk gambar yang mau dihapus' : '';

  // legend values
  const n = candles.length, li = hov != null && hov >= 0 && hov < n ? hov : n - 1, bar = candles[li], prev = candles[li - 1];
  const fx = (v: number | undefined | null) => (v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  const chg = bar && prev ? ((bar.close - prev.close) / prev.close) * 100 : null;
  const rsiNow = indVals.rsi?.[li];

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
    {tools && bar ? <div className={`cv-legend${store ? ' with-tools' : ''}`}>
      <span><b>O</b> {fx(bar.open)} <b>H</b> {fx(bar.high)} <b>L</b> {fx(bar.low)} <b>C</b> {fx(bar.close)}{chg != null ? <em className={chg >= 0 ? 'pos' : 'neg'}> {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</em> : null}</span>
      {indVals.e20 || indVals.e50 || indVals.e200 || indVals.rsi ? <span>
        {indVals.e20 ? <>EMA20 {fx(indVals.e20[li])} </> : null}{indVals.e50 ? <>EMA50 {fx(indVals.e50[li])} </> : null}{indVals.e200 ? <>EMA200 {fx(indVals.e200[li])} </> : null}
        {indVals.rsi ? <>RSI {rsiNow != null ? rsiNow.toFixed(1) : '–'}</> : null}
      </span> : null}
    </div> : null}
    {store ? <div className="draw-tools" role="toolbar" aria-label="Alat gambar">
      <button type="button" className={open ? 'on' : ''} aria-label={open ? 'Tutup alat gambar' : 'Buka alat gambar'} aria-expanded={open} title="Alat gambar" onClick={() => { setOpen((o) => !o); setAnchor(null); setMode(''); }}>
        {icon('M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3')}
      </button>
      {open ? <>
        {TOOLS.map(([k, label, d]) => <button key={k} type="button" className={mode === k ? 'on' : ''} aria-label={label} aria-pressed={mode === k} title={label} disabled={k === 'erase' && !count} onClick={() => pick(k)}>{icon(d)}</button>)}
        <button type="button" aria-label="Hapus semua gambar" title="Hapus semua gambar" disabled={!count} onClick={() => { if (window.confirm('Hapus semua gambar di chart ini?')) { update({ ...EMPTY }); setMode(''); } }}>{icon('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13')}</button>
      </> : null}
    </div> : null}
    {tools ? <div className="cv-tools" role="toolbar" aria-label="Tampilan chart">
      {menu ? <div className="cv-menu" role="group" aria-label="Indikator">
        {([['vol', 'Volume'], ['e20', 'EMA 20'], ['e50', 'EMA 50 · putus-putus'], ['e200', 'EMA 200 · tebal'], ['rsi', 'RSI 14']] as const).map(([k, label]) =>
          <button key={k} type="button" role="switch" aria-checked={ind[k]} onClick={() => toggleInd(k)}><span className="cv-box" aria-hidden>{ind[k] ? icon('M5 12l5 5 9-10') : null}</span>{label}</button>)}
      </div> : null}
      <div className="cv-row">
        <button type="button" className={menu ? 'on' : ''} aria-label="Indikator" aria-expanded={menu} title="Indikator" onClick={() => setMenu((m) => !m)}><span className="cv-txt">ƒx</span></button>
        <button type="button" aria-label="Skala harga otomatis" title="Skala otomatis" onClick={autoScale}><span className="cv-txt">A</span></button>
        <button type="button" className={logScale ? 'on' : ''} aria-label="Skala logaritmik" aria-pressed={logScale} title="Skala log" onClick={() => setLogScale((v) => !v)}><span className="cv-txt">L</span></button>
        {position ? <button type="button" aria-label="Fokus entry trade" title="Fokus entry" onClick={() => focus.current()}>{icon('M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 12h8M12 8v8')}</button> : null}
        <button type="button" aria-label="Tampilkan seluruh candle" title="Semua candle" onClick={() => { chart.current?.timeScale().fitContent(); autoScale(); }}>{icon('M4 5v14M20 5v14M8 9l-3 3 3 3M16 9l3 3-3 3M5 12h14')}</button>
        <button type="button" className={full ? 'on' : ''} aria-label={full ? 'Keluar layar penuh' : 'Layar penuh'} aria-pressed={full} title="Layar penuh" onClick={() => setFull((v) => !v)}>{icon(full ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5')}</button>
      </div>
    </div> : null}
    {hint ? <div className="draw-hint">{hint}</div> : null}
  </>;
}
