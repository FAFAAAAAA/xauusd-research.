# Scan support/resistance + filter tren di semua instrumen data/market (M30).
# S/R dari swing fractal H1/H4/D1, tiga jenis:
#   plain  = swing terdekat yang belum ditembus close
#   strong = zona yang terbentuk >= 2 swing (toleransi 0.3 ATR), tetap hidup setelah ditembus (role reversal)
#   flip   = level yang baru ditembus close (<= 5 hari), dites ulang dari sisi baru
# Filter tren (long hanya saat naik, short hanya saat turun): EMA200 H1, EMA200 H1 + slope, EMA stack H1,
#   struktur H4 (HH+HL / LH+LL), EMA20 D1.
# Mode: touch (limit di level, SL 1/2 ATR), confirm (close balik, SL di wick), break (close tembus, ikut arah).
# Exit: rr1, rr2, partial (50% di 1R, SL ke BE, sisa 2R). Aturan konservatif sama dengan respect_scan.
# Usage: python3 scripts/research/snr_trend_scan.py <out.csv> [SYM ...]
import sys, json
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, 'scripts/research')
from respect_scan import load, cls, ema, cost_array, FX_COST, OOS_FROM, MAXHOLD, D

FLIP_BARS = 240


def pivots(t, h, l, tfmin, P):
    """Event swing terkonfirmasi: (index bar M30 pertama yg boleh tahu, tipe 1=high/-1=low, harga)."""
    k = t // tfmin
    g = pd.DataFrame({'k': k, 'h': h, 'l': l}).groupby('k').agg(h=('h', 'max'), l=('l', 'min'))
    gk, gh, gl = g.index.values, g.h.values, g.l.values
    phv = pd.Series(gh).rolling(2 * P + 1, center=True).max().values
    plv = pd.Series(gl).rolling(2 * P + 1, center=True).min().values
    ev = []
    for j in range(P, len(gk) - P):
        ct = (gk[j + P] + 1) * tfmin
        if gh[j] == phv[j]: ev.append((ct, 1, gh[j]))
        if gl[j] == plv[j]: ev.append((ct, -1, gl[j]))
    ev.sort()
    idx = np.searchsorted(t, [e[0] for e in ev])
    return [(int(i), ty, px) for i, (_, ty, px) in zip(idx, ev) if i < len(t)]


def sr_sets(t, h, l, c, atr, ev):
    n = len(t)
    out = {k: (np.full(n, np.nan), np.full(n, np.nan)) for k in ('plain', 'strong', 'flip')}
    highs, lows, zones, flips = [], [], [], []  # zones: [price, count]; flips: [price, side, expiry]
    e = 0
    for i in range(1, n):
        x = c[i - 1]
        while e < len(ev) and ev[e][0] <= i:
            _, ty, px = ev[e]; e += 1
            (highs if ty == 1 else lows).append(px)
            tol = 0.3 * atr[i] if np.isfinite(atr[i]) else 0
            for z in zones:
                if abs(z[0] - px) <= tol:
                    z[0] = (z[0] * z[1] + px) / (z[1] + 1); z[1] += 1; break
            else:
                zones.append([px, 1])
            zones = zones[-40:]
        # level plain yang ditembus close -> jadi flip
        nh = []
        for v in highs:
            if v > x: nh.append(v)
            else: flips.append([v, 1, i + FLIP_BARS])  # resistance tembus -> support (long)
        nl = []
        for v in lows:
            if v < x: nl.append(v)
            else: flips.append([v, -1, i + FLIP_BARS])
        highs, lows = nh[-15:], nl[-15:]
        flips = [f for f in flips if f[2] > i and ((f[1] == 1 and x > f[0]) or (f[1] == -1 and x < f[0]))][-10:]
        ps, pr = out['plain']
        if lows: ps[i] = max(lows)
        if highs: pr[i] = min(highs)
        ss, sr = out['strong']
        below = [z[0] for z in zones if z[1] >= 2 and z[0] < x]; above = [z[0] for z in zones if z[1] >= 2 and z[0] > x]
        if below: ss[i] = max(below)
        if above: sr[i] = min(above)
        fs, fr = out['flip']
        fb = [f[0] for f in flips if f[1] == 1]; fa = [f[0] for f in flips if f[1] == -1]
        if fb: fs[i] = max(fb)
        if fa: fr[i] = min(fa)
    return out


def structure_trend(n, ev):
    """+1 bila 2 swing high & low terakhir H4 naik (HH+HL), -1 bila turun (LH+LL), 0 lainnya."""
    tr = np.zeros(n); hs, ls = [], []; e = 0; cur = 0
    for i in range(n):
        while e < len(ev) and ev[e][0] <= i:
            _, ty, px = ev[e]; e += 1
            (hs if ty == 1 else ls).append(px)
            if len(hs) >= 2 and len(ls) >= 2:
                cur = 1 if hs[-1] > hs[-2] and ls[-1] > ls[-2] else (-1 if hs[-1] < hs[-2] and ls[-1] < ls[-2] else 0)
        tr[i] = cur
    return tr


def trends(t, c, crypto, ev4):
    n = len(c); prv = lambda x: np.r_[np.nan, x[:-1]]
    pc = prv(c); e20, e50, e200 = prv(ema(c, 40)), prv(ema(c, 100)), prv(ema(c, 400))
    T = {'none': np.zeros(n) + 2}
    T['EMA200 H1'] = np.sign(pc - e200)
    slope = e200 - np.r_[np.full(48, np.nan), e200[:-48]]
    T['EMA200 H1 + slope'] = np.where((pc > e200) & (slope > 0), 1, np.where((pc < e200) & (slope < 0), -1, 0))
    T['EMA stack H1'] = np.where((e20 > e50) & (e50 > e200), 1, np.where((e20 < e50) & (e50 < e200), -1, 0))
    T['Struktur H4'] = structure_trend(n, ev4)
    day = (t + (0 if crypto else 120)) // 1440
    dc = pd.Series(c).groupby(day).last()
    de = dc.ewm(span=20, adjust=False).mean()
    sig = np.sign(dc - de).shift(1)  # hari sebelumnya yang sudah selesai
    T['EMA20 D1'] = sig.reindex(day).values
    return T


def first(m):
    return int(np.argmax(m)) if m.any() else 10 ** 9


def sim(cand, h, l, c, cost, ex, t):
    """cand: (i, side, entry, sl, entry_bar_check). Entry bar i (touch) atau close bar i (confirm/break)."""
    n = len(c); busy = -1; out = []
    for i, side, e, sl, touch in cand:
        if i <= busy: continue
        risk = abs(e - sl)
        if risk <= 0: continue
        cr = cost[i] / risk
        if touch and ((side == 1 and l[i] <= sl) or (side == -1 and h[i] >= sl)):
            out.append((t[i], -1 - cr, 0)); busy = i; continue
        j0, j1 = i + 1, min(i + 1 + MAXHOLD, n)
        if j0 >= n: break
        lo, hi = l[j0:j1], h[j0:j1]
        adv = (lo <= sl) if side == 1 else (hi >= sl)
        tp1 = e + side * (2.0 if ex == 'rr2' else 1.0) * risk
        fav = (hi >= tp1) if side == 1 else (lo <= tp1)
        ks, kt = first(adv), first(fav)
        if ks == kt == 10 ** 9:
            k = j1 - j0 - 1; R = side * (c[j0 + k] - e) / risk
        elif ks <= kt:
            k = ks; R = -1.0
        elif ex != 'partial':
            k = kt; R = 2.0 if ex == 'rr2' else 1.0
        else:
            tp2 = e + side * 2 * risk; lo2, hi2 = lo[kt + 1:], hi[kt + 1:]
            kb = first((lo2 <= e) if side == 1 else (hi2 >= e)); k2 = first((hi2 >= tp2) if side == 1 else (lo2 <= tp2))
            if kb == k2 == 10 ** 9:
                k = j1 - j0 - 1; R = 0.5 + 0.5 * side * (c[j0 + k] - e) / risk
            elif kb <= k2:
                k = kt + 1 + kb; R = 0.5
            else:
                k = kt + 1 + k2; R = 1.5
        out.append((t[i], R - cr, k + 1)); busy = j0 + k  # kolom 3 = lama tahan (bar)
    return np.array(out) if out else np.zeros((0, 3))


def pf(x):
    gl = -x[x < 0].sum(); return x[x > 0].sum() / gl if gl > 0 else np.nan


def run_symbol(sym):
    t, o, h, l, c = load(sym); crypto = cls(sym) == 'CRYPTO'; n = len(c)
    cost = cost_array(sym, c)
    pcl = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(abs(h - pcl), abs(l - pcl)))
    atr = np.r_[np.nan, pd.Series(tr).rolling(14).mean().values[:-1]]
    pc = np.r_[np.nan, c[:-1]]
    ev = {'H1': pivots(t, h, l, 60, 3), 'H4': pivots(t, h, l, 240, 3), 'D1': pivots(t, h, l, 1440, 2)}
    T = trends(t, c, crypto, ev['H4'])
    base = np.isfinite(atr) & (atr > 0)
    day = t // 1440
    weeks = (t[-1] - t[0]) / (1440 * 7); weeks_oos = max(1e-9, (t[-1] - max(t[0], OOS_FROM)) / (1440 * 7))
    rows = []
    for tf, evs in ev.items():
        S = sr_sets(t, h, l, c, atr, evs)
        for kind, (sup, res) in S.items():
            lt = base & np.isfinite(sup) & (l <= sup) & (pc > sup) & (o > sup)
            st = base & np.isfinite(res) & (h >= res) & (pc < res) & (o < res)
            modes = {'touch s1': 1.0, 'touch s2': 2.0, 'confirm': None}
            if kind == 'plain': modes.update({'break s1': 1.0, 'break s2': 2.0})
            for mode, s in modes.items():
                if mode.startswith('break'):
                    lm = base & np.isfinite(res) & (c > res) & (pc < res); sm = base & np.isfinite(sup) & (c < sup) & (pc > sup)
                    lv_l, lv_s = res, sup
                elif mode == 'confirm':
                    lm, sm, lv_l, lv_s = lt & (c > sup), st & (c < res), sup, res
                else:
                    lm, sm, lv_l, lv_s = lt, st, sup, res
                for tn, tv in T.items():
                    li = np.nonzero(lm & ((tv == 1) | (tv == 2)))[0]; si = np.nonzero(sm & ((tv == -1) | (tv == 2)))[0]
                    cd = pd.DataFrame({'i': np.r_[li, si], 'side': np.r_[np.ones(len(li), int), -np.ones(len(si), int)],
                                       'lv': np.r_[lv_l[li], lv_s[si]]})
                    cd['d'] = day[cd.i.values]
                    cd = cd.drop_duplicates(['side', 'lv', 'd']).sort_values('i')
                    i_, sd, lv = cd.i.values, cd.side.values, cd.lv.values
                    if mode.startswith('touch'):
                        e = lv; sl = lv - sd * s * atr[i_]; tch = True
                    elif mode == 'confirm':
                        e = c[i_]; sl = np.where(sd == 1, l[i_] - 0.1 * atr[i_], h[i_] + 0.1 * atr[i_]); tch = False
                        okr = (abs(e - sl) >= 0.3 * atr[i_]) & (abs(e - sl) <= 3 * atr[i_])
                        i_, sd, e, sl = i_[okr], sd[okr], e[okr], sl[okr]
                    else:
                        e = c[i_]; sl = e - sd * s * atr[i_]; tch = False
                    cand = [(a, b, x, y, tch) for a, b, x, y in zip(i_, sd, e, sl)]
                    for ex in ('rr1', 'rr2', 'partial'):
                        r = sim(cand, h, l, c, cost, ex, t)
                        R = r[:, 1] if len(r) else np.zeros(0); oo = r[:, 0] >= OOS_FROM if len(r) else np.zeros(0, bool); Ro = R[oo]
                        rows.append(dict(sym=sym, cls=cls(sym), tf=tf, kind=kind, mode=mode, trend=tn, exit=ex, n=len(R),
                                         per_week=len(R) / weeks, wr=(R > 0).mean() if len(R) else np.nan, pf=pf(R),
                                         avgR=R.mean() if len(R) else np.nan, n_oos=len(Ro), per_week_oos=len(Ro) / weeks_oos,
                                         wr_oos=(Ro > 0).mean() if len(Ro) else np.nan, pf_oos=pf(Ro),
                                         avgR_oos=Ro.mean() if len(Ro) else np.nan,
                                         first=pd.Timestamp(t[0], unit='m').strftime('%Y-%m')))
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
