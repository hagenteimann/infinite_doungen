# Coding Conventions

**Analysis Date:** 2026-03-09

## Naming Patterns

**Files:**
- kebab-case is not used; files are single-word lowercase: `engine.js`, `network.js`, `party.js`, `tagparser.js`
- Test files mirror module name: `tests/network.test.js`, `tests/state.test.js`

**Functions / Methods:**
- camelCase for all methods: `interactWithAI()`, `beginSessionFlow()`, `submitCombatAction()`
- Private helpers prefixed with underscore: `_requireHost()`, `_syncLocalProfile()`, `_generateAutoAction()`, `_getCharForPlayer()`
- Boolean getters use `is`/`can` prefix: `isHost()`, `isClient()`, `isConnected()`, `isInCombat()`, `canRollFor()`

**Variables / Properties:**
- camelCase for all variables: `turnOrder`, `combatActions`, `playerCharMap`
- Private state on singleton objects prefixed with underscore: `_unsubscribe`, `_idCounter`, `_seenMessageIds`, `_syncDirty`
- Boolean flags use past tense or `is`/`has`: `gameStarted`, `combatEnded`, `isProcessing`, `isBossFight`, `isSummon`

**Constants:**
- SCREAMING_SNAKE_CASE for all named constants in `js/constants.js`: `BASE_HP`, `XP_BASE`, `CHAT_HISTORY_MAX`
- Module-local string constants use SCREAMING_SNAKE_CASE: `ROOM_PREFIX`, `SYNC_KEYS`, `CONNECT_TIMEOUT_MS`

**Dispatch Action Types:**
- SCREAMING_SNAKE_CASE strings: `'DAMAGE_HERO'`, `'ADD_GOLD'`, `'SET_PROCESSING'`, `'RESTORE_SNAPSHOT'`
- Verb-noun pattern: `DAMAGE_HERO`, `HEAL_HERO`, `ADD_XP`, `SET_MERCHANT`, `BULK_UPDATE`

**CSS / HTML:**
- Tailwind utility classes inline on elements
- `data-action` attribute values use kebab-case: `'show-api-settings'`, `'submit-action'`, `'entity-click'`, `'assign-loot'`

## Code Style

**Language:**
- Vanilla ES2022 modules. No TypeScript.
- `const` is preferred over `let`. `var` is forbidden.
- Template literals for all HTML generation and multi-token string interpolation. No `+` string concatenation for HTML.
- Arrow functions for callbacks; regular function expressions or method shorthand for named module members.

**Formatting:**
- No formatter configured (no `.prettierrc`, no Biome). Convention is 4-space indentation observed across all files.
- Single quotes for string literals in JS.

**Linting:**
- No ESLint configured. Idiomatic ES2022 is the standard.

**Modules:**
- ES modules only (`import`/`export`). No CommonJS (`require`/`module.exports`).
- Each file exports a single named singleton object (`Engine`, `Network`, `UI`, `PartyManager`, `Utils`) or a set of closely related named exports (`dispatch`, `subscribe`, `State` from `js/state.js`).
- No default exports for singleton objects — named exports only.
- Import only what is needed; no wildcard imports.

## Import Organization

**Order (observed pattern):**
1. Third-party packages: `import Peer from 'peerjs'`, `import DOMPurify from 'dompurify'`
2. Internal modules — closest siblings first, then cross-module: `'./state.js'`, `'./ui.js'`, `'./engine.js'`
3. Constants: `'./constants.js'`

**Path Aliases:** None configured. All imports use relative paths (`./`, `../js/`).

## State Mutations

Two tiers of mutation are intentional:

**Observable mutations — use `dispatch()`:**
```javascript
// When mutation must be synced over network or trigger UI subscribers
dispatch({ type: 'ADD_GOLD', amount: 50 });
dispatch({ type: 'DAMAGE_HERO', charId: char.id, amount: 7 });
```

**Direct mutations — acceptable for transient/UI state:**
```javascript
// Flags that don't need to be observed or synced
State.isProcessing = true;
State.tempPortraitData = dataUrl;
```

When adding a new dispatch action: add it to the `switch` in `js/state.js` AND write a corresponding test in `tests/state.test.js`.

## Event Handling

All user interaction goes through `data-action` event delegation in `js/events.js`.

**Pattern:**
```javascript
// In HTML or JS-generated markup
`<button data-action="submit-action" data-text="${sanitize(value)}">Go</button>`

// Handled in ACTIONS map inside initEvents() in js/events.js
'submit-action': () => {
    const text = actionEl.dataset.text;
    text ? Engine.submitPlayerAction(text) : Engine.submitPlayerAction();
},
```

**Forbidden:** Inline `onclick`, `onchange` handlers in HTML strings or template literals. This applies even for dynamically generated content.

## DOM and HTML Generation

All untrusted content (LLM output, player-imported saves, AI-generated text) must be sanitized before DOM insertion:

```javascript
// For LLM / untrusted content
import { sanitizeStrict } from './sanitize.js';
el.innerHTML = sanitizeStrict(llmResponse);

// For trusted application-generated HTML (can use buttons, data-action, etc.)
import { sanitize } from './sanitize.js';
el.innerHTML = sanitize(appHtml);
```

Raw `innerHTML` with AI-sourced strings is forbidden.

## Error Handling

Every `catch` block must either log or surface the error to the user. Empty catch blocks are forbidden.

```javascript
// Correct pattern
try {
    await api.call();
} catch (e) {
    console.error('API call failed:', e);
    UI.addChatLog('System', 'Anfrage fehlgeschlagen: ' + e.message);
}

// Also acceptable for recoverable non-critical errors
} catch (e) {
    console.warn('Sound playback failed:', e);
}
```

Critical async flows (e.g., `interactWithAI` in `js/engine.js`) use `try/finally` to guarantee `isProcessing = false` is always reset:
```javascript
try {
    dispatch({ type: 'SET_PROCESSING', value: true });
    await doWork();
} finally {
    dispatch({ type: 'SET_PROCESSING', value: false });
}
```

## Numeric Parsing

All numbers parsed from LLM tag content must be validated before use:

```javascript
// Correct
const dmg = parseInt(parts[1], 10);
if (isNaN(dmg) || dmg < 0) return;
char.hp -= dmg;
```

`parseInt` without radix 10 or without NaN guard is a bug per the project's known-issues registry.

## Logging

**No logging library.** Use native browser console:
- `console.error(message, e)` — for caught exceptions and unexpected failures
- `console.warn(message)` — for recoverable issues (e.g., unknown dispatch action)
- `console.log` — avoided in production paths; not observed in current source

System messages surfaced to the user go through `UI.addChatLog('System', text)`.

## Constants

All game balance numbers live in `js/constants.js` as named exports. No magic numbers in logic files.

```javascript
// Correct
import { BASE_HP, HP_PER_LEVEL } from './constants.js';
const maxHp = BASE_HP + (level - 1) * HP_PER_LEVEL;

// Forbidden
const maxHp = 20 + (level - 1) * 5;
```

## Async Patterns

Sequential async operations (e.g., tag processing) use `for...of` with `await`, not `forEach` with async callbacks:

```javascript
// Correct
for (const tag of tags) {
    await processTag(tag);
}

// Forbidden (async forEach does not await)
tags.forEach(async tag => { await processTag(tag); });
```

## Entity IDs

Use `crypto.randomUUID()` for all entity IDs. `Date.now() + Math.random()` is forbidden (collision risk).

```javascript
// Correct (from js/utils.js)
generateId: function () {
    return crypto.randomUUID();
},
```

## Comments

- JSDoc is used sparingly, only where intent is non-obvious.
- Section dividers in long files use line comments: `// ──────────────────────────────────────────`
- Inline comments explain "why", not "what".
- No block (`/* */`) comments observed in source.

## Module Design

**Exports:** Named exports only. Each module exports one singleton object or a small set of related functions.

**No barrel files.** Each consumer imports directly from the source module.

**Module singletons** are plain objects with method shorthand:
```javascript
export const Engine = {
    _privateFlag: false,
    publicMethod() { ... },
    _privateHelper() { ... },
};
```

---

*Convention analysis: 2026-03-09*
