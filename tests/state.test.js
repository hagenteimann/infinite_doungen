import { describe, it, expect, beforeEach, vi } from 'vitest';
import { State, dispatch, subscribe } from '../js/state.js';

function resetState() {
    State.party = [];
    State.activeEnemies = [];
    State.defeatedEnemies = [];
    State.lootDrops = [];
    State.gold = 0;
    State.fate = 0;
    State.fatigue = 0;
    State.combatEnded = false;
    State.dungeonLevel = 0;
    State.activeMerchant = null;
    State.undoSnapshot = null;
    State.abilityCooldowns = {};
    State.isProcessing = false;
    State.gameStarted = false;
    State.lastStoryPart = '';
    State.journal = [];
    State.weather = { current: 'sunny', name: 'Sonnig', icon: '☀️', dcMod: 0 };
    State.sessionStats = {
        totalDamageDealt: 0, totalDamageTaken: 0,
        totalXPEarned: 0, totalHealed: 0,
        diceRolls: [], highestRoll: 0, lowestRoll: 21,
        combatsWon: 0, turnsPlayed: 0,
    };
}

function makeChar(overrides = {}) {
    return {
        id: 'hero-1', name: 'Tester', class: 'Krieger',
        level: 1, xp: 0, hp: 20, maxHp: 20,
        attributes: { STR: 10, DEX: 10, INT: 10, CON: 10 },
        equipment: [], inventory: [], statPoints: 0,
        isSummon: false, ...overrides,
    };
}

function makeEnemy(overrides = {}) {
    return {
        id: 'enemy-1', name: 'Goblin', hp: 15, maxHp: 15,
        desc: '', loggedDefeat: false, portrait: '',
        ...overrides,
    };
}

beforeEach(resetState);

describe('dispatch: DAMAGE_HERO', () => {
    it('reduces hero HP and tracks stats', () => {
        const c = makeChar({ hp: 20 });
        State.party.push(c);
        dispatch({ type: 'DAMAGE_HERO', charId: 'hero-1', amount: 7 });
        expect(c.hp).toBe(13);
        expect(State.sessionStats.totalDamageTaken).toBe(7);
    });

    it('does not reduce HP below 0', () => {
        const c = makeChar({ hp: 3 });
        State.party.push(c);
        dispatch({ type: 'DAMAGE_HERO', charId: 'hero-1', amount: 10 });
        expect(c.hp).toBe(0);
    });

    it('ignores unknown charId', () => {
        dispatch({ type: 'DAMAGE_HERO', charId: 'nope', amount: 5 });
        expect(State.sessionStats.totalDamageTaken).toBe(0);
    });
});

describe('dispatch: HEAL_HERO', () => {
    it('heals hero and tracks stats', () => {
        const c = makeChar({ hp: 10 });
        State.party.push(c);
        dispatch({ type: 'HEAL_HERO', charId: 'hero-1', amount: 8, maxHp: 20 });
        expect(c.hp).toBe(18);
        expect(State.sessionStats.totalHealed).toBe(8);
    });

    it('caps heal at maxHp', () => {
        const c = makeChar({ hp: 18 });
        State.party.push(c);
        dispatch({ type: 'HEAL_HERO', charId: 'hero-1', amount: 10, maxHp: 20 });
        expect(c.hp).toBe(20);
        expect(State.sessionStats.totalHealed).toBe(2);
    });
});

describe('dispatch: ADD_XP', () => {
    it('adds XP and tracks stats', () => {
        const c = makeChar();
        State.party.push(c);
        dispatch({ type: 'ADD_XP', charId: 'hero-1', amount: 50 });
        expect(c.xp).toBe(50);
        expect(State.sessionStats.totalXPEarned).toBe(50);
    });

    it('ignores summons', () => {
        const c = makeChar({ isSummon: true });
        State.party.push(c);
        dispatch({ type: 'ADD_XP', charId: 'hero-1', amount: 50 });
        expect(c.xp).toBe(0);
    });
});

describe('dispatch: DAMAGE_ENEMY', () => {
    it('reduces enemy HP and tracks stats', () => {
        const e = makeEnemy({ hp: 15 });
        State.activeEnemies.push(e);
        dispatch({ type: 'DAMAGE_ENEMY', enemyId: 'enemy-1', amount: 5 });
        expect(e.hp).toBe(10);
        expect(State.sessionStats.totalDamageDealt).toBe(5);
    });

    it('does not reduce below 0', () => {
        const e = makeEnemy({ hp: 3 });
        State.activeEnemies.push(e);
        dispatch({ type: 'DAMAGE_ENEMY', enemyId: 'enemy-1', amount: 10 });
        expect(e.hp).toBe(0);
    });
});

describe('dispatch: ADD_ENEMY / REMOVE_ENEMY', () => {
    it('adds enemy to active list', () => {
        const e = makeEnemy();
        dispatch({ type: 'ADD_ENEMY', enemy: e });
        expect(State.activeEnemies).toHaveLength(1);
        expect(State.activeEnemies[0].name).toBe('Goblin');
    });

    it('removes enemy by id', () => {
        State.activeEnemies.push(makeEnemy());
        dispatch({ type: 'REMOVE_ENEMY', enemyId: 'enemy-1' });
        expect(State.activeEnemies).toHaveLength(0);
    });
});

describe('dispatch: ADD_PARTY_MEMBER / REMOVE_PARTY_MEMBER', () => {
    it('adds and removes party members', () => {
        dispatch({ type: 'ADD_PARTY_MEMBER', character: makeChar() });
        expect(State.party).toHaveLength(1);
        dispatch({ type: 'REMOVE_PARTY_MEMBER', charId: 'hero-1' });
        expect(State.party).toHaveLength(0);
    });
});

describe('dispatch: ADD_LOOT / ASSIGN_LOOT', () => {
    it('adds loot items (array)', () => {
        dispatch({ type: 'ADD_LOOT', items: ['Sword', 'Shield'] });
        expect(State.lootDrops).toEqual(['Sword', 'Shield']);
    });

    it('adds single loot item', () => {
        dispatch({ type: 'ADD_LOOT', items: 'Potion' });
        expect(State.lootDrops).toEqual(['Potion']);
    });

    it('assigns loot to a character', () => {
        const c = makeChar({ inventory: [] });
        State.party.push(c);
        State.lootDrops = ['Sword', 'Shield'];
        dispatch({ type: 'ASSIGN_LOOT', charId: 'hero-1', index: 0 });
        expect(c.inventory).toEqual(['Sword']);
        expect(State.lootDrops).toEqual(['Shield']);
    });
});

describe('dispatch: ADD_GOLD / SET_GOLD', () => {
    it('adds gold to current total', () => {
        State.gold = 10;
        dispatch({ type: 'ADD_GOLD', amount: 25 });
        expect(State.gold).toBe(35);
    });

    it('sets gold to exact value', () => {
        State.gold = 100;
        dispatch({ type: 'SET_GOLD', amount: 42 });
        expect(State.gold).toBe(42);
    });
});

describe('dispatch: SET_MERCHANT', () => {
    it('sets active merchant', () => {
        dispatch({ type: 'SET_MERCHANT', merchant: { name: 'Bob', items: ['Potion'] } });
        expect(State.activeMerchant).toEqual({ name: 'Bob', items: ['Potion'] });
    });

    it('clears merchant with null', () => {
        State.activeMerchant = { name: 'Bob' };
        dispatch({ type: 'SET_MERCHANT', merchant: null });
        expect(State.activeMerchant).toBeNull();
    });
});

describe('dispatch: SET_PROCESSING / SET_GAME_STARTED', () => {
    it('toggles processing flag', () => {
        dispatch({ type: 'SET_PROCESSING', value: true });
        expect(State.isProcessing).toBe(true);
        dispatch({ type: 'SET_PROCESSING', value: false });
        expect(State.isProcessing).toBe(false);
    });

    it('toggles game started flag', () => {
        dispatch({ type: 'SET_GAME_STARTED', value: true });
        expect(State.gameStarted).toBe(true);
    });
});

describe('dispatch: SET_STORY / ADD_JOURNAL', () => {
    it('sets story text', () => {
        dispatch({ type: 'SET_STORY', text: 'The adventure begins.' });
        expect(State.lastStoryPart).toBe('The adventure begins.');
    });

    it('adds journal entry at front', () => {
        dispatch({ type: 'ADD_JOURNAL', entry: { text: 'Entry 1' }, maxEntries: 5 });
        dispatch({ type: 'ADD_JOURNAL', entry: { text: 'Entry 2' }, maxEntries: 5 });
        expect(State.journal[0].text).toBe('Entry 2');
        expect(State.journal).toHaveLength(2);
    });

    it('caps journal at maxEntries', () => {
        for (let i = 0; i < 5; i++) {
            dispatch({ type: 'ADD_JOURNAL', entry: { text: `Entry ${i}` }, maxEntries: 3 });
        }
        expect(State.journal).toHaveLength(3);
    });
});

describe('dispatch: SET_WEATHER', () => {
    it('updates weather properties', () => {
        dispatch({ type: 'SET_WEATHER', weather: { current: 'rain', name: 'Regen', icon: '🌧️', dcMod: 2 } });
        expect(State.weather.current).toBe('rain');
        expect(State.weather.dcMod).toBe(2);
    });
});

describe('dispatch: COMBAT_ENDED', () => {
    it('sets combat ended flag and increments stats', () => {
        dispatch({ type: 'COMBAT_ENDED' });
        expect(State.combatEnded).toBe(true);
        expect(State.sessionStats.combatsWon).toBe(1);
        expect(State.dungeonLevel).toBe(1);
    });
});

describe('dispatch: SET_COOLDOWN / CLEAR_COOLDOWN', () => {
    it('sets and clears ability cooldowns', () => {
        dispatch({ type: 'SET_COOLDOWN', key: 'hero-1_Fireball', rounds: 5 });
        expect(State.abilityCooldowns['hero-1_Fireball']).toBe(5);
        dispatch({ type: 'CLEAR_COOLDOWN', key: 'hero-1_Fireball' });
        expect(State.abilityCooldowns['hero-1_Fireball']).toBeUndefined();
    });
});

describe('dispatch: SET_FATIGUE / SET_FATE', () => {
    it('sets fatigue value', () => {
        dispatch({ type: 'SET_FATIGUE', value: 12 });
        expect(State.fatigue).toBe(12);
    });

    it('sets fate value', () => {
        dispatch({ type: 'SET_FATE', value: 7 });
        expect(State.fate).toBe(7);
    });
});

describe('dispatch: RESTORE_SNAPSHOT', () => {
    it('restores state from snapshot', () => {
        State.party = [makeChar({ hp: 5 })];
        State.gold = 100;
        State.undoSnapshot = { marker: true };

        const snapshot = {
            party: [makeChar({ hp: 20 })],
            activeEnemies: [],
            defeatedEnemies: [],
            lootDrops: ['Sword'],
            fate: 3,
            fatigue: 2,
            gold: 50,
            activeMerchant: null,
            abilityCooldowns: {},
        };
        dispatch({ type: 'RESTORE_SNAPSHOT', snapshot });
        expect(State.party[0].hp).toBe(20);
        expect(State.gold).toBe(50);
        expect(State.lootDrops).toEqual(['Sword']);
        expect(State.undoSnapshot).toBeNull();
    });
});

describe('dispatch: BULK_UPDATE', () => {
    it('applies multiple properties at once', () => {
        dispatch({ type: 'BULK_UPDATE', updates: { gold: 99, fate: 5, fatigue: 3 } });
        expect(State.gold).toBe(99);
        expect(State.fate).toBe(5);
        expect(State.fatigue).toBe(3);
    });
});

describe('dispatch: unknown action', () => {
    it('logs a warning for unknown types', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        dispatch({ type: 'UNKNOWN_ACTION' });
        expect(warn).toHaveBeenCalledWith('Unknown dispatch action: UNKNOWN_ACTION');
        warn.mockRestore();
    });
});

describe('subscribe', () => {
    it('calls listener on dispatch', () => {
        const listener = vi.fn();
        const unsub = subscribe(listener);
        dispatch({ type: 'ADD_GOLD', amount: 10 });
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(State, { type: 'ADD_GOLD', amount: 10 });
        unsub();
    });

    it('unsubscribe stops future notifications', () => {
        const listener = vi.fn();
        const unsub = subscribe(listener);
        dispatch({ type: 'ADD_GOLD', amount: 5 });
        expect(listener).toHaveBeenCalledOnce();
        unsub();
        dispatch({ type: 'ADD_GOLD', amount: 5 });
        expect(listener).toHaveBeenCalledOnce();
    });

    it('multiple subscribers all receive events', () => {
        const a = vi.fn();
        const b = vi.fn();
        const unA = subscribe(a);
        const unB = subscribe(b);
        dispatch({ type: 'SET_FATE', value: 1 });
        expect(a).toHaveBeenCalledOnce();
        expect(b).toHaveBeenCalledOnce();
        unA();
        unB();
    });

    it('does not notify on unknown actions', () => {
        const listener = vi.fn();
        const unsub = subscribe(listener);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        dispatch({ type: 'NOPE' });
        expect(listener).not.toHaveBeenCalled();
        console.warn.mockRestore();
        unsub();
    });

    it('catches errors in listeners without breaking others', () => {
        const errorListener = vi.fn(() => { throw new Error('boom'); });
        const goodListener = vi.fn();
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const un1 = subscribe(errorListener);
        const un2 = subscribe(goodListener);
        dispatch({ type: 'ADD_GOLD', amount: 1 });
        expect(goodListener).toHaveBeenCalledOnce();
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
        un1();
        un2();
    });
});
