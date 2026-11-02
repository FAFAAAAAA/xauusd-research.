/**
 * Risk statistics of the live strategies, from the website engine backtest (XAUUSD M15, 2004–2026, RR 1:2,
 * average broker costs: spread 0.12, slippage 0.10, commission $5/lot, swap BUY −$67 / SELL +$25 per lot per night).
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
    "avgR": 0.1141,
    "perMonthR": 0.355,
    "maxDdR": 30.2,
    "maxLossStreak": 9,
    "worstMonthR": -6.4,
    "bestMonthR": 10.1,
    "negMonthsPct": 0.409,
    "worstYearR": -14.2,
    "worst12mR": -26.7,
    "maxOpen": 3,
    "medianSl": 7.92,
    "p25Sl": 5.28,
    "p75Sl": 12.07
  },
  "v2": {
    "trades": 1302,
    "years": 21.7,
    "perMonth": 5.01,
    "winRate": 0.3418,
    "avgR": 0.172,
    "perMonthR": 0.861,
    "maxDdR": 15.9,
    "maxLossStreak": 10,
    "worstMonthR": -5.8,
    "bestMonthR": 11.5,
    "negMonthsPct": 0.372,
    "worstYearR": -5.2,
    "worst12mR": -11.4,
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
    "avgR": 0.1335,
    "perMonthR": 0.551,
    "maxDdR": 25.0,
    "maxLossStreak": 12,
    "worstMonthR": -6.5,
    "bestMonthR": 13.4,
    "negMonthsPct": 0.483,
    "worstYearR": -15.4,
    "worst12mR": -16.3,
    "maxOpen": 4,
    "medianSl": 8.66,
    "p25Sl": 5.64,
    "p75Sl": 13.14
  },
  "v1v2": {
    "trades": 2135,
    "years": 22.4,
    "perMonth": 7.96,
    "winRate": 0.3686,
    "avgR": 0.1494,
    "perMonthR": 1.189,
    "maxDdR": 36.7,
    "maxLossStreak": 12,
    "worstMonthR": -9.2,
    "bestMonthR": 21.2,
    "negMonthsPct": 0.42,
    "worstYearR": -14.2,
    "worst12mR": -34.2,
    "maxOpen": 6,
    "medianSl": 7.48,
    "p25Sl": 5.23,
    "p75Sl": 10.95
  },
  "v1v2v3": {
    "trades": 3208,
    "years": 22.4,
    "perMonth": 11.96,
    "winRate": 0.3806,
    "avgR": 0.144,
    "perMonthR": 1.723,
    "maxDdR": 40.2,
    "maxLossStreak": 17,
    "worstMonthR": -11.3,
    "bestMonthR": 29.4,
    "negMonthsPct": 0.431,
    "worstYearR": -14.2,
    "worst12mR": -35.4,
    "maxOpen": 8,
    "medianSl": 7.85,
    "p25Sl": 5.34,
    "p75Sl": 11.73
  }
};
export const RISK_LABEL: Record<keyof typeof RISK_STATS, string> = { v1: 'v1 · Level H1', v2: 'v2 · Breakout volatilitas', v3: 'v3 · BOS H1', v1v2: 'v1 + v2 bersamaan', v1v2v3: 'v1 + v2 + v3 bersamaan' };
/** Owner-facing rule: the historical max drawdown should stay at or below this share of the capital. */
export const IDEAL_DD_SHARE = 0.4;
