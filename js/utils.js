export const Utils = {
    GOLD_ITEM_NAME: 'Goldmuenze',
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
        let amt = 1, name = str.trim();
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
    sanitizeCharacter: function (c) {
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
        if (!name || !Array.isArray(list) || list.length === 0) return null;

        const normalize = (value) => String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\([^)]*\)/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');

        const target = normalize(name);
        if (!target) return null;

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

        return scored[0]?.item || null;
    }
};
