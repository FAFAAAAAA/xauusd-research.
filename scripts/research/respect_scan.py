# Scan "level apa yang selalu di-respect harga" di semua instrumen data/market (M30).
# Tiap level diuji sebagai trade pantulan: RR 1:1 dan 1:2, dengan biaya, tanpa look-ahead.
# Aturan konservatif: bila SL dan TP kena di candle yang sama -> dihitung SL. Candle entry yang juga kena SL -> SL.
# Usage: python3 scripts/research/respect_scan.py <out.csv> [SYM ...]
import gzip, sys, os, json
import numpy as np, pandas as pd
from multiprocessing import Pool

D = 'data/market'
OOS_FROM = int(pd.Timestamp('2024-07-01').value // 60_000_000_000)  # menit
MAXHOLD = 96  # 2 hari (M30)
FX_COST = {'EURUSD': 0.00010, 'GBPUSD': 0.00015, 'USDJPY': 0.012, 'USDCAD': 0.00018, 'USDCHF': 0.00015,
           'XAUUSD': 0.30, 'USATECHIDXUSD': 1.5, 'USA30IDXUSD': 3.0}


def cls(sym):
    if sym == 'XAUUSD': return 'XAU'
    if sym == 'USATECHIDXUSD': return 'NASDAQ'
    if sym == 'USA30IDXUSD': return 'US30'
    if sym in FX_COST: return 'FOREX'
    return 'CRYPTO'


def load(sym, tf='M30'):
    b = gzip.open(f'{D}/{sym}_{tf}.bin.gz').read()
    n = int(np.frombuffer(b, '<i4', 1)[0])
    t = np.frombuffer(b, '<i4', n, 4).astype(np.int64)
    p = np.frombuffer(b, '<f4', 4 * n, 4 + 4 * n).reshape(n, 4).astype(np.float64)
    return t, p[:, 0].copy(), p[:, 1].copy(), p[:, 2].copy(), p[:, 3].copy()


def ema(x, n):
    return pd.Series(x).ewm(span=n, adjust=False).mean().values


def prev_period(pid, h, l):
    """High/low periode sebelumnya, dipetakan ke tiap bar periode sekarang."""
    df = pd.DataFrame({'p': pid, 'h': h, 'l': l})
    g = df.groupby('p').agg(h=('h', 'max'), l=('l', 'min'))
    ph, pl = g.h.shift(1), g.l.shift(1)
    return ph.reindex(pid).values, pl.reindex(pid).values


def levels(t, o, h, l, c, crypto, atr):
    n = len(t)
    shift = 0 if crypto else 120  # hari forex mulai 22:00 UTC
    day = (t + shift) // 1440
    week = (day + 3) // 7
    L = {}
    a, b = prev_period(day, h, l); L['PDH/PDL'] = (b, a)
    a, b = prev_period(week, h, l); L['PWH/PWL'] = (b, a)
    # open harian: support jika harga di atasnya, resistance jika di bawah
    dopen = pd.Series(o).groupby(day).transform('first').values
    pc = np.r_[np.nan, c[:-1]]
    L['Daily Open'] = (np.where(pc > dopen, dopen, np.nan), np.where(pc < dopen, dopen, np.nan))
    # range Asia 00-07 UTC, berlaku 07:00-20:59 UTC
    hr = (t // 60) % 24; uday = t // 1440
    m = hr < 7
    ah = pd.Series(np.where(m, h, np.nan)).groupby(uday).transform('max').values
    al = pd.Series(np.where(m, l, np.nan)).groupby(uday).transform('min').values
    win = (hr >= 7) & (hr < 21)
    L['Asia H/L'] = (np.where(win, al, np.nan), np.where(win, ah, np.nan))
    for nm, sp in (('EMA50 H1', 100), ('EMA200 H1', 400)):
        e = np.r_[np.nan, ema(c, sp)[:-1]]
        L[nm] = (np.where(pc > e, e, np.nan), np.where(pc < e, e, np.nan))
    # angka bulat: step = angka "nice" ~ 0.5x rata2 range harian 30 hari sebelumnya (dihitung per bulan)
    mon = t // (1440 * 30)
    med = pd.Series(atr * 48).groupby(mon).transform('median').shift(1).bfill().values
    raw = 0.5 * med
    mag = 10 ** np.floor(np.log10(np.maximum(raw, 1e-12)))
    f = raw / mag
    step = np.where(f < 1.5, 1, np.where(f < 3.5, 2.5, np.where(f < 7.5, 5, 10))) * mag
    L['Round Number'] = (np.floor(pc / step) * step, np.ceil(pc / step) * step)
    # pivot H1 (fractal 3 kiri/kanan) yang belum ditembus close + FVG M30 yang belum terisi
    hid = t // 60
    H = pd.DataFrame({'k': hid, 'h': h, 'l': l}).groupby('k').agg(h=('h', 'max'), l=('l', 'min'))
    hk, hh, hl = H.index.values, H.h.values, H.l.values
    P = 3
    phv = pd.Series(hh).rolling(2 * P + 1, center=True).max().values
    plv = pd.Series(hl).rolling(2 * P + 1, center=True).min().values
    conf = {}  # menit konfirmasi -> list (type, price)
    for k in range(P, len(hk) - P):
        ct = (hk[k + P] + 1) * 60
        if hh[k] == phv[k]: conf.setdefault(ct, []).append((1, hh[k]))
        if hl[k] == plv[k]: conf.setdefault(ct, []).append((-1, hl[k]))
    psup = np.full(n, np.nan); pres = np.full(n, np.nan)
    fsup = np.full(n, np.nan); fres = np.full(n, np.nan)
    highs, lows, bull, bear = [], [], [], []
    for i in range(3, n):
        for typ, px in conf.get(int(t[i]), ()):
            (highs if typ == 1 else lows).append(px)
        x = c[i - 1]
        lows = [v for v in lows if v < x][-12:]
        highs = [v for v in highs if v > x][-12:]
        if lows: psup[i] = max(lows)
        if highs: pres[i] = min(highs)
        # FVG terbentuk di bar i-1 (pola i-3, i-2, i-1)
        if l[i - 1] > h[i - 3]: bull.append(l[i - 1])
        if h[i - 1] < l[i - 3]: bear.append(h[i - 1])
        bull = [v for v in bull if v < x][-8:]
        bear = [v for v in bear if v > x][-8:]
        if bull: fsup[i] = max(bull)
        if bear: fres[i] = min(bear)
    L['Swing SNR H1'] = (psup, pres)
    L['FVG M30'] = (fsup, fres)
    rng = np.random.default_rng(7)
    u = rng.uniform(0.5, 1.5, n)
    L['RANDOM (baseline)'] = (pc - u * atr, pc + u * atr)
    return L


DEDUPE = {'EMA50 H1': False, 'EMA200 H1': False, 'RANDOM (baseline)': False}


def run_symbol(sym):
    t, o, h, l, c = load(sym)
    crypto = cls(sym) == 'CRYPTO'
    cost_px = (0.0008 * c) if crypto else np.full(len(c), FX_COST[sym])
    tr = np.maximum(h - l, np.maximum(abs(h - np.r_[c[0], c[:-1]]), abs(l - np.r_[c[0], c[:-1]])))
    atr = np.r_[np.nan, pd.Series(tr).rolling(14).mean().values[:-1]]
    L = levels(t, o, h, l, c, crypto, atr)
    pc = np.r_[np.nan, c[:-1]]
    e400 = np.r_[np.nan, ema(c, 400)[:-1]]
    hr = (t // 60) % 24
    weeks = (t[-1] - t[0]) / (1440 * 7)
    weeks_oos = max(1e-9, (t[-1] - max(t[0], OOS_FROM)) / (1440 * 7))
    rows = []
    for nm, (sup, res) in L.items():
        base = np.isfinite(atr) & (atr > 0)
        lt = base & np.isfinite(sup) & (l <= sup) & (pc > sup) & (o > sup)
        st = base & np.isfinite(res) & (h >= res) & (pc < res) & (o < res)
        for mode in ('touch', 'confirm', 'break'):
            if mode == 'break':  # close menembus resistance -> BUY, menembus support -> SELL
                lm = base & np.isfinite(res) & (c > res) & (pc < res)
                sm = base & np.isfinite(sup) & (c < sup) & (pc > sup)
            else:
                lm = lt & (c > sup) if mode == 'confirm' else lt
                sm = st & (c < res) if mode == 'confirm' else st
            for flt in ('none', 'trend', 'session'):
                if flt == 'trend':
                    lf = lm & (pc > e400); sf = sm & (pc < e400)
                elif flt == 'session':
                    ss = (hr >= 7) & (hr < 20); lf = lm & ss; sf = sm & ss
                else:
                    lf, sf = lm, sm
                li, si = np.nonzero(lf)[0], np.nonzero(sf)[0]
                lvl, lvs = (res, sup) if mode == 'break' else (sup, res)
                cd = pd.DataFrame({'i': np.r_[li, si], 'side': np.r_[np.ones(len(li), int), -np.ones(len(si), int)],
                                   'lv': np.r_[lvl[li], lvs[si]]})
                if DEDUPE.get(nm, True):
                    cd['key'] = np.round(cd.lv.values, 10)
                    if nm == 'Round Number': cd['key'] = cd.key.astype(str) + '_' + (t[cd.i.values] // 1440).astype(str)
                    cd = cd.drop_duplicates(['side', 'key'])
                cd = cd.sort_values('i')
                cand = list(zip(cd.i.values, cd.side.values, cd.lv.values))
                for s in ((1.0, 2.0) if mode != 'confirm' else (0,)):
                    for rr in (1.0, 2.0):
                        r = simulate_var(cand, o, h, l, c, atr, cost_px, mode, s, rr, t)
                        rows.append(stats(sym, nm, mode, flt, s, rr, r, weeks, weeks_oos))
    return rows


def simulate_var(cand, o, h, l, c, atr, cost_px, mode, s, rr, t):
    n = len(c); busy = -1; out = []
    for i, side, lv in cand:
        if i <= busy: continue
        cost = cost_px[i]
        if mode == 'break':
            e = c[i]; risk = s * atr[i]
            sl = e - side * risk; tp = e + side * rr * risk
        elif mode == 'touch':
            e = lv; risk = s * atr[i]
            sl = e - side * risk; tp = e + side * rr * risk
            if (side == 1 and l[i] <= sl) or (side == -1 and h[i] >= sl):
                out.append((t[i], -1 - cost / risk, 0)); busy = i; continue
        else:
            e = c[i]
            sl = (l[i] - 0.1 * atr[i]) if side == 1 else (h[i] + 0.1 * atr[i])
            risk = abs(e - sl)
            if risk < 0.3 * atr[i] or risk > 3 * atr[i]: continue
            tp = e + side * rr * risk
        j0, j1 = i + 1, min(i + 1 + MAXHOLD, n)
        if j0 >= n: break
        if side == 1:
            hs = l[j0:j1] <= sl; ht = h[j0:j1] >= tp
        else:
            hs = h[j0:j1] >= sl; ht = l[j0:j1] <= tp
        ks = np.argmax(hs) if hs.any() else 10 ** 9
        kt = np.argmax(ht) if ht.any() else 10 ** 9
        if ks == 10 ** 9 and kt == 10 ** 9:
            k = j1 - j0 - 1; R = side * (c[j0 + k] - e) / risk
        elif ks <= kt:
            k = ks; R = -1.0
        else:
            k = kt; R = rr
        out.append((t[i], R - cost / risk, k + 1)); busy = j0 + k
    return np.array(out) if out else np.zeros((0, 3))


def stats(sym, nm, mode, flt, s, rr, r, weeks, weeks_oos):
    def pf(R):
        gl = -R[R < 0].sum(); return R[R > 0].sum() / gl if gl > 0 else np.nan
    R = r[:, 1] if len(r) else np.zeros(0)
    oo = r[:, 0] >= OOS_FROM if len(r) else np.zeros(0, bool)
    Ro = R[oo]
    return dict(sym=sym, cls=cls(sym), level=nm, mode=mode, filter=flt, sl_atr=s, rr=rr, n=len(R),
                per_week=len(R) / weeks, wr=(R > 0).mean() if len(R) else np.nan, pf=pf(R),
                avgR=R.mean() if len(R) else np.nan, n_oos=len(Ro), per_week_oos=len(Ro) / weeks_oos,
                wr_oos=(Ro > 0).mean() if len(Ro) else np.nan, pf_oos=pf(Ro), avgR_oos=Ro.mean() if len(Ro) else np.nan)


if __name__ == '__main__':
    out = sys.argv[1]
    m = json.load(open(f'{D}/manifest.json'))
    syms = sys.argv[2:] or sorted({v['symbol'] for k, v in m.items() if v['tf'] == 'M30' and v['symbol'] not in ('BTCUSD', 'ETHUSD')})
    with Pool(4) as p:
        allrows = []
        for k, rows in enumerate(p.imap_unordered(run_symbol, syms)):
            allrows += rows
            print(k + 1, len(syms), rows[0]['sym'], flush=True)
    pd.DataFrame(allrows).to_csv(out, index=False)
