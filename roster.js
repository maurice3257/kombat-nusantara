'use strict';
/* =====================================================================
 * roster.js — Data 6 petarung + pembentuk (builder) daftar jurus
 * ---------------------------------------------------------------------
 * Karakter dibuat data-driven: menambah petarung baru cukup dengan
 * menambah satu objek ke ROSTER. Semua angka frame mengacu ke 60 FPS.
 *
 * Arketipe mengikuti spesifikasi (Balanced, Rushdown, Footsies/Zoner,
 * Aggressive, Zoner/Defensive, Mixup) dengan tokoh & jurus orisinal.
 * ===================================================================== */

// Notasi arah ala numpad, relatif terhadap arah hadap:
// 7 8 9   (atas-belakang, atas, atas-maju)
// 4 5 6   (belakang, netral, maju)
// 1 2 3   (bawah-belakang, bawah, bawah-maju)
const MOTIONS = {
    qcf: [2, 3, 6],          // ↓ ↘ →
    qcb: [2, 1, 4],          // ↓ ↙ ←
    dp: [6, 2, 3],           // → ↓ ↘
    hcf: [4, 2, 6],          // ← ↙ ↓ ↘ → (dipermudah: ← ↓ →)
    hcb: [6, 2, 4],          // → ↘ ↓ ↙ ←
    qcfqcf: [2, 3, 6, 2, 3, 6]
};
// Input Assist (aksesibilitas): motion disederhanakan
const MOTION_ASSIST = { qcf: [3, 6], qcb: [1, 4], dp: [2, 3], hcf: [2, 6], hcb: [2, 4], qcfqcf: [3, 6, 3, 6] };
// Urutan pengecekan (DP harus dicek sebelum QCF karena mirip)
const MOTION_PRIORITY = { dp: 0, chargeDU: 1, chargeBF: 2, hcf: 3, hcb: 3, qcf: 4, qcb: 4 };
const MOTION_LABEL = {
    qcf: '↓↘→', qcb: '↓↙←', dp: '→↓↘', hcf: '←↙↓↘→', hcb: '→↘↓↙←',
    chargeBF: '[← tahan] →', chargeDU: '[↓ tahan] ↑', qcfqcf: '↓↘→↓↘→'
};

/* ---------------- SERANGAN NORMAL (dipakai semua karakter) ----------------
 * box: {x,y,w,h} relatif ke kaki karakter, x positif = ke depan.
 * str: L / M / H  (kekuatan → hitstop, suara, efek)
 * level: mid | low | overhead
 */
const NORMALS = {
    LP:  { name: 'Jab',            startup: 4,  active: 3, recovery: 7,  dmg: 30, hitstun: 13, blockstun: 9,  kb: 320, box: { x: 18, y: -142, w: 64, h: 24 }, pose: 'jab', str: 'L', meter: 4, cancel: true },
    MP:  { name: 'Straight',       startup: 6,  active: 3, recovery: 13, dmg: 55, hitstun: 17, blockstun: 12, kb: 420, box: { x: 18, y: -140, w: 80, h: 26 }, pose: 'straight', str: 'M', meter: 6, cancel: true },
    HP:  { name: 'Fierce',         startup: 9,  active: 4, recovery: 20, dmg: 90, hitstun: 21, blockstun: 15, kb: 560, box: { x: 18, y: -146, w: 94, h: 32 }, pose: 'fierce', str: 'H', meter: 9, cancel: true },
    LK:  { name: 'Short',          startup: 5,  active: 3, recovery: 9,  dmg: 35, hitstun: 13, blockstun: 9,  kb: 320, box: { x: 14, y: -82,  w: 80, h: 26 }, pose: 'lowkick', str: 'L', meter: 4, cancel: true },
    MK:  { name: 'Forward',        startup: 7,  active: 4, recovery: 15, dmg: 60, hitstun: 17, blockstun: 12, kb: 440, box: { x: 14, y: -116, w: 100, h: 28 }, pose: 'midkick', str: 'M', meter: 6, cancel: true },
    HK:  { name: 'Roundhouse',     startup: 11, active: 4, recovery: 24, dmg: 95, hitstun: 22, blockstun: 15, kb: 620, box: { x: 14, y: -162, w: 106, h: 36 }, pose: 'highkick', str: 'H', meter: 9 },
    cLP: { name: 'Crouch Jab',     startup: 4,  active: 3, recovery: 7,  dmg: 25, hitstun: 12, blockstun: 8,  kb: 300, box: { x: 18, y: -100, w: 62, h: 22 }, pose: 'cjab', str: 'L', meter: 4, cancel: true, crouch: true },
    cMP: { name: 'Crouch Strong',  startup: 6,  active: 3, recovery: 12, dmg: 50, hitstun: 16, blockstun: 11, kb: 400, box: { x: 18, y: -100, w: 76, h: 24 }, pose: 'cstraight', str: 'M', meter: 6, cancel: true, crouch: true },
    cHP: { name: 'Uppercut',       startup: 7,  active: 6, recovery: 24, dmg: 85, hitstun: 24, blockstun: 14, kb: 200, box: { x: 4,  y: -218, w: 62, h: 124 }, pose: 'uppercut', str: 'H', meter: 9, crouch: true, cancel: true, launch: -800 },
    cLK: { name: 'Crouch Short',   startup: 5,  active: 3, recovery: 8,  dmg: 25, hitstun: 12, blockstun: 8,  kb: 300, box: { x: 14, y: -30,  w: 82, h: 26 }, pose: 'clowkick', str: 'L', meter: 4, cancel: true, crouch: true, level: 'low', otg: true },
    cMK: { name: 'Crouch Forward', startup: 7,  active: 4, recovery: 14, dmg: 50, hitstun: 16, blockstun: 11, kb: 400, box: { x: 14, y: -32,  w: 102, h: 28 }, pose: 'cmidkick', str: 'M', meter: 6, cancel: true, crouch: true, level: 'low' },
    cHK: { name: 'Sweep',          startup: 9,  active: 4, recovery: 26, dmg: 80, hitstun: 20, blockstun: 14, kb: 300, box: { x: 10, y: -32,  w: 120, h: 30 }, pose: 'sweep', str: 'H', meter: 9, crouch: true, level: 'low', knockdown: true },
    jLP: { name: 'Air Jab',        startup: 4,  active: 8, recovery: 4,  dmg: 35, hitstun: 14, blockstun: 10, kb: 280, box: { x: 14, y: -122, w: 62, h: 32 }, pose: 'jpunch', str: 'L', meter: 4, air: true, level: 'overhead' },
    jMP: { name: 'Air Strong',     startup: 6,  active: 6, recovery: 6,  dmg: 55, hitstun: 17, blockstun: 12, kb: 340, box: { x: 14, y: -114, w: 74, h: 36 }, pose: 'jpunch', str: 'M', meter: 6, air: true, level: 'overhead' },
    jHP: { name: 'Air Fierce',     startup: 8,  active: 6, recovery: 8,  dmg: 85, hitstun: 21, blockstun: 15, kb: 400, box: { x: 10, y: -108, w: 84, h: 46 }, pose: 'jpunch', str: 'H', meter: 9, air: true, level: 'overhead' },
    jLK: { name: 'Air Short',      startup: 4,  active: 10, recovery: 4, dmg: 35, hitstun: 14, blockstun: 10, kb: 280, box: { x: 10, y: -74,  w: 68, h: 32 }, pose: 'jkick', str: 'L', meter: 4, air: true, level: 'overhead' },
    jMK: { name: 'Air Forward',    startup: 6,  active: 6, recovery: 6,  dmg: 60, hitstun: 17, blockstun: 12, kb: 340, box: { x: 10, y: -70,  w: 82, h: 36 }, pose: 'jkick', str: 'M', meter: 6, air: true, level: 'overhead' },
    jHK: { name: 'Air Roundhouse', startup: 8,  active: 6, recovery: 8,  dmg: 90, hitstun: 21, blockstun: 15, kb: 420, box: { x: 6,  y: -78,  w: 94, h: 42 }, pose: 'jkick', str: 'H', meter: 9, air: true, level: 'overhead' }
};

/* ---------------- ROSTER ---------------- */
const ROSTER = [
    {
        id: 'raka', name: 'RAKA', title: 'Pendekar Angin', archetype: 'Seimbang',
        stats: { hp: 1000, speed: 400, dmg: 1.00, def: 1.0, jump: 900 },
        bars: { power: 3, speed: 3, defense: 3, difficulty: 2 },
        look: { gi: '#2d6a8a', pants: '#2d6a8a', belt: '#e0b03a', skin: '#c98b5e', hair: '#1b1410', hairStyle: 'short', band: '#f08a24', glove: '#3a2a1e', feet: 'skin', sleeves: 'none', fx: '#5ec8ff',
                alt: { gi: '#7a3b2e', pants: '#7a3b2e', band: '#f5f5f5', fx: '#9be7ff' } },
        desc: 'Pesilat serba bisa. Proyektil, anti-udara, dan tendangan berputar — fondasi sempurna untuk belajar.',
        specials: [
            { id: 'bayu', name: 'Bayu Blast', motion: 'qcf', btn: 'P', kind: 'projectile', speed: [420, 560, 700], dmg: 80, color: '#5ec8ff' },
            { id: 'garuda', name: 'Garuda Rise', motion: 'dp', btn: 'P', kind: 'rising', dmg: 130, hits: 1 },
            { id: 'beliung', name: 'Puting Beliung', motion: 'qcb', btn: 'K', kind: 'spin', dmg: 42, hits: 3 }
        ],
        super: { name: 'BADAI BAYU', kind: 'superBeam', dmg: 62, hits: 5, color: '#5ec8ff' }
    },
    {
        id: 'bima', name: 'BIMA', title: 'Tinju Bara', archetype: 'Rushdown',
        stats: { hp: 950, speed: 450, dmg: 1.05, def: 1.0, jump: 920 },
        bars: { power: 4, speed: 4, defense: 2, difficulty: 3 },
        look: { gi: '#e2701e', pants: '#26262c', belt: '#26262c', skin: '#e0a274', hair: '#3a2216', hairStyle: 'long', band: null, glove: '#26262c', feet: 'skin', sleeves: 'none', fx: '#ff8a2a',
                alt: { gi: '#1565c0', pants: '#e0e0e0', belt: '#1565c0', fx: '#ffd54f' } },
        desc: 'Agresif dan berapi-api. Garuda api 3-hit dan tekanan tanpa henti.',
        specials: [
            { id: 'bara', name: 'Bola Bara', motion: 'qcf', btn: 'P', kind: 'projectile', speed: [380, 500, 620], dmg: 75, color: '#ff8a2a' },
            { id: 'naga', name: 'Naga Api', motion: 'dp', btn: 'P', kind: 'rising', dmg: 150, hits: 3, flame: true },
            { id: 'beliung2', name: 'Puting Beliung', motion: 'qcb', btn: 'K', kind: 'spin', dmg: 38, hits: 4 }
        ],
        super: { name: 'NAGA LANGIT', kind: 'superRising', dmg: 50, hits: 7, color: '#ff8a2a' }
    },
    {
        id: 'linmei', name: 'LIN MEI', title: 'Kelopak Badai', archetype: 'Footsies / Zoner',
        stats: { hp: 900, speed: 500, dmg: 0.90, def: 1.0, jump: 960 }, female: true,
        bars: { power: 2, speed: 5, defense: 2, difficulty: 3 },
        look: { gi: '#139c7a', pants: '#f1efe6', belt: '#b03060', skin: '#f0c49a', hair: '#1a1210', hairStyle: 'buns', band: null, glove: '#b03060', feet: 'boots', boot: '#b03060', sleeves: 'short', fx: '#7fffd4',
                alt: { gi: '#7b1fa2', pants: '#2b2b33', belt: '#ffd54f', fx: '#e1a7ff' } },
        desc: 'Kaki tercepat di turnamen. Tendangan seratus kelopak dan pinwheel charge.',
        specials: [
            { id: 'lotus', name: 'Bola Teratai', motion: 'qcf', btn: 'P', kind: 'projectile', speed: [300, 380, 460], dmg: 70, color: '#7fffd4', size: 64 },
            { id: 'pinwheel', name: 'Kincir Kelopak', motion: 'chargeDU', btn: 'K', kind: 'spin', dmg: 40, hits: 4 },
            { id: 'petals', name: 'Seratus Kelopak', motion: 'qcb', btn: 'K', kind: 'multi', dmg: 20, hits: 5 }
        ],
        super: { name: 'BADAI KELOPAK', kind: 'superMulti', dmg: 30, hits: 12, color: '#7fffd4' }
    },
    {
        id: 'kaido', name: 'KAIDO', title: 'Iblis Kawah', archetype: 'Agresif (glass cannon)',
        stats: { hp: 850, speed: 450, dmg: 1.20, def: 1.0, jump: 940 },
        bars: { power: 5, speed: 4, defense: 1, difficulty: 5 },
        look: { gi: '#4a2c6b', pants: '#4a2c6b', belt: '#d4a017', skin: '#b07a5a', hair: '#f2f2f2', hairStyle: 'spiky', band: null, glove: '#2a1838', feet: 'skin', sleeves: 'none', fx: '#ff2a4a',
                alt: { gi: '#1d3b2e', pants: '#1d3b2e', belt: '#ff7043', fx: '#b388ff' } },
        desc: 'Damage paling besar, darah paling tipis. Lompatan iblis menembus pertahanan jongkok.',
        specials: [
            { id: 'merah', name: 'Bola Merah', motion: 'qcf', btn: 'P', kind: 'projectile', speed: [460, 600, 740], dmg: 90, color: '#ff2a4a' },
            { id: 'kawah', name: 'Tinju Kawah', motion: 'dp', btn: 'P', kind: 'rising', dmg: 140, hits: 2 },
            { id: 'flip', name: 'Lompatan Iblis', motion: 'dp', btn: 'K', kind: 'flip', dmg: 85 }
        ],
        super: { name: 'SENYAP SERIBU', kind: 'superGrab', dmg: 400, color: '#ff2a4a' }
    },
    {
        id: 'garrett', name: 'GARRETT', title: 'Benteng Sonik', archetype: 'Zoner / Defensif',
        stats: { hp: 1050, speed: 350, dmg: 1.00, def: 1.0, jump: 860 },
        bars: { power: 3, speed: 2, defense: 5, difficulty: 4 },
        look: { gi: '#3e4a5a', pants: '#3e4a5a', belt: '#1e1e1e', skin: '#e3b48f', hair: '#2b1d14', hairStyle: 'short', band: null, glove: '#1e1e1e', feet: 'boots', boot: '#1e1e1e', sleeves: 'tank', top: '#9e9e9e', fx: '#ffd84a',
                alt: { gi: '#5d4037', pants: '#5d4037', top: '#d7ccc8', fx: '#80d8ff' } },
        desc: 'Tahan banting, sabar, mematikan dari jauh. Semua jurus memakai input charge.',
        specials: [
            { id: 'sonic', name: 'Gelombang Sonik', motion: 'chargeBF', btn: 'P', kind: 'projectile', speed: [450, 600, 760], dmg: 70, color: '#ffd84a', style: 'wave', recovery: 22, startup: 10 },
            { id: 'arc', name: 'Tendangan Busur', motion: 'chargeDU', btn: 'K', kind: 'rising', dmg: 125, hits: 1, longInvuln: true }
        ],
        super: { name: 'TOPAN SONIK', kind: 'superBeam', dmg: 52, hits: 6, color: '#ffd84a' }
    },
    {
        id: 'sasha', name: 'SASHA', title: 'Tombak Spiral', archetype: 'Rushdown / Mixup',
        stats: { hp: 900, speed: 480, dmg: 0.95, def: 1.0, jump: 950 }, female: true,
        bars: { power: 3, speed: 5, defense: 2, difficulty: 4 },
        look: { gi: '#5b2c83', pants: '#5b2c83', belt: '#3dfcff', skin: '#f2c9a4', hair: '#d8d8e8', hairStyle: 'braids', band: '#3dfcff', glove: '#3dfcff', feet: 'boots', boot: '#1b1b1b', sleeves: 'none', fx: '#c38bff',
                alt: { gi: '#263238', pants: '#263238', belt: '#ffd54f', band: '#ffd54f', glove: '#ffd54f', fx: '#ffe57f' } },
        desc: 'Luncuran rendah, tusukan anti-udara, dan kombinasi kilat. Raja mixup.',
        specials: [
            { id: 'spiral', name: 'Tombak Spiral', motion: 'qcf', btn: 'K', kind: 'rush', dmg: 50 },
            { id: 'spike', name: 'Tusuk Langit', motion: 'dp', btn: 'K', kind: 'rising', dmg: 120, hits: 1 },
            { id: 'quick', name: 'Kombinasi Kilat', motion: 'qcb', btn: 'P', kind: 'multi', dmg: 24, hits: 4 }
        ],
        super: { name: 'BADAI SPIRAL', kind: 'superRush', dmg: 40, hits: 8, color: '#c38bff' }
    }
];

const STAGES = [
    { id: 'dojo', name: 'Dojo Sakura', desc: 'Tatami, pintu geser & sakura gugur' },
    { id: 'temple', name: 'Kuil Naga', desc: 'Merah emas, naga & lentera' },
    { id: 'neon', name: 'Kota Neon', desc: 'Kasino, lampu neon & langit malam' },
    { id: 'volcano', name: 'Kawah Vulkanik', desc: 'Magma, batu & api bergerak' }
];

function charById(id) { return ROSTER.find((c) => c.id === id) || ROSTER[0]; }

/* ---------------- BUILDER JURUS SPESIAL ----------------
 * str: 0 = Light, 1 = Medium, 2 = Heavy. ex: versi EX (50 meter).
 * Fungsi onFrame(c, t, m) dipanggil tiap frame selama jurus berlangsung.
 */
function buildSpecial(sp, str, ex) {
    const k = 0.85 + 0.15 * str;
    const em = ex ? 1.25 : 1;
    const base = {
        name: sp.name + (ex ? ' EX' : ''), isSpecial: true, ex: !!ex, kind: sp.kind, str: 'S', level: 'mid',
        meter: ex ? 0 : 12, meterCost: ex ? CONFIG.EX_COST : 0, hitstun: 24, blockstun: 16, kb: 420, cancelSuper: true,
        color: sp.color
    };
    const dmg = (total, hits) => Math.round(total * k * em / hits);
    switch (sp.kind) {
        case 'projectile': {
            const hits = ex ? 2 : 1;
            return Object.assign(base, {
                startup: sp.startup || 12, active: 2, recovery: sp.recovery || 30, noHitbox: true, pose: 'fireball',
                projectile: {
                    speed: sp.speed[str] + (ex ? 140 : 0), dmg: dmg(sp.dmg, hits), w: sp.size || 54, h: 42, y: -118, hits, interval: 8,
                    color: sp.color, hitstun: 22, blockstun: 16, kb: 420, life: 300, style: sp.style || 'orb'
                }
            });
        }
        case 'rising': {
            const st = 3 + str, hits = (sp.hits || 1) + (ex ? 1 : 0);
            const inv = ex || sp.longInvuln ? [1, 12 + str * 2] : [1, 3 + str * 3];
            return Object.assign(base, {
                startup: st, active: 14, recovery: 0, untilLand: true, landLag: 14 + str * 5, invuln: inv, pose: 'rising',
                dmg: dmg(sp.dmg, hits), hits, hitInterval: 4, box: { x: -6, y: -212, w: 70, h: 144 },
                launch: -720, knockdown: true, kb: 160, fx: sp.flame ? 'flame' : null, ignoreJuggle: true,
                onFrame: (c, t) => { if (t === st) { c.vy = -(820 + str * 140 + (ex ? 120 : 0)); c.vx = c.facing * (90 + str * 40); c.grounded = false; } }
            });
        }
        case 'spin': {
            const st = 8, act = 24 + str * 6 + (ex ? 6 : 0), hits = (sp.hits || 3) + (ex ? 1 : 0);
            return Object.assign(base, {
                startup: st, active: act, recovery: 6, untilLand: true, landLag: 8, pose: 'spin', hover: [st + 6, st + act],
                hits, hitInterval: Math.max(4, Math.floor(act / hits)), dmg: dmg(sp.dmg * hits, hits), box: { x: -58, y: -142, w: 156, h: 48 },
                kb: 260, finalKnockdown: true, finalKb: 520, invuln: ex ? [1, 10] : null, ignoreJuggle: true, keepVel: true,
                onFrame: (c, t) => {
                    if (t === st) { c.vy = -300; c.grounded = false; }
                    if (t > st && t <= st + act) { c.vx = c.facing * (240 + str * 50); if (t >= st + 6) c.vy = 0; }
                }
            });
        }
        case 'rush': {
            const st = 9, act = 16 + str * 4, hits = 2 + (ex ? 1 : 0);
            return Object.assign(base, {
                startup: st, active: act, recovery: 18, pose: 'rush', hits, hitInterval: 7, dmg: dmg(sp.dmg * hits, hits),
                box: { x: 0, y: -62, w: 104, h: 58 }, level: 'low', kb: 120, finalKnockdown: true, finalKb: 480,
                invuln: ex ? [1, 10] : null, keepVel: true,
                onFrame: (c, t) => {
                    if (t > st && t <= st + act) c.vx = c.facing * (640 + str * 90);
                    else if (t > st + act) c.vx *= 0.7;
                }
            });
        }
        case 'multi': {
            const st = 6, hits = (sp.hits || 5) + str + (ex ? 2 : 0);
            return Object.assign(base, {
                startup: st, active: hits * 5, recovery: 16, pose: sp.btn === 'K' ? 'multikick' : 'multipunch', hits, hitInterval: 5,
                dmg: dmg(sp.dmg * hits, hits), box: { x: 12, y: -150, w: 100, h: 96 }, kb: 90, finalKb: 520,
                hitstun: 16, blockstun: 10, invuln: ex ? [1, 8] : null
            });
        }
        case 'flip': {
            const hits = 1 + (ex ? 1 : 0);
            return Object.assign(base, {
                startup: 24, active: 24, recovery: 0, untilLand: true, landLag: 10, pose: 'flip', level: 'overhead', hits, hitInterval: 8,
                dmg: dmg(sp.dmg, hits), box: { x: -12, y: -84, w: 84, h: 84 }, kb: 380, keepVel: true,
                onFrame: (c, t) => { if (t === 5) { c.vy = -950; c.vx = c.facing * (260 + str * 130); c.grounded = false; } }
            });
        }
    }
    throw new Error('Jenis jurus tidak dikenal: ' + sp.kind);
}

/* ---------------- BUILDER SUPER (100 meter) ---------------- */
function buildSuper(sp) {
    const base = {
        name: sp.name, isSuper: true, isSpecial: true, kind: sp.kind, str: 'S', level: 'mid', meter: 0, meterCost: CONFIG.SUPER_COST,
        hitstun: 30, blockstun: 18, kb: 300, invuln: [1, 18], pose: 'fireball', color: sp.color
    };
    const hits = sp.hits || 1;
    switch (sp.kind) {
        case 'superBeam':
            return Object.assign(base, {
                startup: 12, active: 2, recovery: 40, noHitbox: true,
                projectile: { speed: 950, dmg: sp.dmg, w: 200, h: 110, y: -124, hits, interval: 4, color: sp.color, hitstun: 30, blockstun: 12, kb: 160, finalKb: 600, life: 160, style: 'beam', beam: true, finalKnockdown: true, isSuper: true }
            });
        case 'superRising':
            return Object.assign(base, {
                startup: 5, active: 34, recovery: 0, untilLand: true, landLag: 30, invuln: [1, 20], pose: 'rising', hits, hitInterval: 4,
                dmg: sp.dmg, box: { x: -16, y: -222, w: 96, h: 164 }, launch: -760, kb: 120, knockdown: true, fx: 'flame', ignoreJuggle: true,
                onFrame: (c, t) => { if (t === 5) { c.vy = -1200; c.vx = c.facing * 140; c.grounded = false; } }
            });
        case 'superMulti':
            return Object.assign(base, {
                startup: 8, active: hits * 5, recovery: 20, pose: 'multikick', hits, hitInterval: 5, dmg: sp.dmg,
                box: { x: 4, y: -166, w: 118, h: 156 }, kb: 70, finalKb: 620, finalKnockdown: true, hitstun: 18, keepVel: true,
                onFrame: (c, t) => { if (t > 8) c.vx = c.facing * 110; }
            });
        case 'superRush':
            return Object.assign(base, {
                startup: 8, active: 28, recovery: 24, pose: 'rush', hits, hitInterval: 3, dmg: sp.dmg,
                box: { x: -10, y: -160, w: 124, h: 150 }, kb: 0, finalKb: 640, finalKnockdown: true, hitstun: 20, keepVel: true,
                onFrame: (c, t) => { if (t > 8 && t <= 36) c.vx = c.facing * 820; else if (t > 36) c.vx *= 0.6; }
            });
        case 'superGrab':
            return Object.assign(base, {
                startup: 10, active: 24, recovery: 30, pose: 'dash', hits: 1, unblockable: true, dmg: sp.dmg, invuln: [1, 10],
                box: { x: 0, y: -176, w: 72, h: 176 }, kb: 320, knockdown: true, keepVel: true,
                onFrame: (c, t) => { if (t > 10 && t <= 34) c.vx = c.facing * 700; else if (t > 34) c.vx *= 0.5; },
                onHit: (a, d, m) => { m.blackout = 75; m.event({ type: 'blackout', slot: a.slot }); a.vx = 0; }
            });
    }
    throw new Error('Jenis super tidak dikenal: ' + sp.kind);
}

/** Bangun set jurus lengkap untuk satu karakter */
function buildMoveSet(def) {
    const normals = {};
    for (const k in NORMALS) normals[k] = Object.assign({ id: k, level: 'mid' }, NORMALS[k]);
    const specials = def.specials.map((sp) => ({
        id: sp.id, name: sp.name, motion: sp.motion, btn: sp.btn, kind: sp.kind,
        v: [0, 1, 2].map((s) => buildSpecial(sp, s, false)),
        ex: buildSpecial(sp, 2, true)
    })).sort((a, b) => MOTION_PRIORITY[a.motion] - MOTION_PRIORITY[b.motion]);
    return { normals, specials, super: buildSuper(def.super) };
}
