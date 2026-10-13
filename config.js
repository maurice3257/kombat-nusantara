'use strict';
/* =====================================================================
 * config.js — Pengaturan global game KOMBAT NUSANTARA
 * ---------------------------------------------------------------------
 * Ubah SERVER_URL ke alamat backend Node.js kamu setelah deploy
 * (Render / Railway). Saat dijalankan di localhost, URL otomatis
 * diarahkan ke http://localhost:3000.
 * ===================================================================== */
const CONFIG = {
    // URL backend server Socket.IO (Render / Railway). GANTI SETELAH DEPLOY!
    SERVER_URL: 'https://fighting-game-server.onrender.com',

    // URL API PHP (leaderboard MySQL di InfinityFree) — relatif ke index.html
    API_URL: 'api/',

    GAME_TITLE: 'KOMBAT NUSANTARA',

    // ---------- Pengaturan game ----------
    CANVAS_WIDTH: 1280,
    CANVAS_HEIGHT: 720,
    TARGET_FPS: 60,
    ROUND_TIME: 99,          // detik
    MAX_ROUNDS: 3,
    ROUNDS_TO_WIN: 2,        // best of 3

    // ---------- Fisika (satuan px & detik) ----------
    GROUND_Y: 570,           // tinggi canvas - 150
    STAGE_WIDTH: 2000,       // lebar arena (kamera bergeser / parallax)
    WALL_MARGIN: 40,
    GRAVITY: 2000,
    JUMP_VELOCITY: -900,
    FRICTION_GROUND: 0.85,
    FRICTION_AIR: 0.95,
    MAX_FALL_SPEED: 1200,

    // ---------- Input ----------
    INPUT_BUFFER_SIZE: 12,   // frame tombol diingat (buffer)
    MOTION_WINDOW: 14,       // toleransi frame untuk motion (QCF, DP, dst)
    SUPER_MOTION_WINDOW: 26, // QCF QCF butuh jendela lebih panjang
    NORMAL_BUFFER: 4,        // buffer untuk serangan normal
    CHARGE_FRAMES: 45,       // lama tahan charge (frame). Spesifikasi menyebut 2 detik (=120), 45 terasa lebih wajar

    // ---------- Combat ----------
    CHIP_PCT: 0.1,
    COMBO_SCALE_START: 3,
    COMBO_SCALE_STEP: 0.05,
    COMBO_SCALE_MIN: 0.7,
    COUNTER_HITSTUN: 8,
    JUGGLE_LIMIT: 4,
    SUPER_COST: 100,
    EX_COST: 50,
    BURST_COST: 50,
    SUPER_FREEZE: 30,        // 0.5 detik
    SLOWMO_FRAMES: 18,       // 0.3 detik

    // ---------- Network ----------
    INPUT_DELAY: 3,          // delay-based netcode (frame)
    RECONNECT_ATTEMPTS: 3,
    RECONNECT_DELAY: 2000,
    STALL_PAUSE_MS: 3000,    // auto-pause jika input lawan tak datang > 3 dtk
    SPECTATOR_DELAY_FRAMES: 1800, // 30 detik delay untuk penonton
    ROLLBACK_FRAMES: 0,      // (rollback belum dipakai; netcode = delay-based lockstep)

    // ---------- Audio ----------
    USE_AUDIO_FILES: false,  // true = muat file .wav di assets/audio/sfx (jika ada); false = suara sintetis

    // ---------- Debug ----------
    SHOW_HITBOXES: false,
    SHOW_FPS: true,
    SHOW_PING: true,
    LOG_NETWORK: false
};

// Development: otomatis pakai server lokal, atau override via ?server=URL
if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('server');
    if (q) CONFIG.SERVER_URL = q;
    else if (/^(localhost|127\.0\.0\.1|)$/.test(location.hostname)) CONFIG.SERVER_URL = 'http://localhost:3000';
}
