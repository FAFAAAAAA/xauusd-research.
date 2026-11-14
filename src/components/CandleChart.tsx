'use client';
import { useEffect, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type SeriesMarker, type IPriceLine, type MouseEventParams, type Time,
} from 'lightweight-charts';
import { TradePositionOverlay, type TradePosition } from '@/components/TradePositionOverlay';
import type { Candle } from '@/lib/core/types';
import { tzOffsetMinutes } from '@/lib/core/time';

export interface ChartZone { id: string; low: number; high: number; kind: string }
export interface ChartMarker { time: number; text: string; position: 'above' | 'below'; shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown' }

/* Candle colours like TradingView (owner's choice, 14 Nov 2026): blue up, red down, on every chart of the website. */
export const CANDLE_UP = '#2962FF', CANDLE_DOWN = '#F23645';

/* Drawings (trend lines and horizontal lines) are kept per symbol on this device (localStorage), so they come back
 * after the app is closed and show on every timeframe. Times are stored as real UTC ms, prices as numbers. */
type Drawings = { t: Array<[number, number, number, number]>; h: number[] };
const loadDraw = (k: string): Drawings => { try { const v = JSON.parse(localStorage.getItem(`chart-draw:${k}`) || 'null'); if (v && Array.isArray(v.t) && Array.isArray(v.h)) return v; } catch { /* storage off */ } return { t: [], h: [] }; };
const saveDraw = (k: string, d: Drawings) => { try { localStorage.setItem(`chart-draw:${k}`, JSON.stringify(d)); } catch { /* storage off */ } };

/**
 * Candlestick chart. lightweight-charts renders in UTC, so times are
 * shifted by the display timezone offset (DST-aware per candle) for the axis only.
 */
export default function CandleChart({ candles, zones = [], markers = [], timezone = 'UTC', fitKey, position, drawKey }:
  { candles: Candle[]; zones?: ChartZone[]; markers?: ChartMarker[]; timezone?: string; fitKey?: string; position?: TradePosition; drawKey?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const focus = useRef<() => void>(() => {});
  const lastFit = useRef<string | undefined>(undefined);

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
      crosshair: { mode: position ? CrosshairMode.Hidden : CrosshairMode.Normal },
      rightPriceScale: { scaleMargins: { top: 0.14, bottom: 0.14 }, borderColor: v('--line', '#e4e7ec') },
      timeScale: { borderColor: v('--line', '#e4e7ec'), timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 9, minBarSpacing: 0.4 },   // allow zooming far out (years of candles)
    });
    series.current = c.addCandlestickSeries({
      upColor: up, borderUpColor: up, wickUpColor: up,
      downColor: dn, borderDownColor: dn, wickDownColor: dn,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      priceLineVisible: !position, lastValueVisible: !position,
    });
    chart.current = c;
    return () => { c.remove(); chart.current = null; series.current = null; lines.current = []; };
  }, []);

  const shift = (t: number) => ((t + tzOffsetMinutes(t, timezone) * 60_000) / 1000) as UTCTimestamp;

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    s.setData(candles.map((c) => ({ time: shift(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    const m: SeriesMarker<UTCTimestamp>[] = markers
      .map((x) => ({ time: shift(x.time), position: x.position === 'above' ? 'aboveBar' as const : 'belowBar' as const, shape: x.shape, color: box.current ? (getComputedStyle(box.current).getPropertyValue('--ink').trim() || '#1b2433') : '#1b2433', text: x.text }))
      .sort((a, b) => a.time - b.time);
    s.setMarkers(m);
    if (!position && fitKey !== lastFit.current) { chart.current?.timeScale().fitContent(); lastFit.current = fitKey; }
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

  /* ---- drawing tools: trend line (tap two points), horizontal line (one tap), eraser (tap a line), clear ---- */
  const [mode, setMode] = useState<'' | 'trend' | 'hline' | 'erase'>('');
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  const [draw, setDraw] = useState<Drawings>(() => (drawKey && typeof window !== 'undefined' ? loadDraw(drawKey) : { t: [], h: [] }));
  const drawn = useRef<{ lines: ISeriesApi<'Line'>[]; hl: IPriceLine[] }>({ lines: [], hl: [] });
  const update = (d: Drawings) => { setDraw(d); if (drawKey) saveDraw(drawKey, d); };
  const drawRef = useRef(draw); drawRef.current = draw;
  // lines are black (the theme's ink colour: black in light mode, white in dark mode so they stay visible)
  const ink = () => (box.current ? getComputedStyle(box.current).getPropertyValue('--ink').trim() : '') || '#000000';
  // bar grid of the current timeframe: trend points snap to it so the line sits on real candles
  const barMs = () => { const n = candles.length; if (n < 2) return 60_000; const g: number[] = []; for (let i = Math.max(1, n - 50); i < n; i++) g.push(candles[i].time - candles[i - 1].time); g.sort((a, b) => a - b); return g[g.length >> 1] || 60_000; };
  const snap = (ms: number) => { const b = barMs(), first = candles[0]?.time ?? ms; return first + Math.round((ms - first) / b) * b; };
  // a tap on the chart -> real time (ms) and price
  const pointOf = (p: MouseEventParams<Time>): [number, number] | null => {
    const s = series.current, c = chart.current; if (!s || !c || !p.point || !candles.length) return null;
    const price = s.coordinateToPrice(p.point.y); if (price == null) return null;
    const lg = c.timeScale().coordinateToLogical(p.point.x); if (lg == null) return null;
    const i = Math.round(lg), last = candles.length - 1;
    const ms = i <= last ? candles[Math.max(0, i)].time : candles[last].time + (i - last) * barMs();
    return [ms, Number(price)];
  };
  // draw the saved lines on this chart (clipped to the loaded candles' time range)
  useEffect(() => {
    const c = chart.current, s = series.current; if (!c || !s || !drawKey || !candles.length) return;
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
  }, [draw, candles, timezone, drawKey]);
  // taps while a tool is active
  useEffect(() => {
    const c = chart.current; if (!c || !drawKey || !mode) return;
    const onClick = (p: MouseEventParams<Time>) => {
      const pt = pointOf(p); if (!pt || !p.point) return;
      if (mode === 'hline') { update({ ...draw, h: [...draw.h, pt[1]] }); setMode(''); return; }
      if (mode === 'trend') {
        if (!anchor) { setAnchor(pt); return; }
        update({ ...draw, t: [...draw.t, [anchor[0], anchor[1], pt[0], pt[1]]] }); setAnchor(null); setMode(''); return;
      }
      // eraser: the line nearest to the tap (within 14 px) goes
      const best = hitTest(p.point.x, p.point.y); if (!best) return;
      if (best.kind === 'h') update({ ...draw, h: draw.h.filter((_, i) => i !== best.i) });
      if (best.kind === 't') update({ ...draw, t: draw.t.filter((_, i) => i !== best.i) });
    };
    // a quick second tap can reach the chart as a double tap: count it as the trend line's second point
    const onDbl = (p: MouseEventParams<Time>) => { if (mode === 'trend' && anchor) onClick(p); };
    c.subscribeClick(onClick); c.subscribeDblClick(onDbl);
    return () => { c.unsubscribeClick(onClick); c.unsubscribeDblClick(onDbl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, anchor, draw, candles, drawKey]);
  /** the drawn line under a point of the chart (within 14 px): a horizontal line, or a trend line (end 0 / 1 = near an end point, -1 = its body) */
  function hitTest(px: number, py: number): { kind: 'h' | 't'; i: number; end: number } | null {
    const c = chart.current, s = series.current, d0 = drawRef.current; if (!c || !s) return null;
    const X = (ms: number) => c.timeScale().timeToCoordinate(shift(snap(ms))), Y = (pr: number) => s.priceToCoordinate(pr);
    let best: { d: number; kind: 'h' | 't'; i: number; end: number } | null = null;
    d0.h.forEach((pr, i) => { const y = Y(pr); if (y != null && Math.abs(y - py) < (best?.d ?? 14)) best = { d: Math.abs(y - py), kind: 'h', i, end: -1 }; });
    d0.t.forEach(([a, pa, b, pb], i) => {
      const x1 = X(a), y1 = Y(pa), x2 = X(b), y2 = Y(pb); if (x1 == null || x2 == null || y1 == null || y2 == null) return;
      const e1 = Math.hypot(px - x1, py - y1), e2 = Math.hypot(px - x2, py - y2);
      if (Math.min(e1, e2) < (best?.d ?? 16)) { best = { d: Math.min(e1, e2), kind: 't', i, end: e1 <= e2 ? 0 : 1 }; return; }
      const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L));
      const d = Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy)); if (d < (best?.d ?? 14)) best = { d, kind: 't', i, end: -1 };
    });
    return best;
  }
  // drag a line: press on it (no tool active) and move; the chart does not pan while a line is held
  const drag = useRef<{ kind: 'h' | 't'; i: number; end: number; x0: number; y0: number; orig: Drawings } | null>(null);
  useEffect(() => {
    const el = box.current; if (!el || !drawKey) return;
    const at = (e: { clientX: number; clientY: number }) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
    const timeAt = (x: number) => { const c = chart.current; const lg = c?.timeScale().coordinateToLogical(x); if (lg == null || !candles.length) return null; const i = Math.round(lg), last = candles.length - 1; return i <= last ? candles[Math.max(0, i)].time : candles[last].time + (i - last) * barMs(); };
    const priceAt = (y: number) => { const v = series.current?.coordinateToPrice(y); return v == null ? null : Number(v); };
    const down = (e: PointerEvent) => {
      if (mode) return;
      const [x, y] = at(e); const h = hitTest(x, y); if (!h) return;
      drag.current = { ...h, x0: x, y0: y, orig: JSON.parse(JSON.stringify(drawRef.current)) };
      chart.current?.applyOptions({ handleScroll: false, handleScale: false });
      try { el.setPointerCapture(e.pointerId); } catch { /* old browser */ }
      e.stopPropagation(); e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const g = drag.current; if (!g) return;
      e.stopPropagation(); e.preventDefault();
      const [x, y] = at(e); const p1 = priceAt(y), p0 = priceAt(g.y0), t1 = timeAt(x), t0 = timeAt(g.x0); if (p1 == null || p0 == null || t1 == null || t0 == null) return;
      const d: Drawings = { t: g.orig.t.map((q) => [...q] as [number, number, number, number]), h: [...g.orig.h] };
      if (g.kind === 'h') d.h[g.i] = p1;
      else if (g.end === 0) { d.t[g.i][0] = t1; d.t[g.i][1] = p1; }
      else if (g.end === 1) { d.t[g.i][2] = t1; d.t[g.i][3] = p1; }
      else { const dt = t1 - t0, dp = p1 - p0, o = g.orig.t[g.i]; d.t[g.i] = [o[0] + dt, o[1] + dp, o[2] + dt, o[3] + dp]; }
      setDraw(d);
    };
    const up = (e: PointerEvent) => {
      if (!drag.current) return;
      drag.current = null; e.stopPropagation();
      chart.current?.applyOptions({ handleScroll: true, handleScale: true });
      if (drawKey) saveDraw(drawKey, drawRef.current);
    };
    // the chart listens to mouse / touch events: stop them while a line is held so it does not pan
    const block = (e: Event) => { if (drag.current) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); } };
    el.addEventListener('pointerdown', down, true); el.addEventListener('pointermove', move, true); el.addEventListener('pointerup', up, true); el.addEventListener('pointercancel', up, true);
    for (const k of ['mousedown', 'mousemove', 'touchstart', 'touchmove']) el.addEventListener(k, block, { capture: true, passive: false });
    return () => {
      el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointermove', move, true); el.removeEventListener('pointerup', up, true); el.removeEventListener('pointercancel', up, true);
      for (const k of ['mousedown', 'mousemove', 'touchstart', 'touchmove']) el.removeEventListener(k, block, { capture: true } as EventListenerOptions);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, candles, drawKey, timezone]);
  const pick = (m: typeof mode) => { setAnchor(null); setMode((cur) => (cur === m ? '' : m)); };
  const hint = mode === 'trend' ? (anchor ? 'Ketuk titik kedua' : 'Ketuk titik pertama') : mode === 'hline' ? 'Ketuk harga untuk garis' : mode === 'erase' ? 'Ketuk garis yang mau dihapus' : '';

  const zoom = (factor: number) => {
    const scale = chart.current?.timeScale(), range = scale?.getVisibleLogicalRange();
    if (!scale || !range) return;
    const mid = (range.from + range.to) / 2;
    const width = Math.max(15, Math.min(candles.length + 30, (range.to - range.from) * factor));
    scale.setVisibleLogicalRange({ from: mid - width / 2, to: mid + width / 2 });
  };

  return <>
    <div ref={box} style={{ position: 'absolute', inset: 0 }} />
    {position ? <div className="trade-chart-tools" role="toolbar" aria-label="Alat chart">
      <button type="button" aria-label="Perbesar chart" title="Perbesar" onClick={() => zoom(.75)}>+</button>
      <button type="button" aria-label="Perkecil chart" title="Perkecil" onClick={() => zoom(1.33)}>−</button>
      <button type="button" aria-label="Fokus entry trade" title="Fokus entry" onClick={() => focus.current()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 12h8M12 8v8" /></svg></button>
      <button type="button" aria-label="Tampilkan seluruh candle" title="Semua candle" onClick={() => chart.current?.timeScale().fitContent()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M4 5v14M20 5v14M8 9l-3 3 3 3M16 9l3 3-3 3M5 12h14" /></svg></button>
    </div> : null}
    {drawKey ? <div className="draw-tools" role="toolbar" aria-label="Alat gambar">
      <button type="button" className={mode === 'trend' ? 'on' : ''} aria-label="Garis tren" title="Garis tren" onClick={() => pick('trend')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M5 19L19 5" /><circle cx="5" cy="19" r="2" fill="currentColor" /><circle cx="19" cy="5" r="2" fill="currentColor" /></svg></button>
      <button type="button" className={mode === 'hline' ? 'on' : ''} aria-label="Garis horizontal" title="Garis horizontal" onClick={() => pick('hline')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M3 12h18" /><circle cx="12" cy="12" r="2" fill="currentColor" /></svg></button>
      <button type="button" className={mode === 'erase' ? 'on' : ''} aria-label="Hapus satu garis" title="Hapus satu garis" disabled={!draw.t.length && !draw.h.length} onClick={() => pick('erase')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M16 4l4 4-10 10H6l-2-2L16 4zM6 18h14" /></svg></button>
      <button type="button" aria-label="Hapus semua garis" title="Hapus semua garis" disabled={!draw.t.length && !draw.h.length} onClick={() => { if (window.confirm('Hapus semua garis di chart ini?')) { update({ t: [], h: [] }); setMode(''); } }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg></button>
    </div> : null}
    {hint ? <div className="draw-hint">{hint}</div> : null}
  </>;
}
