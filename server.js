// Məlumat bazası (DATABASE_URL) hazır olmayınca server başlamır
const store = require("./db");
if (!store.ready) {
    store.init()
        .then(() => { delete require.cache[__filename]; require(__filename); })
        .catch(e => { console.error("DB başladıla bilmədi:", e.message); process.exit(1); });
    return;
}
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createCallRegistry, validateSignal } = require("./call-registry");
const {
    OWNER_USERNAME, ROLE_LEVEL, roleOf, canAssignRole,
    canModerateUser, normalizeBanDuration, objectKey
} = require("./moderationPolicy");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const supa = require("./supabaseStorage");

if (process.env.NODE_ENV === "production" && !supa.enabled) {
    throw new Error("Supabase Storage konfiqurasiyası production mühitində tələb olunur; lokal diskə fayl yazılmayacaq.");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA = path.join(__dirname, "data");
const UPLOADS = path.join(__dirname, "public", "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

function readJSON(name, fallback = []) { return store.read(name, fallback); }
function saveJSON(name, value) { store.save(name, value); }

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
const reports = () => readJSON("reports.json");
const saveReports = value => saveJSON("reports.json", value);
const messageRequests = () => readJSON("messageRequests.json");
const saveMessageRequests = value => saveJSON("messageRequests.json", value);
const { createPush } = require("./push");
const push = createPush({ readJSON, saveJSON });



app.use(helmet({
    crossOriginResourcePolicy: { policy: "same-site" },
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "img-src": ["'self'", "data:", "blob:", supa.origin].filter(Boolean),
            "media-src": ["'self'", "blob:", supa.origin].filter(Boolean)
        }
    }
}));
app.use(express.json({ limit: "1mb" }));
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET Render Environment-də təyin edilməlidir.");
}

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}
const sessionMiddleware = require("cookie-session")({
    name: "talkchat_session",
    keys: [process.env.SESSION_SECRET || "talkchat-local-development-secret-change-me"],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
});
app.use(sessionMiddleware);
app.get("/uploads/:name", requireAuth, async (req, res) => {
    const filename = req.params.name;
    if (!/^[a-zA-Z0-9._-]{1,180}$/.test(filename) ||
        !canAccessUpload(filename, currentUser(req))) {
        return res.status(404).json({ error: "Fayl tapılmadı." });
    }
    res.set("Cache-Control", "private, no-store");
    if (supa.enabled) {
        try {
            return res.redirect(302, await supa.createSignedUrl(filename));
        } catch (error) {
            console.error("Supabase signed URL xətası:", error.message);
            return res.status(503).json({ error: "Fayla hazırda giriş mümkün deyil." });
        }
    }
    const file = path.join(UPLOADS, filename);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "Fayl tapılmadı." });
    return res.sendFile(file);
});
app.use(express.static(path.join(__dirname, "public")));

io.use((socket, next) => sessionMiddleware(socket.request, {}, next));
io.use((socket, next) => {
    if (!socket.request.session.username) return next(new Error("Giriş tələb olunur"));
    if (activeBanForUsername(socket.request.session.username)) return next(new Error("Hesab müvəqqəti məhdudlaşdırılıb."));
    next();
});
// TALKCHAT_PRESENCE_READ_V1
const onlineUsers = new Map();
const lastSeenMap = new Map();

// Mesajın önizlemesi (söhbət siyahısında göstərilir)
function previewOf(m) {
    if (m.deleted) return "Mesaj silindi";
    if (m.sharedPost) return m.sharedPost.kind === "reel" ? "↗ Reels göndərildi" : "↗ Paylaşım göndərildi";
    if (m.text) return m.text;
    if ((m.attachmentType || "").startsWith("image/")) return "📷 Şəkil";
    return "📎 " + (m.attachmentName || "Fayl");
}

// İstifadəçi qoşulanda ona gələn, hələ çatdırılmamış mesajları "çatdırıldı" edir
function deliverPending(name) {
    const ids = new Set(conversations().filter(c => c.participants.includes(name)).map(c => c.id));
    const list = messages();
    const notify = new Map();
    let changed = false;
    for (const m of list) {
        if (!m.deliveredAt && m.from !== name && ids.has(m.conversationId)) {
            m.deliveredAt = new Date().toISOString();
            changed = true;
            notify.set(m.from + "|" + m.conversationId, { to: m.from, conversationId: m.conversationId });
        }
    }
    if (changed) {
        saveMessages(list);
        notify.forEach(v => io.to(`user:${v.to}`).emit("messagesChanged", { conversationId: v.conversationId }));
    }
}

const activeGroupCalls = new Map();
const activeGroupCallTimers = new Map();
const directCallRegistry = createCallRegistry();
const directCallTimers = new Map();
function clearGroupCallTimer(conversationId) {
    const timer = activeGroupCallTimers.get(conversationId);
    if (timer) clearTimeout(timer);
    activeGroupCallTimers.delete(conversationId);
}
function expireDisconnectedGroupCall(conversationId, call) {
    clearGroupCallTimer(conversationId);
    const timer = setTimeout(() => {
        if (activeGroupCalls.get(conversationId) === call && call.participants.length === 0) activeGroupCalls.delete(conversationId);
        activeGroupCallTimers.delete(conversationId);
    }, 45000);
    if (timer && typeof timer.unref === "function") timer.unref();
    activeGroupCallTimers.set(conversationId, timer);
}

function clearDirectCallTimer(callId) {
    const timer = directCallTimers.get(callId);
    if (timer) clearTimeout(timer);
    directCallTimers.delete(callId);
}

function notifyDirectCallEnded(call, reason) {
    const payload = { callId: call.id, conversationId: call.conversationId, reason };
    io.to("user:" + call.caller).emit("call:ended", payload);
    if (call.callee !== call.caller) io.to("user:" + call.callee).emit("call:ended", payload);
}


function getGroupCallConversation(conversationId, username) {
    return conversations().find(c =>
        c.id === conversationId &&
        c.type === "group" &&
        Array.isArray(c.participants) &&
        c.participants.includes(username)
    );
}

io.on("connection", socket => {
    const name = socket.request.session.username;
    socket.join(`user:${name}`);
    const resumedCall = directCallRegistry.findForUser(name);
    if (resumedCall && resumedCall.status === "active" && directCallTimers.has(resumedCall.id)) {
        clearDirectCallTimer(resumedCall.id);
        const peer = resumedCall.caller === name ? resumedCall.callee : resumedCall.caller;
        const payload = { callId: resumedCall.id, conversationId: resumedCall.conversationId, mediaType: resumedCall.mediaType, peer, reason: "reconnected" };
        socket.emit("call:resumed", payload);
        io.to("user:" + peer).emit("call:peer-reconnected", payload);
    }
    function getCallPeer(conversationId) {
        const c = conversations().find(x =>
            x.id === conversationId && x.type === "direct" &&
            Array.isArray(x.participants) && x.participants.includes(name));
        return c ? (c.participants.find(p => p !== name) || null) : null;
    }

    const ringingCall = directCallRegistry.findForUser(name);
    if (ringingCall && ringingCall.status === "ringing" && ringingCall.callee === name) {
        socket.emit("call:incoming", { callId: ringingCall.id, conversationId: ringingCall.conversationId, from: ringingCall.caller, to: name, mediaType: ringingCall.mediaType });
    }
    onlineUsers.set(name, (onlineUsers.get(name) || 0) + 1);
    io.emit("presenceUpdate", { username: name, online: true });


    
socket.on("call:invite", data => {
  if (!data || typeof data.conversationId !== "string") return;
  const target = getCallPeer(data.conversationId);
  if (!target) { socket.emit("call:error", { conversationId: data.conversationId, code: "not-authorized" }); return; }
  const opened = directCallRegistry.invite({ conversationId: data.conversationId, caller: name, callee: target, mediaType: data.mediaType === "video" ? "video" : "audio" });
  if (!opened.ok) { socket.emit("call:error", { conversationId: data.conversationId, code: opened.code }); return; }
  const call = opened.call;
  const payload = { callId: call.id, conversationId: call.conversationId, from: name, to: target, mediaType: call.mediaType };
  socket.emit("call:created", payload);
  io.to("user:" + target).emit("call:incoming", payload);
  push.send(target, "call", name, { conversationId: call.conversationId, callId: call.id, mediaType: call.mediaType });
  const timer = setTimeout(() => {
    const ended = directCallRegistry.end({ callId: call.id, actor: call.caller, reason: "no-answer" });
    directCallTimers.delete(call.id);
    if (ended.ok) notifyDirectCallEnded(ended.call, "no-answer");
  }, 40000);
  if (timer && typeof timer.unref === "function") timer.unref();
  directCallTimers.set(call.id, timer);
});

socket.on("call:accept", data => {
  if (!data || typeof data.conversationId !== "string") return;
  const accepted = directCallRegistry.accept({ callId: data.callId, conversationId: data.conversationId, actor: name });
  if (!accepted.ok) { socket.emit("call:error", { conversationId: data.conversationId, code: accepted.code }); return; }
  clearDirectCallTimer(accepted.call.id);
  const payload = { callId: accepted.call.id, conversationId: accepted.call.conversationId, from: name, mediaType: accepted.call.mediaType };
  io.to("user:" + accepted.call.caller).emit("call:accepted", payload);
  io.to("user:" + accepted.call.callee).emit("call:answered", payload);
});

socket.on("call:reject", data => {
  if (!data || typeof data.conversationId !== "string") return;
  const rejected = directCallRegistry.reject({ callId: data.callId, conversationId: data.conversationId, actor: name });
  if (!rejected.ok) { socket.emit("call:error", { conversationId: data.conversationId, code: rejected.code }); return; }
  clearDirectCallTimer(rejected.call.id);
  const payload = { callId: rejected.call.id, conversationId: rejected.call.conversationId, from: name, reason: "rejected" };
  io.to("user:" + rejected.call.caller).emit("call:rejected", payload);
  io.to("user:" + rejected.call.callee).emit("call:answered", payload);
});

socket.on("call:signal", data => {
  if (!data || typeof data.conversationId !== "string") return;
  const relayed = directCallRegistry.signal({ callId: data.callId, conversationId: data.conversationId, actor: name, signal: data.signal });
  if (!relayed.ok) { socket.emit("call:error", { conversationId: data.conversationId, code: relayed.code }); return; }
  io.to("user:" + relayed.peer).emit("call:signal", { callId: relayed.call.id, conversationId: relayed.call.conversationId, from: name, signal: data.signal });
});

socket.on("call:end", data => {
  if (!data || typeof data.conversationId !== "string") return;
  const ended = directCallRegistry.end({ callId: data.callId, conversationId: data.conversationId, actor: name, reason: "ended" });
  if (!ended.ok) return;
  clearDirectCallTimer(ended.call.id);
  notifyDirectCallEnded(ended.call, "ended");
});

    // Qrup zəngini başlat
    socket.on("group-call:start", data => {
        if (!data || typeof data.conversationId !== "string") return;
        const convo = getGroupCallConversation(data.conversationId, name);
        if (!convo) return;

        if (activeGroupCalls.has(convo.id)) {
            socket.emit("group-call:error", {
                conversationId: convo.id,
                message: "Bu qrupda artıq aktiv zəng var."
            });
            return;
        }

        const mediaType = data.mediaType === "video" ? "video" : "audio";
        clearGroupCallTimer(convo.id);
        activeGroupCalls.set(convo.id, { participants: [name], mediaType });

        socket.emit("group-call:joined", {
            conversationId: convo.id,
            participants: [],
            mediaType
        });

        convo.participants.filter(p => p !== name).forEach(p => {
            io.to(`user:${p}`).emit("group-call:incoming", {
                conversationId: convo.id,
                from: name,
                mediaType
            });
            push.send(p, "group-call", name, { conversationId: convo.id, mediaType });
        });
    });

    // Qrup zənginə qoşul
    socket.on("group-call:join", data => {
        if (!data || typeof data.conversationId !== "string") return;
        const convo = getGroupCallConversation(data.conversationId, name);
        const call = convo && activeGroupCalls.get(convo.id);
        if (!call) {
            socket.emit("group-call:error", {
                conversationId: data.conversationId,
                message: "Bu qrup zəngi artıq aktiv deyil."
            });
            return;
        }

        clearGroupCallTimer(convo.id);
        if (call.participants.includes(name)) {
            socket.emit("group-call:joined", {
                conversationId: convo.id,
                participants: call.participants.filter(p => p !== name),
                mediaType: call.mediaType || "audio"
            });
            return;
        }

        if (call.participants.length >= 5) {
            socket.emit("group-call:error", {
                conversationId: convo.id,
                message: "Qrup zəngi maksimum 5 nəfər üçündür."
            });
            return;
        }

        const previous = [...call.participants];
        call.participants.push(name);

        previous.forEach(p => {
            io.to(`user:${p}`).emit("group-call:peer-joined", {
                conversationId: convo.id,
                username: name,
                mediaType: call.mediaType || "audio"
            });
        });

        socket.emit("group-call:joined", {
            conversationId: convo.id,
            participants: previous,
            mediaType: call.mediaType || "audio"
        });
    });

    // İştirakçılar arasında WebRTC siqnalları
    socket.on("group-call:signal", data => {
        if (!data || typeof data.conversationId !== "string" ||
            typeof data.to !== "string" || !data.signal) return;

        const convo = getGroupCallConversation(data.conversationId, name);
        const call = convo && activeGroupCalls.get(convo.id);
        if (!call || !call.participants.includes(name) ||
            !call.participants.includes(data.to) || !validateSignal(data.signal)) return;

        io.to(`user:${data.to}`).emit("group-call:signal", {
            conversationId: convo.id,
            from: name,
            signal: data.signal
        });
    });

    // Qrup zəngindən çıx
    socket.on("group-call:leave", data => {
        if (!data || typeof data.conversationId !== "string") return;
        const call = activeGroupCalls.get(data.conversationId);
        if (!getGroupCallConversation(data.conversationId, name) || !call || !call.participants.includes(name)) return;

        call.participants = call.participants.filter(p => p !== name);
        call.participants.forEach(p => {
            io.to(`user:${p}`).emit("group-call:peer-left", {
                conversationId: data.conversationId,
                username: name
            });
        });

        if (call.participants.length === 0) {
            clearGroupCallTimer(data.conversationId);
            activeGroupCalls.delete(data.conversationId);
        }
    });

    socket.on("joinTalkRoom", roomId => {
      const room = getRooms().find(r => r.id === roomId);
      if (room && roomMember(room, name)) socket.join("talk-room:" + roomId);
    });
    socket.on("leaveTalkRoom", roomId => socket.leave("talk-room:" + roomId));

    deliverPending(name);
    socket.on("typing", data => {
        if (!data || typeof data.conversationId !== "string") return;
        const convo = conversations().find(c => c.id === data.conversationId && c.participants.includes(name));
        if (!convo) return;
        convo.participants.filter(p => p !== name).forEach(p =>
            io.to(`user:${p}`).emit("typing", { conversationId: convo.id, from: name }));
    });

    socket.on("disconnect", () => {
        const count = Math.max(0, (onlineUsers.get(name) || 1) - 1);
        if (count === 0) {
            const activeDirectCall = directCallRegistry.findForUser(name);
            if (activeDirectCall) {
                clearDirectCallTimer(activeDirectCall.id);
                if (activeDirectCall.status === "active") {
                    const peer = activeDirectCall.caller === name ? activeDirectCall.callee : activeDirectCall.caller;
                    io.to("user:" + peer).emit("call:peer-reconnecting", { callId: activeDirectCall.id, conversationId: activeDirectCall.conversationId, peer: name });
                    const timer = setTimeout(() => {
                        const ended = directCallRegistry.end({ callId: activeDirectCall.id, conversationId: activeDirectCall.conversationId, actor: name, reason: "disconnected" });
                        directCallTimers.delete(activeDirectCall.id);
                        if (ended.ok) notifyDirectCallEnded(ended.call, "disconnected");
                    }, 45000);
                    if (timer && typeof timer.unref === "function") timer.unref();
                    directCallTimers.set(activeDirectCall.id, timer);
                } else {
                    const ended = directCallRegistry.end({ callId: activeDirectCall.id, conversationId: activeDirectCall.conversationId, actor: name, reason: "disconnected" });
                    if (ended.ok) notifyDirectCallEnded(ended.call, "disconnected");
                }
            }
            // Remove offline members; keep an empty room briefly to allow a transient reconnect.
            for (const [conversationId, call] of activeGroupCalls) {
                if (!call.participants.includes(name)) continue;
                call.participants = call.participants.filter(p => p !== name);
                call.participants.forEach(p => io.to("user:" + p).emit("group-call:peer-left", { conversationId, username: name }));
                if (call.participants.length === 0) expireDisconnectedGroupCall(conversationId, call);
            }
            onlineUsers.delete(name);
            lastSeenMap.set(name, new Date().toISOString());
            io.emit("presenceUpdate", {
                username: name,
                online: false,
                lastSeen: new Date().toISOString()
            });
        } else {
            onlineUsers.set(name, count);
        }
    });
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

function currentUser(req) { return req.session?.username || null; }
function requireAuth(req, res, next) {
    if (!currentUser(req)) return res.status(401).json({ error: "Əvvəlcə giriş et." });
    expireBans();
    const account = users().find(user => user.username === currentUser(req));
    if (!account) return res.status(401).json({ error: "Hesab tapılmadı. Yenidən daxil ol." });
    const ban = activeBan(account);
    if (ban) return res.status(403).json({
        error: ban.until ? `Hesabın ${new Date(ban.until).toLocaleString("az-AZ")} tarixinədək məhdudlaşdırılıb.` : "Hesabın daimi məhdudlaşdırılıb.",
        banned: true,
        ban: { reason: ban.reason || "", until: ban.until || null }
    });
    next();
}

app.get("/api/calls/ice", requireAuth, async (req, res) => {
    const token = process.env.TURNIX_API_TOKEN;

    if (!token) {
        console.error("TURN env adları:", JSON.stringify(Object.keys(process.env).filter(k => /turn/i.test(k))));
        console.error("TURNIX_API_TOKEN is missing");
        return res.status(503).json({
            error: "TURN service is not configured"
        });
    }

    try {
        const response = await fetch(
            "https://turnix.io/api/v1/credentials/ice",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-TURN-CLIENT-IP": req.ip
                },
                body: JSON.stringify({ ttl: 3600 }),
                signal: AbortSignal.timeout(10000)
            }
        );

        if (!response.ok) {
    if (response.status === 429) {
        console.error("Turnix usage limit reached (429)");
        return res.status(503).json({
            error: "TURN usage limit reached"
        });
    }

    if (response.status === 401) {
        console.error("Turnix rejected TURNIX_API_TOKEN (401)");
    } else {
        console.error("Turnix request failed:", response.status);
    }

    return res.status(502).json({
        error: "Could not get TURN credentials"
    });
        }

        const data = await response.json();

        if (!Array.isArray(data.iceServers) || !data.iceServers.length) {
            console.error("Invalid Turnix ICE response");
            return res.status(502).json({
                error: "Invalid TURN response"
            });
        }

        res.set("Cache-Control", "private, no-store");
return res.json({
    iceServers: data.iceServers,
    ...(data.expiresAt ? { expiresAt: data.expiresAt } : {})
});

    } catch (error) {
        console.error("Turnix error:", error.name);
        return res.status(502).json({
            error: "TURN connection failed"
        });
    }
});
function publicUser(user) {
    return {
        username: user.username,
        role: roleOf(user),
        displayName: user.displayName || "",
        bio: user.bio || "",
        avatar: user.avatar || "",
        link: user.link || "",
        followersCount: (user.followers || []).length,
        followingCount: (user.following || []).length,
        isFollowing: false
    };
}
function publicPost(post, userList = users()) {
    const author = userList.find(user => user.username === post.username);
    return {
        ...post,
        kind: post.kind === "reel" ? "reel" : "post",
        comments: (post.comments || []).map(comment => ({
            ...comment,
            role: roleOf(userList.find(user => user.username === comment.username))
        })),
        authorName: author?.displayName || "",
        authorAvatar: author?.avatar || "",
        authorRole: roleOf(author)
    };
}
function activeBan(user) {
    const ban = user?.ban;
    if (!ban || !Object.prototype.hasOwnProperty.call(ban, "until")) return null;
    if (ban.until === null) return ban;
    const end = Date.parse(ban.until);
    return Number.isFinite(end) && end > Date.now() ? ban : null;
}
function activeBanForUsername(username) {
    const account = users().find(user => user.username === username);
    const ban = activeBan(account);
    if (account?.ban && !ban) expireBans();
    return ban;
}
function expireBans() {
    const list = users();
    const now = Date.now();
    const expired = list.filter(user => {
        if (!user.ban || user.ban.until === null) return false;
        const end = Date.parse(user.ban.until);
        return Number.isFinite(end) && end <= now;
    });
    if (!expired.length) return;
    for (const user of expired) {
        user.ban = null;
        appendAudit({
            actorUsername: "system",
            targetUsername: user.username,
            actionType: "ban_expired",
            reason: "Müddətli banın vaxtı bitdi."
        });
    }
    saveUsers(list);
}
function canAccessUpload(filename, username) {
    const matches = (record, pathField, fallbackField) => objectKey(record, pathField, fallbackField) === filename;
    if (users().some(user => matches(user, "avatarStoragePath", "avatar"))) return true;
    if (posts().some(post => matches(post, "storagePath", "media"))) return true;
    if (stories().some(story => Date.parse(story.expiresAt) > Date.now() && matches(story, "storagePath", "media"))) return true;
    const ownedMessage = messages().some(message => {
        if (!matches(message, "attachmentStoragePath", "attachment")) return false;
        const convo = conversations().find(item => item.id === message.conversationId);
        return !!convo && Array.isArray(convo.participants) && convo.participants.includes(username);
    });
    return ownedMessage;
}
async function removeLocalUpload(media, storagePath = "") {
    const raw = storagePath || (typeof media === "string" && media.startsWith("/uploads/") ? media.slice("/uploads/".length) : "");
    if (!raw || raw.split("/").some(part => part === "." || part === "..")) return { ok: true, skipped: true };
    const filename = path.basename(raw);
    if (!filename || filename === "." || filename === "..") return { ok: true, skipped: true };
    let storageResult = { ok: true, skipped: true };
    if (supa.enabled) {
        try { storageResult = await supa.remove(raw); }
        catch (error) {
            console.error("Supabase silmə xətası:", error.message);
            storageResult = { ok: false, error };
        }
    }
    await fs.promises.unlink(path.join(UPLOADS, filename)).catch(() => {});
    return storageResult;
}
function appendAudit(entry) {
    const log = readJSON("auditLogs.json");
    log.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry });
    saveJSON("auditLogs.json", log.slice(0, 2000));
}
function requireRole(minimumRole) {
    return (req, res, next) => {
        const actor = users().find(user => user.username === currentUser(req));
        if (!actor || ROLE_LEVEL[roleOf(actor)] < ROLE_LEVEL[minimumRole])
            return res.status(403).json({ error: "Bu əməliyyat üçün icazən yoxdur." });
        req.talkchatActor = actor;
        next();
    };
}
function canUseDuration(value) {
    return normalizeBanDuration(value) !== undefined;
}
function applyBan(actor, target, duration, reason) {
    if (!canModerateUser(actor, target)) return { status: 403, error: "Bu istifadəçiyə ban tətbiq etmək icazən yoxdur." };
    const durationMs = normalizeBanDuration(duration);
    if (durationMs === undefined) return { status: 400, error: "Ban müddəti düzgün deyil." };
    const trimmedReason = String(reason || "").trim().slice(0, 500);
    if (trimmedReason.length < 3) return { status: 400, error: "Ban səbəbi ən azı 3 simvol olmalıdır." };
    const list = users();
    const account = list.find(user => user.username === target.username);
    if (!account) return { status: 404, error: "İstifadəçi tapılmadı." };
    const ban = {
        reason: trimmedReason,
        until: durationMs === null ? null : new Date(Date.now() + durationMs).toISOString(),
        createdAt: new Date().toISOString(),
        createdBy: actor.username
    };
    account.ban = ban;
    saveUsers(list);
    appendAudit({
        actorUsername: actor.username,
        targetUsername: account.username,
        actionType: "user_banned",
        reason: trimmedReason
    });
    io.to(`user:${account.username}`).emit("account:banned", { reason: ban.reason, until: ban.until });
    io.in(`user:${account.username}`).disconnectSockets(true);
    return { status: 200, ban };
}
function findAccount(name) {
    const normalized = String(name || "").replace(/^@/, "").toLowerCase();
    return users().find(user => user.username.toLowerCase() === normalized) || null;
}
async function deleteModeratedContent(type, id, actorUsername, reason) {
    const list = posts();
    if (type === "comment") {
        for (const post of list) {
            const index = (post.comments || []).findIndex(comment => comment.id === id);
            if (index < 0) continue;
            const [comment] = post.comments.splice(index, 1);
            savePosts(list);
            appendAudit({
                actorUsername, targetUsername: comment.username,
                actionType: "comment_deleted", targetType: "comment", targetId: id, reason
            });
            return { ok: true, targetUsername: comment.username, postId: post.id };
        }
        return { status: 404, error: "Şərh tapılmadı." };
    }
    if (type !== "post" && type !== "reel") return { status: 400, error: "Məzmun növü düzgün deyil." };
    const post = list.find(item => item.id === id && (type !== "reel" || item.kind === "reel") && (type !== "post" || item.kind !== "reel"));
    if (!post) return { status: 404, error: "Paylaşım tapılmadı." };
    const removed = await removeLocalUpload(post.media, post.storagePath);
    if (!removed.ok) return { status: 503, error: "Fayl Storage-dan silinmədi; paylaşım saxlanıldı." };
    savePosts(list.filter(item => item.id !== post.id));
    appendAudit({
        actorUsername, targetUsername: post.username,
        actionType: type === "reel" ? "reel_deleted" : "post_deleted",
        targetType: type, targetId: id, reason
    });
    return { ok: true, targetUsername: post.username };
}
function reportContent(report) {
    const type = report.itemType || "post";
    if (type === "comment") {
        const post = posts().find(item => item.id === report.postId);
        const comment = post?.comments?.find(item => item.id === (report.itemId || report.commentId));
        return comment ? {
            type, id: comment.id, postId: post.id, owner: comment.username,
            text: comment.text, createdAt: comment.createdAt
        } : null;
    }
    const post = posts().find(item => item.id === (report.itemId || report.postId));
    return post ? {
        type: post.kind === "reel" ? "reel" : "post",
        id: post.id, owner: post.username, text: post.text || "",
        media: post.media || "", mediaType: post.mediaType || "",
        createdAt: post.createdAt
    } : null;
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
const storage = supa.enabled ? supa.engine() : multer.diskStorage({
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
const socialMediaMime = new Set([
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/webm"
]);
const socialExtensions = {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    "image/gif": [".gif"],
    "video/mp4": [".mp4"],
    "video/webm": [".webm"]
};
const socialUpload = multer({
    storage,
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase();
        if (!socialMediaMime.has(file.mimetype) || !socialExtensions[file.mimetype]?.includes(ext))
            return cb(new Error("Yalnız JPG, PNG, WebP, GIF, MP4 və ya WebM faylı seç."));
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
            role: "member", displayName: "", bio: "", avatar: "", avatarStoragePath: "",
            link: "", followers: [], following: [],
            createdAt: new Date().toISOString()
        };
        list.push(user);
        saveUsers(list);
        req.session = { username: name };
        res.json({ username: name });
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
        expireBans();
        const ban = activeBan(user);
        if (ban) return res.status(403).json({
            error: ban.until ? `Hesabın ${new Date(ban.until).toLocaleString("az-AZ")} tarixinədək məhdudlaşdırılıb.` : "Hesabın daimi məhdudlaşdırılıb.",
            banned: true,
            ban: { reason: ban.reason || "", until: ban.until || null }
        });
        req.session = { username: user.username };
        res.json({ username: user.username });
    } catch { res.status(500).json({ error: "Server xətası." }); }
});

app.get("/api/me", (req, res) => {
    if (!currentUser(req)) return res.status(401).json({ error: "Giriş edilməyib." });
    expireBans();
    const user = users().find(item => item.username === currentUser(req));
    if (!user) return res.status(401).json({ error: "Hesab tapılmadı." });
    const ban = activeBan(user);
    res.json({
        username: user.username,
        role: roleOf(user),
        ban: ban ? { reason: ban.reason || "", until: ban.until || null } : null
    });
});
app.post("/api/logout", (req, res) => {
    req.session = null;
    res.json({ message: "Çıxış edildi." });
});

app.post("/api/owner/bootstrap", requireAuth, (req, res) => {
    const actor = users().find(user => user.username === currentUser(req));
    const expected = process.env.TALKCHAT_OWNER_BOOTSTRAP_SECRET || "";
    const supplied = typeof req.body?.secret === "string" ? req.body.secret : "";
    const expectedBytes = Buffer.from(expected);
    const suppliedBytes = Buffer.from(supplied);
    const secretMatches = expectedBytes.length > 0 &&
        expectedBytes.length === suppliedBytes.length &&
        crypto.timingSafeEqual(expectedBytes, suppliedBytes);
    if (!expectedBytes.length) return res.status(503).json({ error: "Owner doğrulama sirri server mühitində qurulmayıb." });
    if (!secretMatches || actor?.username !== OWNER_USERNAME)
        return res.status(403).json({ error: "Owner hesabı təsdiqlənmədi." });
    if (roleOf(actor) === "owner") return res.json({ role: "owner" });
    const list = users();
    const user = list.find(item => item.username === OWNER_USERNAME);
    if (!user) return res.status(404).json({ error: "DevQrxyz hesabı tapılmadı." });
    user.role = "owner";
    user.ownerVerifiedAt = new Date().toISOString();
    saveUsers(list);
    appendAudit({
        actorUsername: OWNER_USERNAME,
        targetUsername: OWNER_USERNAME,
        actionType: "owner_verified",
        reason: "Server owner secret ilə təsdiqləndi."
    });
    res.json({ role: "owner" });
});

app.get("/api/profile", requireAuth, (req, res) => {
    const user = users().find(u => u.username === currentUser(req));
    if (!user) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    res.json(publicUser(user));
});
app.put("/api/profile", requireAuth, (req, res) => {
    const body = req.body || {};
    if (body.bio !== undefined && (typeof body.bio !== "string" || body.bio.length > 160))
        return res.status(400).json({ error: "Bio maksimum 160 simvol ola bilər." });
    if (body.displayName !== undefined && (typeof body.displayName !== "string" || body.displayName.length > 50))
        return res.status(400).json({ error: "Ad maksimum 50 simvol ola bilər." });
    let link = "";
    if (body.link !== undefined) {
        if (typeof body.link !== "string" || body.link.length > 200)
            return res.status(400).json({ error: "Link maksimum 200 simvol ola bilər." });
        link = body.link.trim();
        if (link) {
            try {
                const parsed = new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`);
                if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid protocol");
                link = parsed.toString();
            } catch {
                return res.status(400).json({ error: "Düzgün veb linki daxil et." });
            }
        }
    }
    const list = users();
    const user = list.find(u => u.username === currentUser(req));
    if (!user) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    if (body.bio !== undefined) user.bio = body.bio.trim();
    if (body.displayName !== undefined) user.displayName = body.displayName.trim();
    if (body.link !== undefined) user.link = link;
    saveUsers(list);
    res.json(publicUser(user));
});
app.post("/api/profile/avatar", requireAuth, socialUpload.single("file"), async (req, res) => {
    if (!req.file || !req.file.mimetype.startsWith("image/")) {
        if (req.file) removeLocalUpload(`/uploads/${req.file.filename}`);
        return res.status(400).json({ error: "Profil şəkli üçün şəkil faylı seç." });
    }
    if (req.file.size > 12 * 1024 * 1024) {
        removeLocalUpload(`/uploads/${req.file.filename}`);
        return res.status(400).json({ error: "Şəkil maksimum 12 MB ola bilər." });
    }
    const list = users();
    const user = list.find(u => u.username === currentUser(req));
    if (!user) {
        removeLocalUpload(`/uploads/${req.file.filename}`);
        return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    }
    await removeLocalUpload(user.avatar, user.avatarStoragePath);
    user.avatar = `/uploads/${req.file.filename}`;
    user.avatarStoragePath = req.file.filename;
    saveUsers(list);
    res.json({ avatar: user.avatar });
});

app.get("/api/users/:username", requireAuth, (req, res) => {
    const name = req.params.username.replace(/^@/, "");
    const user = users().find(u => u.username.toLowerCase() === name.toLowerCase());
    if (!user) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    const result = publicUser(user);
    result.isFollowing = (users().find(u => u.username === currentUser(req))?.following || []).includes(user.username);
    res.json(result);
});
app.get("/api/search", requireAuth, (req, res) => {
    const q = String(req.query.q || "").trim().replace(/^@/, "").toLowerCase();
    if (!q) return res.json([]);
    res.json(users().filter(u => u.username.toLowerCase().includes(q))
        .slice(0, 30).map(u => {
            const result = publicUser(u);
            result.isFollowing = (users().find(x => x.username === currentUser(req))?.following || []).includes(u.username);
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
    const me = currentUser(req);
    const self = users().find(u => u.username === me);
    if (!self) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    const following = self.following || [];
    let list = posts().filter(p => p.kind !== "reel");
    if (scope === "following") list = list.filter(p => p.username === self.username || following.includes(p.username));
    const userList = users();
    res.json(list.slice().sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 100).map(p => publicPost(p, userList)));
});
app.get("/api/reels", requireAuth, (req, res) => {
    const userList = users();
    const list = posts().filter(p => p.kind === "reel")
        .sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 100);
    res.json(list.map(p => publicPost(p, userList)));
});
app.get("/api/profile/posts", requireAuth, (req, res) => {
    const userList = users();
    res.json(posts().filter(p => p.username === currentUser(req))
        .sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 100).map(p => publicPost(p, userList)));
});
app.get("/api/users/:username/posts", requireAuth, (req, res) => {
    const name = req.params.username.replace(/^@/, "");
    const userList = users();
    const author = userList.find(u => u.username.toLowerCase() === name.toLowerCase());
    if (!author) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    res.json(posts().filter(p => p.username === author.username)
        .sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 100).map(p => publicPost(p, userList)));
});
app.post("/api/posts", requireAuth, socialUpload.single("media"), (req, res) => {
    const text = String(req.body.text || "").trim().slice(0, 1000);
    if (!text && !req.file) return res.status(400).json({ error: "Mətn və ya media əlavə et." });
    let mediaType = "";
    if (req.file) {
        if (req.file.mimetype.startsWith("image/")) mediaType = "image";
        else if (req.file.mimetype.startsWith("video/")) mediaType = "video";
        else return res.status(400).json({ error: "Paylaşım üçün yalnız şəkil və video seç." });
        if (mediaType === "image" && req.file.size > 12 * 1024 * 1024) {
            removeLocalUpload(`/uploads/${req.file.filename}`);
            return res.status(400).json({ error: "Şəkil maksimum 12 MB ola bilər." });
        }
    }
    const list = posts();
    const post = {
        id: crypto.randomUUID(), username: currentUser(req), text,
        media: req.file ? `/uploads/${req.file.filename}` : "",
        storagePath: req.file ? req.file.filename : "",
        mediaType, kind: "post", likes: [], comments: [], createdAt: new Date().toISOString()
    };
    list.unshift(post); savePosts(list);
    res.json(publicPost(post));
});
app.post("/api/reels", requireAuth, socialUpload.single("media"), (req, res) => {
    const caption = String(req.body.text || "").trim().slice(0, 500);
    if (!req.file) return res.status(400).json({ error: "Reels üçün video seç." });
    if (!["video/mp4", "video/webm"].includes(req.file.mimetype)) {
        removeLocalUpload(`/uploads/${req.file.filename}`);
        return res.status(400).json({ error: "Reels yalnız MP4 və ya WebM videoları qəbul edir." });
    }
    const reel = {
        id: crypto.randomUUID(), username: currentUser(req), text: caption,
        media: `/uploads/${req.file.filename}`, storagePath: req.file.filename,
        mediaType: "video", kind: "reel",
        likes: [], comments: [], createdAt: new Date().toISOString()
    };
    const list = posts();
    list.unshift(reel);
    savePosts(list);
    res.status(201).json(publicPost(reel));
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
app.put("/api/posts/:id", requireAuth, (req, res) => {
    const text = String((req.body || {}).text || "").trim().slice(0, 1000);
    const list = posts();
    const post = list.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: "Paylaşım tapılmadı." });
    if (post.username !== currentUser(req)) return res.status(403).json({ error: "Yalnız öz paylaşımını redaktə edə bilərsən." });
    if (!text && !post.media) return res.status(400).json({ error: "Mətn boş ola bilməz." });
    post.text = text;
    post.updatedAt = new Date().toISOString();
    savePosts(list);
    res.json(publicPost(post));
});
app.delete("/api/posts/:id", requireAuth, async (req, res) => {
    const list = posts();
    const post = list.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: "Paylaşım tapılmadı." });
    if (post.username !== currentUser(req)) return res.status(403).json({ error: "Yalnız öz paylaşımını silə bilərsən." });
    const removed = await removeLocalUpload(post.media, post.storagePath);
    if (!removed.ok) return res.status(503).json({ error: "Fayl Storage-dan silinmədi; paylaşım saxlanıldı." });
    savePosts(list.filter(p => p.id !== post.id));
    res.json({ ok: true });
});
app.post("/api/posts/:id/report", requireAuth, (req, res) => {
    const me = currentUser(req);
    const post = posts().find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: "Paylaşım tapılmadı." });
    if (post.username === me) return res.status(400).json({ error: "Öz paylaşımını şikayət edə bilməzsən." });
    const list = reports();
    if (list.some(report => report.reporter === me &&
        (report.itemId === post.id || report.postId === post.id) &&
        (report.itemType === "comment" ? false : true)))
        return res.status(409).json({ error: "Bu paylaşımı artıq şikayət etmisən." });
    const reason = String((req.body || {}).reason || "").trim();
    if (!["Spam", "Taciz", "Uygunsuz içerik", "Sahte hesap", "Diğer"].includes(reason))
        return res.status(400).json({ error: "Şikayət səbəbini siyahıdan seç." });
    list.unshift({
        id: crypto.randomUUID(),
        itemType: post.kind === "reel" ? "reel" : "post",
        itemId: post.id, postId: post.id, owner: post.username,
        reporter: me, reason, status: "pending", createdAt: new Date().toISOString()
    });
    saveReports(list.slice(0, 5000));
    res.status(201).json({ ok: true });
});
app.post("/api/posts/:id/comments/:commentId/report", requireAuth, (req, res) => {
    const me = currentUser(req);
    const post = posts().find(item => item.id === req.params.id);
    const comment = post?.comments?.find(item => item.id === req.params.commentId);
    if (!comment) return res.status(404).json({ error: "Şərh tapılmadı." });
    if (comment.username === me) return res.status(400).json({ error: "Öz şərhini şikayət edə bilməzsən." });
    const reason = String((req.body || {}).reason || "").trim();
    if (!["Spam", "Taciz", "Uygunsuz içerik", "Sahte hesap", "Diğer"].includes(reason))
        return res.status(400).json({ error: "Şikayət səbəbini siyahıdan seç." });
    const list = reports();
    if (list.some(report => report.reporter === me && report.itemType === "comment" && report.itemId === comment.id))
        return res.status(409).json({ error: "Bu şərhi artıq şikayət etmisən." });
    list.unshift({
        id: crypto.randomUUID(), itemType: "comment", itemId: comment.id,
        postId: post.id, owner: comment.username, reporter: me, reason,
        status: "pending", createdAt: new Date().toISOString()
    });
    saveReports(list.slice(0, 5000));
    res.status(201).json({ ok: true });
});
app.get("/api/admin/summary", requireAuth, requireRole("moderator"), (_req, res) => {
    expireBans();
    const userList = users();
    const reportList = reports();
    const pending = reportList.filter(report => !report.status || report.status === "pending");
    const pendingTypes = pending.map(report => reportContent(report)?.type || report.itemType || "post");
    const audit = readJSON("auditLogs.json");
    res.json({
        users: userList.length,
        admins: userList.filter(user => roleOf(user) === "admin").length,
        moderators: userList.filter(user => roleOf(user) === "moderator").length,
        banned: userList.filter(user => !!activeBan(user)).length,
        reports: pending.length,
        reportedPosts: pendingTypes.filter(type => type === "post").length,
        reportedReels: pendingTypes.filter(type => type === "reel").length,
        recentActions: audit.slice(0, 12)
    });
});
app.get("/api/admin/users", requireAuth, requireRole("moderator"), (req, res) => {
    expireBans();
    const query = String(req.query.q || "").trim().replace(/^@/, "").toLowerCase();
    const result = users().filter(user => !query ||
        user.username.toLowerCase().includes(query) ||
        String(user.displayName || "").toLowerCase().includes(query))
        .slice(0, 50)
        .map(user => ({
            ...publicUser(user),
            createdAt: user.createdAt || "",
            ban: activeBan(user) ? { ...activeBan(user) } : null
        }));
    res.json(result);
});
app.get("/api/admin/reports", requireAuth, requireRole("moderator"), (req, res) => {
    const status = String(req.query.status || "pending");
    const list = reports().filter(report => status === "all"
        ? true
        : (report.status || "pending") === status)
        .slice(0, 200)
        .map(report => ({ ...report, content: reportContent(report) }));
    res.json(list);
});
app.get("/api/admin/audit", requireAuth, requireRole("moderator"), (req, res) => {
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
    res.json(readJSON("auditLogs.json").slice(0, limit));
});
app.post("/api/admin/users/:username/role", requireAuth, requireRole("owner"), (req, res) => {
    const actor = req.talkchatActor;
    const target = findAccount(req.params.username);
    const desiredRole = String(req.body?.role || "");
    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    if (!target) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    if (!canAssignRole(actor, target, desiredRole))
        return res.status(403).json({ error: "Bu rol dəyişikliyinə icazən yoxdur." });
    if (reason.length < 3) return res.status(400).json({ error: "Səbəb ən azı 3 simvol olmalıdır." });
    target.role = desiredRole;
    const list = users();
    const index = list.findIndex(user => user.username === target.username);
    list[index] = target;
    saveUsers(list);
    appendAudit({
        actorUsername: actor.username, targetUsername: target.username,
        actionType: "role_changed", reason: `${reason} (${roleOf(target)})`
    });
    res.json({ username: target.username, role: roleOf(target) });
});
app.post("/api/admin/users/:username/ban", requireAuth, requireRole("moderator"), (req, res) => {
    const target = findAccount(req.params.username);
    if (!target) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    const result = applyBan(req.talkchatActor, target, req.body?.duration, req.body?.reason);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, ban: result.ban });
});
app.post("/api/admin/users/:username/unban", requireAuth, requireRole("moderator"), (req, res) => {
    const target = findAccount(req.params.username);
    if (!target) return res.status(404).json({ error: "İstifadəçi tapılmadı." });
    if (!canModerateUser(req.talkchatActor, target))
        return res.status(403).json({ error: "Bu istifadəçinin banını qaldırmağa icazən yoxdur." });
    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    if (reason.length < 3) return res.status(400).json({ error: "Səbəb ən azı 3 simvol olmalıdır." });
    if (!activeBan(target)) return res.status(409).json({ error: "İstifadəçinin aktiv banı yoxdur." });
    const list = users();
    const account = list.find(user => user.username === target.username);
    account.ban = null;
    saveUsers(list);
    appendAudit({
        actorUsername: req.talkchatActor.username, targetUsername: account.username,
        actionType: "ban_lifted", reason
    });
    res.json({ ok: true });
});
app.delete("/api/admin/content/:type/:id", requireAuth, requireRole("moderator"), async (req, res) => {
    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    if (reason.length < 3) return res.status(400).json({ error: "Səbəb ən azı 3 simvol olmalıdır." });
    const result = await deleteModeratedContent(req.params.type, req.params.id, req.talkchatActor.username, reason);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error || "Məzmun silinmədi." });
    res.json({ ok: true });
});
app.post("/api/admin/reports/:id/action", requireAuth, requireRole("moderator"), async (req, res) => {
    const reportList = reports();
    const report = reportList.find(item => item.id === req.params.id);
    if (!report) return res.status(404).json({ error: "Şikayət tapılmadı." });
    if (report.status && report.status !== "pending")
        return res.status(409).json({ error: "Bu şikayət artıq işlənib." });
    const action = String(req.body?.action || "");
    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    if (!["resolve", "reject", "delete", "ban"].includes(action))
        return res.status(400).json({ error: "Şikayət əməliyyatı düzgün deyil." });
    if (reason.length < 3) return res.status(400).json({ error: "Səbəb ən azı 3 simvol olmalıdır." });
    const content = reportContent(report);
    if (!content) return res.status(404).json({ error: "Şikayət edilən məzmun artıq mövcud deyil." });
    const actor = req.talkchatActor;
    if (action === "delete") {
        const deleted = await deleteModeratedContent(content.type, content.id, actor.username, reason);
        if (!deleted.ok) return res.status(deleted.status || 400).json({ error: deleted.error || "Məzmun silinmədi." });
    }
    if (action === "ban") {
        const target = findAccount(content.owner);
        if (!target) return res.status(404).json({ error: "Məzmun sahibi tapılmadı." });
        const banned = applyBan(actor, target, req.body?.duration, reason);
        if (banned.status !== 200) return res.status(banned.status).json({ error: banned.error });
    }
    report.status = action === "reject" ? "rejected" : "resolved";
    report.action = action;
    report.actionBy = actor.username;
    report.actionAt = new Date().toISOString();
    report.actionReason = reason;
    saveReports(reportList);
    appendAudit({
        actorUsername: actor.username, targetUsername: content.owner,
        actionType: action === "reject" ? "report_rejected" : "report_resolved",
        targetType: content.type, targetId: content.id, reason
    });
    res.json({ ok: true, status: report.status });
});
app.post("/api/posts/:id/share", requireAuth, (req, res) => {
    const me = currentUser(req);
    const name = String((req.body || {}).username || "").trim().replace(/^@/, "");
    const userList = users();
    const target = userList.find(user => user.username.toLowerCase() === name.toLowerCase());
    const post = posts().find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: "Paylaşım tapılmadı." });
    if (!target || target.username === me) return res.status(400).json({ error: "Qəbul edənin istifadəçi adını yoxla." });
    const conversationList = conversations();
    let convo = conversationList.find(c => c.type === "direct" &&
        c.participants.includes(me) && c.participants.includes(target.username));
    if (!convo) {
        convo = { id: crypto.randomUUID(), type: "direct", participants: [me, target.username], createdAt: new Date().toISOString() };
        conversationList.push(convo);
        saveConversations(conversationList);
    }
    const message = {
        id: crypto.randomUUID(), conversationId: convo.id, from: me, text: "",
        attachment: "", attachmentName: "", attachmentType: "", sharedPostId: post.id,
        sharedPost: {
            id: post.id, username: post.username, authorName: publicPost(post, userList).authorName,
            text: post.text || "", media: post.media || "", mediaType: post.mediaType || "",
            kind: post.kind === "reel" ? "reel" : "post"
        },
        replyTo: "", deleted: false, deliveredAt: onlineUsers.has(target.username) ? new Date().toISOString() : "",
        createdAt: new Date().toISOString()
    };
    const messageList = messages();
    messageList.push(message);
    saveMessages(messageList);
    io.to(`user:${target.username}`).emit("newMessage", { conversationId: convo.id });
    io.to(`user:${me}`).emit("messagesChanged", { conversationId: convo.id });
    addNotification(target.username, me, "message");
    push.send(target.username, "message", me);
    res.status(201).json({ ok: true, conversationId: convo.id, message });
});

app.get("/api/notifications", requireAuth, (req, res) => {
    const list = notifications();
    const mine = list.filter(n => n.to === currentUser(req));
    mine.forEach(n => n.read = true); saveNotifications(list);
    res.json(mine.slice(0, 100));
});

app.get("/api/conversations", requireAuth, (req, res) => {
    const me = currentUser(req);
    const allMessages = messages();
    res.json(conversations().filter(c => c.participants.includes(me)).map(c => {
        const mine = allMessages.filter(m => m.conversationId === c.id);
        const last = mine[mine.length - 1] || null;
        const reads = c.reads || {};
        const readAt = reads[me] ? new Date(reads[me]).getTime() : 0;
        const unread = mine.filter(m => m.from !== me && !m.deleted && new Date(m.createdAt).getTime() > readAt).length;
        return {
            id: c.id, type: c.type,
            name: c.type === "group" ? c.name : c.participants.find(x => x !== me),
            participants: c.participants,
            lastMessage: last ? previewOf(last) : "",
            lastMessageAt: last ? last.createdAt : "",
            lastFrom: last ? last.from : "",
            unread,
            reads
        };
    }));
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
    const replyId = String(req.body.replyTo || "");
    const replyTarget = replyId ? messages().find(m => m.id === replyId && m.conversationId === convo.id) : null;
    const recipients = convo.participants.filter(x => x !== currentUser(req));
    const message = {
        id: crypto.randomUUID(), conversationId: convo.id, from: currentUser(req), text,
        attachment: req.file ? `/uploads/${req.file.filename}` : "",
        attachmentStoragePath: req.file ? req.file.filename : "",
        attachmentName: req.file ? req.file.originalname.slice(0, 100) : "",
        attachmentType: req.file ? req.file.mimetype : "",
        replyTo: replyTarget ? replyTarget.id : "",
        deleted: false,
        deliveredAt: recipients.some(to => onlineUsers.has(to)) ? new Date().toISOString() : "",
        createdAt: new Date().toISOString()
    };
    const list = messages(); list.push(message); saveMessages(list);
    convo.participants.filter(x => x !== currentUser(req)).forEach(to => {
        io.to(`user:${to}`).emit("newMessage", { conversationId: convo.id });
        addNotification(to, currentUser(req), "message");
        console.log("PUSH msg to", to, "online:", onlineUsers.has(to));
        push.send(to, "message", currentUser(req));
    });
    res.json(message);
});


// Söhbəti oxunmuş et (karşı tərəf "Göründü" görür)
app.post("/api/conversations/:id/read", requireAuth, (req, res) => {
    const me = currentUser(req);
    const list = conversations();
    const convo = list.find(c => c.id === req.params.id && c.participants.includes(me));
    if (!convo) return res.status(404).json({ error: "Söhbət tapılmadı." });
    convo.reads = { ...(convo.reads || {}), [me]: new Date().toISOString() };
    saveConversations(list);
    convo.participants.filter(x => x !== me).forEach(to =>
        io.to(`user:${to}`).emit("messagesChanged", { conversationId: convo.id }));
    res.json({ ok: true });
});

// Öz mesajını sil (mətn və fayl təmizlənir, "Mesaj silindi" qalır)
app.delete("/api/conversations/:id/messages/:mid", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const convo = conversations().find(c => c.id === req.params.id && c.participants.includes(me));
    if (!convo) return res.status(404).json({ error: "Söhbət tapılmadı." });
    const list = messages();
    const m = list.find(x => x.id === req.params.mid && x.conversationId === convo.id);
    if (!m) return res.status(404).json({ error: "Mesaj tapılmadı." });
    if (m.from !== me) return res.status(403).json({ error: "Yalnız öz mesajını silə bilərsən." });
    if (m.attachment) {
        const removed = await removeLocalUpload(m.attachment, m.attachmentStoragePath);
        if (!removed.ok) return res.status(503).json({ error: "Fayl Storage-dan silinmədi; mesaj saxlanıldı." });
    }
    Object.assign(m, { deleted: true, text: "", attachment: "", attachmentName: "", attachmentType: "" });
    m.attachmentStoragePath = "";
    saveMessages(list);
    convo.participants.forEach(to => io.to(`user:${to}`).emit("messagesChanged", { conversationId: convo.id }));
    res.json({ ok: true });
});

// Push bildiriş tokenini qeyd et (Android tətbiq). Dil bildiriş mətninin dilini təyin edir.
app.post("/api/push/register", requireAuth, (req, res) => {
  console.log("PUSH register hit:", currentUser(req), "online:", onlineUsers.size);
    const body = req.body || {};
    const token = String(body.token || "");
    if (!token || token.length > 500) return res.status(400).json({ error: "Token səhvdir." });
    push.register(currentUser(req), token, String(body.lang || "tr"));
    res.json({ ok: true });
});

// Aktiv istifadəçilər və son görülmə vaxtları
app.get("/api/presence", requireAuth, (req, res) => {
    res.json({ online: [...onlineUsers.keys()], lastSeen: Object.fromEntries(lastSeenMap) });
});

// TALKCHAT_STORIES_V1
app.get("/api/stories", requireAuth, async (req, res) => {
    const now = Date.now();
    const existing = stories();
    const list = existing.filter(x => new Date(x.expiresAt).getTime() > now);
    for (const expired of existing.filter(x => new Date(x.expiresAt).getTime() <= now))
        await removeLocalUpload(expired.media, expired.storagePath);
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

app.post("/api/stories", requireAuth, socialUpload.single("media"), (req, res) => {
    if (!req.file) return res.status(400).json({error:"Şəkil və ya video seç."});
    if (!req.file.mimetype.startsWith("image/") && !req.file.mimetype.startsWith("video/")) {
        removeLocalUpload(`/uploads/${req.file.filename}`);
        return res.status(400).json({error:"Yalnız şəkil və video paylaşmaq olar."});
    }
    if (req.file.mimetype.startsWith("image/") && req.file.size > 12 * 1024 * 1024) {
        removeLocalUpload(`/uploads/${req.file.filename}`);
        return res.status(400).json({error:"Şəkil maksimum 12 MB ola bilər."});
    }
    const now = new Date();
    const item = {
        id: crypto.randomUUID(),
        username: currentUser(req),
        media: "/uploads/" + req.file.filename,
        storagePath: req.file.filename,
        storagePath: req.file.filename,
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

app.delete("/api/stories/:id", requireAuth, async (req, res) => {
    const list = stories();
    const item = list.find(x => x.id === req.params.id);
    if (!item) return res.status(404).json({error:"Story tapılmadı."});
    if (item.username !== currentUser(req)) return res.status(403).json({error:"Bu Story sənə aid deyil."});
    const removed = await removeLocalUpload(item.media, item.storagePath);
    if (!removed.ok) return res.status(503).json({error:"Fayl Storage-dan silinmədi; Story saxlanıldı."});
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


// TALKCHAT ROOMS API
const roomFile = path.join(DATA, "rooms.json");
const roomMessageFile = path.join(DATA, "roomMessages.json");

function getRooms() { return store.read("rooms.json"); }
function saveRooms(v) { store.save("rooms.json", v); }
function getRoomMessages() { return store.read("roomMessages.json"); }
function saveRoomMessages(v) { store.save("roomMessages.json", v); }
const roomReactions = ["❤️", "😂", "👍", "🔥"];
function roomMember(room, username) {
  return Array.isArray(room.members) && room.members.includes(username);
}

app.get("/api/rooms/discover", requireAuth, (req, res) => {
  const username = currentUser(req);
  res.json(getRooms().map(r => ({
    id: r.id, name: r.name, owner: r.owner,
    memberCount: r.members.length,
    joined: roomMember(r, username)
  })));
});

app.get("/api/rooms", requireAuth, (req, res) => {
  res.json(getRooms().filter(r => roomMember(r, currentUser(req))));
});

app.post("/api/rooms", requireAuth, (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 40);
  if (name.length < 2) return res.status(400).json({error:"Otaq adı ən azı 2 simvol olmalıdır."});
  const username = currentUser(req);
  const rooms = getRooms();
  const room = {id:crypto.randomUUID(), name, owner:username, members:[username], createdAt:new Date().toISOString()};
  rooms.push(room);
  saveRooms(rooms);
  res.json(room);
});

app.post("/api/rooms/:id/join", requireAuth, (req, res) => {
  const rooms = getRooms();
  const room = rooms.find(r => r.id === req.params.id);
  if (!room) return res.status(404).json({error:"Otaq tapılmadı."});
  const username = currentUser(req);
  if (!roomMember(room, username)) room.members.push(username);
  saveRooms(rooms);
  res.json(room);
});

app.get("/api/rooms/:id/members", requireAuth, (req, res) => {
  const room = getRooms().find(r => r.id === req.params.id);
  if (!room || !roomMember(room, currentUser(req))) return res.status(403).json({error:"Giriş icazən yoxdur."});
  res.json({members:room.members});
});

app.get("/api/rooms/:id/messages", requireAuth, (req, res) => {
  const room = getRooms().find(r => r.id === req.params.id);
  if (!room || !roomMember(room, currentUser(req))) return res.status(403).json({error:"Giriş icazən yoxdur."});
  res.json(getRoomMessages().filter(m => m.roomId === room.id));
});

app.post("/api/rooms/:id/messages", requireAuth, (req, res) => {
  const room = getRooms().find(r => r.id === req.params.id);
  if (!room || !roomMember(room, currentUser(req))) return res.status(403).json({error:"Giriş icazən yoxdur."});
  const text = String(req.body.text || "").trim();
  if (!text || text.length > 2000) return res.status(400).json({error:"Mesaj 1–2000 simvol olmalıdır."});
  const message = {id:crypto.randomUUID(), roomId:room.id, username:currentUser(req), text, reactions:{}, createdAt:new Date().toISOString()};
  const list = getRoomMessages();
  list.push(message);
  saveRoomMessages(list);
  io.to("talk-room:" + room.id).emit("roomMessage", message);
  res.json(message);
});

app.post("/api/rooms/:id/messages/:messageId/react", requireAuth, (req, res) => {
  const room = getRooms().find(r => r.id === req.params.id);
  if (!room || !roomMember(room, currentUser(req))) return res.status(403).json({error:"Giriş icazən yoxdur."});
  const emoji = String(req.body.emoji || "");
  if (!roomReactions.includes(emoji)) return res.status(400).json({error:"Reaksiya icazəli deyil."});
  const list = getRoomMessages();
  const message = list.find(m => m.id === req.params.messageId && m.roomId === room.id);
  if (!message) return res.status(404).json({error:"Mesaj tapılmadı."});
  if (!message.reactions) message.reactions = {};
  if (!Array.isArray(message.reactions[emoji])) message.reactions[emoji] = [];
  const users = message.reactions[emoji];
  const username = currentUser(req);
  const i = users.indexOf(username);
  if (i >= 0) users.splice(i, 1); else users.push(username);
  saveRoomMessages(list);
  io.to("talk-room:" + room.id).emit("roomReaction", message);
  res.json(message);
});

const PORT = process.env.PORT || 3000;
async function startServer() {
    if (supa.enabled) await supa.ensurePrivateBucket();
    server.listen(PORT, "0.0.0.0", () => console.log(`TalkChat V2 işləyir: http://localhost:${PORT}`));
}
startServer().catch(error => {
    console.error("Storage təhlükəsizliyini yoxlamaq mümkün olmadı:", error.message);
    process.exit(1);
});
