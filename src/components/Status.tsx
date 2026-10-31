export function Status({ on, error, children }: { on: boolean; error?: boolean; children: React.ReactNode }) {
  return <span className="row" style={{ gap: 8 }}><span className={`dot ${error ? 'err' : on ? 'on' : ''}`} aria-hidden />{children}</span>;
}
export function ModeTag({ mode, test }: { mode: string; test?: boolean }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className={`tag ${mode === 'LIVE' ? 'live' : 'bt'}`}>{mode === 'LIVE' ? 'Live' : 'Simulasi'}</span>
      {test ? <span className="tag test">Tes</span> : null}
    </span>
  );
}
export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return <div className="page-head"><h1>{title}</h1>{sub ? <p className="sub">{sub}</p> : null}{children}</div>;
}
export function Loading({ what = 'data' }: { what?: string }) {
  return (
    <div className="skeleton" role="status" aria-label={`Memuat ${what}`}>
      <span className="sk sk-lg" /><span className="sk" /><span className="sk sk-sm" />
    </div>
  );
}
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="error row between"><span>{error}</span>{retry ? <button className="btn sm" onClick={retry}>Coba lagi</button> : null}</div>;
}
