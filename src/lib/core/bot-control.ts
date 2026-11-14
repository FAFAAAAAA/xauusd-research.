/**
 * Remote settings for the Binance bot (Atur → Kontrol bot). The website only stores WISHES; the bot on the VPS fetches them
 * (every ~60 s), clamps them again and applies them itself. The website never places, changes or closes an order.
 * A key missing from `set` = "use the value in snr_bot_config.json on the VPS".
 * Secrets and account switches (API key, testnet, dry_run, report key) are NOT remote on purpose: they stay on the VPS.
 */
export type BotKey =
  | 'risk_mode' | 'risk_percent' | 'risk_usdt' | 'max_positions' | 'max_buy_positions' | 'buy_enabled'
  | 'stop_balance_usdt' | 'max_loss_streak' | 'leverage_auto' | 'leverage' | 'margin_isolated'
  | 'daily_summary' | 'summary_hours_kst' | 'exclude';
export type BotVal = number | boolean | string | number[] | string[];
export interface BotControl { set: Partial<Record<BotKey, BotVal>>; paused: boolean; resetAt: number; updatedAt: number }
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
export const DEFAULT_BOT_CONTROL: BotControl = { set: {}, paused: false, resetAt: 0, updatedAt: 0 };

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
  if (o.riskPercent != null && !('risk_mode' in raw) && set.risk_percent != null) set.risk_mode = 'percent';
  const t = (v: unknown) => (Number.isFinite(num(v)) && num(v) > 0 ? num(v) : 0);
  return { set, paused: o.paused === true, resetAt: t(o.resetAt), updatedAt: t(o.updatedAt) || now };
}

export function cleanApplied(x: unknown): BotApplied | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>, c = (o.cfg && typeof o.cfg === 'object' ? o.cfg : {}) as Record<string, unknown>;
  const cfg: BotApplied['cfg'] = {};
  for (const k of BOT_KEYS) { const v = cleanBotVal(k, c[k]); if (v !== undefined) cfg[k] = v; }
  return { cfg, paused: o.paused === true, lossStreak: Math.max(0, Math.round(num(o.lossStreak)) || 0), version: String(o.version ?? '').slice(0, 20) };
}
