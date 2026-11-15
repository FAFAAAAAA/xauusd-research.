'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { call, fmt, peek } from '@/components/client';
import { CopyButton, ErrorBox, Loading, PageHead, Seg, Sheet, Spinner, Status, copyText, toast } from '@/components/Status';
import { FileText } from '@/components/FileText';
import { BotControlCard } from '@/components/BotControl';
import { TIMEFRAMES } from '@/lib/core/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function Settings() {
  const [s, setS] = useState<any>(() => peek('/api/settings'));
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); call<any>('/api/settings').then(setS).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  if (err && !s) return <><PageHead title="Atur" /><ErrorBox error={err} retry={load} /></>;
  if (!s) return <><PageHead title="Atur" /><Loading what="pengaturan" variant="page" /></>;
  return (
    <div className="stack">
      <PageHead title="Atur" />
      <BotControlCard />
      <p className="at-h">KONEKSI</p>
      <div className="at-apps">
        <Telegram s={s} reload={load} />
        <EaSetup tz={s.timezone} />
        <FeedSetup tz={s.timezone} />
        <TradingView s={s} />
      </div>
      <p className="at-h">LAINNYA</p>
      <div className="at-apps">
        <General s={s} reload={load} />
        <HistoricalData />
        <Zones />
        <OtherImports />
        <Errors />
      </div>
    </div>
  );
}

/* simple line icons for the settings tiles */
const ICON: Record<string, string> = {
  telegram: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  ea: 'M4 7h16v10H4zM9 17v3M15 17v3M8 11h.01M16 11h.01M12 3v4',
  sinyal: 'M13 2 3 14h9l-1 8 10-12h-9z',
  tradingview: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  tampilan: 'M12 3a9 9 0 1 0 9 9c0-1-1-1.5-2-1.5h-2a2 2 0 0 1-1-3.7A9 9 0 0 0 12 3zM7.5 10.5h.01M10.5 7h.01M15 7.5h.01',
  data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  zona: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  'impor-tv': 'M12 3v12M7 10l5 5 5-5M4 21h16',
  error: 'M12 3 2 21h20L12 3zM12 10v5M12 18h.01',
};
const GRAD: Record<string, string> = {
  telegram: 'linear-gradient(160deg,#5ac8fa,#1e90d6)', ea: 'linear-gradient(160deg,#3a3a40,#141416)', sinyal: 'linear-gradient(160deg,#ffcc4d,#f2930d)',
  tradingview: 'linear-gradient(160deg,#7d93ff,#4058e6)', tampilan: 'linear-gradient(160deg,#c7c7cc,#8e8e93)', data: 'linear-gradient(160deg,#5fd3c3,#22a091)',
  zona: 'linear-gradient(160deg,#d17bf0,#9b3fd1)', 'impor-tv': 'linear-gradient(160deg,#8fdcff,#3aa9e6)', error: 'linear-gradient(160deg,#ff7b72,#e5322b)',
};
const SHORT: Record<string, string> = { telegram: 'Telegram', ea: 'EA & bot', sinyal: 'Sinyal XAU', tradingview: 'TradingView', tampilan: 'Tampilan', data: 'Data harga', zona: 'Zona', 'impor-tv': 'Impor TV', error: 'Error' };

/** Settings tile: a square with an icon, a name and its status; tap opens the full section in a bottom sheet.
 *  Opens automatically when the URL hash matches its id (e.g. /settings#data). */
function Group({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (typeof window !== 'undefined' && window.location.hash === `#${id}`) setOpen(true); }, [id]);
  const dot = !sub ? null : /ada update|masalah|gagal/i.test(sub) ? 'warn' : /aktif|terbaru|siap|terakhir|terkirim|berhasil/i.test(sub) && !/belum/i.test(sub) ? 'ok' : null;
  return (
    <>
      <button type="button" className="ap-btn" id={id} onClick={() => setOpen(true)} aria-label={`${title}${sub ? ` — ${sub}` : ''}`}>
        <span className="ap-ic" style={{ background: GRAD[id] ?? 'linear-gradient(160deg,#3a3a40,#141416)' }}>
          <svg viewBox="0 0 24 24"><path d={ICON[id] ?? 'M12 12h.01'} /></svg>
          {dot === 'warn' ? <em className={dot} /> : null}
        </span>
        <small>{SHORT[id] ?? title}</small>
      </button>
      {open ? <Sheet title={title} onClose={() => { setOpen(false); if (window.location.hash === `#${id}`) history.replaceState(null, '', window.location.pathname); }}><div className="at-body">{children}</div></Sheet> : null}
    </>
  );
}

function useSave(reload: () => void) {
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (json: unknown) => {
    setMsg(null);
    try { await call('/api/settings', { method: 'PUT', json }); toast('Tersimpan'); reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  return { msg, save };
}

function General({ s, reload }: { s: any; reload: () => void }) {
  const { msg, save } = useSave(reload);
  // theme is per device (browser storage); 'auto' follows the iPhone light/dark setting
  // theme is per device (browser storage). Light is the default; 'auto' follows the iPhone light/dark setting.
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(() => {
    try { const t = localStorage.getItem('xau.theme'); return t === 'dark' || t === 'auto' ? t : 'light'; } catch { return 'light'; }
  });
  const pickTheme = (t: 'auto' | 'light' | 'dark') => {
    setTheme(t);
    try { if (t === 'light') localStorage.removeItem('xau.theme'); else localStorage.setItem('xau.theme', t); } catch { /* storage blocked */ }
    document.documentElement.dataset.theme = t;
  };
  const tzLabel = s.timezone === 'Asia/Seoul' ? 'Seoul' : s.timezone === 'America/New_York' ? 'New York' : 'UTC';
  return (
    <Group id="tampilan" title="Tampilan" sub={`${theme === 'auto' ? 'Tema otomatis' : theme === 'dark' ? 'Gelap' : 'Terang'} · ${tzLabel}`}>
      <div className="picker"><span className="label">Tema</span>
        <div style={{ maxWidth: 360 }}><Seg full label="Tema" options={[['light', 'Terang'], ['dark', 'Gelap'], ['auto', 'Otomatis']] as const} value={theme} onChange={pickTheme} /></div></div>
      <div className="picker"><span className="label">Zona waktu</span>
        <div style={{ maxWidth: 360 }}><Seg full label="Zona waktu" options={[['UTC', 'UTC'], ['Asia/Seoul', 'Seoul'], ['America/New_York', 'New York']] as const} value={s.timezone} onChange={(v) => save({ timezone: v })} /></div></div>
      {msg ? <div className="error">{msg}</div> : null}
    </Group>
  );
}

function Telegram({ s, reload }: { s: any; reload: () => void }) {
  const t = s.telegram;
  const { msg, save } = useSave(reload);
  const [token, setToken] = useState('');
  const [chat, setChat] = useState(t.chatSource === 'database' ? t.chatId ?? '' : '');
  const [cool, setCool] = useState(String(t.cooldownSeconds));
  const [perMin, setPerMin] = useState(String(t.maxPerMinute));
  const [test, setTest] = useState<any>(null);
  const [logs, setLogs] = useState<any[] | null>(null);
  const loadLogs = () => call<any[]>('/api/telegram/logs').then(setLogs).catch(() => setLogs([]));
  useEffect(() => { loadLogs(); }, []);
  const sendTest = async () => {
    setTest({ busy: true });
    try { const r = await call<any>('/api/telegram/test', { method: 'POST' }); setTest(r); } catch (e) { setTest({ status: 'failed', error: (e as Error).message }); }
    reload(); loadLogs();
  };
  const [det, setDet] = useState<any>(null);
  const detect = async () => {
    setDet({ busy: true });
    try { setDet(await call<any>('/api/telegram/detect', { method: 'POST' })); } catch (e) { setDet({ tokenOk: false, error: (e as Error).message }); }
  };
  const pickChat = async (id: string) => { await save({ telegram: { chatId: id } }); setChat(id); setDet(null); };
  const retry = async (id: string) => { try { await call('/api/telegram/retry', { method: 'POST', json: { id } }); } catch { /* shown in log */ } loadLogs(); };
  const status = t.lastTest?.at ? (t.lastTest.ok ? 'Terhubung' : 'Tes terakhir gagal') : 'Belum dites';
  return (
    <Group id="telegram" title="Bot Telegram" sub={status}>
      <Status on={!!t.lastTest?.ok} error={t.lastTest?.ok === false}>
        {t.lastTest?.at ? (t.lastTest.ok ? `Terhubung · dites ${fmt(t.lastTest.at, s.timezone)}` : `Gagal: ${t.lastTest.error}`) : 'Belum pernah dites'}
      </Status>
      <label className="switch">Kirim sinyal live<input type="checkbox" checked={t.liveEnabled} onChange={(e) => save({ telegram: { liveEnabled: e.target.checked } })} /></label>
      <label className="switch">Kirim sinyal simulasi (backtest)<input type="checkbox" checked={t.backtestEnabled} onChange={(e) => save({ telegram: { backtestEnabled: e.target.checked } })} /></label>
      <div className="grid two">
        <label className="field">Token bot {t.tokenHint ? `· tersimpan ${t.tokenHint}` : ''}
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t.tokenSource === 'env' ? 'Diatur di Vercel' : '123456789:AA…'} disabled={t.tokenSource === 'env' || !t.canStoreToken} />
        </label>
        <label className="field">Chat ID
          <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder={t.chatSource === 'env' ? t.chatId : 'Tekan Cari Chat ID'} />
        </label>
      </div>
      <div className="row">
        <button className="btn" onClick={() => { save({ telegram: { botToken: token || undefined, chatId: chat, cooldownSeconds: Number(cool), maxPerMinute: Number(perMin) } }); setToken(''); }}>Simpan</button>
        <button className="btn" onClick={detect} disabled={det?.busy}>{det?.busy ? <><Spinner />Mencari…</> : 'Cari Chat ID'}</button>
        <button className="btn primary" onClick={sendTest} disabled={test?.busy}>{test?.busy ? <><Spinner />Mengirim…</> : 'Kirim pesan tes'}</button>
      </div>
      {msg ? <div className="error">{msg}</div> : null}
      {det && !det.busy ? (det.tokenOk ? (
        <div className="notice stack tight">
          <span>Bot <strong>@{det.bot.username}</strong> aktif.</span>
          {det.chats.length ? det.chats.map((c: any) => (
            <div key={c.id} className="row between"><span>{c.name || c.type} · <span className="num">{c.id}</span></span>
              {String(det.currentChatId) === c.id ? <span className="small">Dipakai</span> : <button className="btn sm" onClick={() => pickChat(c.id)}>Pakai</button>}</div>
          )) : <span>Kirim &quot;halo&quot; ke bot di Telegram, lalu tekan Cari Chat ID lagi.</span>}
        </div>) : <div className="error">{det.error}</div>) : null}
      {test && !test.busy ? (test.status === 'sent' ? <div className="ok">Pesan tes terkirim. Cek Telegram kamu.</div> : <div className="error">Tidak terkirim: {test.error ?? test.status}</div>) : null}
      <details className="more">
        <summary>Lanjutan</summary>
        <div className="grid two">
          <label className="field">Jeda sinyal serupa (detik)<input inputMode="numeric" value={cool} onChange={(e) => setCool(e.target.value)} /></label>
          <label className="field">Maks pesan per menit<input inputMode="numeric" value={perMin} onChange={(e) => setPerMin(e.target.value)} /></label>
        </div>
        {t.tokenSource === 'database' ? <button className="btn sm" onClick={() => save({ telegram: { clearToken: true } })}>Hapus token tersimpan</button> : null}
        {!t.canStoreToken && t.tokenSource !== 'env' ? <p className="mute small">Untuk menyimpan token di sini, isi APP_ENCRYPTION_KEY di Vercel. Atau isi TELEGRAM_BOT_TOKEN di Vercel.</p> : null}
      </details>
      <details className="more">
        <summary>Riwayat pengiriman</summary>
        {!logs ? <Loading what="riwayat" /> : logs.length ? <div className="list">{logs.slice(0, 30).map((l) => (
          <div key={l.id} className="item"><span style={{ minWidth: 0 }}><span className="t" style={{ display: 'block' }}>{l.status === 'sent' ? 'Terkirim' : l.status === 'failed' ? 'Gagal' : l.status}</span>
            <span className="d">{fmt(Date.parse(l.created_at), s.timezone)} · {l.mode === 'LIVE' ? 'live' : l.mode === 'BACKTEST' ? 'simulasi' : 'tes'}{l.error ? ` · ${l.error}` : l.skip_reason ? ` · ${l.skip_reason}` : ''}</span></span>
            {l.status === 'failed' ? <button className="btn sm" onClick={() => retry(l.id)}>Ulangi</button> : null}</div>))}</div>
          : <p className="mute small">Belum ada.</p>}
      </details>
    </Group>
  );
}

function FeedSetup({ tz }: { tz: string }) {
  const [f, setF] = useState<any>(null);
  const [key, setKey] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => call<any>('/api/live/feed').then(setF).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const post = async (json: any) => { setMsg(null); setBusy(true); try { return await call<any>('/api/live/feed', { method: 'POST', json }); } catch (e) { setMsg((e as Error).message); return null; } finally { setBusy(false); } };
  const st = f?.status;
  const ok = !!(f?.apiKeySource && f?.cronConfigured && st?.ok);
  return (
    <Group id="sinyal" title="Sinyal otomatis v1 XAU (gratis)" sub={!f ? '' : ok ? `Aktif · cek terakhir ${fmt(st.at, tz)}` : !f.apiKeySource ? 'API key belum diisi' : !f.cronConfigured ? 'Jadwal belum dibuat' : st?.error ? 'Ada masalah' : 'Menunggu jadwal pertama'}>
      <details className="more">
        <summary>Cara pasang</summary>
      <ol className="howto">
        <li>Daftar gratis di <strong>twelvedata.com</strong>, salin API key dari dashboard, tempel di bawah → Simpan.</li>
        <li>Tekan <strong>Buat alamat jadwal</strong>, salin alamatnya.</li>
        <li>Di <strong>cron-job.org</strong>: Create cronjob → tempel alamat → jadwal <strong>setiap 15 menit</strong> → Create.</li>
        <li>Pastikan Atur → Bot Telegram → <strong>Kirim sinyal live</strong> menyala.</li>
      </ol>
      </details>
      <label className="field">API key Twelve Data {f?.apiKeyHint ? `· tersimpan ${f.apiKeyHint}${f.apiKeySource === 'env' ? ' (Vercel)' : ''}` : ''}
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={f?.apiKeySource === 'env' ? 'Diatur di Vercel' : 'tempel API key'} disabled={f?.apiKeySource === 'env'} />
      </label>
      <div className="row">
        <button className="btn sm" disabled={busy || !key.trim()} onClick={async () => { if (await post({ action: 'apikey', apiKey: key.trim() })) { setKey(''); setMsg('API key tersimpan.'); load(); } }}>Simpan API key</button>
        <button className="btn sm" disabled={busy} onClick={async () => {
          if (f?.cronConfigured && !window.confirm('Buat alamat baru? Alamat lama di cron-job.org langsung tidak berlaku.')) return;
          const r = await post({ action: 'cronkey' }); if (r) { setUrl(r.url); load(); } }}>{f?.cronConfigured ? 'Buat alamat baru' : 'Buat alamat jadwal'}</button>
        <button className="btn sm primary" disabled={busy || !f?.apiKeySource} onClick={async () => {
          const r = await post({ action: 'test' }); if (r) { setMsg(r.ok ? `Berhasil: candle terakhir ${fmt(r.lastBar, tz)}, ${r.signals.length} sinyal baru.` : `Gagal: ${r.error}`); load(); } }}>{busy ? <><Spinner />Mengecek…</> : 'Tes sekarang'}</button>
      </div>
      {url ? <div className="notice warn stack tight"><strong>Alamat jadwal — salin sekarang, hanya ditampilkan sekali</strong>
        <div className="copyable"><span className="val">{url}</span><CopyButton text={url} done="Alamat jadwal tersalin" /></div></div> : null}
      {msg ? <div className="notice">{msg}</div> : null}
      {st ? <dl className="kv"><dt>Cek terakhir</dt><dd>{fmt(st.at, tz)}{st.ok ? '' : ` · ${st.error}`}</dd><dt>Candle terakhir</dt><dd>{st.lastBar ? fmt(st.lastBar, tz) : '—'}</dd></dl> : null}
    </Group>
  );
}

function EaSetup({ tz }: { tz: string }) {
  const [info, setInfo] = useState<any>(null);
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => call<any>('/api/ea/key').then(setInfo).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const make = async () => {
    if (info?.configured && !window.confirm('Buat kunci baru? Kunci lama di EA langsung tidak berlaku.')) return;
    try { const r = await call<any>('/api/ea/key', { method: 'POST' }); setKey(r.key); load(); } catch (e) { setErr((e as Error).message); }
  };
  const last = info?.lastReport as { at: number; event: string } | null;
  const [botV, setBotV] = useState<string | null>(null);
  useEffect(() => { call<any>('/api/bot-control').then((x) => setBotV(x?.seen?.applied?.version || null)).catch(() => {}); }, []);
  const newest = '2026.11.15.4';
  return (
    <Group id="ea" title="EA MT5 & bot Binance (otomatis)" sub={botV ? `Bot v${botV}${botV >= newest ? ' · terbaru' : ' · ada update'}` : info?.configured ? (last ? `Laporan terakhir ${fmt(last.at, tz)}` : 'Kunci siap, belum ada laporan') : 'Belum diatur'}>
      <div className={`at-ver ${botV && botV >= newest ? 'ok' : 'old'}`}>
        <span><small>Bot Binance di VPS</small><b>{botV ? `versi ${botV}` : 'versi belum diketahui'}</b></span>
        <em>{botV && botV >= newest ? 'Terbaru' : `Terbaru: ${newest}`}</em>
      </div>
      <div className="row">
        <a className="btn sm primary" href="/ea/XAU_v2_EA_v114.mq5" download>Unduh EA v1 XAU (XAU_v2_EA_v114.mq5)</a>
        <a className="btn sm primary" href="/ea/NAS_v1_EA_v100.mq5" download>Unduh EA v1 NAS (NAS_v1_EA_v100.mq5)</a>
        <a className="btn sm primary" href="/ea/PROP_XAU_NAS_EA_v100.mq5" download>Unduh EA prop firm v1 XAU + v1 NAS (PROP_XAU_NAS_EA_v100.mq5)</a>
        <a className="btn sm primary" href="/bot/snr_bot.py" download>Unduh bot Binance — ALT + BIG (snr_bot.py)</a>
        <a className="btn sm" href="/ea/XAU_v2_EA_DIAGNOSTIK.mq5" download>Unduh EA Diagnostik (MT5)</a>
        <button className="btn sm" onClick={make}>{info?.configured ? 'Buat kunci baru' : 'Buat kunci EA'}</button>
        <button className="btn sm" onClick={async () => { try { const r = await call<any>('/api/ea/test', { method: 'POST' }); toast(r.sent?.every((x: string) => x === 'sent') ? 'Contoh pesan bot terkirim ke Telegram + 1 trade TES di jurnal (Trade → Crypto)' : `Telegram: ${(r.sent ?? []).join(', ')}`); } catch (e) { setErr((e as Error).message); } }}>Tes pesan bot di Telegram</button>
      </div>
      {key ? <div className="notice warn stack tight"><strong>Kunci EA — salin sekarang, hanya ditampilkan sekali</strong>
        <div className="copyable"><span className="val">{key}</span><CopyButton text={key} done="Kunci EA tersalin" /></div></div> : null}
      {err ? <div className="error">{err}</div> : null}
      <div className="picker"><span className="label">Alamat laporan</span>
        {info?.reportUrl ? <div className="copyable"><span className="val">{info.reportUrl}</span><CopyButton text={info.reportUrl} done="Alamat laporan tersalin" /></div> : <span className="mute small">{info ? 'Isi APP_BASE_URL di Vercel' : 'Memuat…'}</span>}</div>
      <details className="more">
        <summary>Cara pasang</summary>
      <ol className="howto">
        <li>Di MetaTrader 5 (komputer): File → Open Data Folder → MQL5 → Experts → salin file EA → klik kanan Navigator → Refresh.</li>
        <li>Tools → Options → Expert Advisors → centang <strong>Allow WebRequest for listed URL</strong> → tambahkan alamat website (tanpa /api/…).</li>
        <li>Buka chart XAUUSD (timeframe bebas), seret EA ke chart, aktifkan <strong>Algo Trading</strong>. Isi: Risiko %, Alamat laporan, Kunci EA.</li>
        <li><strong>Coba di akun demo dulu</strong> minimal 2–4 minggu. Cek bahwa entry, SL, TP muncul di Jurnal dan Telegram.</li>
      </ol>
      </details>
    </Group>
  );
}

function TradingView({ s }: { s: any }) {
  const tv = s.tradingview;
  const [logs, setLogs] = useState<any[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { call<any[]>('/api/webhooks/logs').then(setLogs).catch(() => setLogs([])); }, []);
  const copy = async (file: string, label: string) => {
    try {
      const txt = await (await fetch(`/pine/${file}`, { cache: 'no-store' })).text();
      if (await copyText(txt, `${label} tersalin`)) setMsg(`${label} tersalin. Tempel di TradingView → Pine Editor.`);
      else setMsg('Gagal menyalin. Buka tautan file lalu salin manual.');
    } catch { setMsg('Gagal menyalin. Buka tautan file lalu salin manual.'); }
  };
  return (
    <Group id="tradingview" title="TradingView & sinyal" sub={tv.secretConfigured ? 'Webhook siap' : 'Indikator v1 XAU'}>
      <div className="row">
        <button className="btn sm primary" onClick={() => copy('xau_v2.pine', 'Indikator v1 XAU')}>Salin indikator v1 XAU</button>
        <button className="btn sm" onClick={() => copy('xau_peta_struktur.pine', 'Peta Struktur')}>Salin Peta Struktur</button>
      </div>
      {msg ? <div className="notice">{msg}</div> : null}
      <details className="more">
        <summary>Cara pasang</summary>
      <ol className="howto">
        <li>Chart <strong>XAUUSD</strong> broker kamu, timeframe <strong>15 menit</strong>.</li>
        <li>Pine Editor → tempel → <strong>Add to chart</strong>.</li>
        <li>Alert → kondisi: nama indikator → <strong>Any alert() function call</strong> → notifikasi aplikasi.</li>
        <li><strong>Opsional (Telegram + lot):</strong> paket TradingView dengan webhook. Isi Secret di pengaturan indikator, centang &quot;format JSON&quot;, isi Webhook URL di bawah.</li>
      </ol>
      </details>
      <div className="picker"><span className="label">Webhook URL</span>
        {tv.webhookUrl ? <div className="copyable"><span className="val">{tv.webhookUrl}</span><CopyButton text={tv.webhookUrl} done="Webhook URL tersalin" /></div> : <span className="mute small">Isi APP_BASE_URL di Vercel</span>}</div>
      <dl className="kv"><dt>Secret</dt><dd>{tv.secretConfigured ? 'Sudah diatur' : 'Belum (TRADINGVIEW_WEBHOOK_SECRET di Vercel)'}</dd></dl>
      <details className="more">
        <summary>Riwayat alert</summary>
        {!logs ? <Loading what="riwayat" /> : logs.length ? <div className="list">{logs.slice(0, 30).map((l) => (
          <div key={l.id} className="item"><span style={{ minWidth: 0 }}><span className="t" style={{ display: 'block' }}>{l.status}</span>
            <span className="d">{fmt(Date.parse(l.received_at), s.timezone)}{l.error ? ` · ${l.error}` : ''}</span></span></div>))}</div>
          : <p className="mute small">Belum ada alert masuk.</p>}
      </details>
    </Group>
  );
}

function HistoricalData() {
  const [sources, setSources] = useState<any[]>([]);
  const [cov, setCov] = useState<any[]>([]);
  const reload = () => { call<any[]>('/api/sources').then(setSources).catch(() => {}); call<any[]>('/api/sources/coverage').then(setCov).catch(() => {}); };
  useEffect(reload, []);
  const [f, setF] = useState({ name: '', provider: '', broker_symbol: '', file_timezone: 'UTC', price_basis: 'bid', spread_points: '', notes: '', is_test: false });
  const [msg, setMsg] = useState<string | null>(null);
  const create = async () => {
    try { await call('/api/sources', { method: 'POST', json: { ...f, kind: 'csv_import' } }); setMsg('Sumber dibuat'); reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const [src, setSrc] = useState('');
  const [tf, setTf] = useState('M15');
  const [file, setFile] = useState<File | null>(null);
  const [prog, setProg] = useState<any>(null);
  const upload = async () => {
    if (!file || !src) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    const firstIdx = lines.findIndex((l) => l.trim());
    const hasHeader = /[a-zA-Z]/.test((lines[firstIdx] ?? '').replace(/^\d{4}[-./]\d{2}[-./]\d{2}T?/, ''));
    const header = hasHeader ? lines[firstIdx] : undefined;
    const body = lines.slice(hasHeader ? firstIdx + 1 : firstIdx);
    const CH = 5000;
    let batch: string | null = null;
    const total = { parsed: 0, inserted: 0, existing: 0, issues: [] as any[] };
    try {
      for (let i = 0; i < body.length; i += CH) {
        setProg({ done: i, total: body.length });
        const r: any = await call('/api/import/ohlc', { method: 'POST', json: { source_id: src, timeframe: tf, header, text: body.slice(i, i + CH).join('\n'), line_offset: (hasHeader ? firstIdx + 2 : firstIdx + 1) + i, batch_id: batch, filename: file.name } });
        batch = r.batchId;
        total.parsed += r.parsed; total.inserted += r.inserted; total.existing += r.existing; total.issues.push(...r.issues);
      }
      setProg({ finished: true, ...total, issues: total.issues.slice(0, 20), issueCount: total.issues.length });
      reload();
    } catch (e) { setProg({ error: (e as Error).message }); }
  };
  const [derive, setDerive] = useState<any>(null);
  const runDerive = async (alignment: string) => {
    setDerive({ busy: true });
    try { setDerive(await call('/api/import/derive', { method: 'POST', json: { source_id: src, from: tf, alignment, targets: ['H1', 'H4', 'D1'] } })); reload(); }
    catch (e) { setDerive({ error: (e as Error).message }); }
  };
  const realCov = cov.filter((c) => !c.is_test);
  useEffect(() => { if (!src && sources.length) setSrc((sources.find((x) => !x.is_test) ?? sources[0]).id); }, [sources, src]);
  return (
    <Group id="data" title="Data harga" sub={realCov.length ? `${realCov.length} timeframe tersimpan` : 'Belum ada data'}>
      {cov.length ? (
        <div className="list">
          {cov.map((c) => (
            <div key={c.source_id + c.timeframe} className="item">
              <span style={{ minWidth: 0 }}><span className="t" style={{ display: 'block' }}>{c.timeframe} · {c.source_name}{c.is_test ? ' (tes)' : ''}</span>
                <span className="d">{fmt(c.first, 'UTC').slice(0, 10)} sampai {fmt(c.last, 'UTC').slice(0, 10)}</span></span>
              <span className="end num">{c.candles.toLocaleString('id-ID')}</span>
            </div>
          ))}
        </div>
      ) : <p className="mute">Belum ada data. Ikuti langkah di bawah.</p>}

      <h3>1. Pilih sumber</h3>
      <div className="row">
        <select value={src} onChange={(e) => setSrc(e.target.value)} style={{ flex: '1 1 220px', width: 'auto' }} aria-label="Sumber data">
          <option value="">Pilih sumber…</option>
          {sources.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.file_timezone}){x.is_test ? ' · tes' : ''}</option>)}
        </select>
      </div>
      <details className="more">
        <summary>Buat sumber baru</summary>
        <div className="grid two">
          <label className="field">Nama<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Dukascopy XAUUSD BID" /></label>
          <label className="field">Penyedia<input value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} placeholder="Dukascopy" /></label>
          <label className="field">Zona waktu file<input value={f.file_timezone} onChange={(e) => setF({ ...f, file_timezone: e.target.value })} placeholder="UTC" /></label>
          <label className="field">Harga<select value={f.price_basis} onChange={(e) => setF({ ...f, price_basis: e.target.value })}>{['bid', 'ask', 'mid', 'last', 'unknown'].map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <label className="switch">Data uji coba<input type="checkbox" checked={f.is_test} onChange={(e) => setF({ ...f, is_test: e.target.checked })} /></label>
        <button className="btn" onClick={create} disabled={!f.name || !f.provider}>Buat sumber</button>
        {msg ? <span className="small mute">{msg}</span> : null}
      </details>

      <h3>2. Impor file CSV</h3>
      <label className="field">Timeframe file<select value={tf} onChange={(e) => setTf(e.target.value)}>{TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="field">File CSV<input type="file" accept=".csv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <button className="btn primary block" onClick={upload} disabled={!file || !src || prog?.done !== undefined && !prog?.finished && !prog?.error}>Impor</button>
      {prog ? (prog.error ? <div className="error">Gagal: {prog.error}</div>
        : prog.finished ? <div className="ok">Selesai: {prog.inserted.toLocaleString('id-ID')} candle baru{prog.existing ? `, ${prog.existing.toLocaleString('id-ID')} sudah ada` : ''}{prog.issueCount ? `, ${prog.issueCount} baris ditolak` : ''}.</div>
        : <div className="notice">Mengunggah {Math.round((prog.done / Math.max(1, prog.total)) * 100)}%… jangan tutup halaman.</div>) : null}
      {prog?.issues?.length ? <pre>{prog.issues.slice(0, 10).map((i: any) => `Baris ${i.line}: ${i.message}`).join('\n')}</pre> : null}

      <h3>3. Bentuk H1, H4 & D1</h3>
      <button className="btn block" onClick={() => runDerive('utc')} disabled={!src || derive?.busy}>{derive?.busy ? 'Menghitung… (bisa beberapa menit)' : `Bentuk H1, H4 & D1 dari ${tf}`}</button>
      {derive && !derive.busy ? (derive.error ? <div className="error">{derive.error}</div>
        : <div className="ok">Selesai: {Object.entries(derive).map(([k, v]) => `${k} ${(v as number).toLocaleString('id-ID')} baru`).join(', ')}.</div>) : null}
      <details className="more">
        <summary>Lainnya</summary>
        <p className="mute small">Format yang dikenali: Dukascopy, TradingView, MetaTrader, atau tanggal ISO. Impor ulang aman, data dobel dilewati.</p>
        <button className="btn sm" onClick={() => runDerive('ny_close')} disabled={!src}>Bentuk dengan jam broker (tutup 17:00 New York)</button>
      </details>
    </Group>
  );
}

function Zones() {
  const [zones, setZones] = useState<any[]>([]);
  const reload = () => call<any[]>('/api/zones').then(setZones).catch(() => {});
  useEffect(() => { reload(); }, []);
  const [z, setZ] = useState({ mode: 'BACKTEST', kind: 'support', low: '', high: '', timeframe: 'H1', valid_from: '', notes: '', is_test: false });
  const [msg, setMsg] = useState<string | null>(null);
  const add = async () => {
    try { await call('/api/zones', { method: 'POST', json: { ...z, valid_from: z.valid_from ? new Date(z.valid_from + 'Z').toISOString() : null } }); setMsg('Zona disimpan'); reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const del = async (id: string) => { await call(`/api/zones?id=${id}`, { method: 'DELETE' }).catch(() => {}); reload(); };
  return (
    <Group id="zona" title="Zona manual" sub={zones.length ? `${zones.length} zona` : 'Opsional'}>
      <div className="grid two">
        <label className="field">Jenis<select value={z.kind} onChange={(e) => setZ({ ...z, kind: e.target.value })}><option value="support">Support</option><option value="resistance">Resistance</option></select></label>
        <label className="field">Batas bawah<input inputMode="decimal" value={z.low} onChange={(e) => setZ({ ...z, low: e.target.value })} /></label>
        <label className="field">Batas atas<input inputMode="decimal" value={z.high} onChange={(e) => setZ({ ...z, high: e.target.value })} /></label>
        <label className="field">Berlaku sejak (UTC)<input type="datetime-local" value={z.valid_from} onChange={(e) => setZ({ ...z, valid_from: e.target.value })} /></label>
      </div>
      <button className="btn" onClick={add} disabled={!z.low || !z.high || !z.valid_from}>Tambah zona</button>
      {msg ? <span className="small mute">{msg}</span> : null}
      {zones.length ? <div className="list">{zones.map((x) => (
        <div key={x.id} className="item"><span><span className="t" style={{ display: 'block' }}>{x.kind === 'support' ? 'Support' : 'Resistance'} {x.low}–{x.high}</span>
          <span className="d">sejak {fmt(Date.parse(x.valid_from), 'UTC')} UTC{x.is_test ? ' · tes' : ''}</span></span>
          <button className="btn sm" onClick={() => del(x.id)}>Hapus</button></div>))}</div> : null}
    </Group>
  );
}

function OtherImports() {
  const [evText, setEvText] = useState('');
  const [repText, setRepText] = useState('');
  const [rep, setRep] = useState({ name: '', chart_timezone: 'UTC', timeframe: 'H1' });
  const [isTest, setIsTest] = useState(false);
  const [res, setRes] = useState<any>(null);
  const run = async (url: string, json: unknown) => { try { setRes(await call(url, { method: 'POST', json })); } catch (e) { setRes({ error: (e as Error).message }); } };
  return (
    <Group id="impor-tv" title="Impor dari TradingView" sub="Opsional">
      <h3>Laporan Strategy Tester</h3>
      <div className="grid two">
        <label className="field">Nama<input value={rep.name} onChange={(e) => setRep({ ...rep, name: e.target.value })} /></label>
        <label className="field">Zona waktu chart<input value={rep.chart_timezone} onChange={(e) => setRep({ ...rep, chart_timezone: e.target.value })} /></label>
        <label className="field">Timeframe<select value={rep.timeframe} onChange={(e) => setRep({ ...rep, timeframe: e.target.value })}>{TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}</select></label>
      </div>
      <FileText onText={setRepText} />
      <button className="btn" onClick={() => run('/api/import/strategy-report', { ...rep, text: repText, is_test: isTest })} disabled={!repText || !rep.name}>Impor laporan</button>
      <details className="more">
        <summary>Impor event indikator (CSV)</summary>
        <code>event_id,timestamp,timeframe,event_type,price,zone_low,zone_high,zone_kind,strategy_version</code>
        <FileText onText={setEvText} />
        <button className="btn" onClick={() => run('/api/import/indicator-events', { text: evText, is_test: isTest })} disabled={!evText}>Impor event</button>
      </details>
      <label className="switch">Data uji coba<input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} /></label>
      {res ? (res.error ? <div className="error">{res.error}</div> : <pre>{JSON.stringify(res, null, 2)}</pre>) : null}
    </Group>
  );
}

function Errors() {
  const [e, setE] = useState<any[] | null>(null);
  useEffect(() => { call<any[]>('/api/errors').then(setE).catch(() => setE([])); }, []);
  return (
    <Group id="error" title="Catatan error" sub={e ? (e.length ? `${e.length} catatan` : 'Tidak ada') : ''}>
      {!e ? <Loading what="catatan" /> : e.length ? <div className="list">{e.slice(0, 30).map((x) => (
        <div key={x.id} className="item"><span style={{ minWidth: 0 }}><span className="t" style={{ display: 'block' }}>{x.message}</span>
          <span className="d">{x.scope} · {String(x.occurred_at).slice(0, 16).replace('T', ' ')}</span></span></div>))}</div>
        : <p className="mute small">Tidak ada error.</p>}
    </Group>
  );
}
