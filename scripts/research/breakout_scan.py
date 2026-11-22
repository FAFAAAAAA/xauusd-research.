# Scan strategi breakout di TF kecil (M5/M15/M30).
# Sinyal (semua masuk di close candle penembus, tanpa look-ahead):
#   swing      = tembus swing fractal (P=3) TF itu sendiri yang belum ditembus
#   swing H1   = tembus swing fractal H1
#   donchian20 / donchian55 = close tembus high/low N candle sebelumnya
#   ORB London / ORB NY     = tembus range 30 menit pertama sesi (08:00 London / 09:30 New York, ikut DST), maks 4 jam
#   Asia range = tembus range 00-07 UTC, jam 07-12 UTC
#   PDH/PDL    = tembus high/low hari sebelumnya
#   squeeze    = BB(20,2) tersempit 10% dari 120 candle terakhir lalu close di luar band
# Filter tren: none, EMA200 H1, EMA20 D1, keduanya. SL: 1.5/2/3 ATR TF itu, atau sisi range seberang (ORB/Asia).
# Exit: rr1, rr2, partial. Tahan maksimal 1 hari. Biaya: lihat respect_scan.cost_array.
# Usage: python3 scripts/research/breakout_scan.py <out.csv> <TF> [SYM ...]
import sys, json, os
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, 'scripts/research')
from respect_scan import load, cls, ema, cost_array, OOS_FROM, D
import snr_trend_scan as S

WF_SPLIT = int(pd.Timestamp('2022-01-01').value // 60_000_000_000)  # walk-forward: pilih < 2022, uji >= 2022
EXITS = tuple(os.environ.get('EXITS', 'rr1,rr2,partial').split(','))


def wf_stats(r):
    """Statistik in-sample (< 2022) dan walk-forward (>= 2022) dari array trade (t, R, hold)."""
    out = {}
    for nm, m in (('is', r[:, 0] < WF_SPLIT), ('wf', r[:, 0] >= WF_SPLIT)) if len(r) else ():
        R = r[m, 1]; tt = r[m, 0]
        wk = (tt.max() - tt.min()) / (1440 * 7) if len(tt) > 1 else np.nan
        yp = pd.Series(R).groupby(pd.to_datetime(tt, unit='m').year).sum() if len(R) else pd.Series(dtype=float)
        out.update({f'n_{nm}': len(R), f'wr_{nm}': (R > 0).mean() if len(R) else np.nan, f'pf_{nm}': S.pf(R),
                    f'pw_{nm}': len(R) / wk if wk and wk > 0 else np.nan, f'yrs_pos_{nm}': (yp > 0).mean() if len(yp) else np.nan})
    return out

TFMIN = {'M5': 5, 'M15': 15, 'M30': 30}


def run_symbol(args, want=None, max_hold_h=None):
    """want=(signal, trend, sl, exit) -> kembalikan DataFrame trade (t, R) untuk satu konfigurasi."""
    sym, tf = args
    t, o, h, l, c = load(sym, tf); n = len(c); tfm = TFMIN[tf]
    crypto = cls(sym) == 'CRYPTO'
    cost = cost_array(sym, c)
    pcl = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(abs(h - pcl), abs(l - pcl)))
    atr = np.r_[np.nan, pd.Series(tr).rolling(14).mean().values[:-1]]
    pc = np.r_[np.nan, c[:-1]]
    base = np.isfinite(atr) & (atr > 0)
    bars_day = 1440 // tfm
    S.MAXHOLD = bars_day if max_hold_h is None else max_hold_h * 60 // tfm
    # tren
    e200h1 = np.r_[np.nan, ema(c, 200 * 60 // tfm)[:-1]]
    tr_h1 = np.sign(pc - e200h1)
    day = (t + (0 if crypto else 120)) // 1440
    dc = pd.Series(c).groupby(day).last(); de = dc.ewm(span=20, adjust=False).mean()
    tr_d1 = np.sign(dc - de).shift(1).reindex(day).values
    TR = {'none': np.full(n, 2.0), 'EMA200 H1': tr_h1, 'EMA20 D1': tr_d1,
          'H1+D1': np.where((tr_h1 == 1) & (tr_d1 == 1), 1, np.where((tr_h1 == -1) & (tr_d1 == -1), -1, 0))}
    SIG = {}  # nama -> (long_mask, short_mask, level_long, level_short, sl_long, sl_short) ; sl None = pakai ATR
    # swing TF sendiri dan H1
    for nm, tmin in (('swing', tfm), ('swing H1', 60)):
        ev = S.pivots(t, h, l, tmin, 3)
        sup, res = S.sr_sets(t, h, l, c, atr, ev)['plain']
        SIG[nm] = (base & np.isfinite(res) & (c > res) & (pc < res), base & np.isfinite(sup) & (c < sup) & (pc > sup), res, sup, None, None)
    for N in (20, 55):
        hh = np.r_[np.nan, pd.Series(h).rolling(N).max().values[:-1]]; ll = np.r_[np.nan, pd.Series(l).rolling(N).min().values[:-1]]
        hh1 = np.r_[np.nan, hh[:-1]]; ll1 = np.r_[np.nan, ll[:-1]]
        SIG[f'donchian{N}'] = (base & (c > hh) & (pc <= hh1), base & (c < ll) & (pc >= ll1), hh, ll, None, None)
    # ORB London 08:00 dan NY 09:30 (waktu lokal), range 30 menit, berlaku 4 jam
    for nm, tz, hh_, mm_ in (('ORB London', 'Europe/London', 8, 0), ('ORB NY', 'America/New_York', 9, 30)):
        idx = pd.DatetimeIndex(pd.to_datetime(t, unit='m', utc=True)).tz_convert(tz)
        mins = idx.hour.values * 60 + idx.minute.values
        dk = idx.year.values * 10000 + idx.month.values * 100 + idx.day.values
        st = hh_ * 60 + mm_
        inr = (mins >= st) & (mins + tfm <= st + 30)
        rh = pd.Series(np.where(inr, h, np.nan)).groupby(dk).transform('max').values
        rl = pd.Series(np.where(inr, l, np.nan)).groupby(dk).transform('min').values
        act = (mins >= st + 30) & (mins < st + 270)
        SIG[nm] = (base & act & (c > rh) & (pc <= rh), base & act & (c < rl) & (pc >= rl), rh, rl, rl, rh)
    hr = (t // 60) % 24; ud = t // 1440
    m = hr < 7
    ah = pd.Series(np.where(m, h, np.nan)).groupby(ud).transform('max').values
    al = pd.Series(np.where(m, l, np.nan)).groupby(ud).transform('min').values
    act = (hr >= 7) & (hr < 12)
    SIG['Asia range'] = (base & act & (c > ah) & (pc <= ah), base & act & (c < al) & (pc >= al), ah, al, al, ah)
    g = pd.DataFrame({'p': day, 'h': h, 'l': l}).groupby('p').agg(h=('h', 'max'), l=('l', 'min'))
    pdh, pdl = g.h.shift(1).reindex(day).values, g.l.shift(1).reindex(day).values
    SIG['PDH/PDL'] = (base & (c > pdh) & (pc <= pdh), base & (c < pdl) & (pc >= pdl), pdh, pdl, None, None)
    ma = pd.Series(c).rolling(20).mean().values; sd = pd.Series(c).rolling(20).std().values
    up, dn = ma + 2 * sd, ma - 2 * sd
    w = (up - dn) / ma
    sq = w <= pd.Series(w).rolling(120).quantile(0.1).values
    sq_prev = np.r_[False, sq[:-1]]
    up1, dn1 = np.r_[np.nan, up[:-1]], np.r_[np.nan, dn[:-1]]
    SIG['squeeze'] = (base & sq_prev & (c > up1), base & sq_prev & (c < dn1), up1, dn1, None, None)

    weeks = (t[-1] - t[0]) / (1440 * 7); weeks_oos = max(1e-9, (t[-1] - max(t[0], OOS_FROM)) / (1440 * 7))
    dd_day = t // 1440
    rows = []
    for sn, (lm, sm, lvl, lvs, sll, sls) in SIG.items():
        for tn, tv in TR.items():
            li = np.nonzero(lm & ((tv == 1) | (tv == 2)))[0]; si = np.nonzero(sm & ((tv == -1) | (tv == 2)))[0]
            cd = pd.DataFrame({'i': np.r_[li, si], 'side': np.r_[np.ones(len(li), int), -np.ones(len(si), int)]})
            cd['d'] = dd_day[cd.i.values]
            if sn.startswith(('ORB', 'Asia', 'PDH')):
                cd = cd.drop_duplicates(['side', 'd'])  # satu breakout per sisi per hari
            cd = cd.sort_values('i')
            i_, sd_ = cd.i.values, cd.side.values; e = c[i_]
            sls_opts = {'1.5ATR': 1.5, '2ATR': 2.0, '3ATR': 3.0}
            if sll is not None: sls_opts['range'] = None
            for sln, k in sls_opts.items():
                if k is None:
                    sl = np.where(sd_ == 1, sll[i_], sls[i_]) - sd_ * 0.1 * atr[i_]
                else:
                    sl = e - sd_ * k * atr[i_]
                ok = np.isfinite(sl) & (abs(e - sl) > 0)
                cand = [(a, b, x, y, False) for a, b, x, y in zip(i_[ok], sd_[ok], e[ok], sl[ok])]
                for ex in EXITS:
                    if want is not None and want != (sn, tn, sln, ex): continue
                    r = S.sim(cand, h, l, c, cost, ex, t)
                    if want is not None:
                        return pd.DataFrame({'t': pd.to_datetime(r[:, 0], unit='m'), 'R': r[:, 1], 'hold_h': r[:, 2] * tfm / 60})
                    R = r[:, 1] if len(r) else np.zeros(0); oo = r[:, 0] >= OOS_FROM if len(r) else np.zeros(0, bool); Ro = R[oo]
                    yrs = pd.to_datetime(r[:, 0], unit='m').year if len(r) else np.zeros(0)
                    yp = pd.Series(R).groupby(yrs).sum() if len(r) else pd.Series(dtype=float)
                    rows.append(dict(sym=sym, cls=cls(sym), tf=tf, max_hold_h=S.MAXHOLD * tfm / 60, signal=sn, trend=tn, sl=sln, exit=ex, n=len(R),
                                     per_week=len(R) / weeks, wr=(R > 0).mean() if len(R) else np.nan, pf=S.pf(R),
                                     avgR=R.mean() if len(R) else np.nan, n_oos=len(Ro), per_week_oos=len(Ro) / weeks_oos,
                                     wr_oos=(Ro > 0).mean() if len(Ro) else np.nan, pf_oos=S.pf(Ro),
                                     avgR_oos=Ro.mean() if len(Ro) else np.nan, yrs_pos=(yp > 0).mean() if len(yp) else np.nan,
                                     first=pd.Timestamp(t[0], unit='m').strftime('%Y-%m'), **wf_stats(r)))
    return rows


if __name__ == '__main__':
    out, tf = sys.argv[1], sys.argv[2]
    m = json.load(open(f'{D}/manifest.json'))
    syms = sys.argv[3:] or sorted({v['symbol'] for v in m.values() if v['tf'] == tf})
    with Pool(4) as p:
        allrows = []
        mh = int(os.environ['MAXHOLD_H']) if os.environ.get('MAXHOLD_H') else None
        from functools import partial as _p
        for k, rows in enumerate(p.imap_unordered(_p(run_symbol, max_hold_h=mh), [(s, tf) for s in syms])):
            allrows += rows; print(k + 1, len(syms), rows[0]['sym'], flush=True)
    pd.DataFrame(allrows).to_csv(out, index=False)
