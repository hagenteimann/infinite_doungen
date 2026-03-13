import { repairDisplayText, repairStoredText } from './sanitize.js';
export const Utils = {
    GOLD_ITEM_NAME: 'Goldmuenze',
    ITEM_STAT_REGEXES: [
        /\b(STR|DEX|INT|CON)\s*([+-]\s*\d+)\b/gi,
        /([+-]\s*\d+)\s*(STR|DEX|INT|CON)\b/gi,
    ],
    generateId: function (prefix = 'id') {
        return `${prefix}-${crypto.randomUUID()}`;
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
            .replace(/[^a-z0-9 ]+/g, '')
            .trim();
        return /^(\d+\s+)?(goldmunzen?|goldmuenze|goldcoin|gold)$/.test(normalized);
    },
    getGoldAmount: function (inventory) {
        if (!Array.isArray(inventory)) return 0;
        return inventory.reduce((sum, item) => {
            if (!this.isGoldItem(item)) return sum;
            const normalized = String(item || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            const match = normalized.match(/^(\d+)/);
            return sum + (match ? parseInt(match[1], 10) : 1);
        }, 0);
    },
    getPartyGold: function (party) {
        if (!Array.isArray(party)) return 0;
        return party.reduce((sum, char) => sum + this.getGoldAmount(char?.inventory || []), 0);
    },
    addGoldToInventory: function (inventory, amount) {
        if (!Array.isArray(inventory) || !amount || amount < 1) return 0;
        const existing = this.getGoldAmount(inventory);
        for (let i = inventory.length - 1; i >= 0; i--) {
            if (this.isGoldItem(inventory[i])) inventory.splice(i, 1);
        }
        const total = existing + amount;
        inventory.push(`${total} Goldmünzen`);
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
    _getLootItemBonusSpec: function (itemName) {
        const normalized = this._normalizeItemText(itemName).toLowerCase();
        if (!normalized) return '';
        const keywordGroups = [
            { pattern: /(stab|zauberstab|fokus|orb|buch|grimoire|kristall)/i, stat: 'INT' },
            { pattern: /(bogen|dolch|messer|leder|robe|mantel|umhang)/i, stat: 'DEX' },
            { pattern: /(ruestung|rüstung|schild|helm|panzer|harnisch|brustplatte)/i, stat: 'CON' },
            { pattern: /(schwert|axt|hammer|keule|speer|streitkolben|klinge)/i, stat: 'STR' },
            { pattern: /(ring|amulett|talisman|reif|kette)/i, stat: 'INT' },
        ];
        const match = keywordGroups.find(entry => entry.pattern.test(normalized));
        if (!match) return '';
        const tierTwo = /\b(episch|legendär|mythisch|uralt|erz|runen|arkane|arcan|meisterlich)\b/i.test(normalized);
        return '(' + match.stat + ' +' + (tierTwo ? 2 : 1) + ')';
    },
    _getLootItemMagicEffect: function (itemName) {
        const normalized = this._normalizeItemText(itemName).toLowerCase();
        if (!normalized) return '';
        const effectGroups = [
            { pattern: /(runen|rune|arkane|arcan|zauber|mystisch)/i, effect: 'Verstärkt arkane Macht' },
            { pattern: /(flammen|feuer|glut|inferno)/i, effect: 'Entfacht einen kleinen Feuerfunken beim Treffer' },
            { pattern: /(frost|winter|gletscher|frostfeuer)/i, effect: 'Kühlt die Luft und verlangsamt kurz' },
            { pattern: /(schatten|nacht|dunkel)/i, effect: 'Hüllt den Träger kurz in Schatten' },
            { pattern: /(heilig|licht|sonnen|engel)/i, effect: 'Spendet einen heiligen Lichtimpuls' },
            { pattern: /(gift|venom|tox)/i, effect: 'Hinterlässt einen schwachen Giftstachel' },
        ];
        const match = effectGroups.find(entry => entry.pattern.test(normalized));
        return match ? '(' + match.effect + ')' : '';
    },
    enrichLootItemName: function (itemName) {
        const parts = this.getItemEffectParts(itemName);
        if (!parts.raw || parts.effects.length > 0 || this.isGoldItem(parts.raw)) return parts.raw;
        const spec = this._getLootItemBonusSpec(parts.baseName);
        const magicEffect = this._getLootItemMagicEffect(parts.baseName);
        return [parts.baseName, spec, magicEffect].filter(Boolean).join(' ').trim() || parts.raw;
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
                if (amt > 1 && this.isGoldItem(name)) {
                    const existingGold = this.getGoldAmount(newInv);
                    for (let j = newInv.length - 1; j >= 0; j--) {
                        if (this.isGoldItem(newInv[j])) newInv.splice(j, 1);
                    }
                    newInv.push(`${existingGold + amt} Goldmünzen`);
                } else {
                    for (let i = 0; i < amt; i++) newInv.push(name);
                }
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
    },
    // Security: localStorage access wrappers (avoid crashes in private mode).
    safeStorageGet: function (key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.warn('Storage get failed:', key, e);
            return null;
        }
    },
    safeStorageSet: function (key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.warn('Storage set failed:', key, e);
        }
    },
    safeStorageRemove: function (key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.warn('Storage remove failed:', key, e);
        }
    },
    // Security: central image loader with error handling (sprite sheets later).
    loadImage: function (src) {
        return new Promise((resolve) => {
            try {
                const img = new Image();
                img.onload = () => resolve({ ok: true, img });
                img.onerror = () => resolve({ ok: false, img: null });
                img.src = src;
            } catch (e) {
                console.warn('Image load failed:', e);
                resolve({ ok: false, img: null });
            }
        });
    },
    preloadImages: async function (sources) {
        if (!Array.isArray(sources)) return [];
        const results = [];
        for (const src of sources) {
            // Keep behavior non-blocking; just warm the cache.
            results.push(await this.loadImage(src));
        }
        return results;
    },};

