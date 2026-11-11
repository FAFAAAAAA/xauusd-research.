'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { call, peek } from '@/components/client';
import { ErrorBox, Loading, PageHead } from '@/components/Status';
import type { OfficeData } from '@/components/Office';
import { OFFICE_LEGEND } from '@/components/Office';

const Office = dynamic(() => import('@/components/Office'), { ssr: false });
const usd = (n: number, sign = false) => `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Kantor: the bots and EA methods as office workers, following live data (journal + bot / EA balance reports). */
export default function KantorPage() {
  const [j, setJ] = useState<OfficeData | null>(() => peek<OfficeData>('/api/journal'));
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const load = () => call<OfficeData>('/api/journal').then(setJ).catch((e) => setErr(e.message));
    load();
    const a = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
    const b = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  if (err && !j) return <><PageHead title="Kantor" /><ErrorBox error={err} /></>;
  if (!j) return <><PageHead title="Kantor" /><Loading /></>;
  // next H4 candle close (00, 04, 08 … UTC): when ALT and BIG look for new signals
  const H4 = 4 * 3_600_000, left = H4 - (now % H4);
  const hh = Math.floor(left / 3_600_000), mm = Math.floor((left % 3_600_000) / 60_000), ss = Math.floor((left % 60_000) / 1000);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const pnlToday = j.trades.filter((t) => t.result !== 'open' && t.closedAt && t.closedAt >= today.getTime()).reduce((a, t) => a + Number(t.pnl ?? 0), 0);
  // open positions with their floating P&L (bot / EA reports)
  const open = j.trades.filter((t) => t.result === 'open');
  const coin = (t: any) => (/Bot Binance ([0-9A-Z]+)/.exec(t.note ?? '')?.[1] ?? '').replace(/USDT$/, '');
  const flo = (t: any) => (t.strategy === 'v2' ? j.mt5?.pos?.xau : t.strategy === 'nas' ? j.mt5?.pos?.nas : j.binance?.pos?.[`${coin(t)}USDT`]) ?? null;
  const openSum = open.reduce((a, t) => a + (flo(t) ?? 0), 0);
  const openTxt = open.length ? `${open.length}× ${usd(openSum, true)}` : '';
  return (
    <div className="stack">
      <PageHead title="Kantor" />
      <Office data={j} now={now} screen={[
        { k: 'BINANCE', v: j.binance ? usd(j.binance.wallet) : '—' },
        { k: 'MT5', v: j.mt5 ? usd(j.mt5.wallet) : '—' },
        { k: 'HARI INI', v: usd(pnlToday, true), color: pnlToday > 0 ? '#2ee59d' : pnlToday < 0 ? '#ff6b6b' : undefined },
        { k: 'POSISI', v: openTxt || 'tidak ada', color: openSum > 0 ? '#2ee59d' : openSum < 0 ? '#ff6b6b' : undefined },
        { k: 'SINYAL H4', v: `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` },
      ]} />
      <p className="mute small" style={{ margin: '0 4px' }}>{OFFICE_LEGEND}</p>
      <p className="mute small" style={{ margin: '0 4px' }}>Semua gerakan mengikuti data asli: posisi terbuka, laporan bot/EA, dan trade yang baru selesai (15 menit terakhir).</p>
    </div>
  );
}
