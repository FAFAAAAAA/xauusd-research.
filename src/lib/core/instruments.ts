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
  /** swap as a fraction of the price per night (BUY / SELL) and the UTC weekday charged 3× (index CFDs) */
  swapLongPct?: number; swapShortPct?: number; swapTripleDay?: number;
  /** round-turn fee as a fraction of the notional (crypto exchanges) */
  commissionPct?: number;
}

const BINANCE = { commissionPct: 0.0012, swapLongPct: 0.0003, swapShortPct: 0, swapTripleDay: 5 } as const;   // fee+slippage 0.12% round turn, funding BUY 0.03%/day
export const INSTRUMENTS: InstrumentSpec[] = [
  // Gold uses the owner's Exness Raw Spread costs (2 Nov 2026, src/lib/core/broker.ts): spread 0.12, slippage 0.10 per fill, commission $7/lot round turn.
  { symbol: 'XAUUSD', label: 'XAUUSD (emas)', group: 'Emas', digits: 3, contractSize: 100, usdBase: false, spread: 0.12, slippage: 0.10, commission: 7 },   // Exness Raw Spread: $3.50 per lot per side
  { symbol: 'EURUSD', label: 'EURUSD', group: 'Forex', digits: 5, contractSize: 100_000, usdBase: false, spread: 0.00005, slippage: 0.00002, commission: 7 },
  { symbol: 'GBPUSD', label: 'GBPUSD', group: 'Forex', digits: 5, contractSize: 100_000, usdBase: false, spread: 0.00008, slippage: 0.00002, commission: 7 },
  { symbol: 'USDJPY', label: 'USDJPY', group: 'Forex', digits: 3, contractSize: 100_000, usdBase: true, spread: 0.006, slippage: 0.002, commission: 7 },
  { symbol: 'USDCHF', label: 'USDCHF', group: 'Forex', digits: 5, contractSize: 100_000, usdBase: true, spread: 0.00008, slippage: 0.00002, commission: 7 },
  { symbol: 'USDCAD', label: 'USDCAD', group: 'Forex', digits: 5, contractSize: 100_000, usdBase: true, spread: 0.00008, slippage: 0.00002, commission: 7 },
  // US100 = the owner's Exness USTEC (7 Nov 2026): commission 0.313 USD/lot/side, swap BUY −619.3 points (2 digits → 6.193 USD/lot/night
  // at ±28,420 = 0.0218% of the price), SELL 0, Friday 3×; spread floating (1.5 kept as estimate).
  { symbol: 'USATECHIDXUSD', label: 'US100 (Nasdaq)', group: 'Indeks', digits: 3, contractSize: 1, usdBase: false, spread: 1.5, slippage: 0.5, commission: 0.626,
    swapLongPct: 6.193 / 28420, swapShortPct: 0, swapTripleDay: 5 },
  { symbol: 'USA30IDXUSD', label: 'US30 (Dow Jones)', group: 'Indeks', digits: 3, contractSize: 1, usdBase: false, spread: 3, slippage: 1, commission: 0 },
  // Crypto = Binance USDT-M perpetual futures (7 Nov 2026): taker fee 0.05% per side + 0.02% slippage → commissionPct 0.0012 round
  // turn; spread ≈ 1 tick; funding estimated 0.01% per 8 h paid by longs → swapLongPct 0.0003 per day, 7 days a week
  // (rollover Mon–Fri with Friday ×3 = 7 charges per week); shorts 0 (conservative: they usually receive funding).
  { symbol: 'BTCUSD', label: 'BTCUSDT (Binance Futures)', group: 'Kripto', digits: 1, contractSize: 1, usdBase: false, spread: 0.1, slippage: 0, commission: 0,
    commissionPct: 0.0012, swapLongPct: 0.0003, swapShortPct: 0, swapTripleDay: 5 },
  { symbol: 'ETHUSD', label: 'ETHUSDT (Binance Futures)', group: 'Kripto', digits: 2, contractSize: 1, usdBase: false, spread: 0.01, slippage: 0, commission: 0,
    commissionPct: 0.0012, swapLongPct: 0.0003, swapShortPct: 0, swapTripleDay: 5 },
  // Binance USDT-M futures with ≥ $100 jt/hari volume (90 hari s/d Okt 2026), data 30m dari data.binance.vision (7 Nov 2026).
  { symbol: 'ZECUSDT', label: 'ZECUSDT (Binance)', group: 'Kripto', digits: 2, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'NEARUSDT', label: 'NEARUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ENAUSDT', label: 'ENAUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'UNIUSDT', label: 'UNIUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: '1000PEPEUSDT', label: '1000PEPEUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'PUMPUSDT', label: 'PUMPUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'WLDUSDT', label: 'WLDUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'TRUMPUSDT', label: 'TRUMPUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'BANKUSDT', label: 'BANKUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'LSKUSDT', label: 'LSKUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ARBUSDT', label: 'ARBUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ONDOUSDT', label: 'ONDOUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'TUTUSDT', label: 'TUTUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'FILUSDT', label: 'FILUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'SOLUSDT', label: 'SOLUSDT (Binance)', group: 'Kripto', digits: 2, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'XRPUSDT', label: 'XRPUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'HYPEUSDT', label: 'HYPEUSDT (Binance)', group: 'Kripto', digits: 3, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'DOGEUSDT', label: 'DOGEUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'BNBUSDT', label: 'BNBUSDT (Binance)', group: 'Kripto', digits: 2, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'SUIUSDT', label: 'SUIUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ADAUSDT', label: 'ADAUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'LINKUSDT', label: 'LINKUSDT (Binance)', group: 'Kripto', digits: 3, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'TAOUSDT', label: 'TAOUSDT (Binance)', group: 'Kripto', digits: 2, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'AVAXUSDT', label: 'AVAXUSDT (Binance)', group: 'Kripto', digits: 3, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'AAVEUSDT', label: 'AAVEUSDT (Binance)', group: 'Kripto', digits: 2, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'BCHUSDT', label: 'BCHUSDT (Binance)', group: 'Kripto', digits: 2, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  // + Binance coins with ≥ $20 jt/hari volume (90 hari s/d 6 Nov 2026), added 7 Nov 2026
  { symbol: 'LTCUSDT', label: 'LTCUSDT (Binance)', group: 'Kripto', digits: 3, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ACEUSDT', label: 'ACEUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'LITUSDT', label: 'LITUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'STRKUSDT', label: 'STRKUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'XLMUSDT', label: 'XLMUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'PENGUUSDT', label: 'PENGUUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'DASHUSDT', label: 'DASHUSDT (Binance)', group: 'Kripto', digits: 3, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'INJUSDT', label: 'INJUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'DOTUSDT', label: 'DOTUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ASTERUSDT', label: 'ASTERUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'SANDUSDT', label: 'SANDUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'XMRUSDT', label: 'XMRUSDT (Binance)', group: 'Kripto', digits: 2, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ONEUSDT', label: 'ONEUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'HBARUSDT', label: 'HBARUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ONGUSDT', label: 'ONGUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'MOVRUSDT', label: 'MOVRUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'PROMUSDT', label: 'PROMUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'XPLUSDT', label: 'XPLUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: '1000SHIBUSDT', label: '1000SHIBUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'COTIUSDT', label: 'COTIUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'TIAUSDT', label: 'TIAUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'VVVUSDT', label: 'VVVUSDT (Binance)', group: 'Kripto', digits: 3, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'APTUSDT', label: 'APTUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'TRXUSDT', label: 'TRXUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'DEXEUSDT', label: 'DEXEUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'MUBARAKUSDT', label: 'MUBARAKUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'HEMIUSDT', label: 'HEMIUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ZROUSDT', label: 'ZROUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'RLCUSDT', label: 'RLCUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'IOSTUSDT', label: 'IOSTUSDT (Binance)', group: 'Kripto', digits: 8, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'OPUSDT', label: 'OPUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'BICOUSDT', label: 'BICOUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'CRVUSDT', label: 'CRVUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'FARTCOINUSDT', label: 'FARTCOINUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'NILUSDT', label: 'NILUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ETCUSDT', label: 'ETCUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'GTCUSDT', label: 'GTCUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'KAITOUSDT', label: 'KAITOUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ETHFIUSDT', label: 'ETHFIUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ICPUSDT', label: 'ICPUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'WLFIUSDT', label: 'WLFIUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: '1000BONKUSDT', label: '1000BONKUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'HOMEUSDT', label: 'HOMEUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'VIRTUALUSDT', label: 'VIRTUALUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'AGTUSDT', label: 'AGTUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'BOMEUSDT', label: 'BOMEUSDT (Binance)', group: 'Kripto', digits: 8, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'BMTUSDT', label: 'BMTUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'MAGICUSDT', label: 'MAGICUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'SOPHUSDT', label: 'SOPHUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'GUSDT', label: 'GUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'WIFUSDT', label: 'WIFUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'SAGAUSDT', label: 'SAGAUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ATOMUSDT', label: 'ATOMUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'LDOUSDT', label: 'LDOUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'GPSUSDT', label: 'GPSUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'AEROUSDT', label: 'AEROUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'JUPUSDT', label: 'JUPUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: '1000RATSUSDT', label: '1000RATSUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'POLUSDT', label: 'POLUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'SEIUSDT', label: 'SEIUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'SYNUSDT', label: 'SYNUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  // + coins profitable with v1 SNR in research, still active (30-day volume >= $5 jt/hari), added 7 Nov 2026
  { symbol: 'WUSDT', label: 'WUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'BATUSDT', label: 'BATUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ERAUSDT', label: 'ERAUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'SUSDT', label: 'SUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'RSRUSDT', label: 'RSRUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ZEREBROUSDT', label: 'ZEREBROUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'KAIAUSDT', label: 'KAIAUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'PYTHUSDT', label: 'PYTHUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'HOTUSDT', label: 'HOTUSDT (Binance)', group: 'Kripto', digits: 8, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'CFXUSDT', label: 'CFXUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ZKUSDT', label: 'ZKUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ORCAUSDT', label: 'ORCAUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ALTUSDT', label: 'ALTUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'STXUSDT', label: 'STXUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'RENDERUSDT', label: 'RENDERUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'MINAUSDT', label: 'MINAUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'INITUSDT', label: 'INITUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'PENDLEUSDT', label: 'PENDLEUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ALGOUSDT', label: 'ALGOUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'EIGENUSDT', label: 'EIGENUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'JTOUSDT', label: 'JTOUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ARCUSDT', label: 'ARCUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'BLURUSDT', label: 'BLURUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'RUNEUSDT', label: 'RUNEUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'CKBUSDT', label: 'CKBUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'GALAUSDT', label: 'GALAUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'MORPHOUSDT', label: 'MORPHOUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'INUSDT', label: 'INUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'COMPUSDT', label: 'COMPUSDT (Binance)', group: 'Kripto', digits: 3, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'CAKEUSDT', label: 'CAKEUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'PLUMEUSDT', label: 'PLUMEUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ARKUSDT', label: 'ARKUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'AXSUSDT', label: 'AXSUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ORDIUSDT', label: 'ORDIUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'REZUSDT', label: 'REZUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'PIXELUSDT', label: 'PIXELUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'BERAUSDT', label: 'BERAUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'APEUSDT', label: 'APEUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'SPXUSDT', label: 'SPXUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'GRIFFAINUSDT', label: 'GRIFFAINUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'POWRUSDT', label: 'POWRUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'TREEUSDT', label: 'TREEUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'ANIMEUSDT', label: 'ANIMEUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'MANAUSDT', label: 'MANAUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: '1000FLOKIUSDT', label: '1000FLOKIUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'CHZUSDT', label: 'CHZUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'VETUSDT', label: 'VETUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'IOUSDT', label: 'IOUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'BIOUSDT', label: 'BIOUSDT (Binance)', group: 'Kripto', digits: 6, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'NXPCUSDT', label: 'NXPCUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: '0GUSDT', label: '0GUSDT (Binance)', group: 'Kripto', digits: 5, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'LPTUSDT', label: 'LPTUSDT (Binance)', group: 'Kripto', digits: 4, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'MEWUSDT', label: 'MEWUSDT (Binance)', group: 'Kripto', digits: 8, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
  { symbol: 'PEOPLEUSDT', label: 'PEOPLEUSDT (Binance)', group: 'Kripto', digits: 7, contractSize: 1, usdBase: false, spread: 0, slippage: 0, commission: 0, ...BINANCE },
];

export function instrumentSpec(symbol: string): InstrumentSpec | null {
  return INSTRUMENTS.find((x) => x.symbol === symbol.toUpperCase()) ?? null;
}

/** Default execution costs for an instrument (XAUUSD keeps the website's long-standing defaults). */
export function instrumentCosts(symbol: string): Omit<CostConfig, 'ambiguityPolicy'> {
  const s = instrumentSpec(symbol) ?? INSTRUMENTS[0];
  return { spread: s.spread, slippage: s.slippage, commissionPerUnit: s.commission, contractSize: s.contractSize,
    ...(s.commissionPct ? { commissionPct: s.commissionPct } : {}),
    ...(s.swapLongPct || s.swapShortPct ? { swapLongPct: s.swapLongPct ?? 0, swapShortPct: s.swapShortPct ?? 0 } : {}),
    ...(s.swapTripleDay !== undefined ? { swapTripleDay: s.swapTripleDay } : {}) };
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
