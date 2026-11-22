# Lanjutan respect_scan: Daily Open + FVG M30 dengan jendela sesi, konfluensi, filter tren, dan TP parsial.
# Exit: rr1, rr2, partial (50% di 1R lalu SL ke BE, sisa ke 2R). Aturan konservatif sama dengan respect_scan.
# Usage: python3 scripts/research/combo_scan.py <out.csv> [SYM ...]
import sys, json
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, 'scripts/research')
from respect_scan import load, cls, ema, cost_array, levels, FX_COST, OOS_FROM, MAXHOLD, D

SESS = {'all': range(0, 24), 'london 07-10': range(7, 10), 'ny 13-16': range(13, 16), 'lon+ny': list(range(7, 10)) + list(range(13, 16)),
        '07-20': range(7, 20)}


def first(mask):
    return int(np.argmax(mask)) if mask.any() else 10 ** 9


def sim(cand, h, l, c, atr, cost, s, ex, t):
    n = len(c); busy = -1; out = []
    for i, side, lv in cand:
        if i <= busy: continue
        e = lv; risk = s * atr[i]; sl = e - side * risk
        cr = cost[i] / risk
        if (side == 1 and l[i] <= sl) or (side == -1 and h[i] >= sl):
            out.append((t[i], -1 - cr)); busy = i; continue
        j0, j1 = i + 1, min(i + 1 + MAXHOLD, n)
        if j0 >= n: break
        lo, hi = l[j0:j1], h[j0:j1]
        adv = (lo <= sl) if side == 1 else (hi >= sl)
        tp1 = e + side * (1.0 if ex != 'rr2' else 2.0) * risk
        fav = (hi >= tp1) if side == 1 else (lo <= tp1)
        ks, kt = first(adv), first(fav)
        if ks == kt == 10 ** 9:
            k = j1 - j0 - 1; R = side * (c[j0 + k] - e) / risk
        elif ks <= kt:
            k = ks; R = -1.0
        elif ex != 'partial':
            k = kt; R = 1.0 if ex == 'rr1' else 2.0
        else:  # 50% di 1R, sisa: BE atau 2R
            tp2 = e + side * 2 * risk
            lo2, hi2 = lo[kt + 1:], hi[kt + 1:]
            be = (lo2 <= e) if side == 1 else (hi2 >= e)
            f2 = (hi2 >= tp2) if side == 1 else (lo2 <= tp2)
            kb, k2 = first(be), first(f2)
            if kb == k2 == 10 ** 9:
                k = j1 - j0 - 1; R = 0.5 + 0.5 * side * (c[j0 + k] - e) / risk
            elif kb <= k2:
                k = kt + 1 + kb; R = 0.5
            else:
                k = kt + 1 + k2; R = 1.5
        out.append((t[i], R - cr)); busy = j0 + k
    return np.array(out) if out else np.zeros((0, 2))


def run_symbol(sym):
    t, o, h, l, c = load(sym)
    crypto = cls(sym) == 'CRYPTO'
    cost = cost_array(sym, c)
    tr = np.maximum(h - l, np.maximum(abs(h - np.r_[c[0], c[:-1]]), abs(l - np.r_[c[0], c[:-1]])))
    atr = np.r_[np.nan, pd.Series(tr).rolling(14).mean().values[:-1]]
    L = levels(t, o, h, l, c, crypto, atr)
    pc = np.r_[np.nan, c[:-1]]
    e400 = np.r_[np.nan, ema(c, 400)[:-1]]
    hr = (t // 60) % 24
    base = np.isfinite(atr) & (atr > 0)
    day = (t + (0 if crypto else 120)) // 1440

    def touches(sup, res):
        lt = base & np.isfinite(sup) & (l <= sup) & (pc > sup) & (o > sup)
        st = base & np.isfinite(res) & (h >= res) & (pc < res) & (o < res)
        return lt, st

    dos, dor = L['Daily Open']; fs, fr = L['FVG M30']
    dl, ds = touches(dos, dor); fl, fsh = touches(fs, fr)
    conf_l = dl & np.isfinite(fs) & (abs(fs - dos) <= 0.5 * atr)
    conf_s = ds & np.isfinite(fr) & (abs(fr - dor) <= 0.5 * atr)
    setups = {'DO': (dl, ds, dos, dor, True), 'FVG': (fl, fsh, fs, fr, True), 'DO+FVG konfluensi': (conf_l, conf_s, dos, dor, True)}
    weeks = (t[-1] - t[0]) / (1440 * 7)
    weeks_oos = max(1e-9, (t[-1] - max(t[0], OOS_FROM)) / (1440 * 7))
    rows = []
    for sn, sh in SESS.items():
        sm = np.isin(hr, list(sh))
        for tf in ('none', 'trend'):
            lf_ = sm & (pc > e400) if tf == 'trend' else sm
            sf_ = sm & (pc < e400) if tf == 'trend' else sm
            built = {}
            for nm, (lm, smk, sup, res, dd) in setups.items():
                li, si = np.nonzero(lm & lf_)[0], np.nonzero(smk & sf_)[0]
                cd = pd.DataFrame({'i': np.r_[li, si], 'side': np.r_[np.ones(len(li), int), -np.ones(len(si), int)],
                                   'lv': np.r_[sup[li], res[si]]})
                cd['d'] = day[cd.i.values]
                cd = cd.drop_duplicates(['side', 'lv', 'd']).sort_values('i')
                built[nm] = cd
            built['DO atau FVG'] = pd.concat([built['DO'], built['FVG']]).drop_duplicates('i').sort_values('i')
            for nm, cd in built.items():
                cand = list(zip(cd.i.values, cd.side.values, cd.lv.values))
                for s in (1.0, 1.5, 2.0):
                    for ex in ('rr1', 'rr2', 'partial'):
                        r = sim(cand, h, l, c, atr, cost, s, ex, t)
                        R = r[:, 1] if len(r) else np.zeros(0); oo = r[:, 0] >= OOS_FROM if len(r) else np.zeros(0, bool)
                        pf = lambda x: x[x > 0].sum() / max(1e-9, -x[x < 0].sum())
                        Ro = R[oo]
                        rows.append(dict(sym=sym, cls=cls(sym), setup=nm, sess=sn, filter=tf, sl_atr=s, exit=ex, n=len(R),
                                         per_week=len(R) / weeks, wr=(R > 0).mean() if len(R) else np.nan, pf=pf(R),
                                         avgR=R.mean() if len(R) else np.nan, n_oos=len(Ro), per_week_oos=len(Ro) / weeks_oos,
                                         wr_oos=(Ro > 0).mean() if len(Ro) else np.nan, pf_oos=pf(Ro),
                                         avgR_oos=Ro.mean() if len(Ro) else np.nan))
    return rows


if __name__ == '__main__':
    out = sys.argv[1]
    m = json.load(open(f'{D}/manifest.json'))
    syms = sys.argv[2:] or sorted({v['symbol'] for v in m.values() if v['tf'] == 'M30'})
    with Pool(4) as p:
        allrows = []
        for k, rows in enumerate(p.imap_unordered(run_symbol, syms)):
            allrows += rows; print(k + 1, len(syms), rows[0]['sym'], flush=True)
    pd.DataFrame(allrows).to_csv(out, index=False)
