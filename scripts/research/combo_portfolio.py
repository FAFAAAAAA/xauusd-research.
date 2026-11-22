# Uji portofolio per tahun: DO atau FVG, NY 13-16 UTC, searah EMA200 H1, SL 2 ATR, RR 1:2.
# Usage: python3 scripts/research/combo_portfolio.py oldcrypto|newcrypto|fx
import sys, json, numpy as np, pandas as pd
sys.path.insert(0, 'scripts/research')
import combo_scan as cs
from respect_scan import load, cls, ema, levels, FX_COST
from multiprocessing import Pool
SESSION = range(13, 16)
def trades(sym, s=2.0, ex='rr2', sess=SESSION, trend=True):
    t, o, h, l, c = load(sym); crypto = cls(sym) == 'CRYPTO'
    cost = 0.0008 * c if crypto else np.full(len(c), FX_COST[sym])
    tr = np.maximum(h - l, np.maximum(abs(h - np.r_[c[0], c[:-1]]), abs(l - np.r_[c[0], c[:-1]])))
    atr = np.r_[np.nan, pd.Series(tr).rolling(14).mean().values[:-1]]
    L = levels(t, o, h, l, c, crypto, atr); pc = np.r_[np.nan, c[:-1]]; e400 = np.r_[np.nan, ema(c, 400)[:-1]]
    hr = (t // 60) % 24; base = np.isfinite(atr) & (atr > 0); day = (t + (0 if crypto else 120)) // 1440
    sm = np.isin(hr, list(sess)); lf = sm & ((pc > e400) if trend else True); sf = sm & ((pc < e400) if trend else True)
    parts = []
    for nm in ('Daily Open', 'FVG M30'):
        sup, res = L[nm]
        lt = base & np.isfinite(sup) & (l <= sup) & (pc > sup) & (o > sup) & lf
        st = base & np.isfinite(res) & (h >= res) & (pc < res) & (o < res) & sf
        li, si = np.nonzero(lt)[0], np.nonzero(st)[0]
        cd = pd.DataFrame({'i': np.r_[li, si], 'side': np.r_[np.ones(len(li), int), -np.ones(len(si), int)], 'lv': np.r_[sup[li], res[si]]})
        cd['d'] = day[cd.i.values]; parts.append(cd.drop_duplicates(['side', 'lv', 'd']))
    cd = pd.concat(parts).drop_duplicates('i').sort_values('i')
    r = cs.sim(list(zip(cd.i.values, cd.side.values, cd.lv.values)), h, l, c, atr, cost, s, ex, t)
    return pd.DataFrame({'sym': sym, 't': pd.to_datetime(r[:, 0], unit='m'), 'R': r[:, 1]}) if len(r) else None
if __name__ == '__main__':
    m = json.load(open('data/market/manifest.json'))
    first = {v['symbol']: v['first'] for v in m.values() if v['tf'] == 'M30'}
    grp = sys.argv[1]
    if grp == 'oldcrypto':
        syms = [s for s in first if cls(s) == 'CRYPTO' and s not in ('BTCUSD', 'ETHUSD') and first[s] < pd.Timestamp('2024-07-01').value // 10**6]
    elif grp == 'newcrypto':
        syms = [s for s in first if cls(s) == 'CRYPTO' and s not in ('BTCUSD', 'ETHUSD') and first[s] >= pd.Timestamp('2024-07-01').value // 10**6]
    else:
        syms = [s for s in first if cls(s) != 'CRYPTO']
    with Pool(4) as p: T = pd.concat([x for x in p.map(trades, syms) if x is not None])
    T = T.sort_values('t'); T['y'] = T.t.dt.year
    pf = lambda x: x[x > 0].sum() / -x[x < 0].sum()
    g = T.groupby('y').R.agg(n='size', wr=lambda x: (x > 0).mean(), pf=pf, sumR='sum')
    g['koin_aktif'] = T.groupby('y').sym.nunique()
    print(grp, len(syms), 'koin'); print(g.round(2).to_string())
    eq = T.R.cumsum().values; dd = (np.maximum.accumulate(eq) - eq).max()
    wk = T.set_index('t').R.resample('W').size()
    print('total n', len(T), 'WR', round((T.R > 0).mean(), 3), 'PF', round(pf(T.R), 3), 'maxDD R', round(dd, 1), 'trade/minggu median', wk[wk > 0].median())
    if grp == 'fx':
        print(T.groupby('sym').R.agg(n='size', wr=lambda x: (x > 0).mean(), pf=pf).round(2))
