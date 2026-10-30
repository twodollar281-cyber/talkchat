const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA = path.join(__dirname, "data");
const UPLOADS = path.join(__dirname, "public", "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

function readJSON(name, fallback = []) {
    const file = path.join(DATA, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { return fallback; }
}
function saveJSON(name, value) {
    fs.writeFileSync(path.join(DATA, name), JSON.stringify(value, null, 2));
}

// One-time migration: preserve accounts from the older TalkChat version.
const oldUsersFile = path.join(__dirname, "users.json");
const newUsersFile = path.join(DATA, "users.json");
if (!fs.existsSync(newUsersFile) && fs.existsSync(oldUsersFile)) {
    try {
        const oldUsers = JSON.parse(fs.readFileSync(oldUsersFile, "utf8"));
        const migratedUsers = oldUsers.map(user => ({
            ...user,
            bio: user.bio || "",
            avatar: user.avatar || "",
            followers: user.followers || [],
            following: user.following || []
        }));
        fs.writeFileSync(newUsersFile, JSON.stringify(migratedUsers, null, 2));
        console.log("Köhnə hesablar TalkChat V2-yə köçürüldü.");
    } catch (error) {
        console.error("Köhnə hesabları köçürmək mümkün olmadı:", error.message);
    }
}

const users = () => readJSON("users.json");
const saveUsers = value => saveJSON("users.json", value);
const posts = () => readJSON("posts.json");
const savePosts = value => saveJSON("posts.json", value);
const notifications = () => readJSON("notifications.json");
const saveNotifications = value => saveJSON("notifications.json", value);
const conversations = () => readJSON("conversations.json");
const saveConversations = value => saveJSON("conversations.json", value);
const messages = () => readJSON("messages.json");
const saveMessages = value => saveJSON("messages.json", value);
const friendRequests = () => readJSON("friendRequests.json");
const saveFriendRequests = value => saveJSON("friendRequests.json", value);
const stories = () => readJSON("stories.json");
const saveStories = value => saveJSON("stories.json", value);
const messageRequests = () => readJSON("messageRequests.json");
const saveMessageRequests = value => saveJSON("messageRequests.json", value);



app.use(helmet({
    crossOriginResourcePolicy: { policy: "same-site" }
}));
app.use(express.json({ limit: "1mb" }));
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET Render Environment-də təyin edilməlidir.");
}

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || "talkchat-local-development-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000
    }
});
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));

io.use((socket, next) => sessionMiddleware(socket.request, {}, next));
io.use((socket, next) => {
    if (!socket.request.session.username) return next(new Error("Giriş tələb olunur"));
    next();
});
io.on("connection", socket => {
    const name = socket.request.session.username;
    socket.join(`user:${name}`);
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Çox sayda cəhd edildi. Bir az sonra yenidən yoxla." }
});
app.use("/api/register", authLimiter);
app.use("/api/login", authLimiter);

function currentUser(req) { return req.session.username || null; }
function requireAuth(req, res, next) {
    if (!currentUser(req)) return res.status(401).json({ error: "Əvvəlcə giriş et." });
    next();
}
function publicUser(user) {
    return {
        username: user.username,
        bio: user.bio || "",
        avatar: user.avatar || "",
        followersCount: (user.followers || []).length,
        followingCount: (user.following || []).length,
        isFollowing: false
    };
}
function addNotification(to, from, type, extra = {}) {
    if (!to || to === from) return;
    const list = notifications();
    list.unshift({
        id: crypto.randomUUID(), to, from, type,
        ...extra, read: false, createdAt: new Date().toISOString()
    });
    saveNotifications(list.slice(0, 1000));
}

const allowedMime = new Set([
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/webm",
    "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm",
    "application/pdf", "text/plain",
    "application/zip", "application/x-zip-compressed"
]);
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
        cb(null, `${crypto.randomUUID()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (!allowedMime.has(file.mimetype)) return cb(new Error("Bu fayl növünə icazə verilmir."));
        cb(null, true);
    }
});

app.post("/api/register", async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (typeof username !== "string" || typeof password !== "string")
            return res.status(400).json({ error: "Məlumatlar düzgün deyil." });
        const name = username.trim().replace(/^@/, "");
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(name))
            return res.status(400).json({ error: "İstifadəçi adı 3-20 simvol olmalı, yalnız hərf, rəqəm və _ işlənməlidir." });
        if (password.length < 8 || password.length > 72)
            return res.status(400).json({ error: "Şifrə 8-72 simvol arasında olmalıdır." });
        const list = users();
        if (list.some(u => u.username.toLowerCase() === name.toLowerCase()))
            return res.status(409).json({ error: "Bu istifadəçi adı artıq mövcuddur." });
        const user = {
            username: name, password: await bcrypt.hash(password, 12),
            bio: "", avatar: "", followers: [], following: [],
            createdAt: new Date().toISOString()
        };
        list.push(user);
        saveUsers(list);
        req.session.username = name;
        req.session.save(err => {
            if (err) return res.status(500).json({ error: "Sessiya xətası." });
            res.json({ username: name });
        });
    } catch (e) { res.status(500).json({ error: "Server xətası." }); }
});

app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (typeof username !== "string" || typeof password !== "string")
            return res.status(400).json({ error: "Məlumatlar düzgün deyil." });
        const user = users().find(u => u.username.toLowerCase() === username.trim().replace(/^@/, "").toLowerCase());
        if (!user || !(await bcrypt.compare(password, user.password)))
            return res.status(401).json({ error: "İstifadəçi adı və ya şifrə yanlışdır." });
        req.session.username = user.username;
        req.session.save(err => {
            if (err) return res.status(500).json({ error: "Sessiya xətası." });
            res.json({ username: user.username });
        });
    } catch { res.status(500).json({ error: "Server xətası." }); }
});

app.get("/api/me", (req, res) => {
    if (!currentUser(req)) return res.status(401).json({ error: "Giriş edilməyib." });
    res.json({ username: currentUser(req) });
});
app.post("/api/logout", (req, res) => {
    req.session.destroy(() => res.json({ message: "Çıxış edildi." }));
});

app.get("/api/profile", requireAuth, (req, res) => {
    const user = users().find(u => u.username === currentUser(req));
    if (!user) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    res.json(publicUser(user));
});
app.put("/api/profile", requireAuth, (req, res) => {
    const { bio } = req.body || {};
    if (typeof bio !== "string" || bio.length > 160)
        return res.status(400).json({ error: "Bio maksimum 160 simvol ola bilər." });
    const list = users();
    const user = list.find(u => u.username === currentUser(req));
    if (!user) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    user.bio = bio.trim();
    saveUsers(list);
    res.json(publicUser(user));
});
app.post("/api/profile/avatar", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file || !req.file.mimetype.startsWith("image/"))
        return res.status(400).json({ error: "Profil şəkli üçün şəkil faylı seç." });
    const list = users();
    const user = list.find(u => u.username === currentUser(req));
    user.avatar = `/uploads/${req.file.filename}`;
    saveUsers(list);
    res.json({ avatar: user.avatar });
});

app.get("/api/users/:username", requireAuth, (req, res) => {
    const name = req.params.username.replace(/^@/, "");
    const user = users().find(u => u.username.toLowerCase() === name.toLowerCase());
    if (!user) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    const result = publicUser(user);
    result.isFollowing = (users().find(u => u.username === currentUser(req)).following || []).includes(user.username);
    res.json(result);
});
app.get("/api/search", requireAuth, (req, res) => {
    const q = String(req.query.q || "").trim().replace(/^@/, "").toLowerCase();
    if (!q) return res.json([]);
    res.json(users().filter(u => u.username.toLowerCase().includes(q))
        .slice(0, 30).map(u => {
            const result = publicUser(u);
            result.isFollowing = (users().find(x => x.username === currentUser(req)).following || []).includes(u.username);
            return result;
        }));
});
app.post("/api/follow/:username", requireAuth, (req, res) => {
    const me = currentUser(req), targetName = req.params.username.replace(/^@/, "");
    if (me.toLowerCase() === targetName.toLowerCase()) return res.status(400).json({ error: "Özünü izləyə bilməzsən." });
    const list = users();
    const target = list.find(u => u.username.toLowerCase() === targetName.toLowerCase());
    const self = list.find(u => u.username === me);
    if (!target || !self) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    self.following ||= []; target.followers ||= [];
    if (!self.following.includes(target.username)) {
        self.following.push(target.username);
        target.followers.push(me);
        saveUsers(list);
        addNotification(target.username, me, "follow");
    }
    res.json({ following: true });
});
app.delete("/api/follow/:username", requireAuth, (req, res) => {
    const targetName = req.params.username.replace(/^@/, "");
    const list = users(), self = list.find(u => u.username === currentUser(req));
    const target = list.find(u => u.username.toLowerCase() === targetName.toLowerCase());
    if (!self || !target) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    self.following = (self.following || []).filter(x => x !== target.username);
    target.followers = (target.followers || []).filter(x => x !== self.username);
    saveUsers(list);
    res.json({ following: false });
});


const friendRequestLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Çox sorğu göndərdin. Bir az gözlə." }
});

app.get("/api/friends", requireAuth, (req, res) => {
    const self = users().find(u => u.username === currentUser(req));
    if (!self) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    const names = self.friends || [];
    res.json(users().filter(u => names.includes(u.username)).map(publicUser));
});

app.get("/api/friend-requests", requireAuth, (req, res) => {
    const me = currentUser(req);
    const allUsers = users();
    const list = friendRequests();
    const incoming = list.filter(r => r.to === me).map(r => {
        const u = allUsers.find(x => x.username === r.from);
        return u ? publicUser(u) : null;
    }).filter(Boolean);
    const outgoing = list.filter(r => r.from === me).map(r => {
        const u = allUsers.find(x => x.username === r.to);
        return u ? publicUser(u) : null;
    }).filter(Boolean);
    res.json({ incoming, outgoing });
});

app.post("/api/friends/request/:username", requireAuth, friendRequestLimiter, (req, res) => {
    const me = currentUser(req);
    const name = String(req.params.username || "").replace(/^@/, "");
    const allUsers = users();
    const self = allUsers.find(u => u.username === me);
    const target = allUsers.find(u => u.username.toLowerCase() === name.toLowerCase());

    if (!target) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    if (target.username === me) return res.status(400).json({ error: "Özünə sorğu göndərə bilməzsən." });

    self.friends ||= [];
    target.friends ||= [];
    if (self.friends.includes(target.username))
        return res.status(409).json({ error: "Artıq dostsunuz." });

    const list = friendRequests();
    if (list.some(r =>
        (r.from === me && r.to === target.username) ||
        (r.from === target.username && r.to === me)
    )) return res.status(409).json({ error: "Bu şəxslə artıq gözləyən dostluq sorğusu var." });

    list.push({
        id: crypto.randomUUID(),
        from: me,
        to: target.username,
        createdAt: new Date().toISOString()
    });
    saveFriendRequests(list);
    addNotification(target.username, me, "friend_request");
    res.json({ sent: true });
});

app.post("/api/friends/accept/:username", requireAuth, (req, res) => {
    const me = currentUser(req);
    const name = String(req.params.username || "").replace(/^@/, "");
    const allUsers = users();
    const self = allUsers.find(u => u.username === me);
    const target = allUsers.find(u => u.username.toLowerCase() === name.toLowerCase());
    if (!target || !self) return res.status(404).json({ error: "İstifadəçi tapılmadı." });

    const list = friendRequests();
    const request = list.find(r => r.from === target.username && r.to === me);
    if (!request) return res.status(404).json({ error: "Dostluq sorğusu tapılmadı." });

    self.friends ||= [];
    target.friends ||= [];
    if (!self.friends.includes(target.username)) self.friends.push(target.username);
    if (!target.friends.includes(me)) target.friends.push(me);

    saveUsers(allUsers);
    saveFriendRequests(list.filter(r =>
        !((r.from === me && r.to === target.username) ||
          (r.from === target.username && r.to === me))
    ));
    addNotification(target.username, me, "friend_accept");
    res.json({ accepted: true });
});

app.post("/api/friends/reject/:username", requireAuth, (req, res) => {
    const me = currentUser(req);
    const name = String(req.params.username || "").replace(/^@/, "");
    const list = friendRequests();
    const updated = list.filter(r => !(r.from.toLowerCase() === name.toLowerCase() && r.to === me));
    if (updated.length === list.length)
        return res.status(404).json({ error: "Dostluq sorğusu tapılmadı." });
    saveFriendRequests(updated);
    res.json({ rejected: true });
});

app.delete("/api/friends/:username", requireAuth, (req, res) => {
    const me = currentUser(req);
    const name = String(req.params.username || "").replace(/^@/, "");
    const allUsers = users();
    const self = allUsers.find(u => u.username === me);
    const target = allUsers.find(u => u.username.toLowerCase() === name.toLowerCase());
    if (!self || !target) return res.status(404).json({ error: "İstifadəçi tapılmadı." });

    self.friends = (self.friends || []).filter(x => x !== target.username);
    target.friends = (target.friends || []).filter(x => x !== me);
    saveUsers(allUsers);
    res.json({ removed: true });
});

app.get("/api/feed", requireAuth, (req, res) => {
    const scope = req.query.scope === "following" ? "following" : "all";
    const self = users().find(u => u.username === currentUser(req));
    const following = self.following || [];
    let list = posts();
    if (scope === "following") list = list.filter(p => p.username === self.username || following.includes(p.username));
    res.json(list.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100));
});
app.post("/api/posts", requireAuth, upload.single("media"), (req, res) => {
    const text = String(req.body.text || "").trim().slice(0, 1000);
    if (!text && !req.file) return res.status(400).json({ error: "Mətn və ya media əlavə et." });
    let mediaType = "";
    if (req.file) {
        if (req.file.mimetype.startsWith("image/")) mediaType = "image";
        else if (req.file.mimetype.startsWith("video/")) mediaType = "video";
        else return res.status(400).json({ error: "Paylaşım üçün yalnız şəkil və video seç." });
    }
    const list = posts();
    const post = {
        id: crypto.randomUUID(), username: currentUser(req), text,
        media: req.file ? `/uploads/${req.file.filename}` : "",
        mediaType, likes: [], comments: [], createdAt: new Date().toISOString()
    };
    list.unshift(post); savePosts(list);
    res.json(post);
});
app.post("/api/posts/:id/like", requireAuth, (req, res) => {
    const list = posts(), post = list.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: "Paylaşım tapılmadı." });
    post.likes ||= [];
    const i = post.likes.indexOf(currentUser(req));
    if (i >= 0) post.likes.splice(i, 1);
    else {
        post.likes.push(currentUser(req));
        addNotification(post.username, currentUser(req), "like", { postId: post.id });
    }
    savePosts(list);
    res.json({ liked: post.likes.includes(currentUser(req)), likes: post.likes.length });
});
app.post("/api/posts/:id/comments", requireAuth, (req, res) => {
    const text = String((req.body || {}).text || "").trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: "Şərh boş ola bilməz." });
    const list = posts(), post = list.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: "Paylaşım tapılmadı." });
    post.comments ||= [];
    const comment = { id: crypto.randomUUID(), username: currentUser(req), text, createdAt: new Date().toISOString() };
    post.comments.push(comment); savePosts(list);
    addNotification(post.username, currentUser(req), "comment", { postId: post.id });
    res.json(comment);
});

app.get("/api/notifications", requireAuth, (req, res) => {
    const list = notifications();
    const mine = list.filter(n => n.to === currentUser(req));
    mine.forEach(n => n.read = true); saveNotifications(list);
    res.json(mine.slice(0, 100));
});

app.get("/api/conversations", requireAuth, (req, res) => {
    const me = currentUser(req);
    res.json(conversations().filter(c => c.participants.includes(me)).map(c => ({
        id: c.id, type: c.type, name: c.type === "group" ? c.name : c.participants.find(x => x !== me),
        participants: c.participants
    })));
});
app.post("/api/conversations/direct", requireAuth, (req, res) => {
    const other = String((req.body || {}).username || "").replace(/^@/, "");
    if (!users().some(u => u.username.toLowerCase() === other.toLowerCase()) || other === currentUser(req))
        return res.status(400).json({ error: "İstifadəçi tapılmadı." });
    const list = conversations();
    let convo = list.find(c => c.type === "direct" && c.participants.includes(currentUser(req)) && c.participants.includes(other));
    if (!convo) {
        convo = { id: crypto.randomUUID(), type: "direct", participants: [currentUser(req), other], createdAt: new Date().toISOString() };
        list.push(convo); saveConversations(list);
    }
    res.json(convo);
});
app.post("/api/conversations/group", requireAuth, (req, res) => {
    const name = String((req.body || {}).name || "").trim().slice(0, 40);
    const invited = Array.isArray((req.body || {}).usernames) ? req.body.usernames : [];
    const valid = users().map(u => u.username);
    const participants = [...new Set([currentUser(req), ...invited.map(x => String(x).replace(/^@/, "")).filter(x => valid.includes(x))])];
    if (!name || participants.length < 2) return res.status(400).json({ error: "Qrup adı və ən azı bir başqa iştirakçı lazımdır." });
    const convo = { id: crypto.randomUUID(), type: "group", name, participants, createdAt: new Date().toISOString() };
    const list = conversations(); list.push(convo); saveConversations(list);
    res.json(convo);
});
app.get("/api/conversations/:id/messages", requireAuth, (req, res) => {
    const convo = conversations().find(c => c.id === req.params.id && c.participants.includes(currentUser(req)));
    if (!convo) return res.status(404).json({ error: "Söhbət tapılmadı." });
    res.json(messages().filter(m => m.conversationId === convo.id).slice(-200));
});
app.post("/api/conversations/:id/messages", requireAuth, upload.single("file"), (req, res) => {
    const convo = conversations().find(c => c.id === req.params.id && c.participants.includes(currentUser(req)));
    if (!convo) return res.status(404).json({ error: "Söhbət tapılmadı." });
    const text = String(req.body.text || "").trim().slice(0, 2000);
    if (!text && !req.file) return res.status(400).json({ error: "Mesaj boş ola bilməz." });
    const message = {
        id: crypto.randomUUID(), conversationId: convo.id, from: currentUser(req), text,
        attachment: req.file ? `/uploads/${req.file.filename}` : "",
        attachmentName: req.file ? req.file.originalname.slice(0, 100) : "",
        attachmentType: req.file ? req.file.mimetype : "",
        createdAt: new Date().toISOString()
    };
    const list = messages(); list.push(message); saveMessages(list);
    convo.participants.filter(x => x !== currentUser(req)).forEach(to => {
        io.to(`user:${to}`).emit("newMessage", { conversationId: convo.id });
        addNotification(to, currentUser(req), "message");
    });
    res.json(message);
});


// TALKCHAT_STORIES_V1
app.get("/api/stories", requireAuth, (req, res) => {
    const now = Date.now();
    const list = stories().filter(x => new Date(x.expiresAt).getTime() > now);
    saveStories(list);
    const me = currentUser(req);
    const result = list.map(x => {
        if (!x.views.includes(me) && x.username !== me) {
            x.views.push(me);
        }
        return {
            id: x.id, username: x.username, media: x.media,
            mediaType: x.mediaType, text: x.text,
            createdAt: x.createdAt, expiresAt: x.expiresAt,
            viewsCount: x.views.length, mine: x.username === me
        };
    });
    saveStories(list);
    res.json(result);
});

app.post("/api/stories", requireAuth, upload.single("media"), (req, res) => {
    if (!req.file) return res.status(400).json({error:"Şəkil və ya video seç."});
    if (!req.file.mimetype.startsWith("image/") && !req.file.mimetype.startsWith("video/")) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({error:"Yalnız şəkil və video paylaşmaq olar."});
    }
    const now = new Date();
    const item = {
        id: crypto.randomUUID(),
        username: currentUser(req),
        media: "/uploads/" + req.file.filename,
        mediaType: req.file.mimetype.startsWith("video/") ? "video" : "image",
        text: String(req.body.text || "").trim().slice(0, 250),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        views: []
    };
    const list = stories().filter(x => new Date(x.expiresAt).getTime() > now.getTime());
    list.push(item);
    saveStories(list);
    res.json({ok:true, story:{...item, views:undefined}});
});

app.delete("/api/stories/:id", requireAuth, (req, res) => {
    const list = stories();
    const item = list.find(x => x.id === req.params.id);
    if (!item) return res.status(404).json({error:"Story tapılmadı."});
    if (item.username !== currentUser(req)) return res.status(403).json({error:"Bu Story sənə aid deyil."});
    saveStories(list.filter(x => x.id !== item.id));
    res.json({ok:true});
});

// Message requests
app.get("/api/message-requests", requireAuth, (req, res) => {
    const me = currentUser(req);
    const list = messageRequests().filter(x => x.status === "pending");
    res.json({
        incoming: list.filter(x => x.to === me),
        outgoing: list.filter(x => x.from === me)
    });
});

app.post("/api/message-requests", requireAuth, (req, res) => {
    const from = currentUser(req);
    const to = String((req.body || {}).username || "").trim().replace(/^@/, "");
    const target = users().find(u => u.username.toLowerCase() === to.toLowerCase());
    if (!target || target.username === from)
        return res.status(400).json({error:"İstifadəçi tapılmadı."});
    const existing = conversations().find(x => x.type === "direct" &&
        x.participants.includes(from) && x.participants.includes(target.username));
    if (existing) return res.status(409).json({error:"Bu şəxslə artıq söhbətin var."});
    const list = messageRequests();
    if (list.some(x => x.from === from && x.to === target.username && x.status === "pending"))
        return res.status(409).json({error:"Sorğu artıq göndərilib."});
    list.push({
        id: crypto.randomUUID(), from, to: target.username,
        status:"pending", createdAt:new Date().toISOString()
    });
    saveMessageRequests(list);
    addNotification(target.username, from, "message_request");
    res.json({ok:true});
});

app.post("/api/message-requests/:id/accept", requireAuth, (req, res) => {
    const list = messageRequests();
    const request = list.find(x => x.id === req.params.id && x.to === currentUser(req) && x.status === "pending");
    if (!request) return res.status(404).json({error:"Mesaj sorğusu tapılmadı."});
    const convos = conversations();
    let convo = convos.find(x => x.type === "direct" &&
        x.participants.includes(request.from) && x.participants.includes(request.to));
    if (!convo) {
        convo = {
            id:crypto.randomUUID(), type:"direct",
            participants:[request.from, request.to],
            createdAt:new Date().toISOString()
        };
        convos.push(convo);
        saveConversations(convos);
    }
    request.status = "accepted";
    request.conversationId = convo.id;
    request.acceptedAt = new Date().toISOString();
    saveMessageRequests(list);
    res.json({ok:true, conversation:convo});
});

app.delete("/api/message-requests/:id", requireAuth, (req, res) => {
    const list = messageRequests();
    const item = list.find(x => x.id === req.params.id && x.status === "pending" &&
        (x.to === currentUser(req) || x.from === currentUser(req)));
    if (!item) return res.status(404).json({error:"Sorğu tapılmadı."});
    item.status = "rejected";
    item.rejectedAt = new Date().toISOString();
    saveMessageRequests(list);
    res.json({ok:true});
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: "Fayl çox böyükdür və ya yükləmə xətası baş verdi (maksimum 30 MB)." });
    if (err) return res.status(400).json({ error: err.message || "Xəta baş verdi." });
    next();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`TalkChat V2 işləyir: http://localhost:${PORT}`));
