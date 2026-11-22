# Seleksi walk-forward: pilih setup RR 1:2 (maks tahan 8 jam) HANYA dari data < 2022, lalu uji portofolio di >= 2022.
# Aturan seleksi dikunci sebelum melihat hasil >= 2022:
#   n_is >= 60, pf_is >= 1.20, yrs_pos_is >= 0.6, pw_is >= 0.25; per (simbol, jenis sinyal) ambil 1 dengan pf_is tertinggi.
# Usage: python3 scripts/research/wf_select.py <dir dengan wf_fast.csv wf_bo5.csv wf_bo15.csv wf_bo30.csv>
import sys, os
import numpy as np, pandas as pd
sys.path.insert(0, 'scripts/research')
import fast_breakout_scan as F, breakout_scan as B, snr_trend_scan as S
from multiprocessing import Pool

RULE = dict(n_is=60, pf_is=1.20, yrs_pos_is=0.6, pw_is=0.25)


def load_all(dr):
    f = pd.read_csv(f'{dr}/wf_fast.csv'); f['family'] = 'swing ' + f.level; f['src'] = 'fast'
    bs = [pd.read_csv(f'{dr}/{x}') for x in ('wf_bo5.csv', 'wf_bo15.csv', 'wf_bo30.csv') if os.path.exists(f'{dr}/{x}')]
    b = pd.concat(bs); b['family'] = b.signal; b['src'] = 'bo'
    d = pd.concat([f, b], ignore_index=True)
    return d[d.exit == 'rr2']


def select(d):
    m = (d.n_is >= RULE['n_is']) & (d.pf_is >= RULE['pf_is']) & (d.yrs_pos_is >= RULE['yrs_pos_is']) & (d.pw_is >= RULE['pw_is'])
    q = d[m].sort_values('pf_is', ascending=False)
    return q.drop_duplicates(['sym', 'family'])


def trades(row):
    row = dict(row)
    if row['src'] == 'fast':
        x = F.run(f"{row['sym']}:{row['tf']}", (row['level'], row['trend'], float(row['sl_atr']), int(row['max_hold_h']), 'rr2'))
    else:
        x = B.run_symbol((row['sym'], row['tf']), (row['signal'], row['trend'], row['sl'], 'rr2'), 8)
    x['leg'] = f"{row['sym']} {row['tf']} {row['family']} | {row['trend']} | SL {row.get('sl') if row['src'] == 'bo' else row['sl_atr']} | {int(row['max_hold_h'])}j"
    return x


def summary(T, nm):
    if not len(T): print(nm, 'kosong'); return
    eq = T.R.cumsum().values; dd = (np.maximum.accumulate(np.r_[0, eq])[1:] - eq).max()
    weeks = (T.t.max() - T.t.min()).days / 7
    wk = T.set_index('t').R.resample('W').size()
    print(f'{nm}: n {len(T)} trade/minggu {len(T)/weeks:.1f} (minggu >= 8 trade: {(wk>=8).mean()*100:.0f}%) WR {(T.R>0).mean()*100:.1f}% '
          f'PF {S.pf(T.R.values):.2f} totalR {T.R.sum():.0f} maxDD {dd:.1f}R tahan median {T.hold_h.median():.1f}j')
    g = T.groupby(T.t.dt.year).R.agg(n='size', wr=lambda r: (r > 0).mean(), pf=S.pf, sumR='sum')
    print(g.round(2).T.to_string())


if __name__ == '__main__':
    d = load_all(sys.argv[1])
    sel = select(d)
    print(f'kombinasi RR2: {len(d)} | lolos seleksi in-sample: {len(sel)}')
    cols = ['sym', 'tf', 'family', 'trend', 'sl', 'sl_atr', 'max_hold_h', 'n_is', 'pw_is', 'wr_is', 'pf_is', 'yrs_pos_is']
    print(sel[[c for c in cols if c in sel]].round(2).to_string())
    with Pool(4) as p:
        parts = p.map(trades, [r for _, r in sel.iterrows()])
    T = pd.concat(parts).sort_values('t')
    print()
    for leg, x in T.groupby('leg'):
        a, b = x[x.t < '2022'], x[x.t >= '2022']
        print(f'{leg:75s} <2022 PF {S.pf(a.R.values):.2f} WR {(a.R>0).mean()*100:4.1f}% | >=2022 n {len(b):4d} PF {S.pf(b.R.values):.2f} WR {(b.R>0).mean()*100:4.1f}%')
    print()
    summary(T[(T.t >= '2018') & (T.t < '2022')], 'IN-SAMPLE 2018-2021')
    summary(T[T.t >= '2022'], 'WALK-FORWARD 2022-2026 (tidak dipakai saat memilih)')
    T.to_csv(f'{sys.argv[1]}/wf_trades.csv', index=False)
