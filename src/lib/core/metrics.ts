import type { SessionLabel } from './time';

export interface TradeRecord {
  id: string;
  entryTime: number;
  exitTime: number | null;
  pnl: number | null;        // account currency, after costs
  pnlR: number | null;       // result in R multiples
  plannedRr: number | null;
  timeframe: string | null;
  session: SessionLabel | null;
  newsConfirmed: boolean | null;
  zoneOutcome: 'respect' | 'breakout' | 'unknown' | null;
}

export interface Metrics {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  totalPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  expectancy: number | null;
  expectancyR: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number | null;
  avgPlannedRr: number | null;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  /** Hours from entry to exit (exit = the candle in which TP/SL was hit). */
  avgHoldHours: number | null;
  medianHoldHours: number | null;
  avgHoldWinHours: number | null;
  avgHoldLossHours: number | null;
  /** Most positions open at the same time (entry ≤ t < exit). */
  maxOpenPositions: number;
}

/** Returns null when there are no closed trades — the UI then shows an empty state, never zeros. */
export function computeMetrics(trades: readonly TradeRecord[], startingEquity?: number): Metrics | null {
  const closed = trades.filter((t) => t.pnl != null && t.exitTime != null).sort((a, b) => a.exitTime! - b.exitTime!);
  if (!closed.length) return null;
  let wins = 0, losses = 0, be = 0, gp = 0, gl = 0, total = 0;
  let peak = 0, equity = 0, maxDd = 0, maxDdPct: number | null = startingEquity ? 0 : null;
  let cw = 0, cl = 0, mcw = 0, mcl = 0;
  const rs: number[] = [];
  const rrs: number[] = [];
  const hold: number[] = [], holdW: number[] = [], holdL: number[] = [];
  for (const t of closed) {
    const p = t.pnl!;
    total += p;
    if (p > 0) { wins++; gp += p; cw++; cl = 0; }
    else if (p < 0) { losses++; gl += -p; cl++; cw = 0; }
    else { be++; cw = 0; cl = 0; }
    mcw = Math.max(mcw, cw); mcl = Math.max(mcl, cl);
    equity += p;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
    if (startingEquity) {
      const pct = dd / (startingEquity + peak);
      if (pct > (maxDdPct ?? 0)) maxDdPct = pct;
    }
    const h = (t.exitTime! - t.entryTime) / 3_600_000;
    if (Number.isFinite(h) && h >= 0) { hold.push(h); if (p > 0) holdW.push(h); else if (p < 0) holdL.push(h); }
    if (t.pnlR != null) rs.push(t.pnlR);
    if (t.plannedRr != null) rrs.push(t.plannedRr);
  }
  const n = closed.length;
  // most positions open at once: sweep entries/exits (an exit at the same moment as an entry frees the slot first)
  const ev: Array<[number, number]> = [];
  for (const t of closed) { ev.push([t.entryTime, 1]); ev.push([t.exitTime!, -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0, maxOpen = 0;
  for (const [, d] of ev) { open += d; if (open > maxOpen) maxOpen = open; }
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    totalTrades: n,
    wins, losses, breakeven: be,
    winRate: wins / n,
    totalPnl: total,
    grossProfit: gp,
    grossLoss: gl,
    profitFactor: gl > 0 ? gp / gl : null, // undefined when no losing trade
    expectancy: total / n,
    expectancyR: avg(rs),
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    avgPlannedRr: avg(rrs),
    maxConsecutiveWins: mcw,
    maxConsecutiveLosses: mcl,
    avgHoldHours: avg(hold),
    medianHoldHours: hold.length ? [...hold].sort((a, b) => a - b)[Math.floor(hold.length / 2)] : null,
    avgHoldWinHours: avg(holdW),
    avgHoldLossHours: avg(holdL),
    maxOpenPositions: maxOpen,
  };
}

export function groupMetrics<K extends string>(
  trades: readonly TradeRecord[], keyOf: (t: TradeRecord) => K | null,
): Array<{ key: K; metrics: Metrics }> {
  const groups = new Map<K, TradeRecord[]>();
  for (const t of trades) {
    const k = keyOf(t);
    if (k == null) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, metrics: computeMetrics(list) }))
    .filter((g): g is { key: K; metrics: Metrics } => g.metrics !== null)
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

export function zoneOutcomeCounts(trades: readonly TradeRecord[]) {
  const c = { respect: 0, breakout: 0, unknown: 0 };
  for (const t of trades) if (t.zoneOutcome) c[t.zoneOutcome]++;
  return c;
}
