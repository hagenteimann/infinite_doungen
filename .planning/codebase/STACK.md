# Technology Stack

**Analysis Date:** 2026-03-09

## Languages

**Primary:**
- JavaScript ES2022 - All game logic, UI, networking, and AI integration in `js/`
- HTML5 - Single-page application shell in `index.html`
- CSS3 - Styling in `style.css`, augmented by Tailwind utility classes

**Secondary:**
- None detected (no TypeScript, no backend language)

## Runtime

**Environment:**
- Browser (vanilla client-side only — no server, no Node.js runtime in production)
- Node.js 24.13.0 — development tooling only (Vite, Vitest)

**Package Manager:**
- Bun 1.3.10 (declared in `package.json` `packageManager` field)
- npm also present (`package-lock.json` exists alongside `bun.lock`)
- Both lockfiles committed

## Frameworks

**Core:**
- None — vanilla ES2022 modules with no UI framework (no React, Vue, Svelte)
- Custom state management via `js/state.js` (`dispatch()` / `subscribe()` pattern)

**Styling:**
- Tailwind CSS 4.2.1 — utility classes applied directly in `index.html`; integrated via Vite plugin (`@tailwindcss/vite`)

**Testing:**
- Vitest 4.0.18 — test runner; configured in `vite.config.js` (`environment: 'jsdom'`)
- jsdom 28.1.0 — DOM simulation for browser API tests

**Build/Dev:**
- Vite 7.3.1 — dev server and production bundler
- Build target: `es2022`
- Base path: `/infinite_doungen/` (GitHub Pages deployment)

## Key Dependencies

**Critical:**
- `peerjs` 1.5.5 — WebRTC peer-to-peer multiplayer networking; used throughout `js/network.js`
- `dompurify` 3.3.2 — HTML sanitization for all AI-generated content; used in `js/sanitize.js`

**Infrastructure:**
- `@tailwindcss/vite` 4.2.1 — Tailwind integration as Vite plugin (dev dependency)

## Configuration

**Environment:**
- No `.env` files detected
- API keys stored in browser `localStorage` at runtime (keys: `api_key_gemini`, `api_key_chatgpt`, `api_key_openrouter`, `api_key_claude`, `api_model_claude`, `api_model_or_text`, `api_model_or_image`, `api_provider`)
- Game auto-save stored in `localStorage` under key `infiniteDungeon_autosave` (`js/constants.js` line 25)
- Multiplayer peer server config stored in `localStorage` under keys `mp_peer_server`, `mp_turn_config`

**Build:**
- `vite.config.js` — Vite + Tailwind plugin, ES2022 target, jsdom test environment
- `package.json` — scripts: `dev`, `build`, `preview`, `test`
- `feature.json` in `public/` — copied to build output; loaded at runtime for feature flags

## Platform Requirements

**Development:**
- Node.js 24+ (for Vite/Vitest tooling)
- Bun 1.3.10 (preferred package manager)
- Run: `npm run dev` or `bun run dev` from project root

**Production:**
- Static file hosting only (no server required)
- Deployed to GitHub Pages at base path `/infinite_doungen/`
- Build output in `dist/` (contains `index.html` + hashed assets)
- All AI API calls made directly from the browser to external provider endpoints

---

*Stack analysis: 2026-03-09*
