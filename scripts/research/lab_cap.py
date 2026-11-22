# Portofolio dengan batas posisi terbuka bersamaan (seperti bot sungguhan): trade baru dilewati bila slot penuh.
# Usage: python3 scripts/research/lab_cap.py "<signal>" "<trend>" <sl_atr> <hold> kripto|non-kripto <cap,cap,...>
import sys
import numpy as np, pandas as pd
from functools import partial
from multiprocessing import Pool
sys.path.insert(0, 'scripts/research')
import strat_lab as L, snr_trend_scan as S, lab_yearly as Y

def capped(T, cap):
    T = T.sort_values('t'); ex = (T.t + pd.to_timedelta(T.hold_h, unit='h')).values; tv = T.t.values
    keep = np.zeros(len(T), bool); open_ex = []
    for k in range(len(T)):
        open_ex = [e for e in open_ex if e > tv[k]]
        if len(open_ex) < cap: keep[k] = True; open_ex.append(ex[k])
    return T[keep]

if __name__ == '__main__':
    sig, trend, k, hold, grp = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], sys.argv[5]
    with Pool(4) as p: T = pd.concat(p.map(partial(L.run, want=(sig, trend, k, hold)), Y.universe(grp)))
    for cap in [int(x) for x in sys.argv[6].split(',')]:
        Y.report(capped(T, cap), f'maks {cap} posisi')
