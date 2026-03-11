import { State, subscribe } from './state.js';
import { TTS, DOM, initDOM, UI } from './ui.js';
import { Weather, initFeatures } from './features.js';
import { Sound } from './sound.js';
import { Utils } from './utils.js';
import { API } from './api.js';
import { Engine } from './engine.js';
import { repairStoredText, validateSaveData } from './sanitize.js';
import { AUTO_SAVE_KEY } from './constants.js';
import { initEvents } from './events.js';
import { Network } from './network.js';

const init = () => {
    Sound.initMusic();
    window.addEventListener('music-state-changed', () => UI.updateMusicControls());

    initDOM();

    const autoSave = localStorage.getItem(AUTO_SAVE_KEY);
    if (autoSave) {
        try {
            let saved = JSON.parse(autoSave);
            saved = repairStoredText(validateSaveData(saved));
            if (saved.party && saved.party.length > 0 && saved.gameStarted) {
                const time = saved._autoSaveTime ? new Date(saved._autoSaveTime).toLocaleString('de-DE') : 'Unbekannt';
                if (confirm('Auto-Save gefunden (' + time + ').\nFortsetzen?')) {
                    const legacyGold = Number(saved.gold) || 0;
                    const allowed = Object.keys(State);
                    Object.keys(saved).forEach(k => { if (k !== '_autoSaveTime' && allowed.includes(k)) State[k] = saved[k]; });
                    if (Array.isArray(State.party)) {
                        State.party = State.party.filter(c => typeof c === 'object' && c.name).map(c => Utils.sanitizeCharacter(c));
                        if (legacyGold > 0) Utils.distributeGold(State.party.filter(c => !c.isSummon), legacyGold);
                    }
                    State.sessionPhase = 'in_game';
                    DOM.storyLog.querySelector('#lobby-view')?.classList.add('hidden');
                    DOM.actionArea?.classList.remove('hidden');
                }
            }
        } catch (e) { console.error('Auto-save recovery failed:', e); }
    }

    UI.updateAll();

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (e.key === 'Escape') {
            document.querySelectorAll('.fixed:not(.hidden)').forEach(m => m.classList.add('hidden'));
        }

    });
    document.addEventListener('click', (e) => {
        Sound.handleUserGesture();
        if (State.soundEnabled && (e.target.closest('button') || e.target.closest('a') || e.target.closest('.cursor-pointer'))) {
            Sound.play('click');
        }
    });
    document.addEventListener('keydown', () => { Sound.handleUserGesture(); }, { once: true });
};

window.App = { Engine, UI, Utils, API, State, Weather, Network };
window.TTS = TTS;

if (import.meta.env?.DEV) {
    subscribe((_state, action) => {
        console.debug('[State]', action.type, action);
    });
}

// Global UI-State Sync for Chat/System Messages
subscribe((_state, action) => {
    if (action.type === 'ADD_CHAT_MSG') {
        UI.addChatLog(action.entry, null, { persist: false });
    } else if (action.type === 'ADD_SYSTEM_MSG') {
        UI.addChatLog(action.entry, null, { persist: false });
    }
});

init();
initEvents();
initFeatures();

function initBackgroundAnimation() {
    const bgElement = document.getElementById('animated-bg');
    if (!bgElement) return;

    const images = [
        'Chat_Background/Whisk_0d9136830190271b81c40512b02f802ddr.jpeg',
        'Chat_Background/Whisk_1493945a2086049b80f4121b12f6aae7dr.jpeg',
        'Chat_Background/Whisk_1aab308e30b0d95af2d44ba61788b4f6dr (1).jpeg',
        'Chat_Background/Whisk_1aab308e30b0d95af2d44ba61788b4f6dr.jpeg',
        'Chat_Background/Whisk_6b8285ab4922bdc9f3e4cc32601fd807dr.jpeg',
        'Chat_Background/Whisk_7037a463a2a7a21a7a644f762e1b17c5dr.jpeg',
        'Chat_Background/Whisk_72c21ca8790aa9b93d54513534ec10e9dr.jpeg',
        'Chat_Background/Whisk_f1637aef1076327b1f4478d302122458dr.jpeg'
    ];

    let currentIndex = 0;
    
    // Set initial image
    bgElement.style.backgroundImage = `url('${images[currentIndex]}')`;

    // Rotate every 30 seconds
    setInterval(() => {
        currentIndex = (currentIndex + 1) % images.length;
        bgElement.style.backgroundImage = `url('${images[currentIndex]}')`;
    }, 30000);
}

initBackgroundAnimation();
