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
