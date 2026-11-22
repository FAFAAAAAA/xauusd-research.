# Empat ide baru, RR 1:2 tanpa parsial, statistik < 2022 (pilih) dan >= 2022 (uji), biaya ikut respect_scan.cost_array.
#   A momentum lintas koin : tiap Senin rangking return L hari, long K teratas / short K terbawah (mom) atau kebalikannya (rev).
#                            SL k x ATR14 D1, tahan maks 7 hari.
#   B funding rate Binance : funding ekstrem (persentil 95/5 dari 90 hari, atau absolut) -> lawan kerumunan (fade) atau ikut (follow).
#   C BTC pemimpin         : BTC bergerak > z x ATR dalam 2 candle M30, alt belum ikut (< 0.5 ATR) -> masuk alt searah BTC (lag)
#                            atau berlawanan (fade, kontrol).
#   D pola waktu           : masuk di jam UTC tertentu (tiap 2 jam) x hari (semua / Senin..Minggu) x arah (long/short/ikut EMA20 D1).
# Usage: python3 scripts/research/new_ideas.py <out_dir> <funding_zip_dir> [A B C D]
import sys, os, json, glob, zipfile, io
import numpy as np, pandas as pd
from functools import partial
from multiprocessing import Pool
sys.path.insert(0, 'scripts/research')
from respect_scan import load, cls, ema, cost_array
import snr_trend_scan as S

SPLIT = int(pd.Timestamp('2022-01-01').value // 60_000_000_000)
M = json.load(open('data/market/manifest.json'))
OLD = sorted(v['symbol'] for v in M.values() if v['tf'] == 'M30' and v['first'] < pd.Timestamp('2021-01-01').value // 10**6)
CRYPTO = [s for s in OLD if cls(s) == 'CRYPTO']


def stats(r):
    row = {}
    for pn, msk in (('is', r[:, 0] < SPLIT), ('wf', r[:, 0] >= SPLIT)) if len(r) else ():
        R = r[msk, 1]; tt = r[msk, 0]
        yr = pd.Series(R).groupby(pd.to_datetime(tt, unit='m').year).sum()
        row.update({f'n_{pn}': len(R), f'win_{pn}': int((R > 0).sum()), f'gp_{pn}': R[R > 0].sum(), f'gl_{pn}': -R[R < 0].sum(),
                    f'weeks_{pn}': (tt.max() - tt.min()) / (1440 * 7) if len(tt) > 1 else 0,
                    f'yrs_{pn}': len(yr), f'yrs_pos_{pn}': int((yr > 0).sum()), f'hold_{pn}': np.median(r[msk, 2]) * 0.5 if len(R) else np.nan})
    return row


def prep(sym):
    t, o, h, l, c = load(sym); crypto = cls(sym) == 'CRYPTO'
    cost = cost_array(sym, c); pcl = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(abs(h - pcl), abs(l - pcl)))
    atr = np.r_[np.nan, pd.Series(tr).rolling(14).mean().values[:-1]]
    day = (t + (0 if crypto else 120)) // 1440
    g = pd.DataFrame({'d': day, 'h': h, 'l': l, 'c': c}).groupby('d').agg(h=('h', 'max'), l=('l', 'min'), c=('c', 'last'))
    dtr = np.maximum(g.h - g.l, np.maximum(abs(g.h - g.c.shift(1)), abs(g.l - g.c.shift(1))))
    atr_d = dtr.rolling(14).mean().shift(1).reindex(day).values
    td = np.sign(g.c - g.c.ewm(span=20, adjust=False).mean()).shift(1).reindex(day).values
    return dict(t=t, o=o, h=h, l=l, c=c, cost=cost, atr=atr, atr_d=atr_d, day=day, g=g, td=td)


def sim(P, cand, hold_bars):
    S.MAXHOLD = hold_bars
    return S.sim(cand, P['h'], P['l'], P['c'], P['cost'], 'rr2', P['t'])


# ---------- A: momentum lintas koin ----------
def run_A(_):
    P = {s: prep(s) for s in CRYPTO}
    close = pd.DataFrame({s: P[s]['g'].c for s in CRYPTO}).sort_index()
    rows = []
    for L in (7, 14, 28):
        ret = close / close.shift(L) - 1
        for K in (3, 5):
            for mode in ('mom', 'rev'):
                picks = {s: [] for s in CRYPTO}  # (day, side)
                for d in close.index:
                    if (d + 3) % 7 != 0: continue  # Senin
                    r = ret.loc[:d - 1].iloc[-1] if (ret.index < d).any() else None
                    if r is None: continue
                    r = r.dropna()
                    if len(r) < 2 * K + 4: continue
                    top, bot = r.nlargest(K).index, r.nsmallest(K).index
                    for s in top: picks[s].append((d, 1 if mode == 'mom' else -1))
                    for s in bot: picks[s].append((d, -1 if mode == 'mom' else 1))
                for k in (1.0, 2.0):
                    for sd_f in ('both', 'long', 'short'):
                        for s in CRYPTO:
                            Q = P[s]; cand = []
                            for d, sd in picks[s]:
                                if sd_f == 'long' and sd != 1: continue
                                if sd_f == 'short' and sd != -1: continue
                                i = int(np.searchsorted(Q['t'], d * 1440))
                                if i >= len(Q['t']) or not np.isfinite(Q['atr_d'][i]): continue
                                e = Q['c'][i]; cand.append((i, sd, e, e - sd * k * Q['atr_d'][i], False))
                            r_ = sim(Q, cand, 336)
                            rows.append(dict(family='A momentum lintas koin', rule=f'{mode} L{L} K{K} | SL{k} ATR D1 | {sd_f}', sym=s, **stats(r_)))
    return rows


# ---------- B: funding ----------
def load_funding(fdir, sym):
    fs = sorted(glob.glob(f'{fdir}/{sym}-fundingRate-*.zip'))
    if not fs: return None
    parts = []
    for f in fs:
        try:
            z = zipfile.ZipFile(f); parts.append(pd.read_csv(io.BytesIO(z.read(z.namelist()[0]))))
        except Exception:
            continue
    d = pd.concat(parts)
    return pd.DataFrame({'t': (d.calc_time.values // 60000).astype(np.int64), 'f': d.last_funding_rate.values.astype(float)}).sort_values('t')


def run_B(sym, fdir):
    fsym = {'BTCUSD': 'BTCUSDT', 'ETHUSD': 'ETHUSDT'}.get(sym, sym)
    F = load_funding(fdir, fsym)
    if F is None or len(F) < 300: return []
    P = prep(sym); rows = []
    hi = F.f.rolling(270).quantile(0.95).shift(1).values; lo = F.f.rolling(270).quantile(0.05).shift(1).values
    sig = {'persentil': ((F.f.values >= hi) & (F.f.values > 0.0003), (F.f.values <= lo) & (F.f.values < 0)),
           'absolut': (F.f.values > 0.0005, F.f.values < -0.0002)}
    for sn, (crowd_long, crowd_short) in sig.items():
        for mode in ('fade', 'follow'):
            for tf_ in ('none', 'EMA20 D1'):
                ev = [(tt, -1) for tt in F.t.values[crowd_long]] + [(tt, 1) for tt in F.t.values[crowd_short]]
                ev.sort()
                for k in (3.0, 5.0):
                    for hn, hb in (('24j', 48), ('5h', 240)):
                        cand = []
                        for tt, sd in ev:
                            sd = sd if mode == 'fade' else -sd
                            i = int(np.searchsorted(P['t'], tt))
                            if i >= len(P['t']) or not np.isfinite(P['atr'][i]): continue
                            if tf_ != 'none' and P['td'][i] != sd: continue
                            e = P['c'][i]; cand.append((i, sd, e, e - sd * k * P['atr'][i], False))
                        r_ = sim(P, cand, hb)
                        rows.append(dict(family='B funding', rule=f'{sn} {mode} | {tf_} | SL{k} | {hn}', sym=sym, **stats(r_)))
    return rows


# ---------- C: BTC pemimpin ----------
def run_C(sym):
    if sym == 'BTCUSD': return []
    P = prep(sym); B = prep('BTCUSD')
    idx = np.searchsorted(B['t'], P['t']); ok = (idx < len(B['t'])) & (B['t'][np.minimum(idx, len(B['t']) - 1)] == P['t'])
    bc = np.where(ok, B['c'][np.minimum(idx, len(B['t']) - 1)], np.nan); batr = np.where(ok, B['atr'][np.minimum(idx, len(B['t']) - 1)], np.nan)
    bmove = (bc - np.r_[np.nan, np.nan, bc[:-2]]) / batr
    amove = (P['c'] - np.r_[np.nan, np.nan, P['c'][:-2]]) / P['atr']
    rows = []
    for z in (1.5, 2.5):
        up = (bmove > z) & (amove < 0.5); dn = (bmove < -z) & (amove > -0.5)
        for mode in ('lag', 'fade'):
            li, si = np.nonzero(up if mode == 'lag' else dn)[0], np.nonzero(dn if mode == 'lag' else up)[0]
            cd = np.r_[np.c_[li, np.ones(len(li), int)], np.c_[si, -np.ones(len(si), int)]]
            cd = cd[np.argsort(cd[:, 0])] if len(cd) else cd
            for k in (2.0, 3.0, 5.0):
                cand = [(int(i), int(sd), P['c'][i], P['c'][i] - sd * k * P['atr'][i], False) for i, sd in cd if np.isfinite(P['atr'][i])]
                for hn, hb in (('8j', 16), ('24j', 48)):
                    r_ = sim(P, cand, hb)
                    rows.append(dict(family='C BTC pemimpin', rule=f'{mode} z{z} | SL{k} | {hn}', sym=sym, **stats(r_)))
    return rows


# ---------- D: pola waktu ----------
def run_D(sym):
    P = prep(sym); t = P['t']; rows = []
    mins = t % 1440; dow = ((t // 1440) + 3) % 7  # 0 = Senin (UTC)
    for H in range(0, 24, 2):
        at = np.nonzero((mins == H * 60) & np.isfinite(P['atr']))[0]
        for dn in ['semua'] + list(range(7)):
            ii = at if dn == 'semua' else at[dow[at] == dn]
            for side in ('long', 'short', 'ikut EMA20 D1'):
                sd = np.ones(len(ii)) if side == 'long' else (-np.ones(len(ii)) if side == 'short' else P['td'][ii])
                cand = [(int(i), int(s), P['c'][i], P['c'][i] - s * 3.0 * P['atr'][i], False) for i, s in zip(ii, sd) if s in (1, -1)]
                r_ = sim(P, cand, 16)
                hari = dn if dn == 'semua' else ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'][dn]
                rows.append(dict(family='D pola waktu', rule=f'{H:02d}:00 UTC | {hari} | {side} | SL3 | 8j', sym=sym, **stats(r_)))
    return rows


if __name__ == '__main__':
    out, fdir = sys.argv[1], sys.argv[2]; which = sys.argv[3:] or list('ABCD')
    with Pool(4) as p:
        if 'A' in which:
            pd.DataFrame(run_A(None)).to_csv(f'{out}/idea_A.csv', index=False); print('A selesai', flush=True)
        if 'B' in which:
            pd.DataFrame(sum(p.map(partial(run_B, fdir=fdir), CRYPTO), [])).to_csv(f'{out}/idea_B.csv', index=False); print('B selesai', flush=True)
        if 'C' in which:
            pd.DataFrame(sum(p.map(run_C, CRYPTO), [])).to_csv(f'{out}/idea_C.csv', index=False); print('C selesai', flush=True)
        if 'D' in which:
            pd.DataFrame(sum(p.map(run_D, OLD), [])).to_csv(f'{out}/idea_D.csv', index=False); print('D selesai', flush=True)
