"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGroupCallRegistry } = require("../group-call-registry");

function makeRegistry() {
  let id = 0;
  const clock = { value: 10_000 };
  const registry = createGroupCallRegistry({
    idFactory: () => "group-call-" + (++id),
    now: () => clock.value,
    maxParticipants: 3
  });
  registry.advanceTo = value => { clock.value = value; };
  return registry;
}

test("group call state records real participants and prevents duplicate joins", () => {
  const registry = makeRegistry();
  const started = registry.start({
    conversationId: "group-1",
    username: "nuran",
    mediaType: "video",
    account: { displayName: "Nuran", avatar: "https://cdn.example/avatar.jpg", role: "member" }
  });
  assert.equal(started.ok, true);
  assert.equal(started.call.mediaType, "video");
  assert.equal(started.call.participants[0].username, "nuran");
  assert.equal(started.call.participants[0].avatar, "https://cdn.example/avatar.jpg");

  assert.equal(registry.join({ conversationId: "group-1", username: "nuran" }).alreadyJoined, true);
  assert.equal(registry.get("group-1").participants.filter(p => p.status === "joined").length, 1);
  assert.equal(registry.join({ conversationId: "group-2", username: "nuran" }).code, "not-found");
  assert.equal(registry.start({ conversationId: "group-2", username: "nuran" }).code, "busy");
});

test("a declined group invite stays active and can be joined later exactly once", () => {
  const registry = makeRegistry();
  registry.start({ conversationId: "group-1", username: "aqil" });
  const declined = registry.decline({ conversationId: "group-1", username: "meh" });
  assert.equal(declined.ok, true);
  assert.deepEqual(declined.call.declined, ["meh"]);
  assert.equal(declined.call.status, "active");

  const joined = registry.join({ conversationId: "group-1", username: "meh" });
  assert.equal(joined.ok, true);
  assert.equal(joined.alreadyJoined, false);
  assert.equal(joined.call.declined.length, 0);
  assert.equal(registry.join({ conversationId: "group-1", username: "meh" }).alreadyJoined, true);
  assert.equal(joined.call.participants.filter(p => p.status === "joined").length, 2);
});

test("self mute and moderator mute are server-state changes with authorization checks", () => {
  const registry = makeRegistry();
  registry.start({
    conversationId: "group-1",
    username: "mod",
    account: { role: "moderator" }
  });
  registry.join({
    conversationId: "group-1",
    username: "member",
    account: { role: "member" }
  });

  assert.equal(registry.setModeratorMuted({
    conversationId: "group-1", actor: "mod", target: "member", muted: true
  }).code, "not-authorized");
  const muted = registry.setModeratorMuted({
    conversationId: "group-1", actor: "mod", target: "member", muted: true, authorized: true
  });
  assert.equal(muted.ok, true);
  assert.equal(muted.call.participants.find(p => p.username === "member").moderatorMuted, true);
  assert.equal(registry.setSelfMuted({
    conversationId: "group-1", username: "member", muted: false
  }).code, "moderator-muted");
  const unmuted = registry.setModeratorMuted({
    conversationId: "group-1", actor: "mod", target: "member", muted: false, authorized: true
  });
  assert.equal(unmuted.call.participants.find(p => p.username === "member").moderatorMuted, false);
  assert.equal(registry.setSelfMuted({
    conversationId: "group-1", username: "member", muted: false
  }).ok, true);
});

test("leave and end retain exact end time, duration, and idempotence", () => {
  const registry = makeRegistry();
  registry.start({ conversationId: "group-1", username: "aqil" });
  registry.join({ conversationId: "group-1", username: "nuran" });
  registry.advanceTo(12_500);
  const first = registry.leave({ conversationId: "group-1", username: "aqil" });
  assert.equal(first.ended, false);
  registry.advanceTo(15_000);
  const ended = registry.leave({ conversationId: "group-1", username: "nuran" });
  assert.equal(ended.ended, true);
  assert.equal(ended.call.endedAt, 15_000);
  assert.equal(ended.call.durationSeconds, 5);
  assert.equal(ended.call.endReason, "left");
  assert.equal(registry.get("group-1"), null);
  assert.equal(registry.leave({ conversationId: "group-1", username: "nuran" }).code, "not-participant");
});

test("disconnected members reserve the same session only during the reconnect grace", () => {
  const registry = makeRegistry();
  registry.start({ conversationId: "group-1", username: "aqil" });
  registry.join({ conversationId: "group-1", username: "meh" });
  const lost = registry.leave({
    conversationId: "group-1", username: "aqil", reason: "disconnected", keepIfEmpty: true
  });
  assert.equal(lost.empty, false);
  assert.equal(registry.hasUser("aqil"), true);
  assert.equal(registry.join({ conversationId: "group-1", username: "aqil" }).alreadyJoined, false);
  assert.equal(registry.get("group-1").participants.find(p => p.username === "aqil").status, "joined");
});
