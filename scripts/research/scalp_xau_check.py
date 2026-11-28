# Cek per tahun + uji biaya lebih mahal untuk scalp XAU: close M1 tembus swing D1, SL k ATR M5, RR 2, maks 60 menit.
# Usage: python3 scripts/research/scalp_xau_check.py
import sys
import numpy as np, pandas as pd
sys.path.insert(0, 'scripts/research')
import scalp_xau as X, snr_trend_scan as S

if __name__ == '__main__':
    d = X.data(); V = X.variants(d); base = V['D1 break']; atr = d['atr']
    for k in (2.0, 3.0):
        for bps in (1.5, 2.5, 3.5):
            d['cost'] = bps * 1e-4 * d['c']
            cc = [(i, sd, e, e - sd * k * atr[i], tch) for i, sd, e, _, tch in base]
            r = X.sim(cc, 2.0, 60, d)
            T = pd.DataFrame({'t': pd.to_datetime(r[:, 0], unit='m'), 'R': r[:, 1]})
            a, b = T[T.t < '2022'], T[T.t >= '2022']
            line = f'SL {k} ATR M5 | biaya {bps} bps (~${bps*0.2:.2f} di harga 2000): 2010-21 PF {S.pf(a.R.values):.2f} WR {(a.R>0).mean()*100:.0f}% | 2022-26 n {len(b)} PF {S.pf(b.R.values):.2f} WR {(b.R>0).mean()*100:.0f}%'
            print(line)
            if bps == 1.5:
                print('   PF per tahun:', {y: round(S.pf(v.values), 2) for y, v in T.groupby(T.t.dt.year).R})
    d['cost'] = 1.5e-4 * d['c']
    risk = np.array([k * atr[i] for i, *_ in base]) if False else None
    print('rata-rata SL (SL 2 ATR M5) 2022+: $%.2f' % np.nanmean([2 * atr[i] for i, *_ in base if d['t'][i] >= X.SPLIT]))
