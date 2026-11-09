import { api } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Binance candles for the live-trade chart (Trade → Riwayat). Public market data; spot mirror first (not region-blocked), futures as fallback. */
const IV = new Set(['5m', '15m', '1h', '4h', '1d']);
export async function GET(req: Request) {
  return api(async () => {
    const u = new URL(req.url);
    const symbol = String(u.searchParams.get('symbol') ?? '').toUpperCase();
    const interval = String(u.searchParams.get('interval') ?? '');
    const start = Number(u.searchParams.get('startTime')), end = Number(u.searchParams.get('endTime'));
    if (!/^[0-9A-Z]{2,20}USDT$/.test(symbol) || !IV.has(interval) || !(start > 0) || !(end > start)) throw new HttpError(422, 'parameter tidak valid');
    const q = `symbol=${symbol}&interval=${interval}&startTime=${Math.floor(start)}&endTime=${Math.floor(end)}&limit=1000`;
    for (const base of ['https://data-api.binance.vision/api/v3/klines', 'https://fapi.binance.com/fapi/v1/klines']) {
      try {
        const r = await fetch(`${base}?${q}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length) return { candles: rows.map((k: any[]) => [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4])]) };
      } catch { /* next source */ }
    }
    throw new HttpError(502, 'Candle Binance tidak tersedia');
  });
}
