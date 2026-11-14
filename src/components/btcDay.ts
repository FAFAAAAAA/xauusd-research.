'use client';
import { useEffect, useState } from 'react';

/* Bitcoin's move today: % change from today's daily open (00:00 UTC = 09:00 Korea, the same day candle as Binance and
 * TradingView) to the latest price. One shared poll every 3 s for every component that shows it (office board, Trade page). */
export type BtcDay = { price: number; open: number; pct: number; at: number };

let cur: BtcDay | null = null;
const subs = new Set<(v: BtcDay | null) => void>();
let timer = 0;

async function poll() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  const q = 'symbol=BTCUSDT&interval=1d&limit=1';
  const rows = await Promise.any([
    fetch(`https://fapi.binance.com/fapi/v1/klines?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())),
    fetch(`https://data-api.binance.vision/api/v3/klines?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())),
  ]).catch(() => null);
  const k = Array.isArray(rows) ? rows[rows.length - 1] : null;
  const open = Number(k?.[1]), price = Number(k?.[4]);
  if (!(open > 0) || !(price > 0)) return;
  cur = { price, open, pct: ((price - open) / open) * 100, at: Date.now() };
  for (const f of subs) f(cur);
}

export function useBtcDay(): BtcDay | null {
  const [v, setV] = useState<BtcDay | null>(cur);
  useEffect(() => {
    subs.add(setV);
    if (subs.size === 1) { poll(); timer = window.setInterval(poll, 3000); }
    else if (cur) setV(cur);
    const vis = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', vis);
    return () => {
      subs.delete(setV); document.removeEventListener('visibilitychange', vis);
      if (!subs.size) { window.clearInterval(timer); timer = 0; }
    };
  }, []);
  return v;
}

export const pctText = (p: number) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(2)}%`;
