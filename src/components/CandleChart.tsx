'use client';
import { useEffect, useRef } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type SeriesMarker, type IPriceLine,
} from 'lightweight-charts';
import type { Candle } from '@/lib/core/types';
import { tzOffsetMinutes } from '@/lib/core/time';

export interface ChartZone { id: string; low: number; high: number; kind: string }
export interface ChartMarker { time: number; text: string; position: 'above' | 'below'; shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown' }

/**
 * Monochrome candlestick chart. lightweight-charts renders in UTC, so times are
 * shifted by the display timezone offset (DST-aware per candle) for the axis only.
 */
export default function CandleChart({ candles, zones = [], markers = [], timezone = 'UTC', fitKey }:
  { candles: Candle[]; zones?: ChartZone[]; markers?: ChartMarker[]; timezone?: string; fitKey?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const lastFit = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!box.current) return;
    // colours follow the theme tokens (light / dark)
    const css = getComputedStyle(box.current);
    const v = (k: string, d: string) => css.getPropertyValue(k).trim() || d;
    const up = v('--up', '#12805c'), dn = v('--down', '#c2410c');
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: v('--surface', '#ffffff') }, textColor: v('--mute', '#8a94a6'), fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" },
      grid: { vertLines: { color: v('--sunk', '#f2f4f7') }, horzLines: { color: v('--sunk', '#f2f4f7') } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: v('--line', '#e4e7ec') },
      timeScale: { borderColor: v('--line', '#e4e7ec'), timeVisible: true, secondsVisible: false, rightOffset: 6 },
    });
    series.current = c.addCandlestickSeries({
      upColor: up, borderUpColor: up, wickUpColor: up,
      downColor: dn, borderDownColor: dn, wickDownColor: dn,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
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
    if (fitKey !== lastFit.current) { chart.current?.timeScale().fitContent(); lastFit.current = fitKey; }
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

  return <div ref={box} style={{ position: 'absolute', inset: 0 }} />;
}
