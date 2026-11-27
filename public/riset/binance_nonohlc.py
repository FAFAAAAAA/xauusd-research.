"""
Binance USD-M Futures NON-OHLC data (data.binance.vision, free) -> one H1 table per coin, point-in-time (no lookahead).

  python binance_nonohlc.py unduh  --data C:\\bdata --koin koin448.csv          (download, can be stopped and resumed)
  python binance_nonohlc.py susun  --data C:\\bdata --koin koin448.csv          (build C:\\bdata\\h1\\<SYMBOL>.parquet)
  python binance_nonohlc.py cek    --data C:\\bdata --symbol BTCUSDT            (show a few rows of one coin)

Sources (monthly files for finished months, daily files for the current month):
  klines 1h            futures/um/{monthly|daily}/klines/S/1h/S-1h-YYYY-MM(-DD).zip
  premiumIndexKlines   futures/um/{monthly|daily}/premiumIndexKlines/S/1h/S-1h-YYYY-MM(-DD).zip
  fundingRate          futures/um/monthly/fundingRate/S/S-fundingRate-YYYY-MM.zip
  metrics (5 minutes)  futures/um/daily/metrics/S/S-metrics-YYYY-MM-DD.zip        (exists from Dec 2021)

H1 row with open time t (UTC) uses ONLY information known at its close (t + 1 h):
  qv, tbq           quote volume and taker-buy quote volume of that candle (kline columns 8 and 11)
  delta, buy_ratio  2*tbq - qv  and  tbq / qv
  vol_surge         qv / mean(qv of the previous 24 candles)
  prem_c / prem_l   premium index (futures vs index price) close / low of that candle
  fund, fund_t      last SETTLED funding rate with calc_time <= candle close, and its time
  oi_val, oi, top_acc, top_pos, ls_acc, taker_ls   last metrics snapshot with create_time <= close - LAG (5 min safety lag)
"""
import argparse, concurrent.futures as cf, io, os, sys, time, urllib.request, urllib.error, zipfile, datetime as dt
import pandas as pd, numpy as np

BASE = 'https://data.binance.vision/data/futures/um'
LAG_S = 300                      # metrics: only snapshots at least 5 minutes before the candle close
KL = ['open_time', 'open', 'high', 'low', 'close', 'volume', 'close_time', 'quote_volume', 'count', 'taker_buy_volume', 'taker_buy_quote_volume', 'ignore']
MT = ['create_time', 'symbol', 'sum_open_interest', 'sum_open_interest_value', 'count_toptrader_long_short_ratio',
      'sum_toptrader_long_short_ratio', 'count_long_short_ratio', 'sum_taker_long_short_vol_ratio']

def months(a, b):
    p, q = pd.Period(a, 'M'), pd.Period(b, 'M')
    while p <= q: yield p; p += 1

def jobs(sym, a, b, what):
    today = dt.datetime.utcnow().date(); cur = pd.Period(today, 'M')
    for p in months(a, b):
        ym = p.strftime('%Y-%m'); days = [d for d in pd.date_range(p.start_time, p.end_time, freq='D') if d.date() < today]
        if p < cur:
            if 'klines' in what: yield f'monthly/klines/{sym}/1h/{sym}-1h-{ym}.zip', f'klines/{sym}/{sym}-1h-{ym}.zip'
            if 'premium' in what: yield f'monthly/premiumIndexKlines/{sym}/1h/{sym}-1h-{ym}.zip', f'premium/{sym}/{sym}-1h-{ym}.zip'
            if 'funding' in what: yield f'monthly/fundingRate/{sym}/{sym}-fundingRate-{ym}.zip', f'funding/{sym}/{sym}-fundingRate-{ym}.zip'
        else:                                                # current month: daily files
            for d in days:
                ymd = d.strftime('%Y-%m-%d')
                if 'klines' in what: yield f'daily/klines/{sym}/1h/{sym}-1h-{ymd}.zip', f'klines/{sym}/{sym}-1h-{ymd}.zip'
                if 'premium' in what: yield f'daily/premiumIndexKlines/{sym}/1h/{sym}-1h-{ymd}.zip', f'premium/{sym}/{sym}-1h-{ymd}.zip'
        if 'metrics' in what and p >= pd.Period('2021-12', 'M'):
            for d in days:
                ymd = d.strftime('%Y-%m-%d'); yield f'daily/metrics/{sym}/{sym}-metrics-{ymd}.zip', f'metrics/{sym}/{sym}-metrics-{ymd}.zip'

def fetch(url_path, out):
    if os.path.exists(out) or os.path.exists(out + '.404'): return 'ada'
    os.makedirs(os.path.dirname(out), exist_ok=True)
    for k in range(4):
        try:
            with urllib.request.urlopen(f'{BASE}/{url_path}', timeout=60) as r: b = r.read()
            tmp = out + '.part'; open(tmp, 'wb').write(b); os.replace(tmp, out); return 'ok'
        except urllib.error.HTTPError as e:
            if e.code == 404: open(out + '.404', 'w').close(); return '404'
            time.sleep(2 * (k + 1))
        except Exception:
            time.sleep(2 * (k + 1))
    return 'gagal'

def unduh(a):
    K = pd.read_csv(a.koin); what = set(a.jenis.split(','))
    todo = [(u, os.path.join(a.data, 'raw', o)) for s, m0, m1 in K[['symbol', 'mulai', 'akhir']].itertuples(index=False) for u, o in jobs(s, m0, m1, what)]
    print(f'{len(todo):,} file di daftar (yang sudah ada dilewati)'); t0 = time.time(); cnt = {}
    with cf.ThreadPoolExecutor(a.threads) as ex:
        for i, r in enumerate(ex.map(lambda x: fetch(*x), todo), 1):
            cnt[r] = cnt.get(r, 0) + 1
            if i % 2000 == 0 or i == len(todo):
                el = time.time() - t0; print(f'{i:,}/{len(todo):,}  {cnt}  {el / 60:.1f} mnt, sisa ±{el / i * (len(todo) - i) / 60:.0f} mnt', flush=True)
    print('Selesai. Kalau ada "gagal", jalankan perintah yang sama lagi (yang sudah ada dilewati).')

def read_zips(folder, cols):
    if not os.path.isdir(folder): return None
    parts = []
    for f in sorted(os.listdir(folder)):
        if not f.endswith('.zip'): continue
        try:
            with zipfile.ZipFile(os.path.join(folder, f)) as z: raw = z.read(z.namelist()[0]).decode()
        except Exception: continue
        first = raw.split('\n', 1)[0]
        df = pd.read_csv(io.StringIO(raw), header=0 if not first[:1].isdigit() else None)
        if df.shape[1] == len(cols): df.columns = cols
        parts.append(df)
    return pd.concat(parts, ignore_index=True) if parts else None

def susun_satu(a, sym):
    R = os.path.join(a.data, 'raw')
    k = read_zips(os.path.join(R, 'klines', sym), KL)
    if k is None: return f'{sym}: tidak ada klines'
    k = k.drop_duplicates('open_time').sort_values('open_time')
    H = pd.DataFrame({'t': (k.open_time // 1000).astype('int64'), 'o': k.open, 'h': k.high, 'l': k.low, 'c': k.close,
                      'qv': k.quote_volume.astype(float), 'tbq': k.taker_buy_quote_volume.astype(float), 'n': k['count']})
    H['delta'] = 2 * H.tbq - H.qv; H['buy_ratio'] = np.where(H.qv > 0, H.tbq / H.qv, np.nan)
    H['vol_surge'] = H.qv / H.qv.shift(1).rolling(24, min_periods=12).mean()
    H['close_t'] = H.t + 3600
    p = read_zips(os.path.join(R, 'premium', sym), KL)
    if p is not None:
        p = p.drop_duplicates('open_time'); p = pd.DataFrame({'t': (p.open_time // 1000).astype('int64'), 'prem_c': p.close.astype(float), 'prem_l': p.low.astype(float)})
        H = H.merge(p, on='t', how='left')
    f = read_zips(os.path.join(R, 'funding', sym), ['calc_time', 'funding_interval_hours', 'last_funding_rate'])
    if f is not None:
        f = pd.DataFrame({'fund_t': (f.calc_time // 1000).astype('int64'), 'fund': f.last_funding_rate.astype(float)}).drop_duplicates('fund_t').sort_values('fund_t')
        H = pd.merge_asof(H.sort_values('close_t'), f, left_on='close_t', right_on='fund_t', direction='backward')
        H.loc[(H.close_t - H.fund_t) > 12 * 3600, ['fund', 'fund_t']] = np.nan       # no settled funding in the last 12 h = unknown (e.g. current month)
    m = read_zips(os.path.join(R, 'metrics', sym), MT)
    if m is not None:
        m = pd.DataFrame({'met_t': ((pd.to_datetime(m.create_time) - pd.Timestamp('1970-01-01')).dt.total_seconds()).astype('int64'), 'oi': m.sum_open_interest, 'oi_val': m.sum_open_interest_value,
                          'top_acc': m.count_toptrader_long_short_ratio, 'top_pos': m.sum_toptrader_long_short_ratio,
                          'ls_acc': m.count_long_short_ratio, 'taker_ls': m.sum_taker_long_short_vol_ratio}).drop_duplicates('met_t').sort_values('met_t')
        H['_k'] = H.close_t - LAG_S
        H = pd.merge_asof(H.sort_values('_k'), m, left_on='_k', right_on='met_t', direction='backward', tolerance=3600).drop(columns='_k')
    H = H.sort_values('t').reset_index(drop=True)
    os.makedirs(os.path.join(a.data, 'h1'), exist_ok=True)
    H.to_parquet(os.path.join(a.data, 'h1', f'{sym}.parquet'), index=False)
    return f'{sym}: {len(H):,} jam, {pd.to_datetime(H.t.iloc[0], unit="s"):%Y-%m} s/d {pd.to_datetime(H.t.iloc[-1], unit="s"):%Y-%m}'

def susun(a):
    K = pd.read_csv(a.koin)
    with cf.ProcessPoolExecutor(max(1, (os.cpu_count() or 2) - 1)) as ex:
        for msg in ex.map(susun_satu, [a] * len(K), K.symbol): print(msg, flush=True)

def cek(a):
    H = pd.read_parquet(os.path.join(a.data, 'h1', f'{a.symbol}.parquet'))
    pd.set_option('display.width', 250); pd.set_option('display.max_columns', 30)
    print(H.tail(5)); print('\nkolom kosong (%):'); print((H.isna().mean() * 100).round(1).to_string())

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('perintah', choices=['unduh', 'susun', 'cek'])
    ap.add_argument('--data', default=r'C:\bdata'); ap.add_argument('--koin', default='koin448.csv'); ap.add_argument('--symbol', default='BTCUSDT')
    ap.add_argument('--jenis', default='klines,premium,funding,metrics'); ap.add_argument('--threads', type=int, default=16)
    a = ap.parse_args(); {'unduh': unduh, 'susun': susun, 'cek': cek}[a.perintah](a)
