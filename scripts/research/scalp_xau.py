# Riset scalping XAUUSD di data M1 (2010 - Jan 2026). Uji jujur: statistik 2010-2021 (pilih) dan >= 2022 (uji).
# Ide:
#   sweep       harga menembus high/low Asia (00-07 UTC) atau PDH/PDL lalu close kembali ke dalam dalam <= W menit -> lawan arah tembus
#   open mom    5/15 menit pertama London 08:00 / NY 09:30 (waktu lokal, ikut DST) bergerak > 1 ATR M5 -> ikut (mom) atau lawan (fade)
#   TWAP        harga harian rata-rata (proxy VWAP, data tanpa volume); limit di TWAP saat disentuh dari sisi tren
#   round       angka bulat $5/$10, sentuhan pertama per hari: pantul (limit) atau tembus (close)
#   D1 break    close M1 menembus swing D1 (level dari M30, tanpa look-ahead)
# Filter tren: none, EMA200 H1, EMA20 D1. SL k x ATR14 M5 (k 1/2/3), dilewati bila risiko < 10x biaya. RR 1.5 / 2.
# Tahan maks 15/30/60 menit. Biaya 1.5 bps harga per trade. SL & TP di menit yang sama -> SL.
# Usage: python3 scripts/research/scalp_xau.py <out.csv>
import sys
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, 'scripts/research')
from respect_scan import load, ema
import snr_trend_scan as S

SPLIT = int(pd.Timestamp('2022-01-01').value // 60_000_000_000)
COST_BPS = 1.5e-4
_D = {}


def data():
    if _D: return _D
    parts = [load('XAUUSD', f'M1_{y}') for y in range(2010, 2027)]
    t = np.concatenate([p[0] for p in parts]); o, h, l, c = (np.concatenate([p[k] for p in parts]) for k in range(1, 5))
    k5 = t // 5
    g5 = pd.DataFrame({'k': k5, 'h': h, 'l': l, 'c': c}).groupby('k').agg(h=('h', 'max'), l=('l', 'min'), c=('c', 'last'))
    tr5 = np.maximum(g5.h - g5.l, np.maximum(abs(g5.h - g5.c.shift(1)), abs(g5.l - g5.c.shift(1))))
    atr5 = tr5.rolling(14).mean().shift(1).reindex(k5).values  # ATR M5 dari candle M5 yang sudah selesai
    day = (t + 120) // 1440
    gd = pd.DataFrame({'d': day, 'h': h, 'l': l, 'c': c}).groupby('d').agg(h=('h', 'max'), l=('l', 'min'), c=('c', 'last'))
    pc = np.r_[np.nan, c[:-1]]
    e200 = np.r_[np.nan, ema(c, 12000)[:-1]]
    td = np.sign(gd.c - gd.c.ewm(span=20, adjust=False).mean()).shift(1).reindex(day).values
    tp_ = (h + l + c) / 3
    twap = np.r_[np.nan, (pd.Series(tp_).groupby(day).cumsum() / pd.Series(np.ones(len(c))).groupby(day).cumsum()).values[:-1]]
    twap[np.r_[True, day[1:] != day[:-1]]] = np.nan
    # swing D1 dari M30 (tanpa look-ahead), dipetakan ke M1
    t3, o3, h3, l3, c3 = load('XAUUSD', 'M30')
    p3 = np.r_[c3[0], c3[:-1]]; tr3 = np.maximum(h3 - l3, np.maximum(abs(h3 - p3), abs(l3 - p3)))
    a3 = np.r_[np.nan, pd.Series(tr3).rolling(14).mean().values[:-1]]
    sup3, res3 = S.sr_sets(t3, h3, l3, c3, a3, S.pivots(t3, h3, l3, 1440, 2))['plain']
    j = np.clip(np.searchsorted(t3, t, side='right') - 1, 0, len(t3) - 1)
    _D.update(t=t, o=o, h=h, l=l, c=c, pc=pc, atr=atr5, day=day, gd=gd, th=np.sign(pc - e200), td=td, twap=twap,
              sup=sup3[j], res=res3[j], cost=COST_BPS * c, hr=(t // 60) % 24, mins=t % 1440)
    return _D


def sim(cand, rr, hold, d):
    h, l, c, t, cost = d['h'], d['l'], d['c'], d['t'], d['cost']; n = len(c); busy = -1; out = []
    for i, sd, e, sl, touch in cand:
        if i <= busy: continue
        risk = abs(e - sl)
        if not np.isfinite(risk) or risk < 10 * cost[i]: continue
        cr = cost[i] / risk
        if touch and ((sd == 1 and l[i] <= sl) or (sd == -1 and h[i] >= sl)):
            out.append((t[i], -1 - cr)); busy = i; continue
        j0, j1 = i + 1, min(i + 1 + hold, n)
        if j0 >= n: break
        lo, hi = l[j0:j1], h[j0:j1]; tp = e + sd * rr * risk
        a = (lo <= sl) if sd == 1 else (hi >= sl); f = (hi >= tp) if sd == 1 else (lo <= tp)
        ks = int(np.argmax(a)) if a.any() else 10 ** 9; kt = int(np.argmax(f)) if f.any() else 10 ** 9
        if ks == kt == 10 ** 9: k = j1 - j0 - 1; R = sd * (c[j0 + k] - e) / risk
        elif ks <= kt: k = ks; R = -1.0
        else: k = kt; R = rr
        out.append((t[i], R - cr)); busy = j0 + k
    return np.array(out) if out else np.zeros((0, 2))


def variants(d):
    """nama -> list (i, side, entry, sl_struktur_or_None, touch)."""
    t, o, h, l, c, pc, atr, day = d['t'], d['o'], d['h'], d['l'], d['c'], d['pc'], d['atr'], d['day']
    V = {}
    hr = d['hr']; uday = t // 1440
    m = hr < 7
    ah = pd.Series(np.where(m, h, np.nan)).groupby(uday).transform('max').values
    al = pd.Series(np.where(m, l, np.nan)).groupby(uday).transform('min').values
    pdh, pdl = d['gd'].h.shift(1).reindex(day).values, d['gd'].l.shift(1).reindex(day).values
    win = (hr >= 7) & (hr < 17)
    for lvn, (hi_, lo_, act) in {'Asia': (ah, al, win), 'PDH/PDL': (pdh, pdl, np.ones(len(t), bool))}.items():
        for W in (1, 5):
            hmax = pd.Series(h).rolling(W).max().values; lmin = pd.Series(l).rolling(W).min().values
            if W == 1:  # wick menembus level, candle yang sama close kembali ke dalam
                sh = act & np.isfinite(hi_) & (h > hi_) & (c < hi_) & (o < hi_)
                sl_ = act & np.isfinite(lo_) & (l < lo_) & (c > lo_) & (o > lo_)
            else:  # breakout gagal: sempat close di luar level dalam W menit terakhir, sekarang close kembali ke dalam
                cmax = np.r_[np.nan, pd.Series(c).rolling(W).max().values[:-1]]; cmin = np.r_[np.nan, pd.Series(c).rolling(W).min().values[:-1]]
                sh = act & np.isfinite(hi_) & (cmax > hi_) & (c < hi_)
                sl_ = act & np.isfinite(lo_) & (cmin < lo_) & (c > lo_)
            cand = []
            for idx, sd in ((np.nonzero(sl_)[0], 1), (np.nonzero(sh)[0], -1)):
                cd = pd.DataFrame({'i': idx, 'd': day[idx]}).drop_duplicates('d')
                cand += [(int(i), sd, c[i], (lmin[i] if sd == 1 else hmax[i]) - sd * 0.1 * atr[i], False) for i in cd.i.values]
            V[f'sweep {lvn} W{W}'] = sorted(cand)
    for sess, tz, hh, mm in (('London', 'Europe/London', 8, 0), ('NY', 'America/New_York', 9, 30)):
        idx = pd.DatetimeIndex(pd.to_datetime(t, unit='m', utc=True)).tz_convert(tz)
        lm = idx.hour.values * 60 + idx.minute.values; st = hh * 60 + mm
        dk = idx.year.values * 10000 + idx.month.values * 100 + idx.day.values
        op = pd.Series(np.where(lm == st, o, np.nan)).groupby(dk).transform('max').values
        for X in (5, 15):
            at = np.nonzero(lm == st + X - 1)[0]
            mv = (c[at] - op[at]) / atr[at]
            for mode in ('mom', 'fade'):
                cand = []
                for i, v in zip(at, mv):
                    if not np.isfinite(v) or abs(v) < 1.0: continue
                    sd = int(np.sign(v)) * (1 if mode == 'mom' else -1)
                    cand.append((int(i), sd, c[i], None, False))
                V[f'open {sess} {X}m {mode}'] = cand
    tw = d['twap']
    lt = np.isfinite(tw) & (l <= tw) & (pc > tw) & (o > tw) & (hr >= 7) & (hr < 20)
    st_ = np.isfinite(tw) & (h >= tw) & (pc < tw) & (o < tw) & (hr >= 7) & (hr < 20)
    V['TWAP pantul'] = sorted([(int(i), 1, tw[i], None, True) for i in np.nonzero(lt)[0]] + [(int(i), -1, tw[i], None, True) for i in np.nonzero(st_)[0]])
    for step in (5.0, 10.0):
        dn = np.floor(pc / step) * step; up = np.ceil(pc / step) * step
        lt = (l <= dn) & (o > dn); st_ = (h >= up) & (o < up)
        for mode in ('pantul', 'tembus'):
            cand = []
            if mode == 'pantul':
                for idx, sd, lv in ((np.nonzero(lt)[0], 1, dn), (np.nonzero(st_)[0], -1, up)):
                    cd = pd.DataFrame({'i': idx, 'lv': lv[idx], 'd': day[idx]}).drop_duplicates(['lv', 'd'])
                    cand += [(int(i), sd, v, None, True) for i, v in zip(cd.i.values, cd.lv.values)]
            else:
                bu = (c > np.ceil(pc / step) * step) & (pc < np.ceil(pc / step) * step)
                bd = (c < np.floor(pc / step) * step) & (pc > np.floor(pc / step) * step)
                for idx, sd in ((np.nonzero(bu)[0], 1), (np.nonzero(bd)[0], -1)):
                    lv = np.ceil(pc[idx] / step) * step if sd == 1 else np.floor(pc[idx] / step) * step
                    cd = pd.DataFrame({'i': idx, 'lv': lv, 'd': day[idx]}).drop_duplicates(['lv', 'd'])
                    cand += [(int(i), sd, c[i], None, False) for i in cd.i.values]
            V[f'round ${int(step)} {mode}'] = sorted(cand)
    sup, res = d['sup'], d['res']
    bu = np.isfinite(res) & (c > res) & (pc < res); bd = np.isfinite(sup) & (c < sup) & (pc > sup)
    cand = []
    for idx, sd, lv in ((np.nonzero(bu)[0], 1, res), (np.nonzero(bd)[0], -1, sup)):
        cd = pd.DataFrame({'i': idx, 'lv': lv[idx], 'd': day[idx]}).drop_duplicates(['lv', 'd'])
        cand += [(int(i), sd, c[i], None, False) for i in cd.i.values]
    V['D1 break'] = sorted(cand)
    return V


def run(name):
    d = data(); V = variants(d) if name not in _V else None
    cand0 = (V or _V)[name]; atr = d['atr']; rows = []
    TR = {'none': None, 'EMA200 H1': d['th'], 'EMA20 D1': d['td']}
    for tn, tv in TR.items():
        cf = [x for x in cand0 if tv is None or tv[x[0]] == x[1]]
        for k in ('struktur', 1.0, 2.0, 3.0):
            if k == 'struktur':
                if not cf or cf[0][3] is None: continue
                cc = [(i, sd, e, sl, tch) for i, sd, e, sl, tch in cf]
            else:
                cc = [(i, sd, e, e - sd * k * atr[i], tch) for i, sd, e, _, tch in cf]
            for rr in (1.5, 2.0):
                for hold in (15, 30, 60):
                    r = sim(cc, rr, hold, d)
                    row = dict(idea=name, trend=tn, sl=k, rr=rr, hold=hold)
                    for pn, msk in (('is', r[:, 0] < SPLIT), ('wf', r[:, 0] >= SPLIT)) if len(r) else ():
                        R = r[msk, 1]; tt = r[msk, 0]
                        yr = pd.Series(R).groupby(pd.to_datetime(tt, unit='m').year).sum()
                        row.update({f'n_{pn}': len(R), f'wr_{pn}': (R > 0).mean() if len(R) else np.nan, f'pf_{pn}': S.pf(R),
                                    f'pw_{pn}': len(R) / max(1e-9, (tt.max() - tt.min()) / 10080) if len(R) > 1 else 0,
                                    f'yrs_pos_{pn}': (yr > 0).mean() if len(yr) else np.nan})
                    rows.append(row)
    print(name, 'selesai', flush=True)
    return rows


_V = {}
if __name__ == '__main__':
    d = data(); _V.update(variants(d))
    print({k: len(v) for k, v in _V.items()}, flush=True)
    with Pool(4) as p:  # fork: anak mewarisi _D dan _V
        rows = sum(p.map(run, list(_V)), [])
    pd.DataFrame(rows).to_csv(sys.argv[1], index=False)
