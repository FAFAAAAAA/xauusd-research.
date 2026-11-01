/**
 * Risk statistics of the live strategies, from the website engine backtest (XAUUSD M15, 2004–2026, RR 1:2,
 * average broker costs: spread 0.12, slippage 0.10, commission $5/lot, swap BUY −$67 / SELL +$25 per lot per night).
 * All "R" values are in units of the risk per trade (1R = the planned loss when SL is hit).
 * Generated 1 Nov 2026 from v1 = metode level-v2 and v2 = metode volbreak-v4. Update when the strategies change.
 */
export interface RiskStats {
  trades: number; years: number; perMonth: number; winRate: number; avgR: number; perMonthR: number;
  maxDdR: number; maxLossStreak: number; worstMonthR: number; bestMonthR: number; negMonthsPct: number;
  worstYearR: number; worst12mR: number; maxOpen: number; medianSl: number; p25Sl: number; p75Sl: number;
}
export const RISK_STATS: Record<'v1' | 'v2' | 'v1v2', RiskStats> = {
  "v1": {
    "trades": 941,
    "years": 22.3,
    "perMonth": 3.51,
    "winRate": 0.406,
    "avgR": 0.1003,
    "perMonthR": 0.351,
    "maxDdR": 42.5,
    "maxLossStreak": 9,
    "worstMonthR": -7.3,
    "bestMonthR": 15.7,
    "negMonthsPct": 0.401,
    "worstYearR": -16.7,
    "worst12mR": -32.3,
    "maxOpen": 4,
    "medianSl": 7.95,
    "p25Sl": 5.34,
    "p75Sl": 12.09
  },
  "v2": {
    "trades": 2160,
    "years": 21.7,
    "perMonth": 8.3,
    "winRate": 0.3954,
    "avgR": 0.0879,
    "perMonthR": 0.728,
    "maxDdR": 56.2,
    "maxLossStreak": 19,
    "worstMonthR": -13.7,
    "bestMonthR": 19.6,
    "negMonthsPct": 0.448,
    "worstYearR": -28.2,
    "worst12mR": -37.5,
    "maxOpen": 6,
    "medianSl": 7.11,
    "p25Sl": 5.06,
    "p75Sl": 10.11
  },
  "v1v2": {
    "trades": 3101,
    "years": 22.4,
    "perMonth": 11.56,
    "winRate": 0.3986,
    "avgR": 0.0917,
    "perMonthR": 1.057,
    "maxDdR": 66.8,
    "maxLossStreak": 23,
    "worstMonthR": -20.1,
    "bestMonthR": 30.7,
    "negMonthsPct": 0.465,
    "worstYearR": -31.8,
    "worst12mR": -44.5,
    "maxOpen": 8,
    "medianSl": 7.26,
    "p25Sl": 5.16,
    "p75Sl": 10.73
  }
};
export const RISK_LABEL: Record<keyof typeof RISK_STATS, string> = { v1: 'v1 · Level H1', v2: 'v2 · Breakout volatilitas', v1v2: 'v1 + v2 bersamaan' };
/** Owner-facing rule: the historical max drawdown should stay at or below this share of the capital. */
export const IDEAL_DD_SHARE = 0.4;
