import { State, dispatch } from './state.js';
import { Sound } from './sound.js';
import { UI } from './ui.js';
import { Utils } from './utils.js';
import { PartyManager } from './party.js';
import { API } from './api.js';
import {
    DUNGEON_XP_BONUS_PER_LEVEL, ENEMY_XP_MULTIPLIER, ENEMY_XP_BASE,
    MIN_XP_PER_HERO, ENEMY_GOLD_MULTIPLIER, ENEMY_GOLD_BASE,
    FLED_ENEMY_GOLD_MULTIPLIER, FATE_BOSS_THRESHOLD,
} from './constants.js';

export const CombatManager = {
    damage: function (enemy, amount) {
        State.sessionStats.totalDamageDealt += amount;
        enemy.hp = Math.max(0, enemy.hp - amount);
        Sound.play('sword');
        Sound.play('hit');
        if (enemy.hp === 0 && !enemy.loggedDefeat) { enemy.loggedDefeat = true; UI.addChatLog("System", `⚔️ ${enemy.name} wurde besiegt!`); }
    },
    spawn: async function (name, hp, desc) {
        const lowerName = name ? name.toLowerCase().trim() : '';
        if (!lowerName || lowerName.includes('tot') || lowerName.includes('tod') || lowerName.includes('dead') || lowerName.includes('leiche') || hp <= 0) return;

        if (State.activeEnemies.some(e => e.name.toLowerCase() === lowerName)) return;

        const wasEmpty = State.activeEnemies.length === 0;
        const e = { id: Utils.generateId(), name, hp, maxHp: hp, desc, loggedDefeat: false, portrait: "" };
        State.activeEnemies.push(e); UI.updateAll();

        if (wasEmpty && State.activeEnemies.length > 0) {
            const summoners = State.party.filter(p => {
                if (p.isSummon) return false;
                let hasSummon = false;
                if (p.ability && p.ability.includes("Beschwörung")) hasSummon = true;
                if (p.abilities && p.abilities.some(ab => ab.includes("Beschwörung"))) hasSummon = true;
                return hasSummon;
            });
            for (const p of summoners) {
                let summonAbilities = [];
                if (p.ability && p.ability.includes("Beschwörung")) summonAbilities.push(p.ability);
                if (p.abilities) {
                    p.abilities.forEach(ab => {
                        if (ab.includes("Beschwörung") && !summonAbilities.includes(ab)) summonAbilities.push(ab);
                    });
                }

                for (const abilityFull of summonAbilities) {
                    const summonName = abilityFull.split(' ')[0];

                    const pEff = PartyManager.getEffectiveAttributes(p);
                    const pInt = pEff.INT || 10;
                    const mod = pInt - 10;
                    const roll = Math.floor(Math.random() * 20) + 1;
                    const total = roll + mod;
                    const dc = 10 + p.level;
                    const success = total >= dc;

                    const summonLevel = Math.max(1, Math.floor(p.level / 2));
                    const summonHp = success ? (15 + summonLevel * 5) : (5 + summonLevel * 5);
                    const summonAttributes = {
                        STR: Math.max(1, Math.floor((pEff.STR || 10) / 2)),
                        DEX: Math.max(1, Math.floor((pEff.DEX || 10) / 2)),
                        INT: Math.max(1, Math.floor((pEff.INT || 10) / 2)),
                        CON: Math.max(1, Math.floor((pEff.CON || 10) / 2))
                    };

                    let summonPUrl = "";
                    try {
                        let summonImgPrompt = `Fantasy portrait, face only, highly detailed, ${summonName}`.replace(/\n/g, ' ').trim();
                        summonPUrl = await API.generateImageWithFallbacks([
                            summonImgPrompt,
                            `Fantasy portrait, ${summonName}`,
                            `Monster: ${summonName}`
                        ]);
                    } catch (e) { console.error("Summon Image Gen Error:", e); }

                    State.party.push(Utils.sanitizeCharacter({ id: Utils.generateId(), name: summonName + ` (von ${p.name})`, class: 'Beschwörung', hp: summonHp, maxHp: summonHp, portrait: summonPUrl, isNPC: true, isSummon: true, level: summonLevel, attributes: summonAttributes, _summonSource: abilityFull }));

                    const statusHtml = success ? `<span class="text-green-400 font-bold">Gewaltig! Begleiter ist extra stark.</span>` : `<span class="text-red-400 font-bold">Geschwächt! Schwacher Begleiter.</span>`;
                    UI.addChatLog("System", `🌀 **${p.name}** beschwört einen **${summonName}**!\n🎲 **Beschwörungs-Wurf (Lvl ${p.level} vs DC ${dc}):** ${roll} (W20) ${mod >= 0 ? '+ ' + mod : mod} (INT) = **${total}** -> ${statusHtml} [${summonHp} HP]`);
                }
            }
            UI.updateAll();
        }
        const descStr = desc ? `, ${desc}` : '';
        let pUrl = "";
        try {
            let imgPrompt = `Fantasy portrait, face only, highly detailed, ${name}${descStr}`.replace(/\n/g, ' ').trim();
            pUrl = await API.generateImageWithFallbacks([
                imgPrompt,
                `Fantasy portrait, ${name}`,
                `Monster: ${name}, ${desc}`
            ]);
        } catch (e) { console.error("Enemy Image Gen Error:", e); }

        e.portrait = pUrl;
        UI.updateAll();
    },
    cleanupDead: function () {
        State.activeEnemies.forEach(e => { if (e.hp <= 0 && !State.defeatedEnemies.some(d => d.id === e.id)) State.defeatedEnemies.unshift({ ...e }); });
        State.activeEnemies = State.activeEnemies.filter(e => e.hp > 0);
        if (State.activeEnemies.length === 0 && State.defeatedEnemies.length > 0) this.endCombat();
    },
    endCombat: function () {
        dispatch({ type: 'COMBAT_ENDED' });
        if (State.party.some(p => p.isSummon)) { State.party = State.party.filter(p => !p.isSummon); UI.addChatLog("System", `💨 Beschworene Kreaturen verschwinden.`); }

        const dungeonBonus = (State.dungeonLevel || 0) * DUNGEON_XP_BONUS_PER_LEVEL;
        const xpPool = State.defeatedEnemies.reduce((sum, e) => {
            if (e.fled) return sum;
            return sum + Math.floor((e.maxHp || 20) * ENEMY_XP_MULTIPLIER) + ENEMY_XP_BASE;
        }, 0) + dungeonBonus;
        const livingHeroes = State.party.filter(p => !p.isSummon && p.hp > 0);
        if (xpPool > 0 && livingHeroes.length > 0) {
            const xpEach = Math.max(MIN_XP_PER_HERO, Math.floor(xpPool / livingHeroes.length));
            livingHeroes.forEach(p => PartyManager.addXP(p, xpEach));
            UI.addChatLog("System", `⭐ Sieg! Jeder Held erhält **${xpEach} XP** (Dungeon-Tiefe ${State.dungeonLevel} eingerechnet).`);
        }

        const goldPool = State.defeatedEnemies.reduce((sum, e) => {
            if (e.fled) return sum + Math.floor((e.maxHp || 20) * FLED_ENEMY_GOLD_MULTIPLIER);
            return sum + Math.floor((e.maxHp || 20) * ENEMY_GOLD_MULTIPLIER) + ENEMY_GOLD_BASE;
        }, 0);
        if (goldPool > 0) {
            dispatch({ type: 'ADD_GOLD', amount: goldPool });
            Sound.play('loot');
            UI.addChatLog("System", `💰 Die Gruppe findet **${goldPool} Goldmünzen** (Gesamt: ${State.gold} 🪙).`);
        }

        State.activeEnemies = [];
        State.defeatedEnemies = [];

        if ((State.fate || 0) >= FATE_BOSS_THRESHOLD) {
            dispatch({ type: 'SET_FATE', value: 0 });
            UI.addChatLog("System", `🏆 Triumph! Das Schicksal hat sich gewendet und ein mächtiger Feind wurde bezwungen. Eine neue Ära bricht an.`);
        }

        UI.updateAll();
    }
};
