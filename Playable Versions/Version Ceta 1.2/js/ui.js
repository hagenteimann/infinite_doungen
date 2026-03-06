/* ==========================================
   3. DOM CACHING (Performance Setup)
   ========================================== */
const DOM = {};
const initDOM = () => {
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
        'tab-party', 'tab-journal', 'tab-stats', 'tab-bestiary',
        'tab-content-party', 'tab-content-journal', 'tab-content-stats', 'tab-content-bestiary'
    ];
    ids.forEach(id => {
        const camelCaseId = id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        DOM[camelCaseId] = document.getElementById(id);
    });
};

/* ==========================================
   8. UI RENDERING (Templates & DOM Updates)
   ========================================== */
const UIBuilders = {
    buildHeroCard: function (c) {
        const isDead = c.hp === 0;
        const borderClass = isDead ? 'border-red-900 shadow-[0_0_15px_rgba(220,38,38,0.3)] grayscale opacity-80' :
            (c.isSummon ? 'border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]' :
                (c.isNPC ? 'border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-white/10 hover:border-amber-500/50 shadow-[0_4px_15px_rgba(0,0,0,0.5)] hover:shadow-[0_0_20px_rgba(245,158,11,0.2)]'));
        const nameColor = isDead ? 'text-red-500 line-through' :
            (c.isSummon ? 'text-purple-400 drop-shadow-[0_0_5px_rgba(168,85,247,0.5)]' :
                (c.isNPC ? 'text-blue-400 drop-shadow-[0_0_5px_rgba(96,165,250,0.5)]' : 'text-amber-400 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)]'));
        const badge = isDead ? '💀' : (c.isSummon ? '🌀' : '👤');
        const effMaxHp = PartyManager.getEffectiveMaxHp(c);
        if (c.hp > effMaxHp) c.hp = effMaxHp;
        const hpPercent = (c.hp / effMaxHp) * 100;
        const hpGlowClass = isDead ? 'hp-glow-dead' : (hpPercent > 75 ? 'hp-glow-high' : (hpPercent > 25 ? 'hp-glow-mid' : 'hp-glow-low'));

        const portraitHtml = c.portrait ? `<img src="${c.portrait}" class="w-10 h-10 rounded-lg object-cover bg-black/50 border ${hpGlowClass} shadow-sm">` : `<div class="w-10 h-10 rounded-lg bg-black/50 flex items-center justify-center border border-white/10 text-[10px] shadow-sm">${badge}</div>`;

        return `<div class="bg-black/30 backdrop-blur-md p-2 rounded-xl border ${borderClass} flex gap-2.5 items-center cursor-pointer group transition-all" onclick="App.UI.handleEntityClick('${c.name.replace(/'/g, "\\'")}', 'hero', '${c.id}')">
            ${portraitHtml}
            <div class="flex-1">
                <div class="flex justify-between text-[11px] font-bold tracking-wide"><span class="${nameColor}">${c.name} <span class="text-slate-500 text-[9px] font-normal ml-0.5">Lvl ${c.level}</span></span><span class="${isDead ? 'text-red-500' : 'text-slate-300 font-mono'}">${c.hp}/${effMaxHp}</span></div>
                <div class="w-full bg-black/60 h-1.5 rounded-full mt-1.5 border border-white/5 overflow-hidden"><div class="${c.isNPC ? (c.isSummon ? 'bg-gradient-to-r from-purple-700 to-purple-400' : 'bg-gradient-to-r from-blue-700 to-blue-400') : 'bg-gradient-to-r from-red-700 to-red-400'} h-full rounded-full transition-all duration-500" style="width: ${(c.hp / effMaxHp) * 100}%"></div></div>
            </div>
            <button onclick="event.stopPropagation(); App.Engine.removeCharacter('${c.id}')" class="opacity-0 group-hover:opacity-100 p-1.5 text-red-500/70 hover:text-red-400 transition-colors bg-white/5 rounded-lg hover:bg-white/10"><i class="fas fa-trash text-[10px]"></i></button>
        </div>`;
    },
    buildEnemyCard: function (e, isDeadFlag) {
        const isDead = isDeadFlag || e.hp <= 0;
        const hpDisplay = isDead ? 0 : e.hp;
        const hpBarWidth = isDead ? 0 : (e.hp / e.maxHp) * 100;
        const hoverClass = isDead ? '' : 'cursor-pointer hover:border-red-400/80 transition-all hover:shadow-[0_0_15px_rgba(248,113,113,0.3)] hover:bg-red-950/20';
        return `<div class="bg-black/30 backdrop-blur-sm p-2 rounded-xl border ${isDead ? 'border-slate-800' : 'border-red-900/50 shadow-[0_4px_10px_rgba(0,0,0,0.5)]'} flex gap-2.5 items-center fade-in ${isDead ? 'defeated-enemy' : ''} ${hoverClass}" ${!isDead ? `onclick="App.UI.handleEntityClick('${e.name.replace(/'/g, "\\'")}', 'enemy', '${e.id}')"` : ''}>
            ${e.portrait ? `<img src="${e.portrait}" class="w-10 h-10 rounded-lg object-cover ${isDead ? '' : 'border border-red-900/50 shadow-[0_0_10px_rgba(127,29,29,0.5)]'}">` : `<div class="w-10 h-10 rounded-lg bg-black/60 ${isDead ? '' : 'border border-red-900/50 shadow-[0_0_10px_rgba(127,29,29,0.5)]'} flex items-center justify-center text-red-500/50"><i class="fas fa-skull"></i></div>`}
            <div class="flex-1 min-w-0">
                <div class="flex justify-between text-[10px] truncate tracking-wide"><span class="${isDead ? 'line-through text-slate-600' : 'text-slate-200'}">${e.name}</span><span class="${isDead ? 'text-slate-600' : 'text-red-400 font-mono font-bold drop-shadow-[0_0_2px_rgba(248,113,113,0.8)]'}">${hpDisplay}/${e.maxHp}</span></div>
                <div class="w-full bg-black/60 h-1.5 rounded-full mt-1.5 overflow-hidden border border-white/5"><div class="${isDead ? 'bg-slate-700' : 'bg-gradient-to-r from-red-800 to-red-500'} h-full transition-all duration-500" style="width: ${hpBarWidth}%"></div></div>
            </div>
        </div>`;
    }
};

const UI = {
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
                <button title="Einfügen" onclick="App.Engine.insertPrompt(${idx})" class="text-blue-400 hover:text-blue-300 p-1.5 transition-colors"><i class="fas fa-paste"></i></button>
                <button title="Spielen" onclick="App.Engine.playPrompt(${idx})" class="text-emerald-400 hover:text-emerald-300 p-1.5 transition-colors"><i class="fas fa-play"></i></button>
                <button title="Löschen" onclick="App.Engine.deletePrompt(${idx})" class="text-opacity-50 text-red-500 hover:text-opacity-100 p-1.5 transition-opacity"><i class="fas fa-trash"></i></button>
            </div>`;
        }).join('');
        document.getElementById('prompt-list').innerHTML = listHtml || '<p class="text-slate-500 text-xs text-center italic mt-2">Noch keine Prompts gespeichert.</p>';
    },

    switchTab: function (tab) {
        ['party', 'journal', 'stats', 'bestiary'].forEach(t => {
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
        if (tab === 'bestiary') this.renderBestiary();
    },

    renderJournal: function () {
        if (!DOM.journalContent) return;
        if (State.journal.length === 0) {
            DOM.journalContent.innerHTML = '<p class="text-slate-500 italic">Noch keine Einträge. Starte ein Abenteuer und klicke ✨ Update!</p>';
            return;
        }
        DOM.journalContent.innerHTML = State.journal.map((e, i) => `
            <div class="journal-entry fade-in">
                <div class="flex justify-between text-[9px] text-slate-500 mb-1">
                    <span>Eintrag #${State.journal.length - i}</span>
                    <span>${e.timestamp}</span>
                </div>
                <p class="text-slate-300 leading-relaxed">${e.text}</p>
            </div>
        `).join('');
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
            </div>
        `;
    },

    renderBestiary: function () {
        const el = document.getElementById('bestiary-content');
        if (!el) return;
        const entries = Object.values(State.bestiary || {});
        if (entries.length === 0) {
            el.innerHTML = '<p class="text-slate-500 italic text-center mt-4">Noch keine Monster besiegt. K\u00e4mpfe und besiege Feinde!</p>';
            return;
        }
        el.innerHTML = entries.map(e => {
            const portrait = e.portrait
                ? `<img src="${e.portrait}" class="w-9 h-9 rounded-lg object-cover border border-red-900/50 shadow-[0_0_6px_rgba(127,29,29,0.5)] flex-shrink-0">`
                : `<div class="w-9 h-9 rounded-lg bg-black/60 border border-red-900/40 flex items-center justify-center text-red-500/60 flex-shrink-0"><i class="fas fa-skull text-sm"></i></div>`;
            return `<div class="bg-black/30 border border-slate-800 rounded-xl p-2 flex gap-2.5 items-center fade-in">
                ${portrait}
                <div class="flex-1 min-w-0">
                    <div class="text-slate-200 text-[11px] font-bold truncate">${e.name}</div>
                    <div class="text-[9px] text-slate-500 mt-0.5">Max HP: <span class="text-red-400">${e.maxHp}</span> &nbsp;&#x2022;&nbsp; Besiegt: <span class="text-amber-400 font-bold">${e.timesDefeated}\u00d7</span></div>
                </div>
            </div>`;
        }).join('');
    },

    toggleTargetMode: function () {
        State.targetMapMode = !State.targetMapMode;
        this.renderBestiary();
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
        DOM.partyList.innerHTML = State.party.map(UIBuilders.buildHeroCard).join('');
        DOM.actingChar.innerHTML = '<option value="party">Gruppe</option>' + State.party.filter(p => !p.isSummon && p.hp > 0).map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        DOM.enemySection.classList.toggle('hidden', !State.activeEnemies.length && !State.defeatedEnemies.length);
        DOM.enemyHistoryContainer.innerHTML = State.defeatedEnemies.map(e => UIBuilders.buildEnemyCard(e, true)).join('');
        DOM.currentEnemyContainer.innerHTML = State.activeEnemies.map(e => UIBuilders.buildEnemyCard(e, false)).join('');

        // Loot section with null checks
        if (DOM.lootDropSection && DOM.lootList) {
            const hadLoot = !DOM.lootDropSection.classList.contains('hidden');
            DOM.lootDropSection.classList.toggle('hidden', !State.lootDrops.length);
            DOM.lootList.innerHTML = State.lootDrops.map((it, idx) => {
            const formatted = App.UI.formatItemDisplay(it);
            const titleAttr = formatted.hasEffects ? `title="${formatted.tooltip.replace(/"/g, '&quot;')}"` : '';
            const effectIcon = formatted.hasEffects ? `<i class="fas fa-info-circle text-amber-500/70 ml-1 text-[8px]" ${titleAttr}></i>` : '';
            return `<div class="text-[10px] bg-amber-950/60 p-1.5 rounded border border-amber-800/50 flex justify-between items-center mt-1.5 shadow-sm loot-item-entrance" ${titleAttr}><span class="text-amber-300 font-mono truncate mr-2 flex-1">+ ${formatted.displayName} ${effectIcon}</span><select onchange="App.Engine.assignLoot(${idx}, this.value)" class="bg-slate-800 text-slate-300 border border-slate-600 rounded outline-none p-1 max-w-[85px] cursor-pointer"><option value="">Geben...</option>${State.party.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>`;
        }).join('');

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
            DOM.merchantItems.innerHTML = State.activeMerchant.items.map(it => `<div class="bg-blue-950/60 p-1.5 rounded border border-blue-800/50 flex justify-between items-center mt-1.5 shadow-sm"><span class="text-blue-200">${it}</span></div>`).join('');
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

                    const dungeonLevelEl = document.getElementById('hud-dungeon-level');
                    if (dungeonLevelEl) dungeonLevelEl.innerText = ` (/10)`;
                }
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

            let html = '<h3 class="text-indigo-400 text-[10px] font-bold uppercase mb-2 tracking-widest flex items-center gap-2"><i class="fas fa-dice-d20"></i> Erforderliche DM-Proben</h3><div class="space-y-1.5">';
            State.pendingRolls.forEach(r => {
                let dt = r.diceType || 'W20';
                let btnClass = dt === 'W6' ? 'bg-blue-600 hover:bg-blue-500' : (dt === 'W40' ? 'bg-purple-600 hover:bg-purple-500' : 'bg-indigo-600 hover:bg-indigo-500');
                let textClass = dt === 'W6' ? 'text-blue-400' : (dt === 'W40' ? 'text-purple-400' : 'text-indigo-400');

                let status = r.rolled ? (r.result >= r.dc ? `<span class="text-green-400 text-xs font-bold flex items-center gap-1 bg-green-900/20 px-2 py-1 rounded border border-green-700/50"><i class="fas fa-check"></i> Erfolg (${r.result})</span>` : `<span class="text-red-400 text-xs font-bold flex items-center gap-1 bg-red-900/20 px-2 py-1 rounded border border-red-700/50"><i class="fas fa-times"></i> Fehl (${r.result})</span>`) : `<div id="roll-status-${r.id}"><button onclick="App.Engine.rollSpecific('${r.id}')" class="${btnClass} px-3 py-1 rounded text-white text-[10px] font-bold shadow-md transition-all">${dt} Werfen</button></div>`;
                let modHtml = r.stat ? `<span class="bg-slate-800 text-slate-300 px-1 py-0.5 rounded text-[9px] ml-1 font-mono align-middle border border-slate-600/50">${r.stat} ${r.mod >= 0 ? '+' + r.mod : r.mod}</span>` : '';

                html += `<div class="flex justify-between items-center bg-slate-900/80 border border-slate-700 p-2.5 rounded-lg shadow-sm">
                    <div class="text-[11px] leading-tight"><span class="text-amber-400 font-bold text-xs">${r.name}</span> <span class="text-[10px] ${textClass} font-mono font-bold">[${dt}]</span>${modHtml}<br><span class="text-slate-300 block mt-1">${r.desc} <span class="text-slate-500 ml-1 font-mono">(DC ${r.dc})</span></span></div>
                    <div>${status}</div>
                </div>`;
            });
            html += '</div>';

            if (State.pendingRolls.some(r => !r.rolled)) {
                html += `<button id="btn-roll-all" onclick="App.Engine.rollAllPending()" class="mt-3 w-full bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 py-2 rounded text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm"><i class="fas fa-dice mr-1"></i> Alle automatisch auswürfeln</button>`;
            } else {
                html += `<button onclick="App.Engine.submitPendingRolls()" class="mt-3 w-full bg-green-600 hover:bg-green-500 text-white py-2 rounded text-xs font-bold animate-pulse shadow-[0_0_15px_rgba(34,197,94,0.4)]">Ergebnisse bestätigen & fortfahren</button>`;
            }
            DOM.actionBoxContainer.innerHTML = html;
        } else {
            DOM.actionBoxContainer.classList.add('hidden');
            DOM.playerInput.disabled = false; DOM.sendBtn.disabled = false;
            DOM.playerInput.placeholder = "Was tut ihr?";
        }
    },

    addChatLog: function (s, t) {
        const d = document.createElement('div');
        const isAI = s === 'DM' || s.includes('Orakel'), isSys = s.includes('System') || s.includes('Schicksal');
        d.className = `p-4 rounded-xl relative fade-in mb-4 ${isAI ? 'bg-black/40 backdrop-blur-md border border-white/10 border-l-4 border-l-purple-500 shadow-[0_4px_20px_rgba(0,0,0,0.5)]' : (isSys ? 'bg-black/30 backdrop-blur-sm border border-white/5 italic text-xs text-slate-400 shadow-inner' : 'bg-purple-900/20 backdrop-blur-sm border border-purple-500/20 ml-12 text-right shadow-[0_4px_15px_rgba(168,85,247,0.1)]')}`;

        let formattedText = t;
        // Bold and Italic Markdown
        formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-amber-300 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)] tracking-wide">$1</strong>');
        formattedText = formattedText.replace(/\*(.*?)\*/g, '<em class="text-slate-300">$1</em>');
        // Line breaks
        formattedText = formattedText.replace(/\n/g, '<br>');

        const titleSizeClass = isAI ? 'text-[10px] font-bold uppercase mb-2 tracking-[0.2em]' : 'text-[9px] font-bold uppercase mb-1 tracking-wider';
        const titleColorClass = isAI ? 'text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.6)]' : (isSys ? 'text-slate-500' : 'text-amber-400 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)]');
        const textSizeClass = isAI ? 'text-sm md:text-base leading-relaxed text-slate-200' : 'text-sm md:text-base leading-relaxed text-slate-300';

        d.innerHTML = `<div class="${titleSizeClass} ${titleColorClass}">${s}</div><div class="${textSizeClass}">${formattedText}</div>`;
        DOM.storyLog.appendChild(d); DOM.storyLog.scrollTop = DOM.storyLog.scrollHeight;
    },

    showCreator: function () { DOM.creatorModal.classList.remove('hidden'); },
    showAbilityReplaceModal: function (charId, newAbility) {
        const c = State.party.find(p => p.id === charId);
        if (!c) return;
        document.getElementById('ar-char-name').innerText = c.name;
        document.getElementById('ar-new-ability').innerText = newAbility;

        const listHtml = c.abilities.map((ab, idx) => `
            <button onclick="App.Engine.replaceAbility(${idx})" class="w-full text-left bg-red-900/40 hover:bg-red-800/60 border border-red-700/50 p-2.5 rounded-lg transition-colors flex justify-between items-center group shadow-sm mb-1.5">
                <span class="text-[11px] text-red-200 font-bold"><i class="fas fa-trash-alt mr-2 opacity-50 group-hover:opacity-100 group-hover:text-red-400"></i> ${ab} verlernen</span>
            </button>
        `).join('');
        document.getElementById('ar-ability-list').innerHTML = listHtml;
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
                        const formatted = App.UI.formatItemDisplay(it);
                        const titleAttr = formatted.hasEffects ? `title="${formatted.tooltip.replace(/"/g, '&quot;')}"` : '';
                        const effectIcon = formatted.hasEffects ? `<i class="fas fa-info-circle text-slate-500 ml-1 text-[8px]" ${titleAttr}></i>` : '';
                        charInvHtml += `<div class="flex justify-between items-center bg-slate-900 hover:bg-slate-800 p-1.5 rounded border border-slate-700/50 cursor-pointer mb-1 transition-colors group" onclick="App.Engine.addCraftingIngredient('${c.id}', '${it.replace(/'/g, "\\'").replace(/"/g, "&quot;")}')" ${titleAttr}>
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
                const formatted = App.UI.formatItemDisplay(ing.itemName);
                const titleAttr = formatted.hasEffects ? `title="${formatted.tooltip.replace(/"/g, '&quot;')}"` : '';
                const effectIcon = formatted.hasEffects ? `<i class="fas fa-info-circle text-indigo-400/50 ml-1 text-[8px]" ${titleAttr}></i>` : '';
                return `<div class="flex justify-between items-center bg-indigo-900/40 hover:bg-indigo-900/80 p-1.5 rounded border border-indigo-700/50 cursor-pointer mb-1 shadow-sm transition-colors group" onclick="App.Engine.removeCraftingIngredient(${idx})" ${titleAttr}>
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

        const aHtml = Object.entries(c.attributes).map(([k, v]) => {
            const bonus = effAttrs[k] - v;
            const bonusHtml = bonus !== 0 ? `<span class="${bonus > 0 ? 'text-green-400' : 'text-red-400'} font-bold ml-1">${bonus > 0 ? '+' : ''}${bonus}</span>` : '';
            return `<div class="flex justify-between items-center bg-slate-800/50 p-1.5 rounded mb-1 border border-slate-700/50"><span class="text-slate-400 font-bold text-[9px] w-8">${k}</span><span class="text-amber-400 font-mono flex-1 text-center text-[11px]">${v}${bonusHtml}</span>${c.statPoints > 0 ? `<button onclick="App.Engine.upgradeStat('${c.id}', '${k}')" class="bg-green-700 text-white w-5 h-5 rounded">+</button>` : '<div class="w-5"></div>'}</div>`;
        }).join('');

        const sumBadge = c.isSummon ? `<span class="text-purple-400 text-[8px] border border-purple-500 px-1 rounded ml-1">Kreatur</span>` : '';
        const detailPortraitHtml = c.portrait ? `<img src="${c.portrait}" class="w-20 h-20 mx-auto rounded border-2 ${c.isNPC ? (c.isSummon ? 'border-purple-600' : 'border-blue-600') : 'border-slate-600'}">` : `<div class="w-20 h-20 mx-auto rounded border-2 ${c.isNPC ? (c.isSummon ? 'border-purple-600' : 'border-blue-600') : 'border-slate-600'} bg-slate-800 flex items-center justify-center text-4xl">${c.isSummon ? '🌀' : '👤'}</div>`;

        DOM.detailsContent.innerHTML = `
            <div class="text-center">${detailPortraitHtml}
            <h3 class="cinzel text-amber-400 text-sm mt-2">${c.name} ${sumBadge}</h3><p class="text-[8px] opacity-50 mb-1">${c.class} • Lvl ${c.level}</p>
            <div class="w-3/4 mx-auto bg-slate-900 h-1 rounded-full"><div class="bg-purple-500 h-full" style="width: ${(c.xp / (c.level * 100)) * 100}%"></div></div><p class="text-[7px] text-slate-500 mb-3">${c.xp}/${c.level * 100} XP</p></div>
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
                    return `<div onclick="${onCooldown ? '' : `App.Engine.useAbility('${c.id}', '${safeAb}')`}" class="mb-2 p-1.5 ${onCooldown ? 'bg-slate-800/60 border-slate-600/50 opacity-60 cursor-not-allowed' : 'bg-amber-900/40 hover:bg-amber-800/80 border-amber-700/50 hover:border-amber-500 cursor-pointer'} border rounded text-center text-[9px] shadow-sm transition-all ${onCooldown ? '' : 'shadow-[0_0_10px_rgba(245,158,11,0.2)] hover:shadow-[0_0_15px_rgba(245,158,11,0.4)]'} group"><span class="${onCooldown ? 'text-slate-500' : 'text-amber-500'} font-bold block mb-0.5 ${onCooldown ? '' : 'group-hover:animate-pulse'}">${onCooldown ? '<i class="fas fa-hourglass-half"></i> Abklingzeit' : '<i class="fas fa-meteor"></i> Fähigkeit (Klicken)'}:</span>${ab}${cdBarHtml}</div>`;
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
                    return `<div onclick="App.Engine.useAbility('${c.id}', '${safeEffect}', true)" class="mb-2 p-1.5 bg-teal-900/30 hover:bg-teal-800/50 border border-teal-700/40 hover:border-teal-500 rounded text-center text-[9px] cursor-pointer shadow-sm transition-all shadow-[0_0_10px_rgba(20,184,166,0.15)] hover:shadow-[0_0_15px_rgba(20,184,166,0.3)] group"><span class="text-teal-400 font-bold block mb-0.5 group-hover:animate-pulse"><i class="fas fa-gem"></i> ${ia.source}:</span>${ia.effect}</div>`;
                }).join('') + '</div>';
            })()}
            
            ${(c.talents && c.talents.length > 0) ? `<div class="mb-3"><h4 class="text-[9px] font-bold border-b border-slate-700 pb-1 mb-2 text-emerald-400 uppercase">Spezialisierung</h4><div class="flex flex-wrap gap-1">${c.talents.map(t => `<span class="bg-emerald-900/30 border border-emerald-500/30 text-emerald-200 px-2 py-0.5 rounded text-[10px]"><i class="fas fa-leaf mr-1 opacity-70"></i>${t}</span>`).join('')}</div></div>` : ''}
            
            ${(c.pendingTalentPoints > 0 && TALENT_TREES[c.class]) ? `<div class="mb-3 p-2 border border-emerald-500/50 rounded bg-emerald-950/30 shadow-inner"><div class="text-[10px] text-emerald-400 font-bold mb-2 uppercase tracking-wider"><i class="fas fa-star animate-pulse mr-1"></i> Talent wählbar!</div><div class="flex gap-1.5">` +
                Object.keys(TALENT_TREES[c.class]).map(lvlReq => {
                    if (c.level >= parseInt(lvlReq) && TALENT_TREES[c.class][lvlReq].some(t => !c.talents.includes(t))) {
                        return TALENT_TREES[c.class][lvlReq].filter(t => !c.talents.includes(t)).map(t => `<button onclick="App.Engine.learnTalent('${c.id}', '${t}')" class="flex-1 bg-emerald-700/50 hover:bg-emerald-600/70 border border-emerald-500/50 text-white text-[9px] font-bold py-1.5 rounded shadow-sm transition-colors">${t}</button>`).join('');
                    }
                    return '';
                }).join('') + `</div></div>` : ''}

            <div><h4 class="text-[9px] font-bold border-b border-slate-700 pb-1 mb-2">ATTRIBUTE ${sBadge}</h4>${aHtml}</div>
            <div class="mt-3">
                <h4 class="text-[9px] font-bold border-b border-slate-700 pb-1 mb-2 text-indigo-300">AUSRÜSTUNG</h4>
                <ul id="equipment-list-${c.id}" class="text-[10px] space-y-1.5 mb-3"></ul>
                <h4 class="text-[9px] font-bold border-b border-slate-700 pb-1 mb-2">INVENTAR</h4>
                <ul id="inventory-list-${c.id}" class="text-[10px] space-y-1.5"></ul>
                <button onclick="App.Engine.startCrafting('${c.id}')" class="w-full mt-2 bg-indigo-700/40 hover:bg-indigo-600/60 border border-indigo-500/50 text-indigo-200 text-[10px] py-1.5 rounded font-bold shadow-sm transition-all"><i class="fas fa-hammer mr-1"></i> Schmiede / Verzaubern</button>
            </div>`;

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

        document.getElementById(`equipment-list-${c.id}`).innerHTML = activeSetsHtml + Array.from(eqMap.entries()).map(([it, count]) => {
            const safeIt = it.replace(/'/g, "\\'").replace(/"/g, "&quot;");
            const countHtml = count > 1 ? `<span class="text-indigo-400 font-bold ml-1">(x${count})</span>` : '';
            const formatted = App.UI.formatItemDisplay(it);
            const titleAttr = formatted.hasEffects ? `title="${formatted.tooltip.replace(/"/g, '&quot;')}"` : '';
            const effectIcon = formatted.hasEffects ? `<i class="fas fa-info-circle text-indigo-400/70 ml-1 text-[8px]" ${titleAttr}></i>` : '';
            return `<li onclick="App.Engine.handleItemClick('${c.id}', '${safeIt}', true)" class="bg-indigo-900/30 p-1.5 rounded cursor-pointer hover:bg-indigo-800/50 border border-indigo-700/50 flex justify-between group transition-colors" ${titleAttr}><span class="text-indigo-200">• ${formatted.displayName} ${effectIcon} ${countHtml}</span> <i class="fas fa-hand-pointer opacity-0 group-hover:opacity-100 text-indigo-400 mt-0.5"></i></li>`;
        }).join('') || '<li class="text-slate-500 italic">Nichts ausgerüstet</li>';

        const invMap = new Map();
        c.inventory.forEach(it => { invMap.set(it, (invMap.get(it) || 0) + 1); });
        document.getElementById(`inventory-list-${c.id}`).innerHTML = Array.from(invMap.entries()).map(([it, count]) => {
            const safeIt = it.replace(/'/g, "\\'").replace(/"/g, "&quot;");
            const countHtml = count > 1 ? `<span class="text-amber-500 font-bold ml-1">(x${count})</span>` : '';
            const formatted = App.UI.formatItemDisplay(it);
            const titleAttr = formatted.hasEffects ? `title="${formatted.tooltip.replace(/"/g, '&quot;')}"` : '';
            const effectIcon = formatted.hasEffects ? `<i class="fas fa-info-circle text-amber-500/70 ml-1 text-[8px]" ${titleAttr}></i>` : '';
            return `<li onclick="App.Engine.handleItemClick('${c.id}', '${safeIt}', false, ${count})" class="bg-slate-800/50 p-1.5 rounded cursor-pointer hover:bg-slate-700 border border-slate-700/50 flex justify-between group transition-colors" ${titleAttr}><span>• ${formatted.displayName} ${effectIcon} ${countHtml}</span> <i class="fas fa-hand-pointer opacity-0 group-hover:opacity-100 text-slate-400 mt-0.5"></i></li>`;
        }).join('') || '<li class="text-slate-500 italic">Leer</li>';

        DOM.exportHeroBtn.onclick = () => App.Engine.exportHero(c.id);
    },
    hideDetails: function () { DOM.charDetails.classList.add('hidden'); DOM.partyList.classList.remove('hidden'); },

    showAnimatedDiceModal: function (name, targetDC, modifier, callback, closeAfter = true, diceType = 'W20') {
        Sound.play('dice');
        let sides = 20;
        if (diceType && diceType.toUpperCase().startsWith('W')) {
            sides = parseInt(diceType.substring(1)) || 20;
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
            if (count > 15) {
                clearInterval(ival);
                const finalRawRoll = Math.floor(Math.random() * sides) + 1;
                const totalResult = finalRawRoll + modifier;

                State.sessionStats.diceRolls.push(finalRawRoll);
                if (finalRawRoll > State.sessionStats.highestRoll) State.sessionStats.highestRoll = finalRawRoll;
                if (finalRawRoll < State.sessionStats.lowestRoll) State.sessionStats.lowestRoll = finalRawRoll;

                const success = totalResult >= targetDC;
                DOM.diceQualityLabel.innerHTML = success ? "Erfolg <i class='fas fa-check'></i>" : "Fehlschlag <i class='fas fa-times'></i>";
                DOM.diceQualityLabel.className = `text-2xl cinzel font-bold uppercase tracking-widest mb-4 drop-shadow-lg h-8 ${success ? 'text-green-400' : 'text-red-500'}`;

                if (success && finalRawRoll === sides) Sound.play('crit');
                else if (!success) Sound.play('fail');

                let modStr = modifier !== 0 ? `<span class="text-4xl text-slate-400 mx-2">${modifier >= 0 ? '+' : ''}${modifier}</span><span class="text-7xl">=${totalResult}</span>` : '';
                DOM.diceResult.innerHTML = `<span class="text-7xl">${finalRawRoll}</span>${modStr}`;
                DOM.diceResult.className = `font-bold cinzel mb-6 mt-4 transition-all duration-300 scale-110 drop-shadow-[0_0_20px_rgba(255,255,255,0.5)] ${success ? 'text-green-300' : 'text-red-400'}`;

                setTimeout(() => {
                    if (closeAfter) DOM.diceModal.classList.add('hidden');
                    if (callback) callback(totalResult, success, finalRawRoll);
                }, 1800);
            }
        }, 60);
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
