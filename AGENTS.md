# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
bun dev           # Start Vite dev server with HMR at http://localhost:5173
bun run build     # Production build to dist/
bun run preview   # Preview production build locally
bun run test      # Run Vitest test suite (use `bun run test`, NOT `bun test`)
```

> `bun test` runs Bun's built-in runner, which is incompatible with Vitest's API. Always use `bun run test`.

## Architecture

**Infinite Dungeons** is a fully client-side, AI-powered D&D Dungeon Master app with P2P multiplayer. No backend server — everything runs in the browser.

### Data Flow

```
User interaction
  → data-action attributes → events.js (delegated handler)
    → engine.js (game logic, AI calls)
      → dispatch(action) → state.js (single State object)
        → subscribers notified → network.js syncs to peers, UI re-renders
```

### Key Modules

| Module | Role |
|--------|------|
| `js/state.js` | Single `State` object; `dispatch(action)` / `subscribe(fn)` pattern |
| `js/engine.js` | Core game loop, AI interaction, turn management, undo, save/load |
| `js/ui.js` | DOM builders, chat rendering, card components, modals |
| `js/events.js` | All user input via `data-action` delegation — no inline handlers |
| `js/api.js` | Multi-provider LLM adapter (Gemini, OpenAI, Anthropic, OpenRouter) |
| `js/tagparser.js` | Parses LLM output tags (`[Schaden]`, `[Gegner]`, etc.) into state mutations |
| `js/network.js` | PeerJS/WebRTC host/client logic, state sync |
| `js/party.js` | Character stats, damage, heal, XP, leveling |
| `js/combat.js` | Combat lifecycle: spawn, damage, end |
| `js/prompts.js` | System prompt, character presets, talent trees |
| `js/constants.js` | All game balance numbers (no magic numbers in logic files) |
| `js/sanitize.js` | DOMPurify wrapper — used for all LLM output before DOM insertion |

### State Mutations — Two Tiers

**Use `dispatch()` for observable mutations** (network-synced, subscriber-notified):
```javascript
dispatch({ type: 'DAMAGE_HERO', charId: char.id, amount: 7 });
dispatch({ type: 'ADD_GOLD', amount: 50 });
```

**Direct mutation acceptable for transient/UI state** (not synced):
```javascript
State.isProcessing = true;
State.tempPortraitData = dataUrl;
```

When adding a new dispatch action: add the case to `js/state.js` AND write a test in `tests/state.test.js`.

## Coding Conventions

- **Language:** Vanilla ES2022 modules. No TypeScript, no UI framework. `const` over `let`; `var` is forbidden.
- **Formatting:** 4-space indentation, single quotes in JS. No formatter/linter configured.
- **Modules:** Named exports only, no default exports. Each module exports one singleton object (`Engine`, `UI`, `Network`, etc.) or closely related named exports. No barrel files — import directly from the source module.
- **Naming:** camelCase for functions/variables; `_prefix` for private helpers; `SCREAMING_SNAKE_CASE` for constants and dispatch action types (verb-noun: `DAMAGE_HERO`, `ADD_GOLD`).
- **HTML generation:** Template literals only — no `+` string concatenation for HTML.
- **Event handling:** All user interaction via `data-action` attribute delegation in `events.js`. Inline `onclick`/`onchange` in HTML strings is forbidden.
- **Entity IDs:** `crypto.randomUUID()` only. `Date.now() + Math.random()` is forbidden.
- **Async:** Use `for...of` with `await` for sequential async; `async forEach` is forbidden.
- **Critical async flows** use `try/finally` to guarantee `SET_PROCESSING` is always reset.

## Security Rules

- All LLM output and imported save data must pass through `sanitizeStrict()` from `js/sanitize.js` before DOM insertion. Raw `innerHTML` with AI-sourced strings is forbidden.
- Application-generated HTML (trusted) uses `sanitize()` (permissive allowlist).
- All numbers parsed from LLM tag content must be validated: `parseInt(x, 10)` with an `isNaN` guard before use.
- Empty `catch` blocks are forbidden — always log or surface errors.

## Tests

99 tests across 5 files in `tests/`. Each test file mirrors its module (`state.test.js` → `state.js`). Tests run under jsdom via Vitest. New dispatch action types require a corresponding test in `tests/state.test.js`.

## Deployment

GitHub Actions (`deploy.yml`) builds on push to `main` and deploys to GitHub Pages. Build output goes to `dist/` with base path `/infinite_doungen/`.
