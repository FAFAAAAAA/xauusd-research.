# Scan: level apa yang di-respect harga (2026-11-22)

Skrip: `scripts/research/respect_scan.py`. Data: `data/market/*_M30` berisi 153 koin Binance USDT, 5 pair forex (EURUSD, GBPUSD, USDJPY, USDCAD, USDCHF), XAUUSD, NASDAQ (USATECHIDXUSD) dan US30. Tiap kombinasi wajib minimal 30 trade.

## Aturan yang diuji
- RR 1:1 dan 1:2
- Winrate di atas 50%
- Profit factor minimal 1,3
- Minimal 8 trade per minggu per instrumen
- Lolos di seluruh data **dan** di out-of-sample (Juli 2024 ke atas)

## Cara uji
- **Level:** PDH/PDL, PWH/PWL, Daily Open, range Asia (00-07 UTC), EMA50/EMA200 H1, angka bulat, Swing SNR H1 (fractal 3, belum ditembus close), FVG M30 yang belum terisi. Pembanding: level acak.
- **Mode:**
  - `touch`: limit di level, SL 1 atau 2 ATR.
  - `confirm`: candle menyentuh level lalu close balik; SL di ujung wick + 0,1 ATR.
  - `break`: close menembus level, ikut arah tembus.
- **Filter:** tanpa filter, searah EMA200 H1, atau jam 07-20 UTC.
- **Biaya:**
  - Kripto: 0,08% per trade.
  - Forex: 1-1,8 pip.
  - XAU: 0,30.
  - NASDAQ: 1,5 poin.
  - US30: 3 poin.
- **Konservatif:**
  - Bila SL dan TP kena di candle yang sama, dihitung SL.
  - Satu posisi per level per instrumen.
  - Tahan maksimal 2 hari.

## Hasil
**0 dari 46.000+ kombinasi lolos semua aturan**, bahkan di data penuh sebelum cek out-of-sample.

Aturannya dilonggarkan (PF minimal 1,1, tetap ≥ 8 trade/minggu, WR > 50% di data penuh dan OOS). Hasilnya hanya 6 kombinasi, semuanya dari koin baru (AERO, HEMI, WLFI, XPL). Datanya masih pendek, jadi itu kebetulan, bukan pola.

Winrate RR 1:1 di mode `touch`, SL 1 ATR, tanpa filter, sudah termasuk biaya. Angka dalam kurung adalah selisih terhadap level acak:

| Level | CRYPTO | FOREX | NASDAQ | US30 | XAU |
|---|---|---|---|---|---|
| Asia H/L | 46.8% (-0.9) | 42.9% (-3.6) | 42.5% (-0.3) | 42.8% (-1.1) | 43.2% (-2.7) |
| Daily Open | 46.7% (-0.9) | 49.5% (+2.9) | 48.8% (+6.0) | 48.0% (+4.1) | 48.4% (+2.4) |
| EMA200 H1 | 48.0% (+0.3) | 46.0% (-0.5) | 41.7% (-1.1) | 44.2% (+0.3) | 46.3% (+0.3) |
| EMA50 H1 | 48.4% (+0.7) | 46.6% (+0.1) | 43.0% (+0.2) | 43.6% (-0.2) | 46.5% (+0.6) |
| FVG M30 | 49.4% (+1.7) | 47.9% (+1.4) | 46.4% (+3.6) | 46.7% (+2.8) | 48.1% (+2.2) |
| PDH/PDL | 44.2% (-3.4) | 43.1% (-3.5) | 40.0% (-2.8) | 41.1% (-2.8) | 39.4% (-6.6) |
| PWH/PWL | 38.8% (-8.8) | 40.1% (-6.5) | 38.0% (-4.8) | 44.2% (+0.3) | 35.3% (-10.7) |
| RANDOM (baseline) | 47.6% | 46.6% | 42.8% | 43.9% | 46.0% |
| Round Number | 45.1% (-2.5) | 43.1% (-3.5) | 42.2% (-0.7) | 43.4% (-0.5) | 42.1% (-3.9) |
| Swing SNR H1 | 46.1% (-1.5) | 44.7% (-1.8) | 40.9% (-1.9) | 42.1% (-1.8) | 42.3% (-3.6) |

## Kesimpulan
- **Tidak ada level yang "selalu di-respect".** Semua level ada di kisaran ±4 poin dari level acak.
- **Daily Open** paling konsisten di atas acak untuk forex, NASDAQ, US30 dan XAU (+2 sampai +6 poin). **FVG M30** sedikit di atas acak di semua kelas. Tetapi winrate keduanya setelah biaya masih di bawah 50%.
- **PDH/PDL, PWH/PWL dan Swing SNR lebih sering ditembus daripada level acak**, paling kuat di XAU. Namun mode breakout di level yang sama juga tidak cukup kuat setelah biaya.
- **RR 1:2 dengan WR > 50% berarti PF > 2.** Tidak ada satu pun konfigurasi yang mendekati angka itu secara konsisten.
