import { State, subscribe } from './state.js';
import { TTS, DOM, initDOM, UI } from './ui.js';
import { Weather, initFeatures } from './features.js';
import { Sound } from './sound.js';
import { Utils } from './utils.js';
import { API } from './api.js';
import { Engine } from './engine.js';
import { validateSaveData } from './sanitize.js';
import { AUTO_SAVE_KEY } from './constants.js';
import { initEvents } from './events.js';
import { Network } from './network.js';

const init = () => {
    initDOM();

    const autoSave = localStorage.getItem(AUTO_SAVE_KEY);
    if (autoSave) {
        try {
            let saved = JSON.parse(autoSave);
            saved = validateSaveData(saved);
            if (saved.party && saved.party.length > 0 && saved.gameStarted) {
                const time = saved._autoSaveTime ? new Date(saved._autoSaveTime).toLocaleString('de-DE') : 'Unbekannt';
                if (confirm('Auto-Save gefunden (' + time + ').\nFortsetzen?')) {
                    const allowed = Object.keys(State);
                    Object.keys(saved).forEach(k => { if (k !== '_autoSaveTime' && allowed.includes(k)) State[k] = saved[k]; });
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
        if (e.key === 'z' && e.ctrlKey) {
            e.preventDefault();
            Engine.undoLastAction();
        }
    });
    document.addEventListener('click', (e) => {
        if (State.soundEnabled) {
            Sound.getCtx().resume();
            if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.cursor-pointer')) {
                Sound.play('click');
            }
        }
    });
    document.addEventListener('keydown', () => { if (State.soundEnabled) Sound.getCtx().resume(); }, { once: true });
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
