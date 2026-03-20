# Design: Held-Verwaltung auf dem Startbildschirm

**Datum:** 2026-03-20
**Status:** Genehmigt

## Ziel

Der Spieler soll seinen im `localStorage` gespeicherten Standard-Helden bereits auf dem Startbildschirm verwalten können — ohne ein Spiel starten zu müssen. Konkret: Stat-Punkte verteilen (nach Level-Up) und das Inventar/Ausrüstung interaktiv bearbeiten.

## Scope

Erweiterung von `UI.showDefaultHeroDetails()` in `js/ui.js` sowie neue Event-Handler in `js/events.js`.

## Design

### Ansatz: Erweitertes Details-Modal (Ansatz A)

Das bestehende `hero-details-modal` wird um interaktive Elemente erweitert. Kein neuer State, keine Dispatch-Actions — alle Änderungen gehen direkt über `Engine.saveDefaultHero(hero)` in den `localStorage` und das Modal wird neu gerendert.

---

### Feature 1: Stat-Punkte verteilen

- `showDefaultHeroDetails()` liest `hero.statPoints`.
- Falls `> 0`: Jedes Attribut bekommt einen `+`-Button (`data-action="hero-details-upgrade-stat"`, `data-stat="STR"` etc.).
- Klick-Handler in `events.js`: Attribut +1, `statPoints` -1, `saveDefaultHero(hero)`, Modal neu rendern via `UI.showDefaultHeroDetails()`.
- Falls `statPoints === 0`: Buttons sind nicht sichtbar.

---

### Feature 2: Inventar-Verwaltung

Jedes Item in `hero.inventory` und `hero.equipment` bekommt 3 Aktions-Buttons:

| Button | Action | data-Attribute | Verhalten |
|--------|--------|----------------|-----------|
| ↑ | `hero-details-item-up` | `data-source`, `data-index` | Tauscht Item mit Vorgänger im Array |
| ↓ | `hero-details-item-down` | `data-source`, `data-index` | Tauscht Item mit Nachfolger im Array |
| ⚔ Ausrüsten | `hero-details-item-equip` | `data-index` | Verschiebt Item von `inventory` → `equipment` (max `EQUIPMENT_LIMIT`) |
| 📦 Ablegen | `hero-details-item-unequip` | `data-index` | Verschiebt Item von `equipment` → `inventory` |
| 🗑 | `hero-details-item-remove` | `data-source`, `data-index` | Entfernt Item aus `inventory` oder `equipment` |

Nach jeder Aktion: `Engine.saveDefaultHero(hero)` → `UI.showDefaultHeroDetails()`.

---

### Datenpersistenz

Alle Änderungen werden sofort über `Engine.saveDefaultHero(hero)` in `localStorage` gespeichert. Der Hero wird beim nächsten `Engine.getDefaultHero()`-Aufruf mit den aktualisierten Daten geladen.

---

### Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `js/ui.js` | `showDefaultHeroDetails()` erweitern: Stat-Buttons, Item-Buttons |
| `js/events.js` | 6 neue `data-action`-Handler hinzufügen |

### Nicht im Scope

- Drag & Drop (zu komplex für den Mehrwert)
- Items hinzufügen
- Talente/Abilities verwalten
- Dispatch-Actions (kein Netzwerk-Sync nötig, da Startbildschirm)
