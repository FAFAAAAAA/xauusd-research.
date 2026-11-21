#!/usr/bin/env node
/*
 * GMGN paper recorder (no trading, no wallet, read-only API key).
 *
 * Every minute it reads GMGN (Solana) and writes down "would-buy" moments of 4 strategies, then follows each
 * token's price with 1-minute candles for 48 hours. Nothing is bought or sold.
 *
 *   sinyal   = every new GMGN signal (market signal), recorded per signal_type
 *   smart    = 2+ different smart-money wallets buy the same token within 30 minutes
 *   trending = token enters the 1h trending list and passes the safety filter
 *   baru     = newly migrated token (trenches "completed") that passes the safety filter
 *
 * Safety filter (trending / baru): liquidity, not honeypot, rug ratio, wash trading, holder spread (see FILTER below).
 *
 * Usage (in the folder of this file):
 *   node gmgn_rekam.js            start recording (leave the window open)
 *   node gmgn_rekam.js --laporan  results so far per strategy and SL/TP (cost included)
 *
 * Needs gmgn-cli (npm install -g gmgn-cli) and GMGN_API_KEY (file .env next to this file: GMGN_API_KEY=...).
 * Without .env it uses GMGN's public demo key, which is meant for testing only.
 */
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const VERSION = '2026.11.21.1';
const HERE = __dirname, DATA = path.join(HERE, 'data'), STATE = path.join(HERE, 'rekam_state.json'), LOG = path.join(HERE, 'gmgn_rekam.log');
const CHAIN = 'sol';
const TRACK_H = 48;                 // follow each token for 48 hours
const CHECK_MIN = 15;               // fetch new candles of open tokens every 15 minutes
const PER_HOUR = { sinyal: 30, smart: 15, trending: 15, baru: 15 };   // max new tokens per strategy per hour (rate limit)
const COST = 0.03;                  // assumed round-trip cost (fees + slippage) as a fraction of price, used in --laporan
const GRID = [[0.2, 0.4], [0.3, 0.6], [0.5, 1.0]];                    // SL / TP as a fraction of entry (RR 1:2)
const STABLE = new Set(['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
const FILTER = { minLiq: 20000, maxRug: 0.3, maxTop10: 0.35, maxDev: 0.1, maxBundler: 0.3, minHolders: 200 };

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const now = () => Math.floor(Date.now() / 1000);
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function log(...a) { const s = `${stamp()} ${a.join(' ')}`; console.log(s); try { fs.appendFileSync(LOG, s + '\n'); } catch (e) { /* ignore */ } }

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(HERE, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch (e) { /* no .env */ }
  if (!process.env.GMGN_API_KEY) { process.env.GMGN_API_KEY = 'gmgn_solbscbaseethmonadtron'; log('Memakai kunci DEMO GMGN (hanya untuk tes). Buat .env dengan GMGN_API_KEY milikmu.'); }
}

// ---------- GMGN calls (sequential, rate limited) ----------
let lastCall = 0;
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function gmgn(args) {
  const wait = 1300 - (Date.now() - lastCall); if (wait > 0) sleepMs(wait);
  lastCall = Date.now();
  if (!args.every((a) => /^[A-Za-z0-9_\-.:]+$/.test(String(a)))) throw new Error('argumen tidak aman');
  const r = spawnSync('gmgn-cli', [...args, '--raw'], { shell: true, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '').trim();
  if (r.status !== 0 || !out) throw new Error(((r.stderr || '') + out).trim().slice(0, 200) || `kode ${r.status}`);
  try { return JSON.parse(out); } catch (e) { throw new Error('jawaban bukan JSON: ' + out.slice(0, 120)); }
}
function findList(j, keys) {           // GMGN wraps lists differently per route: try known paths, then the first array found
  for (const k of keys) { let o = j; for (const p of k.split('.')) o = o && o[p]; if (Array.isArray(o)) return o; }
  if (Array.isArray(j)) return j;
  let o = j;
  for (let d = 0; d < 5 && o && typeof o === 'object'; d++) {
    const k = Object.keys(o); const a = k.find((x) => Array.isArray(o[x])); if (a) return o[a];
    const b = k.find((x) => o[x] && typeof o[x] === 'object'); if (!b) break; o = o[b];
  }
  return [];
}
function candles(addr, from, to) {     // 1m candles [{t, o, h, l, c}] (t in seconds)
  const j = gmgn(['market', 'kline', '--chain', CHAIN, '--address', addr, '--resolution', '1m', '--from', String(from), '--to', String(to)]);
  return findList(j, ['list', 'data.list', 'data']).map((k) => ({ t: Math.floor(num(k.time) / (num(k.time) > 1e11 ? 1000 : 1)), o: num(k.open), h: num(k.high), l: num(k.low), c: num(k.close) }))
    .filter((k) => k.t && k.h && k.l && k.c).sort((a, b) => a.t - b.t);
}

// ---------- state ----------
function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return { seen: {}, open: [], hour: {}, smartBuys: [] }; } }
function saveState(S) { fs.writeFileSync(STATE + '.tmp', JSON.stringify(S)); fs.renameSync(STATE + '.tmp', STATE); }
const recPath = (id) => path.join(DATA, id + '.json');

function addCandidate(S, strat, addr, feat) {
  if (!addr || STABLE.has(addr)) return;
  const key = strat + ':' + addr, t = now();
  if (S.seen[key] && t - S.seen[key] < 86400) return;           // same token, same strategy: once per 24h
  const hr = strat.split('_')[0] + ':' + Math.floor(t / 3600);
  if ((S.hour[hr] || 0) >= (PER_HOUR[strat.split('_')[0]] || 10)) return;
  let entry = null, k = [];
  try { k = candles(addr, t - 600, t); if (k.length) entry = k[k.length - 1].c; } catch (e) { log('candle', addr.slice(0, 8), e.message); }
  if (!entry && num(feat.price)) entry = num(feat.price);
  if (!entry) return;
  S.seen[key] = t; S.hour[hr] = (S.hour[hr] || 0) + 1;
  const id = `${t}_${strat}_${addr.slice(0, 10)}`;
  fs.writeFileSync(recPath(id), JSON.stringify({ id, strat, addr, t, entry, feat, k: [], done: false }));
  S.open.push({ id, addr, t, last: t });
  log('CATAT', strat.padEnd(10), addr.slice(0, 10), 'harga', entry.toPrecision(4), feat.symbol || '');
}

const safe = (x) => (num(x.liquidity) || 0) >= FILTER.minLiq && !(x.is_honeypot === true || x.is_honeypot === 1 || x.is_honeypot === '1')
  && !(x.is_wash_trading === true || x.is_wash_trading === 1) && (num(x.rug_ratio) == null || num(x.rug_ratio) < FILTER.maxRug)
  && (num(x.top_10_holder_rate) == null || num(x.top_10_holder_rate) < FILTER.maxTop10);
const pick = (x, keys) => Object.fromEntries(keys.filter((k) => x[k] !== undefined && typeof x[k] !== 'object').map((k) => [k, x[k]]));
const FEAT = ['symbol', 'price', 'market_cap', 'liquidity', 'holder_count', 'top_10_holder_rate', 'rug_ratio', 'dev_team_hold_rate', 'bundler_rate',
  'smart_degen_count', 'renowned_count', 'sniper_count', 'price_change_percent5m', 'price_change_percent1h', 'volume', 'swaps', 'creation_timestamp', 'open_timestamp', 'launchpad'];

function poll(S) {
  // 1) GMGN signals
  try {
    for (const s of findList(gmgn(['market', 'signal', '--chain', CHAIN]), ['data', 'list'])) {
      const key = 'sig:' + s.id; if (!s.id || S.seen[key]) continue; S.seen[key] = now();
      if (now() - (num(s.trigger_at) || 0) > 900) continue;          // only fresh signals (<= 15 min old)
      const d = s.data || {}, c = s.cur_data || {};
      addCandidate(S, 'sinyal_' + s.signal_type, s.token_address, { ...pick(d, FEAT), signal_type: s.signal_type, trigger_mc: s.trigger_mc, market_cap: s.market_cap, signal_times: s.signal_times, liquidity: c.liquidity ?? d.liquidity, holder_count: c.holder_count ?? d.holder_count });
    }
  } catch (e) { log('signal:', e.message); }
  // 2) smart money: 2+ wallets buying the same token within 30 minutes
  try {
    const t = now();
    for (const x of findList(gmgn(['track', 'smartmoney', '--chain', CHAIN, '--limit', '100']), ['list', 'data.list'])) {
      if (x.side !== 'buy' || (num(x.amount_usd) || 0) < 50) continue;
      const ts = num(x.timestamp) || 0, k = x.transaction_hash; if (!k || S.seen['tx:' + k]) continue; S.seen['tx:' + k] = ts || t;
      S.smartBuys.push({ a: x.base_address, m: x.maker, ts, sym: (x.base_token || {}).symbol });
    }
    S.smartBuys = S.smartBuys.filter((b) => t - b.ts < 1800);
    const by = {}; for (const b of S.smartBuys) (by[b.a] = by[b.a] || new Set()).add(b.m);
    for (const [a, makers] of Object.entries(by)) if (makers.size >= 2) addCandidate(S, 'smart', a, { wallets: makers.size, symbol: (S.smartBuys.find((b) => b.a === a) || {}).sym });
  } catch (e) { log('smart:', e.message); }
  // 3) trending 1h
  try {
    for (const x of findList(gmgn(['market', 'trending', '--chain', CHAIN, '--interval', '1h', '--limit', '50']), ['data.rank', 'rank'])) {
      if (!safe(x) || (num(x.holder_count) || 0) < FILTER.minHolders || !((num(x.price_change_percent1h) || 0) > 0)) continue;
      addCandidate(S, 'trending', x.address, pick(x, FEAT));
    }
  } catch (e) { log('trending:', e.message); }
  // 4) newly migrated tokens
  try {
    const j = gmgn(['market', 'trenches', '--chain', CHAIN, '--type', 'completed', '--limit', '80']);
    for (const x of findList(j, ['data.completed', 'completed'])) {
      if (!safe(x) || (num(x.dev_team_hold_rate) || 0) > FILTER.maxDev || (num(x.bundler_rate) || 0) > FILTER.maxBundler) continue;
      addCandidate(S, 'baru', x.address, pick(x, FEAT));
    }
  } catch (e) { log('trenches:', e.message); }
}

function track(S) {                     // append new 1m candles to each open record, close after 48h
  const t = now(); let n = 0;
  for (const o of S.open) {
    if (t - o.last < CHECK_MIN * 60 && t - o.t < TRACK_H * 3600) continue;
    if (n++ >= 25) break;               // at most 25 tokens per round (rate limit); the rest next round
    let rec; try { rec = JSON.parse(fs.readFileSync(recPath(o.id), 'utf8')); } catch (e) { o.drop = true; continue; }
    const end = Math.min(t, o.t + TRACK_H * 3600);
    try {
      for (let a = o.last; a < end; a += 480 * 60) {
        const k = candles(o.addr, a, Math.min(end, a + 480 * 60)); const lastT = rec.k.length ? rec.k[rec.k.length - 1][0] : 0;
        for (const c of k) if (c.t > lastT && c.t >= o.t) rec.k.push([c.t, c.h, c.l, c.c]);
      }
      o.last = end;
      if (end >= o.t + TRACK_H * 3600) { rec.done = true; o.drop = true; }
      fs.writeFileSync(recPath(o.id), JSON.stringify(rec));
    } catch (e) { log('ikuti', o.addr.slice(0, 8), e.message); if (t - o.t > (TRACK_H + 24) * 3600) o.drop = true; }
  }
  S.open = S.open.filter((o) => !o.drop);
  for (const k of Object.keys(S.seen)) if (t - S.seen[k] > 3 * 86400) delete S.seen[k];
  for (const k of Object.keys(S.hour)) if (Number(k.split(':')[1]) < Math.floor(t / 3600) - 2) delete S.hour[k];
}

// ---------- report ----------
function outcome(rec, sl, tp) {         // first touch of SL / TP after entry; both in one candle = SL (conservative)
  const e = rec.entry, lo = e * (1 - sl), hi = e * (1 + tp);
  for (const [, h, l] of rec.k) { if (l <= lo) return { x: -1, end: true }; if (h >= hi) return { x: tp / sl, end: true }; }
  if (!rec.k.length) return null;
  return { x: (rec.k[rec.k.length - 1][3] / e - 1) / sl, end: rec.done };   // not hit yet: value at the last price
}
function report() {
  const recs = fs.existsSync(DATA) ? fs.readdirSync(DATA).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return null; } }).filter(Boolean) : [];
  if (!recs.length) { console.log('Belum ada catatan.'); return; }
  const t0 = Math.min(...recs.map((r) => r.t)), t1 = Math.max(...recs.map((r) => r.t)), mid = (t0 + t1) / 2;
  console.log(`GMGN rekam ${VERSION} · ${recs.length} catatan · ${new Date(t0 * 1000).toISOString().slice(0, 16)} s/d ${new Date(t1 * 1000).toISOString().slice(0, 16)} UTC · biaya ${COST * 100}% per trade`);
  console.log('x = kelipatan risiko (SL). "terbuka" = belum kena TP/SL, dinilai di harga terakhir.');
  const groups = {}; for (const r of recs) (groups[r.strat] = groups[r.strat] || []).push(r);
  for (const [sl, tp] of GRID) {
    console.log(`\nSL -${sl * 100}% / TP +${tp * 100}%`);
    console.log('strategi       n   menang  per trade  total x  paruh1   paruh2  terbuka');
    for (const [g, rs] of Object.entries(groups).sort()) {
      const o = rs.map((r) => ({ r, q: outcome(r, sl, tp) })).filter((z) => z.q);
      if (!o.length) continue;
      const x = o.map((z) => z.q.x - COST / sl), m = (a) => a.length ? (a.reduce((s, v) => s + v, 0) / a.length) : NaN;
      const h1 = o.filter((z) => z.r.t < mid).map((z) => z.q.x - COST / sl), h2 = o.filter((z) => z.r.t >= mid).map((z) => z.q.x - COST / sl);
      console.log(`${g.padEnd(13)}${String(o.length).padStart(4)}  ${(100 * o.filter((z) => z.q.x > 0).length / o.length).toFixed(0).padStart(5)}%  ${m(x).toFixed(2).padStart(8)}  ${x.reduce((s, v) => s + v, 0).toFixed(1).padStart(7)}  ${m(h1).toFixed(2).padStart(6)}  ${m(h2).toFixed(2).padStart(7)}  ${String(o.filter((z) => !z.q.end).length).padStart(6)}`);
    }
  }
}

// ---------- main ----------
if (process.argv.includes('--laporan')) { report(); process.exit(0); }
loadEnv(); fs.mkdirSync(DATA, { recursive: true });
log(`GMGN rekam ${VERSION} mulai — hanya mencatat, tidak membeli apa pun. Tutup jendela ini untuk berhenti.`);
const S = loadState();
const ONCE = process.argv.includes('--sekali');
for (;;) {
  const t = Date.now();
  try { poll(S); track(S); saveState(S); } catch (e) { log('putaran gagal:', e.message); }
  const open = S.open.length; if (Math.floor(t / 600000) !== Math.floor((t - 60000) / 600000)) log(`terbuka ${open} token · total catatan ${fs.readdirSync(DATA).length}`);
  if (ONCE) break;
  const w = 60000 - (Date.now() - t); if (w > 0) sleepMs(w);
}
