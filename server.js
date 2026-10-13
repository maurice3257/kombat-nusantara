'use strict';
/* =====================================================================
 * server.js — Game server KOMBAT NUSANTARA (Node.js + Express + Socket.IO)
 * ---------------------------------------------------------------------
 * Deploy ke Render / Railway (InfinityFree tidak mendukung Node.js).
 * Tugas server:
 *   1. Room 1v1: create / join (kode XXXX-YYYY) / list publik
 *   2. Sinkron pilih karakter & stage, ready, mulai pertandingan
 *   3. Relay input per frame (netcode lockstep — simulasi di client)
 *   4. Reconnect dengan token (grace period), deklarasi menang disconnect
 *   5. Penonton (spectator) + chat, rematch, ping
 * ===================================================================== */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const RoomManager = require('./roomManager');
const GameState = require('./gameState');

const PORT = process.env.PORT || 3000;
const GRACE_MS = 15000;          // waktu tunggu pemain yang putus sebelum dinyatakan kalah
const ALLOWED = process.env.CORS_ORIGIN || '*';   // mis. "https://namagame.infinityfreeapp.com"

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: ALLOWED === '*' ? '*' : ALLOWED.split(',') },
    pingInterval: 10000,
    pingTimeout: 8000,
    maxHttpBufferSize: 1e5
});
const rooms = new RoomManager();

// Health check (dipakai Render/Railway & untuk "membangunkan" server gratis)
app.get('/', (req, res) => res.type('text').send('KOMBAT NUSANTARA server OK — rooms: ' + rooms.rooms.size));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.rooms.size, uptime: process.uptime() }));

const specChannel = (code) => code + ':spec';
const reply = (cb, data) => { if (typeof cb === 'function') cb(data); };
const log = (...a) => { if (process.env.NODE_ENV !== 'test') console.log(new Date().toISOString(), ...a); };

function broadcastSelection(room) {
    io.to(room.code).emit('selectionUpdate', { players: rooms.publicPlayers(room) });
}

/** Mulai (atau mulai ulang) pertandingan */
function startMatch(room, isRematch) {
    const stage = rooms.selectStage(room);
    room.state = 'playing';
    room.matchCount++;
    room.players.forEach((p) => { p.rematch = false; });
    room.match = new GameState(room, stage);
    io.to(room.code).emit('startGame', { players: rooms.publicPlayers(room), stage, rematch: !!isRematch });
    io.to(specChannel(room.code)).emit('specStart', room.match.snapshot());
    log('match start', room.code, room.match.chars.join(' vs '), 'stage', stage);
}

io.on('connection', (socket) => {
    log('connect', socket.id);

    /* ---------------- ROOM ---------------- */
    socket.on('createRoom', (data = {}, cb) => {
        if (rooms.roomOf(socket.id)) leaveCurrent(socket);
        const room = rooms.createRoom(socket.id, data.username, data.isPublic);
        socket.join(room.code);
        reply(cb, { ok: true, roomCode: room.code, token: room.players[0].token, slot: 0 });
        log('room created', room.code);
    });

    socket.on('joinRoom', (data = {}, cb) => {
        if (rooms.roomOf(socket.id)) leaveCurrent(socket);
        const res = rooms.joinRoom(data.roomCode, socket.id, data.username);
        if (!res.success) { reply(cb, { ok: false, error: res.error }); socket.emit('joinError', { message: res.error }); return; }
        socket.join(res.room.code);
        reply(cb, { ok: true, roomCode: res.room.code, token: res.player.token, slot: res.player.slot });
        io.to(res.room.code).emit('opponentFound', { players: rooms.publicPlayers(res.room) });
        log('join', res.room.code);
    });

    socket.on('listRooms', (data, cb) => reply(cb, { ok: true, rooms: rooms.listPublic() }));

    /* ---------------- PILIH KARAKTER ---------------- */
    socket.on('selectCharacter', (data = {}) => {
        const room = rooms.setSelection(socket.id, data.character, data.stage);
        if (room) broadcastSelection(room);
    });
    socket.on('characterSelected', (data = {}) => { // alias sesuai spesifikasi awal
        const room = rooms.setSelection(socket.id, data.character, data.stage);
        if (room) broadcastSelection(room);
    });

    socket.on('setReady', (data = {}) => {
        const room = rooms.setReady(socket.id, data.ready, data.assist);
        if (!room) return;
        broadcastSelection(room);
        if (room.state === 'select' && rooms.allReady(room)) startMatch(room, false);
    });

    /* ---------------- GAMEPLAY: relay input ---------------- */
    socket.on('input', (pkt) => {
        const room = rooms.roomOf(socket.id);
        if (!room || room.state !== 'playing' || !pkt) return;
        const p = room.players.find((x) => x.id === socket.id);
        if (!p) return;
        if (!Number.isInteger(pkt.s) || pkt.s < 0 || !Array.isArray(pkt.b) || pkt.b.length > 120) return;
        const b = pkt.b.map((v) => (v | 0) & 2047);
        if (room.match) room.match.record(p.slot, pkt.s, b);
        // ke lawan
        socket.to(room.code).emit('input', { s: pkt.s, b, a: pkt.a | 0, c: Array.isArray(pkt.c) ? pkt.c.slice(0, 2) : undefined });
        // ke penonton (tanpa ack)
        if (room.spectators.size && b.length) io.to(specChannel(room.code)).emit('specInput', { slot: p.slot, s: pkt.s, b });
    });

    socket.on('matchEnd', () => {
        const room = rooms.roomOf(socket.id);
        if (room && room.state === 'playing') room.state = 'ended';
    });

    socket.on('rematch', () => {
        const room = rooms.setRematch(socket.id);
        if (!room) return;
        socket.to(room.code).emit('rematchWaiting');
        if (rooms.bothRematch(room)) startMatch(room, true);
    });

    socket.on('leaveRoom', () => leaveCurrent(socket));

    /* ---------------- RECONNECT ---------------- */
    socket.on('rejoinRoom', (data = {}, cb) => {
        const room = rooms.getRoom(data.roomCode);
        const p = room && room.players.find((x) => x.token === data.token);
        if (!p) { reply(cb, { ok: false, error: 'Sesi room sudah berakhir' }); return; }
        if (p.graceTimer) { clearTimeout(p.graceTimer); p.graceTimer = null; }
        rooms.socketRoom.delete(p.id);
        p.id = socket.id; p.connected = true;
        rooms.socketRoom.set(socket.id, room.code);
        socket.join(room.code);
        socket.to(room.code).emit('opponentStatus', { connected: true });
        reply(cb, { ok: true, slot: p.slot, state: room.state });
        log('rejoin', room.code, 'slot', p.slot);
    });

    /* ---------------- PENONTON ---------------- */
    socket.on('spectate', (data = {}, cb) => {
        const room = rooms.getRoom(data.roomCode);
        if (!room) { reply(cb, { ok: false, error: 'Room tidak ditemukan' }); return; }
        room.spectators.add(socket.id);
        rooms.specRoom.set(socket.id, room.code);
        socket.data.specName = String(data.username || 'Penonton').slice(0, 16);
        socket.join(specChannel(room.code));
        reply(cb, { ok: true, match: room.state === 'playing' && room.match ? room.match.snapshot() : null });
        io.to(specChannel(room.code)).emit('chat', { name: '★', text: socket.data.specName + ' mulai menonton (' + room.spectators.size + ' penonton)' });
    });

    socket.on('leaveSpectate', () => leaveSpectate(socket));

    socket.on('chat', (data = {}) => {
        const code = rooms.specRoom.get(socket.id);
        if (!code) return;
        const text = String(data.text || '').replace(/[<>]/g, '').slice(0, 120).trim();
        if (!text) return;
        const now = Date.now();
        if (socket.data.lastChat && now - socket.data.lastChat < 700) return; // anti-spam
        socket.data.lastChat = now;
        io.to(specChannel(code)).emit('chat', { name: socket.data.specName || 'Penonton', text });
    });

    /* ---------------- PING ---------------- */
    socket.on('latency', (cb) => reply(cb, Date.now()));

    /* ---------------- DISCONNECT ---------------- */
    socket.on('disconnect', (reason) => {
        log('disconnect', socket.id, reason);
        leaveSpectate(socket);
        const room = rooms.roomOf(socket.id);
        if (!room) return;
        const p = room.players.find((x) => x.id === socket.id);
        if (!p) return;
        if (room.state === 'waiting' || room.players.length < 2) { leaveCurrent(socket); return; }
        // Beri waktu reconnect (Socket.IO client mencoba 3x)
        p.connected = false;
        socket.to(room.code).emit('opponentStatus', { connected: false });
        p.graceTimer = setTimeout(() => {
            p.graceTimer = null;
            if (p.connected) return;
            io.to(room.code).emit('opponentLeft', { reason: 'timeout' });
            io.to(specChannel(room.code)).emit('chat', { name: '★', text: p.name + ' terputus.' });
            rooms.removePlayer(p.id);
        }, GRACE_MS);
    });
});

function leaveCurrent(socket) {
    const room = rooms.roomOf(socket.id);
    if (!room) return;
    socket.leave(room.code);
    socket.to(room.code).emit('opponentLeft', { reason: 'left' });
    rooms.removePlayer(socket.id);
}

function leaveSpectate(socket) {
    const code = rooms.specRoom.get(socket.id);
    if (!code) return;
    rooms.specRoom.delete(socket.id);
    const room = rooms.rooms.get(code);
    if (room) room.spectators.delete(socket.id);
    socket.leave(specChannel(code));
}

setInterval(() => rooms.cleanup(), 10 * 60 * 1000);

server.listen(PORT, () => log('KOMBAT NUSANTARA server berjalan di port ' + PORT));

module.exports = { server, io, rooms };
