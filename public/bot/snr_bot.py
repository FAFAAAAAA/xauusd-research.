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

BUY part (v1 BTC rules, 9 Nov 2026, on the largest coins: BTC ETH SOL BNB XRP DOGE; config buy_enabled / buy_coins / max_buy_positions):
  BUY      = an H4 candle CLOSES above the highest high of the 50 H4 candles before it (first close beyond) and that H4 close
             is above EMA200 (H4) (was EMA200 D1 until 2026.11.15.3).   SL = H4 close - 1.0 x ATR14(D1);  TP = entry + 2 x (entry - SL).   Max 2 BUY positions.

BZ part (Bollinger squeeze SELL, 15 Nov 2026, on EVERY liquid USDT coin; config bz_enabled / max_bz_positions):
  BZ SELL  = the H4 Bollinger band width (4 x std20 / SMA20) of the candle BEFORE the last one is in the lowest 20% of the last 120 H4
             candles (squeeze) and the last closed H4 candle closes below the lower band (SMA20 - 2 x std20). No trend filter.
             Liquidity: 30-day average quote volume >= min_volume_usdt.  SL = close + 1.5 x ATR14(H4);  TP = 2 x risk.  Max 2 BZ positions.
  Each part has its own position cap (SELL = SNR, BUY, BZ) and one position per coin across all parts.

Remote settings (website Atur -> Kontrol bot, checked every ~60 s): risk %, max SELL / BUY positions and Pause (no new positions).
  The website never sends orders; the bot applies these values itself. Empty on the website = use snr_bot_config.json.

Runs on YOUR computer / VPS. Your API key stays in snr_bot_config.json on that machine (never send it to anyone).
Start on the Binance Futures TESTNET (demo money). Trading is risky; backtest results are not a promise.

Install:  pip install requests          Run:  python snr_bot.py          (Ctrl+C to stop; positions keep their SL/TP at Binance)
Background + autostart (Windows):   python snr_bot.py --install    start now and after every VPS restart (hidden)
                                    python snr_bot.py --status     last lines of the log
                                    python snr_bot.py --stop       stop the background bot (until --install again)
                                    python snr_bot.py --reset      resume after the loss-streak brake (max_loss_streak)
                                    python snr_bot.py --uninstall  stop and remove the autostart
                                    python snr_bot.py --test       send a test trade + message to the website journal / Telegram
                                    python snr_bot.py --sync [CAPUSDT PONSUSDT ...] [strat=bz]
                                        (bot stopped first) adopt open Binance positions the bot does not know (SL/TP from Binance) so their
                                        close is reported, and send the missed close reports of the listed coins (last 14 days) to the website
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
BOT_VERSION = '2026.11.19.2'
LOCK_PORT = 47219

DEFAULT_CONFIG = {
    "testnet": True,                 # true = demo-fapi.binance.com (uang mainan); false = akun asli
    "api_key": "",                   # isi sendiri, jangan dibagikan
    "api_secret": "",
    "dry_run": True,                 # true = hanya tulis sinyal ke log, tidak pasang order
    "risk_mode": "percent",          # "percent" = % dari saldo USDT, "usdt" = jumlah tetap
    "risk_percent": 0.5,             # risiko per trade (% saldo) bila risk_mode = percent
    "risk_usdt": 5.0,                # risiko per trade (USDT) bila risk_mode = usdt
    "max_positions": 3,              # maks posisi SELL (v1 SNR) terbuka (backtest: 3)
    "buy_enabled": True,             # BUY v1 BTC di koin terbesar (buy_coins)
    "buy_coins": ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"],
    "max_buy_positions": 2,          # maks posisi BUY terbuka (backtest: 2)
    "bz_enabled": True,              # BZ = Bollinger squeeze SELL di semua koin likuid
    "max_bz_positions": 2,           # maks posisi BZ terbuka (backtest: 2)
    "stop_balance_usdt": 0,          # rem: tidak buka posisi baru bila saldo Futures di bawah angka ini (0 = mati)
    "max_loss_streak": 7,            # rem kalah beruntun: setelah N kali SL berturut-turut tidak buka posisi baru (0 = mati); lanjut lagi: python snr_bot.py --reset
    "leverage": 5,                   # leverage tetap per koin (dipakai hanya bila leverage_auto = false)
    "leverage_auto": True,           # leverage per posisi = 0,5 / jarak SL (maks 20x): margin ≈ 2x risiko, likuidasi ±2x lebih jauh dari SL
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
BUY_N, BUY_SLK, BUY_D1_LIMIT, BUY_H4_LIMIT = 50, 1.0, 400, 1000
BZ_N, BZ_K, BZ_Q, BZ_W, BZ_SLK, BZ_H4_LIMIT = 20, 2.0, 0.2, 120, 1.5, 200
NOT_COINS = ('USDCUSDT', 'BTCDOMUSDT', 'FDUSDUSDT', 'USDPUSDT', 'TUSDUSDT', 'DEFIUSDT')
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


def buy_signal(h4, d1):
    """v1 BTC (identical to the website adapter metode_crypto_donchian): the LAST closed H4 candle closes above the highest high of the
    50 H4 candles before it while the candle before it did not, and that H4 close is above EMA200 (H4).
    Returns (level, atr14_d1) or None."""
    if len(h4) < 210 or len(d1) < 20: return None
    k = len(h4) - 1
    hh = lambda j: max(r[2] for r in h4[j - BUY_N:j])
    lvl = hh(k)
    if not h4[k][4] > lvl: return None
    if h4[k - 1][4] > hh(k - 1): return None                   # not the first close beyond the channel
    if not h4[k][4] > ema_last([r[4] for r in h4], 200): return None      # trend: H4 close above EMA200 (H4)
    atr = None; dd = d1[-400:]
    for i in range(1, len(dd)):
        pc = dd[i - 1][4]; tr = max(dd[i][2] - dd[i][3], abs(dd[i][2] - pc), abs(dd[i][3] - pc))
        atr = tr if atr is None else atr + (tr - atr) / 14
    return (lvl, atr) if atr and atr > 0 else None


def bz_signal(h4):
    """BZ (identical to the research backtest): squeeze on the candle before the last one (band width in the lowest 20% of the last 120
    H4 candles), and the LAST closed H4 candle closes below the lower Bollinger band. Returns (lower_band, atr14_h4) or None."""
    n = len(h4)
    if n < BZ_N + BZ_W + 1: return None
    c = [r[4] for r in h4]
    def band(j):                                                  # SMA20 and sample std (ddof 1) of the 20 closes ending at j
        w = c[j - BZ_N + 1:j + 1]; m = sum(w) / BZ_N
        return m, math.sqrt(sum((x - m) ** 2 for x in w) / (BZ_N - 1))
    k = n - 1
    mid, sd = band(k)
    if not c[k] < mid - BZ_K * sd: return None
    bw = []
    for j in range(k - BZ_W, k):
        m, d = band(j); bw.append(4 * d / m if m > 0 else float('inf'))
    srt = sorted(bw); pos = BZ_Q * (len(srt) - 1); lo = int(math.floor(pos))   # linear quantile (as pandas)
    q = srt[lo] + (srt[min(lo + 1, len(srt) - 1)] - srt[lo]) * (pos - lo)
    if not bw[-1] <= q: return None
    atr = -1.0
    for i in range(1, n):
        pc = h4[i - 1][4]; hi, lw = h4[i][2], h4[i][3]
        tr = max(hi - lw, abs(hi - pc), abs(lw - pc)); atr = tr if atr < 0 else atr + (tr - atr) / 14
    return (mid - BZ_K * sd, atr) if atr > 0 else None


def strat_of(p):
    return p.get('strat') or ('btc' if p.get('side') == 'BUY' else 'snr')


STRAT_NAME = {'snr': 'ALT', 'btc': 'BIG', 'bz': 'BZ'}


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
    if not cfg['report_url'] or not cfg['report_key']: return False
    try:
        r = requests.post(cfg['report_url'], json={'key': cfg['report_key'], 'strategy': 'snr', **payload}, timeout=15)
        if r.status_code != 200: log.warning('Website menolak laporan: HTTP %s %s', r.status_code, r.text[:200]); return False
        return True
    except requests.RequestException as e:
        log.warning('Laporan ke website gagal: %s', e); return False


def notify(cfg, text, level='info'):
    """short status message to Telegram through the website (daily summary, warnings)"""
    report(cfg, {'event': 'info', 'text': text, 'level': level})


def fetch_control(cfg, applied):
    """remote settings from the website (Atur -> Kontrol bot). Only risk %, max positions and pause; never orders."""
    if not cfg['report_url'] or not cfg['report_key']: return None
    try:
        r = requests.post(cfg['report_url'], json={'key': cfg['report_key'], 'strategy': 'snr', 'event': 'control', 'applied': applied}, timeout=15)
        if r.status_code != 200: return None
        c = r.json().get('control')
        return c if isinstance(c, dict) else None
    except (requests.RequestException, ValueError):
        return None


class Bot:
    def __init__(self, cfg):
        self.cfg, self.api, self.st = cfg, Binance(cfg), load_state()
        self.filters = {}
        self.base = {k: (list(v) if isinstance(v, list) else v) for k, v in ((k, cfg.get(k)) for k in self.REMOTE)}   # values from the config file
        self.paused = False; self.ctl_at = 0

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
        bc = list(self.cfg.get('buy_coins') or []) if self.cfg.get('buy_enabled') else []
        self.buy_coins = [x for x in bc if x in self.filters and x not in set(self.cfg['exclude']) and x not in self.coins]
        if bc: log.info('BUY v1 BTC: %s', ', '.join(self.buy_coins) or 'tidak ada koin aktif')
        ex = set(self.cfg['exclude'])
        self.bz_all = [x for x in self.filters if x not in ex and x not in NOT_COINS] if self.cfg.get('bz_enabled') else []
        old = getattr(self, 'bz_liq', None) or {'day': -1, 'syms': []}; keep = set(self.bz_all)
        self.bz_liq = {'day': old['day'] if self.bz_all else -1, 'syms': [x for x in old['syms'] if x in keep]}
        if self.bz_all and old['day'] == -1: log.info('BZ (Bollinger squeeze SELL): semua koin likuid (%d koin USDT di Binance)', len(self.bz_all))
        log.info('Memantau %d koin (%s)', len(self.coins), 'TESTNET' if self.cfg['testnet'] else 'AKUN ASLI')

    # ----- account -----
    def positions(self):
        if self.cfg['dry_run']: return {}
        try: rows = self.api.get('/fapi/v3/positionRisk', signed=True)
        except RuntimeError: rows = self.api.get('/fapi/v2/positionRisk', signed=True)
        if not isinstance(rows, list): raise RuntimeError(f'positionRisk: jawaban tidak terduga: {str(rows)[:200]}')
        return {r['symbol']: float(r['positionAmt']) for r in rows if float(r.get('positionAmt') or 0) != 0}

    def positions_mode_hedge(self):
        return bool(self.api.get('/fapi/v1/positionSide/dual', signed=True).get('dualSidePosition'))

    def balance(self):
        for b in self.api.get('/fapi/v2/balance', signed=True):
            if b['asset'] == 'USDT': return float(b['balance'])
        return 0.0

    def push_balance(self):
        """send the real Binance Futures balance to the website (Trade page shows it as the balance)"""
        if self.cfg['dry_run']: return
        try:
            a = self.api.get('/fapi/v2/account', signed=True)
            pos = {x['symbol']: round(float(x.get('unrealizedProfit') or 0), 4) for x in a.get('positions', []) if float(x.get('positionAmt') or 0) != 0}
            report(self.cfg, {'event': 'balance', 'wallet': round(float(a.get('totalWalletBalance') or 0), 4),
                              'upnl': round(float(a.get('totalUnrealizedProfit') or 0), 4), 'pos': pos, 'time': int(time.time())})
        except Exception as e: log.warning('saldo tidak terkirim ke website: %s', e)
        self.bal_pushed = time.time()
        self.push_cashflow()

    CF_TYPES = ('TRANSFER', 'INTERNAL_TRANSFER', 'STRATEGY_UMFUTURES_TRANSFER')
    def push_cashflow(self):
        """money moved in / out of the Futures wallet (deposit via Spot, withdrawal, transfer to Spot): sent to the website so it is
        recorded and NOT counted as profit or loss. Read from /fapi/v1/income in 7-day windows since the last successful check."""
        now = int(time.time() * 1000)
        since = int(self.st.get('cf_since') or now - 30 * 86_400_000)
        items = []
        try:
            for typ in self.CF_TYPES:
                t0 = since
                while t0 < now:
                    t1 = min(now, t0 + 7 * 86_400_000)
                    rows = self.api.get('/fapi/v1/income', {'incomeType': typ, 'startTime': t0, 'endTime': t1, 'limit': 1000}, signed=True) or []
                    for r in rows:
                        amt = float(r.get('income') or 0)
                        if amt: items.append({'id': f"{r.get('tranId')}:{r.get('incomeType')}:{r.get('asset')}", 'at': int(r['time']),
                                              'amount': round(amt, 6), 'asset': r.get('asset') or 'USDT', 'type': r.get('incomeType') or typ})
                    t0 = t1
        except Exception as e:
            log.warning('riwayat transfer tidak terbaca: %s', e); return
        for i in range(0, len(items), 40):
            if not report(self.cfg, {'event': 'cashflow', 'source': 'binance', 'items': items[i:i + 40]}): return   # retry next time
        for it in items: log.info('Transfer %s %+.2f %s tercatat', it['type'], it['amount'], it['asset'])
        self.st['cf_since'] = now - 60_000          # small overlap; the website ignores duplicates
        save_state(self.st)

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
                if s: sigs.append((sym, 'SELL', s[0] + SLK * s[1], h4[-1][4], s[0], 'snr'))
            except Exception as e:
                log.warning('%s: %s', sym, e)
            time.sleep(0.15)
        for sym in getattr(self, 'buy_coins', []):
            try:
                h4 = closed_klines(self.api, sym, '4h', BUY_H4_LIMIT, now_s)
                if not h4 or h4[-1][0] + H4 > now_s + 5 or now_s - (h4[-1][0] + H4) > 600: continue
                d1 = closed_klines(self.api, sym, '1d', BUY_D1_LIMIT, now_s)
                s = buy_signal(h4, d1)
                if s: sigs.append((sym, 'BUY', h4[-1][4] - BUY_SLK * s[1], h4[-1][4], s[0], 'btc'))
            except Exception as e:
                log.warning('%s: %s', sym, e)
            time.sleep(0.15)
        for sym in self.bz_coins(now_s):
            try:
                h4 = closed_klines(self.api, sym, '4h', BZ_H4_LIMIT, now_s)
                if not h4 or h4[-1][0] + H4 > now_s + 5 or now_s - (h4[-1][0] + H4) > 900: continue
                s = bz_signal(h4)
                if s: sigs.append((sym, 'SELL', h4[-1][4] + BZ_SLK * s[1], h4[-1][4], s[0], 'bz'))
            except Exception as e:
                log.warning('BZ %s: %s', sym, e)
            time.sleep(0.05)
        return sigs

    def bz_coins(self, now_s):
        """liquid coins for BZ, refreshed once per UTC day: 30-day average quote volume (completed days) >= min_volume_usdt"""
        if not self.cfg.get('bz_enabled') or not getattr(self, 'bz_all', None): return []
        day = now_s // 86400
        if getattr(self, 'bz_liq', {}).get('day') == day: return self.bz_liq['syms']
        try: tick = {t['symbol']: float(t['quoteVolume']) for t in self.api.get('/fapi/v1/ticker/24hr')}
        except RuntimeError as e:
            log.warning('BZ: daftar volume tidak terbaca (%s)', e); return getattr(self, 'bz_liq', {}).get('syms', [])
        mn = float(self.cfg['min_volume_usdt']); out = []
        for sym in [x for x in self.bz_all if tick.get(x, 0) >= 0.25 * mn]:
            try:
                d1 = closed_klines(self.api, sym, '1d', 32, now_s)
                if len(d1) >= 20 and sum(r[5] for r in d1[-30:]) / min(30, len(d1)) >= mn: out.append(sym)
            except Exception as e:
                log.warning('BZ %s: %s', sym, e)
            time.sleep(0.05)
        self.bz_liq = {'day': day, 'syms': out}
        log.info('BZ: %d koin likuid hari ini', len(out))
        return out

    def open_pos(self, sym, side, sl, close, strat=None):
        """market order on `side` (SELL = v1 SNR, BUY = v1 BTC), then SL and TP (RR 1:2) as Binance algo orders (closePosition)"""
        f = self.filters[sym]
        s = 1 if side == 'BUY' else -1; ex = 'SELL' if side == 'BUY' else 'BUY'
        if not s * (close - sl) > 0: log.warning('%s: SL %.8f di sisi yang salah dari harga %.8f — dilewati', sym, sl, close); return
        risk = self.risk_usdt()
        qty = step_floor(risk / (s * (close - sl)), f['step'])
        qty = min(qty, f['maxQty'])
        if qty < f['minQty'] or qty * close < f['minNotional']:
            log.info('%s: jumlah %.8f di bawah minimum Binance untuk risiko %.2f USDT — dilewati', sym, qty, risk); return
        if self.cfg['dry_run']:
            log.info('[DRY RUN] %s %s qty %s ~%s SL %s TP %s', side, sym, fmt(qty, f['step']), close, fmt(sl, f['tick']), fmt(close + s * RR * s * (close - sl), f['tick'])); return
        if self.cfg.get('margin_isolated', True):
            try: self.api.post('/fapi/v1/marginType', {'symbol': sym, 'marginType': 'ISOLATED'})
            except RuntimeError as e:
                if '-4046' not in str(e): log.warning('%s: margin isolated: %s', sym, e)   # -4046 = already isolated
        # leverage only sets the margin; the risk comes from the SL distance. Auto: liquidation ≈ 2x further than the SL, margin ≈ 2x the risk.
        if self.cfg.get('leverage_auto', True):
            lev = int(max(2, min(20, 0.5 / (s * (close - sl) / close))))
            tries = [lev] + [x for x in (10, 5, 3, 2) if x < lev]
        else: tries = [int(self.cfg['leverage'])]
        for lv in tries:
            try: self.api.post('/fapi/v1/leverage', {'symbol': sym, 'leverage': lv}); break
            except RuntimeError as e: log.warning('%s: leverage %dx: %s', sym, lv, e)
        o = self.api.post('/fapi/v1/order', {'symbol': sym, 'side': side, 'type': 'MARKET', 'quantity': fmt(qty, f['step']), 'newOrderRespType': 'RESULT'})
        entry = float(o.get('avgPrice') or 0)
        filled = float(o.get('executedQty') or 0)
        for _ in range(5):                                   # the market order answer can come before the fill: ask again for the real fill price
            if entry > 0 and filled > 0: break
            time.sleep(0.4)
            try:
                q = self.api.get('/fapi/v1/order', {'symbol': sym, 'orderId': o.get('orderId')}, signed=True)
                entry = float(q.get('avgPrice') or 0); filled = float(q.get('executedQty') or 0)
            except RuntimeError as e: log.warning('%s: status order tidak terbaca: %s', sym, e)
        if not entry > 0: log.warning('%s: harga isi tidak terbaca — memakai harga close %.8f', sym, close); entry = close
        if not filled > 0: filled = qty
        if not s * (entry - sl) > 0:
            log.warning('%s: harga isi %.8f sudah melewati SL %.8f — posisi ditutup lagi', sym, entry, sl); self.close_now(sym, filled, side); return
        # risk was sized on the signal close; if the real fill is further from the SL, buy back the excess so the loss at SL stays ≈ the planned risk
        want = step_floor(risk / (s * (entry - sl)), f['step']); trim_id = None
        if filled - want >= f['minQty'] and filled * s * (entry - sl) > 1.05 * risk:
            try:
                trim_id = self.api.post('/fapi/v1/order', {'symbol': sym, 'side': ex, 'type': 'MARKET', 'quantity': fmt(filled - want, f['step']), 'reduceOnly': 'true'}).get('orderId')
                log.info('%s: harga isi %.8f (sinyal %.8f) — jumlah dikurangi %s → %s supaya rugi di SL tetap ±%.2f USDT', sym, entry, close, fmt(filled, f['step']), fmt(want, f['step']), risk)
                filled = want
            except RuntimeError as e: log.warning('%s: gagal mengurangi jumlah: %s', sym, e)
        tp = entry + s * RR * s * (entry - sl)
        if s < 0: sl_r = math.ceil(sl / f['tick'] - 1e-9) * f['tick']; tp_r = math.floor(tp / f['tick'] + 1e-9) * f['tick']
        else: sl_r = math.floor(sl / f['tick'] + 1e-9) * f['tick']; tp_r = math.ceil(tp / f['tick'] - 1e-9) * f['tick']
        try:
            a = self.api.post('/fapi/v1/algoOrder', {'algoType': 'CONDITIONAL', 'symbol': sym, 'side': ex, 'type': 'STOP_MARKET', 'triggerPrice': fmt(sl_r, f['tick']),
                                                     'closePosition': 'true', 'workingType': 'CONTRACT_PRICE'})
            b = self.api.post('/fapi/v1/algoOrder', {'algoType': 'CONDITIONAL', 'symbol': sym, 'side': ex, 'type': 'TAKE_PROFIT_MARKET', 'triggerPrice': fmt(tp_r, f['tick']),
                                                     'closePosition': 'true', 'workingType': 'CONTRACT_PRICE'})
        except RuntimeError as e:
            log.error('%s: SL/TP gagal dipasang (%s) — posisi ditutup demi keamanan', sym, e)
            notify(self.cfg, f'{sym}: SL/TP gagal dipasang ({e}). Posisi langsung ditutup demi keamanan — cek Binance.', 'error')
            self.close_now(sym, filled, side); return
        t = int(time.time())
        ticket = f"{sym}-{o['orderId']}"
        strat = strat or ('btc' if side == 'BUY' else 'snr')
        self.st['positions'][sym] = {'ticket': ticket, 'side': side, 'strat': strat, 'entry': entry, 'sl': sl_r, 'tp': tp_r, 'qty': filled, 'opened': t, 'trim_id': trim_id, 'sl_id': a.get('algoId'), 'tp_id': b.get('algoId')}
        save_state(self.st)
        log.info('%s %s %s qty %s @ %s | SL %s | TP %s', STRAT_NAME.get(strat, strat), side, sym, filled, entry, fmt(sl_r, f['tick']), fmt(tp_r, f['tick']))
        report(self.cfg, {'event': 'open', 'strategy': strat, 'ticket': ticket, 'symbol': sym, 'side': side, 'price': entry, 'sl': sl_r, 'tp': tp_r, 'lot': filled, 'time': t})

    def close_now(self, sym, qty, side='SELL'):
        try: self.api.post('/fapi/v1/order', {'symbol': sym, 'side': 'SELL' if side == 'BUY' else 'BUY', 'type': 'MARKET', 'quantity': fmt(qty, self.filters[sym]['step']), 'reduceOnly': 'true'})
        except RuntimeError as e:
            log.error('%s: GAGAL menutup posisi — tutup manual di Binance! (%s)', sym, e)
            notify(self.cfg, f'{sym}: GAGAL menutup posisi ({e}). TUTUP MANUAL di Binance sekarang!', 'error')

    # ----- every minute: positions that closed at TP/SL -----
    def manage(self):
        if self.cfg['dry_run'] or not self.st['positions']: return
        try: live = self.positions()
        except RuntimeError as e:
            log.warning('Posisi tidak terbaca (%s) — cek ulang nanti, tidak ada yang diubah.', e); return
        for sym, p in list(self.st['positions'].items()):
            side = p.get('side', 'SELL'); ex = 'SELL' if side == 'BUY' else 'BUY'
            if (live.get(sym, 0) > 0) if side == 'BUY' else (live.get(sym, 0) < 0): p.pop('miss', None); continue    # still open
            # The position is not in the list. Do NOT touch anything until the close is CONFIRMED by closing BUY trades
            # (8 Nov 2026: an empty/partial positionRisk answer made the bot cancel the SL/TP of a position that was still open).
            p['miss'] = p.get('miss', 0) + 1
            # Binance returns at most 7 days from startTime: for a position older than ~7 days read the last 7 days (the closing fills are there)
            t_from = max(p['opened'] * 1000 - 60000, int(time.time() * 1000) - 7 * 86_400_000 + 60000)
            try: trades = self.api.get('/fapi/v1/userTrades', {'symbol': sym, 'startTime': t_from}, signed=True)
            except RuntimeError as e:
                log.warning('%s: riwayat trade tidak terbaca (%s) — cek ulang nanti.', sym, e); save_state(self.st); continue
            buys = [x for x in trades if x['side'] == ex and x.get('orderId') != p.get('trim_id')]   # closing fills (not the size trim right after entry)
            sells = [x for x in trades if x['side'] == side]                                       # entry fills
            if sells:                                                # real average entry (Binance "Harga Masuk Rata-Rata")
                qs = sum(float(x['qty']) for x in sells)
                if qs > 0: p['entry'] = sum(float(x['price']) * float(x['qty']) for x in sells) / qs
            if sum(float(x['qty']) for x in buys) < 0.99 * float(p['qty']):
                if p['miss'] in (3, 60):
                    log.error('%s: posisi tidak terlihat tapi tidak ada transaksi penutupan — dianggap MASIH TERBUKA, SL/TP tidak disentuh. Cek di app Binance.', sym)
                    notify(self.cfg, f'{sym}: posisi tidak terlihat di daftar posisi, tapi belum ada transaksi penutupan. Bot menganggap posisi masih terbuka (SL/TP tidak disentuh). Tolong cek di app Binance.', 'error')
                save_state(self.st); continue
            try: self.api.delete('/fapi/v1/algoOpenOrders', {'symbol': sym})   # closed for sure: cancel the other TP/SL
            except RuntimeError: pass
            pnl, exit_px, reason = 0.0, None, 'manual'
            try:
                pnl = sum(float(x['realizedPnl']) - float(x['commission']) for x in trades if x['commissionAsset'] == 'USDT')
                if buys:
                    q = sum(float(x['qty']) for x in buys); exit_px = sum(float(x['price']) * float(x['qty']) for x in buys) / q
                inc = self.api.get('/fapi/v1/income', {'symbol': sym, 'incomeType': 'FUNDING_FEE', 'startTime': p['opened'] * 1000}, signed=True)
                pnl += sum(float(x['income']) for x in inc)
            except RuntimeError as e:
                log.warning('%s: hasil trade tidak terbaca: %s', sym, e)
            if exit_px is not None:
                r1 = abs(p['sl'] - p['entry'])                             # 1R in price
                reason = 'tp' if abs(exit_px - p['tp']) <= 0.25 * r1 else 'sl' if abs(exit_px - p['sl']) <= 0.25 * r1 else 'manual'
            log.info('Posisi %s ditutup (%s) | hasil %.2f USDT', sym, reason.upper(), pnl)
            self.bal_pushed = 0                                   # send the new balance on the next loop
            report(self.cfg, {'event': 'close', 'strategy': strat_of(p), 'ticket': p['ticket'], 'symbol': sym, 'side': side, 'price': exit_px or p['entry'], 'profit': round(pnl, 2),
                              'reason': reason, 'lot': p['qty'], 'entry': p['entry'], 'sl': p['sl'], 'tp': p['tp'],
                              'time': int(max(float(x['time']) for x in buys) / 1000) if buys else int(time.time())})
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
        pos = ', '.join(f"{k.replace('USDT', '')} ({STRAT_NAME.get(strat_of(v), '')} {v.get('side', 'SELL')})" for k, v in self.st['positions'].items()) or 'tidak ada'
        mx = int(self.cfg.get('max_loss_streak') or 0); ls = self.st.get('loss_streak', 0)
        pos += f"\nKalah beruntun: {ls}" + (f" dari {mx}" + (' — REM AKTIF (--reset untuk lanjut)' if ls >= mx else '') if mx > 0 else '')
        notify(self.cfg, f"Ringkasan {kst.strftime('%H:%M')} (waktu Korea) — bot aktif.\nSaldo Futures: {bal:.2f} USDT\n"
                         f"Sejak ringkasan terakhir: {len(done)} trade selesai (TP {tp}, SL {sl}), hasil {res:+.2f} USDT\nPosisi terbuka: {pos}")

    REMOTE = {'risk_mode': ('mode',), 'risk_percent': ('num', 0.1, 5, 1), 'risk_usdt': ('num', 0.5, 500, 2), 'max_positions': ('num', 1, 6, 0),
              'max_buy_positions': ('num', 0, 4, 0), 'buy_enabled': ('bool',), 'bz_enabled': ('bool',), 'max_bz_positions': ('num', 0, 4, 0), 'stop_balance_usdt': ('num', 0, 100000, 0), 'max_loss_streak': ('num', 0, 30, 0),
              'leverage_auto': ('bool',), 'leverage': ('num', 1, 20, 0), 'margin_isolated': ('bool',), 'daily_summary': ('bool',),
              'summary_hours_kst': ('hours',), 'exclude': ('syms',)}
    LABEL = {'risk_mode': 'mode risiko', 'risk_percent': 'risiko %', 'risk_usdt': 'risiko USDT', 'max_positions': 'maks SELL', 'max_buy_positions': 'maks BUY',
             'buy_enabled': 'BUY aktif', 'bz_enabled': 'BZ aktif', 'max_bz_positions': 'maks BZ', 'stop_balance_usdt': 'rem saldo', 'max_loss_streak': 'rem kalah beruntun', 'leverage_auto': 'leverage otomatis',
             'leverage': 'leverage', 'margin_isolated': 'margin isolated', 'daily_summary': 'ringkasan', 'summary_hours_kst': 'jam ringkasan', 'exclude': 'koin dikecualikan'}

    @staticmethod
    def remote_val(spec, v):
        if v is None: return None
        t = spec[0]
        if t == 'num':
            try: x = float(v)
            except (TypeError, ValueError): return None
            if not math.isfinite(x): return None
            x = round(min(spec[2], max(spec[1], x)), spec[3])
            return int(x) if spec[3] == 0 else x
        if t == 'bool': return v if isinstance(v, bool) else None
        if t == 'mode': return v if v in ('percent', 'usdt') else None
        if t == 'hours':
            if not isinstance(v, list): return None
            return sorted({int(h) for h in v if isinstance(h, (int, float)) and 0 <= h <= 23})[:6]
        if t == 'syms':
            if not isinstance(v, list): return None
            out = []
            for x in v:
                x = str(x).upper().strip()
                if 6 <= len(x) <= 24 and x.endswith('USDT') and x.isalnum() and x not in out: out.append(x)
            return out[:40]
        return None

    def applied(self):
        cfg = {k: self.cfg.get(k) for k in self.REMOTE}
        return {'cfg': cfg, 'paused': self.paused, 'lossStreak': int(self.st.get('loss_streak', 0)), 'version': BOT_VERSION}

    def control(self, quiet=False):
        """apply the remote settings from the website (Atur -> Kontrol bot); anything not set there = snr_bot_config.json.
        API keys, testnet, dry_run and the report key are never changed from the website."""
        self.ctl_at = time.time()
        c = fetch_control(self.cfg, self.applied())
        if c is None: return
        remote = c.get('set') if isinstance(c.get('set'), dict) else {}
        changes, reload = [], False
        for k, spec in self.REMOTE.items():
            v = self.remote_val(spec, remote.get(k))
            want = self.base[k] if v is None else v
            if want != self.cfg.get(k):
                self.cfg[k] = want
                changes.append(f"{self.LABEL[k]} {(', '.join(map(str, want)) or '-') if isinstance(want, list) else ('ya' if want is True else 'tidak' if want is False else want)}")
                if k in ('exclude', 'buy_enabled', 'bz_enabled'): reload = True
        paused = c.get('paused') is True
        if paused != self.paused:
            self.paused = paused
            changes.append('JEDA: tidak buka posisi baru (posisi terbuka tetap jalan dengan SL/TP)' if paused else 'LANJUT: boleh buka posisi baru lagi')
        reset_at = c.get('resetAt') if isinstance(c.get('resetAt'), (int, float)) else 0
        if reset_at and reset_at > self.st.get('reset_at', 0):          # the website's "Reset" button (only a recent press counts)
            self.st['reset_at'] = reset_at
            if reset_at > (time.time() - 900) * 1000 and self.st.get('loss_streak', 0):
                self.st['loss_streak'] = 0; self.st['brake_sent'] = 0; changes.append('hitungan kalah beruntun di-reset ke 0')
            save_state(self.st)
        close_at = c.get('closeAllAt') if isinstance(c.get('closeAllAt'), (int, float)) else 0
        if close_at and close_at > self.st.get('close_all_at', 0):            # EMERGENCY from the website (confirmed twice in the app)
            self.st['close_all_at'] = close_at; save_state(self.st)
            if close_at > (time.time() - 600) * 1000: self.close_all()            # only a press from the last 10 minutes counts
        if reload:
            try: self.load_symbols()
            except RuntimeError as e: log.warning('Muat ulang koin gagal: %s', e)
        if changes:
            log.info('Setelan dari website: %s', '; '.join(changes))
            if not quiet: notify(self.cfg, 'Setelan dari website dipakai: ' + '; '.join(changes) + '.')
            fetch_control(self.cfg, self.applied())   # tell the website what is used now

    def close_all(self):
        """close every position THIS bot opened, at market (reduce-only), then cancel their TP/SL; manual positions are not touched"""
        own = dict(self.st.get('positions') or {})
        log.error('DARURAT dari website: tutup %d posisi bot sekarang.', len(own))
        if self.cfg['dry_run'] or not own:
            notify(self.cfg, 'DARURAT dari website: tidak ada posisi bot yang terbuka. Bot dijeda (tidak buka posisi baru).', 'error'); return
        try: live = self.positions()
        except RuntimeError as e:
            notify(self.cfg, f'DARURAT: daftar posisi tidak terbaca ({e}). TUTUP MANUAL di Binance!', 'error'); return
        done = []
        for sym, p in own.items():
            side = p.get('side', 'SELL'); amt = live.get(sym, 0)
            if (amt > 0) if side == 'BUY' else (amt < 0):
                self.close_now(sym, abs(amt), side); done.append(sym.replace('USDT', ''))
        time.sleep(3); self.manage()                                       # books the closes (manual) and cancels the leftover TP/SL
        notify(self.cfg, f"DARURAT dari website: {len(done)} posisi ditutup{' (' + ', '.join(done) + ')' if done else ''}. Bot dijeda — lanjutkan dari Atur → Kontrol bot.", 'error')

    def run(self):
        self.api.sync_time(); self.load_symbols()
        self.control(quiet=True)
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
        nbz = int(self.cfg.get('max_bz_positions') or 0) if self.cfg.get('bz_enabled') else 0
        log.info('Mode: %s · risiko %s · maks %d posisi SELL + %d BUY + %d BZ · leverage %s', 'DRY RUN (tanpa order)' if self.cfg['dry_run'] else 'TRADING',
                 f"{self.cfg['risk_percent']}% saldo" if self.cfg['risk_mode'] == 'percent' else f"{self.cfg['risk_usdt']} USDT", self.cfg['max_positions'],
                 int(self.cfg.get('max_buy_positions') or 0) if self.buy_coins else 0, nbz, 'otomatis (0,5 / jarak SL, maks 20x)' if self.cfg.get('leverage_auto', True) else f"{self.cfg['leverage']}x")
        last_sync = time.time()
        notify(self.cfg, f"Bot mulai ({'DRY RUN' if self.cfg['dry_run'] else 'TRADING'}, {'testnet' if self.cfg['testnet'] else 'akun asli'}): {len(self.coins)} koin SELL + {len(self.buy_coins)} koin BUY, risiko {self.cfg['risk_usdt'] if self.cfg['risk_mode'] == 'usdt' else str(self.cfg['risk_percent']) + '%'} per trade, maks {self.cfg['max_positions']} SELL + {int(self.cfg.get('max_buy_positions') or 0) if self.buy_coins else 0} BUY + {nbz} BZ (semua koin likuid){' · JEDA dari website' if self.paused else ''}.")
        self.push_balance()
        while True:
            if time.time() - self.ctl_at > 60: self.control()
            if time.time() - getattr(self, 'bal_pushed', 0) > (60 if self.st['positions'] else 900): self.push_balance()   # every minute while positions are open, else every 15 min
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
                own = self.st['positions']                              # positions per part; unknown live positions: short = SNR, long = BUY
                n_side = {g: {k for k, v in own.items() if strat_of(v) == g} for g in ('snr', 'btc', 'bz')}
                n_side['snr'] |= {k for k, a in live.items() if a < 0 and k not in own}; n_side['btc'] |= {k for k, a in live.items() if a > 0 and k not in own}
                cap = {'snr': int(self.cfg['max_positions']), 'btc': int(self.cfg.get('max_buy_positions') or 0),
                       'bz': int(self.cfg.get('max_bz_positions') or 0) if self.cfg.get('bz_enabled') else 0}
                stop = float(self.cfg.get('stop_balance_usdt') or 0)
                if sigs and stop > 0 and not self.cfg['dry_run']:
                    bal = self.balance()
                    if bal >= stop: self.st['brake_sent'] = 0
                    if bal < stop:
                        log.error('REM AKTIF: saldo %.2f USDT di bawah batas %.2f — tidak membuka posisi baru. Naikkan modal / ubah stop_balance_usdt bila ingin lanjut.', bal, stop)
                        if not self.st.get('brake_sent'): notify(self.cfg, f'REM AKTIF: saldo {bal:.2f} USDT di bawah batas {stop:.2f}. Bot tidak membuka posisi baru.', 'error'); self.st['brake_sent'] = 1
                        sigs = []
                if sigs and self.paused:
                    log.info('JEDA dari website — %d sinyal dilewati.', len(sigs)); sigs = []
                mx = int(self.cfg.get('max_loss_streak') or 0)
                if sigs and mx > 0 and self.st.get('loss_streak', 0) >= mx:
                    log.error('REM KALAH BERUNTUN aktif (%d SL berturut-turut) — %d sinyal dilewati. Lanjut lagi: python snr_bot.py --reset', self.st['loss_streak'], len(sigs))
                    sigs = []
                for sym, side, sl, close, level, strat in sigs:
                    if sym in busy: continue
                    nm = STRAT_NAME[strat]
                    if not self.cfg['dry_run'] and len(n_side[strat]) >= cap[strat]:
                        log.info('Sinyal %s %s %s dilewati: sudah %d posisi %s', nm, side, sym, len(n_side[strat]), nm); continue
                    log.info('Sinyal %s %s %s: close %s menembus %s %s', nm, side, sym, close, {'btc': 'high 50 H4', 'snr': 'support', 'bz': 'band bawah Bollinger (squeeze)'}[strat], level)
                    try: self.open_pos(sym, side, sl, close, strat)
                    except RuntimeError as e: log.error('%s: order gagal: %s', sym, e)
                    busy.add(sym); n_side[strat].add(sym)
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


def sync_command(args):
    """--sync: repair after another bot (or a crash) left positions the bot does not know about.
    1) every open Binance position missing from snr_bot_state.json is adopted (side, size, entry, SL/TP read from Binance; ticket = symbol-entry order id,
       the same id the bot uses, so the website matches it) -> its TP / SL is reported later like any other position;
    2) for each coin given (e.g. CAPUSDT PONSUSDT) the last closed position of the past 14 days is read from the trade history and its close is
       reported to the website journal / Telegram. Never sends orders. Run it only while the bot is stopped."""
    try:
        lk = socket.socket(); lk.bind(('127.0.0.1', LOCK_PORT))
    except OSError:
        sys.exit('Bot masih berjalan. Hentikan dulu: python snr_bot.py --stop  (tunggu ±40 detik), lalu jalankan --sync lagi.')
    setup_log(); cfg = load_config()
    strat = next((a.split('=', 1)[1] for a in args if a.startswith('strat=')), 'bz')
    if strat not in STRAT_NAME: sys.exit('strat harus snr, btc atau bz')
    syms = [a.upper() for a in args if not a.startswith('strat=')]
    api = Binance(cfg); api.sync_time()
    st = load_state(); st.setdefault('positions', {})
    nowms = int(time.time() * 1000)
    def history(sym):    # Binance gives at most 7 days per call: read the last 14 days in two windows, oldest first
        out = []
        for k in (2, 1):
            try: out += api.get('/fapi/v1/userTrades', {'symbol': sym, 'startTime': nowms - k * 7 * 86_400_000 + 1, 'endTime': nowms - (k - 1) * 7 * 86_400_000, 'limit': 1000}, signed=True)
            except RuntimeError as e: print(f'{sym}: riwayat tidak terbaca ({e})')
        uniq = {(x.get('id'), x['orderId'], x['time'], x['qty']): x for x in out}          # no double count where the windows touch
        return sorted(uniq.values(), key=lambda x: (int(x['time']), int(x.get('id', 0))))
    vw = lambda xs: sum(float(x['price']) * float(x['qty']) for x in xs) / max(1e-12, sum(float(x['qty']) for x in xs))
    # 1) adopt unknown open positions
    try: rows = api.get('/fapi/v3/positionRisk', signed=True)
    except RuntimeError: rows = api.get('/fapi/v2/positionRisk', signed=True)
    live = {r['symbol']: r for r in rows if float(r.get('positionAmt') or 0) != 0}
    try: algos = api.get('/fapi/v1/openAlgoOrders', {}, signed=True)
    except RuntimeError as e: algos = []; print(f'Order SL/TP tidak terbaca: {e}')
    if isinstance(algos, dict): algos = algos.get('orders') or algos.get('rows') or []
    for sym, r in live.items():
        if sym in st['positions']: print(f'{sym}: sudah dikenal bot'); continue
        amt = float(r['positionAmt']); side = 'BUY' if amt > 0 else 'SELL'
        mine = [a for a in algos if a.get('symbol') == sym]
        typ = lambda a: str(a.get('orderType') or a.get('type') or '')
        sl = next((float(a['triggerPrice']) for a in mine if 'STOP' in typ(a) and 'PROFIT' not in typ(a)), 0.0)
        tp = next((float(a['triggerPrice']) for a in mine if 'TAKE_PROFIT' in typ(a)), 0.0)
        if not (sl > 0 and tp > 0):
            print(f'{sym}: SL/TP tidak ditemukan di Binance — dilewati, cek manual di app Binance.'); continue
        tr = history(sym)
        ent = [x for x in tr if x['side'] == side]
        if not ent: print(f'{sym}: transaksi entry tidak ditemukan (lebih dari 14 hari?) — dilewati.'); continue
        oid = ent[-1]['orderId']; fills = [x for x in ent if x['orderId'] == oid]
        p = {'ticket': f'{sym}-{oid}', 'side': side, 'strat': strat, 'entry': float(r.get('entryPrice') or vw(fills)), 'sl': sl, 'tp': tp,
             'qty': abs(amt), 'opened': int(fills[0]['time']) // 1000, 'trim_id': None,
             'sl_id': next((a.get('algoId') for a in mine if 'STOP' in typ(a) and 'PROFIT' not in typ(a)), None),
             'tp_id': next((a.get('algoId') for a in mine if 'TAKE_PROFIT' in typ(a)), None)}
        st['positions'][sym] = p
        report(cfg, {'event': 'open', 'strategy': strat, 'ticket': p['ticket'], 'symbol': sym, 'side': side, 'price': p['entry'], 'sl': sl, 'tp': tp, 'lot': p['qty'], 'time': p['opened']})
        print(f'{sym}: diambil alih ({STRAT_NAME[strat]} {side}, entry {p["entry"]}, SL {sl}, TP {tp}) — TP/SL-nya nanti dilaporkan.')
    save_state(st)
    # 2) missed close reports
    for sym in syms:
        if sym in live: print(f'{sym}: masih terbuka di Binance — tidak ada yang dilaporkan.'); continue
        tr = history(sym)
        if not tr: print(f'{sym}: tidak ada transaksi 14 hari terakhir.'); continue
        last = tr[-1]['orderId']; cl = [x for x in tr if x['orderId'] == last]
        ex = cl[0]['side']; side = 'BUY' if ex == 'SELL' else 'SELL'
        ent = [x for x in tr if x['side'] == side and int(x['time']) < int(cl[0]['time'])]
        if not ent: print(f'{sym}: transaksi entry tidak ditemukan — dilewati.'); continue
        oid = ent[-1]['orderId']; fills = [x for x in ent if x['orderId'] == oid]
        t0 = int(fills[0]['time']); t1 = int(cl[-1]['time'])
        pnl = sum(float(x['realizedPnl']) - float(x['commission']) for x in tr if t0 <= int(x['time']) <= t1 and x.get('commissionAsset') == 'USDT')
        try:
            inc = api.get('/fapi/v1/income', {'symbol': sym, 'incomeType': 'FUNDING_FEE', 'startTime': t0, 'endTime': t1}, signed=True)
            pnl += sum(float(x['income']) for x in inc)
        except RuntimeError: pass
        entry, exit_px = vw(fills), vw(cl); reason = 'tp' if pnl > 0 else 'sl'
        d = abs(exit_px - entry); sgn = 1 if side == 'BUY' else -1
        sl_px, tp_px = (entry - sgn * d / 2, exit_px) if reason == 'tp' else (exit_px, entry + sgn * 2 * d)
        ok = report(cfg, {'event': 'close', 'strategy': strat, 'ticket': f'{sym}-{oid}', 'symbol': sym, 'side': side, 'price': exit_px, 'profit': round(pnl, 2), 'reason': reason,
                          'lot': sum(float(x['qty']) for x in fills), 'entry': entry, 'sl': sl_px, 'tp': tp_px, 'time': t1 // 1000})
        print(f'{sym}: penutupan dilaporkan ({reason.upper()}, {pnl:+.2f} USDT)' if ok else f'{sym}: laporan ditolak website — cek log.')
    lk.close()
    print('Selesai. Jalankan bot lagi: python snr_bot.py --install')


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
    elif cmd == '--sync':
        sync_command(sys.argv[2:])
    elif cmd == '--status':
        try:
            with open(LOG_FILE, encoding='utf-8') as f: lines = f.readlines()[-15:]
            print(''.join(lines))
        except FileNotFoundError: print('Belum ada log.')
        print('stop.flag ada -> bot dihentikan' if os.path.exists(STOP_FILE) else '')
    else:
        sys.exit('Perintah: --install, --status, --stop, --reset, --uninstall, --test, --sync')


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
