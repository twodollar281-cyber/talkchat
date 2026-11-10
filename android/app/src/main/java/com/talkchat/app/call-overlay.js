/* TalkChat native call overlay bridge. Uses the existing Capacitor CallService plugin. */
(() => {
  "use strict";
  if (window.TalkChatCallOverlay) return;

  const plugin = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CallService;
  const state = { active: false, lastUpdate: 0, pending: null, latest: null, timer: null, listenerReady: false };

  function emitAction(action) {
    window.dispatchEvent(new CustomEvent("talkchat:native-overlay-action", { detail: { action } }));
  }

  async function call(method, data) {
    const native = plugin();
    if (!native || typeof native[method] !== "function") {
      return { supported: false, reason: "native-plugin-unavailable" };
    }
    return native[method](data || {});
  }

  async function permissionGranted() {
    try {
      const result = await call("checkOverlayPermission");
      return !!(result && result.granted);
    } catch (_) { return false; }
  }

  async function requestPermission() {
    try {
      const result = await call("requestOverlayPermission");
      return !!(result && result.granted);
    } catch (error) {
      console.warn("TalkChat overlay permission could not be opened:", error);
      return false;
    }
  }

  function normalize(payload) {
    const data = payload && typeof payload === "object" ? payload : {};
    return {
      title: String(data.title || "TalkChat zəngi").slice(0, 100),
      mediaType: data.mediaType === "video" ? "video" : "audio",
      isGroup: data.isGroup === true,
      micMuted: data.micMuted === true,
      cameraOn: data.cameraOn === true,
      durationSeconds: Math.max(0, Math.floor(Number(data.durationSeconds) || 0)),
      participants: Array.isArray(data.participants) ? data.participants.slice(0, 8).map(person => ({
        username: String(person && person.username || "").slice(0, 64),
        displayName: String(person && (person.displayName || person.username) || "İştirakçı").slice(0, 64),
        avatar: typeof (person && person.avatar) === "string" ? person.avatar.slice(0, 2048) : "",
        muted: person && person.muted === true,
        moderatorMuted: person && person.moderatorMuted === true
      })).filter(person => person.username) : [],
      speakers: Array.isArray(data.speakers) ? [...new Set(data.speakers.map(String))].slice(0, 8) : []
    };
  }

  async function start(payload) {
    state.active = true;
    const granted = await permissionGranted();
    if (!granted) {
      emitAction("overlayPermissionRequired");
      return { shown: false, permissionRequired: true };
    }
    const data = normalize(payload);
    state.latest = data;
    try { await call("showOverlay", data); }
    catch (error) { console.warn("TalkChat overlay could not be shown:", error); return { shown: false, error }; }
    state.lastUpdate = Date.now();
    return { shown: true };
  }

  function update(payload, force) {
    if (!state.active) return;
    const now = Date.now();
    if (!force && now - state.lastUpdate < 320) {
      state.pending = payload;
      if (!state.timer) {
        state.timer = setTimeout(() => {
          state.timer = null;
          if (state.pending) update(state.pending, true);
          state.pending = null;
        }, 330);
      }
      return;
    }
    state.lastUpdate = now;
    const data = normalize(payload);
    state.latest = data;
    call("updateOverlay", data).catch(error => console.warn("TalkChat overlay update failed:", error));
  }

  async function enableFromMenu(payload) {
    state.active = true;
    state.latest = normalize(payload);
    if (await permissionGranted()) {
      await call("showOverlay", state.latest);
      return { shown: true };
    }
    return requestPermission();
  }

  async function stop() {
    state.active = false;
    state.pending = null;
    state.latest = null;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    try { await call("hideOverlay"); } catch (_) {}
  }

  function init() {
    if (state.listenerReady) return;
    const native = plugin();
    if (!native || typeof native.addListener !== "function") return;
    state.listenerReady = true;
    native.addListener("overlayAction", event => {
      if (!event || typeof event.action !== "string") return;
      if (event.action === "hide") {
        state.active = false;
        state.latest = null;
        state.pending = null;
      }
      emitAction(event.action);
    }).catch(error => {
      state.listenerReady = false;
      console.warn("TalkChat overlay action listener failed:", error);
    });
  }

  window.TalkChatCallOverlay = {
    init,
    start,
    update,
    stop,
    requestPermission,
    enableFromMenu,
    permissionGranted,
    isActive: () => state.active
  };

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || !state.active || !state.latest) return;
    if (await permissionGranted()) {
      try { await call("showOverlay", state.latest); } catch (_) {}
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
