# External Integrations

**Analysis Date:** 2026-03-09

## APIs & External Services

**AI / Language Models (text generation):**
All providers called directly from the browser via `fetch` in `js/api.js` (`API.generateText()`). The active provider is selected at runtime and stored in `localStorage`.

- **Google Gemini** (default provider)
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
  - Default text model: `gemini-2.5-flash` (configured in `js/prompts.js` `CONFIG.models.text`)
  - Auth: query param `?key={apiKey}` — key stored in `localStorage` as `api_key_gemini`
  - Response format: JSON object (`responseMimeType: "application/json"`)

- **OpenAI ChatGPT**
  - Text endpoint: `https://api.openai.com/v1/chat/completions`
  - Text model: hardcoded `gpt-4o-mini`
  - Image endpoint: `https://api.openai.com/v1/images/generations`
  - Image model: hardcoded `dall-e-3` (1024x1024, b64_json)
  - Auth: `Authorization: Bearer {apiKey}` header — key in `localStorage` as `api_key_chatgpt`

- **OpenRouter**
  - Endpoint: `https://openrouter.ai/api/v1/chat/completions`
  - Text model: user-configurable, stored in `localStorage` as `api_model_or_text` (default: `arcee-ai/trinity-large-preview:free`)
  - Image model: user-configurable, stored in `localStorage` as `api_model_or_image`
  - Auth: `Authorization: Bearer {apiKey}` header — key in `localStorage` as `api_key_openrouter`
  - Extra headers: `HTTP-Referer: {window.location.href}`, `X-Title: Infinite Dungeons`

- **Anthropic Claude**
  - Endpoint: `https://api.anthropic.com/v1/messages`
  - Default model: `claude-sonnet-4-6` (overridable via `localStorage` key `api_model_claude`)
  - Max tokens: 4096 (`CLAUDE_MAX_TOKENS` in `js/constants.js`)
  - Auth: `x-api-key: {apiKey}` header — key in `localStorage` as `api_key_claude`
  - Special header: `anthropic-dangerous-direct-browser-access: true` (required for browser direct calls)
  - API version header: `anthropic-version: 2023-06-01`

**AI / Image Generation:**
Handled by `API.generateImageWithFallbacks()` in `js/api.js`. Provider matches the active text provider.

- **Google Imagen** (Gemini provider)
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:predict`
  - Default image model: `imagen-4.0-fast-generate-001` (configured in `js/prompts.js` `CONFIG.models.image`)
  - Returns base64-encoded PNG
  - Quota exhaustion tracked in `State.imageQuotaExceeded` (HTTP 429 triggers permanent disable for session)

**Retry logic:** All text API calls retry up to `API_RETRY_COUNT` (5) times with 1500ms delay between attempts. Invalid JSON responses prompt the model to retry with an error message appended to the prompt.

## Data Storage

**Databases:**
- None — no backend database

**Local Persistence:**
- Browser `localStorage` — all persistence; used for:
  - Game auto-save: key `infiniteDungeon_autosave`
  - API configuration: keys prefixed `api_key_*`, `api_provider`, `api_model_*`
  - Multiplayer config: keys `mp_peer_server`, `mp_turn_config`
  - TTS config: key `tts_cfg`

**File Storage:**
- Local filesystem only — no cloud file storage

**Caching:**
- None — no service worker, no CDN caching layer

## Authentication & Identity

**Auth Provider:**
- None — no user authentication system
- API keys are user-supplied and stored in `localStorage`; no server-side validation

## Real-Time / Networking

**WebRTC Peer-to-Peer Multiplayer:**
- Library: PeerJS 1.5.5 (`js/network.js`, `import Peer from 'peerjs'`)
- Signaling: PeerJS public cloud server (default) or user-configured custom server via `localStorage` key `mp_peer_server`
- ICE/TURN servers configured in `js/network.js` `DEFAULT_ICE_SERVERS`:
  - STUN: `stun.l.google.com:19302`
  - STUN: `stun.relay.metered.ca:80`
  - TURN: `global.relay.metered.ca:80` and `:443` (free/anonymous credentials)
- Room prefix: `infdung-` prepended to user-entered room code
- Connection timeout: 10000ms
- Host/client role model; host authoritative for state sync

## Monitoring & Observability

**Error Tracking:**
- None — no Sentry, Datadog, or similar

**Logs:**
- Development only: `console.debug('[State]', action)` for all state dispatches (guarded by `import.meta.env?.DEV` in `js/main.js` line 66)
- API errors logged via `console.warn` in `js/api.js`

## CI/CD & Deployment

**Hosting:**
- GitHub Pages — static site hosting
- Base path: `/infinite_doungen/` (set in `vite.config.js`)
- Build output: `dist/` directory

**CI Pipeline:**
- Not detected (no GitHub Actions workflow files, no CI config)

## CDN / External Assets

**Fonts:**
- Google Fonts CDN — `Cinzel` (400, 700) and `Inter` (300, 400, 600); loaded in `index.html`

**Icons:**
- Font Awesome 6.4.0 — loaded from `cdnjs.cloudflare.com` in `index.html`

## Browser APIs Used

- `localStorage` — persistence
- `AudioContext` / `webkitAudioContext` — procedural sound effects (`js/sound.js`)
- `SpeechSynthesis` — text-to-speech with German voice preference (`js/ui.js` TTS module)
- `RTCPeerConnection` — underlying WebRTC (via PeerJS)
- `fetch` — all external HTTP calls

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None — all API calls are request/response, no webhooks

## Environment Configuration

**Required end-user configuration (via in-app settings UI, stored in localStorage):**
- `api_provider` — one of: `gemini`, `chatgpt`, `openrouter`, `claude`
- `api_key_{provider}` — API key for the selected provider
- `api_model_or_text` — text model slug for OpenRouter (optional, has default)
- `api_model_or_image` — image model slug for OpenRouter (optional)
- `api_model_claude` — Claude model ID (optional, defaults to `claude-sonnet-4-6`)

**No secrets location:**
- No `.env` files; no server-side secrets management; all credentials client-side only

---

*Integration audit: 2026-03-09*
