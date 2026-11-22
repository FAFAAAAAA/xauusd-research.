# Breakout level TF besar (swing D1/H4) dengan entry di TF kecil (M5/M15/M30) dan batas waktu tahan.
# Sinyal: close TF entry menembus swing plain D1/H4, searah filter tren. SL = k x ATR TF entry. Exit rr1/rr2/partial.
# Batas tahan 2/4/8 jam: posisi ditutup di close bila belum kena SL/TP. Biaya: respect_scan.cost_array.
# Usage: python3 scripts/research/fast_breakout_scan.py <out.csv> SYM:TF [SYM:TF ...]
import sys
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, 'scripts/research')
from respect_scan import load, cls, ema, cost_array, OOS_FROM
import snr_trend_scan as S

TFMIN = {'M5': 5, 'M15': 15, 'M30': 30}


def run(arg, want=None):
    """want=(level, trend, sl_atr, max_hold_h, exit) -> DataFrame trade (t, R, hold_h)."""
    sym, tf = arg.split(':'); tfm = TFMIN[tf]
    t, o, h, l, c = load(sym, tf); n = len(c); crypto = cls(sym) == 'CRYPTO'
    cost = cost_array(sym, c); pcl = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(abs(h - pcl), abs(l - pcl)))
    atr = np.r_[np.nan, pd.Series(tr).rolling(14).mean().values[:-1]]; pc = np.r_[np.nan, c[:-1]]
    base = np.isfinite(atr) & (atr > 0)
    ev4 = S.pivots(t, h, l, 240, 3)
    e200 = np.r_[np.nan, ema(c, 200 * 60 // tfm)[:-1]]
    day = (t + (0 if crypto else 120)) // 1440
    dc = pd.Series(c).groupby(day).last(); de = dc.ewm(span=20, adjust=False).mean()
    TR = {'EMA200 H1': np.sign(pc - e200), 'Struktur H4': S.structure_trend(n, ev4),
          'EMA20 D1': np.sign(dc - de).shift(1).reindex(day).values}
    weeks = (t[-1] - t[0]) / (1440 * 7); weeks_oos = max(1e-9, (t[-1] - max(t[0], OOS_FROM)) / (1440 * 7))
    rows = []
    for lvl_tf, (tmin, P) in (('D1', (1440, 2)), ('H4', (240, 3))):
        sup, res = S.sr_sets(t, h, l, c, atr, S.pivots(t, h, l, tmin, P) if tmin != 240 else ev4)['plain']
        lm = base & np.isfinite(res) & (c > res) & (pc < res); sm = base & np.isfinite(sup) & (c < sup) & (pc > sup)
        for tn, tv in TR.items():
            li, si = np.nonzero(lm & (tv == 1))[0], np.nonzero(sm & (tv == -1))[0]
            cd = pd.DataFrame({'i': np.r_[li, si], 'side': np.r_[np.ones(len(li), int), -np.ones(len(si), int)],
                               'lv': np.r_[res[li], sup[si]]})
            cd['d'] = t[cd.i.values] // 1440; cd = cd.drop_duplicates(['side', 'lv', 'd']).sort_values('i')
            i_, sd = cd.i.values, cd.side.values; e = c[i_]
            for k in (1.0, 2.0, 3.0):
                sl = e - sd * k * atr[i_]
                cand = [(a, b, x, y, False) for a, b, x, y in zip(i_, sd, e, sl)]
                for hold_h in (2, 4, 8):
                    S.MAXHOLD = hold_h * 60 // tfm
                    for ex in ('rr1', 'rr2', 'partial'):
                        if want is not None and want != (lvl_tf, tn, k, hold_h, ex): continue
                        r = S.sim(cand, h, l, c, cost, ex, t)
                        if want is not None:
                            return pd.DataFrame({'t': pd.to_datetime(r[:, 0], unit='m'), 'R': r[:, 1], 'hold_h': r[:, 2] * tfm / 60})
                        R = r[:, 1] if len(r) else np.zeros(0); oo = r[:, 0] >= OOS_FROM if len(r) else np.zeros(0, bool); Ro = R[oo]
                        yrs = pd.to_datetime(r[:, 0], unit='m').year if len(r) else []
                        yp = pd.Series(R).groupby(yrs).sum() if len(r) else pd.Series(dtype=float)
                        hold = r[:, 2] * tfm / 60 if len(r) else np.zeros(0)
                        rows.append(dict(sym=sym, cls=cls(sym), tf=tf, level=lvl_tf, trend=tn, sl_atr=k, max_hold_h=hold_h, exit=ex,
                                         n=len(R), per_week=len(R) / weeks, wr=(R > 0).mean() if len(R) else np.nan, pf=S.pf(R),
                                         avgR=R.mean() if len(R) else np.nan, pf_oos=S.pf(Ro), wr_oos=(Ro > 0).mean() if len(Ro) else np.nan,
                                         per_week_oos=len(Ro) / weeks_oos, yrs_pos=(yp > 0).mean() if len(yp) else np.nan,
                                         hold_med_h=np.median(hold) if len(hold) else np.nan,
                                         time_exit=(hold >= hold_h - 1e-9).mean() if len(hold) else np.nan))
    print(arg, 'selesai', flush=True)
    return rows


if __name__ == '__main__':
    with Pool(4) as p:
        rows = sum(p.map(run, sys.argv[2:]), [])
    pd.DataFrame(rows).to_csv(sys.argv[1], index=False)
