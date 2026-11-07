/**
 * The owner keeps two separate markets (7 Nov 2026): Forex = MetaTrader 5 / Exness (gold, Nasdaq) and Crypto = Binance Futures.
 * Every page shows one market at a time; this file says which strategy / journal key / symbol belongs where.
 */
export type Market = 'forex' | 'crypto';
export const MARKETS: ReadonlyArray<readonly [Market, string]> = [['forex', 'Forex (MT5)'], ['crypto', 'Crypto (Binance)']];

/** adapter key → market */
const ADAPTER: Record<string, Market> = { metode_crypto_donchian: 'crypto' };
/** strategy label of a backtest session ("metode <version>") → market */
const VERSION: Record<string, Market> = { 'metode crypto-donchian-v1': 'crypto' };
/** journal / risk-calculator keys per market (in display order) */
export const JOURNAL_KEYS: Record<Market, string[]> = { forex: ['v2', 'nas'], crypto: ['btc', 'alt'] };
export const RISK_KEYS: Record<Market, Array<'v2' | 'nas' | 'btc' | 'alt'>> = { forex: ['v2', 'nas'], crypto: ['btc', 'alt'] };
const CRYPTO_SYMBOLS = new Set(['BTCUSD', 'ETHUSD']);

export const marketOfAdapter = (k: string): Market => ADAPTER[k] ?? 'forex';
export const marketOfStrategy = (s: string): Market => VERSION[s] ?? 'forex';
export const marketOfSymbol = (s: string): Market => (CRYPTO_SYMBOLS.has(String(s).toUpperCase()) ? 'crypto' : 'forex');
/** journal key → market; 'lain' (other) shows in both */
export const marketOfJournal = (k: string): Market | 'both' => (k === 'btc' || k === 'alt' ? 'crypto' : k === 'lain' ? 'both' : 'forex');
