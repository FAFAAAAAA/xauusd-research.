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
  /** when TP and SL are both inside one candle and order is unknowable */
  ambiguityPolicy: 'worst' | 'best' | 'skip';
  /** contract multiplier: account currency per 1.00 price move per 1 unit (e.g. 100 for 1 lot = 100 oz) */
  contractSize: number;
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
  costs: { spread: number; slippage: number; commission: number };
}

export function simulateTrade(candles: readonly Candle[], intent: TradeIntent, cost: CostConfig): TradeResult {
  const entryBar = candles[intent.entryBarIndex];
  if (!entryBar) throw new Error('entryBarIndex di luar data');
  const long = intent.side === 'long';
  // Long buys at ASK (+spread), short sells at BID; both pay slippage.
  const entryPrice = long ? entryBar.open + cost.spread + cost.slippage : entryBar.open - cost.slippage;
  const risk = Math.abs(entryPrice - intent.stopLoss);
  if (risk <= 0) throw new Error('Stop loss harus berbeda dari harga entry');
  if (long ? intent.stopLoss >= entryPrice || intent.takeProfit <= entryPrice
           : intent.stopLoss <= entryPrice || intent.takeProfit >= entryPrice) {
    throw new Error('SL/TP tidak konsisten dengan arah trade');
  }
  const plannedRr = Math.abs(intent.takeProfit - entryPrice) / risk;
  const commission = cost.commissionPerUnit * intent.size;
  const costs = { spread: cost.spread, slippage: cost.slippage, commission };

  const finish = (t: number, px: number, reason: TradeResult['exitReason']): TradeResult => {
    const gross = (long ? px - entryPrice : entryPrice - px) * intent.size * cost.contractSize;
    const pnl = gross - commission;
    return {
      entryTime: entryBar.time, entryPrice, exitTime: t, exitPrice: px, exitReason: reason,
      pnl, pnlR: pnl / (risk * intent.size * cost.contractSize), plannedRr, costs,
    };
  };

  const maxBars = intent.maxBarsInTrade ?? Infinity;
  for (let i = intent.entryBarIndex, n = 0; i < candles.length && n < maxBars; i++, n++) {
    const c = candles[i];
    // Exits for a long happen on BID (data), for a short on ASK (data + spread).
    const hi = long ? c.high : c.high + cost.spread;
    const lo = long ? c.low : c.low + cost.spread;
    const hitSl = long ? lo <= intent.stopLoss : hi >= intent.stopLoss;
    const hitTp = long ? hi >= intent.takeProfit : lo <= intent.takeProfit;
    const slPx = long ? intent.stopLoss - cost.slippage : intent.stopLoss + cost.slippage;
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
  }
  return { entryTime: entryBar.time, entryPrice, exitTime: null, exitPrice: null, exitReason: 'open', pnl: null, pnlR: null, plannedRr, costs };
}
