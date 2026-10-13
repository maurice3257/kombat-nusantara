'use strict';
/* =====================================================================
 * input.js — Keyboard, Gamepad & Touch → bitmask input per frame
 * ---------------------------------------------------------------------
 * Setiap frame, input pemain diringkas menjadi satu angka (bitmask).
 * Angka inilah yang dikirim lewat jaringan (sangat hemat bandwidth)
 * dan disimpan untuk replay.
 * ===================================================================== */
const IN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, LP: 16, MP: 32, HP: 64, LK: 128, MK: 256, HK: 512, BLK: 1024 };
IN.PUNCH = IN.LP | IN.MP | IN.HP;
IN.KICK = IN.LK | IN.MK | IN.HK;
IN.BUTTONS = IN.PUNCH | IN.KICK;

const ACTIONS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'LP', 'MP', 'HP', 'LK', 'MK', 'HK', 'BLK'];
const ACTION_LABEL = {
    UP: 'Lompat', DOWN: 'Jongkok', LEFT: 'Kiri', RIGHT: 'Kanan', LP: 'Pukulan Ringan', MP: 'Pukulan Sedang',
    HP: 'Pukulan Berat', LK: 'Tendangan Ringan', MK: 'Tendangan Sedang', HK: 'Tendangan Berat', BLK: 'Block'
};

// Catatan: spesifikasi memakai I/J/K/L untuk gerak P2, tetapi tombol itu
// juga dipakai P1 untuk serangan. Agar tidak bentrok di 1 keyboard,
// P2 memakai panah + numpad.
const DEFAULT_KEYS = {
    p1: { UP: ['KeyW'], DOWN: ['KeyS'], LEFT: ['KeyA'], RIGHT: ['KeyD'], LP: ['KeyU'], MP: ['KeyI'], HP: ['KeyO'],
          LK: ['KeyJ'], MK: ['KeyK'], HK: ['KeyL'], BLK: ['Space'] },
    p2: { UP: ['ArrowUp'], DOWN: ['ArrowDown'], LEFT: ['ArrowLeft'], RIGHT: ['ArrowRight'], LP: ['Numpad7'], MP: ['Numpad8'],
          HP: ['Numpad9'], LK: ['Numpad4'], MK: ['Numpad5'], HK: ['Numpad6'], BLK: ['NumpadEnter', 'Numpad0'] }
};

const Input = {
    down: new Set(),
    touchBits: 0,
    keys: JSON.parse(JSON.stringify(DEFAULT_KEYS)),
    capture: false,          // true saat layar game aktif → cegah scroll dsb.
    rebindCb: null,          // callback saat mode ganti tombol

    init(keys) {
        if (keys) this.keys = keys;
        window.addEventListener('keydown', (e) => {
            if (this.rebindCb) { e.preventDefault(); const cb = this.rebindCb; this.rebindCb = null; cb(e.code); return; }
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            this.down.add(e.code);
            if (this.capture && this.isGameKey(e.code)) e.preventDefault();
        });
        window.addEventListener('keyup', (e) => this.down.delete(e.code));
        window.addEventListener('blur', () => this.down.clear());
    },

    isGameKey(code) {
        for (const p of ['p1', 'p2']) for (const a of ACTIONS) if (this.keys[p][a].includes(code)) return true;
        return false;
    },

    bitsFor(map) {
        let b = 0;
        for (const a of ACTIONS) {
            for (const code of map[a]) if (this.down.has(code)) { b |= IN[a]; break; }
        }
        return b;
    },

    // Gamepad standar (Xbox/PS): D-pad / stik kiri, X Y RB = pukulan, A B RT = tendangan, LB = block
    pad(i) {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const g = pads && pads[i];
        if (!g) return 0;
        const bt = (n) => g.buttons[n] && g.buttons[n].pressed;
        let b = 0;
        const ax = g.axes[0] || 0, ay = g.axes[1] || 0;
        if (bt(12) || ay < -0.5) b |= IN.UP;
        if (bt(13) || ay > 0.5) b |= IN.DOWN;
        if (bt(14) || ax < -0.5) b |= IN.LEFT;
        if (bt(15) || ax > 0.5) b |= IN.RIGHT;
        if (bt(2)) b |= IN.LP; if (bt(3)) b |= IN.MP; if (bt(5)) b |= IN.HP;
        if (bt(0)) b |= IN.LK; if (bt(1)) b |= IN.MK; if (bt(7)) b |= IN.HK;
        if (bt(4)) b |= IN.BLK;
        return b;
    },

    /**
     * Ambil input frame ini.
     * who: 'p1' | 'p2' | 'solo' (solo = satu pemain, boleh pakai kedua layout)
     */
    sample(who) {
        let b = 0;
        if (who === 'p1' || who === 'solo') b |= this.bitsFor(this.keys.p1) | this.pad(0) | this.touchBits;
        if (who === 'solo') b |= this.bitsFor(this.keys.p2);
        if (who === 'p2') b |= this.bitsFor(this.keys.p2) | this.pad(1);
        return Input.clean(b);
    },

    // SOCD cleaning: kiri+kanan = netral, atas+bawah = atas
    clean(b) {
        if ((b & IN.LEFT) && (b & IN.RIGHT)) b &= ~(IN.LEFT | IN.RIGHT);
        if ((b & IN.UP) && (b & IN.DOWN)) b &= ~IN.DOWN;
        return b;
    },

    // ---------- Kontrol sentuh (mobile) ----------
    initTouch(root) {
        if (!root) return;
        const pad = root.querySelector('.t-pad');
        let padBits = 0, btnBits = 0;
        const sync = () => { this.touchBits = padBits | btnBits; };
        const padMove = (e) => {
            const r = pad.getBoundingClientRect();
            const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
            const dz = r.width * 0.15;
            padBits = 0;
            if (dx < -dz) padBits |= IN.LEFT; if (dx > dz) padBits |= IN.RIGHT;
            if (dy < -dz) padBits |= IN.UP; if (dy > dz) padBits |= IN.DOWN;
            const knob = pad.querySelector('.t-knob');
            const max = r.width / 2 - 20, d = Math.hypot(dx, dy), k = d > max ? max / d : 1;
            knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
            sync();
        };
        const padEnd = () => { padBits = 0; pad.querySelector('.t-knob').style.transform = ''; sync(); };
        pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); padMove(e); });
        pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') padMove(e); });
        pad.addEventListener('pointerup', padEnd);
        pad.addEventListener('pointercancel', padEnd);
        root.querySelectorAll('[data-bit]').forEach((el) => {
            const bit = IN[el.dataset.bit];
            const on = (e) => { e.preventDefault(); btnBits |= bit; el.classList.add('on'); sync(); };
            const off = () => { btnBits &= ~bit; el.classList.remove('on'); sync(); };
            el.addEventListener('pointerdown', on);
            el.addEventListener('pointerup', off);
            el.addEventListener('pointerleave', off);
            el.addEventListener('pointercancel', off);
        });
    }
};
