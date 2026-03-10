import { State, dispatch } from './state.js';
import { PRESETS, TALENT_TREES, EQUIPMENT_SETS } from './prompts.js';
import { PartyManager } from './party.js';
import { Sound } from './sound.js';
import { Utils } from './utils.js';
import { API } from './api.js';
import { repairDisplayText, repairHtmlText, sanitize, sanitizeStrict } from './sanitize.js';
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
        ['rate', 'pitch', 'vol'].forEach(k => {
            document.getElementById(`tts-${k}`).oninput = (e) => {
                document.getElementById(`tts-${k}-val`).textContent = parseFloat(e.target.value).toFixed(2);
            };
        });
        modal.classList.remove('hidden');
    },

    savePicker: function () {
        this.cfg.voice = document.getElementById('tts-voice-select').value;
        this.cfg.rate = parseFloat(document.getElementById('tts-rate').value);
        this.cfg.pitch = parseFloat(document.getElementById('tts-pitch').value);
        this.cfg.vol = parseFloat(document.getElementById('tts-vol').value);
        localStorage.setItem('tts_cfg', JSON.stringify(this.cfg));
        document.getElementById('tts-picker-modal').classList.add('hidden');
    },

    testVoice: function () {
        if (this.synth.speaking) this.synth.cancel();
        const u = new SpeechSynthesisUtterance('In den Tiefen des Dungeons hallt euer Atem wider. Die Fackeln flackern.');
        u.lang = 'de-DE';
        u.rate = parseFloat(document.getElementById('tts-rate').value);
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
        'action-box-container', 'player-input', 'send-btn',
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
        'journal-content', 'stats-content', 'system-content', 'quick-actions-container', 'sound-toggle',
        'music-toggle', 'music-modal', 'music-track-label', 'music-volume-slider', 'music-volume-value', 'music-power-btn',
        'tab-content-party', 'tab-content-dice', 'tab-content-system', 'tab-content-journal', 'tab-content-stats',
        'tab-party', 'tab-dice', 'tab-system', 'tab-journal', 'tab-stats',
        'topbar-thinking-status', 'topbar-thinking-text',
        'enemy-lightbox', 'enemy-lightbox-image', 'enemy-lightbox-title'
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
        c = { ...c, name: repairDisplayText(c.name || ''), class: repairDisplayText(c.class || '') };
        const isDead = c.hp === 0;
        const ownHighlight = isOwnHero && !isDead ? 'border-cyan-400/70 shadow-[0_0_20px_rgba(34,211,238,0.35)] ring-1 ring-cyan-500/30' : '';
        const borderClass = ownHighlight || (isDead ? 'border-red-900 shadow-[0_0_15px_rgba(220,38,38,0.3)] grayscale opacity-80' :
            (c.isSummon ? 'border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]' :
                (c.isNPC ? 'border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-white/10 hover:border-amber-500/50 shadow-[0_4px_15px_rgba(0,0,0,0.5)] hover:shadow-[0_0_20px_rgba(245,158,11,0.2)]')));
        const nameColor = isDead ? 'text-red-500 line-through' :
            (c.isSummon ? 'text-purple-400 drop-shadow-[0_0_5px_rgba(168,85,247,0.5)]' :
                (c.isNPC ? 'text-blue-400 drop-shadow-[0_0_5px_rgba(96,165,250,0.5)]' : 'text-amber-400 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)]'));
        const badge = isDead ? '<i class="fas fa-skull"></i>' : (c.isSummon ? '<i class="fas fa-hat-wizard"></i>' : '<i class="fas fa-user"></i>');
        const effMaxHp = PartyManager.getEffectiveMaxHp(c);
        if (c.hp > effMaxHp) c.hp = effMaxHp;
        const hpPercent = (c.hp / effMaxHp) * 100;
        const hpGlowClass = isDead ? 'hp-glow-dead' : (hpPercent > 75 ? 'hp-glow-high' : (hpPercent > 25 ? 'hp-glow-mid' : 'hp-glow-low'));

        const portraitHtml = c.portrait ? `<img src="${c.portrait}" class="w-10 h-10 rounded-lg object-cover bg-black/50 border ${hpGlowClass} shadow-sm btn-premium">` : `<div class="w-10 h-10 rounded-lg bg-black/50 flex items-center justify-center border border-white/10 text-[10px] shadow-sm btn-premium">${badge}</div>`;

        return `<div class="bg-black/30 backdrop-blur-md p-2 rounded-xl border ${borderClass} flex gap-2.5 items-center cursor-pointer group transition-all btn-premium" data-action="entity-click" data-name="${c.name.replace(/"/g, '&quot;')}" data-entity-type="hero" data-entity-id="${c.id}">
            ${portraitHtml}
            <div class="flex-1">
                <div class="flex justify-between text-[11px] font-bold tracking-wide"><span class="${nameColor}">${c.name} <span class="text-slate-500 text-[9px] font-normal ml-0.5">Lvl ${c.level}</span></span><span class="${isDead ? 'text-red-500' : 'text-slate-300 font-mono'}">${c.hp}/${effMaxHp}</span></div>
                <div class="w-full bg-black/60 h-1.5 rounded-full mt-1.5 border border-white/5 overflow-hidden"><div class="${c.isNPC ? (c.isSummon ? 'bg-gradient-to-r from-purple-700 to-purple-400' : 'bg-gradient-to-r from-blue-700 to-blue-400') : 'bg-gradient-to-r from-red-700 to-red-400'} h-full rounded-full transition-all duration-500" style="width: ${(c.hp / effMaxHp) * 100}%"></div></div>
            </div>
            ${c._levelUpPortraitReady ? `<button data-action="refresh-levelup-portrait" data-char-id="${c.id}" class="p-1.5 text-purple-400 hover:text-purple-300 transition-colors bg-purple-900/30 rounded-lg hover:bg-purple-900/50 border border-purple-500/30 btn-premium" title="Neues Level-Porträt generieren"><i class="fas fa-image text-[10px]"></i></button>` : ''}
            ${c._portraitRegenPending ? `<span class="p-1.5 text-purple-400/60"><i class="fas fa-spinner fa-spin text-[10px]"></i></span>` : ''}
            <button data-action="remove-char" data-char-id="${c.id}" class="opacity-0 group-hover:opacity-100 p-1.5 text-red-500/70 hover:text-red-400 transition-colors bg-white/5 rounded-lg hover:bg-white/10 btn-premium"><i class="fas fa-trash text-[10px]"></i></button>
        </div>`;
    },
    buildEnemyCard: function (e, isDeadFlag) {
        e = { ...e, name: repairDisplayText(e.name || ''), description: repairDisplayText(e.description || ''), appearance: repairDisplayText(e.appearance || ''), loot: repairDisplayText(e.loot || '') };
        const isDead = isDeadFlag || e.hp <= 0;
        const hpDisplay = isDead ? 0 : e.hp;
        const hpBarWidth = isDead ? 0 : (e.hp / e.maxHp) * 100;
        const hoverClass = isDead ? '' : 'cursor-pointer hover:border-red-400/80 transition-all hover:shadow-[0_0_15px_rgba(248,113,113,0.3)] hover:bg-red-950/20';
        return `<div class="bg-black/30 backdrop-blur-sm p-2 rounded-xl border ${isDead ? 'border-slate-800' : 'border-red-900/50 shadow-[0_4px_10px_rgba(0,0,0,0.5)]'} flex gap-2.5 items-center fade-in btn-premium ${isDead ? 'defeated-enemy' : ''} ${hoverClass}" ${!isDead ? `data-action="entity-click" data-name="${e.name.replace(/"/g, '&quot;')}" data-entity-type="enemy" data-entity-id="${e.id}"` : ''}>
            ${e.portrait ? `<img src="${e.portrait}" class="w-10 h-10 rounded-lg object-cover btn-premium ${isDead ? '' : 'border border-red-900/50 shadow-[0_0_10px_rgba(127,29,29,0.5)]'}">` : `<div class="w-10 h-10 rounded-lg bg-black/60 btn-premium ${isDead ? '' : 'border border-red-900/50 shadow-[0_0_10px_rgba(127,29,29,0.5)]'} flex items-center justify-center text-red-500/50"><i class="fas fa-skull"></i></div>`}
            <div class="flex-1 min-w-0">
                <div class="flex justify-between text-[10px] truncate tracking-wide"><span class="${isDead ? 'line-through text-slate-600' : 'text-slate-200'}">${e.name}</span><span class="${isDead ? 'text-slate-600' : 'text-red-400 font-mono font-bold drop-shadow-[0_0_2px_rgba(248,113,113,0.8)]'}">${hpDisplay}/${e.maxHp}</span></div>
                <div class="w-full bg-black/60 h-1.5 rounded-full mt-1.5 overflow-hidden border border-white/5"><div class="${isDead ? 'bg-slate-700' : 'bg-gradient-to-r from-red-800 to-red-500'} h-full transition-all duration-500" style="width: ${hpBarWidth}%"></div></div>
            </div>
        </div>`;
    }
};

export const UI = {
    _setHtmlIfChanged: function (element, html) {
        if (!element) return;
        const nextHtml = String(html ?? '');
        if (element.innerHTML !== nextHtml) {
            element.innerHTML = nextHtml;
        }
    },
    formatItemDisplay: function (fullItemString) {
        const sourceText = repairDisplayText(fullItemString || '');
        let effects = [];
        let cleanName = sourceText.replace(/\s*\((.*?)\)/g, (match, p1) => {
            effects.push(repairDisplayText(p1));
            return '';
        }).trim();
        if (!cleanName) cleanName = sourceText;

        let visibleStats = [];
        let hiddenEffects = [];
        effects.forEach(e => {
            if (/^(?:[+-]\s*\d+\s*(?:STR|DEX|INT|CON)|(?:STR|DEX|INT|CON)\s*[+-]\s*\d+)$/i.test(e)) {
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
    showLoader: function (s) {
        if (DOM.loadingSpinner) DOM.loadingSpinner.classList.add('hidden');
        const existing = DOM.storyLog?.querySelector('#dm-typing-indicator');
        if (existing) existing.remove();
        if (!s || !DOM.storyLog) return;
        const row = document.createElement('article');
        row.id = 'dm-typing-indicator';
        row.className = 'chat-row chat-row-dm';
        row.innerHTML = sanitize(`
            <div class="dm-message-card chat-bubble chat-bubble-dm">
                <div class="chat-meta-row">
                    <span class="chat-sender chat-sender-dm">DM</span>
                </div>
                <div class="dm-typing-bubble">
                    <span class="dm-typing-orb"></span>
                </div>
            </div>
        `);
        DOM.storyLog.appendChild(row);
        this.scrollChatToBottom();
    },
    showToast: function (message, duration = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toast.style.setProperty('--delay', `${duration}ms`);
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = `toastOut 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards`;
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },
    selectOption: function (t) {
        this.clearSuggestions();
        const optionText = repairDisplayText(String(t || ''));
        const normalized = optionText
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<strong[^>]*>.*?<\/strong>/gi, match => match.replace(/<[^>]+>/g, ''))
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/^[::][^\s]+\s+/g, '')
            .replace(/^[-*]\s*/g, '')
            .replace(/\s+[|>]+\s*/g, ' ')
            .replace(/^(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}\u2600-\u27BF]\s*)+/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
        DOM.playerInput.value = normalized.replace(/<[^>]+>/g, '').trim();
        DOM.playerInput.focus();
    },

    clearSuggestions: function () {
        document.querySelectorAll('.suggestion-option').forEach(el => {
            const wrapper = el.parentElement;
            if (wrapper && wrapper.children.length === 1 && wrapper.classList.contains('mt-3')) wrapper.remove();
            else el.remove();
        });
    },

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
                <button title="Einfuegen" data-action="insert-prompt" data-idx="${idx}" class="text-blue-400 hover:text-blue-300 p-1.5 transition-colors"><i class="fas fa-paste"></i></button>
                <button title="Spielen" data-action="play-prompt" data-idx="${idx}" class="text-emerald-400 hover:text-emerald-300 p-1.5 transition-colors"><i class="fas fa-play"></i></button>
                <button title="Loeschen" data-action="delete-prompt" data-idx="${idx}" class="text-opacity-50 text-red-500 hover:text-opacity-100 p-1.5 transition-opacity"><i class="fas fa-trash"></i></button>
            </div>`;
        }).join('');
        document.getElementById('prompt-list').innerHTML = sanitize(listHtml || '<p class="text-slate-500 text-xs text-center italic mt-2">Noch keine Prompts gespeichert.</p>');
    },

    switchTab: function (tab) {
        ['party', 'dice', 'system', 'journal', 'stats'].forEach(t => {
            const btn = DOM[`tab${t.charAt(0).toUpperCase() + t.slice(1)}`];
            const content = DOM[`tabContent${t.charAt(0).toUpperCase() + t.slice(1)}`];
            if (!btn || !content) return;
            const active = t === tab;
            btn.classList.toggle('active', active);
            content.classList.toggle('hidden', !active);
            content.classList.toggle('flex', active);
        });
        if (tab === 'dice') this.renderDiceFeed();
        if (tab === 'system') this.renderSystemLog();
        if (tab === 'journal') this.renderJournal();
        if (tab === 'stats') this.renderStats();
    },
    renderJournal: function () {
        if (!DOM.journalContent) return;
        if (State.journal.length === 0) {
            DOM.journalContent.innerHTML = '<p class="text-slate-500 italic">Noch keine Eintraege. Starte ein Abenteuer und klicke auf Update!</p>';
            return;
        }
        DOM.journalContent.innerHTML = sanitize(repairHtmlText(State.journal.map((e, i) => `
            <div class="journal-entry fade-in">
                <div class="flex justify-between text-[9px] text-slate-500 mb-1">
                    <span>Eintrag #${State.journal.length - i}</span>
                    <span>${repairDisplayText(e.timestamp || '')}</span>
                </div>
                <p class="text-slate-300 leading-relaxed">${repairDisplayText(e.text || '')}</p>
            </div>
        `).join('')));
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

        DOM.statsContent.innerHTML = sanitize(repairHtmlText(`
            <div class="space-y-3">
                <div>
                    <div class="text-[9px] uppercase text-slate-500 font-bold mb-2 tracking-wider">Kampf</div>
                    <div class="grid grid-cols-2 gap-1.5 text-[10px]">
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50"><div class="text-slate-400">Schaden ausgeteilt</div><div class="text-red-400 font-bold text-sm">${s.totalDamageDealt}</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50"><div class="text-slate-400">Schaden erhalten</div><div class="text-orange-400 font-bold text-sm">${s.totalDamageTaken}</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50"><div class="text-slate-400">Geheilt</div><div class="text-green-400 font-bold text-sm">${s.totalHealed}</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50"><div class="text-slate-400">Kaempfe gewonnen</div><div class="text-purple-400 font-bold text-sm">${s.combatsWon}</div></div>
                    </div>
                </div>
                <div>
                    <div class="text-[9px] uppercase text-slate-500 font-bold mb-2 tracking-wider">Wuerfel</div>
                    <div class="grid grid-cols-3 gap-1.5 text-[10px]">
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50 text-center"><div class="text-slate-400">Schnitt</div><div class="${luckyColor} font-bold text-sm">${avgRoll}</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50 text-center"><div class="text-slate-400">Hoechster</div><div class="text-green-400 font-bold text-sm">${s.diceRolls.length ? s.highestRoll : '-'}</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50 text-center"><div class="text-slate-400">Niedrigster</div><div class="text-red-400 font-bold text-sm">${s.diceRolls.length ? s.lowestRoll : '-'}</div></div>
                    </div>
                    <div class="text-center text-[10px] text-slate-500 mt-1">${s.diceRolls.length} Wuerfe gesamt | ${s.turnsPlayed} Runden</div>
                </div>
                <div>
                    <div class="text-[9px] uppercase text-slate-500 font-bold mb-2 tracking-wider">Gruppe</div>
                    ${charStats || '<p class="text-slate-500 italic text-[10px]">Keine Helden</p>'}
                    <div class="grid grid-cols-2 gap-1.5 text-[10px] mt-2">
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50"><div class="text-slate-400">Session-XP</div><div class="text-yellow-400 font-bold text-sm">${s.totalXPEarned}</div></div>
                        <div class="bg-slate-800/60 p-1.5 rounded border border-slate-700/50"><div class="text-slate-400">Momentum</div><div class="${(State.momentum || 0) >= 3 ? 'text-yellow-300 animate-pulse' : 'text-slate-300'} font-bold text-sm">${State.momentum || 0}x</div></div>
                    </div>
                </div>
            </div>
        `));
    },
    updateAll: function () {
        if (this._updateAllTimeout) {
            cancelAnimationFrame(this._updateAllTimeout);
        }
        this._updateAllTimeout = requestAnimationFrame(() => {
            this._updateAllInternal();
        });
    },

    _updateAllInternal: function () {
        this.renderLobbyView();
        this.toggleViews(!!State.gameStarted || State.sessionPhase === 'in_game');
        const myCharId = State._mpMyCharId || null;
        const sorted = [...State.party].sort((a, b) => {
            if (a.id === myCharId) return -1;
            if (b.id === myCharId) return 1;
            return 0;
        });
        this._setHtmlIfChanged(DOM.partyList, sanitize(sorted.map(c => UIBuilders.buildHeroCard(c, c.id === myCharId)).join('')));
        const isMp = State._mpRole && myCharId;
        if (isMp) {
            const myChar = State.party.find(p => p.id === myCharId);
            State.actingChar = (myChar && myChar.hp > 0) ? myChar.name : 'party';
        }
        DOM.enemySection.classList.toggle('hidden', !State.activeEnemies.length && !State.defeatedEnemies.length);
        this._setHtmlIfChanged(DOM.enemyHistoryContainer, sanitize(State.defeatedEnemies.map(e => UIBuilders.buildEnemyCard(e, true)).join('')));
        this._setHtmlIfChanged(DOM.currentEnemyContainer, sanitize(State.activeEnemies.map(e => UIBuilders.buildEnemyCard(e, false)).join('')));

        if (DOM.lootDropSection && DOM.lootList) {
            const hadLoot = !DOM.lootDropSection.classList.contains('hidden');
            DOM.lootDropSection.classList.toggle('hidden', !State.lootDrops.length);
            const lootHtml = sanitize(State.lootDrops.map((it, idx) => {
                const formatted = UI.formatItemDisplay(it);
                const titleAttr = formatted.hasEffects ? 'title="' + formatted.tooltip.replace(/"/g, '&quot;') + '"' : '';
                const effectIcon = formatted.hasEffects ? '<i class="fas fa-info-circle text-amber-500/70 ml-1 text-[8px]" ' + titleAttr + '></i>' : '';
                return '<div class="text-[10px] bg-amber-950/60 p-1.5 rounded border border-amber-800/50 flex justify-between items-center mt-1.5 shadow-sm loot-item-entrance" ' + titleAttr + '><span class="text-amber-300 font-mono truncate mr-2 flex-1">+ ' + formatted.displayName + ' ' + effectIcon + '</span><select data-action="assign-loot" data-idx="' + idx + '" class="bg-slate-800 text-slate-300 border border-slate-600 rounded outline-none p-1 max-w-[85px] cursor-pointer"><option value="">Geben...</option>' + State.party.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('') + '</select></div>';
            }).join(''));
            this._setHtmlIfChanged(DOM.lootList, lootHtml);
            if (!hadLoot && State.lootDrops.length > 0) this.showLootAnimation();
        }

        const collectAllSelect = document.getElementById('collect-all-select');
        if (collectAllSelect) collectAllSelect.innerHTML = '<option value="">Alle nehmen...</option>' + State.party.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');

        if (State.activeMerchant) {
            DOM.merchantSection.classList.remove('hidden');
            DOM.merchantName.innerText = State.activeMerchant.name;
            this._setHtmlIfChanged(DOM.merchantItems, sanitize(State.activeMerchant.items.map(it => '<div class="bg-blue-950/60 p-1.5 rounded border border-blue-800/50 flex justify-between items-center mt-1.5 shadow-sm"><span class="text-blue-200">' + it + '</span></div>').join('')));
        } else {
            DOM.merchantSection.classList.add('hidden');
        }

        const hud = document.getElementById('dungeon-hud');
        if (hud) hud.classList.toggle('hidden', !State.gameStarted);
        if (State.gameStarted && hud) {
            const fateEl = document.getElementById('hud-fate');
            if (fateEl) {
                const f = State.fate || 0;
                fateEl.innerText = f + '/100';
                fateEl.className = 'text-xs font-bold ' + (f <= 25 ? 'text-green-400' : f <= 50 ? 'text-blue-400' : f <= 75 ? 'text-yellow-400' : 'text-red-500 animate-pulse');
            }
            const fatigueEl = document.getElementById('hud-fatigue');
            if (fatigueEl) fatigueEl.innerText = State.fatigue;
        }

        document.body.classList.toggle('session-startscreen', ['start', 'api_gate'].includes(State.sessionPhase || 'start'));
        document.body.classList.toggle('session-pregame', State.sessionPhase === 'pregame');
        this.updateSelfControlButton();
        this.updateTargetModeButton();
        this.updateActionBox();
        this.renderDiceFeed();
        this.renderSystemLog();


    },

    toggleTargetMode: function () {
        State.targetMapMode = !State.targetMapMode;
        this.updateTargetModeButton();
    },
    _updateActionBoxTimeout: null,
    updateActionBox: function () {
        if (this._updateActionBoxTimeout) {
            cancelAnimationFrame(this._updateActionBoxTimeout);
        }
        this._updateActionBoxTimeout = requestAnimationFrame(() => {
            this._updateActionBoxInternal();
        });
    },

    _updateActionBoxInternal: function () {
        if (State.pendingRolls.length > 0) {
            DOM.actionBoxContainer.classList.remove('hidden');
            DOM.playerInput.disabled = true;
            DOM.sendBtn.disabled = true;
            DOM.playerInput.placeholder = 'Wuerfle zuerst die anstehenden Proben aus...';

            const isClient = State._mpRole === 'client';
            const myChar = State._mpMyCharId ? State.party.find(p => p.id === State._mpMyCharId) : null;

            let html = '<h3 class="text-indigo-400 text-[10px] font-bold uppercase mb-2 tracking-widest flex items-center gap-2"><i class="fas fa-dice-d20"></i> Erforderliche Proben</h3><div class="space-y-1.5">';
            State.pendingRolls.forEach(r => {
                const dt = r.diceType || 'W20';
                const btnClass = dt === 'W6'
                    ? 'bg-blue-600 hover:bg-blue-500'
                    : (dt === 'W100' ? 'bg-purple-700 hover:bg-purple-600 shadow-[0_0_15px_rgba(147,51,234,0.5)]' : 'bg-indigo-600 hover:bg-indigo-500');
                const textClass = dt === 'W6' ? 'text-blue-400' : (dt === 'W100' ? 'text-purple-300 font-bold' : 'text-indigo-400');
                const canRoll = !isClient || (myChar && r.name === myChar.name);
                let status;

                if (r.rolled) {
                    status = r.result >= r.dc
                        ? `<span class="text-green-400 text-xs font-bold flex items-center gap-1 bg-green-900/20 px-2 py-1 rounded border border-green-700/50"><i class="fas fa-check"></i> Erfolg (${r.result})</span>`
                        : `<span class="text-red-400 text-xs font-bold flex items-center gap-1 bg-red-900/20 px-2 py-1 rounded border border-red-700/50"><i class="fas fa-times"></i> Fehlschlag (${r.result})</span>`;
                } else if (canRoll) {
                    status = `<div id="roll-status-${r.id}"><button data-action="roll-specific" data-roll-id="${r.id}" class="${btnClass} px-3 py-1 rounded text-white text-[10px] font-bold shadow-md transition-all">${dt} werfen</button></div>`;
                } else if (window.App?.Network?.isHost?.()) {
                    status = `<div class="flex flex-col items-end gap-1"><span class="text-[9px] text-slate-500 italic"><i class="fas fa-hourglass-half mr-1"></i>Warte...</span><button data-action="mp-roll-pending" data-roll-id="${r.id}" class="px-2 py-1 rounded border border-amber-500/40 text-amber-300 text-[9px] font-bold hover:bg-amber-900/30 transition-colors">Fuer ${r.name} wuerfeln</button></div>`;
                } else {
                    status = '<span class="text-[9px] text-slate-500 italic animate-pulse"><i class="fas fa-hourglass-half mr-1"></i>Warte...</span>';
                }

                const modHtml = r.stat ? `<span class="bg-slate-800 text-slate-300 px-1 py-0.5 rounded text-[9px] ml-1 font-mono align-middle border border-slate-600/50">${r.stat} ${r.mod >= 0 ? '+' + r.mod : r.mod}</span>` : '';
                const ownHighlight = isClient && myChar && r.name === myChar.name ? 'border-cyan-700/50' : 'border-slate-700';

                html += `<div class="flex justify-between items-center bg-slate-900/80 border ${ownHighlight} p-2.5 rounded-lg shadow-sm">
                    <div class="text-[11px] leading-tight"><span class="text-amber-400 font-bold text-xs">${r.name}</span> <span class="text-[10px] ${textClass} font-mono font-bold">[${dt}]</span>${modHtml}<br><span class="text-slate-300 block mt-1">${r.desc} <span class="text-slate-500 ml-1 font-mono">(DC ${r.dc})</span></span></div>
                    <div>${status}</div>
                </div>`;
            });
            html += '</div>';

            if (State.pendingRolls.some(r => !r.rolled)) {
                if (!isClient) {
                    html += '<button id="btn-roll-all" data-action="roll-all" class="mt-3 w-full bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 py-2 rounded text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm"><i class="fas fa-dice mr-1"></i> Alle automatisch auswuerfeln</button>';
                }
            } else if (!isClient) {
                html += '<p class="mt-3 text-center text-[10px] text-emerald-300 animate-pulse"><i class="fas fa-wand-sparkles mr-1"></i>Alle Wuerfe liegen vor. Die Probe wird automatisch ausgewertet...</p>';
            } else {
                html += '<p class="mt-3 text-center text-[10px] text-amber-400 animate-pulse"><i class="fas fa-hourglass-half mr-1"></i>Warte auf den Host...</p>';
            }

            DOM.actionBoxContainer.innerHTML = sanitize(html);
        } else if (State.routeChoices.length > 0) {
            DOM.actionBoxContainer.classList.remove('hidden');
            DOM.playerInput.disabled = false;
            DOM.sendBtn.disabled = false;
            DOM.playerInput.placeholder = 'Waehle einen Weg oder beschreibe eine eigene Aktion...';

            const routeButtons = State.routeChoices.map(route =>
                `<button data-action="choose-route" data-route="${route.replace(/"/g, '&quot;')}" class="w-full bg-slate-800/80 hover:bg-slate-700 py-3 rounded-lg font-bold text-xs border border-slate-600 shadow-sm transition-colors text-slate-300 hover:text-white flex items-center justify-center gap-2 mb-2"><i class="fas fa-door-open text-slate-400"></i> Route waehlen: ${route}</button>`
            ).join('');
            DOM.actionBoxContainer.innerHTML = sanitize(`<h3 class="text-slate-300 text-[10px] font-bold uppercase mb-2 tracking-widest flex items-center gap-2"><i class="fas fa-compass"></i> Verfuegbare Wege</h3>${routeButtons}`);
        } else {
            DOM.actionBoxContainer.classList.add('hidden');
            DOM.playerInput.disabled = false;
            DOM.sendBtn.disabled = false;
            DOM.playerInput.placeholder = 'Was tut ihr?';
        }
    },
    _chatScrollRaf: null,
    scrollChatToBottom: function () {
        if (!DOM.storyLog) return;
        if (this._chatScrollRaf) cancelAnimationFrame(this._chatScrollRaf);
        this._chatScrollRaf = requestAnimationFrame(() => {
            DOM.storyLog.scrollTo({ top: DOM.storyLog.scrollHeight, behavior: 'auto' });
            this._chatScrollRaf = null;
        });
    },
    _insertChatRow: function (row, createdAt) {
        if (!DOM.storyLog) return;
        const rows = Array.from(DOM.storyLog.querySelectorAll('[data-chat-id]'));
        const nextRow = rows.find(node => Number(node.dataset.createdAt || 0) > Number(createdAt || 0));
        if (nextRow) DOM.storyLog.insertBefore(row, nextRow);
        else DOM.storyLog.appendChild(row);
    },

    rebuildChatLog: function () {
        Array.from(DOM.storyLog.children).forEach(child => {
            if (child.id !== 'lobby-view') child.remove();
        });
        (State.chatMessages || []).forEach(entry => this.addChatLog(entry, null, { persist: false, deferScroll: true }));
        this.scrollChatToBottom();
    },
    syncChatLogFromState: function () {
        const entries = [...(State.chatMessages || [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        let added = false;
        entries.forEach(entry => {
            if (!DOM.storyLog.querySelector('[data-chat-id="' + entry.id + '"]')) {
                this.addChatLog(entry, null, { persist: false, deferScroll: true });
                added = true;
            }
        });
        if (added) this.scrollChatToBottom();
    },
    updateSelfControlButton: function () {
        const button = document.getElementById('self-control-toggle');
        if (!button) return;
        const network = window.App?.Network;
        const playerName = String(network?.playerName || State.localPlayerName || '').trim();
        const shouldShow = !!playerName && (State.sessionPhase === 'pregame' || State.sessionPhase === 'in_game' || !!State._mpRole);
        button.classList.toggle('hidden', !shouldShow);
        if (!shouldShow) return;
        const mode = network?.getPlayerControlMode ? network.getPlayerControlMode(playerName) : (State.playerControlMode?.[playerName] || 'human');
        button.innerHTML = '<i class="fas fa-user-astronaut ' + (mode === 'ai' ? 'text-cyan-300' : 'text-emerald-400') + '"></i> Ich: ' + (mode === 'ai' ? 'KI' : 'Human');
        button.classList.toggle('border-cyan-500/50', mode === 'ai');
        button.classList.toggle('text-cyan-100', mode === 'ai');
    },
    updateMusicControls: function () {
        const button = DOM.musicToggle;
        const modal = DOM.musicModal;
        const trackLabel = DOM.musicTrackLabel;
        const volumeSlider = DOM.musicVolumeSlider;
        const volumeValue = DOM.musicVolumeValue;
        const powerButton = DOM.musicPowerBtn;
        const enabled = !!State.musicEnabled;
        const playing = !!State.musicIsPlaying;
        const volumePercent = Math.round((Number(State.musicVolume) || 0) * 100);
        if (button) {
            button.innerHTML = '<i class="fas ' + (enabled ? 'fa-music text-pink-300' : 'fa-music text-slate-500') + '"></i> Musik';
            button.classList.toggle('border-pink-500/50', enabled);
            button.classList.toggle('text-white', enabled);
            button.classList.toggle('bg-pink-900/20', enabled);
            button.setAttribute('title', enabled ? 'Musiksteuerung oeffnen' : 'Musik einschalten');
        }
        if (trackLabel) trackLabel.textContent = playing ? (State.currentMusicTrack || 'Playlist laeuft') : (enabled ? 'Bereit zum Abspielen' : 'Musik ist aus');
        if (volumeSlider) volumeSlider.value = String(volumePercent);
        if (volumeValue) volumeValue.textContent = volumePercent + '%';
        if (powerButton) {
            powerButton.innerHTML = enabled ? '<i class="fas fa-pause mr-2"></i>Musik aus' : '<i class="fas fa-play mr-2"></i>Musik an';
            powerButton.className = 'w-full rounded-xl border px-3 py-2 text-xs font-bold transition-all ' + (enabled
                ? 'bg-pink-600/80 hover:bg-pink-500 border-pink-400/60 text-white shadow-[0_0_18px_rgba(236,72,153,0.35)]'
                : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-200');
        }
        if (modal) modal.dataset.musicEnabled = enabled ? 'true' : 'false';
    },

    showMusicSettings: function () {
        this.updateMusicControls();
        DOM.musicModal?.classList.remove('hidden');
    },

    updateTargetModeButton: function () {
        const button = document.getElementById('target-mode-btn');
        if (!button) return;
        const active = !!State.targetMapMode;
        button.classList.toggle('border-amber-500/50', active);
        button.classList.toggle('text-white', active);
        button.classList.toggle('bg-amber-900/30', active);
        const icon = button.querySelector('i');
        if (icon) {
            icon.classList.toggle('text-amber-400', active);
            icon.classList.toggle('text-slate-500', !active);
        }
    },
    buildHostInventoryOverview: function () {
        const heroes = State.party.filter(c => !c.isSummon);
        if (heroes.length === 0) {
            return '<div class="text-[10px] text-slate-500 italic">Noch keine Helden vorhanden.</div>';
        }
        return heroes.map(c => {
            const equipment = (c.equipment || []).length
                ? (c.equipment || []).map(it => `<li class="text-[10px] text-indigo-200 truncate">${it}</li>`).join('')
                : '<li class="text-[10px] text-slate-500 italic">Keine Ausruestung</li>';
            const inventory = (c.inventory || []).length
                ? (c.inventory || []).map(it => `<li class="text-[10px] text-slate-300 truncate">${it}</li>`).join('')
                : '<li class="text-[10px] text-slate-500 italic">Leer</li>';
            return `<div class="rounded-xl border border-slate-700/50 bg-black/20 p-3">
                <div class="flex items-center justify-between gap-2">
                    <button data-action="show-details" data-char-id="${c.id}" class="text-left text-amber-300 font-bold text-xs hover:text-amber-200 transition-colors">${c.name}</button>
                    <span class="text-[9px] text-slate-500">${c.class || 'Held'}</span>
                </div>
                <div class="mt-2 grid grid-cols-2 gap-3">
                    <div>
                        <div class="text-[9px] uppercase tracking-wider text-indigo-300 mb-1">Ausruestung</div>
                        <ul class="space-y-1">${equipment}</ul>
                    </div>
                    <div>
                        <div class="text-[9px] uppercase tracking-wider text-slate-400 mb-1">Inventar</div>
                        <ul class="space-y-1 max-h-28 overflow-y-auto custom-scrollbar">${inventory}</ul>
                    </div>
                </div>
            </div>`;
        }).join('');
    },
    getRollEntity: function (name) {
        return Utils.findTarget(State.party, name) || Utils.findTarget(State.activeEnemies, name) || Utils.findTarget(State.defeatedEnemies, name);
    },
    getRollPortraitMarkup: function (name) {
        const entity = this.getRollEntity(name);
        if (entity?.portrait) return `<img src="${entity.portrait}" alt="${name}" class="w-full h-full object-cover">`;
        if (entity?.isSummon) return '<i class="fas fa-hat-wizard"></i>';
        if (entity && entity.class) return '<i class="fas fa-user"></i>';
        if (entity) return '<i class="fas fa-skull"></i>';
        return '<i class="fas fa-dice-d20"></i>';
    },
    pushDiceFeedEntry: function (entry) {
        if (!entry || !entry.name) return;
        State.recentRolls = Array.isArray(State.recentRolls) ? State.recentRolls : [];
        const normalized = {
            id: entry.id || `${entry.name}-${Date.now()}`,
            name: repairDisplayText(entry.name),
            reason: repairDisplayText(entry.reason || 'Probe'),
            diceType: repairDisplayText(entry.diceType || 'W20'),
            rawRoll: entry.rawRoll ?? null,
            modifier: entry.modifier || 0,
            result: entry.result ?? null,
            targetDC: entry.targetDC ?? null,
            success: entry.result != null && entry.targetDC != null ? entry.result >= entry.targetDC : null,
            createdAt: entry.createdAt || Date.now(),
        };
        const idx = State.recentRolls.findIndex(r => r.id === normalized.id);
        if (idx >= 0) State.recentRolls[idx] = { ...State.recentRolls[idx], ...normalized };
        else State.recentRolls.unshift(normalized);
        State.recentRolls = State.recentRolls.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 8);
        this.renderDiceFeed();
    },
    renderDiceFeed: function () {
        if (!DOM.dynamicRollContainer) return;
        const rolls = Array.isArray(State.recentRolls) ? State.recentRolls : [];
        if (!rolls.length) {
            this._setHtmlIfChanged(DOM.dynamicRollContainer, '<div class="dice-feed-empty">Noch keine Wuerfe in dieser Szene.</div>');
            return;
        }

        const diceFeedHtml = sanitize(rolls.map(roll => {
            const successClass = roll.success === null ? 'border-slate-700/70 is-rolling' : (roll.success ? 'border-emerald-500/40' : 'border-rose-500/40');
            const resultClass = roll.success === null ? 'text-slate-300' : (roll.success ? 'text-emerald-300' : 'text-rose-300');
            const modifierText = roll.modifier ? `${roll.modifier >= 0 ? '+' : ''}${roll.modifier}` : '+0';
            const dcText = roll.targetDC != null ? `DC ${roll.targetDC}` : 'Freier Wurf';
            const statusText = roll.success === null ? 'Laeuft' : (roll.success ? 'Erfolg' : 'Fehlschlag');
            return `<article class="dice-feed-card ${successClass}">
                <div class="dice-feed-avatar">${this.getRollPortraitMarkup(roll.name)}</div>
                <div class="dice-feed-body min-w-0 flex-1">
                    <div class="dice-feed-main min-w-0">
                        <div class="dice-feed-name truncate">${roll.name}</div>
                        <div class="dice-feed-reason">${roll.reason}</div>
                        <div class="dice-feed-meta">
                            <span class="dice-feed-die">${roll.diceType}</span>
                            <span class="dice-feed-roll">Wurf ${roll.rawRoll ?? '-'} ${modifierText}</span>
                        </div>
                    </div>
                    <div class="dice-feed-outcome">
                        <div class="dice-feed-dc">${dcText}</div>
                        <div class="dice-feed-result ${resultClass}">${roll.result ?? '-'}</div>
                        <div class="dice-feed-status ${roll.success === null ? 'dice-feed-status-rolling' : ''} ${resultClass}">${statusText}</div>
                    </div>
                </div>
            </article>`;
        }).join(''));
        this._setHtmlIfChanged(DOM.dynamicRollContainer, diceFeedHtml);
    },
    renderSystemLog: function () {
        if (!DOM.systemContent) return;
        const entries = Array.isArray(State.systemMessages) ? State.systemMessages : [];
        if (!entries.length) {
            this._setHtmlIfChanged(DOM.systemContent, '<p class="system-feed-empty">Noch keine Systemmeldungen.</p>');
            return;
        }
        const systemHtml = sanitize([...entries].reverse().map(entry => {
            const tone = entry.tone || 'neutral';
            const content = sanitize(repairHtmlText(String(entry.text || '').replace(/\n/g, '<br>')));
            return `<article class="system-feed-item system-feed-${tone}">
                <div class="system-feed-meta">
                    <span class="system-feed-sender">${repairDisplayText(entry.sender || 'System')}</span>
                    <span class="system-feed-time">${repairDisplayText(entry.timestamp || '')}</span>
                </div>
                <div class="system-feed-text">${content}</div>
            </article>`;
        }).join(''));
        this._setHtmlIfChanged(DOM.systemContent, systemHtml);
    },
    _appendSystemMessage: function (sender, text, tone = 'neutral', options = {}) {
        State.systemMessages = Array.isArray(State.systemMessages) ? State.systemMessages : [];
        if (options.persist !== false) {
            State.systemMessages.push({
                sender,
                text,
                tone,
                timestamp: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
            });
            if (State.systemMessages.length > 120) State.systemMessages.shift();
        }
        this.renderSystemLog();
    },

    _formatDmText: function (html) {
        let content = String(html || '').trim();
        if (!content) return content;

        content = content.replace(/(<div class="mt-3">[\s\S]*<\/div>)$/i, '<div class="dm-suggestions-wrap">$1</div>');
        const parts = content.split(/<div class="dm-suggestions-wrap">/i);
        let narrative = parts[0] || '';
        const suggestions = parts[1] ? '<div class="dm-suggestions-wrap">' + parts[1] : '';

        narrative = narrative
            .replace(/(?:<br>\s*){3,}/g, '<br><br>')
            .replace(/([^>])<br><br>/g, '$1</p><p class="dm-copy-block">')
            .replace(/^/, '<p class="dm-copy-block">')
            .replace(/$/, '</p>')
            .replace(/<p class="dm-copy-block">\s*<\/p>/g, '')
            .replace(/<p class="dm-copy-block">(.*?\?)<\/p>/g, '<p class="dm-copy-block dm-question-line">$1</p>');

        return narrative + suggestions;
    },

    _formatChatHtml: function (text, isDm = false) {
        let formattedText = repairDisplayText(text || '');
        formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-amber-300">$1</strong>');
        formattedText = formattedText.replace(/\*(.*?)\*/g, '<em class="text-slate-300">$1</em>');
        formattedText = formattedText.replace(/\n/g, '<br>');
        return isDm ? sanitize(this._formatDmText(formattedText)) : sanitize(formattedText);
    },

    addChatLog: function (s, t, options = {}) {
        const incoming = typeof s === 'object' && s !== null ? s : null;
        const sender = repairDisplayText(incoming ? (incoming.sender || 'Unbekannt') : (s || ''));
        const textValue = repairDisplayText(incoming ? (incoming.text || '') : (t || ''));
        const entryType = incoming?.senderType || (sender === 'DM' || sender.includes('Orakel') || sender.includes('Schicksal') ? 'dm' : ((sender.includes('System') || sender.includes('Wetter')) ? 'system' : 'player'));
        const entry = {
            id: incoming?.id || options.id || Utils.generateId(entryType === 'system' ? 'sys' : 'msg'),
            sender,
            text: textValue,
            senderType: entryType,
            isAiControlled: !!incoming?.isAiControlled,
            tone: incoming?.tone || options.tone || 'neutral',
            timestamp: incoming?.timestamp || new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
            createdAt: incoming?.createdAt || Date.now(),
            relatedPlayer: repairDisplayText(incoming?.relatedPlayer || options.relatedPlayer || ''),
            relatedCharacter: repairDisplayText(incoming?.relatedCharacter || options.relatedCharacter || ''),
        };
        const persist = options.persist !== false;

        if (persist) {
            dispatch({ type: entryType === 'system' ? 'ADD_SYSTEM_MSG' : 'ADD_CHAT_MSG', entry });
        }

        if (entryType === 'system') {
            this.renderSystemLog();
            return;
        }

        if (DOM.storyLog.querySelector('[data-chat-id="' + entry.id + '"]')) return;

        const row = document.createElement('article');
        row.dataset.chatId = entry.id;
        row.className = 'tts-msg chat-message-glide chat-row ' + (entry.senderType === 'dm' ? 'chat-row-dm' : 'chat-row-player');
        row.dataset.createdAt = String(entry.createdAt || Date.now());
        const speaker = entry.isAiControlled ? entry.sender + ' <span class="chat-ai-badge">AI</span>' : entry.sender;
        if (entry.senderType === 'dm') {
            const ttsBtn = '<button class="tts-btn" title="Vorlesen" data-action="tts-speak"><i class="fas fa-volume-up"></i></button>';
            const relation = entry.relatedPlayer ? '<div class="chat-turn-label">Zug von ' + entry.relatedPlayer + '</div>' : '';
            row.innerHTML = sanitize('<div class="dm-message-card chat-bubble chat-bubble-dm"><div class="chat-meta-row"><span class="chat-sender chat-sender-dm">' + speaker + '</span><span class="chat-time">' + entry.timestamp + '</span>' + ttsBtn + '</div>' + relation + '<div class="tts-text dm-copy text-sm md:text-base leading-relaxed text-slate-200">' + this._formatChatHtml(entry.text, true) + '</div></div>');
        } else {
            const mine = window.App?.Network?.playerName && entry.sender === window.App.Network.playerName ? ' chat-bubble-self' : '';
            row.innerHTML = sanitize('<div class="chat-bubble chat-bubble-player' + mine + '"><div class="chat-meta-row"><span class="chat-sender">' + speaker + '</span><span class="chat-time">' + entry.timestamp + '</span></div><div class="tts-text text-sm leading-relaxed text-slate-200">' + this._formatChatHtml(entry.text, false) + '</div></div>');
        }
        this._insertChatRow(row, entry.createdAt);
        if (!options.deferScroll) this.scrollChatToBottom();
    },
    renderLobbyView: function () {
        if (!DOM.lobbyView) return;
        if (State.gameStarted || State.sessionPhase === 'in_game') return;
        const phase = State.sessionPhase || 'start';
        const html = phase === 'pregame' ? this._buildPregameLobbyHtml() : this._buildEntryScreenHtml();
        const nextHtml = sanitize(html);
        this._setHtmlIfChanged(DOM.lobbyView, nextHtml);
    },

    _buildEntryScreenHtml: function () {
        const roomCode = repairDisplayText(State.pendingRoomCode || '');
        const provider = repairDisplayText(State.selectedApiProvider || 'gemini');
        const providerLabels = { gemini: 'Google Gemini', chatgpt: 'OpenAI ChatGPT', claude: 'Anthropic Claude', openrouter: 'OpenRouter' };
        const pendingModelText = repairDisplayText(State.pendingApiModelText || API.getOrModelText() || 'arcee-ai/trinity-large-preview:free');
        const providerIcons = { gemini: 'fa-wand-magic-sparkles', chatgpt: 'fa-robot', claude: 'fa-brain', openrouter: 'fa-route' };
        const providerButtons = ['gemini', 'chatgpt', 'claude', 'openrouter'].map(key => {
            const active = key === provider ? ' is-active' : '';
            return `<button type="button" data-action="entry-select-provider" data-provider="${key}" class="entry-provider-card${active}"><i class="fas ${providerIcons[key]}"></i><span>${providerLabels[key]}</span></button>`;
        }).join('');
        const apiOverlay = State.sessionPhase === 'api_gate' ? `
            <div class="entry-modal-backdrop">
                <div class="entry-modal">
                    <button type="button" data-action="entry-back" class="entry-modal-close"><i class="fas fa-times"></i></button>
                    <div class="entry-modal-title"><i class="fas fa-key"></i> API Key</div>
                    <p class="entry-modal-copy">Waehle deinen KI-Anbieter und gib den API-Key ein, um loszuspielen.</p>
                    <div class="entry-provider-grid">${providerButtons}</div>
                    <label class="entry-label" for="start-api-key-input">API Key</label>
                    <input id="start-api-key-input" class="entry-input" type="password" placeholder="${providerLabels[provider] || 'API'} Key" value="${repairDisplayText(State.pendingApiKeyValue || '')}">
                    ${provider === 'openrouter' ? `<label class="entry-label" for="start-api-model-input">OpenRouter Modell</label><input id="start-api-model-input" class="entry-input" type="text" placeholder="arcee-ai/trinity-large-preview:free" value="${pendingModelText}">` : ''}
                    <button type="button" data-action="entry-confirm-api" class="entry-primary-btn entry-confirm-btn"><i class="fas fa-check-square"></i> Bestaetigen & Starten</button>
                    <p class="entry-modal-hint">Dein Key wird nur lokal im Browser gespeichert.</p>
                </div>
            </div>` : '';
        return `
            <div class="entry-shell">
                <div class="entry-card">
                    <img src="infinite%20dungeons.png" alt="Infinite Dungeons" class="entry-logo-image">
                    <div class="entry-cta-stack">
                        <button type="button" data-action="entry-start-solo" class="entry-primary-btn"><i class="fas fa-gamepad"></i> Solo spielen</button>
                        <button type="button" data-action="entry-start-host" class="entry-secondary-btn"><i class="fas fa-house"></i> Raum erstellen (Host)</button>
                    </div>
                    <div class="entry-join-card">
                        <div class="entry-join-copy">oder einem Raum beitreten:</div>
                        <div class="entry-join-row">
                            <input id="entry-room-code" class="entry-input entry-room-input" type="text" maxlength="6" placeholder="RAUMCODE" value="${roomCode}">
                            <button type="button" data-action="entry-join-room" class="entry-join-btn"><i class="fas fa-globe"></i> Beitreten</button>
                        </div>
                    </div>
                    <p class="entry-footnote">Als Client brauchst du keinen API-Key - Anfragen laufen ueber den Host.</p>
                </div>
                ${apiOverlay}
            </div>`;
    },

    _buildPregameLobbyHtml: function () {
        const players = window.App?.Engine?.getPregameStatus?.().players || (window.App?.Network?.isConnected?.() ? (window.App.Network.turnOrder.length ? window.App.Network.turnOrder : [window.App.Network.playerName]).filter(Boolean) : [State.localPlayerName].filter(Boolean));
        const localPlayerKey = String(State.localPlayerName || window.App?.Network?.playerName || '').trim();
        const localProfile = State.playerProfiles?.[localPlayerKey] || null;
        const localHero = localProfile?.heroId ? State.party.find(p => p.id === localProfile.heroId) : null;
        const isConnected = window.App?.Network?.isConnected?.();
        const isHost = window.App?.Network?.isHost?.();
        const roomCode = repairDisplayText(window.App?.Network?.roomCode || '');
        const canStart = window.App?.Engine?.getPregameStatus?.().ok;
        const isSolo = !isConnected;

        const rows = players.map(playerName => {
            const profile = State.playerProfiles?.[playerName] || {};
            const controlMode = profile.controlMode || State.playerControlMode?.[playerName] || 'human';
            const displayName = repairDisplayText(window.App?.Network?.getDisplayPlayerName?.(playerName, 'Ein Held') || playerName);
            const isMe = playerName === localPlayerKey;
            const initial = displayName.charAt(0).toUpperCase();
            return `<div class="pg2-player-row${isMe ? ' is-me' : ''}">
                <div class="pg2-avatar">${initial}</div>
                <div class="pg2-player-info">
                    <div class="pg2-player-name">${displayName}${isMe ? ' <span class="pg2-me-badge">Du</span>' : ''}</div>
                    <div class="pg2-player-hero">${repairDisplayText(profile.heroName || 'Noch kein Held')}</div>
                </div>
                <div class="pg2-player-status">
                    <span class="pg2-flag ${profile.isReady ? 'is-ready' : 'is-waiting'}">${profile.isReady ? '<i class="fas fa-check"></i> Bereit' : '<i class="fas fa-clock"></i> Wartet'}</span>
                    ${controlMode === 'ai' ? '<span class="pg2-flag is-ai">AI</span>' : ''}
                </div>
            </div>`;
        }).join('');

        let sessionChip = '';
        if (isConnected && isHost) {
            sessionChip = `<div class="pg2-room-chip"><i class="fas fa-crown"></i> Host &nbsp;·&nbsp; Code: <span class="pg2-room-code">${roomCode}</span></div>`;
        } else if (isConnected) {
            sessionChip = `<div class="pg2-room-chip"><i class="fas fa-link"></i> Verbunden &nbsp;·&nbsp; Raum: <span class="pg2-room-code">${roomCode}</span></div>`;
        } else {
            sessionChip = `<div class="pg2-room-chip pg2-room-chip-solo"><i class="fas fa-user"></i> Solo-Sitzung</div>`;
        }

        const heroHp = localHero ? `${localHero.hp ?? localHero.maxHp ?? '?'}/${localHero.maxHp ?? '?'}` : null;
        const heroLevel = localHero?.level ?? null;

        const heroSection = localHero ? `
            <div class="pg2-hero-card">
                <div class="pg2-hero-avatar"><i class="fas fa-shield-halved"></i></div>
                <div class="pg2-hero-info">
                    <div class="pg2-hero-name">${repairDisplayText(localHero.name)}</div>
                    <div class="pg2-hero-class">${repairDisplayText(localHero.class || 'Held')}</div>
                    <div class="pg2-hero-stats">
                        ${heroLevel !== null ? `<span><i class="fas fa-star"></i> Lvl ${heroLevel}</span>` : ''}
                        ${heroHp ? `<span><i class="fas fa-heart"></i> ${heroHp} HP</span>` : ''}
                    </div>
                </div>
            </div>` : `
            <div class="pg2-hero-empty">
                <i class="fas fa-user-plus pg2-hero-empty-icon"></i>
                <p>Kein Held gewählt</p>
                <p class="pg2-hero-empty-hint">Lade einen Save oder erstelle einen neuen Helden.</p>
            </div>`;

        return `
            <div class="entry-shell">
                <div class="pg2-card${isSolo ? ' pg2-card-solo' : ''}">
                    <div class="pg2-header">
                        <span class="pg2-kicker"><i class="fas fa-map-signs"></i> Reisevorbereitung</span>
                        <h2 class="pg2-title cinzel">${isSolo ? 'Dein Held' : 'Die Gruppe sammelt sich'}</h2>
                        ${sessionChip}
                    </div>
                    <div class="${isSolo ? '' : 'pg2-grid'}">
                        ${!isSolo ? `<section class="pg2-panel">
                            <div class="pg2-panel-title"><i class="fas fa-users"></i> Spielerstatus</div>
                            <div class="pg2-player-list">${rows || '<div class="pg2-empty"><i class="fas fa-wifi"></i> Noch keine Spieler verbunden.</div>'}</div>
                        </section>` : ''}
                        <section class="pg2-panel">
                            <div class="pg2-panel-title"><i class="fas fa-shield-halved"></i> Dein Held</div>
                            ${heroSection}
                            <div class="pg2-action-row">
                                <button type="button" data-action="pregame-load-hero" class="pg2-ghost-btn"><i class="fas fa-file-import"></i> Laden</button>
                                <button type="button" data-action="pregame-create-hero" class="pg2-ghost-btn"><i class="fas fa-plus"></i> Erstellen</button>
                            </div>
                            ${!isSolo ? `<button type="button" data-action="pregame-toggle-ready" class="pg2-ready-btn${localProfile?.isReady ? ' is-ready' : ''}">${localProfile?.isReady ? '<i class="fas fa-times-circle"></i> Nicht mehr bereit' : '<i class="fas fa-shield-heart"></i> Bereit melden'}</button>` : ''}
                        </section>
                    </div>
                    <div class="pg2-footer">
                        ${isHost || isSolo
                ? `<button type="button" data-action="start-game" class="pg2-start-btn${canStart ? '' : ' is-disabled'}"${canStart ? '' : ' disabled'}><i class="fas fa-dungeon"></i> Abenteuer starten</button>`
                : `<div class="pg2-wait-note"><i class="fas fa-hourglass-half"></i> Der Host startet das Abenteuer, sobald alle bereit sind.</div>`}
                    </div>
                </div>
            </div>`;
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
        const portraitFallback = c.isSummon ? '<i class="fas fa-hat-wizard"></i>' : '<i class="fas fa-user"></i>';
        const xpNeeded = Math.floor(XP_BASE * Math.pow(c.level, XP_SCALING_EXPONENT));
        const detailPortraitHtml = `
            <div class="hero-detail-header sticky top-0 z-20 rounded-xl overflow-hidden border ${c.isNPC ? (c.isSummon ? 'border-purple-600/50' : 'border-blue-600/50') : 'border-slate-600/60'} shadow-[0_10px_30px_rgba(0,0,0,0.45)] mb-3">
                <div class="hero-detail-header-media ${portraitSrc ? '' : 'hero-detail-header-fallback'}">
                    ${portraitSrc ? `<img src="${portraitSrc}" class="hero-detail-header-bg" aria-hidden="true"><img src="${portraitSrc}" class="hero-detail-header-portrait">` : `<div class="hero-detail-fallback-icon">${portraitFallback}</div>`}
                    <div class="hero-detail-header-shade"></div>
                </div>
                <div class="hero-detail-header-meta">
                    <h3 class="cinzel text-amber-300 text-sm tracking-wide">${c.name} ${sumBadge}</h3>
                    <p class="text-[10px] text-slate-200/90">${c.class} | Lvl ${c.level}</p>
                    <div class="mt-1.5 w-full bg-black/40 h-1.5 rounded-full border border-white/10 overflow-hidden"><div class="bg-gradient-to-r from-purple-500 to-indigo-400 h-full" style="width: ${Math.min(100, (c.xp / xpNeeded) * 100)}%"></div></div>
                    <p class="text-[9px] text-slate-300/80 mt-1">${c.xp}/${xpNeeded} XP</p>
                </div>
            </div>
            <div class="hero-details-stack">
        `;

        DOM.detailsContent.innerHTML = sanitize(repairHtmlText(`
            ${detailPortraitHtml}
            ${(() => {
                const abilities = PartyManager.getAbilityEntries(c).filter(entry => entry.type === 'ability');
                if (abilities.length === 0) return '<div class="mb-2 text-[9px] text-slate-500 italic">Keine Faehigkeiten erlernt</div>';
                return '<div class="mb-1"><h4 class="text-[9px] font-bold border-b border-amber-700/50 pb-1 mb-2 text-amber-400 uppercase tracking-wider"><i class="fas fa-fire mr-1"></i>Faehigkeiten</h4>' + abilities.map(entry => {
                    const cdRemaining = State.abilityCooldowns[entry.cooldownKey] || 0;
                    const onCooldown = cdRemaining > 0;
                    const safeAb = entry.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const cdBarHtml = onCooldown
                        ? `<div class="mt-1 flex items-center gap-1.5"><div class="flex-1 bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-700/50"><div class="bg-gradient-to-r from-orange-600 to-amber-500 h-full rounded-full transition-all" style="width: ${Math.min(100, cdRemaining * 20)}%"></div></div><span class="text-[8px] text-orange-400 font-mono font-bold whitespace-nowrap">${cdRemaining} Rdn</span></div>`
                        : '';
                    return `<div ${onCooldown ? '' : `data-action="use-ability" data-char-id="${c.id}" data-ability="${safeAb}"`} class="mb-2 p-1.5 ${onCooldown ? 'bg-slate-800/60 border-slate-600/50 opacity-60 cursor-not-allowed' : 'bg-amber-900/40 hover:bg-amber-800/80 border-amber-700/50 hover:border-amber-500 cursor-pointer'} border rounded text-center text-[9px] shadow-sm transition-all ${onCooldown ? '' : 'shadow-[0_0_10px_rgba(245,158,11,0.2)] hover:shadow-[0_0_15px_rgba(245,158,11,0.4)]'} group"><span class="${onCooldown ? 'text-slate-500' : 'text-amber-500'} font-bold block mb-0.5 ${onCooldown ? '' : 'group-hover:animate-pulse'}">${onCooldown ? '<i class="fas fa-hourglass-half"></i> Abklingzeit' : '<i class="fas fa-meteor"></i> Faehigkeit (Klicken)'}:</span>${entry.name}${cdBarHtml}</div>`;
                }).join('') + '</div>';
            })()}
            ${(() => {
                const itemAbilities = PartyManager.getAbilityEntries(c).filter(entry => entry.type === 'item');
                if (itemAbilities.length === 0) return '';
                return '<div class="mb-1"><h4 class="text-[9px] font-bold border-b border-teal-700/50 pb-1 mb-2 text-teal-400 uppercase tracking-wider"><i class="fas fa-shield-alt mr-1"></i>Item-Faehigkeiten</h4>' + itemAbilities.map(entry => {
                    const safeEffect = entry.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const safeSource = String(entry.source || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const cdRemaining = State.abilityCooldowns[entry.cooldownKey] || 0;
                    const onCooldown = cdRemaining > 0;
                    const cdBarHtml = onCooldown
                        ? `<div class="mt-1 flex items-center gap-1.5"><div class="flex-1 bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-700/50"><div class="bg-gradient-to-r from-orange-600 to-amber-500 h-full rounded-full transition-all" style="width: ${Math.min(100, cdRemaining * 20)}%"></div></div><span class="text-[8px] text-orange-400 font-mono font-bold whitespace-nowrap">${cdRemaining} Rdn</span></div>`
                        : '';
                    return `<div ${onCooldown ? '' : `data-action="use-ability" data-char-id="${c.id}" data-ability="${safeEffect}" data-item-ability="true" data-ability-source="${safeSource}"`} class="mb-2 p-1.5 ${onCooldown ? 'bg-slate-800/60 border-slate-600/50 opacity-60 cursor-not-allowed' : 'bg-teal-900/30 hover:bg-teal-800/50 border-teal-700/40 hover:border-teal-500 cursor-pointer'} border rounded text-center text-[9px] shadow-sm transition-all ${onCooldown ? '' : 'shadow-[0_0_10px_rgba(20,184,166,0.15)] hover:shadow-[0_0_15px_rgba(20,184,166,0.3)]'} group"><span class="${onCooldown ? 'text-slate-500' : 'text-teal-400'} font-bold block mb-0.5 ${onCooldown ? '' : 'group-hover:animate-pulse'}"><i class="fas fa-gem"></i> ${entry.source || 'Item'}:</span>${entry.name}${cdBarHtml}</div>`;
                }).join('') + '</div>';
            })()}
            ${(c.talents && c.talents.length > 0) ? `<div class="mb-3"><h4 class="text-[9px] font-bold border-b border-slate-700 pb-1 mb-2 text-emerald-400 uppercase">Spezialisierung</h4><div class="flex flex-wrap gap-1">${c.talents.map(t => `<span class="bg-emerald-900/30 border border-emerald-500/30 text-emerald-200 px-2 py-0.5 rounded text-[10px]"><i class="fas fa-leaf mr-1 opacity-70"></i>${t}</span>`).join('')}</div></div>` : ''}
            ${(c.pendingTalentPoints > 0 && TALENT_TREES[c.class]) ? `<div class="mb-3 p-2 border border-emerald-500/50 rounded bg-emerald-950/30 shadow-inner"><div class="text-[10px] text-emerald-400 font-bold mb-2 uppercase tracking-wider"><i class="fas fa-star animate-pulse mr-1"></i> Talent waehlbar!</div><div class="flex gap-1.5">` +
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
                <h4 class="text-[9px] font-bold border-b border-slate-700 pb-1 mb-2 text-indigo-300">AUSRUESTUNG</h4>
                <ul id="equipment-list-${c.id}" class="text-[10px] space-y-1.5 mb-3"></ul>
                <h4 class="text-[9px] font-bold border-b border-slate-700 pb-1 mb-2">INVENTAR</h4>
                <ul id="inventory-list-${c.id}" class="text-[10px] space-y-1.5"></ul>
                <button data-action="start-crafting" data-char-id="${c.id}" class="w-full mt-2 bg-indigo-700/40 hover:bg-indigo-600/60 border border-indigo-500/50 text-indigo-200 text-[10px] py-1.5 rounded font-bold shadow-sm transition-all"><i class="fas fa-hammer mr-1"></i> Schmiede / Verzaubern</button>
            </div>`}
            </div>`));

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
                return `<li data-action="item-click" data-char-id="${c.id}" data-item="${safeIt}" data-equipped="true" data-count="${count}" class="bg-indigo-900/30 p-1.5 rounded cursor-pointer hover:bg-indigo-800/50 border border-indigo-700/50 flex justify-between group transition-colors" ${titleAttr}><span class="text-indigo-200">${formatted.displayName} ${effectIcon} ${countHtml}</span> <i class="fas fa-hand-pointer opacity-0 group-hover:opacity-100 text-indigo-400 mt-0.5"></i></li>`;
            }).join('') || '<li class="text-slate-500 italic">Nichts ausgeruestet</li>');

            const invMap = new Map();
            c.inventory.forEach(it => { invMap.set(it, (invMap.get(it) || 0) + 1); });
            document.getElementById(`inventory-list-${c.id}`).innerHTML = sanitize(Array.from(invMap.entries()).map(([it, count]) => {
                const safeIt = it.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                const countHtml = count > 1 ? `<span class="text-amber-500 font-bold ml-1">(x${count})</span>` : '';
                const formatted = UI.formatItemDisplay(it);
                const titleAttr = formatted.hasEffects ? `title="${formatted.tooltip.replace(/"/g, '&quot;')}"` : '';
                const effectIcon = formatted.hasEffects ? `<i class="fas fa-info-circle text-amber-500/70 ml-1 text-[8px]" ${titleAttr}></i>` : '';
                return `<li data-action="item-click" data-char-id="${c.id}" data-item="${safeIt}" data-equipped="false" data-count="${count}" class="bg-slate-800/50 p-1.5 rounded cursor-pointer hover:bg-slate-700 border border-slate-700/50 flex justify-between group transition-colors" ${titleAttr}><span>${formatted.displayName} ${effectIcon} ${countHtml}</span> <i class="fas fa-hand-pointer opacity-0 group-hover:opacity-100 text-slate-400 mt-0.5"></i></li>`;
            }).join('') || '<li class="text-slate-500 italic">Leer</li>');
        }

        DOM.exportHeroBtn.dataset.action = 'export-hero';
        DOM.exportHeroBtn.dataset.charId = c.id;
    },

    openEnemyLightbox: function (enemy) {
        if (!enemy?.portrait || !DOM.enemyLightbox || !DOM.enemyLightboxImage) return;
        DOM.enemyLightboxImage.src = enemy.portrait;
        DOM.enemyLightboxImage.alt = enemy.name || 'Gegner';
        if (DOM.enemyLightboxTitle) DOM.enemyLightboxTitle.textContent = enemy.name || 'Gegner';
        DOM.enemyLightbox.classList.remove('hidden');
    },
    closeEnemyLightbox: function () {
        if (DOM.enemyLightbox) DOM.enemyLightbox.classList.add('hidden');
    },

    renderTransientEvents: function () {
        const now = Date.now();
        State.transientEvents = (State.transientEvents || []).filter(event => (event.expiresAt || 0) > now);
        let layer = document.getElementById('dice-broadcast-layer');
        if (!layer && State.transientEvents.length) {
            layer = document.createElement('div');
            layer.id = 'dice-broadcast-layer';
            layer.className = 'fixed inset-x-0 top-4 pointer-events-none z-[115] px-4 grid gap-3 content-start justify-center';
            document.body.appendChild(layer);
        }
        if (!layer) return;

        const visibleEvents = State.transientEvents.slice(-4);
        const wantedIds = new Set(visibleEvents.map(event => event.id));
        Array.from(layer.children).forEach(node => {
            if (!wantedIds.has(node.dataset.eventId)) node.remove();
        });

        visibleEvents.forEach(event => {
            const payload = event.payload || {};
            const success = payload.result == null ? null : ((payload.result || 0) >= (payload.targetDC || 0));
            const toneClass = event.type === 'loot_gain' ? 'notification-loot' : (event.type === 'turn_notice' ? 'notification-turn' : (success === false ? 'notification-fail' : 'notification-dice'));
            const html = event.type === 'loot_gain'
                ? '<div class="notification-kicker"><i class="fas fa-gem"></i> Beute</div><div class="notification-title">' + repairDisplayText(event.sender || 'Held') + '</div><div class="notification-copy">' + repairDisplayText(payload.text || 'Neue Beute erhalten.') + '</div>'
                : event.type === 'turn_notice'
                    ? '<div class="notification-kicker"><i class="fas fa-hourglass-half"></i> Zug</div><div class="notification-title">' + repairDisplayText(event.sender || 'Spieler') + '</div><div class="notification-copy">' + repairDisplayText(payload.text || '') + '</div>'
                    : '<div class="notification-kicker"><i class="fas fa-dice-d20"></i> ' + (payload.result == null ? 'Wurf laeuft' : 'Wurf') + '</div><div class="notification-title">' + repairDisplayText(payload.name || event.sender || 'Unbekannt') + '</div><div class="notification-copy">' + repairDisplayText(payload.reason || 'Probe') + '</div><div class="notification-roll"><span>' + (payload.rawRoll ?? '?') + '</span><small>' + ((payload.modifier || 0) >= 0 ? '+' : '') + (payload.modifier || 0) + '</small><strong>' + (payload.result ?? '?') + '</strong></div><div class="notification-copy">' + repairDisplayText(payload.diceType || 'W20') + ' gegen DC ' + (payload.targetDC ?? '-') + '</div>';
            let card = layer.querySelector('[data-event-id="' + event.id + '"]');
            if (!card) {
                card = document.createElement('div');
                card.dataset.eventId = event.id;
                layer.appendChild(card);
            }
            card.className = 'notification-card ' + toneClass;
            const sanitized = sanitize(html);
            if (card.innerHTML !== sanitized) card.innerHTML = sanitized;
        });

        if (!layer.children.length) layer.remove();
    },
    showTransientEvent: function (event) {
        this.renderTransientEvents();
        const timeout = Math.max(250, (event.expiresAt || (Date.now() + 5000)) - Date.now());
        setTimeout(() => this.renderTransientEvents(), timeout + 40);
    },
    handleEntityClick: function (name, entityType, entityId) {
        if (entityType === 'hero') {
            this.showDetails(entityId);
            return;
        }
        if (entityType === 'enemy') {
            this.showEnemyDetails(entityId);
        }
    },
    showEnemyDetails: function (id) {
        const enemy = State.activeEnemies.find(e => e.id === id) || State.defeatedEnemies.find(e => e.id === id);
        if (!enemy) return;
        if (enemy.portrait) this.openEnemyLightbox(enemy);
        DOM.partyList.classList.add('hidden');
        DOM.charDetails.classList.remove('hidden');
        const portrait = enemy.portrait
            ? `<img src="${enemy.portrait}" class="hero-detail-header-bg" aria-hidden="true"><img src="${enemy.portrait}" class="hero-detail-header-portrait">`
            : `<div class="hero-detail-fallback-icon">??</div>`;
        DOM.detailsContent.innerHTML = sanitize(repairHtmlText(`
            <div class="hero-detail-header sticky top-0 z-20 rounded-xl overflow-hidden border border-red-600/50 shadow-[0_10px_30px_rgba(0,0,0,0.45)] mb-3">
                <div class="hero-detail-header-media ${enemy.portrait ? '' : 'hero-detail-header-fallback'}">
                    ${portrait}
                    <div class="hero-detail-header-shade"></div>
                </div>
                <div class="hero-detail-header-meta">
                    <h3 class="cinzel text-red-300 text-sm tracking-wide">${enemy.name}</h3>
                    <p class="text-[10px] text-slate-200/90">Monster ⬢ ${enemy.hp <= 0 ? 'Besiegt' : 'Aktiv'}</p>
                    <div class="mt-1.5 w-full bg-black/40 h-1.5 rounded-full border border-white/10 overflow-hidden"><div class="bg-gradient-to-r from-red-700 to-red-400 h-full" style="width: ${Math.max(0, Math.min(100, (enemy.hp / enemy.maxHp) * 100))}%"></div></div>
                    <p class="text-[9px] text-slate-300/80 mt-1">${Math.max(0, enemy.hp)}/${enemy.maxHp} HP</p>
                </div>
            </div>
            <div class="hero-details-stack space-y-3">
                <div class="bg-slate-900/50 border border-slate-700/50 rounded-xl p-3">
                    <h4 class="text-[9px] font-bold border-b border-red-700/40 pb-1 mb-2 text-red-300 uppercase tracking-wider">Status</h4>
                    <p class="text-[11px] text-slate-300 leading-relaxed">${enemy.description || enemy.appearance || 'Keine weiteren Informationen vorhanden.'}</p>
                </div>
                <div class="bg-slate-900/50 border border-slate-700/50 rounded-xl p-3">
                    <h4 class="text-[9px] font-bold border-b border-red-700/40 pb-1 mb-2 text-red-300 uppercase tracking-wider">Kampfwerte</h4>
                    <div class="grid grid-cols-2 gap-2 text-[10px]">
                        <div class="bg-black/30 rounded-lg p-2 border border-white/5"><span class="text-slate-500 block">HP</span><span class="text-red-300 font-bold">${Math.max(0, enemy.hp)}/${enemy.maxHp}</span></div>
                        <div class="bg-black/30 rounded-lg p-2 border border-white/5"><span class="text-slate-500 block">XP</span><span class="text-amber-300 font-bold">${enemy.xp || 0}</span></div>
                        <div class="bg-black/30 rounded-lg p-2 border border-white/5 col-span-2"><span class="text-slate-500 block">Loot</span><span class="text-slate-300">${enemy.loot || 'Unbekannt'}</span></div>
                    </div>
                </div>
            </div>
        `));
        DOM.exportHeroBtn.removeAttribute('data-char-id');
        DOM.exportHeroBtn.removeAttribute('data-action');
    },
    hideDetails: function () { DOM.charDetails.classList.add('hidden'); DOM.partyList.classList.remove('hidden'); },


    showNetworkDiceAnimation: function (payload) {
        this.pushDiceFeedEntry(payload);
        const event = {
            id: 'roll-' + (payload.id || Date.now()),
            type: payload.result == null ? 'dice_start' : 'dice_result',
            sender: payload.name || 'Unbekannt',
            payload,
            expiresAt: Date.now() + (payload.result == null ? 3000 : 8000),
        };
        State.transientEvents = Array.isArray(State.transientEvents) ? State.transientEvents : [];
        const idx = State.transientEvents.findIndex(item => item.id === event.id);
        if (idx >= 0) State.transientEvents[idx] = { ...State.transientEvents[idx], ...event };
        else State.transientEvents.push(event);
        this.showTransientEvent(event);
    },
    showAnimatedDiceModal: function (name, targetDC, modifier, callback, closeAfter = true, diceType = 'W20') {
        Sound.play('dice');
        let sides = 20;
        if (diceType && diceType.toUpperCase().startsWith('W')) {
            sides = parseInt(diceType.substring(1)) || 20;
        }

        if (DOM.diceRollerPortrait) {
            const entity = Utils.findTarget(State.party, name) || Utils.findTarget(State.activeEnemies, name);
            let portraitHtml = '<i class="fas fa-user"></i>';
            if (entity) {
                if (entity.portrait) portraitHtml = `<img src="${entity.portrait}" class="w-full h-full object-cover">`;
                else if (entity.isSummon) portraitHtml = '<i class="fas fa-hat-wizard"></i>';
                else if (entity.hp !== undefined && !entity.class) portraitHtml = '<i class="fas fa-skull"></i>';
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

        DOM.diceContainer.classList.remove('scale-110');
        void DOM.diceContainer.offsetWidth; // Reflow
        DOM.diceContainer.classList.add('scale-110');

        DOM.diceQualityLabel.innerText = "Wuerfelt..."; DOM.diceQualityLabel.className = "text-xl cinzel text-slate-400 tracking-widest mb-4 animate-pulse h-8";
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
                    labelHtml = "Kritisch <i class='fas fa-star'></i>";
                    labelClass = 'text-yellow-300 animate-pulse drop-shadow-[0_0_15px_rgba(234,179,8,0.8)]';
                } else if (isBotch) {
                    labelHtml = "Patzer <i class='fas fa-skull'></i>";
                    labelClass = 'text-red-600 animate-pulse';
                } else if (isNearSuccess) {
                    labelHtml = "Knapp geschafft <i class='fas fa-crosshairs'></i>";
                    labelClass = 'text-cyan-300 drop-shadow-[0_0_10px_rgba(34,211,238,0.6)]';
                } else if (isNearMiss) {
                    labelHtml = "Fast geschafft <i class='fas fa-minus-circle'></i>";
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

        let activeName = State.actingChar;
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










