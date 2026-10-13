'use strict';
/* =====================================================================
 * ai.js — Lawan CPU
 * ---------------------------------------------------------------------
 * CPU menghasilkan bitmask input persis seperti pemain manusia, jadi ia
 * tunduk pada aturan motion input yang sama (tidak "curang").
 * level: 0 = Mudah, 1 = Normal, 2 = Sulit
 * ===================================================================== */
class CPU {
    constructor(slot, level = 1, rand = Math.random) {
        this.slot = slot; this.level = level; this.rand = rand;
        this.queue = []; this.wait = 0; this.holdBits = 0; this.holdT = 0;
    }

    /** Ubah notasi numpad + tombol menjadi urutan bitmask per frame */
    seq(me, dirs, btn, framesPer = 2) {
        const fw = me.facing > 0 ? IN.RIGHT : IN.LEFT, bk = me.facing > 0 ? IN.LEFT : IN.RIGHT;
        const map = { 1: IN.DOWN | bk, 2: IN.DOWN, 3: IN.DOWN | fw, 4: bk, 5: 0, 6: fw, 7: IN.UP | bk, 8: IN.UP, 9: IN.UP | fw };
        const out = [];
        dirs.forEach((d, i) => {
            for (let k = 0; k < framesPer; k++) out.push(map[d] | (i === dirs.length - 1 && k === framesPer - 1 ? btn : 0));
        });
        out.push(map[dirs[dirs.length - 1]]);
        return out;
    }

    specialSeq(me, sp, btnBits) {
        const btn = btnBits || (sp.btn === 'P' ? [IN.LP, IN.MP, IN.HP] : [IN.LK, IN.MK, IN.HK])[Math.floor(this.rand() * 3)];
        if (sp.motion === 'chargeBF' || sp.motion === 'chargeDU') {
            const hold = sp.motion === 'chargeBF' ? 4 : 2, rel = sp.motion === 'chargeBF' ? 6 : 8;
            const s = this.seq(me, Array(CONFIG.CHARGE_FRAMES + 4).fill(hold), 0, 1);
            return s.concat(this.seq(me, [rel], btn, 1));
        }
        const m = MOTIONS[sp.motion];
        return this.seq(me, m, btn);
    }

    think(m) {
        const me = m.fighters[this.slot], op = m.fighters[1 - this.slot];
        if (m.phase !== 'fight' || me.state === 'ko') { this.queue.length = 0; return 0; }
        if (this.queue.length) return this.queue.shift();
        if (this.holdT > 0) { this.holdT--; return this.holdBits; }

        const L = this.level, r = this.rand();
        const fw = me.facing > 0 ? IN.RIGHT : IN.LEFT, bk = me.facing > 0 ? IN.LEFT : IN.RIGHT;
        const dist = Math.abs(op.x - me.x);
        const specials = me.moves.specials;
        const find = (kinds) => specials.filter((s) => kinds.includes(s.kind));
        const pick = (arr) => arr[Math.floor(this.rand() * arr.length)];
        const hold = (bits, t) => { this.holdBits = bits; this.holdT = t; return bits; };

        // Reaksi: CPU mudah lebih lambat bereaksi
        if (this.wait > 0) { this.wait--; return this.holdBits; }
        this.wait = [10, 5, 1][L];

        // 1) Ancaman: lawan menyerang dekat / proyektil datang
        const incoming = m.projectiles.find((p) => p.owner === op && Math.abs(p.x - me.x) < 340 && Math.sign(p.vx) === Math.sign(me.x - p.x));
        const attacking = op.state === 'attack' && op.action && dist < 230 && op.action.t <= op.action.def.startup + op.action.def.active;
        if ((attacking || incoming) && r < [0.25, 0.55, 0.8][L]) {
            if (incoming && dist > 280 && this.rand() < 0.4) { this.queue = this.seq(me, [9, 9, 9], 0, 4); return 0; }
            const low = op.action && op.action.def.level === 'low';
            return hold(bk | (low || op.crouching ? IN.DOWN : 0), 12);
        }

        // 2) Anti-udara
        if (!op.grounded && op.state === 'jump' && dist < 240 && r < [0.15, 0.45, 0.8][L]) {
            const rise = find(['rising']);
            if (rise.length && this.rand() < 0.7) { this.queue = this.specialSeq(me, rise[0], IN.HP | (rise[0].btn === 'K' ? IN.HK : 0)); return 0; }
            this.queue = this.seq(me, [2, 2], IN.HP); return 0;
        }

        // 3) Super jika meter penuh & cukup dekat
        if (me.meter >= 100 && dist < 360 && r < [0.05, 0.25, 0.5][L]) {
            this.queue = this.seq(me, MOTIONS.qcfqcf, IN.HP); return 0;
        }

        // 4) Jarak jauh: proyektil / maju
        if (dist > 420) {
            const proj = find(['projectile']);
            if (proj.length && !me.hasProjectile(m) && this.rand() < 0.35) { this.queue = this.specialSeq(me, proj[0]); return 0; }
            if (this.rand() < 0.15) { this.queue = this.seq(me, [9, 9, 9], 0, 3).concat(Array(24).fill(0), this.seq(me, [5], IN.HK)); return 0; }
            return hold(fw, 14);
        }

        // 5) Jarak menengah
        if (dist > 170) {
            const x = this.rand();
            if (x < 0.4) return hold(fw, 8);
            if (x < 0.55) { this.queue = this.seq(me, [5], IN.MK); return 0; }
            if (x < 0.65) { this.queue = this.seq(me, [2], IN.MK); return 0; }
            const rush = find(['rush', 'flip', 'spin']);
            if (x < 0.8 && rush.length) { this.queue = this.specialSeq(me, pick(rush)); return 0; }
            if (x < 0.9) return hold(bk, 10);
            this.queue = this.seq(me, [9, 9], 0, 3).concat(Array(22).fill(0), this.seq(me, [5], IN.HP)); return 0;
        }

        // 6) Jarak dekat: string combo
        const x = this.rand();
        if (x < 0.2) {
            const sp = pick(specials);
            this.queue = this.seq(me, [2], IN.MK).concat(Array(4).fill(0), this.specialSeq(me, sp)); return 0;
        }
        if (x < 0.35) { this.queue = this.seq(me, [5], IN.LP).concat(Array(6).fill(0), this.seq(me, [5], IN.MP), Array(9).fill(0), this.seq(me, [5], IN.HP)); return 0; }
        if (x < 0.48) { this.queue = this.seq(me, [2], IN.LK).concat(Array(6).fill(0), this.seq(me, [2], IN.MK)); return 0; }
        if (x < 0.56) { this.queue = this.seq(me, [2], IN.HK); return 0; }
        if (x < 0.66) { this.queue = this.seq(me, [5], IN.HK); return 0; }
        if (x < 0.8) return hold(bk | (this.rand() < 0.5 ? IN.DOWN : 0), 14);
        if (x < 0.9) return hold(bk, 10);
        this.queue = this.seq(me, [5], IN.MP); return 0;
    }
}
