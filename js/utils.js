export const Utils = {
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
        if (!name) return null;
        const n = name.toLowerCase().trim();
        return list.find(x => x.name.toLowerCase() === n) || list.find(x => x.name.toLowerCase().includes(n)) || list.find(x => n.includes(x.name.toLowerCase()));
    }
};
