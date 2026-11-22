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

## Tahap 2: kombinasi (`combo_scan.py`, `combo_portfolio.py`)
Daily Open dan FVG M30 diuji ulang dengan tambahan berikut. Totalnya 58.000 kombinasi.
- **Jendela sesi:** London 07-10, NY 13-16, London+NY, 07-20 UTC.
- **Setup:** DO+FVG konfluensi (jarak ≤ 0,5 ATR), atau gabungan DO atau FVG.
- **Filter tren:** EMA200 H1.
- **SL:** 1, 1,5 atau 2 ATR.
- **Exit:** RR 1:1, RR 1:2, atau parsial (50% di 1R, SL ke BE, sisa ke 2R).

### Hasil
- **PF ≥ 1,3 + WR > 50% + ≥ 8 trade/minggu: 0 kombinasi.**
- **Versi longgar (PF ≥ 1,1): 62 kombinasi.** Semuanya koin yang listing setelah Juli 2024. Ini tidak terbukti sebagai pola: setup terbaiknya di 47 koin baru punya median PF 1,00.
- **Kandidat terbaik di koin lama:** DO atau FVG, NY 13-16, searah tren, SL 2 ATR, RR 1:2. Di OOS, 87% dari 106 koin PF > 1 (median 1,09). Tapi uji portofolio per tahun menunjukkan edge-nya **bergantung rezim pasar**:

| Tahun | Kripto lama: WR | Kripto lama: PF | Forex+XAU+indeks: PF |
|---|---|---|---|
| 2020 | 37% | 1,05 | 0,90 |
| 2021 | 35% | 0,99 | 0,86 |
| 2022 | 35% | 0,97 | 0,98 |
| 2023 | 36% | 1,00 | 0,95 |
| 2024 | 38% | 1,11 | 1,01 |
| 2025 | 36% | 1,03 | 0,95 |
| 2026 | 37% | 1,05 | 1,05 |

- **Forex, XAU, NASDAQ, US30: PF 0,87-1,00 di semua simbol.** Tidak ada edge.

### Kesimpulan tahap 2
Konfirmasi sesi, konfluensi, tren dan TP parsial tidak mengubah hasil tahap 1. Level Daily Open dan FVG memang memantul sedikit lebih sering daripada level acak. Tapi bedanya terlalu kecil untuk menutup biaya secara konsisten, dan untung yang muncul di kripto hanya ada di periode 2024-2026.

## Koreksi (berlaku untuk semua tahap)
- **Biaya XAU, NASDAQ dan US30 sekarang proporsional harga:** XAU 1,5 bps, indeks 1 bps. Sebelumnya biaya tetap dalam poin, sehingga terlalu mahal di tahun harga rendah (XAU 2004 ≈ 0,6R per trade). Tahap 1-2 sudah diulang untuk ketiga instrumen ini dan **tetap 0 yang lolos**.
- **BTCUSD dan ETHUSD sebelumnya terlewat** (tidak ada file BTCUSDT/ETHUSDT). Ketiga scan sudah dijalankan untuk keduanya: **0 lolos**, PF tertinggi 1,35.

## Tahap 3: support/resistance + filter tren (`snr_trend_scan.py`, `snr_yearly.py`)
- **S/R:** swing fractal H1, H4 dan D1, dalam tiga jenis:
  - `plain`: swing terdekat yang belum ditembus.
  - `strong`: zona dengan ≥ 2 swing.
  - `flip`: resistance yang baru ditembus dan jadi support, atau sebaliknya.
- **Filter tren:** EMA200 H1, EMA200 H1 + slope, EMA stack 20/50/200 H1, struktur H4 (HH+HL / LH+LL), EMA20 D1.
- **Mode:** touch (SL 1 atau 2 ATR), confirm, break.
- **Exit:** RR 1:1, RR 1:2, atau parsial.
- **Total:** 90.000+ kombinasi.

### Hasil
- **Lolos semua aturan: 0.**
- **Filter tren membantu, tapi sedikit.** Median PF naik ~0,02-0,06 dibanding tanpa filter, dan tidak ada filter yang mengubah hasil secara drastis.
- **Pantulan (touch/confirm) di swing S/R rugi di semua kelas** (median PF 0,4-0,9), terutama di swing H4/D1 yang belum ditembus. Harga lebih sering **menembus** swing lama daripada memantul.
- **Temuan terkuat: breakout swing D1 di XAU.** Setupnya close M30 menembus swing high/low D1 searah EMA200 H1, SL 2 ATR M30:

| Exit | n | WR | PF | PF OOS | Tahun PF > 1 | Max DD |
|---|---|---|---|---|---|---|
| RR 1:1 | 1.223 | 58,8% | 1,31 | 1,57 | 19/23 | 16,6R |
| Parsial (1R + BE + 2R) | 1.166 | 59,2% | 1,37 | 1,84 | 19/23 | 17,5R |
| RR 1:2, filter struktur H4 | 461 | 45,6% | 1,55 | 1,49 | 17/23 | 10,2R |

  Kekurangannya: hanya **~1 trade/minggu**.
- **Setup yang sama di instrumen lain lebih lemah:**
  - BTC: PF 1,16 (9/10 tahun untung).
  - ETH: PF 1,09.
  - NASDAQ: PF 1,10.
  - US30: PF 1,00.
  - Forex: PF 0,80-1,00.
  - Median koin lama: PF 0,99.

  Jadi edge ini paling jelas di XAU, bukan pola universal.

## Tahap 4: breakout TF kecil, validasi M1, portofolio (`breakout_scan.py`, `xau_m1_validate.py`, `breakout_portfolio.py`)

### Validasi M1 breakout swing D1 XAU
Exit dihitung ulang di data M1 (2004 sampai Jan 2026), sehingga urutan SL/TP di dalam candle M30 terlihat. Hasilnya sejalan dengan M30, malah sedikit lebih baik. Artinya edge ini bukan artefak dari cara simulasi.

| Setup | Exit | n | WR | PF | Tahun untung |
|---|---|---|---|---|---|
| D1 + EMA200 H1 | RR 1:1 | 1.269 | 58,9% | 1,33 | 16/23 |
| D1 + EMA200 H1 | Parsial | 1.179 | 58,9% | 1,39 | 17/23 |
| D1 + struktur H4 | Parsial | 481 | 60,7% | 1,52 | 19/22 |
| H4 + EMA stack H1 | Parsial | 2.264 | 55,6% | 1,18 | 19/23 |

### Breakout di TF kecil
- **Sinyal:** swing TF itu sendiri, swing H1, Donchian 20/55, ORB London (08:00 London) dan ORB NY (09:30 New York), keduanya ikut DST, range Asia, PDH/PDL, squeeze Bollinger.
- **Filter tren:** EMA200 H1, EMA20 D1, keduanya.
- **SL:** 1,5/2/3 ATR, atau sisi range seberang.
- **TF dan instrumen:**
  - M5: XAU.
  - M15: forex, XAU, NASDAQ, US30, BTC, ETH.
  - M30: semua.

**Hasil: 0 lolos di M5, M15 dan M30.**
- Hampir semua breakout TF kecil punya PF ≤ 1,05 setelah biaya. Forex paling buruk.
- Versi longgar di M30 (29 kombinasi) semuanya koin yang listing 2024-2025.
- Kandidat terbaik:
  - **XAU, range Asia, M30:** searah EMA200 H1, SL di sisi range seberang, RR 1:2. PF 1,21, PF data baru 1,48, ~2 trade/minggu.
  - **NASDAQ, ORB NY, M15:** searah EMA20 D1, SL di sisi range, parsial. PF 1,15, WR 55%, ~2,3 trade/minggu.

### Portofolio breakout (2018+)
| Portofolio | Trade/minggu | WR | PF | Tahun untung | Max DD |
|---|---|---|---|---|---|
| XAU D1 + H4 | 2,9 | 56,4% | 1,21 | 7/9 | 25,5R |
| XAU D1 + H4 + Asia | 4,7 | 51,6% | 1,16 | 8/9 | 28,8R |
| **6 leg terbaik** (XAU D1, XAU H4, XAU Asia, BTC D1, NAS D1, NAS ORB NY) | **9,1** | **53,4%** | **1,16** | **9/9** | 34,0R |
| Semua 9 leg (+ETH D1, BTC H4, NAS H4) | 14,5 | 53,2% | 1,10 | 8/9 | 62,7R |

**Catatan:**
- Leg dipilih dari hasil scan di seluruh data, jadi ada bias seleksi. Hanya leg XAU D1 yang sudah terbukti di OOS dan di M1.
- Portofolio 6 leg memenuhi ≥ 8 trade/minggu dan WR > 50%. PF-nya 1,16, belum mencapai 1,3.
