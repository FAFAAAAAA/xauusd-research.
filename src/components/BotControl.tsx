'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, peek } from './client';
import { Loading, Sheet, Spinner, toast } from './Status';
import { BOT_KEYS, SYM_RE, type BotKey, type BotVal } from '@/lib/core/bot-control';

/* eslint-disable @typescript-eslint/no-explicit-any */

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} dtk lalu` : s < 3600 ? `${Math.round(s / 60)} mnt lalu` : s < 86400 ? `${Math.round(s / 3600)} jam lalu` : `${Math.round(s / 86400)} hari lalu`;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const nf = (x: number) => String(x).replace('.', ',');

/** backtest 2020–2026, 12-month windows, 4 SELL + 2 BUY: balance multiple (median / worst 10%) and usual deepest drop, by risk % per trade */
const EXP: Array<[number, number, number, number]> = [[0, 1, 1, 0], [1, 2.31, 1.68, 21], [1.5, 3.36, 2.1, 30], [2, 4.74, 2.59, 39], [2.5, 6.51, 3.12, 46], [3, 8.66, 3.65, 53], [4, 13.64, 3.53, 65], [5, 19.44, 2.21, 73]];
function expect(r: number) {
  const x = Math.max(0, Math.min(5, r));
  const i = Math.max(1, EXP.findIndex((p) => p[0] >= x)), a = EXP[i - 1], b = EXP[i], t = (x - a[0]) / (b[0] - a[0] || 1);
  const l = (k: 1 | 2 | 3) => a[k] + (b[k] - a[k]) * t;
  return { mid: l(1), bad: l(2), dd: l(3) };
}

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
  const [sos, setSos] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [revert, setRevert] = useState(false);   // emergency close: 0 = closed, 1 = first confirmation, 2 = second
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
  const mode = v<string>('risk_mode', 'percent');
  const stopBal = v<number>('stop_balance_usdt', 0), streak = v<number>('max_loss_streak', 7), ls = ap?.lossStreak ?? 0;
  const lev = v<boolean>('leverage_auto', true);
  const hours = v<number[]>('summary_hours_kst', [8, 23]);
  const excl = v<string[]>('exclude', []);
  const addSym = () => {
    let s = sym.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (s && !s.endsWith('USDT')) s += 'USDT';
    if (!SYM_RE.test(s)) { setErr('Nama koin tidak valid, contoh: ARB atau ARBUSDT'); return; }
    setErr(null); put('exclude', [...new Set([...excl, s])]); setSym('');
  };

  const bal = typeof d.balance === 'number' && d.balance > 0 ? d.balance : null;
  const riskPct = mode === 'usdt' ? (bal ? (v<number>('risk_usdt', 5) / bal) * 100 : 0) : v<number>('risk_percent', 1);
  const riskUsd = mode === 'usdt' ? v<number>('risk_usdt', 5) : bal ? (bal * riskPct) / 100 : 0;
  const ex = expect(riskPct);
  const tier = bal == null ? null : bal < 200 ? { risk: 2, sell: 3, buy: 1, bz: 1, keep: 0.5 } : bal < 1000 ? { risk: 2, sell: 4, buy: 2, bz: 2, keep: 0.5 }
    : bal < 5000 ? { risk: 1.5, sell: 4, buy: 2, bz: 2, keep: 0.6 } : { risk: 1, sell: 4, buy: 2, bz: 2, keep: 0.7 };
  const safe: Partial<Record<BotKey, BotVal>> | null = tier && bal ? { risk_mode: 'percent', risk_percent: tier.risk, max_positions: tier.sell, buy_enabled: true, max_buy_positions: tier.buy, bz_enabled: true, max_bz_positions: tier.bz,
    stop_balance_usdt: Math.max(10, Math.floor((bal * tier.keep) / 10) * 10), max_loss_streak: 7, leverage_auto: true, margin_isolated: true } : null;
  const isSafe = !!safe && Object.entries(safe).every(([k, x]) => same(v(k as BotKey, null as unknown as BotVal), x));
  const zone = riskPct <= 1.5 ? 'Aman' : riskPct <= 3 ? 'Seimbang' : 'Agresif';
  const fmtUsd = (x: number) => `$${Math.round(x).toLocaleString('id-ID')}`;
  const LABEL: Partial<Record<BotKey, string>> = { risk_mode: 'Cara risiko', risk_percent: 'Risiko', risk_usdt: 'Risiko', max_positions: 'SELL', max_buy_positions: 'BUY', buy_enabled: 'BUY', bz_enabled: 'BZ', max_bz_positions: 'BZ',
    stop_balance_usdt: 'Rem saldo', max_loss_streak: 'Rem beruntun', leverage_auto: 'Leverage', leverage: 'Leverage', margin_isolated: 'Margin', daily_summary: 'Ringkasan', summary_hours_kst: 'Jam ringkasan', exclude: 'Koin' };
  const show = (k: BotKey, x: unknown) => (x == null ? '—' : typeof x === 'boolean' ? (x ? 'nyala' : 'mati') : Array.isArray(x) ? (x.length ? x.join(', ').replace(/USDT/g, '') : '—')
    : k === 'risk_percent' ? `${nf(x as number)}%` : k === 'risk_usdt' || k === 'stop_balance_usdt' ? `$${nf(x as number)}` : k === 'risk_mode' ? (x === 'usdt' ? 'USD' : '%') : String(x));
  const posTxt = `${v<number>('max_positions', 3)} + ${v<boolean>('buy_enabled', true) ? v<number>('max_buy_positions', 2) : 0} + ${v<boolean>('bz_enabled', true) ? v<number>('max_bz_positions', 2) : 0}`;
  const changed = BOT_KEYS.filter((k) => !same(set[k], c.set[k]) && !same(v(k, null as unknown as BotVal), ap?.cfg?.[k]));
  const tiles: Array<[string, string, string, string, string]> = [
    ['pos', '⇅', 'Posisi', posTxt, 'SELL · BUY · BZ'],
    ['brake', '⛨', 'Rem', stopBal > 0 ? fmtUsd(stopBal) : 'Mati', streak > 0 ? `${streak} SL beruntun` : 'beruntun mati'],
    ['lev', '⚡', 'Leverage', lev ? 'Otomatis' : `${v<number>('leverage', 5)}x`, v<boolean>('margin_isolated', true) ? 'Isolated' : 'Cross'],
    ['sum', '✈', 'Ringkasan', v<boolean>('daily_summary', true) ? hours.map((h) => String(h).padStart(2, '0')).join(' & ') : 'Mati', 'Telegram'],
  ];

  const ver = ap?.version || '';
  const latest = ver >= '2026.11.19.2';
  const riskTxt = mode === 'usdt' ? `$${nf(v<number>('risk_usdt', 5))}` : `${nf(riskPct)}%`;
  return (
    <>
      <div className="bxs">
        <div className="bxs-top">
          <span><b>Bot Binance</b><small>{seen ? `versi ${ver || 'lama'} · ${latest ? 'terbaru' : 'ada update'}` : 'belum terhubung'}</small></span>
          <em className={online ? (ap?.paused ? 'pause' : 'on') : 'off'}>{online ? `${ap?.paused ? 'Jeda' : 'Aktif'} · ${ago(now - seen.at).replace(' lalu', '')}` : seen ? 'Tidak ada kabar' : 'Belum terhubung'}</em>
        </div>
        <div className="bxs-sum">
          <div><small>Risiko</small><b>{riskTxt}</b></div>
          <div><small>Posisi</small><b>{posTxt}</b></div>
          <div><small>Rem</small><b>{stopBal > 0 ? fmtUsd(stopBal) : 'Mati'}</b></div>
        </div>
        <div className="bxs-btn">
          <button type="button" className="ps" disabled={busy} onClick={() => send({ ...c, paused: !c.paused }, c.paused ? 'Trading dilanjutkan' : 'Trading dijeda')}>{c.paused ? '▶ Lanjutkan' : '❚❚ Jeda'}</button>
          <button type="button" className="go" onClick={() => setSheet(true)}>Atur bot ›{dirty ? <i /> : null}</button>
        </div>
      </div>
      {sheet ? <Sheet title="Atur bot" onClose={() => setSheet(false)}>
    <div className="bx">
      {bal ? (
        <div className="bx-hero">
          <small>Perkiraan 12 bulan · dari {fmtUsd(bal)}</small>
          <div className="bx-big"><b>{fmtUsd(bal * ex.mid)}</b><span>biasa</span></div>
          <div className="bx-rng"><i style={{ left: `${(ex.bad / (ex.mid * 1.15)) * 100}%`, right: `${100 - 100 / 1.15}%` }} /><em style={{ left: `${100 / 1.15}%` }} /></div>
          <div className="bx-rl"><span>periode buruk <b>{fmtUsd(bal * ex.bad)}</b></span><span>backtest 2020–2026</span></div>
          <div className="bx-stats">
            <div><small>Rugi / SL</small><b className="dn">−${nf(Math.round(riskUsd * 100) / 100)}</b></div>
            <div><small>Untung / TP</small><b className="up">+${nf(Math.round(riskUsd * 200) / 100)}</b></div>
            <div><small>Turun maks</small><b className="yl">−{Math.round(ex.dd)}%</b><i>−{fmtUsd(bal * ex.dd / 100)}</i></div>
          </div>
        </div>
      ) : null}

      <div className="bx-risk">
        <div className="bx-rh"><small>Risiko per trade</small>
          <span className="bc-seg">{(['percent', 'usdt'] as const).map((m) => <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => put('risk_mode', m)}>{m === 'percent' ? '%' : 'USD'}</button>)}</span></div>
        <div className="bx-pct">{mode === 'percent' ? <>{nf(riskPct)}%<span>± ${nf(Math.round(riskUsd * 100) / 100)}</span></> : <>${nf(v<number>('risk_usdt', 5))}<span>{bal ? `± ${nf(Math.round(riskPct * 10) / 10)}% saldo` : ''}</span></>}<em className={`z-${zone}`}>{zone}</em></div>
        {mode === 'percent'
          ? <input className="bx-slider" type="range" min={0.5} max={5} step={0.5} value={riskPct} onChange={(e) => put('risk_percent', Number(e.target.value))} aria-label="Risiko per trade (%)" />
          : <input className="bx-slider" type="range" min={1} max={bal ? Math.max(5, Math.round(bal * 0.05)) : 50} step={1} value={v<number>('risk_usdt', 5)} onChange={(e) => put('risk_usdt', Number(e.target.value))} aria-label="Risiko per trade (USD)" />}
        <div className="bx-zones"><span>Aman</span><span>Seimbang</span><span>Agresif</span></div>
        {safe ? <button type="button" className={`bx-safe ${isSafe ? 'on' : ''}`} onClick={() => setSet({ ...set, ...safe })}>{isSafe ? '✓ Sudah setelan aman' : `✓ Setelan aman untuk ${fmtUsd(bal!)}`}</button> : null}
      </div>

      <div className="bx-grid">
        {tiles.map(([id, ic, t, b, i]) => (
          <button key={id} type="button" className={`bx-t ${open === id ? 'open' : ''}`} onClick={() => setOpen(open === id ? null : id)}>
            <span className="bx-ic">{ic}</span><small>{t}</small><b>{b}</b><i>{i}</i>
          </button>
        ))}
      </div>

      {open ? (
        <div className="bc-card bx-detail" key={open}>
          <div className="bx-dh"><b>{({ pos: 'Posisi', brake: 'Rem', lev: 'Leverage & margin', sum: 'Ringkasan Telegram', ex: 'Koin dikecualikan', log: 'Riwayat setelan' } as Record<string, string>)[open]}</b><button type="button" aria-label="Tutup" onClick={() => setOpen(null)}>✕</button></div>
          {open === 'pos' ? <>
            <Step k="max_positions" label="Maks posisi SELL" by={1} lo={1} hi={6} dflt={3} />
            <Toggle k="buy_enabled" label="BUY (BTC, ETH, SOL, …)" dflt />
            {v<boolean>('buy_enabled', true) ? <Step k="max_buy_positions" label="Maks posisi BUY" by={1} lo={0} hi={4} dflt={2} /> : null}
            <Toggle k="bz_enabled" label="BZ (Bollinger SELL, semua koin)" dflt />
            {v<boolean>('bz_enabled', true) ? <Step k="max_bz_positions" label="Maks posisi BZ" by={1} lo={0} hi={4} dflt={2} /> : null}
          </> : null}
          {open === 'brake' ? <>
            <Step k="stop_balance_usdt" label="Rem saldo" unit="$" by={10} lo={0} hi={100000} dflt={0} />
            <Step k="max_loss_streak" label="Rem beruntun" unit=" SL" by={1} lo={0} hi={30} dflt={7} />
            <div className="bc-row"><span className="bc-l">Kalah beruntun<small>{streak > 0 && ls >= streak ? 'REM AKTIF — bot tidak buka posisi baru' : `dari ${streak || '—'}`}</small></span>
              <span className="bc-step"><b className={streak > 0 && ls >= streak ? 'dn' : ''}>{ls}</b>
                <button type="button" className="bc-mini" disabled={busy || !ls} onClick={() => send({ ...c, reset: true }, 'Hitungan kalah beruntun di-nol-kan')}>Nol-kan</button></span></div>
          </> : null}
          {open === 'lev' ? <>
            <Toggle k="leverage_auto" label="Leverage otomatis" sub="0,5 / jarak SL, maks 20x" dflt />
            {!lev ? <Step k="leverage" label="Leverage tetap" unit="x" by={1} lo={1} hi={20} dflt={5} /> : null}
            <Toggle k="margin_isolated" label="Margin Isolated" sub="mati = Cross" dflt />
          </> : null}
          {open === 'sum' ? <>
            <Toggle k="daily_summary" label="Ringkasan saldo & trade" dflt />
            {v<boolean>('daily_summary', true) ? (
              <div className="bc-row bc-col"><span className="bc-l">Jam (waktu Korea)</span>
                <div className="bc-hours">{Array.from({ length: 24 }, (_, h) => <button key={h} type="button" className={hours.includes(h) ? 'on' : ''} onClick={() => put('summary_hours_kst', hours.includes(h) ? hours.filter((x) => x !== h) : [...hours, h].sort((a, b) => a - b).slice(0, 6))}>{String(h).padStart(2, '0')}</button>)}</div></div>
            ) : null}
          </> : null}
          {open === 'log' ? (
            <div className="bx-log">{d.log?.length ? d.log.slice(0, 15).map((e: { at: number; items: string[] }) => (
              <div key={e.at}><small>{new Date(e.at).toLocaleString('id-ID', { timeZone: 'Asia/Seoul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>{e.items.map((x) => <p key={x}>{x}</p>)}</div>
            )) : <p className="bc-sub">Perubahan dari website akan tercatat di sini.</p>}</div>
          ) : null}
          {open === 'ex' ? (
            <div className="bc-row bc-col">
              <div className="bc-chips">{excl.length ? excl.map((x) => <button key={x} type="button" onClick={() => put('exclude', excl.filter((y) => y !== x))}>{x.replace(/USDT$/, '')} <i>×</i></button>) : <span className="bc-l"><small>Semua koin dipakai.</small></span>}</div>
              <div className="bc-add"><input value={sym} placeholder="mis. ARB" autoCapitalize="characters" onChange={(e) => setSym(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSym(); }} /><button type="button" onClick={addSym}>Tambah</button></div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="bx-more">
        <button type="button" className={open === 'ex' ? 'on' : ''} onClick={() => setOpen(open === 'ex' ? null : 'ex')}>Koin{excl.length ? ` · ${excl.length}` : ''}</button>
        <button type="button" className={open === 'log' ? 'on' : ''} onClick={() => setOpen(open === 'log' ? null : 'log')}>Riwayat</button>
        <button type="button" className="bx-sos-dot" aria-label="Darurat: tutup semua posisi" onClick={() => setSos(sos ? 0 : 1)}>
          <svg viewBox="0 0 24 24"><path d="M12 3v9M6.3 6.8a8 8 0 1 0 11.4 0" /></svg>
        </button>
      </div>

      {err ? <div className="error">{err}</div> : null}
      {pending ? <p className="bc-now">Menunggu bot memakai setelan baru…</p> : null}
      {dirty ? (
        <div className="bx-bar">
          <span><b>{changed.length || 1} perubahan</b><small>{(changed.length ? changed : BOT_KEYS.filter((k) => !same(set[k], c.set[k]))).slice(0, 3).map((k) => `${LABEL[k]} ${show(k, ap?.cfg?.[k])} → ${show(k, v(k, null as unknown as BotVal))}`).join(' · ')}</small></span>
          <button type="button" className="ghost" onClick={() => setSet({ ...c.set })} aria-label="Batal">✕</button>
          <button type="button" disabled={busy} onClick={save}>{busy ? <Spinner /> : 'Kirim ke bot'}</button>
        </div>
      ) : null}
      {!dirty && Object.keys(c.set).length ? (revert ? (
        <div className="bx-rv">
          <b>Kembalikan semua setelan ke config VPS?</b>
          <div className="bx-sos-row">
            <button type="button" className="ghost" onClick={() => setRevert(false)}>Batal</button>
            <button type="button" className="dark" disabled={busy} onClick={async () => { const r = await send({ ...c, set: {} }, 'Semua setelan kembali ke config VPS'); if (r) setSet({}); setRevert(false); }}>Ya, kembalikan</button>
          </div>
        </div>
      ) : <button type="button" className="bx-rv-btn" onClick={() => setRevert(true)}>↺ Kembalikan ke config VPS</button>) : null}
      {sos ? (
        <div className="bx-sos open">
          <b>Tutup semua posisi bot?</b>
          <p>{sos === 1 ? 'Ditutup harga pasar, lalu bot dijeda.' : 'Yakin? Tidak bisa dibatalkan.'}</p>
          <div className="bx-sos-row">
            <button type="button" className="ghost" onClick={() => setSos(0)}>Batal</button>
            {sos === 1 ? <button type="button" onClick={() => setSos(2)}>Lanjut</button>
              : <button type="button" disabled={busy} onClick={async () => { const r = await send({ ...c, closeAll: true, confirm: 'TUTUP SEMUA' }, 'Perintah darurat terkirim — bot menutup semua posisi dalam ±1 menit'); if (r) setSos(0); }}>Ya, tutup semua</button>}
          </div>
        </div>
      ) : null}
    </div>
      </Sheet> : null}
    </>
  );
}
