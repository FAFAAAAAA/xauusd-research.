'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, fmt, peek, tzShort } from '@/components/client';
import { ErrorBox, Loading, PageHead } from '@/components/Status';
import { CATEGORY_LABEL } from '@/lib/core/news';
import { zonedWallTimeToUtc } from '@/lib/core/time';
import { FileText } from '@/components/FileText';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ECON_TEMPLATE = 'external_id,title,category,currency,impact,scheduled_at,schedule_available_at,forecast,previous,actual,actual_available_at,unit,source_url';
const NEWS_TEMPLATE = 'external_id,title,source_name,category,published_at,first_seen_at,url,summary';
const GOLD: Record<string, { t: string; c: string }> = {
  Bullish: { t: 'Emas naik', c: 'buy' }, Bearish: { t: 'Emas turun', c: 'sell' }, Neutral: { t: 'Netral', c: '' },
};

export default function News() {
  const [tz, setTz] = useState('UTC');
  const [asOfLocal, setAsOfLocal] = useState('');
  const [d, setD] = useState<any>(() => peek('/api/news'));
  const [err, setErr] = useState<string | null>(null);

  const asOfUtc = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(asOfLocal);
    return m ? zonedWallTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], 0, tz) : null;
  })();
  const load = useCallback(() => {
    setErr(null);
    const q = asOfUtc ? `?as_of=${encodeURIComponent(new Date(asOfUtc).toISOString())}` : '';
    call<any>(`/api/news${q}`).then(setD).catch((e) => setErr(e.message));
  }, [asOfUtc]);
  useEffect(() => { call<any>('/api/settings').then((s) => setTz(s.timezone)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="stack">
      <PageHead title="Berita" sub="Jadwal rilis ekonomi yang biasa menggerakkan emas." />

      <section className="group stack">
        <div className="row between">
          <h2>{asOfLocal ? `Per ${fmt(d?.asOf ?? null, tz)}` : 'Minggu ini'}</h2>
          {asOfLocal ? <button className="btn sm" onClick={() => setAsOfLocal('')}>Kembali ke sekarang</button> : null}
        </div>
        {err ? <ErrorBox error={err} retry={load} /> : !d ? <Loading what="kalender" /> : !d.events.length ? (
          <p className="mute">Belum ada jadwal untuk tanggal ini. Impor kalender di bawah.</p>
        ) : (
          <div className="list">
            {d.events.map((e: any) => {
              const g = e.sentiment ? GOLD[e.sentiment.label] : null;
              return (
                <div key={e.id} className="item" style={{ alignItems: 'flex-start' }}>
                  <span style={{ minWidth: 0 }}>
                    <span className="t" style={{ display: 'block' }}>{e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noreferrer">{e.title}</a> : e.title}</span>
                    <span className="d" style={{ display: 'block' }}>{fmt(e.scheduledAt, tz)} · {CATEGORY_LABEL[e.category as keyof typeof CATEGORY_LABEL] ?? e.category}</span>
                    <span className="d" style={{ display: 'block' }}>
                      {e.released ? `Hasil ${e.actual}` : 'Belum rilis'}{e.forecast != null ? ` · perkiraan ${e.forecast}` : ''}{e.previous != null ? ` · sebelumnya ${e.previous}` : ''}
                    </span>
                  </span>
                  <span className="stack tight" style={{ alignItems: 'flex-end', flex: 'none' }}>
                    {e.impact === 'high' ? <span className="tag sell">Penting</span> : e.impact === 'medium' ? <span className="tag">Sedang</span> : null}
                    {g ? <span className={`tag ${g.c}`} title={e.sentiment.reasoning}>{g.t}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {d?.articles?.length ? (
          <div className="list" style={{ marginTop: 8 }}>
            {d.articles.map((a: any) => (
              <div key={a.id} className="item"><span style={{ minWidth: 0 }}>
                <span className="t" style={{ display: 'block' }}>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a> : a.title}</span>
                <span className="d">{a.sourceName} · {fmt(a.availableAt, tz)}</span></span></div>
            ))}
          </div>
        ) : null}
        <details className="more">
          <summary>Lihat seperti di tanggal lain</summary>
          <label className="field">Tanggal & jam ({tzShort(tz)})
            <input type="datetime-local" value={asOfLocal} onChange={(e) => setAsOfLocal(e.target.value)} />
          </label>
          <p className="mute small">Hasil rilis yang belum keluar pada waktu itu tetap disembunyikan.</p>
        </details>
      </section>

      <details className="group">
        <summary><span><h2>Impor kalender ekonomi</h2><span className="s">File CSV jadwal & hasil rilis</span></span></summary>
        <div className="body"><ImportBox endpoint="/api/import/economic" template={ECON_TEMPLATE}
          help="Waktu harus lengkap dengan zona, mis. 2019-07-12T12:30:00Z. Sentimen emas dihitung otomatis untuk CPI, PCE, NFP, dan pengangguran." onDone={load} /></div>
      </details>
      <details className="group">
        <summary><span><h2>Impor arsip berita</h2><span className="s">File CSV judul berita</span></span></summary>
        <div className="body"><ImportBox endpoint="/api/import/news" template={NEWS_TEMPLATE}
          help="Simpan link sumber aslinya di kolom url." onDone={load} /></div>
      </details>
    </div>
  );
}

function ImportBox({ endpoint, template, help, onDone }: { endpoint: string; template: string; help: string; onDone: () => void }) {
  const [provider, setProvider] = useState('');
  const [text, setText] = useState('');
  const [isTest, setIsTest] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { setRes(await call(endpoint, { method: 'POST', json: { provider, text, is_test: isTest } })); onDone(); }
    catch (e) { setRes({ error: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <>
      <p className="mute small">{help}</p>
      <label className="field">Nama sumber<input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="mis. Forex Factory" /></label>
      <FileText onText={setText} />
      <label className="switch">Data uji coba<input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} /></label>
      <button className="btn primary block" onClick={submit} disabled={busy || !text || !provider}>{busy ? 'Mengimpor…' : 'Impor'}</button>
      {res ? (res.error ? <div className="error">{res.error}</div>
        : <div className="ok">Selesai: {res.inserted ?? res.saved ?? 0} baru{res.updated ? `, ${res.updated} diperbarui` : ''}{res.issues?.length ? `, ${res.issues.length} baris ditolak` : ''}.</div>) : null}
      {res?.issues?.length ? <pre>{res.issues.slice(0, 10).map((i: any) => `Baris ${i.line}: ${i.message}`).join('\n')}</pre> : null}
      <details className="more"><summary>Format kolom</summary><code>{template}</code></details>
    </>
  );
}
