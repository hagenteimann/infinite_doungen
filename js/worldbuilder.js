import { State, dispatch } from './state.js';
import { API } from './api.js';
import { sanitize } from './sanitize.js';
import { Utils } from './utils.js';

const WB_STORAGE_KEY = 'dm_world_config';
const TOTAL_STEPS = 5;
const CLASSES = ['Krieger', 'Waldläufer', 'Magier', 'Schurke', 'Kleriker'];
const DICE_SIZES = [4, 6, 8, 10, 12, 20];

// Local wizard state — not dispatched until finalize
const _w = {
    step: 1,
    name: '',
    description: '',
    classSpecs: {
        Krieger:    { hpBonus: 0, statBonus: 0 },
        Waldläufer: { hpBonus: 0, statBonus: 0 },
        Magier:     { hpBonus: 0, statBonus: 0 },
        Schurke:    { hpBonus: 0, statBonus: 0 },
        Kleriker:   { hpBonus: 0, statBonus: 0 },
    },
    enemies: [],
    difficulty: { diceSize: 20, hpMult: 1.0, xpMult: 1.0 },
    mapPrompt: '',
    mapImageUrl: '',
    locations: [],
    isGenerating: false,
    pendingPin: null, // { x, y } — awaiting name input
};

let _overlay = null;

// ─── Public API ──────────────────────────────────────────────────────────────

export const WorldBuilder = {
    open() {
        _readFromWizardInputs();
        _ensureOverlay();
        _overlay.classList.remove('hidden');
        _renderStep();
    },

    close() {
        _overlay?.classList.add('hidden');
    },

    nextStep() {
        _readFromWizardInputs();
        if (_w.step < TOTAL_STEPS) { _w.step++; _renderStep(); }
    },

    prevStep() {
        _readFromWizardInputs();
        if (_w.step > 1) { _w.step--; _renderStep(); }
    },

    async expandDescription() {
        if (_w.isGenerating) return;
        _readFromWizardInputs();
        if (!_w.name && !_w.description) { _showStepMsg('Bitte zuerst einen Weltnamen oder eine Beschreibung eingeben.'); return; }
        _setGenerating(true);
        try {
            const prompt = `Erweitere diese Fantasy-Weltbeschreibung atmosphärisch auf 3-4 Sätze. Weltname: "${_w.name}". Aktuelle Beschreibung: "${_w.description || 'Keine'}". Antworte NUR mit dem erweiterten Text, kein JSON.`;
            const expanded = await API.generateText(prompt, 'Du bist ein Fantasy-Weltenschöpfer. Antworte NUR mit dem erweiterten Beschreibungstext, ohne Anführungszeichen oder Erklärungen.');
            // generateText returns cleaned JSON string; for plain text prompts with non-JSON system prompts it returns the raw text
            _w.description = expanded.replace(/^"|"$/g, '').trim();
            _renderStep();
        } catch (e) {
            console.error('WorldBuilder expand error:', e);
            _showStepMsg(`Fehler: ${e.message}`);
        } finally {
            _setGenerating(false);
        }
    },

    addEnemy() {
        _w.enemies.push({ id: Utils.generateId(), name: '', hpMin: 10, hpMax: 30, description: '', portrait: '' });
        _renderStep();
        // Focus the last name input
        setTimeout(() => {
            const inputs = _overlay?.querySelectorAll('.wb-enemy-name');
            inputs?.[inputs.length - 1]?.focus();
        }, 50);
    },

    removeEnemy(id) {
        _w.enemies = _w.enemies.filter(e => e.id !== id);
        _renderStep();
    },

    async generateEnemyPortrait(id) {
        if (_w.isGenerating) return;
        _readFromWizardInputs();
        const enemy = _w.enemies.find(e => e.id === id);
        if (!enemy || !enemy.name) { _showStepMsg('Bitte zuerst einen Namen für den Gegner eingeben.'); return; }
        _setGenerating(true);
        try {
            const pUrl = await API.generateImageWithFallbacks([
                `Fantasy portrait, American shot, waist-up, highly detailed, ${enemy.name}${enemy.description ? ', ' + enemy.description : ''}`,
                `Fantasy portrait, ${enemy.name}`,
                `Monster: ${enemy.name}`,
            ]);
            enemy.portrait = pUrl;
            _renderStep();
        } catch (e) {
            console.error('WorldBuilder portrait error:', e);
            _showStepMsg(`Porträt-Fehler: ${e.message}`);
        } finally {
            _setGenerating(false);
        }
    },

    async generateMap() {
        if (_w.isGenerating) return;
        _readFromWizardInputs();
        _setGenerating(true);
        try {
            const prompt = _w.mapPrompt || `Fantasy world map, top-down view, painted style, ${_w.name || 'epic fantasy world'}`;
            const url = await API.generateImageWithFallbacks([
                `Fantasy world map, top-down view, painted style, ${prompt}`,
                `Fantasy map, ${_w.name || 'world map'}`,
                'Fantasy RPG world map, top-down painted',
            ]);
            _w.mapImageUrl = url;
            _renderStep();
        } catch (e) {
            console.error('WorldBuilder map error:', e);
            _showStepMsg(`Karten-Fehler: ${e.message}`);
        } finally {
            _setGenerating(false);
        }
    },

    handleMapClick(e) {
        const img = _overlay?.querySelector('#wb-map-img');
        if (!img) return;
        const rect = img.getBoundingClientRect();
        const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
        const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
        _w.pendingPin = { x, y };
        _renderStep();
        setTimeout(() => _overlay?.querySelector('#wb-pin-name')?.focus(), 50);
    },

    confirmLocation() {
        if (!_w.pendingPin) return;
        const nameEl = _overlay?.querySelector('#wb-pin-name');
        const typeEl = _overlay?.querySelector('#wb-pin-type');
        const name = nameEl?.value.trim();
        if (!name) { nameEl?.focus(); return; }
        _w.locations.push({
            id: Utils.generateId(),
            name,
            type: typeEl?.value || 'Ort',
            x: _w.pendingPin.x,
            y: _w.pendingPin.y,
        });
        _w.pendingPin = null;
        _renderStep();
    },

    cancelPin() {
        _w.pendingPin = null;
        _renderStep();
    },

    removeLocation(id) {
        _w.locations = _w.locations.filter(l => l.id !== id);
        _renderStep();
    },

    finalize() {
        _readFromWizardInputs();
        if (!_w.name.trim()) { _showStepMsg('Bitte einen Weltnamen eingeben.'); _w.step = 1; _renderStep(); return; }
        const config = {
            name: _w.name.trim(),
            description: _w.description.trim(),
            classSpecs: { ..._w.classSpecs },
            enemies: _w.enemies.filter(e => e.name.trim()),
            difficulty: { ..._w.difficulty },
            mapImageUrl: _w.mapImageUrl,
            locations: [..._w.locations],
        };
        dispatch({ type: 'SET_WORLD_CONFIG', config });
        _saveToStorage(config);
        WorldBuilder.close();
        // Small notification via UI toast if available
        try { window.App?.UI?.showToast?.(`🌍 Welt "${config.name}" erstellt!`); } catch (_) { /* ok */ }
    },

    loadSavedWorld() {
        const saved = _loadFromStorage();
        if (!saved) return;
        Object.assign(_w, {
            step: 1,
            name: saved.name || '',
            description: saved.description || '',
            classSpecs: saved.classSpecs || _defaultClassSpecs(),
            enemies: saved.enemies || [],
            difficulty: saved.difficulty || { diceSize: 20, hpMult: 1.0, xpMult: 1.0 },
            mapImageUrl: saved.mapImageUrl || '',
            locations: saved.locations || [],
            pendingPin: null,
        });
        dispatch({ type: 'SET_WORLD_CONFIG', config: saved });
        try { window.App?.UI?.showToast?.(`🌍 Welt "${saved.name}" geladen!`); } catch (_) { /* ok */ }
        try { window.App?.UI?.updateAll?.(); } catch (_) { /* ok */ }
    },

    deleteSavedWorld() {
        try { localStorage.removeItem(WB_STORAGE_KEY); } catch (_) { /* ok */ }
        dispatch({ type: 'SET_WORLD_CONFIG', config: null });
        try { window.App?.UI?.updateAll?.(); } catch (_) { /* ok */ }
        try { window.App?.UI?.showToast?.('Welt gelöscht.'); } catch (_) { /* ok */ }
    },

    hasSavedWorld() {
        try { return !!localStorage.getItem(WB_STORAGE_KEY); } catch (_) { return false; }
    },
};

// ─── Overlay management ──────────────────────────────────────────────────────

function _ensureOverlay() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.id = 'dm-wizard-overlay';
    _overlay.className = 'dm-wizard-overlay hidden';
    document.body.appendChild(_overlay);
}

// ─── Step rendering ──────────────────────────────────────────────────────────

function _renderStep() {
    if (!_overlay) return;
    const stepBuilders = [null, _buildStep1, _buildStep2, _buildStep3, _buildStep4, _buildStep5];
    const bodyHtml = stepBuilders[_w.step]?.() ?? '';
    const isLast = _w.step === TOTAL_STEPS;
    const isFirst = _w.step === 1;

    _overlay.innerHTML = sanitize(`
        <div class="dm-wizard-modal">
            <div class="dm-wizard-header">
                <span class="dm-wizard-title"><i class="fas fa-scroll"></i> DM Weltbauer</span>
                <button class="dm-wizard-close" data-action="dm-close" type="button">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="dm-step-bar">
                ${Array.from({ length: TOTAL_STEPS }, (_, i) => {
                    const n = i + 1;
                    const cls = n < _w.step ? 'done' : n === _w.step ? 'active' : '';
                    return `<div class="dm-step-dot ${cls}">${n < _w.step ? '<i class="fas fa-check"></i>' : n}</div>`;
                }).join('<div class="dm-step-line"></div>')}
            </div>
            <div class="dm-wizard-body">
                ${bodyHtml}
                ${_w.isGenerating ? '<div class="dm-generating"><i class="fas fa-circle-notch fa-spin"></i> KI generiert…</div>' : ''}
            </div>
            <div class="dm-wizard-footer">
                ${!isFirst ? `<button class="dm-btn-secondary" data-action="dm-prev-step" type="button"><i class="fas fa-arrow-left"></i> Zurück</button>` : '<div></div>'}
                ${!isLast
                    ? `<button class="dm-btn-primary" data-action="dm-next-step" type="button">Weiter <i class="fas fa-arrow-right"></i></button>`
                    : `<button class="dm-btn-finalize" data-action="dm-finalize" type="button"><i class="fas fa-globe"></i> Welt erstellen</button>`
                }
            </div>
        </div>
    `);

    _attachMapClickListener();
}

function _buildStep1() {
    return `
        <h3 class="dm-step-title"><i class="fas fa-globe"></i> Schritt 1 – Weltname &amp; Beschreibung</h3>
        <label class="dm-label">Weltname</label>
        <input id="wb-world-name" class="dm-input" type="text" placeholder="z.B. Aetherion, Das Reich der Asche…" value="${_esc(_w.name)}">
        <label class="dm-label">Weltbeschreibung</label>
        <textarea id="wb-world-desc" class="dm-textarea" rows="4" placeholder="Beschreibe die Welt, ihre Geschichte, Stimmung und Besonderheiten…">${_esc(_w.description)}</textarea>
        <button class="dm-btn-ai" data-action="dm-expand-desc" type="button" ${_w.isGenerating ? 'disabled' : ''}>
            <i class="fas fa-wand-magic-sparkles"></i> KI erweitern
        </button>
    `;
}

function _buildStep2() {
    const rows = CLASSES.map(cls => {
        const spec = _w.classSpecs[cls] || { hpBonus: 0, statBonus: 0 };
        return `
            <tr class="dm-class-row">
                <td class="dm-class-name">${cls}</td>
                <td>
                    <input class="dm-num-input wb-hp-bonus" data-class="${cls}" type="number" min="-20" max="50" value="${spec.hpBonus}" placeholder="0">
                </td>
                <td>
                    <input class="dm-num-input wb-stat-bonus" data-class="${cls}" type="number" min="-5" max="10" value="${spec.statBonus}" placeholder="0">
                </td>
            </tr>`;
    }).join('');
    return `
        <h3 class="dm-step-title"><i class="fas fa-shield-halved"></i> Schritt 2 – Klassen Grundwerte</h3>
        <p class="dm-hint">Passe Basiswerte pro Klasse an. Positive Zahlen stärken, negative schwächen.</p>
        <table class="dm-class-table">
            <thead><tr><th>Klasse</th><th>HP Bonus</th><th>Attribut-Bonus</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function _buildStep3() {
    const cards = _w.enemies.map(e => `
        <div class="dm-enemy-card" data-id="${e.id}">
            <div class="dm-enemy-portrait-wrap">
                ${e.portrait
                    ? `<img class="dm-enemy-portrait" src="${_esc(e.portrait)}" alt="${_esc(e.name)}">`
                    : `<div class="dm-enemy-portrait-placeholder"><i class="fas fa-skull"></i></div>`
                }
                <button class="dm-btn-ai dm-btn-portrait" data-action="dm-gen-enemy-portrait" data-id="${e.id}" type="button" ${_w.isGenerating ? 'disabled' : ''}>
                    <i class="fas fa-image"></i>
                </button>
            </div>
            <div class="dm-enemy-fields">
                <input class="dm-input wb-enemy-name" data-id="${e.id}" type="text" placeholder="Name des Gegners" value="${_esc(e.name)}">
                <div class="dm-enemy-hp-row">
                    <input class="dm-num-input wb-enemy-hp-min" data-id="${e.id}" type="number" min="1" max="999" value="${e.hpMin}" placeholder="HP min">
                    <span class="dm-hp-sep">–</span>
                    <input class="dm-num-input wb-enemy-hp-max" data-id="${e.id}" type="number" min="1" max="999" value="${e.hpMax}" placeholder="HP max">
                    <span class="dm-hint-inline">HP</span>
                </div>
                <input class="dm-input wb-enemy-desc" data-id="${e.id}" type="text" placeholder="Kurze Beschreibung…" value="${_esc(e.description)}">
            </div>
            <button class="dm-enemy-remove" data-action="dm-remove-enemy" data-id="${e.id}" type="button">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
    return `
        <h3 class="dm-step-title"><i class="fas fa-dragon"></i> Schritt 3 – Gegner &amp; Völker</h3>
        <p class="dm-hint">Definiere die Gegner deiner Welt. Der DM bevorzugt diese bei Begegnungen.</p>
        <div class="dm-enemy-list">${cards || '<p class="dm-hint dm-hint-empty">Noch keine Gegner. Füge welche hinzu!</p>'}</div>
        <button class="dm-btn-secondary dm-btn-add-enemy" data-action="dm-add-enemy" type="button">
            <i class="fas fa-plus"></i> Gegner hinzufügen
        </button>
    `;
}

function _buildStep4() {
    const diceBtns = DICE_SIZES.map(d => {
        const active = _w.difficulty.diceSize === d ? 'active' : '';
        return `<button class="dm-dice-btn ${active}" data-action="dm-set-dice" data-size="${d}" type="button">W${d}</button>`;
    }).join('');
    return `
        <h3 class="dm-step-title"><i class="fas fa-dice-d20"></i> Schritt 4 – Schwierigkeit</h3>
        <label class="dm-label">Standard-Würfelgröße</label>
        <div class="dm-dice-row">${diceBtns}</div>
        <label class="dm-label">HP-Multiplikator <span class="dm-value-badge" id="hp-mult-val">${_w.difficulty.hpMult.toFixed(1)}×</span></label>
        <input id="wb-hp-mult" class="dm-range" type="range" min="0.5" max="3.0" step="0.1" value="${_w.difficulty.hpMult}">
        <label class="dm-label">XP-Multiplikator <span class="dm-value-badge" id="xp-mult-val">${_w.difficulty.xpMult.toFixed(1)}×</span></label>
        <input id="wb-xp-mult" class="dm-range" type="range" min="0.5" max="3.0" step="0.1" value="${_w.difficulty.xpMult}">
    `;
}

function _buildStep5() {
    const pins = _w.locations.map(l => `
        <div class="dm-map-pin" style="left:${l.x}%;top:${l.y}%;" title="${_esc(l.name)}">
            <i class="fas fa-map-marker-alt"></i>
            <span class="dm-pin-label">${_esc(l.name)}</span>
            <button class="dm-pin-remove" data-action="dm-remove-location" data-id="${l.id}" type="button">×</button>
        </div>
    `).join('');

    const pinForm = _w.pendingPin ? `
        <div class="dm-pin-form">
            <strong>Ort bei (${_w.pendingPin.x}%, ${_w.pendingPin.y}%)</strong>
            <input id="wb-pin-name" class="dm-input" type="text" placeholder="Ortsname…">
            <select id="wb-pin-type" class="dm-select">
                <option>Stadt</option><option>Dungeon</option><option>Wildnis</option>
                <option>Burg</option><option>Dorf</option><option>Tempel</option><option>Ort</option>
            </select>
            <div class="dm-pin-form-btns">
                <button class="dm-btn-primary" data-action="dm-confirm-location" type="button"><i class="fas fa-check"></i> Hinzufügen</button>
                <button class="dm-btn-secondary" data-action="dm-cancel-pin" type="button">Abbrechen</button>
            </div>
        </div>
    ` : '';

    const locationList = _w.locations.length > 0 ? `
        <div class="dm-location-list">
            ${_w.locations.map(l => `
                <div class="dm-location-item">
                    <i class="fas fa-map-marker-alt text-amber-400"></i>
                    <span>${_esc(l.name)}</span>
                    <span class="dm-location-type">${_esc(l.type)}</span>
                    <button class="dm-pin-remove-btn" data-action="dm-remove-location" data-id="${l.id}" type="button"><i class="fas fa-times"></i></button>
                </div>
            `).join('')}
        </div>
    ` : '';

    return `
        <h3 class="dm-step-title"><i class="fas fa-map"></i> Schritt 5 – Weltkarte</h3>
        <label class="dm-label">Karten-Prompt</label>
        <input id="wb-map-prompt" class="dm-input" type="text"
            placeholder="z.B. Dark forest kingdom with mountains and ancient ruins…"
            value="${_esc(_w.mapPrompt)}">
        <button class="dm-btn-ai" data-action="dm-gen-map" type="button" ${_w.isGenerating ? 'disabled' : ''}>
            <i class="fas fa-image"></i> Karte generieren
        </button>
        ${_w.mapImageUrl ? `
            <div class="dm-map-wrap">
                <img id="wb-map-img" class="dm-map-img" src="${_esc(_w.mapImageUrl)}" alt="Weltkarte">
                <div id="wb-map-pins">${pins}</div>
            </div>
            <p class="dm-hint">Klicke auf die Karte, um Orte zu markieren.</p>
        ` : '<p class="dm-hint">Generiere zuerst eine Karte.</p>'}
        ${pinForm}
        ${locationList}
    `;
}

// ─── Map click ────────────────────────────────────────────────────────────────

function _attachMapClickListener() {
    const img = _overlay?.querySelector('#wb-map-img');
    if (!img) return;
    img.addEventListener('click', (e) => {
        if (_w.pendingPin) return; // wait for confirmation first
        WorldBuilder.handleMapClick(e);
    });

    // Range inputs live-update
    const hpRange = _overlay?.querySelector('#wb-hp-mult');
    const xpRange = _overlay?.querySelector('#wb-xp-mult');
    hpRange?.addEventListener('input', () => {
        _w.difficulty.hpMult = parseFloat(hpRange.value);
        const badge = _overlay?.querySelector('#hp-mult-val');
        if (badge) badge.textContent = `${_w.difficulty.hpMult.toFixed(1)}×`;
    });
    xpRange?.addEventListener('input', () => {
        _w.difficulty.xpMult = parseFloat(xpRange.value);
        const badge = _overlay?.querySelector('#xp-mult-val');
        if (badge) badge.textContent = `${_w.difficulty.xpMult.toFixed(1)}×`;
    });
}

// ─── Read inputs back into _w ─────────────────────────────────────────────────

function _readFromWizardInputs() {
    if (!_overlay) return;
    const g = (id) => _overlay.querySelector(`#${id}`);

    // Step 1
    const nameEl = g('wb-world-name');
    if (nameEl) _w.name = nameEl.value;
    const descEl = g('wb-world-desc');
    if (descEl) _w.description = descEl.value;

    // Step 2
    _overlay.querySelectorAll('.wb-hp-bonus').forEach(el => {
        const cls = el.dataset.class;
        if (cls && _w.classSpecs[cls]) _w.classSpecs[cls].hpBonus = parseInt(el.value, 10) || 0;
    });
    _overlay.querySelectorAll('.wb-stat-bonus').forEach(el => {
        const cls = el.dataset.class;
        if (cls && _w.classSpecs[cls]) _w.classSpecs[cls].statBonus = parseInt(el.value, 10) || 0;
    });

    // Step 3
    _overlay.querySelectorAll('.wb-enemy-name').forEach(el => {
        const id = el.dataset.id;
        const enemy = _w.enemies.find(e => e.id === id);
        if (enemy) enemy.name = el.value;
    });
    _overlay.querySelectorAll('.wb-enemy-hp-min').forEach(el => {
        const id = el.dataset.id;
        const enemy = _w.enemies.find(e => e.id === id);
        if (enemy) enemy.hpMin = parseInt(el.value, 10) || 1;
    });
    _overlay.querySelectorAll('.wb-enemy-hp-max').forEach(el => {
        const id = el.dataset.id;
        const enemy = _w.enemies.find(e => e.id === id);
        if (enemy) enemy.hpMax = parseInt(el.value, 10) || 10;
    });
    _overlay.querySelectorAll('.wb-enemy-desc').forEach(el => {
        const id = el.dataset.id;
        const enemy = _w.enemies.find(e => e.id === id);
        if (enemy) enemy.description = el.value;
    });

    // Step 4
    const hpMult = g('wb-hp-mult');
    if (hpMult) _w.difficulty.hpMult = parseFloat(hpMult.value) || 1.0;
    const xpMult = g('wb-xp-mult');
    if (xpMult) _w.difficulty.xpMult = parseFloat(xpMult.value) || 1.0;

    // Step 5
    const mapPrompt = g('wb-map-prompt');
    if (mapPrompt) _w.mapPrompt = mapPrompt.value;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _setGenerating(val) {
    _w.isGenerating = val;
    _renderStep();
}

function _showStepMsg(msg) {
    const msgEl = _overlay?.querySelector('.dm-step-msg');
    if (msgEl) { msgEl.textContent = msg; return; }
    const body = _overlay?.querySelector('.dm-wizard-body');
    if (body) {
        const div = document.createElement('div');
        div.className = 'dm-step-msg';
        div.textContent = msg;
        body.prepend(div);
    }
}

function _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _defaultClassSpecs() {
    return Object.fromEntries(CLASSES.map(c => [c, { hpBonus: 0, statBonus: 0 }]));
}

function _saveToStorage(config) {
    try { localStorage.setItem(WB_STORAGE_KEY, JSON.stringify(config)); } catch (e) { console.warn('WorldBuilder save failed:', e); }
}

function _loadFromStorage() {
    try {
        const raw = localStorage.getItem(WB_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { console.warn('WorldBuilder load failed:', e); return null; }
}

// Called from events.js for dm-set-dice action
WorldBuilder.setDice = function(size) {
    _w.difficulty.diceSize = parseInt(size, 10);
    _renderStep();
};
