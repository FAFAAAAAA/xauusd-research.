'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Seg, Spinner } from './Status';
import type { Candle } from '@/lib/core/types';
import type { JournalTrade } from '@/lib/core/journal';

const CandleChart = dynamic(() => import('./CandleChart'), { ssr: false });

/* Chart of a live Binance trade (Trade → Riwayat detail), like the backtest trade review (9 Nov 2026).
 * Candles are read in the browser from Binance's public market data (futures, with the spot data mirror as fallback). */
const TF: Record<string, number> = { '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
const auto = (ms: number) => (ms < 6 * 3_600_000 ? '5m' : ms < 2 * 86_400_000 ? '15m' : ms < 7 * 86_400_000 ? '1h' : '4h');

export default function LiveTradeChart({ symbol, t, tz }: { symbol: string; t: JournalTrade; tz: string }) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [err, setErr] = useState(false);
  const [iv, setIv] = useState(() => auto((t.closedAt ?? Date.now()) - t.openedAt));
  useEffect(() => {
    let off = false;
    setCandles(null); setErr(false);
    const end = t.closedAt ?? Date.now();
    const ms = TF[iv];
    const from = t.openedAt - 40 * ms, to = Math.min(Date.now(), end + 20 * ms);
    const q = `symbol=${encodeURIComponent(symbol)}&interval=${iv}&startTime=${from}&endTime=${to}&limit=1000`;
    const urls = [`https://fapi.binance.com/fapi/v1/klines?${q}`, `https://data-api.binance.vision/api/v3/klines?${q}`];
    (async () => {
      try {                                                                  // 1) the website's own proxy
        const r = await fetch(`/api/klines?${q}`);
        const j = r.ok ? await r.json() : null;
        if (j && Array.isArray(j.candles) && j.candles.length) {
          if (!off) setCandles(j.candles.map((k: number[]) => ({ time: k[0], open: k[1], high: k[2], low: k[3], close: k[4] } as Candle)));
          return;
        }
      } catch { /* fall back to Binance directly */ }
      for (const u of urls) {                                                // 2) Binance directly from the browser
        try {
          const r = await fetch(u);
          if (!r.ok) continue;
          const rows = (await r.json()) as any[];
          if (!Array.isArray(rows) || !rows.length) continue;
          if (!off) setCandles(rows.map((k) => ({ time: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) } as Candle)));
          return;
        } catch { /* try the next source */ }
      }
      if (!off) setErr(true);
    })();
    return () => { off = true; };
  }, [symbol, t.openedAt, t.closedAt, iv]);
  return (
    <div className="stack" style={{ gap: 10 }}>
    <Seg full label="Timeframe" options={[['5m', 'M5'], ['15m', 'M15'], ['1h', 'H1'], ['4h', 'H4']] as const} value={iv} onChange={(v) => setIv(v)} />
    <div className="chartbox trade-review-chart">
      {candles ? <CandleChart candles={candles} timezone={tz} fitKey={`${t.id}-${iv}`} position={{ side: t.side === 'BUY' ? 'long' : 'short', entry: t.openedAt, exit: t.closedAt ?? null, entryPrice: t.entry, stopLoss: t.sl, takeProfit: t.tp, exitPrice: t.exit ?? null } as any} />
        : err ? <div className="empty">Chart tidak bisa dimuat.</div> : <div className="empty"><Spinner /></div>}
    </div>
    </div>
  );
}
