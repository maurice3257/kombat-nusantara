'use strict';
/* =====================================================================
 * match.js — Simulasi pertandingan (ronde, timer, kamera, proyektil)
 * ---------------------------------------------------------------------
 * Match.step(inputs) memajukan dunia tepat 1 frame (1/60 detik) dari
 * sepasang input. Tidak ada ketergantungan pada waktu nyata, render,
 * atau angka acak → hasil identik di setiap client (lockstep netcode),
 * dan replay cukup menyimpan daftar input.
 * ===================================================================== */
class Match {
    /**
     * cfg: { chars:[id,id], names:[n,n], stage, assist:[bool,bool] }
     */
    constructor(cfg) {
        this.cfg = cfg;
        this.frame = 0;
        this.round = 1;
        this.wins = [0, 0];
        this.events = [];             // dikonsumsi render/audio setelah tiap step
        this.actionSeq = 0;
        this.stats = [0, 1].map(() => ({ hits: 0, maxCombo: 0, damage: 0, specials: 0, supers: 0 }));
        this.meters = [0, 0];
        this.matchWinner = null;      // 0 / 1 / -1 (seri)
        this.startRound();
    }

    event(e) { this.events.push(e); }

    startRound() {
        const W = CONFIG.STAGE_WIDTH, c = W / 2;
        const same = this.cfg.chars[0] === this.cfg.chars[1];
        this.fighters = [0, 1].map((i) => new Character(charById(this.cfg.chars[i]), i, c + (i ? 230 : -230), {
            name: this.cfg.names ? this.cfg.names[i] : null,
            assist: this.cfg.assist ? this.cfg.assist[i] : false,
            stats: this.stats[i], meter: this.meters[i], alt: same && i === 1
        }));
        this.projectiles = [];
        this.hitstop = 0; this.superFreeze = 0; this.superUser = null; this.superDef = null;
        this.slowmo = 0; this.blackout = 0;
        this.phase = 'intro'; this.phaseT = 0;
        this.timer = CONFIG.ROUND_TIME; this.timerSub = 0;
        this.roundResult = null;
        this.cameraX = c - CONFIG.CANVAS_WIDTH / 2;
        const final = this.wins[0] === CONFIG.ROUNDS_TO_WIN - 1 && this.wins[1] === CONFIG.ROUNDS_TO_WIN - 1;
        this.roundLabel = final ? 'FINAL ROUND' : 'ROUND ' + this.round;
        this.event({ type: 'roundStart', round: this.round, label: this.roundLabel });
    }

    /** Majukan simulasi 1 frame */
    step(inputs) {
        this.frame++;
        const [a, b] = this.fighters;
        // Input SELALU dicatat (meski game sedang freeze) agar buffer tidak hilang
        a.readInput(inputs[0] | 0, this.frame);
        b.readInput(inputs[1] | 0, this.frame);
        if (this.phase === 'matchEnd') { this.phaseT++; a.animT++; b.animT++; return; }

        if (this.blackout > 0) { this.blackout--; return; }
        if (this.superFreeze > 0) { this.superFreeze--; if (this.superUser) this.superUser.animT++; return; }
        if (this.hitstop > 0) { this.hitstop--; return; }
        if (this.slowmo > 0) { this.slowmo--; if (this.slowmo % 2 === 1) return; }

        this.phaseT++;
        const canAct = this.phase === 'fight';
        a.canAct = canAct && a.state !== 'ko';
        b.canAct = canAct && b.state !== 'ko';

        a.update(this); b.update(this);
        a.physics(this); b.physics(this);
        this.updateProjectiles();
        this.resolvePush();
        this.updateCamera();
        this.clampBounds();
        this.updateFacing();
        if (this.phase === 'fight') Combat.resolve(this);
        this.updatePhase();
    }

    /* ---------------- PROYEKTIL ---------------- */
    spawnProjectile(c, P) {
        this.projectiles.push({
            id: ++this.actionSeq, owner: c, x: c.x + c.facing * 70, y: c.y + P.y, vx: c.facing * P.speed,
            w: P.w, h: P.h, hits: P.hits, cool: 0, life: P.life, t: 0, color: P.color, style: P.style, beam: !!P.beam,
            props: {
                dmg: P.dmg, hitstun: P.hitstun, blockstun: P.blockstun, kb: P.kb, finalKb: P.finalKb, str: 'S', isSpecial: true,
                isSuper: !!P.isSuper, level: 'mid', interval: P.interval, finalKnockdown: P.finalKnockdown, meter: 10
            }
        });
        this.event({ type: 'projectile', slot: c.slot, beam: !!P.beam, x: c.x, y: c.y + P.y });
    }

    updateProjectiles() {
        const left = this.cameraX - 250, right = this.cameraX + CONFIG.CANVAS_WIDTH + 250;
        for (const p of this.projectiles) {
            p.t++; p.life--;
            if (p.cool > 0) p.cool--;
            p.x += p.vx * DT;
            if (p.life <= 0 || p.x < left || p.x > right) p.dead = true;
        }
        this.projectiles = this.projectiles.filter((p) => !p.dead);
    }

    /* ---------------- PUSHBOX & BATAS ---------------- */
    resolvePush() {
        const [a, b] = this.fighters;
        const lying = (f) => f.state === 'knockdown' || f.state === 'getup' || (f.state === 'ko' && f.grounded);
        if (lying(a) || lying(b)) return;
        const pa = a.pushbox(), pb = b.pushbox();
        if (!Combat.overlap(pa, pb)) return;
        const dx = b.x - a.x;
        const dirv = dx > 0 ? 1 : dx < 0 ? -1 : a.facing;
        const over = (pa.w + pb.w) / 2 - Math.abs(dx);
        if (over <= 0) return;
        a.x -= dirv * over / 2;
        b.x += dirv * over / 2;
    }

    updateCamera() {
        const [a, b] = this.fighters, W = CONFIG.CANVAS_WIDTH;
        const target = (a.x + b.x) / 2 - W / 2;
        this.cameraX = Math.max(0, Math.min(CONFIG.STAGE_WIDTH - W, target));
    }

    clampBounds() {
        const M = CONFIG.WALL_MARGIN;
        const lo = this.cameraX + M, hi = this.cameraX + CONFIG.CANVAS_WIDTH - M;
        for (const f of this.fighters) {
            if (f.x < lo) { f.x = lo; if (f.vx < 0) f.vx = 0; }
            if (f.x > hi) { f.x = hi; if (f.vx > 0) f.vx = 0; }
        }
    }

    atWall(f) {
        const M = CONFIG.WALL_MARGIN + 6;
        return f.x <= this.cameraX + M || f.x >= this.cameraX + CONFIG.CANVAS_WIDTH - M;
    }

    updateFacing() {
        const [a, b] = this.fighters;
        for (const [f, o] of [[a, b], [b, a]]) {
            const s = f.state;
            if (f.grounded && (s === 'idle' || s === 'walk' || s === 'crouch' || s === 'guard' || s === 'landing' || s === 'prejump')) {
                const d = o.x - f.x;
                if (d > 2) f.facing = 1; else if (d < -2) f.facing = -1;
            }
        }
    }

    /* ---------------- SUPER & KO ---------------- */
    startSuper(c, def) {
        this.superFreeze = CONFIG.SUPER_FREEZE;
        this.superUser = c; this.superDef = def;
    }

    onKO(d, att, dirX) {
        if (d.state === 'ko') return;
        d.action = null; d.setState('ko');
        if (d.grounded) { d.grounded = false; d.vy = -520; }
        d.vx = dirX * 320;
        this.event({ type: 'ko', slot: d.slot, x: d.x, y: d.y - 100 });
    }

    /* ---------------- RONDE ---------------- */
    updatePhase() {
        const [a, b] = this.fighters;
        if (this.phase === 'intro') {
            if (this.phaseT === 60) this.event({ type: 'fight' });
            if (this.phaseT >= 84) { this.phase = 'fight'; this.phaseT = 0; }
        } else if (this.phase === 'fight') {
            if (++this.timerSub >= 60) { this.timerSub = 0; this.timer--; }
            const koA = a.hp <= 0, koB = b.hp <= 0;
            if (koA || koB || this.timer <= 0) this.endRound(koA, koB, !koA && !koB);
        } else if (this.phase === 'roundEnd') {
            const r = this.roundResult;
            if (this.phaseT === 100 && r.winner >= 0) {
                const w = this.fighters[r.winner];
                if (w.state !== 'ko') { w.action = null; w.setState('victory'); w.vx = 0; }
            }
            if (this.phaseT >= 200) this.nextRound();
        }
    }

    endRound(koA, koB, timeout) {
        const [a, b] = this.fighters;
        let winner;
        if (timeout) winner = a.hp > b.hp ? 0 : b.hp > a.hp ? 1 : -1;
        else winner = koA && koB ? -1 : koA ? 1 : 0;
        this.phase = 'roundEnd'; this.phaseT = 0;
        if (winner >= 0) this.wins[winner]++; else { this.wins[0]++; this.wins[1]++; }
        const perfect = winner >= 0 && !this.fighters[winner].wasHit;
        this.roundResult = { winner, timeout, perfect, draw: winner < 0 };
        this.meters = [a.meter, b.meter];
        if (!timeout) this.slowmo = Math.max(this.slowmo, 60);
        this.event({ type: 'roundEnd', winner, timeout, perfect, draw: winner < 0 });
    }

    nextRound() {
        const need = CONFIG.ROUNDS_TO_WIN;
        if (this.wins[0] >= need || this.wins[1] >= need) {
            this.matchWinner = this.wins[0] >= need && this.wins[1] >= need ? -1 : this.wins[0] >= need ? 0 : 1;
            this.phase = 'matchEnd'; this.phaseT = 0;
            if (this.matchWinner >= 0) {
                const w = this.fighters[this.matchWinner];
                if (w.state !== 'ko') { w.action = null; w.setState('victory'); }
            }
            this.event({ type: 'matchEnd', winner: this.matchWinner });
            return;
        }
        this.round++;
        this.startRound();
    }

    /** Hash state untuk mendeteksi desync antar client */
    checksum() {
        let h = 2166136261 >>> 0;
        const mix = (v) => { h ^= (v | 0); h = Math.imul(h, 16777619) >>> 0; };
        mix(this.frame); mix(this.round);
        for (const f of this.fighters) {
            mix(Math.round(f.x * 100)); mix(Math.round(f.y * 100)); mix(f.hp); mix(Math.round(f.meter * 10)); mix(STATES.indexOf(f.state));
        }
        mix(this.projectiles.length);
        return h;
    }
}
