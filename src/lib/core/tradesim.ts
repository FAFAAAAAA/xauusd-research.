import type { Candle } from './types';

/**
 * Execution model for simulated trades. Prices in the data are assumed to be the
 * source's `price_basis` (usually BID). Spread is added on the ASK side.
 * This module executes trade INTENTS supplied by a strategy; it never decides
 * entries, stops or targets itself.
 */
export interface CostConfig {
  /** spread in price units (e.g. 0.30 = 30 cents) */
  spread: number;
  /** adverse slippage in price units applied to market entries and stop exits */
  slippage: number;
  /** commission per trade round-turn, account currency per 1 unit of size */
  commissionPerUnit: number;
  /** extra commission round-turn as a FRACTION of the entry notional (exchange fees, e.g. Binance taker 0.05% × 2 = 0.001) */
  commissionPct?: number;
  /** when TP and SL are both inside one candle and order is unknowable */
  ambiguityPolicy: 'worst' | 'best' | 'skip';
  /** contract multiplier: account currency per 1.00 price move per 1 unit (e.g. 100 for 1 lot = 100 oz) */
  contractSize: number;
  /** overnight swap COST per 1 unit of size per night (positive = you pay), BUY and SELL; 0 / missing = no swap */
  swapLong?: number;
  swapShort?: number;
  /** extra swap as a FRACTION of the entry price per night (index CFDs whose swap follows the price), BUY / SELL */
  swapLongPct?: number;
  swapShortPct?: number;
  /** UTC weekday whose rollover counts 3 nights (default 3 = Wednesday for gold/FX; 5 = Friday for index CFDs) */
  swapTripleDay?: number;
}

/** Rollover at 21:00 UTC on Mon–Fri; Wednesday (or `tripleDay`) counts 3 nights (weekend). Returns nights charged between entry and exit. */
export function swapNights(entry: number, exit: number, tripleDay = 3): number {
  if (!(exit > entry)) return 0;
  const DAY = 86_400_000, ROLL = 21 * 3_600_000;
  let n = 0;
  for (let t = Math.floor((entry - ROLL) / DAY) * DAY + ROLL; t <= exit; t += DAY) {
    if (t <= entry) continue;
    const wd = new Date(t).getUTCDay();
    if (wd >= 1 && wd <= 5) n += wd === tripleDay ? 3 : 1;
  }
  return n;
}

export const DEFAULT_COSTS: CostConfig = {
  spread: 0, slippage: 0, commissionPerUnit: 0, ambiguityPolicy: 'worst', contractSize: 100,
};

export interface TradeIntent {
  side: 'long' | 'short';
  /** the bar AFTER the signal bar; entry fills at its open (no same-bar fill on a closed signal) */
  entryBarIndex: number;
  stopLoss: number;
  takeProfit: number;
  size: number;
  maxBarsInTrade?: number;
  /** move the stop to the entry price once price has reached entry + breakevenR × risk (active from the NEXT bar; the
   *  bar that reaches it cannot also use the new stop because the order inside a candle is unknown). */
  breakevenR?: number;
}

export interface TradeResult {
  entryTime: number;
  entryPrice: number;
  exitTime: number | null;
  exitPrice: number | null;
  exitReason: 'tp' | 'sl' | 'ambiguous_worst' | 'ambiguous_best' | 'ambiguous_skipped' | 'time' | 'open';
  pnl: number | null;
  pnlR: number | null;
  plannedRr: number;
  costs: { spread: number; slippage: number; commission: number; swap?: number; nights?: number; breakeven?: boolean };
}

/** Fill price of a market entry at `open`: longs pay the ask (+spread) and slippage, shorts sell the bid minus slippage. */
export function fillPrice(side: 'long' | 'short', open: number, cost: CostConfig): number {
  return side === 'long' ? open + cost.spread + cost.slippage : open - cost.slippage;
}

export function simulateTrade(candles: readonly Candle[], intent: TradeIntent, cost: CostConfig): TradeResult {
  const entryBar = candles[intent.entryBarIndex];
  if (!entryBar) throw new Error('entryBarIndex di luar data');
  const long = intent.side === 'long';
  // Long buys at ASK (+spread), short sells at BID; both pay slippage.
  const entryPrice = fillPrice(intent.side, entryBar.open, cost);
  const risk = Math.abs(entryPrice - intent.stopLoss);
  if (risk <= 0) throw new Error('Stop loss harus berbeda dari harga entry');
  if (long ? intent.stopLoss >= entryPrice || intent.takeProfit <= entryPrice
           : intent.stopLoss <= entryPrice || intent.takeProfit >= entryPrice) {
    throw new Error('SL/TP tidak konsisten dengan arah trade');
  }
  const plannedRr = Math.abs(intent.takeProfit - entryPrice) / risk;
  const commission = cost.commissionPerUnit * intent.size + (cost.commissionPct ?? 0) * entryPrice * cost.contractSize * intent.size;
  const costs = { spread: cost.spread, slippage: cost.slippage, commission };

  let stop = intent.stopLoss, moved = false;
  const beAt = intent.breakevenR && intent.breakevenR > 0 ? entryPrice + (long ? 1 : -1) * intent.breakevenR * risk : NaN;
  const finish = (t: number, px: number, reason: TradeResult['exitReason']): TradeResult => {
    const gross = (long ? px - entryPrice : entryPrice - px) * intent.size * cost.contractSize;
    const rate = ((long ? cost.swapLong : cost.swapShort) ?? 0)
      + ((long ? cost.swapLongPct : cost.swapShortPct) ?? 0) * entryPrice * cost.contractSize;
    const nights = rate ? swapNights(entryBar.time, t, cost.swapTripleDay ?? 3) : 0;
    const swap = rate * nights * intent.size;
    const pnl = gross - commission - swap;
    return {
      entryTime: entryBar.time, entryPrice, exitTime: t, exitPrice: px, exitReason: reason,
      pnl, pnlR: pnl / (risk * intent.size * cost.contractSize), plannedRr,
      costs: { ...(rate ? { ...costs, swap, nights } : costs), ...(moved && reason !== 'tp' ? { breakeven: true } : {}) },
    };
  };

  const maxBars = intent.maxBarsInTrade ?? Infinity;
  for (let i = intent.entryBarIndex, n = 0; i < candles.length && n < maxBars; i++, n++) {
    const c = candles[i];
    // Exits for a long happen on BID (data), for a short on ASK (data + spread).
    const hi = long ? c.high : c.high + cost.spread;
    const lo = long ? c.low : c.low + cost.spread;
    const hitSl = long ? lo <= stop : hi >= stop;
    const hitTp = long ? hi >= intent.takeProfit : lo <= intent.takeProfit;
    const slPx = long ? stop - cost.slippage : stop + cost.slippage;
    if (hitSl && hitTp) {
      if (cost.ambiguityPolicy === 'skip') {
        return { entryTime: entryBar.time, entryPrice, exitTime: c.time, exitPrice: null, exitReason: 'ambiguous_skipped', pnl: null, pnlR: null, plannedRr, costs };
      }
      return cost.ambiguityPolicy === 'worst'
        ? finish(c.time, slPx, 'ambiguous_worst')
        : finish(c.time, intent.takeProfit, 'ambiguous_best');
    }
    if (hitSl) return finish(c.time, slPx, 'sl');
    if (hitTp) return finish(c.time, intent.takeProfit, 'tp');
    if (n + 1 >= maxBars) return finish(c.time, long ? c.close : c.close + cost.spread, 'time');
    if (!moved && Number.isFinite(beAt) && (long ? hi >= beAt : lo <= beAt)) { moved = true; stop = entryPrice; }   // SL → entry from the next bar
  }
  return { entryTime: entryBar.time, entryPrice, exitTime: null, exitPrice: null, exitReason: 'open', pnl: null, pnlR: null, plannedRr, costs };
}
