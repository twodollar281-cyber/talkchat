"use strict";
/* TalkStore Gems: server-side balans, mükafatlar və premium alışlar. Balans yalnız burada dəyişir. */

const PREMIUM = {
    "theme-aurora": { type: "theme", price: 125, name: "Aurora Glow", desc: "Zümrüd-firuzəyi qaranlıq mövzu.", theme: { background: "#051e1c", incoming: "#0e3835", outgoing: "#2dd4bf", incomingText: "#e6fffb", outgoingText: "#03211e", bubbleStyle: "rounded" } },
    "theme-crimson": { type: "theme", price: 125, name: "Crimson Noir", desc: "Qara fon, qırmızı vurğu.", theme: { background: "#14070b", incoming: "#2b1119", outgoing: "#e11d48", incomingText: "#ffe8ee", outgoingText: "#ffffff", bubbleStyle: "soft" } },
    "theme-pearl": { type: "theme", price: 125, name: "Pearl Rose", desc: "İşıqlı mirvari fon, çəhrayı vurğu.", theme: { background: "#fdf2f8", incoming: "#ffffff", outgoing: "#db2777", incomingText: "#3b0a24", outgoingText: "#ffffff", bubbleStyle: "rounded" } },
    "item-frame-aurora": { type: "frame", price: 150, name: "Aurora Çərçivəsi", desc: "Şimal işıqları halqası.", ring: ["#34d399", "#22d3ee"] },
    "item-frame-inferno": { type: "frame", price: 150, name: "İnferno Çərçivəsi", desc: "Alovlu narıncı-qırmızı halqa.", ring: ["#ff512f", "#f9a825"] },
    "item-frame-diamond": { type: "frame", price: 150, name: "Almaz Çərçivəsi", desc: "Buzlu almaz parıltısı.", ring: ["#e0f2fe", "#7dd3fc"] }
};
const REWARDS = { login: 5, daily: 5, weekly: 25, profile: 20 };
const DAILY_TASKS = [
    { id: "msg", label: "3 mesaj göndər", target: 3 },
    { id: "like", label: "Başqalarının 3 paylaşımını bəyən", target: 3 },
    { id: "post", label: "1 paylaşım və ya Reels yerləşdir", target: 1 }
];
const WEEKLY = { id: "week", label: "Həftədə 3 fərqli gün gündəlik tapşırıq tamamla", target: 3 };
const COLOR_KEYS = ["background", "incoming", "outgoing", "incomingText", "outgoingText"];

const bakuDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku" }).format(d);
function weekKey(day) {
    const t = new Date(day + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
}

function installGems({ app, users, posts, readJSON, saveJSON, requireAuth, currentUser }) {
    const readAll = () => {
        const v = readJSON("gems.json", {});
        return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    };
    function rec(all, name) {
        const r = all[name] && typeof all[name] === "object" ? all[name] : (all[name] = {});
        r.balance = Number.isInteger(r.balance) && r.balance >= 0 ? r.balance : 0;
        r.owned = Array.isArray(r.owned) ? r.owned.filter(id => PREMIUM[id]) : [];
        r.history = Array.isArray(r.history) ? r.history : [];
        r.profileClaimed = r.profileClaimed === true;
        r.loginDate = typeof r.loginDate === "string" ? r.loginDate : "";
        const today = bakuDay();
        if (!r.day || r.day.date !== today) r.day = { date: today, counts: {}, liked: [], done: {} };
        const wk = weekKey(today);
        if (!r.week || r.week.key !== wk) r.week = { key: wk, days: [], done: false };
        return r;
    }
    function credit(r, amount, type, label) {
        r.balance += amount;
        r.history.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type, amount, label, at: new Date().toISOString() });
        r.history = r.history.slice(0, 50);
    }
    /* Real fəaliyyət qeydi: yalnız serverin uğurla cavab verdiyi əməliyyatlardan sonra çağırılır. */
    function track(username, task, key) {
        const all = readAll(), r = rec(all, username), def = DAILY_TASKS.find(t => t.id === task);
        if (!def || r.day.done[task]) return;
        if (task === "like") {
            if (r.day.liked.includes(key)) return;
            r.day.liked.push(key);
        }
        r.day.counts[task] = (r.day.counts[task] || 0) + 1;
        if (r.day.counts[task] >= def.target) {
            r.day.done[task] = true;
            credit(r, REWARDS.daily, "daily", "Gündəlik tapşırıq: " + def.label);
            if (!r.week.days.includes(r.day.date)) r.week.days.push(r.day.date);
            if (!r.week.done && r.week.days.length >= WEEKLY.target) {
                r.week.done = true;
                credit(r, REWARDS.weekly, "weekly", "Həftəlik tapşırıq: " + WEEKLY.label);
            }
        }
        saveJSON("gems.json", all);
    }

    app.use((req, res, next) => {
        if (req.method !== "POST") return next();
        const p = req.path;
        const isMsg = /^\/api\/conversations\/[^/]+\/messages$/.test(p);
        const isPost = p === "/api/posts" || p === "/api/reels";
        const like = p.match(/^\/api\/posts\/([^/]+)\/like$/);
        if (!isMsg && !isPost && !like) return next();
        let body;
        const json = res.json.bind(res);
        res.json = b => { body = b; return json(b); };
        res.on("finish", () => {
            try {
                const me = currentUser(req);
                if (!me || res.statusCode >= 300) return;
                if (isMsg) track(me, "msg");
                else if (isPost) track(me, "post");
                else if (body && body.liked === true) {
                    const post = posts().find(x => x.id === like[1]);
                    if (post && post.username !== me) track(me, "like", like[1]);
                }
            } catch (e) { console.error("Gems izləmə xətası:", e.message); }
        });
        next();
    });

    const profileComplete = u => !!(u && u.avatar && String(u.bio || "").trim() && String(u.displayName || "").trim());
    const catalogOut = () => Object.entries(PREMIUM).map(([id, v]) => ({ id, ...v }));

    function state(username) {
        const all = readAll(), r = rec(all, username), u = users().find(x => x.username === username);
        saveJSON("gems.json", all);
        return {
            balance: r.balance, owned: r.owned, catalog: catalogOut(),
            login: { reward: REWARDS.login, claimed: r.loginDate === r.day.date },
            daily: DAILY_TASKS.map(t => ({ id: t.id, label: t.label, target: t.target, reward: REWARDS.daily, progress: Math.min(r.day.counts[t.id] || 0, t.target), done: !!r.day.done[t.id] })),
            weekly: { label: WEEKLY.label, target: WEEKLY.target, reward: REWARDS.weekly, progress: Math.min(r.week.days.length, WEEKLY.target), done: r.week.done },
            profile: { reward: REWARDS.profile, claimed: r.profileClaimed, complete: profileComplete(u), need: "Profil şəkli, ad və bio" },
            history: r.history
        };
    }

    app.get("/api/gems", requireAuth, (req, res) => { res.set("Cache-Control", "private, no-store"); res.json(state(currentUser(req))); });

    app.post("/api/gems/claim-daily", requireAuth, (req, res) => {
        const all = readAll(), r = rec(all, currentUser(req));
        if (r.loginDate === r.day.date) return res.status(409).json({ error: "Bugünkü mükafat artıq alınıb." });
        r.loginDate = r.day.date;
        credit(r, REWARDS.login, "login", "Gündəlik giriş mükafatı");
        saveJSON("gems.json", all);
        res.json(state(currentUser(req)));
    });

    app.post("/api/gems/claim-profile", requireAuth, (req, res) => {
        const me = currentUser(req), all = readAll(), r = rec(all, me);
        if (r.profileClaimed) return res.status(409).json({ error: "Profil mükafatı artıq alınıb." });
        if (!profileComplete(users().find(x => x.username === me))) return res.status(400).json({ error: "Əvvəl profil şəkli, ad və bio əlavə et." });
        r.profileClaimed = true;
        credit(r, REWARDS.profile, "profile", "Profil tamamlandı");
        saveJSON("gems.json", all);
        res.json(state(me));
    });

    app.post("/api/gems/purchase", requireAuth, (req, res) => {
        const me = currentUser(req), id = req.body && req.body.id, item = typeof id === "string" && Object.prototype.hasOwnProperty.call(PREMIUM, id) ? PREMIUM[id] : null;
        if (!item) return res.status(404).json({ error: "Məhsul tapılmadı." });
        const all = readAll(), r = rec(all, me);
        if (r.owned.includes(id)) return res.status(409).json({ error: "Bu məhsul artıq səndədir." });
        if (r.balance < item.price) return res.status(402).json({ error: `Kifayət qədər Gems yoxdur (${item.price} lazımdır).` });
        r.balance -= item.price;
        r.owned.push(id);
        r.history.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: "purchase", amount: -item.price, label: item.name + " alındı", at: new Date().toISOString() });
        r.history = r.history.slice(0, 50);
        saveJSON("gems.json", all);
        res.json(state(me));
    });

    const owns = (name, id) => rec(readAll(), name).owned.includes(id);
    return {
        /* Premium çərçivə yalnız sahibi tərəfindən tətbiq oluna bilər. */
        canUseFrame: (name, frame) => !frame || !PREMIUM[frame] || owns(name, frame),
        /* Rəngləri premium mövzu ilə eyni olan mövzu alınmayıbsa true qaytarır. */
        isLockedTheme: (name, theme) => {
            const hit = Object.entries(PREMIUM).find(([, v]) => v.type === "theme" && COLOR_KEYS.every(k => v.theme[k] === theme[k]) && v.theme.bubbleStyle === theme.bubbleStyle);
            return !!hit && !owns(name, hit[0]);
        }
    };
}

module.exports = { installGems };
