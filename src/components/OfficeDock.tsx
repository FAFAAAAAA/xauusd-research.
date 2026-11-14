'use client';
import { useEffect, useMemo, useState } from 'react';
import { call, peek } from '@/components/client';
import Office, { type OfficeData, type ScreenLine } from '@/components/Office';
import { useBtcDay } from '@/components/btcDay';


const usd = (n: number, sign = false) => `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const coinOf = (t: { note?: string | null }) => (/Bot Binance ([0-9A-Z]+)/.exec(t.note ?? '')?.[1] ?? '').replace(/USDT$/, '');

/** The virtual office on top of every page (stays mounted while switching pages).
 *  Journal every 30 s + Binance mark price every 3 s, so the wall TV and the floating P&L are realtime. */
export default function OfficeDock({ full = false, onSwipe }: { full?: boolean; onSwipe?: () => void } = {}) {
  const [j, setJ] = useState<OfficeData | null>(() => peek<OfficeData>('/api/journal'));
  const [now, setNow] = useState(() => Date.now());
  const [mark, setMark] = useState<Record<string, number>>({});
  const btc = useBtcDay()?.pct ?? null;      // Bitcoin % today, for the board next to the H4 countdown
  useEffect(() => {
    const load = () => call<OfficeData>('/api/journal').then(setJ).catch(() => {});
    load();
    const a = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
    const b = setInterval(() => setNow(Date.now()), 1000);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(a); clearInterval(b); document.removeEventListener('visibilitychange', vis); };
  }, []);
  // market watch for the office: gold (PAXG, a token that tracks the gold price) and BTC, % change over the last 15 minutes (every minute)
  const [market, setMarket] = useState<Array<{ name: string; move: number }>>([]);
  useEffect(() => {
    let off = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const got = await Promise.all([['EMAS', 'PAXGUSDT'], ['BTC', 'BTCUSDT']].map(async ([name, sym]) => {
        try {
          const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1m&limit=16`); if (!r.ok) return null;
          const k = await r.json() as Array<[number, string, string, string, string]>; if (!Array.isArray(k) || k.length < 16) return null;
          const a = Number(k[0][4]), b = Number(k[k.length - 1][4]);
          return a > 0 && b > 0 ? { name, move: ((b - a) / a) * 100 } : null;
        } catch { return null; }
      }));
      if (!off) setMarket(got.filter((x): x is { name: string; move: number } => !!x));
    };
    tick(); const id = window.setInterval(tick, 60_000);
    return () => { off = true; window.clearInterval(id); };
  }, []);
  // big US news coming up (CPI, FOMC, NFP…) for the countdown board in the lobby (every 30 minutes)
  const [cal, setCal] = useState<Array<{ title: string; at: number }>>([]);
  useEffect(() => {
    const load = () => call<{ events: Array<{ title: string; at: number }> }>('/api/office-cal').then((x) => setCal(x.events ?? [])).catch(() => {});
    load(); const id = window.setInterval(load, 30 * 60_000);
    return () => window.clearInterval(id);
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

  // iPhone app bug (iOS 26): the page gets a window one status-bar shorter than the screen (e.g. 793 of 852), and things pinned
  // to that window stop there, leaving a strip at the bottom. The page itself can still paint the whole screen, so in that case the
  // office is laid out in the page (not pinned) at the real screen height.
  useEffect(() => {
    if (!full) return;
    const root = document.documentElement;
    const set = () => {
      const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const portrait = window.innerHeight >= window.innerWidth;
      const scr = Math.max(window.screen.height, window.screen.width);
      // installed app, portrait: always the full screen height. iOS sometimes reports the full height and sometimes one status bar
      // less (after coming back from the background, opening a sheet…); switching between the two made the strip come and go.
      const tall = standalone && portrait;
      root.classList.toggle('app-tall', tall);
      if (tall) root.style.setProperty('--app-h', `${Math.max(scr, window.innerHeight)}px`); else root.style.removeProperty('--app-h');
    };
    set();
    const later = () => { set(); window.setTimeout(set, 250); window.setTimeout(set, 900); };
    window.addEventListener('resize', later); window.addEventListener('orientationchange', later); window.addEventListener('pageshow', later); document.addEventListener('visibilitychange', later);
    return () => {
      window.removeEventListener('resize', later); window.removeEventListener('orientationchange', later); window.removeEventListener('pageshow', later); document.removeEventListener('visibilitychange', later);
      root.classList.remove('app-tall'); root.style.removeProperty('--app-h');
    };
  }, [full]);
  const cls = full ? 'office-home' : 'office-dock';
  const View = (p: { data: OfficeData; screen: ScreenLine[] }) => <Office data={p.data} now={now} screen={p.screen} full={full} onSwipe={onSwipe} />;
  if (!j) return <div className={cls}>{View({ data: { trades: [], market, cal, btc }, screen: [] })}</div>;   // the building shows at once, people appear when the data arrives
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
  const data: OfficeData = { ...j, market, cal, btc, binance: j.binance ? { ...j.binance, pos: posB } : j.binance };
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
  return <div className={cls}>{View({ data, screen })}</div>;
}
