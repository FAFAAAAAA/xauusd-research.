# Portofolio breakout intraday: semua trade ditutup maksimal 4-8 jam.
# Usage: python3 scripts/research/fast_portfolio.py
import sys
import numpy as np, pandas as pd
sys.path.insert(0, 'scripts/research')
import fast_breakout_scan as F, breakout_scan as B, snr_trend_scan as S
LEGS = [  # (nama, fungsi)
    ('XAU M5  tembus swing D1, EMA200 H1, SL3, 4j, parsial', lambda: F.run('XAUUSD:M5', ('D1', 'EMA200 H1', 3.0, 4, 'partial'))),
    ('XAU M30 tembus swing D1, Struktur H4, SL2, 8j, parsial', lambda: F.run('XAUUSD:M30', ('D1', 'Struktur H4', 2.0, 8, 'partial'))),
    ('XAU M30 range Asia, EMA200 H1, SL range, 8j, RR2', lambda: B.run_symbol(('XAUUSD', 'M30'), ('Asia range', 'EMA200 H1', 'range', 'rr2'), 8)),
    ('NAS M15 ORB NY, EMA20 D1, SL range, 4j, parsial', lambda: B.run_symbol(('USATECHIDXUSD', 'M15'), ('ORB NY', 'EMA20 D1', 'range', 'partial'), 4)),
    ('NAS M30 tembus swing D1, EMA200 H1, SL3, 8j, RR2', lambda: F.run('USATECHIDXUSD:M30', ('D1', 'EMA200 H1', 3.0, 8, 'rr2'))),
    ('BTC M30 tembus swing D1, Struktur H4, SL2, 8j, parsial', lambda: F.run('BTCUSD:M30', ('D1', 'Struktur H4', 2.0, 8, 'partial'))),
    ('USDJPY M15 tembus swing D1, EMA20 D1, SL3, 8j, parsial', lambda: F.run('USDJPY:M15', ('D1', 'EMA20 D1', 3.0, 8, 'partial'))),
]
if __name__ == '__main__':
    parts = []
    for nm, fn in LEGS:
        x = fn(); x['leg'] = nm; parts.append(x)
        a, b = x[(x.t >= '2018') & (x.t < '2022')].R.values, x[x.t >= '2022'].R.values
        print(f'{nm:58s} n {len(x):5d} /mgg {len(x)/((x.t.max()-x.t.min()).days/7):.2f} WR {(x.R>0).mean():.3f} PF {S.pf(x.R.values):.2f} | 18-21 PF {S.pf(a):.2f} | 22-26 PF {S.pf(b):.2f} | tahan median {x.hold_h.median():.1f}j p90 {x.hold_h.quantile(.9):.1f}j')
    T = pd.concat(parts).sort_values('t'); T = T[(T.t >= '2018-01-01') & (T.t < '2026-01-01')]  # M5 XAU berakhir Jan 2026
    g = T.groupby(T.t.dt.year).R.agg(n='size', wr=lambda r: (r > 0).mean(), pf=S.pf, sumR='sum')
    eq = T.R.cumsum().values; dd = (np.maximum.accumulate(np.r_[0, eq])[1:] - eq).max()
    wk = T.set_index('t').R.resample('W').size()
    print(f'\n== Portofolio 2018-2025: n {len(T)} trade/minggu {len(T)/(8*52.18):.1f} (minggu < 8 trade: {(wk<8).mean()*100:.0f}%) WR {(T.R>0).mean():.3f} PF {S.pf(T.R.values):.2f} totalR {T.R.sum():.0f} maxDD {dd:.1f}R tahan median {T.hold_h.median():.1f}j')
    print(g.round(2).T.to_string())
