'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Seg, Spinner } from './Status';
import type { Candle } from '@/lib/core/types';

const CandleChart = dynamic(() => import('./CandleChart'), { ssr: false });

/* Bitcoin chart only (Trade page → tap "Bitcoin"): Binance BTCUSDT candles, newest candles refreshed every 5 s. */
const IV = [['1m', 'M1'], ['5m', 'M5'], ['15m', 'M15'], ['30m', 'M30'], ['1h', 'H1'], ['4h', 'H4'], ['1d', 'D1'], ['1w', 'W1']] as const;
type Iv = (typeof IV)[number][0];
const toCandle = (k: any[]) => ({ time: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: k[5] != null ? Number(k[5]) : null } as Candle);
const get = (q: string) => Promise.any([
  fetch(`https://fapi.binance.com/fapi/v1/klines?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())),
  fetch(`/api/klines?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => j?.candles ?? Promise.reject()),
  fetch(`https://data-api.binance.vision/api/v3/klines?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())),
]).then((rows) => (Array.isArray(rows) ? rows.map(toCandle) : null)).catch(() => null);

export default function BtcChart({ tz }: { tz: string }) {
  const [iv, setIv] = useState<Iv>('1h');
  // candles with their timeframe: the chart stays mounted while another timeframe loads (keeps full screen and drawings)
  const [data, setData] = useState<{ iv: Iv; candles: Candle[] } | null>(null);
  const candles = data?.candles ?? null;
  const [err, setErr] = useState(false);
  useEffect(() => {
    let off = false; setErr(false);
    get(`symbol=BTCUSDT&interval=${iv}&limit=1000`).then((c) => { if (off) return; if (c && c.length) setData({ iv, candles: c }); else setErr(true); });
    const id = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const fresh = await get(`symbol=BTCUSDT&interval=${iv}&limit=2`);
      if (off || !fresh) return;
      setData((cur) => { if (!cur || cur.iv !== iv) return cur; const m = new Map(cur.candles.map((c) => [c.time, c] as const)); for (const c of fresh) m.set(c.time, c); return { iv, candles: [...m.values()].sort((a, b) => a.time - b.time) }; });
    }, 5000);
    return () => { off = true; window.clearInterval(id); };
  }, [iv]);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <Seg scroll label="Timeframe" options={IV} value={iv} onChange={(v) => setIv(v)} />
      <div className="chartbox trade-review-chart">
        {candles && data ? <CandleChart candles={candles} timezone={tz} fitKey={`btc-${data.iv}`} drawKey="BTCUSDT" initialBars={80} tf={{ options: IV, value: iv, onChange: setIv }} /> : err ? <div className="mute small" style={{ padding: 20 }}>Chart tidak bisa dimuat.</div> : <div style={{ padding: 20 }}><Spinner /></div>}
        {data && data.iv !== iv && !err ? <div className="cv-loading" aria-live="polite"><Spinner /></div> : null}
      </div>
    </div>
  );
}
