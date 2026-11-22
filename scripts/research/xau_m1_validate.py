# Validasi breakout swing D1 XAU (M30, searah EMA200 H1, SL 2 ATR) dengan exit dihitung di data M1.
# Di M30, bila SL dan TP kena di candle yang sama dihitung SL (konservatif). Di M1 urutan sebenarnya terlihat.
# Usage: python3 scripts/research/xau_m1_validate.py
import sys, glob
import numpy as np, pandas as pd
sys.path.insert(0, 'scripts/research')
from respect_scan import load, cost_array
import snr_trend_scan as S

def load_m1():
    T, H, L, C = [], [], [], []
    for f in sorted(glob.glob('data/market/XAUUSD_M1_*.bin.gz')):
        sym_tf = f.split('/')[-1].replace('.bin.gz', '').split('_', 1)[1]
        t, o, h, l, c = load('XAUUSD', sym_tf); T.append(t); H.append(h); L.append(l); C.append(c)
    return np.concatenate(T), np.concatenate(H), np.concatenate(L), np.concatenate(C)

def signals(trend='EMA200 H1', tf='D1', s=2.0):
    t, o, h, l, c = load('XAUUSD'); pcl = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(abs(h - pcl), abs(l - pcl)))
    atr = np.r_[np.nan, pd.Series(tr).rolling(14).mean().values[:-1]]; pc = np.r_[np.nan, c[:-1]]
    tfm = {'H4': (240, 3), 'D1': (1440, 2)}[tf]
    T = S.trends(t, c, False, S.pivots(t, h, l, 240, 3))[trend]
    sup, res = S.sr_sets(t, h, l, c, atr, S.pivots(t, h, l, *tfm))['plain']
    base = np.isfinite(atr) & (atr > 0)
    lm = base & np.isfinite(res) & (c > res) & (pc < res) & (T == 1)
    sm = base & np.isfinite(sup) & (c < sup) & (pc > sup) & (T == -1)
    li, si = np.nonzero(lm)[0], np.nonzero(sm)[0]
    cd = pd.DataFrame({'i': np.r_[li, si], 'side': np.r_[np.ones(len(li), int), -np.ones(len(si), int)], 'lv': np.r_[res[li], sup[si]]})
    cd['d'] = t[cd.i.values] // 1440; cd = cd.drop_duplicates(['side', 'lv', 'd']).sort_values('i')
    i_ = cd.i.values; sd = cd.side.values
    return t[i_] + 30, sd, c[i_], c[i_] - sd * s * atr[i_], cost_array('XAUUSD', c)[i_]  # waktu close candle

def sim_m1(sig, m1, ex, hold_min=2 * 1440):
    tt, sd, e, sl, cost = sig; T, H, L, C = m1; out = []; busy = 0
    for k in range(len(tt)):
        if tt[k] < busy: continue
        j0 = np.searchsorted(T, tt[k]); j1 = np.searchsorted(T, tt[k] + hold_min)
        if j0 >= len(T) - 1 or j1 <= j0: continue
        risk = abs(e[k] - sl[k]); s_ = sd[k]; lo, hi = L[j0:j1], H[j0:j1]
        f = lambda m: int(np.argmax(m)) if m.any() else 10 ** 9
        tp1 = e[k] + s_ * (2 if ex == 'rr2' else 1) * risk
        ks = f(lo <= sl[k]) if s_ == 1 else f(hi >= sl[k]); kt = f(hi >= tp1) if s_ == 1 else f(lo <= tp1)
        if ks == kt == 10 ** 9: q = j1 - j0 - 1; R = s_ * (C[j0 + q] - e[k]) / risk
        elif ks <= kt: q = ks; R = -1.0
        elif ex != 'partial': q = kt; R = 2.0 if ex == 'rr2' else 1.0
        else:
            tp2 = e[k] + s_ * 2 * risk; lo2, hi2 = lo[kt + 1:], hi[kt + 1:]
            kb = f(lo2 <= e[k]) if s_ == 1 else f(hi2 >= e[k]); k2 = f(hi2 >= tp2) if s_ == 1 else f(lo2 <= tp2)
            if kb == k2 == 10 ** 9: q = j1 - j0 - 1; R = 0.5 + 0.5 * s_ * (C[j0 + q] - e[k]) / risk
            elif kb <= k2: q = kt + 1 + kb; R = 0.5
            else: q = kt + 1 + k2; R = 1.5
        out.append((tt[k], R - cost[k] / risk)); busy = T[j0 + q] + 1
    return pd.DataFrame(out, columns=['t', 'R'])

if __name__ == '__main__':
    m1 = load_m1(); end = m1[0][-1]
    for tf, trend in (('D1', 'EMA200 H1'), ('D1', 'Struktur H4'), ('H4', 'EMA stack H1')):
        sig = signals(trend, tf)
        keep = sig[0] < end - 2 * 1440; sig = tuple(x[keep] for x in sig)
        for ex in ('rr1', 'rr2', 'partial'):
            r = sim_m1(sig, m1, ex)
            y = pd.to_datetime(r.t, unit='m').dt.year; g = r.groupby(y).R.sum()
            print(f'M1 exit | {tf} {trend:12s} {ex:7s} n {len(r)} WR {(r.R>0).mean():.3f} PF {S.pf(r.R.values):.2f} totalR {r.R.sum():.0f} tahun+ {(g>0).sum()}/{len(g)}', flush=True)
