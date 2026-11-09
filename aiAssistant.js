"use strict";

const crypto = require("crypto");

const MODEL = "gpt-4.1-mini";
const MAX_PROMPT_LENGTH = 2000;
const MAX_STORED_MESSAGES = 60;
const CONTEXT_MESSAGES = 12;
const MAX_OUTPUT_TOKENS = 600;
const MAX_DAILY_REQUESTS = 40;
const instructions = [
    "You are TalkChat AI, a helpful assistant inside the TalkChat social app.",
    "Answer the user's question directly and in the language they used.",
    "You only know the messages in this AI conversation. Do not claim to read TalkChat profiles, chats, files, or account data.",
    "Do not ask for passwords, API keys, or other secrets."
].join(" ");

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

function extractText(body) {
    if (typeof body?.output_text === "string") return body.output_text.trim();
    const parts = [];
    for (const item of Array.isArray(body?.output) ? body.output : []) {
        for (const part of Array.isArray(item?.content) ? item.content : []) {
            if (part?.type === "output_text" && typeof part.text === "string") parts.push(part.text);
        }
    }
    return parts.join("\n").trim();
}

function installAIAssistant({ app, readJSON, saveJSON, requireAuth, currentUser, userRateLimit }) {
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
        const data = readJSON("aiAssistantUsage.json", {});
        const all = data && typeof data === "object" && !Array.isArray(data) ? data : {};
        const today = new Date().toISOString().slice(0, 10);
        const previous = all[username];
        const count = previous?.date === today ? Number(previous.count) || 0 : 0;
        if (count >= MAX_DAILY_REQUESTS) return false;
        all[username] = { date: today, count: count + 1 };
        saveJSON("aiAssistantUsage.json", all);
        return true;
    };
    const noStore = res => res.set("Cache-Control", "private, no-store");
    const perMinute = userRateLimit(60 * 1000, 6, "AI sorğu limiti dolub. Bir az sonra yenidən cəhd et.");

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
            return res.status(400).json({ error: `Mesaj 1–${MAX_PROMPT_LENGTH} simvol arasında olmalıdır.` });

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || !apiKey.trim())
            return res.status(503).json({ error: "TalkChat AI konfiqurasiya edilməyib. Render server mühitində OPENAI_API_KEY əlavə et və xidməti yenidən başlad." });

        const username = currentUser(req);
        if (!takeDailyRequest(username))
            return res.status(429).json({ error: "Gündəlik AI sorğu limitinə çatmısan. Sabah yenidən cəhd et." });
        const previous = messagesFor(username);
        const input = previous.slice(-CONTEXT_MESSAGES).map(item => ({
            role: item.role,
            content: item.content
        }));
        input.push({ role: "user", content: message });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        let response;
        let body;
        try {
            response = await fetch("https://api.openai.com/v1/responses", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: MODEL,
                    instructions,
                    input,
                    max_output_tokens: MAX_OUTPUT_TOKENS,
                    store: false
                }),
                signal: controller.signal
            });
            if (response.ok) body = await response.json();
        } catch {
            return res.status(503).json({ error: "TalkChat AI hazırda cavab verə bilmir. Bir az sonra yenidən cəhd et." });
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            const status = response.status === 429 ? 503 : 502;
            return res.status(status).json({
                error: response.status === 429
                    ? "OpenAI xidməti müvəqqəti limitə çatıb. Bir az sonra yenidən cəhd et."
                    : "OpenAI sorğusu uğursuz oldu. Bir az sonra yenidən cəhd et."
            });
        }

        const answer = extractText(body);
        if (!answer)
            return res.status(502).json({ error: "OpenAI cavab qaytarmadı. Yenidən cəhd et." });

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
