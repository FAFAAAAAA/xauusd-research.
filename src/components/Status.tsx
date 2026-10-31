export function Status({ on, error, children }: { on: boolean; error?: boolean; children: React.ReactNode }) {
  return <span className="row" style={{ gap: 8 }}><span className={`dot ${error ? 'err' : on ? 'on' : ''}`} aria-hidden />{children}</span>;
}
export function ModeTag({ mode, test }: { mode: string; test?: boolean }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className={`tag ${mode === 'LIVE' ? 'live' : 'bt'}`}>{mode === 'LIVE' ? 'LIVE' : 'BACKTEST'}</span>
      {test ? <span className="tag test">TEST</span> : null}
    </span>
  );
}
export function Loading({ what = 'data' }: { what?: string }) { return <p className="skeleton">Memuat {what}…</p>; }
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="error row between"><span>{error}</span>{retry ? <button className="btn" onClick={retry}>Coba lagi</button> : null}</div>;
}
