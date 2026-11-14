'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Seg, Spinner } from './Status';
import type { Candle } from '@/lib/core/types';

const CandleChart = dynamic(() => import('./CandleChart'), { ssr: false });

/* Bitcoin chart only (Trade page → tap "Bitcoin"): Binance BTCUSDT candles, newest candles refreshed every 5 s. */
const IV = [['15m', 'M15'], ['1h', 'H1'], ['4h', 'H4'], ['1d', 'D1'], ['1w', 'W1']] as const;
type Iv = (typeof IV)[number][0];
const toCandle = (k: any[]) => ({ time: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]) } as Candle);
const get = (q: string) => Promise.any([
  fetch(`https://fapi.binance.com/fapi/v1/klines?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())),
  fetch(`/api/klines?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => j?.candles ?? Promise.reject()),
  fetch(`https://data-api.binance.vision/api/v3/klines?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())),
]).then((rows) => (Array.isArray(rows) ? rows.map(toCandle) : null)).catch(() => null);

export default function BtcChart({ tz }: { tz: string }) {
  const [iv, setIv] = useState<Iv>('1h');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let off = false; setCandles(null); setErr(false);
    get(`symbol=BTCUSDT&interval=${iv}&limit=500`).then((c) => { if (off) return; if (c && c.length) setCandles(c); else setErr(true); });
    const id = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const fresh = await get(`symbol=BTCUSDT&interval=${iv}&limit=2`);
      if (off || !fresh) return;
      setCandles((cur) => { if (!cur) return cur; const m = new Map(cur.map((c) => [c.time, c] as const)); for (const c of fresh) m.set(c.time, c); return [...m.values()].sort((a, b) => a.time - b.time); });
    }, 5000);
    return () => { off = true; window.clearInterval(id); };
  }, [iv]);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <Seg label="Timeframe" options={IV} value={iv} onChange={(v) => setIv(v)} />
      <div className="chartbox trade-review-chart">
        {candles ? <CandleChart candles={candles} timezone={tz} fitKey={`btc-${iv}`} /> : err ? <div className="mute small" style={{ padding: 20 }}>Chart tidak bisa dimuat.</div> : <div style={{ padding: 20 }}><Spinner /></div>}
      </div>
    </div>
  );
}
