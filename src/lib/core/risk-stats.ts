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
export const RISK_STATS: Record<'v1' | 'v2' | 'v3' | 'v1v2' | 'v1v2v3' | 'nas' | 'btc' | 'alt', RiskStats> = {
  // v1 ALT (Binance Futures, SELL breakout volatilitas di koin cepat & ramai): research portfolio, max 3 open positions, 1/coin, Jan 2020 – Okt 2026,
  // costs 0.12% round turn (fee + slippage), shorts pay no funding. medianSl / p25Sl / p75Sl = SL distance in % of the price. Generated 7 Nov 2026.
  "alt": {"trades": 2495, "years": 6.8, "perMonth": 30.63, "winRate": 0.3888, "avgR": 0.1429, "perMonthR": 4.378, "maxDdR": 37.1, "maxLossStreak": 26, "worstMonthR": -16.9, "bestMonthR": 35.8, "negMonthsPct": 0.354, "worstYearR": 9.0, "worst12mR": -17.0, "maxOpen": 3, "medianSl": 5.34, "p25Sl": 4.15, "p75Sl": 7.33},
  // v1 BTC (Binance BTCUSDT futures, metode crypto-donchian-v1): website engine on M30 Feb 2018–Oct 2026 with Binance costs (fee 0.05%/side
  // + slippage = 0.12% round turn, funding 0.03%/day for BUY), RR 1:2, generated 7 Nov 2026. medianSl / p25Sl / p75Sl in USD of BTC price:
  // SL as a % of the price over the LAST 12 MONTHS × the last price (77,254). "Lot" = BTC quantity (Binance minimum 0.001 BTC).
  "btc": {
    "trades": 308,
    "years": 8.7,
    "perMonth": 2.96,
    "winRate": 0.4123,
    "avgR": 0.1717,
    "perMonthR": 0.508,
    "maxDdR": 17.8,
    "maxLossStreak": 16,
    "worstMonthR": -8.1,
    "bestMonthR": 19.0,
    "negMonthsPct": 0.39,
    "worstYearR": -8.6,
    "worst12mR": -8.6,
    "maxOpen": 6,
    "medianSl": 2065,
    "p25Sl": 2015,
    "p75Sl": 2181
  },
  // v1 NAS (US100, metode nas-donchian-v1): website engine on M30 2013–2026 with the website's US100 costs (spread 1.5 + slippage 0.5 +
  // commission 0.626 points, swap BUY 0.0218% of the price per night, Friday 3×), RR 1:2, generated 7 Nov 2026. medianSl / p25Sl / p75Sl
  // are SL distances in index points over the LAST 12 MONTHS (the price rose ~7× since 2013, so older SLs would understate the lot size).
  "nas": {
    "trades": 838,
    "years": 12.6,
    "perMonth": 5.56,
    "winRate": 0.4308,
    "avgR": 0.1819,
    "perMonthR": 1.012,
    "maxDdR": 26.3,
    "maxLossStreak": 15,
    "worstMonthR": -7.8,
    "bestMonthR": 16.0,
    "negMonthsPct": 0.382,
    "worstYearR": -14.6,
    "worst12mR": -16.8,
    "maxOpen": 5,
    "medianSl": 92.4,
    "p25Sl": 78.7,
    "p75Sl": 102.3
  },
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
export const RISK_LABEL: Record<keyof typeof RISK_STATS, string> = { v1: 'v1 Level', v2: 'v1 XAU', v3: 'v3 BOS', v1v2: 'v1 + v2 bersamaan', v1v2v3: 'v1 + v2 + v3 bersamaan', nas: 'v1 NAS', btc: 'v1 BTC', alt: 'v1 ALT' };
/** Instrument facts per entry: USD per 1.00 price move per 1 lot, the broker's minimum lot (Exness) and the backtest period. */
export const RISK_META: Record<keyof typeof RISK_STATS, { contract: number; minLot: number; period: string; unit: string; dp?: number; broker?: string; noLot?: boolean }> = {
  v1: { contract: 100, minLot: 0.01, period: '2004–2026', unit: '$' }, v2: { contract: 100, minLot: 0.01, period: '2004–2026', unit: '$' },
  v3: { contract: 100, minLot: 0.01, period: '2004–2026', unit: '$' }, v1v2: { contract: 100, minLot: 0.01, period: '2004–2026', unit: '$' },
  v1v2v3: { contract: 100, minLot: 0.01, period: '2004–2026', unit: '$' }, nas: { contract: 1, minLot: 0.05, period: '2014–2026', unit: ' poin' },
  btc: { contract: 1, minLot: 0.001, period: '2018–2026', unit: '$', dp: 3, broker: 'Binance' },
  alt: { contract: 1, minLot: 0, period: '2020–2026', unit: '%', broker: 'Binance', noLot: true },   // many coins → no single lot; % risk only
};
/** Owner-facing rule: the historical max drawdown should stay at or below this share of the capital. */
export const IDEAL_DD_SHARE = 0.4;
