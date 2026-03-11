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
    // Process event array directly
    process: function (events) {
        if (!events || !Array.isArray(events)) return;

        events.forEach(evt => {
            this.applyEvent(evt);
        });

        CombatManager.cleanupDead();
        UI.updateAll();
    },

    applyEvent: function (evt) {
        if (!evt || !evt.type) return;
        const type = evt.type.toUpperCase();

        if (type === 'GEGNER_SCHADEN') {
            let e = Utils.findTarget(State.activeEnemies, evt.target);
            if (e) CombatManager.damage(e, evt.amount || 0);
            else UI.addChatLog("System", `?? Mechanik verworfen: Feind '${evt.target}' nicht gefunden.`);
        }
        else if (type === 'SCHADEN') {
            let c = Utils.findTarget(State.party, evt.target);
            if (c) PartyManager.damage(c, evt.amount || 0);
            else {
                let e = Utils.findTarget(State.activeEnemies, evt.target);
                if (e) CombatManager.damage(e, evt.amount || 0);
                else UI.addChatLog("System", `?? Mechanik verworfen: Ziel '${evt.target}' f�r Schaden nicht gefunden.`);
            }
        }
        else if (type === 'HEILUNG') {
            let c = Utils.findTarget(State.party, evt.target);
            if (c) PartyManager.heal(c, evt.amount || 0);
            else UI.addChatLog("System", `?? Mechanik verworfen: Ziel '${evt.target}' f�r Heilung nicht gefunden.`);
        }
        else if (type === 'GEGNER') {
            if (evt.hp > 0) {
                CombatManager.spawn(evt.name || "Gegner", evt.hp || 20, evt.desc || "");
            }
        }
        else if (type === 'GEGNER_TOT') {
            let e = Utils.findTarget(State.activeEnemies, evt.name);
            if (e) CombatManager.damage(e, e.hp);
        }
        else if (type === 'GEGNER_FLUCHT') {
            let e = Utils.findTarget(State.activeEnemies, evt.name);
            if (e) {
                CombatManager.damage(e, e.hp); // For now just kill them to remove from combat
                UI.addChatLog("System", `?? **${e.name}** ist geflohen!`);
            }
        }
        else if (type === 'BEUTE') {
            const items = [];
            if (Array.isArray(evt.items)) {
                evt.items.filter(a => a).forEach(itemStr => {
                    const { amt, name } = Utils.parseItemQuantity(itemStr);
                    for (let i = 0; i < amt; i++) items.push(Utils.enrichLootItemName(name));
                });
            }
            if (items.length > 0) {
                dispatch({ type: 'ADD_LOOT', items });
                UI.addChatLog({ sender: 'System', senderType: 'system', text: `**Beute gefunden!**\n- ${items.join('\n- ')}` });
            }
        }
        else if (type === 'ROUTE') {
            let routeName = evt.name;
            if (routeName && !State.routeChoices.includes(routeName)) {
                State.routeChoices.push(routeName);
            }
        }
        else if (type === 'VERBRAUCHT') {
            let c = Utils.findTarget(State.party, evt.char);
            if (c && Array.isArray(evt.items)) {
                evt.items.forEach(itemStr => {
                    const { amt, name } = Utils.parseItemQuantity(itemStr);
                    PartyManager.consumeItem(c, name, amt);
                });
            }
        }
        else if (type === 'KAMPF_BEENDET') {
            State.activeEnemies = [];
            CombatManager.endCombat();
        }
        else if (type === 'XP') {
            if (evt.target && evt.target.toLowerCase() === 'alle') {
                State.party.forEach(p => PartyManager.addXP(p, evt.amount || 0));
            } else {
                let c = Utils.findTarget(State.party, evt.target);
                if (c) PartyManager.addXP(c, evt.amount || 0);
            }
        }
        else if (type === 'NEUER_NPC') {
            Engine.spawnNPCFromTag(evt.name || 'Unbekannt', evt.class || 'B�rger', evt.appearance || 'Begleiter');
        }
        else if (type === 'TAUSCH') {
            let c = Utils.findTarget(State.party, evt.char);
            if (c && evt.given && evt.received) {
                PartyManager.consumeItem(c, evt.given);
                const receivedItem = evt.received.trim().charAt(0).toUpperCase() + evt.received.trim().slice(1);
                c.inventory.push(receivedItem);
                UI.addChatLog("System", `?? **${c.name}** tauschte **${evt.given}** gegen **${receivedItem}**.`);
            }
        }
        else if (type === 'GOLD') {
            if (evt.amount > 0) {
                const amount = evt.amount;
                dispatch({ type: 'ADD_LOOT', items: [`${amount} Goldmünzen`] });
                if (window.App && window.App.Network) {
                    window.App.Network.broadcastSystemChat('System', `**Beute gefunden!**\n- ${amount} Goldmünzen`);
                }
                UI.addChatLog({ sender: 'System', senderType: 'system', text: `**Beute gefunden!**\n- ${amount} Goldmünzen` });
            }
        }
        else if (type === 'COOLDOWN') {
            const safeCharName = evt.char.replace(/[^a-zA-Z0-9]/g, '');
            const safeAbilityName = evt.ability.replace(/[^a-zA-Z0-9]/g, '');
            const cdKey = `${safeCharName}_${safeAbilityName}`;
            State.abilityCooldowns[cdKey] = (evt.rounds || 3) + 1;
        }
        else if (type === 'FLUCHT_ERFOLG') {
            if (State.isBossFight) {
                UI.addChatLog("System", `?? **Flucht unm�glich!** Der Boss blockiert jeden Fluchtversuch!`);
            } else {
                UI.addChatLog("System", `?? **Flucht erfolgreich!** Die Gruppe entkommt dem Kampf!`);
                State.activeEnemies = [];
                State.defeatedEnemies = [];
                State.combatEnded = true;
            }
        }
        else if (type === 'DEATH_SAVE') {
            let c = Utils.findTarget(State.party, evt.name);
            if (c && c.hp <= 0) {
                const roll = Math.floor(Math.random() * 20) + 1;
                const dc = DEATH_SAVE_DC;
                Sound.play('dice');
                if (roll >= dc) {
                    c.hp = 1;
                    Sound.play('heal');
                    UI.addChatLog("System", `?? **TODESRETTUNG � ${c.name}:** W20-Wurf: ${roll} vs DC ${dc} ? ? **�berlebt!** Stabilisiert mit 1 HP.`);
                } else {
                    UI.addChatLog("System", `?? **TODESRETTUNG � ${c.name}:** W20-Wurf: ${roll} vs DC ${dc} ? ? **Fehlgeschlagen!** Letzter Versuch zur Rettung!`);
                }
            }
        }
        else if (type === 'PROBE') {
            this.handleProbe(evt);
        }
    },

    handleProbe: function (evt) {
        let charName = evt.char;
        let statName = (evt.stat || "STR").toUpperCase();
        let desc = evt.desc || statName;
        let dc = parseInt(evt.dc) || 10;
        let dt = (evt.dice || "W20").toUpperCase();
        let modifier = 0;

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
            ? ` [DC ${dc}${weatherDcMod > 0 ? ` +${weatherDcMod} ${State.weather.name}` : ''}${fatigueDcMod > 0 ? ` +${fatigueDcMod} Ersch�pfung` : ''}]`
            : '';

        State.pendingRolls.push({
            id: Utils.generateId(),
            name: charName,
            stat: statName,
            mod: modifier,
            desc: desc + dcNote,
            dc: finalDc,
            diceType: dt,
            rolled: false,
            result: 0,
            rawRoll: 0,
            modBreakdown: breakdown
        });

        UI.updateActionBox();
    }
};


