'use strict';
/* =====================================================================
 * main.js — Titik masuk aplikasi
 * Urutan skrip di index.html: config → engine → characters → systems
 * → game → lobby → main
 * ===================================================================== */
(function boot() {
    Settings.load();
    Input.init(Settings.data.keys);
    UI.show('menu');
    UI.init();          // init bisa langsung membuka lobby bila ada ?join= / ?watch=

    // Musik menu dimulai pada interaksi pertama (aturan autoplay browser)
    const startAudio = () => {
        AudioSys.init();
        if (UI.current !== 'game') AudioSys.bgm('menu');
        window.removeEventListener('pointerdown', startAudio);
        window.removeEventListener('keydown', startAudio);
    };
    window.addEventListener('pointerdown', startAudio);
    window.addEventListener('keydown', startAudio);

    // Info server kecil di menu
    const info = document.getElementById('server-info');
    if (info) info.textContent = 'Server: ' + CONFIG.SERVER_URL.replace(/^https?:\/\//, '');

    // Pegangan debug di console: KOMBAT.session, KOMBAT.config
    window.KOMBAT = { get session() { return UI.session; }, config: CONFIG, roster: ROSTER };
})();
