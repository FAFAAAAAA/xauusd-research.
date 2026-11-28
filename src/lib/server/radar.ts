/**
 * Radar (29 Nov 2026): coins that are CLOSE to a bot signal, read from Binance public market data with the bot's own rules
 * (public/bot/snr_bot.py: snr_signal, buy_signal, macd_signal, scan_listing). Nothing is traded here.
 * The heavy part (levels per coin) is rebuilt once per H4 candle and kept in app_settings; every request applies the live price.
 *
 *  ALT  SELL: 26 bot coins, liquid (30 d avg >= $20 jt), D1 close < EMA50. Nearest unused H4 support under the price;
 *             a signal comes when an H4 candle CLOSES below it. Near = price within 1 x ATR14(H4) above it.
 *  BIG  BUY : 6 largest coins, BTC above EMA200 (H4), close above EMA200 (H4). Trigger = high of the last 50 H4 + 0.5 x ATR14(H4)
 *             (a close at or above it). Near = price within 1 x ATR14(H4) under the trigger.
 *  MACD BUY : liquid altcoins (not the 6 largest). MACD (12/26/9, H4) in a negative zone with a first valley already marked,
 *             close above EMA200 (H4) and < 2 x ATR above it: waiting for a second, similar valley (MACD crossing up again).
 *  LISTING SELL: coins listed in the last 24 h: SELL at the close of their 25th 1h candle, SL +10 %.
 */
const FAPI = 'https://fapi.binance.com/fapi/v1';
const SPOT = 'https://data-api.binance.vision/api/v3';
const H4 = 4 * 3_600_000, DAY = 86_400_000, HOUR = 3_600_000;
export const ALT_COINS = ['GMTUSDT', 'FILUSDT', '1000SHIBUSDT', 'SANDUSDT', 'DOTUSDT', 'GALAUSDT', 'ATOMUSDT', 'APTUSDT', 'AVAXUSDT', 'ALGOUSDT',
  'WLDUSDT', 'AAVEUSDT', 'NEOUSDT', '1000PEPEUSDT', 'LUNA2USDT', 'ARBUSDT', 'IMXUSDT', 'THETAUSDT', 'FTMUSDT', 'KSMUSDT',
  '1000LUNCUSDT', '1INCHUSDT', 'ROSEUSDT', 'ARKMUSDT', 'ANKRUSDT', 'HOTUSDT'];
export const BIG_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
const NOT_COINS = new Set(['USDCUSDT', 'BTCDOMUSDT', 'FDUSDUSDT', 'USDPUSDT', 'TUSDUSDT', 'DEFIUSDT']);
const PV = 5, KEEP = 10, SLK = 0.5, MIN_VOL = 20_000_000, NEAR = 1.0;
const BUY_N = 50, BUY_BRK = 0.5, MB_EXT = 2.0, MB_TOL = 8;

type K = [number, number, number, number, number, number];   // open ms, o, h, l, c, quote volume
export type RadarStrat = 'snr' | 'btc' | 'mb' | 'lst';
/** per coin, fixed until the next H4 close */
export interface RadarBase { sym: string; strat: RadarStrat; side: 'BUY' | 'SELL'; level: number; trigger: number; sl: number; tp: number; atr: number; note: string; at?: number }
export interface RadarItem extends RadarBase { price: number | null; dist: number | null; status: string }
export interface RadarData { bar: number; builtAt: number; btcDrop: number | null; btcUp: boolean; items: RadarBase[]; listing: Array<{ sym: string; signalAt: number }> }

async function get(url: string): Promise<any> {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
async function klines(sym: string, interval: string, limit: number, now: number): Promise<K[]> {
  const q = `symbol=${sym}&interval=${interval}&limit=${limit}`;
  let rows: any[];
  try { rows = await get(`${FAPI}/klines?${q}`); } catch { rows = await get(`${SPOT}/klines?${q}&limit=${Math.min(limit, 1000)}`); }
  return rows.filter((r) => Number(r[6]) < now).map((r) => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[7])] as K);
}
/** run tasks with a small concurrency (Binance weight stays low) */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; try { await fn(x); } catch { /* one coin failing never stops the radar */ } } }));
}
const emaSeries = (v: number[], n: number) => { const a = 2 / (n + 1), o = [v[0]]; for (let i = 1; i < v.length; i++) o.push(a * v[i] + (1 - a) * o[i - 1]); return o; };
const emaLast = (v: number[], n: number) => emaSeries(v, n)[v.length - 1];
/** ATR14 exactly like the bot (first TR from the second candle) */
const atrBot = (k: K[]) => { let a = -1; for (let i = 1; i < k.length; i++) { const pc = k[i - 1][4], tr = Math.max(k[i][2] - k[i][3], Math.abs(k[i][2] - pc), Math.abs(k[i][3] - pc)); a = a < 0 ? tr : a + (tr - a) / 14; } return a; };
const vol30 = (d1: K[]) => d1.slice(-30).reduce((s, r) => s + r[5], 0) / Math.min(30, d1.length);

/** ALT: the unused supports after the walk over the H4 candles (same walk as snr_signal) */
export function altSupports(h4: K[]): number[] {
  const n = h4.length, sup: Array<[number, boolean]> = [];
  for (let k = 2 * PV; k < n; k++) {
    const q = k - PV; let low = true;
    for (let j = q - PV; j <= q + PV; j++) if (h4[j][3] < h4[q][3]) { low = false; break; }
    if (low) { sup.push([h4[q][3], false]); if (sup.length > KEEP) sup.shift(); }
    const c = h4[k][4], pc = h4[k - 1][4];
    for (const lv of sup) if (!lv[1] && c < lv[0] && pc >= lv[0]) lv[1] = true;
  }
  return sup.filter((x) => !x[1]).map((x) => x[0]);
}
/** MACD state at the last closed H4 candle (same machine as macd_signal): waiting for the second valley? */
export function macdWaiting(h4: K[]): { zlow: number; first: number } | null {
  const n = h4.length; if (n < 300) return null;
  const c = h4.map((r) => r[4]), lo = h4.map((r) => r[3]);
  const e12 = emaSeries(c, 12), e26 = emaSeries(c, 26), mc = c.map((_, i) => e12[i] - e26[i]);
  const sg = mc.map((_, i) => (i >= 8 ? mc.slice(i - 8, i + 1).reduce((a, b) => a + b, 0) / 9 : 0));
  let side = 0, pend = 0, pcnt = 0, vals: number[] = [], zlow = Infinity, fired = false;
  for (let i = 35; i < n; i++) {
    const mv = mc[i], cur = mv > 0 ? 1 : mv < 0 ? -1 : side;
    if (side === 0) side = cur;
    let flipped = false;
    if (cur === side) { pend = 0; pcnt = 0; } else { if (pend !== cur) { pend = cur; pcnt = 0; } pcnt++; if (pcnt > 6) { side = cur; pend = 0; pcnt = 0; vals = []; fired = false; flipped = true; } }
    zlow = flipped ? lo[i] : Math.min(zlow, lo[i]);
    const up = mc[i] > sg[i] && mc[i - 1] <= sg[i - 1], dn = mc[i] < sg[i] && mc[i - 1] >= sg[i - 1];
    if ((side === -1 && up && mv < 0) || (side === 1 && dn && mv > 0)) {
      if (vals.length < 200) vals.push(mv);
      if (vals.length >= 2 && !fired) {
        const ref = Math.max(Math.abs(vals[vals.length - 2]), Math.abs(vals[vals.length - 1]));
        const sim = ref > 0 && (Math.abs(vals[vals.length - 1] - vals[vals.length - 2]) / ref) * 100 <= MB_TOL;
        let best = 0; for (let z = 1; z < vals.length; z++) if (side === -1 ? vals[z] < vals[best] : vals[z] > vals[best]) best = z;
        if (sim && best >= vals.length - 2) fired = true;
      }
    }
  }
  // waiting: negative zone, at least one valley, no signal yet in this zone, MACD now under its signal line (a new valley is forming)
  if (side !== -1 || !vals.length || fired || !(mc[n - 1] < 0 && mc[n - 1] < sg[n - 1])) return null;
  return { zlow, first: vals[vals.length - 1] };
}

export async function buildRadar(now: number, enabled: { btc: boolean; mb: boolean; lst: boolean }): Promise<RadarData> {
  const bar = Math.floor(now / H4) * H4;
  const info = await get(`${FAPI}/exchangeInfo`).catch(() => null);
  const trading = new Set<string>(), onboard: Record<string, number> = {};
  for (const s of info?.symbols ?? []) if (s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING') { trading.add(s.symbol); onboard[s.symbol] = Number(s.onboardDate) || 0; }
  const ok = (s: string) => !trading.size || trading.has(s);
  const items: RadarBase[] = [];
  // BTC filters
  const btc = await klines('BTCUSDT', '4h', 1000, now).catch(() => [] as K[]);
  const btcDrop = btc.length >= 7 ? btc[btc.length - 1][4] / btc[btc.length - 7][4] - 1 : null;
  const btcUp = btc.length >= 210 && btc[btc.length - 1][4] > emaLast(btc.map((r) => r[4]), 200);
  // ALT
  await pool(ALT_COINS.filter(ok), 6, async (sym) => {
    const d1 = await klines(sym, '1d', 400, now); if (d1.length < 60 || vol30(d1) < MIN_VOL) return;
    if (!(d1[d1.length - 1][4] < emaLast(d1.map((r) => r[4]), 50))) return;
    const h4 = (await klines(sym, '4h', 601, now)).slice(-600); if (h4.length < 40) return;
    const atr = atrBot(h4), close = h4[h4.length - 1][4]; if (!(atr > 0)) return;
    const below = altSupports(h4).filter((lv) => lv <= close); if (!below.length) return;
    const lv = Math.max(...below), sl = lv + SLK * atr;
    if ((close - lv) / atr > 3) return;   // far away even before the live price
    items.push({ sym, strat: 'snr', side: 'SELL', level: lv, trigger: lv, sl, tp: lv - 2 * (sl - lv), atr, note: 'support H4' });
  });
  // BIG
  if (enabled.btc && btcUp) await pool(BIG_COINS.filter(ok), 3, async (sym) => {
    const h4 = sym === 'BTCUSDT' ? btc : await klines(sym, '4h', 1000, now); if (h4.length < 210) return;
    const n = h4.length, hh = (a: number, b: number) => { let m = -Infinity; for (let j = a; j < b; j++) m = Math.max(m, h4[j][2]); return m; };
    const lvl = hh(n - BUY_N, n);                                    // channel the NEXT candle has to close above
    if (h4[n - 1][4] > hh(n - 1 - BUY_N, n - 1)) return;            // the last candle already broke out: not a first close
    if (!(h4[n - 1][4] > emaLast(h4.map((r) => r[4]), 200))) return;
    const a4 = atrBot(h4); if (!(a4 > 0)) return;
    const trig = lvl + BUY_BRK * a4;
    if ((trig - h4[n - 1][4]) / a4 > 3) return;
    const d1 = await klines(sym, '1d', 400, now); const ad = atrBot(d1); if (!(ad > 0)) return;
    const sl = trig - ad;
    items.push({ sym, strat: 'btc', side: 'BUY', level: lvl, trigger: trig, sl, tp: trig + 2 * (trig - sl), atr: a4, note: 'high 50 H4 + 0,5 ATR' });
  });
  // MACD: liquid altcoins (24 h volume pre-filter, then the 30-day average like the bot)
  if (enabled.mb) {
    const tick: any[] = await get(`${FAPI}/ticker/24hr`).catch(() => []);
    const cand = tick.filter((t) => ok(t.symbol) && t.symbol.endsWith('USDT') && !NOT_COINS.has(t.symbol) && !BIG_COINS.includes(t.symbol) && Number(t.quoteVolume) >= 0.25 * MIN_VOL).map((t) => t.symbol as string);
    await pool(cand, 8, async (sym) => {
      const d1 = await klines(sym, '1d', 32, now); if (d1.length < 20 || vol30(d1) < MIN_VOL) return;
      const h4 = await klines(sym, '4h', 1000, now); const w = macdWaiting(h4); if (!w) return;
      const c = h4.map((r) => r[4]), close = c[c.length - 1], a4 = atrBot(h4), e200 = emaLast(c, 200);
      if (!(a4 > 0 && close > e200 && (close - e200) / a4 < MB_EXT)) return;
      const stop = w.zlow - 0.1 * a4, rk = (close - stop) / close; if (!(rk >= 0.003 && rk <= 0.25)) return;
      items.push({ sym, strat: 'mb', side: 'BUY', level: w.zlow, trigger: close, sl: stop, tp: close + 2 * (close - stop), atr: a4, note: 'tunggu lembah MACD ke-2' });
    });
  }
  // LISTING: listed in the last 24 h -> signal at the close of the 25th 1h candle
  const listing: RadarData['listing'] = [];
  if (enabled.lst) for (const [sym, ob] of Object.entries(onboard)) {
    if (!ob || NOT_COINS.has(sym) || ob > now || now - ob > 24 * HOUR) continue;
    listing.push({ sym, signalAt: Math.floor(ob / HOUR) * HOUR + 25 * HOUR });
  }
  return { bar, builtAt: now, btcDrop, btcUp, items, listing };
}

/** live view: distance of the live price to each signal, near ones only, nearest first */
export async function radarView(data: RadarData, now: number) {
  const px: Record<string, number> = {};
  try { for (const t of await get(`${FAPI}/ticker/price`)) px[t.symbol] = Number(t.price); } catch { /* without prices: distances from the last close are unknown */ }
  const out: RadarItem[] = [];
  for (const b of data.items) {
    const price = px[b.sym] ?? null;
    let dist: number | null = null, status = '';
    if (b.strat === 'snr') { if (price != null) dist = (price - b.level) / b.atr; status = dist != null && dist < 0 ? 'Sudah di bawah support — sinyal jika H4 tutup di bawahnya' : 'Turun ke support lalu H4 tutup di bawahnya'; }
    else if (b.strat === 'btc') { if (price != null) dist = (b.trigger - price) / b.atr; status = dist != null && dist < 0 ? 'Sudah di atas pemicu — sinyal jika H4 tutup di atasnya' : 'Naik ke pemicu lalu H4 tutup di atasnya'; }
    else { dist = null; status = 'Lembah MACD pertama sudah ada, tunggu lembah kedua yang mirip (MACD silang naik lagi)'; }
    if (dist != null && (dist > NEAR || dist < -1)) continue;
    if (data.btcDrop != null && data.btcDrop < -0.04 && b.strat === 'snr') status = 'Ditahan: BTC turun lebih dari 4% dalam 24 jam';
    // MACD: entry is the close of the signal candle; keep the levels on the live price
    const it: RadarItem = { ...b, price, dist, status };
    if (b.strat === 'mb' && price != null) { it.trigger = price; it.tp = price + 2 * (price - b.sl); }
    out.push(it);
  }
  for (const l of data.listing) {
    const price = px[l.sym] ?? null;
    const left = l.signalAt - now; if (left < -30 * 60_000) continue;
    out.push({ sym: l.sym, strat: 'lst', side: 'SELL', level: price ?? 0, trigger: price ?? 0, sl: price != null ? price * 1.1 : 0, tp: price != null ? price * 0.8 : 0, atr: 0, note: 'koin baru', at: l.signalAt,
      price, dist: null, status: left > 0 ? `SELL saat candle 1h ke-25 tutup (± ${Math.max(1, Math.round(left / 3_600_000 * 10) / 10)} jam lagi). Garis: perkiraan dari harga sekarang` : 'Sinyal sekarang (candle 1h ke-25 tutup)' });
  }
  const rank = (x: RadarItem) => (x.strat === 'lst' ? (x.at ?? 0) - now : x.dist == null ? 5 : Math.abs(x.dist));
  out.sort((a, b) => rank(a) - rank(b));
  return { bar: data.bar, builtAt: data.builtAt, items: out, btcUp: data.btcUp, btcDrop: data.btcDrop };
}
