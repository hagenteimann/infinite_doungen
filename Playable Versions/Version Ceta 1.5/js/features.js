/* ============================================================
   WETTER-MODUL (Weather Feature Patch)
   ============================================================ */
const WEATHER_TYPES = [
{ id: 'sunny', name: 'Sonnig', icon: '☀️', dcMod: 0, bodyBg: 'radial-gradient(circle at 50% 0%, #282460 0%, #0d1330 60%, #080816 100%)', descHint: 'Die Sonne scheint hell.' },
{ id: 'cloudy', name: 'Bewölkt', icon: '☁️', dcMod: 0, bodyBg: 'radial-gradient(circle at 50% 0%, #1e2a3a 0%, #0d1520 60%, #060c14 100%)', descHint: 'Schwere Wolken hängen am Himmel.' },
{ id: 'rain', name: 'Regen', icon: '🌧️', dcMod: 1, bodyBg: 'radial-gradient(circle at 50% 0%, #1a2535 0%, #0a1020 60%, #04080f 100%)', descHint: 'Regen prasselt herab. DEX-Proben sind schwieriger.' },
{ id: 'storm', name: 'Gewitter', icon: '⛈️', dcMod: 2, bodyBg: 'radial-gradient(circle at 50% 0%, #200a30 0%, #0d0818 60%, #050308 100%)', descHint: 'Ein Sturm wütet! DEX und STR-Proben sind schwieriger.' },
{ id: 'snow', name: 'Schnee', icon: '❄️', dcMod: 1, bodyBg: 'radial-gradient(circle at 50% 0%, #1e2d40 0%, #0e1a2a 60%, #080e18 100%)', descHint: 'Schnee bedeckt alles. Bewegung ist langsam.' },
{ id: 'fog', name: 'Nebel', icon: '🌫️', dcMod: 2, bodyBg: 'radial-gradient(circle at 50% 0%, #232830 0%, #111518 60%, #08090b 100%)', descHint: 'Dicker Nebel verhüllt die Welt. Wahrnehmungsproben sind schwieriger.' },
{ id: 'heatwave', name: 'Gluthitze', icon: '🔥', dcMod: 1, bodyBg: 'radial-gradient(circle at 50% 0%, #3d1a0a 0%, #1a0a04 60%, #0d0502 100%)', descHint: 'Unerträgliche Hitze. CON-Proben werden schwieriger.' },
{ id: 'night', name: 'Nacht', icon: '🌙', dcMod: 1, bodyBg: 'radial-gradient(circle at 50% 0%, #050518 0%, #030310 60%, #010108 100%)', descHint: 'Tiefe Dunkelheit. Alle Sichtproben sind schwieriger.' },
];

const Weather = {
_interval: null,
apply: function (weatherId) {
    const wt = WEATHER_TYPES.find(w => w.id === weatherId) || WEATHER_TYPES[0];
    State.weather = { current: wt.id, name: wt.name, icon: wt.icon, dcMod: wt.dcMod };
    document.body.style.background = wt.bodyBg;

    // Update HUD badge
    const iconEl = document.getElementById('hud-weather-icon');
    const nameEl = document.getElementById('hud-weather-name');
    if (iconEl) iconEl.textContent = wt.icon;
    if (nameEl) {
        nameEl.textContent = wt.name;
        nameEl.className = 'text-xs font-bold ' + (wt.dcMod > 0 ? 'text-orange-300' : 'text-yellow-300');
    }

    // Clear old particles & interval
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    const overlay = document.getElementById('weather-overlay');
    if (!overlay) return;
    overlay.innerHTML = '';

    if (wt.id === 'rain' || wt.id === 'storm') {
        const count = wt.id === 'storm' ? 80 : 40;
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'rain-particle';
            p.style.left = Math.random() * 100 + 'vw';
            p.style.height = (8 + Math.random() * 15) + 'px';
            p.style.animationDuration = (0.4 + Math.random() * 0.4) + 's';
            p.style.animationDelay = (-Math.random() * 2) + 's';
            p.style.opacity = 0.3 + Math.random() * 0.4;
            overlay.appendChild(p);
        }
        if (wt.id === 'storm') {
            this._interval = setInterval(() => {
                if (Math.random() > 0.7) {
                    overlay.style.background = 'rgba(200,220,255,0.05)';
                    setTimeout(() => overlay.style.background = '', 80);
                    setTimeout(() => { overlay.style.background = 'rgba(200,220,255,0.03)'; setTimeout(() => overlay.style.background = '', 60); }, 120);
                }
            }, 3000);
        }
    } else if (wt.id === 'snow') {
        for (let i = 0; i < 50; i++) {
            const p = document.createElement('div');
            p.className = 'snow-particle';
            p.style.left = Math.random() * 100 + 'vw';
            p.style.width = p.style.height = (2 + Math.random() * 4) + 'px';
            p.style.animationDuration = (3 + Math.random() * 4) + 's';
            p.style.animationDelay = (-Math.random() * 6) + 's';
            overlay.appendChild(p);
        }
    } else if (wt.id === 'fog') {
        for (let i = 0; i < 3; i++) {
            const p = document.createElement('div');
            p.className = 'fog-layer';
            p.style.animationDelay = (i * 2.5) + 's';
            p.style.opacity = 0.4 + i * 0.1;
            overlay.appendChild(p);
        }
    }

    if (wt.dcMod > 0) {
        UI.addChatLog('🌦️ Wetter', `Das Wetter hat sich geändert: **${wt.name}** ${wt.icon}\n${wt.descHint}\n⚠️ Alle Proben erhalten **+${wt.dcMod} DC** durch die Witterung.`);
    }
},
randomChange: function () {
    if (Math.random() < 0.15) {
        const current = State.weather ? State.weather.current : 'sunny';
        const options = WEATHER_TYPES.filter(w => w.id !== current);
        const pick = options[Math.floor(Math.random() * options.length)];
        this.apply(pick.id);
    }
},
getWeatherContext: function () {
    const w = State.weather;
    if (!w || w.dcMod === 0) return '';
    const wt = WEATHER_TYPES.find(x => x.id === w.current);
    if (!wt) return '';
    return ` [WETTER: ${wt.name} – alle Proben +${wt.dcMod} DC. ${wt.descHint}]`;
}
};

// Wetter beim Start initialisieren
Weather.apply('sunny');

/* ============================================================
   VISUAL FEATURE LOADER (feature.json)
   ============================================================ */
const DEFAULT_FEATURES = {
    visual: {
        theme: 'arcane_ruins',
        lighting: { intensity: 0.75, color: '#7dd3fc', flicker: true, vignette: 0.28 },
        background: { gradient: ['#0b1020', '#111827'], fog: { enabled: true, density: 0.35, speed: 0.2 }, parallaxLayers: 3 },
        particles: { embers: true, dust: true, magicMotes: true, spawnRate: 0.6 },
        animations: { sceneTransition: 'fade_slide', enemySpawnFx: 'shadow_burst', critFx: 'screen_flash_red', healFx: 'green_pulse' },
        ui: { glassmorphism: true, chatTypewriter: true, choiceHoverGlow: true, damageNumbers: 'floating', hpBarStyle: 'gradient_glow' },
        portraits: { frameStyle: 'ornate', idleBreath: true, statusOverlay: true }
    },
    audio: { swordOnAttack: true, hitLayer: true, uiClick: true }
};

const VisualFX = {
    config: DEFAULT_FEATURES,
    loadConfig: async function () {
        try {
            const res = await fetch('feature.json', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            if (data && typeof data === 'object') {
                this.config = {
                    ...DEFAULT_FEATURES,
                    ...data,
                    visual: { ...DEFAULT_FEATURES.visual, ...(data.visual || {}) },
                    audio: { ...DEFAULT_FEATURES.audio, ...(data.audio || {}) }
                };
            }
        } catch (e) { }
    },
    ensureOverlay: function () {
        let overlay = document.getElementById('visual-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'visual-overlay';
            document.body.appendChild(overlay);
        }
        return overlay;
    },
    spawnMotes: function () {
        const cfg = this.config.visual || DEFAULT_FEATURES.visual;
        const overlay = this.ensureOverlay();
        overlay.innerHTML = '';
        if (!cfg.particles?.magicMotes && !cfg.particles?.dust && !cfg.particles?.embers) return;

        const count = Math.max(12, Math.floor(28 * (cfg.particles.spawnRate || 0.6)));
        for (let i = 0; i < count; i++) {
            const mote = document.createElement('div');
            mote.className = 'magic-mote';
            mote.style.left = (Math.random() * 100).toFixed(2) + 'vw';
            mote.style.top = (Math.random() * 100).toFixed(2) + 'vh';
            mote.style.animationDelay = (-Math.random() * 8).toFixed(2) + 's';
            mote.style.animationDuration = (4 + Math.random() * 6).toFixed(2) + 's';
            mote.style.opacity = (0.25 + Math.random() * 0.5).toFixed(2);
            overlay.appendChild(mote);
        }
    },
    apply: function () {
        const cfg = this.config.visual || DEFAULT_FEATURES.visual;
        const root = document.documentElement;
        root.style.setProperty('--fx-accent', cfg.lighting?.color || '#7dd3fc');
        root.style.setProperty('--fx-vignette', String(cfg.lighting?.vignette ?? 0.28));
        root.style.setProperty('--fx-light-intensity', String(cfg.lighting?.intensity ?? 0.75));

        document.body.classList.toggle('fx-vignette', (cfg.lighting?.vignette ?? 0) > 0);
        document.body.classList.toggle('fx-flicker', !!cfg.lighting?.flicker);
        document.body.classList.toggle('fx-glass', !!cfg.ui?.glassmorphism);

        this.spawnMotes();
    },
    init: async function () {
        await this.loadConfig();
        this.apply();
    }
};

window.addEventListener('load', async () => {
    try {
        await VisualFX.init();
        if (typeof Weather !== 'undefined') Weather.apply((State.weather && State.weather.current) || 'sunny');
    } catch (e) { }
});