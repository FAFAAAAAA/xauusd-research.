# XAUUSD Research System

Website riset XAUUSD: replay historis mandiri, event SNR, berita ekonomi dengan pencegahan look-ahead, webhook TradingView, dan notifikasi Telegram (LIVE dan SIMULASI BACKTEST).

> **Status:** infrastruktur. Strategi SNR, BUY/SELL, SL, dan TP **belum** ditentukan. Strategi aktif bawaan adalah `snr unconfigured` yang tidak menghasilkan event apa pun ("Strategy Not Configured"). Satu fixture `test_zone_proximity TEST-0` disediakan khusus untuk uji teknis pipeline.

---

## 1. Arsitektur

```
LIVE      TradingView (Pine alert JSON) ──► /api/webhooks/tradingview ──► validasi · auth · rate limit · dedupe
                                                                         └► market_events (LIVE) ──► Telegram 🔔 LIVE
BACKTEST  CSV OHLC ──► historical_candles ──► Replay engine (server) ──► Strategy adapter (versi aktif)
                                                 │  hanya candle ≤ waktu replay      └► market_events (BACKTEST)
                                                 └► berita yang SUDAH tersedia      └► Telegram 🧪 SIMULASI (opt-in)
Website (Next.js) ◄── API routes ◄── PostgreSQL (Supabase, RLS terkunci)
```

| Lapisan | Lokasi |
|---|---|
| Logika inti tanpa framework (bisa diuji mandiri) | `src/lib/core/*` |
| Layanan server (DB, replay, webhook, Telegram, impor, analitik) | `src/lib/server/*` |
| API routes | `src/app/api/**` |
| Halaman (Dashboard, Replay, Analytics, News, Settings) | `src/app/(main)/**` |
| Skema & migrasi | `supabase/migrations/20261031000000_init.sql` |
| Template Pine Script | `pine/xauusd_event_bridge_template.pine` |
| Template CSV / payload uji | `templates/` |
| Tes | `tests/core.test.ts`, `tests/e2e.test.ts` |

### Cara replay bekerja
- Sesi replay disimpan di server (`replay_sessions`) dengan **cursor** = waktu buka candle terakhir yang sudah terungkap.
- Browser hanya menerima candle `open_time ≤ cursor`. Candle masa depan tidak pernah dikirim.
- Event diketahui pada **penutupan** candle (`event_time = open_time + durasi TF`), sama seperti alert Pine `barstate.isconfirmed`.
- Play/Pause/kecepatan: browser memanggil `POST /api/replay/{id}/step`. 1× = 1 candle/detik, 10× = 10 candle/detik. Saat Pause server **menolak** langkah otomatis (HTTP 409); hanya "Next candle" yang diizinkan.
- Optimistic lock pada cursor + `dedupe_key` unik pada event → request ganda/retry tidak membuat event atau pesan Telegram ganda.
- Reset: kebijakan `never` (default) = event yang sudah tercatat tidak dikirim ulang; `new_run` = run baru, event dicatat & dikirim ulang. UI menjelaskan pilihan ini.
- Replay ini **tidak** mengendalikan/membaca Bar Replay TradingView (tidak ada API resmi untuk itu). Untuk mencocokkan hasil, impor CSV event indikator atau laporan Strategy Tester dari TradingView.

### Anti-lookahead
- Strategi menerima konteks yang dibekukan: candle ≤ sekarang, zona dengan `valid_from ≤ sekarang`, berita dengan waktu ketersediaan ≤ sekarang. Output yang merujuk candle masa depan dibuang dan dicatat di `system_errors`.
- `economic_events.actual` hanya terlihat setelah `actual_available_at`. Baris dengan actual tanpa waktu ketersediaan **ditolak** saat impor.
- `news_articles.available_at = max(published_at, first_seen_at)`.
- Sentimen (`rule_surprise_v0`) hanya untuk CPI, PCE, NFP, Unemployment bila actual & forecast ada; keyakinan dibatasi ≤ 0,6; selain itu `Unknown`. Hanya konfirmasi, bukan sinyal.
- Tautan event ↔ berita bernama `related_by_time` dan ditampilkan sebagai "berkaitan dengan berita" — tidak pernah klaim sebab-akibat.

---

## 2. Yang perlu Anda siapkan (akses dari Anda)

| Kebutuhan | Untuk | Cara mendapatkan |
|---|---|---|
| **Proyek Supabase BARU** | Database | supabase.com → New project (terpisah dari proyek lain; proyek lama tidak disentuh) |
| `DATABASE_URL` | Koneksi server | Project Settings → Database → Connection string → *Transaction pooler* (port 6543) |
| **Hosting** (mis. Vercel) | Website dapat diakses | vercel.com → Import repo |
| **Bot Telegram** | Notifikasi | @BotFather → `/newbot` → token |
| **Chat ID** | Tujuan pesan | Kirim pesan ke bot, buka `https://api.telegram.org/bot<TOKEN>/getUpdates`, ambil `message.chat.id` (grup: tambahkan bot, id diawali `-100`) |
| **TradingView** paket yang mendukung webhook | Mode LIVE | Alert → Notifications → Webhook URL |
| **Data OHLC historis XAUUSD** (mis. 2019) | Replay | Unduh dari penyedia yang sah dan sesuai lisensi (mis. ekspor chart TradingView dari akun Anda, Dukascopy historical data, data broker Anda). Catat basis harga (bid/ask) & zona waktu file. |
| **Arsip kalender ekonomi/berita** dengan timestamp | Konfirmasi berita | Ekspor dari sumber yang Anda punya haknya; isi `actual_available_at` sesuai waktu rilis resmi |

---

## 3. Instalasi

```bash
npm install
cp .env.example .env.local     # isi semua nilai
npm run db:migrate             # butuh psql; atau tempel file SQL ke Supabase → SQL Editor → Run
npm run dev                    # http://localhost:3000
```

Membuat secret:
```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 32   # APP_ENCRYPTION_KEY (harus 32 byte)
openssl rand -hex 24      # TRADINGVIEW_WEBHOOK_SECRET
```

### Deploy ke Vercel
1. Push folder ini ke repo Git privat, Import di Vercel.
2. Settings → Environment Variables: isi semua variabel dari `.env.example`. `APP_BASE_URL` = URL https Vercel Anda.
3. Deploy. Buka `/api/health` → `{"ok":true,"db":"up"}` berarti database terhubung.
4. Login dengan `ADMIN_PASSWORD`.

> Region Vercel sebaiknya sama dengan region Supabase. Fungsi impor/derive memakai `maxDuration` 60–300 detik; paket Hobby dibatasi lebih pendek — impor dilakukan per potongan 5.000 baris sehingga tetap aman.

---

## 4. Konfigurasi API

### Telegram
1. Isi `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` di env (disarankan), **atau** simpan lewat Settings (token dienkripsi AES-256-GCM dengan `APP_ENCRYPTION_KEY`, hanya ditampilkan tersamar).
2. Settings → **Send Test Telegram**. Status "Terverifikasi" hanya muncul jika Telegram membalas `ok:true` dengan `message_id`.
3. Aktifkan "Notifikasi LIVE" dan/atau "Notifikasi BACKTEST". Untuk replay, toggle "Kirim notifikasi SIMULASI" juga harus diaktifkan per sesi (default mati).
4. Cooldown: event dengan tipe & zona sama dalam N detik (waktu pasar) tidak dikirim ulang. Batas pesan per menit mencegah spam.
5. Semua percobaan tercatat di `telegram_delivery_logs` (sent/failed/skipped). Retry otomatis untuk 429/5xx/timeout; 4xx tidak di-retry. Pengiriman gagal bisa diulang manual dari Settings.

### TradingView (LIVE)
1. Webhook URL: `https://<app>/api/webhooks/tradingview`.
2. Pesan alert = JSON (lihat Settings atau `templates/tradingview_webhook_TEST_payload.json`). Field wajib: `secret, event_id, symbol, timeframe, event_type, timestamp, price, zone{low,high,kind}, strategy_version, source, mode="LIVE"`.
3. TradingView tidak bisa mengirim header kustom, jadi secret ada di body dan disamarkan (`[REDACTED]`) di log.
4. Validasi: simbol harus XAUUSD (boleh `OANDA:XAUUSD`), timestamp maks 15 menit lalu (webhook bukan jalur data historis), zona `low ≤ high`.
5. Opsional: `TRADINGVIEW_ENFORCE_IP_ALLOWLIST=true` setelah memverifikasi daftar IP TradingView di `src/lib/server/config.ts`.
6. Uji manual:
```bash
curl -X POST https://<app>/api/webhooks/tradingview -H 'content-type: application/json' \
  -d '{"secret":"…","event_id":"TEST-1","symbol":"OANDA:XAUUSD","timeframe":"60","event_type":"SNR_NEAR","timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","price":2000,"zone":{"low":1995,"high":1998,"kind":"support"},"strategy_version":"snr-dev","source":"tradingview-TEST","mode":"LIVE"}'
```

### Data historis
1. Settings → Tambah sumber data: nama, penyedia, simbol, **zona waktu file** (`UTC`, `UTC+2`, atau IANA `Europe/Athens`), basis harga, spread tipikal.
2. Pilih file CSV + timeframe → Impor. Format yang dikenali: TradingView export, MetaTrader, Dukascopy, ISO/unix. Baris rusak dilaporkan; duplikat dilewati.
3. "Bentuk H1, H4 & D1" mengagregasi dari TF yang diimpor (penjajaran UTC atau close 17:00 New York). Bucket tidak lengkap di ujung data dibuang.
4. Dashboard & Replay menampilkan rentang tanggal yang **benar-benar ada**.

### Berita & kalender
Menu News → impor CSV (template di `templates/`). Kategori: `FOMC, US_CPI, US_PCE, NFP, UNEMPLOYMENT, US_TREASURY_YIELD, DXY, GEOPOLITICAL, GOLD_NEWS, OTHER`. Jika tidak ada arsip untuk periode replay, UI menampilkan **DATA UNAVAILABLE**.

---

## 5. Menambahkan strategi SNR Anda nanti

1. Buat adapter di `src/lib/core/strategy/` yang mengimplementasikan `StrategyAdapter` (`evaluate(ctx) → StrategyEventDraft[]`). Fungsi harus murni: hanya memakai `ctx.candles`, `ctx.zones`, `ctx.news`, `ctx.params`, `ctx.state`.
2. Daftarkan di `REGISTRY` (`registry.ts`).
3. Tambah baris `strategy_versions` (mis. `snr`, `v1`, `adapter_key='snr_v1'`, `status='active'`) dan ubah versi lama menjadi `retired`.
4. Terapkan logika yang sama di Pine (`pine/…template.pine`) agar event LIVE dan BACKTEST konsisten (konfirmasi candle close, tanpa repaint).
5. Untuk trade simulasi gunakan `simulateTrade()` (`tradesim.ts`): entry di open candle berikutnya, spread/komisi/slippage, dan kebijakan TP/SL ambigu (`worst` | `best` | `skip`). Simpan hasil ke `simulated_trades` dengan `backtest_sessions.confirmation_profile` (A–D) agar slot perbandingan terisi dari pengujian nyata.

---

## 5a. Strategi SNR H4/H1 → M15 (v0.1, DRAF)

Aturan dipilih pemilik; implementasi: `src/lib/core/strategy/snr.ts` (adapter `snr_h4h1_m15`, versi `snr h4h1m15-v0.1`). **Belum terbukti profit — inilah yang diuji oleh backtest.**

| Bagian | Aturan |
|---|---|
| Tren H4 | Struktur swing dari pivot terkonfirmasi (n=2): 2 pivot high terakhir & 2 pivot low terakhir naik (HH+HL) = bullish → hanya BUY; turun (LH+LL) = bearish → hanya SELL; selain itu netral → tidak entry |
| Zona SNR | Setiap pivot H4 (n=2, 120 candle terakhir) dan H1 (n=3, 240 candle terakhir) → harga pivot ± 0,25×ATR14 TF tersebut; zona yang tumpang tindih digabung |
| Arah zona | Bullish: zona di bawah close M15 sebelumnya (support). Bearish: di atasnya (resistance) |
| Notifikasi dekat | `SNR_NEAR` saat pertama kali jarak ≤ 1,0×ATR14 M15 |
| Entry | `SETUP_CONFIRMED` saat candle M15 menyentuh zona (tanpa candle konfirmasi). Entry di **open M15 berikutnya** |
| Stop loss | BUY: bawah zona − 0,5×ATR14 M15. SELL: atas zona + 0,5×ATR14 M15 |
| Take profit | Diuji 3 varian: RR 1:1, 1:2, 1:3 (satu sesi backtest per RR) |
| Re-entry | Zona yang sama baru aktif lagi setelah harga menjauh (> jarak "dekat"); satu posisi per sesi RR (sinyal saat posisi terbuka dilewati) |
| Gap | Jika open berikutnya > 60 menit setelah sinyal (mis. weekend) → dilewati |
| Ukuran posisi | Default risiko tetap **$10 per trade**: lot = 10 ÷ (jarak entry→SL × 100), tidak dibulatkan ke 0,01 broker. Kosongkan risiko → lot tetap (default 0,01) |
| Biaya default | spread 0,30 · slippage 0,10 · komisi 7/lot · TP & SL di 1 candle = anggap SL |
| Berita | `news_confirmed` = ada rilis high-impact ±24 jam; `sentiment_confirmed` = sentimen rule_surprise_v0 searah. Tanpa arsip berita → kosong (bukan "tidak") |

Anti-lookahead: pivot hanya dipakai setelah n candle kanan **tutup**; strategi hanya menerima candle H1/H4 yang sudah tutup (`runStrategyGuarded` membuang yang belum). Tes `snr.test.ts` + e2e #11 memeriksa: hasil hingga waktu T tidak berubah walau data sesudahnya ada, replay langkah-demi-langkah = backtest runner.

**Data yang dibutuhkan:** impor CSV **M15** (mulai ±1 bulan sebelum tanggal backtest untuk pemanasan; untuk zona H4 idealnya 4 bulan), lalu Atur → Data harga → "Bentuk H1, H4 & D1". Jalankan dari menu Hasil → "Jalankan backtest" (maks ±1 tahun per run). Pine: `pine/xauusd_snr_h4h1_m15_v01.pine` (**belum dikompilasi di TradingView**; perbedaan yang diketahui tertulis di kepala file).

## 5b. Strategi Breakout v0.2 (dipilih dari riset data 2018–2026)

Kode: `src/lib/core/strategy/breakout.ts` (adapter `breakout_v02`). Riset: 92 variasi diuji pada XAUUSD M15 Mei 2018 – Okt 2026 dengan RR 1:2, risiko $10, spread 0,30, slippage 0,10, komisi $7/lot; aturan dipilih dari 2018–2022 dan diuji ulang 2023–2026. Adapter website menghasilkan sinyal yang sama persis dengan riset (1.497 trade, +$1.274).

| Bagian | Aturan |
|---|---|
| Tren | BUY hanya jika close H4 > EMA50(H4) > EMA200(H4) **dan** close D1 > EMA50(D1); SELL kebalikannya |
| H1 | candle H1 ditutup di atas high tertinggi 40 candle H1 sebelumnya (SELL: di bawah low terendah). SL = close ∓ 2,5×ATR14(H1) |
| London | range 00:00–07:00 UTC; close M15 pertama di luar range antara 07:00–11:00 UTC. SL = sisi lain range |
| New York | range 12:00–13:30 UTC; close M15 pertama di luar range antara 13:30–16:00 UTC. SL = sisi lain range |
| M30 (opsional) | breakout 10 candle M30, SL 2,5×ATR14(M30) — lebih sering, hasil lebih lemah |
| Posisi | satu BUY dan satu SELL boleh terbuka per bagian |

Hasil riset (BUY+SELL, H1+London+NY, RR 1:2): ±3,4 trade/minggu, win 36,6%, +$1.274, turun terdalam −$502; 2018–2022 ≈ impas, 2023–2026 +0,18R/trade. Sisi SELL merugi di data ini (−$557) dan bisa dimatikan. **Butuh data D1** (Atur → Data harga → "Bentuk H1, H4 & D1"). Bukan jaminan profit.

## 5c. Strategi buatan sendiri (tanpa coding)

Menu **Strategi** (`/strategi`, dari Atur atau tombol di panel backtest):
- **Buat strategi**: pemicu entry (breakout N candle, EMA cross, harga × EMA, RSI, Bollinger, MACD, breakout range sesi, pola candle) + syarat (tren EMA, harga vs EMA, RSI, jam, hari) + SL (ATR, swing, range, $ tetap). TP diuji RR 1:1/1:2/1:3.
- **Impor file strategi (.json)**: format di `AI_GUIDE` (`src/lib/core/strategy/builder.ts`) — tombol "Salin panduan" untuk dipakai di AI lain.
- **Impor sinyal (.csv)**: `time,side,stop_loss` (jam buka candle M15 sinyal, UTC).
- Strategi bawaan bisa disembunyikan; buatan sendiri bisa dihapus (opsional beserta hasilnya).
Definisi disimpan di `strategy_settings.params.definition` (mode BACKTEST) — tidak perlu migrasi.

## 5d. Pola N (`n_pattern_v1`)

Swing A-B-C dari pivot M15 yang sudah terkonfirmasi (5 candle kiri/kanan). BUY: A low → B high → C low di atas A, dorongan A→B ≥ 1,5×ATR, koreksi (B−C)/(B−A) 30–79%, lalu close M15 pertama menembus B (≤ 48 candle setelah C, C belum ditembus) searah tren H4 (EMA50 > EMA200 dan close > EMA50). SL = C − 0,1×ATR. SELL kebalikannya.
Riset pada data 2018–2026 (12 variasi ditentukan sebelumnya, dipilih dari 2018–2022): 567 trade, win 37,2%, +$537 (RR 1:2, $10/trade, biaya termasuk), turun terdalam −$271; 2018–22 +0,02R/trade, 2023–26 +0,19R/trade; BUY +$709, SELL −$172. Varian tanpa filter tren semuanya minus.

## 5e. RBR / DBD (`rbr_dbd_v1`)

RBR (BUY): dorongan naik (1–3 candle, total ≥ 1×ATR) → base 1–3 candle kecil (badan ≤ 0,5×ATR) → dorongan naik lagi (≥ 1×ATR, close di atas base). Zona demand = badan tertinggi base s/d low terendah base, dari candle H1 yang sudah tutup. Zona harus segar (belum pernah didatangi lagi), mati jika ada close di luar sisi jauh atau lewat 120 candle H1. Entry: candle penolakan M15 (close searah, di 60% atas range) saat harga kembali ke base, searah tren H4 EMA50/200; SL di luar base + 0,1×ATR M15; 1 trade per zona. DBD kebalikannya.
Riset 2018–2026 (RR 1:2, $10, biaya termasuk; 12+12 variasi ditentukan sebelumnya): setelan bawaan 125 trade (±0,3/minggu), win 32,8%, −$60, 2018–22 −0,05R, 2023–26 −0,05R. Tidak ada variasi yang positif konsisten di kedua periode; pola ini jarang muncul sehingga tidak mencapai target 3–10 trade/minggu.

## 5f. SNR breakout H1 (`snr_break_h1_v1`)

Tanpa filter tren. Level SNR = swing high/low H1 terakhir yang sudah terkonfirmasi (pivot 3). Saat candle H1 pertama kali close menembus level itu → entry di open M15 berikutnya (BUY tembus resistance, SELL tembus support). SL = level ∓ 1,5×ATR(14) H1; dilewati jika risiko > 3×ATR. Opsi `mode: 'retest'` menunggu harga kembali ke level dulu.
Riset 2018–2026 (RR 1:2, $10, biaya termasuk; 12 variasi ditentukan sebelumnya): setelan bawaan 1.610 trade (3,7/minggu), win 33,9%, +$21 (impas), turun terdalam −$768; 2018–22 −0,05R, 2023–26 +0,07R. Belum ada keunggulan yang meyakinkan.

## 5g. Breakout v0.3 (`breakout_v03`) — disarankan

= v0.2 + bagian M30 (Donchian 10, SL 2,5×ATR M30) + SELL hanya jika EMA50(D1) < EMA200(D1). Analisis v0.2 menunjukkan BUY +$1.832 tetapi SELL −$557: breakout ke bawah saat emas dalam tren naik jangka panjang sering gagal.
Dipilih dari 14 variasi yang ditentukan sebelumnya berdasarkan 2018–2022 saja, lalu dicek di 2023–2026 (RR 1:2, $10, biaya termasuk): 2.348 trade (5,3/minggu; 1.911 BUY, 437 SELL), win 37,9%, **+$2.922**, turun terdalam −$613; 2018–22 +0,07R/trade (+$871), 2023–26 +0,18R/trade (+$2.051). Per tahun: 2018 −$73, 2019 +$240, 2020 +$535, 2021 −$259, 2022 +$428, 2023 +$159, 2024 +$568, 2025 +$1.021, 2026 +$303. Hasil adapter website identik dengan riset.

## 5h. Breakout v0.4 (`breakout_v04`) — disarankan

= v0.3 + bagian **level**: swing high/low H1 (pivot 3) yang sudah didatangi lagi 2–3 kali (dalam 0,25×ATR, jarak ≥ 3 candle) lalu pertama kali ditembus close H1 (≤ 120 candle setelah pivot), searah tren. SL = level ∓ 1,5×ATR(14) H1.
Riset awal: tembusan level 1 sentuhan +0,03R/trade, 2 sentuhan +0,16R, 3 sentuhan +0,29R, 4+ sentuhan +0,03R (konsisten di 2018–22 dan 2023–26).
Dipilih dari 6 variasi berdasarkan 2018–2022 (RR 1:2, $10, biaya termasuk): 2.899 trade (6,6/minggu; 2.353 BUY, 546 SELL), win 38,1%, **+$3.749**, turun terdalam −$790; 2018–22 +$1.090 (v0.3: +$871), 2023–26 +$2.659 (v0.3: +$2.051). Per tahun: 2018 −$81, 2019 +$308, 2020 +$584, 2021 −$288, 2022 +$568, 2023 +$232, 2024 +$691, 2025 +$1.305, 2026 +$431.
Alternatif lebih tenang (tidak dipasang): H1 + New York + level = 3,2/minggu, +$2.514, turun terdalam −$335.

## 5i. Breakout v0.5 inti (`breakout_v05`) — disarankan

Tiga bagian terkuat v0.4 (untung per trade tertinggi dan positif di 2018–22 maupun 2023–26): breakout H1 40 candle, range New York, tembus level H1 2–3×; filter tren sama dengan v0.3/v0.4. London (rugi di 2018–22) dan M30 (+0,08R/trade) dibuang.
Hasil 2018–2026 (RR 1:2, $10, biaya termasuk): 1.422 trade (3,2/minggu), win 39,7%, +0,18R/trade, **+$2.514**, turun terdalam **−$335** (v0.4: −$780); untung/turun-terdalam 7,5 (v0.4: 4,8). 2018–22 +$860, 2023–26 +$1.655. Per tahun: 2018 −$45, 2019 +$190, 2020 +$317, 2021 +$32, 2022 +$367, 2023 +$143, 2024 +$373, 2025 +$903, 2026 +$236.
Catatan jujur: v0.5 disusun setelah melihat hasil per bagian di seluruh 2018–2026, jadi uji 2023–2026 bukan lagi uji "buta"; cek ke depan (forward test) tetap perlu.

## 5j. Order Block + FVG (`ob_fvg_v1`)

FVG (high candle 1 < low candle 3 untuk BUY, celah ≥ 0,3×ATR) yang dorongannya menembus swing high terakhir (BOS); order block = candle berlawanan terakhir sebelum dorongan. Entry saat harga M15 pertama kali kembali ke FVG, SL di luar OB + 0,1×ATR, searah tren H4 EMA50/200 + D1 (SELL juga perlu EMA50 D1 < EMA200 D1). Zona dari candle H1 yang sudah tutup.
Riset 2018–2026 (10 variasi ditentukan sebelumnya, RR 1:2, $10, biaya termasuk): setelan bawaan 495 trade (1,1/minggu), win 37,2%, +$495, turun terdalam −$237; 2018–22 +0,02R, 2023–26 +0,19R. Entry di OB, konfirmasi candle, zona M15, atau tanpa filter tren lebih jelek. Masih di bawah Breakout v0.5.

## 5k. Banyak pair (data file bawaan)

Data harga forexsb.com (UTC) untuk XAUUSD, EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, US100 (USATECHIDXUSD), US30 (USA30IDXUSD), BTCUSD dan ETHUSD disimpan sebagai file di `data/market/<SIMBOL>_<TF>.bin.gz` (M15 sejak 2017/2018, kripto sejak 2021; M30 sejak 2010/2013/2017) — **bukan di database**, supaya Supabase gratis tidak penuh. Dibuat ulang dengan `node scripts/pack-market-data.mjs <folder-csv>`.
- Halaman **Hasil → Backtest baru**: pilih strategi, data M15/M30, pair (default semua) dan tahun → dijalankan per pair per tahun (berurutan). Hasil tampil sebagai daftar **Hasil per pair** (untung/rugi semua tahun, trade, win rate); tekan pair untuk grafik, kalender dan trade-nya.
- Tiap dataset muncul sebagai sumber data `file:<SIMBOL>:<TF>`; H1/H4/D1 dibentuk di memori dari M15/M30 (UTC). Entry di open candle berikutnya dari timeframe dasar.
- Biaya per pair (`src/lib/core/instruments.ts`) adalah perkiraan akun ECN, bukan kutipan broker: EURUSD spread 0,5 pip, GBPUSD/USDCHF/USDCAD 0,8 pip, USDJPY 0,6 pip (+0,2 pip slippage, komisi $7/lot); US100 1,5 poin, US30 3 poin; BTC $25, ETH $2. XAUUSD tetap memakai biaya yang bisa diubah.
- Risiko tetap per trade: lot dihitung dari jarak SL; untung/rugi USDJPY/USDCHF/USDCAD dikonversi ke USD dengan harga entry.
- Untuk menghemat database, backtest dari data file tidak menyimpan baris sinyal (market_events); alasan entry tetap ada di trade.

## 5l. Breakout v0.6 (`breakout_v06`) — v0.5 + candle momentum

Sama dengan v0.5 inti, ditambah syarat: candle yang menembus level harus candle momentum, yaitu badan ≥ 1 × ATR14 timeframe-nya (candle H1 untuk breakout H1 dan level; candle dasar untuk New York). Dipilih dari 4 definisi momentum yang ditentukan dulu (bentuk badan, badan ≥ ATR, keduanya, badan ≥ 1,5× rata-rata 20 candle); semuanya memperbaiki v0.5.
Emas, RR 1:2, $10, biaya termasuk: data M30 2010–2026 → 1.705 trade (±2/minggu), win 39,5%, +$2.955 (v0.5: 2.724 trade, 37,4%, +$2.918); 2010–2017 +$1.178 (v0.5 +$589), 2018–2026 +$1.777. Data M15 2018–2026 → 869 trade, win 41,1%, +$1.938 (v0.5 +$2.572).
Di halaman Backtest baru sekarang hanya v0.6 dan v0.5 yang bisa dipilih; strategi lain tetap ada di kode agar hasil lama masih bisa dibuka.

## 5m. Breakout v0.7 (`breakout_v07`) — v0.6 + Pola N

v0.6 tidak diubah sama sekali, lalu ditambah bagian **Pola N** dengan slot sendiri (jadi v0.6 dan Pola N bisa sama-sama punya posisi terbuka; risiko sesekali ±2×).
- **Swing**: zigzag pada candle H1 dan H4 yang sudah tutup. Puncak/lembah jadi swing setelah harga berbalik ≥ 3 × ATR14 timeframe itu. Tanpa hitungan candle, tanpa batas umur pola.
- **BUY**: A lembah, B puncak, C lembah dengan C > A. Pola terlihat saat C terkonfirmasi; sinyal = close M15 pertama di atas B (close sebelumnya ≤ B). Batal jika close M15 di bawah C lebih dulu. **SL = C**, TP = RR × risiko. SELL kebalikannya.
- **Tren**: BUY hanya jika EMA50 H4 > EMA200 H4. SELL hanya jika EMA50 < EMA200 di H4 **dan** D1.

Mesin website, emas, RR 1:2, $10, biaya termasuk: data M15 2018–2026 → 1.025 trade, win 41,3%, +$2.390, drawdown $286 (v0.6: +$1.938, DD $245). Data M30 2010–2026 → 2.018 trade, +$3.473, DD $485; 2010–2017 +$1.276 (v0.6 +$1.178), 2018–2022 +$680, 2023–2026 +$1.516.
Pantulan 3×ATR dipilih karena satu-satunya versi Pola N yang tetap untung di 2010–2017; 1×/1,5×ATR memberi lebih banyak trade tapi rugi di 2010–2017 (riset, tidak dipasang).

## 5n. Breakout v0.8 (`breakout_v08`) — v0.7 + Breakout Base H4/H1

v0.7 tidak diubah, ditambah **Breakout Base** di H4 dan H1 (masing-masing slot sendiri; dengan v0.6 dan Pola N jadi 4 slot → risiko sesekali sampai ±4×).
- **Base** (candle timeframe base yang sudah tutup): ≥ 3 candle berurutan, tiap pasangan berurutan overlap ≥ 50% dari range candle yang lebih kecil (range nol = gagal), tinggi total ≤ 1,5 × ATR14 timeframe itu. Base aktif = rangkaian valid terpanjang yang berakhir di candle terakhir; berlaku sampai ada close yang keluar (satu breakout per base) atau diganti base baru. Candle sampai candle breakout tidak boleh masuk base berikutnya.
- **Entry**: close M15 di atas batas atas (BUY) / di bawah batas bawah (SELL). **SL** = batas seberang ∓ 0,3 × ATR timeframe base. TP = RR × risiko.
- **Tambahan** (hasil riset, dipilih di 2018–2022, dicek di 2023–2026 dan 2010–2017): base H4 hanya breakout jam 07:00–16:59 UTC; base H1 hanya jika harga sudah bergerak ≥ 1 × ATR searah trade dalam 5 candle sebelum base.
- **Tren**: BUY EMA50 H4 > EMA200; SELL EMA50 < EMA200 di H4 dan D1.
- Parameter bisa diubah lewat params: `baseMinN`, `baseOverlap`, `baseMult`, `baseSlAtr`, `baseImpAtr`, `baseH4`, `baseH1`.

Mesin website, emas, RR 1:2, $10, biaya termasuk: data M15 2018–2026 → 1.728 trade (±4/minggu), win 41,2%, +$3.941, drawdown $324 (v0.7 +$2.390). Data M30 2010–2026 → 3.419 trade, +$5.049, DD $703; 2010–2017 +$1.608, 2018–2022 +$1.179, 2023–2026 +$2.262. Aturan base asli tanpa tambahan: base H4 rugi di 2010–2017, base H1/M15 rugi (riset, tidak dipasang).

## 5o. Satu metode per versi (`metode_*`)

Atas permintaan pemilik, tiap metode juga tersedia sebagai strategi sendiri dengan **1 slot** (maksimal satu posisi terbuka). Definisinya di `src/lib/core/strategy/methods-meta.ts`; aturannya sama persis dengan bagian v0.8.
Mesin website, emas, RR 1:2, $10, biaya termasuk — M15 2018–2026 | M30 2010–2017:
| Metode | Trade/minggu | Win | Total 2018–26 | DD | Win / total 2010–17 |
|---|---|---|---|---|---|
| 1 Level H1 diuji 2–3× | 0,6 | 43,7% | +$777 | $105 | 41,9% / +$596 |
| 2 Breakout H1 40 candle | 0,9 | 39,6% | +$681 | $145 | 36,5% / +$294 |
| 3 Range New York | 0,5 | 40,9% | +$480 | $118 | 38,6% / +$288 |
| 4 Breakout Base H4 | 0,5 | 44,7% | +$791 | $132 | 34,6% / +$73 |
| 5 Breakout Base H1 | 1,1 | 39,3% | +$759 | $241 | 36,5% / +$259 |
| 6 Pola N H1/H4 | 0,4 | 43,0% | +$452 | $122 | 35,8% / +$98 |

**Pembersihan website (1 Nov 2026):** menu Backtest dan daftar hasil hanya menampilkan **satu strategi: v1 · Level H1 diuji 2–3×** (= Metode 1, 1 slot), yang terbaik dari 42 strategi yang diuji. Semua strategi lain disembunyikan. Strategi lain tetap ada di kode dan hasil lamanya tetap di database, hanya disembunyikan (`STRAT_ORDER` / `VISIBLE_STRATEGIES` di `analytics/page.tsx`).

## 5p. Data emas tambahan 2004–2026 (M5, M15, M30)

File dari pemilik (`XAU_5m/15m/30m_data.csv`, pemisah `;`) memakai **waktu server broker EET/EEST** (UTC+2 musim dingin, UTC+3 musim panas, ikut jadwal DST Eropa). Diubah ke UTC dengan zona `Europe/Athens`; dicek terhadap data forexsb (UTC) di 8 bulan berbeda, selisih median 0,02–0,2 (beda feed), jadi jam sudah cocok.
- **XAUUSD M15 & M30 = file pemilik sebagai dasar**, lalu (atas permintaan pemilik) lubang data yang benar-benar kosong (> 6 jam di luar akhir pekan, mis. 13 Sep–15 Okt 2025 dan 13–22 Jan 2026) dan periode sesudah 30 Jan 2026 ditambal dari forexsb (jam sudah sama-sama UTC, selisih harga 0,02–0,2). M15: 2.926 candle tambalan di dalam data + 17.786 candle Feb–Okt 2026. Jeda harian dan akhir pekan tidak diisi.
- **XAUUSD M5**: hanya file pemilik (Jun 2004 – 30 Jan 2026); tidak ada sumber M5 lain, jadi lubangnya tetap.
- Acuan **v1** (Metode 1) di M15 2004–Okt 2026, RR 1:2, $10: 694 trade (±0,6/minggu), win 40,3%, +$1.326, drawdown $160, 20 dari 23 tahun untung; 2004–2017 +$632 (39,1%), 2018–2026 +$694 (42,3%).
- File M1 (333 MB) tidak dimasukkan karena terlalu besar untuk server; H1/H4/D1/W/MN tidak perlu karena dibentuk dari data dasar.
Uji buta Metode 1 di M15 2005–2017 (data yang belum pernah dipakai): 398 trade, win 39,7%, +$674 (RR 1:2, $10), 11 dari 13 tahun untung.

## 5q. v2 · Breakout volatilitas (`metode_volbreak`)

Kode: `src/lib/core/strategy/volbreak.ts`. Hari = hari UTC, hanya candle yang sudah tutup.
- Level hari ini: **open hari ini ± 0,5 × range kemarin** (high − low D1 kemarin).
- **BUY**: candle M15 pertama hari itu yang close di atas level atas (close sebelumnya ≤ level), searah tren aturan 1. **SELL** kebalikannya. Satu sinyal per arah per hari.
- **SL** = level ∓ 1 × ATR14 D1. Entry open M15 berikutnya, TP = RR × risiko, 1 posisi. Parameter opsional `volK` (0,5) dan `volSlAtr` (1).
Dipilih dari ±10 ide baru yang masing-masing diuji sekali (tanpa disetel). Mesin website, emas M15 2004–2026, RR 1:2, $10, biaya termasuk: 587 trade (±2,2/bulan), win 41,9%, **+$1.464**, drawdown $144; 2004–2017 +$738 (40,8%), 2018–2026 +$726 (43,4%); 19 dari 22 tahun untung (rugi: 2008 −$22, 2015 −$113, 2021 −$71). Pembanding v1: 692 trade, 40,3%, +$1.317, DD $160.
Temuan riset: masuk searah tren aturan 1 pada jam tetap (13:00 UTC, SL 1×ATR D1) juga memberi ±+$1.700 — sumber untung utama adalah filter tren + SL lebar, pemicu breakout hanya menambah sedikit.
**Pembaruan v2 (1 Nov 2026, versi `volbreak-v2`)**: SL 0,75×ATR D1 (dulu 1×) dan boleh masuk lagi: maksimal 1 entry per arah per blok 4 jam UTC (dulu 1 per hari). Dipilih dari 18 variasi (k 0,25/0,35/0,5 × SL 0,5/0,75/1 × 1/hari atau per 4 jam). Mesin website, M15 2004–2026: 806 trade (±3,0/bulan), win 40,3%, **+$1.608**, drawdown $154; 2004–2017 +$724 (38,9%), 2018–2026 +$885 (42,3%); 18 dari 22 tahun untung. Versi lama `volbreak-v1` diberi status retired (hasil lamanya tetap ada).
Website menampilkan **v1** dan **v2**. **Pilihan "Data" (M5/M15/M30) dihapus dari halaman Backtest**: timeframe mengikuti strategi (konfirmasi close M15, level & tren dari H1/H4/D1), jadi backtest selalu memakai data M15. Data M5/M30 tetap disimpan untuk riset.

**Tanpa batas posisi terbuka (1 Nov 2026, atas permintaan pemilik)**: v1 (`level-v2`) dan v2 (`volbreak-v3`) mengambil setiap sinyal walau masih ada posisi terbuka (tiap sinyal punya slot sendiri). Versi lama (`level-v1`, `volbreak-v1/v2`) retired, hasil lamanya tetap ada. Mesin website, M15 2004–2026, RR 1:2, $10:
- v1: 941 trade (±3,5/bulan), win 40,0%, +$1.685, drawdown $229, maks 4 posisi bersamaan; 2004–2017 +$622, 2018–2026 +$1.064.
- v2: 2.723 trade (±10/bulan), win 40,0%, +$5.182, drawdown $615, **maks 15 posisi bersamaan**; 2004–2017 +$1.451, 2018–2026 +$3.731.

**Biaya emas = kemungkinan terburuk (1 Nov 2026, atas permintaan pemilik)**: default backtest XAUUSD sekarang spread **0,50**, slippage **0,30** per eksekusi (entry & SL), komisi **$10/lot** pulang-pergi (dulu 0,30 / 0,10 / $7). Hasil v1/v2 tanpa batas posisi, M15 2004–2026, RR 1:2, $10: v1 941 trade, win 38,6%, +$1.102 (2004–17 +$178, 2018–26 +$924); v2 2.722 trade, win 39,2%, +$4.188 (2004–17 +$964, 2018–26 +$3.223).
**Swap (biaya inap) belum dihitung** mesin backtest. Perkiraan dampak (posisi v1 rata-rata 1,9 malam, v2 3,6 malam; Rabu 3×): swap −$20/lot/malam → v1 +$707, v2 +$2.682; −$40 → v1 +$311, v2 +$1.177; −$60 → v1 −$85, v2 −$329 (2004–2017 rugi mulai −$20). Pakai akun bebas swap atau periksa swap broker.

## 6. Keamanan
- Login admin **nonaktif secara default** atas pilihan pemilik: siapa pun yang tahu URL dapat membuka dashboard dan mengubah pengaturan. Aktifkan dengan env `REQUIRE_LOGIN=true` + `ADMIN_PASSWORD` + `SESSION_SECRET` (cookie HttpOnly bertanda tangan HMAC). Webhook TradingView selalu diautentikasi secret; token Telegram tidak pernah dikirim ke browser.
- RLS aktif di 20 tabel tanpa policy untuk `anon`/`authenticated`; aplikasi hanya terhubung dari server.
- Tidak ada auto-trading, tidak ada koneksi broker, tidak menyimpan password TradingView.
- Token tidak pernah ditulis ke log (disamarkan `[TOKEN]`).

---

## 7. Tes
```bash
npm test          # 15 unit test logika inti
npm run test:e2e  # 10 skenario end-to-end terhadap PostgreSQL sungguhan (butuh psql + server Postgres lokal;
                  # set PGHOST/PGPORT/PGUSER). Telegram HTTP diganti stub perekam.
```
Hasil lengkap: `TEST_RESULTS.md`. Semua fixture uji bertanda TEST dan memakai tanggal sintetis tahun 2030 agar tidak tertukar dengan data pasar nyata.

## 5r. Persiapan live trade (1 Nov 2026)

- **Menu Trade** (menggantikan Replay di menu bawah; Replay masih ada di tautan bawah Beranda):
  - **Rencana risiko**: modal + risiko % per trade, disimpan di server (`app_settings.live_risk`). Dipakai untuk lot di sinyal Telegram.
  - **Kalkulator lot**: entry + SL → lot (dibulatkan ke bawah ke 0,01 supaya risiko tidak lewat rencana), risiko sebenarnya, TP 1:2.
  - **Sinyal live**: event LIVE dari TradingView yang membawa `extra.side/sl/tp`.
  - **Jurnal**: trade manual pemilik (`app_settings.live_journal`, maks 3000). Tutup dengan TP / SL / impas / harga manual. Ringkasan win rate & rata-rata R per metode, dibandingkan dengan win rate backtest (v1 40,6%, v2 40,4%, biaya rata-rata broker + swap).
- **Indikator TradingView** `public/pine/xau_v1.pine` (chart H1) dan `xau_v2.pine` (chart M15): aturan sama dengan backtest. Logika dicek ulang di Python terhadap trade website 2024–2025: v1 101/101 sinyal sama; v2 325/326 sama (5 sinyal tambahan di candle terakhir sebelum jeda pasar, yang dilewati backtest karena entry > 1 jam). Di TradingView, H4/D1 memakai candle broker (jam tutup bisa beda dari UTC), jadi sesekali beda.
- Alert `alert()`: teks biasa (notifikasi HP, paket gratis) atau JSON untuk webhook website (`extra: {side, sl, tp}`); pesan Telegram LIVE lalu berisi entry ≈ close, SL, TP, RR dan lot dari rencana risiko. Tidak ada order otomatis.
- Beranda: ringkasan jurnal bulan ini, sinyal live terakhir, koneksi, berita.

## 5s. v2 versi volbreak-v4 (1 Nov 2026)

Dua perubahan atas permintaan pemilik (trade harus selesai di TP atau SL, sebaiknya dalam sehari):
1. **Hari Senin memakai range Jumat.** Sebelumnya "kemarin" untuk Senin adalah sesi Minggu (±1–2 jam, range rata-rata 0,27 × ATR D1 vs 1,12 di hari biasa), sehingga level terlalu dekat dengan open: 34% trade v2 terjadi hari Senin dengan hasil hampir nol.
2. **SL = level ∓ 0,35 × ATR14 D1** (dulu 0,75). TP tetap 2 × jarak SL, tanpa penutupan paksa.

Mesin website, 2004–2026, biaya rata-rata broker (spread 0,12, slippage 0,10, komisi $5) + swap BUY −$67 / SELL +$25, risiko $10:
| | trade/bulan | win | total | PF | DD | selesai < 24 jam | 2004–17 | 2018–26 |
|---|---|---|---|---|---|---|---|---|
| volbreak-v3 | 10,1 | 40,4% | +$1.976 | 1,11 | $1.319 | 29% | −$736 | +$2.712 |
| **volbreak-v4** | 8,0 | 39,5% | **+$1.899** | 1,13 | **$562** | **70%** (median 13,5 jam) | **+$385** | +$1.514 |

Diuji juga dan ditolak: aturan 1 yang disederhanakan (semua varian lebih banyak trade tapi untung turun; tanpa D1 hanya menambah SELL dengan win 31,8%), UT Bot sebagai tren, penutupan sebelum rollover (bertentangan dengan aturan TP/SL). volbreak-v3 dipensiunkan; hasil lamanya tetap di database tetapi disembunyikan.

## 5t. Kalkulator risiko modal & lot (menu Trade, 1 Nov 2026)

Seperti contoh website di video pemilik: isi modal (USD atau cent), lalu risiko % per trade atau lot tetap, pilih v1 / v2 / v1+v2.
Statistik diambil dari `src/lib/core/risk-stats.ts` (backtest mesin website 2004–2026, biaya rata-rata broker + swap; semua dalam R).
Keluaran: drawdown historis terburuk dalam $ dan % modal (ideal ≤ 40%), risiko/lot/modal ideal, posisi terbuka maks, perkiraan hasil per bulan/tahun,
bulan & 12 bulan terburuk, dan tabel rugi beruntun. Mode lot memakai jarak SL median strategi (perkiraan). Perbarui `risk-stats.ts` kalau strategi berubah.

## 5u. EA MetaTrader 5 untuk v2 (1 Nov 2026)

Atas permintaan pemilik: order otomatis dijalankan oleh **EA di MetaTrader 5 milik pemilik** (PC/VPS), bukan oleh website.
- `public/ea/XAU_v2_EA_v114.mq5` (dulu `XAU_v2_EA.mq5`; nama file memuat versi sejak v1.14): aturan volbreak-v4 persis (hari UTC, Senin pakai range Jumat, aturan 1 dengan H4/D1 dibentuk dari H1 dalam jam UTC, EMA dengan jendela 1000, ATR D1 Wilder 400, SL 0,35 ATR D1, TP 2R dari harga isi, maks 1 entry per arah per blok 4 jam — dicek juga dari posisi & riwayat supaya aman saat restart). Lot dari risiko % equity, dibulatkan ke bawah; lewati kalau di bawah lot minimum atau spread > batas.
- EA melaporkan entry & penutupan ke `POST /api/ea/report` (WebRequest). Auth: kunci EA dari Atur → EA (hanya SHA-256 yang disimpan). Laporan ditulis ke jurnal (`ea-<ticket>`, strategi v2, hasil bersih broker termasuk komisi & swap) dan dikirim ke Telegram jika "Kirim sinyal live" aktif. Duplikat diabaikan.
- EA belum pernah dijalankan di MetaTrader dari lingkungan ini: wajib uji di akun demo.

## 5w. EA MetaTrader 5 untuk v1 NAS (7 Nov 2026)

- `public/ea/NAS_v1_EA_v100.mq5`, untuk USTEC (Exness), chart timeframe apa saja. Aturan nas-donchian-v1 persis (bagian 6b): close H1 menembus high/low 20 candle H1 sebelumnya, aturan 1 dengan H4 & D1 dibentuk dari H1 dalam jam UTC (D1 hanya Senin–Jumat), breakout searah-tren yang sama 1–2 candle H1 sebelumnya (dihitung ulang dari riwayat, jadi aman saat restart), jam entry 10:00–16:00 New York (DST otomatis), SL close ∓ 0,2 ATR14 D1, TP 2R dari harga isi, tanpa BE, tanpa batas posisi. Penanda per candle di GlobalVariables mencegah entry ganda setelah restart.
- Laporan memakai kunci EA yang sama dengan `"strategy":"nas"`: jurnal menyimpan strategi `nas`, Telegram "EA v1 NAS", dan label impas (BE) hanya untuk v1 XAU.
- Lot minimum USTEC 0,05: risiko kecil (mis. 0,5% dari $1.000 ≈ $5 vs SL ±92 poin × 0,05 = $4,6) ada di batas — entry dilewati jika lot < minimum.
- Belum pernah dijalankan di MetaTrader dari lingkungan ini: wajib uji di Strategy Tester & akun demo.

## 5v. Sinyal live v2 gratis tanpa TradingView (1 Nov 2026)

TradingView webhook butuh paket Essential (±Rp 400 rb/bulan; paket gratis bahkan tidak punya alert indikator). Pengganti gratis:
- Jadwal luar (cron-job.org, gratis) memanggil `GET /api/live/tick?key=<kunci jadwal>` tiap 15 menit. Kunci dibuat di Atur → Sinyal otomatis (hanya hash yang disimpan).
- Website mengambil XAU/USD dari Twelve Data (API key gratis; env `TWELVEDATA_API_KEY` atau disimpan di Atur): M15 (400), H1 (5000 → H4 UTC) dan D1 (1100), lalu menjalankan **adapter v2 yang sama dengan backtest** atas candle M15 hari ini; sinyal pada candle tertutup terakhir → event LIVE (dedupe) + Telegram dengan entry ≈ close, SL, TP 1:2, lot dari rencana risiko, tombol salin. 3 panggilan API per 15 menit (±288/hari, batas gratis 800).
- Harga Twelve Data bisa sedikit berbeda dari broker. Tidak ada order ke broker.

## 5w. v3 · BOS H1 (`metode_bos_h1`, versi `bos-h1-v1`) — dipasang di website 2 Nov 2026
Status: **ada di mesin backtest website** (menu Backtest), jurnal (pilihan v3) dan kalkulator risiko. Belum ada Pine/TradingView, sinyal live, Telegram otomatis, atau EA. Adapter: `src/lib/core/strategy/bosh1.ts`.

Mesin website (2004–2026, biaya rata-rata + swap, $10/trade): 1.073 trade · 4,1/bln · win 40,4% · **+$1.432** · DD 25R ($250) · 2004–17 +$527 · 2018–26 +$905 · median hold 14,8 jam, 63% < 24 jam. Skrip riset Python (`scripts/research/v3_bos_h1.py`) memberi +$1.289 untuk aturan yang sama (beda kecil: ATR & batas tahun).

Aturan (RR 1:2 tetap, keluar hanya di TP atau SL, tanpa batas posisi):
- Swing H1: pivot 3 candle kiri & kanan, dipakai setelah terkonfirmasi; urutan swing selang-seling (high/low).
- **BUY:** swing low A → swing high B → swing low C dengan **C > A** (higher low). Entry saat **close M15 menembus di atas B** (candle sebelumnya ≤ B). SL = **C − 0,1 × ATR14 H1**. TP = 2R. Satu trade per level B.
- **SELL:** kebalikannya — swing high A → low B → high C dengan **C < A**, close M15 di bawah B, SL = C + 0,1 ATR.
- Filter **aturan 1**: BUY hanya jika H4 close > EMA50 > EMA200 dan D1 close > EMA50; SELL kebalikannya + D1 EMA50 < EMA200.

Hasil 2004–2026 (spread 0,12 · slippage 0,10 · komisi $5 · swap 67/−25, risiko $10/trade):
4,1 trade/bln · win 40,3% · **+$1.289** · PF 1,18 · DD $250 · 2004–17 +$400 (PF 1,10) · 2018–26 +$889 (PF 1,31) · median hold 14,6 jam, 63% < 24 jam.
Tanpa aturan 1: −$566. H4 dan M15: rugi. 25 variasi (panjang swing, buffer SL, close H1, kesegaran, batas SL, sesi, ukuran candle, SL tetap ATR) tidak ada yang jelas lebih baik di 2004–2017 → aturan dasar dipertahankan.

## 5x. Perbaikan dari bedah SL (2 Nov 2026): v2 → `volbreak-v5`, v1 → `level-v3`, v3 tetap
Bedah semua trade yang kena SL (lihat percakapan 2 Nov): ±30% tembusan palsu (tidak pernah +0,25R), ±25% sempat +1R lalu balik ke SL.
Filter hanya dipakai kalau PF naik di 2004–17 **dan** 2018–26. Hari Rabu & jam New York ditolak (tidak konsisten / memotong terlalu banyak trade).

- **v2 `volbreak-v5`**: (1) badan candle sinyal ≥ 0,5×ATR14 M15, (2) sinyal ke-2 searah di hari UTC yang sama dilewati (ke-3 boleh; dihitung sebelum aturan candle), (3) **breakeven**: setelah +1R SL digeser ke harga entry (`details.breakeven_r = 1`; simulator: aktif mulai candle berikutnya, keluar di entry ditandai `costs.breakeven = true`, `exit_reason` tetap `sl` karena constraint DB). Param: `volMinBody`, `volBe`, `volDayRule` (`skip2`/`max1`/`off`).
  Mesin website 2004–2026 (biaya rata-rata + swap, $10/trade): 1.302 trade · 5,0/bln · +$2.239 · DD 15,9R ($159) · 2004–17 +$1.281 · 2018–26 +$957 · ±15% trade keluar impas. (v4: +$1.899, DD $562.) Varian `max1` (+$2.036) lebih jelek.
- **v1 `level-v3`**: sinyal ke-2 searah di hari UTC yang sama dilewati. 833 trade · 3,1/bln · +$950 · DD 30,2R · 2004–17 +$142 · 2018–26 +$808. (v2: +$944, DD 42,5R.)
- **v3 `bos-h1-v1`**: tidak diubah (filter & breakeven tidak memperbaiki di kedua periode).
- Ikut diperbarui: Pine `xau_v1.pine` / `xau_v2.pine`, EA `XAU_v2_EA.mq5` (v1.10: aturan v5 + geser SL ke entry setelah +1R; penanda hari/blok di Global Variables terminal), sinyal live Twelve Data & Telegram (baris "Breakeven: bila harga mencapai X geser SL ke entry"), jurnal EA (tutup di harga entry dicatat **BE**), kalkulator risiko (`RISK_STATS` baru + kombinasi v1+v2+v3).
- Gabungan v1 + v2 + v3 ($10/trade): 3.208 trade · 12/bln · +$4.621 · DD 40,2R.

## 5y. Biaya akun pemilik: Exness Raw Spread (2 Nov 2026)
`src/lib/core/broker.ts` = default website: komisi $3,50/lot/arah ($7 pulang-pergi), swap BUY −474,7 point = $47,47/lot/malam, SELL 0 (Rabu ×3), jam server = UTC, level stop 0, lot 0,01. Spread tetap 0,12 sampai diukur.
Dipakai di: form Backtest (nilai lama default 5 / 67 / −25 yang tersimpan di browser diganti otomatis; tombol "Pakai biaya Exness"), biaya default server & instrumen XAUUSD, P/L jurnal trade manual (dikurangi komisi + swap; trade dari EA tetap memakai profit asli broker), kalkulator risiko (`RISK_STATS` dihitung ulang), EA v1.13 (`InpTesterUtcOffset` default 0 untuk Exness); v1.14 (6 Nov 2026) mempercepat Strategy Tester: nilai D1 dihitung sekali per hari UTC dan tren H4 hanya saat close M15 menembus level (sinyal tidak berubah).
Mesin website dengan biaya ini (2004–2026, $10/trade): v1 +$1.123 · v2 +$2.375 (PF 1,38, DD 15,3R) · v3 +$1.523 · gabungan +$5.021 (DD 33,2R).

## 5z. Strategi untuk pair lain + nama singkat (3 Nov 2026)
Studi semua strategi di 10 pair (2017/2018–2026, biaya bawaan tiap pair): pair terbaik di luar emas = **US100** dan **USDJPY**.
- Baru (`src/lib/core/strategy/pairs.ts`): **Trendline H4** (`metode_trendline_h4`, paling cocok US100: mesin website 2017–2026 +53,8R, 122 trade; data M30 2013–2026 PF 1,68; trade berhari-hari, hampir semua BUY) dan **Asia → London** (`metode_asia_london`, paling cocok USDJPY: +35,2R, 419 trade).
- Ditampilkan lagi di menu Backtest: Base H1, Base H4 (USDJPY +36,4R), Donchian H1 (US100 +90,3R, tapi 2022+ impas), Range NY (US100 +28,1R, USDCAD +28,9R).
- Nama singkat: v1 Level · v2 Volatilitas · v3 BOS · Base H1 · Base H4 · Donchian H1 · Range NY · Trendline H4 · Asia → London · Pola N.
- Biaya backtest: isian biaya di form (akun Exness emas) hanya untuk XAUUSD; pair lain memakai perkiraan biayanya sendiri (`instruments.ts`), tanpa swap.

## 6a. Website disederhanakan: hanya "v1 XAU" (7 Nov 2026)
- Pilihan pemilik: emas hanya memakai satu strategi terbaik, **v1 XAU** = `metode volbreak-v5` (dulu "v2 Volatilitas"). Aturan tidak berubah.
- Uji ketahanan (16 variasi level 0,3–0,7, SL 0,25–0,6 ATR D1, badan 0–0,7, BE mati/0,75/1,5R, aturan sinyal ke-2): setelan sekarang paling efisien (profit/DD 0,69); hampir semua variasi tetap untung di 2004–2017 dan 2018–2026.
- Menu Backtest, Trade (jurnal, performa), kalkulator risiko, Telegram, sinyal Twelve Data, Pine dan EA memakai nama v1 XAU. Kunci internal tetap `v2` (jurnal lama, laporan EA, data backtest tidak berubah).
- Strategi lain (v1 Level, v3 BOS, Base, Donchian, Range NY, Trendline H4, Asia → London, Pola N) tetap di kode dan hasilnya tetap di database, hanya disembunyikan. Pair lain akan diberi strategi terbaiknya sendiri.

## 6b. v1 NAS — Donchian H1 20 untuk Nasdaq (US100), 7 Nov 2026
- **Aturan:** close H1 menembus high (BUY) / low (SELL) 20 candle H1 sebelumnya · aturan 1 (H4 & D1) · **breakout lanjutan**: breakout searah (yang lolos tren) sebelumnya paling lama 2 candle H1 sebelumnya · entry hanya **10:00–16:00 waktu New York** (sesi bursa AS, DST otomatis) · SL close ∓ 0,2×ATR14 D1 (hari kerja), TP 1:2, tanpa BE, tanpa batas posisi. Kode: `src/lib/core/strategy/nas.ts` (`metode nas-donchian-v1`).
- **Riset** (M30 2013–2026, biaya USTEC Exness, spread 2): 5,6 trade/bulan, win 46%, PF 1,52, +20R/tahun, DD 15R, rugi beruntun 14, 1 tahun rugi (2016 −0,4R). Dasar Donchian H1 20 tanpa filter: PF 1,13, DD 58R. Filter jam NY dan breakout lanjutan kokoh: Donchian 10–40, SL 0,15–0,3 ATR, jendela 1–4 jam, spread 4 poin → PF 1,34–1,57; data M15 terpisah 2017–2026 PF 1,50 tanpa tahun rugi.
- **Validasi adapter website** (data M15 2017–2026): sinyal sama persis dengan riset (583/583 setelah pemanasan 210 candle D1). Dengan biaya instrumen website (spread tetap 1,5 + slippage 0,5 + komisi 0,626 poin, lebih berat di tahun harga rendah) PF 1,34, 5,9 trade/bulan, DD 16,5R.
- **Biaya US100** (`instruments.ts`) = spesifikasi USTEC akun pemilik: komisi 0,313 USD/lot/sisi, swap BUY 619,3 point (≈ 0,0218% harga per malam, `swapLongPct`), SELL 0, Jumat 3× (`swapTripleDay` 5). `tradesim` mendukung swap persentase harga dan hari triple per instrumen.
- Form backtest otomatis memilih pair milik strategi (v1 XAU → XAUUSD, v1 NAS → US100).
- v1 NAS memakai data dasar **M30** di website (mulai Mei 2013; trade pertama ±2014 setelah pemanasan 210 candle D1). Validasi adapter di M30 2013–2026 dengan biaya website: 5,6 trade/bulan (sama dengan riset), PF 1,29 (2013–2019 PF 1,18, 2020–2026 PF 1,37), DD 26R; per tahun 2014 +7R, 2015 +1, 2016 −15, 2017 +4, 2018 +42, 2019 +1, 2020 +21, 2021 +12, 2022 +23, 2023 +4, 2024 +21, 2025 +18, 2026 +14. Lebih rendah dari riset (PF 1,52) karena website memakai spread/slippage/komisi tetap dalam poin (2,6 poin total) — berat saat harga US100 masih 3.000–6.000 (2013–2017); riset memakai biaya proporsional terhadap harga.

## 6c. v1 BTC — Binance Futures BTC/ETH (7 Nov 2026)

Pemilik ingin fokus ke Binance Futures. Semua strategi chat (60+ per koin) dan pencarian khusus kripto (±2.000 kombinasi: Donchian H1/H4/D1,
breakout volatilitas, RSI2, high/low kemarin × filter tren × arah × jam UTC × SL 0,25–1 ATR D1) diuji di BTC dan ETH dengan biaya Binance.
Syarat lolos: PF ≥ 1,15 di BTC **dan** ETH dan PF ≥ 1,05 di kedua paruh data. Keluarga yang lolos konsisten: breakout H4 BUY dengan SL lebar.
- Aturan (`metode crypto-donchian-v1`, adapter `src/lib/core/strategy/crypto.ts`): BUY saat close H4 pertama di atas high 50 candle H4
  sebelumnya, close D1 terakhir > EMA200 D1, SL = close − 1×ATR14 D1, TP 1:2, tanpa SELL, tanpa batas posisi. Basis M30.
- Dataran stabil: Donchian 20–80 × SL 0,75–1,5 ATR semuanya PF 1,3–1,8 di kedua koin. SELL rugi di semua varian.
- Mesin website (biaya Binance: `commissionPct` 0,12% pulang-pergi, funding BUY 0,03%/hari 7 hari): BTC Feb 2018–Okt 2026 308 trade
  (3,0/bln) win 41% PF 1,28 DD 17,8R; ETH 2019–2026 273 trade win 45% PF 1,55 DD 17,9R. Hold median ±2,5 hari (hanya ±25% selesai < 1 hari).
- Profit terkumpul di tahun bull (2019–2021, 2024); 2022 (crash) −2/−3R; 2025–2026 ±impas. BTC dan ETH berkorelasi tinggi → bagi risiko.
- Forex major: tidak ada konfigurasi yang lolos di ≥ 3 dari 5 pair; hanya USDJPY BUY (profit dari tahun yen melemah) — tidak dipakai.


## 6d. v1 ALT — SELL di koin cepat & ramai, Binance Futures (7 Nov 2026)

Pemilik ingin satu strategi untuk banyak koin, dengan filter koin "cepat & banyak trader" dulu. Data: 1h `data.binance.vision`
untuk 448 koin USDT-M (termasuk delisting; daftar disusun manual karena fapi.binance.com menolak lokasi ini → koin baru bisa terlewat).
- Filter harian (titik waktu, tanpa data masa depan): volume rata-rata 30 hari ≥ $100 jt/hari dan ATR14 D1 % ≥ median koin-koin itu (±21 koin/hari).
- Di koin itu semua BUY rugi (PF 0,7–0,86 hampir tiap tahun). Terbaik: breakout volatilitas SELL — close 1h < open hari UTC − 0,5 × range kemarin
  (sekali per hari per koin), SL level + 0,35 ATR14 D1, TP 2R. Portofolio maks 3 posisi, 1 per koin: 2.495 trade (30,6/bln) win 39% PF 1,23,
  +4,4R/bln, DD 37R, rugi beruntun 26, untung setiap tahun 2020–2026, hold median 24 jam. Maks 5/10 posisi: PF 1,21/1,16, DD 70/99R.
- Hasil riset (bukan mesin website; strategi multi-koin tidak bisa dijalankan dari file per-pair) → ringkasan tetap di
  `src/lib/core/alt-result.json`, tampil di halaman Backtest (`AltResult`) dan kalkulator risiko (mode % saja). Belum dibedah.

- 7 Nov 2026 (lanjutan): Forex dan Crypto dipisah di website (`src/lib/core/markets.ts`, tombol Forex (MT5) | Crypto (Binance)).
  87 koin Binance dengan volume ≥ $20 jt/hari (cepat & lambat) dibundel sebagai data 30m (`data/market/<KOIN>USDT_M30.bin.gz`, sumber
  data.binance.vision) dengan biaya Binance. v1 ALT kini juga adapter per pair (`metode alt-volbreak-v1`, `strategy/alt.ts`) dengan filter
  koin harian dari `alt-fast-days.json` (dihitung titik-waktu s/d 6 Nov 2026; `params.altAll` mematikannya). Per pair tanpa batas 3 posisi
  hasilnya lebih lemah dari portofolio riset (contoh: ENA PF 1,15, WLD 1,09, PEPE 1,06, NEAR 1,00, SUI 0,98).


## 6e. v2 ALT — breakdown dalam SELL untuk semua koin likuid (7 Nov 2026)

Bedah lanjutan di semua koin Binance yang likuid pada saat sinyal (volume 30 hari ≥ $20 jt/hari, 440 koin, 1h 2020 – 6 Nov 2026,
fee+slippage 0,12%): grid breakout volatilitas (level 0,3–2,0 × range kemarin, SL 0,2–0,75 ATR) × pump-fade/dump-bounce × tren × jam × volatilitas.
- BUY tetap rugi hampir di semua varian. SELL makin kuat makin dalam levelnya (dataran kv 1,0–2,0 positif).
- Dipilih `metode alt-breakdown-v1` (adapter `strategy/alt2.ts`): SELL saat close H1 < open hari UTC − 1,5 × range kemarin, close D1 < EMA50 D1,
  SL level + 0,35 ATR14 D1, TP 2R, sekali per hari per koin; hanya hari koin likuid (`alt-liquid-days.json`).
- Riset: gabungan PF 1,26 (7.405 trade, 418 koin, 77% koin PF > 1); biaya ×2 PF 1,21; short bayar funding 0,03%/hari PF 1,24.
  Portofolio maks 3 posisi, 1 per koin: 17,8 trade/bln, win 47%, PF 1,68, DD 35×, untung tiap tahun. Profit terkumpul di bulan crash
  (Okt 2025 +141R, Jan 2026 +74R); tanpa 5 bulan terbaik tetap PF 1,26.
- Mesin website (6 koin contoh): PF 1,33 vs riset 1,26 untuk koin yang sama. v1 ALT disembunyikan (tetap di kode).


## 6f. v1 SNR — support jebol SELL untuk altcoin (7 Nov 2026)

SNR, Pola N dan base breakout diuji di 440 koin likuid (BUY semua rugi; SNR pantul rugi). SNR tembus SELL dibedah: TF H2/H4/H8 × pivot 2/3/5 ×
10 atau 3 level × SL 0,25–1,0 ATR × tren × jam; diuji sebagai portofolio maks 3 posisi (1 per koin).
- Dipilih `metode snr-sell-v1` (`strategy/snrsell.ts`): support = low H4 terendah 5 candle kiri-kanan, 10 terakhir; SELL saat close H4 < support
  (candle sebelumnya ≥), close D1 < EMA50 D1, koin likuid (≥ $20 jt/hari, `alt-liquid-days.json`); SL support + 0,5 ATR14 H4; TP 2R.
- Riset portofolio maks 3: 4.328 trade (±54/bln) win 43% PF 1,41, +$10.689 (risiko $10), DD 41×, untung tiap tahun, hold median 8 jam;
  biaya ×2 PF 1,32; short bayar funding PF 1,40; tanpa 5 bulan terbaik PF 1,23. Per koin: 270 dari 393 untung (69%); BTC rugi.
- Atas permintaan pemilik: pair default = 114 koin website yang untung di riset (cherry-picking: hasil koin pilihan ke depan bisa lebih lemah);
  54 koin untung yang masih aktif (≥ $5 jt/hari) ditambahkan sebagai data 30m. Koin lain tetap ada.
- Mesin website (6 koin contoh): PF 1,13 vs riset 1,22 (riset membuka trade untuk tiap support yang jebol di candle yang sama; website 1).

- Koreksi (7 Nov 2026): hasil portofolio bergantung pada koin mana yang diambil saat banyak sinyal muncul bersamaan. Dengan urutan acak
  (25 kali): v1 SNR maks 3 → PF 1,32–1,39 (median 1,34), total $8,0–9,9 rb (risiko $10), DD 45–81× (median 51×), tidak ada tahun rugi;
  maks 2 → PF 1,36, DD 39×. v2 ALT maks 3 → PF 1,64–1,74, DD 33–43×. Kalkulator risiko memakai run dengan total median.
- Funding rate (data.binance.vision, semua koin): SELL tembus low 24 jam makin bagus saat funding > 0,01% (PF 1,7–1,9 vs 0,76 saat negatif),
  tapi sebagai portofolio maks 3 hanya PF 1,13 (untung dari kejadian likuidasi massal). Filter/prioritas funding tidak memperbaiki v1 SNR.

- Pair default v1 SNR (7 Nov 2026, permintaan pemilik) = 26 koin terbaik: ≥ 100 trade, PF ≥ 1,25, PF ≥ 1,1 di 2020–23 dan 2024–26
  (12 koin ditambahkan sebagai data 30m). Portofolio maks 3 (urutan acak): PF 1,40, +$5,4 rb, DD 33× vs semua koin PF 1,31, +$8,5 rb, DD 74×.
  Dipilih dengan seluruh data → ke depan kemungkinan lebih lemah. Bedah lanjutan (retest, sentuhan, umur support, body, volume, turun 7 hari,
  breadth) tidak memperbaiki portofolio; retest rugi (PF 0,99).


## 6g. Bot Binance v1 SNR (8 Nov 2026)

`public/bot/snr_bot.py` (Python 3, hanya butuh `requests`), dijalankan di PC/VPS pemilik; kunci API tetap di `snr_bot_config.json` di mesin itu.
- Aturan sama dengan `metode snr-sell-v1`; logika sinyal dicek pada data historis: SAND 281/281, FIL 363/364, ARB 219/219 sinyal riset ditemukan.
- Setiap H4 tutup (+20 detik): koin dengan volume 30 hari ≥ $20 jt dan close D1 < EMA50 diperiksa; sinyal → MARKET SELL, lalu SL/TP sebagai
  algo order (`POST /fapi/v1/algoOrder`, STOP_MARKET & TAKE_PROFIT_MARKET, closePosition, CONTRACT_PRICE). SL gagal dipasang → posisi langsung ditutup.
- Maks posisi (default 3), 1 per koin, sinyal bersamaan diacak. Jumlah koin = risiko / (SL − harga), dibulatkan ke bawah ke stepSize.
- Default `testnet: true` (demo-fapi.binance.com) dan `dry_run: true`. Koin: "default" (26 koin terbaik), "all" (semua USDT likuid) atau daftar.
- Laporan buka/tutup ke `/api/ea/report` dengan `"strategy":"snr"` dan `symbol` (jurnal strategi snr, Telegram "Bot v1 SNR <KOIN>"),
  hasil bersih = realizedPnl − komisi + funding dari Binance.
- Belum pernah dijalankan ke Binance dari lingkungan ini (fapi.binance.com menolak lokasi ini): wajib uji di testnet.

- Tambahan (8 Nov 2026): margin Isolated per posisi (`margin_isolated`), rem saldo (`stop_balance_usdt`), ringkasan (08:00 & 23:00 waktu Korea, `summary_hours_kst`) & peringatan ke
  Telegram lewat `/api/ea/report` event `info` (tanpa baris jurnal), satu instance saja (port lokal 47219), autostart Windows:
  `--install` (Task Scheduler "SNR Bot", saat VPS menyala, akun SYSTEM, `start_bot.bat` mengulang bila error), `--status`, `--stop`, `--uninstall`.
- Rem kalah beruntun (8 Nov 2026, `max_loss_streak`, bawaan 7, 0 = mati): setelah 7 SL berturut-turut (TP me-reset, tutup manual tidak dihitung) bot tidak membuka posisi baru; posisi terbuka tetap jalan. Lanjut lagi: `python snr_bot.py --reset`. Catatan riset: 7 kalah beruntun terjadi ±1× per 1–2 bulan di backtest 25 koin, jadi rem ini sering aktif.

## 6h. EA prop firm: v1 XAU + v1 NAS dalam satu EA (8 Nov 2026)
- File `public/ea/PROP_XAU_NAS_EA_v100.mq5` (unduh di Atur → EA). Satu chart, simbol emas (`InpXauSymbol`, default XAUUSD) dan Nasdaq (`InpNasSymbol`, default NAS100 = FundingPips).
  Logika sinyal disalin persis dari `XAU_v2_EA_v114` dan `NAS_v1_EA_v100`, magic number sama (laporan jurnal tetap v1 XAU / v1 NAS).
- Risiko = `InpRiskPercent` % dari `InpAccountSize` (ukuran akun awal). Penjaga prop firm: target (`InpTargetPct`, tutup semua & berhenti), rugi harian
  (dari saldo/equity tertinggi saat hari server mulai) dan rugi total, masing-masing berhenti `InpBufferPct` sebelum batas; sebelum entry lot dikecilkan bila
  rugi terburuk (semua posisi kena SL + trade baru) bisa melewati batas, atau bila margin (leverage kecil) tidak cukup. Filter berita USD dampak tinggi
  (`InpNewsMinutes`, kalender MT5; untuk akun funded FundingPips). Hari trading dihitung saat target tercapai.
- Riset prop firm (aturan 8%/5%, harian 5%, total 10%, XAU+NAS 2014–2026): risiko 2% → lulus 2 fase sekali beli ±41%, ±1 bulan bila lulus;
  1% → ±51%, ±3 bulan; 0,5% → ±99%, ±1 tahun. Funded risiko 0,5%: ±0,94%/bulan dengan posisi ditutup tiap Jumat (aturan akun Master FundingPips),
  12 bulan tidak pernah kena batas. Crypto (BTC/ETH) untuk prop firm: tidak ada strategi yang lolos (147 kombinasi, hanya hari kerja, tutup Jumat).
- Perbaikan bot (9 Nov 2026): posisi baru dianggap tutup hanya bila ada transaksi BUY penutup (qty penuh) di riwayat trade. Sebelumnya jawaban
  daftar posisi yang kosong/terpotong membuat bot mengira WLD sudah tutup ("Ditutup manual", harga keluar = harga masuk) dan membatalkan SL/TP
  posisi yang masih terbuka. Sekarang SL/TP tidak disentuh, dan bila posisi tidak terlihat tanpa transaksi penutup bot mengirim peringatan.

