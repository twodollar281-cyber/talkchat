(() => {
  const root = document.documentElement;
  const page = () => document.getElementById("messagesPage");
  const app = () => document.getElementById("app");
  let lastVisibleHeight = window.visualViewport?.height || window.innerHeight || root.clientHeight;
  let composerSession = false;
  let keyboardWasVisible = false;
  let keyboardDismissed = false;
  let keyboardBaseline = 0;

  const readVisibleHeight = () => Math.round(window.visualViewport?.height || window.innerHeight || root.clientHeight);
  const syncViewport = () => {
    const height = readVisibleHeight();
    root.style.setProperty("--tc-vv-height", height + "px");
    const messages = page();
    const shell = app();
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const chatOpen = !!messages?.classList.contains("tc-chat-open");
    const composerFocused = document.activeElement?.id === "dmText";
    const eligible = mobile && chatOpen && composerFocused;

    if (!eligible) {
      composerSession = false;
      keyboardWasVisible = false;
      keyboardDismissed = false;
      keyboardBaseline = 0;
    } else {
      if (!composerSession) {
        composerSession = true;
        keyboardBaseline = lastVisibleHeight || height;
        keyboardWasVisible = false;
        keyboardDismissed = false;
      }
      if (height < keyboardBaseline - 100) {
        keyboardWasVisible = true;
        keyboardDismissed = false;
      } else if (keyboardWasVisible && height >= keyboardBaseline - 60) {
        keyboardDismissed = true;
      }
    }

    const keyboardOpen = eligible && composerSession && !keyboardDismissed;
    messages?.classList.toggle("tc-keyboard-open", keyboardOpen);
    shell?.classList.toggle("tc-keyboard-open", keyboardOpen);
    lastVisibleHeight = height;
  };

  const scheduleSync = () => window.requestAnimationFrame(syncViewport);
  document.addEventListener("focusin", event => {
    if (event.target?.id === "dmText") scheduleSync();
  });
  document.addEventListener("focusout", event => {
    if (event.target?.id === "dmText") window.setTimeout(scheduleSync, 120);
  });
  document.addEventListener("pointerdown", event => {
    if (event.target?.id === "dmText" && keyboardDismissed) {
      keyboardBaseline = lastVisibleHeight || readVisibleHeight();
      keyboardWasVisible = false;
      keyboardDismissed = false;
      scheduleSync();
    }
  }, { passive: true });
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
