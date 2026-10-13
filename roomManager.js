'use strict';
/* =====================================================================
 * roomManager.js — Membuat, mencari, dan mengelola room 1v1
 * ===================================================================== */
const crypto = require('crypto');

// Tanpa huruf/angka yang mirip (0/O, 1/I) agar kode mudah diketik
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class RoomManager {
    constructor() {
        this.rooms = new Map();        // code → room
        this.socketRoom = new Map();   // socketId → code (pemain)
        this.specRoom = new Map();     // socketId → code (penonton)
    }

    /** Kode format XXXX-YYYY (8 karakter alfanumerik) */
    genCode() {
        let code;
        do {
            const pick = () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
            code = Array.from({ length: 4 }, pick).join('') + '-' + Array.from({ length: 4 }, pick).join('');
        } while (this.rooms.has(code));
        return code;
    }

    /** "abcd efgh" / "ABCDEFGH" → "ABCD-EFGH" */
    normalize(code) {
        const s = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : s;
    }

    newPlayer(socketId, name, slot) {
        return {
            id: socketId, token: crypto.randomUUID(), slot,
            name: String(name || 'Petarung').replace(/[<>]/g, '').slice(0, 16) || 'Petarung',
            character: null, stage: 0, ready: false, assist: false, rematch: false, connected: true, graceTimer: null
        };
    }

    createRoom(socketId, name, isPublic) {
        const code = this.genCode();
        const room = {
            code, players: [this.newPlayer(socketId, name, 0)], spectators: new Set(),
            state: 'waiting',          // waiting → select → playing → ended
            isPublic: !!isPublic, createdAt: Date.now(), match: null, matchCount: 0
        };
        this.rooms.set(code, room);
        this.socketRoom.set(socketId, code);
        return room;
    }

    joinRoom(rawCode, socketId, name) {
        const code = this.normalize(rawCode);
        const room = this.rooms.get(code);
        if (!room) return { success: false, error: 'Room tidak ditemukan (Room not found)' };
        if (room.players.length >= 2) return { success: false, error: 'Room penuh (Room is full)' };
        if (room.state !== 'waiting') return { success: false, error: 'Game sudah dimulai (Game already started)' };
        const p = this.newPlayer(socketId, name, 1);
        room.players.push(p);
        room.state = 'select';
        this.socketRoom.set(socketId, code);
        return { success: true, room, player: p };
    }

    getRoom(code) { return this.rooms.get(this.normalize(code)); }
    roomOf(socketId) { const c = this.socketRoom.get(socketId); return c ? this.rooms.get(c) : null; }
    playerOf(socketId) { const r = this.roomOf(socketId); return r ? r.players.find((p) => p.id === socketId) : null; }

    /** Data pemain yang aman dikirim ke client (tanpa token) */
    publicPlayers(room) {
        return room.players.map((p) => ({ slot: p.slot, name: p.name, character: p.character, stage: p.stage, ready: p.ready, assist: p.assist, connected: p.connected }));
    }

    setSelection(socketId, character, stage) {
        const p = this.playerOf(socketId);
        if (!p || p.ready) return null;
        if (typeof character === 'string' && /^[a-z0-9]{2,16}$/.test(character)) p.character = character;
        if (Number.isInteger(stage) && stage >= 0 && stage < 4) p.stage = stage;
        return this.roomOf(socketId);
    }

    setReady(socketId, ready, assist) {
        const p = this.playerOf(socketId);
        if (!p || !p.character) return null;
        p.ready = !!ready; p.assist = !!assist;
        return this.roomOf(socketId);
    }

    allReady(room) { return room.players.length === 2 && room.players.every((p) => p.ready && p.character && p.connected); }

    /** Stage: jika pilihan sama → itu; jika beda → acak salah satu */
    selectStage(room) {
        const a = room.players[0].stage, b = room.players[1].stage;
        return a === b ? a : (crypto.randomInt(2) ? a : b);
    }

    setRematch(socketId) {
        const p = this.playerOf(socketId);
        if (p) p.rematch = true;
        return this.roomOf(socketId);
    }
    bothRematch(room) { return room.players.length === 2 && room.players.every((p) => p.rematch); }

    listPublic() {
        const out = [];
        for (const r of this.rooms.values()) {
            if (!r.isPublic) continue;
            out.push({ code: r.code, host: r.players[0] ? r.players[0].name : '?', state: r.state === 'waiting' ? 'waiting' : 'playing', players: r.players.length });
        }
        return out.slice(-30).reverse();
    }

    removePlayer(socketId) {
        const room = this.roomOf(socketId);
        this.socketRoom.delete(socketId);
        if (!room) return null;
        const p = room.players.find((x) => x.id === socketId);
        if (p && p.graceTimer) clearTimeout(p.graceTimer);
        room.players = room.players.filter((x) => x.id !== socketId);
        if (room.players.length === 0) this.deleteRoom(room.code);
        else {
            // Pemain tersisa menjadi host baru, room kembali menunggu
            const left = room.players[0];
            left.slot = 0; left.ready = false; left.rematch = false;
            room.state = 'waiting'; room.match = null;
        }
        return room;
    }

    deleteRoom(code) {
        const r = this.rooms.get(code);
        if (!r) return;
        for (const p of r.players) { this.socketRoom.delete(p.id); if (p.graceTimer) clearTimeout(p.graceTimer); }
        for (const s of r.spectators) this.specRoom.delete(s);
        this.rooms.delete(code);
    }

    /** Hapus room basi (mis. ditinggal > 2 jam) */
    cleanup(maxAgeMs = 2 * 3600 * 1000) {
        const now = Date.now();
        for (const r of this.rooms.values()) if (now - r.createdAt > maxAgeMs && r.state !== 'playing') this.deleteRoom(r.code);
    }
}

module.exports = RoomManager;
