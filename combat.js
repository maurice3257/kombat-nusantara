'use strict';
/* =====================================================================
 * combat.js — Deteksi tabrakan AABB, block, damage, combo, juggle
 * ---------------------------------------------------------------------
 * Bagian dari simulasi deterministik (lihat catatan di Character.js).
 * ===================================================================== */
const Combat = {
    /** AABB: dua kotak tumpang tindih? */
    overlap(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    },

    /** Kumpulkan semua hit di frame ini, lalu terapkan bersamaan (trade mungkin terjadi) */
    resolve(m) {
        const F = m.fighters, hits = [];

        // 1) Hitbox serangan petarung vs hurtbox lawan
        for (let i = 0; i < 2; i++) {
            const att = F[i], d = F[1 - i];
            const hb = att.hitbox();
            if (!hb) continue;
            const P = att.action.def;
            let hu = d.hurtbox();
            // OTG: serangan tertentu bisa mengenai lawan yang tergeletak (1x per knockdown)
            if (!hu && P.otg && d.state === 'knockdown' && !d.otgUsed && d.stateTimer < 30) hu = d.lyingBox();
            if (hu && this.overlap(hb, hu)) hits.push({ att, d, P, src: att, box: hb, hu, srcId: att.action.id });
        }

        // 2) Proyektil vs proyektil (saling meniadakan; beam menang)
        const ps = m.projectiles;
        for (let i = 0; i < ps.length; i++) {
            for (let j = i + 1; j < ps.length; j++) {
                const a = ps[i], b = ps[j];
                if (a.dead || b.dead || a.owner === b.owner) continue;
                if (!this.overlap(this.pbox(a), this.pbox(b))) continue;
                if (a.beam && !b.beam) { b.dead = true; a.hits--; }
                else if (b.beam && !a.beam) { a.dead = true; b.hits--; }
                else { a.hits--; b.hits--; }
                if (a.hits <= 0) a.dead = true;
                if (b.hits <= 0) b.dead = true;
                m.event({ type: 'clash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            }
        }

        // 3) Proyektil vs petarung
        for (const p of ps) {
            if (p.dead || p.cool > 0) continue;
            const d = F[1 - p.owner.slot];
            const hu = d.hurtbox();
            if (!hu) continue;
            const pb = this.pbox(p);
            if (this.overlap(pb, hu)) hits.push({ att: p.owner, d, P: p.props, src: p, box: pb, hu, srcId: p.id });
        }

        for (const h of hits) this.apply(m, h);
    },

    pbox(p) { return { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h }; },

    /** Apakah bertahan berhasil? Stand block = mid & overhead, crouch block = mid & low */
    canBlock(d, P) {
        if (P.unblockable || !d.grounded) return false;
        const okState = d.state === 'idle' || d.state === 'walk' || d.state === 'crouch' || d.state === 'guard' || d.state === 'blockstun';
        if (!okState) return false;
        const holdBack = d.dir === 4 || d.dir === 1;
        const holding = (d.bits & IN.BLK) || holdBack || d.state === 'blockstun';
        if (!holding) return false;
        const crouchBlock = d.dir <= 3 || (d.state === 'blockstun' && d.crouching);
        if (P.level === 'low' && !crouchBlock) return false;
        if (P.level === 'overhead' && crouchBlock) return false;
        return true;
    },

    apply(m, h) {
        const { att, d, P, src } = h;
        if (d.state === 'ko' && d.grounded) return;
        const isProj = src !== att;

        // Catat hit pada sumber serangan
        let last;
        if (isProj) { src.hits--; src.cool = P.interval || 6; if (src.hits <= 0) src.dead = true; last = src.dead; }
        else if (att.action && att.action.id === h.srcId) {
            const a = att.action; a.hits++; a.next = a.t + (P.hitInterval || 999); a.contact = true;
            last = a.hits >= (P.hits || 1);
        } else last = true;

        const dirX = isProj ? (src.vx >= 0 ? 1 : -1) : att.facing;
        const cx = (Math.max(h.box.x, h.hu.x) + Math.min(h.box.x + h.box.w, h.hu.x + h.hu.w)) / 2;
        const cy = (Math.max(h.box.y, h.hu.y) + Math.min(h.box.y + h.box.h, h.hu.y + h.hu.h)) / 2;

        /* ---------------- DIBLOK ---------------- */
        if (this.canBlock(d, P)) {
            const chip = (P.isSpecial || P.isSuper) ? Math.max(1, Math.round(P.dmg * att.dmgMul * CONFIG.CHIP_PCT)) : 0;
            d.hp = Math.max(0, d.hp - chip);
            d.action = null;
            d.setState('blockstun'); d.stateTimer = 0;
            d.stun = P.blockstun || 12;
            d.crouching = d.dir <= 3;
            const kb = (P.kb || 300) * (last ? 1 : 0.4);
            d.vx = dirX * Math.max(kb, 260);
            // Pushback: jika bertahan di dinding, penyerang yang terdorong mundur
            if (!isProj && att.grounded && m.atWall(d)) att.vx = -dirX * Math.max(kb, 260) * 0.8;
            // Guard gauge → guard break
            d.guard += P.isSuper ? 35 : P.isSpecial ? 22 : P.str === 'H' ? 30 : P.str === 'M' ? 20 : 12;
            d.guardRegen = 45;
            att.addMeter(P.isSuper ? 0 : 3); d.addMeter(2);
            if (!isProj) m.hitstop = Math.max(m.hitstop, 5);
            m.event({ type: 'block', x: cx, y: cy, slot: d.slot, chip });
            if (d.guard >= 100) {
                d.guard = 0; d.setState('guardbreak'); d.stun = 50; d.vx = dirX * 200;
                m.event({ type: 'guardbreak', x: d.x, y: d.y - 200, slot: d.slot });
            }
            if (d.hp <= 0) m.onKO(d, att, dirX);
            return;
        }

        /* ---------------- KENA ---------------- */
        const counter = d.state === 'attack' && d.action && d.action.t <= d.action.def.startup;
        const inCombo = d.state === 'hitstun' || d.state === 'airhit' || d.state === 'guardbreak' || d.state === 'knockdown';
        d.comboTaken = inCombo ? d.comboTaken + 1 : 1;
        const n = d.comboTaken;
        // Scaling: tiap hit setelah ke-3 → -5%, minimum 70%
        const scale = n > CONFIG.COMBO_SCALE_START
            ? Math.max(CONFIG.COMBO_SCALE_MIN, 1 - CONFIG.COMBO_SCALE_STEP * (n - CONFIG.COMBO_SCALE_START)) : 1;
        const dmg = Math.max(1, Math.round(P.dmg * att.dmgMul / d.defense * scale * (counter ? 1.2 : 1)));
        d.hp = Math.max(0, d.hp - dmg);
        d.wasHit = true; d.flash = 6;
        att.stats.hits++; att.stats.damage += dmg;
        if (n > att.stats.maxCombo) att.stats.maxCombo = n;
        att.addMeter(P.isSuper ? 0 : (P.meter || 8));
        d.addMeter(Math.round(dmg / 25));
        if (d.state === 'knockdown') d.otgUsed = true;
        d.action = null;

        const launch = P.launch || (last && P.finalLaunch) || 0;
        const kd = P.knockdown || (last && P.finalKnockdown) || d.hp <= 0;
        const kb = (last && P.finalKb) ? P.finalKb : (P.kb || 300);
        d.hardKD = !!(P.isSuper || P.unblockable);

        if (!d.grounded || launch || kd || d.state === 'knockdown') {
            // Juggle: batasi berapa kali bisa disambung di udara
            if (!d.grounded && !P.ignoreJuggle && h.srcId !== d.lastJuggleSrc) { d.juggle++; d.lastJuggleSrc = h.srcId; }
            d.setState('airhit'); d.stateTimer = 0;
            d.grounded = false;
            d.vy = launch ? launch : (kd ? -460 : -380);
            d.vx = dirX * kb * 0.5;
            if (d.juggle >= CONFIG.JUGGLE_LIMIT) d.juggleLock = true;
        } else {
            d.setState('hitstun'); d.stateTimer = 0;
            d.stun = (P.hitstun || 15) + (counter ? CONFIG.COUNTER_HITSTUN : 0);
            d.vx = dirX * kb;
            if (!isProj && att.grounded && m.atWall(d)) att.vx = -dirX * kb * 0.7;
        }

        m.hitstop = Math.max(m.hitstop, isProj ? 6 : P.isSuper ? 3 : P.str === 'H' ? 10 : P.str === 'M' ? 8 : P.isSpecial ? 9 : 6);
        m.event({ type: 'hit', x: cx, y: cy, str: P.isSuper ? 'S' : P.str, slot: att.slot, target: d.slot, counter,
                  combo: n, dmg, color: att.look.fx, special: !!P.isSpecial });
        if (P.isSuper && last) m.slowmo = Math.max(m.slowmo, CONFIG.SLOWMO_FRAMES * 2);
        if (P.onHit) P.onHit(att, d, m);
        if (d.hp <= 0) m.onKO(d, att, dirX);
    }
};
