"use strict";

const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { validateSignal } = require("./call-registry");

const STREAMS_KEY = "liveStreams.json";
const MAX_VIEWERS = 10;
const MAX_COMMENTS = 500;
const COMMENT_LIMIT = 500;

function installLiveStreams(deps) {
    const {
        app, io, users, readJSON, saveJSON, requireAuth, currentUser,
        canViewProfile, canViewContent, isBlockedBetween,
        roleOf, canModerateUser, appendAudit
    } = deps;
    const sessions = new Map();
    const streams = () => readJSON(STREAMS_KEY, []);
    const saveStreams = value => saveJSON(STREAMS_KEY, value);
    const findStream = id => streams().find(item => item.id === id);
    const now = () => new Date().toISOString();
    const canWatch = (viewer, stream) => {
        const owner = users().find(user => user.username === stream?.username);
        return !!owner && canViewProfile(viewer, owner) &&
            canViewContent(viewer, owner.username, "posts") &&
            !isBlockedBetween(viewer, owner.username);
    };
    const countViewers = id => sessions.get(id)?.viewers.size || 0;
    const publicComments = comments => (comments || []).slice(-30).map(comment => ({
        ...comment,
        role: roleOf(users().find(user => user.username === comment.username))
    }));
    const publicStream = stream => ({
        id: stream.id,
        username: stream.username,
        title: stream.title,
        status: stream.status,
        createdAt: stream.createdAt,
        startedAt: stream.startedAt || null,
        viewerCount: countViewers(stream.id),
        comments: publicComments(stream.comments)
    });
    const isModerationAllowed = (actorName, stream) => {
        if (actorName === stream.username) return true;
        const actor = users().find(user => user.username === actorName);
        const target = users().find(user => user.username === stream.username);
        return !!actor && !!target && canModerateUser(actor, target);
    };
    function endStream(id, actorName, reason = "ended") {
        const list = streams();
        const stream = list.find(item => item.id === id);
        if (!stream || stream.status === "ended") return null;
        stream.status = "ended";
        stream.endedAt = now();
        stream.endReason = reason;
        saveStreams(list);
        const runtime = sessions.get(id);
        io.to(`live:${id}`).emit("live:ended", { streamId: id, reason });
        if (runtime) {
            for (const socketId of runtime.viewers.keys()) {
                const peer = io.sockets.sockets.get(socketId);
                if (peer) peer.leave(`live:${id}`);
            }
            const host = io.sockets.sockets.get(runtime.hostSocketId);
            if (host) host.leave(`live:${id}`);
            sessions.delete(id);
        }
        if (reason === "moderator") {
            appendAudit({
                actorUsername: actorName,
                targetUsername: stream.username,
                actionType: "live_stream_ended",
                targetType: "live_stream",
                targetId: id,
                reason: "Moderator ended live stream."
            });
        }
        return stream;
    }

    // A process restart closes streams whose WebRTC transport no longer exists.
    const startup = streams();
    let startupChanged = false;
    const startupNow = Date.now();
    for (const stream of startup) {
        const stalePreview = stream.status === "preview" &&
            startupNow - Date.parse(stream.createdAt || "") > 24 * 60 * 60 * 1000;
        if (stream.status === "live" || stalePreview) {
            stream.status = "ended";
            stream.endedAt = now();
            stream.endReason = "server-restart";
            startupChanged = true;
        }
    }
    if (startupChanged) saveStreams(startup);

    const commentLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 30,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        keyGenerator: req => `user:${String(currentUser(req) || "").toLowerCase()}`,
        message: { error: "Live şərh limiti dolub. Bir az sonra yenidən cəhd et." }
    });

    app.get("/api/live-streams", requireAuth, (req, res) => {
        const viewer = currentUser(req);
        const result = streams()
            .filter(stream => stream.status === "live" && canWatch(viewer, stream))
            .concat(streams().filter(stream => stream.username === viewer && stream.status === "preview"))
            .map(publicStream)
            .sort((a, b) => String(b.startedAt || b.createdAt).localeCompare(String(a.startedAt || a.createdAt)));
        res.set("Cache-Control", "private, no-store");
        res.json(result);
    });

    app.post("/api/live-streams", requireAuth, (req, res) => {
        const title = String(req.body?.title || "").normalize("NFKC").trim().replace(/\s+/g, " ");
        if (title.length < 3 || title.length > 120)
            return res.status(400).json({ error: "Başlıq 3–120 simvol arasında olmalıdır." });
        if (streams().some(item => item.username === currentUser(req) && ["preview", "live"].includes(item.status)))
            return res.status(409).json({ error: "Əvvəlcə mövcud canlı yayımı bitir." });
        const stream = {
            id: crypto.randomUUID(),
            username: currentUser(req),
            title,
            status: "preview",
            createdAt: now(),
            startedAt: null,
            endedAt: null,
            comments: []
        };
        saveStreams([...streams(), stream].slice(-1000));
        res.status(201).json(publicStream(stream));
    });

    app.delete("/api/live-streams/:id", requireAuth, (req, res) => {
        const list = streams();
        const stream = list.find(item => item.id === req.params.id);
        if (!stream) return res.status(404).json({ error: "Canlı yayım tapılmadı." });
        if (stream.username !== currentUser(req) || stream.status !== "preview")
            return res.status(403).json({ error: "Yalnız öz yayımlanmamış preview-ını silə bilərsən." });
        saveStreams(list.filter(item => item.id !== stream.id));
        sessions.delete(stream.id);
        res.json({ ok: true });
    });

    app.post("/api/live-streams/:id/start", requireAuth, (req, res) => {
        const list = streams();
        const stream = list.find(item => item.id === req.params.id);
        if (!stream) return res.status(404).json({ error: "Canlı yayım tapılmadı." });
        if (stream.username !== currentUser(req) || stream.status !== "preview")
            return res.status(403).json({ error: "Bu canlı yayımı başlatmağa icazən yoxdur." });
        const runtime = sessions.get(stream.id);
        if (!runtime || !io.sockets.sockets.has(runtime.hostSocketId))
            return res.status(409).json({ error: "Canlı yayım bağlantısı hazır deyil. Yenidən cəhd et." });
        stream.status = "live";
        stream.startedAt = now();
        saveStreams(list);
        io.to(`live:${stream.id}`).emit("live:started", publicStream(stream));
        res.json(publicStream(stream));
    });

    app.post("/api/live-streams/:id/end", requireAuth, (req, res) => {
        const stream = findStream(req.params.id);
        if (!stream) return res.status(404).json({ error: "Canlı yayım tapılmadı." });
        const actorName = currentUser(req);
        if (!isModerationAllowed(actorName, stream))
            return res.status(403).json({ error: "Bu canlı yayımı bitirmək üçün icazən yoxdur." });
        const reason = actorName === stream.username ? "owner-ended" : "moderator";
        const ended = endStream(stream.id, actorName, reason);
        if (!ended) return res.status(409).json({ error: "Canlı yayım artıq bitib." });
        res.json({ ok: true, endedAt: ended.endedAt });
    });

    app.get("/api/live-streams/:id/comments", requireAuth, (req, res) => {
        const stream = findStream(req.params.id);
        if (!stream || !["live", "preview"].includes(stream.status) ||
            (stream.username !== currentUser(req) && !canWatch(currentUser(req), stream)))
            return res.status(404).json({ error: "Canlı yayım tapılmadı." });
        res.set("Cache-Control", "private, no-store");
        res.json((stream.comments || []).slice(-100).map(comment => ({
            ...comment,
            role: roleOf(users().find(user => user.username === comment.username))
        })));
    });

    app.post("/api/live-streams/:id/comments", requireAuth, commentLimiter, (req, res) => {
        const list = streams();
        const stream = list.find(item => item.id === req.params.id);
        const author = currentUser(req);
        if (!stream || stream.status !== "live" ||
            (stream.username !== author && !canWatch(author, stream)))
            return res.status(404).json({ error: "Canlı yayım aktiv deyil və ya görünmür." });
        const text = String(req.body?.text || "").normalize("NFKC").trim().slice(0, COMMENT_LIMIT);
        if (!text) return res.status(400).json({ error: "Şərh boş ola bilməz." });
        const normalized = text.toLowerCase().replace(/\s+/g, " ");
        const repeated = (stream.comments || []).some(comment =>
            comment.username === author && comment.text.toLowerCase().replace(/\s+/g, " ") === normalized &&
            Date.now() - Date.parse(comment.createdAt) < 30_000
        );
        if (repeated) return res.status(429).json({ error: "Eyni şərhi qısa vaxtda təkrar göndərmə." });
        const comment = { id: crypto.randomUUID(), username: author, text, createdAt: now() };
        stream.comments = [...(stream.comments || []), comment].slice(-MAX_COMMENTS);
        saveStreams(list);
        const publicComment = { ...comment, role: roleOf(users().find(user => user.username === author)) };
        io.to(`live:${stream.id}`).emit("live:comment", publicComment);
        res.status(201).json(publicComment);
    });

    app.delete("/api/live-streams/:id/comments/:commentId", requireAuth, (req, res) => {
        const list = streams();
        const stream = list.find(item => item.id === req.params.id);
        if (!stream) return res.status(404).json({ error: "Canlı yayım tapılmadı." });
        const index = (stream.comments || []).findIndex(item => item.id === req.params.commentId);
        if (index < 0) return res.status(404).json({ error: "Şərh tapılmadı." });
        const comment = stream.comments[index];
        const actor = currentUser(req);
        const actorUser = users().find(user => user.username === actor);
        const commentAuthor = users().find(user => user.username === comment.username);
        const canDelete = actor === comment.username || actor === stream.username ||
            (!!actorUser && !!commentAuthor && canModerateUser(actorUser, commentAuthor));
        if (!canDelete) return res.status(403).json({ error: "Bu şərhi silməyə icazən yoxdur." });
        stream.comments.splice(index, 1);
        saveStreams(list);
        if (actor !== comment.username) appendAudit({
            actorUsername: actor,
            targetUsername: comment.username,
            actionType: "live_comment_deleted",
            targetType: "live_comment",
            targetId: comment.id,
            reason: "Live stream comment moderation."
        });
        io.to(`live:${stream.id}`).emit("live:comment-deleted", { streamId: stream.id, commentId: comment.id });
        res.json({ ok: true });
    });

    io.on("connection", socket => {
        const username = socket.request.session?.username;
        if (!username) return;
        const updateViewerCount = streamId => {
            const runtime = sessions.get(streamId);
            if (runtime) io.to(`live:${streamId}`).emit("live:viewers", { streamId, viewerCount: runtime.viewers.size });
        };
        socket.on("live:host", (data, ack) => {
            const stream = typeof data?.streamId === "string" ? findStream(data.streamId) : null;
            if (!stream || stream.username !== username || stream.status !== "preview")
                return typeof ack === "function" && ack({ ok: false, error: "Preview yayıma hazır deyil." });
            const current = sessions.get(stream.id);
            if (current && current.hostSocketId !== socket.id)
                return typeof ack === "function" && ack({ ok: false, error: "Başqa cihazda preview açıqdır." });
            sessions.set(stream.id, current || { hostSocketId: socket.id, viewers: new Map() });
            socket.join(`live:${stream.id}`);
            if (typeof ack === "function") ack({ ok: true });
        });
        socket.on("live:join", (data, ack) => {
            const stream = typeof data?.streamId === "string" ? findStream(data.streamId) : null;
            const runtime = stream && sessions.get(stream.id);
            if (!stream || stream.status !== "live" || !runtime ||
                !io.sockets.sockets.has(runtime.hostSocketId) ||
                stream.username === username || !canWatch(username, stream))
                return typeof ack === "function" && ack({ ok: false, error: "Bu canlı yayıma qoşulmaq mümkün deyil." });
            if (!runtime.viewers.has(socket.id) && runtime.viewers.size >= MAX_VIEWERS)
                return typeof ack === "function" && ack({ ok: false, error: "Bu yayım maksimum 10 izləyici üçündür." });
            runtime.viewers.set(socket.id, username);
            socket.join(`live:${stream.id}`);
            socket.emit("live:joined", publicStream(stream));
            io.to(runtime.hostSocketId).emit("live:viewer-joined", { streamId: stream.id, viewerSocketId: socket.id, username });
            updateViewerCount(stream.id);
            if (typeof ack === "function") ack({ ok: true, stream: publicStream(stream) });
        });
        socket.on("live:signal", data => {
            if (typeof data?.streamId !== "string" || typeof data?.to !== "string" ||
                !validateSignal(data.signal)) return;
            const stream = findStream(data.streamId);
            const runtime = stream && sessions.get(stream.id);
            if (!stream || stream.status !== "live" || !runtime) return;
            let recipient = null;
            if (socket.id === runtime.hostSocketId && username === stream.username &&
                runtime.viewers.has(data.to)) {
                recipient = data.to;
            } else if (runtime.viewers.has(socket.id) && data.to === runtime.hostSocketId &&
                runtime.viewers.get(socket.id) === username) {
                recipient = runtime.hostSocketId;
            }
            const target = recipient && io.sockets.sockets.get(recipient);
            if (target) target.emit("live:signal", { streamId: stream.id, from: socket.id, signal: data.signal });
        });
        socket.on("live:leave", data => {
            const id = typeof data?.streamId === "string" ? data.streamId : "";
            const stream = id && findStream(id);
            const runtime = id && sessions.get(id);
            if (!stream || !runtime) return;
            if (socket.id === runtime.hostSocketId && stream.username === username) {
                if (stream.status === "live") endStream(id, username, "host-disconnected");
                else {
                    sessions.delete(id);
                    socket.leave(`live:${id}`);
                }
                return;
            }
            if (runtime.viewers.delete(socket.id)) {
                socket.leave(`live:${id}`);
                io.to(runtime.hostSocketId).emit("live:viewer-left", { streamId: id, viewerSocketId: socket.id });
                updateViewerCount(id);
            }
        });
        socket.on("disconnect", () => {
            for (const [id, runtime] of sessions) {
                const stream = findStream(id);
                if (runtime.hostSocketId === socket.id) {
                    if (stream?.status === "live") endStream(id, username, "host-disconnected");
                    else sessions.delete(id);
                } else if (runtime.viewers.delete(socket.id)) {
                    io.to(runtime.hostSocketId).emit("live:viewer-left", { streamId: id, viewerSocketId: socket.id });
                    updateViewerCount(id);
                }
            }
        });
    });
}

module.exports = { installLiveStreams };
