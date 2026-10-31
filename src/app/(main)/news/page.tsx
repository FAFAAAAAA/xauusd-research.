'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, fmt, tzShort } from '@/components/client';
import { ErrorBox, Loading } from '@/components/Status';
import { CATEGORY_LABEL } from '@/lib/core/news';
import { zonedWallTimeToUtc } from '@/lib/core/time';
import { FileText } from '@/components/FileText';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ECON_TEMPLATE = 'external_id,title,category,currency,impact,scheduled_at,schedule_available_at,forecast,previous,actual,actual_available_at,unit,source_url';
const NEWS_TEMPLATE = 'external_id,title,source_name,category,published_at,first_seen_at,url,summary';

export default function News() {
  const [tz, setTz] = useState('UTC');
  const [asOfLocal, setAsOfLocal] = useState('');
  const [d, setD] = useState<any>(null);
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
      <div>
        <h1>News & sentiment</h1>
        <p className="sub">Berita hanya dipakai sebagai konfirmasi. Pilih “lihat per waktu” untuk melihat kalender persis seperti yang diketahui pada momen itu — actual yang belum rilis disembunyikan.</p>
      </div>
      <section className="panel row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 240px' }}>Lihat per waktu ({tzShort(tz)})
          <input type="datetime-local" value={asOfLocal} onChange={(e) => setAsOfLocal(e.target.value)} />
        </label>
        <button className="btn" onClick={() => setAsOfLocal('')}>Sekarang</button>
      </section>

      {err ? <ErrorBox error={err} retry={load} /> : !d ? <Loading what="kalender" /> : (
        <section className="panel">
          <h2>Kalender ekonomi ±7 hari dari {fmt(d.asOf, tz)}</h2>
          {!d.archiveAvailable && !d.events.length ? <p><strong>DATA UNAVAILABLE</strong><br /><span className="mute small">Belum ada arsip untuk periode ini. Impor kalender di bawah.</span></p> : (
            <div className="tablewrap"><table><thead><tr><th>Jadwal</th><th>Rilis</th><th>Kategori</th><th>Dampak</th><th>Forecast</th><th>Previous</th><th>Actual</th><th>Sentimen emas</th></tr></thead>
              <tbody>{d.events.map((e: any) => (
                <tr key={e.id}>
                  <td>{fmt(e.scheduledAt, tz)}</td>
                  <td>{e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noreferrer">{e.title}</a> : e.title}{e.isTest ? ' (TEST)' : ''}<div className="mute small">{e.provider}</div></td>
                  <td>{CATEGORY_LABEL[e.category as keyof typeof CATEGORY_LABEL]}</td><td>{e.impact}</td>
                  <td className="num">{e.forecast ?? '—'}</td><td className="num">{e.previous ?? '—'}</td>
                  <td className="num">{e.released ? e.actual : <span className="mute">belum tersedia</span>}</td>
                  <td>{e.sentiment ? <span title={e.sentiment.reasoning}>{e.sentiment.label}{e.sentiment.confidence != null ? ` (${e.sentiment.confidence})` : ''}</span> : 'Unknown'}</td>
                </tr>))}</tbody></table></div>)}
          {d.articles.length ? (<>
            <h2 style={{ marginTop: 20 }}>Artikel yang sudah tersedia</h2>
            {d.articles.map((a: any) => <div key={a.id} className="event"><strong>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a> : a.title}</strong>
              <div className="mute">{a.sourceName} · tersedia {fmt(a.availableAt, tz)}</div></div>)}
          </>) : null}
        </section>
      )}

      <div className="grid">
        <ImportBox title="Impor kalender ekonomi (CSV)" endpoint="/api/import/economic" template={ECON_TEMPLATE}
          help="Waktu wajib ISO-8601 dengan zona (mis. 2019-07-12T12:30:00Z). Baris dengan actual tanpa actual_available_at ditolak. Sentimen dihitung otomatis (rule_surprise_v0) untuk CPI, PCE, NFP, Unemployment." onDone={load} />
        <ImportBox title="Impor arsip berita (CSV)" endpoint="/api/import/news" template={NEWS_TEMPLATE}
          help="available_at = waktu paling akhir antara published_at dan first_seen_at. Simpan URL sumber asli." onDone={load} />
      </div>
    </div>
  );
}

function ImportBox({ title, endpoint, template, help, onDone }: { title: string; endpoint: string; template: string; help: string; onDone: () => void }) {
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
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>{title}</h2>
      <p className="mute small" style={{ margin: 0 }}>{help}</p>
      <code className="small" style={{ wordBreak: 'break-all' }}>{template}</code>
      <label className="field">Nama penyedia / sumber<input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="mis. Forex Factory export, BLS" /></label>
      <FileText onText={setText} />
      <label className="switch"><input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />Tandai sebagai data TEST</label>
      <button className="btn primary" onClick={submit} disabled={busy || !text || !provider}>{busy ? 'Mengimpor…' : 'Impor'}</button>
      {res ? <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(res, null, 2)}</pre> : null}
    </section>
  );
}
