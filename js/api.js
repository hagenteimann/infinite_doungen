import { CONFIG } from './prompts.js';
import { State } from './state.js';
import { Utils } from './utils.js';
import { UI } from './ui.js';
import { API_RETRY_COUNT, CLAUDE_MAX_TOKENS } from './constants.js';

export const API = {
    getProvider: function () {
        return Utils.safeStorageGet("api_provider") || "gemini";
    },
    getKey: function (providerStr) {
        const prov = providerStr || this.getProvider();
        return Utils.safeStorageGet(`api_key_${prov}`) || "";
    },
    getOrModelText: function () {
        return Utils.safeStorageGet("api_model_or_text") || "arcee-ai/trinity-large-preview:free";
    },
    getOrModelImage: function () {
        return Utils.safeStorageGet("api_model_or_image") || "";
    },

    generateText: async function (prompt, systemInstruction = CONFIG.systemPrompt) {
        const provider = this.getProvider();
        const apiKey = this.getKey(provider);

        if (!apiKey) throw new Error(`Kein API Key für ${provider} hinterlegt. Bitte in den Einstellungen eintragen.`);

        let lastError = "Netzwerkfehler";
        for (let i = 0; i < API_RETRY_COUNT; i++) {
            try {
                let responseText = "";
                if (provider === "gemini") {
                    const payload = { 
                        contents: [{ parts: [{ text: prompt }] }], 
                        systemInstruction: { parts: [{ text: systemInstruction }] },
                        generationConfig: { responseMimeType: "application/json" }
                    };
                    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.models.text}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    if (!res.ok) {
                        if (res.status === 401) { lastError = "HTTP 401: Zugriff verweigert. API-Key ungültig."; break; }
                        const errorText = await res.text();
                        throw new Error(`HTTP ${res.status}: ${errorText || 'Unbekannter API Fehler'}`);
                    }
                    const data = await res.json();
                    if (data.error) throw new Error(data.error.message);
                    if (!data.candidates || data.candidates.length === 0) throw new Error("Sicherheitsfilter: Blockiert.");
                    responseText = data.candidates[0].content.parts[0].text;
                }
                else if (provider === "chatgpt") {
                    const payload = {
                        model: "gpt-4o-mini",
                        response_format: { type: "json_object" },
                        messages: [
                            { role: "system", content: systemInstruction },
                            { role: "user", content: prompt }
                        ]
                    };
                    const res = await fetch(`https://api.openai.com/v1/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                        body: JSON.stringify(payload)
                    });
                    if (!res.ok) {
                        if (res.status === 401) { lastError = "HTTP 401: OpenAI API-Key ungültig."; break; }
                        const errorText = await res.text();
                        throw new Error(`HTTP ${res.status}: ${errorText}`);
                    }
                    const data = await res.json();
                    responseText = data.choices[0].message.content;
                }
                else if (provider === "openrouter") {
                    const modelText = this.getOrModelText();
                    const payload = {
                        model: modelText,
                        messages: [
                            { role: "system", content: systemInstruction },
                            { role: "user", content: prompt }
                        ]
                    };
                    const res = await fetch(`https://openrouter.ai/api/v1/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                            'HTTP-Referer': window.location.href,
                            'X-Title': 'Infinite Dungeons'
                        },
                        body: JSON.stringify(payload)
                    });
                    if (!res.ok) {
                        if (res.status === 401) { lastError = "HTTP 401: OpenRouter API-Key ungültig."; break; }
                        const errorText = await res.text();
                        throw new Error(`HTTP ${res.status}: ${errorText}`);
                    }
                    const data = await res.json();
                    responseText = data.choices[0].message.content;
                }
                else if (provider === "claude") {
                    const model = Utils.safeStorageGet('api_model_claude') || 'claude-sonnet-4-6';
                    const payload = {
                        model: model,
                        max_tokens: CLAUDE_MAX_TOKENS,
                        system: systemInstruction,
                        messages: [{ role: "user", content: prompt }]
                    };
                    const res = await fetch(`https://api.anthropic.com/v1/messages`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
                        body: JSON.stringify(payload)
                    });
                    if (!res.ok) {
                        if (res.status === 401) { lastError = "HTTP 401: Claude API-Key ungültig."; break; }
                        const errorText = await res.text();
                        throw new Error(`HTTP ${res.status}: ${errorText}`);
                    }
                    const data = await res.json();
                    responseText = data.content[0].text;
                }
                else {
                    throw new Error("Unbekannter Provider");
                }

                // JSON Parsing & Validation für Haupt-Prompt
                if (systemInstruction === CONFIG.systemPrompt) {
                    let cleanText = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
                    try {
                        let parsed = JSON.parse(cleanText);
                        // Engine expects a string right now, so we return the cleaned JSON string
                        // The engine will parse it! Wait, we can return the string so that it's safe.
                        return cleanText;
                    } catch (e) {
                        console.warn("JSON Parse Error. Retrying...", e);
                        if (i < API_RETRY_COUNT - 1) {
                            prompt += "\n\nFEHLER: Deine letzte Antwort war kein g�ltiges JSON. Bitte antworte AUSSCHLIESSLICH im JSON-Format!";
                            continue; // Retry
                        } else {
                            throw new Error("API konnte kein gültiges JSON generieren.");
                        }
                    }
                }
                
                return responseText;
            } catch (err) {
                lastError = err.message;
                console.warn(`API Fehler (Versuch ${i + 1}/${API_RETRY_COUNT}):`, err);
                if (i === API_RETRY_COUNT - 1) throw new Error(lastError);
                await new Promise(r => setTimeout(r, 1500));
            }
        }
        throw new Error(lastError);
    },
    generateImageWithFallbacks: async function (prompts, options = {}) {
        const provider = options.provider || this.getProvider();
        if (State.imageQuotaExceeded && provider === 'gemini') return "";

        const apiKey = options.apiKey || this.getKey(provider);
        if (!apiKey) return "";

        let pUrl = "";
        for (const prompt of prompts) {
            try {
                if (provider === "gemini") {
                    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.models.image}:predict?key=${apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ instances: [{ prompt: prompt.substring(0, 400) }], parameters: { sampleCount: 1 } })
                    });
                    if (!res.ok) {
                        if (res.status === 429) {
                            State.imageQuotaExceeded = true;
                            UI.addChatLog("System", "⚠️ Das Limit für die Bildgenerierung (Gemini) wurde erreicht.");
                            return "";
                        }
                        continue;
                    }
                    const data = await res.json();
                    if (data.predictions?.[0]) return `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`;
                }
                else if (provider === "chatgpt") {
                    const res = await fetch(`https://api.openai.com/v1/images/generations`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                        body: JSON.stringify({
                            model: "dall-e-3",
                            prompt: prompt.substring(0, 1000),
                            n: 1,
                            size: "1024x1024",
                            response_format: "b64_json"
                        })
                    });
                    if (!res.ok) continue;
                    const data = await res.json();
                    if (data.data?.[0]?.b64_json) return `data:image/png;base64,${data.data[0].b64_json}`;
                }
                else if (provider === "openrouter") {
                    const imageModel = this.getOrModelImage();
                    if (!imageModel) return "";

                    const res = await fetch(`https://openrouter.ai/api/v1/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                        body: JSON.stringify({
                            model: imageModel,
                            messages: [{ role: "user", content: "GENERATE IMAGE ONLY: " + prompt.substring(0, 400) }]
                        })
                    });
                    if (!res.ok) continue;
                    const data = await res.json();

                    const msg = data.choices[0]?.message?.content || "";
                    const urlMatch = msg.match(/\]\((https:\/\/[^\)]+)\)/);
                    if (urlMatch) return urlMatch[1];
                }
            } catch (e) {
                console.error(`Image Exception (${provider}):`, e);
            }
        }
        if (!pUrl && !State.imageQuotaExceeded && provider === "gemini" && !options.silent) {
            UI.addChatLog("System", `⚠️ **Bildgenerierung fehlgeschlagen:** Das Bild konnte nicht erstellt werden.`);
        }
        return "";
    }
};






