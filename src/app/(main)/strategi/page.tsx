'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { call, peek } from '@/components/client';
import { ErrorBox, Loading, PageHead } from '@/components/Status';
import { parseSignalsCsv } from '@/lib/core/signals-csv';
import { AI_GUIDE, TFS, validateDefinition, type Entry, type Filter, type RuleDefinition, type Stop } from '@/lib/core/strategy/builder';

/* eslint-disable @typescript-eslint/no-explicit-any */
type FieldSpec = { key: string; label: string; kind: 'tf' | 'int' | 'num' | 'hhmm' | 'bool' | 'days' | 'select'; def: any; options?: Array<[string, string]> };
const tf = (def = 'M15'): FieldSpec => ({ key: 'tf', label: 'Timeframe', kind: 'tf', def });

const ENTRY: Record<Entry['type'], { label: string; fields: FieldSpec[] }> = {
  donchian: { label: 'Breakout: close tembus high/low N candle', fields: [tf('H1'), { key: 'length', label: 'Jumlah candle', kind: 'int', def: 20 }] },
  session_breakout: { label: 'Breakout range sesi (jam UTC)', fields: [
    { key: 'rangeStart', label: 'Range mulai', kind: 'hhmm', def: '00:00' }, { key: 'rangeEnd', label: 'Range selesai', kind: 'hhmm', def: '07:00' },
    { key: 'windowEnd', label: 'Batas waktu entry', kind: 'hhmm', def: '11:00' }] },
  ema_cross: { label: 'EMA cepat memotong EMA lambat', fields: [tf(), { key: 'fast', label: 'EMA cepat', kind: 'int', def: 9 }, { key: 'slow', label: 'EMA lambat', kind: 'int', def: 21 }] },
  price_ema: { label: 'Harga memotong EMA', fields: [tf(), { key: 'length', label: 'Panjang EMA', kind: 'int', def: 50 }] },
  rsi: { label: 'RSI keluar dari oversold / overbought', fields: [tf(), { key: 'length', label: 'Panjang RSI', kind: 'int', def: 14 }, { key: 'low', label: 'Oversold (BUY)', kind: 'num', def: 30 }, { key: 'high', label: 'Overbought (SELL)', kind: 'num', def: 70 }] },
  bollinger: { label: 'Harga kembali masuk Bollinger Band', fields: [tf(), { key: 'length', label: 'Panjang', kind: 'int', def: 20 }, { key: 'mult', label: 'Deviasi', kind: 'num', def: 2 }] },
  macd: { label: 'MACD memotong signal', fields: [tf(), { key: 'fast', label: 'Cepat', kind: 'int', def: 12 }, { key: 'slow', label: 'Lambat', kind: 'int', def: 26 }, { key: 'signal', label: 'Signal', kind: 'int', def: 9 }] },
  candle: { label: 'Pola candle (rejection / engulfing)', fields: [tf(), { key: 'pattern', label: 'Pola', kind: 'select', def: 'rejection', options: [['rejection', 'Rejection (ekor panjang)'], ['engulfing', 'Engulfing']] }, { key: 'wickRatio', label: 'Posisi close (0.5–0.95)', kind: 'num', def: 0.6 }] },
};
const FILTER: Record<Filter['type'], { label: string; fields: FieldSpec[] }> = {
  ema_trend: { label: 'Tren EMA (BUY hanya saat naik)', fields: [tf('H4'), { key: 'fast', label: 'EMA cepat', kind: 'int', def: 50 }, { key: 'slow', label: 'EMA lambat', kind: 'int', def: 200 }, { key: 'priceAbove', label: 'Harga juga di atas EMA cepat', kind: 'bool', def: true }] },
  price_vs_ema: { label: 'Harga di atas/bawah EMA', fields: [tf('H1'), { key: 'length', label: 'Panjang EMA', kind: 'int', def: 200 }] },
  rsi_range: { label: 'RSI dalam rentang', fields: [tf('H1'), { key: 'length', label: 'Panjang RSI', kind: 'int', def: 14 }, { key: 'buyMin', label: 'BUY jika RSI ≥', kind: 'num', def: 50 }, { key: 'sellMax', label: 'SELL jika RSI ≤', kind: 'num', def: 50 }] },
  session: { label: 'Hanya jam tertentu (UTC)', fields: [{ key: 'from', label: 'Dari', kind: 'hhmm', def: '07:00' }, { key: 'to', label: 'Sampai', kind: 'hhmm', def: '17:00' }] },
  weekdays: { label: 'Hanya hari tertentu', fields: [{ key: 'days', label: 'Hari', kind: 'days', def: [1, 2, 3, 4, 5] }] },
};
const STOP: Record<Stop['type'], { label: string; fields: FieldSpec[] }> = {
  atr: { label: 'Jarak ATR dari close', fields: [tf('H1'), { key: 'mult', label: 'Kali ATR', kind: 'num', def: 2 }] },
  swing: { label: 'Di luar swing high/low terakhir', fields: [{ key: 'lookback', label: 'Lihat N candle M15', kind: 'int', def: 10 }, { key: 'bufferAtr', label: 'Buffer (× ATR M15)', kind: 'num', def: 0.1 }] },
  range: { label: 'Di sisi lain range sesi', fields: [{ key: 'bufferAtr', label: 'Buffer (× ATR M15)', kind: 'num', def: 0 }] },
  fixed: { label: 'Jarak tetap dalam $', fields: [{ key: 'distance', label: 'Jarak SL ($)', kind: 'num', def: 5 }] },
};
const defaults = (fields: FieldSpec[]) => Object.fromEntries(fields.map((f) => [f.key, f.def]));
const DAYNAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function Fields({ specs, value, onChange }: { specs: FieldSpec[]; value: any; onChange: (v: any) => void }) {
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="grid two">
      {specs.map((f) => {
        const v = value[f.key];
        if (f.kind === 'bool') return <label key={f.key} className="switch" style={{ gridColumn: '1 / -1' }}>{f.label}<input type="checkbox" checked={!!v} onChange={(e) => set(f.key, e.target.checked)} /></label>;
        if (f.kind === 'days') return (
          <div key={f.key} className="stack tight" style={{ gridColumn: '1 / -1' }}><span className="label">{f.label}</span>
            <div className="seg scroll">{DAYNAMES.map((n, i) => <button key={n} aria-pressed={(v as number[]).includes(i)} onClick={() => set(f.key, (v as number[]).includes(i) ? (v as number[]).filter((x) => x !== i) : [...v, i].sort())}>{n}</button>)}</div>
          </div>);
        if (f.kind === 'tf' || f.kind === 'select') return (
          <label key={f.key} className="field">{f.label}<select value={v} onChange={(e) => set(f.key, e.target.value)}>
            {(f.kind === 'tf' ? TFS.map((t) => [t, t] as [string, string]) : f.options!).map(([a, b]) => <option key={a} value={a}>{b}</option>)}
          </select></label>);
        return (
          <label key={f.key} className="field">{f.label}
            <input inputMode={f.kind === 'hhmm' ? 'numeric' : 'decimal'} value={String(v ?? '')} placeholder={String(f.def)}
              onChange={(e) => set(f.key, f.kind === 'hhmm' ? e.target.value : e.target.value === '' ? '' : Number(e.target.value))} />
          </label>);
      })}
    </div>
  );
}

export default function Strategies() {
  const [list, setList] = useState<any[] | null>(() => peek('/api/strategies'));
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { call<any[]>('/api/strategies').then(setList).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (definition: unknown) => {
    setMsg(null);
    const v = validateDefinition(definition);
    if (!v.ok) { setMsg({ ok: false, text: v.errors.join(' · ') }); return false; }
    try { await call('/api/strategies', { method: 'POST', json: { definition: v.def } }); setMsg({ ok: true, text: `Strategi "${v.def.name}" tersimpan. Pilih di Hasil → Backtest baru.` }); load(); return true; }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); return false; }
  };

  return (
    <div className="stack">
      <PageHead title="Strategi" sub="Tambah, impor, atau hapus strategi yang mau kamu backtest." />
      {msg ? <div className={msg.ok ? 'ok' : 'error'}>{msg.text}</div> : null}
      {err ? <ErrorBox error={err} retry={load} /> : !list ? <Loading what="strategi" /> : <StrategyList list={list} reload={load} />}

      <details className="group" open={!list?.some((s) => s.custom)}>
        <summary><span><h2>Buat strategi baru</h2><span className="s">Pilih aturan dari menu, tanpa coding</span></span></summary>
        <div className="body"><Builder onSave={save} /></div>
      </details>

      <details className="group">
        <summary><span><h2>Impor file strategi (.json)</h2><span className="s">Dari AI lain atau file yang kamu unduh</span></span></summary>
        <div className="body"><ImportJson onSave={save} /></div>
      </details>

      <details className="group">
        <summary><span><h2>Impor sinyal (.csv)</h2><span className="s">Daftar BUY/SELL + SL dari TradingView, Python, atau AI</span></span></summary>
        <div className="body"><ImportSignals onSave={save} /></div>
      </details>

      <details className="group">
        <summary><span><h2>Pakai AI lain</h2><span className="s">Teks panduan untuk ChatGPT, Gemini, dll.</span></span></summary>
        <div className="body"><AiGuide /></div>
      </details>
    </div>
  );
}

function StrategyList({ list, reload }: { list: any[]; reload: () => void }) {
  const [showHidden, setShowHidden] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const [withResults, setWithResults] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const visible = list.filter((s) => !s.is_test && s.configured && (showHidden || s.status === 'active'));
  const hidden = list.filter((s) => !s.is_test && s.configured && s.status !== 'active').length;
  const name = (s: any) => s.custom ? s.version : s.adapter_key === 'breakout_v02' ? 'Breakout v0.2' : s.adapter_key === 'snr_h4h1_m15' ? 'SNR v0.1 (sentuh zona)' : s.adapter_key === 'snr_snd_mtf_v1' ? 'Indikator TradingView kamu (SNR + SND)' : `${s.strategy_key} ${s.version}`;
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setActErr(null); try { await fn(); setAsk(null); reload(); } catch (e) { setActErr((e as Error).message); } finally { setBusy(false); } };
  const download = (s: any) => {
    const blob = new Blob([JSON.stringify(s.definition, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${s.version.replace(/[^\w-]+/g, '_')}.json`; a.click();
  };
  return (
    <section className="group stack tight">
      <div className="row between"><h2>Daftar strategi</h2><Link className="btn sm" href="/analytics">Backtest</Link></div>
      <div className="list">
        {visible.map((s) => (
          <div key={s.id} className="item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <span style={{ minWidth: 0 }}>
                <span className="t" style={{ display: 'block' }}>{name(s)}</span>
                <span className="d">{s.custom ? (s.customKind === 'signals' ? `File sinyal · ${s.signalCount ?? 0} sinyal` : 'Buatan sendiri') : 'Bawaan'}{s.status !== 'active' ? ' · disembunyikan' : ''}</span>
              </span>
              <span className="row" style={{ gap: 6, flexWrap: 'nowrap', flex: 'none' }}>
                {s.custom && s.definition ? <button className="btn sm" onClick={() => download(s)}>Unduh</button> : null}
                {s.custom
                  ? <button className="btn sm ghost" onClick={() => setAsk(s.id)}>Hapus</button>
                  : <button className="btn sm ghost" disabled={busy} onClick={() => act(() => call('/api/strategies', { method: 'PATCH', json: { id: s.id, status: s.status === 'active' ? 'retired' : 'active' } }))}>{s.status === 'active' ? 'Sembunyikan' : 'Tampilkan'}</button>}
              </span>
            </div>
            {s.description ? <span className="mute small">{s.description}</span> : null}
            {ask === s.id ? (
              <div className="error stack tight">
                <strong>Hapus "{name(s)}"?</strong>
                <label className="switch">Hapus juga semua hasil backtest-nya<input type="checkbox" checked={withResults} onChange={(e) => setWithResults(e.target.checked)} /></label>
                <div className="row">
                  <button className="btn sm" onClick={() => setAsk(null)} disabled={busy}>Batal</button>
                  <button className="btn sm danger" disabled={busy} onClick={() => act(() => call(`/api/strategies?id=${s.id}${withResults ? '&results=1' : ''}`, { method: 'DELETE' }))}>{busy ? 'Menghapus…' : 'Ya, hapus'}</button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {actErr ? <div className="error">{actErr}</div> : null}
      {hidden ? <button className="btn sm" onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Sembunyikan yang disembunyikan' : `Tampilkan yang disembunyikan (${hidden})`}</button> : null}
      <p className="mute small">Strategi bawaan tidak bisa dihapus, hanya disembunyikan. Strategi buatan sendiri bisa dihapus.</p>
    </section>
  );
}

function Builder({ onSave }: { onSave: (d: unknown) => Promise<boolean> }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [sides, setSides] = useState<'both' | 'long' | 'short'>('both');
  const [entryType, setEntryType] = useState<Entry['type']>('donchian');
  const [entry, setEntry] = useState<any>(defaults(ENTRY.donchian.fields));
  const [filters, setFilters] = useState<any[]>([{ type: 'ema_trend', ...defaults(FILTER.ema_trend.fields) }]);
  const [stopType, setStopType] = useState<Stop['type']>('atr');
  const [stop, setStop] = useState<any>(defaults(STOP.atr.fields));
  const [cooldown, setCooldown] = useState<number | ''>(0);
  const [maxStop, setMaxStop] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const def: RuleDefinition = useMemo(() => ({
    kind: 'rules', name: name.trim(), ...(desc.trim() ? { description: desc.trim() } : {}), sides,
    entry: { type: entryType, ...entry } as Entry, filters: filters as Filter[], stop: { type: stopType, ...stop } as Stop,
    ...(cooldown !== '' ? { cooldownBars: cooldown } : {}), ...(maxStop !== '' ? { maxStopAtr: maxStop } : {}),
  }), [name, desc, sides, entryType, entry, filters, stopType, stop, cooldown, maxStop]);
  const check = validateDefinition(def);
  const submit = async () => { setBusy(true); const ok = await onSave(def); setBusy(false); if (ok) setName(''); };
  return (
    <>
      <label className="field">Nama strategi<input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. EMA cross H1 + tren H4" /></label>
      <label className="field">Catatan (opsional)<input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>

      <span className="label">Arah</span>
      <div className="seg">{([['both', 'BUY + SELL'], ['long', 'BUY saja'], ['short', 'SELL saja']] as const).map(([k, l]) => <button key={k} aria-pressed={sides === k} onClick={() => setSides(k)}>{l}</button>)}</div>

      <h3>1. Kapan entry</h3>
      <label className="field">Pemicu<select value={entryType} onChange={(e) => { const t = e.target.value as Entry['type']; setEntryType(t); setEntry(defaults(ENTRY[t].fields)); if (t !== 'session_breakout' && stopType === 'range') { setStopType('atr'); setStop(defaults(STOP.atr.fields)); } }}>
        {Object.entries(ENTRY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select></label>
      <Fields specs={ENTRY[entryType].fields} value={entry} onChange={setEntry} />

      <h3>2. Syarat tambahan</h3>
      {filters.map((f, i) => (
        <div key={i} className="stack tight" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
          <div className="row between"><strong className="small">{FILTER[f.type as Filter['type']].label}</strong><button className="btn sm ghost" onClick={() => setFilters(filters.filter((_, k) => k !== i))}>Hapus</button></div>
          <Fields specs={FILTER[f.type as Filter['type']].fields} value={f} onChange={(v) => setFilters(filters.map((x, k) => (k === i ? { ...v, type: f.type } : x)))} />
        </div>
      ))}
      <label className="field">Tambah syarat<select value="" onChange={(e) => { const t = e.target.value as Filter['type']; if (t) setFilters([...filters, { type: t, ...defaults(FILTER[t].fields) }]); }}>
        <option value="">Pilih…</option>{Object.entries(FILTER).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select></label>

      <h3>3. Stop loss</h3>
      <label className="field">Cara menaruh SL<select value={stopType} onChange={(e) => { const t = e.target.value as Stop['type']; setStopType(t); setStop(defaults(STOP[t].fields)); }}>
        {Object.entries(STOP).filter(([k]) => k !== 'range' || entryType === 'session_breakout').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select></label>
      <Fields specs={STOP[stopType].fields} value={stop} onChange={setStop} />
      <p className="mute small">Take profit diuji otomatis: RR 1:1, 1:2, 1:3.</p>

      <details className="more">
        <summary>Lainnya</summary>
        <div className="grid two">
          <label className="field">Jeda antar sinyal (candle M15)<input inputMode="numeric" value={cooldown} onChange={(e) => setCooldown(e.target.value === '' ? '' : Number(e.target.value))} /></label>
          <label className="field">Lewati jika SL &gt; … × ATR M15<input inputMode="decimal" value={maxStop} placeholder="kosong = tidak dibatasi" onChange={(e) => setMaxStop(e.target.value === '' ? '' : Number(e.target.value))} /></label>
        </div>
        <pre>{JSON.stringify(def, null, 2)}</pre>
      </details>
      {!check.ok && name.trim() ? <div className="error">{check.errors.join(' · ')}</div> : null}
      <button className="btn primary block" onClick={submit} disabled={busy || !check.ok}>{busy ? 'Menyimpan…' : 'Simpan strategi'}</button>
    </>
  );
}

function readFile(onText: (t: string, name: string) => void) {
  return (e: { target: HTMLInputElement }) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => onText(t, f.name)); };
}

function ImportJson({ onSave }: { onSave: (d: unknown) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setErr(null);
    let d: unknown;
    try { d = JSON.parse(text.trim().replace(/^```(json)?/i, '').replace(/```$/, '')); } catch { setErr('Isi bukan JSON yang valid. Pastikan hanya JSON tanpa teks lain.'); return; }
    if (await onSave(d)) setText('');
  };
  return (
    <>
      <p className="mute small">Pilih file .json, atau tempel isi JSON dari AI lain di kotak di bawah.</p>
      <input type="file" accept=".json,application/json,.txt" onChange={readFile((t) => setText(t))} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder='{"kind":"rules","name":"…", …}' />
      {err ? <div className="error">{err}</div> : null}
      <button className="btn primary block" onClick={go} disabled={!text.trim()}>Periksa & simpan</button>
    </>
  );
}

function ImportSignals({ onSave }: { onSave: (d: unknown) => Promise<boolean> }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const parsed = useMemo(() => (text ? parseSignalsCsv(text) : null), [text]);
  return (
    <>
      <p className="mute small">Kolom: <code>time,side,stop_loss</code>. Waktu = jam buka candle M15 sinyal (UTC), mis. <code>2024-03-05 14:15</code>. Side = BUY atau SELL. Entry di open candle berikutnya, TP diuji RR 1:1–1:3.</p>
      <label className="field">Nama<input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Sinyal indikator X 2024" /></label>
      <input type="file" accept=".csv,.txt,text/csv" onChange={readFile((t, n) => { setText(t); if (!name) setName(n.replace(/\.[^.]+$/, '').slice(0, 60)); })} />
      {parsed ? (
        <div className={parsed.signals.length ? 'ok' : 'error'}>
          {parsed.signals.length} sinyal terbaca ({parsed.signals.filter((s) => s[1] > 0).length} BUY, {parsed.signals.filter((s) => s[1] < 0).length} SELL)
          {parsed.errors.length ? <><br />Baris dilewati: {parsed.errors.join(' · ')}</> : null}
        </div>
      ) : null}
      <button className="btn primary block" disabled={!parsed?.signals.length || !name.trim()}
        onClick={async () => { if (await onSave({ kind: 'signals', name: name.trim(), signals: parsed!.signals })) { setText(''); setName(''); } }}>Simpan sebagai strategi</button>
    </>
  );
}

function AiGuide() {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(AI_GUIDE); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* user can select the text */ } };
  return (
    <>
      <ol className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
        <li>Tekan <strong>Salin panduan</strong>.</li>
        <li>Buka AI lain, tempel panduan, lalu jelaskan strategimu (mis. &quot;BUY saat EMA 9 memotong EMA 21 di M15, hanya kalau H4 naik, SL 2 ATR H1&quot;).</li>
        <li>Salin JSON jawabannya, lalu tempel di <strong>Impor file strategi</strong>.</li>
      </ol>
      <button className="btn primary block" onClick={copy}>{copied ? 'Tersalin' : 'Salin panduan'}</button>
      <details className="more"><summary>Lihat isi panduan</summary><pre>{AI_GUIDE}</pre></details>
    </>
  );
}
