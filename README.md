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
