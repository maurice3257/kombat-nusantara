'use strict';
/* =====================================================================
 * network.js — Koneksi Socket.IO, ping, reconnect
 * ---------------------------------------------------------------------
 * Netcode yang dipakai: DELAY-BASED LOCKSTEP (input sync).
 * - Tiap client menjalankan simulasi yang sama (deterministik).
 * - Yang dikirim hanya bitmask input per frame + nomor frame.
 * - Input lokal dijadwalkan CONFIG.INPUT_DELAY frame ke depan, sehingga
 *   biasanya input lawan sudah tiba saat frame tsb disimulasikan.
 * - Paket membawa "ack" sehingga input yang hilang (misal saat
 *   reconnect) otomatis dikirim ulang.
 * Logika lockstep-nya ada di game.js (GameSession.netTick).
 * ===================================================================== */
const Net = {
    socket: null, ping: null, room: null, token: null, slot: 0, pingTimer: null, listeners: {},

    available() { return typeof io !== 'undefined'; },
    isConnected() { return !!(this.socket && this.socket.connected); },

    /** Daftarkan listener lokal (status koneksi dsb.) */
    onLocal(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    fire(ev, data) { (this.listeners[ev] || []).forEach((f) => f(data)); },

    connect() {
        if (this.socket) return this.socket;
        if (!this.available()) { this.fire('error', 'Library Socket.IO gagal dimuat (cek koneksi internet).'); return null; }
        const s = this.socket = io(CONFIG.SERVER_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: CONFIG.RECONNECT_ATTEMPTS,
            reconnectionDelay: CONFIG.RECONNECT_DELAY,
            timeout: 20000
        });
        s.on('connect', () => {
            this.log('terhubung', s.id);
            this.fire('status', 'online');
            // Reconnect di tengah room → klaim kembali slot kita
            if (this.room && this.token) {
                s.emit('rejoinRoom', { roomCode: this.room, token: this.token }, (res) => {
                    this.fire('rejoin', res);
                });
            }
        });
        s.on('disconnect', (reason) => { this.log('putus', reason); this.fire('status', 'offline'); });
        s.on('connect_error', (e) => { this.fire('status', 'error'); this.log('connect_error', e && e.message); });
        s.io.on('reconnect_attempt', (n) => this.fire('status', 'reconnect:' + n));
        s.io.on('reconnect_failed', () => this.fire('reconnectFailed'));
        if (!this.pingTimer) this.pingTimer = setInterval(() => this.measurePing(), 2000);
        return s;
    },

    measurePing() {
        if (!this.isConnected()) return;
        const t0 = performance.now();
        this.socket.timeout(4000).emit('latency', (err) => {
            if (!err) this.ping = Math.round(performance.now() - t0);
        });
    },

    emit(ev, data, cb) {
        if (!this.socket) return;
        if (cb) this.socket.timeout(10000).emit(ev, data, (err, res) => cb(err ? { ok: false, error: 'Server tidak merespons' } : res));
        else this.socket.emit(ev, data);
    },
    on(ev, fn) { if (this.socket) this.socket.on(ev, fn); },
    off(ev, fn) { if (this.socket) this.socket.off(ev, fn); },

    /** Input dikirim "volatile": jika koneksi sedang putus, dibuang (nanti dikirim ulang via ack) */
    sendInput(pkt) { if (this.isConnected()) this.socket.volatile.emit('input', pkt); },

    leave() { if (this.socket && this.room) this.socket.emit('leaveRoom'); this.room = null; this.token = null; },

    log(...a) { if (CONFIG.LOG_NETWORK) console.log('[NET]', ...a); }
};
