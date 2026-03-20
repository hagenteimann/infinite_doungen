# Bugfix & UX-Plan: Infinite Dungeons

**Datum:** 2026-03-20
**Branch:** main
**Ziel:** Alle gefundenen Bugs und UX-Probleme aus der Analyse beheben.

---

## Kontext

Vanilla JS + ES-Module-App. Kein TypeScript, kein Framework.
State-Mutationen über `dispatch(action)` (netzwerk-synchronisiert) oder direkte Mutation (UI-State).
Alle Event-Handler über `data-action` in `events.js`.
Kein Formatter/Linter. 4-Spaces-Einrückung, single quotes.

---

## Task 1 — engine.js Guard-Fixes

**Dateien:** `js/engine.js`

### 1a. `learnTalent()` — Duplikate verhindern
- Vor `char.talents.push(talentName)` prüfen: `if (char.talents.includes(talentName)) return;`

### 1b. `removeCharacter()` — Mindestens 1 Charakter
- Vor dem Entfernen: `if (State.party.length <= 1) { UI.showToast('Du brauchst mindestens einen Helden!'); return; }`

### 1c. `finalizeCharacter()` — Leeren Namen abfangen
- `const name = DOM.newName.value.trim();`
- `if (!name) { UI.showToast('Bitte gib einen Namen ein!'); return; }`

### 1d. `camp()` — isProcessing-Guard
- Erste Zeile: `if (State.isProcessing) return;`
- Toter Party: `if (State.party.every(p => p.hp <= 0)) { UI.showToast('Deine Party ist kampfunfähig!'); return; }`

### 1e. `_soloAdvanceTurn()` — Infinite-Loop-Schutz
- Nach der Loop-Suche nach aktivem Held: Wenn keiner gefunden, auf `State.party[0]` fallbacken statt endlos zu suchen.

### 1f. `confirmUseItem()` — Null-Guard für Character
- `const c = State.party.find(...)` — wenn `!c`, früh returnen mit Toast.

---

## Task 2 — ui.js UX-Verbesserungen

**Dateien:** `js/ui.js`

### 2a. `showCreator()` — Auto-Fokus auf Name-Input
- `setTimeout(() => DOM.newName?.focus(), 100);` am Ende der Funktion.

### 2b. `genPortrait()` — `imageQuotaExceeded` nach Aufruf zurücksetzen
- Wenn der User einen neuen Key eingibt: `State.imageQuotaExceeded = false` vor dem API-Aufruf.

### 2c. `finalizeGeneratorHero()` — Item-Modal schließen wenn Char entfernt
- Nicht direkt hier, aber `closeHeroGenerator()` soll sicherstellen dass keine offenen Modals hängen.

---

## Task 3 — network.js: pendingRolls in SYNC_KEYS

**Datei:** `js/network.js`

- `'pendingRolls'` zur `SYNC_KEYS`-Liste hinzufügen, damit Würfel-Anfragen zwischen Host und Clients synchronisiert werden.

---

## Task 4 — events.js & ui.js: Hero-Import Überschreiben-Warnung

**Dateien:** `js/engine.js`

- Wenn User einen Hero importiert und bereits ein Hero mit derselben `id` oder demselben Namen in `State.party` existiert: Confirmation-Toast/Dialog vor dem Überschreiben.

---

## Task 5 — engine.js: Item-Modal cleanup bei removeCharacter

**Datei:** `js/engine.js`

- In `removeCharacter()`: Wenn `State.actingChar` dem entfernten Charakter entspricht, `State.actingChar = null` setzen und Item-Modal schließen (`DOM.itemActionModal?.classList.add('hidden')`).

---

## Nicht im Scope dieses Plans

- Komplexe Multiplayer Race Conditions (erfordern Protokoll-Änderungen)
- XSS via Network.broadcastChat (separater Security-Patch nötig)
- Modal-Manager (größeres Refactoring)
- Client-Timeout bei Portrait-Generierung (separater Feature-Task)
