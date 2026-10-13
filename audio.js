'use strict';
/* =====================================================================
 * audio.js — Sound system berbasis Web Audio API
 * ---------------------------------------------------------------------
 * Semua SFX & musik DISINTESIS secara prosedural, jadi game langsung
 * bersuara tanpa file audio apa pun. Jika kamu menaruh file di
 * assets/audio/sfx/<nama>.wav (nama sama seperti di SOUND_FILES),
 * file itu otomatis dipakai menggantikan suara sintetis.
 * Suara announcer memakai Speech Synthesis browser.
 * ===================================================================== */
const SOUND_FILES = {
    hit_light: 'assets/audio/sfx/hit_light.wav', hit_medium: 'assets/audio/sfx/hit_medium.wav', hit_heavy: 'assets/audio/sfx/hit_heavy.wav',
    hit_special: 'assets/audio/sfx/hit_special.wav', block: 'assets/audio/sfx/block.wav', whoosh_light: 'assets/audio/sfx/whoosh_light.wav',
    whoosh_heavy: 'assets/audio/sfx/whoosh_heavy.wav', projectile: 'assets/audio/sfx/projectile.wav', rising: 'assets/audio/sfx/rising.wav',
    jump: 'assets/audio/sfx/jump.wav', land: 'assets/audio/sfx/land.wav', ko: 'assets/audio/sfx/ko.wav', round_start: 'assets/audio/sfx/fight.wav',
    victory: 'assets/audio/sfx/victory.wav', super_activate: 'assets/audio/sfx/super.wav', counter: 'assets/audio/sfx/counter.wav',
    select: 'assets/audio/sfx/select.wav', confirm: 'assets/audio/sfx/confirm.wav'
};

const AudioSys = {
    ctx: null, master: null, sfxGain: null, bgmGain: null, noiseBuf: null,
    vol: { bgm: 0.5, sfx: 0.8, voice: 0.8 }, announcer: true,
    buffers: {}, bgmTimer: null, bgmStep: 0, bgmNext: 0, bgmSong: null,

    /** Harus dipanggil dari interaksi user (klik) — aturan autoplay browser */
    init() {
        if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
        const comp = this.ctx.createDynamicsCompressor(); comp.connect(this.master);
        this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(comp);
        this.bgmGain = this.ctx.createGain(); this.bgmGain.connect(comp);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.setVolumes(this.vol);
        if (CONFIG.USE_AUDIO_FILES) this.loadFiles();
    },

    // Lazy-load file audio opsional (gagal = diam-diam pakai sintesis)
    loadFiles() {
        for (const [k, url] of Object.entries(SOUND_FILES)) {
            fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
                .then((b) => this.ctx.decodeAudioData(b)).then((buf) => { this.buffers[k] = buf; }).catch(() => {});
        }
    },

    setVolumes(v) {
        Object.assign(this.vol, v);
        if (!this.ctx) return;
        this.sfxGain.gain.value = this.vol.sfx;
        this.bgmGain.gain.value = this.vol.bgm * 0.5;
    },

    tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null, when = 0, dest = null) {
        const c = this.ctx, t = c.currentTime + when;
        const o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(dest || this.sfxGain);
        o.start(t); o.stop(t + dur + 0.02);
    },

    noise(dur, vol = 0.3, ftype = 'bandpass', freq = 1500, q = 1, slideTo = null, when = 0, dest = null) {
        const c = this.ctx, t = c.currentTime + when;
        const s = c.createBufferSource(); s.buffer = this.noiseBuf;
        const f = c.createBiquadFilter(); f.type = ftype; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
        if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f); f.connect(g); g.connect(dest || this.sfxGain);
        s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    },

    play(name) {
        if (!this.ctx || this.vol.sfx <= 0) return;
        if (this.buffers[name]) {
            const s = this.ctx.createBufferSource(); s.buffer = this.buffers[name]; s.connect(this.sfxGain); s.start(); return;
        }
        switch (name) {
            case 'hit_light': this.noise(0.07, 0.5, 'bandpass', 2400, 1.2); this.tone(220, 0.06, 'sine', 0.4, 120); break;
            case 'hit_medium': this.noise(0.1, 0.6, 'bandpass', 1500, 1); this.tone(160, 0.1, 'sine', 0.5, 70); break;
            case 'hit_heavy': this.noise(0.18, 0.7, 'lowpass', 1800, 0.7, 300); this.tone(110, 0.2, 'sine', 0.7, 40); this.tone(70, 0.25, 'triangle', 0.4, 35); break;
            case 'hit_special': this.noise(0.22, 0.6, 'bandpass', 900, 0.8, 200); this.tone(300, 0.2, 'square', 0.15, 80); this.tone(90, 0.25, 'sine', 0.6, 40); break;
            case 'block': this.noise(0.05, 0.5, 'highpass', 3500, 1); this.tone(1200, 0.08, 'square', 0.08, 900); break;
            case 'whoosh_light': this.noise(0.12, 0.18, 'bandpass', 800, 2, 2600); break;
            case 'whoosh_heavy': this.noise(0.2, 0.28, 'bandpass', 500, 2, 2000); break;
            case 'projectile': this.tone(500, 0.35, 'sawtooth', 0.12, 120); this.noise(0.35, 0.3, 'bandpass', 1200, 3, 300); break;
            case 'rising': this.tone(200, 0.3, 'square', 0.12, 900); this.noise(0.25, 0.25, 'bandpass', 700, 2, 3000); break;
            case 'jump': this.tone(280, 0.1, 'triangle', 0.15, 520); break;
            case 'land': this.tone(90, 0.1, 'sine', 0.35, 50); this.noise(0.08, 0.2, 'lowpass', 600); break;
            case 'ko': this.tone(80, 0.9, 'sawtooth', 0.35, 30); this.noise(0.9, 0.6, 'lowpass', 1200, 0.7, 100); this.tone(55, 1.2, 'sine', 0.8, 25); break;
            case 'round_start': this.tone(440, 0.15, 'square', 0.15); this.tone(660, 0.3, 'square', 0.15, null, 0.12); break;
            case 'victory': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.25, null, i * 0.14)); break;
            case 'super_activate': this.noise(0.5, 0.4, 'bandpass', 300, 1, 5000); [220, 277, 330, 440].forEach((f, i) => this.tone(f, 0.6, 'sawtooth', 0.1, f * 2, i * 0.03)); break;
            case 'counter': this.tone(1320, 0.25, 'square', 0.15, 1760); this.tone(880, 0.25, 'triangle', 0.2); break;
            case 'select': this.tone(660, 0.05, 'square', 0.1); break;
            case 'confirm': this.tone(523, 0.08, 'square', 0.12); this.tone(784, 0.15, 'square', 0.12, null, 0.07); break;
            case 'burst': this.noise(0.4, 0.5, 'bandpass', 4000, 1, 300); this.tone(880, 0.3, 'sine', 0.3, 220); break;
            case 'guardbreak': this.tone(1500, 0.4, 'square', 0.15, 200); this.noise(0.3, 0.5, 'highpass', 2000); break;
        }
    },

    /** Announcer: memakai Speech Synthesis */
    say(text) {
        if (!this.announcer || this.vol.voice <= 0 || !('speechSynthesis' in window)) return;
        try {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'en-US'; u.rate = 0.85; u.pitch = 0.5; u.volume = this.vol.voice;
            speechSynthesis.cancel(); speechSynthesis.speak(u);
        } catch (e) { /* abaikan */ }
    },

    /* ---------------- MUSIK LATAR (sequencer sederhana) ---------------- */
    SONGS: {
        menu:    { bpm: 96,  root: 57, scale: [0, 3, 5, 7, 10], bass: [0, 0, 3, 5], lead: 'triangle', drums: 'soft' },
        dojo:    { bpm: 118, root: 57, scale: [0, 2, 3, 7, 8],  bass: [0, 0, 5, 3], lead: 'triangle', drums: 'taiko' },
        temple:  { bpm: 108, root: 55, scale: [0, 2, 4, 7, 9],  bass: [0, 5, 3, 4], lead: 'square', drums: 'gong' },
        neon:    { bpm: 128, root: 52, scale: [0, 3, 5, 7, 10], bass: [0, 0, 5, 3], lead: 'sawtooth', drums: 'four' },
        volcano: { bpm: 140, root: 45, scale: [0, 1, 3, 5, 7],  bass: [0, 1, 0, 3], lead: 'sawtooth', drums: 'metal' }
    },

    bgm(name) {
        this.stopBGM();
        if (!this.ctx) return;
        this.bgmSong = this.SONGS[name] || this.SONGS.menu;
        this.bgmStep = 0; this.bgmNext = this.ctx.currentTime + 0.1;
        this.bgmSeed = 1;
        this.bgmTimer = setInterval(() => this.schedule(), 25);
    },

    stopBGM() { if (this.bgmTimer) clearInterval(this.bgmTimer); this.bgmTimer = null; },

    schedule() {
        const s = this.bgmSong, c = this.ctx, step = 60 / s.bpm / 4;
        const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
        while (this.bgmNext < c.currentTime + 0.12) {
            const i = this.bgmStep % 64, bar = Math.floor(i / 16), w = this.bgmNext - c.currentTime;
            const g = this.bgmGain;
            // Drum
            if (s.drums === 'four') { if (i % 4 === 0) this.tone(110, 0.15, 'sine', 0.8, 40, w, g); if (i % 8 === 4) this.noise(0.12, 0.35, 'highpass', 1500, 1, null, w, g); }
            else if (s.drums === 'taiko') { if (i % 8 === 0 || i % 16 === 11) this.tone(90, 0.3, 'sine', 0.9, 45, w, g); if (i % 16 === 8) this.noise(0.1, 0.25, 'bandpass', 900, 1, null, w, g); }
            else if (s.drums === 'gong') { if (i % 16 === 0) this.tone(70, 1.4, 'sine', 0.5, 60, w, g); if (i % 4 === 2) this.noise(0.05, 0.15, 'highpass', 6000, 1, null, w, g); if (i % 8 === 4) this.tone(150, 0.15, 'sine', 0.5, 70, w, g); }
            else if (s.drums === 'metal') { if (i % 2 === 0 && (i % 8 !== 6)) this.tone(80, 0.12, 'sine', 0.8, 40, w, g); if (i % 8 === 4) this.noise(0.15, 0.4, 'bandpass', 1800, 0.8, null, w, g); }
            else { if (i % 8 === 0) this.tone(100, 0.2, 'sine', 0.5, 50, w, g); }
            if (i % 2 === 1 && s.drums !== 'soft') this.noise(0.03, 0.08, 'highpass', 8000, 1, null, w, g);
            // Bass
            if (i % 2 === 0) this.tone(midi(s.root - 12 + s.bass[bar]), step * 1.8, s.drums === 'four' ? 'sawtooth' : 'triangle', 0.18, null, w, g);
            // Melodi pentatonik semi-acak (deterministik per lagu)
            if (i % 4 === 0 || (i % 4 === 3 && this.rnd() > 0.5)) {
                const deg = s.scale[Math.floor(this.rnd() * s.scale.length)], oct = this.rnd() > 0.7 ? 12 : 0;
                this.tone(midi(s.root + 12 + deg + oct + s.bass[bar]), step * 2.5, s.lead, 0.05, null, w, g);
            }
            this.bgmNext += step; this.bgmStep++;
        }
    },
    rnd() { this.bgmSeed = (this.bgmSeed * 16807) % 2147483647; return this.bgmSeed / 2147483647; }
};
