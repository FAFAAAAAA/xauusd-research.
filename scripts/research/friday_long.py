# Pola waktu kripto: BUY Jumat jam H UTC (close candle M30 yang buka H:00), SL 3 ATR M30, TP 6 ATR (RR 1:2), tutup paksa 8 jam.
# Usage: python3 scripts/research/friday_long.py [H ...]
import sys
import numpy as np, pandas as pd
from multiprocessing import Pool
from functools import partial
sys.path.insert(0, 'scripts/research')
import new_ideas as N, snr_trend_scan as S

def trades(sym, H, dow=4, side=1, k=3.0, hold=16):
    P = N.prep(sym); t = P['t']
    ii = np.nonzero((t % 1440 == H * 60) & ((((t // 1440) + 3) % 7) == dow) & np.isfinite(P['atr']))[0]
    cand = [(int(i), side, P['c'][i], P['c'][i] - side * k * P['atr'][i], False) for i in ii]
    r = N.sim(P, cand, hold)
    return pd.DataFrame({'sym': sym, 't': pd.to_datetime(r[:, 0], unit='m'), 'R': r[:, 1], 'hold_h': r[:, 2] * 0.5})

def show(T, label):
    wk = T.groupby(T.t.dt.to_period('W')).R.sum()  # semua koin di minggu yang sama = satu "taruhan"
    for nm, m in (('<2022', T.t < '2022'), ('2022-2026', T.t >= '2022')):
        x = T[m]; w = wk[[p.start_time < pd.Timestamp('2022') if nm == '<2022' else p.start_time >= pd.Timestamp('2022') for p in wk.index]]
        eq = x.R.cumsum().values; dd = (np.maximum.accumulate(np.r_[0, eq])[1:] - eq).max()
        print(f'{label} {nm}: n {len(x)} WR {(x.R>0).mean()*100:.1f}% PF {S.pf(x.R.values):.2f} totalR {x.R.sum():.0f} maxDD {dd:.0f}R | '
              f'minggu untung {(w>0).mean()*100:.0f}% dari {len(w)}')
    print('  PF per tahun:', {k: round(S.pf(v.values), 2) for k, v in T.groupby(T.t.dt.year).R})

if __name__ == '__main__':
    for H in [int(x) for x in sys.argv[1:]] or [20]:
        with Pool(4) as p: T = pd.concat(p.map(partial(trades, H=H), N.CRYPTO))
        show(T, f'Jumat {H:02d}:00 UTC, 38 koin')
        show(T[T.sym.isin(['BTCUSD', 'ETHUSD'])], f'Jumat {H:02d}:00 UTC, BTC+ETH')
