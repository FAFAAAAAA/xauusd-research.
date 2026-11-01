import sys, json
exec(open('momfib.py').read().split("def run(")[0])
E.SPREAD, E.SLIP, E.COMM = SP, SLIP, COMM
h1 = df.resample('1h').agg({'o':'first','h':'max','l':'min','c':'last'}).dropna()
SW = {}
def swings(P):
    if P in SW: return SW[P]
    a = h1; step = pd.Timedelta('1h'); at_ = E.atr(a, 14).values; hi, lo = a.h.values, a.l.values
    phv = pd.Series(hi).rolling(2*P+1, center=True).max().values; plv = pd.Series(lo).rolling(2*P+1, center=True).min().values
    ev = []
    for k in range(P, len(a) - P):
        ct = a.index[k + P] + step
        if hi[k] == phv[k]: ev.append((ct, 1, hi[k], at_[k + P]))
        if lo[k] == plv[k]: ev.append((ct, -1, lo[k], at_[k + P]))
    ev.sort(key=lambda e: e[0]); SW[P] = ev; return ev
HR = T.hour.values; MIN = T.minute.values
def run(nm, P=3, buf=0.1, trig='m15', fresh=None, slmax=None, slmin=None, hours=None, trend=True, body=None, bsl='C'):
    ev = swings(P); ei = 0; seq = []; used = set(); sig = []
    for i in range(4, N):
        while ei < len(ev) and ev[ei][0] <= T[i]:
            ct, ty, px, a = ev[ei]; ei += 1
            if not np.isfinite(a): continue
            if seq and seq[-1][0] == ty:
                if (ty == 1 and px > seq[-1][1]) or (ty == -1 and px < seq[-1][1]): seq[-1] = [ty, px, a, ct]
            else: seq.append([ty, px, a, ct])
            seq = seq[-6:]
        if len(seq) < 3: continue
        if trig == 'h1' and MIN[i] != 45: continue
        s3, s2, s1 = seq[-3], seq[-2], seq[-1]
        prev = C[i-4] if trig == 'h1' else C[i-1]
        if hours is not None and HR[i] not in hours: continue
        if fresh is not None and (T[i] - s1[3]) > pd.Timedelta(hours=fresh): continue
        for side in (1, -1):
            if side == 1:
                ok = s1[0] == -1 and s2[0] == 1 and s3[0] == -1 and s1[1] > s3[1] and C[i] > s2[1] and prev <= s2[1] and (not trend or UP[i])
            else:
                ok = s1[0] == 1 and s2[0] == -1 and s3[0] == 1 and s1[1] < s3[1] and C[i] < s2[1] and prev >= s2[1] and (not trend or DN[i])
            if not ok: continue
            key = (side, s2[1])
            if key in used: continue
            used.add(key)
            a = s1[2]
            if body is not None and abs(C[i] - O[i]) < body * atr[i]: continue
            sl = (s1[1] if bsl == 'C' else C[i] - side * bsl * a) - side * buf * a
            d = abs(C[i] - sl)
            if slmax is not None and d > slmax * a: continue
            if slmin is not None and d < slmin * a: continue
            sig.append((i, side, sl))
    rows = [E.simulate(df, np.array([i]), np.array([s]), np.array([sl]), rr=2.0) for i, s, sl in sig]
    rows = [x for x in rows if not x.empty]
    if not rows: print(f"{nm:34s} no trades", flush=True); return
    t = pd.concat(rows); lot = 10 / ((t.entry - t.sl).abs() * 100)
    et, xt = pd.to_datetime(t.entry_t), pd.to_datetime(t.exit_t)
    ng = (((xt - pd.Timedelta('21h')).dt.floor('D') - (et - pd.Timedelta('21h')).dt.floor('D')).dt.days).clip(lower=0)
    t['pnl'] = t.pnl - np.where(t.side > 0, 67, -25) * ng * lot
    hold = (xt - et).dt.total_seconds() / 3600
    y = et.dt.year; R = t.pnl.values / 10; eq = np.cumsum(R); dd = (np.maximum.accumulate(np.r_[0, eq])[1:] - eq).max(); gp, gl = R[R > 0].sum(), -R[R < 0].sum()
    a, b = t.pnl[y <= 2017], t.pnl[y >= 2018]
    pf = lambda s: s[s > 0].sum() / max(1e-9, -s[s < 0].sum())
    print(f"{nm:34s} {len(t)/(22.3*12):4.1f}/bln win {100*(R>0).mean():4.1f}% tot {t.pnl.sum():+6.0f} PF {gp/gl:.2f} DD {dd*10:4.0f} | 04-17 {a.sum():+5.0f} PF {pf(a):.2f} | 18-26 {b.sum():+5.0f} PF {pf(b):.2f} | hold med {hold.median():4.1f}h <24h {100*(hold<24).mean():3.0f}%", flush=True)
    return t
G = sys.argv[1]
if G == 'a':
    run('BASE P3 buf0.1 m15')
    for P in (2, 4, 5): run(f'P{P}', P=P)
    for b in (0.0, 0.3, 0.5): run(f'buf{b}', buf=b)
elif G == 'b':
    run('trig H1 close', trig='h1')
    for f in (12, 24, 48): run(f'fresh {f}h', fresh=f)
    for m in (2, 3, 4): run(f'SL max {m} ATR', slmax=m)
elif G == 'c':
    for m in (0.5, 1.0): run(f'SL min {m} ATR', slmin=m)
    run('jam 07-20 UTC (London+NY)', hours=set(range(7, 21)))
    run('jam 12-20 UTC (NY)', hours=set(range(12, 21)))
    run('jam 07-12 UTC (London)', hours=set(range(7, 12)))
    run('skip jam 21-01', hours=set(range(1, 21)))
elif G == 'd':
    for bd in (0.5, 1.0): run(f'body >= {bd} ATR M15', body=bd)
    for k in (1.0, 1.5, 2.0): run(f'SL tetap {k} ATR H1', bsl=k, buf=0)
