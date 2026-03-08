import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/ui.js', () => ({
    UI: {
        addChatLog: vi.fn(),
        updateAll: vi.fn(),
        showAbilityReplaceModal: vi.fn(),
    },
    DOM: {},
}));

vi.mock('../js/sound.js', () => ({
    Sound: { play: vi.fn() },
}));

import { PartyManager } from '../js/party.js';
import { State } from '../js/state.js';

function makeChar(overrides = {}) {
    return {
        id: 'test-1', name: 'Tester', class: 'Krieger',
        level: 1, xp: 0, hp: 20, maxHp: 20,
        attributes: { STR: 10, DEX: 10, INT: 10, CON: 10 },
        equipment: [], inventory: [], statPoints: 0,
        isSummon: false, ability: null, abilities: [],
        talents: [], pendingTalentPoints: 0,
        ...overrides,
    };
}

beforeEach(() => {
    State.party = [];
    State.sessionStats = { totalDamageTaken: 0, totalHealed: 0, totalXPEarned: 0, totalDamageDealt: 0, combatsWon: 0, turnsPlayed: 0 };
});

describe('PartyManager.getEffectiveAttributes', () => {
    it('returns base attributes with no equipment', () => {
        const c = makeChar();
        expect(PartyManager.getEffectiveAttributes(c)).toEqual({ STR: 10, DEX: 10, INT: 10, CON: 10 });
    });

    it('applies equipment stat bonuses (STR +2)', () => {
        const c = makeChar({ equipment: ['Sword (STR +2)'] });
        const eff = PartyManager.getEffectiveAttributes(c);
        expect(eff.STR).toBe(12);
    });

    it('applies reverse format (+3 DEX)', () => {
        const c = makeChar({ equipment: ['Ring (+3 DEX)'] });
        const eff = PartyManager.getEffectiveAttributes(c);
        expect(eff.DEX).toBe(13);
    });

    it('stacks multiple equipment bonuses', () => {
        const c = makeChar({ equipment: ['Sword (STR +2)', 'Shield (CON +1)'] });
        const eff = PartyManager.getEffectiveAttributes(c);
        expect(eff.STR).toBe(12);
        expect(eff.CON).toBe(11);
    });
});

describe('PartyManager.getEffectiveMaxHp', () => {
    it('returns base HP at level 1 with CON 10', () => {
        const c = makeChar();
        expect(PartyManager.getEffectiveMaxHp(c)).toBe(20);
    });

    it('increases HP with level', () => {
        const c = makeChar({ level: 3 });
        expect(PartyManager.getEffectiveMaxHp(c)).toBe(30);
    });

    it('applies CON bonus', () => {
        const c = makeChar({ attributes: { STR: 10, DEX: 10, INT: 10, CON: 14 } });
        expect(PartyManager.getEffectiveMaxHp(c)).toBe(32);
    });

    it('never returns less than 1', () => {
        const c = makeChar({ attributes: { STR: 10, DEX: 10, INT: 10, CON: 1 } });
        expect(PartyManager.getEffectiveMaxHp(c)).toBeGreaterThanOrEqual(1);
    });
});

describe('PartyManager.damage', () => {
    it('reduces HP by amount', () => {
        const c = makeChar({ hp: 20 });
        PartyManager.damage(c, 5);
        expect(c.hp).toBe(15);
    });

    it('does not go below 0', () => {
        const c = makeChar({ hp: 3 });
        PartyManager.damage(c, 10);
        expect(c.hp).toBe(0);
    });

    it('tracks damage in session stats', () => {
        const c = makeChar({ hp: 20 });
        PartyManager.damage(c, 7);
        expect(State.sessionStats.totalDamageTaken).toBe(7);
    });
});

describe('PartyManager.heal', () => {
    it('restores HP up to max', () => {
        const c = makeChar({ hp: 10 });
        PartyManager.heal(c, 5);
        expect(c.hp).toBe(15);
    });

    it('caps at effective max HP', () => {
        const c = makeChar({ hp: 18 });
        PartyManager.heal(c, 10);
        expect(c.hp).toBe(20);
    });

    it('tracks healing in session stats', () => {
        const c = makeChar({ hp: 10 });
        PartyManager.heal(c, 5);
        expect(State.sessionStats.totalHealed).toBe(5);
    });
});

describe('PartyManager.addXP', () => {
    it('adds XP to character', () => {
        const c = makeChar();
        PartyManager.addXP(c, 50);
        expect(c.xp).toBe(50);
    });

    it('levels up when XP threshold is reached', () => {
        const c = makeChar({ xp: 90 });
        PartyManager.addXP(c, 20);
        expect(c.level).toBe(2);
    });

    it('ignores summons', () => {
        const c = makeChar({ isSummon: true });
        PartyManager.addXP(c, 100);
        expect(c.xp).toBe(0);
    });

    it('grants stat points on level up', () => {
        const c = makeChar({ xp: 90 });
        PartyManager.addXP(c, 20);
        expect(c.statPoints).toBeGreaterThan(0);
    });
});

describe('PartyManager.consumeItem', () => {
    it('removes item from inventory', () => {
        const c = makeChar({ inventory: ['Potion', 'Sword'] });
        PartyManager.consumeItem(c, 'Potion');
        expect(c.inventory).toEqual(['Sword']);
    });

    it('removes multiple items', () => {
        const c = makeChar({ inventory: ['Potion', 'Potion', 'Sword'] });
        PartyManager.consumeItem(c, 'Potion', 2);
        expect(c.inventory).toEqual(['Sword']);
    });

    it('handles missing items gracefully', () => {
        const c = makeChar({ inventory: ['Sword'] });
        PartyManager.consumeItem(c, 'Potion');
        expect(c.inventory).toEqual(['Sword']);
    });
});

describe('PartyManager.getItemSpecialEffects', () => {
    it('extracts non-stat effects from equipment', () => {
        const c = makeChar({ equipment: ['Flame Sword (Feuerschaden)'] });
        const effects = PartyManager.getItemSpecialEffects(c);
        expect(effects).toContain('Feuerschaden');
    });

    it('excludes pure stat bonuses', () => {
        const c = makeChar({ equipment: ['Ring (STR +2)'] });
        const effects = PartyManager.getItemSpecialEffects(c);
        expect(effects).toHaveLength(0);
    });
});
