"use strict";

function redactReplyPreviews(messages, deletedMessage) {
  if (!Array.isArray(messages) || !deletedMessage || !deletedMessage.id) return;
  for (const reply of messages) {
    if (reply && reply.replyTo === deletedMessage.id) {
      reply.replyPreview = { from: deletedMessage.from, text: "Mesaj silindi" };
    }
  }
}

function removeBlockedFollower(self, blockedUsername) {
  if (!self || typeof blockedUsername !== "string" || !blockedUsername) return;
  self.followers = (Array.isArray(self.followers) ? self.followers : [])
    .filter(username => username !== blockedUsername);
}

function prepareForwardMedia(source, { normalizeGifPayload, findSticker }) {
  const message = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const hasGif = message.gif !== undefined && message.gif !== null;
  const gif = hasGif ? normalizeGifPayload(message.gif) : null;
  if (hasGif && !gif) return { error: "gif" };

  const hasSticker = message.sticker !== undefined && message.sticker !== null;
  const stickerData = message.sticker;
  const sticker = hasSticker && stickerData && typeof stickerData === "object" && !Array.isArray(stickerData)
    ? findSticker(stickerData.id)
    : null;
  if (hasSticker && !sticker) return { error: "sticker" };

  const storedPath = typeof message.attachmentStoragePath === "string" ? message.attachmentStoragePath : "";
  const legacyPath = typeof message.attachment === "string" && message.attachment.startsWith("/uploads/")
    ? message.attachment.slice("/uploads/".length)
    : "";
  const rawPath = storedPath || legacyPath;
  if ((gif && sticker) || (gif && rawPath) || (sticker && rawPath)) {
    return { error: "multiple-media" };
  }
  return { gif, sticker, rawPath };
}

module.exports = { redactReplyPreviews, removeBlockedFollower, prepareForwardMedia };
