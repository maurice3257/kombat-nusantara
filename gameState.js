'use strict';
/* =====================================================================
 * gameState.js — Catatan input pertandingan yang sedang berjalan
 * ---------------------------------------------------------------------
 * Server TIDAK menjalankan simulasi (client yang deterministik). Server
 * hanya meneruskan input & menyimpannya agar penonton yang masuk di
 * tengah pertandingan bisa "memutar ulang" dari frame 0 lalu mengikuti
 * siaran (dengan delay 30 detik — lihat CONFIG.SPECTATOR_DELAY_FRAMES).
 * ===================================================================== */
const MAX_FRAMES = 60 * 60 * 15; // batas 15 menit per match (pengaman memori)

class GameState {
    constructor(room, stage) {
        const ps = room.players.slice().sort((a, b) => a.slot - b.slot);
        this.chars = ps.map((p) => p.character);
        this.names = ps.map((p) => p.name);
        this.assist = ps.map((p) => !!p.assist);
        this.stage = stage;
        this.log = [[], []];
        this.startedAt = Date.now();
    }

    /** Simpan potongan input {s: frame awal, b: [bitmask...]} dari pemain slot */
    record(slot, start, bits) {
        const L = this.log[slot];
        for (let i = 0; i < bits.length; i++) {
            const f = start + i;
            if (f >= MAX_FRAMES) break;
            if (L[f] === undefined) L[f] = bits[i] | 0;
        }
    }

    /** Ringkasan untuk penonton baru */
    snapshot() {
        // frame yang belum diterima dikirim sebagai null (client mengisinya sendiri / menunggu)
        const arr = (a) => Array.from(a, (v) => (v === undefined ? null : v));
        return { chars: this.chars, names: this.names, assist: this.assist, stage: this.stage, log: [arr(this.log[0]), arr(this.log[1])] };
    }
}

module.exports = GameState;
