"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const direct = read("public/calls.js");
const group = read("public/group-calls.js");

test("direct call signaling does not wait for optional overlay permission", () => {
  const start = direct.slice(
    direct.indexOf("async function startCall(mode"),
    direct.indexOf("function showIncoming")
  );
  assert.doesNotMatch(start, /await\s+requestDirectOverlayPermission/);
  assert.ok(start.indexOf('emit("call:invite"') < start.indexOf("requestDirectOverlayPermission().then"));
  assert.match(start, /getMedia\(mode\)/);
});

test("audio and video buttons route to direct or group call handlers", () => {
  const listener = direct.slice(direct.lastIndexOf('document.addEventListener("click", (e)'));
  assert.match(listener, /#tcCallBtn, #tcVideoCallBtn/);
  assert.match(listener, /btn\.id === "tcVideoCallBtn" \? "video" : "audio"/);
  assert.match(listener, /window\.TalkChatGroupCalls\?\.startCall/);
  assert.match(listener, /startCall\(mode\)\.catch/);
});

test("group calls fail visibly when Socket.IO is disconnected", () => {
  const start = group.slice(group.indexOf("async function startCall(conversationId"), group.indexOf("async function toggleCamera"));
  assert.match(start, /if \(!socket\.connected\) return alert\(tx\("offline"\)\)/);
  assert.match(start, /socket\.emit\("group-call:start"/);
  assert.match(start, /async function joinCall[\s\S]*?if \(!socket\.connected\) return alert\(tx\("offline"\)\)/);
  assert.match(group, /socket\.emit\("group-call:join"/);
});

test("Android keeps the native call plugin and WebView media permissions wired", () => {
  const activity = read("android/app/src/main/java/com/talkchat/app/MainActivity.java");
  const plugin = read("android/app/src/main/java/com/talkchat/app/CallServicePlugin.java");
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(activity, /registerPlugin\(CallServicePlugin\.class\)/);
  assert.match(plugin, /@CapacitorPlugin\(name = "CallService"\)/);
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android\.permission\.CAMERA/);
  assert.match(manifest, /android\.permission\.SYSTEM_ALERT_WINDOW/);
});
