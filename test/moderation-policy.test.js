"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  roleOf,
  canAssignRole,
  canModerateUser,
  normalizeBanDuration,
  objectKey
} = require("../moderationPolicy");

const owner = { username: "DevQrxyz", role: "owner", ownerVerifiedAt: "verified" };

test("only the verified DevQrxyz account is Owner", () => {
  assert.equal(roleOf(owner), "owner");
  assert.equal(roleOf({ username: "first-user", role: "owner", ownerVerifiedAt: "verified" }), "member");
  assert.equal(roleOf({ username: "DevQrxyz", role: "owner" }), "member");
});

test("only Owner can assign roles and cannot promote self or another Owner", () => {
  assert.equal(canAssignRole(owner, { username: "member" }, "admin"), true);
  assert.equal(canAssignRole(owner, { username: "member" }, "moderator"), true);
  assert.equal(canAssignRole(owner, { username: "member" }, "owner"), false);
  assert.equal(canAssignRole(owner, owner, "admin"), false);
  assert.equal(canAssignRole({ username: "admin", role: "admin" }, { username: "member" }, "moderator"), false);
});

test("moderation follows strict role hierarchy and excludes self", () => {
  assert.equal(canModerateUser({ username: "mod", role: "moderator" }, { username: "member" }), true);
  assert.equal(canModerateUser({ username: "mod", role: "moderator" }, { username: "admin", role: "admin" }), false);
  assert.equal(canModerateUser(owner, { username: "admin", role: "admin" }), true);
  assert.equal(canModerateUser(owner, owner), false);
});

test("ban durations and legacy upload paths normalize safely", () => {
  assert.equal(normalizeBanDuration("permanent"), null);
  assert.equal(normalizeBanDuration("24h"), 24 * 60 * 60 * 1000);
  assert.equal(normalizeBanDuration("2d"), 2 * 24 * 60 * 60 * 1000);
  assert.equal(normalizeBanDuration("3d"), 3 * 24 * 60 * 60 * 1000);
  assert.equal(normalizeBanDuration("5d"), undefined);
  assert.equal(objectKey({ url: "/uploads/file.png" }, "storagePath", "url"), "file.png");
  assert.equal(objectKey({ storagePath: "folder/file.png" }, "storagePath", "url"), "folder/file.png");
});
