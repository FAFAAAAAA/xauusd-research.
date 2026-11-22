# Lab strategi RR 1:2 (tanpa parsial) di M30, uji walk-forward: statistik < 2022 (in-sample) dan >= 2022 (uji).
# Keluarga sinyal (semua tanpa look-ahead, konteks D1/minggu dari periode yang sudah selesai):
#   donchian D1 20/55   close M30 tembus high/low N hari sebelumnya
#   NR4 D1 / inside D1  hari kemarin NR4 / inside day, lalu close tembus high/low kemarin
#   PWH/PWL             close tembus high/low minggu lalu
#   swing D1            close tembus swing D1 plain (acuan dari riset sebelumnya)
#   retest D1           limit di level swing D1 yang baru ditembus (flip), dites ulang dari sisi baru
#   RSI pullback        RSI14 M30 kembali dari < 30 (long) / > 70 (short), searah tren
#   RSI2 reversion      RSI2 M30 < 5 (long) / > 95 (short), searah tren
#   big candle          range > 2.5 ATR, close di 25% ujung, ikut arah
# Filter tren: none, EMA200 H1, EMA20 D1, keduanya. SL: 2/3/5 ATR(14) M30. Maks tahan: 8 jam, 24 jam, 5 hari.
# Usage: python3 scripts/research/strat_lab.py <out.csv> SYM [SYM ...]
import sys, os
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, 'scripts/research')
from respect_scan import load, cls, ema, cost_array
import snr_trend_scan as S

SPLIT = int(pd.Timestamp('2022-01-01').value // 60_000_000_000)
HOLDS = {'8j': 16, '24j': 48, '5h': 240}


def rsi(c, n):
    d = np.diff(c, prepend=c[0]); up = pd.Series(np.maximum(d, 0)).ewm(alpha=1 / n, adjust=False).mean()
    dn = pd.Series(np.maximum(-d, 0)).ewm(alpha=1 / n, adjust=False).mean()
    return (100 - 100 / (1 + up / dn.replace(0, np.nan))).values


def daily_ctx(t, h, l, c, crypto):
    day = (t + (0 if crypto else 120)) // 1440
    g = pd.DataFrame({'d': day, 'h': h, 'l': l, 'c': c}).groupby('d').agg(h=('h', 'max'), l=('l', 'min'), c=('c', 'last'))
    return day, g


def signals(t, o, h, l, c, crypto, atr):
    n = len(c); pc = np.r_[np.nan, c[:-1]]; base = np.isfinite(atr) & (atr > 0)
    day, g = daily_ctx(t, h, l, c, crypto)
    m = lambda s: s.reindex(day).values
    SIG = {}  # nama -> (long_mask, short_mask, entry_long, entry_short, touch, once_per_day)
    for N in (20, 55):
        hh = m(g.h.rolling(N).max().shift(1)); ll = m(g.l.rolling(N).min().shift(1))
        SIG[f'donchian D1 {N}'] = (base & (c > hh) & (pc <= hh), base & (c < ll) & (pc >= ll), None, None, False, True)
    ph, pl = m(g.h.shift(1)), m(g.l.shift(1))
    rng = g.h - g.l
    nr4 = m((rng <= rng.rolling(4).min()).shift(1)).astype(bool)
    ins = m(((g.h < g.h.shift(1)) & (g.l > g.l.shift(1))).shift(1).fillna(False)).astype(bool)
    for nm, k in (('NR4 D1', nr4), ('inside D1', ins)):
        SIG[nm] = (base & k & (c > ph) & (pc <= ph), base & k & (c < pl) & (pc >= pl), None, None, False, True)
    week = (day + 3) // 7
    w = pd.DataFrame({'w': week, 'h': h, 'l': l}).groupby('w').agg(h=('h', 'max'), l=('l', 'min'))
    pwh, pwl = w.h.shift(1).reindex(week).values, w.l.shift(1).reindex(week).values
    SIG['PWH/PWL'] = (base & (c > pwh) & (pc <= pwh), base & (c < pwl) & (pc >= pwl), None, None, False, True)
    Sx = S.sr_sets(t, h, l, c, atr, S.pivots(t, h, l, 1440, 2))
    sup, res = Sx['plain']
    SIG['swing D1'] = (base & np.isfinite(res) & (c > res) & (pc < res), base & np.isfinite(sup) & (c < sup) & (pc > sup), None, None, False, True)
    fs, fr = Sx['flip']
    SIG['retest D1'] = (base & np.isfinite(fs) & (l <= fs) & (pc > fs) & (o > fs), base & np.isfinite(fr) & (h >= fr) & (pc < fr) & (o < fr),
                        fs, fr, True, True)
    r14 = rsi(c, 14); r14p = np.r_[np.nan, r14[:-1]]
    SIG['RSI pullback'] = (base & (r14p < 30) & (r14 >= 30), base & (r14p > 70) & (r14 <= 70), None, None, False, False)
    r2 = rsi(c, 2)
    SIG['RSI2 reversion'] = (base & (r2 < 5), base & (r2 > 95), None, None, False, False)
    rg = h - l; pos = (c - l) / np.where(rg > 0, rg, np.nan)
    SIG['big candle'] = (base & (rg > 2.5 * atr) & (pos >= 0.75), base & (rg > 2.5 * atr) & (pos <= 0.25), None, None, False, False)
    return SIG, day, g


def run(sym, want=None):
    """want=(signal, trend, sl_atr, hold) -> DataFrame trade (t, R, hold_h)."""
    t, o, h, l, c = load(sym); n = len(c); crypto = cls(sym) == 'CRYPTO'
    cost = cost_array(sym, c); pcl = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(abs(h - pcl), abs(l - pcl)))
    atr = np.r_[np.nan, pd.Series(tr).rolling(14).mean().values[:-1]]; pc = np.r_[np.nan, c[:-1]]
    SIG, day, g = signals(t, o, h, l, c, crypto, atr)
    e200 = np.r_[np.nan, ema(c, 400)[:-1]]
    de = g.c.ewm(span=20, adjust=False).mean()
    td = np.sign(g.c - de).shift(1).reindex(day).values; th = np.sign(pc - e200)
    TR = {'none': np.full(n, 2.0), 'EMA200 H1': th, 'EMA20 D1': td,
          'H1+D1': np.where((th == 1) & (td == 1), 1, np.where((th == -1) & (td == -1), -1, 0))}
    rows = []
    for sn, (lm, sm, el, es, touch, once) in SIG.items():
        for tn, tv in TR.items():
            li = np.nonzero(lm & ((tv == 1) | (tv == 2)))[0]; si = np.nonzero(sm & ((tv == -1) | (tv == 2)))[0]
            if os.environ.get('SIDE') == 'long': si = si[:0]
            if os.environ.get('SIDE') == 'short': li = li[:0]
            cd = pd.DataFrame({'i': np.r_[li, si], 'side': np.r_[np.ones(len(li), int), -np.ones(len(si), int)]})
            if once:
                cd['d'] = day[cd.i.values]; cd = cd.drop_duplicates(['side', 'd'])
            cd = cd.sort_values('i'); i_, sd = cd.i.values, cd.side.values
            e = np.where(sd == 1, el[i_], es[i_]) if touch else c[i_]
            for k in (2.0, 3.0, 5.0):
                sl = e - sd * k * atr[i_]
                cand = [(a, b, x, y, touch) for a, b, x, y in zip(i_, sd, e, sl)]
                for hn, hb in HOLDS.items():
                    if want is not None and want != (sn, tn, k, hn): continue
                    S.MAXHOLD = hb
                    r = S.sim(cand, h, l, c, cost, 'rr2', t)
                    if want is not None:
                        x = pd.DataFrame({'t': pd.to_datetime(r[:, 0], unit='m'), 'R': r[:, 1], 'hold_h': r[:, 2] * 0.5}); x['sym'] = sym
                        return x
                    row = dict(sym=sym, cls=cls(sym), signal=sn, trend=tn, sl_atr=k, hold=hn)
                    for pn, msk in (('is', r[:, 0] < SPLIT), ('wf', r[:, 0] >= SPLIT)) if len(r) else ():
                        R = r[msk, 1]; tt = r[msk, 0]
                        yr = pd.Series(R).groupby(pd.to_datetime(tt, unit='m').year).sum()
                        row.update({f'n_{pn}': len(R), f'win_{pn}': int((R > 0).sum()), f'gp_{pn}': R[R > 0].sum(), f'gl_{pn}': -R[R < 0].sum(),
                                    f'weeks_{pn}': (tt.max() - tt.min()) / (1440 * 7) if len(tt) > 1 else 0,
                                    f'yrs_{pn}': len(yr), f'yrs_pos_{pn}': int((yr > 0).sum()),
                                    f'hold_{pn}': np.median(r[msk, 2]) * 0.5 if len(R) else np.nan})
                    rows.append(row)
    print(sym, 'selesai', flush=True)
    return rows


if __name__ == '__main__':
    with Pool(4) as p:
        rows = []
        for rr in p.imap_unordered(run, sys.argv[2:]): rows += rr
    pd.DataFrame(rows).to_csv(sys.argv[1], index=False)
