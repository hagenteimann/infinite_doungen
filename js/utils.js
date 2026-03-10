import { repairDisplayText, repairStoredText } from './sanitize.js';
export const Utils = {
    GOLD_ITEM_NAME: 'Goldmuenze',
    ITEM_STAT_REGEXES: [
        /\b(STR|DEX|INT|CON)\s*([+-]\s*\d+)\b/gi,
        /([+-]\s*\d+)\s*(STR|DEX|INT|CON)\b/gi,
    ],
    generateId: function () {
        return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2);
    },
    splitByCommaOutsideBrackets: function (str) {
        let res = [];
        let current = '';
        let depth = 0;
        for (let i = 0; i < str.length; i++) {
            const c = str[i];
            if (c === '(' || c === '[' || c === '{') depth++;
            else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
            else if (c === ',' && depth === 0) {
                res.push(current.trim());
                current = '';
                continue;
            }
            current += c;
        }
        if (current.trim()) res.push(current.trim());
        return res;
    },
    parseItemQuantity: function (str) {
        let amt = 1, name = repairDisplayText(str).trim();
        const prefixMatch = name.match(/^(\d+)x?\s+(.*)$/i);
        const suffixMatch = name.match(/^(.*?)\s*\(?x(\d+)\)?$/i);
        if (prefixMatch) { amt = parseInt(prefixMatch[1]); name = prefixMatch[2].trim(); }
        else if (suffixMatch) { amt = parseInt(suffixMatch[2]); name = suffixMatch[1].trim(); }

        name = name.charAt(0).toUpperCase() + name.slice(1);
        return { amt, name };
    },
    isGoldItem: function (itemName) {
        const normalized = String(itemName || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
        return normalized === 'goldmuenze' || normalized === 'goldmunze' || normalized === 'goldcoin' || normalized === 'gold';
    },
    getGoldAmount: function (inventory) {
        if (!Array.isArray(inventory)) return 0;
        return inventory.reduce((sum, item) => sum + (this.isGoldItem(item) ? 1 : 0), 0);
    },
    getPartyGold: function (party) {
        if (!Array.isArray(party)) return 0;
        return party.reduce((sum, char) => sum + this.getGoldAmount(char?.inventory || []), 0);
    },
    addGoldToInventory: function (inventory, amount) {
        if (!Array.isArray(inventory) || !amount || amount < 1) return 0;
        for (let i = 0; i < amount; i++) inventory.push(this.GOLD_ITEM_NAME);
        return amount;
    },
    distributeGold: function (party, amount) {
        const eligible = (party || []).filter(char => char && Array.isArray(char.inventory));
        if (!eligible.length || !amount || amount < 1) return [];

        const base = Math.floor(amount / eligible.length);
        const remainder = amount % eligible.length;
        return eligible.map((char, index) => {
            const share = base + (index < remainder ? 1 : 0);
            if (share > 0) this.addGoldToInventory(char.inventory, share);
            return { hero: char, amount: share };
        }).filter(entry => entry.amount > 0);
    },
    _normalizeItemText: function (value) {
        return repairDisplayText(String(value || '')).trim();
    },
    _isStatEffectText: function (text) {
        const normalized = this._normalizeItemText(text);
        if (!normalized) return false;
        return /^(?:(?:STR|DEX|INT|CON)\s*[+-]\s*\d+|[+-]\s*\d+\s*(?:STR|DEX|INT|CON))$/i.test(normalized);
    },
    getItemEffectParts: function (itemName) {
        const original = this._normalizeItemText(itemName);
        const effects = [];
        const baseName = original.replace(/\(([^)]+)\)/g, (_, content) => {
            const cleaned = this._normalizeItemText(content);
            if (cleaned) effects.push(cleaned);
            return ' ';
        }).replace(/\s+/g, ' ').trim();
        return {
            raw: original,
            baseName: baseName || original,
            effects,
        };
    },
    getEquipmentDerivedData: function (equipment) {
        const derived = {
            statBonuses: { STR: 0, DEX: 0, INT: 0, CON: 0 },
            itemAbilities: [],
            displayItems: [],
        };

        (Array.isArray(equipment) ? equipment : []).forEach(itemName => {
            const parts = this.getItemEffectParts(itemName);
            const visibleStats = [];
            const hiddenEffects = [];

            parts.effects.forEach(effect => {
                if (this._isStatEffectText(effect)) {
                    visibleStats.push(effect);
                    this.ITEM_STAT_REGEXES.forEach(regex => {
                        regex.lastIndex = 0;
                        let match;
                        while ((match = regex.exec(effect)) !== null) {
                            const stat = (match[1] && /^(STR|DEX|INT|CON)$/i.test(match[1]) ? match[1] : match[2]).toUpperCase();
                            const rawValue = match[2] && /^([+-]|\s)/.test(match[2]) ? match[2] : match[1];
                            const value = parseInt(String(rawValue || '').replace(/\s+/g, ''), 10);
                            if (!Number.isNaN(value) && derived.statBonuses[stat] !== undefined) {
                                derived.statBonuses[stat] += value;
                            }
                        }
                    });
                    return;
                }

                hiddenEffects.push(effect);
                derived.itemAbilities.push({
                    source: parts.baseName,
                    effect,
                    fullItem: parts.raw,
                });
            });

            const displayName = visibleStats.length > 0
                ? `${parts.baseName} (${visibleStats.join(', ')})`
                : parts.baseName;

            derived.displayItems.push({
                raw: parts.raw,
                displayName,
                tooltip: hiddenEffects.join(' | '),
                hasEffects: hiddenEffects.length > 0,
                visibleStats,
                hiddenEffects,
            });
        });

        return derived;
    },
    normalizeAbilityKeyPart: function (value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'core';
    },
    getAbilityCooldownKey: function (charId, abilityName, sourceName = '') {
        return [String(charId || 'unknown'), this.normalizeAbilityKeyPart(sourceName || 'core'), this.normalizeAbilityKeyPart(abilityName)].join('::');
    },
    sanitizeCharacter: function (c) {
        c = repairStoredText(c || {});
        c.level = c.level || 1; c.xp = c.xp || 0; c.statPoints = c.statPoints || 0;
        c.attributes = c.attributes || { STR: 10, DEX: 10, INT: 10, CON: 10 };
        c.imagePrompt = c.imagePrompt || ""; c.isSummon = c.isSummon || false; c.ability = c.ability || null;
        c.talents = c.talents || []; c.pendingTalentPoints = c.pendingTalentPoints || 0;
        if (!c.id) c.id = this.generateId();

        c.equipment = c.equipment || [];

        if (c.inventory && c.inventory.length > 0) {
            let newInv = [];
            c.inventory.forEach(item => {
                const { amt, name } = this.parseItemQuantity(item);
                for (let i = 0; i < amt; i++) newInv.push(name);
            });
            c.inventory = newInv;
        } else {
            c.inventory = [];
        }
        return c;
    },
    findTarget: function (list, name) {
        if (!Array.isArray(list) || list.length === 0) return undefined;
        if (!name) return null;

        const normalize = (value) => String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\([^)]*\)/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');

        const target = normalize(name);
        if (!target) return undefined;

        const scored = list
            .filter(item => item && item.name)
            .map(item => {
                const normalized = normalize(item.name);
                let score = 0;

                if (normalized === target) score = 100;
                else if (normalized.startsWith(target + ' ')) score = 90;
                else if (target.startsWith(normalized + ' ')) score = 80;
                else if (normalized.split(' ').includes(target)) score = 70;
                else if (normalized.includes(target)) score = 60;
                else if (target.includes(normalized)) score = 50;

                return { item, score, normalizedLength: normalized.length };
            })
            .filter(entry => entry.score > 0)
            .sort((a, b) => b.score - a.score || a.normalizedLength - b.normalizedLength);

        return scored[0]?.item;
    }
};

