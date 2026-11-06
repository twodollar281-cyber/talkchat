"use strict";

const { randomUUID } = require("node:crypto");
const MAX_SIGNAL_BYTES = 256 * 1024;
const MAX_SDP_CHARS = 200 * 1024;

function validText(value, max = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function validateSignal(signal, maxBytes = MAX_SIGNAL_BYTES) {
  if (!signal || typeof signal !== "object" || Array.isArray(signal)) return false;
  let encoded;
  try { encoded = JSON.stringify(signal); } catch { return false; }
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) return false;
  const keys = Object.keys(signal);
  if (keys.length !== 1) return false;
  if (keys[0] === "description") {
    const d = signal.description;
    return !!d && typeof d === "object" &&
      (d.type === "offer" || d.type === "answer") &&
      typeof d.sdp === "string" && d.sdp.length <= MAX_SDP_CHARS;
  }
  if (keys[0] === "candidate") {
    const c = signal.candidate;
    return !!c && typeof c === "object" &&
      typeof c.candidate === "string" && c.candidate.length <= 8192;
  }
  return (keys[0] === "muted" || keys[0] === "screen" || keys[0] === "camera") &&
    typeof signal[keys[0]] === "boolean";
}

function createCallRegistry(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const idFactory = typeof options.idFactory === "function" ? options.idFactory : randomUUID;
  const calls = new Map();
  const byUser = new Map();

  function snapshot(call) { return call ? { ...call } : null; }
  function find(input = {}) {
    const actor = input.actor;
    if (!validText(actor)) return null;
    const id = validText(input.callId) ? input.callId : byUser.get(actor);
    const call = id && calls.get(id);
    if (!call || (input.conversationId && call.conversationId !== input.conversationId)) return null;
    if (actor !== call.caller && actor !== call.callee) return null;
    return call;
  }
  function remove(call, actor, reason) {
    const ended = { ...call, status: "ended", endedAt: now(), endReason: reason || "ended" };
    calls.delete(call.id);
    if (byUser.get(call.caller) === call.id) byUser.delete(call.caller);
    if (byUser.get(call.callee) === call.id) byUser.delete(call.callee);
    return { ok: true, call: ended, peer: actor === call.caller ? call.callee : call.caller };
  }

  return {
    invite({ conversationId, caller, callee, mediaType = "audio" } = {}) {
      if (!validText(conversationId) || !validText(caller) || !validText(callee) || caller === callee) return { ok: false, code: "invalid-call" };
      if (mediaType !== "audio" && mediaType !== "video") return { ok: false, code: "invalid-media-type" };
      if (byUser.has(caller) || byUser.has(callee)) return { ok: false, code: "busy" };
      const id = idFactory();
      if (!validText(id) || calls.has(id)) return { ok: false, code: "id-unavailable" };
      const call = { id, conversationId, caller, callee, mediaType, status: "ringing", createdAt: now(), acceptedAt: null };
      calls.set(id, call);
      byUser.set(caller, id);
      byUser.set(callee, id);
      return { ok: true, call: snapshot(call) };
    },
    accept(input = {}) {
      const call = find(input);
      if (!call) return { ok: false, code: "not-found" };
      if (input.actor !== call.callee) return { ok: false, code: "not-recipient" };
      if (call.status !== "ringing") return { ok: false, code: "invalid-state" };
      call.status = "active";
      call.acceptedAt = now();
      return { ok: true, call: snapshot(call) };
    },
    reject(input = {}) {
      const call = find(input);
      if (!call) return { ok: false, code: "not-found" };
      if (input.actor !== call.callee) return { ok: false, code: "not-recipient" };
      if (call.status !== "ringing") return { ok: false, code: "invalid-state" };
      return remove(call, input.actor, "rejected");
    },
    signal(input = {}) {
      const call = find(input);
      if (!call) return { ok: false, code: "not-found" };
      if (call.status !== "active") return { ok: false, code: "invalid-state" };
      if (!validateSignal(input.signal)) return { ok: false, code: "invalid-signal" };
      return { ok: true, call: snapshot(call), peer: input.actor === call.caller ? call.callee : call.caller };
    },
    end(input = {}) {
      const call = find(input);
      if (!call) return { ok: false, code: "not-found" };
      return remove(call, input.actor, input.reason);
    },
    findForUser(actor, conversationId) {
      return snapshot(find({ actor, conversationId }));
    },
    get size() { return calls.size; }
  };
}

module.exports = { createCallRegistry, validateSignal };
