"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallRegistry, validateSignal } = require("../call-registry");

function makeRegistry() {
  let id = 0;
  let time = 1000;
  return createCallRegistry({ idFactory: () => "call-" + (++id), now: () => ++time });
}

test("invites bind both users and reject busy participants", () => {
  const registry = makeRegistry();
  const first = registry.invite({ conversationId: "dm-1", caller: "aqil", callee: "leyla", mediaType: "video" });
  assert.equal(first.ok, true);
  assert.equal(first.call.mediaType, "video");
  assert.equal(first.call.status, "ringing");
  assert.equal(registry.invite({ conversationId: "dm-2", caller: "other", callee: "leyla" }).code, "busy");
  assert.equal(registry.findForUser("aqil", "dm-1").id, first.call.id);
});

test("only the callee can accept or reject and legacy conversation lookup works", () => {
  const registry = makeRegistry();
  const first = registry.invite({ conversationId: "dm-1", caller: "aqil", callee: "leyla" }).call;
  assert.equal(registry.accept({ callId: first.id, conversationId: "dm-1", actor: "aqil" }).code, "not-recipient");
  assert.equal(registry.reject({ callId: first.id, conversationId: "dm-1", actor: "stranger" }).code, "not-found");
  const accepted = registry.accept({ conversationId: "dm-1", actor: "leyla" });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.call.status, "active");
  assert.equal(registry.reject({ callId: first.id, conversationId: "dm-1", actor: "leyla" }).code, "invalid-state");
});

test("signals require an active call, a participant, and a bounded supported payload", () => {
  const registry = makeRegistry();
  const call = registry.invite({ conversationId: "dm-1", caller: "aqil", callee: "leyla" }).call;
  const offer = { description: { type: "offer", sdp: "v=0" } };
  assert.equal(registry.signal({ callId: call.id, actor: "aqil", signal: offer }).code, "invalid-state");
  registry.accept({ callId: call.id, actor: "leyla" });
  assert.equal(registry.signal({ callId: call.id, actor: "aqil", signal: offer }).peer, "leyla");
  assert.equal(registry.signal({ callId: call.id, actor: "stranger", signal: offer }).code, "not-found");
  assert.equal(validateSignal({ description: { type: "answer", sdp: "v=0" } }), true);
  assert.equal(validateSignal({ muted: "yes" }), false);
  assert.equal(validateSignal({ description: { type: "offer", sdp: "x".repeat(210000) } }), false);
});

test("ending clears both participants and is idempotent", () => {
  const registry = makeRegistry();
  const call = registry.invite({ conversationId: "dm-1", caller: "aqil", callee: "leyla" }).call;
  const ended = registry.end({ callId: call.id, actor: "aqil", reason: "ended" });
  assert.equal(ended.ok, true);
  assert.equal(ended.peer, "leyla");
  assert.equal(ended.call.status, "ended");
  assert.equal(registry.findForUser("aqil"), null);
  assert.equal(registry.findForUser("leyla"), null);
  assert.equal(registry.end({ callId: call.id, actor: "leyla" }).code, "not-found");
});
