# Portofolio breakout swing (close M30 tembus swing plain, SL 2 ATR, exit partial), per tahun.
# Usage: python3 scripts/research/breakout_portfolio.py
import sys
import numpy as np, pandas as pd
sys.path.insert(0, 'scripts/research')
import snr_yearly as Y, snr_trend_scan as S, breakout_scan as B
LEGS = [('XAUUSD', 'D1', 'EMA200 H1'), ('XAUUSD', 'H4', 'EMA stack H1'), ('BTCUSD', 'D1', 'EMA200 H1'),
        ('USATECHIDXUSD', 'D1', 'EMA200 H1'), ('ETHUSD', 'D1', 'EMA200 H1'), ('BTCUSD', 'H4', 'EMA stack H1'),
        ('USATECHIDXUSD', 'H4', 'EMA stack H1')]
if __name__ == '__main__':
    parts = []
    for sym, tf, tr in LEGS:
        x = Y.trades(sym, tf, tr, 'partial'); x['leg'] = f'{sym} {tf}'; parts.append(x)
        print(f'{sym:14s} {tf} {tr:12s} n {len(x):5d} WR {(x.R>0).mean():.3f} PF {S.pf(x.R.values):.2f} /mgg {len(x)/((x.t.max()-x.t.min()).days/7):.2f}')
    TF_LEGS = [('XAUUSD', 'M30', ('Asia range', 'EMA200 H1', 'range', 'rr2')),
               ('USATECHIDXUSD', 'M15', ('ORB NY', 'EMA20 D1', 'range', 'partial'))]
    for sym, tf, want in TF_LEGS:
        x = B.run_symbol((sym, tf), want); x['leg'] = f'{sym} {tf} {want[0]}'; parts.append(x)
        print(f'{sym:14s} {tf} {want[0]:12s} n {len(x):5d} WR {(x.R>0).mean():.3f} PF {S.pf(x.R.values):.2f} /mgg {len(x)/((x.t.max()-x.t.min()).days/7):.2f}')
    best = [0, 1, 2, 3, 7, 8]  # XAU D1, XAU H4, BTC D1, NAS D1, XAU Asia, NAS ORB NY
    for name, idx in (('XAU D1+H4', [0, 1]), ('XAU D1+H4+Asia', [0, 1, 7]), ('6 leg terbaik', best), ('semua 9 leg', list(range(9)))):
        T = pd.concat([parts[k] for k in idx]).sort_values('t'); T = T[T.t >= '2018-01-01']
        g = T.groupby(T.t.dt.year).R.agg(n='size', wr=lambda r: (r > 0).mean(), pf=S.pf, sumR='sum')
        eq = T.R.cumsum().values; dd = (np.maximum.accumulate(np.r_[0, eq])[1:] - eq).max()
        wk = len(T) / ((T.t.max() - T.t.min()).days / 7)
        print(f'\n== {name} (2018+): n {len(T)} trade/minggu {wk:.1f} WR {(T.R>0).mean():.3f} PF {S.pf(T.R.values):.2f} totalR {T.R.sum():.0f} maxDD {dd:.1f}R')
        print(g.round(2).T.to_string())
