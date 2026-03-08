import { State } from './state.js';
import { EQUIPMENT_SETS, TALENT_TREES } from './prompts.js';
import { Sound } from './sound.js';
import { UI } from './ui.js';
import {
    BASE_HP, HP_PER_LEVEL, CON_HP_MULTIPLIER, CON_BASELINE,
    XP_BASE, XP_SCALING_EXPONENT, STAT_POINTS_PER_LEVEL,
} from './constants.js';

function findEntityCard(targetName) {
    const normalizedTarget = (targetName || '').toLowerCase().trim();
    if (!normalizedTarget) return null;

    const cards = Array.from(document.querySelectorAll('[data-action="entity-click"]'));
    return cards.find(card => (card.dataset.name || '').toLowerCase().trim() === normalizedTarget)
        || cards.find(card => (card.dataset.name || '').toLowerCase().includes(normalizedTarget))
        || cards.find(card => normalizedTarget.includes((card.dataset.name || '').toLowerCase().trim()))
        || null;
}

function showFloatingNumber(targetName, amount, type) {
    const targetCard = findEntityCard(targetName);
    if (!targetCard) return;

    const float = document.createElement('div');
    float.className = 'damage-float ' + type;
    float.textContent = type === 'heal' ? '+' + amount : (type === 'xp' ? '+' + amount + ' XP' : '-' + amount);

    const rect = targetCard.getBoundingClientRect();
    float.style.position = 'fixed';
    float.style.left = (rect.left + rect.width/2 - 15) + 'px';
    float.style.top = rect.top + 'px';
    float.style.zIndex = '1000';

    document.body.appendChild(float);
    setTimeout(() => float.remove(), 1300);
}

function showLevelUpAnimation(char) {
    const targetCard = findEntityCard(char.name);
    if (!targetCard) return;

    targetCard.classList.add('level-up-glow');
    setTimeout(() => {
        targetCard.classList.remove('level-up-glow');
    }, 2000);

    const float = document.createElement('div');
    float.className = 'damage-float levelup';
    float.textContent = 'LEVEL UP!';
    const rect = targetCard.getBoundingClientRect();
    float.style.position = 'fixed';
    float.style.left = (rect.left + rect.width/2 - 50) + 'px';
    float.style.top = (rect.top - 60) + 'px';
    document.body.appendChild(float);
    setTimeout(() => float.remove(), 1500);

    setTimeout(() => {
        const levelSpan = targetCard.querySelector('.text-slate-500.text-\\[9px\\]');
        if (levelSpan) {
            levelSpan.classList.add('level-up-bounce');
            setTimeout(() => levelSpan.classList.remove('level-up-bounce'), 400);
        }
    }, 100);
}

export const PartyManager = {
    getEffectiveAttributes: function (char) {
        let effAttrs = { ...char.attributes };
        (char.equipment || []).forEach(item => {
            const regex1 = /(STR|DEX|INT|CON)\s*([+-]\s*\d+)/gi;
            let match;
            while ((match = regex1.exec(item)) !== null) {
                const stat = match[1].toUpperCase();
                const val = parseInt(match[2].replace(/\s+/g, ''));
                if (effAttrs[stat] !== undefined) effAttrs[stat] += val;
            }
            const regex2 = /([+-]\s*\d+)\s*(STR|DEX|INT|CON)/gi;
            while ((match = regex2.exec(item)) !== null) {
                const stat = match[2].toUpperCase();
                const val = parseInt(match[1].replace(/\s+/g, ''));
                if (effAttrs[stat] !== undefined) effAttrs[stat] += val;
            }
        });

        if (char.equipment && char.equipment.length > 0) {
            EQUIPMENT_SETS.forEach(set => {
                const equippedPieces = set.pieces.filter(p => char.equipment.some(e => e.includes(p)));
                if (equippedPieces.length >= 2) {
                    for (const stat in set.bonus) {
                        if (effAttrs[stat] !== undefined) effAttrs[stat] += set.bonus[stat];
                    }
                }
            });
        }

        return effAttrs;
    },
    getItemSpecialEffects: function (char) {
        const effects = [];
        (char.equipment || []).forEach(item => {
            const parenRegex = /\(([^)]+)\)/g;
            let m;
            while ((m = parenRegex.exec(item)) !== null) {
                const spec = m[1].trim();
                if (!spec.match(/^(?:STR|DEX|INT|CON)\s*[+-]\s*\d+$/) && !spec.match(/^[+-]\s*\d+\s*(?:STR|DEX|INT|CON)$/i)) {
                    effects.push(spec);
                }
            }
        });
        return effects;
    },
    getEffectiveMaxHp: function (char) {
        const effAttrs = this.getEffectiveAttributes(char);
        const baseMax = BASE_HP + ((char.level - 1) * HP_PER_LEVEL);
        const conBonus = (effAttrs.CON - CON_BASELINE) * CON_HP_MULTIPLIER;
        return Math.max(1, baseMax + conBonus);
    },
    damage: function (char, amount) {
        State.sessionStats.totalDamageTaken += amount;
        char.hp = Math.max(0, char.hp - amount);
        Sound.play('sword');
        Sound.play('hit');
        showFloatingNumber(char.name, amount, 'damage');
        if (char.hp === 0) {
            UI.addChatLog("System", `💀 **${char.name}** ist bewusstlos zu Boden gegangen! Ihr habt **GENAU EINEN VERSUCH**, ihn/sie zu retten (Medizin, Magie etc.).`);
        }
    },
    heal: function (char, amount) {
        const effMax = this.getEffectiveMaxHp(char);
        const actualHeal = Math.min(amount, effMax - char.hp);
        char.hp += actualHeal;
        if (actualHeal > 0) {
            State.sessionStats.totalHealed += actualHeal;
            Sound.play('heal');
            showFloatingNumber(char.name, actualHeal, 'heal');
        }
    },
    addXP: function (char, amount) {
        if (char.isSummon) return;
        char.xp += amount;
        State.sessionStats.totalXPEarned += amount;

        showFloatingNumber(char.name, amount, 'xp');
        let needed = Math.floor(XP_BASE * Math.pow(char.level, XP_SCALING_EXPONENT)); let leveledUp = false; let levelUpsThisChar = 0;
        let bonusStat;
        while (char.xp >= needed) {
            char.xp -= needed; char.level++; char.statPoints += STAT_POINTS_PER_LEVEL;
            const classBonusMap = {
                'Krieger':    char.level % 2 === 0 ? 'STR' : 'CON',
                'Waldläufer': 'DEX',
                'Magier':     'INT',
                'Schurke':    char.level % 2 === 0 ? 'DEX' : 'STR',
                'Kleriker':   char.level % 2 === 0 ? 'INT' : 'CON'
            };
            bonusStat = classBonusMap[char.class];
            if (bonusStat && char.attributes[bonusStat] !== undefined) {
                char.attributes[bonusStat]++;
            }
            char.hp = this.getEffectiveMaxHp(char);
            leveledUp = true; levelUpsThisChar++; needed = Math.floor(XP_BASE * Math.pow(char.level, XP_SCALING_EXPONENT));
            if (char.level === 2 && !char.ability) {
                const abs = { "Waldläufer": "Waldgeist (Beschwörung)", "Krieger": "Schildwall", "Magier": "Arkaner Familiar (Beschwörung)", "Schurke": "Schattenklon (Beschwörung)", "Kleriker": "Lichtbote (Beschwörung)" };
                char.ability = abs[char.class] || null;
            }
            if ([3, 5, 10].includes(char.level) && TALENT_TREES[char.class]) {
                char.pendingTalentPoints++;
            }
        }
        if (leveledUp) {
            Sound.play('levelup');
            const bonusStatMsg = bonusStat ? ` **${bonusStat} +1** (Klassen-Bonus)` : '';
            UI.addChatLog("System", `🌟 **${char.name}** hat Level ${char.level} erreicht!${bonusStatMsg}`);
            showLevelUpAnimation(char);
        }
    },
    consumeItem: function (char, itemName, amount = 1) {
        let removed = 0;
        for (let i = 0; i < amount; i++) {
            const idx = char.inventory.findIndex(it => it.toLowerCase().includes(itemName.toLowerCase()));
            if (idx > -1) { char.inventory.splice(idx, 1); removed++; }
            else break;
        }
        if (removed > 0) {
            UI.addChatLog("System", `🗑️ **${char.name}** hat **${removed}x ${itemName}** verbraucht.`);
            const effMax = this.getEffectiveMaxHp(char);
            if (char.hp > effMax) char.hp = effMax;
        }
    }
};
