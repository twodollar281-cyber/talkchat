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
