"use strict";

const OWNER_USERNAME = "DevQrxyz";
const ROLE_LEVEL = Object.freeze({ member: 0, moderator: 1, admin: 2, owner: 3 });
const ASSIGNABLE_ROLES = new Set(["member", "moderator", "admin"]);

function roleOf(user) {
  if (!user) return "member";
  if (user.username === OWNER_USERNAME && user.role === "owner" && user.ownerVerifiedAt) return "owner";
  return Object.prototype.hasOwnProperty.call(ROLE_LEVEL, user.role) && user.role !== "owner"
    ? user.role
    : "member";
}

function canAssignRole(actor, target, desiredRole) {
  return roleOf(actor) === "owner" &&
    !!target &&
    target.username !== actor.username &&
    target.username !== OWNER_USERNAME &&
    ASSIGNABLE_ROLES.has(desiredRole);
}

function canModerateUser(actor, target) {
  const actorRole = roleOf(actor);
  const targetRole = roleOf(target);
  return ROLE_LEVEL[actorRole] >= ROLE_LEVEL.moderator &&
    !!target &&
    target.username !== actor.username &&
    targetRole !== "owner" &&
    ROLE_LEVEL[targetRole] < ROLE_LEVEL[actorRole];
}

function normalizeBanDuration(value) {
  if (value === "permanent") return null;
  if (value === "24h") return 24 * 60 * 60 * 1000;
  if (value === "2d") return 2 * 24 * 60 * 60 * 1000;
  if (value === "3d") return 3 * 24 * 60 * 60 * 1000;
  return undefined;
}

function objectKey(record, pathField, fallbackField) {
  if (!record) return "";
  const key = record[pathField] || record[fallbackField] || "";
  if (typeof key !== "string") return "";
  if (key.startsWith("/uploads/")) return key.slice("/uploads/".length);
  return key;
}

module.exports = {
  OWNER_USERNAME,
  ROLE_LEVEL,
  roleOf,
  canAssignRole,
  canModerateUser,
  normalizeBanDuration,
  objectKey
};
