# Infinite Dungeons

[![Vite](https://img.shields.io/badge/Vite-7.x-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![PeerJS](https://img.shields.io/badge/PeerJS-1.5-orange?logo=webrtc&logoColor=white)](https://peerjs.com/)
[![Vitest](https://img.shields.io/badge/Tested_with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Bun](https://img.shields.io/badge/Bun-1.3-f9f1e1?logo=bun&logoColor=black)](https://bun.sh/)

An AI-powered Dungeon Master for browser-based D&D sessions. Generates narrative, manages combat, tracks party stats and inventory, and supports real-time peer-to-peer multiplayer -- all running client-side with no backend server required.

## Features

- **AI Dungeon Master** -- Connects to Gemini, OpenAI, Anthropic, or OpenRouter to generate contextual narrative, encounters, and NPC dialogue.
- **Full Party Management** -- Character creation with presets, stat tracking (STR/DEX/INT/CON), HP, XP, leveling, equipment, abilities, and talent trees.
- **Turn-Based Combat** -- Enemy spawning via LLM tags, damage/healing resolution, death saves, boss encounters, and XP/gold distribution.
- **Structured LLM Protocol** -- A custom tag system (`[Schaden]`, `[Gegner]`, `[Beute]`, `[Probe]`, etc.) lets the AI trigger game mechanics deterministically while maintaining narrative flow.
- **Peer-to-Peer Multiplayer** -- WebRTC-based via PeerJS. One player hosts, others join with a room code. State syncs automatically on every game event.
- **Persistent State** -- Auto-save/load via `localStorage`, manual save/import as JSON, undo with Ctrl+Z.
- **Sound and TTS** -- Procedural sound effects via Web Audio API, text-to-speech with native and Google TTS fallback.
- **Dynamic Weather** -- Particle-based weather overlay (rain, snow, fog) that affects gameplay via DC modifiers.

## Architecture

```
index.html          HTML shell, modals, layout
style.css           Custom styles, animations
js/
  main.js           Entry point, init, global exports
  state.js          Centralized state with dispatch/subscribe
  engine.js         Core game loop, AI interaction, undo, save/load
  ui.js             DOM manipulation, card builders, chat rendering
  events.js         Delegated event handlers (data-action routing)
  api.js            Multi-provider LLM adapter (Gemini, OpenAI, Claude, OpenRouter)
  tagparser.js      Parses LLM output tags into state mutations
  party.js          Party management (damage, heal, XP, leveling)
  combat.js         Combat lifecycle (spawn, damage, cleanup, end)
  network.js        PeerJS multiplayer (host/client, state sync, TURN config)
  sanitize.js       DOMPurify wrapper, save/hero import validation
  sound.js          Web Audio procedural sound effects
  features.js       Weather system, visual particle effects
  prompts.js        System prompt, presets, talent trees, equipment sets
  constants.js      Game balance constants
  utils.js          Pure utility functions
tests/
  state.test.js     Dispatch/subscribe, all action types
  party.test.js     PartyManager damage, heal, XP, attributes
  utils.test.js     String parsing, character validation, targeting
  sanitize.test.js  XSS vectors, DOMPurify allowlist verification
```

## Prerequisites

- [Bun](https://bun.sh/) >= 1.3 (or [Node.js](https://nodejs.org/) >= 18)
- An API key for at least one supported LLM provider:
  - [Google Gemini](https://ai.google.dev/)
  - [OpenAI](https://platform.openai.com/)
  - [Anthropic Claude](https://console.anthropic.com/)
  - [OpenRouter](https://openrouter.ai/)

## Getting Started

```bash
git clone https://github.com/hagenteimann/infinite_doungen.git
cd infinite_doungen
bun install
bun dev
```

Open `http://localhost:5173` in a browser. Click the settings icon to configure your API provider and key.

## Scripts

| Command            | Description                                |
| ------------------ | ------------------------------------------ |
| `bun dev`          | Start Vite dev server with HMR             |
| `bun run build`    | Production build to `dist/`                |
| `bun run preview`  | Preview the production build locally       |
| `bun run test`     | Run the Vitest test suite                  |

## Multiplayer

Multiplayer uses WebRTC via PeerJS. No dedicated game server is needed -- the free PeerJS cloud signaling server (`0.peerjs.com`) brokers the initial handshake, then all data flows directly between browsers.

1. **Host**: Click the MP button, enter a player name, click "Raum erstellen". Share the generated 6-character room code.
2. **Join**: Click the MP button, enter the room code and a player name, click "Beitreten".
3. State syncs automatically on every dispatched game event.

### Advanced Configuration

The multiplayer modal includes an expandable "Advanced Settings" section for:

- **Custom PeerServer** -- Self-host a signaling server with `bunx peer --port 9000` and point the client to it via host/port/path fields.
- **TURN Relay** -- Configure custom TURN server credentials for connectivity behind strict NAT/firewalls. A free public TURN fallback (metered.ca) is included by default.

### Connection Protocol

```
Host -> Client:  { type: "STATE_SYNC",     state: {...} }
Host -> Client:  { type: "DM_MESSAGE",     text, formatted }
Client -> Host:  { type: "PLAYER_ACTION",  action, actingChar }
Client -> Host:  { type: "DICE_RESULT",    rollId, result }
```

## State Management

Game state lives in a single `State` object in `js/state.js`. Mutations are routed through a `dispatch(action)` function with ~25 action types (`DAMAGE_HERO`, `HEAL_HERO`, `ADD_GOLD`, `ADD_LOOT`, `RESTORE_SNAPSHOT`, etc.). Subscribers registered via `subscribe(fn)` are notified after every dispatch -- this drives the multiplayer sync, dev logging, and future extensibility.

## Security

All LLM output is sanitized through [DOMPurify](https://github.com/cure53/DOMPurify) before DOM insertion. A strict allowlist limits permitted HTML tags and attributes; all event handler attributes (`onclick`, `onerror`, etc.) are explicitly forbidden. Save file imports are validated against a schema to prevent prototype pollution and malformed data.

## Testing

```bash
bun run test
```

Note: Use `bun run test` (not `bun test`) to invoke Vitest. The bare `bun test` command runs bun's built-in test runner which is not fully compatible with Vitest's API.

99 tests across 4 suites covering state dispatch/subscribe, party management, utility functions, and XSS sanitization. Tests run in a jsdom environment via Vitest.

## Tech Stack

| Layer         | Technology                                      |
| ------------- | ----------------------------------------------- |
| Runtime       | Bun 1.3                                         |
| Build         | Vite 7, ES2022 target                           |
| Styling       | Tailwind CSS 4, custom CSS                      |
| Sanitization  | DOMPurify 3                                     |
| Multiplayer   | PeerJS 1.5 (WebRTC)                             |
| Testing       | Vitest 4, jsdom                                 |
| AI Providers  | Gemini, OpenAI, Anthropic Claude, OpenRouter    |
| Audio         | Web Audio API (procedural synthesis)             |

## License

[ISC](LICENSE)
