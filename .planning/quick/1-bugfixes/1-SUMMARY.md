# Bugfixes Summary

## Fix 1: Missing `updateTargetModeButton` in ui.js (CRITICAL)

**Root cause:** `_updateAllInternal` in `js/ui.js` (lines 470, 480) called
`this.updateTargetModeButton()`, but the function was never defined on the UI
object. JavaScript threw a TypeError at that call site, which halted execution
of `_updateAllInternal` before `updateActionBox()` was reached.

**Symptom chain:**
1. `updateAll()` triggers `_updateAllInternal()`
2. `this.updateTargetModeButton()` throws `TypeError: this.updateTargetModeButton is not a function`
3. `updateActionBox()` is never called
4. Clients never see the pending-rolls / dice window
5. Console fills with uncaught TypeErrors on every state update

**Fix:** Added `updateTargetModeButton()` to the UI object in `js/ui.js` directly
after `updateSelfControlButton`. The function reads `State.targetMapMode` and
toggles amber/active styling on `#target-mode-btn` and its child icon element.

**Files changed:** `js/ui.js`

---

## Fix 2: Missing `TRANSIENT_EVENT` case in `_handleHostMessage`

**Root cause:** The host sends `{ type: 'TRANSIENT_EVENT', event: ... }` messages
to all clients via `_addTransientEvent()` in `js/network.js`. However,
`_handleHostMessage` had no `case 'TRANSIENT_EVENT'` branch, so every such
message fell through to the `default:` handler and logged a console warning.
Clients also never displayed the transient event in their UI.

**Fix:** Added a `case 'TRANSIENT_EVENT'` block before the `default:` in
`_handleHostMessage`. The handler mirrors the logic in `_addTransientEvent`:
validates the event is not already expired, upserts it into
`State.transientEvents`, trims the array to 12 entries, and calls
`UI.showTransientEvent(evt)`.

**Files changed:** `js/network.js`

---

## Fix 3: `feature.json` missing from Vite build output

**Root cause:** `js/features.js` fetches `feature.json` via a relative path
(`fetch('feature.json')`). The file lived only at the project root. Vite copies
only files from `public/` into `dist/` during build; files in the root are not
served in production. On GitHub Pages the request returned 404.

**Fix:** Copied `feature.json` to `public/feature.json`. Vite serves `public/`
files at the site root, so `fetch('feature.json')` resolves correctly both in
development (Vite dev server) and production (dist/). No code changes to
`features.js` were necessary.

**Files changed:** `public/feature.json` (new file)

---

## Commits

| Hash    | Message                                                     |
|---------|-------------------------------------------------------------|
| 0b2ac71 | Fix updateTargetModeButton crash and TRANSIENT_EVENT handler |
| fb59631 | Add feature.json to public dir for build output             |
