"use strict";

const COLOR_KEYS = ["background", "incoming", "outgoing", "incomingText", "outgoingText"];
const BUBBLE_STYLES = new Set(["rounded", "soft", "square"]);

function normalizeTheme(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const theme = {};
    for (const key of COLOR_KEYS) {
        const color = value[key];
        if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return null;
        theme[key] = color.toLowerCase();
    }
    if (!BUBBLE_STYLES.has(value.bubbleStyle)) return null;
    theme.bubbleStyle = value.bubbleStyle;
    return theme;
}

function installChatThemes({ app, readJSON, saveJSON, conversations, requireAuth, currentUser }) {
    const readAll = () => {
        const data = readJSON("chatThemes.json", {});
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    };
    const getUserThemes = username => {
        const all = readAll();
        const value = all[username];
        return value && typeof value === "object" && !Array.isArray(value)
            ? {
                default: value.default || null,
                conversations: value.conversations && typeof value.conversations === "object" && !Array.isArray(value.conversations)
                    ? value.conversations : {}
            }
            : { default: null, conversations: {} };
    };
    const saveUserThemes = (username, value) => {
        const all = readAll();
        all[username] = value;
        saveJSON("chatThemes.json", all);
    };
    const ownsConversation = (username, id) => conversations().some(item =>
        item.id === id && Array.isArray(item.participants) && item.participants.includes(username)
    );
    const sendNoStore = res => res.set("Cache-Control", "private, no-store");

    app.get("/api/chat-themes", requireAuth, (req, res) => {
        const username = currentUser(req);
        const value = getUserThemes(username);
        const allowedIds = new Set(conversations()
            .filter(item => Array.isArray(item.participants) && item.participants.includes(username))
            .map(item => item.id));
        const scoped = Object.fromEntries(Object.entries(value.conversations)
            .filter(([id]) => allowedIds.has(id))
            .map(([id, theme]) => [id, normalizeTheme(theme)])
            .filter(([, theme]) => !!theme));
        sendNoStore(res);
        res.json({ default: normalizeTheme(value.default), conversations: scoped });
    });

    app.put("/api/chat-themes/default", requireAuth, (req, res) => {
        const theme = normalizeTheme(req.body);
        if (!theme) return res.status(400).json({ error: "Mövzu rəngləri və bubble forması düzgün deyil." });
        const username = currentUser(req);
        const value = getUserThemes(username);
        value.default = theme;
        saveUserThemes(username, value);
        sendNoStore(res);
        res.json({ default: theme });
    });

    app.delete("/api/chat-themes/default", requireAuth, (req, res) => {
        const username = currentUser(req);
        const value = getUserThemes(username);
        value.default = null;
        saveUserThemes(username, value);
        res.json({ ok: true, default: null });
    });

    app.put("/api/chat-themes/conversations/:id", requireAuth, (req, res) => {
        const username = currentUser(req);
        const id = req.params.id;
        if (!ownsConversation(username, id))
            return res.status(404).json({ error: "Söhbət tapılmadı." });
        const theme = normalizeTheme(req.body);
        if (!theme) return res.status(400).json({ error: "Mövzu rəngləri və bubble forması düzgün deyil." });
        const value = getUserThemes(username);
        value.conversations[id] = theme;
        saveUserThemes(username, value);
        sendNoStore(res);
        res.json({ conversationId: id, theme });
    });

    app.delete("/api/chat-themes/conversations/:id", requireAuth, (req, res) => {
        const username = currentUser(req);
        const id = req.params.id;
        if (!ownsConversation(username, id))
            return res.status(404).json({ error: "Söhbət tapılmadı." });
        const value = getUserThemes(username);
        delete value.conversations[id];
        saveUserThemes(username, value);
        res.json({ ok: true, conversationId: id });
    });
}

module.exports = { installChatThemes, normalizeTheme };
