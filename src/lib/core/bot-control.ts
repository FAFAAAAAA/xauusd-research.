/**
 * Remote settings for the Binance bot. The website only stores WISHES; the bot on the VPS fetches them (every ~60 s),
 * clamps them again and applies them itself. The website never places, changes or closes an order.
 * null = "use the value in snr_bot_config.json on the VPS".
 */
export interface BotControl { riskPercent: number | null; maxSell: number | null; maxBuy: number | null; paused: boolean; updatedAt: number }
export interface BotApplied { riskMode: string; riskPercent: number; riskUsdt: number; maxSell: number; maxBuy: number; paused: boolean; version: string }
export interface BotSeen { at: number; applied: BotApplied | null }

export const BOT_LIMITS = { risk: [0.1, 5], sell: [1, 6], buy: [0, 4] } as const;
export const DEFAULT_BOT_CONTROL: BotControl = { riskPercent: null, maxSell: null, maxBuy: null, paused: false, updatedAt: 0 };

const n = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : NaN);
const clampOrNull = (x: unknown, [lo, hi]: readonly [number, number], step: number) => {
  const v = n(x);
  if (x == null || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, Math.round(v / step) * step));
};

export function cleanBotControl(x: unknown, now = Date.now()): BotControl {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  return {
    riskPercent: clampOrNull(o.riskPercent, BOT_LIMITS.risk, 0.1) == null ? null : Math.round(clampOrNull(o.riskPercent, BOT_LIMITS.risk, 0.1)! * 10) / 10,
    maxSell: clampOrNull(o.maxSell, BOT_LIMITS.sell, 1),
    maxBuy: clampOrNull(o.maxBuy, BOT_LIMITS.buy, 1),
    paused: o.paused === true,
    updatedAt: Number.isFinite(n(o.updatedAt)) && n(o.updatedAt) > 0 ? n(o.updatedAt) : now,
  };
}

export function cleanApplied(x: unknown): BotApplied | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>, f = (v: unknown) => (Number.isFinite(n(v)) ? n(v) : 0);
  return { riskMode: o.riskMode === 'usdt' ? 'usdt' : 'percent', riskPercent: f(o.riskPercent), riskUsdt: f(o.riskUsdt), maxSell: f(o.maxSell), maxBuy: f(o.maxBuy), paused: o.paused === true, version: String(o.version ?? '').slice(0, 20) };
}
