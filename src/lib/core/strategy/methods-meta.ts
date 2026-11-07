/**
 * Single-method strategies ("satu metode per versi"): each is ONE part of Breakout v0.8 on its own, with ONE slot
 * (at most one open position). Same trend filter family as v0.8. Shared by the server (registry/DB rows) and the UI (labels).
 */
export interface MethodMeta { adapterKey: string; version: string; label: string; rules: string; params: Record<string, boolean>; /** own adapter (not a part of v0.8) */ custom?: boolean; /** base (entry) timeframe, default M15; scalping uses M1/M5 */ baseTf?: 'M1' | 'M5' | 'M15' | 'M30'; /** pairs selected by default in the backtest form */ pairs?: string[] }
const OFF = { donchianH1: false, newYork: false, levelTouch: false, nH1: false, nH4: false, baseH4: false, baseH1: false };
const TREND = 'BUY: H4 close > EMA50 > EMA200 & D1 close > EMA50 · SELL kebalikannya + EMA50 D1 < EMA200';
const TREND_EMA = 'BUY: EMA50 H4 > EMA200 · SELL: EMA50 < EMA200 di H4 & D1';
export const METHODS: MethodMeta[] = [
  { adapterKey: 'metode_level', version: 'level-v3', label: 'v1 Level',
    rules: `Swing high/low H1 yang sudah disentuh 2–3× ditembus close H1 pertama (candle momentum, badan ≥ 1×ATR) · entry open M15 berikutnya · sinyal ke-2 searah di hari yang sama dilewati · SL level ∓ 1,5×ATR H1 · ${TREND} · tanpa batas posisi terbuka`,
    params: { ...OFF, levelTouch: true, skipSecond: true } },
  { adapterKey: 'metode_donchian', version: 'h1-40-v1', label: 'Donchian H1',
    rules: `Close H1 di atas high / di bawah low 40 candle H1 sebelumnya (candle momentum) · SL close ∓ 2,5×ATR H1 · ${TREND} · tanpa batas posisi · cocok juga: US100`,
    params: { ...OFF, donchianH1: true } },
  { adapterKey: 'metode_ny', version: 'newyork-v1', label: 'Range NY',
    rules: `Range 12:00–13:30 UTC, close M15 pertama keluar range 13:30–16:00 UTC (candle momentum) · SL sisi lain range · ${TREND} · tanpa batas posisi · cocok juga: US100, USDCAD`,
    params: { ...OFF, newYork: true } },
  { adapterKey: 'metode_base_h4', version: 'base-h4-v1', label: 'Base H4',
    rules: `Base H4 ≥ 3 candle (overlap ≥ 50%, tinggi ≤ 1,5×ATR) · close M15 keluar base jam 07–17 UTC · SL batas base ∓ 0,3×ATR H4 · ${TREND_EMA} · tanpa batas posisi · cocok juga: USDJPY`,
    params: { ...OFF, baseH4: true } },
  { adapterKey: 'metode_base_h1', version: 'base-h1-v1', label: 'Base H1',
    rules: `Base H1 ≥ 3 candle (overlap ≥ 50%, tinggi ≤ 1,5×ATR), harga sebelumnya bergerak ≥ 1×ATR searah · close M15 keluar base · SL batas base ∓ 0,3×ATR H1 · ${TREND_EMA} · tanpa batas posisi`,
    params: { ...OFF, baseH1: true } },
  { adapterKey: 'metode_pola_n', version: 'pola-n-v1', label: 'Pola N',
    rules: `A-B-C di H1/H4 (swing = pantulan 3×ATR, C di atas A untuk BUY) · close M15 menembus B · SL di C · ${TREND_EMA} · tanpa batas posisi`,
    params: { ...OFF, nH1: true, nH4: true } },
];
// "v1 XAU" (internal key v2, version volbreak-v5) has its own adapter (volbreak.ts); listed here for labels, report rules and the DB row.
// Renamed 7 Nov 2026: the owner keeps only this strategy for gold; the others stay in the code but are hidden on the website.
METHODS.push({ adapterKey: 'metode_volbreak', version: 'volbreak-v5', label: 'v1 XAU', custom: true, params: {}, pairs: ['XAUUSD'],
  rules: `Close M15 di atas open hari ini + 0,5 × range kemarin (BUY) / di bawah open − 0,5 × range kemarin (SELL); hari Senin memakai range Jumat (sesi Minggu tidak dihitung) · badan candle sinyal ≥ 0,5×ATR M15 · maks 1 entry per arah per blok 4 jam, sinyal ke-2 searah di hari yang sama dilewati · SL level ∓ 0,35×ATR D1, TP 2× jarak SL, SL digeser ke entry setelah +1R · ${TREND} · tanpa batas posisi terbuka` });
// v3 has its own adapter (bosh1.ts).
METHODS.push({ adapterKey: 'metode_bos_h1', version: 'bos-h1-v1', label: 'v3 BOS', custom: true, params: {},
  rules: `Swing H1 (pivot 3 candle): BUY bila swing low C lebih tinggi dari swing low A, lalu close M15 menembus swing high B di antaranya (SELL kebalikannya) · 1 trade per level B · SL di C ∓ 0,1×ATR H1, TP 2× jarak SL · ${TREND} · tanpa batas posisi terbuka` });
// Strategies from the multi-pair study (pairs.ts).
METHODS.push({ adapterKey: 'metode_trendline_h4', version: 'trendline-h4-v1', label: 'Trendline H4', custom: true, params: {},
  rules: `Pivot H4 (5 candle kiri-kanan): BUY bila close H4 menembus garis yang melewati 2 pivot high terakhir yang menurun (SELL: 2 pivot low yang naik) · 1 trade per garis · SL di pivot lawan terakhir ∓ 0,1×ATR H4, TP 2× jarak SL · ${TREND} · tanpa batas posisi · paling cocok: US100 (trade bisa berhari-hari)` });
METHODS.push({ adapterKey: 'metode_asia_london', version: 'asia-london-v1', label: 'Asia → London', custom: true, params: {},
  rules: `Range Asia = candle M15 00:00–06:59 UTC · close M15 pertama keluar range antara 07:00–11:59 UTC (tiap arah sekali per hari) · SL sisi lain range ∓ 0,1×ATR M15, TP 2× jarak SL · ${TREND} · tanpa batas posisi · paling cocok: USDJPY` });
// v1 NAS (nas.ts) — Nasdaq (US100) only, research 7 Nov 2026 (README 6b).
METHODS.push({ adapterKey: 'metode_nas_donchian', version: 'nas-donchian-v1', label: 'v1 NAS', custom: true, params: {}, pairs: ['USATECHIDXUSD'], baseTf: 'M30',
  rules: `US100: close H1 di atas high 20 candle H1 sebelumnya (BUY) / di bawah low 20 candle (SELL) · breakout lanjutan: breakout searah sebelumnya paling lama 2 candle H1 sebelumnya · entry hanya 10:00–16:00 waktu New York (bursa AS buka) · SL close ∓ 0,2×ATR D1, TP 2× jarak SL · ${TREND} · tanpa batas posisi` });
export const methodByKey = (k: string) => METHODS.find((m) => m.adapterKey === k);
export const methodByStrategy = (s: string) => METHODS.find((m) => `metode ${m.version}` === s);
