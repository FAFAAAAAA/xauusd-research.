import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeChartWindow } from '../src/lib/core/trade-chart';

test('chart includes entry and exit even for trades longer than 300 candles', () => {
  const interval = 900_000, entry = Date.UTC(2026, 0, 5), exit = entry + 800 * interval;
  const range = tradeChartWindow(entry, exit, interval);
  assert.equal(range.from, entry - 48 * interval);
  assert.ok(range.to > exit);
  assert.equal(range.to, exit + 20 * interval + 1);
});

test('open and same-bar trades retain context on both sides of entry', () => {
  for (const exit of [null, 123_000]) {
    const range = tradeChartWindow(123_000, exit, 60_000);
    assert.ok(range.from < 123_000 && range.to > 123_000);
  }
});

import { TradePositionOverlay } from '../src/components/TradePositionOverlay';
import type { SeriesAttachedParameter, Logical } from 'lightweight-charts';

for (const side of ['long', 'short'] as const) {
  test(`position drawing: ${side} places reward and risk on the correct sides`, () => {
    const rectangles: number[][] = [];
    const ctx = new Proxy({
      fillRect: (...args: number[]) => rectangles.push(args),
      measureText: () => ({ width: 70 }),
    } as unknown as CanvasRenderingContext2D, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
    const drawing = new TradePositionOverlay({ side, entry: 0, exit: 20, entryPrice: 100, stopLoss: side === 'long' ? 90 : 110, takeProfit: side === 'long' ? 120 : 80 }, 10, 30);
    drawing.attached({ chart: { timeScale: () => ({ logicalToCoordinate: (index: number) => index * 5 }) }, series: { priceToCoordinate: (price: number) => 300 - price }, requestUpdate: () => {} } as unknown as SeriesAttachedParameter);
    const renderer = drawing.paneViews()[0].renderer()!;
    renderer.draw({ useMediaCoordinateSpace: (draw: (scope: unknown) => void) => draw({ context: ctx, mediaSize: { width: 400, height: 300 } }) } as Parameters<typeof renderer.draw>[0]);
    assert.deepEqual(rectangles[0], [50, side === 'long' ? 180 : 200, 100, 20]);
    assert.deepEqual(rectangles[1], [50, side === 'long' ? 200 : 190, 100, 10]);
    assert.equal(drawing.autoscaleInfo(40 as Logical, 80 as Logical), null);
  });
}
