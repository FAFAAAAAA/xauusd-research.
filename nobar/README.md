# Nobar

Nonton bareng untuk 2 orang. Host membagikan satu tab Chrome (gambar + suara tab) dari laptop, penonton menonton di HP lewat tautan + PIN. Video dan suara dikirim langsung lewat WebRTC P2P. Server (Cloudflare Worker) hanya mempertemukan kedua browser. Telepon tetap lewat WhatsApp.

Terpisah dari situs XAUUSD: semua isi ada di folder ini dan dideploy sendiri ke Cloudflare. Situs XAUUSD di Vercel tidak ikut berubah.

## Deploy pertama kali (sekali saja)

1. Buat akun Cloudflare gratis.
2. Di Cloudflare: **My Profile > API Tokens > Create Token**, pilih template **Edit Cloudflare Workers**, simpan tokennya.
3. Catat **Account ID** (ada di halaman Workers & Pages, kolom kanan).
4. Di GitHub repo ini: **Settings > Secrets and variables > Actions > New repository secret**, isi:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
5. Buka tab **Actions > nobar-deploy > Run workflow**. Setelah hijau, alamatnya muncul di log langkah "Deploy to Cloudflare", bentuknya `https://nobar.<nama-akun>.workers.dev`.

Setiap push ke folder `nobar/` setelah itu akan dideploy otomatis.

### Relay TURN (disarankan)

Kalau jaringan salah satu pihak ketat (sering di data seluler), koneksi langsung bisa gagal. Relay TURN Cloudflare gratis sampai 1.000 GB per bulan.

1. Cloudflare: **Realtime > TURN Server > Create**. Simpan **Turn Token ID** dan **API Token**.
2. Tambahkan secret GitHub `TURN_KEY_ID` dan `TURN_KEY_API_TOKEN`, lalu jalankan workflow lagi.

Halaman host memberi tahu apakah relay sudah siap.

## Cara pakai

**Host (laptop, Chrome):**
1. Buka alamat aplikasi, klik **Buat room**.
2. Klik **Salin pesan untuk WhatsApp**, kirim ke penonton.
3. Klik **Pilih tab**, pilih tab film, dan nyalakan **Bagikan juga audio tab**.
4. Putar filmnya di tab itu.

**Penonton (HP):**
1. Buka tautan di Safari atau Chrome (bukan browser di dalam KakaoTalk).
2. Masukkan PIN, lalu ketuk **Mulai nonton**.
3. **Layar penuh** untuk menonton miring. **Statistik** untuk melihat kualitas koneksi.

Batasan yang perlu diketahui:
- Netflix, Disney+, Prime Video dan layanan DRM lain tampil hitam. YouTube dan file video lokal aman.
- Di iPhone, suara film bisa terhenti saat telepon WhatsApp aktif. Ketuk **Lanjut nonton**, atau pilih **Tanpa suara film**. Pakai earphone supaya suara film tidak masuk ke telepon.
- Room otomatis hilang setelah 12 jam tidak dipakai.

## Tes pertama di HP sungguhan

Di halaman penonton ada **Catatan audio dan koneksi**. Lakukan ini sekali dan kirim catatannya (tombol **Salin catatan**):
1. Mulai nonton dengan suara, lalu mulai telepon WhatsApp. Apa yang terjadi pada suara film?
2. Telepon WhatsApp dulu, baru ketuk **Mulai nonton**.
3. Di iPhone, ulangi dengan **Mode audio Safari** = Ambient.
4. Kunci layar 1 menit lalu buka lagi.

## Pengembangan

```bash
cd nobar
npm install
npm run dev        # build + wrangler dev di http://localhost:8787
npm test           # tes unit
npm run test:e2e   # host + penonton di dua Chromium, WebRTC sungguhan
npm run typecheck
```

Struktur:
- `shared/protocol.ts`: pesan signaling dan batasan room
- `worker/src/`: Worker (API, rute `/w/:room`, kredensial TURN) dan Durable Object `Room`
- `web/`: halaman host (`index.html`) dan penonton (`watch.html`)
- `docs/`: laporan riset yang menjadi dasar desain
