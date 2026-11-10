"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  redactReplyPreviews,
  removeBlockedFollower,
  prepareForwardMedia
} = require("../review-fixes");

const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

test("moderated deletion redacts every linked reply preview", () => {
  const deleted = { id: "message-1", from: "sender", text: "" };
  const replies = [
    { id: "reply-1", replyTo: "message-1", replyPreview: { from: "sender", text: "private message" } },
    { id: "reply-2", replyTo: "message-1", replyPreview: { from: "sender", text: "private message" } },
    { id: "reply-3", replyTo: "another-message", replyPreview: { from: "other", text: "keep this" } }
  ];

  redactReplyPreviews(replies, deleted);

  assert.deepEqual(replies[0].replyPreview, { from: "sender", text: "Mesaj silindi" });
  assert.deepEqual(replies[1].replyPreview, { from: "sender", text: "Mesaj silindi" });
  assert.deepEqual(replies[2].replyPreview, { from: "other", text: "keep this" });
  assert.ok(replies.every(reply => !reply.replyPreview.text.includes("private message")));
});

test("moderated and user deletion paths both redact linked replies", () => {
  const moderationStart = serverSource.indexOf("async function deleteModeratedContent");
  const moderationEnd = serverSource.indexOf("\nfunction reportContent", moderationStart);
  const deletionStart = serverSource.indexOf('app.delete("/api/conversations/:id/messages/:mid"');
  const deletionEnd = serverSource.indexOf("\n// Push bildiriş", deletionStart);

  assert.ok(moderationStart >= 0 && moderationEnd > moderationStart);
  assert.ok(deletionStart >= 0 && deletionEnd > deletionStart);
  assert.match(serverSource.slice(moderationStart, moderationEnd), /redactReplyPreviews\(messageList, message\)/);
  assert.match(serverSource.slice(deletionStart, deletionEnd), /redactReplyPreviews\(list, m\)/);
});

test("blocking removes only the blocked account from the blocker's followers", () => {
  const self = { followers: ["blocked-user", "another-user"] };

  removeBlockedFollower(self, "blocked-user");

  assert.deepEqual(self.followers, ["another-user"]);
});

test("block route keeps existing relationship cleanup and removes the blocked follower", () => {
  const start = serverSource.indexOf('app.post("/api/users/:username/block"');
  const end = serverSource.indexOf('app.delete("/api/users/:username/block"', start);
  const route = serverSource.slice(start, end);

  assert.match(route, /removeBlockedFollower\(self, blockedUser\.username\)/);
  assert.match(route, /self\.following\s*=/);
  assert.match(route, /self\.friends\s*=/);
  assert.match(route, /blockedUser\.followers\s*=/);
  assert.match(route, /blockedUser\.following\s*=/);
  assert.match(route, /blockedUser\.friends\s*=/);
});

test("forwarded GIF and sticker metadata is taken from safe canonicalizers", () => {
  const safeGif = {
    id: "gif-1",
    url: "https://media.giphy.com/media/gif-1/giphy.gif",
    previewUrl: "https://media.giphy.com/media/gif-1/preview.gif",
    title: "GIF"
  };
  const safeSticker = { id: "party", category: "Bayram", emoji: "🎉", label: "Təbriklər!" };
  const normalizeGifPayload = value => value?.safe === true ? safeGif : null;
  const findSticker = id => id === "party" ? safeSticker : null;

  const gif = prepareForwardMedia(
    { gif: { safe: true, url: "https://untrusted.invalid/evil.gif" }, attachment: "https://untrusted.invalid/evil.gif" },
    { normalizeGifPayload, findSticker }
  );
  const sticker = prepareForwardMedia(
    { sticker: { id: "party", emoji: "<script>", label: "untrusted" } },
    { normalizeGifPayload, findSticker }
  );

  assert.deepEqual(gif, { gif: safeGif, sticker: null, rawPath: "" });
  assert.deepEqual(sticker, { gif: null, sticker: safeSticker, rawPath: "" });
});

test("forwarding rejects invalid or conflicting media payloads", () => {
  const normalizeGifPayload = value => value?.safe === true ? { url: "https://media.giphy.com/gif.gif" } : null;
  const findSticker = id => id === "party" ? { id } : null;
  const dependencies = { normalizeGifPayload, findSticker };

  assert.deepEqual(prepareForwardMedia({ gif: { url: "javascript:alert(1)" } }, dependencies), { error: "gif" });
  assert.deepEqual(prepareForwardMedia({ sticker: { id: "unknown" } }, dependencies), { error: "sticker" });
  assert.deepEqual(prepareForwardMedia({
    gif: { safe: true },
    attachmentStoragePath: "upload.gif"
  }, dependencies), { error: "multiple-media" });
});

test("both post-report endpoints use reportLimiter and /api/reports stays protected", () => {
  assert.match(
    serverSource,
    /app\.post\("\/api\/posts\/:id\/report",\s*requireAuth,\s*reportLimiter,/
  );
  assert.match(
    serverSource,
    /app\.post\("\/api\/posts\/:id\/comments\/:commentId\/report",\s*requireAuth,\s*reportLimiter,/
  );
  assert.match(
    serverSource,
    /app\.use\("\/api\/reports",\s*\(req, res, next\) =>\s*req\.method === "POST" \? reportLimiter\(req, res, next\) : next\(\)\);/
  );
});

test("message forwarding keeps source, target, block, and shared-post access checks", () => {
  const start = serverSource.indexOf('app.post("/api/conversations/:id/messages/:mid/forward"');
  const end = serverSource.indexOf('app.post("/api/conversations/:id/read"', start);
  const route = serverSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(route, /sourceConvo = conversations\(\)\.find\(c => c\.id === req\.params\.id && c\.participants\.includes\(me\)\)/);
  assert.match(route, /!source \|\| source\.deleted/);
  assert.match(route, /target = conversations\(\)\.find\(c => c\.id === targetId && c\.id !== sourceConvo\.id && c\.participants\.includes\(me\)\)/);
  assert.match(route, /isBlockedBetween\(me, user\)/);
  assert.match(route, /canViewContent\(user, source\.sharedPost\.username, "posts"\)/);
});

test("direct messages use stable server order for identical timestamps", () => {
  const routeStart = serverSource.indexOf('app.get("/api/conversations/:id/messages"');
  const routeEnd = serverSource.indexOf('app.get("/api/conversations/:id/files"', routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(route, /messages\(\)\s*\.map\(\(message, serverOrder\) => \(\{ message, serverOrder \}\)\)/);
  assert.match(route, /left\.serverOrder - right\.serverOrder/);
  assert.match(route, /serverOrder \}\)/);
  const comparatorBody = route.match(/\.sort\(\(left, right\) => \{\s*([\s\S]*?)\n\s*\}\);/)?.[1];
  assert.ok(comparatorBody);
  const compareServerMessages = new Function("left", "right", comparatorBody);
  const equalTime = "2026-11-10T10:00:00.000Z";
  assert.ok(compareServerMessages(
    { message: { createdAt: equalTime }, serverOrder: 4 },
    { message: { createdAt: equalTime }, serverOrder: 5 }
  ) < 0);
  assert.ok(compareServerMessages(
    { message: { createdAt: "2026-11-10T10:00:01.000Z" }, serverOrder: 2 },
    { message: { createdAt: equalTime }, serverOrder: 99 }
  ) > 0);

  const sortStart = appSource.indexOf("function igSortMessages(messages) {");
  const sortEnd = appSource.indexOf("\n\n/* ----------", sortStart);
  assert.ok(sortStart >= 0 && sortEnd > sortStart);
  const sortMessages = new Function(`${appSource.slice(sortStart, sortEnd)}; return igSortMessages;`)();
  const timestamp = equalTime;
  const ordered = sortMessages([
    { id: "later-in-storage", createdAt: timestamp, serverOrder: 11 },
    { id: "earlier-in-storage", createdAt: timestamp, serverOrder: 10 },
    { id: "newer", createdAt: "2026-11-10T10:00:01.000Z", serverOrder: 12 }
  ]);
  assert.deepEqual(ordered.map(message => message.id), ["earlier-in-storage", "later-in-storage", "newer"]);
});

test("direct-message reaction route validates participants, blocks, emoji, and persists toggles", () => {
  const start = serverSource.indexOf('app.post("/api/conversations/:id/messages/:mid/react"');
  const end = serverSource.indexOf('app.delete("/api/conversations/:id/messages/:mid"', start);
  const route = serverSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /requireAuth/);
  assert.match(route, /participants\.includes\(me\)/);
  assert.match(route, /&& !item\.deleted/);
  assert.match(route, /isBlockedBetween\(me, message\.from\)/);
  assert.match(route, /directMessageReactions\.includes\(emoji\)/);
  assert.match(route, /users\.indexOf\(me\)/);
  assert.match(route, /saveMessages\(list\)/);
  assert.match(route, /emit\("messagesChanged"/);
});

test("private-message edit and delete stay restricted to the sender", () => {
  const editStart = serverSource.indexOf('app.put("/api/conversations/:id/messages/:mid"');
  const reactionStart = serverSource.indexOf('app.post("/api/conversations/:id/messages/:mid/react"', editStart);
  const deleteStart = serverSource.indexOf('app.delete("/api/conversations/:id/messages/:mid"', reactionStart);
  const pushStart = serverSource.indexOf("\n// Push bildiriş", deleteStart);
  const editRoute = serverSource.slice(editStart, reactionStart);
  const deleteRoute = serverSource.slice(deleteStart, pushStart);
  assert.match(editRoute, /m\.from !== me/);
  assert.match(deleteRoute, /m\.from !== me/);
  assert.match(appSource, /message\.from === me && message\.text && !message\.deleted/);
  assert.match(appSource, /message\.from === me && !message\.deleted/);
});

test("message refreshes preserve position and action menu supports press and context menu", () => {
  assert.match(appSource, /if \(d\.conversationId === activeConversation\) igLoadMessages\(true\);/);
  assert.doesNotMatch(appSource, /if \(d\.conversationId === activeConversation\) igLoadMessages\(true, \{ forceBottom: true \}\);/);
  assert.match(appSource, /addEventListener\("pointerdown"/);
  assert.match(appSource, /addEventListener\("contextmenu"/);
  assert.match(appSource, /addEventListener\("keydown"/);
  assert.match(appSource, /igOpenMessageInfo\(m\)/);
  assert.match(appSource, /data-message-react/);
});
