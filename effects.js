'use strict';
/* =====================================================================
 * effects.js — Partikel (object pooling), screen shake, teks melayang
 * ---------------------------------------------------------------------
 * Murni visual: boleh memakai Math.random karena TIDAK memengaruhi
 * simulasi (netcode tetap sinkron).
 * ===================================================================== */
const Effects = {
    pool: [], live: [], shakeT: 0, shakeMag: 0, flashT: 0, flashCol: '#fff',
    enabled: { particles: true, shake: true },

    get() { return this.pool.pop() || {}; },
    add(o) { if (this.live.length < 600) this.live.push(o); else this.pool.push(o); },

    spawn(type, x, y, props) {
        const p = this.get();
        p.type = type; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.life = 30; p.max = 30; p.size = 4; p.col = '#fff'; p.g = 0; p.rot = 0; p.text = '';
        Object.assign(p, props);
        p.max = p.life;
        this.add(p);
        return p;
    },

    hitSpark(x, y, str, color) {
        if (!this.enabled.particles) return;
        const n = str === 'L' ? 8 : str === 'M' ? 10 : str === 'H' ? 14 : 18;
        const sp = str === 'L' ? 360 : str === 'M' ? 480 : 650;
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random() * 0.8);
            this.spawn('spark', x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 12 + Math.random() * 10, size: 3 + Math.random() * 3, col: i % 3 ? color : '#ffffff' });
        }
        if (str === 'L') this.spawn('star', x, y, { life: 8, size: 26, col: '#fff' });
        else this.spawn('burst', x, y, { life: str === 'H' || str === 'S' ? 16 : 11, size: str === 'H' ? 80 : str === 'S' ? 110 : 50, col: color });
        if (str === 'H' || str === 'S') this.spawn('ring', x, y, { life: 18, size: 30, col: '#fff' });
    },

    blockSpark(x, y) {
        if (!this.enabled.particles) return;
        for (let i = 0; i < 8; i++) {
            const a = Math.random() * Math.PI * 2, v = 250 + Math.random() * 250;
            this.spawn('spark', x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 10 + Math.random() * 6, size: 3, col: i % 2 ? '#8fd3ff' : '#ffffff' });
        }
        this.spawn('ring', x, y, { life: 12, size: 20, col: '#8fd3ff' });
    },

    dust(x, y, n = 6) {
        if (!this.enabled.particles) return;
        for (let i = 0; i < n; i++) {
            this.spawn('dust', x + (Math.random() - 0.5) * 40, y - 4, { vx: (Math.random() - 0.5) * 200, vy: -40 - Math.random() * 60, life: 24 + Math.random() * 12, size: 8 + Math.random() * 8, col: 'rgba(210,200,180,' });
        }
    },

    ring(x, y, col, size = 40) { this.spawn('ring', x, y, { life: 22, size, col }); },

    text(x, y, s, col = '#ffd23f', size = 40, life = 50) {
        this.spawn('text', x, y, { text: s, col, size, life, vy: -60 });
    },

    shake(mag, frames) {
        if (!this.enabled.shake) return;
        if (mag >= this.shakeMag || this.shakeT <= 0) { this.shakeMag = mag; this.shakeT = frames; }
    },
    flash(col = '#fff', frames = 6) { this.flashCol = col; this.flashT = frames; },

    shakeOffset() {
        if (this.shakeT <= 0) return [0, 0];
        const k = this.shakeMag * (this.shakeT / 12);
        return [(Math.random() - 0.5) * k, (Math.random() - 0.5) * k];
    },

    /** Dipanggil per frame render (frozen = super freeze: partikel tetap bergerak) */
    update(dt) {
        const f = dt * 60;
        if (this.shakeT > 0) this.shakeT -= f;
        if (this.flashT > 0) this.flashT -= f;
        for (let i = this.live.length - 1; i >= 0; i--) {
            const p = this.live[i];
            p.life -= f;
            if (p.life <= 0) { this.live[i] = this.live[this.live.length - 1]; this.live.pop(); this.pool.push(p); continue; }
            p.x += p.vx * dt; p.y += p.vy * dt;
            if (p.type === 'spark') { p.vx *= 0.9; p.vy *= 0.9; }
            if (p.type === 'dust') { p.vx *= 0.94; p.size += 0.4 * f; }
        }
    },

    draw(ctx, cam) {
        for (const p of this.live) {
            const k = Math.max(0, p.life / p.max), x = p.x - cam, y = p.y;
            switch (p.type) {
                case 'spark':
                    ctx.strokeStyle = p.col; ctx.globalAlpha = k; ctx.lineWidth = p.size; ctx.lineCap = 'round';
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * 0.03, y - p.vy * 0.03); ctx.stroke();
                    break;
                case 'burst': {
                    ctx.globalAlpha = k;
                    const r = p.size * (1.2 - k * 0.6);
                    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
                    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, p.col); g.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
                    ctx.globalCompositeOperation = 'source-over';
                    break;
                }
                case 'star': {
                    ctx.globalAlpha = k; ctx.fillStyle = p.col; ctx.beginPath();
                    const r = p.size * (1.3 - k * 0.5);
                    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.25 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
                    ctx.closePath(); ctx.fill();
                    break;
                }
                case 'ring':
                    ctx.globalAlpha = k; ctx.strokeStyle = p.col; ctx.lineWidth = 4 * k + 1;
                    ctx.beginPath(); ctx.arc(x, y, p.size + (1 - k) * p.size * 2.5, 0, 6.283); ctx.stroke();
                    break;
                case 'dust':
                    ctx.globalAlpha = 1; ctx.fillStyle = p.col + (0.45 * k) + ')';
                    ctx.beginPath(); ctx.arc(x, y, p.size, 0, 6.283); ctx.fill();
                    break;
                case 'text':
                    ctx.globalAlpha = Math.min(1, k * 2);
                    Renderer.txt(ctx, p.text, x, y, p.size * (1 + Math.max(0, (k - 0.85)) * 3), p.col, 'center', 6);
                    break;
            }
        }
        ctx.globalAlpha = 1;
    },

    drawScreen(ctx) {
        if (this.flashT > 0) {
            ctx.globalAlpha = Math.min(0.8, this.flashT / 8);
            ctx.fillStyle = this.flashCol; ctx.fillRect(0, 0, 1280, 720);
            ctx.globalAlpha = 1;
        }
    },

    clear() { while (this.live.length) this.pool.push(this.live.pop()); this.shakeT = 0; this.flashT = 0; }
};
