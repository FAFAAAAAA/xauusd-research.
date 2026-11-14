'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, peek } from './client';
import { Loading, Spinner, toast } from './Status';
import { BOT_KEYS, SYM_RE, type BotKey, type BotVal } from '@/lib/core/bot-control';

/* eslint-disable @typescript-eslint/no-explicit-any */

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} dtk lalu` : s < 3600 ? `${Math.round(s / 60)} mnt lalu` : s < 86400 ? `${Math.round(s / 3600)} jam lalu` : `${Math.round(s / 86400)} hari lalu`;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const nf = (x: number) => String(x).replace('.', ',');

/**
 * Remote settings for the Binance bot. The bot fetches them every ~60 s and applies them itself (no order is ever sent from here).
 * A setting that was never changed here keeps the value from snr_bot_config.json on the VPS ("config VPS").
 */
export function BotControlCard() {
  const [d, setD] = useState<any>(() => peek('/api/bot-control'));
  const [set, setSet] = useState<Partial<Record<BotKey, BotVal>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<string | null>(null);
  const [sym, setSym] = useState('');
  const load = useCallback(() => call<any>('/api/bot-control').then((x) => { setD(x); setNow(Date.now()); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  const c = d?.control, seen = d?.seen, ap = seen?.applied;
  useEffect(() => { if (c && !set) setSet({ ...c.set }); }, [c, set]);
  if (!d || !set) return <div className="bc"><div className="bc-top"><b>Kontrol bot</b></div><Loading what="kontrol bot" /></div>;

  const online = !!seen && now - seen.at < 5 * 60_000;
  const v = <T extends BotVal>(k: BotKey, dflt: T): T => (set[k] ?? ap?.cfg?.[k] ?? dflt) as T;
  const mine = (k: BotKey) => k in set;
  const put = (k: BotKey, x: BotVal) => setSet({ ...set, [k]: x });
  const dirty = BOT_KEYS.some((k) => !same(set[k], c.set[k]));
  const pending = !dirty && ap && c.updatedAt > seen.at;
  const send = async (body: any, msg = 'Terkirim — bot memakai setelan baru dalam ±1 menit') => {
    setBusy(true); setErr(null);
    try { const r = await call<any>('/api/bot-control', { method: 'PUT', json: body }); setD(r); toast(msg); return r; }
    catch (e) { setErr((e as Error).message); return null; } finally { setBusy(false); }
  };
  const save = async () => { const r = await send({ ...c, set }); if (r) setSet({ ...r.control.set }); };

  const Hint = ({ k }: { k: BotKey }) => (mine(k) ? null : <small>config VPS</small>);
  const Step = ({ k, label, unit = '', by, lo, hi, dp = 0, dflt }: { k: BotKey; label: string; unit?: string; by: number; lo: number; hi: number; dp?: number; dflt: number }) => {
    const x = v<number>(k, dflt), f = 10 ** dp;
    const go = (dx: number) => put(k, Math.round(Math.min(hi, Math.max(lo, x + dx)) * f) / f);
    return (
      <div className="bc-row">
        <span className="bc-l">{label}<Hint k={k} /></span>
        <span className="bc-step">
          <button type="button" aria-label="Kurangi" onClick={() => go(-by)}>−</button>
          <b>{unit === '$' ? `$${nf(x)}` : `${nf(x)}${unit}`}</b>
          <button type="button" aria-label="Tambah" onClick={() => go(by)}>+</button>
        </span>
      </div>
    );
  };
  const Toggle = ({ k, label, sub, dflt }: { k: BotKey; label: string; sub?: string; dflt: boolean }) => {
    const on = v<boolean>(k, dflt);
    return (
      <button type="button" className="bc-row bc-tog" role="switch" aria-checked={on} onClick={() => put(k, !on)}>
        <span className="bc-l">{label}{sub ? <small>{sub}</small> : <Hint k={k} />}</span><i className={`co-tg ${on ? 'on' : ''}`} />
      </button>
    );
  };
  const Sec = ({ id, title, sum, children }: { id: string; title: string; sum: string; children: React.ReactNode }) => (
    <div className={`bc-sec ${open === id ? 'open' : ''}`}>
      <button type="button" className="bc-sh" onClick={() => setOpen(open === id ? null : id)}><b>{title}</b><span>{sum}</span><em>›</em></button>
      {open === id ? <div className="bc-card">{children}</div> : null}
    </div>
  );

  const mode = v<string>('risk_mode', 'percent');
  const riskSum = mode === 'usdt' ? `$${nf(v<number>('risk_usdt', 5))} per trade` : `${nf(v<number>('risk_percent', 1))}% saldo per trade`;
  const stopBal = v<number>('stop_balance_usdt', 0), streak = v<number>('max_loss_streak', 7), ls = ap?.lossStreak ?? 0;
  const lev = v<boolean>('leverage_auto', true);
  const hours = v<number[]>('summary_hours_kst', [8, 23]);
  const excl = v<string[]>('exclude', []);
  const addSym = () => {
    let s = sym.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (s && !s.endsWith('USDT')) s += 'USDT';
    if (!SYM_RE.test(s)) { setErr('Nama koin tidak valid, contoh: ARB atau ARBUSDT'); return; }
    setErr(null); put('exclude', [...new Set([...excl, s])]); setSym('');
  };

  return (
    <div className="bc">
      <div className="bc-top">
        <b>Kontrol bot</b>
        <span className={`bc-dot ${online ? (ap?.paused ? 'pause' : 'on') : 'off'}`}>{online ? (ap?.paused ? 'Jeda' : 'Aktif') : seen ? 'Tidak ada kabar' : 'Belum terhubung'}</span>
      </div>
      <p className="bc-sub">{seen ? `Bot cek ${ago(now - seen.at)}${ap?.version ? ` · versi ${ap.version}` : ''}` : 'Ganti snr_bot.py di VPS dengan versi terbaru agar bot bisa diatur dari sini.'}</p>

      <button type="button" className={`bc-pause ${c.paused ? 'is' : ''}`} role="switch" aria-checked={!c.paused} disabled={busy} onClick={() => send({ ...c, paused: !c.paused }, c.paused ? 'Trading dilanjutkan' : 'Trading dijeda')}>
        <span><b>{c.paused ? 'Trading dijeda' : 'Trading berjalan'}</b><small>{c.paused ? 'Tidak buka posisi baru. Posisi terbuka tetap jalan dengan SL/TP.' : 'Bot boleh membuka posisi baru.'}</small></span>
        <i className={`co-tg ${c.paused ? '' : 'on'}`} />
      </button>

      <Sec id="risk" title="Risiko" sum={riskSum}>
        <div className="bc-row"><span className="bc-l">Cara hitung<Hint k="risk_mode" /></span>
          <span className="bc-seg">{(['percent', 'usdt'] as const).map((m) => <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => put('risk_mode', m)}>{m === 'percent' ? '% saldo' : 'USD tetap'}</button>)}</span></div>
        {mode === 'percent'
          ? <Step k="risk_percent" label="Risiko per trade" unit="%" by={0.5} lo={0.5} hi={5} dp={1} dflt={1} />
          : <Step k="risk_usdt" label="Risiko per trade" unit="$" by={1} lo={1} hi={500} dflt={5} />}
      </Sec>

      <Sec id="pos" title="Posisi" sum={`${v<number>('max_positions', 3)} SELL · ${v<boolean>('buy_enabled', true) ? `${v<number>('max_buy_positions', 2)} BUY` : 'BUY mati'}`}>
        <Step k="max_positions" label="Maks posisi SELL" by={1} lo={1} hi={6} dflt={3} />
        <Toggle k="buy_enabled" label="BUY (BTC, ETH, SOL, …)" dflt />
        {v<boolean>('buy_enabled', true) ? <Step k="max_buy_positions" label="Maks posisi BUY" by={1} lo={0} hi={4} dflt={2} /> : null}
      </Sec>

      <Sec id="brake" title="Rem" sum={`${stopBal > 0 ? `saldo < $${stopBal}` : 'saldo mati'} · ${streak > 0 ? `${streak} SL beruntun` : 'beruntun mati'}`}>
        <Step k="stop_balance_usdt" label="Rem saldo" unit="$" by={10} lo={0} hi={100000} dflt={0} />
        <Step k="max_loss_streak" label="Rem beruntun" unit=" SL" by={1} lo={0} hi={30} dflt={7} />
        <div className="bc-row"><span className="bc-l">Kalah beruntun<small>{streak > 0 && ls >= streak ? 'REM AKTIF — bot tidak buka posisi baru' : `dari ${streak || '—'}`}</small></span>
          <span className="bc-step"><b className={streak > 0 && ls >= streak ? 'dn' : ''}>{ls}</b>
            <button type="button" className="bc-mini" disabled={busy || !ls} onClick={() => send({ ...c, reset: true }, 'Reset dikirim — bot menghitung dari 0 lagi')}>Reset</button></span></div>
      </Sec>

      <Sec id="lev" title="Leverage & margin" sum={`${lev ? 'otomatis' : `${v<number>('leverage', 5)}x`} · ${v<boolean>('margin_isolated', true) ? 'Isolated' : 'Cross'}`}>
        <Toggle k="leverage_auto" label="Leverage otomatis" sub={mine('leverage_auto') ? '0,5 / jarak SL, maks 20x' : 'config VPS'} dflt />
        {!lev ? <Step k="leverage" label="Leverage tetap" unit="x" by={1} lo={1} hi={20} dflt={5} /> : null}
        <Toggle k="margin_isolated" label="Margin Isolated" sub={mine('margin_isolated') ? 'mati = Cross' : 'config VPS'} dflt />
      </Sec>

      <Sec id="sum" title="Ringkasan Telegram" sum={v<boolean>('daily_summary', true) ? hours.map((h) => `${String(h).padStart(2, '0')}:00`).join(' & ') : 'mati'}>
        <Toggle k="daily_summary" label="Ringkasan saldo & trade" dflt />
        {v<boolean>('daily_summary', true) ? (
          <div className="bc-row bc-col"><span className="bc-l">Jam (waktu Korea)<Hint k="summary_hours_kst" /></span>
            <div className="bc-hours">{Array.from({ length: 24 }, (_, h) => <button key={h} type="button" className={hours.includes(h) ? 'on' : ''} onClick={() => put('summary_hours_kst', hours.includes(h) ? hours.filter((x) => x !== h) : [...hours, h].sort((a, b) => a - b).slice(0, 6))}>{String(h).padStart(2, '0')}</button>)}</div></div>
        ) : null}
      </Sec>

      <Sec id="ex" title="Koin dikecualikan" sum={excl.length ? excl.map((x) => x.replace(/USDT$/, '')).join(', ') : 'tidak ada'}>
        <div className="bc-row bc-col">
          <div className="bc-chips">{excl.length ? excl.map((x) => <button key={x} type="button" onClick={() => put('exclude', excl.filter((y) => y !== x))}>{x.replace(/USDT$/, '')} <i>×</i></button>) : <span className="bc-l"><small>Semua koin dipakai.<Hint k="exclude" /></small></span>}</div>
          <div className="bc-add"><input value={sym} placeholder="mis. ARB" autoCapitalize="characters" onChange={(e) => setSym(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSym(); }} /><button type="button" onClick={addSym}>Tambah</button></div>
        </div>
      </Sec>

      {pending ? <p className="bc-now">Menunggu bot memakai setelan baru…</p> : null}
      {err ? <div className="error">{err}</div> : null}
      {dirty ? <div className="row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? <><Spinner />Mengirim…</> : 'Kirim ke bot'}</button><button className="btn" onClick={() => setSet({ ...c.set })}>Batal</button></div> : null}
      {!dirty && Object.keys(c.set).length ? <button type="button" className="bc-reset" disabled={busy} onClick={async () => { const r = await send({ ...c, set: {} }, 'Semua setelan kembali ke config VPS'); if (r) setSet({}); }}>Kembalikan semua ke config VPS</button> : null}
      <p className="bc-foot">API key, akun asli/testnet dan mode uji tetap hanya bisa diubah di VPS.</p>
    </div>
  );
}
