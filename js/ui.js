import { State } from './state.js';
import { PRESETS, TALENT_TREES, EQUIPMENT_SETS } from './prompts.js';
import { PartyManager } from './party.js';
import { Sound } from './sound.js';
import { Utils } from './utils.js';
import { API } from './api.js';
import { sanitize, sanitizeStrict } from './sanitize.js';
import { DICE_ANIMATION_TICKS, DICE_ANIMATION_INTERVAL_MS, XP_BASE, XP_SCALING_EXPONENT } from './constants.js';

/* ==========================================
   TTS (Text-to-Speech / Vorlese-Feature)
   ========================================== */
export const TTS = {
    synth: window.speechSynthesis,
    activeBtn: null,
    cfg: JSON.parse(localStorage.getItem('tts_cfg') || '{"rate":0.92,"pitch":0.85,"vol":1,"voice":null}'),

    getVoice: function () {
        const voices = this.synth.getVoices();
        if (this.cfg.voice) {
            const saved = voices.find(v => v.name === this.cfg.voice);
            if (saved) return saved;
        }
        // Best German voice fallback priority: Katja > Stefan > any de-DE > any de
        return voices.find(v => v.name.includes('Katja'))
            || voices.find(v => v.name.includes('Stefan'))
            || voices.find(v => v.lang === 'de-DE')
            || voices.find(v => v.lang.startsWith('de'))
            || null;
    },

    speak: function (textEl, btn) {
        if (!this.synth) return;
        const wasSameBtn = this.activeBtn === btn;
        if (this.synth.speaking) {
            this.synth.cancel();
            if (this.activeBtn) { this.activeBtn.classList.remove('tts-active'); this.activeBtn = null; }
            if (wasSameBtn) return;
        }
        const clone = textEl.cloneNode(true);
        clone.querySelectorAll('.suggestion-option').forEach(el => el.remove());
        const clean = clone.textContent.replace(/\s+/g, ' ').trim();
        const u = new SpeechSynthesisUtterance(clean);
        u.lang = 'de-DE';
        u.rate = this.cfg.rate;
        u.pitch = this.cfg.pitch;
        u.volume = this.cfg.vol;
        const voice = this.getVoice();
        if (voice) u.voice = voice;
        this.activeBtn = btn;
        if (btn) btn.classList.add('tts-active');
        u.onend = u.onerror = () => { if (this.activeBtn) { this.activeBtn.classList.remove('tts-active'); this.activeBtn = null; } };
        this.synth.speak(u);
    },

    openPicker: function () {
        const modal = document.getElementById('tts-picker-modal');
        const sel = document.getElementById('tts-voice-select');
        const voices = this.synth.getVoices();
        sel.innerHTML = '';
        voices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.name;
            opt.textContent = `${v.name} (${v.lang})`;
            if (v.name === this.cfg.voice || (!this.cfg.voice && v === this.getVoice())) opt.selected = true;
            sel.appendChild(opt);
        });
        document.getElementById('tts-rate').value = this.cfg.rate;
        document.getElementById('tts-rate-val').textContent = this.cfg.rate;
        document.getElementById('tts-pitch').value = this.cfg.pitch;
        document.getElementById('tts-pitch-val').textContent = this.cfg.pitch;
        document.getElementById('tts-vol').value = this.cfg.vol;
        document.getElementById('tts-vol-val').textContent = this.cfg.vol;
        ['rate','pitch','vol'].forEach(k => {
            document.getElementById(`tts-${k}`).oninput = (e) => {
                document.getElementById(`tts-${k}-val`).textContent = parseFloat(e.target.value).toFixed(2);
            };
        });
        modal.classList.remove('hidden');
    },

    savePicker: function () {
        this.cfg.voice = document.getElementById('tts-voice-select').value;
        this.cfg.rate  = parseFloat(document.getElementById('tts-rate').value);
        this.cfg.pitch = parseFloat(document.getElementById('tts-pitch').value);
        this.cfg.vol   = parseFloat(document.getElementById('tts-vol').value);
        localStorage.setItem('tts_cfg', JSON.stringify(this.cfg));
        document.getElementById('tts-picker-modal').classList.add('hidden');
    },

    testVoice: function () {
        if (this.synth.speaking) this.synth.cancel();
        const u = new SpeechSynthesisUtterance('In den Tiefen des Dungeons hallt euer Atem wider. Die Fackeln flackern.');
        u.lang = 'de-DE';
        u.rate  = parseFloat(document.getElementById('tts-rate').value);
        u.pitch = parseFloat(document.getElementById('tts-pitch').value);
        u.volume = parseFloat(document.getElementById('tts-vol').value);
        const voices = this.synth.getVoices();
        const sel = document.getElementById('tts-voice-select').value;
        const v = voices.find(v => v.name === sel);
        if (v) u.voice = v;
        this.synth.speak(u);
    }
};

/* ==========================================
   3. DOM CACHING (Performance Setup)
   ========================================== */
export const DOM = {};
export const initDOM = () => {
    const ids = [
        'story-log', 'lobby-view', 'start-adventure-container', 'action-area',
        'action-box-container', 'acting-char', 'player-input', 'send-btn',
        'dynamic-roll-container', 'game-difficulty', 'enemy-rate', 'loading-spinner',
        'loading-text', 'party-list', 'char-details', 'export-hero-btn',
        'details-content', 'enemy-section', 'enemy-history-container',
        'current-enemy-container', 'loot-drop-section', 'loot-list', 'creator-modal',
        'new-name', 'new-class', 'new-appearance', 'start-item', 'portrait-preview',
        'generated-portrait', 'gen-img-btn', 'save-char-btn', 'dice-modal',
        'dice-container', 'dice-roller-portrait', 'dice-roller-name', 'dice-target-dc',
        'dice-result', 'dice-quality-label', 'dice-accept-btn', 'api-key-modal',
        'custom-key-input', 'oracle-modal', 'oracle-input', 'item-action-modal',
        'item-action-title', 'item-action-cid', 'item-action-name',
        'item-action-is-equipped', 'modal-inv-actions', 'item-action-target',
        'modal-eq-actions', 'load-input', 'merchant-section', 'merchant-name', 'merchant-items', 'btn-offer-item',
        'crafting-modal', 'craft-inv-list', 'craft-sel-list', 'craft-target-item',
        'journal-content', 'stats-content', 'quick-actions-container', 'sound-toggle',
        'tab-party', 'tab-journal', 'tab-stats',
        'tab-content-party', 'tab-content-journal', 'tab-content-stats'
    ];
    ids.forEach(id => {
        const camelCaseId = id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        DOM[camelCaseId] = document.getElementById(id);
    });

    // Event delegation for suggestion options (avoids inline onclick escaping issues)
    if (DOM.storyLog) {
        DOM.storyLog.addEventListener('click', (e) => {
            const suggestion = e.target.closest('.suggestion-option');
            if (suggestion) {
                const prompt = suggestion.getAttribute('data-prompt');
                if (prompt) {
                    UI.selectOption(prompt);
                }
            }
        });
    }
};

/* ==========================================
   8. UI RENDERING (Templates & DOM Updates)
   ========================================== */
export const UIBuilders = {
    buildHeroCard: function (c, isOwnHero = false) {
        const isDead = c.hp === 0;
        const ownHighlight = isOwnHero && !isDead ? 'border-cyan-400/70 shadow-[0_0_20px_rgba(34,211,238,0.35)] ring-1 ring-cyan-500/30' : '';
        const borderClass = ownHighlight || (isDead ? 'border-red-900 shadow-[0_0_15px_rgba(220,38,38,0.3)] grayscale opacity-80' :
            (c.isSummon ? 'border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]' :
                (c.isNPC ? 'border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-white/10 hover:border-amber-500/50 shadow-[0_4px_15px_rgba(0,0,0,0.5)] hover:shadow-[0_0_20px_rgba(245,158,11,0.2)]')));
        const nameColor = isDead ? 'text-red-500 line-through' :
            (c.isSummon ? 'text-purple-400 drop-shadow-[0_0_5px_rgba(168,85,247,0.5)]' :
                (c.isNPC ? 'text-blue-400 drop-shadow-[0_0_5px_rgba(96,165,250,0.5)]' : 'text-amber-400 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)]'));
        const badge = isDead ? '💀' : (c.isSummon ? '🌀' : '👤');
        const effMaxHp = PartyManager.getEffectiveMaxHp(c);
        if (c.hp > effMaxHp) c.hp = effMaxHp;
        const hpPercent = (c.hp / effMaxHp) * 100;
        const hpGlowClass = isDead ? 'hp-glow-dead' : (hpPercent > 75 ? 'hp-glow-high' : (hpPercent > 25 ? 'hp-glow-mid' : 'hp-glow-low'));

        const portraitHtml = c.portrait ? `<img src="${c.portrait}" class="w-10 h-10 rounded-lg object-cover bg-black/50 border ${hpGlowClass} shadow-sm">` : `<div class="w-10 h-10 rounded-lg bg-black/50 flex items-center justify-center border border-white/10 text-[10px] shadow-sm">${badge}</div>`;

        return `<div class="bg-black/30 backdrop-blur-md p-2 rounded-xl border ${borderClass} flex gap-2.5 items-center cursor-pointer group transition-all" data-action="entity-click" data-name="${c.name.replace(/"/g, '&quot;')}" data-entity-type="hero" data-entity-id="${c.id}">
            ${portraitHtml}
            <div class="flex-1">
                <div class="flex justify-between text-[11px] font-bold tracking-wide"><span class="${nameColor}">${c.name} <span class="text-slate-500 text-[9px] font-normal ml-0.5">Lvl ${c.level}</span></span><span class="${isDead ? 'text-red-500' : 'text-slate-300 font-mono'}">${c.hp}/${effMaxHp}</span></div>
                <div class="w-full bg-black/60 h-1.5 rounded-full mt-1.5 border border-white/5 overflow-hidden"><div class="${c.isNPC ? (c.isSummon ? 'bg-gradient-to-r from-purple-700 to-purple-400' : 'bg-gradient-to-r from-blue-700 to-blue-400') : 'bg-gradient-to-r from-red-700 to-red-400'} h-full rounded-full transition-all duration-500" style="width: ${(c.hp / effMaxHp) * 100}%"></div></div>
            </div>
            <button data-action="remove-char" data-char-id="${c.id}" class="opacity-0 group-hover:opacity-100 p-1.5 text-red-500/70 hover:text-red-400 transition-colors bg-white/5 rounded-lg hover:bg-white/10"><i class="fas fa-trash text-[10px]"></i></button>
        </div>`;
    },
    buildEnemyCard: function (e, isDeadFlag) {
        const isDead = isDeadFlag || e.hp <= 0;
        const hpDisplay = isDead ? 0 : e.hp;
        const hpBarWidth = isDead ? 0 : (e.hp / e.maxHp) * 100;
        const hoverClass = isDead ? '' : 'cursor-pointer hover:border-red-400/80 transition-all hover:shadow-[0_0_15px_rgba(248,113,113,0.3)] hover:bg-red-950/20';
        return `<div class="bg-black/30 backdrop-blur-sm p-2 rounded-xl border ${isDead ? 'border-slate-800' : 'border-red-900/50 shadow-[0_4px_10px_rgba(0,0,0,0.5)]'} flex gap-2.5 items-center fade-in ${isDead ? 'defeated-enemy' : ''} ${hoverClass}" ${!isDead ? `data-action="entity-click" data-name="${e.name.replace(/"/g, '&quot;')}" data-entity-type="enemy" data-entity-id="${e.id}"` : ''}>
            ${e.portrait ? `<img src="${e.portrait}" class="w-10 h-10 rounded-lg object-cover ${isDead ? '' : 'border border-red-900/50 shadow-[0_0_10px_rgba(127,29,29,0.5)]'}">` : `<div class="w-10 h-10 rounded-lg bg-black/60 ${isDead ? '' : 'border border-red-900/50 shadow-[0_0_10px_rgba(127,29,29,0.5)]'} flex items-center justify-center text-red-500/50"><i class="fas fa-skull"></i></div>`}
            <div class="flex-1 min-w-0">
                <div class="flex justify-between text-[10px] truncate tracking-wide"><span class="${isDead ? 'line-through text-slate-600' : 'text-slate-200'}">${e.name}</span><span class="${isDead ? 'text-slate-600' : 'text-red-400 font-mono font-bold drop-shadow-[0_0_2px_rgba(248,113,113,0.8)]'}">${hpDisplay}/${e.maxHp}</span></div>
                <div class="w-full bg-black/60 h-1.5 rounded-full mt-1.5 overflow-hidden border border-white/5"><div class="${isDead ? 'bg-slate-700' : 'bg-gradient-to-r from-red-800 to-red-500'} h-full transition-all duration-500" style="width: ${hpBarWidth}%"></div></div>
            </div>
        </div>`;
    }
};

export const UI = {
    formatItemDisplay: function (fullItemString) {
        let effects = [];
        let cleanName = fullItemString.replace(/\s*\((.*?)\)/g, (match, p1) => {
            effects.push(p1);
            return '';
        }).trim();
        if (!cleanName) cleanName = fullItemString;

        let visibleStats = [];
        let hiddenEffects = [];
        effects.forEach(e => {
            if (e.match(/^[+-]\d+\s*(STR|DEX|INT|CON)|(STR|DEX|INT|CON)\s*[+-]\d+$/i)) {
                visibleStats.push(e);
            } else {
                hiddenEffects.push(e);
            }
        });

        let displayName = cleanName;
        if (visibleStats.length > 0) displayName += ` (${visibleStats.join(', ')})`;
        return {
            displayName: displayName,
            tooltip: hiddenEffects.join(' | '),
            hasEffects: hiddenEffects.length > 0
        };
    },
    toggleViews: function (s) { DOM.lobbyView.classList.toggle('hidden', s); DOM.actionArea.classList.toggle('hidden', !s); },
    showLoader: function (s, t = "Lädt...") { DOM.loadingSpinner.classList.toggle('hidden', !s); DOM.loadingText.innerText = t; },
    selectOption: function (t) { DOM.playerInput.value = t; DOM.playerInput.focus(); },

    showApiSettings: function () {
        document.getElementById('api-provider-select').value = API.getProvider();
        document.getElementById('api-key-gemini').value = API.getKey('gemini');
        document.getElementById('api-key-chatgpt').value = API.getKey('chatgpt');
        document.getElementById('api-key-openrouter').value = API.getKey('openrouter');
        document.getElementById('api-key-claude').value = API.getKey('claude');
        document.getElementById('api-model-claude').value = localStorage.getItem('api_model_claude') || 'claude-sonnet-4-6';
        document.getElementById('api-model-or-text').value = API.getOrModelText();
        document.getElementById('api-model-or-image').value = API.getOrModelImage();
        this.updateApiSettingsView();
        document.getElementById('api-settings-modal').classList.remove('hidden');
    },
    updateApiSettingsView: function () {
        const provider = document.getElementById('api-provider-select').value;
        document.getElementById('api-settings-gemini').classList.toggle('hidden', provider !== 'gemini');
        document.getElementById('api-settings-chatgpt').classList.toggle('hidden', provider !== 'chatgpt');
        document.getElementById('api-settings-openrouter').classList.toggle('hidden', provider !== 'openrouter');
        document.getElementById('api-settings-claude').classList.toggle('hidden', provider !== 'claude');
    },

    showPromptManager: function () {
        const piValue = document.getElementById('player-input').value.trim();
        if (piValue) document.getElementById('new-prompt-input').value = piValue;
        this.renderPromptManager();
        document.getElementById('prompt-manager-modal').classList.remove('hidden');
    },
    renderPromptManager: function () {
        const listHtml = (State.savedPrompts || []).map((promptText, idx) => {
            return `<div class="bg-slate-900/60 p-2.5 rounded-lg border border-slate-700/50 flex gap-2 items-center group shadow-sm">
                <span class="text-xs text-slate-300 flex-1 truncate font-medium" title="${promptText.replace(/"/g, '&quot;')}">${promptText}</span>
                <button title="Einfügen" data-action="insert-prompt" data-idx="${idx}" class="text-blue-400 hover:text-blue-300 p-1.5 transition-colors"><i class="fas fa-paste"></i></button>
                <button title="Spielen" data-action="play-prompt" data-idx="${idx}" class="text-emerald-400 hover:text-emerald-300 p-1.5 transition-colors"><i class="fas fa-play"></i></button>
                <button title="Löschen" data-action="delete-prompt" data-idx="${idx}" class="text-opacity-50 text-red-500 hover:text-opacity-100 p-1.5 transition-opacity"><i class="fas fa-trash"></i></button>
            </div>`;
        }).join('');
        document.getElementById('prompt-list').innerHTML = sanitize(listHtml || '<p class="text-slate-500 text-xs text-center italic mt-2">Noch keine Prompts gespeichert.</p>');
    },

    switchTab: function (tab) {
        ['party', 'journal', 'stats'].forEach(t => {
            const btn = DOM[`tab${t.charAt(0).toUpperCase() + t.slice(1)}`];
            const content = DOM[`tabContent${t.charAt(0).toUpperCase() + t.slice(1)}`];
            if (!btn || !content) return;
            const active = t === tab;
            btn.classList.toggle('active', active);
            content.classList.toggle('hidden', !active);
            content.classList.toggle('flex', active);
        });
        if (tab === 'journal') this.renderJournal();
        if (tab === 'stats') this.renderStats();
    },

    renderJournal: function () {
        if (!DOM.journalContent) return;
        if (State.journal.length === 0) {
            DOM.journalContent.innerHTML = '<p class="text-slate-500 italic">Noch keine Einträge. Starte ein Abenteuer und klicke ✨ Update!</p>';
            return;
        }
        DOM.journalContent.innerHTML = sanitize(State.journal.map((e, i) => `
            <div class="journal-entry fade-in">
                <div class="flex justify-between text-[9px] text-slate-500 mb-1">
                    <span>Eintrag #${State.journal.length - i}</span>
                    <span>${e.timestamp}</span>
                </div>
                <p class="text-slate-300 leading-relaxed">${e.text}</p>
            </div>
        `).join(''));
    },

    renderStats: function () {
        if (!DOM.statsContent) return;
        const s = State.sessionStats;
        if (s.turnsPlayed === 0) {
            DOM.statsContent.innerHTML = '<p class="text-slate-500 italic">Noch keine Session-Daten.</p>';
            return;
        }
        const avgRoll = s.diceRolls.length > 0 ? (s.diceRolls.reduce((a, b) => a + b, 0) / s.diceRolls.length).toFixed(1) : '-';
        const luckyColor = parseFloat(avgRoll) >= 12 ? 'text-green-400' : parseFloat(avgRoll) >= 8 ? 'text-amber-400' : 'text-red-400';

        // Per-character damage breakdown
        const charStats = State.party.filter(p => !p.isSummon).map(p => {
            const hpPercent = (p.hp / PartyManager.getEffectiveMaxHp(p)) * 100;
            const barColor = hpPercent > 60 ? 'bg-green-500' : hpPercent > 30 ? 'bg-amber-500' : 'bg-red-500';
            return `<div class="mb-2">
                <div class="flex justify-between text-[10px] mb-0.5">
                    <span class="text-amber-300">${p.name}</span>
                    <span class="text-slate-400">Lvl ${p.level} | ${p.hp}/${PartyManager.getEffectiveMaxHp(p)} HP</span>
                </div>
                <div class="stat-bar"><div class="stat-bar-fill ${barColor}" style="width:${hpPercent}%"></div></div>
            </div>`;
        }).join('');

        DOM.statsContent.innerHTML = `
            <div class="space-y-3">
                <div>
                    <div class="text-[9px] uppercase text-slate-500 font-bold mb-2 tracking-wider">⚔️ Kampf</div>
                    <div class="grid grid-cols-2 gap-1.5 text-[10px]">
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50"><div class="text-slate-400">Schaden ausgeteilt</div><div class="text-red-400 font-bold text-sm">${s.totalDamageDealt}</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50"><div class="text-slate-400">Schaden erhalten</div><div class="text-orange-400 font-bold text-sm">${s.totalDamageTaken}</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50"><div class="text-slate-400">Geheilt</div><div class="text-green-400 font-bold text-sm">${s.totalHealed}</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50"><div class="text-slate-400">Kämpfe gewonnen</div><div class="text-purple-400 font-bold text-sm">${s.combatsWon}</div></div>
                    </div>
                </div>
                <div>
                    <div class="text-[9px] uppercase text-slate-500 font-bold mb-2 tracking-wider">🎲 Würfelglück</div>
                    <div class="grid grid-cols-3 gap-1.5 text-[10px]">
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50 text-center"><div class="text-slate-400">Ø Wurf</div><div class="${luckyColor} font-bold text-sm">${avgRoll}</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50 text-center"><div class="text-slate-400">Höchster</div><div class="text-green-400 font-bold text-sm">${s.diceRolls.length ? s.highestRoll : '-'}</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50 text-center"><div class="text-slate-400">Niedrigster</div><div class="text-red-400 font-bold text-sm">${s.diceRolls.length ? s.lowestRoll : '-'}</div></div>
                    </div>
                    <div class="text-center text-[10px] text-slate-500 mt-1">${s.diceRolls.length} Würfe gesamt | ${s.turnsPlayed} Runden</div>
                </div>
                <div>
                    <div class="text-[9px] uppercase text-slate-500 font-bold mb-2 tracking-wider">🧙 Gruppe</div>
                    ${charStats || '<p class="text-slate-500 italic text-[10px]">Keine Helden</p>'}
                    <div class="text-[10px] text-slate-400 mt-1">Gesamt XP dieser Session: <span class="text-yellow-400 font-bold">${s.totalXPEarned}</span></div>
                </div>
                <div>
                    <div class="text-[9px] uppercase text-slate-500 font-bold mb-2 tracking-wider">💰 Wirtschaft</div>
                    <div class="grid grid-cols-2 gap-1.5 text-[10px]">
                        <div class="bg-slate-800/60 p-1.5 rounded border border-amber-800/40"><div class="text-slate-400">Goldmünzen</div><div class="text-amber-400 font-bold text-sm">${State.gold || 0} 🪙</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50"><div class="text-slate-400">Momentum</div><div class="${(State.momentum||0) >= 3 ? 'text-yellow-300 animate-pulse' : 'text-slate-300'} font-bold text-sm">${State.momentum || 0}x ⚡</div></div>
                    </div>
                </div>
            </div>
        `;
    },

    toggleTargetMode: function () {
        State.targetMapMode = !State.targetMapMode;
        this.updateTargetModeButton();
    },
    updateTargetModeButton: function () {
        const btn = document.getElementById('target-mode-btn');
        if (!btn) return;
        if (State.targetMapMode) {
            btn.className = "group bg-amber-900/40 hover:bg-amber-800/60 border border-amber-500/80 text-amber-100 px-3.5 py-2 rounded-lg transition-all duration-300 flex items-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.5)] backdrop-blur-md tracking-wide animate-pulse";
            btn.innerHTML = `<i class="fas fa-crosshairs text-amber-400"></i> Zielmodus Aktiv`;
        } else {
            btn.className = "group bg-white/5 hover:bg-black/40 border border-white/10 hover:border-amber-500/50 text-slate-300 hover:text-white px-3.5 py-2 rounded-lg transition-all duration-300 flex items-center gap-1.5 shadow-[0_0_10px_rgba(0,0,0,0.3)] hover:shadow-[0_0_15px_rgba(245,158,11,0.3)] backdrop-blur-md tracking-wide";
            btn.innerHTML = `<i class="fas fa-crosshairs text-slate-500 group-hover:text-amber-400 transition-colors"></i> Schnellauswahl`;
        }
    },
    handleEntityClick: function (name, type, id) {
        if (State.targetMapMode) {
            const val = DOM.playerInput.value;
            DOM.playerInput.value = val + (val && !val.endsWith(' ') ? " " : "") + name + " ";
            DOM.playerInput.focus();
        } else {
            if (type === 'hero') this.showDetails(id);
        }
    },

    updateAll: function () {
        const myCharId = State._mpMyCharId || null;
        const sorted = [...State.party].sort((a, b) => {
            if (a.id === myCharId) return -1;
            if (b.id === myCharId) return 1;
            return 0;
        });
        DOM.partyList.innerHTML = sanitize(sorted.map(c => UIBuilders.buildHeroCard(c, c.id === myCharId)).join(''));
        const isMp = State._mpRole && myCharId;
        if (isMp) {
            const myChar = State.party.find(p => p.id === myCharId);
            if (myChar && myChar.hp > 0) {
                DOM.actingChar.innerHTML = `<option value="${myChar.name}">${myChar.name}</option>`;
                DOM.actingChar.value = myChar.name;
            } else {
                DOM.actingChar.innerHTML = '<option value="party">Gruppe</option>';
            }
        } else {
            const prevActing = DOM.actingChar.value;
            DOM.actingChar.innerHTML = '<option value="party">Gruppe</option>' + State.party.filter(p => !p.isSummon && p.hp > 0).map(c => `<option value="${c.name}">${c.name}</option>`).join('');
            if (DOM.actingChar.querySelector(`option[value="${CSS.escape(prevActing)}"]`)) {
                DOM.actingChar.value = prevActing;
            }
        }
        DOM.enemySection.classList.toggle('hidden', !State.activeEnemies.length && !State.defeatedEnemies.length);
        DOM.enemyHistoryContainer.innerHTML = sanitize(State.defeatedEnemies.map(e => UIBuilders.buildEnemyCard(e, true)).join(''));
        DOM.currentEnemyContainer.innerHTML = sanitize(State.activeEnemies.map(e => UIBuilders.buildEnemyCard(e, false)).join(''));

        // Loot section with null checks
        if (DOM.lootDropSection && DOM.lootList) {
            const hadLoot = !DOM.lootDropSection.classList.contains('hidden');
            DOM.lootDropSection.classList.toggle('hidden', !State.lootDrops.length);
            DOM.lootList.innerHTML = sanitize(State.lootDrops.map((it, idx) => {
            const formatted = UI.formatItemDisplay(it);
            const titleAttr = formatted.hasEffects ? `title="${formatted.tooltip.replace(/"/g, '&quot;')}"` : '';
            const effectIcon = formatted.hasEffects ? `<i class="fas fa-info-circle text-amber-500/70 ml-1 text-[8px]" ${titleAttr}></i>` : '';
            return `<div class="text-[10px] bg-amber-950/60 p-1.5 rounded border border-amber-800/50 flex justify-between items-center mt-1.5 shadow-sm loot-item-entrance" ${titleAttr}><span class="text-amber-300 font-mono truncate mr-2 flex-1">+ ${formatted.displayName} ${effectIcon}</span><select data-action="assign-loot" data-idx="${idx}" class="bg-slate-800 text-slate-300 border border-slate-600 rounded outline-none p-1 max-w-[85px] cursor-pointer"><option value="">Geben...</option>${State.party.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>`;
        }).join(''));

        // If loot just appeared, trigger animations
        if (!hadLoot && State.lootDrops.length > 0) {
            UI.showLootAnimation();
        } else if (State.lootDrops.length > 0) {
            // Animate new items with staggered delays
            const items = DOM.lootList.querySelectorAll('.loot-item-entrance');
            items.forEach((item, idx) => {
                item.style.animationDelay = `${idx * 0.15}s`;
            });
        }
        }

        const collectAllSelect = document.getElementById('collect-all-select');
        if (collectAllSelect) {
            collectAllSelect.innerHTML = '<option value="">Alle nehmen...</option>' + State.party.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }

        if (State.activeMerchant) {
            DOM.merchantSection.classList.remove('hidden');
            DOM.merchantName.innerText = State.activeMerchant.name;
            DOM.merchantItems.innerHTML = sanitize(State.activeMerchant.items.map(it => `<div class="bg-blue-950/60 p-1.5 rounded border border-blue-800/50 flex justify-between items-center mt-1.5 shadow-sm"><span class="text-blue-200">${it}</span></div>`).join(''));
        } else {
            DOM.merchantSection.classList.add('hidden');
        }

        DOM.startAdventureContainer.classList.toggle('hidden', !State.party.length);

        if (State.gameStarted) {
            const hud = document.getElementById('dungeon-hud');
            if (hud) {
                hud.classList.remove('hidden');
                const fateEl = document.getElementById('hud-fate');
                if (fateEl) {
                    const f = State.fate || 0;
                    fateEl.innerText = `${f}/100`;
                    fateEl.className = 'text-xs font-bold ' +
                        (f <= 25 ? 'text-green-400' : f <= 50 ? 'text-blue-400' : f <= 75 ? 'text-yellow-400' : 'text-red-500 animate-pulse');
                }

                const fatigueEl = document.getElementById('hud-fatigue');
                fatigueEl.innerText = State.fatigue;
                if (State.fatigue >= 15) {
                    fatigueEl.classList.add('text-red-500', 'animate-pulse');
                    fatigueEl.classList.remove('text-amber-500', 'text-white');
                } else if (State.fatigue >= 8) {
                    fatigueEl.classList.add('text-amber-500');
                    fatigueEl.classList.remove('text-red-500', 'animate-pulse', 'text-white');
                } else {
                    fatigueEl.classList.add('text-white');
                    fatigueEl.classList.remove('text-red-500', 'text-amber-500', 'animate-pulse');
                }

                const goldHudEl = document.getElementById('hud-gold');
                if (goldHudEl) goldHudEl.innerText = `${State.gold || 0} 🪙`;
            }
        }

        this.updateTargetModeButton();
        this.updateActionBox();

    },

    updateActionBox: function () {
        if (State.pendingRolls.length > 0) {
            DOM.actionBoxContainer.classList.remove('hidden');
            DOM.playerInput.disabled = true; DOM.sendBtn.disabled = true;
            DOM.playerInput.placeholder = "Würfle zuerst die anstehenden Proben aus...";

            const isClient = State._mpRole === 'client';
            const myChar = State._mpMyCharId ? State.party.find(p => p.id === State._mpMyCharId) : null;

            let html = '<h3 class="text-indigo-400 text-[10px] font-bold uppercase mb-2 tracking-widest flex items-center gap-2"><i class="fas fa-dice-d20"></i> Erforderliche Proben</h3><div class="space-y-1.5">';
            State.pendingRolls.forEach(r => {
                let dt = r.diceType || 'W20';
                let btnClass = dt === 'W6' ? 'bg-blue-600 hover:bg-blue-500' : (dt === 'W100' ? 'bg-purple-700 hover:bg-purple-600 shadow-[0_0_15px_rgba(147,51,234,0.5)]' : 'bg-indigo-600 hover:bg-indigo-500');
                let textClass = dt === 'W6' ? 'text-blue-400' : (dt === 'W100' ? 'text-purple-300 font-bold' : 'text-indigo-400');

                const canRoll = !isClient || (myChar && r.name === myChar.name);
                let status;
                if (r.rolled) {
                    status = r.result >= r.dc
                        ? `<span class="text-green-400 text-xs font-bold flex items-center gap-1 bg-green-900/20 px-2 py-1 rounded border border-green-700/50"><i class="fas fa-check"></i> Erfolg (${r.result})</span>`
                        : `<span class="text-red-400 text-xs font-bold flex items-center gap-1 bg-red-900/20 px-2 py-1 rounded border border-red-700/50"><i class="fas fa-times"></i> Fehl (${r.result})</span>`;
                } else if (canRoll) {
                    status = `<div id="roll-status-${r.id}"><button data-action="roll-specific" data-roll-id="${r.id}" class="${btnClass} px-3 py-1 rounded text-white text-[10px] font-bold shadow-md transition-all">${dt} Werfen</button></div>`;
                } else {
                    status = `<span class="text-[9px] text-slate-500 italic animate-pulse"><i class="fas fa-hourglass-half mr-1"></i>Warte...</span>`;
                }
                let modHtml = r.stat ? `<span class="bg-slate-800 text-slate-300 px-1 py-0.5 rounded text-[9px] ml-1 font-mono align-middle border border-slate-600/50">${r.stat} ${r.mod >= 0 ? '+' + r.mod : r.mod}</span>` : '';
                const ownHighlight = isClient && myChar && r.name === myChar.name ? 'border-cyan-700/50' : 'border-slate-700';

                html += `<div class="flex justify-between items-center bg-slate-900/80 border ${ownHighlight} p-2.5 rounded-lg shadow-sm">
                    <div class="text-[11px] leading-tight"><span class="text-amber-400 font-bold text-xs">${r.name}</span> <span class="text-[10px] ${textClass} font-mono font-bold">[${dt}]</span>${modHtml}<br><span class="text-slate-300 block mt-1">${r.desc} <span class="text-slate-500 ml-1 font-mono">(DC ${r.dc})</span></span></div>
                    <div>${status}</div>
                </div>`;
            });
            html += '</div>';

            if (State.pendingRolls.some(r => !r.rolled)) {
                if (!isClient) {
                    html += `<button id="btn-roll-all" data-action="roll-all" class="mt-3 w-full bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 py-2 rounded text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm"><i class="fas fa-dice mr-1"></i> Alle automatisch auswürfeln</button>`;
                }
            } else {
                if (!isClient) {
                    html += `<button data-action="submit-rolls" class="mt-3 w-full bg-green-600 hover:bg-green-500 text-white py-2 rounded text-xs font-bold animate-pulse shadow-[0_0_15px_rgba(34,197,94,0.4)]">Ergebnisse bestätigen & fortfahren</button>`;
                } else {
                    html += `<p class="mt-3 text-center text-[10px] text-amber-400 animate-pulse"><i class="fas fa-hourglass-half mr-1"></i> Warte auf den Host...</p>`;
                }
            }
            DOM.actionBoxContainer.innerHTML = sanitize(html);
        } else {
            DOM.actionBoxContainer.classList.add('hidden');
            DOM.playerInput.disabled = false; DOM.sendBtn.disabled = !!State.isProcessing;
            DOM.playerInput.placeholder = "Was tut ihr?";
        }
    },

    addChatLog: function (s, t) {
        const isAI = s === 'DM' || s.includes('Orakel') || s.includes('Schicksal');
        const isDice = s.includes('🎲');
        const isWeather = s.includes('🌦');
        const isSys = !isAI && !isDice && !isWeather && s.includes('System');

        let formattedText = t;
        formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-amber-300">$1</strong>');
        formattedText = formattedText.replace(/\*(.*?)\*/g, '<em class="text-slate-300">$1</em>');
        if (isAI) {
            formattedText = formattedText.replace(/\n\n+/g, '</p><p class="mt-2 leading-relaxed">');
            formattedText = formattedText.replace(/\n/g, '<br>');
            formattedText = `<p class="leading-relaxed">${formattedText}</p>`;
        } else {
            formattedText = formattedText.replace(/\n/g, '<br>');
        }

        if (isSys) {
            const lastMsg = DOM.storyLog.lastElementChild;
            if (lastMsg && lastMsg.classList.contains('chat-sys-group')) {
                const content = lastMsg.querySelector('.sys-lines');
                if (content) {
                    const line = document.createElement('div');
                    line.className = 'text-[10px] text-slate-500 leading-snug';
                    line.innerHTML = sanitize(formattedText);
                    content.appendChild(line);
                    DOM.storyLog.scrollTop = DOM.storyLog.scrollHeight;
                    return;
                }
            }
        }

        const d = document.createElement('div');

        if (isAI) {
            d.className = 'p-4 rounded-xl relative fade-in mb-3 bg-black/40 backdrop-blur-md border border-white/10 border-l-4 border-l-purple-500 shadow-[0_4px_20px_rgba(0,0,0,0.5)]';
            const ttsBtn = `<button class="tts-btn" title="Vorlesen" data-action="tts-speak"><i class="fas fa-volume-up"></i></button>`;
            const safeText = sanitizeStrict(formattedText);
            d.innerHTML = sanitize(`<div class="text-[10px] font-bold uppercase mb-2 tracking-[0.2em] text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.6)]">${s}${ttsBtn}</div><div class="tts-text text-sm md:text-base leading-relaxed text-slate-200">${safeText}</div>`);
        } else if (isDice) {
            d.className = 'px-3 py-1.5 rounded-lg fade-in mb-1.5 bg-indigo-950/30 border border-indigo-500/20 backdrop-blur-sm';
            d.innerHTML = sanitize(`<div class="flex items-baseline gap-2"><span class="text-[9px] font-bold uppercase text-indigo-400 shrink-0">${s}</span><span class="tts-text text-[11px] leading-snug text-slate-300 font-mono">${formattedText}</span></div>`);
        } else if (isWeather) {
            d.className = 'px-3 py-2 rounded-lg fade-in mb-2 bg-sky-950/25 border border-sky-500/15 backdrop-blur-sm';
            d.innerHTML = sanitize(`<div class="text-[9px] font-bold uppercase text-sky-400 mb-1">${s}</div><div class="tts-text text-[11px] leading-relaxed text-slate-300">${formattedText}</div>`);
        } else if (isSys) {
            d.className = 'chat-sys-group px-3 py-1.5 rounded-md fade-in mb-1 border-l-2 border-l-slate-600/40 bg-black/15';
            d.innerHTML = sanitize(`<div class="sys-lines"><div class="text-[10px] text-slate-500 leading-snug">${formattedText}</div></div>`);
        } else {
            d.className = 'px-3 py-2 rounded-lg fade-in mb-2 bg-slate-800/30 backdrop-blur-sm border border-amber-500/10 border-l-2 border-l-amber-500/60';
            d.innerHTML = sanitize(`<div class="text-[9px] font-bold uppercase mb-0.5 tracking-wider text-amber-400">${s}</div><div class="tts-text text-sm leading-relaxed text-slate-300">${formattedText}</div>`);
        }

        d.classList.add('tts-msg');
        DOM.storyLog.appendChild(d);
        DOM.storyLog.scrollTop = DOM.storyLog.scrollHeight;
    },

    showCreator: function () { DOM.creatorModal.classList.remove('hidden'); },
    showAbilityReplaceModal: function (charId, newAbility) {
        const c = State.party.find(p => p.id === charId);
        if (!c) return;
        document.getElementById('ar-char-name').innerText = c.name;
        document.getElementById('ar-new-ability').innerText = newAbility;

        const listHtml = c.abilities.map((ab, idx) => `
            <button data-action="replace-ability" data-idx="${idx}" class="w-full text-left bg-red-900/40 hover:bg-red-800/60 border border-red-700/50 p-2.5 rounded-lg transition-colors flex justify-between items-center group shadow-sm mb-1.5">
                <span class="text-[11px] text-red-200 font-bold"><i class="fas fa-trash-alt mr-2 opacity-50 group-hover:opacity-100 group-hover:text-red-400"></i> ${ab} verlernen</span>
            </button>
        `).join('');
        document.getElementById('ar-ability-list').innerHTML = sanitize(listHtml);
        document.getElementById('ability-replace-modal').classList.remove('hidden');
    },
    closeCreator: function () { DOM.creatorModal.classList.add('hidden'); },
    applyPreset: function (k) { DOM.newName.value = k; DOM.newClass.value = PRESETS[k].class; DOM.newAppearance.value = PRESETS[k].appearance; },

    closeCrafting: function () { DOM.craftingModal.classList.add('hidden'); },
    renderCraftingModal: function () {
        let invHtml = '';
        const party = State.party.filter(p => !p.isSummon);
        party.forEach(c => {
            if (c.inventory.length > 0) {
                let charInvHtml = '';
                const selectedCounts = {};
                State.craftingIngredients.filter(ing => ing.charId === c.id).forEach(ing => {
                    selectedCounts[ing.itemName] = (selectedCounts[ing.itemName] || 0) + 1;
                });

                const invCounts = {};
                c.inventory.forEach(it => { invCounts[it] = (invCounts[it] || 0) + 1; });

                Object.entries(invCounts).forEach(([it, count]) => {
                    const avail = count - (selectedCounts[it] || 0);
                    if (avail > 0) {
                        const formatted = UI.formatItemDisplay(it);
                        const titleAttr = formatted.hasEffects ? `title="${formatted.tooltip.replace(/"/g, '&quot;')}"` : '';
                        const effectIcon = formatted.hasEffects ? `<i class="fas fa-info-circle text-slate-500 ml-1 text-[8px]" ${titleAttr}></i>` : '';
                        charInvHtml += `<div class="flex justify-between items-center bg-slate-900 hover:bg-slate-800 p-1.5 rounded border border-slate-700/50 cursor-pointer mb-1 transition-colors group" data-action="add-craft-ingredient" data-char-id="${c.id}" data-item="${it.replace(/"/g, '&quot;')}" ${titleAttr}>
                            <span class="text-[10px] text-slate-300 truncate mr-1">${formatted.displayName} ${effectIcon} ${avail > 1 ? '<span class="text-amber-500 font-bold">(x' + avail + ')</span>' : ''}</span>
                            <i class="fas fa-plus text-green-500 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"></i>
                        </div>`;
                    }
                });

                if (charInvHtml) {
                    invHtml += `<div class="text-[9px] text-amber-500 font-bold mt-2 mb-1 border-b border-slate-700 pb-0.5">${c.name}'s Taschen</div>` + charInvHtml;
                }
            }
        });
        if (!invHtml) invHtml = `<div class="text-[10px] text-slate-500 italic p-2 text-center mt-4">Niemand hat verwertbare Materialien.</div>`;
        DOM.craftInvList.innerHTML = invHtml;

        if (State.craftingIngredients.length === 0) {
            DOM.craftSelList.innerHTML = `<div class="text-[10px] text-indigo-400/50 italic p-2 text-center mt-8"><i class="fas fa-arrow-left block text-2xl mb-2"></i>Klicke auf Items links, um sie in die Schmiede zu legen.</div>`;
        } else {
            DOM.craftSelList.innerHTML = State.craftingIngredients.map((ing, idx) => {
                const cName = State.party.find(p => p.id === ing.charId)?.name || 'Unbekannt';
                const formatted = UI.formatItemDisplay(ing.itemName);
                const titleAttr = formatted.hasEffects ? `title="${formatted.tooltip.replace(/"/g, '&quot;')}"` : '';
                const effectIcon = formatted.hasEffects ? `<i class="fas fa-info-circle text-indigo-400/50 ml-1 text-[8px]" ${titleAttr}></i>` : '';
                return `<div class="flex justify-between items-center bg-indigo-900/40 hover:bg-indigo-900/80 p-1.5 rounded border border-indigo-700/50 cursor-pointer mb-1 shadow-sm transition-colors group" data-action="remove-craft-ingredient" data-idx="${idx}" ${titleAttr}>
                    <span class="text-[10px] text-indigo-100 truncate flex-1"><span class="text-indigo-400 font-bold mr-1">[${cName}]</span>${formatted.displayName} ${effectIcon}</span>
                    <i class="fas fa-times text-red-500 text-[10px] ml-2 opacity-50 group-hover:opacity-100 transition-opacity"></i>
                </div>`;
            }).join('');
        }
    },

    showDetails: function (id) {
        const c = State.party.find(p => p.id === id); if (!c) return;
        DOM.partyList.classList.add('hidden'); DOM.charDetails.classList.remove('hidden');

        const effAttrs = PartyManager.getEffectiveAttributes(c);
        const effMaxHp = PartyManager.getEffectiveMaxHp(c);
        const sBadge = c.statPoints > 0 ? `<span class="bg-green-600 px-1.5 py-0.5 rounded text-[8px] animate-pulse ml-2">${c.statPoints} Punkte!</span>` : '';
        const isPrivateInventory = State._mpRole === 'client' && State._mpMyCharId && c.id !== State._mpMyCharId;

        const aHtml = Object.entries(c.attributes).map(([k, v]) => {
            const bonus = effAttrs[k] - v;
            const bonusHtml = bonus !== 0 ? `<span class="${bonus > 0 ? 'text-green-400' : 'text-red-400'} font-bold ml-1">${bonus > 0 ? '+' : ''}${bonus}</span>` : '';
            return `<div class="flex justify-between items-center bg-slate-800/50 p-1.5 rounded mb-1 border border-slate-700/50"><span class="text-slate-400 font-bold text-[9px] w-8">${k}</span><span class="text-amber-400 font-mono flex-1 text-center text-[11px]">${v}${bonusHtml}</span>${c.statPoints > 0 ? `<button data-action="upgrade-stat" data-char-id="${c.id}" data-stat="${k}" class="bg-green-700 text-white w-5 h-5 rounded">+</button>` : '<div class="w-5"></div>'}</div>`;
        }).join('');

        const sumBadge = c.isSummon ? `<span class="text-purple-400 text-[8px] border border-purple-500 px-1 rounded ml-1">Kreatur</span>` : '';
        const portraitSrc = c.portrait || '';
        const portraitFallback = c.isSummon ? '🌀' : '👤';
        const xpNeeded = Math.floor(XP_BASE * Math.pow(c.level, XP_SCALING_EXPONENT));
        const detailPortraitHtml = `
            <div class="hero-detail-header sticky top-0 z-20 rounded-xl overflow-hidden border ${c.isNPC ? (c.isSummon ? 'border-purple-600/50' : 'border-blue-600/50') : 'border-slate-600/60'} shadow-[0_10px_30px_rgba(0,0,0,0.45)] mb-3">
                <div class="hero-detail-header-media ${portraitSrc ? '' : 'hero-detail-header-fallback'}">
                    ${portraitSrc ? `<img src="${portraitSrc}" class="hero-detail-header-bg" aria-hidden="true"><img src="${portraitSrc}" class="hero-detail-header-portrait">` : `<div class="hero-detail-fallback-icon">${portraitFallback}</div>`}
                    <div class="hero-detail-header-shade"></div>
                </div>
                <div class="hero-detail-header-meta">
                    <h3 class="cinzel text-amber-300 text-sm tracking-wide">${c.name} ${sumBadge}</h3>
                    <p class="text-[10px] text-slate-200/90">${c.class} • Lvl ${c.level}</p>
                    <div class="mt-1.5 w-full bg-black/40 h-1.5 rounded-full border border-white/10 overflow-hidden"><div class="bg-gradient-to-r from-purple-500 to-indigo-400 h-full" style="width: ${Math.min(100, (c.xp / xpNeeded) * 100)}%"></div></div>
                    <p class="text-[9px] text-slate-300/80 mt-1">${c.xp}/${xpNeeded} XP</p>
                </div>
            </div>
            <div class="hero-details-stack">
        `;

        DOM.detailsContent.innerHTML = sanitize(`
            ${detailPortraitHtml}
            ${(() => {
                let abilities = [];
                if (c.abilities) abilities = [...c.abilities];
                if (c.ability && !abilities.includes(c.ability)) abilities.push(c.ability);
                if (abilities.length === 0) return '<div class="mb-2 text-[9px] text-slate-500 italic">Keine Fähigkeiten erlernt</div>';
                return '<div class="mb-1"><h4 class="text-[9px] font-bold border-b border-amber-700/50 pb-1 mb-2 text-amber-400 uppercase tracking-wider"><i class="fas fa-fire mr-1"></i>Fähigkeiten</h4>' + abilities.map(ab => {
                    let cdKey = `${c.id}_${ab}`;
                    let cdRemaining = State.abilityCooldowns[cdKey] || 0;
                    let onCooldown = cdRemaining > 0;
                    let safeAb = ab.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                    let cdBarHtml = '';
                    if (onCooldown) {
                        cdBarHtml = `<div class="mt-1 flex items-center gap-1.5"><div class="flex-1 bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-700/50"><div class="bg-gradient-to-r from-orange-600 to-amber-500 h-full rounded-full transition-all" style="width: ${Math.min(100, cdRemaining * 20)}%"></div></div><span class="text-[8px] text-orange-400 font-mono font-bold whitespace-nowrap">${cdRemaining} Rdn</span></div>`;
                    }
                    return `<div ${onCooldown ? '' : `data-action="use-ability" data-char-id="${c.id}" data-ability="${safeAb}"`} class="mb-2 p-1.5 ${onCooldown ? 'bg-slate-800/60 border-slate-600/50 opacity-60 cursor-not-allowed' : 'bg-amber-900/40 hover:bg-amber-800/80 border-amber-700/50 hover:border-amber-500 cursor-pointer'} border rounded text-center text-[9px] shadow-sm transition-all ${onCooldown ? '' : 'shadow-[0_0_10px_rgba(245,158,11,0.2)] hover:shadow-[0_0_15px_rgba(245,158,11,0.4)]'} group"><span class="${onCooldown ? 'text-slate-500' : 'text-amber-500'} font-bold block mb-0.5 ${onCooldown ? '' : 'group-hover:animate-pulse'}">${onCooldown ? '<i class="fas fa-hourglass-half"></i> Abklingzeit' : '<i class="fas fa-meteor"></i> Fähigkeit (Klicken)'}:</span>${ab}${cdBarHtml}</div>`;
                }).join('') + '</div>';
            })()}
            ${(() => {
                // Feature 1: Item-Fähigkeiten aus ausgerüsteten Items extrahieren
                let itemAbilities = [];
                (c.equipment || []).forEach(item => {
                    let effects = [];
                    item.replace(/\s*\((.*?)\)/g, (match, p1) => {
                        effects.push(p1);
                        return '';
                    });
                    effects.forEach(e => {
                        // Nur Nicht-Stat-Effekte als Fähigkeiten zählen
                        if (!e.match(/^[+-]\d+\s*(STR|DEX|INT|CON)|(STR|DEX|INT|CON)\s*[+-]\d+$/i)) {
                            itemAbilities.push({ effect: e, source: item.replace(/\s*\(.*?\)/g, '').trim() });
                        }
                    });
                });
                if (itemAbilities.length === 0) return '';
                return '<div class="mb-1"><h4 class="text-[9px] font-bold border-b border-teal-700/50 pb-1 mb-2 text-teal-400 uppercase tracking-wider"><i class="fas fa-shield-alt mr-1"></i>Item-Fähigkeiten</h4>' + itemAbilities.map(ia => {
                    let safeEffect = ia.effect.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                    return `<div data-action="use-ability" data-char-id="${c.id}" data-ability="${safeEffect}" data-item-ability="true" class="mb-2 p-1.5 bg-teal-900/30 hover:bg-teal-800/50 border border-teal-700/40 hover:border-teal-500 rounded text-center text-[9px] cursor-pointer shadow-sm transition-all shadow-[0_0_10px_rgba(20,184,166,0.15)] hover:shadow-[0_0_15px_rgba(20,184,166,0.3)] group"><span class="text-teal-400 font-bold block mb-0.5 group-hover:animate-pulse"><i class="fas fa-gem"></i> ${ia.source}:</span>${ia.effect}</div>`;
                }).join('') + '</div>';
            })()}
            
            ${(c.talents && c.talents.length > 0) ? `<div class="mb-3"><h4 class="text-[9px] font-bold border-b border-slate-700 pb-1 mb-2 text-emerald-400 uppercase">Spezialisierung</h4><div class="flex flex-wrap gap-1">${c.talents.map(t => `<span class="bg-emerald-900/30 border border-emerald-500/30 text-emerald-200 px-2 py-0.5 rounded text-[10px]"><i class="fas fa-leaf mr-1 opacity-70"></i>${t}</span>`).join('')}</div></div>` : ''}
            
            ${(c.pendingTalentPoints > 0 && TALENT_TREES[c.class]) ? `<div class="mb-3 p-2 border border-emerald-500/50 rounded bg-emerald-950/30 shadow-inner"><div class="text-[10px] text-emerald-400 font-bold mb-2 uppercase tracking-wider"><i class="fas fa-star animate-pulse mr-1"></i> Talent wählbar!</div><div class="flex gap-1.5">` +
                Object.keys(TALENT_TREES[c.class]).map(lvlReq => {
                    if (c.level >= parseInt(lvlReq) && TALENT_TREES[c.class][lvlReq].some(t => !c.talents.includes(t))) {
                        return TALENT_TREES[c.class][lvlReq].filter(t => !c.talents.includes(t)).map(t => `<button data-action="learn-talent" data-char-id="${c.id}" data-talent="${t}" class="flex-1 bg-emerald-700/50 hover:bg-emerald-600/70 border border-emerald-500/50 text-white text-[9px] font-bold py-1.5 rounded shadow-sm transition-colors">${t}</button>`).join('');
                    }
                    return '';
                }).join('') + `</div></div>` : ''}

            <div><h4 class="text-[9px] font-bold border-b border-slate-700 pb-1 mb-2">ATTRIBUTE ${sBadge}</h4>${aHtml}</div>
            ${isPrivateInventory ? `
            <div class="mt-3 p-3 bg-slate-900/40 rounded-lg border border-slate-700/40 text-center">
                <i class="fas fa-lock text-slate-600 text-lg mb-1 block"></i>
                <p class="text-[10px] text-slate-500 italic">Privates Inventar</p>
            </div>` : `
            <div class="mt-3">
                <h4 class="text-[9px] font-bold border-b border-slate-700 pb-1 mb-2 text-indigo-300">AUSRÜSTUNG</h4>
                <ul id="equipment-list-${c.id}" class="text-[10px] space-y-1.5 mb-3"></ul>
                <h4 class="text-[9px] font-bold border-b border-slate-700 pb-1 mb-2">INVENTAR</h4>
                <ul id="inventory-list-${c.id}" class="text-[10px] space-y-1.5"></ul>
                <button data-action="start-crafting" data-char-id="${c.id}" class="w-full mt-2 bg-indigo-700/40 hover:bg-indigo-600/60 border border-indigo-500/50 text-indigo-200 text-[10px] py-1.5 rounded font-bold shadow-sm transition-all"><i class="fas fa-hammer mr-1"></i> Schmiede / Verzaubern</button>
            </div>`}
            </div>`);

        if (!isPrivateInventory) {
        const eqMap = new Map();
        (c.equipment || []).forEach(it => { eqMap.set(it, (eqMap.get(it) || 0) + 1); });

        let activeSetsHtml = "";
        EQUIPMENT_SETS.forEach(set => {
            let equippedPieces = 0;
            set.pieces.forEach(p => { if ((c.equipment || []).includes(p)) equippedPieces++; });
            if (equippedPieces >= 2) {
                let bonusDesc = Object.entries(set.bonus).map(([k, v]) => `+${v} ${k}`).join(', ');
                activeSetsHtml += `<div class="bg-indigo-900/40 border border-indigo-500/50 rounded p-1.5 mb-2 shadow-inner"><span class="text-indigo-300 font-bold text-[9px] uppercase"><i class="fas fa-layer-group text-indigo-400 mr-1"></i> Set-Bonus: ${set.name} (${equippedPieces}/${set.pieces.length})</span><div class="text-indigo-200 text-[8px] mt-0.5">${bonusDesc}</div></div>`;
            }
        });

        document.getElementById(`equipment-list-${c.id}`).innerHTML = sanitize(activeSetsHtml + Array.from(eqMap.entries()).map(([it, count]) => {
            const safeIt = it.replace(/'/g, "\\'").replace(/"/g, "&quot;");
            const countHtml = count > 1 ? `<span class="text-indigo-400 font-bold ml-1">(x${count})</span>` : '';
            const formatted = UI.formatItemDisplay(it);
            const titleAttr = formatted.hasEffects ? `title="${formatted.tooltip.replace(/"/g, '&quot;')}"` : '';
            const effectIcon = formatted.hasEffects ? `<i class="fas fa-info-circle text-indigo-400/70 ml-1 text-[8px]" ${titleAttr}></i>` : '';
            return `<li data-action="item-click" data-char-id="${c.id}" data-item="${safeIt}" data-equipped="true" data-count="${count}" class="bg-indigo-900/30 p-1.5 rounded cursor-pointer hover:bg-indigo-800/50 border border-indigo-700/50 flex justify-between group transition-colors" ${titleAttr}><span class="text-indigo-200">• ${formatted.displayName} ${effectIcon} ${countHtml}</span> <i class="fas fa-hand-pointer opacity-0 group-hover:opacity-100 text-indigo-400 mt-0.5"></i></li>`;
        }).join('') || '<li class="text-slate-500 italic">Nichts ausgerüstet</li>');

        const invMap = new Map();
        c.inventory.forEach(it => { invMap.set(it, (invMap.get(it) || 0) + 1); });
        document.getElementById(`inventory-list-${c.id}`).innerHTML = sanitize(Array.from(invMap.entries()).map(([it, count]) => {
            const safeIt = it.replace(/'/g, "\\'").replace(/"/g, "&quot;");
            const countHtml = count > 1 ? `<span class="text-amber-500 font-bold ml-1">(x${count})</span>` : '';
            const formatted = UI.formatItemDisplay(it);
            const titleAttr = formatted.hasEffects ? `title="${formatted.tooltip.replace(/"/g, '&quot;')}"` : '';
            const effectIcon = formatted.hasEffects ? `<i class="fas fa-info-circle text-amber-500/70 ml-1 text-[8px]" ${titleAttr}></i>` : '';
            return `<li data-action="item-click" data-char-id="${c.id}" data-item="${safeIt}" data-equipped="false" data-count="${count}" class="bg-slate-800/50 p-1.5 rounded cursor-pointer hover:bg-slate-700 border border-slate-700/50 flex justify-between group transition-colors" ${titleAttr}><span>• ${formatted.displayName} ${effectIcon} ${countHtml}</span> <i class="fas fa-hand-pointer opacity-0 group-hover:opacity-100 text-slate-400 mt-0.5"></i></li>`;
        }).join('') || '<li class="text-slate-500 italic">Leer</li>');
        }

        DOM.exportHeroBtn.dataset.action = 'export-hero';
        DOM.exportHeroBtn.dataset.charId = c.id;
    },
    hideDetails: function () { DOM.charDetails.classList.add('hidden'); DOM.partyList.classList.remove('hidden'); },

    showAnimatedDiceModal: function (name, targetDC, modifier, callback, closeAfter = true, diceType = 'W20', watchMode = false) {
        Sound.play('dice');
        let sides = 20;
        if (diceType && diceType.toUpperCase().startsWith('W')) {
            sides = parseInt(diceType.substring(1)) || 20;
        }

        // Watch mode: show animation but don't execute callback (another player is rolling)
        if (watchMode) {
            if (DOM.diceRollerPortrait) {
                let entity = Utils.findTarget(State.party, name) || Utils.findTarget(State.activeEnemies, name);
                let portraitHtml = '👤';
                if (entity) {
                    if (entity.portrait) portraitHtml = `<img src="${entity.portrait}" class="w-full h-full object-cover">`;
                    else if (entity.isSummon) portraitHtml = '🌀';
                    else if (entity.hp !== undefined && !entity.class) portraitHtml = '💀';
                    DOM.diceRollerPortrait.className = `w-16 h-16 rounded-full border-2 bg-slate-800 flex items-center justify-center text-3xl overflow-hidden shadow-inner flex-shrink-0 ${entity.isNPC ? (entity.isSummon ? 'border-purple-500' : 'border-blue-500') : (entity.class ? 'border-amber-500' : 'border-red-600')}`;
                } else {
                    DOM.diceRollerPortrait.className = 'w-16 h-16 rounded-full border-2 border-slate-600 bg-slate-800 flex items-center justify-center text-3xl overflow-hidden shadow-inner flex-shrink-0';
                }
                DOM.diceRollerPortrait.innerHTML = portraitHtml;
                DOM.diceRollerPortrait.classList.remove('hidden');
            }
            DOM.diceRollerName.innerText = name;
            DOM.diceTargetDc.innerText = `Ziel: DC ${targetDC}`; DOM.diceTargetDc.classList.remove('hidden');
            DOM.diceAcceptBtn.classList.add('hidden'); DOM.diceModal.classList.remove('hidden');
            DOM.diceQualityLabel.innerText = "Würfelt..."; DOM.diceQualityLabel.className = "text-xl cinzel text-slate-400 tracking-widest mb-4 animate-pulse h-8";
            DOM.diceResult.className = "text-9xl font-bold cinzel mb-6 mt-4 text-white inline-block dice-rolling";
            let wc = 0;
            const wival = setInterval(() => {
                DOM.diceResult.innerText = Math.floor(Math.random() * sides) + 1; wc++;
                if (wc > DICE_ANIMATION_TICKS + 5) {
                    clearInterval(wival);
                    DOM.diceQualityLabel.innerText = "Ergebnis ausstehend...";
                    setTimeout(() => DOM.diceModal.classList.add('hidden'), 1800);
                }
            }, DICE_ANIMATION_INTERVAL_MS);
            return;
        }

        if (DOM.diceRollerPortrait) {
            let entity = Utils.findTarget(State.party, name) || Utils.findTarget(State.activeEnemies, name);
            let portraitHtml = '👤';
            if (entity) {
                if (entity.portrait) portraitHtml = `<img src="${entity.portrait}" class="w-full h-full object-cover">`;
                else if (entity.isSummon) portraitHtml = '🌀';
                else if (entity.hp !== undefined && !entity.class) portraitHtml = '💀';
                DOM.diceRollerPortrait.className = `w-16 h-16 rounded-full border-2 bg-slate-800 flex items-center justify-center text-3xl overflow-hidden shadow-inner flex-shrink-0 ${entity.isNPC ? (entity.isSummon ? 'border-purple-500' : 'border-blue-500') : (entity.class ? 'border-amber-500' : 'border-red-600')}`;
            } else {
                DOM.diceRollerPortrait.className = "w-16 h-16 rounded-full border-2 border-slate-600 bg-slate-800 flex items-center justify-center text-3xl overflow-hidden shadow-inner flex-shrink-0";
            }
            DOM.diceRollerPortrait.innerHTML = portraitHtml;
            DOM.diceRollerPortrait.classList.remove('hidden');
        }

        DOM.diceRollerName.innerText = name;
        DOM.diceTargetDc.innerText = `Ziel: DC ${targetDC}`; DOM.diceTargetDc.classList.remove('hidden');
        DOM.diceAcceptBtn.classList.add('hidden'); DOM.diceModal.classList.remove('hidden');

        DOM.diceContainer.classList.remove('scale-110');
        void DOM.diceContainer.offsetWidth; // Reflow
        DOM.diceContainer.classList.add('scale-110');

        DOM.diceQualityLabel.innerText = "Würfelt..."; DOM.diceQualityLabel.className = "text-xl cinzel text-slate-400 tracking-widest mb-4 animate-pulse h-8";
        DOM.diceResult.className = "text-9xl font-bold cinzel mb-6 mt-4 text-white inline-block dice-rolling";

        let count = 0;
        const ival = setInterval(() => {
            DOM.diceResult.innerText = Math.floor(Math.random() * sides) + 1; count++;
            if (count > DICE_ANIMATION_TICKS) {
                clearInterval(ival);
                const finalRawRoll = Math.floor(Math.random() * sides) + 1;
                const totalResult = finalRawRoll + modifier;

                State.sessionStats.diceRolls.push(finalRawRoll);
                if (finalRawRoll > State.sessionStats.highestRoll) State.sessionStats.highestRoll = finalRawRoll;
                if (finalRawRoll < State.sessionStats.lowestRoll) State.sessionStats.lowestRoll = finalRawRoll;

                const success = totalResult >= targetDC;
                const isCritical = finalRawRoll === sides; // Maximaler Wurf
                const isNearSuccess = success && totalResult === targetDC; // Haarscharf bestanden
                const isNearMiss = !success && totalResult === targetDC - 1; // Um einen Punkt verfehlt
                const isBotch = finalRawRoll === 1; // Minimaler Wurf

                let labelHtml, labelClass;
                if (isCritical && success) {
                    labelHtml = "⚡ KRITISCH! <i class='fas fa-star'></i>";
                    labelClass = 'text-yellow-300 animate-pulse drop-shadow-[0_0_15px_rgba(234,179,8,0.8)]';
                } else if (isBotch) {
                    labelHtml = "💀 PATZER! <i class='fas fa-skull'></i>";
                    labelClass = 'text-red-600 animate-pulse';
                } else if (isNearSuccess) {
                    labelHtml = "🎯 KNAPP BESTANDEN! <i class='fas fa-crosshairs'></i>";
                    labelClass = 'text-cyan-300 drop-shadow-[0_0_10px_rgba(34,211,238,0.6)]';
                } else if (isNearMiss) {
                    labelHtml = "💨 FAST GESCHAFFT... <i class='fas fa-minus-circle'></i>";
                    labelClass = 'text-orange-400';
                } else if (success) {
                    labelHtml = "Erfolg <i class='fas fa-check'></i>";
                    labelClass = 'text-green-400';
                } else {
                    labelHtml = "Fehlschlag <i class='fas fa-times'></i>";
                    labelClass = 'text-red-500';
                }

                DOM.diceQualityLabel.innerHTML = labelHtml;
                DOM.diceQualityLabel.className = `text-2xl cinzel font-bold uppercase tracking-widest mb-4 drop-shadow-lg h-8 ${labelClass}`;

                if (isCritical && success) Sound.play('crit');
                else if (!success) Sound.play('fail');

                let modStr = modifier !== 0 ? `<span class="text-4xl text-slate-400 mx-2">${modifier >= 0 ? '+' : ''}${modifier}</span><span class="text-7xl">=${totalResult}</span>` : '';
                DOM.diceResult.innerHTML = `<span class="text-7xl">${finalRawRoll}</span>${modStr}`;
                DOM.diceResult.className = `font-bold cinzel mb-6 mt-4 transition-all duration-300 scale-110 drop-shadow-[0_0_20px_rgba(255,255,255,0.5)] ${success ? 'text-green-300' : 'text-red-400'}`;

                setTimeout(() => {
                    if (closeAfter) DOM.diceModal.classList.add('hidden');
                    if (callback) callback(totalResult, success, finalRawRoll);
                }, 1800);
            }
        }, DICE_ANIMATION_INTERVAL_MS);
    },

    showDiceModal: function (target, isGroup = false) {
        Sound.play('dice');
        const r = Math.floor(Math.random() * 20) + 1;
        DOM.diceResult.innerText = r;
        DOM.diceResult.className = "text-9xl font-bold cinzel mb-6 text-white inline-block";
        DOM.diceTargetDc.classList.add('hidden');
        DOM.diceAcceptBtn.classList.remove('hidden');

        let activeName = DOM.actingChar.value;
        if (isGroup || activeName === 'party') activeName = "Die Gruppe";
        else if (typeof target === 'string' && target !== 'null') activeName = target;

        DOM.diceRollerName.innerText = activeName;
        DOM.diceQualityLabel.innerText = r === 20 ? "Kritisch!" : r >= 10 ? "Erfolg" : r > 1 ? "Fehlschlag" : "Patzer!";
        DOM.diceQualityLabel.className = `text-xl cinzel font-bold uppercase tracking-widest mb-8 ${r >= 10 ? 'text-green-400' : 'text-red-500'}`;
        DOM.diceModal.classList.remove('hidden');
    },

    showLootAnimation: function () {
        const container = DOM.lootDropSection;
        if (!container) return;

        // Play loot sound
        Sound.play('loot');

        // Layer 1: Container glow effect
        container.classList.add('loot-container-glow');
        setTimeout(() => {
            container.classList.remove('loot-container-glow');
        }, 3600); // 3 iterations of 1.2s = 3.6s

        // Layer 2: "LOOT!" floating text
        const float = document.createElement('div');
        float.className = 'damage-float loot';
        float.textContent = 'LOOT!';
        float.style.position = 'fixed';

        const rect = container.getBoundingClientRect();
        float.style.left = (rect.left + rect.width / 2 - 50) + 'px';
        float.style.top = (rect.top - 50) + 'px';
        float.style.zIndex = '1000';

        document.body.appendChild(float);
        setTimeout(() => float.remove(), 1800);

        // Layer 3: Particle explosion inside container
        this.createLootParticles(container);
    },

    createLootParticles: function (container) {
        const colors = ['#c084fc', '#fbbf24', '#a3e635', '#22c55e', '#3b82f6'];
        const particleCount = 15;

        for (let i = 0; i < particleCount; i++) {
            const p = document.createElement('div');
            p.className = 'loot-particle';

            const size = 4 + Math.random() * 6;
            p.style.width = size + 'px';
            p.style.height = size + 'px';
            p.style.background = colors[Math.floor(Math.random() * colors.length)];
            p.style.boxShadow = `0 0 ${size}px ${p.style.background}`;

            // Start position (random within container)
            const containerRect = container.getBoundingClientRect();
            const startX = Math.random() * containerRect.width;
            const startY = Math.random() * containerRect.height * 0.5; // top half

            p.style.left = (containerRect.left + startX) + 'px';
            p.style.top = (containerRect.top + startY) + 'px';
            p.style.position = 'fixed';

            // Random horizontal drift
            const drift = (Math.random() - 0.5) * 100;
            p.style.setProperty('--drift', drift + 'px');

            // Extend animation with custom drift
            p.style.animation = `lootParticleFall ${1.5 + Math.random() * 0.5}s ease-out forwards`;

            document.body.appendChild(p);
            setTimeout(() => p.remove(), 2000);
        }
    }
};

