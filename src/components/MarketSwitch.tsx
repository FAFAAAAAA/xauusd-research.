'use client';
import { useEffect, useState } from 'react';
import { Seg } from '@/components/Status';
import { MARKETS, type Market } from '@/lib/core/markets';

/* Forex (MT5) | Crypto (Binance) switch shared by every page. The choice is a per-browser convenience (localStorage, guarded),
 * kept in sync between components on the same page through a window event. */
const KEY = 'market';
const EVT = 'market-change';
function read(): Market {
  try { const v = localStorage.getItem(KEY); return v === 'crypto' ? 'crypto' : 'forex'; } catch { return 'forex'; }
}
export function useMarket(): [Market, (m: Market) => void] {
  const [m, setM] = useState<Market>('forex');
  useEffect(() => {
    setM(read());
    const on = () => setM(read());
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  const set = (v: Market) => {
    try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
    setM(v); window.dispatchEvent(new Event(EVT));
  };
  return [m, set];
}
export function MarketSwitch({ value, onChange }: { value: Market; onChange: (m: Market) => void }) {
  return <Seg full label="Pasar" options={MARKETS} value={value} onChange={onChange} />;
}
