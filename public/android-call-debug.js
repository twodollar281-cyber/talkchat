(() => {
  "use strict";
  const capacitor = window.Capacitor;
  const platform = typeof capacitor?.getPlatform === "function" ? capacitor.getPlatform() : "web";
  if (platform !== "android" || window.__tccAndroidCallDebugLoaded) return;
  window.__tccAndroidCallDebugLoaded = true;

  const plugin = () => window.Capacitor?.Plugins?.CallService;
  const detailText = detail => {
    try { return JSON.stringify(detail || {}).slice(0, 700); }
    catch { return "{}"; }
  };
  const log = (stage, detail = {}) => {
    const text = detailText(detail);
    console.info("[TalkChatCallDebug]", stage, text);
    try {
      const nativePlugin = plugin();
      if (nativePlugin?.logCallDiagnostic)
        Promise.resolve(nativePlugin.logCallDiagnostic({ stage: String(stage).slice(0, 60), detail: text }))
          .catch(error => console.warn("[TalkChatCallDebug] native log failed", error?.message || error));
    } catch (error) {
      console.warn("[TalkChatCallDebug] native log failed", error?.message || error);
    }
  };

  window.TalkChatAndroidCallDebug = {
    enabled: true,
    log,
    async requestMediaPermissions(mode, callType = "direct") {
      const nativePlugin = plugin();
      const cameraRequired = mode === "video";
      log("PERMISSION", {
        callType, mode, secureContext: window.isSecureContext,
        mediaDevices: !!navigator.mediaDevices,
        getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
        pluginAvailable: !!nativePlugin,
        requestCallPermissionsAvailable: typeof nativePlugin?.requestCallPermissions === "function"
      });
      if (!nativePlugin?.requestCallPermissions) {
        log("PERMISSION_BRIDGE_MISSING", { callType, fallback: "WebView getUserMedia" });
        return;
      }
      try {
        const result = await nativePlugin.requestCallPermissions({ camera: cameraRequired });
        log("PERMISSION_RESULT", {
          callType, microphone: result?.microphone === true,
          camera: cameraRequired ? result?.camera === true : "not_requested"
        });
        if (result?.microphone !== true || (cameraRequired && result?.camera !== true)) {
          const error = new Error("Mikrofon və ya kamera icazəsi verilmədi.");
          error.name = "NotAllowedError";
          throw error;
        }
      } catch (error) {
        log("PERMISSION_ERROR", { callType, name: error?.name || "Error", message: error?.message || "permission request failed" });
        throw error;
      }
    }
  };

  log("DEBUG_BOOT", {
    platform,
    capacitorNative: typeof capacitor?.isNativePlatform === "function" ? capacitor.isNativePlatform() : null,
    callServiceAvailable: !!plugin(),
    pluginPermissionMethod: typeof plugin()?.requestCallPermissions === "function",
    pluginLogMethod: typeof plugin()?.logCallDiagnostic === "function",
    currentScript: document.currentScript?.src?.split("/").pop() || "",
    directButton: !!document.getElementById("tcCallBtn"),
    videoButton: !!document.getElementById("tcVideoCallBtn"),
    callsGuard: !!window.__tccLoaded,
    groupModuleReady: !!window.TalkChatGroupCalls
  });
  window.addEventListener("load", event => {
    const script = event.target;
    if (script?.tagName === "SCRIPT" && /(?:calls|group-calls)\.js/.test(script.src))
      log("SCRIPT_LOADED", { file: script.src.split("/").pop() });
  }, true);

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("#tcCallBtn, #tcVideoCallBtn");
    if (button) log("BUTTON_CLICK_CAPTURE", { buttonId: button.id || "unknown" });
  }, true);
  window.addEventListener("error", event => log("WEBVIEW_JS_ERROR", {
    message: event.message || "unknown",
    source: event.filename ? event.filename.split("/").pop() : "",
    line: Number(event.lineno) || 0,
    column: Number(event.colno) || 0
  }));
  window.addEventListener("unhandledrejection", event => log("WEBVIEW_UNHANDLED_REJECTION", {
    name: event.reason?.name || "Error",
    message: event.reason?.message || String(event.reason || "unknown")
  }));
  if (typeof socket !== "undefined") {
    socket.on("connect", () => log("SOCKET_CONNECTED"));
    socket.on("disconnect", reason => log("SOCKET_DISCONNECTED", { reason: String(reason || "") }));
  }
})();
