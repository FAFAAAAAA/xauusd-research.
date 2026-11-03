import type { ISeriesPrimitive, SeriesAttachedParameter, ISeriesPrimitivePaneView, Logical } from 'lightweight-charts';

export interface TradePosition {
  side: 'long' | 'short';
  entry: number;
  exit: number | null;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  exitPrice?: number | null;
}

/** A position drawing on the chart canvas, synchronized by the chart's render loop. */
export class TradePositionOverlay implements ISeriesPrimitive {
  private attachedTo?: SeriesAttachedParameter;
  private readonly views: ISeriesPrimitivePaneView[];

  constructor(private position: TradePosition, private entryIndex: number, private exitIndex: number) {
    this.views = [{ zOrder: () => 'bottom', renderer: () => ({ draw: (target) => {
      const api = this.attachedTo;
      if (!api) return;
      const scale = api.chart.timeScale();
      const left = scale.logicalToCoordinate(this.entryIndex as Logical);
      const right = scale.logicalToCoordinate(Math.max(this.entryIndex + 1, this.exitIndex) as Logical);
      const entry = api.series.priceToCoordinate(position.entryPrice);
      const stop = api.series.priceToCoordinate(position.stopLoss);
      const profit = api.series.priceToCoordinate(position.takeProfit);
      if (left == null || right == null || entry == null || stop == null || profit == null) return;
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
        if (right < 0 || left > mediaSize.width) return;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, mediaSize.width, mediaSize.height); ctx.clip();
        const width = right - left;
        ctx.fillStyle = 'rgba(40, 165, 121, .18)';
        ctx.fillRect(left, Math.min(entry, profit), width, Math.abs(profit - entry));
        ctx.fillStyle = 'rgba(218, 88, 105, .17)';
        ctx.fillRect(left, Math.min(entry, stop), width, Math.abs(stop - entry));
        for (const [price, color] of [[profit, '#389b78'], [entry, '#87909c'], [stop, '#cf6674']] as const) {
          ctx.strokeStyle = color; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(left, price); ctx.lineTo(right, price); ctx.stroke();
        }
        ctx.restore();
      });
    } }) }];
  }

  attached(parameters: SeriesAttachedParameter) { this.attachedTo = parameters; parameters.requestUpdate(); }
  detached() { this.attachedTo = undefined; }
  paneViews() { return this.views; }
  autoscaleInfo(start: Logical, end: Logical) {
    if (end < this.entryIndex || start > Math.max(this.entryIndex + 1, this.exitIndex)) return null;
    return { priceRange: { minValue: Math.min(this.position.entryPrice, this.position.stopLoss, this.position.takeProfit), maxValue: Math.max(this.position.entryPrice, this.position.stopLoss, this.position.takeProfit) } };
  }
}
