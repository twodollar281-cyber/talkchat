"use strict";

const { randomUUID } = require("node:crypto");

function validText(value, max = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function createGroupCallRegistry(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const idFactory = typeof options.idFactory === "function" ? options.idFactory : randomUUID;
  const maxParticipants = Number.isInteger(options.maxParticipants) && options.maxParticipants > 0
    ? options.maxParticipants
    : 5;
  const calls = new Map();
  const byUser = new Map();

  function activeParticipants(call) {
    return [...call.participants.values()].filter(participant => participant.status === "joined");
  }

  function copyParticipant(participant) {
    return { ...participant };
  }

  function snapshot(call) {
    if (!call) return null;
    return {
      ...call,
      participants: [...call.participants.values()].map(copyParticipant),
      declined: [...call.participants.values()]
        .filter(participant => participant.status === "declined")
        .map(participant => participant.username)
    };
  }

  function removeUserIndex(call, username) {
    if (byUser.get(username) === call.id) byUser.delete(username);
  }

  function endCall(call, reason = "ended") {
    const endedAt = now();
    call.status = "ended";
    call.endedAt = endedAt;
    call.durationSeconds = call.startedAt
      ? Math.max(0, Math.floor((endedAt - call.startedAt) / 1000))
      : 0;
    call.endReason = reason;
    calls.delete(call.conversationId);
    for (const participant of call.participants.values()) removeUserIndex(call, participant.username);
    return snapshot(call);
  }

  function joinOne(call, username, account, status = "joined") {
    const old = call.participants.get(username);
    const participant = {
      ...(old || {}),
      username,
      displayName: String(account?.displayName || old?.displayName || "").slice(0, 100),
      avatar: String(account?.avatar || old?.avatar || "").slice(0, 2048),
      role: String(account?.role || old?.role || "member").slice(0, 32),
      status,
      muted: old?.muted === true,
      moderatorMuted: old?.moderatorMuted === true,
      joinedAt: status === "joined" ? (old?.joinedAt || now()) : (old?.joinedAt || null),
      updatedAt: now()
    };
    call.participants.set(username, participant);
    if (status === "joined" || status === "reconnecting") byUser.set(username, call.id);
    else removeUserIndex(call, username);
    return participant;
  }

  return {
    start({ conversationId, username, mediaType = "audio", account = null } = {}) {
      if (!validText(conversationId) || !validText(username) ||
          !["audio", "video"].includes(mediaType)) return { ok: false, code: "invalid-call" };
      if (calls.has(conversationId)) return { ok: false, code: "already-active" };
      if (byUser.has(username)) return { ok: false, code: "busy" };
      const id = idFactory();
      if (!validText(id) || [...calls.values()].some(call => call.id === id))
        return { ok: false, code: "id-unavailable" };
      const startedAt = now();
      const call = {
        id,
        conversationId,
        mediaType,
        status: "active",
        startedAt,
        endedAt: null,
        durationSeconds: null,
        endReason: null,
        participants: new Map()
      };
      calls.set(conversationId, call);
      joinOne(call, username, account);
      return { ok: true, call: snapshot(call) };
    },

    join({ conversationId, username, account = null } = {}) {
      const call = calls.get(conversationId);
      if (!call || call.status !== "active") return { ok: false, code: "not-found" };
      if (!validText(username)) return { ok: false, code: "invalid-participant" };
      const participant = call.participants.get(username);
      if (participant?.status === "joined") {
        return { ok: true, alreadyJoined: true, call: snapshot(call) };
      }
      const reservedCallId = byUser.get(username);
      if (reservedCallId && reservedCallId !== call.id) return { ok: false, code: "busy" };
      if (activeParticipants(call).length >= maxParticipants) return { ok: false, code: "full" };
      joinOne(call, username, account);
      return { ok: true, alreadyJoined: false, call: snapshot(call) };
    },

    decline({ conversationId, username, account = null } = {}) {
      const call = calls.get(conversationId);
      if (!call || call.status !== "active") return { ok: false, code: "not-found" };
      if (!validText(username)) return { ok: false, code: "invalid-participant" };
      if (call.participants.get(username)?.status === "joined")
        return { ok: false, code: "already-joined" };
      joinOne(call, username, account, "declined");
      return { ok: true, call: snapshot(call) };
    },

    setSelfMuted({ conversationId, username, muted } = {}) {
      const call = calls.get(conversationId);
      const participant = call?.participants.get(username);
      if (!call || call.status !== "active" || participant?.status !== "joined")
        return { ok: false, code: "not-participant" };
      if (typeof muted !== "boolean") return { ok: false, code: "invalid-muted-state" };
      if (participant.moderatorMuted && !muted) return { ok: false, code: "moderator-muted" };
      participant.muted = muted;
      participant.updatedAt = now();
      return { ok: true, call: snapshot(call) };
    },

    setModeratorMuted({ conversationId, actor, target, muted, authorized = false } = {}) {
      const call = calls.get(conversationId);
      const moderator = call?.participants.get(actor);
      const participant = call?.participants.get(target);
      if (!call || call.status !== "active" || moderator?.status !== "joined" ||
          participant?.status !== "joined") return { ok: false, code: "not-participant" };
      if (actor === target) return { ok: false, code: "cannot-mute-self" };
      if (authorized !== true) return { ok: false, code: "not-authorized" };
      if (typeof muted !== "boolean") return { ok: false, code: "invalid-muted-state" };
      participant.moderatorMuted = muted;
      if (muted) participant.muted = true;
      participant.updatedAt = now();
      return { ok: true, call: snapshot(call) };
    },

    leave({ conversationId, username, reason = "left", keepIfEmpty = false } = {}) {
      const call = calls.get(conversationId);
      const participant = call?.participants.get(username);
      if (!call || call.status !== "active" || !participant ||
          !["joined", "reconnecting"].includes(participant.status))
        return { ok: false, code: "not-participant" };
      participant.status = reason === "disconnected" && keepIfEmpty ? "reconnecting" : "left";
      participant.updatedAt = now();
      if (participant.status === "left") removeUserIndex(call, username);
      const remaining = activeParticipants(call).length;
      if (!remaining && !keepIfEmpty) {
        return { ok: true, ended: true, call: endCall(call, reason) };
      }
      return { ok: true, ended: false, empty: remaining === 0, call: snapshot(call) };
    },

    endIfEmpty(conversationId, reason = "disconnected") {
      const call = calls.get(conversationId);
      if (!call || call.status !== "active" || activeParticipants(call).length) return null;
      return endCall(call, reason);
    },

    get(conversationId) {
      return snapshot(calls.get(conversationId));
    },

    findForUser(username) {
      const id = byUser.get(username);
      const call = id && [...calls.values()].find(candidate => candidate.id === id);
      return snapshot(call);
    },

    hasUser(username) {
      return byUser.has(username);
    },

    get size() {
      return calls.size;
    }
  };
}

module.exports = { createGroupCallRegistry };
