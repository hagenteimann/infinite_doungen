# Hero-Verwaltung Startbildschirm — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Spieler kann im `hero-details-modal` auf dem Startbildschirm Stat-Punkte verteilen, Inventar-Items entfernen/umordnen und Ausrüstung an-/ablegen — alles wird sofort in `localStorage` gespeichert.

**Architecture:** `showDefaultHeroDetails()` in `ui.js` wird vollständig ersetzt durch eine interaktive Version. Neue `data-action`-Handler in `events.js` mutieren den Hero-Objekt und rufen `Engine.saveDefaultHero(hero)` + `UI.showDefaultHeroDetails()` auf. Keine Dispatch-Actions, kein Netzwerk-Sync.

**Tech Stack:** Vanilla ES2022, localStorage, DOMPurify (sanitize), Tailwind CSS

---

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `js/sanitize.js` | `data-source` und `data-index` zu `TRUSTED.ALLOWED_ATTR` hinzufügen |
| `js/ui.js` | `showDefaultHeroDetails()` ersetzen |
| `js/events.js` | `EQUIPMENT_LIMIT` importieren + 6 neue Handler |

---

## Task 0: Sanitize-Allowlist erweitern

**Files:**
- Modify: `js/sanitize.js` — `TRUSTED.ALLOWED_ATTR` (Zeile 21–31)

Die neuen Item-Buttons nutzen `data-source` und `data-index`. DOMPurify entfernt alle Attribute, die nicht in der `ALLOWED_ATTR`-Liste stehen. Ohne diesen Schritt werden die Attribute beim `sanitize()`-Aufruf in `showDefaultHeroDetails()` stillschweigend entfernt und alle Handler schlagen lautlos fehl.

- [ ] **Schritt 0.1:** In `js/sanitize.js`, Zeile 28, nach `'data-stat'` folgende zwei Einträge ergänzen:

  Alte Zeile 28:
  ```javascript
  'data-tab', 'data-stat', 'data-player', 'data-room', 'data-provider', 'data-option',
  ```

  Neue Zeile 28:
  ```javascript
  'data-tab', 'data-stat', 'data-player', 'data-room', 'data-provider', 'data-option',
  'data-source', 'data-index',
  ```

- [ ] **Schritt 0.2:** Commit:
  ```bash
  git add js/sanitize.js
  git commit -m "Fix: data-source und data-index zur TRUSTED-Allowlist hinzufügen"
  ```

---

## Task 1: Stat-Punkte-Buttons im Details-Modal

**Files:**
- Modify: `js/ui.js` — Funktion `showDefaultHeroDetails` (Zeile 1275–1342)

- [ ] **Schritt 1.1:** `showDefaultHeroDetails` in `js/ui.js` vollständig ersetzen:

  Alten Block (Zeile 1275–1342) durch folgenden Code ersetzen:

  ```javascript
  showDefaultHeroDetails: function () {
      const hero = Engine.getDefaultHero();
      if (!hero) { this.showToast('Kein Standard-Held gespeichert.'); return; }

      let modal = document.getElementById('hero-details-modal');
      if (!modal) {
          modal = document.createElement('div');
          modal.id = 'hero-details-modal';
          modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4';
          document.body.appendChild(modal);
      }

      const portraitHtml = hero.portrait
          ? `<img src="${hero.portrait}" alt="${repairDisplayText(hero.name)}" class="w-24 h-24 rounded-2xl object-cover border-2 border-amber-500/50 shadow-lg mx-auto mb-3">`
          : `<div class="w-24 h-24 rounded-2xl bg-slate-800 flex items-center justify-center border-2 border-amber-500/30 mx-auto mb-3"><i class="fas fa-shield-halved text-amber-500 text-3xl"></i></div>`;

      const statPoints = hero.statPoints || 0;
      const statPointsBadge = statPoints > 0
          ? `<div class="text-center mb-2"><span class="bg-green-600/80 text-white text-[10px] px-2 py-0.5 rounded-full animate-pulse">${statPoints} Stat-Punkt${statPoints > 1 ? 'e' : ''} verfügbar!</span></div>`
          : '';

      const attrs = hero.attributes || {};
      const attrsHtml = Object.entries(attrs).map(([k, v]) => `
          <div class="bg-black/30 rounded-lg p-2 text-center">
              <div class="text-amber-400 font-bold text-xs">${k}</div>
              <div class="text-white text-sm font-bold">${v}</div>
              ${statPoints > 0 ? `<button data-action="hero-details-upgrade-stat" data-stat="${k}" class="mt-1 bg-green-700 hover:bg-green-600 text-white w-5 h-5 rounded text-xs font-bold transition-colors">+</button>` : ''}
          </div>`).join('');

      const inv = Array.isArray(hero.inventory) ? hero.inventory : [];
      const invHtml = inv.length
          ? inv.map((it, i) => `
              <div class="flex items-center gap-1 bg-slate-700/60 border border-white/10 rounded px-2 py-1 text-[10px] text-slate-300 w-full">
                  <span class="flex-1 truncate">${repairDisplayText(it)}</span>
                  <button data-action="hero-details-item-up" data-source="inventory" data-index="${i}" class="text-slate-400 hover:text-white px-0.5" ${i === 0 ? 'disabled' : ''} title="Nach oben">↑</button>
                  <button data-action="hero-details-item-down" data-source="inventory" data-index="${i}" class="text-slate-400 hover:text-white px-0.5" ${i === inv.length - 1 ? 'disabled' : ''} title="Nach unten">↓</button>
                  <button data-action="hero-details-item-equip" data-index="${i}" class="text-amber-400 hover:text-amber-300 px-0.5" title="Ausrüsten">⚔</button>
                  <button data-action="hero-details-item-remove" data-source="inventory" data-index="${i}" class="text-red-400 hover:text-red-300 px-0.5" title="Entfernen">🗑</button>
              </div>`).join('')
          : '<span class="text-slate-500 text-xs">Leer</span>';

      const eq = Array.isArray(hero.equipment) ? hero.equipment : [];
      const eqHtml = eq.length
          ? eq.map((it, i) => `
              <div class="flex items-center gap-1 bg-amber-900/40 border border-amber-500/20 rounded px-2 py-1 text-[10px] text-amber-300 w-full">
                  <span class="flex-1 truncate">${repairDisplayText(it)}</span>
                  <button data-action="hero-details-item-up" data-source="equipment" data-index="${i}" class="text-amber-400/60 hover:text-amber-300 px-0.5" ${i === 0 ? 'disabled' : ''} title="Nach oben">↑</button>
                  <button data-action="hero-details-item-down" data-source="equipment" data-index="${i}" class="text-amber-400/60 hover:text-amber-300 px-0.5" ${i === eq.length - 1 ? 'disabled' : ''} title="Nach unten">↓</button>
                  <button data-action="hero-details-item-unequip" data-index="${i}" class="text-slate-300 hover:text-white px-0.5" title="Ablegen">📦</button>
                  <button data-action="hero-details-item-remove" data-source="equipment" data-index="${i}" class="text-red-400 hover:text-red-300 px-0.5" title="Entfernen">🗑</button>
              </div>`).join('')
          : '<span class="text-slate-500 text-xs">Keine</span>';

      modal.innerHTML = sanitize(`
          <div class="bg-slate-900/95 border border-amber-500/30 rounded-2xl p-6 max-w-sm w-full shadow-[0_0_40px_rgba(245,158,11,0.15)] max-h-[90vh] overflow-y-auto custom-scrollbar">
              <div class="flex justify-between items-center mb-4">
                  <h2 class="cinzel text-amber-400 text-lg">Mein Held</h2>
                  <button data-action="close-hero-details-modal" class="text-slate-500 hover:text-white transition-colors"><i class="fas fa-times text-lg"></i></button>
              </div>
              ${portraitHtml}
              <div class="text-center mb-4">
                  <div class="cinzel text-white font-bold text-xl">${repairDisplayText(hero.name)}</div>
                  <div class="text-slate-400 text-sm">${repairDisplayText(hero.class || 'Held')} · Level ${hero.level || 1}</div>
                  <div class="text-slate-300 text-sm mt-1">HP <span class="text-amber-400 font-bold">${hero.hp ?? hero.maxHp ?? '?'}</span>/<span class="text-amber-400 font-bold">${hero.maxHp ?? '?'}</span></div>
              </div>
              ${statPointsBadge}
              <div class="grid grid-cols-4 gap-2 mb-4">${attrsHtml}</div>
              <div class="mb-3">
                  <div class="text-slate-400 text-[10px] uppercase tracking-wider mb-1">Inventar</div>
                  <div class="flex flex-col gap-1">${invHtml}</div>
              </div>
              <div class="mb-4">
                  <div class="text-slate-400 text-[10px] uppercase tracking-wider mb-1">Ausrüstung</div>
                  <div class="flex flex-col gap-1">${eqHtml}</div>
              </div>
              <div class="flex gap-2">
                  <button data-action="load-default-hero" class="flex-1 bg-amber-600/20 hover:bg-amber-600/40 border border-amber-500/30 rounded-xl py-2.5 text-xs text-amber-300 transition-all">
                      <i class="fas fa-play mr-1"></i> Laden
                  </button>
                  <button data-action="change-default-hero" class="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl py-2.5 text-xs text-slate-200 transition-all">
                      <i class="fas fa-edit mr-1"></i> Ändern
                  </button>
                  <button data-action="close-hero-details-modal" class="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl py-2.5 text-xs text-slate-400 transition-all">
                      <i class="fas fa-times mr-1"></i> Schließen
                  </button>
              </div>
          </div>`);
      modal.classList.remove('hidden');
  },
  ```

- [ ] **Schritt 1.2:** Commit:
  ```bash
  git add js/ui.js
  git commit -m "Feat: showDefaultHeroDetails mit Stat- und Inventar-Buttons"
  ```

---

## Task 2: Event-Handler + Import

**Files:**
- Modify: `js/events.js` — Import-Block + action-switch

### Schritt 2.1 — `EQUIPMENT_LIMIT` importieren

In `js/events.js` am Anfang der Datei den bestehenden Import-Block suchen. `EQUIPMENT_LIMIT` ist dort **nicht** enthalten. Folgenden Import ergänzen (als neuer `import`-Statement vor den anderen oder als Ergänzung falls bereits ein Import aus `constants.js` existiert):

```javascript
import { EQUIPMENT_LIMIT } from './constants.js';
```

- [ ] **Schritt 2.1:** `import { EQUIPMENT_LIMIT } from './constants.js';` zum Import-Block in `js/events.js` hinzufügen.

### Schritt 2.2 — 6 Handler einfügen

In `js/events.js` direkt **nach** der Zeile `'close-hero-details-modal': () => document.getElementById('hero-details-modal')?.classList.add('hidden'),` folgende 6 Handler einfügen:

```javascript
// Hero-Details: Stat-Upgrade
'hero-details-upgrade-stat': () => {
    const stat = actionEl.dataset.stat;
    if (!stat) return;
    const hero = Engine.getDefaultHero();
    if (!hero || !hero.statPoints || hero.statPoints <= 0) return;
    hero.attributes = hero.attributes || {};
    hero.attributes[stat] = (hero.attributes[stat] || 0) + 1;
    hero.statPoints -= 1;
    Engine.saveDefaultHero(hero);
    UI.showDefaultHeroDetails();
},

// Hero-Details: Item nach oben
'hero-details-item-up': () => {
    const source = actionEl.dataset.source;
    const idx = parseInt(actionEl.dataset.index, 10);
    if (!source || isNaN(idx) || idx <= 0) return;
    const hero = Engine.getDefaultHero();
    if (!hero) return;
    const arr = source === 'inventory' ? hero.inventory : hero.equipment;
    if (!Array.isArray(arr) || idx >= arr.length) return;
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    Engine.saveDefaultHero(hero);
    UI.showDefaultHeroDetails();
},

// Hero-Details: Item nach unten
'hero-details-item-down': () => {
    const source = actionEl.dataset.source;
    const idx = parseInt(actionEl.dataset.index, 10);
    if (!source || isNaN(idx) || idx < 0) return;
    const hero = Engine.getDefaultHero();
    if (!hero) return;
    const arr = source === 'inventory' ? hero.inventory : hero.equipment;
    if (!Array.isArray(arr) || idx >= arr.length - 1) return;
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    Engine.saveDefaultHero(hero);
    UI.showDefaultHeroDetails();
},

// Hero-Details: Item ausrüsten (inventory → equipment)
'hero-details-item-equip': () => {
    const idx = parseInt(actionEl.dataset.index, 10);
    if (isNaN(idx) || idx < 0) return;
    const hero = Engine.getDefaultHero();
    if (!hero) return;
    const inv = Array.isArray(hero.inventory) ? hero.inventory : [];
    const eq = Array.isArray(hero.equipment) ? hero.equipment : [];
    if (idx >= inv.length) return;
    if (eq.length >= EQUIPMENT_LIMIT) { UI.showToast(`Max. ${EQUIPMENT_LIMIT} Ausrüstungsgegenstände.`); return; }
    const [item] = inv.splice(idx, 1);
    eq.push(item);
    hero.inventory = inv;
    hero.equipment = eq;
    Engine.saveDefaultHero(hero);
    UI.showDefaultHeroDetails();
},

// Hero-Details: Ausrüstung ablegen (equipment → inventory)
'hero-details-item-unequip': () => {
    const idx = parseInt(actionEl.dataset.index, 10);
    if (isNaN(idx) || idx < 0) return;
    const hero = Engine.getDefaultHero();
    if (!hero) return;
    const inv = Array.isArray(hero.inventory) ? hero.inventory : [];
    const eq = Array.isArray(hero.equipment) ? hero.equipment : [];
    if (idx >= eq.length) return;
    const [item] = eq.splice(idx, 1);
    inv.push(item);
    hero.inventory = inv;
    hero.equipment = eq;
    Engine.saveDefaultHero(hero);
    UI.showDefaultHeroDetails();
},

// Hero-Details: Item entfernen
'hero-details-item-remove': () => {
    const source = actionEl.dataset.source;
    const idx = parseInt(actionEl.dataset.index, 10);
    if (!source || isNaN(idx) || idx < 0) return;
    const hero = Engine.getDefaultHero();
    if (!hero) return;
    if (source === 'inventory') {
        const inv = Array.isArray(hero.inventory) ? hero.inventory : [];
        if (idx >= inv.length) return;
        inv.splice(idx, 1);
        hero.inventory = inv;
    } else {
        const eq = Array.isArray(hero.equipment) ? hero.equipment : [];
        if (idx >= eq.length) return;
        eq.splice(idx, 1);
        hero.equipment = eq;
    }
    Engine.saveDefaultHero(hero);
    UI.showDefaultHeroDetails();
},
```

- [ ] **Schritt 2.2:** Die 6 Handler in `js/events.js` nach `'close-hero-details-modal'` einfügen.

- [ ] **Schritt 2.3:** Tests laufen lassen:
  ```bash
  bun run test
  ```
  Expected: Alle 99 Tests grün (kein State-Code geändert).

- [ ] **Schritt 2.4:** Manuell testen:
  1. `bun dev` starten
  2. Startbildschirm → "Details" klicken
  3. Inventar-Item mit ↑/↓ verschieben → Position ändert sich, bleibt nach Reload erhalten
  4. Item "⚔ Ausrüsten" → wechselt in Ausrüstungs-Sektion
  5. Ausrüstung "📦 Ablegen" → wechselt zurück ins Inventar
  6. "🗑" → Item verschwindet, nach Reload immer noch weg
  7. Falls Held mit `statPoints > 0`: `+`-Button verteilt Punkt, Badge aktualisiert sich
  8. Test mit `statPoints = 0`: Keine `+`-Buttons sichtbar

- [ ] **Schritt 2.5:** Commit:
  ```bash
  git add js/events.js
  git commit -m "Feat: Held-Verwaltung Startbildschirm — Event-Handler (Stats & Inventar)"
  ```
