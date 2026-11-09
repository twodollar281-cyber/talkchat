"use strict";

const crypto = require("crypto");

function installSavedCollections(deps) {
    const {
        app, posts, readJSON, saveJSON, requireAuth, currentUser,
        canViewContent, isBlockedBetween, publicPost
    } = deps;
    const readAll = () => {
        const value = readJSON("savedCollections.json", {});
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    };
    const collectionsFor = username => {
        const all = readAll();
        return Array.isArray(all[username]) ? all[username] : [];
    };
    const saveFor = (username, list) => {
        const all = readAll();
        all[username] = list;
        saveJSON("savedCollections.json", all);
    };
    const visiblePost = (viewer, post) => !!post &&
        canViewContent(viewer, post.username, "posts") &&
        !isBlockedBetween(viewer, post.username);
    const collectionPayload = (viewer, collection) => {
        const savedIds = Array.isArray(collection.postIds) ? collection.postIds : [];
        const records = posts();
        const visible = savedIds
            .map(id => records.find(post => post.id === id))
            .filter(post => visiblePost(viewer, post))
            .map(post => publicPost(post, undefined, viewer));
        return {
            id: collection.id,
            name: collection.name,
            createdAt: collection.createdAt,
            updatedAt: collection.updatedAt,
            count: visible.length,
            posts: visible
        };
    };
    const findOwned = (username, id) => collectionsFor(username).find(item => item.id === id);
    const noStore = res => res.set("Cache-Control", "private, no-store");

    app.get("/api/collections", requireAuth, (req, res) => {
        const username = currentUser(req);
        noStore(res);
        res.json(collectionsFor(username).map(item => collectionPayload(username, item)));
    });

    app.post("/api/collections", requireAuth, (req, res) => {
        const username = currentUser(req);
        const name = String(req.body?.name || "").normalize("NFKC").trim().replace(/\s+/g, " ");
        if (name.length < 1 || name.length > 60)
            return res.status(400).json({ error: "Kolleksiya adı 1–60 simvol arasında olmalıdır." });
        const list = collectionsFor(username);
        if (list.some(item => item.name.toLowerCase() === name.toLowerCase()))
            return res.status(409).json({ error: "Bu adda kolleksiya artıq mövcuddur." });
        const collection = {
            id: crypto.randomUUID(),
            name,
            postIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        saveFor(username, [...list, collection]);
        res.status(201).json(collectionPayload(username, collection));
    });

    app.patch("/api/collections/:id", requireAuth, (req, res) => {
        const username = currentUser(req);
        const list = collectionsFor(username);
        const collection = list.find(item => item.id === req.params.id);
        if (!collection) return res.status(404).json({ error: "Kolleksiya tapılmadı." });
        const name = String(req.body?.name || "").normalize("NFKC").trim().replace(/\s+/g, " ");
        if (name.length < 1 || name.length > 60)
            return res.status(400).json({ error: "Kolleksiya adı 1–60 simvol arasında olmalıdır." });
        if (list.some(item => item.id !== collection.id && item.name.toLowerCase() === name.toLowerCase()))
            return res.status(409).json({ error: "Bu adda kolleksiya artıq mövcuddur." });
        collection.name = name;
        collection.updatedAt = new Date().toISOString();
        saveFor(username, list);
        res.json(collectionPayload(username, collection));
    });

    app.delete("/api/collections/:id", requireAuth, (req, res) => {
        const username = currentUser(req);
        const list = collectionsFor(username);
        if (!list.some(item => item.id === req.params.id))
            return res.status(404).json({ error: "Kolleksiya tapılmadı." });
        saveFor(username, list.filter(item => item.id !== req.params.id));
        res.json({ ok: true });
    });

    app.post("/api/collections/:id/posts/:postId", requireAuth, (req, res) => {
        const username = currentUser(req);
        const list = collectionsFor(username);
        const collection = list.find(item => item.id === req.params.id);
        if (!collection) return res.status(404).json({ error: "Kolleksiya tapılmadı." });
        const post = posts().find(item => item.id === req.params.postId);
        if (!post || !visiblePost(username, post))
            return res.status(404).json({ error: "Paylaşım tapılmadı və ya ona giriş yoxdur." });
        collection.postIds = Array.isArray(collection.postIds) ? collection.postIds : [];
        if (collection.postIds.includes(post.id))
            return res.status(409).json({ error: "Bu paylaşım kolleksiyada artıq var." });
        collection.postIds.push(post.id);
        collection.updatedAt = new Date().toISOString();
        saveFor(username, list);
        res.status(201).json({ ok: true, collectionId: collection.id, postId: post.id });
    });

    app.delete("/api/collections/:id/posts/:postId", requireAuth, (req, res) => {
        const username = currentUser(req);
        const list = collectionsFor(username);
        const collection = list.find(item => item.id === req.params.id);
        if (!collection) return res.status(404).json({ error: "Kolleksiya tapılmadı." });
        const current = Array.isArray(collection.postIds) ? collection.postIds : [];
        if (!current.includes(req.params.postId))
            return res.status(404).json({ error: "Yadda saxlanmış paylaşım tapılmadı." });
        collection.postIds = current.filter(id => id !== req.params.postId);
        collection.updatedAt = new Date().toISOString();
        saveFor(username, list);
        res.json({ ok: true });
    });
}

module.exports = { installSavedCollections };
