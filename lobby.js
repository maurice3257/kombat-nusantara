'use strict';
/* =====================================================================
 * lobby.js — Semua UI di luar arena: menu, lobby online, create/join
 * room, pemilihan karakter & stage, options, daftar jurus, leaderboard,
 * replay, layar kemenangan, penonton.
 * ===================================================================== */

/* ---------------- SETTINGS (disimpan di localStorage) ---------------- */
const Settings = {
    KEY: 'kombat_settings_v1',
    defaults: {
        name: '', bgm: 0.5, sfx: 0.8, voice: 0.8, announcer: true, particles: true, shake: true, hitboxes: false,
        showFps: true, showPing: true, colorblind: false, assist: false, touch: 'auto', cpuLevel: 1,
        keys: JSON.parse(JSON.stringify(DEFAULT_KEYS))
    },
    data: null,
    load() {
        let d = {};
        try { d = JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch (e) { d = {}; }
        this.data = Object.assign({}, JSON.parse(JSON.stringify(this.defaults)), d);
        this.apply();
    },
    save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* mode privat */ } this.apply(); },
    apply() {
        const d = this.data;
        AudioSys.setVolumes({ bgm: d.bgm, sfx: d.sfx, voice: d.voice });
        AudioSys.announcer = d.announcer;
        Effects.enabled.particles = d.particles;
        Effects.enabled.shake = d.shake;
        Input.keys = d.keys;
        document.body.classList.toggle('colorblind', d.colorblind);
    }
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TIPS = [
    'Tekan dua tombol pukulan/tendangan bersamaan saat jurus spesial untuk versi EX (50 meter).',
    'HP + HK bersamaan saat menyerang = BURST: membatalkan recovery apa pun (50 meter).',
    'Tahan ← untuk block berdiri, ↓← untuk block jongkok. Serangan udara harus diblock berdiri!',
    'Sapuan (↓ + HK) selalu menjatuhkan lawan. Lalu ↓ + LK bisa memukul lawan yang tergeletak (OTG).',
    'Saat terjatuh: tekan tombol = bangun cepat, tahan ← = berguling mundur, tahan ↓ = tetap berbaring.',
    'Chain combo: LP → MP → HP berturut-turut saat kena, lalu cancel ke jurus spesial!',
    'Counter hit (memukul lawan saat ia memulai serangan) = damage +20% dan stun lebih lama.',
    'Block terus-menerus mengisi guard gauge. Penuh = GUARD BREAK!',
    'Jurus charge (Garrett & Lin Mei): tahan arah ← atau ↓ ±¾ detik, lalu → / ↑ + tombol.',
    'Super: ↓↘→↓↘→ + Pukulan saat meter penuh. Kebal di awal — cocok untuk membalas serangan!'
];

const UI = {
    current: 'menu', session: null, sel: null, previews: [], lastSession: null, specOn: false,

    /* ================= DASAR ================= */
    show(id) {
        $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + id));
        this.current = id;
        document.body.dataset.screen = id;
        if (id !== 'select' && id !== 'chars') this.previews = [];
    },

    toast(msg, type = 'info', ms = 3200) {
        const t = $('#toast');
        t.textContent = msg; t.className = 'show ' + type;
        clearTimeout(this.toastT);
        this.toastT = setTimeout(() => { t.className = ''; }, ms);
    },

    banner(text, ms = 1600) {
        return new Promise((res) => {
            const el = $('#found');
            el.querySelector('span').textContent = text;
            el.classList.add('show');
            AudioSys.play('confirm');
            setTimeout(() => { el.classList.remove('show'); res(); }, ms);
        });
    },

    countdown() {
        return new Promise((res) => {
            const el = $('#countdown');
            let n = 3;
            const tick = () => {
                if (n === 0) { el.classList.remove('show'); res(); return; }
                el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('show', 'pop');
                AudioSys.play('select'); n--; setTimeout(tick, 800);
            };
            tick();
        });
    },

    username() {
        let n = ($('#username').value || '').trim().replace(/[^\w\- .]/g, '').slice(0, 16);
        if (!n) n = 'Petarung' + Math.floor(Math.random() * 900 + 100);
        $('#username').value = n; Settings.data.name = n; Settings.save();
        return n;
    },

    /* ================= INISIALISASI ================= */
    init() {
        $('#username').value = Settings.data.name || '';
        document.addEventListener('pointerdown', () => AudioSys.init(), { once: false });

        // Menu utama
        $$('#scr-menu [data-act]').forEach((b) => b.addEventListener('click', () => {
            AudioSys.init(); AudioSys.play('confirm');
            const a = b.dataset.act;
            if (a === 'online') this.openOnline();
            if (a === 'cpu') this.openSelect({ mode: 'cpu' });
            if (a === 'local') this.openSelect({ mode: 'local' });
            if (a === 'chars') this.openChars();
            if (a === 'options') this.openOptions();
            if (a === 'leader') this.openLeader();
            if (a === 'replay') $('#replay-file').click();
        }));
        $$('[data-back]').forEach((b) => b.addEventListener('click', () => { AudioSys.play('select'); this.back(b.dataset.back); }));
        $$('button').forEach((b) => b.addEventListener('mouseenter', () => AudioSys.play('select')));

        // Lobby online
        $('#btn-create').addEventListener('click', () => this.createRoom());
        $('#btn-join').addEventListener('click', () => this.joinRoom());
        $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinRoom(); });
        $('#btn-refresh').addEventListener('click', () => this.refreshRooms());
        $('#btn-spec').addEventListener('click', () => this.spectate($('#spec-code').value));
        $('#btn-copy').addEventListener('click', () => this.copyCode());
        $('#btn-room-cancel').addEventListener('click', () => { Net.leave(); this.openOnline(); });

        // Select
        $('#btn-ready').addEventListener('click', () => this.selReady());
        $('#btn-random').addEventListener('click', () => this.selRandom());
        $('#cpu-level').addEventListener('change', (e) => { Settings.data.cpuLevel = +e.target.value; Settings.save(); });

        // Game overlays
        $('#btn-resume').addEventListener('click', () => this.pause(false));
        $('#btn-quit').addEventListener('click', () => this.quitGame());
        $('#btn-rematch').addEventListener('click', () => this.rematch());
        $('#btn-lobby').addEventListener('click', () => this.quitGame());
        $('#btn-save-replay').addEventListener('click', () => this.saveReplay());
        $('#chat-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const v = $('#chat-input').value.trim();
            if (v) Net.emit('chat', { text: v.slice(0, 120) });
            $('#chat-input').value = '';
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.current === 'game' && this.session && !this.session.ended) this.pause(!this.session.paused);
        });

        // Replay
        $('#replay-file').addEventListener('change', (e) => this.loadReplay(e.target.files[0]));

        // Status jaringan
        Net.onLocal('status', (s) => this.netStatus(s));
        Net.onLocal('error', (m) => this.toast(m, 'error', 5000));
        Net.onLocal('reconnectFailed', () => {
            this.toast('Koneksi ke server gagal setelah ' + CONFIG.RECONNECT_ATTEMPTS + 'x percobaan.', 'error', 6000);
            if (this.session && this.session.mode === 'online' && !this.session.ended) this.forceResult('Koneksi terputus');
        });
        Net.onLocal('rejoin', (res) => { if (res && !res.ok && this.session && this.session.mode === 'online' && !this.session.ended) this.forceResult('Gagal kembali ke room'); });

        Input.initTouch($('#touch'));
        this.setupTouch();
        window.addEventListener('resize', () => this.fitCanvas());
        this.fitCanvas();
        this.previewLoop();

        // Link undangan: ?join=XXXX-YYYY atau ?watch=XXXX-YYYY
        const q = new URLSearchParams(location.search);
        if (q.get('join')) { this.openOnline(); $('#join-code').value = q.get('join'); this.toast('Kode room terisi — klik JOIN ROOM', 'info'); }
        if (q.get('watch')) { this.openOnline(); $('#spec-code').value = q.get('watch'); }
    },

    back(to) {
        if (this.current === 'select' && this.sel && this.sel.mode === 'online') Net.leave();
        if (this.specOn) { Net.emit('leaveSpectate'); this.specOn = false; }
        this.show(to || 'menu');
    },

    setupTouch() {
        const isTouch = Settings.data.touch === 'on' || (Settings.data.touch === 'auto' && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
        document.body.classList.toggle('touch', isTouch);
    },

    /** Skala canvas 1280x720 agar pas layar (letterbox 16:9) */
    fitCanvas() {
        const c = $('#game-canvas'), wrap = $('.game-wrap');
        const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
        wrap.style.width = Math.floor(1280 * s) + 'px';
        wrap.style.height = Math.floor(720 * s) + 'px';
        const bg = $('#bg-canvas');
        bg.width = Math.min(1280, window.innerWidth); bg.height = Math.round(bg.width * window.innerHeight / window.innerWidth);
        document.body.classList.toggle('portrait', window.innerHeight > window.innerWidth && document.body.classList.contains('touch'));
    },

    /* ================= LOBBY ONLINE ================= */
    netStatus(s) {
        const el = $('#conn-status');
        if (!el) return;
        const map = { online: ['● Terhubung ke server', 'ok'], offline: ['● Terputus', 'bad'], error: ['● Menghubungkan… (server gratis bisa butuh ±1 menit untuk bangun)', 'warn'] };
        const [txt, cls] = map[s] || ['● Mencoba menyambung lagi… (' + s.split(':')[1] + '/' + CONFIG.RECONNECT_ATTEMPTS + ')', 'warn'];
        el.textContent = txt; el.className = 'conn ' + cls;
    },

    openOnline() {
        this.show('online');
        if (!Net.socket) {
            this.netStatus('error');
            Net.connect();
            if (Net.socket) this.bindServerEvents();
        } else this.netStatus(Net.isConnected() ? 'online' : 'error');
        setTimeout(() => this.refreshRooms(), 400);
    },

    bindServerEvents() {
        Net.on('opponentFound', async (d) => {
            this.roomPlayers = d.players;
            await this.banner('OPPONENT FOUND!');
            this.openSelect({ mode: 'online' });
        });
        Net.on('selectionUpdate', (d) => this.selFromServer(d.players));
        Net.on('startGame', (d) => this.onStartGame(d));
        Net.on('opponentStatus', (d) => {
            if (!d.connected) this.toast('Koneksi lawan terputus… menunggu (maks 15 dtk)', 'warn', 5000);
            else this.toast('Lawan tersambung kembali', 'ok');
        });
        Net.on('opponentLeft', (d) => {
            const playing = this.session && this.session.mode === 'online' && !this.session.ended;
            if (playing) { this.forceResult('Lawan keluar / terputus — kamu menang!', true); return; }
            if (this.current === 'select' || this.current === 'room' || $('#ov-victory').classList.contains('show')) {
                this.toast(d && d.reason === 'timeout' ? 'Lawan terputus.' : 'Lawan meninggalkan room.', 'warn', 4000);
                if (this.current !== 'game') { Net.leave(); this.openOnline(); }
                else $('#btn-rematch').disabled = true;
            }
        });
        Net.on('rematchWaiting', () => { $('#victory-note').textContent = 'Lawan ingin REMATCH!'; });
        Net.on('chat', (d) => {
            const li = document.createElement('li');
            li.innerHTML = `<b>${esc(d.name)}:</b> ${esc(d.text)}`;
            $('#chat-log').appendChild(li); $('#chat-log').scrollTop = 1e9;
        });
        Net.on('specStart', (d) => { if (this.specOn) this.startSpectate(d); });
        Net.on('roomList', (list) => this.renderRooms(list));
    },

    ensureConnected() {
        if (!Net.socket) { Net.connect(); if (Net.socket) this.bindServerEvents(); }
        if (!Net.isConnected()) { this.toast('Belum terhubung ke server. Tunggu sebentar lalu coba lagi.', 'warn'); return false; }
        return true;
    },

    createRoom() {
        if (!this.ensureConnected()) return;
        const name = this.username();
        Net.emit('createRoom', { username: name, isPublic: $('#public').checked }, (res) => {
            if (!res || !res.ok) { this.toast((res && res.error) || 'Gagal membuat room', 'error'); return; }
            Net.room = res.roomCode; Net.token = res.token; Net.slot = res.slot;
            this.show('room');
            $('#room-code').textContent = res.roomCode;
            const link = location.origin + location.pathname + '?join=' + res.roomCode;
            $('#room-link').textContent = link;
            const qr = $('#qr'); qr.innerHTML = '';
            if (typeof QRCode !== 'undefined') new QRCode(qr, { text: link, width: 156, height: 156, colorDark: '#0b0710', colorLight: '#ffffff' });
            else qr.textContent = '(QR tidak tersedia)';
        });
    },

    copyCode() {
        const code = $('#room-code').textContent;
        const done = () => this.toast('Kode ' + code + ' disalin!', 'ok');
        if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, () => this.toast('Salin manual: ' + code));
        else { const ta = document.createElement('textarea'); ta.value = code; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
    },

    joinRoom(codeArg) {
        if (!this.ensureConnected()) return;
        const code = (codeArg || $('#join-code').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length < 6 || code.length > 8) { this.toast('Kode room harus 6-8 karakter', 'error'); return; }
        const name = this.username();
        Net.emit('joinRoom', { roomCode: code, username: name }, (res) => {
            if (!res || !res.ok) { this.toast((res && res.error) || 'Gagal join', 'error', 4000); return; }
            Net.room = res.roomCode; Net.token = res.token; Net.slot = res.slot;
            // event 'opponentFound' akan datang dari server
        });
    },

    refreshRooms() {
        if (!Net.isConnected()) return;
        Net.emit('listRooms', {}, (res) => this.renderRooms(res && res.rooms));
    },

    renderRooms(list) {
        const ul = $('#room-list');
        if (!list || !list.length) { ul.innerHTML = '<li class="empty">Belum ada room publik. Buat satu!</li>'; return; }
        ul.innerHTML = list.map((r) => `<li><span><b>${esc(r.host)}</b> <small>${esc(r.code)}</small></span>
            <span class="tag ${r.state}">${r.state === 'waiting' ? 'MENUNGGU' : 'BERTANDING'}</span>
            ${r.state === 'waiting' ? `<button class="mini" data-join="${esc(r.code)}">JOIN</button>` : `<button class="mini ghost" data-watch="${esc(r.code)}">TONTON</button>`}</li>`).join('');
        $$('[data-join]', ul).forEach((b) => b.addEventListener('click', () => this.joinRoom(b.dataset.join)));
        $$('[data-watch]', ul).forEach((b) => b.addEventListener('click', () => this.spectate(b.dataset.watch)));
    },

    /* ================= PILIH KARAKTER ================= */
    openSelect(cfg) {
        const online = cfg.mode === 'online';
        this.sel = { mode: cfg.mode, picks: [null, null], hover: [ROSTER[0].id, ROSTER[1].id], stage: [0, 0], ready: [false, false],
                     picking: 0, mySlot: online ? Net.slot : 0, names: online ? (this.roomPlayers || []).map((p) => p.name) : ['PLAYER 1', cfg.mode === 'cpu' ? 'CPU' : 'PLAYER 2'] };
        this.show('select');
        $('#sel-title').textContent = online ? 'ONLINE — PILIH PETARUNG' : cfg.mode === 'cpu' ? 'VS CPU — PILIH PETARUNG' : 'VERSUS LOKAL — PILIH PETARUNG';
        $('#cpu-wrap').style.display = cfg.mode === 'cpu' ? '' : 'none';
        $('#cpu-level').value = Settings.data.cpuLevel;
        $('#room-badge').textContent = online ? 'ROOM ' + Net.room : '';

        // Grid karakter
        const grid = $('#char-grid'); grid.innerHTML = '';
        this.previews = [];
        ROSTER.forEach((c) => {
            const card = document.createElement('button');
            card.className = 'char-card'; card.dataset.id = c.id;
            card.innerHTML = `<canvas width="120" height="140"></canvas><span>${c.name}</span><i class="p1">P1</i><i class="p2">P2</i>`;
            card.style.setProperty('--fx', c.look.fx);
            card.addEventListener('mouseenter', () => { const s = this.selSlot(); if (s !== null && !this.sel.picks[s]) { this.sel.hover[s] = c.id; this.selRender(); } });
            card.addEventListener('click', () => this.selPick(c.id));
            grid.appendChild(card);
            this.addPreview(card.querySelector('canvas'), c.id, 0.62, 1, { demo: false });
        });
        // Panel pemain
        for (let s = 0; s < 2; s++) this.addPreview($('#prev-p' + (s + 1)), () => this.sel.picks[s] || this.sel.hover[s], 1.25, s === 0 ? 1 : -1, { demo: true, alt: () => s === 1 && (this.sel.picks[0] || this.sel.hover[0]) === (this.sel.picks[1] || this.sel.hover[1]) });

        // Stage
        const row = $('#stage-row'); row.innerHTML = '';
        STAGES.forEach((st, i) => {
            const b = document.createElement('button');
            b.className = 'stage-card'; b.dataset.i = i;
            b.innerHTML = `<canvas width="192" height="108"></canvas><span>${st.name}</span><i class="p1">P1</i><i class="p2">P2</i>`;
            const cx = b.querySelector('canvas').getContext('2d');
            cx.scale(0.15, 0.15); Renderer.drawStage(cx, i, 300, 100, false);
            b.addEventListener('click', () => this.selStage(i));
            row.appendChild(b);
        });
        this.selRender();
        if (online && this.sel.picks.every((p) => !p)) this.selFromServer(this.roomPlayers || []);
    },

    /** Slot yang sedang dikendalikan pemain di komputer ini */
    selSlot() {
        const s = this.sel;
        if (s.mode === 'online') return s.mySlot;
        return s.picking > 1 ? null : s.picking;
    },

    selPick(id) {
        const s = this.sel, slot = this.selSlot();
        AudioSys.play('confirm');
        if (s.mode === 'online') {
            if (s.ready[slot]) return;
            s.picks[slot] = id;
            Net.emit('selectCharacter', { character: id, stage: s.stage[slot] });
        } else {
            if (slot === null) { s.picks = [null, null]; s.picking = 0; }
            else { s.picks[slot] = id; s.picking++; }
            if (s.picking === 1 && s.mode === 'cpu') this.toast('Sekarang pilih lawan CPU (atau ACAK)', 'info', 2000);
            if (s.picking === 1 && s.mode === 'local') this.toast('Player 2 memilih', 'info', 2000);
        }
        this.selRender();
    },

    selRandom() {
        const r = ROSTER[Math.floor(Math.random() * ROSTER.length)].id;
        if (this.selSlot() === null) return;
        this.selPick(r);
    },

    selStage(i) {
        const s = this.sel;
        AudioSys.play('select');
        if (s.mode === 'online') { s.stage[s.mySlot] = i; Net.emit('selectCharacter', { character: s.picks[s.mySlot], stage: i }); }
        else s.stage = [i, i];
        this.selRender();
    },

    selReady() {
        const s = this.sel;
        if (s.mode === 'online') {
            const me = s.mySlot;
            if (!s.picks[me]) { this.toast('Pilih petarung dulu!', 'warn'); return; }
            s.ready[me] = !s.ready[me];
            Net.emit('setReady', { ready: s.ready[me], assist: Settings.data.assist });
            this.selRender();
            return;
        }
        if (!s.picks[0] || !s.picks[1]) { this.toast('Kedua petarung harus dipilih', 'warn'); return; }
        s.ready = [true, true];
        this.selRender();
        this.launch({
            mode: s.mode, chars: s.picks.slice(), names: s.mode === 'cpu' ? [Settings.data.name || 'PLAYER 1', 'CPU'] : ['PLAYER 1', 'PLAYER 2'],
            stage: s.stage[0], assist: [Settings.data.assist, s.mode === 'local' ? Settings.data.assist : false], cpuLevel: Settings.data.cpuLevel
        });
    },

    selFromServer(players) {
        const s = this.sel;
        if (!s || s.mode !== 'online' || !players) return;
        players.forEach((p) => {
            if (p.character) s.picks[p.slot] = p.character;
            s.stage[p.slot] = p.stage || 0;
            s.ready[p.slot] = !!p.ready;
            s.names[p.slot] = p.name;
        });
        this.selRender();
    },

    selRender() {
        const s = this.sel;
        if (!s) return;
        for (let i = 0; i < 2; i++) {
            const id = s.picks[i] || s.hover[i], c = charById(id);
            const panel = $('#sel-p' + (i + 1));
            panel.querySelector('.who').textContent = (s.names[i] || 'P' + (i + 1)) + (s.mode === 'online' && i === s.mySlot ? ' (KAMU)' : '');
            panel.querySelector('.cname').textContent = c.name;
            panel.querySelector('.ctitle').textContent = c.title + ' · ' + c.archetype;
            panel.querySelector('.stats').innerHTML = [['DAYA', c.bars.power], ['KECEPATAN', c.bars.speed], ['KETAHANAN', c.bars.defense], ['KESULITAN', c.bars.difficulty]]
                .map(([n, v]) => `<div><label>${n}</label><b style="--v:${v * 20}%"></b></div>`).join('') +
                `<p>HP ${c.stats.hp} · SPD ${c.stats.speed} · DMG ${Math.round(c.stats.dmg * 100)}%</p>`;
            const rd = panel.querySelector('.ready');
            rd.textContent = s.ready[i] ? `P${i + 1} READY ✓` : s.picks[i] ? 'TERPILIH' : 'MEMILIH…';
            rd.className = 'ready' + (s.ready[i] ? ' on' : s.picks[i] ? ' picked' : '');
            panel.classList.toggle('active', this.selSlot() === i);
        }
        $$('.char-card').forEach((el) => {
            el.classList.toggle('p1sel', (s.picks[0] || s.hover[0]) === el.dataset.id);
            el.classList.toggle('p2sel', (s.picks[1] || s.hover[1]) === el.dataset.id);
        });
        $$('.stage-card').forEach((el) => {
            el.classList.toggle('p1sel', s.stage[0] === +el.dataset.i);
            el.classList.toggle('p2sel', s.stage[1] === +el.dataset.i);
        });
        const btn = $('#btn-ready');
        if (s.mode === 'online') btn.textContent = s.ready[s.mySlot] ? 'BATAL READY' : 'READY!';
        else btn.textContent = 'MULAI PERTANDINGAN';
        const bothPicked = s.picks[0] && s.picks[1];
        $('#stage-wrap').classList.toggle('dim', !bothPicked && s.mode !== 'online');
        $('#sel-hint').textContent = s.mode === 'online'
            ? (s.ready[0] && s.ready[1] ? 'Keduanya siap!' : 'Pilih petarung & stage, lalu READY. Jika stage berbeda, server memilih salah satu secara acak.')
            : s.picking < 2 ? `Klik petarung untuk ${s.picking === 0 ? 'PLAYER 1' : s.mode === 'cpu' ? 'CPU' : 'PLAYER 2'}` : 'Pilih stage lalu MULAI. (Klik petarung lagi untuk memilih ulang)';
    },

    onStartGame(d) {
        const me = Net.slot;
        if (this.session) { this.session.stop(); this.session = null; }
        $('#ov-victory').classList.remove('show');
        const p = d.players.slice().sort((a, b) => a.slot - b.slot);
        if (this.sel) { this.sel.ready = [true, true]; this.selRender(); }
        this.launch({
            mode: 'online', chars: p.map((x) => x.character), names: p.map((x) => x.name), stage: d.stage,
            assist: p.map((x) => !!x.assist), localSlot: me
        }, d.rematch);
    },

    async launch(opts, skipCountdown) {
        this.lastOpts = opts;
        if (!skipCountdown) await this.countdown();
        await this.loading(opts);
        this.startSession(opts);
    },

    loading(opts) {
        return new Promise((res) => {
            this.show('loading');
            const [a, b] = opts.chars.map(charById);
            $('#load-names').innerHTML = `<span style="color:${a.look.fx}">${esc(opts.names[0])}<small>${a.name}</small></span><em>VS</em><span style="color:${b.look.fx}">${esc(opts.names[1])}<small>${b.name}</small></span>`;
            $('#load-stage').textContent = STAGES[opts.stage].name;
            $('#load-tip').textContent = 'TIPS: ' + TIPS[Math.floor(Math.random() * TIPS.length)];
            this.previews = [];
            this.addPreview($('#load-canvas'), a.id, 2.1, 1, { x: 0.3, demo: true });
            this.addPreview($('#load-canvas'), b.id, 2.1, -1, { x: 0.7, demo: true, noClear: true, alt: a.id === b.id });
            const bar = $('#load-bar i'); bar.style.width = '0%';
            let p = 0;
            const iv = setInterval(() => {
                p = Math.min(100, p + 4 + Math.random() * 9);
                bar.style.width = p + '%';
                if (p >= 100) { clearInterval(iv); setTimeout(res, 250); }
            }, 60);
        });
    },

    startSession(opts) {
        this.previews = [];
        this.show('game');
        $('#ov-victory').classList.remove('show');
        $('#ov-pause').classList.remove('show');
        $('#ov-wait').classList.remove('show');
        $('#ov-chat').classList.toggle('show', opts.mode === 'spectate');
        this.fitCanvas();
        this.session = new GameSession(opts);
        this.session.start();
    },

    /* ================= DALAM GAME ================= */
    pause(on) {
        const s = this.session;
        if (!s || s.ended) return;
        if (s.mode === 'online' || s.mode === 'spectate') { // online tidak bisa pause → tampilkan menu keluar
            $('#ov-pause').classList.toggle('show', on);
            $('#btn-resume').textContent = 'LANJUT';
            return;
        }
        s.paused = on;
        $('#ov-pause').classList.toggle('show', on);
        if (on) AudioSys.stopBGM(); else AudioSys.bgm(STAGES[s.opts.stage].id);
    },

    netWait(on, ms) {
        const el = $('#ov-wait');
        if (on) {
            const left = Math.max(0, Math.ceil(15 - ms / 1000));
            el.querySelector('p').textContent = `Menunggu koneksi lawan… (${left} dtk)`;
        }
        el.classList.toggle('show', on);
    },

    quitGame() {
        const s = this.session;
        if (s) { s.stop(); this.session = null; }
        $('#ov-victory').classList.remove('show'); $('#ov-pause').classList.remove('show'); $('#ov-wait').classList.remove('show');
        $('#ov-chat').classList.remove('show');
        AudioSys.bgm('menu');
        if (s && (s.mode === 'online' || s.mode === 'spectate')) {
            if (s.mode === 'online') Net.leave(); else { Net.emit('leaveSpectate'); this.specOn = false; }
            this.openOnline();
        } else this.show('menu');
    },

    /** Akhir pertandingan paksa (lawan disconnect) */
    forceResult(msg, iWin) {
        const s = this.session;
        if (!s) return;
        s.ended = true;
        this.onMatchEnd(s, { winner: iWin ? s.localSlot : -2, names: s.match.fighters.map((f) => f.name), chars: s.opts.chars, stats: s.match.stats, note: msg });
        $('#btn-rematch').disabled = true;
    },

    onMatchEnd(session, res) {
        this.lastSession = session;
        const ov = $('#ov-victory');
        $('#ov-wait').classList.remove('show'); $('#ov-pause').classList.remove('show');
        const w = res.winner;
        let title;
        if (w === -1) title = 'DRAW!';
        else if (w === -2) title = 'PERTANDINGAN BERAKHIR';
        else if (session.mode === 'cpu') title = w === 0 ? 'KAMU MENANG!' : 'CPU MENANG!';
        else title = `PLAYER ${w + 1} WINS!`;
        $('#victory-title').textContent = title;
        $('#victory-sub').textContent = w >= 0 ? `${res.names[w]} (${charById(res.chars[w]).name})` : '';
        $('#victory-note').textContent = res.note || '';
        $('#victory-stats').innerHTML = `<tr><th></th><th>${esc(res.names[0])}</th><th>${esc(res.names[1])}</th></tr>` +
            [['Total Hit', 'hits'], ['Max Combo', 'maxCombo'], ['Damage', 'damage'], ['Jurus Spesial', 'specials'], ['Super', 'supers']]
                .map(([l, k]) => `<tr><td>${l}</td><td>${res.stats[0][k]}</td><td>${res.stats[1][k]}</td></tr>`).join('');
        $('#btn-rematch').disabled = session.mode === 'spectate' || session.mode === 'replay';
        $('#btn-rematch').textContent = 'REMATCH';
        $('#btn-save-replay').style.display = session.mode === 'spectate' ? 'none' : '';
        $('#btn-lobby').textContent = session.mode === 'online' || session.mode === 'spectate' ? 'KEMBALI KE LOBBY' : 'MENU UTAMA';
        ov.classList.add('show');
        // Simpan skor ke leaderboard (hanya host/P1 yang melapor agar tidak ganda)
        if (session.mode === 'online' && session.localSlot === 0 && w >= 0 && !res.note) {
            this.postScore(res.names[w], res.names[1 - w], res.chars[w], res.chars[1 - w]);
        }
        if (session.mode === 'online') Net.emit('matchEnd', { winner: w });
    },

    rematch() {
        const s = this.lastSession;
        if (!s) return;
        AudioSys.play('confirm');
        if (s.mode === 'online') {
            Net.emit('rematch');
            $('#btn-rematch').disabled = true; $('#btn-rematch').textContent = 'MENUNGGU LAWAN…';
            return;
        }
        if (this.session) this.session.stop();
        this.launch(Object.assign({}, this.lastOpts), true);
    },

    /* ================= REPLAY ================= */
    saveReplay() {
        const s = this.lastSession;
        if (!s) return;
        const data = s.replayData();
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `replay_${data.chars.join('_vs_')}_${Date.now()}.kombat.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        this.toast('Replay disimpan. Buka lewat menu TONTON REPLAY.', 'ok');
    },

    loadReplay(file) {
        if (!file) return;
        const fr = new FileReader();
        fr.onload = () => {
            try {
                const d = JSON.parse(fr.result);
                if (d.v !== 1 || !d.inputs) throw new Error('format');
                const inputs = d.inputs.map(rleDecode);
                AudioSys.init();
                this.lastOpts = null;
                this.startSession({ mode: 'replay', chars: d.chars, names: d.names, stage: d.stage, assist: d.assist, replayInputs: inputs });
            } catch (e) { this.toast('File replay tidak valid', 'error'); }
        };
        fr.readAsText(file);
        $('#replay-file').value = '';
    },

    /* ================= PENONTON ================= */
    spectate(code) {
        if (!this.ensureConnected()) return;
        code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length < 6) { this.toast('Masukkan kode room untuk ditonton', 'error'); return; }
        Net.emit('spectate', { roomCode: code, username: this.username() }, (res) => {
            if (!res || !res.ok) { this.toast((res && res.error) || 'Room tidak ditemukan', 'error'); return; }
            this.specOn = true;
            $('#chat-log').innerHTML = '';
            if (res.match) this.startSpectate(res.match);
            else this.toast('Terhubung sebagai penonton. Menunggu pertandingan dimulai…', 'info', 5000);
        });
    },

    startSpectate(m) {
        if (this.session) this.session.stop();
        this.startSession({ mode: 'spectate', chars: m.chars, names: m.names, stage: m.stage, assist: m.assist, specLog: m.log });
    },

    /* ================= LEADERBOARD (PHP + MySQL) ================= */
    postScore(winner, loser, wc, lc) {
        fetch(CONFIG.API_URL + 'save_score.php', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winner, loser, winner_char: wc, loser_char: lc })
        }).then((r) => r.json()).then((d) => { if (d && d.ok) this.toast(`Skor tersimpan! ELO ${winner}: ${d.winner_elo}`, 'ok'); }).catch(() => {});
    },

    openLeader() {
        this.show('leader');
        const tb = $('#leader-table');
        tb.innerHTML = '<tr><td colspan="6">Memuat…</td></tr>';
        fetch(CONFIG.API_URL + 'get_leaderboard.php').then((r) => r.json()).then((d) => {
            if (!d.ok) throw new Error(d.error);
            if (!d.players.length) { tb.innerHTML = '<tr><td colspan="6">Belum ada data. Mainkan pertandingan online!</td></tr>'; return; }
            tb.innerHTML = '<tr><th>#</th><th>Nama</th><th>ELO</th><th>Menang</th><th>Kalah</th><th>Streak</th></tr>' +
                d.players.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.username)}</td><td>${p.elo}</td><td>${p.wins}</td><td>${p.losses}</td><td>${p.streak > 1 ? '🔥' + p.streak : p.streak}</td></tr>`).join('');
        }).catch(() => {
            tb.innerHTML = '<tr><td colspan="6">Leaderboard belum tersedia. API PHP berjalan setelah di-upload ke InfinityFree dan database dikonfigurasi (lihat README).</td></tr>';
        });
    },

    /* ================= OPTIONS ================= */
    openOptions() {
        this.show('options');
        const d = Settings.data, box = $('#opt-body');
        const slider = (k, l) => `<label class="opt"><span>${l}</span><input type="range" min="0" max="1" step="0.05" data-k="${k}" value="${d[k]}"><em>${Math.round(d[k] * 100)}%</em></label>`;
        const tog = (k, l) => `<label class="opt tog"><span>${l}</span><input type="checkbox" data-k="${k}" ${d[k] ? 'checked' : ''}><i></i></label>`;
        box.innerHTML = `
          <section><h3>Audio</h3>${slider('bgm', 'Musik (BGM)')}${slider('sfx', 'Efek Suara (SFX)')}${slider('voice', 'Suara Announcer')}${tog('announcer', 'Announcer aktif')}</section>
          <section><h3>Grafis</h3>${tog('particles', 'Partikel')}${tog('shake', 'Screen shake')}${tog('showFps', 'Tampilkan FPS')}${tog('showPing', 'Tampilkan ping')}${tog('hitboxes', 'Debug hitbox')}</section>
          <section><h3>Aksesibilitas</h3>${tog('colorblind', 'Mode buta warna')}${tog('assist', 'Input Assist (jurus lebih mudah)')}
            <label class="opt"><span>Kontrol sentuh</span><select data-k="touch"><option value="auto">Otomatis</option><option value="on">Selalu</option><option value="off">Mati</option></select></label></section>
          <section class="wide"><h3>Kontrol Keyboard <small>(klik tombol lalu tekan key baru)</small></h3><table class="keys" id="keys-table"></table>
            <button class="mini ghost" id="btn-keys-reset">RESET DEFAULT</button></section>`;
        box.querySelector('select[data-k=touch]').value = d.touch;
        $$('[data-k]', box).forEach((el) => el.addEventListener('input', () => {
            const k = el.dataset.k;
            d[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
            if (el.type === 'range') el.nextElementSibling.textContent = Math.round(d[k] * 100) + '%';
            Settings.save();
            if (k === 'touch') this.setupTouch();
            if (k === 'sfx') AudioSys.play('hit_medium');
        }));
        this.renderKeys();
        $('#btn-keys-reset').addEventListener('click', () => { d.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS)); Settings.save(); this.renderKeys(); });
    },

    renderKeys() {
        const d = Settings.data, tb = $('#keys-table');
        const pretty = (c) => c.replace(/^Key/, '').replace(/^Digit/, '').replace('Arrow', '').replace('Numpad', 'Num ');
        tb.innerHTML = '<tr><th>Aksi</th><th>Player 1</th><th>Player 2</th></tr>' + ACTIONS.map((a) =>
            `<tr><td>${ACTION_LABEL[a]}</td>${['p1', 'p2'].map((p) => `<td><button class="key" data-p="${p}" data-a="${a}">${d.keys[p][a].map(pretty).join(' / ')}</button></td>`).join('')}</tr>`).join('');
        $$('.key', tb).forEach((b) => b.addEventListener('click', () => {
            b.textContent = '…tekan key…'; b.classList.add('wait');
            Input.rebindCb = (code) => {
                if (code !== 'Escape') { d.keys[b.dataset.p][b.dataset.a] = [code]; Settings.save(); }
                this.renderKeys();
            };
        }));
    },

    /* ================= KARAKTER & JURUS ================= */
    openChars(id) {
        this.show('chars');
        const tabs = $('#chars-tabs');
        tabs.innerHTML = ROSTER.map((c) => `<button data-id="${c.id}" style="--fx:${c.look.fx}">${c.name}</button>`).join('');
        $$('button', tabs).forEach((b) => b.addEventListener('click', () => this.showChar(b.dataset.id)));
        this.showChar(id || ROSTER[0].id);
    },

    showChar(id) {
        const c = charById(id);
        $$('#chars-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
        const btn = (b) => (b === 'P' ? 'P' : 'K');
        $('#chars-detail').innerHTML = `
          <div class="cd-art"><canvas id="cd-canvas" width="300" height="320"></canvas></div>
          <div class="cd-info">
            <h2 style="color:${c.look.fx}">${c.name} <small>${c.title}</small></h2>
            <p class="arch">${c.archetype} · HP ${c.stats.hp} · Speed ${c.stats.speed} · Damage ${Math.round(c.stats.dmg * 100)}%</p>
            <p>${c.desc}</p>
            <table class="moves">
              <tr><th colspan="2">JURUS SPESIAL</th></tr>
              ${c.specials.map((s) => `<tr><td>${s.name}</td><td><code>${MOTION_LABEL[s.motion]} + ${btn(s.btn)}</code></td></tr>`).join('')}
              <tr><th colspan="2">SUPER (meter 100)</th></tr>
              <tr><td>${c.super.name}</td><td><code>${MOTION_LABEL.qcfqcf} + P</code></td></tr>
              <tr><th colspan="2">MEKANIK UMUM</th></tr>
              <tr><td>EX Special (50 meter)</td><td><code>jurus + 2 tombol P/K bersamaan</code></td></tr>
              <tr><td>Burst / Roman Cancel (50)</td><td><code>HP + HK saat menyerang</code></td></tr>
              <tr><td>Chain combo</td><td><code>L → M → H, lalu cancel ke spesial</code></td></tr>
              <tr><td>Uppercut (launcher) / Sweep</td><td><code>↓ + HP / ↓ + HK</code></td></tr>
              <tr><td>Block berdiri / jongkok</td><td><code>← atau BLOCK / ↙</code></td></tr>
              <tr><td>Bangun: cepat / mundur / diam</td><td><code>tombol / ← / ↓ saat jatuh</code></td></tr>
            </table>
            <p class="small">P = pukulan (LP/MP/HP), K = tendangan (LK/MK/HK). Arah ditulis untuk karakter yang menghadap ke kanan.</p>
          </div>`;
        this.previews = [];
        this.addPreview($('#cd-canvas'), id, 1.7, 1, { demo: true });
    },

    /* ================= PREVIEW ANIMASI KARAKTER ================= */
    /**
     * Petarung kecil yang beranimasi di canvas UI (grid, panel, loading).
     * idOrFn bisa string id atau fungsi yang mengembalikan id (panel P1/P2).
     */
    addPreview(canvas, idOrFn, scale, facing, o = {}) {
        this.previews.push({ canvas, idOrFn, scale, facing, o, c: null, id: null, t: Math.floor(Math.random() * 100) });
    },

    previewLoop() {
        const step = () => {
            const cleared = new Set();
            for (const p of this.previews) {
                const id = typeof p.idOrFn === 'function' ? p.idOrFn() : p.idOrFn;
                const alt = typeof p.o.alt === 'function' ? p.o.alt() : !!p.o.alt;
                if (!p.c || p.id !== id || p.alt !== alt) {
                    p.c = new Character(charById(id), 0, 0, { alt }); p.id = id; p.alt = alt; p.c.facing = p.facing;
                }
                this.demoTick(p);
                const ctx = p.canvas.getContext('2d'), w = p.canvas.width, h = p.canvas.height;
                if (!cleared.has(p.canvas)) { ctx.clearRect(0, 0, w, h); cleared.add(p.canvas); }
                Renderer.drawFighter(ctx, p.c, w * (p.o.x || 0.5), h - 10 * p.scale, { scale: p.scale });
            }
            this.drawBg();
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    },

    /** Demo: sesekali memperagakan jurus di layar pilih karakter */
    demoTick(p) {
        const c = p.c;
        p.t++; c.animT++;
        if (c.flash > 0) c.flash--;
        if (c.state === 'attack') {
            const a = c.action, d = a.def;
            a.t++;
            if (a.t > d.startup + d.active + Math.max(d.recovery, 14)) { c.action = null; c.state = 'idle'; }
            return;
        }
        if (p.o.demo && p.t % 150 === 0) {
            const pool = [c.moves.normals.HP, c.moves.normals.HK, c.moves.normals.MK, ...c.moves.specials.map((s) => s.v[1])];
            const d = pool[Math.floor(Math.random() * pool.length)];
            c.action = { def: d, t: 0, hits: 0 }; c.state = 'attack';
        }
    },

    /* ================= BACKGROUND MENU (parallax) ================= */
    bg: { t: 0, stage: 0, fighters: null },
    drawBg() {
        const visible = this.current !== 'game';
        if (!visible) return;
        const cv = $('#bg-canvas'), ctx = cv.getContext('2d'), b = this.bg;
        b.t++;
        if (b.t % 1200 === 0) b.stage = (b.stage + 1) % STAGES.length;
        if (!b.fighters) {
            const ids = ROSTER.map((r) => r.id).sort(() => Math.random() - 0.5);
            b.fighters = [0, 1].map((i) => { const c = new Character(charById(ids[i]), i, 0); c.facing = i ? -1 : 1; return { c, t: i * 70, o: { demo: true } }; });
        }
        // skala "cover": isi seluruh layar, potong sisi berlebih
        const k = Math.max(cv.width / 1280, cv.height / 720);
        ctx.save();
        ctx.translate((cv.width - 1280 * k) / 2, (cv.height - 720 * k) / 2);
        ctx.scale(k, k);
        const cam = 360 + Math.sin(b.t * 0.002) * 340;
        Renderer.drawStage(ctx, b.stage, cam, b.t, false);
        b.fighters.forEach((f, i) => {
            this.demoTick(f);
            Renderer.drawFighter(ctx, f.c, i ? 920 : 360, CONFIG.GROUND_Y, { scale: 1.15 });
        });
        Renderer.drawStage(ctx, b.stage, cam, b.t, true);
        ctx.restore();
    }
};
