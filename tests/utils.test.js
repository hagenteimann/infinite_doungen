import { describe, it, expect } from 'vitest';
import { Utils } from '../js/utils.js';

describe('Utils.splitByCommaOutsideBrackets', () => {
    it('splits simple comma-separated strings', () => {
        expect(Utils.splitByCommaOutsideBrackets('a, b, c')).toEqual(['a', 'b', 'c']);
    });

    it('preserves commas inside brackets', () => {
        expect(Utils.splitByCommaOutsideBrackets('Sword (STR +2, DEX +1), Shield'))
            .toEqual(['Sword (STR +2, DEX +1)', 'Shield']);
    });

    it('handles nested brackets', () => {
        expect(Utils.splitByCommaOutsideBrackets('A (B [C, D]), E'))
            .toEqual(['A (B [C, D])', 'E']);
    });

    it('returns single-element array for no commas', () => {
        expect(Utils.splitByCommaOutsideBrackets('single item')).toEqual(['single item']);
    });

    it('trims whitespace', () => {
        expect(Utils.splitByCommaOutsideBrackets('  a ,  b  ')).toEqual(['a', 'b']);
    });
});

describe('Utils.parseItemQuantity', () => {
    it('parses "3x Potion" prefix format', () => {
        expect(Utils.parseItemQuantity('3x Potion')).toEqual({ amt: 3, name: 'Potion' });
    });

    it('parses "3 Potion" prefix format', () => {
        expect(Utils.parseItemQuantity('3 Potion')).toEqual({ amt: 3, name: 'Potion' });
    });

    it('parses "Potion (x5)" suffix format', () => {
        expect(Utils.parseItemQuantity('Potion (x5)')).toEqual({ amt: 5, name: 'Potion' });
    });

    it('defaults to 1 for no quantity', () => {
        expect(Utils.parseItemQuantity('Sword')).toEqual({ amt: 1, name: 'Sword' });
    });

    it('capitalizes first letter', () => {
        expect(Utils.parseItemQuantity('dagger')).toEqual({ amt: 1, name: 'Dagger' });
    });
});

describe('Utils.enrichLootItemName', () => {
    it('adds fallback stat to plain equipment loot', () => {
        expect(Utils.enrichLootItemName('Eisenschwert')).toBe('Eisenschwert (STR +1)');
        expect(Utils.enrichLootItemName('Ledermantel')).toBe('Ledermantel (DEX +1)');
        expect(Utils.enrichLootItemName('Stahlhelm')).toBe('Stahlhelm (CON +1)');
    });

    it('keeps existing specs unchanged', () => {
        expect(Utils.enrichLootItemName('Runenschwert (STR +2)')).toBe('Runenschwert (STR +2)');
    });

    it('does not modify non-equipment loot', () => {
        expect(Utils.enrichLootItemName('Heiltrank')).toBe('Heiltrank');
        expect(Utils.enrichLootItemName('Goldmuenze')).toBe('Goldmuenze');
    });
});

describe('Utils.sanitizeCharacter', () => {
    it('fills defaults for empty character', () => {
        const c = Utils.sanitizeCharacter({ name: 'Test' });
        expect(c.level).toBe(1);
        expect(c.xp).toBe(0);
        expect(c.attributes).toEqual({ STR: 10, DEX: 10, INT: 10, CON: 10 });
        expect(c.inventory).toEqual([]);
        expect(c.equipment).toEqual([]);
        expect(c.id).toBeTruthy();
    });

    it('expands stacked inventory items', () => {
        const c = Utils.sanitizeCharacter({ name: 'Test', inventory: ['3x Potion', 'Sword'] });
        expect(c.inventory).toEqual(['Potion', 'Potion', 'Potion', 'Sword']);
    });

    it('preserves existing attributes', () => {
        const c = Utils.sanitizeCharacter({ name: 'Test', level: 5, attributes: { STR: 15, DEX: 12, INT: 8, CON: 14 } });
        expect(c.level).toBe(5);
        expect(c.attributes.STR).toBe(15);
    });
});

describe('Utils.findTarget', () => {
    const list = [
        { name: 'Gimli' },
        { name: 'Legolas der Elf' },
        { name: 'Gandalf der Graue' },
    ];

    it('finds exact match', () => {
        expect(Utils.findTarget(list, 'Gimli')).toBe(list[0]);
    });

    it('finds partial match (name includes search)', () => {
        expect(Utils.findTarget(list, 'Legolas')).toBe(list[1]);
    });

    it('finds reverse partial match (search includes name)', () => {
        expect(Utils.findTarget(list, 'Der große Gimli')).toBe(list[0]);
    });

    it('is case-insensitive', () => {
        expect(Utils.findTarget(list, 'gimli')).toBe(list[0]);
    });

    it('returns null for empty name', () => {
        expect(Utils.findTarget(list, '')).toBeNull();
    });

    it('returns null for no match', () => {
        expect(Utils.findTarget(list, 'Sauron')).toBeUndefined();
    });
});

describe('Utils.generateId', () => {
    it('returns a non-empty string', () => {
        expect(typeof Utils.generateId()).toBe('string');
        expect(Utils.generateId().length).toBeGreaterThan(0);
    });

    it('returns unique values', () => {
        const ids = new Set(Array.from({ length: 100 }, () => Utils.generateId()));
        expect(ids.size).toBe(100);
    });
});
