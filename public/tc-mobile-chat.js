(() => {
  const root = document.documentElement;
  const page = () => document.getElementById("messagesPage");
  const app = () => document.getElementById("app");

  const syncViewport = () => {
    const viewportHeight = window.visualViewport?.height || window.innerHeight || root.clientHeight;
    root.style.setProperty("--tc-vv-height", Math.round(viewportHeight) + "px");
    const messages = page();
    const shell = app();
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const chatOpen = !!messages?.classList.contains("tc-chat-open");
    const composerFocused = document.activeElement?.id === "dmText";
    const keyboardOpen = mobile && chatOpen && composerFocused;
    messages?.classList.toggle("tc-keyboard-open", keyboardOpen);
    shell?.classList.toggle("tc-keyboard-open", keyboardOpen);
  };

  const scheduleSync = () => window.requestAnimationFrame(syncViewport);
  document.addEventListener("focusin", event => {
    if (event.target?.id === "dmText") scheduleSync();
  });
  document.addEventListener("focusout", event => {
    if (event.target?.id === "dmText") window.setTimeout(scheduleSync, 120);
  });
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("#tcMobileBack, .bottom-nav, [data-page]")) window.setTimeout(scheduleSync, 0);
  });
  window.addEventListener("resize", scheduleSync, { passive: true });
  window.addEventListener("orientationchange", scheduleSync, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleSync, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleSync, { passive: true });
  syncViewport();
})();
