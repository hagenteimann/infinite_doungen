import { CONFIG } from './prompts.js';
import { State } from './state.js';
import { UI } from './ui.js';
import { API_RETRY_COUNT, CLAUDE_MAX_TOKENS } from './constants.js';

export const API = {
    getProvider: function () {
        return localStorage.getItem("api_provider") || "gemini";
    },
    getKey: function (providerStr) {
        const prov = providerStr || this.getProvider();
        return localStorage.getItem(`api_key_${prov}`) || "";
    },
    getOrModelText: function () {
        return localStorage.getItem("api_model_or_text") || "google/gemini-2.5-flash";
    },
    getOrModelImage: function () {
        return localStorage.getItem("api_model_or_image") || "";
    },

    generateText: async function (prompt, systemInstruction = CONFIG.systemPrompt) {
        const provider = this.getProvider();
        const apiKey = this.getKey(provider);

        if (!apiKey) throw new Error(`Kein API Key für ${provider} hinterlegt. Bitte in den Einstellungen eintragen.`);

        let lastError = "Netzwerkfehler";
        for (let i = 0; i < API_RETRY_COUNT; i++) {
            try {
                if (provider === "gemini") {
                    const payload = { contents: [{ parts: [{ text: prompt }] }], systemInstruction: { parts: [{ text: systemInstruction }] } };
                    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.models.text}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    if (!res.ok) {
                        if (res.status === 401) { lastError = "HTTP 401: Zugriff verweigert. API-Key ungültig."; break; }
                        const errorText = await res.text();
                        throw new Error(`HTTP ${res.status}: ${errorText || 'Unbekannter API Fehler'}`);
                    }
                    const data = await res.json();
                    if (data.error) throw new Error(data.error.message);
                    if (!data.candidates || data.candidates.length === 0) throw new Error("Sicherheitsfilter: Blockiert.");
                    return data.candidates[0].content.parts[0].text;
                }
                else if (provider === "chatgpt") {
                    const payload = {
                        model: "gpt-4o-mini",
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
                    return data.choices[0].message.content;
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
                    return data.choices[0].message.content;
                }
                else if (provider === "claude") {
                    const model = localStorage.getItem('api_model_claude') || 'claude-sonnet-4-6';
                    const payload = {
                        model: model,
                        max_tokens: CLAUDE_MAX_TOKENS,
                        system: systemInstruction,
                        messages: [{ role: "user", content: prompt }]
                    };
                    const res = await fetch(`https://api.anthropic.com/v1/messages`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': apiKey,
                            'anthropic-version': '2023-06-01',
                            'anthropic-dangerous-direct-browser-access': 'true'
                        },
                        body: JSON.stringify(payload)
                    });
                    if (!res.ok) {
                        if (res.status === 401) { lastError = "HTTP 401: Anthropic API-Key ungültig."; break; }
                        const errorText = await res.text();
                        throw new Error(`HTTP ${res.status}: ${errorText}`);
                    }
                    const data = await res.json();
                    return data.content[0].text;
                }
            } catch (e) {
                lastError = e.message;
                if (lastError.includes("401") || lastError.includes("ungültig") || lastError.includes("fehlt")) break;
                await new Promise(r => setTimeout(r, 1000 * (i + 1)));
            }
        }
        throw new Error(lastError);
    },
    generateImageWithFallbacks: async function (prompts) {
        if (State.imageQuotaExceeded) return "";

        const provider = this.getProvider();
        const apiKey = this.getKey(provider);
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
        if (!pUrl && !State.imageQuotaExceeded && provider === "gemini") {
            UI.addChatLog("System", `⚠️ **Bildgenerierung fehlgeschlagen:** Das Bild konnte nicht erstellt werden.`);
        }
        return "";
    }
};
