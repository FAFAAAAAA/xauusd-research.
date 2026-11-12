'use client';
import { useEffect, useMemo, useState } from 'react';
import { call, peek } from '@/components/client';
import Office, { type OfficeData, type ScreenLine } from '@/components/Office';

const usd = (n: number, sign = false) => `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const coinOf = (t: { note?: string | null }) => (/Bot Binance ([0-9A-Z]+)/.exec(t.note ?? '')?.[1] ?? '').replace(/USDT$/, '');

/** The virtual office on top of every page (stays mounted while switching pages).
 *  Journal every 30 s + Binance mark price every 3 s, so the wall TV and the floating P&L are realtime. */
export default function OfficeDock({ full = false, onSwipe }: { full?: boolean; onSwipe?: () => void } = {}) {
  const [j, setJ] = useState<OfficeData | null>(() => peek<OfficeData>('/api/journal'));
  const [now, setNow] = useState(() => Date.now());
  const [mark, setMark] = useState<Record<string, number>>({});
  useEffect(() => {
    const load = () => call<OfficeData>('/api/journal').then(setJ).catch(() => {});
    load();
    const a = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
    const b = setInterval(() => setNow(Date.now()), 1000);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(a); clearInterval(b); document.removeEventListener('visibilitychange', vis); };
  }, []);
  const open = useMemo(() => (j?.trades ?? []).filter((t) => t.result === 'open'), [j]);
  const syms = open.filter((t) => t.strategy !== 'v2' && t.strategy !== 'nas' && coinOf(t)).map((t) => `${coinOf(t)}USDT`).filter((x, i, a) => a.indexOf(x) === i).sort().join(',');
  useEffect(() => {
    if (!syms) return;
    let off = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const got: Record<string, number> = {};
      await Promise.all(syms.split(',').map(async (sym) => {
        const p = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`).then((r) => (r.ok ? r.json() : null)).then((x) => Number(x?.markPrice))
          .catch(() => fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${sym}`).then((r) => (r.ok ? r.json() : null)).then((x) => Number(x?.price)).catch(() => NaN));
        if (Number.isFinite(p) && p > 0) got[sym] = p;
      }));
      if (!off && Object.keys(got).length) setMark((m) => ({ ...m, ...got }));
    };
    tick(); const id = window.setInterval(tick, 3000);
    return () => { off = true; window.clearInterval(id); };
  }, [syms]);

  const cls = full ? 'office-home' : 'office-dock';
  if (!j) return <div className={cls}><Office data={{ trades: [] }} now={now} screen={[]} full={full} onSwipe={onSwipe} /></div>;   // the building shows at once, people appear when the data arrives
  // realtime floating P&L per crypto position from the mark price (falls back to the bot report)
  const posB: Record<string, number> = { ...(j.binance?.pos ?? {}) };
  let floatB = 0, liveB = false;
  const seen = new Set<string>();
  for (const t of open) {
    if (t.strategy === 'v2' || t.strategy === 'nas') continue;
    const sym = `${coinOf(t)}USDT`, mp = mark[sym], lot = Number(t.lot), entry = Number(t.entry);
    if (!mp || !(lot > 0) || !(entry > 0)) continue;
    if (!seen.has(sym)) { seen.add(sym); posB[sym] = 0; }
    posB[sym] += (t.side === 'BUY' ? 1 : -1) * (mp - entry) * lot; liveB = true;
  }
  for (const v of Object.values(posB)) floatB += v;
  if (!liveB && j.binance) floatB = j.binance.upnl ?? floatB;
  const floatM = j.mt5?.upnl ?? 0;
  const data: OfficeData = { ...j, binance: j.binance ? { ...j.binance, pos: posB } : j.binance };
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const closedToday = j.trades.filter((t) => t.result !== 'open' && t.closedAt && t.closedAt >= today.getTime());
  const isMt5 = (t: { strategy: string }) => t.strategy === 'v2' || t.strategy === 'nas';
  const todayB = closedToday.filter((t) => !isMt5(t)).reduce((a, t) => a + Number(t.pnl ?? 0), 0);
  const fl = floatB + floatM;
  const tone = (n: number) => (n > 0 ? '#2ee59d' : n < 0 ? '#ff6b6b' : undefined);
  const screen: ScreenLine[] = [
    { k: 'BINANCE', v: j.binance ? usd(j.binance.wallet + floatB) : '—' },
    { k: 'MT5', v: j.mt5 ? usd(j.mt5.wallet + floatM) : '—' },
    { k: 'PNL HARI INI', v: usd(todayB, true), color: tone(todayB) },
    { k: 'FLOATING', v: open.length ? `${open.length}× ${usd(fl, true)}` : 'tidak ada', color: open.length ? tone(fl) : undefined },
  ];
  return <div className={cls}><Office data={data} now={now} screen={screen} full={full} onSwipe={onSwipe} /></div>;
}
