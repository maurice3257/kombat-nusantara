'use strict';
/* =====================================================================
 * Character.js — Kelas dasar petarung (state machine, input, fisika)
 * ---------------------------------------------------------------------
 * PENTING UNTUK NETCODE: semua kode di file ini adalah bagian dari
 * SIMULASI DETERMINISTIK. Dilarang memakai Math.random(), Date.now(),
 * Math.sin/cos (hasilnya bisa berbeda di tiap browser). Cukup operasi
 * + - * / dan pembulatan. Dengan begitu dua client yang menerima input
 * yang sama akan menghasilkan pertandingan yang identik bit-per-bit.
 * ===================================================================== */
const DT = 1 / 60;   // fixed timestep: fisika selalu konsisten
const STATES = ['idle', 'walk', 'crouch', 'guard', 'prejump', 'jump', 'landing', 'attack', 'hitstun', 'blockstun',
    'airhit', 'knockdown', 'getup', 'guardbreak', 'ko', 'victory'];

function bitCount(n) { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; }
function strengthOf(bits) { // 0 = light, 1 = medium, 2 = heavy (ambil yang terkuat)
    if (bits & (IN.HP | IN.HK)) return 2;
    if (bits & (IN.MP | IN.MK)) return 1;
    return 0;
}
const STR_RANK = { L: 0, M: 1, H: 2 };

class Character {
    /**
     * @param def   data karakter dari ROSTER
     * @param slot  0 = P1 (kiri), 1 = P2 (kanan)
     * @param x     posisi awal
     * @param opts  {name, assist, stats, meter, alt}
     */
    constructor(def, slot, x, opts = {}) {
        this.def = def; this.slot = slot; this.name = opts.name || def.name;
        this.look = opts.alt ? Object.assign({}, def.look, def.look.alt) : def.look;

        // Posisi & gerak
        this.x = x; this.y = CONFIG.GROUND_Y; this.vx = 0; this.vy = 0;
        this.facing = slot === 0 ? 1 : -1;  // 1 = hadap kanan, -1 = hadap kiri

        // Statistik
        const s = def.stats;
        this.maxHP = s.hp; this.hp = s.hp;
        this.maxMeter = 100; this.meter = opts.meter || 0;
        this.defense = s.def; this.speed = s.speed; this.jumpPower = s.jump; this.dmgMul = s.dmg;
        this.gravity = CONFIG.GRAVITY * (s.gravity || 1);

        // State machine
        this.state = 'idle'; this.stateTimer = 0; this.grounded = true; this.crouching = false;
        this.invuln = 0; this.action = null; this.stun = 0; this.landLag = 0;
        this.kdMode = 'normal'; this.hardKD = false; this.otgUsed = false;
        this.juggle = 0; this.lastJuggleSrc = 0; this.juggleLock = false;
        this.comboTaken = 0;           // jumlah hit beruntun yang SEDANG diterima
        this.guard = 0; this.guardRegen = 0;
        this.jumpDir = 0; this.airAttackUsed = false;
        this.canAct = false;

        // Input & riwayat
        this.bits = 0; this.prev = 0; this.dir = 5; this.dirHist = []; this.pressHist = [];
        this.chargeB = 0; this.chargeD = 0; this.relB = -999; this.relBHeld = 0; this.relD = -999; this.relDHeld = 0;
        this.frame = 0; this.assist = !!opts.assist;

        this.wasHit = false;
        this.stats = opts.stats || { hits: 0, maxCombo: 0, damage: 0, specials: 0, supers: 0 };
        this.moves = buildMoveSet(def);

        // Hanya untuk render (tidak memengaruhi simulasi)
        this.flash = 0; this.animT = 0;
    }

    setState(s) { if (this.state !== s) { this.state = s; this.stateTimer = 0; } }
    addMeter(v) { this.meter = Math.min(this.maxMeter, this.meter + v); }

    /** Arah numpad relatif terhadap hadap (6 = maju, 4 = mundur) */
    static dirOf(bits, facing) {
        let h = 0, v = 0;
        if (bits & IN.LEFT) h -= 1;
        if (bits & IN.RIGHT) h += 1;
        if (bits & IN.UP) v = 1; else if (bits & IN.DOWN) v = -1;
        return 5 + h * facing + v * 3;
    }

    /* ------------------------------------------------------------------
     * INPUT: catat arah & tombol ke buffer (dipanggil SETIAP frame,
     * termasuk saat hitstop/super freeze agar input tidak hilang)
     * ------------------------------------------------------------------ */
    readInput(bits, frame) {
        this.prev = this.bits; this.bits = bits; this.frame = frame;
        const d = Character.dirOf(bits, this.facing);
        this.dir = d;
        this.dirHist.push(d);
        if (this.dirHist.length > 40) this.dirHist.shift();

        const pressed = bits & ~this.prev & IN.BUTTONS;
        if (pressed) this.pressHist.push({ f: frame, b: pressed, used: false });
        while (this.pressHist.length && frame - this.pressHist[0].f > CONFIG.INPUT_BUFFER_SIZE + 4) this.pressHist.shift();

        // Charge: hitung lama menahan belakang / bawah
        const back = d === 1 || d === 4 || d === 7, down = d <= 3;
        if (back) this.chargeB++; else { if (this.chargeB > 0) { this.relBHeld = this.chargeB; this.relB = frame; } this.chargeB = 0; }
        if (down) this.chargeD++; else { if (this.chargeD > 0) { this.relDHeld = this.chargeD; this.relD = frame; } this.chargeD = 0; }
    }

    chargeOK(kind) {
        const need = this.assist ? 15 : CONFIG.CHARGE_FRAMES;
        const cur = kind === 'B' ? this.chargeB : this.chargeD;
        if (cur >= need) return true;
        const rel = kind === 'B' ? this.relB : this.relD, held = kind === 'B' ? this.relBHeld : this.relDHeld;
        return held >= need && this.frame - rel <= 10;
    }

    /** Cek motion input (QCF, DP, dst) di riwayat arah */
    motionOK(name) {
        if (name === 'chargeBF') return this.chargeOK('B') && (this.dir === 6 || this.dir === 3 || this.dir === 9);
        if (name === 'chargeDU') return this.chargeOK('D') && this.dir >= 7;
        const seq = (this.assist ? MOTION_ASSIST : MOTIONS)[name];
        const win = name === 'qcfqcf' ? CONFIG.SUPER_MOTION_WINDOW : CONFIG.MOTION_WINDOW;
        const h = this.dirHist;
        let i = seq.length - 1;
        for (let k = h.length - 1; k >= 0 && k >= h.length - win; k--) {
            if (h[k] === seq[i]) { i--; if (i < 0) return true; }
        }
        return false;
    }

    hasProjectile(m) { return m.projectiles.some((p) => p.owner === this && !p.dead); }

    /* ------------------------------------------------------------------
     * PERINTAH: Super > Special > Heavy > Medium > Light
     * mode: 'neutral' | 'air' | 'cancelNormal' | 'cancelSpecial'
     * ------------------------------------------------------------------ */
    tryCommands(m, mode) {
        const recent = this.pressHist.filter((p) => !p.used && this.frame - p.f <= CONFIG.INPUT_BUFFER_SIZE);
        if (!recent.length) return false;
        const latest = recent[recent.length - 1];
        let combo = 0;
        for (const p of recent) if (latest.f - p.f <= 3) combo |= p.b;
        const consume = () => { for (const p of recent) if (latest.f - p.f <= 3) p.used = true; };
        const punch = combo & IN.PUNCH, kick = combo & IN.KICK;

        if (mode !== 'air') {
            // SUPER (QCF QCF + Punch, 100 meter)
            if (punch && this.meter >= CONFIG.SUPER_COST && this.motionOK('qcfqcf')) {
                consume(); this.doAction(this.moves.super, m); return true;
            }
            // SPECIAL (+ EX jika 2 tombol sejenis ditekan bersamaan & meter >= 50)
            if (mode !== 'cancelSpecial') {
                for (const sp of this.moves.specials) {
                    const btn = sp.btn === 'P' ? punch : kick;
                    if (!btn || !this.motionOK(sp.motion)) continue;
                    if (sp.kind === 'projectile' && this.hasProjectile(m)) continue;
                    const ex = bitCount(btn) >= 2 && this.meter >= CONFIG.EX_COST;
                    consume();
                    this.doAction(ex ? sp.ex : sp.v[strengthOf(btn)], m);
                    this.stats.specials++;
                    return true;
                }
            }
        }
        if (mode === 'cancelSpecial') return false;

        // NORMAL
        if (this.frame - latest.f > CONFIG.NORMAL_BUFFER) return false;
        const order = [['HP', IN.HP], ['HK', IN.HK], ['MP', IN.MP], ['MK', IN.MK], ['LP', IN.LP], ['LK', IN.LK]];
        let key = null;
        for (const [k, bit] of order) if (latest.b & bit) { key = k; break; }
        if (!key) return false;
        let id = key;
        if (mode === 'air' || !this.grounded) id = 'j' + key;
        else if (this.dir <= 3) id = 'c' + key;
        const n = this.moves.normals[id];
        if (mode === 'air' && this.airAttackUsed) return false;
        if (mode === 'cancelNormal') {
            // Chain combo: hanya boleh ke serangan normal yang lebih kuat
            if (!this.action || STR_RANK[n.str] <= STR_RANK[this.action.def.str]) return false;
        }
        latest.used = true;
        this.doAction(n, m);
        if (!this.grounded) this.airAttackUsed = true;
        return true;
    }

    /** Roman Cancel / Burst: HP + HK bersamaan saat menyerang, 50 meter */
    tryBurst(m) {
        if (this.meter < CONFIG.BURST_COST || !this.action || this.action.def.isSuper) return false;
        const both = this.pressHist.some((p) => !p.used && this.frame - p.f <= 2 && (p.b & IN.HP)) &&
                     this.pressHist.some((p) => !p.used && this.frame - p.f <= 2 && (p.b & IN.HK));
        if (!both) return false;
        for (const p of this.pressHist) if (this.frame - p.f <= 2) p.used = true;
        this.meter -= CONFIG.BURST_COST;
        this.endAction();
        this.invuln = 6;
        m.event({ type: 'burst', slot: this.slot, x: this.x, y: this.y - 100 });
        return true;
    }

    doAction(def, m) {
        this.action = { def, t: 0, hits: 0, next: 0, contact: false, id: ++m.actionSeq };
        this.state = 'attack'; this.stateTimer = 0;
        if (def.meterCost) this.meter -= def.meterCost;
        this.crouching = !!def.crouch;
        if (this.grounded) this.vx = 0;
        if (def.isSuper) { this.stats.supers++; m.startSuper(this, def); }
        m.event({ type: def.isSuper ? 'superStart' : def.isSpecial ? 'special' : 'swing', slot: this.slot, str: def.str,
                  name: def.name, ex: def.ex, kind: def.kind, x: this.x, y: this.y - 120 });
    }

    endAction() {
        this.action = null; this.stateTimer = 0;
        if (!this.grounded) this.state = 'jump';
        else if (this.dir <= 3) { this.state = 'crouch'; this.crouching = true; }
        else { this.state = 'idle'; this.crouching = false; }
    }

    updateAction(m) {
        const a = this.action, d = a.def;
        a.t++;
        if (d.onFrame) d.onFrame(this, a.t, m);
        if (d.projectile && a.t === d.startup) m.spawnProjectile(this, d.projectile);
        if (a.t >= d.startup + d.active + d.recovery) {
            if (d.untilLand && !this.grounded) return;  // tunggu mendarat
            this.endAction();
        }
    }

    /* ------------------------------------------------------------------
     * UPDATE STATE (sekali per frame simulasi)
     * ------------------------------------------------------------------ */
    update(m) {
        this.stateTimer++; this.animT++;
        if (this.invuln > 0) this.invuln--;
        if (this.flash > 0) this.flash--;
        if (this.guardRegen > 0) this.guardRegen--; else if (this.guard > 0) this.guard = Math.max(0, this.guard - 0.5);
        const can = this.canAct;

        switch (this.state) {
            case 'idle': case 'walk': case 'crouch': case 'guard':
                if (can && this.tryCommands(m, 'neutral')) break;
                if (can) this.move(); else { this.crouching = false; this.vx = 0; if (this.state !== 'idle') this.setState('idle'); }
                break;
            case 'prejump':
                if (can && this.tryCommands(m, 'neutral')) break;
                if (this.dir === 9) this.jumpDir = 1; else if (this.dir === 7) this.jumpDir = -1;
                if (this.stateTimer >= 3) {
                    this.vy = -this.jumpPower; this.vx = this.jumpDir * this.facing * this.speed * 0.62;
                    this.grounded = false; this.airAttackUsed = false; this.setState('jump');
                    m.event({ type: 'jump', x: this.x, y: this.y });
                }
                break;
            case 'jump':
                if (can) this.tryCommands(m, 'air');
                break;
            case 'landing':
                if (this.stateTimer >= this.landLag) this.setState('idle');
                break;
            case 'attack': {
                if (can && this.tryBurst(m)) break;
                this.updateAction(m);
                const a = this.action;
                if (a && can && a.contact && this.state === 'attack') {
                    if (a.def.isSuper) { /* super tidak bisa di-cancel */ }
                    else if (a.def.isSpecial) { if (a.def.cancelSuper) this.tryCommands(m, 'cancelSpecial'); }
                    else if (a.def.cancel && this.grounded) this.tryCommands(m, 'cancelNormal');
                }
                break;
            }
            case 'hitstun': case 'blockstun': case 'guardbreak':
                if (--this.stun <= 0) {
                    if (this.state !== 'blockstun') this.comboTaken = 0;
                    this.setState(this.dir <= 3 && this.state === 'blockstun' ? 'crouch' : 'idle');
                }
                break;
            case 'knockdown': {
                // Pilihan bangun: tombol = quick rise, mundur = back rise, bawah = stay down
                if (!this.hardKD && this.stateTimer < 12) {
                    if (this.bits & IN.BUTTONS) this.kdMode = 'quick';
                    else if (this.dir === 4 || this.dir === 7) this.kdMode = 'back';
                    else if (this.dir <= 3) this.kdMode = 'stay';
                }
                const dur = this.kdMode === 'quick' ? 16 : this.kdMode === 'stay' ? 60 : 36;
                if (this.stateTimer >= dur) { this.setState('getup'); this.invuln = 24; }
                break;
            }
            case 'getup':
                if (this.kdMode === 'back') this.vx = -this.facing * 260;
                if (this.stateTimer >= 20) { this.setState('idle'); this.vx = 0; this.comboTaken = 0; this.otgUsed = false; this.invuln = 3; }
                break;
        }
    }

    /** Gerak dasar: jalan, jongkok, lompat, guard */
    move() {
        const d = this.dir;
        if (this.bits & IN.BLK) { this.setState('guard'); this.crouching = d <= 3; this.vx = 0; return; }
        if (d >= 7) { this.setState('prejump'); this.jumpDir = d === 9 ? 1 : d === 7 ? -1 : 0; this.vx = 0; return; }
        if (d <= 3) { this.setState('crouch'); this.crouching = true; this.vx = 0; return; }
        this.crouching = false;
        if (d === 6) { this.setState('walk'); this.vx = this.facing * this.speed; }
        else if (d === 4) { this.setState('walk'); this.vx = -this.facing * this.speed * 0.8; }
        else { this.setState('idle'); this.vx = 0; }
    }

    /* ------------------------------------------------------------------
     * FISIKA: gravitasi, gesekan, mendarat
     * ------------------------------------------------------------------ */
    physics(m) {
        const a = this.action;
        const hover = a && a.def.hover && a.t >= a.def.hover[0] && a.t <= a.def.hover[1];
        if (!this.grounded) {
            if (!hover) {
                this.vy += this.gravity * DT;
                if (this.vy > CONFIG.MAX_FALL_SPEED) this.vy = CONFIG.MAX_FALL_SPEED;
            }
            if (this.state === 'airhit' || this.state === 'ko') this.vx *= CONFIG.FRICTION_AIR;
            this.x += this.vx * DT;
            this.y += this.vy * DT;
            if (this.y >= CONFIG.GROUND_Y && this.vy >= 0) {
                this.y = CONFIG.GROUND_Y; this.vy = 0; this.grounded = true;
                this.onLand(m);
            }
        } else {
            const keep = this.state === 'walk' || (this.state === 'getup' && this.kdMode === 'back') || (a && a.def.keepVel);
            if (!keep) this.vx *= CONFIG.FRICTION_GROUND;
            if (this.vx > -1 && this.vx < 1) this.vx = 0;
            this.x += this.vx * DT;
        }
    }

    onLand(m) {
        const s = this.state;
        this.airAttackUsed = false;
        if (s === 'airhit') {
            this.juggle = 0; this.juggleLock = false; this.lastJuggleSrc = 0;
            if (this.hp <= 0) this.setState('ko');
            else { this.setState('knockdown'); this.kdMode = 'normal'; this.otgUsed = false; }
            this.vx *= 0.5;
            m.event({ type: 'land', heavy: true, x: this.x, y: this.y });
            return;
        }
        if (s === 'ko') { this.vx *= 0.4; m.event({ type: 'land', heavy: true, x: this.x, y: this.y }); return; }
        if (s === 'attack' && this.action) {
            const d = this.action.def;
            this.action = null; this.setState('landing');
            this.landLag = d.untilLand ? (d.landLag || 10) : 3;
            this.vx = 0;
            m.event({ type: 'land', x: this.x, y: this.y });
            return;
        }
        if (s === 'jump' || s === 'prejump') {
            this.setState('landing'); this.landLag = 3; this.vx = 0;
            m.event({ type: 'land', x: this.x, y: this.y });
            return;
        }
        this.setState('idle');
    }

    /* ------------------------------------------------------------------
     * KOTAK: hurtbox (bisa kena), hitbox (menyerang), pushbox (dorong)
     * ------------------------------------------------------------------ */
    isInvuln() {
        if (this.invuln > 0) return true;
        const a = this.action;
        if (a && a.def.invuln && a.t >= a.def.invuln[0] && a.t <= a.def.invuln[1]) return true;
        return false;
    }

    hurtbox() {
        const s = this.state;
        if (s === 'knockdown' || s === 'getup' || s === 'ko' || s === 'victory') return null;
        if (this.isInvuln()) return null;
        if (s === 'airhit' && this.juggleLock) return null;
        if (!this.grounded) return { x: this.x - 30, y: this.y - 162, w: 60, h: 142 };
        const crouchy = s === 'crouch' || ((s === 'guard' || s === 'blockstun' || s === 'hitstun') && this.crouching) ||
                        (s === 'attack' && this.action && this.action.def.crouch);
        if (crouchy) return { x: this.x - 36, y: this.y - 112, w: 72, h: 112 };
        return { x: this.x - 35, y: this.y - 178, w: 70, h: 178 };
    }

    lyingBox() { return { x: this.x - 70, y: this.y - 36, w: 140, h: 36 }; }

    pushbox() {
        if (!this.grounded) return { x: this.x - 26, y: this.y - 150, w: 52, h: 130 };
        return { x: this.x - 28, y: this.y - (this.crouching ? 110 : 170), w: 56, h: this.crouching ? 110 : 170 };
    }

    hitbox() {
        const a = this.action;
        if (!a || this.state !== 'attack') return null;
        const d = a.def;
        if (d.noHitbox || !d.box) return null;
        if (a.t <= d.startup || a.t > d.startup + d.active) return null;
        if (a.hits >= (d.hits || 1) || a.t < a.next) return null;
        const b = d.box;
        const x = this.facing === 1 ? this.x + b.x : this.x - b.x - b.w;
        return { x, y: this.y + b.y, w: b.w, h: b.h };
    }
}
