# KOMBAT NUSANTARA — Fighting Game 2D Multiplayer (Browser)

Game fighting 2D 1v1 real-time berbasis HTML5 Canvas + JavaScript + Socket.IO, terinspirasi
Street Fighter / Tekken / Mortal Kombat. Frontend di-hosting di **InfinityFree**, server
multiplayer Node.js di **Render** (atau Railway), leaderboard di **MySQL InfinityFree** via PHP.

> Tidak butuh file sprite/audio sama sekali: petarung, stage, efek, musik & SFX dibuat
> secara prosedural (Canvas + Web Audio). Upload → langsung jalan.

---

## Fitur

| Bagian | Isi |
|---|---|
| Mode | PLAY ONLINE (create/join room, room publik, penonton), VS CPU (3 level), VERSUS LOKAL (1 keyboard / 2 gamepad), REPLAY |
| Room | Kode `XXXX-YYYY`, tombol Copy, QR code, link undangan `?join=KODE`, validasi *not found / full / already started*, animasi OPPONENT FOUND |
| Pilih karakter | 6 petarung, preview animasi + stats, pilih real-time, pilih stage, READY ✓ kedua pemain, countdown 3-2-1, loading screen + tips |
| Petarung | Raka (Seimbang), Bima (Rushdown), Lin Mei (Footsies/Zoner), Kaido (Agresif), Garrett (Zoner/Defensif, charge), Sasha (Mixup) |
| Input | Motion QCF/QCB/DP/HCF/HCB, charge, QCF×2 super, buffer 12 frame, prioritas Super > Special > Heavy > Medium > Light, Input Assist |
| Combat | Hitbox/hurtbox/pushbox AABB per frame, startup/active/recovery, chain combo, cancel normal→special→super, EX (50 meter), Burst/Roman Cancel (HP+HK, 50 meter), juggle + limit, combo scaling (−5%/hit setelah hit ke-3, min 70%), counter hit, stand/crouch block, overhead/low, chip damage 10%, pushback, guard break, knockdown + quick/back rise/stay down, OTG, hard knockdown |
| Super | 100 meter, freeze 0,5 dtk + zoom sinematik + banner, invincible saat startup, slow-motion 0,3 dtk saat kena |
| Ronde | Best of 3, timer 99, ROUND 1 / FINAL ROUND / FIGHT!, K.O., PERFECT, TIME OUT, DRAW, victory screen + statistik |
| HUD | HP bar 2 lapis (delayed drain), flash putih, kedip merah < 25%, super meter (tanda EX), guard gauge, combo counter, PING berwarna, FPS |
| Visual | 4 stage 3-layer parallax + penonton beranimasi (Dojo Sakura, Kuil Naga, Kota Neon, Kawah Vulkanik), hit spark L/H, block spark, debu, trail proyektil, vignette HP kritis, screen shake, partikel di-pool |
| Audio | SFX sintetis per jenis serangan, BGM prosedural per stage, announcer (Speech Synthesis) |
| Lainnya | Options (volume BGM/SFX/Voice, partikel, shake, hitbox debug, buta warna, input assist, key rebinding P1/P2 — tersimpan di localStorage), gamepad, kontrol sentuh, leaderboard ELO + win streak |

---

## Struktur folder

```
/
├── index.html            ← SEMUA layar (single page; socket tidak putus saat pindah layar)
├── game.html             ← hanya redirect ke index.html (kompatibel dengan struktur awal)
├── css/  main.css · lobby.css · game.css
├── js/
│   ├── config.js         ← SERVER_URL & semua angka tuning
│   ├── main.js           ← entry point
│   ├── lobby.js          ← UI: menu, room, pilih karakter, options, replay, penonton
│   ├── game.js           ← GameSession: game loop, netcode lockstep, event → efek/suara
│   ├── engine/  input.js · renderer.js · audio.js · network.js
│   ├── characters/ Character.js (kelas dasar + fisika) · roster.js (6 petarung, data-driven)
│   └── systems/ combat.js · match.js (ronde/kamera/proyektil) · effects.js · ai.js
├── assets/               ← opsional (lihat assets/README.txt)
├── server/               ← deploy ke Render/Railway
│   ├── server.js · roomManager.js · gameState.js · package.json
└── api/                  ← PHP untuk MySQL InfinityFree
    ├── config.php · save_score.php · get_leaderboard.php · schema.sql · .htaccess
```

Penyesuaian dari spesifikasi awal:
- **Satu halaman (`index.html`)**: berpindah ke `game.html` akan memutus koneksi Socket.IO, jadi lobby & arena digabung.
- **Karakter data-driven** (`roster.js`) alih-alih satu file per karakter; fisika ada di `Character.js` dan `match.js` (bukan `physics.js` terpisah), animasi pose di `renderer.js` (bukan sprite sheet).
- **Tombol P2** memakai Panah + Numpad, karena I/J/K/L sudah dipakai P1 untuk serangan.
- **Guard break** memakai *guard gauge* (block beruntun mengisi gauge) supaya 3 hit chain biasa tidak langsung memecah guard. Angkanya di `combat.js`.
- **Charge** = 45 frame (±¾ detik), bisa diubah di `CONFIG.CHARGE_FRAMES`.

---

## Menjalankan di komputer sendiri (test)

```bash
# 1) Server multiplayer
cd server
npm install
npm start                      # http://localhost:3000

# 2) Frontend (terminal lain, dari folder utama)
npx serve .                    # atau: python -m http.server 8080 / VS Code Live Server
```

Buka `http://localhost:8080` di **dua browser/tab**, satu CREATE ROOM, satu JOIN ROOM.
Saat dibuka dari `localhost`, `SERVER_URL` otomatis menjadi `http://localhost:3000`.
Kamu juga bisa memaksa server lain lewat `?server=https://alamat-server`.

Uji latency: Chrome DevTools → Network → Throttling. Uji disconnect: tutup salah satu tab
(lawan menang setelah 15 detik bila tidak tersambung lagi).

---

## Deploy

### 1. Backend Node.js → Render (gratis)
1. Push folder proyek ke repository GitHub.
2. Di render.com: **New → Web Service** → pilih repo.
3. **Root Directory**: `server` · **Build Command**: `npm install` · **Start Command**: `npm start`.
4. Instance type **Free**. Environment (opsional): `NODE_ENV=production`,
   `CORS_ORIGIN=https://namagame.infinityfreeapp.com` (kosongkan = semua origin).
5. Setelah deploy, kamu dapat URL seperti `https://kombat-xyz.onrender.com`. Buka URL itu → harus tampil `KOMBAT NUSANTARA server OK`.

Catatan Render Free: layanan "tidur" setelah 15 menit tanpa trafik dan butuh waktu untuk bangun
pada koneksi pertama (lobby menampilkan status "Menghubungkan…"). Selama ada pertandingan,
koneksi WebSocket yang aktif menjaga server tetap hidup.

**Railway**: langkahnya sama (Deploy from GitHub → Root Directory `server`, Start `npm start`, PORT otomatis). Railway tidak lagi punya paket gratis permanen (hanya kredit trial).

### 2. Frontend → InfinityFree
1. Daftar di infinityfree.net → buat akun hosting (mis. `namagame.infinityfreeapp.com`).
2. Edit `js/config.js`:
   ```js
   SERVER_URL: 'https://kombat-xyz.onrender.com',
   ```
3. Upload isi folder (index.html, game.html, css/, js/, assets/, api/) ke **`htdocs/`** via FileZilla
   (kredensial FTP di Control Panel) atau Online File Manager. Folder `server/` **tidak** perlu di-upload.
4. Control Panel → **SSL Certificates** → pasang SSL gratis, lalu buka situs via `https://`
   (wajib: halaman HTTPS hanya boleh terhubung ke server `https://`/`wss://`).

### 3. Leaderboard MySQL (opsional)
1. Control Panel InfinityFree → **MySQL Databases** → buat database.
2. Buka **phpMyAdmin** → tab SQL → jalankan isi `api/schema.sql`.
3. Isi `api/config.php` dengan host (`sqlXXX.infinityfree.com`), nama DB, user & password dari panel.
4. Hasil match online otomatis dikirim oleh client host (P1) ke `api/save_score.php` dan
   ELO dihitung di server (mulai 1000, ±25 untuk lawan setara). Menu LEADERBOARD membaca `get_leaderboard.php` (Top 10).

---

## Kontrol

| Aksi | P1 | P2 (lokal) | Gamepad |
|---|---|---|---|
| Gerak / lompat / jongkok | W A S D | Panah | D-pad / stik kiri |
| Pukulan L / M / H | U I O | Num 7 8 9 | X Y RB |
| Tendangan L / M / H | J K L | Num 4 5 6 | A B RT |
| Block | Space (atau tahan ←) | Num Enter / Num 0 | LB |
| Pause | Esc | | |

Online & VS CPU: pemain boleh memakai kedua layout. Semua tombol bisa diganti di OPTIONS.

---

## Cara kerja netcode

Fighting game butuh hasil identik di kedua komputer, jadi yang dikirim hanya **input**:

1. Input per frame diringkas menjadi 1 angka bitmask (11 bit).
2. Input lokal dijadwalkan **3 frame ke depan** (`CONFIG.INPUT_DELAY`) dan dikirim ke lawan lewat server.
3. Frame N baru disimulasikan setelah input kedua pemain untuk frame N ada (*lockstep*).
4. Simulasi berjalan dengan *fixed timestep* 1/60 dtk dan hanya memakai operasi aritmatika dasar
   (tanpa `Math.random`/trigonometri) → deterministik. Tiap 2 detik checksum state dibandingkan untuk mendeteksi desync.
5. Paket membawa *ack*; input yang hilang saat reconnect dikirim ulang otomatis.
6. Lawan diam > 3 detik → overlay "Menunggu koneksi lawan…"; Socket.IO mencoba reconnect 3×,
   server menyimpan slot selama 15 detik sebelum menyatakan pemain lain menang.

Karena seluruh pertandingan bisa diputar ulang dari input saja, **replay** (file `.kombat.json`)
dan **mode penonton** (input di-relay server, ditayangkan dengan delay 30 detik) didapat hampir gratis.

Rollback netcode belum diterapkan; arsitekturnya (simulasi deterministik + `Match` yang bisa
di-step) sudah siap bila ingin menambahkan *save/load state*.

---

## Mengubah & menambah konten

- **Angka game** (gravitasi, timer, buffer, delay, scaling…): `js/config.js`.
- **Frame data serangan normal**: `NORMALS` di `js/characters/roster.js`.
- **Petarung baru**: tambah objek di `ROSTER` (stats, warna `look`, `specials` dengan `kind`:
  `projectile | rising | spin | rush | multi | flip`, dan `super` dengan `kind`:
  `superBeam | superRising | superMulti | superRush | superGrab`).
- **Sprite sheet sendiri**: ganti `Renderer.drawFighter()`; state, aksi & frame serangan tersedia di objek `Character`.
- **Debug**: OPTIONS → Debug hitbox (merah = hurtbox, kuning = hitbox, hijau = pushbox). Console: `KOMBAT.session`.
