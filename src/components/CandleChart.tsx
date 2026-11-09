'use client';
import { useEffect, useRef } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type SeriesMarker, type IPriceLine,
} from 'lightweight-charts';
import { TradePositionOverlay, type TradePosition } from '@/components/TradePositionOverlay';
import type { Candle } from '@/lib/core/types';
import { tzOffsetMinutes } from '@/lib/core/time';

export interface ChartZone { id: string; low: number; high: number; kind: string }
export interface ChartMarker { time: number; text: string; position: 'above' | 'below'; shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown' }

/**
 * Monochrome candlestick chart. lightweight-charts renders in UTC, so times are
 * shifted by the display timezone offset (DST-aware per candle) for the axis only.
 */
export default function CandleChart({ candles, zones = [], markers = [], timezone = 'UTC', fitKey, position }:
  { candles: Candle[]; zones?: ChartZone[]; markers?: ChartMarker[]; timezone?: string; fitKey?: string; position?: TradePosition }) {
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
    const up = v('--up', '#12805c'), dn = v('--down', '#c2410c');
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
    const exitIndex = position.exit == null ? entryIndex + 24 : indexAt(position.exit);
    const overlay = new TradePositionOverlay(position, entryIndex, exitIndex);
    s.attachPrimitive(overlay);
    focus.current = () => {
      const span = Math.min(100, Math.max(55, exitIndex - entryIndex + 24));
      c.priceScale('right').applyOptions({ autoScale: true });
      c.timeScale().setVisibleLogicalRange({ from: entryIndex - 16, to: entryIndex + span - 16 });
    };
    focus.current();
    lastFit.current = fitKey;
    return () => { s.detachPrimitive(overlay); };
  }, [position, candles, fitKey]);

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
  </>;
}
