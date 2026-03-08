import { CONFIG, PRESETS, TALENT_TREES } from './prompts.js';
import { State, dispatch } from './state.js';
import { TTS, DOM, UIBuilders, UI } from './ui.js';
import { Weather } from './features.js';
import { Utils } from './utils.js';
import { Sound } from './sound.js';
import { API } from './api.js';
import { PartyManager } from './party.js';
import { CombatManager } from './combat.js';
import { TagParser } from './tagparser.js';
import { sanitize, validateSaveData, validateHeroData } from './sanitize.js';
import { Network } from './network.js';
import {
    EQUIPMENT_LIMIT, ABILITY_LIMIT, SUMMON_COOLDOWN,
    CHAT_HISTORY_MAX, CHAT_HISTORY_CHAR_LIMIT, CHAT_CONTEXT_CHAR_LIMIT,
    FATIGUE_MAX, CAMP_REDUCTION_WITH_FOOD, CAMP_REDUCTION_WITHOUT_FOOD,
    AUTO_SAVE_KEY, JOURNAL_MAX_ENTRIES,
    FATE_BOSS_THRESHOLD, FATE_DARK_THRESHOLD, FATE_UNREST_THRESHOLD,
} from './constants.js';

export const Engine = {
    _isRollingAll: false,

    _requireHost(actionName) {
        if (Network.isClient() && Network.isConnected()) {
            UI.addChatLog('System', `**${actionName}** ist nur für den Host verfügbar.`);
            return true;
        }
        return false;
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

        UI.addChatLog('System', result.message);
        UI.updateAll();
        if (showDetailsId) UI.showDetails(showDetailsId);
        if (Network.isHost() && Network.isConnected()) {
            Network.broadcastSystemChat('System', result.message);
            Network.broadcastState();
        }
        return true;
    },

    _sanitizeSuggestionText(text) {
        return String(text || '')
            .replace(/^.*?">\s*/g, '')
            .replace(/^[::][^\s]+\s+/g, '')
            .replace(/^[-*]\s*/, '')
            .trim();
    },

    setCustomApiKey: function () { DOM.customKeyInput.value = localStorage.getItem("custom_gemini_key") || ""; DOM.apiKeyModal.classList.remove('hidden'); setTimeout(() => DOM.customKeyInput.focus(), 100); },
    saveApiKey: function () { localStorage.setItem("custom_gemini_key", DOM.customKeyInput.value.trim()); DOM.apiKeyModal.classList.add('hidden'); UI.addChatLog("System", "🔑 API-Key wurde gespeichert."); },
    startGame: function () { if (this._requireHost('Abenteuer starten')) return; if (State.party.length === 0) { UI.addChatLog("System", "⚠️ Erstelle zuerst einen Helden!"); return; } State.gameStarted = true; UI.toggleViews(true); this.interactWithAI("Die Reise beginnt."); },

    toggleSound: function () {
        State.soundEnabled = !State.soundEnabled;
        const btn = DOM.soundToggle;
        if (btn) {
            btn.textContent = State.soundEnabled ? '🔊' : '🔇';
            btn.className = `bg-slate-800/80 hover:bg-slate-700 px-3 py-2 rounded-lg text-xs font-medium border border-slate-600/50 hover:border-slate-400 shadow-[0_0_10px_rgba(0,0,0,0.3)] hover:shadow-[0_0_15px_rgba(148,163,184,0.4)] transition-all duration-300 backdrop-blur-sm ${State.soundEnabled ? 'sound-on' : 'sound-off'}`;
        }
        if (State.soundEnabled) Sound.play('dice');
    },

    toggleQuickplay: function () {
        State.quickplayEnabled = !State.quickplayEnabled;
        const btn = document.getElementById('quickplay-btn');
        if (State.quickplayEnabled) {
            btn.className = "bg-blue-600 hover:bg-blue-500 border border-blue-400 text-white px-3.5 py-2 rounded-lg shadow-[0_0_15px_rgba(59,130,246,0.6)] transition-all duration-300 backdrop-blur-sm tracking-wide flex items-center gap-1.5 animate-pulse";
            btn.innerHTML = `<i class="fas fa-bolt text-yellow-300"></i> Quickplay (AN)`;
            UI.addChatLog("System", "⚡ **Quickplay aktiviert:** Der DM wird sich nun kurz fassen, um den Spielfluss zu beschleunigen.");
        } else {
            btn.className = "bg-blue-900/40 hover:bg-blue-800/60 border border-blue-700/50 hover:border-blue-400 text-blue-200 px-3.5 py-2 rounded-lg shadow-[0_0_10px_rgba(0,0,0,0.3)] hover:shadow-[0_0_15px_rgba(59,130,246,0.5)] transition-all duration-300 backdrop-blur-sm tracking-wide flex items-center gap-1.5";
            btn.innerHTML = `⚡ Quickplay`;
            UI.addChatLog("System", "⚡ **Quickplay deaktiviert:** Der DM beschreibt die Welt wieder ausführlicher.");
        }
    },

    generateJournalEntry: async function () {
        if (this._requireHost('Journal-Eintrag')) return;
        if (!State.lastStoryPart || !State.gameStarted) return;
        const oldJournalBtn = document.querySelector('[data-action="gen-journal"]');
        if (oldJournalBtn) { oldJournalBtn.textContent = '⏳'; oldJournalBtn.disabled = true; }
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
            if (oldJournalBtn) { oldJournalBtn.textContent = '✨ Update'; oldJournalBtn.disabled = false; }
        }
    },

    interactWithAI: async function (actionMsg) {
        if (State.isProcessing) return;
        if (State.combatEnded) {
            State.defeatedEnemies = [];
            State.combatEnded = false;
        }

        try {
            State.undoSnapshot = JSON.parse(JSON.stringify({
                party: State.party,
                activeEnemies: State.activeEnemies,
                defeatedEnemies: State.defeatedEnemies,
                lootDrops: State.lootDrops,
                fate: State.fate,
                fatigue: State.fatigue,
                gold: State.gold,
                activeMerchant: State.activeMerchant,
                abilityCooldowns: State.abilityCooldowns
            }));
        } catch (e) { console.warn('Undo snapshot failed:', e); }

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
            UI.addChatLog("System", `✅ Fähigkeiten wieder bereit: ${readyAbilities.join(', ')}`);
        }

        State.isBossFight = (State.fate || 0) >= FATE_BOSS_THRESHOLD && State.activeEnemies.length > 0;

        const acting = DOM.actingChar.value;
        const enemyCtx = State.activeEnemies.length > 0 ? State.activeEnemies.map(e => `${e.name} (HP ${e.hp}/${e.maxHp})`).join(', ') : 'Keine Feinde';

        const partyCtx = State.party.map(p => {
            const eff = PartyManager.getEffectiveAttributes(p);
            const effMax = PartyManager.getEffectiveMaxHp(p);
            const specEffects = PartyManager.getItemSpecialEffects(p);
            const specStr = specEffects.length > 0 ? `, Item-Effekte: [${specEffects.join(', ')}]` : '';
            return `${p.name} (Lvl ${p.level} ${p.class}, HP: ${p.hp}/${effMax}, Stats (inkl. Item-Boni): STR ${eff.STR} DEX ${eff.DEX} INT ${eff.INT} CON ${eff.CON}, Inv: [${p.inventory.join(', ')}], Ausgerüstet: [${(p.equipment || []).join(', ')}]${specStr})`;
        }).join(' | ');

        const diff = DOM.gameDifficulty.value; const rate = DOM.enemyRate.value;
        const dInstr = diff === "Einfach" ? "Gegner-Schaden 1-2, Proben-DC ~10, Belohnungen: Normales Loot" : diff === "Normal" ? "Gegner-Schaden 3-5, Proben-DC ~12, Belohnungen: Gutes Loot" : diff === "Schwer" ? "Gegner-Schaden 6-8, Proben-DC ~14, Belohnungen: Sehr gutes magisches Loot" : "Gegner-Schaden 10-15, Proben-DC ~18, Belohnungen: Episches legendäres Loot";
        const qpAddendum = State.quickplayEnabled
            ? " QUICKPLAY AKTIV: Antworten extrem kurz (1-2 Sätze). Du darfst auch Angriffsproben für Spieler vorschlagen."
            : " NORMALER MODUS – ANGRIFF-REGEL (ABSOLUT): Du darfst NIEMALS selbst eine Angriffs-Probe für einen Spieler fordern oder vorgeben wie dieser angreift. NUR Ausweichen/Blocken-Proben für Spieler sind erlaubt. Warte zwingend, bis der Spieler explizit schreibt dass er angreift (z.B. 'Ich greife an'). Erst dann und nur dann eine Probe fordern.";

        let dungeonContext = "";
        const fate = State.fate || 0;
        if (fate >= FATE_BOSS_THRESHOLD) {
            dungeonContext = ` [WICHTIGE DM-ANWEISUNG: Ein mächtiges Schicksal hat sich erfüllt! Initiiere JETZT SOFORT einen epischen Bosskampf. Der Boss MUSS massiven Loot fallen lassen (Beute-Tag). Erwähne das Schicksal NICHT beim Namen.]`;
        } else if (fate >= FATE_DARK_THRESHOLD) {
            dungeonContext = ` [DM-HINWEIS: Eine dunkle Macht nähert sich unaufhaltsam. Lass die Atmosphäre bedrohlicher werden – verstörte NPCs, unheimliche Zeichen, ein Gefühl drohenden Unheils. Kein konkreter Hinweis auf den Ursprung.]`;
        } else if (fate >= FATE_UNREST_THRESHOLD) {
            dungeonContext = ` [DM-HINWEIS: Eine leichte Unruhe liegt in der Luft. Streue subtile Vorzeichen ein – ein merkwürdiges Detail, ein Gerücht, ein diffuses Unbehagen. Halte es unterschwellig.]`;
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
        const context = `Party: ${partyCtx}. Feinde: ${enemyCtx}. Vorherige Szenen: [${historyCtx}]. Aktuelle Szene: ${State.lastStoryPart}. Aktion (${acting}): ${actionMsg}. [Regeln: Diff=${diff} (${dInstr}), Rate=${rate}]${qpAddendum}${dungeonContext}${weatherCtx}${rollsAddendum}${momentumCtx}${goldCtx}`;

        try {
            const aiResponse = await API.generateText(context);
            const cleanStory = aiResponse
                .replace(/\[(?:Gegner|GegnerTot|GegnerFlucht|Beute|Verbraucht|KampfBeendet|XP|NeuerNPC|Tausch|EndgueltigTot|Haendler|Faehigkeit|Cooldown|Flucht|Gold|DeathSave|Schaden|GegnerSchaden|Heilung|Probe|Route).*?\]/gi, '')
                .replace(/\n{3,}/g, '\n\n').trim();
            State.lastStoryPart = cleanStory.substring(0, 1500);
            Weather.randomChange();
            State.chatHistory.push(cleanStory.substring(0, CHAT_CONTEXT_CHAR_LIMIT));
            if (State.chatHistory.length > CHAT_HISTORY_MAX) State.chatHistory.shift();
            let cleanText = aiResponse;

            const probeRegex = /\[Probe:\s*([^|\]]+)\s*\|\s*([^|\]]+)\s*(?:\|\s*([^|\]]+))?\s*\|\s*(\d+)(?:\s*\|\s*(W\d+|w\d+))?\s*\]/gi;
            let match;
            while ((match = probeRegex.exec(cleanText)) !== null) {
                let charName = match[1].trim();
                let p2 = match[2].trim();
                let p3 = match[3] ? match[3].trim() : "";
                let dc = parseInt(match[4]) || 10;
                let dt = match[5] ? match[5].trim().toUpperCase() : 'W20';

                let rawStat = p2.toUpperCase();
                let desc = p3 || p2;

                let statName = "";
                let modifier = 0;

                if (rawStat.includes('STÄR') || rawStat.includes('STR')) statName = 'STR';
                else if (rawStat.includes('GESCHICK') || rawStat.includes('DEX')) statName = 'DEX';
                else if (rawStat.includes('INTELLIGENZ') || rawStat.includes('INT')) statName = 'INT';
                else if (rawStat.includes('KONST') || rawStat.includes('CON')) statName = 'CON';
                else {
                    let upperDesc = desc.toUpperCase();
                    if (upperDesc.includes('STÄR') || upperDesc.includes('STR')) statName = 'STR';
                    else if (upperDesc.includes('GESCHICK') || upperDesc.includes('DEX')) statName = 'DEX';
                    else if (upperDesc.includes('INTELLIGENZ') || upperDesc.includes('INT')) statName = 'INT';
                    else if (upperDesc.includes('KONST') || upperDesc.includes('CON')) statName = 'CON';
                }

                const c = Utils.findTarget(State.party, charName);
                if (c && statName) {
                    const baseAttr = (c.attributes || {})[statName] || 10;
                    const eff = PartyManager.getEffectiveAttributes(c);
                    const totalAttr = eff[statName] || 10;
                    const itemBonus = totalAttr - baseAttr;
                    modifier = totalAttr;
                    State.pendingRolls._nextModBreakdown = { base: baseAttr, item: itemBonus, total: totalAttr };
                }

                const breakdown = State.pendingRolls._nextModBreakdown || null;
                delete State.pendingRolls._nextModBreakdown;
                const weatherDcMod = (State.weather && State.weather.dcMod) || 0;
                const fatigueDcMod = State.fatigue >= 10 ? Math.floor((State.fatigue - 7) / 3) : 0;
                const finalDc = dc + weatherDcMod + fatigueDcMod;
                const dcNote = (weatherDcMod > 0 || fatigueDcMod > 0)
                    ? ` [DC ${dc}${weatherDcMod > 0 ? ` +${weatherDcMod} ${State.weather.name}` : ''}${fatigueDcMod > 0 ? ` +${fatigueDcMod} Erschöpfung` : ''}]`
                    : '';
                State.pendingRolls.push({ id: Utils.generateId(), name: charName, stat: statName, mod: modifier, desc: desc + dcNote, dc: finalDc, diceType: dt, rolled: false, result: 0, rawRoll: 0, modBreakdown: breakdown });
            }
            cleanText = cleanText.replace(probeRegex, '');

            UI.updateActionBox();

            cleanText = cleanText.replace(/\[Erfolg:\s*(.*?)\]/gi, '<span class="border border-green-500/50 bg-green-900/30 text-green-300 rounded-lg px-2.5 py-1 font-bold inline-flex items-center align-middle shadow-[0_0_10px_rgba(34,197,94,0.15)] mx-0.5 my-1 backdrop-blur-sm"><i class="fas fa-check text-green-400 mr-1.5"></i> $1</span>');
            cleanText = cleanText.replace(/\[Scheitern:\s*(.*?)\]/gi, '<span class="border border-red-500/50 bg-red-900/30 text-red-300 rounded-lg px-2.5 py-1 font-bold inline-flex items-center align-middle shadow-[0_0_10px_rgba(239,68,68,0.15)] mx-0.5 my-1 backdrop-blur-sm"><i class="fas fa-times text-red-400 mr-1.5"></i> $1</span>');
            cleanText = cleanText.replace(/\[Zauber:\s*(.*?)\]/gi, '<span class="border border-blue-400/50 bg-blue-900/30 text-blue-200 rounded-lg px-2.5 py-1 font-bold inline-flex items-center align-middle shadow-[0_0_10px_rgba(59,130,246,0.15)] mx-0.5 my-1 backdrop-blur-sm tracking-wide"><i class="fas fa-magic text-blue-400 mr-2 drop-shadow-[0_0_5px_rgba(96,165,250,0.8)]"></i> $1</span>');
            cleanText = cleanText.replace(/\[Knapp:\s*(.*?)\]/gi, '<span class="border border-yellow-500/50 bg-yellow-900/30 text-yellow-200 rounded-lg px-2.5 py-1 font-bold inline-flex items-center align-middle shadow-[0_0_12px_rgba(234,179,8,0.25)] mx-0.5 my-1 backdrop-blur-sm"><i class="fas fa-bullseye text-yellow-400 mr-1.5 animate-pulse"></i> $1</span>');
            cleanText = cleanText.replace(/\[Schaden[\s:]*([^,\]]+)[\s,]+(\d+)\s*\]/gi, (m, name, amt) => `<span class="border border-red-600/50 bg-red-950/50 text-red-300 rounded-lg px-2 py-0.5 font-bold inline-flex items-center align-middle shadow-[inset_0_0_8px_rgba(220,38,38,0.2)] mx-0.5 my-0.5 backdrop-blur-sm"><i class="fas fa-tint text-red-500 mr-1.5"></i> ${name.trim()} <span class="text-white ml-0.5">-${amt} HP</span></span>`);
            cleanText = cleanText.replace(/\[GegnerSchaden[\s:]*([^,\]]+)[\s,]+(\d+)\s*\]/gi, (m, name, amt) => `<span class="border border-orange-600/50 bg-orange-950/50 text-orange-300 rounded-lg px-2 py-0.5 font-bold inline-flex items-center align-middle shadow-[inset_0_0_8px_rgba(249,115,22,0.2)] mx-0.5 my-0.5 backdrop-blur-sm"><i class="fas fa-bolt text-orange-500 mr-1.5"></i> ${name.trim()} <span class="text-white ml-0.5">-${amt} HP</span></span>`);
            cleanText = cleanText.replace(/\[Heilung[\s:]*([^,\]]+)[\s,]+(\d+)\s*\]/gi, (m, name, amt) => `<span class="border border-emerald-500/50 bg-emerald-950/50 text-emerald-300 rounded-lg px-2 py-0.5 font-bold inline-flex items-center align-middle shadow-[inset_0_0_8px_rgba(16,185,129,0.2)] mx-0.5 my-0.5 backdrop-blur-sm"><i class="fas fa-heart text-emerald-400 mr-1.5"></i> ${name.trim()} <span class="text-white ml-0.5">+${amt} HP</span></span>`);

            cleanText = cleanText.replace(/\[Haendler[\s:]*([^|\]]+)\|\s*(.*?)\]/gi, (m, name, itemsStr) => {
                const mName = name.trim();
                const items = itemsStr.split(',').map(s => s.trim());

                let merchantOptions = items.map(it => `<option value="${it.replace(/"/g, '&quot;')}">${it}</option>`).join('');

                let partyOptions = '<option value="">-- Wähle ein Item zum Tausch --</option>';
                let hasItems = false;
                State.party.forEach(p => {
                    if (p.inventory.length > 0) {
                        hasItems = true;
                        let uniqueInv = [...new Set(p.inventory)];
                        partyOptions += `<optgroup label="Inventar von ${p.name}">`;
                        uniqueInv.forEach(it => {
                            partyOptions += `<option value="${p.id}|${it.replace(/"/g, '&quot;')}">${it}</option>`;
                        });
                        partyOptions += `</optgroup>`;
                    }
                });
                if (!hasItems) partyOptions = '<option value="">Ihr habt keine Items zum Tauschen</option>';

                const safeId = mName.replace(/[^a-zA-Z0-9]/g, '');

                return `<div class="mt-4 block w-full text-left bg-gradient-to-br from-slate-900 to-slate-800 border border-amber-600/40 p-4 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.5)] relative overflow-hidden">
                    <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-600 via-yellow-400 to-amber-600"></div>
                    <h4 class="text-amber-400 font-bold text-sm mb-3 border-b border-amber-900/50 pb-2 uppercase tracking-wider cinzel"><i class="fas fa-store mr-2 text-amber-500"></i>Handelsangebot: ${mName}</h4>
                    <div class="space-y-3 mt-3">
                        <div class="bg-black/20 p-2 rounded-lg border border-white/5">
                            <label class="text-[10px] text-amber-600/80 uppercase font-bold tracking-widest"><i class="fas fa-box-open mr-1"></i> Warenangebot:</label>
                            <select id="trade-want-${safeId}" class="w-full bg-slate-900/80 hover:bg-slate-900 border border-amber-900/40 rounded p-2 text-xs text-amber-100 outline-none focus:border-amber-500 mt-1 transition-colors cursor-pointer shadow-inner">
                                ${merchantOptions}
                            </select>
                        </div>
                        <div class="bg-black/20 p-2 rounded-lg border border-white/5">
                            <label class="text-[10px] text-blue-500/80 uppercase font-bold tracking-widest"><i class="fas fa-hand-holding-usd mr-1"></i> Mein Gegenangebot:</label>
                            <select id="trade-offer-${safeId}" class="w-full bg-slate-900/80 hover:bg-slate-900 border border-blue-900/40 rounded p-2 text-xs text-blue-100 outline-none focus:border-blue-500 mt-1 transition-colors cursor-pointer shadow-inner">
                                ${partyOptions}
                            </select>
                        </div>
                        <button data-action="propose-trade" data-safe-id="${safeId}" data-merchant-name="${mName.replace(/"/g, '&quot;')}" class="w-full bg-gradient-to-r from-amber-700 to-amber-600 hover:from-amber-600 hover:to-amber-500 py-2.5 rounded-lg text-xs font-bold transition-all shadow-md mt-2 border border-amber-500 text-white uppercase tracking-wider"><i class="fas fa-handshake mr-2"></i> Handel Vorschlagen</button>
                    </div>
                </div>`;
            });

            cleanText = cleanText.replace(/\[(Gegner|GegnerTot|GegnerFlucht|Beute|Verbraucht|KampfBeendet|XP|NeuerNPC|Tausch|EndgueltigTot|Haendler|Faehigkeit|Cooldown|Flucht|Gold|DeathSave).*?\]/gi, '').trim();
            const suggestionClass = 'mt-1.5 suggestion-option flex items-center gap-2 w-full text-left bg-slate-800/70 hover:bg-indigo-900/40 border border-slate-600/40 hover:border-indigo-500/50 text-indigo-200 hover:text-indigo-100 rounded-lg px-3 py-2.5 cursor-pointer transition-all shadow-sm hover:shadow-[0_0_10px_rgba(99,102,241,0.2)] text-xs';
            cleanText = cleanText.replace(/(?:^|\n)(?:-|\*)\s+([^\n]+)/g, (m, p1) => {
                const suggestionText = this._sanitizeSuggestionText(p1);
                if (!suggestionText) return '';
                const safeValue = suggestionText.replace(/"/g, '&quot;');
                return `<div class="${suggestionClass}" data-prompt="${safeValue}"><span class="leading-relaxed">${suggestionText}</span></div>`;
            });

            const hasSuggestions = cleanText.includes('suggestion-option');
            const hasPendingRolls = State.pendingRolls.some(r => !r.rolled);
            if (!hasSuggestions && !hasPendingRolls) {
                const inCombat = State.activeEnemies.some(e => e.hp > 0);
                const hasLoot = State.lootDrops && State.lootDrops.length > 0;
                const fallback = inCombat
                    ? [['⚔️', 'Angreifen'], ['🛡️', 'Verteidigen'], ['🏃', 'Fliehen']]
                    : hasLoot
                        ? [['🤚', 'Beute einsammeln'], ['🔍', 'Umgebung untersuchen'], ['🚶', 'Weiter erkunden']]
                        : [['🔍', 'Umgebung untersuchen'], ['🚶', 'Weiter erkunden'], ['⛺', 'Lager aufschlagen']];
                cleanText += '<div class="mt-3">' + fallback.map(([emoji, text]) =>
                    `<div class="${suggestionClass}" data-prompt="${text}"><span>${emoji} ${text}</span></div>`
                ).join('') + '</div>';
            }

            if (cleanText.length > 0) {
                UI.addChatLog("DM", cleanText);
                if (Network.isHost()) Network.broadcastChat("DM", cleanText);
            }
            TagParser.process(aiResponse);
        } catch (e) { UI.addChatLog("System", `⚠️ Fehler: ${e.message}`); }
        finally {
            State.isProcessing = false; UI.showLoader(false);
            CombatManager.cleanupDead();
            if (Network.isHost() && Network.isConnected() && State.lootDrops.length > 0) {
                Network.autoDistributeLoot();
            }
            try {
                const saveData = JSON.parse(JSON.stringify(State));
                saveData._autoSaveTime = new Date().toISOString();
                localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(saveData));
            } catch (e) { console.warn('Auto-save failed:', e); }
            UI.updateAll();
            if (Network.isHost() && Network.isConnected()) {
                Network.broadcastState();
                Network.autoRollPending();
                if (Network.isInCombat()) {
                    Network.startNewCombatRound();
                } else {
                    Network.advanceTurn();
                }
            }
        }
    },

    chooseRoute: function (route) {
        DOM.actionBoxContainer.innerHTML = ''; DOM.actionBoxContainer.classList.add('hidden');
        UI.updateAll();
        this.submitPlayerAction(`wählt den Weg: ${route}.`);
    },

    camp: function () {
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
        char.talents.push(talentName);
        char.pendingTalentPoints--;
        Sound.play('levelup');
        UI.addChatLog("System", `🌟 **${char.name}** hat die Spezialisierung **${talentName}** erlernt!`);
        UI.showDetails(charId);
        UI.updateAll();
    },

    submitPlayerAction: function (actionOverride) {
        if (State.pendingRolls.length > 0) return;
        if (Network.isConnected() && !Network.isMyTurn()) return;

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
            actingName = myChar ? myChar.name : DOM.actingChar.value;
        } else if (DOM.actingChar.value === 'party') {
            actingName = 'Die Gruppe';
        } else {
            actingName = DOM.actingChar.value;
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
            UI.addChatLog(actingName, action);
            Network.submitCombatAction(action, actingName);
            return;
        }

        UI.addChatLog(actingName, action);

        if (Network.isClient() && Network.isConnected()) {
            Network.sendPlayerAction(action, actingName);
            State.isProcessing = true;
            UI.showLoader(true, 'DM antwortet...');
            return;
        }

        State.fatigue = Math.min(FATIGUE_MAX, State.fatigue + 1);
        UI.updateAll();

        this.interactWithAI(action);
    },

    proposeTrade: function (safeId, merchantName) {
        const wantSelect = document.getElementById(`trade-want-${safeId}`);
        const offerSelect = document.getElementById(`trade-offer-${safeId}`);
        if (!wantSelect || !offerSelect) return;

        const wantedItem = wantSelect.value;
        const offerData = offerSelect.value;

        if (!offerData) {
            UI.addChatLog("System", "⚠️ Wähle zuerst ein Item aus dem Inventar aus, das du anbieten möchtest.");
            return;
        }

        const [charId, offeredItem] = offerData.split('|');
        const char = State.party.find(p => p.id === charId);
        if (!char) return;

        DOM.actingChar.value = char.name;
        const msg = `Ich zeige ${merchantName} mein "${offeredItem}" und frage: "Wie viel ist das wert? Reicht das für: ${wantedItem}?"`;
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
        UI.showAnimatedDiceModal(roll.name, roll.dc, roll.mod, (result, success, rawRoll) => {
            roll.rolled = true;
            roll.result = result;
            roll.rawRoll = rawRoll;
            if (Network.isClient() && Network.isConnected()) {
                Network.sendDiceResult(roll.id, result, rawRoll);
            } else if (Network.isHost() && Network.isConnected()) {
                Network.broadcastDiceAnimation({
                    name: roll.name,
                    targetDC: roll.dc,
                    modifier: roll.mod || 0,
                    diceType: roll.diceType || 'W20',
                    result,
                    rawRoll,
                });
                Network._queuePendingRollResolution();
                Network.broadcastState();
            }
            UI.updateActionBox();
        }, true, roll.diceType);
    },

    rollAllPending: async function () {
        if (this._requireHost('Würfeln')) return;
        const unrolled = State.pendingRolls.filter(r => !r.rolled && Network.canRollFor(r.name));
        if (unrolled.length === 0 || this._isRollingAll) return;

        this._isRollingAll = true;
        const btn = DOM.actionBoxContainer.querySelector('#btn-roll-all');
        if (btn) { btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Würfeln...`; btn.disabled = true; btn.classList.add('opacity-70'); }

        for (let i = 0; i < unrolled.length; i++) {
            const roll = unrolled[i];
            const isLast = i === unrolled.length - 1;

            await new Promise(resolve => {
                UI.showAnimatedDiceModal(roll.name, roll.dc, roll.mod, (result, success, rawRoll) => {
                    roll.rolled = true; roll.result = result; roll.rawRoll = rawRoll;
                    UI.updateActionBox(); resolve();
                }, isLast, roll.diceType);
            });
            if (!isLast) await new Promise(r => setTimeout(r, 400));
        }
        this._isRollingAll = false;
    },

    submitPendingRolls: function () {
        if (this._requireHost('Ergebnisse bestätigen')) return;
        const rollsCopy = [...State.pendingRolls];
        let resText = "Die Würfel sind gefallen:\n";
        State.pendingRolls.forEach(r => {
            let dt = r.diceType || 'W20';
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
            resText += `- ${r.name} [${dt}] (${r.desc}): gewürfelt ${modStr} = **${r.result}** vs DC ${r.dc} → ${r.result >= r.dc ? '✅ Erfolg' : '❌ Fehlschlag'}\n`;
        });
        const allSuccess = rollsCopy.length > 0 && rollsCopy.every(r => r.result >= r.dc);
        if (allSuccess) {
            State.momentum = (State.momentum || 0) + 1;
            if (State.momentum >= 3) {
                UI.addChatLog("System", `⚡ **HELDENMOMENTUM x${State.momentum}!** Die Gruppe befindet sich im Heldenfluss – aufeinanderfolgende Siege stärken den Geist!`);
            }
        } else {
            if (State.momentum >= 2) {
                UI.addChatLog("System", `💨 Heldenmomentum (x${State.momentum}) unterbrochen.`);
            }
            State.momentum = 0;
        }

        State.pendingRolls = []; UI.updateActionBox();
        UI.addChatLog("🎲 System", resText);
        this.interactWithAI(`[Würfelergebnisse]\n${resText}\nBitte beschreibe basierend darauf die Konsequenzen.`);
    },

    submitManualDiceRoll: function () {
        if (this._requireHost('Würfeln')) return;
        const r = DOM.diceResult.innerText;
        const name = DOM.diceRollerName.innerText;
        DOM.diceModal.classList.add('hidden');
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
            const ans = await API.generateText(q + ctx, "Du bist ein mystisches Orakel in einer Fantasy-Welt. Beantworte Fragen in 1-2 Sätzen – geheimnisvoll, poetisch, aber spielrelevant. Keine Mechanik-Tags.");
            UI.addChatLog("✨ Orakel", ans);
        } catch (e) { UI.addChatLog('System', `⚠️ Orakel-Fehler: ${e.message}`); } finally { UI.showLoader(false); }
    },
    generatePlotTwist: async function () {
        if (this._requireHost('Plot-Twist')) return;
        UI.showLoader(true, "Schicksal weben...");
        try {
            const twistText = await API.generateText(
                `Die Gruppe erlebt gerade: "${State.lastStoryPart}". Erschaffe jetzt einen dramatischen, unerwarteten Wendepunkt der die Geschichte vorantreibt. Nutze Mechanik-Tags wie nötig (Gegner, XP, Beute, etc.).`,
                CONFIG.systemPrompt
            );
            State.lastStoryPart = twistText.substring(0, 600);
            State.chatHistory.push({ role: 'assistant', content: twistText.substring(0, 400) });
            if (State.chatHistory.length > 8) State.chatHistory.shift();
            TagParser.process(twistText);
            UI.addChatLog("✨ Schicksal", twistText);
        } catch (e) { UI.addChatLog('System', `⚠️ Plot-Twist Fehler: ${e.message}`); } finally { UI.showLoader(false); }
    },

    generatePortrait: async function () {
        const a = DOM.newAppearance.value, c = DOM.newClass.value;
        DOM.genImgBtn.innerText = "⏳";
        const prompt = `Fantasy portrait, face only, highly detailed, ${c}${a ? ', ' + a : ''}`.replace(/\n/g, ' ').trim();
        State.tempImagePrompt = prompt;

        let pData = await API.generateImageWithFallbacks([
            prompt,
            `Fantasy portrait, ${c}${a ? ', ' + a : ''}`,
            `Fantasy portrait, ${c}`
        ]);

        State.tempPortraitData = pData;

        if (State.tempPortraitData) {
            DOM.generatedPortrait.src = State.tempPortraitData;
            DOM.portraitPreview.classList.remove('hidden');
        } else {
            DOM.portraitPreview.classList.add('hidden');
        }

        DOM.saveCharBtn.disabled = false; DOM.saveCharBtn.classList.remove('opacity-50');
        DOM.genImgBtn.innerText = State.imageQuotaExceeded ? "Ohne Porträt ✨" : "Porträt ✨";
    },

    finalizeCharacter: function () {
        const name = DOM.newName.value; const cls = DOM.newClass.value;
        const preset = PRESETS[name]; const attrs = preset ? { ...preset.attributes } : { STR: 10, DEX: 10, INT: 10, CON: 10 };
        const tempChar = { id: Utils.generateId(), name, class: cls, level: 1, hp: 20, maxHp: 20, attributes: attrs, equipment: [] };
        const startHp = PartyManager.getEffectiveMaxHp(tempChar);
        const charData = Utils.sanitizeCharacter({ ...tempChar, hp: startHp, maxHp: startHp, portrait: State.tempPortraitData, imagePrompt: State.tempImagePrompt, inventory: [DOM.startItem.value], isNPC: false });
        if (Network.isClient() && Network.isConnected()) {
            Network.sendCharacterCreate(charData);
        } else {
            State.party.push(charData);
            if (Network.isHost() && Network.isConnected()) {
                Network.registerCharacter(Network.playerName, charData.id);
                Network.broadcastState();
            }
        }
        State.tempPortraitData = ""; State.tempImagePrompt = ""; UI.closeCreator(); UI.updateAll();
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

            let imgPrompt = `Fantasy portrait, face only, highly detailed, ${npcClass}, ${npcApp}`.replace(/\n/g, ' ').trim();
            let pUrl = await API.generateImageWithFallbacks([
                imgPrompt,
                `Fantasy portrait, ${npcClass}, ${npcApp}`,
                `Fantasy portrait, face only, highly detailed, ${npcClass}`
            ]);

            State.party.push(Utils.sanitizeCharacter({ id: Utils.generateId(), name: npcName, class: npcClass, hp: 20, maxHp: 20, portrait: pUrl, imagePrompt: imgPrompt, inventory: [], isNPC: true }));
            UI.addChatLog("System", `✨ NPC **${npcName}** schließt sich der Gruppe an!`);
            UI.updateAll();
        } catch (e) {
            UI.addChatLog("System", `⚠️ NPC konnte nicht generiert werden (${e.message}). Bitte erneut versuchen.`);
        } finally {
            UI.showLoader(false);
        }
    },

    spawnNPCFromTag: async function (name, cls, app) {
        UI.addChatLog("System", `⏳ **${name}** tritt der Gruppe bei...`);
        try {
            let imgPrompt = `Fantasy portrait, face only, highly detailed, ${cls}, ${app}`.replace(/\n/g, ' ');
            let p = await API.generateImageWithFallbacks([
                imgPrompt,
                `Fantasy portrait, face only, highly detailed, ${cls}`
            ]);
            State.party.push(Utils.sanitizeCharacter({ id: Utils.generateId(), name, class: cls, hp: 20, maxHp: 20, portrait: p, inventory: [], isNPC: true }));
            UI.addChatLog("System", `✨ **${name}** schließt sich der Gruppe an!`);
            UI.updateAll();
        } catch (e) { console.error('NPC spawn failed:', e); }
    },

    checkEnemies: function () {
        if (State.activeEnemies.length === 0) {
            UI.addChatLog("System", "👁️ **Feindstatus:** Aktuell sind keine lebenden Feinde in Sicht.");
            return;
        }
        let statusText = "👁️ **Feindstatus:**\n";
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

    leaveMerchant: function () { State.activeMerchant = null; UI.updateAll(); UI.addChatLog("System", "Ihr wendet euch vom H�ndler ab."); },

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
                DOM.itemActionTarget.innerHTML = others.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
                DOM.itemActionTarget.disabled = false;
            } else {
                DOM.itemActionTarget.innerHTML = `<option value="">Niemand da</option>`;
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
        if (!confirm(`Bist du sicher, dass du ${amt}x dieses Item unwiderruflich wegwerfen m�chtest?`)) return;
        const cid = DOM.itemActionCid.value;
        const itemName = DOM.itemActionName.value;
        this._submitInventoryAction('DROP_ITEM', { charId: cid, itemName, amount: amt }, { showDetailsId: cid, closeModal: true });
    },
    confirmUseItem: function () {
        const amt = parseInt(document.getElementById('item-action-amount')?.value) || 1;
        const cid = DOM.itemActionCid.value;
        const itemName = DOM.itemActionName.value;
        const c = State.party.find(p => p.id === cid);
        DOM.itemActionModal.classList.add('hidden');
        DOM.playerInput.value = `Nutzt ${amt > 1 ? amt + 'x ' : ''}${itemName} `;
        DOM.actingChar.value = c.name;
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
            DOM.actingChar.value = c.name;
            DOM.playerInput.value = `Ich zeige ${State.activeMerchant.name} mein(e) "${itemName}" und frage: "Wie viel ist das wert? K�nnen wir tauschen?"`;
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
        if (this._requireHost('KI-Vorschlag')) return;
        if (State.craftingIngredients.length === 0) {
            UI.addChatLog("System", "⚠️ Bitte wähle zuerst Zutaten aus, bevor du einen Vorschlag anforderst.");
            return;
        }
        const btn = document.getElementById('btn-craft-suggest');
        if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btn.disabled = true; }

        const materials = State.craftingIngredients.map(ing => ing.itemName).join(', ');

        try {
            let aiText = await API.generateText(`Erfinde einen passenden, gut ausbalancierten Gegenstand, der logisch aus diesen Zutaten hergestellt werden kann: [${materials}]. WICHTIG: Wenn die Zutaten bereits starke Werte oder Fähigkeiten haben, soll dein vorgeschlagener Gegenstand diese Werte logischerweise übernehmen oder ganz leicht verbessern. \n\nDu bist ein Generator. Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt ohne Markdown oder Codeblock-Tags. Nutze ZWINGEND diese exakten Keys: {"name": "Gegenstandsname", "str": Zahl, "dex": Zahl, "int": Zahl, "con": Zahl}. Wähle 1-2 passende weise Attribute aus (Wert 1-3 oder höher falls die Zutaten es rechtfertigen), die anderen 0.`);

            const match = aiText.match(/\{[\s\S]*\}/);
            if (!match) throw new Error("Konnte kein JSON aus Antwort extrahieren.");
            const data = JSON.parse(match[0]);

            DOM.craftTargetItem.value = data.name || "Mysterium";
            const elStr = document.getElementById('craft-stat-str');
            const elDex = document.getElementById('craft-stat-dex');
            const elInt = document.getElementById('craft-stat-int');
            const elCon = document.getElementById('craft-stat-con');

            if (elStr) elStr.value = data.str > 0 ? data.str : "";
            if (elDex) elDex.value = data.dex > 0 ? data.dex : "";
            if (elInt) elInt.value = data.int > 0 ? data.int : "";
            if (elCon) elCon.value = data.con > 0 ? data.con : "";

        } catch (e) {
            UI.addChatLog("System", `⚠️ KI Konnte keinen Vorschlag generieren: ${e.message}`);
        } finally {
            if (btn) { btn.innerHTML = '<i class="fas fa-magic mr-1"></i>Vorschlag'; btn.disabled = false; }
        }
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

        DOM.actingChar.value = crafter ? crafter.name : 'party';
        DOM.playerInput.value = msg;
        this.submitPlayerAction();
    },
    replaceAbility: function (idx) {
        if (!State.pendingAbilityLearning) return;
        const c = State.party.find(p => p.id === State.pendingAbilityLearning.charId);
        if (c && c.abilities[idx]) {
            const oldAb = c.abilities[idx];
            c.abilities[idx] = State.pendingAbilityLearning.newAbility;
            UI.addChatLog("System", `🔄 **${c.name}** hat die alte Fähigkeit **${oldAb}** vergessen und dafür **${State.pendingAbilityLearning.newAbility}** erlernt!`);
        }
        State.pendingAbilityLearning = null;
        document.getElementById('ability-replace-modal').classList.add('hidden');
        UI.updateAll();
    },
    declineNewAbility: function () {
        if (!State.pendingAbilityLearning) return;
        const c = State.party.find(p => p.id === State.pendingAbilityLearning.charId);
        if (c) {
            UI.addChatLog("System", `❌ **${c.name}** hat entschieden, **${State.pendingAbilityLearning.newAbility}** doch nicht zu erlernen.`);
        }
        State.pendingAbilityLearning = null;
        document.getElementById('ability-replace-modal').classList.add('hidden');
    },
    saveApiSettings: function () {
        const provider = document.getElementById('api-provider-select').value;
        localStorage.setItem('api_provider', provider);
        localStorage.setItem('api_key_gemini', document.getElementById('api-key-gemini').value.trim());
        localStorage.setItem('api_key_chatgpt', document.getElementById('api-key-chatgpt').value.trim());
        localStorage.setItem('api_key_openrouter', document.getElementById('api-key-openrouter').value.trim());
        localStorage.setItem('api_key_claude', document.getElementById('api-key-claude').value.trim());
        localStorage.setItem('api_model_claude', document.getElementById('api-model-claude').value.trim() || 'claude-sonnet-4-6');
        localStorage.setItem('api_model_or_text', document.getElementById('api-model-or-text').value.trim() || 'google/gemini-2.5-flash');
        localStorage.setItem('api_model_or_image', document.getElementById('api-model-or-image').value.trim());

        document.getElementById('api-settings-modal').classList.add('hidden');
        UI.addChatLog("System", "🔌 API-Einstellungen gespeichert!");
    },
    savePrompt: function () {
        const inputEl = document.getElementById('new-prompt-input');
        const pt = inputEl.value.trim();
        if (pt) {
            State.savedPrompts = State.savedPrompts || [];
            State.savedPrompts.push(pt);
            inputEl.value = "";
            UI.renderPromptManager();
        }
    },
    insertPrompt: function (idx) {
        const promptText = (State.savedPrompts || [])[idx];
        if (!promptText) return;
        document.getElementById('player-input').value = promptText;
        document.getElementById('prompt-manager-modal').classList.add('hidden');
        document.getElementById('player-input').focus();
    },
    playPrompt: function (idx) {
        const promptText = (State.savedPrompts || [])[idx];
        if (!promptText) return;
        document.getElementById('player-input').value = promptText;
        document.getElementById('prompt-manager-modal').classList.add('hidden');
        this.submitPlayerAction();
    },
    deletePrompt: function (idx) {
        if (State.savedPrompts && State.savedPrompts[idx]) {
            State.savedPrompts.splice(idx, 1);
            UI.renderPromptManager();
        }
    },
    useAbility: function (cid, abilityName, isItemAbility = false) {
        const c = State.party.find(p => p.id === cid);
        const ab = abilityName || c.ability;
        if (c && ab) {
            let cdKey = `${c.id}_${ab}`;
            if (State.abilityCooldowns[cdKey]) {
                UI.addChatLog("System", `⏳ **${ab}** ist noch **${State.abilityCooldowns[cdKey]} Runden** auf Abklingzeit!`);
                return;
            }
            const abLower = ab.toLowerCase();
            const isSummonAbility = abLower.includes('beschw') || abLower.includes('summon') || abLower.includes('kreatur') || abLower.includes('herbeiruf');
            if (isSummonAbility) {
                const existingSummon = State.party.find(p => p.isSummon && p._summonSource === ab);
                if (existingSummon) {
                    UI.addChatLog("System", "Bereits eine Kreatur aus **" + ab + "** aktiv! Nur 1 Wesen pro Beschw" + String.fromCharCode(0x00F6) + "rung.");
                    return;
                }
            }
            DOM.actingChar.value = c.name;
            const currentInput = DOM.playerInput.value.trim();
            const src = isItemAbility ? 'Item-Fähigkeit' : 'Fähigkeit';
            DOM.playerInput.value = currentInput + ` Ich setze meine ${src}: "${ab}" ein. `;

            if (isSummonAbility) {
                let cdKey2 = c.id + '_' + ab;
                State.abilityCooldowns[cdKey2] = SUMMON_COOLDOWN;
            }
            DOM.playerInput.focus();
            UI.hideDetails();
        }
    },
    undoLastAction: function () {
        if (!State.undoSnapshot) {
            UI.addChatLog("System", "↩️ Kein Rückgängig-Snapshot vorhanden (nur die letzte Aktion kann rückgängig gemacht werden).");
            return;
        }
        const snap = { ...State.undoSnapshot };
        snap.party = (snap.party || []).map(c => Utils.sanitizeCharacter(c));
        dispatch({ type: 'RESTORE_SNAPSHOT', snapshot: snap });
        UI.updateAll();
        UI.addChatLog("System", "↩️ **Letzte Aktion rückgängig gemacht.** (Spielzustand wiederhergestellt)");
    },
    upgradeStat: function (cid, key) { const c = State.party.find(p => p.id === cid); if (c && c.statPoints > 0) { c.attributes[key]++; c.statPoints--; UI.showDetails(cid); UI.updateAll(); } },
    removeCharacter: function (id) { const idx = State.party.findIndex(c => c.id === id); if (idx > -1) { State.party.splice(idx, 1); UI.hideDetails(); UI.updateAll(); } },
    exportHero: function (id) { const c = State.party.find(p => p.id === id); if (!c) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(c)], { type: 'application/json' })); a.download = `Hero_${c.name}.json`; document.body.appendChild(a); a.click(); },
    bulkExportHeroes: async function () {
        const heroes = State.party.filter(p => !p.isSummon);
        if (heroes.length === 0) {
            UI.addChatLog("System", "⚠️ Keine Helden zum Exportieren vorhanden.");
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
        UI.addChatLog("System", `💾 **${heroes.length} Helden** wurden erfolgreich exportiert (Sammel-Download).`);
    },
    downloadSave: function () { const now = new Date(); const pad = n => n.toString().padStart(2, '0'); const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(State)], { type: 'application/json' })); a.download = `InfiniteDungeon_${ts}.json`; document.body.appendChild(a); a.click(); },
    importSave: function (e) {
        if (!e.target.files[0]) return;
        const r = new FileReader();
        r.onload = (ev) => {
            try {
                let data = JSON.parse(ev.target.result);
                data = validateSaveData(data);
                const allowed = Object.keys(State);
                Object.keys(data).forEach(k => { if (!allowed.includes(k)) delete data[k]; });
                Object.assign(State, data);
                State.targetMapMode = false;
                if (State.party) State.party = State.party.filter(c => typeof c === 'object' && c.name).map(c => Utils.sanitizeCharacter(c));
                UI.toggleViews(State.gameStarted);
                UI.updateAll();
            } catch (err) {
                UI.addChatLog('System', `⚠️ Save-Import fehlgeschlagen: ${err.message}`);
            }
        };
        r.readAsText(e.target.files[0]);
        e.target.value = "";
    },
    importHero: function (e) {
        if (!e.target.files[0]) return;
        const r = new FileReader();
        r.onload = (ev) => {
            try {
                let h = JSON.parse(ev.target.result);
                h = validateHeroData(h);
                h.id = Utils.generateId();
                const hero = Utils.sanitizeCharacter(h);
                if (Network.isClient() && Network.isConnected()) {
                    Network.sendCharacterCreate(hero);
                } else {
                    State.party.push(hero);
                    if (Network.isHost() && Network.isConnected()) {
                        Network.registerCharacter(Network.playerName, hero.id);
                        Network.broadcastState();
                    }
                    UI.updateAll();
                }
            } catch (err) {
                UI.addChatLog('System', `?? Hero-Import fehlgeschlagen: ${err.message}`);
            }
        };
        r.readAsText(e.target.files[0]);
        e.target.value = "";
    }
};
