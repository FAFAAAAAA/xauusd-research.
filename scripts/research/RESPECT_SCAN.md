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

## Tahap 5: breakout lebih cepat (`fast_breakout_scan.py`, `fast_portfolio.py`)
- **Lama tahan versi lama (M30, SL 2 ATR, maks 48 jam):** median 3-5 jam. Tapi 25% trade ditahan lebih dari 7-13 jam, dan 10% lebih dari 13-20 jam.
- **Versi cepat:** level tetap swing D1/H4, tapi entry dan ATR dari TF kecil (M5/M15/M30). Posisi ditutup paksa setelah 2, 4 atau 8 jam.
- **Temuan:**
  - SL 1 ATR TF kecil selalu rugi (PF 0,7-0,95) karena biaya dan noise. SL 2-3 ATR yang bekerja.
  - **XAU M5, swing D1, EMA200 H1, SL 3 ATR M5, maks 4 jam, parsial:** WR 56%, PF 1,30, PF OOS 1,49, median tahan 1,5 jam.
  - Level H4 memberi ~3 trade/minggu, tapi PF hanya 1,02-1,11.

### Portofolio intraday (semua trade ≤ 8 jam), 2018-2025
| Leg | /minggu | WR | PF | PF 18-21 | PF 22-26 | Tahan median |
|---|---|---|---|---|---|---|
| XAU M5, swing D1, EMA200 H1, SL3, 4 jam, parsial | 1,08 | 56% | 1,30 | 1,37 | 1,01 | 1,5 jam |
| XAU M30, swing D1, struktur H4, SL2, 8 jam, parsial | 0,42 | 57% | 1,40 | 1,41 | 1,33 | 4 jam |
| XAU M30, range Asia, EMA200 H1, SL range, 8 jam, RR2 | 2,17 | 48% | 1,19 | 0,97 | 1,12 | 8 jam |
| NAS M15, ORB NY, EMA20 D1, SL range, 4 jam, parsial | 2,75 | 55% | 1,04 | 0,97 | 1,13 | 4 jam |
| NAS M30, swing D1, EMA200 H1, SL3, 8 jam, RR2 | 0,84 | 51% | 1,25 | 1,53 | 1,05 | 8 jam |
| BTC M30, swing D1, struktur H4, SL2, 8 jam, parsial | 0,50 | 57% | 1,31 | 1,66 | 1,08 | 3 jam |
| USDJPY M15, swing D1, EMA20 D1, SL3, 8 jam, parsial | 0,87 | 59% | 1,26 | 1,51 | 1,14 | 3,8 jam |
| **Total** | **8,6** | **52,7%** | **1,13** | | | **4 jam** |

- **Portofolio:** 8/8 tahun untung, max DD 29,7R. Namun 41% minggu punya kurang dari 8 trade.
- **Edge melemah di 2022-2026** untuk sebagian besar leg, misalnya XAU M5 turun dari PF 1,37 ke 1,01.
- **Bias seleksi:** leg dipilih dari scan seluruh data, jadi angka portofolio kemungkinan optimis.

## Tahap 6: uji jujur walk-forward, RR 1:2 saja, maks tahan 8 jam (`wf_select.py`, `wf_universal.py`)
- **Scan ulang:** semua instrumen dan sinyal breakout, hanya RR 1:2 tanpa parsial, ditutup paksa setelah 2/4/8 jam. Total 30.276 kombinasi.
- **Pilih hanya dari data < 2022, uji di 2022-2026.**
- **Catatan:** RR 1:2 dengan WR > 50% berarti PF > 2. Tidak ada setup yang mendekati itu di tahap mana pun.

### A. Pilih setup terbaik per instrumen (n ≥ 60, PF ≥ 1,2, ≥ 60% tahun untung, ≥ 0,25 trade/minggu)
| | Leg | WR | PF |
|---|---|---|---|
| < 2022 (dipakai memilih) | 168 | 47,6% | 1,33 |
| **≥ 2022 (uji)** | 168 | **41,9%** | **0,96** |

- Non-kripto saja: PF 1,29 jadi 0,97. Koin USDT: PF 1,34 jadi 0,95.
- Seleksi per instrumen **overfit**. Contoh: XAU M5 swing D1 PF 1,61 jadi 0,80.

### B. Satu aturan sama untuk semua instrumen (diperingkat dari data < 2022)
- Korelasi peringkat < 2022 vs ≥ 2022 cukup tinggi (0,65), tapi **tidak ada aturan dengan median PF ≥ 2022 di atas 1,1** (0 dari 348 aturan non-kripto, 0 dari 130 aturan kripto).
- **Aturan terbaik:** M30, close tembus swing D1, searah EMA200 H1, SL 3 ATR M30, RR 1:2, maks 8 jam. Dijalankan di 10 instrumen non-kripto (XAU, NAS, US30, 5 forex, BTC, ETH):

| Periode | Trade/minggu | Minggu ≥ 8 trade | WR | PF | Max DD |
|---|---|---|---|---|---|
| 2018-2021 | 10,5 | 76% | 46,9% | 1,10 | 36R |
| 2022-2026 | 11,1 | 83% | 46,5% | 1,05 | 53R |

- **Per instrumen ≥ 2022:**
  - USDJPY 1,37, ETH 1,19, XAU 1,16, BTC 1,13.
  - EURUSD dan NAS 1,05, US30 1,03.
  - GBPUSD 0,97, USDCHF 0,90, USDCAD 0,73.
- **Median tahan 8 jam.** Kebanyakan trade ditutup karena batas waktu sebelum mencapai 2R. WR 46% termasuk trade yang ditutup waktu dengan untung kecil.

### Kesimpulan akhir
- **Target lengkap (RR 1:2, WR > 50%, PF tinggi, ≥ 8 trade/minggu) tidak tercapai** di data mana pun.
- Yang tersisa setelah uji jujur hanya edge tipis: PF ~1,05, ~11 trade/minggu, WR ~46%.
- Setelah biaya, slippage live dan jeda eksekusi, edge setipis ini bisa habis. **Belum layak untuk uang sungguhan**, paling jauh untuk forward test di akun demo.

### Rekomendasi: aturan tunggal di instrumen dengan PF < 2022 > 1
Aturannya sama dengan bagian B. Instrumennya hanya yang PF-nya > 1 sebelum 2022, jadi dipilih tanpa melihat data 2022+: XAU, NASDAQ, EURUSD, USDJPY, BTC, ETH.

| Periode | Trade/minggu | WR | PF | Max DD | PF per tahun |
|---|---|---|---|---|---|
| 2018-2021 | 6,1 | 48,7% | 1,20 | 17R | 1,18 / 1,31 / 1,24 / 1,10 |
| **2022-2026** | **6,7** | **47,3%** | **1,16** | **26R** | 1,08 / 1,10 / 1,13 / 1,23 / 1,27 |

Semua tahun 2022-2026 untung. Kekurangannya: frekuensi 6,7 trade/minggu, masih di bawah target 8.

## Tahap 7: cari strategi RR 1:2 terbaik, target lain diabaikan (`strat_lab.py`, `lab_yearly.py`, `lab_cap.py`)
- **Universe:** 46 instrumen dengan data sejak < 2021 (36 koin + BTC/ETH, XAU, NAS, US30, 5 forex).
- **Uji:** RR 1:2 tanpa parsial, 10 keluarga sinyal × 4 filter tren × SL 2/3/5 ATR M30 × maks tahan 8 jam / 24 jam / 5 hari.
- **Cara pilih:** satu aturan untuk satu kelompok aset, diperingkat dari data < 2022, diuji di ≥ 2022.

### Keluarga sinyal (PF gabungan semua variasi, < 2022 → ≥ 2022)
| Keluarga | Kripto | Non-kripto |
|---|---|---|
| swing D1 (breakout) | 1,18 → 1,07 | 1,04 → 1,02 |
| retest D1 (flip) | 1,16 → 1,09 | 0,95 → 0,96 |
| donchian D1 55 | 1,09 → 1,07 | 1,04 → 1,05 |
| PWH/PWL, NR4, inside day | 1,11-1,15 → 0,95-0,98 | 0,89-0,99 → 0,92-0,96 |
| RSI pullback, RSI2 reversion, big candle | 0,85-1,07 → 0,93-0,95 | 0,91-0,94 → 0,91-0,93 |

### Terbaik: retest swing D1 di kripto
**Aturan:**
- Level adalah swing high/low D1 (fractal 2) yang **baru ditembus close M30**, maksimal 5 hari lalu.
- Pasang **limit di level itu** saat harga kembali menyentuhnya dari sisi baru. Resistance yang ditembus jadi support untuk BUY, dan sebaliknya untuk SELL.
- Hanya searah tren **EMA200 H1 dan EMA20 D1** sekaligus.
- **SL 5 ATR(14) M30, TP 10 ATR (RR 1:2)**, tutup paksa setelah 5 hari.
- **Maksimal 5 posisi terbuka bersamaan** di seluruh koin.

| Periode | Trade/minggu | WR | PF | Max DD | PF per tahun |
|---|---|---|---|---|---|
| < 2022 | 5,1 | 43,9% | 1,35 | 30R | 2017-2021: 1,46 / 1,78 / 1,26 / 1,30 / 1,37 |
| **2022-2026** | **11,2** | **42,4%** | **1,20** | **51R** | 1,21 / 1,16 / 1,43 / 1,10 / 1,09 |

**Catatan:**
- Tanpa batas posisi: PF ≥ 2022 = 1,13, tapi DD 153R karena koin bergerak bersamaan.
- BUY dan SELL sama-sama untung di ≥ 2022: SELL PF 1,21, BUY PF 1,05.
- Variasi breakout langsung (bukan retest): PF ≥ 2022 = 1,12 dengan maks 5 posisi, lebih cepat (median tahan 33 jam).
- Median tahan ~48 jam. Funding rate Binance **belum** dihitung. Biaya 0,08% per trade sudah dihitung.
- **Non-kripto:** tidak ada aturan dengan PF ≥ 2022 di atas 1,07 untuk semua instrumen. Dengan filter instrumen PF < 2022 > 1 (5 dari 8), swing D1 tanpa filter tren, SL 5 ATR, 24 jam: PF ≥ 2022 = 1,19 dengan 4,7 trade/minggu.
