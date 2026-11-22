# Portofolio per tahun untuk satu aturan strat_lab di sekelompok simbol.
# Usage: python3 scripts/research/lab_yearly.py "<signal>" "<trend>" <sl_atr> <hold> kripto|non-kripto|SYM,SYM
import sys, json
import numpy as np, pandas as pd
from functools import partial
from multiprocessing import Pool
sys.path.insert(0, 'scripts/research')
import strat_lab as L, snr_trend_scan as S
from respect_scan import cls

def universe(g):
    m = json.load(open('data/market/manifest.json'))
    old = sorted(v['symbol'] for v in m.values() if v['tf'] == 'M30' and v['first'] < pd.Timestamp('2021-01-01').value // 10**6)
    if g == 'kripto': return [s for s in old if cls(s) == 'CRYPTO']
    if g == 'non-kripto': return [s for s in old if cls(s) != 'CRYPTO']
    return g.split(',')

def report(T, label):
    for nm, x in (('<2022', T[T.t < '2022']), ('2022-2026', T[T.t >= '2022'])):
        eq = x.R.cumsum().values; dd = (np.maximum.accumulate(np.r_[0, eq])[1:] - eq).max()
        print(f'{label} {nm}: n {len(x)} trade/minggu {len(x)/max(1,(x.t.max()-x.t.min()).days/7):.1f} WR {(x.R>0).mean()*100:.1f}% '
              f'PF {S.pf(x.R.values):.2f} totalR {x.R.sum():.0f} maxDD {dd:.0f}R tahan median {x.hold_h.median():.1f}j')
    y = T.groupby(T.t.dt.year).R
    print('  PF per tahun:', {k: round(S.pf(v.values), 2) for k, v in y}, flush=True)

if __name__ == '__main__':
    sig, trend, k, hold, grp = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], sys.argv[5]
    syms = universe(grp)
    with Pool(4) as p: T = pd.concat(p.map(partial(L.run, want=(sig, trend, k, hold)), syms)).sort_values('t')
    report(T, f'{sig} | {trend} | SL{k} | {hold} | {grp}')
    ps = T.groupby('sym').apply(lambda x: pd.Series({'pf_is': S.pf(x[x.t < '2022'].R.values), 'pf_wf': S.pf(x[x.t >= '2022'].R.values)}), include_groups=False)
    keep = ps[ps.pf_is > 1].index  # pilih simbol dari data < 2022 saja
    report(T[T.sym.isin(keep)], f'  hanya simbol PF<2022 > 1 ({len(keep)}/{len(ps)})')
