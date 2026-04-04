import { CONFIG, PRESETS, TALENT_TREES, PVP_SYSTEM_PROMPT, buildWorldSystemPrompt } from './prompts.js';
import { State, dispatch } from './state.js';
import { TTS, DOM, UIBuilders, UI } from './ui.js';
import { Weather } from './features.js';
import { Utils } from './utils.js';
import { Sound } from './sound.js';
import { API } from './api.js';
import { PartyManager } from './party.js';
import { CombatManager } from './combat.js';
import { TagParser } from './tagparser.js';
import { repairDisplayText, repairStoredText, sanitize, sanitizeStrict, validateSaveData, validateHeroData } from './sanitize.js';
import { Network } from './network.js';
import {
    EQUIPMENT_LIMIT, ABILITY_LIMIT, SUMMON_COOLDOWN,
    CHAT_HISTORY_MAX, CHAT_HISTORY_CHAR_LIMIT, CHAT_CONTEXT_CHAR_LIMIT,
    FATIGUE_MAX, CAMP_REDUCTION_WITH_FOOD, CAMP_REDUCTION_WITHOUT_FOOD,
    AUTO_SAVE_KEY, HERO_ROSTER_KEY, DEFAULT_HERO_KEY, JOURNAL_MAX_ENTRIES,
    FATE_BOSS_THRESHOLD, FATE_DARK_THRESHOLD, FATE_UNREST_THRESHOLD,
} from './constants.js';

const SYSTEM_NOTICE = {
    abilityReady: '\u2705 F\u00E4higkeiten wieder bereit:',
    specialisationLearned: '\u{1F31F}',
    oracle: '\u2728 Orakel',
    warning: '\u26A0\uFE0F',
    fate: '\u2728',
    joining: '\u23F3',
    enemyStatus: '\u2694\uFE0F **Feindstatus:**',
    settingsSaved: '\u2699\uFE0F API-Einstellungen gespeichert!',
    abilityLearned: '\u2728',
    abilityDeclined: '\u{1F4AD}',
    exportDone: '\u{1F4BE}',
};

function getDifficultyInstruction(difficulty) {
    if (difficulty === 'Einfach') return 'Gegner-Schaden 1-2, Proben-DC ~10, Belohnungen: Normales Loot';
    if (difficulty === 'Normal') return 'Gegner-Schaden 3-5, Proben-DC ~12, Belohnungen: Gutes Loot';
    if (difficulty === 'Schwer') return 'Gegner-Schaden 6-8, Proben-DC ~14, Belohnungen: Sehr gutes magisches Loot';
    return 'Gegner-Schaden 10-15, Proben-DC ~18, Belohnungen: Episches legend\u00E4res Loot';
}

export const Engine = {
    _isRollingAll: false,
    _pendingRollSubmissionQueued: false,

    _requireHost(actionName) {
        if (Network.isClient() && Network.isConnected()) {
            UI.addChatLog('System', `**${actionName}** ist nur f\u00FCr den Host verf\u00FCgbar.`);
            return true;
        }
        return false;
    },

    _getResolvedLocalPlayerName() {
        return String(Network.playerName || State.localPlayerName || '').trim();
    },

    _ensureSessionIdentity() {
        const existing = this._getResolvedLocalPlayerName();
        if (existing) return existing;
        const generated = 'slot-' + Math.random().toString(36).slice(2, 10);
        State.localPlayerName = generated;
        return generated;
    },

    _getAbilityEntry(char, abilityName, isItemAbility = false, sourceName = '') {
        if (!char || !abilityName) return null;
        const direct = PartyManager.findAbilityEntry(char, abilityName, sourceName);
        if (direct) return direct;
        return PartyManager.getAbilityEntries(char).find(entry => {
            if (entry.name !== abilityName) return false;
            if (isItemAbility) return entry.type === 'item';
            return entry.type === 'ability';
        }) || null;
    },

    _getCooldownInfo(char, abilityName, isItemAbility = false, sourceName = '') {
        const entry = this._getAbilityEntry(char, abilityName, isItemAbility, sourceName);
        if (!entry) return null;
        return {
            entry,
            key: entry.cooldownKey,
            rounds: State.abilityCooldowns[entry.cooldownKey] || 0,
        };
    },

    _findPromptCooldownConflict(char, actionText) {
        if (!char || !actionText) return null;
        const textValue = String(actionText || '');
        const normalized = textValue.toLowerCase();
        const intentHints = [' setze ', ' nutze ', ' benutze ', ' verwende ', ' wirke ', ' caste ', ' faehigkeit', 'faehigkeit:', ' item-faehigkeit', ' itemfaehigkeit'];
        const hasAbilityIntent = intentHints.some(hint => normalized.includes(hint.trim()) || normalized.includes(hint));
        if (!hasAbilityIntent && !textValue.includes('"')) return null;

        return PartyManager.getAbilityEntries(char).find(entry => {
            const rounds = State.abilityCooldowns[entry.cooldownKey] || 0;
            if (rounds <= 0) return false;
            const lowerName = String(entry.name || '').toLowerCase();
            const lowerSource = String(entry.source || '').toLowerCase();
            const mentionsQuotedName = textValue.includes('"' + entry.name + '"');
            const mentionsName = lowerName ? normalized.includes(lowerName) : false;
            const mentionsSource = lowerSource ? normalized.includes(lowerSource) : false;
            if (!mentionsQuotedName && !mentionsName && !mentionsSource) return false;
            if (mentionsQuotedName) return true;
            return hasAbilityIntent;
        }) || null;
    },

    _addCooldownBlockedDmMessage(char, entry, roundsLeft) {
        if (!entry || !roundsLeft) return;
        const sourceLabel = entry.type === 'item' && entry.source ? entry.source + ': ' : '';
        const label = sourceLabel + entry.name;
        const relatedPlayer = char?.name || this._getActiveDmContext().relatedPlayer || '';
        UI.addChatLog({
            id: 'cooldown-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            sender: 'DM',
            senderType: 'dm',
            text: 'Die Macht von **' + label + '** ist noch nicht wieder bereit. Warte noch **' + roundsLeft + '** Runden, oder greife zu einer anderen Taktik.',
            createdAt: Date.now(),
            relatedPlayer,
            relatedCharacter: char?.name || '',
        }, null, { persist: true });
    },
    _getActiveDmContext() {
        // Only use an explicitly set player name — never fall back to turnOrder[currentTurnIndex]
        // which is unreliable at async boundaries and causes wrong "Zug von …" labels.
        const activePlayer = Network.isConnected()
            ? (Network._currentActionPlayerName || '')
            : this._getResolvedLocalPlayerName();
        const actingValue = String(State.actingChar || '').trim();
        const actingName = actingValue && actingValue !== 'party' ? actingValue : '';
        return {
            relatedPlayer: Network.getDisplayPlayerName(activePlayer || '', ''),
            relatedCharacter: actingName || ''
        };
    },

    _syncLocalProfile(updates = {}) {
        const name = updates.name || this._getResolvedLocalPlayerName();
        if (!name) return null;
        State.playerProfiles = State.playerProfiles || {};
        const existing = State.playerProfiles[name] || {};
        const next = {
            name,
            heroId: existing.heroId || null,
            heroName: existing.heroName || '',
            isReady: !!existing.isReady,
            controlMode: Network.getPlayerControlMode ? Network.getPlayerControlMode(name) : (existing.controlMode || 'human'),
            ...existing,
            ...updates,
        };
        State.playerProfiles[name] = next;
        return next;
    },

    _enterPregame(mode) {
        State.entryMode = mode;
        State.sessionPhase = 'pregame';
        State.pendingApiMode = null;
        this._syncLocalProfile({ isReady: false });

        // Standard-Held vorladen wenn noch kein Held ausgewählt
        const localKey = this._getResolvedLocalPlayerName();
        if (!State.playerProfiles?.[localKey]?.heroId) {
            this.loadDefaultHero();
        }

        UI.toggleViews(false);
        UI.updateAll();
    },

    beginSessionFlow(mode) {
        const name = this._ensureSessionIdentity();
        const error = Network.validatePlayerName(name);
        if (error) {
            UI.addChatLog('System', error);
            return;
        }

        State.localPlayerName = name;
        this._syncLocalProfile({ name, isReady: false });

        if (mode === 'join') {
            const roomCode = String(document.getElementById('entry-room-code')?.value || State.pendingRoomCode || '').trim().toUpperCase();
            if (!roomCode) {
                UI.addChatLog('System', 'Bitte gib einen Raumcode ein.');
                return;
            }
            State.pendingRoomCode = roomCode;
            State.entryMode = 'join';
            State.sessionPhase = 'pregame';
            Network.join(roomCode, name);
            UI.toggleViews(false);
            UI.updateAll();
            return;
        }

        State.pendingApiMode = mode;
        State.selectedApiProvider = State.selectedApiProvider || API.getProvider();
        State.pendingApiKeyValue = API.getKey(State.selectedApiProvider) || State.pendingApiKeyValue || '';
        State.pendingApiModelText = State.selectedApiProvider === 'openrouter' ? (API.getOrModelText() || State.pendingApiModelText || 'arcee-ai/trinity-large-preview:free') : '';
        State.sessionPhase = 'api_gate';
        UI.updateAll();
    },

    selectStartApiProvider(provider) {
        if (!provider) return;
        State.selectedApiProvider = provider;
        State.pendingApiKeyValue = API.getKey(provider) || '';
        State.pendingApiModelText = provider === 'openrouter' ? (API.getOrModelText() || 'arcee-ai/trinity-large-preview:free') : '';
        UI.updateAll();
    },

    confirmApiGate() {
        const provider = State.selectedApiProvider || API.getProvider();
        const key = String(document.getElementById('start-api-key-input')?.value || State.pendingApiKeyValue || '').trim();
        if (!provider) {
            UI.addChatLog('System', 'Bitte waehle zuerst einen KI-Anbieter.');
            return;
        }
        if (!key) {
            UI.addChatLog('System', 'Bitte gib zuerst einen API-Key ein.');
            return;
        }

        const modelText = provider === 'openrouter' ? String(document.getElementById('start-api-model-input')?.value || State.pendingApiModelText || '').trim() : '';
        if (provider === 'openrouter' && !modelText) {
            UI.addChatLog('System', 'Bitte gib fuer OpenRouter ein Modell an.');
            return;
        }

        State.selectedApiProvider = provider;
        State.pendingApiKeyValue = key;
        State.pendingApiModelText = modelText;
        Utils.safeStorageSet('api_provider', provider);
        Utils.safeStorageSet('api_key_' + provider, key);
        if (provider === 'openrouter') Utils.safeStorageSet('api_model_or_text', modelText || 'arcee-ai/trinity-large-preview:free');

        const mode = State.pendingApiMode;
        if (mode === 'pvp') {
            this._enterPvPArena();
            return;
        }
        if (mode === 'host') {
            const started = Network.host(State.localPlayerName);
            if (started === false) return;
        }

        this._enterPregame(mode || 'solo');
        UI.addChatLog('System', mode === 'host' ? 'Raumvorbereitung gestartet. Waehlt jetzt eure Helden.' : 'Solo-Vorbereitung gestartet. Waehle jetzt deinen Helden.');
    },

    togglePregameReady() {
        const name = this._getResolvedLocalPlayerName();
        if (!name) {
            UI.addChatLog('System', 'Bitte starte zuerst eine Sitzung.');
            return;
        }
        const current = !!State.playerProfiles?.[name]?.isReady;
        const next = !current;
        this._syncLocalProfile({ isReady: next });
        if (Network.isClient() && Network.isConnected()) {
            Network.sendPregameReady(next);
        } else if (Network.isHost() && Network.isConnected()) {
            Network.setPregameReady(name, next);
            Network.broadcastState();
        }
        UI.updateAll();
    },

    toggleSelfControlMode() {
        const playerName = this._getResolvedLocalPlayerName();
        if (!playerName) {
            UI.addChatLog('System', 'Bitte starte zuerst eine Sitzung.');
            return;
        }
        const nextMode = Network.getPlayerControlMode(playerName) === 'ai' ? 'human' : 'ai';
        if (Network.isClient() && Network.isConnected()) {
            Network.requestSelfControlMode(nextMode);
        } else if (Network.isHost() && Network.isConnected()) {
            Network.setPlayerControlMode(playerName, nextMode);
        } else {
            State.playerControlMode = State.playerControlMode || {};
            State.playerControlMode[playerName] = nextMode;
            this._syncLocalProfile({ controlMode: nextMode });
        }
        UI.updateAll();
    },

    openHeroImport() {
        document.getElementById('import-hero')?.click();
    },

    // ── Local Hero Roster (localStorage) ──────────────────────────────────

    getHeroRoster() {
        try { return JSON.parse(Utils.safeStorageGet(HERO_ROSTER_KEY) || '[]'); } catch { return []; }
    },

    _saveCharToRoster(char) {
        if (!char || char.isNPC) return;
        try {
            const roster = this.getHeroRoster();
            const idx = roster.findIndex(h => h.id === char.id);
            if (idx >= 0) roster[idx] = { ...char };
            else roster.push({ ...char });
            Utils.safeStorageSet(HERO_ROSTER_KEY, JSON.stringify(roster));
        } catch (e) {
            console.warn('Hero roster save failed:', e);
        }
    },

    saveHeroToRoster(charId) {
        const char = State.party.find(p => p.id === charId);
        if (!char) return;
        this._saveCharToRoster(char);
        UI.showToast(`${repairDisplayText(char.name)} im Browser gespeichert.`);
    },

    loadHeroFromRoster(rosterId) {
        const hero = this.getHeroRoster().find(h => h.id === rosterId);
        if (!hero) return;
        const localKey = this._getResolvedLocalPlayerName();
        const h = Utils.sanitizeCharacter({ ...hero, id: Utils.generateId() });
        this.saveDefaultHero(h);
        if (Network.isClient() && Network.isConnected()) {
            this._syncLocalProfile({ heroId: h.id, heroName: h.name, isReady: false });
            Network.sendCharacterCreate(h);
        } else {
            // In multiplayer, replace the current hero. In solo, allow multiple.
            if (Network.isConnected()) {
                const oldHeroId = State.playerProfiles?.[localKey]?.heroId;
                if (oldHeroId) dispatch({ type: 'REMOVE_PARTY_MEMBER', charId: oldHeroId });
            }
            dispatch({ type: 'ADD_PARTY_MEMBER', character: h });
            if (Network.isHost() && Network.isConnected()) {
                Network.registerCharacter(Network.playerName, h.id);
                Network.broadcastState();
            } else {
                this._syncLocalProfile({ heroId: h.id, heroName: h.name, isReady: false });
            }
        }
        UI.updateAll();
        UI.showToast(`${repairDisplayText(h.name)} geladen!`);
    },

    deleteHeroFromRoster(rosterId) {
        const roster = this.getHeroRoster().filter(h => h.id !== rosterId);
        Utils.safeStorageSet(HERO_ROSTER_KEY, JSON.stringify(roster));
        UI.updateAll();
    },

    getDefaultHero() {
        try {
            const raw = Utils.safeStorageGet(DEFAULT_HERO_KEY);
            if (raw) return Utils.sanitizeCharacter(JSON.parse(raw));
            // Fallback: ersten Roster-Helden nehmen und als Standard speichern
            const roster = this.getHeroRoster();
            if (roster.length > 0) {
                this.saveDefaultHero(roster[0]);
                return Utils.sanitizeCharacter(roster[0]);
            }
            return null;
        } catch { return null; }
    },

    saveDefaultHero(char) {
        if (!char || char.isNPC || char.isSummon) return;
        Utils.safeStorageSet(DEFAULT_HERO_KEY, JSON.stringify(char));
    },

    loadDefaultHero() {
        const hero = this.getDefaultHero();
        if (!hero) return false;
        this._ensureSessionIdentity();
        const h = Utils.sanitizeCharacter({ ...hero, id: Utils.generateId() });
        const localKey = this._getResolvedLocalPlayerName();
        const oldHeroId = State.playerProfiles?.[localKey]?.heroId;
        if (oldHeroId) dispatch({ type: 'REMOVE_PARTY_MEMBER', charId: oldHeroId });
        dispatch({ type: 'ADD_PARTY_MEMBER', character: h });
        this._syncLocalProfile({ heroId: h.id, heroName: h.name, isReady: false });
        return true;
    },

getPregameStatus() {
        const players = Network.isConnected()
            ? (Network.turnOrder.length ? Network.turnOrder : [Network.playerName]).filter(Boolean)
            : [State.localPlayerName].filter(Boolean);
        if (!players.length) {
            return { ok: false, message: 'Bitte beginne zuerst eine Solo- oder Raum-Sitzung.' };
        }

        const isSolo = !Network.isConnected();
        for (const playerName of players) {
            const profile = State.playerProfiles?.[playerName];
            const displayName = Network.getDisplayPlayerName(playerName, 'Ein Held');
            if (!profile?.heroId) {
                return { ok: false, message: displayName + ' muss zuerst einen Helden laden oder erstellen.' };
            }
            if (!isSolo && !profile?.isReady) {
                return { ok: false, message: displayName + ' ist noch nicht bereit.' };
            }
        }

        return { ok: true, players };
    },

    _submitInventoryAction(action, payload, options = {}) {
        const { showDetailsId = null, closeModal = false } = options;
        if (closeModal) DOM.itemActionModal.classList.add('hidden');

        if (Network.isClient() && Network.isConnected()) {
            Network.sendInventoryAction(action, payload);
            UI.hideDetails();
            return true;
        }

        const result = Network._applyInventoryAction(action, payload, Network.isConnected() ? Network.playerName : null);
        if (!result?.ok) {
            if (result?.error) UI.addChatLog('System', result.error);
            return false;
        }

        const isLootAction = action === 'ASSIGN_LOOT' || action === 'COLLECT_ALL_LOOT';
        if (Network.isHost() && Network.isConnected()) {
            if (isLootAction) {
                Network.broadcastChat('Beute', result.message, { senderType: 'loot' });
            } else {
                UI.addChatLog('System', result.message);
                Network.broadcastSystemChat('System', result.message);
            }
            Network.broadcastState();
        } else {
            if (isLootAction) {
                UI.addChatLog('Beute', result.message, { senderType: 'loot' });
            } else {
                UI.addChatLog('System', result.message);
            }
        }
        UI.updateAll();
        if (showDetailsId) UI.showDetails(showDetailsId);
        return true;
    },

    _sanitizeSuggestionText(text) {
        let cleaned = repairDisplayText(String(text || ''))
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
            .replace(/\s+/g, ' ')
            .trim();

        const firstColon = cleaned.indexOf(':');
        if (firstColon !== -1) {
            const title = cleaned.slice(0, firstColon).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (title) {
                const titlePattern = new RegExp(`${title}\s*:`, 'gi');
                const matches = [...cleaned.matchAll(titlePattern)];
                if (matches.length > 1) {
                    cleaned = cleaned.slice(matches[matches.length - 1].index).trim();
                }
            }
        }

        return cleaned.replace(/^(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}\u2600-\u27BF]\s*)+/gu, '').trim();
    },
    _getSuggestionMeta(text) {
        // First strip any existing HTML tags to avoid processing `<strong class=...>`
        const strippedText = String(text || '').replace(/<[^>]+>/g, '');
        const normalized = this._sanitizeSuggestionText(strippedText);
        const lower = normalized.toLowerCase();
        let icon = '\u2022';
        if (/(angreifen|attack|schlag|hieb|sturm|treffer)/.test(lower)) icon = '\u2694\uFE0F';
        else if (/(verteid|abwehr|block|deckung|haltung)/.test(lower)) icon = '\uD83D\uDEE1\uFE0F';
        else if (/(flieh|rueckzug|entkommen)/.test(lower)) icon = '\uD83C\uDFC3';
        else if (/(untersuch|spur|such|analys|entziffer|pruef)/.test(lower)) icon = '\uD83D\uDD0D';
        else if (/(rede|frage|spreche|verhand|ueberzeug|droh)/.test(lower)) icon = '\uD83D\uDCAC';
        else if (/(zauber|magie|ritual|spruch|wirke)/.test(lower)) icon = '\u2728';
        else if (/(lager|ruhe|rast|camp)/.test(lower)) icon = '\uD83C\uDFD5';
        else if (/(beute|nehmen|sammel|pluender)/.test(lower)) icon = '\uD83C\uDF92';
        else if (/(weiter|erkund|pfad|weg|folge)/.test(lower)) icon = '\uD83E\uDDED';

        const separator = normalized.indexOf(':');
        const title = separator === -1 ? normalized : normalized.slice(0, separator).trim();
        const detail = separator === -1 ? '' : normalized.slice(separator + 1).trim();
        return {
            icon,
            prompt: normalized,
            title: title || normalized,
            detail
        };
    },
    _renderSuggestionOption(text, suggestionClass) {
        const meta = this._getSuggestionMeta(text);
        if (!meta.prompt) return '';
        // Completely strip all HTML tags (like <strong>) from the prompt data attribute
        const strippedPrompt = meta.prompt.replace(/<[^>]+>/g, '');
        const safeValue = strippedPrompt.replace(/"/g, '&quot;');
        const detailHtml = meta.detail ? `<span class="suggestion-detail">${meta.detail}</span>` : '';
        return `<div class="${suggestionClass}" data-prompt="${safeValue}"><span class="suggestion-icon" aria-hidden="true">${meta.icon}</span><span class="suggestion-copy"><span class="suggestion-title">${meta.title}</span>${detailHtml}</span></div>`;
    },
    setCustomApiKey: function () { DOM.customKeyInput.value = Utils.safeStorageGet("custom_gemini_key") || ""; DOM.apiKeyModal.classList.remove('hidden'); setTimeout(() => DOM.customKeyInput.focus(), 100); },
    saveApiKey: function () { Utils.safeStorageSet("custom_gemini_key", DOM.customKeyInput.value.trim()); DOM.apiKeyModal.classList.add('hidden'); UI.addChatLog("System", "API-Key wurde gespeichert."); },
    startGame: function () {
        if (this._requireHost('Abenteuer starten')) return;
        const status = this.getPregameStatus();
        if (!status.ok) {
            UI.addChatLog('System', status.message);
            return;
        }
        State.gameStarted = true;
        State.sessionPhase = 'in_game';
        UI.toggleViews(true);
        UI.updateAll();
        if (Network.isHost() && Network.isConnected()) Network.broadcastState();

        // Solo multi-hero support: set initial acting character
        if (!Network.isConnected() && State.party.length > 0) {
            const firstHero = State.party.find(p => !p.isNPC && !p.isSummon) || State.party[0];
            State.actingChar = firstHero.name;
        }

        this.interactWithAI('Die Reise beginnt.');
    },

    toggleSound: function () {
        State.soundEnabled = !State.soundEnabled;
        const btn = DOM.soundToggle;
        if (btn) {
            btn.innerHTML = State.soundEnabled ? '<i class="fas fa-volume-up text-indigo-300"></i>' : '<i class="fas fa-volume-mute text-slate-400"></i>';
            btn.className = `bg-slate-800/80 hover:bg-slate-700 px-3 py-2 rounded-lg text-xs font-medium border border-slate-600/50 hover:border-slate-400 shadow-[0_0_10px_rgba(0,0,0,0.3)] hover:shadow-[0_0_15px_rgba(148,163,184,0.4)] transition-all duration-300 backdrop-blur-sm ${State.soundEnabled ? 'sound-on' : 'sound-off'}`;
        }
        if (State.soundEnabled) Sound.play('dice');
    },

    toggleMusicPlayback: function () {
        Sound.toggleMusic();
        UI.updateMusicControls();
    },

    setMusicVolume: function (value) {
        Sound.setMusicVolume(value);
        UI.updateMusicControls();
    },

    _syncQuickplayBtn: function () {
        const btn = document.getElementById('quickplay-btn');
        if (!btn) return;
        if (State.quickplayEnabled) {
            btn.className = 'bg-blue-600 hover:bg-blue-500 border border-blue-400 text-white px-3.5 py-2 rounded-lg shadow-[0_0_15px_rgba(59,130,246,0.6)] transition-all duration-300 backdrop-blur-sm tracking-wide flex items-center gap-1.5 animate-pulse';
            btn.innerHTML = '<i class="fas fa-bolt text-yellow-300"></i> Quickplay (AN)';
        } else {
            btn.className = 'bg-blue-900/40 hover:bg-blue-800/60 border border-blue-700/50 hover:border-blue-400 text-blue-200 px-3.5 py-2 rounded-lg shadow-[0_0_10px_rgba(0,0,0,0.3)] hover:shadow-[0_0_15px_rgba(59,130,246,0.5)] transition-all duration-300 backdrop-blur-sm tracking-wide flex items-center gap-1.5';
            btn.innerHTML = '<i class="fas fa-forward text-blue-400/70 group-hover:text-blue-400"></i> Quickplay';
        }
    },

    toggleQuickplay: function () {
        State.quickplayEnabled = !State.quickplayEnabled;
        this._syncQuickplayBtn();
        if (State.quickplayEnabled) {
            UI.addChatLog('System', '**Quickplay aktiviert:** Der DM wird sich nun kurz fassen, um den Spielfluss zu beschleunigen.');
        } else {
            UI.addChatLog('System', '**Quickplay deaktiviert:** Der DM beschreibt die Welt wieder ausfuehrlicher.');
        }
    },

    toggleVerboseMode: function () {
        State.verboseModeEnabled = !State.verboseModeEnabled;
        UI.updateAll();
        UI.showToast(State.verboseModeEnabled ? 'Ausführliche Texte aktiviert.' : 'Ausführliche Texte deaktiviert.');
    },

    generateJournalEntry: async function () {
        if (this._requireHost('Journal-Eintrag')) return;
        if (!State.lastStoryPart || !State.gameStarted) return;
        const oldJournalBtn = document.querySelector('[data-action="gen-journal"]');
        if (oldJournalBtn) { oldJournalBtn.textContent = '...'; oldJournalBtn.disabled = true; }
        try {
            const partyNames = State.party.filter(p => !p.isSummon).map(p => p.name).join(', ');
            const summary = await API.generateText(
                `Fasse diese Szene in 1-2 Sätzen als Tagebucheintrag zusammen (Vergangenheit, dramatisch, kurz): "${State.lastStoryPart.substring(0, 500)}"`,
                "Du bist ein Chronist. Antworte NUR mit dem Tagebucheintrag, ohne Anführungszeichen oder Präambel. Deutsch, max 2 Sätze."
            );
            const entry = { text: summary, timestamp: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), party: partyNames };
            State.journal.unshift(entry);
            if (State.journal.length > JOURNAL_MAX_ENTRIES) State.journal.pop();
            UI.renderJournal();
        } catch (e) { console.error('Journal generation failed:', e); } finally {
            if (oldJournalBtn) { oldJournalBtn.textContent = 'Update'; oldJournalBtn.disabled = false; }
        }
    },

    interactWithAI: async function (actionMsg) {
        if (State.isProcessing) return;
        if (State.combatEnded) {
            State.defeatedEnemies = [];
            State.combatEnded = false;
        }

        dispatch({ type: 'SET_QUICK_OPTIONS', options: [] });
        State.isProcessing = true; UI.showLoader(true);
        State.sessionStats.turnsPlayed++;
        State.fate = (State.fate || 0) + 1;

        let readyAbilities = [];
        for (let cdKey in State.abilityCooldowns) {
            State.abilityCooldowns[cdKey]--;
            if (State.abilityCooldowns[cdKey] <= 0) {
                let parts = cdKey.split('_');
                let charId = parts[0];
                let abName = parts.slice(1).join('_');
                let ch = State.party.find(p => p.id === charId);
                if (ch) readyAbilities.push(`**${ch.name}**: ${abName}`);
                delete State.abilityCooldowns[cdKey];
            }
        }
        if (readyAbilities.length > 0) {
            UI.addChatLog('System', `${SYSTEM_NOTICE.abilityReady} ${readyAbilities.join(', ')}`);
        }

        State.isBossFight = (State.fate || 0) >= FATE_BOSS_THRESHOLD && State.activeEnemies.length > 0;

        const acting = State.actingChar;
        const enemyCtx = State.activeEnemies.length > 0 ? State.activeEnemies.map(e => `${e.name} (HP ${e.hp}/${e.maxHp})`).join(', ') : 'Keine Feinde';

        const partyCtx = State.party.map(p => {
            const eff = PartyManager.getEffectiveAttributes(p);
            const effMax = PartyManager.getEffectiveMaxHp(p);
            const specEffects = PartyManager.getItemSpecialEffects(p);
            const specStr = specEffects.length > 0 ? `, Item-Effekte: [${specEffects.join(', ')}]` : '';
            return `${p.name} (Lvl ${p.level} ${p.class}, HP: ${p.hp}/${effMax}, Stats (inkl. Item-Boni): STR ${eff.STR} DEX ${eff.DEX} INT ${eff.INT} CON ${eff.CON}, Inv: [${p.inventory.join(', ')}], Ausgerüstet: [${(p.equipment || []).join(', ')}]${specStr})`;
        }).join(' | ');

        const diff = DOM.gameDifficulty ? DOM.gameDifficulty.value : 'Normal';
        const rate = DOM.enemyRate ? DOM.enemyRate.value : 'Normal';
        const dInstr = getDifficultyInstruction(diff);
        const qpAddendum = State.quickplayEnabled
            ? " QUICKPLAY AKTIV: Antworten extrem kurz (1-2 Sätze). Du darfst auch Angriffsproben für Spieler vorschlagen."
            : " NORMALER MODUS \u2013 ANGRIFF-REGEL (ABSOLUT): Du darfst NIEMALS selbst eine Angriffs-Probe f\u00FCr einen Spieler fordern oder vorgeben wie dieser angreift. NUR Ausweichen/Blocken-Proben f\u00FCr Spieler sind erlaubt. Warte zwingend, bis der Spieler explizit schreibt dass er angreift (z.B. 'Ich greife an'). Erst dann und nur dann eine Probe fordern.";
        const verboseAddendum = (!State.quickplayEnabled && State.verboseModeEnabled)
            ? " AUSFÜHRLICHER MODUS: Beschreibe Szenen reich und detailliert (4-6 Sätze), male Atmosphäre, Gerüche, Geräusche und Emotionen aus."
            : "";

        let dungeonContext = "";
        const fate = State.fate || 0;
        if (fate >= FATE_BOSS_THRESHOLD) {
            dungeonContext = ` [WICHTIGE DM-ANWEISUNG: Ein mächtiges Schicksal hat sich erfüllt! Initiiere JETZT SOFORT einen epischen Bosskampf. Der Boss MUSS massiven Loot fallen lassen (Beute-Tag). Erwähne das Schicksal NICHT beim Namen.]`;
        } else if (fate >= FATE_DARK_THRESHOLD) {
            dungeonContext = ` [DM-HINWEIS: Eine dunkle Macht n\u00E4hert sich unaufhaltsam. Lass die Atmosph\u00E4re bedrohlicher werden \u2013 verst\u00F6rte NPCs, unheimliche Zeichen, ein Gef\u00FChl drohenden Unheils. Kein konkreter Hinweis auf den Ursprung.]`;
        } else if (fate >= FATE_UNREST_THRESHOLD) {
            dungeonContext = ` [DM-HINWEIS: Eine leichte Unruhe liegt in der Luft. Streue subtile Vorzeichen ein \u2013 ein merkw\u00FCrdiges Detail, ein Ger\u00FCcht, ein diffuses Unbehagen. Halte es unterschwellig.]`;
        }

        const pendingRollsCount = State.pendingRolls.filter(r => !r.rolled).length;
        const rollsAddendum = pendingRollsCount > 0
            ? ` [WICHTIG: Es stehen ${pendingRollsCount} Probe(n) aus. Gib KEINE Handlungsvorschläge am Ende deiner Antwort. Der Spieler muss zuerst diese Proben würfeln. Warte auf deren Ergebnisse.]`
            : "";

        const historyCtx = State.chatHistory.slice(-5).join(' | ').substring(0, CHAT_HISTORY_CHAR_LIMIT);
        const weatherCtx = Weather.getWeatherContext();
        const momentum = State.momentum || 0;
        const momentumCtx = momentum >= 3
            ? ` [HELDENMOMENTUM: Die Gruppe hat ${momentum} aufeinanderfolgende Erfolge! Beschreibe ihre nächste Aktion besonders episch oder gewähre einen kleinen narrativen Vorteil.]`
            : '';
        const goldCtx = State.gold > 0 ? ` [Gruppenkapital: ${State.gold} Goldmünzen]` : '';
        const context = `Party: ${partyCtx}. Feinde: ${enemyCtx}. Vorherige Szenen: [${historyCtx}]. Aktuelle Szene: ${State.lastStoryPart}. Aktion (${acting}): ${actionMsg}. [Regeln: Diff=${diff} (${dInstr}), Rate=${rate}]${qpAddendum}${verboseAddendum}${dungeonContext}${weatherCtx}${rollsAddendum}${momentumCtx}${goldCtx}`;

        try {
            const aiResponseJSON = await API.generateText(context, buildWorldSystemPrompt(State.worldConfig));

            // JSON parsen
            let parsedData;
            try {
                parsedData = JSON.parse(aiResponseJSON);
            } catch (err) {
                console.error("Fehler beim Parsen der KI-Antwort:", err);
                throw new Error("Konnte die Antwort der KI nicht verarbeiten.");
            }

            let cleanStory = parsedData.narrative || "Die Geschichte geht weiter...";
            State.lastStoryPart = cleanStory.substring(0, 1500);
            Weather.randomChange();
            State.chatHistory.push(cleanStory.substring(0, CHAT_CONTEXT_CHAR_LIMIT));
            if (State.chatHistory.length > CHAT_HISTORY_MAX) State.chatHistory.shift();

            // Optionen für das UI vorbereiten (jetzt im State statt im Chat-Text)
            let options = [];
            if (Array.isArray(parsedData.options) && parsedData.options.length > 0) {
                options = parsedData.options;
            }

            // Events an den TagParser/EventProcessor übergeben
            if (Array.isArray(parsedData.events)) {
                TagParser.process(parsedData.events);
            }

            const hasPendingRolls = State.pendingRolls.some(r => !r.rolled);
            if (options.length === 0 && !hasPendingRolls) {
                const inCombat = State.activeEnemies.some(e => e.hp > 0);
                const hasLoot = State.lootDrops && State.lootDrops.length > 0;
                options = inCombat
                    ? ['Angreifen', 'Verteidigen', 'Fliehen']
                    : hasLoot
                        ? ['Beute einsammeln', 'Umgebung untersuchen', 'Weiter erkunden']
                        : ['Umgebung untersuchen', 'Weiter erkunden', 'Lager aufschlagen'];
            }
            
            dispatch({ type: 'SET_QUICK_OPTIONS', options });

            // Neues HTML für den Chat zusammensetzen (nur die Geschichte)
            let cleanText = cleanStory;

            if (cleanText.length > 0) {
                const dmContext = this._getActiveDmContext();
                if (Network.isHost() && Network.isConnected()) Network.broadcastChat("DM", cleanText, dmContext);
                else UI.addChatLog({ sender: "DM", text: cleanText, senderType: 'dm', relatedPlayer: dmContext.relatedPlayer, relatedCharacter: dmContext.relatedCharacter });
            }
        } catch (e) { UI.addChatLog("System", `Fehler: ${e.message}`); }
        finally {
            CombatManager.cleanupDead();
            if (Network.isHost() && Network.isConnected() && State.lootDrops.length > 0) {
                Network.autoDistributeLoot();
            }
            try {
                const saveData = JSON.parse(JSON.stringify(State));
                saveData._autoSaveTime = new Date().toISOString();
                Utils.safeStorageSet(AUTO_SAVE_KEY, JSON.stringify(saveData));
            } catch (e) { console.warn('Auto-save failed:', e); }
            State.isProcessing = false;
            UI.showLoader(false);
            UI.updateAll();

            if (Network.isHost() && Network.isConnected()) {
                Network.broadcastState();
                Network.autoRollPending();
                const hasPendingRolls = State.pendingRolls.some(r => !r.rolled);
                if (!hasPendingRolls) {
                    if (Network.isInCombat()) {
                        Network.startNewCombatRound();
                    } else {
                        Network.advanceTurn();
                    }
                }
            } else if (!Network.isConnected() && !State.pendingRolls.some(r => !r.rolled)) {
                // Solo turn rotation
                this._soloAdvanceTurn();
            }
            Network._currentActionPlayerName = null;
        }
    },

    _soloAdvanceTurn: function () {
        if (Network.isConnected() || State.party.length <= 1) return;
        const currentHero = State.party.find(p => p.name === State.actingChar) || State.party[0];
        const currentIndex = State.party.indexOf(currentHero);
        
        // Find next non-NPC, non-Summon hero
        for (let i = 1; i <= State.party.length; i++) {
            const nextIdx = (currentIndex + i) % State.party.length;
            const nextHero = State.party[nextIdx];
            if (!nextHero.isNPC && !nextHero.isSummon) {
                State.actingChar = nextHero.name;
                break;
            }
        }
        UI.updateAll();
    },

    chooseRoute: function (route) {
        DOM.actionBoxContainer.innerHTML = ''; DOM.actionBoxContainer.classList.add('hidden');
        UI.updateAll();
        this.submitPlayerAction(`wählt den Weg: ${route}.`);
    },

    camp: function () {
        if (State.isProcessing) return;
        if (State.party.every(p => p.hp <= 0)) { UI.showToast('Deine Party ist kampfunfähig!'); return; }
        const hasProvisions = State.party.some(p =>
            p.inventory.some(it => ['ration', 'proviant', 'nahrung', 'brot', 'fleisch', 'wein', 'heiltrank', 'mahlzeit', 'vorrat'].some(food => it.toLowerCase().includes(food)))
        );
        const reduction = hasProvisions ? CAMP_REDUCTION_WITH_FOOD : CAMP_REDUCTION_WITHOUT_FOOD;
        const before = State.fatigue;
        State.fatigue = Math.max(0, State.fatigue - reduction);
        const restored = before - State.fatigue;

        let actionText = `Die Gruppe schlägt ihr Lager auf, um sich auszuruhen.`;
        if (hasProvisions) actionText += ` Dank der Vorräte erholen sie sich besonders gut.`;
        if (State.fatigue > 0) actionText += ` [Erschöpfung sinkt um ${restored} auf ${State.fatigue}]`;
        else actionText += ` [Voll erholt]`;

        UI.updateAll();
        this.submitPlayerAction(actionText);
    },

    learnTalent: function (charId, talentName) {
        const char = State.party.find(p => p.id === charId);
        if (!char || char.pendingTalentPoints <= 0) return;
        if (!char.talents) char.talents = [];
        if (char.talents.includes(talentName)) return;
        char.talents.push(talentName);
        char.pendingTalentPoints--;
        Sound.play('levelup');
        UI.addChatLog('System', `${SYSTEM_NOTICE.specialisationLearned} **${char.name}** hat die Spezialisierung **${talentName}** erlernt!`);
        UI.showDetails(charId);
        UI.updateAll();
    },

    submitPlayerAction: function (actionOverride) {
        if (State.pendingRolls.length > 0) return;
        if (Network.isConnected() && !Network.isMyTurn()) {
            UI.addChatLog('System', 'Es ist nicht dein Zug! Warte, bis du an der Reihe bist.', { tone: 'neutral' });
            return;
        }

        if (State.combatEnded) {
            State.defeatedEnemies = [];
            State.combatEnded = false;
            UI.updateAll();
        }

        const isStr = typeof actionOverride === 'string';
        const action = isStr ? actionOverride.trim() : DOM.playerInput.value.trim();
        if (!action || State.isProcessing) return;
        UI.clearSuggestions();
        State.routeChoices = [];
        if (!isStr) DOM.playerInput.value = "";
        let actingName;
        if (Network.isConnected() && Network.turnOrder.length > 1) {
            const myChar = State._mpMyCharId ? State.party.find(p => p.id === State._mpMyCharId) : null;
            actingName = myChar ? myChar.name : State.actingChar;
        } else if (State.actingChar === 'party') {
            actingName = 'Die Gruppe';
        } else {
            actingName = State.actingChar;
        }

        const actingChar = State.party.find(p => p.name === actingName) || null;
        const cooldownConflict = this._findPromptCooldownConflict(actingChar, action);
        if (cooldownConflict) {
            const roundsLeft = State.abilityCooldowns[cooldownConflict.cooldownKey] || 0;
            this._addCooldownBlockedDmMessage(actingChar, cooldownConflict, roundsLeft);
            if (!isStr) DOM.playerInput.value = action;
            return;
        }

        if (action.startsWith('/vote ') && Network.isHost() && Network.isConnected()) {
            const parts = action.substring(6).split('|').map(s => s.trim());
            if (parts.length >= 2) {
                const question = parts[0];
                const options = parts[1].split(',').map(s => s.trim()).filter(Boolean);
                if (options.length >= 2) {
                    Network.startVote(question, options);
                    return;
                }
            }
            UI.addChatLog('System', 'Syntax: /vote Frage | Option1, Option2, Option3');
            return;
        }

        if (Network.isInCombat()) {
            if (!(Network.isClient() && Network.isConnected())) {
                if (Network.isHost() && Network.isConnected()) {
                    Network.broadcastChat(actingName, action, { relatedPlayer: Network.playerName || this._getResolvedLocalPlayerName(), relatedCharacter: actingName });
                } else {
                    UI.addChatLog(actingName, action);
                }
            }
            Network.submitCombatAction(action, actingName);
            return;
        }

        if (Network.isClient() && Network.isConnected()) {
            const createdAt = Date.now();
            const messageId = Utils.generateId('msg');
            UI.addChatLog({ id: messageId, sender: actingName, text: action, senderType: 'player', createdAt, relatedPlayer: Network.playerName || State.localPlayerName || '', relatedCharacter: actingName }, null, { persist: true });
            Network.sendPlayerAction(action, actingName, messageId, createdAt);
            State.isProcessing = true;
            UI.showLoader(true, 'DM antwortet...');
            // Safety timeout for clients
            setTimeout(() => {
                if (State.isProcessing) {
                    State.isProcessing = false;
                    UI.showLoader(false);
                    UI.updateAll();
                }
            }, 60000);
            return;
        }

        if (State.isProcessing) return;

        if (Network.isHost() && Network.isConnected()) {
            Network.broadcastChat(actingName, action, { relatedPlayer: Network.playerName || this._getResolvedLocalPlayerName(), relatedCharacter: actingName });
        } else {
            UI.addChatLog(actingName, action);
        }

        State.fatigue = Math.min(FATIGUE_MAX, State.fatigue + 1);
        UI.updateAll();

        // Track who is acting so _getActiveDmContext() uses the correct player.
        if (Network.isConnected()) Network._currentActionPlayerName = Network.playerName || this._getResolvedLocalPlayerName();
        this.interactWithAI(action);
    },

    proposeTrade: function (safeId, merchantName) {
        const wantSelect = document.getElementById(`trade-want-${safeId}`);
        const offerSelect = document.getElementById(`trade-offer-${safeId}`);
        if (!wantSelect || !offerSelect) return;

        const wantedItem = wantSelect.value;
        const offerData = offerSelect.value;

        if (!offerData) {
            UI.addChatLog('System', 'Waehle zuerst ein Item aus dem Inventar aus, das du anbieten moechtest.');
            return;
        }

        const [charId, offeredItem] = offerData.split('|');
        const char = State.party.find(p => p.id === charId);
        if (!char) return;

        State.actingChar = char.name;
        const msg = `Ich zeige ${merchantName} mein "${offeredItem}" und frage: "Wie viel ist das wert? Reicht das fuer: ${wantedItem}?"`;
        DOM.playerInput.value = msg;
        this.submitPlayerAction();
    },

    rollSpecific: function (id) {
        const roll = State.pendingRolls.find(r => r.id === id);
        if (!roll) return;
        if (!Network.canRollFor(roll.name)) {
            UI.addChatLog('System', 'Du kannst nur fuer deinen eigenen Charakter wuerfeln.');
            return;
        }

        const startPayload = {
            id: roll.id,
            name: roll.name,
            reason: roll.desc || 'Probe',
            targetDC: roll.dc,
            modifier: roll.mod || 0,
            diceType: roll.diceType || 'W20',
            result: null,
            rawRoll: null,
        };
        UI.pushDiceFeedEntry(startPayload);
        if (Network.isClient() && Network.isConnected()) {
            Network.sendDiceRollStarted(roll.id);
        } else if (Network.isHost() && Network.isConnected()) {
            Network.broadcastDiceRollStarted(startPayload);
        }

        UI.showAnimatedDiceModal(roll.name, roll.dc, roll.mod, (result, success, rawRoll) => {
            roll.rolled = true;
            roll.result = result;
            roll.rawRoll = rawRoll;

            const animationPayload = {
                id: roll.id,
                name: roll.name,
                reason: roll.desc || 'Probe',
                targetDC: roll.dc,
                modifier: roll.mod || 0,
                diceType: roll.diceType || 'W20',
                result,
                rawRoll,
            };

            if (Network.isClient() && Network.isConnected()) {
                UI.pushDiceFeedEntry(animationPayload);
                Network.sendDiceResult(roll.id, result, rawRoll);
            } else if (Network.isHost() && Network.isConnected()) {
                UI.pushDiceFeedEntry(animationPayload);
                Network.broadcastDiceAnimation(animationPayload);
                Network._queuePendingRollResolution();
                Network.broadcastState();
            } else {
                UI.pushDiceFeedEntry(animationPayload);
            }

            UI.updateActionBox();
            this._queuePendingRollSubmission();
        }, true, roll.diceType);
    },
    rollAllPending: async function () {
        if (this._requireHost('Wuerfeln')) return;
        const unrolled = State.pendingRolls.filter(r => !r.rolled && Network.canRollFor(r.name));
        if (unrolled.length === 0 || this._isRollingAll) return;

        this._isRollingAll = true;
        const btn = DOM.actionBoxContainer.querySelector('#btn-roll-all');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Wuerfeln...';
            btn.disabled = true;
            btn.classList.add('opacity-70');
        }

        for (let i = 0; i < unrolled.length; i++) {
            const roll = unrolled[i];
            const isLast = i === unrolled.length - 1;

            const startPayload = {
                id: roll.id,
                name: roll.name,
                reason: roll.desc || 'Probe',
                targetDC: roll.dc,
                modifier: roll.mod || 0,
                diceType: roll.diceType || 'W20',
                result: null,
                rawRoll: null,
            };
            UI.pushDiceFeedEntry(startPayload);
            if (Network.isHost() && Network.isConnected()) {
                Network.broadcastDiceRollStarted(startPayload);
            }

            await new Promise(resolve => {
                UI.showAnimatedDiceModal(roll.name, roll.dc, roll.mod, (result, success, rawRoll) => {
                    roll.rolled = true;
                    roll.result = result;
                    roll.rawRoll = rawRoll;

                    const animationPayload = {
                        id: roll.id,
                        name: roll.name,
                        reason: roll.desc || 'Probe',
                        targetDC: roll.dc,
                        modifier: roll.mod || 0,
                        diceType: roll.diceType || 'W20',
                        result,
                        rawRoll,
                    };

                    UI.pushDiceFeedEntry(animationPayload);
                    if (Network.isHost() && Network.isConnected()) {
                        Network.broadcastDiceAnimation(animationPayload);
                        Network._markDirty();
                    }

                    UI.updateActionBox();
                    this._queuePendingRollSubmission();
                    resolve();
                }, isLast, roll.diceType);
            });

            if (!isLast) await new Promise(r => setTimeout(r, 400));
        }

        if (Network.isHost() && Network.isConnected()) {
            Network._queuePendingRollResolution();
            Network.broadcastState();
        }

        this._isRollingAll = false;
    },
    _queuePendingRollSubmission: function () {
        const allResolved = State.pendingRolls.length > 0 && State.pendingRolls.every(r => r.rolled);
        if (!allResolved || State.isProcessing || this._pendingRollSubmissionQueued) return;
        if (Network.isClient() && Network.isConnected()) {
            UI.updateActionBox();
            return;
        }
        if (Network.isHost() && Network.isConnected()) {
            Network._queuePendingRollResolution();
            return;
        }
        this._pendingRollSubmissionQueued = true;
        setTimeout(() => {
            this._pendingRollSubmissionQueued = false;
            const stillReady = State.pendingRolls.length > 0 && State.pendingRolls.every(r => r.rolled);
            if (stillReady && !State.isProcessing) this.submitPendingRolls();
        }, 150);
    },

    submitPendingRolls: function () {
        this._pendingRollSubmissionQueued = false;
        if (this._requireHost('Ergebnisse bestaetigen')) return;
        const rollsCopy = [...State.pendingRolls];
        let resText = 'Die Wuerfel sind gefallen:\n';
        State.pendingRolls.forEach(r => {
            const dt = r.diceType || 'W20';
            let modStr;
            if (r.stat && r.modBreakdown) {
                const bd = r.modBreakdown;
                const itemPart = bd.item !== 0 ? ` (Basis ${bd.base}${bd.item >= 0 ? '+' : ''}${bd.item} Items = ${bd.total})` : ` (Basis ${bd.base})`;
                modStr = `(${r.rawRoll} ${r.mod >= 0 ? '+' : ''}${r.mod} [${r.stat}${itemPart}])`;
            } else if (r.stat) {
                modStr = `(${r.rawRoll} ${r.mod >= 0 ? '+' : ''}${r.mod} [${r.stat}])`;
            } else {
                modStr = `(${r.rawRoll})`;
            }
            resText += `- ${r.name} [${dt}] (${r.desc}): gewuerfelt ${modStr} = **${r.result}** vs DC ${r.dc} -> ${r.result >= r.dc ? 'Erfolg' : 'Fehlschlag'}\n`;
        });
        const allSuccess = rollsCopy.length > 0 && rollsCopy.every(r => r.result >= r.dc);
        if (allSuccess) {
            State.momentum = (State.momentum || 0) + 1;
            if (State.momentum >= 3) {
                UI.addChatLog('System', `**Heldenmomentum x${State.momentum}!** Die Gruppe ist im Fluss.`);
            }
        } else {
            if (State.momentum >= 2) {
                UI.addChatLog('System', `Heldenmomentum (x${State.momentum}) unterbrochen.`);
            }
            State.momentum = 0;
        }

        State.pendingRolls = [];
        UI.updateActionBox();

        // Show individual roll results as character speech bubbles
        rollsCopy.forEach(r => {
            if (!r.rolled) return;
            const successStr = r.dc > 0 ? (r.result >= r.dc ? ' ✅' : ' ❌') : '';
            const rollText = `🎲 ${r.desc} → **${r.result}**${r.dc > 0 ? ` (SG ${r.dc})${successStr}` : successStr}`;
            if (Network.isHost() && Network.isConnected()) {
                Network.broadcastChat(r.name, rollText);
            } else {
                UI.addChatLog(r.name, rollText);
            }
        });
        if (Network.isConnected()) {
            const allPlayers = new Set(rollsCopy.map(r => {
                const c = State.party.find(p => p.name === r.name);
                return c ? Object.entries(Network.playerCharMap).find(([, cid]) => cid === c.id)?.[0] : null;
            }).filter(Boolean));

            if (allPlayers.size > 1) {
                Network._currentActionPlayerName = 'Gruppe';
                State.actingChar = 'party';
            } else {
                Network._currentActionPlayerName = [...allPlayers][0] || Network.playerName || '';
                if (rollsCopy.length > 0) State.actingChar = rollsCopy[0].name;
            }
        }
        this.interactWithAI(`[Wuerfelergebnisse]\n${resText}\nBitte beschreibe basierend darauf die Konsequenzen.`);
    },
    submitManualDiceRoll: function () {
        if (this._requireHost('Würfeln')) return;
        const r = DOM.diceResult.innerText;
        const name = DOM.diceRollerName.innerText;
        DOM.diceModal.classList.add('hidden');
        if (Network.isConnected()) {
            const rollChar = State.party.find(p => p.name === name);
            const rollPlayer = rollChar ? Object.entries(Network.playerCharMap).find(([, cid]) => cid === rollChar.id)?.[0] : null;
            Network._currentActionPlayerName = rollPlayer || Network.playerName || '';
        }
        const pendingAction = DOM.playerInput.value.trim();
        if (pendingAction) {
            UI.addChatLog(name, `${pendingAction} [🎲 ${r}]`);
            DOM.playerInput.value = "";
            this.interactWithAI(`${pendingAction}. [${name} würfelt eine ${r}]`);
        } else {
            this.interactWithAI(`[${name} würfelt frei eine ${r}]`);
        }
    },

    askOracle: function () { if (this._requireHost('Orakel')) return; DOM.oracleInput.value = ""; DOM.oracleModal.classList.remove('hidden'); setTimeout(() => DOM.oracleInput.focus(), 100); },
    submitOracle: async function () {
        const q = DOM.oracleInput.value.trim();
        if (!q) return;
        DOM.oracleModal.classList.add('hidden');
        UI.showLoader(true, "Orakel befragt...");
        try {
            const ctx = State.lastStoryPart ? `\n\nAktueller Spielkontext: "${State.lastStoryPart.substring(0, 400)}"` : '';
            const ans = await API.generateText(q + ctx, "Du bist ein mystisches Orakel in einer Fantasy-Welt. Beantworte Fragen in 1-2 S\u00E4tzen \u2013 geheimnisvoll, poetisch, aber spielrelevant. Keine Mechanik-Tags.");
            UI.addChatLog(SYSTEM_NOTICE.oracle, ans);
        } catch (e) { UI.addChatLog('System', `${SYSTEM_NOTICE.warning} Orakel-Fehler: ${e.message}`); } finally { UI.showLoader(false); }
    },


    generatePortraitForPrompts: async function (prompts, apiKey = null) {
        return API.generateImageWithFallbacks(prompts, { apiKey });
    },

    generatePortrait: async function (charData = null, customApiKey = null) {
        const a = charData ? charData.appearance : DOM.newAppearance.value;
        const c = charData ? charData.class : DOM.newClass.value;
        
        if (!charData) DOM.genImgBtn.innerText = 'Laedt...';
        
        const primaryPrompt = `Fantasy portrait, American shot, waist-up, highly detailed, ${c}${a ? ', ' + a : ''}`.split('\n').join(' ').trim();
        const prompts = [
            primaryPrompt,
            `Fantasy portrait, ${c}${a ? ', ' + a : ''}`,
            `Fantasy portrait, ${c}`
        ];
        State.tempImagePrompt = primaryPrompt;

        if (Network.isClient() && Network.isConnected()) {
            State.pendingPortraitRequestId = 'portrait-' + Date.now().toString(36);
            UI.showLoader(true, 'Host generiert Portraet...');
            Network.requestPortraitGeneration(State.pendingPortraitRequestId, prompts);
            if (!charData) {
                DOM.saveCharBtn.disabled = false;
                DOM.saveCharBtn.classList.remove('opacity-50');
            }
            return;
        }

        const pData = await this.generatePortraitForPrompts(prompts, customApiKey);
        
        if (!charData) {
            State.tempPortraitData = pData;
            if (State.tempPortraitData) {
                DOM.generatedPortrait.src = State.tempPortraitData;
                DOM.portraitPreview.classList.remove('hidden');
            } else {
                DOM.portraitPreview.classList.add('hidden');
            }
            DOM.saveCharBtn.disabled = false;
            DOM.saveCharBtn.classList.remove('opacity-50');
            DOM.genImgBtn.innerText = State.imageQuotaExceeded ? 'Ohne Portraet' : 'Portraet';
        }
        
        return pData;
    },

    finalizeCharacter: function () {
        const localKey = this._getResolvedLocalPlayerName();
        const name = DOM.newName.value.trim();
        if (!name) { UI.showToast('Bitte gib einen Namen ein!'); return; }
        const cls = DOM.newClass.value;
        const preset = PRESETS[name]; const attrs = preset ? { ...preset.attributes } : { STR: 10, DEX: 10, INT: 10, CON: 10 };
        const tempChar = { id: Utils.generateId(), name, class: cls, level: 1, hp: 20, maxHp: 20, attributes: attrs, equipment: [] };
        const startHp = PartyManager.getEffectiveMaxHp(tempChar);
        const charData = Utils.sanitizeCharacter({ ...tempChar, hp: startHp, maxHp: startHp, portrait: State.tempPortraitData, imagePrompt: State.tempImagePrompt, inventory: [DOM.startItem.value], isNPC: false });
        this.saveDefaultHero(charData);
        if (Network.isClient() && Network.isConnected()) {
            this._syncLocalProfile({ heroId: charData.id, heroName: charData.name, isReady: false });
            Network.sendCharacterCreate(charData);
        } else {
            // In multiplayer, replace the current hero. In solo, allow multiple.
            if (Network.isConnected()) {
                const oldHeroId = State.playerProfiles?.[localKey]?.heroId;
                if (oldHeroId) dispatch({ type: 'REMOVE_PARTY_MEMBER', charId: oldHeroId });
            }
            dispatch({ type: 'ADD_PARTY_MEMBER', character: charData });
            if (Network.isHost() && Network.isConnected()) {
                Network.registerCharacter(Network.playerName, charData.id);
                Network.broadcastState();
            } else {
                this._syncLocalProfile({ heroId: charData.id, heroName: charData.name, isReady: false });
            }
        }
        State.tempPortraitData = ""; State.tempImagePrompt = ""; UI.closeCreator(); UI.updateAll();
        UI.showToast(`Held ${charData.name} wurde erfolgreich erstellt!`);
        this._saveCharToRoster(charData);
    },

    generateNPC: async function () {
        if (this._requireHost('NPC begegnen')) return;
        if (State.party.length === 0) return; UI.showLoader(true, "NPC wird rekrutiert...");
        try {
            let aiText = await API.generateText(`Erstelle einen passenden NPC-Begleiter für diese Szene: "${State.lastStoryPart}".`, "Du bist ein Generator. Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt ohne Markdown. Nutze ZWINGEND diese exakten Keys: {\"name\": \"Name\", \"class\": \"Klasse\", \"appearance\": \"Kurze optische Beschreibung\"}");
            const match = aiText.match(/\{[\s\S]*\}/);
            if (!match) throw new Error("Konnte kein JSON extrahieren.");
            const npcData = JSON.parse(match[0]);

            const npcName = npcData.name || npcData.Name || npcData.NAME || "Unbekannter Reisender";
            const npcClass = npcData.class || npcData.Klasse || npcData.klasse || "Abenteurer";
            const npcApp = npcData.appearance || npcData.Aussehen || npcData.aussehen || "Gestalt";

            let imgPrompt = `Fantasy portrait, American shot, waist-up, highly detailed, ${npcClass}, ${npcApp}`.replace(/\n/g, ' ').trim();
            let pUrl = await API.generateImageWithFallbacks([
                imgPrompt,
                `Fantasy portrait, ${npcClass}, ${npcApp}`,
                `Fantasy portrait, American shot, waist-up, highly detailed, ${npcClass}`
            ]);

            State.party.push(Utils.sanitizeCharacter({ id: Utils.generateId(), name: npcName, class: npcClass, hp: 20, maxHp: 20, portrait: pUrl, imagePrompt: imgPrompt, inventory: [], isNPC: true }));
            UI.addChatLog('System', `${SYSTEM_NOTICE.fate} NPC **${npcName}** schlie\u00DFt sich der Gruppe an!`);
            UI.updateAll();
        } catch (e) {
            UI.addChatLog('System', `${SYSTEM_NOTICE.warning} NPC konnte nicht generiert werden (${e.message}). Bitte erneut versuchen.`);
        } finally {
            UI.showLoader(false);
        }
    },

    spawnNPCFromTag: async function (name, cls, app) {
        UI.addChatLog('System', `${SYSTEM_NOTICE.joining} **${name}** tritt der Gruppe bei...`);
        try {
            let imgPrompt = `Fantasy portrait, American shot, waist-up, highly detailed, ${cls}, ${app}`.replace(/\n/g, ' ');
            let p = await API.generateImageWithFallbacks([
                imgPrompt,
                `Fantasy portrait, American shot, waist-up, highly detailed, ${cls}`
            ]);
            State.party.push(Utils.sanitizeCharacter({ id: Utils.generateId(), name, class: cls, hp: 20, maxHp: 20, portrait: p, inventory: [], isNPC: true }));
            UI.addChatLog('System', `${SYSTEM_NOTICE.fate} **${name}** schlie\u00DFt sich der Gruppe an!`);
            UI.updateAll();
        } catch (e) { console.error('NPC spawn failed:', e); }
    },

    checkEnemies: function () {
        if (State.activeEnemies.length === 0) {
            UI.addChatLog('System', `${SYSTEM_NOTICE.enemyStatus} Aktuell sind keine lebenden Feinde in Sicht.`);
            return;
        }
        let statusText = `${SYSTEM_NOTICE.enemyStatus}\n`;
        State.activeEnemies.forEach(e => {
            const healthPercent = (e.hp / e.maxHp) * 100;
            let healthDesc = "Gesund";
            if (healthPercent <= 0) healthDesc = "Tot";
            else if (healthPercent <= 25) healthDesc = "Schwer verwundet";
            else if (healthPercent <= 50) healthDesc = "Verwundet";
            else if (healthPercent <= 75) healthDesc = "Leicht verletzt";

            statusText += `- **${e.name}**: ${e.hp} / ${e.maxHp} HP (${healthDesc})\n`;
        });
        UI.addChatLog("System", statusText);
    },

    assignLoot: function (i, cid) {
        this._submitInventoryAction('ASSIGN_LOOT', { index: i, charId: cid }, { showDetailsId: cid });
    },
    collectAllLoot: function (cid) {
        this._submitInventoryAction('COLLECT_ALL_LOOT', { charId: cid }, { showDetailsId: cid });
    },

    leaveMerchant: function () { State.activeMerchant = null; UI.updateAll(); UI.addChatLog("System", "Ihr wendet euch vom Händler ab."); },

    handleItemClick: function (cid, itemName, isEquipped = false, count = 1) {
        const c = State.party.find(p => p.id === cid); if (!c) return;
        DOM.itemActionTitle.innerText = itemName;
        DOM.itemActionCid.value = cid;
        DOM.itemActionName.value = itemName;
        DOM.itemActionIsEquipped.value = isEquipped;

        const amountContainer = document.getElementById('item-action-amount-container');
        const maxCountInput = document.getElementById('item-action-max-count');
        const numInput = document.getElementById('item-action-amount');
        const slider = document.getElementById('item-action-slider');

        if (amountContainer) {
            if (count > 1 && !isEquipped) {
                amountContainer.classList.remove('hidden');
                maxCountInput.value = count;
                numInput.max = count; numInput.value = 1;
                slider.max = count; slider.value = 1;
            } else {
                amountContainer.classList.add('hidden');
                maxCountInput.value = 1;
                numInput.max = 1; numInput.value = 1;
                slider.max = 1; slider.value = 1;
            }
        }

        if (isEquipped) {
            DOM.modalInvActions.classList.add('hidden');
            DOM.modalEqActions.classList.remove('hidden');
        } else {
            DOM.modalInvActions.classList.remove('hidden');
            DOM.modalEqActions.classList.add('hidden');

            const others = State.party.filter(p => p.id !== cid && !p.isSummon);
            if (others.length > 0) {
                // Security: build options via textContent to avoid XSS.
                DOM.itemActionTarget.replaceChildren();
                others.forEach((o) => {
                    const opt = document.createElement('option');
                    opt.value = o.id;
                    opt.textContent = o.name;
                    DOM.itemActionTarget.appendChild(opt);
                });
                DOM.itemActionTarget.disabled = false;
            } else {
                // Security: build options via textContent to avoid XSS.
                DOM.itemActionTarget.replaceChildren();
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'Niemand da';
                DOM.itemActionTarget.appendChild(opt);
                DOM.itemActionTarget.disabled = true;
            }


            if (State.activeMerchant && DOM.btnOfferItem) {
                DOM.btnOfferItem.classList.remove('hidden');
            } else if (DOM.btnOfferItem) {
                DOM.btnOfferItem.classList.add('hidden');
            }
        }
        DOM.itemActionModal.classList.remove('hidden');
    },
    confirmDropItem: function () {
        const amt = parseInt(document.getElementById('item-action-amount')?.value) || 1;
        if (!confirm(`Bist du sicher, dass du ${amt}x dieses Item unwiderruflich wegwerfen möchtest?`)) return;
        const cid = DOM.itemActionCid.value;
        const itemName = DOM.itemActionName.value;
        this._submitInventoryAction('DROP_ITEM', { charId: cid, itemName, amount: amt }, { showDetailsId: cid, closeModal: true });
    },
    confirmUseItem: function () {
        const amt = parseInt(document.getElementById('item-action-amount')?.value) || 1;
        const cid = DOM.itemActionCid.value;
        const itemName = DOM.itemActionName.value;
        const c = State.party.find(p => p.id === cid);
        if (!c) return;
        DOM.itemActionModal.classList.add('hidden');
        DOM.playerInput.value = `Nutzt ${amt > 1 ? amt + 'x ' : ''}${itemName} `;
        State.actingChar = c.name;
        UI.hideDetails();
        DOM.playerInput.focus();
    },
    confirmGiveItem: function () {
        const amt = parseInt(document.getElementById('item-action-amount')?.value) || 1;
        const cid = DOM.itemActionCid.value;
        const targetId = DOM.itemActionTarget.value;
        const itemName = DOM.itemActionName.value;
        if (!targetId) return;
        this._submitInventoryAction('GIVE_ITEM', { fromCharId: cid, toCharId: targetId, itemName, amount: amt }, { showDetailsId: cid, closeModal: true });
    },
    confirmOfferItem: function () {
        const cid = DOM.itemActionCid.value;
        const itemName = DOM.itemActionName.value;
        const c = State.party.find(p => p.id === cid);
        DOM.itemActionModal.classList.add('hidden');
        if (c && State.activeMerchant) {
            State.actingChar = c.name;
            DOM.playerInput.value = `Ich zeige ${State.activeMerchant.name} mein(e) "${itemName}" und frage: "Wie viel ist das wert? Können wir tauschen?"`;
            UI.hideDetails();
            DOM.playerInput.focus();
        }
    },
    confirmEquipItem: function () {
        const cid = DOM.itemActionCid.value;
        const itemName = DOM.itemActionName.value;
        this._submitInventoryAction('EQUIP_ITEM', { charId: cid, itemName }, { showDetailsId: cid, closeModal: true });
    },
    confirmUnequipItem: function () {
        const cid = DOM.itemActionCid.value;
        const itemName = DOM.itemActionName.value;
        this._submitInventoryAction('UNEQUIP_ITEM', { charId: cid, itemName }, { showDetailsId: cid, closeModal: true });
    },

    startCrafting: function (cid) {
        State.activeCrafterId = cid || null;
        State.craftingIngredients = [];
        DOM.craftingModal.classList.remove('hidden');
        UI.renderCraftingModal();
    },
    addCraftingIngredient: function (charId, itemName) {
        State.craftingIngredients.push({ charId, itemName });
        UI.renderCraftingModal();
    },
    removeCraftingIngredient: function (index) {
        State.craftingIngredients.splice(index, 1);
        UI.renderCraftingModal();
    },
    suggestCrafting: async function () {
        if (State.craftingIngredients.length === 0) {
            UI.addChatLog('System', `${SYSTEM_NOTICE.warning} Bitte w\u00E4hle zuerst Zutaten aus, bevor du einen Vorschlag anforderst.`);
            return;
        }
        const btn = document.getElementById('btn-craft-suggest');
        if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btn.disabled = true; }

        const materials = State.craftingIngredients.map(ing => ing.itemName).join(', ');

        if (Network.isClient() && Network.isConnected()) {
            Network.sendCraftingSuggestionRequest(materials);
            return;
        }

        try {
            let aiText = await API.generateText(`Erfinde einen passenden, gut ausbalancierten Gegenstand, der logisch aus diesen Zutaten hergestellt werden kann: [${materials}]. WICHTIG: Wenn die Zutaten bereits starke Werte oder Fähigkeiten haben, soll dein vorgeschlagener Gegenstand diese Werte logischerweise übernehmen oder ganz leicht verbessern. \n\nDu bist ein Generator. Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt ohne Markdown oder Codeblock-Tags. Nutze ZWINGEND diese exakten Keys: {"name": "Gegenstandsname", "str": Zahl, "dex": Zahl, "int": Zahl, "con": Zahl}. Wähle 1-2 passende weise Attribute aus (Wert 1-3 oder höher falls die Zutaten es rechtfertigen), die anderen 0.`);

            const match = aiText.match(/\{[\s\S]*\}/);
            if (!match) throw new Error("Konnte kein JSON aus Antwort extrahieren.");
            const data = JSON.parse(match[0]);

            this.applyCraftingSuggestion(data);
        } catch (e) {
            UI.addChatLog('System', `${SYSTEM_NOTICE.warning} KI konnte keinen Vorschlag generieren: ${e.message}`);
            const btn = document.getElementById('btn-craft-suggest');
            if (btn) { btn.innerHTML = '<i class="fas fa-magic mr-1"></i>Vorschlag'; btn.disabled = false; }
        }
    },

    applyCraftingSuggestion: function (data) {
        if (!data) return;
        DOM.craftTargetItem.value = data.name || "Mysterium";
        const elStr = document.getElementById('craft-stat-str');
        const elDex = document.getElementById('craft-stat-dex');
        const elInt = document.getElementById('craft-stat-int');
        const elCon = document.getElementById('craft-stat-con');

        if (elStr) elStr.value = (data.str && data.str > 0) ? data.str : "";
        if (elDex) elDex.value = (data.dex && data.dex > 0) ? data.dex : "";
        if (elInt) elInt.value = (data.int && data.int > 0) ? data.int : "";
        if (elCon) elCon.value = (data.con && data.con > 0) ? data.con : "";

        const btn = document.getElementById('btn-craft-suggest');
        if (btn) { btn.innerHTML = '<i class="fas fa-magic mr-1"></i>Vorschlag'; btn.disabled = false; }
    },
    submitCrafting: function () {
        let target = DOM.craftTargetItem.value.trim();
        if (!target || State.craftingIngredients.length === 0) return;

        const elStr = document.getElementById('craft-stat-str');
        const elDex = document.getElementById('craft-stat-dex');
        const elInt = document.getElementById('craft-stat-int');
        const elCon = document.getElementById('craft-stat-con');

        const str = parseInt(elStr ? elStr.value : 0) || 0;
        const dex = parseInt(elDex ? elDex.value : 0) || 0;
        const int = parseInt(elInt ? elInt.value : 0) || 0;
        const con = parseInt(elCon ? elCon.value : 0) || 0;

        const stats = [];
        if (str > 0) stats.push(`+${str} STR`);
        if (dex > 0) stats.push(`+${dex} DEX`);
        if (int > 0) stats.push(`+${int} INT`);
        if (con > 0) stats.push(`+${con} CON`);

        if (stats.length > 0) {
            target += ` (${stats.join(', ')})`;
        }

        const materials = State.craftingIngredients.map(ing => `1x ${ing.itemName} (von ${State.party.find(p => p.id === ing.charId)?.name || 'Unbekannt'})`).join(', ');

        let crafter = State.party.find(p => p.id === State.activeCrafterId);
        if (!crafter && State.party.length > 0) crafter = State.party[0];
        const crafterName = crafter ? crafter.name : 'Ein Gruppenmitglied';

        const msg = `Ich (${crafterName}) möchte aus den gesammelten Materialien [${materials}] auf Basis meiner Fähigkeiten folgenden Gegenstand verzaubern/schmieden: "${target}".\n\nBitte fordere mich GANZ EXPLIZIT im nächsten Schritt zu einer [Probe: ${crafterName} | Intelligenz (Crafting)] auf! Die Difficulty Class (DC) bestimmst du passend zur Schwere dieses Eingriffs. WICHTIG: Wenn die verwendeten Materialien bereits starke magische Werte oder Spezifikationen besitzen, mach die DC NICHT schwerer, da die Magie/Macht ja bereits in den Zutaten steckt und nur umgeformt wird! Entscheide ERST NACH meinem Wurf über Erfolg oder Misserfolg des Gegenstandes. Füge bei Erfolg 1-2 passende Zusatzfähigkeiten passend zur Zutatenkombination (+ Stats) hinzu. (WICHTIGE DM-ANWEISUNG: Verwende ein [Verbraucht: ...] Tag AUSSCHLIESSLICH exakt für die genannten Zutaten hier! Zerstöre niemals andere Waffen/Ausrüstung!)`;

        DOM.craftingModal.classList.add('hidden');
        DOM.craftTargetItem.value = "";
        if (elStr) elStr.value = "";
        if (elDex) elDex.value = "";
        if (elInt) elInt.value = "";
        if (elCon) elCon.value = "";
        State.craftingIngredients = [];

        State.actingChar = crafter ? crafter.name : 'party';
        DOM.playerInput.value = msg;
        this.submitPlayerAction();
    },
    replaceAbility: function (idx) {
        if (!State.pendingAbilityLearning) return;
        const c = State.party.find(p => p.id === State.pendingAbilityLearning.charId);
        if (c && c.abilities[idx]) {
            const oldAb = c.abilities[idx];
            c.abilities[idx] = State.pendingAbilityLearning.newAbility;
            UI.addChatLog('System', `${SYSTEM_NOTICE.abilityLearned} **${c.name}** hat die alte F\u00E4higkeit **${oldAb}** vergessen und daf\u00FCr **${State.pendingAbilityLearning.newAbility}** erlernt!`);
        }
        State.pendingAbilityLearning = null;
        document.getElementById('ability-replace-modal').classList.add('hidden');
        UI.updateAll();
    },
    declineNewAbility: function () {
        if (!State.pendingAbilityLearning) return;
        const c = State.party.find(p => p.id === State.pendingAbilityLearning.charId);
        if (c) {
            UI.addChatLog('System', `${SYSTEM_NOTICE.abilityDeclined} **${c.name}** hat entschieden, **${State.pendingAbilityLearning.newAbility}** doch nicht zu erlernen.`);
        }
        State.pendingAbilityLearning = null;
        document.getElementById('ability-replace-modal').classList.add('hidden');
    },
    saveApiSettings: function () {
        const provider = document.getElementById('api-provider-select').value;
        Utils.safeStorageSet('api_provider', provider);
        Utils.safeStorageSet('api_key_gemini', document.getElementById('api-key-gemini').value.trim());
        Utils.safeStorageSet('api_key_chatgpt', document.getElementById('api-key-chatgpt').value.trim());
        Utils.safeStorageSet('api_key_openrouter', document.getElementById('api-key-openrouter').value.trim());
        Utils.safeStorageSet('api_key_claude', document.getElementById('api-key-claude').value.trim());
        Utils.safeStorageSet('api_model_claude', document.getElementById('api-model-claude').value.trim() || 'claude-sonnet-4-6');
        Utils.safeStorageSet('api_model_or_text', document.getElementById('api-model-or-text').value.trim() || 'arcee-ai/trinity-large-preview:free');
        Utils.safeStorageSet('api_model_or_image', document.getElementById('api-model-or-image').value.trim());

        document.getElementById('api-settings-modal').classList.add('hidden');
        UI.addChatLog('System', SYSTEM_NOTICE.settingsSaved);
        UI.showToast("API-Einstellungen erfolgreich gespeichert!");
    },
    useAbility:function (cid, abilityName, isItemAbility = false, sourceName = '') {
        const c = State.party.find(p => p.id === cid);
        const ab = abilityName || c?.ability;
        if (c && ab) {
            const cooldown = this._getCooldownInfo(c, ab, isItemAbility, sourceName);
            if (cooldown?.rounds > 0) {
                this._addCooldownBlockedDmMessage(c, cooldown.entry, cooldown.rounds);
                return;
            }
            const abLower = ab.toLowerCase();
            const isSummonAbility = abLower.includes('beschw') || abLower.includes('summon') || abLower.includes('kreatur') || abLower.includes('herbeiruf');
            if (isSummonAbility) {
                const existingSummon = State.party.find(p => p.isSummon && p._summonSource === ab);
                if (existingSummon) {
                    UI.addChatLog('System', 'Bereits eine Kreatur aus **' + ab + '** aktiv! Nur 1 Wesen pro Beschwoerung.');
                    return;
                }
            }
            State.actingChar = c.name;
            const currentInput = DOM.playerInput.value.trim();
            const src = isItemAbility ? 'Item-Faehigkeit' : 'Faehigkeit';
            DOM.playerInput.value = currentInput + ` Ich setze meine ${src}: "${ab}" ein. `;

            if (isSummonAbility && cooldown?.key) {
                State.abilityCooldowns[cooldown.key] = Math.max(State.abilityCooldowns[cooldown.key] || 0, SUMMON_COOLDOWN);
            }
            DOM.playerInput.focus();
            UI.hideDetails();
        }
    },
    upgradeStat: function (cid, key) {
        const c = State.party.find(p => p.id === cid);
        if (!c || c.statPoints <= 0) return;
        dispatch({ type: 'UPGRADE_STAT', charId: cid, stat: key });
        if (Network.isClient() && Network.isConnected()) Network.sendStatUpgrade(cid, key);
        UI.showDetails(cid);
        UI.updateAll();
    },
    removeCharacter: function (id) {
        if (State.party.length <= 1) { UI.showToast('Du brauchst mindestens einen Helden!'); return; }
        const idx = State.party.findIndex(c => c.id === id);
        if (idx > -1) {
            dispatch({ type: 'REMOVE_PARTY_MEMBER', charId: id });
            UI.hideDetails();
        }
    },
    exportHero: function (id) { const c = State.party.find(p => p.id === id); if (!c) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(c)], { type: 'application/json' })); a.download = `Hero_${c.name}.json`; document.body.appendChild(a); a.click(); },
    bulkExportHeroes: async function () {
        const heroes = State.party.filter(p => !p.isSummon);
        if (heroes.length === 0) {
            UI.addChatLog('System', `${SYSTEM_NOTICE.warning} Keine Helden zum Exportieren vorhanden.`);
            return;
        }
        const now = new Date();
        const pad = n => n.toString().padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;

        for (let i = 0; i < heroes.length; i++) {
            const c = heroes[i];
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify(c)], { type: 'application/json' }));
            a.download = `Hero_${c.name}_${ts}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            await new Promise(r => setTimeout(r, 250));
        }
        UI.addChatLog('System', `${SYSTEM_NOTICE.exportDone} **${heroes.length} Helden** wurden erfolgreich exportiert (Sammel-Download).`);
        UI.showToast(`${heroes.length} Helden exportiert`);
    },
    downloadSave: function () { const now = new Date(); const pad = n => n.toString().padStart(2, '0'); const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(State)], { type: 'application/json' })); a.download = `InfiniteDungeon_${ts}.json`; document.body.appendChild(a); a.click(); },
    importSave: function (e) {
        if (!e.target.files[0]) return;
        const r = new FileReader();
        r.onload = (ev) => {
            try {
                let data = JSON.parse(ev.target.result);
                data = repairStoredText(validateSaveData(data));
                const allowed = Object.keys(State);
                Object.keys(data).forEach(k => { if (!allowed.includes(k)) delete data[k]; });
                Object.assign(State, data);

                if (State.party) State.party = State.party.filter(c => typeof c === 'object' && c.name).map(c => Utils.sanitizeCharacter(c));
                UI.toggleViews(State.gameStarted);
                UI.updateAll();
            } catch (err) {
                UI.addChatLog('System', `Save-Import fehlgeschlagen: ${repairDisplayText(err.message)}`);
            }
        };
        r.readAsText(e.target.files[0]);
        e.target.value = "";
    },
    importHero: function (e) {
        if (!e.target.files[0]) return;
        const localKey = this._getResolvedLocalPlayerName();
        const r = new FileReader();
        r.onload = (ev) => {
            try {
                let h = JSON.parse(ev.target.result);
                h = repairStoredText(validateHeroData(h));
                h.id = Utils.generateId();
                const hero = Utils.sanitizeCharacter(h);
                this.saveDefaultHero(hero);
                if (Network.isClient() && Network.isConnected()) {
                    this._syncLocalProfile({ heroId: hero.id, heroName: hero.name, isReady: false });
                    Network.sendCharacterCreate(hero);
                } else {
                    // In multiplayer, replace the current hero. In solo, allow multiple.
                    if (Network.isConnected()) {
                        const oldHeroId = State.playerProfiles?.[localKey]?.heroId;
                        if (oldHeroId) dispatch({ type: 'REMOVE_PARTY_MEMBER', charId: oldHeroId });
                    }
                    dispatch({ type: 'ADD_PARTY_MEMBER', character: hero });
                    if (Network.isHost() && Network.isConnected()) {
                        Network.registerCharacter(Network.playerName, hero.id);
                        Network.broadcastState();
                    } else {
                        this._syncLocalProfile({ heroId: hero.id, heroName: hero.name, isReady: false });
                    }
                }
                UI.showToast(`Held importiert: ${repairDisplayText(hero.name)}`, 'success');
                this._saveCharToRoster(hero);
                UI.updateAll();
            } catch (err) {
                UI.addChatLog('System', `Hero-Import fehlgeschlagen: ${repairDisplayText(err.message)}`);
            }
        };
        r.readAsText(e.target.files[0]);
        e.target.value = "";
    },

    // --- PvP Arena Section ---

    showPvPScreen: function () {
        const shell = document.getElementById('pvp-arena-shell');
        if (!shell) return;
        
        // Always ask for API key/provider before entering the arena
        State.pendingApiMode = 'pvp';
        State.selectedApiProvider = API.getProvider();
        State.pendingApiKeyValue = API.getKey(State.selectedApiProvider) || '';
        State.pendingApiModelText = State.selectedApiProvider === 'openrouter' ? (API.getOrModelText() || 'arcee-ai/trinity-large-preview:free') : '';
        State.sessionPhase = 'api_gate';
        UI.updateAll();
    },

    _enterPvPArena: function () {
        const shell = document.getElementById('pvp-arena-shell');
        if (!shell) return;

        // If not connected, host a room first (name will be updated on hero import)
        if (!Network.isConnected()) {
            Network.host(State.localPlayerName || 'Held');
        }

        // Reset PvP state for a new session
        State.pvp.player1 = null;
        State.pvp.player2 = null;
        State.pvp.combatLog = [];
        State.pvp.currentTurn = 0;
        State.pvp.cooldowns = {};
        State.pvp.player1Summons = [];
        State.pvp.player2Summons = [];

        // Standard-Held automatisch als P1 vorladen
        const defaultHero = this.getDefaultHero();
        if (defaultHero) {
            const h = Utils.sanitizeCharacter({ ...defaultHero, id: Utils.generateId() });
            h.hp = h.maxHp; // Volle HP im PvP
            if (Network.isConnected()) {
                if (Network.isHost()) {
                    State.pvp.player1 = h;
                    Network.playerName = h.name;
                }
            } else {
                State.pvp.player1 = h;
            }
        }

        shell.classList.remove('hidden');
        State.sessionPhase = 'pvp_combat';
        this._startArenaParticles();
        this.addPvPLog("⚔️ Willkommen in der Arena!");
        this.addPvPLog("Bitte importiere deinen Helden, um den Kampf vorzubereiten.");

        if (Network.isHost()) {
            this.addPvPLog(`📢 Raum-Code: **${Network.roomCode}**`);
        }

        this.updatePvPUI();

        if (!State.pvp.player1 || !State.pvp.player2) {
            this._renderPvPSetupButtons();
        }
    },

    closePvPArena: function () {
        const shell = document.getElementById('pvp-arena-shell');
        if (shell) shell.classList.add('hidden');
        State.pvp.player1 = null;
        State.pvp.player2 = null;
        State.pvp.combatLog = [];
        State.pvp.cooldowns = {};
        State.pvp.player1Summons = [];
        State.pvp.player2Summons = [];
        State.sessionPhase = 'lobby';
        UI.updateAll();
    },

    _renderPvPSetupButtons: function () {
        const log = document.getElementById('pvp-log');
        if (!log) return;

        const isHost = Network.isHost();
        const isClient = Network.isClient();
        const p1 = State.pvp.player1;
        const p2 = State.pvp.player2;

        // Prepend existing log entries above the setup buttons
        const entries = State.pvp.combatLog
            .map(m => `<div class="arena-log-entry">${sanitize(m)}</div>`)
            .join('');

        let btns = '<div class="p-4 space-y-4 text-center">';

        if (isHost) {
            if (!p1) btns += `<button id="pvp-import-p1" class="pvp-action-btn bg-amber-600/50"><i class="fas fa-upload mr-2"></i> Meinen Helden laden (P1)</button>`;
            else btns += `<div class="text-green-400 text-xs font-bold"><i class="fas fa-check mr-1"></i> Dein Held bereit: ${p1.name}</div><button id="pvp-import-p1" class="pvp-action-btn bg-slate-700/50 text-xs mt-1"><i class="fas fa-exchange-alt mr-1"></i> Anderen Helden wählen</button>`;

            if (!p2) btns += `<div class="text-slate-500 text-xs italic">Warte auf Gegner...</div>`;
            else btns += `<div class="text-green-400 text-xs font-bold"><i class="fas fa-check mr-1"></i> Gegner bereit: ${p2.name}</div>`;
        } else if (isClient) {
            if (!p1) btns += `<div class="text-slate-500 text-xs italic">Warte auf Host...</div>`;
            else btns += `<div class="text-green-400 text-xs font-bold"><i class="fas fa-check mr-1"></i> Host bereit: ${p1.name}</div>`;

            if (!p2) btns += `<button id="pvp-import-p2" class="pvp-action-btn bg-amber-600/50"><i class="fas fa-upload mr-2"></i> Meinen Helden laden</button>`;
            else btns += `<div class="text-green-400 text-xs font-bold"><i class="fas fa-check mr-1"></i> Dein Held bereit: ${p2.name}</div>`;
        } else {
            // Solo fallback
            btns += `<div class="flex flex-col gap-2">`;
            if (!p1) btns += `<button id="pvp-import-p1" class="pvp-action-btn"><i class="fas fa-upload mr-2"></i> Held 1 laden</button>`;
            else btns += `<div class="text-green-400 text-xs font-bold"><i class="fas fa-check mr-1"></i> ${p1.name} bereit</div><button id="pvp-import-p1" class="pvp-action-btn bg-slate-700/50 text-xs"><i class="fas fa-exchange-alt mr-1"></i> Anderen Helden wählen</button>`;
            if (!p2) btns += `<button id="pvp-import-p2" class="pvp-action-btn"><i class="fas fa-upload mr-2"></i> Held 2 laden</button>`;
            else btns += `<div class="text-green-400 text-xs font-bold"><i class="fas fa-check mr-1"></i> ${p2.name} bereit</div>`;
            btns += `</div>`;
        }

        if (p1 && p2 && (isHost || !Network.isConnected())) {
            btns += `<button id="pvp-start-battle" class="pvp-action-btn bg-amber-600">KAMPF STARTEN</button>`;
        }

        btns += '</div>';
        log.innerHTML = entries + btns;

        // Use onclick to prevent multiple listeners accumulating
        const p1Btn = document.getElementById('pvp-import-p1');
        const p2Btn = document.getElementById('pvp-import-p2');
        const startBtn = document.getElementById('pvp-start-battle');
        if (p1Btn) p1Btn.onclick = () => this._triggerPvPImport(1);
        if (p2Btn) p2Btn.onclick = () => this._triggerPvPImport(2);
        if (startBtn) startBtn.onclick = () => this.startPvPCombat();
    },

    _triggerPvPImport: function (num) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try {
                    let h = JSON.parse(ev.target.result);
                    h = validateHeroData(h);
                    const hero = Utils.sanitizeCharacter(h);
                    // Arena: start at full health with correct maxHp
                    hero.maxHp = Math.max(hero.maxHp || 0, hero.hp || 100, 1);
                    hero.hp = hero.maxHp;
                    
                    if (Network.isConnected()) {
                        if (Network.isHost()) {
                            State.pvp.player1 = hero;
                            Network.playerName = hero.name;
                            this.addPvPLog(`✅ Dein Held (${hero.name}) geladen!`);
                            Network.broadcastState();
                        } else {
                            Network.playerName = hero.name;
                            Network.sendPvPHero(hero);
                            this.addPvPLog(`✅ Held (${hero.name}) gesendet! Warte auf Host...`);
                        }
                    } else {
                        if (num === 1) State.pvp.player1 = hero;
                        else State.pvp.player2 = hero;
                        this.addPvPLog(`✅ ${hero.name} ist bereit!`);
                    }
                    
                    this.updatePvPUI();
                    
                    if (State.pvp.player1 && State.pvp.player2 && Network.isHost()) {
                        document.getElementById('pvp-start-battle')?.classList.remove('hidden');
                    }
                } catch (err) {
                    this.addPvPLog(`❌ Import Fehler: ${err.message}`);
                }
            };
            r.readAsText(file);
        };
        input.click();
    },

    startPvPCombat: function () {
        if (!State.pvp.player1 || !State.pvp.player2) return;
        
        // Random start
        State.pvp.currentTurn = Math.random() > 0.5 ? 0 : 1;
        const starter = State.pvp.currentTurn === 0 ? State.pvp.player1 : State.pvp.player2;
        
        this.addPvPLog(`🏁 Der Kampf beginnt!`);
        this.addPvPLog(`🎲 **${starter.name}** beginnt den Kampf.`);
        this.updatePvPUI();
    },

    _getLocalPvPHero: function () {
        if (Network.isClient()) return State.pvp.player2;
        return State.pvp.player1;
    },

    _togglePvPPanel: function (type) {
        const abPanel = document.getElementById('pvp-abilities-panel');
        const invPanel = document.getElementById('pvp-inventory-panel');
        if (!abPanel || !invPanel) return;

        const hero = this._getLocalPvPHero();
        if (!hero) { this.addPvPLog('⚠️ Importiere erst deinen Helden.'); return; }

        if (type === 'abilities') {
            const wasHidden = abPanel.classList.contains('hidden');
            invPanel.classList.add('hidden');
            if (wasHidden) {
                abPanel.innerHTML = this._renderPvPAbilities(hero);
                abPanel.classList.remove('hidden');
            } else {
                abPanel.classList.add('hidden');
            }
        } else {
            const wasHidden = invPanel.classList.contains('hidden');
            abPanel.classList.add('hidden');
            if (wasHidden) {
                invPanel.innerHTML = this._renderPvPInventory(hero);
                invPanel.classList.remove('hidden');
            } else {
                invPanel.classList.add('hidden');
            }
        }
    },

    _renderPvPAbilities: function (hero) {
        const playerKey = Network.isClient() ? 'player2' : 'player1';
        const cd = State.pvp.cooldowns || {};
        const entries = PartyManager.getAbilityEntries(hero);
        const talents = hero.talents || [];
        if (entries.length === 0 && talents.length === 0) {
            return `<p class="text-slate-500 text-center py-2">Keine Fähigkeiten verfügbar.</p>`;
        }

        const renderEntry = (name, color, icon) => {
            const safe = name.replace(/"/g, '&quot;');
            const cdLeft = cd[`${playerKey}_${name}`] || 0;
            const onCd = cdLeft > 0;
            const actionAttr = onCd ? '' : `data-action="pvp-select-ability" data-ability="${safe}"`;
            const cdBadge = onCd ? ` <span class="text-[10px] text-slate-400 ml-1">(${cdLeft} Rdn)</span>` : '';
            return `<div ${actionAttr}
                class="text-${onCd ? 'slate' : color}-200 bg-${onCd ? 'slate' : color}-900/30 ${onCd ? 'opacity-50 cursor-not-allowed' : `hover:bg-${color}-800/60 cursor-pointer`} border border-${onCd ? 'slate' : color}-700/30 rounded p-1.5 mb-1 transition-colors">
                <i class="fas ${icon} mr-1 text-${onCd ? 'slate' : color}-400"></i>${name}${cdBadge}
            </div>`;
        };

        let html = '';
        const summonEntries = entries.filter(e => /beschwör/i.test(e.name));
        const regularEntries = entries.filter(e => !/beschwör/i.test(e.name));

        if (regularEntries.length > 0) {
            html += `<p class="text-amber-400 font-bold mb-1 uppercase tracking-wide">Fähigkeiten</p>`;
            for (const e of regularEntries) {
                html += renderEntry(e.name, e.type === 'item' ? 'teal' : 'amber', e.type === 'item' ? 'fa-shield-alt' : 'fa-meteor');
            }
        }
        if (summonEntries.length > 0) {
            html += `<p class="text-purple-400 font-bold mb-1 mt-2 uppercase tracking-wide">Beschwörungen</p>`;
            for (const e of summonEntries) {
                html += renderEntry(e.name, 'purple', 'fa-dragon');
            }
        }
        if (talents.length > 0) {
            html += `<p class="text-emerald-400 font-bold mb-1 mt-2 uppercase tracking-wide">Talente</p>`;
            for (const t of talents) {
                html += renderEntry(t, 'emerald', 'fa-leaf');
            }
        }
        return html;
    },

    _renderPvPInventory: function (hero) {
        const equipment = hero.equipment || [];
        const inventory = hero.inventory || [];
        if (equipment.length === 0 && inventory.length === 0) {
            return `<p class="text-slate-500 text-center py-2">Inventar ist leer.</p>`;
        }
        let html = '';
        if (equipment.length > 0) {
            html += `<p class="text-indigo-400 font-bold mb-1 uppercase tracking-wide">Ausrüstung</p>`;
            for (const item of equipment) {
                const safe = item.replace(/"/g, '&quot;');
                html += `<div data-action="pvp-use-item" data-item="${safe}"
                    class="text-indigo-200 bg-indigo-900/30 hover:bg-indigo-800/60 border border-indigo-700/30 rounded p-1.5 mb-1 cursor-pointer transition-colors">
                    <i class="fas fa-shield-alt mr-1 text-indigo-400"></i>${item}
                </div>`;
            }
        }
        if (inventory.length > 0) {
            html += `<p class="text-amber-400 font-bold mb-1 mt-2 uppercase tracking-wide">Gegenstände</p>`;
            for (const item of inventory) {
                const safe = item.replace(/"/g, '&quot;');
                html += `<div data-action="pvp-use-item" data-item="${safe}"
                    class="text-amber-200 bg-amber-900/30 hover:bg-amber-800/60 border border-amber-700/30 rounded p-1.5 mb-1 cursor-pointer transition-colors">
                    <i class="fas fa-cube mr-1 text-amber-400"></i>${item}
                </div>`;
            }
        }
        return html;
    },

    processPvPAction: function (type, value = '', fromNetwork = false) {
        if (State.sessionPhase !== 'pvp_combat') return;
        if (!State.pvp.player1 || !State.pvp.player2) return;
        if (State.isProcessing) return;

        const turn = State.pvp.currentTurn;
        
        // Validation: Is it my turn? 
        // A Host can process a Client's action if it comes from the network.
        const isSolo = !Network.isConnected();
        const isMyTurn = (Network.isHost() && turn === 0) || (Network.isClient() && turn === 1) || isSolo;
        const canProcess = isMyTurn || (Network.isHost() && turn === 1 && fromNetwork);
        
        if (!canProcess) {
            if (isMyTurn) this.addPvPLog("⚠️ Warte auf den Gegner...");
            return;
        }

        // If client, forward to host
        if (Network.isClient()) {
            const inputEl = document.getElementById('pvp-player-input');
            const inputVal = (inputEl?.value || value || '').trim();
            const sendValue = (type === 'attack' || type === 'text-input') ? (inputVal || 'Greift mit der Waffe an.') : value;
            Network.sendPvPAction('text-input', sendValue);
            if (inputEl) inputEl.value = '';
            document.getElementById('pvp-abilities-panel')?.classList.add('hidden');
            document.getElementById('pvp-inventory-panel')?.classList.add('hidden');
            return;
        }

        // Host processing logic starts here
        const activePlayer = turn === 0 ? State.pvp.player1 : State.pvp.player2;
        const opponent = turn === 0 ? State.pvp.player2 : State.pvp.player1;

        let actionDesc = "";
        if (type === 'text-input' || type === 'attack') {
            const inputEl = document.getElementById('pvp-player-input');
            const inputVal = (inputEl?.value || value || '').trim();
            actionDesc = inputVal || 'Greift mit der Waffe an.';
            if (inputEl) inputEl.value = '';
            document.getElementById('pvp-abilities-panel')?.classList.add('hidden');
            document.getElementById('pvp-inventory-panel')?.classList.add('hidden');
        }

        if (!actionDesc) return;

        // Perform AI Mediation (Host-side)
        this._interactWithPvPAI(activePlayer, opponent, actionDesc);
    },

    _interactWithPvPAI: async function (attacker, defender, action) {
        if (!attacker || !defender) return;

        State.isProcessing = true;
        this.updatePvPUI();

        try {
            // Pre-calculate dice roll and show animation
            const isSummonAction = /beschwör/i.test(action);
            const diceResult = this._calculatePvPDamage(attacker, defender);
            if (!isSummonAction) this._showDiceRoll(diceResult, attacker.name);

            const attackerKey = attacker === State.pvp.player1 ? 'player1' : 'player2';
            const defenderKey = attackerKey === 'player1' ? 'player2' : 'player1';
            const attackerSummons = State.pvp[`${attackerKey}Summons`] || [];
            const summonCtx = attackerSummons.length > 0
                ? `\nBESCHWÖRUNGEN von ${attacker.name}: ${attackerSummons.map(s => `${s.name} (HP ${s.hp}/${s.maxHp})`).join(', ')}`
                : '';

            const prompt = `
AKTUELLER ZUG: ${attacker.name} führt folgende Aktion aus: "${action}"
WÜRFELWURF (System): ${diceResult.roll} + ${diceResult.strBonus} (STR) - ${diceResult.conReduction} (ABW) = ${diceResult.total} Schaden
→ Nutze EXAKT ${diceResult.total} im SCHADEN-Event (bei Angriffs-Aktionen).

KÄMPFER 1 (${attacker === State.pvp.player1 ? 'Host' : 'Client'}): ${attacker === State.pvp.player1 ? 'ANGREIFER' : 'VERTEIDIGER'}
Name: ${State.pvp.player1.name} | HP: ${State.pvp.player1.hp}/${State.pvp.player1.maxHp || 100}
Stats: STR ${State.pvp.player1.attributes?.STR ?? 10}, DEX ${State.pvp.player1.attributes?.DEX ?? 10}, CON ${State.pvp.player1.attributes?.CON ?? 10}, INT ${State.pvp.player1.attributes?.INT ?? 10}
Ausrüstung: ${(State.pvp.player1.equipment || []).join(', ') || '—'}

KÄMPFER 2 (${attacker === State.pvp.player2 ? 'Host' : 'Client'}): ${attacker === State.pvp.player2 ? 'ANGREIFER' : 'VERTEIDIGER'}
Name: ${State.pvp.player2.name} | HP: ${State.pvp.player2.hp}/${State.pvp.player2.maxHp || 100}
Stats: STR ${State.pvp.player2.attributes?.STR ?? 10}, DEX ${State.pvp.player2.attributes?.DEX ?? 10}, CON ${State.pvp.player2.attributes?.CON ?? 10}, INT ${State.pvp.player2.attributes?.INT ?? 10}
Ausrüstung: ${(State.pvp.player2.equipment || []).join(', ') || '—'}${summonCtx}

Beschreibe das Ergebnis dramatisch im JSON-Format.`;

            const response = await API.generateText(prompt, PVP_SYSTEM_PROMPT);
            const match = response.match(/\{[\s\S]*\}/);
            if (!match) throw new Error('Keine gültige JSON-Antwort vom Schiedsrichter erhalten.');
            const data = JSON.parse(match[0]);

            if (data.narrative) {
                // Parse [Abklingzeit: X] tag from narrative
                const cdMatch = data.narrative.match(/\[Abklingzeit[:\s]+(\d+)\]/i);
                if (cdMatch) {
                    const rounds = parseInt(cdMatch[1], 10);
                    if (!isNaN(rounds) && rounds > 0) {
                        State.pvp.cooldowns[`${attackerKey}_${action}`] = rounds;
                        this.addPvPLog(`⏳ <em>${action}</em> hat ${rounds} Runden Abklingzeit.`);
                    }
                }
                const cleanNarrative = data.narrative.replace(/\[Abklingzeit[:\s]+\d+\]/gi, '').trim();
                this.addPvPLog(`📖 ${sanitizeStrict(cleanNarrative)}`);
            }

            if (data.events) {
                for (const ev of data.events) {
                    if (ev.type === 'SCHADEN') {
                        const target = ev.target === State.pvp.player1.name ? State.pvp.player1 : State.pvp.player2;
                        const isP1 = target === State.pvp.player1;
                        const amount = parseInt(ev.amount, 10);
                        if (!isNaN(amount) && amount > 0) {
                            target.hp = Math.max(0, target.hp - amount);
                            Sound.play('sword');
                            const barEl = document.getElementById(isP1 ? 'pvp-p1-hp-fill' : 'pvp-p2-hp-fill');
                            if (barEl) {
                                const r = barEl.getBoundingClientRect();
                                this._spawnHitParticles(r.left + r.width / 2, r.top + r.height / 2, '#f97316');
                                this._spawnDamageNumber(r.left + r.width / 2, r.top - 4, amount, false);
                            }
                        }
                    } else if (ev.type === 'HEILUNG') {
                        const target = ev.target === State.pvp.player1.name ? State.pvp.player1 : State.pvp.player2;
                        const isP1 = target === State.pvp.player1;
                        const amount = parseInt(ev.amount, 10);
                        if (!isNaN(amount) && amount > 0) {
                            target.hp = Math.min(target.maxHp || 100, target.hp + amount);
                            Sound.play('heal');
                            const barEl = document.getElementById(isP1 ? 'pvp-p1-hp-fill' : 'pvp-p2-hp-fill');
                            if (barEl) {
                                const r = barEl.getBoundingClientRect();
                                this._spawnHitParticles(r.left + r.width / 2, r.top + r.height / 2, '#4ade80');
                                this._spawnDamageNumber(r.left + r.width / 2, r.top - 4, amount, true);
                            }
                        }
                    } else if (ev.type === 'BESCHWÖRUNG') {
                        const summonOwner = ev.owner === State.pvp.player1?.name ? 'player1' : 'player2';
                        const summon = {
                            id: crypto.randomUUID(),
                            name: sanitizeStrict(ev.name || 'Kreatur'),
                            hp: Math.max(1, parseInt(ev.hp, 10) || 20),
                            maxHp: Math.max(1, parseInt(ev.hp, 10) || 20),
                            str: Math.max(1, parseInt(ev.str, 10) || 8),
                            con: Math.max(1, parseInt(ev.con, 10) || 5),
                        };
                        State.pvp[`${summonOwner}Summons`].push(summon);
                        this.addPvPLog(`👾 <strong>${summon.name}</strong> wurde beschworen! (HP: ${summon.hp})`);
                        Sound.play('sword');
                    } else if (ev.type === 'PVP_ENDE') {
                        this.addPvPLog(`🎉 <strong>${ev.winner} hat gewonnen!</strong>`);
                        Sound.play('victory');
                        const winner = ev.winner === State.pvp.player1?.name ? State.pvp.player1 : State.pvp.player2;
                        if (winner) {
                            winner.inventory = winner.inventory || [];
                            winner.inventory.push('Design-Token');
                            this.addPvPLog(`🏆 <strong>${winner.name}</strong> erhält einen <span style="color:#a78bfa">Design-Token</span>!`);
                        }
                    }
                }
            }

            // Summon auto-attacks after attacker's turn
            const myDefender = attackerKey === 'player1' ? State.pvp.player2 : State.pvp.player1;
            this._summonAutoAttack(State.pvp[`${attackerKey}Summons`], myDefender);

            // Decrement this player's cooldowns
            this._decrementPvPCooldowns(attackerKey);

            // Switch turns if no winner
            const isOver = data.events?.some(e => e.type === 'PVP_ENDE')
                || State.pvp.player1.hp <= 0 || State.pvp.player2.hp <= 0;
            if (!isOver) {
                State.pvp.currentTurn = 1 - State.pvp.currentTurn;
            }

            if (Network.isHost()) Network.broadcastState();
        } catch (err) {
            console.error('PvP AI Error:', err);
            this.addPvPLog(`❌ Schiedsrichter-Fehler: ${err.message}`);
        } finally {
            State.isProcessing = false;
            this.updatePvPUI();
        }
    },

    _spawnHitParticles: function (x, y, color = '#f97316') {
        for (let i = 0; i < 14; i++) {
            const p = document.createElement('div');
            p.className = 'pvp-hit-particle';
            const angle = Math.random() * Math.PI * 2;
            const dist = 25 + Math.random() * 50;
            const size = 2 + Math.random() * 4;
            p.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${color};--tx:${(Math.cos(angle) * dist).toFixed(1)}px;--ty:${(Math.sin(angle) * dist).toFixed(1)}px;`;
            document.body.appendChild(p);
            p.addEventListener('animationend', () => p.remove(), { once: true });
        }
    },

    _spawnDamageNumber: function (x, y, amount, isHeal = false) {
        const el = document.createElement('div');
        el.className = 'pvp-dmg-number';
        el.textContent = (isHeal ? '+' : '-') + amount;
        el.style.cssText = `left:${x}px;top:${y}px;color:${isHeal ? '#4ade80' : '#fb923c'};`;
        document.body.appendChild(el);
        el.addEventListener('animationend', () => el.remove(), { once: true });
    },

    _startArenaParticles: function () {
        const container = document.getElementById('arena-fx-container');
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < 22; i++) {
            const p = document.createElement('div');
            p.className = 'arena-ember';
            p.style.cssText = `left:${(Math.random() * 100).toFixed(1)}%;animation-delay:${(-Math.random() * 6).toFixed(2)}s;animation-duration:${(3 + Math.random() * 5).toFixed(2)}s;width:${(2 + Math.random() * 3).toFixed(1)}px;height:${(2 + Math.random() * 3).toFixed(1)}px;opacity:${(0.3 + Math.random() * 0.5).toFixed(2)};`;
            container.appendChild(p);
        }
    },

    _calculatePvPDamage: function (attacker, defender) {
        const attAttrs = attacker.attributes || { STR: 10, DEX: 10 };
        const defAttrs = defender.attributes || { CON: 10 };
        const strBonus = Math.max(1, Math.floor(attAttrs.STR / 2));
        const roll = Math.floor(Math.random() * 10) + 1;
        const conReduction = Math.floor(defAttrs.CON / 4);
        const total = Math.max(1, strBonus + roll - conReduction);
        return { roll, strBonus, conReduction, total };
    },

    _showDiceRoll: function (result, attackerName) {
        const { roll, strBonus, conReduction, total } = result;
        const reductStr = conReduction > 0 ? ` − <span class="pvp-reduction">${conReduction}</span> (ABW)` : '';
        this.addPvPLog(`<span class="pvp-dice-line"><span class="pvp-dice-icon">🎲</span> <strong>${attackerName}</strong>: <span class="pvp-roll-num">${roll}</span> + <span class="pvp-bonus">${strBonus}</span> (STR)${reductStr} = <strong class="pvp-total">${total} Schaden</strong></span>`);
    },

    _decrementPvPCooldowns: function (playerKey) {
        const cd = State.pvp.cooldowns;
        if (!cd) return;
        for (const key of Object.keys(cd)) {
            if (key.startsWith(playerKey + '_')) {
                cd[key]--;
                if (cd[key] <= 0) delete cd[key];
            }
        }
    },

    _summonAutoAttack: function (summons, defender) {
        for (const summon of summons) {
            if (summon.hp <= 0) continue;
            const fakeAttacker = { name: summon.name, attributes: { STR: summon.str || 8, DEX: 8 } };
            const dice = this._calculatePvPDamage(fakeAttacker, defender);
            this._showDiceRoll(dice, summon.name);
            defender.hp = Math.max(0, defender.hp - dice.total);
            const isP1 = defender === State.pvp.player1;
            const barEl = document.getElementById(isP1 ? 'pvp-p1-hp-fill' : 'pvp-p2-hp-fill');
            if (barEl) {
                const r = barEl.getBoundingClientRect();
                this._spawnHitParticles(r.left + r.width / 2, r.top + r.height / 2, '#a78bfa');
                this._spawnDamageNumber(r.left + r.width / 2, r.top - 4, dice.total, false);
            }
            this.addPvPLog(`👾 <strong>${summon.name}</strong> greift an!`);
        }
    },

    generateItemImage: async function (charId, itemName) {
        const char = State.party.find(c => c.id === charId);
        if (!char) return;
        const tokenIdx = (char.inventory || []).indexOf('Design-Token');
        if (tokenIdx === -1) {
            UI.addChatLog('System', '⚠️ Kein Design-Token im Inventar.');
            return;
        }
        char.inventory.splice(tokenIdx, 1);
        UI.updateAll();
        UI.addChatLog('System', `🎨 Generiere Bild für "${itemName}"...`);
        try {
            const url = await API.generateImageWithFallbacks([
                `Fantasy RPG item, highly detailed digital art, isolated on dark background, glowing magical aura: ${itemName}`,
                `Fantasy item: ${itemName}`,
                itemName
            ]);
            if (url) {
                char.itemPortraits = char.itemPortraits || {};
                char.itemPortraits[itemName] = url;
                UI.addChatLog('System', `✅ Bild für "${itemName}" generiert!`);
            } else {
                char.inventory.push('Design-Token');
                UI.addChatLog('System', '❌ Bildgenerierung fehlgeschlagen. Token zurückerstattet.');
            }
        } catch (e) {
            char.inventory.push('Design-Token');
            UI.addChatLog('System', `❌ Fehler: ${e.message}`);
        }
        UI.updateAll();
    },

    addPvPLog: function (msg) {
        dispatch({ type: 'ADD_PVP_LOG', entry: msg });
        this.updatePvPUI();
    },

    updatePvPUI: function () {
        const p1 = State.pvp.player1;
        const p2 = State.pvp.player2;
        const turn = State.pvp.currentTurn;

        // Room Code Display
        const roomDisplay = document.getElementById('pvp-room-display');
        const roomCodeSpan = document.getElementById('pvp-room-code');
        if (roomDisplay && roomCodeSpan && Network.isConnected() && Network.isHost()) {
            roomDisplay.classList.remove('hidden');
            roomCodeSpan.innerText = Network.roomCode;
        } else if (roomDisplay) {
            roomDisplay.classList.add('hidden');
        }

        // Sync portraits and names
        if (p1) {
            document.getElementById('pvp-p1-portrait').src = p1.portrait || '';
            document.getElementById('pvp-p1-name').innerText = p1.name;
            const p1Hp = Math.round((p1.hp / (p1.maxHp || 100)) * 100);
            document.getElementById('pvp-p1-hp-fill').style.width = p1Hp + '%';
            document.getElementById('pvp-p1-hp-text').innerText = `${p1.hp} / ${p1.maxHp || 100} HP`;
        }
        if (p2) {
            document.getElementById('pvp-p2-portrait').src = p2.portrait || '';
            document.getElementById('pvp-p2-name').innerText = p2.name;
            const p2Hp = Math.round((p2.hp / (p2.maxHp || 100)) * 100);
            document.getElementById('pvp-p2-hp-fill').style.width = p2Hp + '%';
            document.getElementById('pvp-p2-hp-text').innerText = `${p2.hp} / ${p2.maxHp || 100} HP`;
        }

        // Sync log
        const logContainer = document.getElementById('pvp-log');
        if (logContainer) {
            if (!p1 || !p2) {
                // Still in setup — always regenerate so clients/hosts see up-to-date buttons
                this._renderPvPSetupButtons();
            } else {
                logContainer.innerHTML = State.pvp.combatLog
                    .map(m => `<div class="arena-log-entry">${sanitize(m)}</div>`)
                    .join('');
            }
        }

        // Active card glow
        const card1 = document.getElementById('pvp-card-p1');
        const card2 = document.getElementById('pvp-card-p2');
        if (card1 && card2 && p1 && p2) {
            card1.classList.toggle('pvp-card-active', turn === 0);
            card2.classList.toggle('pvp-card-active', turn === 1);
        }

        // Turn banner + actions vs waiting state
        const banner = document.getElementById('pvp-turn-banner');
        const actionsPanel = document.getElementById('pvp-actions-panel');
        const waitingState = document.getElementById('pvp-waiting-state');
        const waitingText = document.getElementById('pvp-waiting-text');
        const canAct = (p1 && p2 && p1.hp > 0 && p2.hp > 0) && !State.isProcessing &&
            ((Network.isHost() && turn === 0) || (Network.isClient() && turn === 1) || (!Network.isConnected()));

        if (banner) {
            if (p1 && p2) {
                const activeName = turn === 0 ? p1.name : p2.name;
                if (canAct) {
                    banner.textContent = `⚔ Dein Zug — ${activeName}`;
                    banner.className = 'pvp-turn-banner is-my-turn mb-3';
                } else if (State.isProcessing) {
                    banner.textContent = 'Schiedsrichter entscheidet...';
                    banner.className = 'pvp-turn-banner is-waiting mb-3';
                } else {
                    banner.textContent = `${activeName} ist am Zug`;
                    banner.className = 'pvp-turn-banner is-waiting mb-3';
                }
            } else {
                banner.textContent = 'Warte auf Helden-Import...';
                banner.className = 'pvp-turn-banner is-waiting mb-3';
            }
        }

        if (actionsPanel && waitingState) {
            if (canAct) {
                actionsPanel.classList.remove('hidden');
                waitingState.classList.add('hidden');
            } else {
                actionsPanel.classList.add('hidden');
                waitingState.classList.remove('hidden');
                if (waitingText && p1 && p2) {
                    const activeName = turn === 0 ? p1.name : p2.name;
                    waitingText.textContent = State.isProcessing ? 'KI berechnet...' : `${activeName} ist am Zug...`;
                }
            }
        }
    }
};










