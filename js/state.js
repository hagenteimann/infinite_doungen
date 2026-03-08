export const State = {
    party: [], activeEnemies: [], defeatedEnemies: [], lootDrops: [],
    lastStoryPart: "", gameStarted: false, isProcessing: false,
    tempPortraitData: "", tempImagePrompt: "",
    pendingRolls: [], craftingIngredients: [], routeChoices: [],`r`n    chatMessages: [],
    targetMapMode: false,
    imageQuotaExceeded: false,
    combatEnded: false,
    activeMerchant: null,
    journal: [],
    sessionStats: { totalDamageDealt: 0, totalDamageTaken: 0, totalXPEarned: 0, totalHealed: 0, diceRolls: [], highestRoll: 0, lowestRoll: 21, combatsWon: 0, turnsPlayed: 0 },
    soundEnabled: true,
    quickplayEnabled: false,
    fate: 0,
    fatigue: 0,
    abilityCooldowns: {},
    isBossFight: false,
    chatHistory: [],
    undoSnapshot: null,
    dungeonLevel: 0,
    savedPrompts: [],
    weather: { current: 'sunny', name: 'Sonnig', icon: '\u2600\uFE0F', dcMod: 0 },
    gold: 0,
    momentum: 0,
    pendingAbilityLearning: null,
    activeCrafterId: null,
};

const listeners = new Set();

export function dispatch(action) {
    switch (action.type) {
        case 'DAMAGE_HERO': {
            const char = State.party.find(c => c.id === action.charId);
            if (char) {
                State.sessionStats.totalDamageTaken += action.amount;
                char.hp = Math.max(0, char.hp - action.amount);
            }
            break;
        }
        case 'HEAL_HERO': {
            const char = State.party.find(c => c.id === action.charId);
            if (char) {
                const heal = Math.min(action.amount, action.maxHp - char.hp);
                char.hp += heal;
                State.sessionStats.totalHealed += heal;
            }
            break;
        }
        case 'ADD_XP': {
            const char = State.party.find(c => c.id === action.charId);
            if (char && !char.isSummon) {
                char.xp += action.amount;
                State.sessionStats.totalXPEarned += action.amount;
            }
            break;
        }
        case 'DAMAGE_ENEMY': {
            const enemy = State.activeEnemies.find(e => e.id === action.enemyId);
            if (enemy) {
                State.sessionStats.totalDamageDealt += action.amount;
                enemy.hp = Math.max(0, enemy.hp - action.amount);
            }
            break;
        }
        case 'ADD_ENEMY': {
            State.activeEnemies.push(action.enemy);
            break;
        }
        case 'REMOVE_ENEMY': {
            State.activeEnemies = State.activeEnemies.filter(e => e.id !== action.enemyId);
            break;
        }
        case 'ADD_PARTY_MEMBER': {
            State.party.push(action.character);
            break;
        }
        case 'REMOVE_PARTY_MEMBER': {
            State.party = State.party.filter(c => c.id !== action.charId);
            break;
        }
        case 'ADD_LOOT': {
            State.lootDrops.push(...(Array.isArray(action.items) ? action.items : [action.items]));
            break;
        }
        case 'ASSIGN_LOOT': {
            const char = State.party.find(c => c.id === action.charId);
            if (char && State.lootDrops[action.index]) {
                char.inventory.push(State.lootDrops[action.index]);
                State.lootDrops.splice(action.index, 1);
            }
            break;
        }
        case 'SET_GOLD': {
            State.gold = action.amount;
            break;
        }
        case 'ADD_GOLD': {
            State.gold = (State.gold || 0) + action.amount;
            break;
        }
        case 'SET_MERCHANT': {
            State.activeMerchant = action.merchant;
            break;
        }
        case 'SET_PROCESSING': {
            State.isProcessing = action.value;
            break;
        }
        case 'SET_GAME_STARTED': {
            State.gameStarted = action.value;
            break;
        }
        case 'SET_STORY': {
            State.lastStoryPart = action.text;
            break;
        }
        case 'ADD_JOURNAL': {
            State.journal.unshift(action.entry);
            if (State.journal.length > action.maxEntries) State.journal.pop();
            break;
        }
        case 'SET_WEATHER': {
            Object.assign(State.weather, action.weather);
            break;
        }
        case 'COMBAT_ENDED': {
            State.combatEnded = true;
            State.sessionStats.combatsWon++;
            State.dungeonLevel = (State.dungeonLevel || 0) + 1;
            break;
        }
        case 'SET_COOLDOWN': {
            State.abilityCooldowns[action.key] = action.rounds;
            break;
        }
        case 'CLEAR_COOLDOWN': {
            delete State.abilityCooldowns[action.key];
            break;
        }
        case 'SET_FATIGUE': {
            State.fatigue = action.value;
            break;
        }
        case 'SET_FATE': {
            State.fate = action.value;
            break;
        }
        case 'RESTORE_SNAPSHOT': {
            const snap = action.snapshot;
            Object.assign(State, {
                party: snap.party,
                activeEnemies: snap.activeEnemies || [],
                defeatedEnemies: snap.defeatedEnemies || [],
                lootDrops: snap.lootDrops || [],
                routeChoices: snap.routeChoices || [],
                fate: snap.fate || 0,
                fatigue: snap.fatigue || 0,
                gold: snap.gold || 0,
                activeMerchant: snap.activeMerchant || null,
                abilityCooldowns: snap.abilityCooldowns || {},
            });
            State.undoSnapshot = null;
            break;
        }
        case 'BULK_UPDATE': {
            Object.assign(State, action.updates);
            break;
        }
        default:
            console.warn(`Unknown dispatch action: ${action.type}`);
            return;
    }
    listeners.forEach(fn => {
        try { fn(State, action); } catch (e) { console.error('State listener error:', e); }
    });
}

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
