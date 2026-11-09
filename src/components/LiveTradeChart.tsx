'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Seg, Spinner } from './Status';
import type { Candle } from '@/lib/core/types';
import type { JournalTrade } from '@/lib/core/journal';

const CandleChart = dynamic(() => import('./CandleChart'), { ssr: false });

/* Chart of a live Binance trade (Trade → Riwayat detail), like the backtest trade review (9 Nov 2026).
 * Candles are read in the browser from Binance's public market data (futures, with the spot data mirror as fallback). */
const TF: Record<string, number> = { '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };
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
    // a long history: up to ~1200 candles before the entry and 300 after the exit (D1 = several years), loaded in pages of 1000
    const from = t.openedAt - 1200 * ms, to = Math.min(Date.now(), end + 300 * ms);
    const pages: Array<[number, number]> = [];
    for (let s0 = from; s0 < to; s0 += 1000 * ms) pages.push([s0, Math.min(to, s0 + 1000 * ms - 1)]);
    const qOf = (a: number, b: number) => `symbol=${encodeURIComponent(symbol)}&interval=${iv}&startTime=${a}&endTime=${b}&limit=1000`;
    const toCandle = (k: any[]) => ({ time: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]) } as Candle);
    const getPage = async (a: number, b: number): Promise<any[] | null> => {
      try {                                                                  // 1) the website's own proxy
        const r = await fetch(`/api/klines?${qOf(a, b)}`);
        const j = r.ok ? await r.json() : null;
        if (j && Array.isArray(j.candles)) return j.candles;
      } catch { /* fall back to Binance directly */ }
      for (const u of [`https://fapi.binance.com/fapi/v1/klines?${qOf(a, b)}`, `https://data-api.binance.vision/api/v3/klines?${qOf(a, b)}`]) {
        try { const r = await fetch(u); if (r.ok) { const rows = await r.json(); if (Array.isArray(rows)) return rows; } } catch { /* next */ }
      }
      return null;
    };
    (async () => {
      const all: Candle[] = [];
      for (const [a, b] of pages) {
        const rows = await getPage(a, b);
        if (rows) for (const k of rows) all.push(toCandle(k));
        if (off) return;
      }
      const seen = new Set<number>(), out = all.filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true))).sort((x, y) => x.time - y.time);
      if (out.length) setCandles(out); else setErr(true);
    })();
    return () => { off = true; };
  }, [symbol, t.openedAt, t.closedAt, iv]);
  return (
    <div className="stack" style={{ gap: 10 }}>
    <Seg full label="Timeframe" options={[['5m', 'M5'], ['15m', 'M15'], ['1h', 'H1'], ['4h', 'H4'], ['1d', 'D1']] as const} value={iv} onChange={(v) => setIv(v)} />
    <div className="chartbox trade-review-chart">
      {candles ? <CandleChart candles={candles} timezone={tz} fitKey={`${t.id}-${iv}`} position={{ side: t.side === 'BUY' ? 'long' : 'short', entry: t.openedAt, exit: t.closedAt ?? null, entryPrice: t.entry, stopLoss: t.sl, takeProfit: t.tp, exitPrice: t.exit ?? null } as any} />
        : err ? <div className="empty">Chart tidak bisa dimuat.</div> : <div className="empty"><Spinner /></div>}
    </div>
    </div>
  );
}
