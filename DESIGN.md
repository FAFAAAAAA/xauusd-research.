# DESIGN.md — XAUUSD Research

Arah desain situs ini. Dibaca agen AI sebelum mengerjakan UI (lihat `CLAUDE.md`).
Isinya mencatat gaya yang **sudah berjalan** (sumber nilai: `src/app/tokens.css`). Bila ada yang berubah, ubah file ini juga.

Dial: ENERGY 1 / RHYTHM 2 / MOTION 2

## Identitas
- Alat riset trading pribadi untuk XAUUSD: dashboard, replay, backtest, berita, pengaturan.
- Pengguna: pemilik proyek, sebagian besar dari iPhone, sesekali dari desktop.
- Kesan yang dituju: tenang, presisi, bisa dipercaya. Seperti alat ukur, bukan produk pemasaran.
- Bahasa UI: Indonesia, lugas dan singkat.

## Warna
- **Monokrom** (pilihan pemilik). Aksen utama hampir hitam di tema terang, hampir putih di tema gelap. Token-nya tetap bernama `--gold` agar komponen tidak perlu diubah.
- Hijau (`--up`) dan merah (`--down`) **hanya** untuk BUY/SELL dan profit/rugi. Amber (`--warn`) **hanya** untuk peringatan.
- Tidak memakai gradien atau glow dekoratif (`--glow-*` sengaja `transparent`).
- Semua teks minimal 4,5:1 terhadap `bg`, `surface`, dan `sunk`, di kedua tema.

## Tema
- Tiga tema: terang (bawaan), gelap, dan `auto` (mengikuti HP). Ketiganya wajib berfungsi.
- Tema terang: kartu putih dengan bayangan sangat tipis. Tema gelap: panel datar tanpa bayangan.
- Kartu Saldo dan ringkasan Backtest tetap kartu putih biasa, bukan panel gelap (pilihan pemilik).

## Tipografi
- Font sistem (SF Pro di iPhone). Tanpa webfont.
- Angka memakai digit tabular (`tnum`) agar kolom harga dan PnL lurus.
- Skala: 12,5 / 13,5 / 16 / 17 / 22 / 28 px, angka besar 36 px.

## Bentuk dan tata letak
- Radius kartu 16 px (lebih kecil dari sebelumnya supaya terasa presisi).
- Spasi kelipatan 4 px.
- Desktop: sidebar 232 px, konten maks ~1040–1260 px. HP: satu kolom, aman untuk notch dan home bar.
- Ritme: halaman memakai pola kartu dan daftar yang konsisten. Variasi muncul dari isi (grafik, kalender PnL, tabel), bukan dari hiasan.

## Gerak
- Transisi pendek (120–260 ms), hanya `opacity` dan `transform`.
- Animasi yang ada dipertahankan: masuk halaman, sheet/modal, indikator segmented control.
- Hormati `prefers-reduced-motion`.

## Data dan kejujuran
- Jangan pernah menampilkan angka contoh atau angka karangan sebagai data nyata. Kosong ditampilkan sebagai kosong, dengan keterangan.
- Hubungan event dan berita ditulis "berkaitan dengan berita", tidak pernah sebagai sebab-akibat.
