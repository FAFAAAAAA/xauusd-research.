/** Live trading helpers: lot size and the owner's trade journal (manual trades, no broker connection). */

export interface LiveRisk { capital: number; riskPct: number }
export const DEFAULT_LIVE_RISK: LiveRisk = { capital: 1000, riskPct: 1 };

/** Gold: 1 lot = 100 oz, so $1 move = $100 per lot. Lot rounded DOWN to 0.01 so the risk never exceeds the plan. */
export function lotFor(riskUsd: number, entry: number, sl: number, contractSize = 100): { lot: number; risk: number; dist: number } | null {
  const dist = Math.abs(entry - sl);
  if (!(riskUsd > 0) || !(dist > 0) || !Number.isFinite(dist)) return null;
  const lot = Math.floor((riskUsd / (dist * contractSize)) * 100 + 1e-9) / 100;
  return { lot, risk: lot * dist * contractSize, dist };
}

export function readLiveRisk(v: unknown): LiveRisk {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const n = (x: unknown, d: number, max: number) => (typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= max ? x : d);
  return { capital: n(o.capital, DEFAULT_LIVE_RISK.capital, 1e9), riskPct: n(o.riskPct, DEFAULT_LIVE_RISK.riskPct, 20) };
}

export type JournalSide = 'BUY' | 'SELL';
export type JournalResult = 'open' | 'tp' | 'sl' | 'be' | 'manual';
export interface JournalTrade {
  id: string; strategy: string; side: JournalSide; openedAt: number; entry: number; sl: number; tp: number; lot: number;
  closedAt: number | null; exit: number | null; result: JournalResult; pnl: number | null; note: string;
}

const STRATS = ['v1', 'v2', 'lain'];
/** Validates one journal entry from the browser. Returns an error message or the clean trade. */
export function cleanTrade(b: Record<string, unknown>, id: string): JournalTrade | string {
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : NaN);
  const side = b.side === 'SELL' ? 'SELL' : b.side === 'BUY' ? 'BUY' : null;
  if (!side) return 'Arah harus BUY atau SELL';
  const entry = num(b.entry), sl = num(b.sl), tp = num(b.tp), lot = num(b.lot);
  if (!(entry > 0) || !(sl > 0) || !(tp > 0)) return 'Entry, SL dan TP wajib diisi';
  if (side === 'BUY' ? !(sl < entry && tp > entry) : !(sl > entry && tp < entry)) return 'SL/TP tidak cocok dengan arah';
  if (!(lot > 0 && lot <= 100)) return 'Lot harus 0,01–100';
  const openedAt = num(b.openedAt);
  if (!(openedAt > 0)) return 'Waktu buka tidak valid';
  const result = (['open', 'tp', 'sl', 'be', 'manual'] as const).includes(b.result as JournalResult) ? (b.result as JournalResult) : 'open';
  let exit = num(b.exit);
  if (result === 'tp') exit = tp; else if (result === 'sl' && !(exit > 0)) exit = sl; else if (result === 'be' && !(exit > 0)) exit = entry;
  if (result !== 'open' && !(exit > 0)) return 'Harga keluar wajib diisi';
  const closedAt = result === 'open' ? null : (num(b.closedAt) > 0 ? num(b.closedAt) : Date.now());
  const pnlIn = num(b.pnl);
  const pnl = result === 'open' ? null : Number.isFinite(pnlIn) ? pnlIn : Math.round((side === 'BUY' ? exit - entry : entry - exit) * lot * 100 * 100) / 100;
  return {
    id, strategy: STRATS.includes(String(b.strategy)) ? String(b.strategy) : 'lain', side, openedAt, entry, sl, tp, lot,
    closedAt, exit: result === 'open' ? null : exit, result, pnl, note: typeof b.note === 'string' ? b.note.slice(0, 300) : '',
  };
}

export interface JournalStats { closed: number; open: number; wins: number; losses: number; winRate: number | null; pnl: number; avgR: number | null }
/** Win = closed with profit; R uses the planned risk (entry→SL × lot × 100). */
export function journalStats(trades: readonly JournalTrade[], strategy?: string): JournalStats {
  const t = strategy ? trades.filter((x) => x.strategy === strategy) : trades;
  const closed = t.filter((x) => x.result !== 'open' && x.pnl != null);
  const wins = closed.filter((x) => (x.pnl ?? 0) > 0).length, losses = closed.filter((x) => (x.pnl ?? 0) < 0).length;
  const rs = closed.map((x) => (x.pnl ?? 0) / (Math.abs(x.entry - x.sl) * x.lot * 100)).filter(Number.isFinite);
  return {
    closed: closed.length, open: t.length - closed.length, wins, losses,
    winRate: closed.length ? wins / closed.length : null, pnl: closed.reduce((a, x) => a + (x.pnl ?? 0), 0),
    avgR: rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : null,
  };
}

export interface LiveSignal { side: JournalSide; entry: number; sl: number; tp: number }
/** Reads side / sl / tp sent by the v1/v2 Pine indicators in the alert `extra`. Entry = alert price (bar close; real fill is the next open). */
export function liveSignalFrom(extra: Record<string, unknown> | null | undefined, price: number): LiveSignal | null {
  if (!extra) return null;
  const side = String(extra.side ?? '').toUpperCase();
  const sl = Number(extra.sl), tp = Number(extra.tp);
  if ((side !== 'BUY' && side !== 'SELL') || !(sl > 0) || !(tp > 0) || !(price > 0)) return null;
  if (side === 'BUY' ? !(sl < price && tp > price) : !(sl > price && tp < price)) return null;
  return { side, entry: price, sl, tp };
}
