import { State, dispatch } from './state.js';
import { Sound } from './sound.js';
import { DOM, UI } from './ui.js';
import { Utils } from './utils.js';
import { PartyManager } from './party.js';
import { CombatManager } from './combat.js';
import { Engine } from './engine.js';
import { sanitize } from './sanitize.js';
import { ABILITY_LIMIT, DEATH_SAVE_DC } from './constants.js';

export const TagParser = {
    process: function (text) {
        const tagRegex = /\[(Schaden|Gegner[\s\-]*Schaden|Heilung|Gegner|GegnerTot|GegnerFlucht|Beute|Verbraucht|KampfBeendet|XP|NeuerNPC|Tausch|EndgueltigTot|Haendler|Faehigkeit|Cooldown|Flucht|Gold|DeathSave)[\s:]*(.*?)\]/gi;
        let match;
        while ((match = tagRegex.exec(text)) !== null) {
            let type = match[1].toLowerCase().replace(/[\s\-]+/g, '');
            let argsStr = match[2] || "";
            let args = argsStr.includes(',') ? argsStr.split(',').map(s => s.trim()) : argsStr.split(/\s+/).map(s => s.trim());
            let targetName = args[0] || ""; let amount = parseInt(args[1]);
            if (args.length > 1 && isNaN(amount) && !isNaN(parseInt(args[0]))) { amount = parseInt(args[0]); targetName = args.slice(1).join(' '); }
            else if (args.length > 1 && !isNaN(amount)) { if (!argsStr.includes(',')) { targetName = args.slice(0, args.length - 1).join(' '); amount = parseInt(args[args.length - 1]); } }
            this.applyEvent(type, targetName, amount || 0, argsStr);
        }
        CombatManager.cleanupDead(); UI.updateAll();
    },
    applyEvent: function (type, targetName, amount, rawArgs) {
        if (['schaden', 'gegnerschaden', 'heilung', 'xp'].includes(type)) {
            if (isNaN(amount) || amount < 0) return;
        }

        if (type === 'gegnerschaden') {
            let e = Utils.findTarget(State.activeEnemies, targetName);
            if (e) CombatManager.damage(e, amount);
            else UI.addChatLog("System", `⚠️ Mechanik verworfen: Feind '${targetName}' nicht gefunden.`);
        }
        else if (type === 'schaden') {
            let c = Utils.findTarget(State.party, targetName);
            if (c) PartyManager.damage(c, amount);
            else {
                let e = Utils.findTarget(State.activeEnemies, targetName);
                if (e) CombatManager.damage(e, amount);
                else UI.addChatLog("System", `⚠️ Mechanik verworfen: Ziel '${targetName}' für Schaden nicht gefunden.`);
            }
        }
        else if (type === 'heilung') {
            let c = Utils.findTarget(State.party, targetName);
            if (c) PartyManager.heal(c, amount);
            else UI.addChatLog("System", `⚠️ Mechanik verworfen: Ziel '${targetName}' für Heilung nicht gefunden.`);
        }
        else if (type === 'gegner') {
            let sArgs = rawArgs.includes(',') ? rawArgs.split(',').map(s => s.trim()) : rawArgs.split(/\s+/).map(s => s.trim());
            let sName = sArgs[0] || "Gegner"; let sHp = parseInt(sArgs[1]) || 20;
            if (!isNaN(parseInt(sArgs[0])) && isNaN(parseInt(sArgs[1]))) { sHp = parseInt(sArgs[0]); sName = sArgs[1]; }
            if (sHp > 0) CombatManager.spawn(sName, sHp, sArgs.slice(2).join(', ') || '');
        }
        else if (type === 'gegnertot') {
            let e = Utils.findTarget(State.activeEnemies, targetName || rawArgs.trim());
            if (e) CombatManager.damage(e, e.hp);
        }
        else if (type === 'beute') {
            let lootItems = rawArgs.includes(',') ? Utils.splitByCommaOutsideBrackets(rawArgs) : [rawArgs.trim()];
            const items = [];
            lootItems.filter(a => a).forEach(itemStr => {
                const { amt, name } = Utils.parseItemQuantity(itemStr);
                for (let i = 0; i < amt; i++) items.push(name);
            });
            if (items.length > 0) dispatch({ type: 'ADD_LOOT', items });
        }
        else if (type === 'route') {
            let routeName = rawArgs.trim();
            let btnHtml = `<button data-action="choose-route" data-route="${routeName.replace(/"/g, '&quot;')}" class="w-full bg-slate-800/80 hover:bg-slate-700 py-3 rounded-lg font-bold text-xs border border-slate-600 shadow-sm transition-colors text-slate-300 hover:text-white flex items-center justify-center gap-2 mb-2"><i class="fas fa-door-open text-slate-400"></i> Route wählen: ${routeName}</button>`;
            DOM.actionBoxContainer.insertAdjacentHTML('beforeend', sanitize(btnHtml));
            DOM.actionBoxContainer.classList.remove('hidden');
        }
        else if (type === 'verbraucht') {
            let vArgs = rawArgs.includes(',') ? Utils.splitByCommaOutsideBrackets(rawArgs) : rawArgs.split(/\s+/);
            let c = Utils.findTarget(State.party, vArgs[0]);
            let rawItemStr = vArgs.slice(1).join(', ').trim() || rawArgs;
            const { amt, name } = Utils.parseItemQuantity(rawItemStr);
            if (c) PartyManager.consumeItem(c, name, amt);
        }
        else if (type === 'kampfbeendet') { State.activeEnemies = []; CombatManager.endCombat(); }
        else if (type === 'xp') {
            if (targetName && targetName.toLowerCase() === 'alle') State.party.forEach(p => PartyManager.addXP(p, amount));
            else {
                let c = Utils.findTarget(State.party, targetName);
                if (c) PartyManager.addXP(c, amount);
            }
        }
        else if (type === 'neuernpc') {
            let nArgs = rawArgs.includes(',') ? Utils.splitByCommaOutsideBrackets(rawArgs) : rawArgs.split(/\s+/);
            Engine.spawnNPCFromTag(nArgs[0] || 'Unbekannt', nArgs[1] || 'Bürger', nArgs.slice(2).join(',') || 'Begleiter');
        }
        else if (type === 'tausch') {
            let tArgs = rawArgs.includes(',') ? Utils.splitByCommaOutsideBrackets(rawArgs) : rawArgs.split(/\s+/);
            let c = Utils.findTarget(State.party, tArgs[0]);
            if (c && tArgs.length >= 3) {
                PartyManager.consumeItem(c, tArgs[1]);
                c.inventory.push(tArgs[2].trim().charAt(0).toUpperCase() + tArgs[2].trim().slice(1));
                UI.addChatLog("System", `🤝 **${c.name}** tauschte **${tArgs[1]}** gegen **${tArgs[2]}**.`);
            } else if (!c) {
                UI.addChatLog("System", `⚠️ Tausch verworfen: Charakter '${tArgs[0]}' nicht gefunden.`);
            }
        }
        else if (type === 'endgueltigtot') {
            let c = Utils.findTarget(State.party, targetName);
            if (c) { State.party = State.party.filter(p => p.id !== c.id); UI.addChatLog("System", `⚰️ **${c.name}** ist endgültig von uns gegangen...`); UI.hideDetails(); }
        }
        else if (type === 'haendler') {
            const parts = rawArgs.split('|');
            const mName = parts[0] ? parts[0].trim() : "Händler";
            const mItems = parts.length > 1 ? Utils.splitByCommaOutsideBrackets(parts[1]) : ["Bietet derzeit nichts an"];
            State.activeMerchant = { name: mName, items: mItems };
        }
        else if (type === 'faehigkeit') {
            let fParts = rawArgs.includes('|') ? rawArgs.split('|') : rawArgs.split(/\s+/);
            let c = Utils.findTarget(State.party, fParts[0].trim());
            if (c) {
                let fName = fParts.slice(1).join(' ').trim();
                if (!c.abilities) c.abilities = [];
                if (c.ability && !c.abilities.includes(c.ability)) c.abilities.push(c.ability);
                if (fName) {
                    let fNameBase = fName.replace(/\s+(II|III|IV|V|VI|VII|VIII|IX|X)$/i, '').trim();
                    let existingIdx = c.abilities.findIndex(ab => {
                        let abBase = ab.replace(/\s+(II|III|IV|V|VI|VII|VIII|IX|X)$/i, '').trim();
                        return abBase.toLowerCase() === fNameBase.toLowerCase();
                    });
                    if (existingIdx !== -1) {
                        let existing = c.abilities[existingIdx];
                        let existingBase = existing.replace(/\s+(II|III|IV|V|VI|VII|VIII|IX|X)$/i, '').trim();
                        let tierMatch = existing.match(/\s+(II|III|IV|V|VI|VII|VIII|IX|X)$/i);
                        let currentTier = tierMatch ? tierMatch[1].toUpperCase() : 'I';
                        const tiers = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
                        let tierIdx = tiers.indexOf(currentTier);
                        let nextTier = tierIdx < tiers.length - 1 ? tiers[tierIdx + 1] : tiers[tiers.length - 1];
                        c.abilities[existingIdx] = `${existingBase} ${nextTier}`;
                        UI.addChatLog("System", `⚡ **${c.name}** hat die Fähigkeit **${existingBase}** verstärkt → **${c.abilities[existingIdx]}**!`);
                    } else {
                        if (c.abilities.length >= ABILITY_LIMIT) {
                            State.pendingAbilityLearning = { charId: c.id, newAbility: fName };
                            UI.showAbilityReplaceModal(c.id, fName);
                        } else {
                            c.abilities.push(fName);
                            UI.addChatLog("System", `🌟 **${c.name}** hat eine neue Fähigkeit erlernt: **${fName}**`);
                        }
                    }
                }
            }
        }
        else if (type === 'cooldown') {
            let cdParts = rawArgs.split('|').map(s => s.trim());
            if (cdParts.length >= 3) {
                let charName = cdParts[0];
                let abilityName = cdParts[1];
                let rounds = parseInt(cdParts[2]) || 3;
                let c = Utils.findTarget(State.party, charName);
                if (c) {
                    let cdKey = `${c.id}_${abilityName}`;
                    State.abilityCooldowns[cdKey] = rounds;
                    UI.addChatLog("System", `⏳ **${c.name}**: Fähigkeit **${abilityName}** hat **${rounds} Runden** Abklingzeit.`);
                }
            }
        }
        else if (type === 'flucht') {
            let fluchtArg = rawArgs.trim().toLowerCase();
            if (fluchtArg.includes('erfolg')) {
                if (State.isBossFight) {
                    UI.addChatLog("System", `🚫 **Flucht unmöglich!** Der Boss blockiert jeden Fluchtversuch!`);
                } else {
                    UI.addChatLog("System", `🌀 **Teleport erfolgreich!** Die Gruppe entkommt dem Kampf!`);
                    State.activeEnemies = [];
                    State.defeatedEnemies = [];
                    State.combatEnded = true;
                    if (State.party.some(p => p.isSummon)) {
                        State.party = State.party.filter(p => !p.isSummon);
                        UI.addChatLog("System", `💨 Beschworene Kreaturen verschwinden.`);
                    }
                }
            }
        }
        else if (type === 'gold') {
            const goldAmount = amount || parseInt(rawArgs.trim()) || 0;
            if (goldAmount > 0) {
                dispatch({ type: 'ADD_GOLD', amount: goldAmount });
                Sound.play('loot');
                UI.addChatLog("System", `💰 **${goldAmount} Goldmünzen** erhalten! (Gesamt: ${State.gold} 🪙)`);
            }
        }
        else if (type === 'gegnerflucht') {
            const eName = targetName || rawArgs.trim();
            let e = Utils.findTarget(State.activeEnemies, eName);
            if (e) {
                Sound.play('click');
                UI.addChatLog("System", `🏃 **${e.name}** flieht aus dem Kampf! (Erschöpft/verängstigt)`);
                State.activeEnemies = State.activeEnemies.filter(en => en.id !== e.id);
                if (!State.defeatedEnemies.some(d => d.id === e.id)) {
                    State.defeatedEnemies.unshift({ ...e, hp: 0, fled: true });
                }
            }
        }
        else if (type === 'deathsave') {
            const charName = targetName || rawArgs.trim();
            let c = Utils.findTarget(State.party, charName);
            if (c && c.hp <= 0) {
                const roll = Math.floor(Math.random() * 20) + 1;
                const dc = DEATH_SAVE_DC;
                Sound.play('dice');
                if (roll >= dc) {
                    c.hp = 1;
                    Sound.play('heal');
                    UI.addChatLog("System", `💫 **TODESRETTUNG – ${c.name}:** W20-Wurf: ${roll} vs DC ${dc} → ✅ **Überlebt!** Stabilisiert mit 1 HP – bewusstlos aber am Leben.`);
                } else {
                    UI.addChatLog("System", `💀 **TODESRETTUNG – ${c.name}:** W20-Wurf: ${roll} vs DC ${dc} → ❌ **Fehlgeschlagen!** Die Gruppe hat EINEN letzten Versuch ihn/sie zu retten!`);
                }
            }
        }
    }
};
