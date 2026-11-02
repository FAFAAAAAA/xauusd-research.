/**
 * The owner's broker account (2 Nov 2026): Exness MT5 "Raw Spread", XAUUSD contract specification from the app.
 * Used as the website default for backtest costs, journal P&L of manual trades and the risk calculator.
 *  - commission 3.50 USD per lot per side → 7 USD per lot round turn
 *  - swap long −474.7 points, short 0 (3 digits, 100 oz) → BUY pays 47.47 USD per lot per night, SELL 0; Wednesday counts 3
 *  - server time = UTC (daily break 21:58–23:00 server time), stop level 0, min lot 0.01, step 0.01
 * Spread is floating; 0.12 is kept until the owner measures the real XAUUSD spread in London / New York hours.
 */
export const BROKER = {
  name: 'Exness Raw Spread',
  spread: 0.12,
  slippage: 0.10,
  commissionPerLot: 7,
  swapLong: 47.47,
  swapShort: 0,
  serverUtcOffsetHours: 0,
  minLot: 0.01,
  lotStep: 0.01,
  contractSize: 100,
} as const;
