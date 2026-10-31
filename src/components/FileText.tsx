'use client';
/** Reads a small text/CSV file in the browser (or accepts pasted text). */
export function FileText({ onText, accept = '.csv,.txt' }: { onText: (t: string) => void; accept?: string }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input type="file" accept={accept} onChange={async (e) => { const f = e.target.files?.[0]; if (f) onText(await f.text()); }} />
      <textarea placeholder="…atau tempel isi CSV di sini" onChange={(e) => onText(e.target.value)} />
    </div>
  );
}
