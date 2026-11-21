/**
 * Remote settings for the Binance bot (Atur → Kontrol bot). The website only stores WISHES; the bot on the VPS fetches them
 * (every ~60 s), clamps them again and applies them itself. The website never places, changes or closes an order.
 * A key missing from `set` = "use the value in snr_bot_config.json on the VPS".
 * Secrets and account switches (API key, testnet, dry_run, report key) are NOT remote on purpose: they stay on the VPS.
 */
export type BotKey =
  | 'risk_mode' | 'risk_percent' | 'risk_usdt' | 'max_positions' | 'max_buy_positions' | 'buy_enabled' | 'mb_enabled' | 'max_mb_positions' | 'lst_enabled' | 'max_lst_positions' | 'bz_enabled' | 'max_bz_positions'
  | 'stop_balance_usdt' | 'max_loss_streak' | 'leverage_auto' | 'leverage' | 'margin_isolated'
  | 'daily_summary' | 'summary_hours_kst' | 'exclude';
export type BotVal = number | boolean | string | number[] | string[];
export interface BotControl { set: Partial<Record<BotKey, BotVal>>; paused: boolean; resetAt: number; closeAllAt: number; updatedAt: number }
export interface BotApplied { cfg: Partial<Record<BotKey, BotVal>>; paused: boolean; lossStreak: number; version: string }
export interface BotSeen { at: number; applied: BotApplied | null }

type Spec = { t: 'num'; lo: number; hi: number; dp: number } | { t: 'bool' } | { t: 'mode' } | { t: 'hours' } | { t: 'syms' };
export const BOT_SPEC: Record<BotKey, Spec> = {
  risk_mode: { t: 'mode' },
  risk_percent: { t: 'num', lo: 0.1, hi: 5, dp: 1 },
  risk_usdt: { t: 'num', lo: 0.5, hi: 500, dp: 2 },
  max_positions: { t: 'num', lo: 1, hi: 6, dp: 0 },
  max_buy_positions: { t: 'num', lo: 0, hi: 4, dp: 0 },
  buy_enabled: { t: 'bool' },
  mb_enabled: { t: 'bool' },
  max_mb_positions: { t: 'num', lo: 0, hi: 4, dp: 0 },
  lst_enabled: { t: 'bool' },
  max_lst_positions: { t: 'num', lo: 0, hi: 4, dp: 0 },
  bz_enabled: { t: 'bool' },
  max_bz_positions: { t: 'num', lo: 0, hi: 4, dp: 0 },
  stop_balance_usdt: { t: 'num', lo: 0, hi: 100000, dp: 0 },
  max_loss_streak: { t: 'num', lo: 0, hi: 30, dp: 0 },
  leverage_auto: { t: 'bool' },
  leverage: { t: 'num', lo: 1, hi: 20, dp: 0 },
  margin_isolated: { t: 'bool' },
  daily_summary: { t: 'bool' },
  summary_hours_kst: { t: 'hours' },
  exclude: { t: 'syms' },
};
export const BOT_KEYS = Object.keys(BOT_SPEC) as BotKey[];
export const DEFAULT_BOT_CONTROL: BotControl = { set: {}, paused: false, resetAt: 0, closeAllAt: 0, updatedAt: 0 };

const num = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : NaN);
export const SYM_RE = /^[A-Z0-9]{2,20}USDT$/;

/** one value checked against its spec; undefined = invalid / not set */
export function cleanBotVal(k: BotKey, v: unknown): BotVal | undefined {
  const s = BOT_SPEC[k];
  if (v == null) return undefined;
  if (s.t === 'num') {
    const x = num(v); if (!Number.isFinite(x)) return undefined;
    const f = 10 ** s.dp; return Math.round(Math.min(s.hi, Math.max(s.lo, x)) * f) / f;
  }
  if (s.t === 'bool') return typeof v === 'boolean' ? v : undefined;
  if (s.t === 'mode') return v === 'percent' || v === 'usdt' ? v : undefined;
  if (s.t === 'hours') {
    if (!Array.isArray(v)) return undefined;
    return [...new Set(v.map(num).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b).slice(0, 6);
  }
  if (!Array.isArray(v)) return undefined;
  return [...new Set(v.map((x) => String(x).toUpperCase().trim()).filter((x) => SYM_RE.test(x)))].slice(0, 40);
}

export function cleanBotControl(x: unknown, now = Date.now()): BotControl {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const raw = (o.set && typeof o.set === 'object' ? o.set : {}) as Record<string, unknown>;
  // first version of this card (15 Nov 2026) stored riskPercent / maxSell / maxBuy
  const legacy: Record<string, unknown> = { risk_percent: o.riskPercent, max_positions: o.maxSell, max_buy_positions: o.maxBuy };
  const set: BotControl['set'] = {};
  for (const k of BOT_KEYS) {
    const v = cleanBotVal(k, k in raw ? raw[k] : legacy[k]);
    if (v !== undefined) set[k] = v;
  }
  // BZ (Bollinger squeeze SELL) retired 19 Nov 2026: always sent OFF so the bot never opens BZ again,
  // even when the VPS config file still says bz_enabled = true. Open BZ positions finish on their own SL/TP.
  set.bz_enabled = false; set.max_bz_positions = 0;
  if (o.riskPercent != null && !('risk_mode' in raw) && set.risk_percent != null) set.risk_mode = 'percent';
  const t = (v: unknown) => (Number.isFinite(num(v)) && num(v) > 0 ? num(v) : 0);
  return { set, paused: o.paused === true, resetAt: t(o.resetAt), closeAllAt: t(o.closeAllAt), updatedAt: t(o.updatedAt) || now };
}

export function cleanApplied(x: unknown): BotApplied | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>, c = (o.cfg && typeof o.cfg === 'object' ? o.cfg : {}) as Record<string, unknown>;
  const cfg: BotApplied['cfg'] = {};
  for (const k of BOT_KEYS) { const v = cleanBotVal(k, c[k]); if (v !== undefined) cfg[k] = v; }
  return { cfg, paused: o.paused === true, lossStreak: Math.max(0, Math.round(num(o.lossStreak)) || 0), version: String(o.version ?? '').slice(0, 20) };
}

export interface BotLogEntry { at: number; items: string[] }
const LABELS: Record<BotKey, string> = {
  risk_mode: 'Cara risiko', risk_percent: 'Risiko', risk_usdt: 'Risiko USD', max_positions: 'Maks ALT', max_buy_positions: 'Maks BIG', buy_enabled: 'BIG', mb_enabled: 'MACD', max_mb_positions: 'Maks MACD', lst_enabled: 'LISTING', max_lst_positions: 'Maks LISTING', bz_enabled: 'BZ', max_bz_positions: 'Maks BZ',
  stop_balance_usdt: 'Rem saldo', max_loss_streak: 'Rem beruntun', leverage_auto: 'Leverage otomatis', leverage: 'Leverage', margin_isolated: 'Margin Isolated',
  daily_summary: 'Ringkasan', summary_hours_kst: 'Jam ringkasan', exclude: 'Koin dikecualikan',
};
export function showBotVal(k: BotKey, x: BotVal | undefined): string {
  if (x === undefined) return 'config VPS';
  if (typeof x === 'boolean') return x ? 'nyala' : 'mati';
  if (Array.isArray(x)) return x.length ? x.map(String).map((s) => (k === 'summary_hours_kst' ? `${s.padStart(2, '0')}:00` : s.replace(/USDT$/, ''))).join(', ') : 'tidak ada';
  if (k === 'risk_percent') return `${String(x).replace('.', ',')}%`;
  if (k === 'risk_usdt' || k === 'stop_balance_usdt') return `$${String(x).replace('.', ',')}`;
  if (k === 'risk_mode') return x === 'usdt' ? 'USD tetap' : '% saldo';
  if (k === 'leverage') return `${x}x`;
  return String(x);
}
/** human-readable list of what changed between two saved controls (for the history list) */
export function botChanges(prev: BotControl, next: BotControl): string[] {
  const out: string[] = [];
  if (prev.paused !== next.paused) out.push(next.paused ? 'Trading dijeda' : 'Trading dilanjutkan');
  for (const k of BOT_KEYS) {
    if (JSON.stringify(prev.set[k] ?? null) === JSON.stringify(next.set[k] ?? null)) continue;
    out.push(`${LABELS[k]}: ${showBotVal(k, prev.set[k])} → ${showBotVal(k, next.set[k])}`);
  }
  if (next.resetAt > prev.resetAt) out.push('Kalah beruntun di-nol-kan');
  if (next.closeAllAt > prev.closeAllAt) out.push('DARURAT: tutup semua posisi bot');
  return out;
}

