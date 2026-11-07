/**
 * Risk statistics of the live strategies, from the website engine backtest (XAUUSD M15, 2004–2026, RR 1:2,
 * the owner's Exness Raw Spread costs: spread 0.12, slippage 0.10, commission $7/lot, swap BUY −$47.47 / SELL 0 per lot per night).
 * All "R" values are in units of the risk per trade (1R = the planned loss when SL is hit).
 * Generated 2 Nov 2026 from v1 = metode level-v3, v2 = metode volbreak-v5 (with breakeven: a trade closed at the entry counts
 * as neither win nor loss) and v3 = metode bos-h1-v1. Update when the strategies change.
 */
export interface RiskStats {
  trades: number; years: number; perMonth: number; winRate: number; avgR: number; perMonthR: number;
  maxDdR: number; maxLossStreak: number; worstMonthR: number; bestMonthR: number; negMonthsPct: number;
  worstYearR: number; worst12mR: number; maxOpen: number; medianSl: number; p25Sl: number; p75Sl: number;
}
export const RISK_STATS: Record<'v1' | 'v2' | 'v3' | 'v1v2' | 'v1v2v3', RiskStats> = {
  "v1": {
    "trades": 833,
    "years": 22.3,
    "perMonth": 3.11,
    "winRate": 0.4106,
    "avgR": 0.1348,
    "perMonthR": 0.419,
    "maxDdR": 25.3,
    "maxLossStreak": 9,
    "worstMonthR": -6.3,
    "bestMonthR": 10.3,
    "negMonthsPct": 0.398,
    "worstYearR": -11.6,
    "worst12mR": -23.1,
    "maxOpen": 3,
    "medianSl": 7.92,
    "p25Sl": 5.28,
    "p75Sl": 12.07
  },
  "v2": {
    "trades": 1302,
    "years": 21.7,
    "perMonth": 5.01,
    "winRate": 0.3402,
    "avgR": 0.1824,
    "perMonthR": 0.913,
    "maxDdR": 15.3,
    "maxLossStreak": 11,
    "worstMonthR": -6.4,
    "bestMonthR": 11.6,
    "negMonthsPct": 0.391,
    "worstYearR": -4.6,
    "worst12mR": -10.8,
    "maxOpen": 4,
    "medianSl": 7.35,
    "p25Sl": 5.2,
    "p75Sl": 10.52
  },
  "v3": {
    "trades": 1073,
    "years": 21.7,
    "perMonth": 4.13,
    "winRate": 0.4045,
    "avgR": 0.142,
    "perMonthR": 0.586,
    "maxDdR": 24.8,
    "maxLossStreak": 12,
    "worstMonthR": -6.4,
    "bestMonthR": 13.6,
    "negMonthsPct": 0.479,
    "worstYearR": -15.2,
    "worst12mR": -15.8,
    "maxOpen": 4,
    "medianSl": 8.66,
    "p25Sl": 5.64,
    "p75Sl": 13.14
  },
  "v1v2": {
    "trades": 2135,
    "years": 22.4,
    "perMonth": 7.96,
    "winRate": 0.3677,
    "avgR": 0.1638,
    "perMonthR": 1.304,
    "maxDdR": 30.3,
    "maxLossStreak": 12,
    "worstMonthR": -9.4,
    "bestMonthR": 21.4,
    "negMonthsPct": 0.401,
    "worstYearR": -11.6,
    "worst12mR": -29.2,
    "maxOpen": 6,
    "medianSl": 7.48,
    "p25Sl": 5.23,
    "p75Sl": 10.95
  },
  "v1v2v3": {
    "trades": 3208,
    "years": 22.4,
    "perMonth": 11.96,
    "winRate": 0.38,
    "avgR": 0.1565,
    "perMonthR": 1.872,
    "maxDdR": 33.2,
    "maxLossStreak": 17,
    "worstMonthR": -11.4,
    "bestMonthR": 30.0,
    "negMonthsPct": 0.42,
    "worstYearR": -11.6,
    "worst12mR": -30.1,
    "maxOpen": 8,
    "medianSl": 7.85,
    "p25Sl": 5.34,
    "p75Sl": 11.73
  }
};
export const RISK_LABEL: Record<keyof typeof RISK_STATS, string> = { v1: 'v1 Level', v2: 'v1 XAU', v3: 'v3 BOS', v1v2: 'v1 + v2 bersamaan', v1v2v3: 'v1 + v2 + v3 bersamaan' };
/** Owner-facing rule: the historical max drawdown should stay at or below this share of the capital. */
export const IDEAL_DD_SHARE = 0.4;
