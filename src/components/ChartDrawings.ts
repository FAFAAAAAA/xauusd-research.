import type { ISeriesPrimitive, SeriesAttachedParameter, ISeriesPrimitivePaneView, ISeriesPrimitiveAxisView } from 'lightweight-charts';

/* Drawings kept per symbol on this device (localStorage), shared by every timeframe. Times are real UTC ms, prices numbers.
 *  t: trend line [t1, p1, t2, p2]      h: horizontal line price
 *  r: rectangle  [t1, p1, t2, p2]      f: fibonacci retracement [t1, p1 (level 1), t2, p2 (level 0)]
 *  p: long / short position tool [time, entry, stop, target, width in bars] (long when target > entry) */
export type T4 = [number, number, number, number];
export type PosTool = [number, number, number, number, number];
export type Drawings = { t: T4[]; h: number[]; r: T4[]; f: T4[]; p: PosTool[] };
export type Kind = 'h' | 't' | 'r' | 'f' | 'p';
export const EMPTY: Drawings = { t: [], h: [], r: [], f: [], p: [] };
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
export const loadDraw = (k: string): Drawings => {
  try {
    const v = JSON.parse(localStorage.getItem(`chart-draw:${k}`) || 'null');
    if (v && typeof v === 'object') return { t: arr(v.t), h: arr(v.h), r: arr(v.r), f: arr(v.f), p: arr(v.p) };
  } catch { /* storage off */ }
  return { ...EMPTY };
};
export const saveDraw = (k: string, d: Drawings) => { try { localStorage.setItem(`chart-draw:${k}`, JSON.stringify(d)); } catch { /* storage off */ } };
export const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const fibPrice = (p1: number, p2: number, level: number) => p2 + (p1 - p2) * level;

export interface DrawState { d: Drawings; xOf: (ms: number) => number | null; barMs: number; ink: string; surface: string; digits: number; sel: { kind: Kind; i: number } | null; width: number }

/** Paints every drawing (lines, boxes, fibonacci, position tools) and the handles of the selected one on the price pane.
 *  One canvas layer, redrawn by the chart: dragging only asks for a repaint, nothing is rebuilt. */
export class DrawingsPrimitive implements ISeriesPrimitive {
  private api?: SeriesAttachedParameter;
  private readonly views: ISeriesPrimitivePaneView[];
  constructor(private state: () => DrawState) {
    this.views = [{ zOrder: () => 'top', renderer: () => ({ draw: (target) => {
      const api = this.api; if (!api) return;
      const s = this.state(), Y = (p: number) => api.series.priceToCoordinate(p);
      const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: s.digits, maximumFractionDigits: s.digits });
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
        const handles: Array<[number, number]> = [];
        const isSel = (k: Kind, i: number) => s.sel?.kind === k && s.sel.i === i;
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, mediaSize.width, mediaSize.height); ctx.clip();
        ctx.font = '11px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'; ctx.textBaseline = 'bottom';
        s.d.h.forEach((pr, i) => {
          const y = Y(pr); if (y == null) return;
          ctx.strokeStyle = s.ink; ctx.lineWidth = isSel('h', i) ? 2 : 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mediaSize.width, y); ctx.stroke();
          if (isSel('h', i)) handles.push([mediaSize.width / 2, y]);
        });
        s.d.t.forEach(([a, pa, b, pb], i) => {
          const x1 = s.xOf(a), x2 = s.xOf(b), y1 = Y(pa), y2 = Y(pb); if (x1 == null || x2 == null || y1 == null || y2 == null) return;
          ctx.strokeStyle = s.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          if (isSel('t', i)) handles.push([x1, y1], [x2, y2]);
        });
        s.d.r.forEach(([a, pa, b, pb], i) => {
          const x1 = s.xOf(a), x2 = s.xOf(b), y1 = Y(pa), y2 = Y(pb); if (x1 == null || x2 == null || y1 == null || y2 == null) return;
          ctx.globalAlpha = 0.1; ctx.fillStyle = s.ink; ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          ctx.globalAlpha = 1; ctx.strokeStyle = s.ink; ctx.lineWidth = isSel('r', i) ? 2 : 1; ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          if (isSel('r', i)) handles.push([x1, y1], [x2, y2], [x1, y2], [x2, y1]);
        });
        s.d.f.forEach(([a, pa, b, pb], i) => {
          const x1 = s.xOf(a), x2 = s.xOf(b); if (x1 == null || x2 == null) return;
          const L = Math.min(x1, x2), R = Math.max(x1, x2, L + 40);
          for (const lv of FIB) {
            const pr = fibPrice(pa, pb, lv), y = Y(pr); if (y == null) continue;
            ctx.strokeStyle = s.ink; ctx.globalAlpha = lv === 0.5 || lv === 0.618 ? 0.9 : 0.55; ctx.lineWidth = lv === 0.618 ? 1.5 : 1;
            ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
            ctx.globalAlpha = 1; ctx.fillStyle = s.ink; ctx.fillText(`${lv} (${fmt(pr)})`, L + 3, y - 2);
          }
          const y1 = Y(pa), y2 = Y(pb);
          if (y1 != null && y2 != null) {
            ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
            if (isSel('f', i)) handles.push([x1, y1], [x2, y2]);
          }
        });
        s.d.p.forEach(([tm, e, sl, tp, w], i) => {
          const x1 = s.xOf(tm), x2 = s.xOf(tm + w * s.barMs), ye = Y(e), ys = Y(sl), yt = Y(tp);
          if (x1 == null || x2 == null || ye == null || ys == null || yt == null) return;
          const W = Math.max(8, x2 - x1);
          ctx.fillStyle = 'rgba(40, 165, 121, .22)'; ctx.fillRect(x1, Math.min(ye, yt), W, Math.abs(yt - ye));
          ctx.fillStyle = 'rgba(218, 88, 105, .2)'; ctx.fillRect(x1, Math.min(ye, ys), W, Math.abs(ys - ye));
          for (const [y, c] of [[yt, '#389b78'], [ye, '#87909c'], [ys, '#cf6674']] as const) { ctx.strokeStyle = c; ctx.lineWidth = isSel('p', i) ? 2 : 1; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1 + W, y); ctx.stroke(); }
          const risk = Math.abs(e - sl), rr = risk > 0 ? Math.abs(tp - e) / risk : 0, pct = (v: number) => `${((Math.abs(v - e) / e) * 100).toFixed(2)}%`;
          ctx.fillStyle = s.ink;
          ctx.textBaseline = tp > e ? 'bottom' : 'top'; ctx.fillText(`TP ${fmt(tp)} · ${pct(tp)} · ${rr.toFixed(2)}R`, x1 + 3, yt + (tp > e ? -2 : 2));
          ctx.textBaseline = tp > e ? 'top' : 'bottom'; ctx.fillText(`SL ${fmt(sl)} · ${pct(sl)}`, x1 + 3, ys + (tp > e ? 2 : -2));
          ctx.textBaseline = 'bottom'; ctx.fillText(`${tp > e ? 'Long' : 'Short'} ${fmt(e)}`, x1 + 3, ye - 2);
          if (isSel('p', i)) handles.push([x1 + W / 2, yt], [x1 + W / 2, ys], [x1, ye], [x1 + W, ye]);
        });
        // handles of the selected drawing: drag them (bigger than they look, see hitTest)
        for (const [x, y] of handles) {
          ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = s.surface; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = s.ink; ctx.stroke();
        }
        ctx.restore();
      });
    } }) }];
  }
  attached(p: SeriesAttachedParameter) { this.api = p; p.requestUpdate(); }
  detached() { this.api = undefined; }
  update() { this.api?.requestUpdate(); }
  paneViews() { return this.views; }
  /** price labels on the right axis for horizontal lines (like TradingView) */
  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const api = this.api; if (!api) return [];
    const s = this.state();
    return s.d.h.map((pr) => ({
      coordinate: () => api.series.priceToCoordinate(pr) ?? -100,
      text: () => pr.toLocaleString('en-US', { minimumFractionDigits: s.digits, maximumFractionDigits: s.digits }),
      textColor: () => s.surface, backColor: () => s.ink, visible: () => true, tickVisible: () => true,
    }));
  }
}
