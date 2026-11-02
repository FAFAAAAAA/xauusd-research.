import type { CostConfig } from './tradesim';

/**
 * Instruments the website can backtest from bundled price files (forexsb.com exports, UTC).
 * Costs are CONSERVATIVE ESTIMATES for a typical ECN/raw account — not quotes from a specific broker.
 *  - contractSize: units per 1.00 lot (gold 100 oz, FX 100,000, index/crypto CFD 1)
 *  - usdBase: P&L is in the quote currency (JPY/CHF/CAD) → converted to USD by dividing by the price
 */
export interface InstrumentSpec {
  symbol: string; label: string; group: 'Emas' | 'Forex' | 'Indeks' | 'Kripto'; digits: number;
  contractSize: number; usdBase: boolean; spread: number; slippage: number; commission: number;
}

export const INSTRUMENTS: InstrumentSpec[] = [
  // Gold uses the owner's Exness Raw Spread costs (2 Nov 2026, src/lib/core/broker.ts): spread 0.12, slippage 0.10 per fill, commission $7/lot round turn.
  { symbol: 'XAUUSD', label: 'XAUUSD (emas)', group: 'Emas', digits: 3, contractSize: 100, usdBase: false, spread: 0.12, slippage: 0.10, commission: 7 },   // Exness Raw Spread: $3.50 per lot per side
  { symbol: 'EURUSD', label: 'EURUSD', group: 'Forex', digits: 5, contractSize: 100_000, usdBase: false, spread: 0.00005, slippage: 0.00002, commission: 7 },
  { symbol: 'GBPUSD', label: 'GBPUSD', group: 'Forex', digits: 5, contractSize: 100_000, usdBase: false, spread: 0.00008, slippage: 0.00002, commission: 7 },
  { symbol: 'USDJPY', label: 'USDJPY', group: 'Forex', digits: 3, contractSize: 100_000, usdBase: true, spread: 0.006, slippage: 0.002, commission: 7 },
  { symbol: 'USDCHF', label: 'USDCHF', group: 'Forex', digits: 5, contractSize: 100_000, usdBase: true, spread: 0.00008, slippage: 0.00002, commission: 7 },
  { symbol: 'USDCAD', label: 'USDCAD', group: 'Forex', digits: 5, contractSize: 100_000, usdBase: true, spread: 0.00008, slippage: 0.00002, commission: 7 },
  { symbol: 'USATECHIDXUSD', label: 'US100 (Nasdaq)', group: 'Indeks', digits: 3, contractSize: 1, usdBase: false, spread: 1.5, slippage: 0.5, commission: 0 },
  { symbol: 'USA30IDXUSD', label: 'US30 (Dow Jones)', group: 'Indeks', digits: 3, contractSize: 1, usdBase: false, spread: 3, slippage: 1, commission: 0 },
  { symbol: 'BTCUSD', label: 'BTCUSD', group: 'Kripto', digits: 1, contractSize: 1, usdBase: false, spread: 25, slippage: 10, commission: 0 },
  { symbol: 'ETHUSD', label: 'ETHUSD', group: 'Kripto', digits: 2, contractSize: 1, usdBase: false, spread: 2, slippage: 0.5, commission: 0 },
];

export function instrumentSpec(symbol: string): InstrumentSpec | null {
  return INSTRUMENTS.find((x) => x.symbol === symbol.toUpperCase()) ?? null;
}

/** Default execution costs for an instrument (XAUUSD keeps the website's long-standing defaults). */
export function instrumentCosts(symbol: string): Omit<CostConfig, 'ambiguityPolicy'> {
  const s = instrumentSpec(symbol) ?? INSTRUMENTS[0];
  return { spread: s.spread, slippage: s.slippage, commissionPerUnit: s.commission, contractSize: s.contractSize };
}

/** USD value of a 1.00 price move for 1 lot at `price` (quote→USD for USD-base pairs). */
export function usdPerPoint(symbol: string, contractSize: number, price: number): number {
  const s = instrumentSpec(symbol);
  return s?.usdBase ? contractSize / price : contractSize;
}

export function instrumentLabel(symbol: string | null | undefined): string {
  if (!symbol) return '—';
  return instrumentSpec(symbol)?.label ?? symbol;
}
