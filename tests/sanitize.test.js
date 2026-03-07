import { describe, it, expect } from 'vitest';
import { sanitize, sanitizeStrict, validateSaveData, validateHeroData } from '../js/sanitize.js';

describe('sanitizeStrict (LLM output)', () => {
    it('strips script tags', () => {
        expect(sanitizeStrict('<script>alert(1)</script>')).toBe('');
    });

    it('strips onerror handlers', () => {
        expect(sanitizeStrict('<img src=x onerror="alert(1)">')).not.toContain('onerror');
    });

    it('strips onclick handlers', () => {
        expect(sanitizeStrict('<span onclick="evil()">text</span>')).not.toContain('onclick');
    });

    it('preserves allowed tags', () => {
        expect(sanitizeStrict('<strong>bold</strong>')).toBe('<strong>bold</strong>');
        expect(sanitizeStrict('<em>italic</em>')).toBe('<em>italic</em>');
    });

    it('strips button tags from untrusted content', () => {
        expect(sanitizeStrict('<button>Click me</button>')).not.toContain('<button');
    });

    it('handles unclosed tags gracefully', () => {
        const result = sanitizeStrict('<div><strong>unclosed');
        expect(result).toBeTruthy();
    });
});

describe('sanitize (trusted application HTML)', () => {
    it('preserves button tags', () => {
        expect(sanitize('<button class="btn">Click</button>')).toContain('<button');
    });

    it('preserves select/option elements', () => {
        expect(sanitize('<select><option value="a">A</option></select>')).toContain('<select');
    });

    it('preserves data-action attributes', () => {
        expect(sanitize('<button data-action="test">Go</button>')).toContain('data-action');
    });

    it('still strips script tags', () => {
        expect(sanitize('<script>alert(1)</script>')).toBe('');
    });
});

describe('validateSaveData', () => {
    it('passes through valid objects', () => {
        const data = { party: [], gameStarted: true };
        expect(validateSaveData(data)).toBe(data);
    });

    it('rejects null', () => {
        expect(() => validateSaveData(null)).toThrow('Invalid save data');
    });

    it('rejects non-objects', () => {
        expect(() => validateSaveData('string')).toThrow('Invalid save data');
        expect(() => validateSaveData(42)).toThrow('Invalid save data');
    });
});

describe('validateHeroData', () => {
    it('passes through valid hero data', () => {
        const data = { name: 'Gimli', class: 'Krieger' };
        expect(validateHeroData(data)).toBe(data);
    });

    it('rejects missing name', () => {
        expect(() => validateHeroData({ class: 'Krieger' })).toThrow('Missing required field: name');
    });

    it('rejects missing class', () => {
        expect(() => validateHeroData({ name: 'Gimli' })).toThrow('Missing required field: class');
    });

    it('rejects empty strings', () => {
        expect(() => validateHeroData({ name: '  ', class: 'Krieger' })).toThrow('Missing required field: name');
    });

    it('rejects null', () => {
        expect(() => validateHeroData(null)).toThrow('Invalid hero data');
    });
});
