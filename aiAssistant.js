"use strict";

const crypto = require("crypto");

const MODEL = "@cf/zai-org/glm-4.7-flash";
const MAX_PROMPT_LENGTH = 2000;
const MAX_STORED_MESSAGES = 60;
const CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_CHARS = 8000;
const MAX_OUTPUT_TOKENS = 600;
const MAX_DAILY_REQUESTS = 40;
const DEFAULT_DAILY_LIMIT = 8;
const MAX_CONFIGURED_DAILY_LIMIT = 40;
const DEFAULT_PER_MINUTE_LIMIT = 3;
const MAX_CONFIGURED_PER_MINUTE_LIMIT = 6;
const instructions = [
    "You are TalkChat AI, a helpful assistant inside the TalkChat social app.",
    "Answer the user's question directly and in the language they used.",
    "You only know the messages in this AI conversation. Do not claim to read TalkChat profiles, chats, files, or account data.",
    "Do not ask for passwords, API keys, or other secrets."
].join(" ");

function configuredLimit(value, fallback, maximum) {
    if (value === undefined || value === null || String(value).trim() === "") return fallback;
    const parsed = Number(String(value).trim());
    if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maximum);
}

function normalizeMessages(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(item =>
        item && (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" && item.content.length <= 10000
    ).slice(-MAX_STORED_MESSAGES).map(item => ({
        id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
        role: item.role,
        content: item.content,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString()
    }));
}

function contextMessages(previous) {
    const selected = [];
    let remaining = MAX_CONTEXT_CHARS;
    for (const item of previous.slice(-CONTEXT_MESSAGES).reverse()) {
        if (remaining <= 0) break;
        const content = item.content.slice(-remaining);
        if (!content) continue;
        selected.push({ role: item.role, content });
        remaining -= content.length;
    }
    return selected.reverse();
}

function extractText(body) {
    const content = body?.result?.choices?.[0]?.message?.content ??
        body?.choices?.[0]?.message?.content ??
        body?.result?.response ?? body?.response;
    return typeof content === "string" ? content.trim() : "";
}

function cloudflareError(status, body) {
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    const codes = new Set(errors.map(item => String(item?.code ?? "")));
    if (status === 429 || codes.has("3036")) {
        return { status: 429, error: "Cloudflare AI gündəlik kvotaya və ya tutum limitinə çatıb. Sorğu təkrar göndərilməyib; limitin yenilənməsini gözlə." };
    }
    if ([401, 402, 403].includes(status) || ["3023", "5018", "5035"].some(code => codes.has(code))) {
        return { status: 503, error: "Cloudflare AI hesabı, model icazəsi və ya planı yoxlanmalıdır. Sorğu təkrar göndərilməyib." };
    }
    if ([400, 404].includes(status) || ["3042", "5007", "5028"].some(code => codes.has(code))) {
        return { status: 503, error: "Cloudflare AI modeli bu hesab üçün hazırda əlçatan deyil. Sorğu təkrar göndərilməyib." };
    }
    return { status: 502, error: "Cloudflare AI hazırda cavab verə bilmir. Sorğu avtomatik təkrar edilməyib." };
}

function installAIAssistant({ app, readJSON, saveJSON, requireAuth, currentUser, userRateLimit, env = process.env, fetchImpl = globalThis.fetch }) {
    const dailyLimit = configuredLimit(env.AI_ASSISTANT_DAILY_LIMIT, DEFAULT_DAILY_LIMIT, MAX_CONFIGURED_DAILY_LIMIT);
    const perMinuteLimit = configuredLimit(env.AI_ASSISTANT_PER_MINUTE_LIMIT, DEFAULT_PER_MINUTE_LIMIT, MAX_CONFIGURED_PER_MINUTE_LIMIT);
    const readAll = () => {
        const data = readJSON("aiAssistant.json", {});
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    };
    const messagesFor = username => normalizeMessages(readAll()[username]);
    const saveFor = (username, messages) => {
        const all = readAll();
        all[username] = normalizeMessages(messages);
        saveJSON("aiAssistant.json", all);
    };
    const takeDailyRequest = username => {
        const today = new Date().toISOString().slice(0, 10);
        const dailyData = readJSON("aiAssistantDailyUsage.json", {});
        const accountCount = dailyData?.date === today ? Number(dailyData.count) || 0 : 0;
        if (accountCount >= dailyLimit) return false;

        const userData = readJSON("aiAssistantUsage.json", {});
        const all = userData && typeof userData === "object" && !Array.isArray(userData) ? userData : {};
        const previous = all[username];
        const userCount = previous?.date === today ? Number(previous.count) || 0 : 0;
        if (userCount >= MAX_DAILY_REQUESTS) return false;

        saveJSON("aiAssistantDailyUsage.json", { date: today, count: accountCount + 1 });
        all[username] = { date: today, count: userCount + 1 };
        saveJSON("aiAssistantUsage.json", all);
        return true;
    };
    const noStore = res => res.set("Cache-Control", "private, no-store");
    const perMinute = userRateLimit(60 * 1000, perMinuteLimit, "AI dəqiqəlik sorğu limiti dolub. Bir az sonra yenidən cəhd et.");

    app.get("/api/ai-assistant/history", requireAuth, (req, res) => {
        noStore(res);
        res.json(messagesFor(currentUser(req)));
    });

    app.delete("/api/ai-assistant/history", requireAuth, (req, res) => {
        const username = currentUser(req);
        saveFor(username, []);
        noStore(res);
        res.json({ ok: true });
    });

    app.post("/api/ai-assistant/messages", requireAuth, perMinute, async (req, res) => {
        noStore(res);
        const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
        if (!message || message.length > MAX_PROMPT_LENGTH)
            return res.status(400).json({ error: "Mesaj 1–" + MAX_PROMPT_LENGTH + " simvol arasında olmalıdır." });

        if (String(env.AI_ENABLED || "").trim().toLowerCase() !== "true" ||
            String(env.CLOUDFLARE_OWNER_VERIFIED || "").trim().toLowerCase() !== "true") {
            return res.status(503).json({ error: "TalkChat AI söndürülüb. Cloudflare hesab sahibi əvvəlcə billing limitlərini yoxlamalı və serverdə aktiv etməlidir." });
        }

        const accountId = typeof env.CLOUDFLARE_ACCOUNT_ID === "string" ? env.CLOUDFLARE_ACCOUNT_ID.trim() : "";
        const apiToken = typeof env.CLOUDFLARE_API_TOKEN === "string" ? env.CLOUDFLARE_API_TOKEN.trim() : "";
        if (!/^[a-f0-9]{32}$/i.test(accountId) || !apiToken) {
            return res.status(503).json({ error: "TalkChat AI server konfiqurasiyası tamamlanmayıb. Hesab sahibi Render server mühitini yoxlamalıdır." });
        }

        const username = currentUser(req);
        if (!takeDailyRequest(username))
            return res.status(429).json({ error: "TalkChat AI gündəlik sorğu limiti dolub. Limit UTC gecə yarısı yenilənəcək; sorğu göndərilməyib." });

        const previous = messagesFor(username);
        const messages = [
            { role: "system", content: instructions },
            ...contextMessages(previous),
            { role: "user", content: message }
        ];
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        let response;
        let body;
        try {
            response = await fetchImpl("https://api.cloudflare.com/client/v4/accounts/" + accountId + "/ai/run/" + MODEL, {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + apiToken,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    messages,
                    max_completion_tokens: MAX_OUTPUT_TOKENS,
                    store: false,
                    stream: false,
                    n: 1
                }),
                signal: controller.signal
            });
            try { body = await response.json(); } catch { body = null; }
        } catch {
            return res.status(503).json({ error: "TalkChat AI hazırda cavab verə bilmir. Sorğu avtomatik təkrar edilməyib." });
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok || body?.success === false || (Array.isArray(body?.errors) && body.errors.length)) {
            const failure = cloudflareError(response.status, body);
            return res.status(failure.status).json({ error: failure.error });
        }

        const answer = extractText(body);
        if (!answer)
            return res.status(502).json({ error: "Cloudflare AI cavab qaytarmadı. Sorğu avtomatik təkrar edilməyib." });

        const timestamp = new Date().toISOString();
        const updated = [
            ...previous,
            { id: crypto.randomUUID(), role: "user", content: message, createdAt: timestamp },
            { id: crypto.randomUUID(), role: "assistant", content: answer.slice(0, 10000), createdAt: new Date().toISOString() }
        ].slice(-MAX_STORED_MESSAGES);
        saveFor(username, updated);
        res.json({ message: updated[updated.length - 1], userMessage: updated[updated.length - 2] });
    });
}

module.exports = { installAIAssistant };
