# Hasil Pengujian — 31 Oktober 2026

## Lingkungan
- Node.js 22, PostgreSQL 16 lokal (server sungguhan), migrasi `20261031000000_init.sql` diterapkan ke database baru setiap run.
- Lapisan database diuji melalui SQL yang sama dengan produksi (dieksekusi via `psql` karena registry npm diblokir di lingkungan uji; produksi memakai driver `pg`).
- Telegram HTTP diganti stub perekam (tidak ada akses jaringan ke api.telegram.org dari lingkungan uji).
- Semua data uji sintetis, bertanda TEST, bertanggal 2030.

## Ringkasan: 25 / 25 lulus

```
ok 1 - time: New York DST offsets are correct
ok 2 - time: wall clock → UTC handles DST and fixed offsets
ok 3 - time: sessions and TradingView interval normalization
ok 4 - csv: TradingView, MetaTrader and Dukascopy formats
ok 5 - csv: invalid rows are reported, not fixed; duplicates removed
ok 6 - timeframes: aggregation keeps only complete buckets
ok 7 - strategy: not-configured adapter never emits events
ok 8 - strategy guard: future zones/news hidden and look-ahead output dropped
ok 9 - TEST adapter is edge-triggered (no repeat while state unchanged)
ok 10 - news: actual hidden until available; sentiment rule
ok 11 - webhook: validation, freshness, secret compare, limiter
ok 12 - metrics: empty → null, computed values correct
ok 13 - tradesim: costs and ambiguous TP/SL policy
ok 14 - telegram format: BACKTEST label is unmistakable and HTML is escaped
ok 15 - crypto: secret encryption round-trip, masking, sessions
ok 16 - 1. migration: tables, seeds and RLS lock-out of anon
ok 17 - 2. OHLC import (TEST source), idempotent re-import, derive H4
ok 18 - 3. news import with anti-lookahead (TEST calendar)
ok 19 - 4. replay with unconfigured strategy produces no events
ok 20 - 5. replay with TEST adapter: events, Telegram, pause, no duplicates, hidden future
ok 21 - 6. reset: policy "never" does not resend; "new_run" does
ok 22 - 7. replay runs to the end and finishes
ok 23 - 8. TradingView webhook: auth, validation, dedupe, LIVE Telegram
ok 24 - 9. Telegram failure, retry and idempotency are logged honestly
ok 25 - 10. analytics: empty until real trades exist; TradingView report import
# tests 25
# pass 25
# fail 0
```

## Cakupan terhadap daftar uji Tahap 7

| Item | Status | Bukti |
|---|---|---|
| Import OHLC | ✅ Terverifikasi | e2e #2: 48 candle, impor ulang 0 baru, chunk dengan header, derive H4 = 12 |
| Replay berjalan | ✅ | e2e #4, #5, #7 (sampai status `finished`) |
| Event dideteksi dengan aturan uji jelas | ✅ | e2e #5: fixture TEST edge-triggered → `SNR_NEAR`, `SNR_TOUCH` |
| Telegram mengirim pesan simulasi | ⚠️ Logika terverifikasi dengan stub; **pengiriman nyata belum** | e2e #5, #8, #9. Perlu token & chat ID Anda lalu tombol *Send Test Telegram* |
| Pause menghentikan pemrosesan | ✅ | e2e #5: langkah otomatis ditolak 409 saat paused |
| Tidak ada duplikasi | ✅ | e2e #5 (request ganda → conflict, 0 pesan tambahan), #6 (reset kebijakan `never`), #8 (webhook duplikat) |
| Berita setelah waktu replay tidak terlihat | ✅ | e2e #3: actual CPI tersembunyi pada menit rilis, terlihat setelahnya; zona/berita masa depan disaring (unit #8) |
| Webhook live diterima backend | ✅ (handler) | e2e #8: accepted, duplicate, 401, 422 (timestamp lama), 400; secret disamarkan di log |
| Website di Safari iPhone | ❌ Belum diuji | Next.js tidak bisa di-build di lingkungan ini. CSS memakai `100dvh`, safe-area, input 16px (tanpa auto-zoom), tab bar bawah — perlu dicek di perangkat setelah deploy |
| Database menyimpan riwayat | ✅ | event, webhook log, delivery log, event↔berita, trade, import batch diperiksa di e2e |

## Pemeriksaan statis
- `tsc --strict` pada seluruh `src/lib` (logika inti + server): 0 error.
- Seluruh 68 file TS/TSX lolos pemeriksaan sintaks TypeScript. Pemeriksaan tipe halaman React/Next memakai shim sederhana (paket asli tidak dapat diunduh di sini); jalankan `npm run typecheck && npm run build` setelah `npm install`.

## Keterbatasan yang masih ada
1. **Belum di-deploy, belum terhubung ke Supabase/Telegram/TradingView Anda** — membutuhkan kredensial Anda (lihat README §2).
2. `next build` dan UI belum dijalankan di sini (registry npm diblokir). Kemungkinan perlu perbaikan kecil saat build pertama.
3. Tidak ada data historis XAUUSD (termasuk 2019) maupun arsip berita yang disertakan — harus diimpor dari sumber sah.
4. Pine template belum dikompilasi di TradingView.
5. Retry Telegram setelah timeout jaringan bisa mengirim pesan dua kali jika permintaan pertama sebenarnya sampai (Telegram tidak mendukung idempotency key); dicatat jumlah percobaannya.
6. Klasifikasi sentimen otomatis hanya heuristik untuk 4 kategori; kategori lain tetap Unknown sampai ada analisis manual.
7. Klasifikasi sesi Asia/London/New York memakai konvensi jam di `src/lib/core/time.ts`; sesuaikan bila Anda memakai definisi lain.
8. Mesin trade simulasi siap, tetapi belum ada trade karena strategi belum ditentukan — analitik menampilkan empty state.

## Update 2026-10-31 — SNR H4/H1 → M15 v0.1 + backtest runner

Run in the sandbox against a real PostgreSQL 16 with the migrations applied:

- `npm test` (core + snr unit tests): **24 passed, 0 failed**
- `npm run test:e2e`: **11 passed, 0 failed** — includes #11: M15 import → derive H1/H4 → backtest RR 1/2/3, every trade checked
  (BUY only in bullish H4, SL below zone, TP = RR × risk, entry at the signal-candle close, no overlapping trades),
  causality (shorter run = identical trades for the shared period) and replay engine = backtest runner for the same setups.

All test candles are SYNTHETIC (2030 zigzag). They prove the mechanics, not profitability.
Not verified here: Next.js build/UI rendering (npm registry blocked), the Pine file (not compiled in TradingView), real 2019 data.
