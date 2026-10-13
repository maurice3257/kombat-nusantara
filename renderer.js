'use strict';
/* =====================================================================
 * renderer.js — Menggambar petarung (vektor prosedural), stage, HUD
 * ---------------------------------------------------------------------
 * Petarung digambar dengan "kerangka" + Inverse Kinematics 2-tulang:
 * setiap pose cukup menentukan posisi pinggul, tangan dan kaki; siku
 * dan lutut dihitung otomatis. Animasi = interpolasi antar pose
 * berdasarkan fase serangan (startup → active → recovery), sehingga
 * frame data dan visual selalu sinkron tanpa sprite sheet.
 *
 * Mau pakai sprite sheet sendiri? Ganti fungsi drawFighter() saja —
 * state & frame serangan tersedia di objek Character.
 * ===================================================================== */
const Renderer = (() => {
    const W = 1280, H = 720, GY = () => CONFIG.GROUND_Y;
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

    /* =================== POSE =================== */
    const STANCE = { hip: [-2, -88], lean: 0.12, hF: [30, -128], hB: [14, -121], fF: [24, 0], fB: [-26, 0], rot: 0, head: 0 };
    const P = (o, base = STANCE) => Object.assign({}, base, o);
    const CROUCH = P({ hip: [0, -54], lean: 0.25, hF: [30, -94], hB: [16, -88], fF: [32, 0], fB: [-28, 0] });
    const JUMP = P({ hip: [0, -92], hF: [26, -138], hB: [10, -130], fF: [18, -38], fB: [-16, -44], lean: 0.05 });
    const LYING = P({ hip: [0, -16], lean: 0, hF: [14, -118], hB: [-4, -112], fF: [8, 0], fB: [-12, 0], rot: -1.5 });
    const POSES = {
        guard: P({ hF: [26, -144], hB: [22, -126], lean: -0.05, hip: [-4, -86] }),
        cguard: P({ hF: [26, -106], hB: [20, -94], lean: 0.1 }, CROUCH),
        prejump: P({ hip: [0, -72], lean: 0.2, fF: [28, 0], fB: [-28, 0] }),
        hit: P({ hip: [-8, -88], lean: -0.35, hF: [6, -122], hB: [-8, -110], head: -0.3 }),
        chit: P({ lean: -0.15, hF: [16, -96], hB: [0, -90] }, CROUCH),
        airhit: P({ hip: [0, -90], lean: -0.5, hF: [-10, -150], hB: [-30, -140], fF: [30, -30], fB: [10, -16], rot: -0.6 }),
        victory: P({ hip: [0, -90], lean: -0.05, hF: [8, -220], hB: [24, -112], fF: [20, 0], fB: [-24, 0] }),
        dizzy: P({ hip: [0, -86], lean: -0.15, hF: [20, -92], hB: [0, -86], head: 0.4 }),
        jab: P({ hF: [76, -136], lean: 0.2 }),
        straight: P({ hF: [86, -132], hB: [8, -118], lean: 0.28, hip: [6, -86], fF: [32, 0] }),
        fierce: P({ hB: [94, -138], hF: [16, -118], lean: 0.38, hip: [12, -84], fF: [38, 0], fB: [-22, 0] }),
        lowkick: P({ fF: [74, -60], hip: [-6, -90], lean: -0.05 }),
        midkick: P({ fF: [90, -106], hip: [-10, -92], lean: -0.2 }),
        highkick: P({ fF: [86, -164], hip: [-12, -94], lean: -0.4, hF: [6, -118] }),
        cjab: P({ hF: [70, -98] }, CROUCH),
        cstraight: P({ hF: [82, -96], lean: 0.38 }, CROUCH),
        uppercut: P({ hF: [26, -208], hB: [10, -118], hip: [8, -86], lean: 0.08, fF: [28, 0] }),
        clowkick: P({ fF: [84, -6], lean: 0.15 }, CROUCH),
        cmidkick: P({ fF: [100, -8], hip: [-12, -48], lean: -0.2 }, CROUCH),
        sweep: P({ fF: [114, -4], hip: [-18, -40], lean: -0.35, hB: [-34, -8], hF: [6, -70] }, CROUCH),
        jpunch: P({ hF: [68, -104], lean: 0.3 }, JUMP),
        jkick: P({ fF: [72, -34], fB: [-6, -62], lean: -0.1 }, JUMP),
        fireball: P({ hF: [76, -112], hB: [70, -106], hip: [8, -80], lean: 0.22, fF: [38, 0], fB: [-36, 0] }),
        windup: P({ hF: [-12, -104], hB: [-18, -98], hip: [-4, -80], lean: -0.05, fF: [36, 0], fB: [-36, 0] }),
        rising: P({ hF: [22, -212], hB: [10, -140], fF: [24, -40], fB: [-8, -4], lean: 0.12 }),
        spin: P({ fF: [100, -114], fB: [-14, -46], hF: [40, -152], hB: [-36, -150], hip: [0, -92], lean: -0.1 }),
        rush: P({ hip: [0, -64], lean: 1.2, hF: [94, -76], hB: [88, -68], fF: [-52, -44], fB: [-64, -34] }),
        dash: P({ hip: [6, -80], lean: 0.55, hF: [82, -128], hB: [72, -116], fF: [40, 0], fB: [-40, -10] }),
        flipkick: P({ hip: [0, -92], fF: [52, -12], fB: [-10, -52], lean: -0.2, hF: [0, -152], hB: [-20, -142] })
    };

    function blend(a, b, t) {
        const o = {};
        for (const k in a) {
            const va = a[k], vb = b[k] !== undefined ? b[k] : va;
            o[k] = Array.isArray(va) ? [lerp(va[0], vb[0], t), lerp(va[1], vb[1], t)] : lerp(va, vb, t);
        }
        return o;
    }
    function bob(p, t, amp = 2) {
        const s = Math.sin(t * 0.12) * amp;
        return P({ hip: [p.hip[0], p.hip[1] + s], hF: [p.hF[0], p.hF[1] + s * 1.3], hB: [p.hB[0], p.hB[1] + s * 1.3] }, p);
    }
    function walkPose(t, dir) {
        const ph = t * 0.24 * dir, s = Math.sin(ph), c = Math.cos(ph);
        return P({ hip: [0, -88 - Math.abs(s) * 2], fF: [22 + s * 18, -Math.max(0, c) * 10], fB: [-24 - s * 18, -Math.max(0, -c) * 10],
            hF: [30 - s * 4, -128], hB: [14 + s * 4, -121] });
    }

    function attackPose(c) {
        const a = c.action, d = a.def, t = a.t;
        const base = !c.grounded && !d.untilLand ? JUMP : d.crouch ? CROUCH : STANCE;
        const end1 = d.startup, end2 = d.startup + d.active;
        let k = t <= end1 ? t / Math.max(1, end1) : t <= end2 ? 1 : 1 - (t - end2) / Math.max(1, d.recovery);
        k = clamp(k, 0, 1);
        const extra = {};
        switch (d.pose) {
            case 'fireball': {
                if (t <= end1) return { p: blend(base, POSES.windup, Math.min(1, t / (end1 * 0.7))) };
                return { p: blend(STANCE, POSES.fireball, clamp(1 - (t - end1 - 10) / 20, 0, 1)) };
            }
            case 'rising':
                if (t <= end1) return { p: blend(STANCE, CROUCH, t / Math.max(1, end1)) };
                return { p: c.grounded ? blend(POSES.rising, STANCE, clamp((t - end2) / 10, 0, 1)) : POSES.rising };
            case 'spin':
                if (t <= end1) return { p: blend(STANCE, CROUCH, t / end1) };
                return { p: c.grounded ? STANCE : POSES.spin, spin: t <= end2 ? Math.cos(t * 0.7) : 1 };
            case 'rush':
                if (t <= end1) return { p: blend(STANCE, POSES.prejump, t / end1) };
                if (t <= end2) return { p: POSES.rush, roll: t * 0.9 };
                return { p: blend(POSES.rush, STANCE, clamp((t - end2) / 10, 0, 1)) };
            case 'dash':
                return { p: blend(STANCE, POSES.dash, t <= end1 ? t / end1 : t <= end2 ? 1 : k) };
            case 'flip':
                if (c.grounded && t < 6) return { p: blend(STANCE, POSES.prejump, t / 5) };
                if (t < end1) return { p: JUMP, rot: (t - 5) * 0.33 };
                return { p: POSES.flipkick };
            case 'multikick': {
                if (t <= end1 || t > end2) return { p: blend(STANCE, POSES.midkick, k) };
                const hts = [-64, -112, -150, -96];
                return { p: P({ fF: [88, hts[Math.floor(t / 3) % 4]], hip: [-10, -92], lean: -0.22 }) };
            }
            case 'multipunch': {
                if (t <= end1 || t > end2) return { p: blend(STANCE, POSES.straight, k) };
                const alt = Math.floor(t / 3) % 2;
                return { p: P({ hF: alt ? [88, -138] : [30, -124], hB: alt ? [20, -118] : [86, -122], lean: 0.3, hip: [8, -86], fF: [34, 0] }) };
            }
        }
        const strike = POSES[d.pose] || POSES.jab;
        return { p: blend(base, strike, k), extra };
    }

    function poseOf(c) {
        const t = c.animT, s = c.state;
        switch (s) {
            case 'idle': return { p: bob(STANCE, t) };
            case 'walk': return { p: walkPose(t, c.vx * c.facing >= 0 ? 1 : -1) };
            case 'crouch': return { p: blend(STANCE, bob(CROUCH, t, 1), clamp(c.stateTimer / 4, 0, 1)) };
            case 'guard': return { p: c.crouching ? POSES.cguard : POSES.guard };
            case 'blockstun': return { p: c.crouching ? POSES.cguard : P({ lean: -0.15 }, POSES.guard) };
            case 'prejump': case 'landing': return { p: POSES.prejump };
            case 'jump': return { p: JUMP, rot: c.jumpDir !== 0 ? clamp((c.vy + c.jumpPower) / (c.jumpPower * 2), 0, 1) * Math.PI * 2 * c.jumpDir : 0 }; // salto saat lompat diagonal
            case 'hitstun': return { p: c.crouching ? POSES.chit : POSES.hit };
            case 'airhit': return { p: POSES.airhit };
            case 'ko': return { p: c.grounded ? LYING : POSES.airhit };
            case 'knockdown': return { p: LYING };
            case 'getup': return { p: blend(LYING, STANCE, clamp(c.stateTimer / 20, 0, 1)) };
            case 'guardbreak': return { p: POSES.dizzy, dizzy: true };
            case 'victory': return { p: bob(POSES.victory, t, 3) };
            case 'attack': if (c.action) return attackPose(c); break;
        }
        return { p: STANCE };
    }

    /* =================== IK & GAMBAR TUBUH =================== */
    function ik(ax, ay, tx, ty, l1, l2, bend) {
        let dx = tx - ax, dy = ty - ay, d = Math.hypot(dx, dy);
        const max = l1 + l2 - 0.5;
        if (d > max) { dx *= max / d; dy *= max / d; d = max; }
        if (d < 1) d = 1;
        const a = Math.atan2(dy, dx);
        const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
        const ang = a + bend * Math.acos(cosA);
        return [ax + Math.cos(ang) * l1, ay + Math.sin(ang) * l1, ax + dx, ay + dy];
    }

    function shade(hex, amt) {
        if (!hex || hex[0] !== '#') return hex;
        let n = parseInt(hex.slice(1), 16);
        let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        const f = (v) => clamp(Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt), 0, 255);
        return '#' + ((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1);
    }

    const OUT = '#120d16';
    function seg(ctx, x1, y1, x2, y2, w, col) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = OUT; ctx.lineWidth = w + 5;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    function dot(ctx, x, y, r, col) {
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 6.283); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }

    /**
     * Gambar 1 petarung. (x,y) = posisi kaki di layar.
     * opts: { scale, time, glow }
     */
    function drawFighter(ctx, c, x, y, opts = {}) {
        const look = c.look || c.def.look;
        const female = !!c.def.female;
        const pr = poseOf(c), p = pr.p;
        const t = opts.time !== undefined ? opts.time : c.animT;
        const white = c.flash > 3;
        const col = (v) => (white ? '#ffffff' : v);

        ctx.save();
        ctx.translate(x, y);
        if (opts.scale) ctx.scale(opts.scale, opts.scale);
        let sx = c.facing;
        if (pr.spin !== undefined) { const s = pr.spin; sx *= (s >= 0 ? 1 : -1) * Math.max(0.2, Math.abs(s)); }
        ctx.scale(sx, 1);
        const rot = (p.rot || 0) + (pr.rot || 0);
        if (rot) { ctx.translate(p.hip[0], p.hip[1]); ctx.rotate(rot); ctx.translate(-p.hip[0], -p.hip[1]); }

        // Aura super / EX
        if (opts.glow) {
            ctx.save();
            ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 0.5);
            const g = ctx.createRadialGradient(0, -95, 10, 0, -95, 130);
            g.addColorStop(0, look.fx); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g; ctx.fillRect(-140, -240, 280, 260);
            ctx.restore();
        }

        const [hx, hy] = p.hip;
        const L = p.lean, tx = Math.sin(L), ty = -Math.cos(L);
        const torsoLen = 58;
        const sh = [hx + tx * 50, hy + ty * 50];
        const neck = [hx + tx * torsoLen, hy + ty * torsoLen];
        const head = [hx + tx * 74, hy + ty * 74];
        const skin = col(look.skin), pants = col(look.pants), gi = col(look.top || look.gi);
        const glove = col(look.glove || look.skin);
        const foot = look.feet === 'boots' ? col(look.boot) : skin;
        const armUpCol = look.sleeves === 'none' || look.sleeves === 'tank' ? skin : gi;
        const back = (v) => (white ? '#e8e8e8' : shade(v, -0.28));

        const legF = ik(hx, hy, p.fF[0], p.fF[1], 48, 46, -1);
        const legB = ik(hx, hy, p.fB[0], p.fB[1], 48, 46, -1);
        const armF = ik(sh[0], sh[1], p.hF[0], p.hF[1], 32, 31, 1);
        const armB = ik(sh[0], sh[1], p.hB[0], p.hB[1], 32, 31, 1);

        const drawArm = (A, front) => {
            const c1 = front ? armUpCol : back(armUpCol), c2 = front ? skin : back(skin), cg = front ? glove : back(glove);
            seg(ctx, sh[0], sh[1], A[0], A[1], 14, c1);
            seg(ctx, A[0], A[1], A[2], A[3], 12, c2);
            if (look.sleeves === 'short') seg(ctx, sh[0], sh[1], lerp(sh[0], A[0], 0.6), lerp(sh[1], A[1], 0.6), 16, front ? gi : back(gi));
            dot(ctx, A[2], A[3], 8, cg);
        };
        const drawLeg = (Lg, front) => {
            const cp = front ? pants : back(pants), cf = front ? foot : back(foot);
            seg(ctx, hx, hy, Lg[0], Lg[1], 19, cp);
            seg(ctx, Lg[0], Lg[1], Lg[2], Lg[3], 16, cp);
            seg(ctx, Lg[2] - 2, Lg[3] - 2, Lg[2] + 14, Lg[3] + 1, 9, cf);
        };

        drawArm(armB, false);
        drawLeg(legB, false);

        // Torso
        const tw = female ? 25 : 30;
        seg(ctx, hx, hy, neck[0], neck[1], tw, gi);
        if (!look.top && look.sleeves !== 'tank') { // kerah gi (V)
            ctx.strokeStyle = white ? '#fff' : shade(look.gi, -0.25); ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(neck[0] + 6, neck[1] + 2); ctx.lineTo(hx + tx * 30 + 8, hy + ty * 30); ctx.stroke();
        }
        // Sabuk
        if (look.belt) {
            seg(ctx, hx - tx * 1, hy - ty * 1, hx + tx * 6, hy + ty * 6, tw + 2, col(look.belt));
            ctx.strokeStyle = col(look.belt); ctx.lineWidth = 5; ctx.lineCap = 'round';
            const sw = Math.sin(t * 0.2) * 4;
            ctx.beginPath(); ctx.moveTo(hx - 10, hy - 2); ctx.lineTo(hx - 22, hy + 16 + sw); ctx.stroke();
        }
        drawLeg(legF, true);

        // Leher & kepala
        seg(ctx, neck[0], neck[1], head[0], head[1], 10, skin);
        drawHead(ctx, head[0], head[1], look, t, white, p.head || 0, pr.dizzy);
        drawArm(armF, true);

        // Efek api (jurus flame)
        if (c.action && c.action.def.fx === 'flame' && c.state === 'attack' && c.action.t > c.action.def.startup) {
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < 6; i++) {
                const fx = p.hF[0] + Math.sin(t * 0.9 + i) * 10, fy = p.hF[1] + i * 14;
                const g = ctx.createRadialGradient(fx, fy, 2, fx, fy, 26 - i * 2);
                g.addColorStop(0, 'rgba(255,240,180,0.9)'); g.addColorStop(0.5, 'rgba(255,120,20,0.6)'); g.addColorStop(1, 'rgba(255,40,0,0)');
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fx, fy, 26 - i * 2, 0, 6.283); ctx.fill();
            }
            ctx.globalCompositeOperation = 'source-over';
        }
        ctx.restore();
    }

    function drawHead(ctx, x, y, look, t, white, tilt, dizzy) {
        const hair = white ? '#ffffff' : look.hair, skin = white ? '#ffffff' : look.skin;
        const r = 15;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(tilt * 0.4);
        // Rambut belakang (digambar sebelum kepala)
        ctx.fillStyle = hair; ctx.strokeStyle = OUT; ctx.lineWidth = 2.5;
        if (look.hairStyle === 'long') {
            ctx.beginPath(); ctx.moveTo(-6, -14); ctx.quadraticCurveTo(-30, 0 + Math.sin(t * 0.15) * 3, -22, 26); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (look.hairStyle === 'braids') {
            for (let i = 0; i < 2; i++) {
                const sw = Math.sin(t * 0.18 + i) * 6;
                ctx.strokeStyle = OUT; ctx.lineWidth = 9; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(-10, -2 + i * 4); ctx.quadraticCurveTo(-24, 20, -30 + sw, 46 + i * 4); ctx.stroke();
                ctx.strokeStyle = hair; ctx.lineWidth = 5;
                ctx.beginPath(); ctx.moveTo(-10, -2 + i * 4); ctx.quadraticCurveTo(-24, 20, -30 + sw, 46 + i * 4); ctx.stroke();
            }
        }
        // Kepala
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(0, 0, r + 2.5, 0, 6.283); ctx.fill();
        ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
        // Mata & alis
        ctx.fillStyle = '#fff'; ctx.fillRect(6, -4, 6, 4);
        ctx.fillStyle = '#111'; ctx.fillRect(9, -4, 3, 4);
        ctx.fillRect(5, -8, 8, 2);
        // Rambut atas
        ctx.fillStyle = hair; ctx.strokeStyle = OUT; ctx.lineWidth = 2.5;
        ctx.beginPath();
        switch (look.hairStyle) {
            case 'spiky':
                ctx.moveTo(-15, 2); ctx.lineTo(-26, -6); ctx.lineTo(-14, -12); ctx.lineTo(-22, -24); ctx.lineTo(-6, -17); ctx.lineTo(-6, -32);
                ctx.lineTo(4, -18); ctx.lineTo(12, -28); ctx.lineTo(13, -13); ctx.lineTo(16, -6); ctx.lineTo(-2, -9); ctx.closePath(); break;
            case 'flattop':
                ctx.moveTo(-15, 0); ctx.lineTo(-15, -26); ctx.lineTo(15, -26); ctx.lineTo(15, -8); ctx.lineTo(-4, -10); ctx.lineTo(-8, 0); ctx.closePath(); break;
            case 'buns':
                ctx.arc(0, -2, r + 1, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.arc(-11, -15, 8, 0, 6.283); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.arc(7, -18, 8, 0, 6.283); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#fff'; ctx.fillRect(-15, -12, 8, 3); ctx.fillRect(3, -15, 8, 3);
                ctx.beginPath(); break;
            default: // short, long, braids
                ctx.arc(0, -1, r + 1.5, Math.PI * 0.95, Math.PI * 1.9); ctx.lineTo(-4, -6); ctx.closePath();
        }
        ctx.fill(); ctx.stroke();
        // Ikat kepala + ekor berkibar
        if (look.band) {
            const band = white ? '#fff' : look.band;
            ctx.strokeStyle = OUT; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-15, -6); ctx.lineTo(15, -8); ctx.stroke();
            ctx.strokeStyle = band; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-15, -6); ctx.lineTo(15, -8); ctx.stroke();
            for (let i = 0; i < 2; i++) {
                const w = Math.sin(t * 0.25 + i * 1.3) * 5;
                ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-15, -6); ctx.quadraticCurveTo(-28, -8 + w, -40 - i * 4, -2 + w + i * 6); ctx.stroke();
            }
        }
        ctx.restore();
        if (dizzy) { // bintang pusing
            for (let i = 0; i < 3; i++) {
                const a = t * 0.15 + i * 2.1;
                star(ctx, x + Math.cos(a) * 24, y - 26 + Math.sin(a) * 6, 6, '#ffe14d');
            }
        }
    }

    function star(ctx, x, y, r, col) {
        ctx.fillStyle = col; ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
            ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
    }

    /* =================== PROYEKTIL =================== */
    function drawProjectile(ctx, p, cam, t) {
        const x = p.x - cam, y = p.y, dir = p.vx >= 0 ? 1 : -1;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        if (p.style === 'beam') {
            const len = Math.min(900, 60 + p.t * 40), h = p.h * (0.85 + 0.15 * Math.sin(t * 1.3));
            const x0 = x - dir * len;
            const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
            g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.3, p.color); g.addColorStop(0.5, '#ffffff');
            g.addColorStop(0.7, p.color); g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(Math.min(x0, x), y - h / 2, Math.abs(x - x0), h);
            const hg = ctx.createRadialGradient(x, y, 5, x, y, h * 0.8);
            hg.addColorStop(0, '#fff'); hg.addColorStop(0.4, p.color); hg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(x, y, h * 0.8, 0, 6.283); ctx.fill();
        } else if (p.style === 'wave') {
            for (let i = 0; i < 3; i++) {
                ctx.strokeStyle = p.color; ctx.globalAlpha = 1 - i * 0.3; ctx.lineWidth = 8 - i * 2;
                ctx.beginPath(); ctx.ellipse(x - dir * i * 14, y, 12, 30 - i * 3, 0, -Math.PI / 2, Math.PI / 2, dir < 0); ctx.stroke();
            }
            ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.ellipse(x, y, 5, 22, 0, 0, 6.283); ctx.fill();
        } else {
            const r = p.w * 0.55;
            for (let i = 1; i <= 5; i++) { // ekor energi
                ctx.globalAlpha = 0.18 * (6 - i) / 5;
                ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x - dir * i * 12, y + Math.sin(t * 0.8 + i) * 3, r * (1 - i * 0.12), 0, 6.283); ctx.fill();
            }
            ctx.globalAlpha = 1;
            const g = ctx.createRadialGradient(x, y, 2, x, y, r * 1.3);
            g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.3, 0, 6.283); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x, y, r * 0.7, t * 0.4, t * 0.4 + 2); ctx.stroke();
        }
        ctx.restore();
    }

    /* =================== STAGE (3 layer parallax) =================== */
    function floor(ctx, cam, top, cA, cB, seam, spacing) {
        const g = ctx.createLinearGradient(0, top, 0, H);
        g.addColorStop(0, cA); g.addColorStop(1, cB);
        ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
        ctx.strokeStyle = seam; ctx.lineWidth = 2;
        // garis perspektif: bagian atas bergerak lebih lambat dari bawah
        const start = Math.floor((cam * 0.7) / spacing) - 2;
        for (let i = start; i < start + Math.ceil(W / spacing) + 6; i++) {
            const xt = i * spacing - cam * 0.7, xb = (i * spacing - cam * 0.7) * 1.6 - W * 0.3 - cam * 0.25;
            ctx.beginPath(); ctx.moveTo(xt, top); ctx.lineTo(xb, H); ctx.stroke();
        }
        for (let j = 1; j < 5; j++) {
            const yy = top + (H - top) * (j * j) / 25;
            ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
        }
    }

    function crowd(ctx, cam, factor, baseY, count, colors, t, seed, scale = 1) {
        const span = CONFIG.STAGE_WIDTH * factor + W;
        for (let i = 0; i < count; i++) {
            const hx = hash(i + seed) * span - cam * factor;
            if (hx < -40 || hx > W + 40) continue;
            const hop = Math.max(0, Math.sin(t * (0.08 + hash(i + seed + 9) * 0.1) + i)) * 6 * scale;
            const y = baseY + hash(i + seed + 3) * 18 - hop;
            ctx.fillStyle = colors[i % colors.length];
            ctx.beginPath(); ctx.ellipse(hx, y + 26 * scale, 16 * scale, 24 * scale, 0, 0, 6.283); ctx.fill();
            ctx.beginPath(); ctx.arc(hx, y, 10 * scale, 0, 6.283); ctx.fill();
            if (hash(i + seed + 5) > 0.75) { // tangan diangkat
                ctx.strokeStyle = colors[i % colors.length]; ctx.lineWidth = 5 * scale; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(hx + 10 * scale, y + 16 * scale); ctx.lineTo(hx + 16 * scale, y - 14 * scale - hop); ctx.stroke();
            }
        }
    }

    const stages = {
        dojo(ctx, cam, t, fg) {
            if (fg) { // foreground: tiang kayu
                for (let i = 0; i < 4; i++) {
                    const x = i * 900 - cam * 1.35 + 200;
                    if (x < -80 || x > W + 80) continue;
                    ctx.fillStyle = '#2a170c'; ctx.fillRect(x, 0, 46, H);
                    ctx.fillStyle = '#3e2414'; ctx.fillRect(x + 6, 0, 10, H);
                }
                return;
            }
            const g = ctx.createLinearGradient(0, 0, 0, 420);
            g.addColorStop(0, '#2b1640'); g.addColorStop(0.6, '#c45a5a'); g.addColorStop(1, '#f6a96b');
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, 430);
            ctx.fillStyle = 'rgba(255,230,190,0.85)'; ctx.beginPath(); ctx.arc(900 - cam * 0.05, 250, 60, 0, 6.283); ctx.fill();
            ctx.fillStyle = '#4b2d4f'; ctx.beginPath(); ctx.moveTo(0, 430);
            for (let x = 0; x <= W + 100; x += 100) ctx.lineTo(x, 300 + hash(Math.floor((x + cam * 0.15) / 100)) * 90 - ((cam * 0.15) % 100));
            ctx.lineTo(W, 430); ctx.fill();
            // dinding dojo + pintu geser (shoji)
            const f = 0.6, off = -cam * f;
            ctx.fillStyle = '#5c3820'; ctx.fillRect(0, 150, W, 300);
            for (let i = -1; i < 22; i++) {
                const x = i * 140 + (off % 140);
                ctx.fillStyle = '#f3e6c8'; ctx.fillRect(x + 10, 175, 120, 230);
                ctx.strokeStyle = '#6b4226'; ctx.lineWidth = 3;
                for (let k = 1; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x + 10 + k * 40, 175); ctx.lineTo(x + 10 + k * 40, 405); ctx.stroke(); }
                for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(x + 10, 175 + k * 46); ctx.lineTo(x + 130, 175 + k * 46); ctx.stroke(); }
            }
            ctx.fillStyle = '#3a2213'; ctx.fillRect(0, 140, W, 18); ctx.fillRect(0, 405, W, 18);
            // pohon sakura bayangan + spanduk
            ctx.fillStyle = 'rgba(255,170,200,0.9)';
            for (let i = 0; i < 9; i++) { const x = i * 260 - cam * 0.6 + 60; ctx.beginPath(); ctx.arc(x, 150, 48, 0, 6.283); ctx.arc(x + 40, 130, 38, 0, 6.283); ctx.fill(); }
            crowd(ctx, cam, 0.8, 410, 70, ['#1d1220', '#2a1a2a', '#24152b'], t, 11, 1.1);
            floor(ctx, cam, 470, '#cdb57c', '#9c8150', 'rgba(80,60,30,0.45)', 160);
            // kelopak sakura
            ctx.fillStyle = '#ffc1d9';
            for (let i = 0; i < 40; i++) {
                const px = ((hash(i) * 1600 + t * (0.6 + hash(i + 2)) * 1.2 - cam * 0.9) % 1500 + 1500) % 1500 - 100;
                const py = ((hash(i + 7) * 700 + t * (0.8 + hash(i + 3))) % 760) - 20;
                ctx.beginPath(); ctx.ellipse(px, py, 5, 3, t * 0.05 + i, 0, 6.283); ctx.fill();
            }
        },
        temple(ctx, cam, t, fg) {
            if (fg) {
                for (let i = 0; i < 4; i++) {
                    const x = i * 820 - cam * 1.35 + 120;
                    if (x < -80 || x > W + 80) continue;
                    ctx.fillStyle = '#5a0c0c'; ctx.fillRect(x, 0, 52, H);
                    ctx.fillStyle = '#d4a017'; ctx.fillRect(x - 4, 60, 60, 12); ctx.fillRect(x - 4, H - 140, 60, 12);
                }
                return;
            }
            const g = ctx.createLinearGradient(0, 0, 0, 470);
            g.addColorStop(0, '#2a0606'); g.addColorStop(1, '#7a1414');
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, 470);
            // jendela bulat + naga (layer jauh)
            const wx = 640 - cam * 0.2 + 200;
            ctx.fillStyle = '#d4a017'; ctx.beginPath(); ctx.arc(wx, 210, 150, 0, 6.283); ctx.fill();
            ctx.fillStyle = '#3d0808'; ctx.beginPath(); ctx.arc(wx, 210, 138, 0, 6.283); ctx.fill();
            ctx.strokeStyle = '#e8b923'; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.beginPath();
            for (let i = 0; i <= 40; i++) {
                const a = i / 40, xx = wx - 120 + a * 240, yy = 210 + Math.sin(a * 9 + t * 0.03) * 50 * (1 - Math.abs(a - 0.5));
                i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
            }
            ctx.stroke();
            ctx.fillStyle = '#e8b923'; ctx.beginPath(); ctx.arc(wx + 120, 210 + Math.sin(9 + t * 0.03) * 0, 18, 0, 6.283); ctx.fill();
            // pilar tengah
            for (let i = -1; i < 16; i++) {
                const x = i * 220 + ((-cam * 0.55) % 220);
                ctx.fillStyle = '#9b1b1b'; ctx.fillRect(x, 60, 34, 420);
                ctx.fillStyle = '#d4a017'; ctx.fillRect(x - 4, 60, 42, 10); ctx.fillRect(x - 4, 440, 42, 10);
            }
            ctx.fillStyle = '#d4a017'; ctx.fillRect(0, 50, W, 14);
            // lentera berayun
            for (let i = 0; i < 12; i++) {
                const x = i * 210 - cam * 0.7 + 100, sw = Math.sin(t * 0.04 + i) * 0.15;
                if (x < -60 || x > W + 60) continue;
                ctx.save(); ctx.translate(x, 64); ctx.rotate(sw);
                ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 60); ctx.stroke();
                const lg = ctx.createRadialGradient(0, 90, 5, 0, 90, 60); lg.addColorStop(0, 'rgba(255,200,80,0.6)'); lg.addColorStop(1, 'rgba(255,100,0,0)');
                ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(0, 90, 60, 0, 6.283); ctx.fill();
                ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.ellipse(0, 90, 22, 30, 0, 0, 6.283); ctx.fill();
                ctx.fillStyle = '#d4a017'; ctx.fillRect(-12, 58, 24, 6); ctx.fillRect(-12, 116, 24, 6);
                ctx.restore();
            }
            crowd(ctx, cam, 0.8, 405, 60, ['#3a0b0b', '#2b0808', '#4a1a0a'], t, 31, 1.1);
            floor(ctx, cam, 470, '#7b6a5a', '#3f342b', 'rgba(20,10,5,0.4)', 120);
        },
        neon(ctx, cam, t, fg) {
            if (fg) {
                ctx.fillStyle = '#05050a';
                for (let i = 0; i < 6; i++) {
                    const x = i * 520 - cam * 1.4 + 300;
                    if (x < -100 || x > W + 100) continue;
                    ctx.fillRect(x, H - 40, 140, 40); ctx.fillRect(x + 20, H - 70, 10, 30); ctx.fillRect(x + 110, H - 70, 10, 30);
                }
                return;
            }
            const g = ctx.createLinearGradient(0, 0, 0, 480);
            g.addColorStop(0, '#05021a'); g.addColorStop(1, '#3a0f5c');
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, 480);
            for (let i = 0; i < 90; i++) {
                ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.7 * Math.abs(Math.sin(t * 0.03 + i))})`;
                ctx.fillRect((hash(i) * 2400 - cam * 0.05) % W, hash(i + 1) * 260, 2, 2);
            }
            // skyline jauh
            for (let i = 0; i < 40; i++) {
                const x = i * 70 - cam * 0.2, h = 120 + hash(i + 50) * 220;
                if (x < -80 || x > W + 10) continue;
                ctx.fillStyle = '#120a28'; ctx.fillRect(x, 470 - h, 64, h);
                ctx.fillStyle = 'rgba(255,220,120,0.6)';
                for (let wy = 470 - h + 10; wy < 450; wy += 18) for (let wx = 6; wx < 58; wx += 14) if (hash(i * 31 + wy + wx) > 0.6) ctx.fillRect(x + wx, wy, 6, 8);
            }
            // fasad kasino
            const cx = 600 - cam * 0.55;
            ctx.fillStyle = '#1a0b2e'; ctx.fillRect(cx - 360, 120, 1200, 360);
            const flick = Math.sin(t * 0.7) > -0.9 ? 1 : 0.3;
            const neon = (txt, x, y, col, size) => {
                ctx.save(); ctx.font = `bold ${size}px "Russo One", Impact, sans-serif`; ctx.textAlign = 'center';
                ctx.shadowColor = col; ctx.shadowBlur = 25; ctx.fillStyle = col; ctx.globalAlpha = flick;
                ctx.fillText(txt, x, y); ctx.restore();
            };
            neon('KASINO', cx + 240, 210, '#ff3df2', 72);
            neon('★ 24 JAM ★', cx - 150, 190, '#3dfcff', 34);
            neon('JACKPOT', cx + 640, 200, '#ffe03d', 44);
            for (let i = 0; i < 26; i++) { // lampu marquee
                const on = (Math.floor(t / 6) + i) % 3 === 0;
                ctx.fillStyle = on ? '#fff59d' : '#5c4b1a';
                ctx.beginPath(); ctx.arc(cx - 330 + i * 46, 260, 7, 0, 6.283); ctx.fill();
            }
            crowd(ctx, cam, 0.8, 400, 70, ['#140a24', '#1e0f33', '#0e0818'], t, 51, 1.1);
            ctx.fillStyle = '#2a2a3a'; ctx.fillRect(0, 452, W, 14);
            floor(ctx, cam, 466, '#1b1730', '#09070f', 'rgba(255,61,242,0.25)', 140);
            // pantulan neon di lantai basah
            ctx.globalAlpha = 0.15; ctx.fillStyle = '#ff3df2'; ctx.fillRect(cx + 120, 500, 240, 8);
            ctx.fillStyle = '#3dfcff'; ctx.fillRect(cx - 250, 530, 200, 6); ctx.globalAlpha = 1;
        },
        volcano(ctx, cam, t, fg) {
            if (fg) {
                ctx.fillStyle = '#100604';
                for (let i = 0; i < 5; i++) {
                    const x = i * 640 - cam * 1.4 + 100;
                    if (x < -200 || x > W + 200) continue;
                    ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + 40, H - 90); ctx.lineTo(x + 90, H - 60); ctx.lineTo(x + 150, H); ctx.fill();
                }
                return;
            }
            const g = ctx.createLinearGradient(0, 0, 0, 470);
            g.addColorStop(0, '#120404'); g.addColorStop(0.7, '#5a120a'); g.addColorStop(1, '#a8320f');
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, 470);
            // gunung berapi jauh
            const vx = 700 - cam * 0.15;
            ctx.fillStyle = '#2a0c08'; ctx.beginPath(); ctx.moveTo(vx - 500, 470); ctx.lineTo(vx - 90, 140); ctx.lineTo(vx + 90, 140); ctx.lineTo(vx + 500, 470); ctx.fill();
            const eg = ctx.createRadialGradient(vx, 140, 10, vx, 140, 160);
            eg.addColorStop(0, 'rgba(255,200,80,0.9)'); eg.addColorStop(0.4, 'rgba(255,80,20,0.4)'); eg.addColorStop(1, 'rgba(255,40,0,0)');
            ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(vx, 140, 160, 0, 6.283); ctx.fill();
            ctx.strokeStyle = '#ff6a1a'; ctx.lineWidth = 6;
            ctx.beginPath(); ctx.moveTo(vx - 20, 145); ctx.quadraticCurveTo(vx - 60, 260, vx - 120, 330); ctx.stroke();
            for (let i = 0; i < 6; i++) { // asap
                const sy = 120 - ((t * 0.5 + i * 40) % 240), sa = 1 - ((t * 0.5 + i * 40) % 240) / 240;
                ctx.fillStyle = `rgba(60,40,40,${0.5 * sa})`; ctx.beginPath(); ctx.arc(vx + Math.sin(i + t * 0.01) * 40, sy, 40 + (1 - sa) * 40, 0, 6.283); ctx.fill();
            }
            // batu tengah
            ctx.fillStyle = '#1e0a07';
            for (let i = 0; i < 14; i++) {
                const x = i * 200 - cam * 0.5;
                if (x < -200 || x > W + 200) continue;
                ctx.beginPath(); ctx.moveTo(x, 470); ctx.lineTo(x + 30, 330 + hash(i) * 60); ctx.lineTo(x + 90, 300 + hash(i + 4) * 80); ctx.lineTo(x + 160, 470); ctx.fill();
            }
            // sungai magma
            ctx.fillStyle = '#ff5a14'; ctx.fillRect(0, 430, W, 44);
            ctx.fillStyle = '#ffb347';
            for (let x = -40; x < W + 40; x += 40) {
                const xx = x - ((cam * 0.8 + t * 1.2) % 40);
                ctx.beginPath(); ctx.ellipse(xx, 446 + Math.sin(t * 0.08 + x) * 4, 18, 4, 0, 0, 6.283); ctx.fill();
            }
            floor(ctx, cam, 472, '#3a1a12', '#120604', 'rgba(255,90,20,0.35)', 150);
            // bara api naik
            for (let i = 0; i < 40; i++) {
                const px = (hash(i) * 1400 - cam * 0.9 % 1400 + 1400) % 1400 - 60 + Math.sin(t * 0.05 + i) * 10;
                const py = H - ((t * (1 + hash(i + 1) * 2) + hash(i + 2) * 700) % 760);
                ctx.fillStyle = `rgba(255,${120 + hash(i + 3) * 120 | 0},40,${0.4 + hash(i + 4) * 0.6})`;
                ctx.fillRect(px, py, 3, 3);
            }
        }
    };

    function drawStage(ctx, idx, cam, t, fg) {
        const s = STAGES[idx] || STAGES[0];
        if (fg) { ctx.save(); ctx.globalAlpha = 0.55; }   // foreground semi-transparan agar petarung tetap terlihat
        stages[s.id](ctx, cam, t, fg);
        if (fg) ctx.restore();
    }

    /* =================== HUD =================== */
    function txt(ctx, s, x, y, size, col = '#fff', align = 'center', outline = 6, font = 'Bangers') {
        ctx.font = `${size}px "${font}", Impact, "Arial Black", sans-serif`;
        ctx.textAlign = align; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        if (outline) { ctx.strokeStyle = '#0b0710'; ctx.lineWidth = outline; ctx.strokeText(s, x, y); }
        ctx.fillStyle = col; ctx.fillText(s, x, y);
    }

    function hpColor(r, cb) {
        if (cb) return r > 0.5 ? '#2f80ed' : r > 0.25 ? '#56ccf2' : '#f2994a';
        return r > 0.5 ? '#43e05a' : r > 0.25 ? '#f5d23a' : '#ff3b3b';
    }

    function drawHUD(ctx, m, view, opts) {
        const cb = opts.colorblind, t = view.t;
        const F = m.fighters;
        const BW = 500, BH = 28, BY = 34;
        for (let i = 0; i < 2; i++) {
            const f = F[i], ratio = f.hp / f.maxHP, disp = view.disp[i] / f.maxHP;
            const x0 = i === 0 ? 50 : W - 50 - BW;
            // bingkai
            ctx.fillStyle = '#0b0710'; ctx.fillRect(x0 - 4, BY - 4, BW + 8, BH + 8);
            ctx.fillStyle = '#3a1020'; ctx.fillRect(x0, BY, BW, BH);
            // lapisan belakang (delayed drain, kuning)
            const wd = BW * disp, wr = BW * ratio;
            ctx.fillStyle = cb ? '#bdbdbd' : '#ffcf3f';
            ctx.fillRect(i === 0 ? x0 + BW - wd : x0, BY, wd, BH);
            // lapisan depan (instan)
            let col = hpColor(ratio, cb);
            if (ratio < 0.25 && Math.sin(t * 0.25) > 0) col = cb ? '#ffffff' : '#ff9a9a';
            if (f.flash > 0) col = '#ffffff';
            ctx.fillStyle = col;
            ctx.fillRect(i === 0 ? x0 + BW - wr : x0, BY, wr, BH);
            ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x0, BY, BW, 6);
            // nama
            // nama pemain + nama petarung
            ctx.font = '26px "Bangers", Impact, sans-serif';
            const nw = ctx.measureText(f.name).width;
            txt(ctx, f.name, i === 0 ? x0 : x0 + BW, BY + BH + 20, 26, '#fff', i === 0 ? 'left' : 'right', 5);
            if (f.def.name !== f.name) txt(ctx, f.def.name, i === 0 ? x0 + nw + 12 : x0 + BW - nw - 12, BY + BH + 21, 20, f.look.fx, i === 0 ? 'left' : 'right', 4);
            // guard gauge
            if (f.guard > 0) {
                ctx.fillStyle = '#0b0710'; ctx.fillRect(x0, BY + BH + 4, BW * 0.4, 5);
                ctx.fillStyle = f.guard > 70 ? '#ff5050' : '#9ad0ff';
                const gw = BW * 0.4 * f.guard / 100;
                ctx.fillRect(i === 0 ? x0 : x0, BY + BH + 4, gw, 5);
            }
            // super meter (bawah)
            const SW = 340, sx0 = i === 0 ? 50 : W - 50 - SW, sy = H - 46;
            ctx.fillStyle = '#0b0710'; ctx.fillRect(sx0 - 3, sy - 3, SW + 6, 22);
            ctx.fillStyle = '#1d1440'; ctx.fillRect(sx0, sy, SW, 16);
            const mw = SW * f.meter / 100, full = f.meter >= 100;
            const mg = ctx.createLinearGradient(sx0, 0, sx0 + SW, 0);
            mg.addColorStop(0, '#3b6cff'); mg.addColorStop(1, full ? '#ff3df2' : '#3dfcff');
            ctx.fillStyle = mg; ctx.fillRect(i === 0 ? sx0 : sx0 + SW - mw, sy, mw, 16);
            ctx.fillStyle = '#0b0710'; ctx.fillRect(sx0 + SW / 2 - 1, sy, 3, 16); // tanda EX (50)
            const label = full ? 'SUPER!' : f.meter >= 50 ? 'EX' : 'METER';
            txt(ctx, label, i === 0 ? sx0 + SW + 12 : sx0 - 12, sy + 8, full ? 28 + Math.sin(t * 0.3) * 3 : 22,
                full ? '#ff8af6' : '#bcd7ff', i === 0 ? 'left' : 'right', 5);
            // tanda ronde menang
            for (let r = 0; r < CONFIG.ROUNDS_TO_WIN; r++) {
                const cx = i === 0 ? W / 2 - 70 - r * 26 : W / 2 + 70 + r * 26;
                ctx.fillStyle = '#0b0710'; ctx.beginPath(); ctx.arc(cx, BY + BH + 22, 10, 0, 6.283); ctx.fill();
                ctx.fillStyle = m.wins[i] > r ? '#ffd23f' : '#3a2f4a'; ctx.beginPath(); ctx.arc(cx, BY + BH + 22, 7, 0, 6.283); ctx.fill();
            }
            // combo counter
            const cv = view.combo[i];
            if (cv && cv.t > 0 && cv.n >= 2) {
                const a = Math.min(1, cv.t / 20), s = 1 + Math.max(0, cv.pop) * 0.04;
                ctx.save(); ctx.globalAlpha = a;
                ctx.translate(i === 0 ? 70 : W - 70, 250); ctx.scale(s, s);
                txt(ctx, cv.n + ' HIT!', 0, 0, 64, '#ffd23f', i === 0 ? 'left' : 'right', 8);
                txt(ctx, cv.dmg + ' DMG', 0, 46, 28, '#fff', i === 0 ? 'left' : 'right', 5);
                ctx.restore();
            }
        }
        // timer
        ctx.fillStyle = '#0b0710'; ctx.fillRect(W / 2 - 46, 20, 92, 64);
        ctx.fillStyle = '#2a1840'; ctx.fillRect(W / 2 - 42, 24, 84, 56);
        txt(ctx, String(Math.max(0, m.timer)).padStart(2, '0'), W / 2, 54, 54, m.timer <= 10 ? '#ff5050' : '#ffd23f', 'center', 6);
        // ping & fps
        if (opts.ping !== undefined && opts.ping !== null) {
            const pc = opts.ping < 80 ? '#43e05a' : opts.ping <= 150 ? '#f5d23a' : '#ff3b3b';
            const pl = opts.ping < 80 ? 'GOOD' : opts.ping <= 150 ? 'OK' : 'BAD';
            txt(ctx, `PING: ${opts.ping}ms ${pl}`, W / 2, 104, 20, pc, 'center', 4);
        }
        if (opts.fps) txt(ctx, opts.fps + ' FPS', W - 12, H - 12, 16, '#9fa', 'right', 3);
        if (opts.banner) txt(ctx, opts.banner, W / 2, 130, 22, '#ffb3f5', 'center', 4);
    }

    /* =================== PENGUMUMAN RONDE =================== */
    function scaleIn(ctx, s, x, y, t, size, col) {
        const k = Math.min(1, t / 10), sc = 2.4 - 1.4 * k + (t > 10 ? Math.sin(t * 0.2) * 0.02 : 0);
        ctx.save(); ctx.globalAlpha = k; ctx.translate(x, y - (1 - k) * 160); ctx.scale(sc, sc);
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowOffsetY = 6; ctx.shadowBlur = 8;
        txt(ctx, s, 0, 0, size, col, 'center', 10);
        ctx.restore();
    }

    function drawAnnounce(ctx, m) {
        const t = m.phaseT;
        if (m.phase === 'intro') {
            if (t < 60) scaleIn(ctx, m.roundLabel, W / 2, 300, t, 110, '#ffd23f');
            else scaleIn(ctx, 'FIGHT!', W / 2, 310, t - 60, 140, '#ff3b3b');
        } else if (m.phase === 'roundEnd' && m.roundResult) {
            const r = m.roundResult;
            let main = r.draw ? (r.timeout ? 'DRAW!' : 'DOUBLE K.O.!') : r.timeout ? 'TIME OUT!' : 'K.O.!';
            if (t < 100) {
                const shake = r.timeout ? 0 : Math.max(0, 10 - t) * 2;
                ctx.save(); ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
                scaleIn(ctx, main, W / 2, 300, t, main.length > 5 ? 110 : 170, r.timeout ? '#3dfcff' : '#ff3b3b');
                ctx.restore();
            } else {
                if (r.perfect) scaleIn(ctx, 'PERFECT!', W / 2, 260, t - 100, 120, '#ffd23f');
                if (r.winner >= 0) scaleIn(ctx, m.fighters[r.winner].name + ' MENANG', W / 2, r.perfect ? 370 : 300, t - 100, 64, '#fff');
            }
        }
    }

    /* =================== DEBUG HITBOX =================== */
    function drawBoxes(ctx, m, cam, cb) {
        const rect = (b, col) => { if (!b) return; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(b.x - cam, b.y, b.w, b.h); ctx.fillStyle = col.replace('1)', '0.2)'); ctx.fillRect(b.x - cam, b.y, b.w, b.h); };
        for (const f of m.fighters) {
            rect(f.pushbox(), 'rgba(60,220,90,1)');
            rect(f.hurtbox(), cb ? 'rgba(80,140,255,1)' : 'rgba(255,60,60,1)');
            rect(f.hitbox(), cb ? 'rgba(255,170,0,1)' : 'rgba(255,230,0,1)');
        }
        for (const p of m.projectiles) rect({ x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h }, 'rgba(255,230,0,1)');
    }

    /* =================== FRAME LENGKAP =================== */
    function drawFrame(ctx, m, stageIdx, view, opts) {
        const cam = m.cameraX, t = view.t;
        ctx.save();
        ctx.clearRect(0, 0, W, H);
        const sh = Effects.shakeOffset();
        ctx.translate(sh[0], sh[1]);

        // Zoom sinematik saat super freeze
        const sf = m.superFreeze > 0 && m.superUser;
        if (sf) {
            const k = Math.sin(Math.PI * (1 - m.superFreeze / CONFIG.SUPER_FREEZE)) * 0.12 + 0.06;
            const ux = m.superUser.x - cam, uy = m.superUser.y - 110;
            ctx.translate(ux, uy); ctx.scale(1 + k, 1 + k); ctx.translate(-ux, -uy);
        }

        drawStage(ctx, stageIdx, cam, t, false);

        // Gelap saat super / blackout
        if (sf || m.blackout > 0) {
            ctx.fillStyle = m.blackout > 0 ? 'rgba(0,0,0,0.92)' : 'rgba(10,0,25,0.6)';
            ctx.fillRect(-100, -100, W + 200, H + 200);
            if (sf) { // garis kecepatan (distortion)
                ctx.strokeStyle = m.superUser.look.fx; ctx.globalAlpha = 0.35; ctx.lineWidth = 3;
                for (let i = 0; i < 30; i++) { const y = (hash(i + t) * H); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + (hash(i) - 0.5) * 40); ctx.stroke(); }
                ctx.globalAlpha = 1;
            }
        }

        // Bayangan
        for (const f of m.fighters) {
            const hgt = Math.max(0, CONFIG.GROUND_Y - f.y), s = Math.max(0.4, 1 - hgt / 400);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.beginPath(); ctx.ellipse(f.x - cam, CONFIG.GROUND_Y + 4, 50 * s, 10 * s, 0, 0, 6.283); ctx.fill();
        }
        // Petarung: penyerang digambar di depan
        const order = m.fighters.slice().sort((a, b) => (a.state === 'attack' ? 1 : 0) - (b.state === 'attack' ? 1 : 0));
        if (m.blackout > 0) {
            // Sinematik grab super: kilatan & tebasan
            const k = m.blackout;
            if (k % 8 < 3) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-100, -100, W + 200, H + 200); }
            ctx.strokeStyle = '#ff2a4a'; ctx.lineWidth = 6;
            for (let i = 0; i < 4; i++) {
                const a = hash(k + i * 3) * 6.28, cx = m.fighters[0].x - cam + (m.fighters[1].x - m.fighters[0].x) / 2, cy = 420;
                ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * 200, cy - Math.sin(a) * 200); ctx.lineTo(cx + Math.cos(a) * 200, cy + Math.sin(a) * 200); ctx.stroke();
            }
            txt(ctx, '滅', W / 2, 360, 220, k > 40 ? 'rgba(255,40,70,0.0)' : '#ff2a4a', 'center', 12, 'Russo One');
        } else {
            for (const f of order) drawFighter(ctx, f, f.x - cam, f.y, { glow: (sf && f === m.superUser) || (f.action && (f.action.def.ex || f.action.def.isSuper)) });
        }
        for (const p of m.projectiles) drawProjectile(ctx, p, cam, t);
        Effects.draw(ctx, cam);
        drawStage(ctx, stageIdx, cam, t, true);
        if (opts.hitboxes) drawBoxes(ctx, m, cam, opts.colorblind);
        ctx.restore();

        // Vignette HP kritis (pemain lokal)
        const lf = m.fighters[opts.localSlot || 0];
        if (lf && lf.hp / lf.maxHP < 0.25 && m.phase === 'fight') {
            const vg = ctx.createRadialGradient(W / 2, H / 2, 250, W / 2, H / 2, 760);
            vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(170,0,0,${0.35 + 0.15 * Math.sin(t * 0.15)})`);
            ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
        }

        // Nama super (banner sinematik)
        if (sf) {
            const u = m.superUser, k = 1 - m.superFreeze / CONFIG.SUPER_FREEZE;
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 560, W, 90);
            ctx.fillStyle = u.look.fx; ctx.fillRect(0, 560, W, 4); ctx.fillRect(0, 646, W, 4);
            txt(ctx, m.superDef ? m.superDef.name : 'SUPER', lerp(-200, W / 2, Math.min(1, k * 3)), 605, 64, u.look.fx, 'center', 8);
            ctx.restore();
            if (m.superFreeze > CONFIG.SUPER_FREEZE - 3) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(0, 0, W, H); }
        }

        drawHUD(ctx, m, view, opts);
        Effects.drawScreen(ctx);
        drawAnnounce(ctx, m);
    }

    return { drawFrame, drawFighter, drawStage, drawHUD, txt, poseOf, STANCE };
})();
