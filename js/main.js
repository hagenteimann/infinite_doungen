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

init();
initEvents();
initFeatures();

