/**
 * The owner keeps two separate markets (7 Nov 2026): Forex = MetaTrader 5 / Exness (gold, Nasdaq) and Crypto = Binance Futures.
 * Every page shows one market at a time; this file says which strategy / journal key / symbol belongs where.
 */
import { instrumentSpec } from './instruments';

export type Market = 'forex' | 'crypto';
export const MARKETS: ReadonlyArray<readonly [Market, string]> = [['forex', 'Forex'], ['crypto', 'Crypto']];

/** adapter key → market */
const ADAPTER: Record<string, Market> = { metode_crypto_donchian: 'crypto', metode_alt_volbreak: 'crypto', metode_alt_breakdown: 'crypto', metode_snr_sell: 'crypto' };
/** strategy label of a backtest session ("metode <version>") → market */
const VERSION: Record<string, Market> = { 'metode crypto-donchian-v1': 'crypto', 'metode alt-volbreak-v1': 'crypto', 'metode alt-breakdown-v1': 'crypto', 'metode snr-sell-v1': 'crypto' };
/** journal / risk-calculator keys per market (in display order) */
export const JOURNAL_KEYS: Record<Market, string[]> = { forex: ['v2', 'nas'], crypto: ['snr', 'btc'] };
export const RISK_KEYS: Record<Market, Array<'v2' | 'nas' | 'btc' | 'alt' | 'snr'>> = { forex: ['v2', 'nas'], crypto: ['snr'] };

export const marketOfAdapter = (k: string): Market => ADAPTER[k] ?? 'forex';
export const marketOfStrategy = (s: string): Market => VERSION[s] ?? 'forex';
export const marketOfSymbol = (s: string): Market => (instrumentSpec(String(s))?.group === 'Kripto' ? 'crypto' : 'forex');
/** journal key → market; 'lain' (other) shows in both */
export const marketOfJournal = (k: string): Market | 'both' => (k === 'btc' || k === 'alt' || k === 'snr' ? 'crypto' : k === 'lain' ? 'both' : 'forex');
