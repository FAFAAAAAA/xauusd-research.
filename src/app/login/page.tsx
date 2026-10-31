'use client';
import { useState } from 'react';

export default function Login() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(b.error ?? 'Gagal masuk');
    const next = new URLSearchParams(window.location.search).get('next');
    window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  };
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form onSubmit={submit} className="panel stack" style={{ width: 'min(380px, 100%)' }}>
        <div>
          <h1>XAUUSD Research</h1>
          <p className="mute small" style={{ margin: 0 }}>Masuk sebagai admin untuk membuka dashboard.</p>
        </div>
        <label className="field">Password admin
          <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </label>
        {err ? <div className="error small">{err}</div> : null}
        <button className="btn primary" disabled={busy || !pw}>{busy ? 'Memeriksa…' : 'Masuk'}</button>
      </form>
    </main>
  );
}
