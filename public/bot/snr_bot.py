#!/usr/bin/env python3
"""
v1 SNR bot — Binance USDⓈ-M Futures (support break SELL for altcoins). Same rules as the website (metode snr-sell-v1):

  Support  = an H4 low that is the lowest of the 5 H4 candles on each side (known after the 5 candles to its right closed);
             the 10 most recent supports are watched, each is used once.
  SELL     = an H4 candle CLOSES below a watched support while the H4 candle before it closed at or above it,
             the coin's last completed D1 close is below EMA50 (D1) and its 30-day average quote volume is >= $20 jt.
  SL       = support + 0.5 x ATR14(H4)  ->  STOP_MARKET (close position)
  TP       = entry - 2 x (SL - entry)   ->  TAKE_PROFIT_MARKET (close position)          RR 1:2, exits only at TP or SL
  Portfolio: at most MAX_POSITIONS open positions, 1 per coin; several signals at once -> random order (as in the backtest).

Runs on YOUR computer / VPS. Your API key stays in snr_bot_config.json on that machine (never send it to anyone).
Start on the Binance Futures TESTNET (demo money). Trading is risky; backtest results are not a promise.

Install:  pip install requests          Run:  python snr_bot.py          (Ctrl+C to stop; positions keep their SL/TP at Binance)
Background + autostart (Windows):   python snr_bot.py --install    start now and after every VPS restart (hidden)
                                    python snr_bot.py --status     last lines of the log
                                    python snr_bot.py --stop       stop the background bot (until --install again)
                                    python snr_bot.py --reset      resume after the loss-streak brake (max_loss_streak)
                                    python snr_bot.py --uninstall  stop and remove the autostart
                                    python snr_bot.py --test       send a test trade + message to the website journal / Telegram
"""
import hashlib, hmac, json, logging, math, os, random, socket, subprocess, sys, time, urllib.parse
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    sys.exit('Paket "requests" belum ada. Jalankan: pip install requests')

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(HERE, 'snr_bot_config.json')
STATE_FILE = os.path.join(HERE, 'snr_bot_state.json')
LOG_FILE = os.path.join(HERE, 'snr_bot.log')
STOP_FILE = os.path.join(HERE, 'stop.flag')
RESET_FILE = os.path.join(HERE, 'reset.flag')
BAT_FILE = os.path.join(HERE, 'start_bot.bat')
TASK = 'SNR Bot'
LOCK_PORT = 47219

DEFAULT_CONFIG = {
    "testnet": True,                 # true = demo-fapi.binance.com (uang mainan); false = akun asli
    "api_key": "",                   # isi sendiri, jangan dibagikan
    "api_secret": "",
    "dry_run": True,                 # true = hanya tulis sinyal ke log, tidak pasang order
    "risk_mode": "percent",          # "percent" = % dari saldo USDT, "usdt" = jumlah tetap
    "risk_percent": 0.5,             # risiko per trade (% saldo) bila risk_mode = percent
    "risk_usdt": 5.0,                # risiko per trade (USDT) bila risk_mode = usdt
    "max_positions": 3,              # maks posisi terbuka (backtest: 3)
    "stop_balance_usdt": 0,          # rem: tidak buka posisi baru bila saldo Futures di bawah angka ini (0 = mati)
    "max_loss_streak": 7,            # rem kalah beruntun: setelah N kali SL berturut-turut tidak buka posisi baru (0 = mati); lanjut lagi: python snr_bot.py --reset
    "leverage": 5,                   # leverage per koin (hanya margin; risiko tetap dari jarak SL)
    "margin_isolated": True,         # true = margin Isolated per posisi (lebih aman), false = Cross
    "daily_summary": True,           # ringkasan ke Telegram
    "summary_hours_kst": [8, 23],    # jam ringkasan (waktu Korea): 08:00 pagi dan 23:00 malam
    "coins": "default",              # "default" = 26 koin terbaik, "all" = semua koin USDT likuid, atau daftar ["SANDUSDT", ...]
    "exclude": [],                   # koin yang tidak mau ditradingkan
    "min_volume_usdt": 20000000,     # likuiditas: rata-rata volume 30 hari (USDT) minimal
    "report_url": "https://xauusd-research.vercel.app/api/ea/report",   # laporan ke jurnal website + Telegram ("" = mati)
    "report_key": ""                 # kunci EA dari website (Atur -> EA); sama dengan kunci EA MT5
}
DEFAULT_COINS = ['GMTUSDT', 'FILUSDT', '1000SHIBUSDT', 'SANDUSDT', 'DOTUSDT', 'GALAUSDT', 'ATOMUSDT', 'APTUSDT', 'AVAXUSDT', 'ALGOUSDT',
                 'WLDUSDT', 'AAVEUSDT', 'NEOUSDT', '1000PEPEUSDT', 'LUNA2USDT', 'ARBUSDT', 'IMXUSDT', 'THETAUSDT', 'FTMUSDT', 'KSMUSDT',
                 '1000LUNCUSDT', '1INCHUSDT', 'ROSEUSDT', 'ARKMUSDT', 'ANKRUSDT', 'HOTUSDT']   # FTMUSDT is skipped automatically when delisted
PV, KEEP, SLK, RR, H4_LIMIT, D1_LIMIT = 5, 10, 0.5, 2.0, 600, 400
H4 = 4 * 3600

log = logging.getLogger('snr')


def setup_log():
    log.setLevel(logging.INFO)
    fmt = logging.Formatter('%(asctime)s %(levelname)s %(message)s', '%Y-%m-%d %H:%M:%S')
    for h in (logging.StreamHandler(sys.stdout), logging.FileHandler(LOG_FILE, encoding='utf-8')):
        h.setFormatter(fmt); log.addHandler(h)


def load_config():
    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f: json.dump(DEFAULT_CONFIG, f, indent=2)
        sys.exit(f'File pengaturan dibuat: {CONFIG_FILE}\nIsi api_key, api_secret (dan report_key), lalu jalankan lagi.')
    with open(CONFIG_FILE, encoding='utf-8') as f: cfg = {**DEFAULT_CONFIG, **json.load(f)}
    if not cfg['dry_run'] and (not cfg['api_key'] or not cfg['api_secret']):
        sys.exit('api_key / api_secret kosong di snr_bot_config.json')
    return cfg


def load_state():
    try:
        with open(STATE_FILE, encoding='utf-8') as f: return json.load(f)
    except Exception:
        return {"positions": {}, "last_scan": 0}


def save_state(st):
    tmp = STATE_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(st, f, indent=2)
    os.replace(tmp, STATE_FILE)


class Binance:
    def __init__(self, cfg):
        self.base = 'https://demo-fapi.binance.com' if cfg['testnet'] else 'https://fapi.binance.com'
        self.key, self.secret = cfg['api_key'], cfg['api_secret'].encode()
        self.s = requests.Session()
        if self.key: self.s.headers['X-MBX-APIKEY'] = self.key
        self.offset = 0

    def sync_time(self):
        t = self.get('/fapi/v1/time')['serverTime']
        self.offset = t - int(time.time() * 1000)

    def _req(self, method, path, params=None, signed=False):
        params = dict(params or {})
        if signed:
            params['timestamp'] = int(time.time() * 1000) + self.offset
            params['recvWindow'] = 10000
            q = urllib.parse.urlencode(params)
            params['signature'] = hmac.new(self.secret, q.encode(), hashlib.sha256).hexdigest()
        for attempt in range(3):
            try:
                r = self.s.request(method, self.base + path, params=params, timeout=20)
            except requests.RequestException as e:
                log.warning('Koneksi gagal (%s %s): %s', method, path, e); time.sleep(2 + 3 * attempt); continue
            if r.status_code == 429 or r.status_code == 418:
                log.warning('Batas request Binance, tunggu 30 detik'); time.sleep(30); continue
            try: data = r.json()
            except ValueError: data = {'msg': r.text}
            if r.status_code >= 400:
                raise RuntimeError(f"Binance {method} {path}: {data.get('code')} {data.get('msg')}")
            return data
        raise RuntimeError(f'Binance {method} {path}: gagal setelah 3 kali')

    def get(self, path, params=None, signed=False): return self._req('GET', path, params, signed)
    def post(self, path, params=None): return self._req('POST', path, params, True)
    def delete(self, path, params=None): return self._req('DELETE', path, params, True)


# ---------- indicators (identical to the website adapter) ----------
def ema_last(v, n):
    a = 2 / (n + 1); e = v[0]
    for x in v[1:]: e = a * x + (1 - a) * e
    return e


def snr_signal(h4):
    """h4: list of closed candles [open_time_s, o, h, l, c] oldest first. Returns (support, atr) if the LAST candle breaks a support."""
    n = len(h4)
    if n < 40: return None
    atr = -1.0
    for i in range(1, n):
        pc = h4[i - 1][4]; hi, lo = h4[i][2], h4[i][3]
        tr = max(hi - lo, abs(hi - pc), abs(lo - pc)); atr = tr if atr < 0 else atr + (tr - atr) / 14
    sup = []; hit = None
    for k in range(2 * PV, n):
        q = k - PV
        if all(h4[j][3] >= h4[q][3] for j in range(q - PV, q + PV + 1)):
            sup.append([h4[q][3], False])
            if len(sup) > KEEP: sup.pop(0)
        c, pc = h4[k][4], h4[k - 1][4]
        for lv in sup:
            if not lv[1] and c < lv[0] and pc >= lv[0]:
                lv[1] = True
                if k == n - 1 and hit is None: hit = lv[0]
    return (hit, atr) if hit is not None and atr > 0 else None


def closed_klines(api, sym, interval, limit, now_s):
    rows = api.get('/fapi/v1/klines', {'symbol': sym, 'interval': interval, 'limit': limit})
    return [[int(r[0]) // 1000, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[7])] for r in rows if int(r[6]) // 1000 < now_s]


# ---------- helpers ----------
def step_floor(x, step):
    return math.floor(x / step + 1e-9) * step


def fmt(x, step):
    d = max(0, -int(math.floor(math.log10(step)))) if step < 1 else 0
    return f'{x:.{d}f}'


def report(cfg, payload):
    if not cfg['report_url'] or not cfg['report_key']: return
    try:
        r = requests.post(cfg['report_url'], json={'key': cfg['report_key'], 'strategy': 'snr', **payload}, timeout=15)
        if r.status_code != 200: log.warning('Website menolak laporan: HTTP %s %s', r.status_code, r.text[:200])
    except requests.RequestException as e:
        log.warning('Laporan ke website gagal: %s', e)


def notify(cfg, text, level='info'):
    """short status message to Telegram through the website (daily summary, warnings)"""
    report(cfg, {'event': 'info', 'text': text, 'level': level})


class Bot:
    def __init__(self, cfg):
        self.cfg, self.api, self.st = cfg, Binance(cfg), load_state()
        self.filters = {}

    def load_symbols(self):
        info = self.api.get('/fapi/v1/exchangeInfo')
        for s in info['symbols']:
            if s.get('contractType') != 'PERPETUAL' or s.get('quoteAsset') != 'USDT' or s.get('status') != 'TRADING': continue
            f = {x['filterType']: x for x in s['filters']}
            self.filters[s['symbol']] = {
                'tick': float(f['PRICE_FILTER']['tickSize']), 'step': float(f['MARKET_LOT_SIZE']['stepSize'] if 'MARKET_LOT_SIZE' in f else f['LOT_SIZE']['stepSize']),
                'minQty': float(f['MARKET_LOT_SIZE']['minQty'] if 'MARKET_LOT_SIZE' in f else f['LOT_SIZE']['minQty']),
                'maxQty': float(f['MARKET_LOT_SIZE']['maxQty'] if 'MARKET_LOT_SIZE' in f else f['LOT_SIZE']['maxQty']),
                'minNotional': float(f.get('MIN_NOTIONAL', {}).get('notional', 5))}
        c = self.cfg['coins']
        if c == 'default': coins = DEFAULT_COINS
        elif c == 'all':
            tick = self.api.get('/fapi/v1/ticker/24hr')
            coins = [t['symbol'] for t in tick if t['symbol'] in self.filters and float(t['quoteVolume']) >= 0.25 * self.cfg['min_volume_usdt']
                     and t['symbol'] not in ('BTCUSDT', 'USDCUSDT', 'BTCDOMUSDT')]
        else: coins = list(c)
        missing = [x for x in coins if x not in self.filters]
        if missing: log.info('Tidak aktif di Binance Futures, dilewati: %s', ', '.join(missing))
        self.coins = [x for x in coins if x in self.filters and x not in set(self.cfg['exclude'])]
        log.info('Memantau %d koin (%s)', len(self.coins), 'TESTNET' if self.cfg['testnet'] else 'AKUN ASLI')

    # ----- account -----
    def positions(self):
        if self.cfg['dry_run']: return {}
        try: rows = self.api.get('/fapi/v3/positionRisk', signed=True)
        except RuntimeError: rows = self.api.get('/fapi/v2/positionRisk', signed=True)
        return {r['symbol']: float(r['positionAmt']) for r in rows if float(r['positionAmt']) != 0}

    def positions_mode_hedge(self):
        return bool(self.api.get('/fapi/v1/positionSide/dual', signed=True).get('dualSidePosition'))

    def balance(self):
        for b in self.api.get('/fapi/v2/balance', signed=True):
            if b['asset'] == 'USDT': return float(b['balance'])
        return 0.0

    def risk_usdt(self):
        if self.cfg['risk_mode'] == 'usdt': return float(self.cfg['risk_usdt'])
        if self.cfg['dry_run'] and not self.cfg['api_key']: return 1000 * float(self.cfg['risk_percent']) / 100   # dry run without a key: pretend 1000 USDT
        return self.balance() * float(self.cfg['risk_percent']) / 100

    # ----- scan at every H4 close -----
    def scan(self, now_s):
        sigs = []
        for sym in self.coins:
            try:
                d1 = closed_klines(self.api, sym, '1d', D1_LIMIT, now_s)
                if len(d1) < 60: continue
                vol30 = sum(r[5] for r in d1[-30:]) / min(30, len(d1))
                if vol30 < self.cfg['min_volume_usdt']: continue
                closes = [r[4] for r in d1]
                if not closes[-1] < ema_last(closes, 50): continue          # coin must be falling (D1 close < EMA50)
                h4 = closed_klines(self.api, sym, '4h', H4_LIMIT + 1, now_s)[-H4_LIMIT:]
                if not h4 or h4[-1][0] + H4 > now_s + 5 or now_s - (h4[-1][0] + H4) > 600: continue   # last closed H4 must be the one that just closed
                s = snr_signal(h4)
                if s: sigs.append((sym, s[0], s[1], h4[-1][4]))
            except Exception as e:
                log.warning('%s: %s', sym, e)
            time.sleep(0.15)
        return sigs

    def open_short(self, sym, level, atr, close):
        f = self.filters[sym]
        sl = level + SLK * atr
        risk = self.risk_usdt()
        qty = step_floor(risk / (sl - close), f['step'])
        qty = min(qty, f['maxQty'])
        if qty < f['minQty'] or qty * close < f['minNotional']:
            log.info('%s: jumlah %.8f di bawah minimum Binance untuk risiko %.2f USDT — dilewati', sym, qty, risk); return
        if self.cfg['dry_run']:
            log.info('[DRY RUN] SELL %s qty %s ~%s SL %s TP %s', sym, fmt(qty, f['step']), close, fmt(sl, f['tick']), fmt(close - RR * (sl - close), f['tick'])); return
        if self.cfg.get('margin_isolated', True):
            try: self.api.post('/fapi/v1/marginType', {'symbol': sym, 'marginType': 'ISOLATED'})
            except RuntimeError as e:
                if '-4046' not in str(e): log.warning('%s: margin isolated: %s', sym, e)   # -4046 = already isolated
        try: self.api.post('/fapi/v1/leverage', {'symbol': sym, 'leverage': int(self.cfg['leverage'])})
        except RuntimeError as e: log.warning('%s: leverage: %s', sym, e)
        o = self.api.post('/fapi/v1/order', {'symbol': sym, 'side': 'SELL', 'type': 'MARKET', 'quantity': fmt(qty, f['step']), 'newOrderRespType': 'RESULT'})
        entry = float(o.get('avgPrice') or 0) or close
        filled = float(o.get('executedQty') or qty)
        if not (sl > entry):
            log.warning('%s: harga isi %.8f sudah di atas SL %.8f — posisi ditutup lagi', sym, entry, sl); self.close_now(sym, filled); return
        tp = entry - RR * (sl - entry)
        sl_r = math.ceil(sl / f['tick'] - 1e-9) * f['tick']; tp_r = math.floor(tp / f['tick'] + 1e-9) * f['tick']
        try:
            a = self.api.post('/fapi/v1/algoOrder', {'algoType': 'CONDITIONAL', 'symbol': sym, 'side': 'BUY', 'type': 'STOP_MARKET', 'triggerPrice': fmt(sl_r, f['tick']),
                                                     'closePosition': 'true', 'workingType': 'CONTRACT_PRICE'})
            b = self.api.post('/fapi/v1/algoOrder', {'algoType': 'CONDITIONAL', 'symbol': sym, 'side': 'BUY', 'type': 'TAKE_PROFIT_MARKET', 'triggerPrice': fmt(tp_r, f['tick']),
                                                     'closePosition': 'true', 'workingType': 'CONTRACT_PRICE'})
        except RuntimeError as e:
            log.error('%s: SL/TP gagal dipasang (%s) — posisi ditutup demi keamanan', sym, e)
            notify(self.cfg, f'{sym}: SL/TP gagal dipasang ({e}). Posisi langsung ditutup demi keamanan — cek Binance.', 'error')
            self.close_now(sym, filled); return
        t = int(time.time())
        ticket = f"{sym}-{o['orderId']}"
        self.st['positions'][sym] = {'ticket': ticket, 'entry': entry, 'sl': sl_r, 'tp': tp_r, 'qty': filled, 'opened': t, 'sl_id': a.get('algoId'), 'tp_id': b.get('algoId')}
        save_state(self.st)
        log.info('SELL %s qty %s @ %s | SL %s | TP %s', sym, filled, entry, fmt(sl_r, f['tick']), fmt(tp_r, f['tick']))
        report(self.cfg, {'event': 'open', 'ticket': ticket, 'symbol': sym, 'side': 'SELL', 'price': entry, 'sl': sl_r, 'tp': tp_r, 'lot': filled, 'time': t})

    def close_now(self, sym, qty):
        try: self.api.post('/fapi/v1/order', {'symbol': sym, 'side': 'BUY', 'type': 'MARKET', 'quantity': fmt(qty, self.filters[sym]['step']), 'reduceOnly': 'true'})
        except RuntimeError as e:
            log.error('%s: GAGAL menutup posisi — tutup manual di Binance! (%s)', sym, e)
            notify(self.cfg, f'{sym}: GAGAL menutup posisi ({e}). TUTUP MANUAL di Binance sekarang!', 'error')

    # ----- every minute: positions that closed at TP/SL -----
    def manage(self):
        if self.cfg['dry_run'] or not self.st['positions']: return
        live = self.positions()
        for sym, p in list(self.st['positions'].items()):
            if live.get(sym, 0) < 0: continue                      # still short
            try: self.api.delete('/fapi/v1/algoOpenOrders', {'symbol': sym})   # cancel the other TP/SL
            except RuntimeError: pass
            pnl, exit_px, reason = 0.0, None, 'manual'
            try:
                trades = self.api.get('/fapi/v1/userTrades', {'symbol': sym, 'startTime': p['opened'] * 1000 - 60000}, signed=True)
                buys = [x for x in trades if x['side'] == 'BUY']
                pnl = sum(float(x['realizedPnl']) - float(x['commission']) for x in trades if x['commissionAsset'] == 'USDT')
                if buys:
                    q = sum(float(x['qty']) for x in buys); exit_px = sum(float(x['price']) * float(x['qty']) for x in buys) / q
                inc = self.api.get('/fapi/v1/income', {'symbol': sym, 'incomeType': 'FUNDING_FEE', 'startTime': p['opened'] * 1000}, signed=True)
                pnl += sum(float(x['income']) for x in inc)
            except RuntimeError as e:
                log.warning('%s: hasil trade tidak terbaca: %s', sym, e)
            if exit_px is not None:
                r1 = p['sl'] - p['entry']                                  # 1R in price
                reason = 'tp' if abs(exit_px - p['tp']) <= 0.25 * r1 else 'sl' if abs(exit_px - p['sl']) <= 0.25 * r1 else 'manual'
            log.info('Posisi %s ditutup (%s) | hasil %.2f USDT', sym, reason.upper(), pnl)
            report(self.cfg, {'event': 'close', 'ticket': p['ticket'], 'symbol': sym, 'side': 'SELL', 'price': exit_px or p['entry'], 'profit': round(pnl, 2),
                              'reason': reason, 'lot': p['qty'], 'entry': p['entry'], 'sl': p['sl'], 'tp': p['tp'], 'time': int(time.time())})
            cl = self.st.setdefault('closed', []); cl.append([int(time.time()), round(pnl, 4), reason]); del cl[:-300]
            if reason == 'sl': self.st['loss_streak'] = self.st.get('loss_streak', 0) + 1
            elif reason == 'tp': self.st['loss_streak'] = 0                     # manual close: streak unchanged
            mx = int(self.cfg.get('max_loss_streak') or 0)
            if mx > 0 and reason == 'sl' and self.st['loss_streak'] == mx:
                log.error('REM KALAH BERUNTUN: %d kali SL berturut-turut — tidak membuka posisi baru. Lanjut lagi: python snr_bot.py --reset', mx)
                notify(self.cfg, f'REM AKTIF: {mx} kali SL berturut-turut. Bot tidak membuka posisi baru (posisi terbuka tetap jalan).\nLanjut lagi: python snr_bot.py --reset', 'error')
            del self.st['positions'][sym]; save_state(self.st)

    def summary(self):
        """status message at the hours in summary_hours_kst (Korea time, UTC+9): balance, result since the last summary, open positions"""
        if not self.cfg.get('daily_summary', True) or self.cfg['dry_run']: return
        kst = datetime.fromtimestamp(time.time() + 9 * 3600, timezone.utc)
        if kst.hour not in [int(h) for h in self.cfg.get('summary_hours_kst', [8, 23])]: return
        key = kst.strftime('%Y-%m-%d %H')
        if self.st.get('last_summary') == key: return
        since = self.st.get('last_summary_ts', int(time.time()) - 86400)
        self.st['last_summary'] = key; self.st['last_summary_ts'] = int(time.time()); save_state(self.st)
        try: bal = self.balance()
        except RuntimeError: bal = float('nan')
        done = [c for c in self.st.get('closed', []) if c[0] > since]
        res = sum(c[1] for c in done); tp = sum(1 for c in done if c[2] == 'tp'); sl = sum(1 for c in done if c[2] == 'sl')
        pos = ', '.join(k.replace('USDT', '') for k in self.st['positions']) or 'tidak ada'
        mx = int(self.cfg.get('max_loss_streak') or 0); ls = self.st.get('loss_streak', 0)
        pos += f"\nKalah beruntun: {ls}" + (f" dari {mx}" + (' — REM AKTIF (--reset untuk lanjut)' if ls >= mx else '') if mx > 0 else '')
        notify(self.cfg, f"Ringkasan {kst.strftime('%H:%M')} (waktu Korea) — bot aktif.\nSaldo Futures: {bal:.2f} USDT\n"
                         f"Sejak ringkasan terakhir: {len(done)} trade selesai (TP {tp}, SL {sl}), hasil {res:+.2f} USDT\nPosisi terbuka: {pos}")

    def run(self):
        self.api.sync_time(); self.load_symbols()
        if self.cfg['api_key']:
            try:
                log.info('API key OK — saldo USDT di dompet Futures: %.2f', self.balance())
                if self.positions_mode_hedge(): log.error('Akun memakai Hedge Mode. Ubah ke One-way Mode di Binance Futures (Pengaturan → Mode Posisi), lalu jalankan lagi.'); return
            except RuntimeError as e:
                log.error('API key belum bisa dipakai: %s', e)
                log.error('Cek: izin "Aktifkan Futures" dicentang, IP VPS sudah ditambahkan, api_key/api_secret tersalin lengkap, testnet sesuai akun.')
                notify(self.cfg, f'Bot tidak bisa mulai: API key ditolak ({e}).', 'error')
                return
        if 'loss_streak' not in self.st:                                     # first run with this version: count the SLs at the end of the history
            n = 0
            for c in reversed(self.st.get('closed', [])):
                if c[2] == 'tp': break
                if c[2] == 'sl': n += 1
            self.st['loss_streak'] = n; save_state(self.st)
        mx = int(self.cfg.get('max_loss_streak') or 0)
        if mx > 0: log.info('Rem kalah beruntun: berhenti buka posisi baru setelah %d SL berturut-turut (sekarang %d)', mx, self.st['loss_streak'])
        if float(self.cfg.get('stop_balance_usdt') or 0) > 0: log.info('Rem saldo: tidak buka posisi baru bila saldo < %.2f USDT', float(self.cfg['stop_balance_usdt']))
        log.info('Mode: %s · risiko %s · maks %d posisi · leverage %dx', 'DRY RUN (tanpa order)' if self.cfg['dry_run'] else 'TRADING',
                 f"{self.cfg['risk_percent']}% saldo" if self.cfg['risk_mode'] == 'percent' else f"{self.cfg['risk_usdt']} USDT", self.cfg['max_positions'], self.cfg['leverage'])
        last_sync = time.time()
        notify(self.cfg, f"Bot mulai ({'DRY RUN' if self.cfg['dry_run'] else 'TRADING'}, {'testnet' if self.cfg['testnet'] else 'akun asli'}): {len(self.coins)} koin, risiko {self.cfg['risk_usdt'] if self.cfg['risk_mode'] == 'usdt' else str(self.cfg['risk_percent']) + '%'} per trade, maks {self.cfg['max_positions']} posisi.")
        while True:
            if os.path.exists(STOP_FILE):
                log.info('stop.flag ditemukan — bot berhenti.'); notify(self.cfg, 'Bot dihentikan (perintah --stop). Posisi terbuka tetap punya SL/TP di Binance.'); return
            if os.path.exists(RESET_FILE):
                try: os.remove(RESET_FILE)
                except OSError: pass
                self.st['loss_streak'] = 0; save_state(self.st)
                log.info('Hitungan kalah beruntun di-reset ke 0 — bot boleh buka posisi lagi.'); notify(self.cfg, 'Hitungan kalah beruntun di-reset. Bot kembali membuka posisi baru.')
            now_s = int(time.time() + self.api.offset / 1000)
            bucket = now_s // H4 * H4
            if bucket > self.st.get('last_scan', 0) and now_s - bucket >= 20:      # 20 s after every H4 close (UTC 00/04/08/12/16/20)
                self.st['last_scan'] = bucket; save_state(self.st)
                log.info('H4 %s UTC tutup — memeriksa %d koin', datetime.fromtimestamp(bucket, timezone.utc).strftime('%Y-%m-%d %H:%M'), len(self.coins))
                sigs = self.scan(now_s)
                random.shuffle(sigs)                                   # several signals at once: random order (as in the backtest)
                live = self.positions()
                busy = set(self.st['positions']) | {s for s, a in live.items() if a != 0}
                stop = float(self.cfg.get('stop_balance_usdt') or 0)
                if sigs and stop > 0 and not self.cfg['dry_run']:
                    bal = self.balance()
                    if bal >= stop: self.st['brake_sent'] = 0
                    if bal < stop:
                        log.error('REM AKTIF: saldo %.2f USDT di bawah batas %.2f — tidak membuka posisi baru. Naikkan modal / ubah stop_balance_usdt bila ingin lanjut.', bal, stop)
                        if not self.st.get('brake_sent'): notify(self.cfg, f'REM AKTIF: saldo {bal:.2f} USDT di bawah batas {stop:.2f}. Bot tidak membuka posisi baru.', 'error'); self.st['brake_sent'] = 1
                        sigs = []
                mx = int(self.cfg.get('max_loss_streak') or 0)
                if sigs and mx > 0 and self.st.get('loss_streak', 0) >= mx:
                    log.error('REM KALAH BERUNTUN aktif (%d SL berturut-turut) — %d sinyal dilewati. Lanjut lagi: python snr_bot.py --reset', self.st['loss_streak'], len(sigs))
                    sigs = []
                for sym, level, atr, close in sigs:
                    if sym in busy: continue
                    if not self.cfg['dry_run'] and len(busy) >= int(self.cfg['max_positions']):
                        log.info('Sinyal %s dilewati: sudah %d posisi', sym, len(busy)); continue
                    log.info('Sinyal SELL %s: close %s menembus support %s', sym, close, level)
                    try: self.open_short(sym, level, atr, close)
                    except RuntimeError as e: log.error('%s: order gagal: %s', sym, e)
                    busy.add(sym)
                if not sigs: log.info('Tidak ada sinyal.')
            try: self.manage()
            except RuntimeError as e: log.warning('Cek posisi gagal: %s', e)
            try: self.summary()
            except Exception as e: log.warning('Ringkasan gagal: %s', e)
            if time.time() - last_sync > 3600:
                try: self.api.sync_time(); self.load_symbols()
                except RuntimeError as e: log.warning('%s', e)
                last_sync = time.time()
            time.sleep(30)


def schtasks(*args):
    r = subprocess.run(['schtasks', *args], capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def command(cmd):
    if cmd == '--install':
        if os.name != 'nt': sys.exit('--install hanya untuk Windows.')
        with open(BAT_FILE, 'w', encoding='utf-8') as f:
            f.write(f'@echo off\ncd /d "{HERE}"\n:loop\nif exist "{STOP_FILE}" goto end\n"{sys.executable}" "{os.path.abspath(__file__)}"\n'
                    f'if exist "{STOP_FILE}" goto end\ntimeout /t 30 /nobreak >nul\ngoto loop\n:end\n')
        if os.path.exists(STOP_FILE): os.remove(STOP_FILE)
        code, out = schtasks('/create', '/tn', TASK, '/tr', f'"{BAT_FILE}"', '/sc', 'onstart', '/ru', 'SYSTEM', '/rl', 'HIGHEST', '/f')
        if code: sys.exit(f'Gagal membuat autostart (jalankan Command Prompt sebagai Administrator):\n{out}')
        code, out = schtasks('/run', '/tn', TASK)
        print('Bot berjalan di latar belakang dan otomatis jalan lagi setiap VPS menyala.' if code == 0 else out)
        print('Cek:  python snr_bot.py --status     Berhenti:  python snr_bot.py --stop')
    elif cmd == '--stop':
        open(STOP_FILE, 'w').close()
        print('Perintah berhenti dikirim. Bot berhenti dalam ±30 detik (posisi tetap punya SL/TP). Jalankan lagi: python snr_bot.py --install')
    elif cmd == '--reset':
        open(RESET_FILE, 'w').close()
        print('Reset dikirim. Dalam ±30 detik hitungan kalah beruntun jadi 0 dan bot boleh buka posisi lagi (bot harus sedang berjalan).')
    elif cmd == '--uninstall':
        open(STOP_FILE, 'w').close(); schtasks('/end', '/tn', TASK)
        code, out = schtasks('/delete', '/tn', TASK, '/f')
        print('Autostart dihapus, bot berhenti.' if code == 0 else out)
    elif cmd == '--test':
        cfg = load_config()
        if not cfg['report_key']: sys.exit('report_key kosong di snr_bot_config.json')
        t = int(time.time()); tk = f'TEST-{t}'
        report(cfg, {'event': 'open', 'ticket': tk, 'symbol': 'TESTUSDT', 'side': 'SELL', 'price': 1.2345, 'sl': 1.2716, 'tp': 1.1603, 'lot': 107.8, 'time': t - 7 * 3600})
        report(cfg, {'event': 'close', 'ticket': tk, 'symbol': 'TESTUSDT', 'side': 'SELL', 'price': 1.1603, 'profit': 7.86, 'reason': 'tp', 'lot': 107.8, 'time': t})
        notify(cfg, 'Pesan tes — kalau ini sampai, laporan bot ke Telegram berfungsi.')
        print('3 pesan tes dikirim (posisi TEST dibuka, ditutup TP, dan info). Hapus trade TEST di jurnal website (Trade -> Crypto) bila sudah dilihat.')
    elif cmd == '--status':
        try:
            with open(LOG_FILE, encoding='utf-8') as f: lines = f.readlines()[-15:]
            print(''.join(lines))
        except FileNotFoundError: print('Belum ada log.')
        print('stop.flag ada -> bot dihentikan' if os.path.exists(STOP_FILE) else '')
    else:
        sys.exit('Perintah: --install, --status, --stop, --reset, --uninstall, --test')


if __name__ == '__main__':
    if len(sys.argv) > 1: command(sys.argv[1]); sys.exit(0)
    try:                                          # only one bot at a time (a second copy would double the orders)
        _lock = socket.socket(); _lock.bind(('127.0.0.1', LOCK_PORT))
    except OSError:
        sys.exit('Bot sudah berjalan (mungkin di latar belakang). Cek: python snr_bot.py --status · hentikan: python snr_bot.py --stop')
    if os.path.exists(STOP_FILE): os.remove(STOP_FILE)
    setup_log()
    cfg = load_config()
    log.info('v1 SNR bot mulai')
    try:
        Bot(cfg).run()
    except KeyboardInterrupt:
        log.info('Bot dihentikan. Posisi terbuka tetap punya SL/TP di Binance.')
        notify(cfg, 'Bot dihentikan manual (Ctrl+C). Posisi terbuka tetap punya SL/TP di Binance.')
    except Exception as e:
        log.exception('Bot error: %s', e)
        notify(cfg, f'Bot error dan berhenti: {e}. (Mode autostart: jalan lagi otomatis dalam 30 detik.)', 'error')
        raise
