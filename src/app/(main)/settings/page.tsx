'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, fmt } from '@/components/client';
import { ErrorBox, Loading, Status } from '@/components/Status';
import { FileText } from '@/components/FileText';
import { TIMEFRAMES } from '@/lib/core/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ALERT_EXAMPLE = `{
  "secret": "<TRADINGVIEW_WEBHOOK_SECRET>",
  "event_id": "{{ticker}}-{{interval}}-{{timenow}}-SNR_NEAR",
  "symbol": "{{exchange}}:{{ticker}}",
  "timeframe": "{{interval}}",
  "event_type": "SNR_NEAR",
  "timestamp": "{{timenow}}",
  "price": {{close}},
  "zone": { "low": 0, "high": 0, "kind": "support" },
  "strategy_version": "snr-dev",
  "source": "tradingview",
  "mode": "LIVE"
}`;

export default function Settings() {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); call<any>('/api/settings').then(setS).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  if (err) return <><h1>Settings</h1><ErrorBox error={err} retry={load} /></>;
  if (!s) return <><h1>Settings</h1><Loading what="pengaturan" /></>;
  return (
    <div className="stack">
      <div><h1>Settings</h1><p className="sub">Token dan secret disimpan di server dan hanya ditampilkan tersamar.</p></div>
      <General s={s} reload={load} />
      <Telegram s={s} reload={load} />
      <TradingView s={s} />
      <HistoricalData />
      <Zones />
      <OtherImports />
      <Errors />
    </div>
  );
}

function useSave(reload: () => void) {
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (json: unknown) => {
    setMsg(null);
    try { await call('/api/settings', { method: 'PUT', json }); setMsg('Tersimpan'); reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  return { msg, save };
}

function General({ s, reload }: { s: any; reload: () => void }) {
  const { msg, save } = useSave(reload);
  const [hist, setHist] = useState(s.providers?.historical ?? '');
  const [news, setNews] = useState(s.providers?.news ?? '');
  const [warm, setWarm] = useState(String(s.replay?.warmup_candles ?? 300));
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Umum & replay</h2>
      <div className="row">
        <span className="mute small">Zona waktu tampilan</span>
        <div className="seg" role="group">
          {[['UTC', 'UTC'], ['America/New_York', 'New York'], ['Asia/Seoul', 'Asia/Seoul']].map(([v, l]) =>
            <button key={v} aria-pressed={s.timezone === v} onClick={() => save({ timezone: v })}>{l}</button>)}
        </div>
      </div>
      <div className="grid">
        <label className="field">Penyedia data historis<input value={hist} onChange={(e) => setHist(e.target.value)} placeholder="mis. Dukascopy (BID), OANDA via TradingView export" /></label>
        <label className="field">Penyedia berita<input value={news} onChange={(e) => setNews(e.target.value)} placeholder="mis. arsip kalender ekspor manual" /></label>
        <label className="field">Default candle riwayat di chart replay<input inputMode="numeric" value={warm} onChange={(e) => setWarm(e.target.value)} /></label>
      </div>
      <div className="row"><button className="btn" onClick={() => save({ providers: { historical: hist || null, news: news || null }, replay: { ...s.replay, warmup_candles: Number(warm) || 300 } })}>Simpan</button>{msg ? <span className="small">{msg}</span> : null}</div>
    </section>
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
  const useChat = async (id: string) => { await save({ telegram: { chatId: id } }); setChat(id); setDet(null); };
  const retry = async (id: string) => { try { await call('/api/telegram/retry', { method: 'POST', json: { id } }); } catch (e) { alert((e as Error).message); } loadLogs(); };
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Telegram</h2>
      <Status on={!!t.lastTest?.ok} error={t.lastTest?.ok === false}>
        {t.lastTest?.at ? (t.lastTest.ok ? `Terverifikasi ${fmt(t.lastTest.at, s.timezone)}` : `Tes terakhir gagal: ${t.lastTest.error}`) : 'Belum pernah diuji'}
      </Status>
      <div className="grid">
        <label className="field">Bot token {t.tokenHint ? `(tersimpan: ${t.tokenHint})` : '(belum ada)'}
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t.tokenSource === 'env' ? 'Diatur lewat env TELEGRAM_BOT_TOKEN' : '123456789:AA…'} disabled={t.tokenSource === 'env' || !t.canStoreToken} />
        </label>
        <label className="field">Chat ID {t.chatSource === 'env' ? '(dari env)' : ''}
          <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder={t.chatSource === 'env' ? t.chatId : 'mis. 123456789 atau -100…'} />
        </label>
        <label className="field">Cooldown event serupa (detik)<input inputMode="numeric" value={cool} onChange={(e) => setCool(e.target.value)} /></label>
        <label className="field">Maks pesan per menit<input inputMode="numeric" value={perMin} onChange={(e) => setPerMin(e.target.value)} /></label>
      </div>
      {!t.canStoreToken && t.tokenSource !== 'env' ? <p className="mute small" style={{ margin: 0 }}>Untuk menyimpan token dari halaman ini, atur APP_ENCRYPTION_KEY di server; atau isi TELEGRAM_BOT_TOKEN di env.</p> : null}
      <div className="row">
        <label className="switch"><input type="checkbox" checked={t.liveEnabled} onChange={(e) => save({ telegram: { liveEnabled: e.target.checked } })} />Notifikasi LIVE</label>
        <label className="switch"><input type="checkbox" checked={t.backtestEnabled} onChange={(e) => save({ telegram: { backtestEnabled: e.target.checked } })} />Notifikasi BACKTEST (simulasi)</label>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <button className="btn" onClick={detect} disabled={det?.busy}>{det?.busy ? 'Memeriksa…' : 'Cek bot & cari Chat ID'}</button>
          <span className="mute small">Simpan token dulu, kirim “halo” ke bot, lalu tekan tombol ini.</span>
        </div>
        {det && !det.busy ? (det.tokenOk ? (
          <div className="notice stack" style={{ gap: 8 }}>
            <span>Token valid: bot <strong>@{det.bot.username}</strong>.</span>
            {det.chats.length ? det.chats.map((c: any) => (
              <div key={c.id} className="row between"><span>{c.name || c.type} · <span className="num">{c.id}</span>{String(det.currentChatId) === c.id ? ' (dipakai)' : ''}</span>
                <button className="btn" onClick={() => useChat(c.id)}>Pakai Chat ID ini</button></div>
            )) : <span>{det.hint}</span>}
          </div>) : <div className="error small">{det.error}</div>) : null}
      </div>
      <div className="row">
        <button className="btn" onClick={() => { save({ telegram: { botToken: token || undefined, chatId: chat, cooldownSeconds: Number(cool), maxPerMinute: Number(perMin) } }); setToken(''); }}>Simpan Telegram</button>
        <button className="btn primary" onClick={sendTest} disabled={test?.busy}>{test?.busy ? 'Mengirim…' : 'Send Test Telegram'}</button>
        {t.tokenSource === 'database' ? <button className="btn" onClick={() => save({ telegram: { clearToken: true } })}>Hapus token tersimpan</button> : null}
        {msg ? <span className="small">{msg}</span> : null}
      </div>
      {test && !test.busy ? <div className={test.status === 'sent' ? 'notice' : 'error'}>{test.status === 'sent' ? `Dikonfirmasi Telegram (message_id ${test.messageId}).` : `Tidak terkirim: ${test.error ?? test.status}`}</div> : null}
      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>Log pengiriman</summary>
        {!logs ? <Loading what="log" /> : logs.length ? <div className="tablewrap"><table><thead><tr><th>Waktu</th><th>Mode</th><th>Status</th><th>Percobaan</th><th>Keterangan</th><th></th></tr></thead>
          <tbody>{logs.map((l) => <tr key={l.id}><td>{fmt(Date.parse(l.created_at), s.timezone, true)}</td><td>{l.mode}</td><td>{l.status}</td><td>{l.attempts}</td>
            <td className="small">{l.error ?? l.skip_reason ?? (l.telegram_message_id ? `message_id ${l.telegram_message_id}` : '')}</td>
            <td>{l.status === 'failed' ? <button className="btn" onClick={() => retry(l.id)}>Ulangi</button> : null}</td></tr>)}</tbody></table></div> : <p className="mute small">Belum ada.</p>}
      </details>
    </section>
  );
}

function TradingView({ s }: { s: any }) {
  const tv = s.tradingview;
  const [logs, setLogs] = useState<any[] | null>(null);
  useEffect(() => { call<any[]>('/api/webhooks/logs').then(setLogs).catch(() => setLogs([])); }, []);
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>TradingView webhook</h2>
      <Status on={tv.secretConfigured}>{tv.secretConfigured ? 'Secret diatur di server' : 'TRADINGVIEW_WEBHOOK_SECRET belum diatur'}</Status>
      <dl className="kv"><dt>URL webhook</dt><dd style={{ wordBreak: 'break-all' }}>{tv.webhookUrl ?? 'Atur APP_BASE_URL'}</dd>
        <dt>Allowlist IP TradingView</dt><dd>{tv.ipAllowlist ? 'aktif' : 'nonaktif'}</dd></dl>
      <p className="mute small" style={{ margin: 0 }}>Tempel JSON berikut di kotak “Message” alert. Isi zona dari indikator Anda. Alert yang lebih tua dari 15 menit ditolak — webhook tidak dipakai untuk data historis.</p>
      <pre className="small" style={{ background: '#000', border: '1px solid var(--line)', borderRadius: 8, padding: 12, overflowX: 'auto', margin: 0 }}>{ALERT_EXAMPLE}</pre>
      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>Log webhook</summary>
        {!logs ? <Loading what="log" /> : logs.length ? <div className="tablewrap"><table><thead><tr><th>Waktu</th><th>Status</th><th>HTTP</th><th>Event</th><th>Error</th></tr></thead>
          <tbody>{logs.map((l) => <tr key={l.id}><td>{fmt(Date.parse(l.received_at), s.timezone, true)}</td><td>{l.status}</td><td>{l.http_status}</td><td className="small">{l.event_uid}</td><td className="small">{l.error}</td></tr>)}</tbody></table></div> : <p className="mute small">Belum ada request.</p>}
      </details>
    </section>
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
  const [tf, setTf] = useState('H1');
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
    try { setDerive(await call('/api/import/derive', { method: 'POST', json: { source_id: src, from: tf, alignment } })); reload(); }
    catch (e) { setDerive({ error: (e as Error).message }); }
  };
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Data historis XAUUSD</h2>
      <p className="mute small" style={{ margin: 0 }}>Gunakan satu sumber yang konsisten per sesi. Harga antar broker berbeda, jadi identitas sumber, basis harga (bid/ask), zona waktu file, dan spread dicatat. Data 2019 hanya tersedia jika Anda mengimpornya.</p>
      {cov.length ? <div className="tablewrap"><table><thead><tr><th>Sumber</th><th>TF</th><th>Dari (UTC)</th><th>Sampai (UTC)</th><th>Candle</th></tr></thead>
        <tbody>{cov.map((c) => <tr key={c.source_id + c.timeframe}><td>{c.source_name}{c.is_test ? ' (TEST)' : ''}</td><td>{c.timeframe}</td><td>{fmt(c.first, 'UTC')}</td><td>{fmt(c.last, 'UTC')}</td><td>{c.candles.toLocaleString()}</td></tr>)}</tbody></table></div>
        : <p className="mute">Belum ada data yang tersimpan.</p>}

      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Tambah sumber data</summary>
        <div className="grid" style={{ marginTop: 12 }}>
          <label className="field">Nama<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Dukascopy XAUUSD BID" /></label>
          <label className="field">Penyedia<input value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} /></label>
          <label className="field">Simbol di sumber<input value={f.broker_symbol} onChange={(e) => setF({ ...f, broker_symbol: e.target.value })} placeholder="OANDA:XAUUSD" /></label>
          <label className="field">Zona waktu file<input value={f.file_timezone} onChange={(e) => setF({ ...f, file_timezone: e.target.value })} placeholder="UTC, UTC+2, Europe/Athens" /></label>
          <label className="field">Basis harga<select value={f.price_basis} onChange={(e) => setF({ ...f, price_basis: e.target.value })}>{['bid', 'ask', 'mid', 'last', 'unknown'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="field">Spread tipikal (satuan harga)<input inputMode="decimal" value={f.spread_points} onChange={(e) => setF({ ...f, spread_points: e.target.value })} placeholder="0.30" /></label>
        </div>
        <label className="field" style={{ marginTop: 12 }}>Catatan (lisensi, cara unduh)<input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="switch"><input type="checkbox" checked={f.is_test} onChange={(e) => setF({ ...f, is_test: e.target.checked })} />Sumber TEST</label>
          <button className="btn" onClick={create} disabled={!f.name || !f.provider}>Buat sumber</button>{msg ? <span className="small">{msg}</span> : null}
        </div>
      </details>

      <div className="grid">
        <label className="field">Sumber<select value={src} onChange={(e) => setSrc(e.target.value)}><option value="">— pilih —</option>{sources.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.file_timezone}){x.is_test ? ' TEST' : ''}</option>)}</select></label>
        <label className="field">Timeframe file<select value={tf} onChange={(e) => setTf(e.target.value)}>{TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="field">File CSV OHLC<input type="file" accept=".csv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      </div>
      <p className="mute small" style={{ margin: 0 }}>Format: ekspor chart TradingView (time,open,high,low,close,Volume), MetaTrader (Date,Time,…), Dukascopy (Gmt time,…), atau datetime ISO. Baris tidak valid dilaporkan, tidak diperbaiki diam-diam. Impor ulang aman (duplikat dilewati).</p>
      <div className="row">
        <button className="btn primary" onClick={upload} disabled={!file || !src}>Impor</button>
        <button className="btn" onClick={() => runDerive('utc')} disabled={!src}>Bentuk TF lebih tinggi (UTC)</button>
        <button className="btn" onClick={() => runDerive('ny_close')} disabled={!src}>… (close 17:00 New York)</button>
      </div>
      {prog ? <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{prog.error ? `Gagal: ${prog.error}` : prog.finished ? JSON.stringify(prog, null, 2) : `Mengunggah ${prog.done.toLocaleString()} / ${prog.total.toLocaleString()} baris…`}</pre> : null}
      {derive ? <pre className="small" style={{ margin: 0 }}>{derive.busy ? 'Menghitung…' : JSON.stringify(derive)}</pre> : null}
    </section>
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
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Zona SNR manual</h2>
      <p className="mute small" style={{ margin: 0 }}>Sistem tidak membuat zona sendiri. Masukkan level Anda sendiri; “berlaku sejak” adalah kapan zona itu diketahui, sehingga replay sebelum waktu tersebut tidak melihatnya.</p>
      <div className="grid">
        <label className="field">Jenis<select value={z.kind} onChange={(e) => setZ({ ...z, kind: e.target.value })}><option value="support">support</option><option value="resistance">resistance</option></select></label>
        <label className="field">Batas bawah<input inputMode="decimal" value={z.low} onChange={(e) => setZ({ ...z, low: e.target.value })} /></label>
        <label className="field">Batas atas<input inputMode="decimal" value={z.high} onChange={(e) => setZ({ ...z, high: e.target.value })} /></label>
        <label className="field">Berlaku sejak (UTC)<input type="datetime-local" value={z.valid_from} onChange={(e) => setZ({ ...z, valid_from: e.target.value })} /></label>
      </div>
      <div className="row">
        <label className="switch"><input type="checkbox" checked={z.is_test} onChange={(e) => setZ({ ...z, is_test: e.target.checked })} />Zona TEST</label>
        <button className="btn" onClick={add} disabled={!z.low || !z.high || !z.valid_from}>Tambah zona</button>{msg ? <span className="small">{msg}</span> : null}
      </div>
      {zones.length ? <div className="tablewrap"><table><thead><tr><th>Jenis</th><th>Zona</th><th>Berlaku sejak</th><th>Asal</th><th></th></tr></thead>
        <tbody>{zones.map((x) => <tr key={x.id}><td>{x.kind}</td><td className="num">{x.low} – {x.high}</td><td>{fmt(Date.parse(x.valid_from), 'UTC')} UTC</td><td>{x.origin}{x.is_test ? ' · TEST' : ''}</td>
          <td><button className="btn" onClick={() => del(x.id)}>Hapus</button></td></tr>)}</tbody></table></div> : null}
    </section>
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
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Impor dari TradingView</h2>
      <div className="grid">
        <div className="stack">
          <strong>Event indikator (CSV)</strong>
          <code className="small">event_id,timestamp,timeframe,event_type,price,zone_low,zone_high,zone_kind,strategy_version</code>
          <FileText onText={setEvText} />
          <button className="btn" onClick={() => run('/api/import/indicator-events', { text: evText, is_test: isTest })} disabled={!evText}>Impor event</button>
        </div>
        <div className="stack">
          <strong>Laporan Strategy Tester (“List of trades” CSV)</strong>
          <label className="field">Nama sesi<input value={rep.name} onChange={(e) => setRep({ ...rep, name: e.target.value })} /></label>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>Zona waktu chart<input value={rep.chart_timezone} onChange={(e) => setRep({ ...rep, chart_timezone: e.target.value })} /></label>
            <label className="field" style={{ flex: 1 }}>TF<select value={rep.timeframe} onChange={(e) => setRep({ ...rep, timeframe: e.target.value })}>{TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}</select></label>
          </div>
          <FileText onText={setRepText} />
          <button className="btn" onClick={() => run('/api/import/strategy-report', { ...rep, text: repText, is_test: isTest })} disabled={!repText || !rep.name}>Impor laporan</button>
        </div>
      </div>
      <label className="switch"><input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />Tandai sebagai TEST</label>
      {res ? <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(res, null, 2)}</pre> : null}
    </section>
  );
}

function Errors() {
  const [e, setE] = useState<any[] | null>(null);
  useEffect(() => { call<any[]>('/api/errors').then(setE).catch(() => setE([])); }, []);
  return (
    <section className="panel">
      <h2>Error sistem terbaru</h2>
      {!e ? <Loading what="log" /> : e.length ? e.map((x) => <div key={x.id} className="event small"><strong>{x.scope}</strong> · {x.occurred_at}<div className="mute">{x.message}</div></div>)
        : <p className="mute small">Tidak ada error tercatat.</p>}
    </section>
  );
}
