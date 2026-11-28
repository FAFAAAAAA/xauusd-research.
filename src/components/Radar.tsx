'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { SecHead, Seg, Sheet, Spinner } from './Status';
import type { Candle } from '@/lib/core/types';
import type { ChartLevel } from './CandleChart';

const CandleChart = dynamic(() => import('./CandleChart'), { ssr: false });

/* Radar (29 Nov 2026, Trade page under "Posisi terbuka"): coins close to a bot signal, from /api/radar (bot rules on public
 * Binance data, levels rebuilt every H4 close, live price each minute). Tap a coin: chart with the signal's lines. Read only. */
interface Item { sym: string; strat: 'snr' | 'btc' | 'mb' | 'lst'; side: 'BUY' | 'SELL'; level: number; trigger: number; sl: number; tp: number; atr: number; note: string; at?: number; price: number | null; dist: number | null; status: string }
interface View { bar: number; builtAt: number; items: Item[]; btcUp: boolean; btcDrop: number | null }
const NAME = { snr: 'ALT', btc: 'BIG', mb: 'MACD', lst: 'LISTING' } as const;
const TFS = [['15m', 'M15'], ['1h', 'H1'], ['4h', 'H4'], ['1d', 'D1']] as const;
type Iv = (typeof TFS)[number][0];
const toCandle = (k: any[]) => ({ time: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: k[5] != null ? Number(k[5]) : null } as Candle);
const fetchK = (sym: string, iv: string, limit: number) => Promise.any([
  fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=${limit}`).then((r) => (r.ok ? r.json() : Promise.reject())),
  fetch(`/api/klines?symbol=${sym}&interval=${iv}&startTime=${Date.now() - limit * ({ '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 } as Record<string, number>)[iv]}&endTime=${Date.now()}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => j?.candles ?? Promise.reject()),
]).then((rows) => (Array.isArray(rows) ? rows.map(toCandle) : null)).catch(() => null);

const coin = (s: string) => s.replace(/USDT$/, '');
/** how close a coin is to its signal, 0..1 (1 = the level is already passed, waiting for the candle close) */
const closeness = (it: Item) => {
  if (it.strat === 'lst') return it.at ? Math.min(1, Math.max(0, 1 - (it.at - Date.now()) / (24 * 36e5))) : 0;   // share of the 24 h wait gone
  if (it.strat === 'mb') return 0.5;                                    // first of the two MACD valleys is there
  return it.dist == null ? 0 : Math.min(1, Math.max(0, 1 - it.dist));   // 1 ATR away = empty ring, at the level = full
};
const passed = (it: Item) => (it.strat === 'snr' || it.strat === 'btc') && it.dist != null && it.dist <= 0;
const sayClose = (it: Item) => (passed(it) ? 'sudah lolos level, tunggu candle tutup' : it.strat === 'mb' ? 'lembah MACD 1 dari 2' : it.strat === 'lst' ? 'menunggu 24 jam setelah listing' : `${Math.round(closeness(it) * 100)}% menuju level`);
/** ring gauge: fills up as the price comes closer; full ring with a check = level passed */
function Gauge({ it }: { it: Item }) {
  const r = 11, C = 2 * Math.PI * r, f = closeness(it), done = passed(it);
  return <span className="rd-gauge" role="img" aria-label={sayClose(it)} title={sayClose(it)}>
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden>
      <circle cx="14" cy="14" r={r} fill={done ? 'currentColor' : 'none'} stroke="currentColor" strokeOpacity={done ? 1 : 0.18} strokeWidth="3" />
      {done ? <path d="M9 14.5l3.2 3.2L19 11" fill="none" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        : <circle cx="14" cy="14" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${Math.max(0.01, f) * C} ${C}`} transform="rotate(-90 14 14)" />}
    </svg>
  </span>;
}

function RadarChart({ it, tz }: { it: Item; tz: string }) {
  const [iv, setIv] = useState<Iv>(it.strat === 'lst' ? '1h' : '4h');
  const [data, setData] = useState<{ iv: Iv; candles: Candle[] } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let off = false; setErr(false);
    fetchK(it.sym, iv, 500).then((c) => { if (off) return; if (c && c.length) setData({ iv, candles: c }); else setErr(true); });
    const id = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const fresh = await fetchK(it.sym, iv, 2); if (off || !fresh) return;
      setData((cur) => { if (!cur || cur.iv !== iv) return cur; const m = new Map(cur.candles.map((c) => [c.time, c] as const)); for (const c of fresh) m.set(c.time, c); return { iv, candles: [...m.values()].sort((a, b) => a.time - b.time) }; });
    }, 8000);
    return () => { off = true; window.clearInterval(id); };
  }, [it.sym, iv]);
  // lines only, no words: the price label on the right axis carries the colour (grey = level / entry, red = SL, green = TP)
  const levels = useMemo<ChartLevel[]>(() => {
    const L: ChartLevel[] = [];
    if (it.strat === 'snr') L.push({ price: it.level, title: '', color: '#5f6873', width: 3 });
    if (it.strat === 'btc') { L.push({ price: it.level, title: '', color: '#87909c', dashed: true, width: 2 }); L.push({ price: it.trigger, title: '', color: '#5f6873', width: 3 }); }
    if (it.strat === 'mb') { L.push({ price: it.level, title: '', color: '#87909c', dashed: true, width: 2 }); L.push({ price: it.trigger, title: '', color: '#5f6873', width: 2 }); }
    if (it.strat === 'lst') L.push({ price: it.trigger, title: '', color: '#5f6873', width: 2 });
    L.push({ price: it.sl, title: '', color: '#cf6674', width: 2 }, { price: it.tp, title: '', color: '#389b78', width: 2 });
    return L;
  }, [it]);
  return <div className="stack" style={{ gap: 10 }}>
    <Seg scroll label="Timeframe" options={TFS} value={iv} onChange={(v) => setIv(v)} />
    <div className="chartbox trade-review-chart">
      {data ? <CandleChart candles={data.candles} timezone={tz} fitKey={`radar-${it.sym}-${data.iv}`} drawKey={it.sym} initialBars={90} levels={levels} tf={{ options: TFS, value: iv, onChange: setIv }} />
        : err ? <div className="empty">Chart tidak bisa dimuat.</div> : <div className="empty"><Spinner /></div>}
      {data && data.iv !== iv && !err ? <div className="cv-loading"><Spinner /></div> : null}
    </div>
  </div>;
}

export default function Radar({ tz }: { tz: string }) {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState<Item | null>(null);
  useEffect(() => {
    let off = false;
    const load = async () => {
      if (document.visibilityState !== 'visible' && v) return;
      try { const r = await fetch('/api/radar'); const j = await r.json(); if (off) return; if (j?.ok) { setV(j.data); setErr(false); } else setErr(true); } catch { if (!off) setErr(true); }
    };
    load(); const id = window.setInterval(load, 60_000);
    return () => { off = true; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <section className="group">
    <SecHead title="👀 Radar" />
    <p className="small mute rd-key">Lingkaran makin penuh = makin dekat. Centang = sudah lolos, tunggu candle tutup.</p>
    {!v ? (err ? <p className="small mute">Radar belum bisa dimuat.</p> : <div style={{ padding: 12 }}><Spinner /></div>)
      : !v.items.length ? <p className="small mute">Belum ada koin yang dekat sinyal.</p>
      : <div className="hcards">
        {v.items.map((it) => (
          <button key={`${it.strat}-${it.sym}`} className="hcard opencard" onClick={() => setOpen(it)}>
            <span className={`hc-side op-badge ${it.side === 'BUY' ? 'b' : 's'}`}>{it.side === 'BUY' ? 'B' : 'S'}</span>
            <span className="op-left"><strong className="hc-name">{coin(it.sym)}</strong><span className="op-strat">{NAME[it.strat]}{it.strat === 'snr' && v.btcDrop != null && v.btcDrop < -0.04 ? ' · ditahan' : ''}</span></span>
            <span className="op-pnl"><Gauge it={it} /></span>
          </button>
        ))}
      </div>}
    {/* the sheet lives outside the card (portal): a chart inside the card switched the card's :has() styles on and off -> a laggy flash on close */}
    {open ? createPortal(<Sheet title={`${coin(open.sym)} · ${NAME[open.strat]} ${open.side === 'BUY' ? 'Buy' : 'Sell'}`} onClose={() => setOpen(null)}><div className="dt-sheet"><RadarChart it={open} tz={tz} /></div></Sheet>, (document.querySelector('.apple-shell') as HTMLElement | null) ?? document.body) : null}
  </section>;
}
