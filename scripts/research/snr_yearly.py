# Uji per tahun: breakout swing S/R (plain, close tembus, SL 2 ATR M30) + filter tren.
# Usage: python3 scripts/research/snr_yearly.py SYM TF TREND EXIT   (mis. XAUUSD D1 "EMA200 H1" partial)
import sys
import numpy as np, pandas as pd
sys.path.insert(0, 'scripts/research')
from respect_scan import load, cls, cost_array
import snr_trend_scan as S

def trades(sym, tf, trend, ex, s=2.0):
    t, o, h, l, c = load(sym); crypto = cls(sym) == 'CRYPTO'
    cost = cost_array(sym, c); pcl = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(abs(h - pcl), abs(l - pcl)))
    atr = np.r_[np.nan, pd.Series(tr).rolling(14).mean().values[:-1]]; pc = np.r_[np.nan, c[:-1]]
    tfm = {'H1': (60, 3), 'H4': (240, 3), 'D1': (1440, 2)}[tf]
    ev = S.pivots(t, h, l, *tfm); T = S.trends(t, c, crypto, S.pivots(t, h, l, 240, 3))[trend]
    sup, res = S.sr_sets(t, h, l, c, atr, ev)['plain']
    base = np.isfinite(atr) & (atr > 0)
    lm = base & np.isfinite(res) & (c > res) & (pc < res) & ((T == 1) | (T == 2))
    sm = base & np.isfinite(sup) & (c < sup) & (pc > sup) & ((T == -1) | (T == 2))
    li, si = np.nonzero(lm)[0], np.nonzero(sm)[0]
    cd = pd.DataFrame({'i': np.r_[li, si], 'side': np.r_[np.ones(len(li), int), -np.ones(len(si), int)], 'lv': np.r_[res[li], sup[si]]})
    cd['d'] = t[cd.i.values] // 1440; cd = cd.drop_duplicates(['side', 'lv', 'd']).sort_values('i')
    i_, sd = cd.i.values, cd.side.values; e = c[i_]; sl = e - sd * s * atr[i_]
    r = S.sim([(a, b, x, y, False) for a, b, x, y in zip(i_, sd, e, sl)], h, l, c, cost, ex, t)
    return pd.DataFrame({'t': pd.to_datetime(r[:, 0], unit='m'), 'R': r[:, 1]})

if __name__ == '__main__':
    sym, tf, trend, ex = sys.argv[1:5]
    T = trades(sym, tf, trend, ex)
    g = T.groupby(T.t.dt.year).R.agg(n='size', wr=lambda x: (x > 0).mean(), pf=S.pf, sumR='sum')
    eq = T.R.cumsum().values; dd = (np.maximum.accumulate(np.r_[0, eq])[1:] - eq).max()
    print(f'{sym} {tf} {trend} {ex}: n {len(T)} WR {(T.R>0).mean():.3f} PF {S.pf(T.R.values):.2f} totalR {T.R.sum():.1f} maxDD {dd:.1f}R tahun PF>1: {(g.pf>1).sum()}/{len(g)}')
    print(g.round(2).T.to_string())
