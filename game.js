'use strict';
/* =====================================================================
 * game.js — GameSession: game loop, mode (CPU/lokal/online/penonton/
 * replay), netcode lockstep, konsumsi event untuk efek & audio
 * ---------------------------------------------------------------------
 * Struktur loop (sesuai spesifikasi, versi fixed-timestep):
 *   gameLoop(timestamp):
 *     dt = timestamp - lastTime          ← delta time nyata
 *     accumulator += dt
 *     while accumulator >= 1/60:          ← simulasi selalu 60 langkah/detik
 *        processInput → updateNetworkState → updatePhysics →
 *        checkCollisions → applyDamage   (semua di Match.step)
 *     updateAnimations(dt) / updateUI / render
 * Fixed timestep wajib untuk netcode deterministik: frame ke-N harus
 * menghasilkan state yang sama persis di kedua komputer.
 * ===================================================================== */
const STEP = 1 / 60;

/** Kompres array input (run-length) untuk file replay */
function rleEncode(arr) { const out = []; for (let i = 0; i < arr.length;) { let j = i; while (j < arr.length && arr[j] === arr[i]) j++; out.push([arr[i] | 0, j - i]); i = j; } return out; }
function rleDecode(rle) { const out = []; for (const [v, n] of rle) for (let k = 0; k < n; k++) out.push(v); return out; }

class GameSession {
    /**
     * opts: { mode: 'cpu'|'local'|'online'|'spectate'|'replay', chars:[a,b], names:[a,b], stage, assist:[a,b],
     *         localSlot, cpuLevel, replayInputs:[[..],[..]], specLog, onEnd }
     */
    constructor(opts) {
        this.opts = opts; this.mode = opts.mode;
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.match = new Match({ chars: opts.chars, names: opts.names, stage: opts.stage, assist: opts.assist || [false, false] });
        this.inputs = [[], []];
        this.view = { t: 0, disp: [this.match.fighters[0].maxHP, this.match.fighters[1].maxHP], hold: [0, 0], combo: [null, null] };
        this.acc = 0; this.last = 0; this.running = false; this.paused = false; this.ended = false;
        this.fps = 60; this.fpsAcc = 0; this.fpsN = 0;
        this.localSlot = opts.localSlot || 0;
        this.ai = this.mode === 'cpu' ? new CPU(1, opts.cpuLevel ?? 1) : null;

        if (this.mode === 'online') {
            const D = CONFIG.INPUT_DELAY;
            for (let f = 0; f < D; f++) { this.inputs[0][f] = 0; this.inputs[1][f] = 0; }
            this.localFrame = D;           // frame berikutnya yang akan diisi input lokal
            this.remoteContig = D - 1;     // frame terakhir (berurutan) yang sudah kita terima dari lawan
            this.remoteAck = D - 1;        // frame terakhir input KITA yang sudah diterima lawan
            this.stall = 0; this.myChecks = {}; this.desync = false;
            this.onInput = (pkt) => this.onRemoteInput(pkt);
            Net.on('input', this.onInput);
        }
        if (this.mode === 'spectate') {
            this.specDelay = opts.specDelay ?? CONFIG.SPECTATOR_DELAY_FRAMES;
            this.contig = [-1, -1];
            // Frame 0..INPUT_DELAY-1 selalu input kosong (protokol lockstep), tidak dikirim lewat jaringan
            for (let s = 0; s < 2; s++) this.addSpecInputs(s, 0, new Array(CONFIG.INPUT_DELAY).fill(0));
            if (opts.specLog) for (let s = 0; s < 2; s++) this.addSpecInputs(s, 0, opts.specLog[s]);
            this.onSpec = (d) => this.addSpecInputs(d.slot, d.s, d.b);
            Net.on('specInput', this.onSpec);
        }
        if (this.mode === 'replay') this.inputs = opts.replayInputs;
        this.loop = this.loop.bind(this);
    }

    start() {
        this.running = true;
        Effects.clear();
        Input.capture = true;
        AudioSys.bgm(STAGES[this.opts.stage].id);
        requestAnimationFrame(this.loop);
    }

    stop() {
        this.running = false;
        Input.capture = false;
        if (this.onInput) Net.off('input', this.onInput);
        if (this.onSpec) Net.off('specInput', this.onSpec);
        AudioSys.stopBGM();
    }

    loop(ts) {
        if (!this.running) return;
        if (!this.last) this.last = ts;
        let dt = (ts - this.last) / 1000;
        this.last = ts;
        if (dt > 0.25) dt = 0.25;
        // FPS meter
        this.fpsAcc += dt; this.fpsN++;
        if (this.fpsAcc >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }

        if (!this.paused) {
            this.acc += dt;
            let n = 0;
            while (this.acc >= STEP && n < 5) { this.tick(); this.acc -= STEP; n++; }
            if (n >= 5) this.acc = 0;   // tab lag: jangan menumpuk
        }
        this.render(dt);
        requestAnimationFrame(this.loop);
    }

    /* ---------------- SATU TICK SIMULASI ---------------- */
    tick() {
        const m = this.match;
        switch (this.mode) {
            case 'cpu': this.stepMatch([Input.sample('solo'), this.ai.think(m)]); break;
            case 'local': this.stepMatch([Input.sample('p1'), Input.sample('p2')]); break;
            case 'replay': {
                const f = m.frame;
                if (f >= this.inputs[0].length) { if (!this.ended) this.finish(); return; }
                this.stepMatch([this.inputs[0][f], this.inputs[1][f]]);
                break;
            }
            case 'online': this.netTick(); break;
            case 'spectate': this.specTick(); break;
        }
    }

    stepMatch(b) {
        const m = this.match, f = m.frame;
        if (this.mode !== 'replay' && this.mode !== 'online' && this.mode !== 'spectate') { this.inputs[0][f] = b[0]; this.inputs[1][f] = b[1]; }
        m.step(b);
        this.consumeEvents();
        if (m.phase === 'matchEnd' && !this.ended && m.phaseT >= 90) this.finish();
    }

    /* ---------------- NETCODE: DELAY-BASED LOCKSTEP ---------------- */
    netTick() {
        const D = CONFIG.INPUT_DELAY, L = this.localSlot, R = 1 - L, m = this.match;
        if (this.ended) return;
        // Jika kita tertinggal jauh dari lawan, boleh 2 langkah per tick untuk mengejar
        const maxSteps = this.remoteContig - m.frame > D + 2 ? 2 : 1;
        for (let s = 0; s < maxSteps; s++) {
            // 1) Jadwalkan input lokal untuk frame (sekarang + delay)
            if (this.localFrame <= m.frame + D) { this.inputs[L][this.localFrame] = Input.sample('solo'); this.localFrame++; }
            // 2) Simulasikan hanya jika input lawan untuk frame ini sudah tiba
            const f = m.frame;
            if (this.inputs[R][f] === undefined) { this.stall++; break; }
            this.stall = 0;
            this.stepMatch([this.inputs[0][f], this.inputs[1][f]]);
            if (m.frame % 120 === 0) this.myChecks[m.frame] = m.checksum();
        }
        this.sendInputs();
        // Auto-pause visual jika lawan tak mengirim input > 3 detik
        const stallMs = this.stall * STEP * 1000;
        UI.netWait(stallMs > CONFIG.STALL_PAUSE_MS, stallMs);
    }

    sendInputs() {
        const L = this.localSlot;
        const from = Math.max(this.remoteAck + 1, this.localFrame - 60);
        const pkt = { s: from, b: this.inputs[L].slice(from, this.localFrame), a: this.remoteContig };
        const lastCheck = Math.floor(this.match.frame / 120) * 120;
        if (lastCheck > 0 && this.myChecks[lastCheck] !== undefined && this.sentCheck !== lastCheck) { pkt.c = [lastCheck, this.myChecks[lastCheck]]; this.sentCheck = lastCheck; }
        Net.sendInput(pkt);
    }

    onRemoteInput(pkt) {
        const R = 1 - this.localSlot;
        for (let i = 0; i < pkt.b.length; i++) { const f = pkt.s + i; if (this.inputs[R][f] === undefined) this.inputs[R][f] = pkt.b[i]; }
        while (this.inputs[R][this.remoteContig + 1] !== undefined) this.remoteContig++;
        if (pkt.a > this.remoteAck) this.remoteAck = pkt.a;
        if (pkt.c) {
            const mine = this.myChecks[pkt.c[0]];
            if (mine !== undefined && mine !== pkt.c[1] && !this.desync) { this.desync = true; console.warn('[NET] DESYNC terdeteksi di frame', pkt.c[0]); }
        }
    }

    /* ---------------- PENONTON (delay 30 detik) ---------------- */
    addSpecInputs(slot, start, arr) {
        for (let i = 0; i < arr.length; i++) if (arr[i] !== null && this.inputs[slot][start + i] === undefined) this.inputs[slot][start + i] = arr[i];
        while (this.inputs[slot][this.contig[slot] + 1] !== undefined) this.contig[slot]++;
    }

    specTick() {
        const m = this.match;
        const target = Math.min(this.contig[0], this.contig[1]) - this.specDelay;
        let n = 0;
        // Fast-forward diam-diam bila tertinggal jauh (penonton yang baru masuk)
        while (m.frame <= target - 120 && n < 600) { m.step([this.inputs[0][m.frame], this.inputs[1][m.frame]]); m.events.length = 0; n++; }
        if (m.frame <= target) this.stepMatch([this.inputs[0][m.frame], this.inputs[1][m.frame]]);
        this.specBanner = m.frame > target ? `SIARAN TERTUNDA ${Math.ceil(this.specDelay / 60)} DETIK — menunggu...` : 'MODE PENONTON (delay ' + Math.ceil(this.specDelay / 60) + ' dtk)';
    }

    /* ---------------- EVENT → EFEK, SUARA, HUD ---------------- */
    consumeEvents() {
        const m = this.match;
        for (const e of m.events) {
            switch (e.type) {
                case 'hit': {
                    Effects.hitSpark(e.x, e.y, e.str, e.color);
                    AudioSys.play(e.str === 'S' ? 'hit_special' : e.special ? 'hit_special' : e.str === 'H' ? 'hit_heavy' : e.str === 'M' ? 'hit_medium' : 'hit_light');
                    if (e.str === 'H' || e.str === 'S' || e.special) Effects.shake(e.str === 'S' ? 14 : 9, 12);
                    if (e.counter) { Effects.text(e.x, e.y - 60, 'COUNTER!', '#ff4d6d', 44); AudioSys.play('counter'); }
                    const c = this.view.combo[e.slot] || (this.view.combo[e.slot] = { n: 0, t: 0, dmg: 0, pop: 0 });
                    if (e.combo === 1) c.dmg = 0;
                    c.n = e.combo; c.t = 100; c.dmg += e.dmg; c.pop = 8;
                    break;
                }
                case 'block': Effects.blockSpark(e.x, e.y); AudioSys.play('block'); break;
                case 'swing': AudioSys.play(e.str === 'H' ? 'whoosh_heavy' : 'whoosh_light'); break;
                case 'special':
                    AudioSys.play(e.kind === 'rising' ? 'rising' : 'whoosh_heavy');
                    if (e.ex) { Effects.text(e.x, e.y - 60, 'EX', '#3dfcff', 40, 30); Effects.ring(e.x, e.y, '#3dfcff', 50); }
                    break;
                case 'projectile': AudioSys.play('projectile'); break;
                case 'superStart': AudioSys.play('super_activate'); break;
                case 'jump': AudioSys.play('jump'); break;
                case 'land': Effects.dust(e.x, e.y, e.heavy ? 10 : 5); AudioSys.play('land'); if (e.heavy) Effects.shake(5, 8); break;
                case 'ko': AudioSys.play('ko'); Effects.shake(18, 24); Effects.flash('#ffffff', 8); break;
                case 'burst': AudioSys.play('burst'); Effects.ring(e.x, e.y, '#ffd23f', 60); Effects.ring(e.x, e.y, '#ffffff', 30); Effects.text(e.x, e.y - 90, 'BURST!', '#ffd23f', 42); break;
                case 'guardbreak': AudioSys.play('guardbreak'); Effects.text(e.x, e.y, 'GUARD BREAK!', '#ff7a2a', 46); break;
                case 'clash': Effects.hitSpark(e.x, e.y, 'M', '#ffffff'); AudioSys.play('block'); break;
                case 'blackout': AudioSys.play('ko'); break;
                case 'roundStart': AudioSys.say(e.label); break;
                case 'fight': AudioSys.play('round_start'); AudioSys.say('Fight!'); break;
                case 'roundEnd': if (e.timeout) AudioSys.say(e.draw ? 'Draw' : 'Time'); else AudioSys.say('K.O.'); if (e.perfect) setTimeout(() => AudioSys.say('Perfect'), 1500); break;
                case 'matchEnd': AudioSys.play('victory'); break;
            }
        }
        m.events.length = 0;
    }

    /* ---------------- RENDER ---------------- */
    render(dt) {
        const m = this.match, v = this.view, S = Settings.data;
        v.t++;
        Effects.update(dt);
        // HP bar: lapisan kuning turun perlahan setelah jeda
        for (let i = 0; i < 2; i++) {
            const hp = m.fighters[i].hp;
            if (v.disp[i] < hp || m.phase === 'intro') { v.disp[i] = hp; v.hold[i] = 0; }
            else if (v.disp[i] > hp) { if (++v.hold[i] > 30) v.disp[i] = Math.max(hp, v.disp[i] - 6); }
            const c = v.combo[i];
            if (c) { if (c.t > 0) c.t--; if (c.pop > 0) c.pop--; }
        }
        Renderer.drawFrame(this.ctx, m, this.opts.stage, v, {
            hitboxes: S.hitboxes || CONFIG.SHOW_HITBOXES, colorblind: S.colorblind,
            ping: this.mode === 'online' && S.showPing ? Net.ping : null,
            fps: S.showFps ? this.fps : null, localSlot: this.mode === 'online' ? this.localSlot : 0,
            banner: this.mode === 'spectate' ? this.specBanner : this.mode === 'replay' ? '▶ REPLAY' : (this.desync ? 'DESYNC TERDETEKSI' : null)
        });
    }

    finish() {
        this.ended = true;
        const m = this.match;
        UI.onMatchEnd(this, {
            winner: m.matchWinner,
            names: m.fighters.map((f) => f.name),
            chars: this.opts.chars,
            stats: m.stats.map((s) => Object.assign({}, s))
        });
    }

    /** Data replay (input-only, dikompres) */
    replayData() {
        const len = this.match.frame;
        return {
            v: 1, game: CONFIG.GAME_TITLE, date: new Date().toISOString(),
            chars: this.opts.chars, names: this.opts.names, stage: this.opts.stage, assist: this.opts.assist || [false, false],
            frames: len, inputs: [0, 1].map((s) => rleEncode(this.inputs[s].slice(0, len)))
        };
    }
}
