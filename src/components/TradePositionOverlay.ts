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
        ctx.setLineDash([5, 4]); ctx.strokeStyle = '#87909c';
        const end = position.exitPrice == null ? null : api.series.priceToCoordinate(position.exitPrice);
        if (end != null) { ctx.beginPath(); ctx.moveTo(left, entry); ctx.lineTo(right, end); ctx.stroke(); }
        ctx.setLineDash([]);
        const risk = Math.abs(position.entryPrice - position.stopLoss);
        const rr = risk > 0 ? Math.abs(position.takeProfit - position.entryPrice) / risk : 0;
        const label = `${position.side === 'long' ? 'BUY' : 'SELL'} · RR 1:${rr.toFixed(1)}`;
        const x = Math.max(6, left + 7);
        if (x + 110 < Math.min(mediaSize.width, right + 20)) {
          const y = Math.max(18, Math.min(entry - 8, mediaSize.height - 8));
          ctx.font = '600 11px system-ui, sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(x - 4, y - 12, ctx.measureText(label).width + 8, 17);
          ctx.fillStyle = '#475569'; ctx.fillText(label, x, y);
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
