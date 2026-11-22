# Satu aturan untuk semua instrumen non-kripto: M30, tembus swing D1, searah EMA200 H1, SL 3 ATR M30, RR 1:2, maks 8 jam.
# Aturan dipilih dari peringkat data < 2022 (lihat RESPECT_SCAN.md tahap 6); di sini hasil per periode.
# Usage: python3 scripts/research/wf_universal.py
import sys
import numpy as np, pandas as pd
sys.path.insert(0, 'scripts/research')
import fast_breakout_scan as F, snr_trend_scan as S
from multiprocessing import Pool
SYMS = ['XAUUSD', 'USATECHIDXUSD', 'USA30IDXUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'USDCHF', 'BTCUSD', 'ETHUSD']
RULE = ('D1', 'EMA200 H1', 3.0, 8, 'rr2')
def one(s):
    x = F.run(f'{s}:M30', RULE); x['sym'] = s; return x
if __name__ == '__main__':
    with Pool(4) as p: T = pd.concat(p.map(one, SYMS)).sort_values('t')
    for s, x in T.groupby('sym'):
        a, b = x[x.t < '2022'].R.values, x[x.t >= '2022'].R.values
        print(f'{s:14s} <2022 PF {S.pf(a):.2f} | >=2022 n {len(b):4d} WR {(b>0).mean()*100:.1f}% PF {S.pf(b):.2f}')
    for nm, x in (('2018-2021', T[(T.t >= '2018') & (T.t < '2022')]), ('2022-2026', T[T.t >= '2022'])):
        eq = x.R.cumsum().values; dd = (np.maximum.accumulate(np.r_[0, eq])[1:] - eq).max()
        wk = x.set_index('t').R.resample('W').size()
        print(f'PORTOFOLIO {nm}: n {len(x)} trade/minggu {len(x)/((x.t.max()-x.t.min()).days/7):.1f} (minggu >= 8: {(wk>=8).mean()*100:.0f}%) '
              f'WR {(x.R>0).mean()*100:.1f}% PF {S.pf(x.R.values):.2f} totalR {x.R.sum():.0f} maxDD {dd:.1f}R tahan median {x.hold_h.median():.1f}j')
        print(x.groupby(x.t.dt.year).R.agg(n='size', wr=lambda r: (r > 0).mean(), pf=S.pf, sumR='sum').round(2).T.to_string())
