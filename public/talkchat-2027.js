(() => {
  "use strict";

  const intro = document.getElementById("tc2027Intro");
  const continueButton = document.getElementById("tcIntroContinue");
  const skipButton = document.getElementById("tcIntroSkip");
  const password = document.getElementById("authPassword");
  const passwordToggle = document.getElementById("passwordToggle");
  const toastRegion = document.getElementById("tcToastRegion");
  let introTimer = 0;
  let previousOverflow = "";
  let activeIntroUsername = "";

  const logoFallback = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#8257ff"/><stop offset="1" stop-color="#36c5ff"/></linearGradient></defs><rect width="160" height="160" rx="28" fill="#11111d"/><path d="M27 35h73a20 20 0 0 1 20 20v45a20 20 0 0 1-20 20H70l-24 18 5-20a20 20 0 0 1-24-18V55a20 20 0 0 1 20-20Z" fill="url(#g)"/><circle cx="55" cy="76" r="5" fill="white"/><circle cx="76" cy="76" r="5" fill="white"/><circle cx="97" cy="76" r="5" fill="white"/></svg>'
  );

  function showToast(message, tone) {
    if (!toastRegion || !message) return;
    const toast = document.createElement("div");
    toast.className = "tc-toast" + (tone === "error" ? " error" : "");
    toast.textContent = message;
    toastRegion.appendChild(toast);
    window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-5px)";
      window.setTimeout(() => toast.remove(), 220);
    }, 3600);
  }

  function beginFeedLoading() {
    const feed = document.getElementById("feed");
    if (!feed) return;
    feed.setAttribute("aria-busy", "true");
    feed.innerHTML = `
      <div class="tc-skeleton-post" aria-hidden="true">
        <div class="tc-skeleton-head"><span class="tc-skeleton-avatar"></span><div style="flex:1"><div class="tc-skeleton-line"></div><div class="tc-skeleton-line short"></div></div></div>
        <div class="tc-skeleton-line" style="width:82%;margin-top:18px"></div>
        <div class="tc-skeleton-media"></div>
      </div>
      <div class="tc-skeleton-post" aria-hidden="true">
        <div class="tc-skeleton-head"><span class="tc-skeleton-avatar"></span><div style="flex:1"><div class="tc-skeleton-line"></div><div class="tc-skeleton-line short"></div></div></div>
        <div class="tc-skeleton-line" style="width:68%;margin-top:18px"></div>
        <div class="tc-skeleton-media"></div>
      </div>`;
  }

  function endFeedLoading() {
    document.getElementById("feed")?.removeAttribute("aria-busy");
  }

  function searchSkeleton() {
    return '<div class="tc-search-skeleton" aria-hidden="true"></div><div class="tc-search-skeleton" aria-hidden="true"></div>';
  }

  function closeIntro(username = activeIntroUsername) {
    if (!intro || intro.hidden) return;
    window.clearTimeout(introTimer);
    const key = "talkchat-2027-intro:" + String(username || "").trim().toLowerCase();
    try { if (username) window.localStorage.setItem(key, "seen"); } catch {}
    intro.hidden = true;
    document.body.classList.remove("tc-intro-active");
    document.body.style.overflow = previousOverflow;
    activeIntroUsername = "";
  }

  function showIntro(username) {
    const cleanName = String(username || "").trim();
    if (!intro || !cleanName) return;
    const key = "talkchat-2027-intro:" + cleanName.toLowerCase();
    try { if (window.localStorage.getItem(key) === "seen") return; } catch {}

    activeIntroUsername = cleanName;
    previousOverflow = document.body.style.overflow;
    document.body.classList.add("tc-intro-active");
    document.body.style.overflow = "hidden";
    intro.hidden = false;
    continueButton.hidden = true;
    intro.focus({ preventScroll: true });

    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1800 : 5400;
    introTimer = window.setTimeout(() => { continueButton.hidden = false; }, delay);
    skipButton.onclick = () => closeIntro(cleanName);
    continueButton.onclick = () => closeIntro(cleanName);
  }

  passwordToggle?.addEventListener("click", () => {
    const visible = password.type === "password";
    password.type = visible ? "text" : "password";
    passwordToggle.setAttribute("aria-pressed", String(visible));
    passwordToggle.setAttribute("aria-label", visible ? "Şifrəni gizlət" : "Şifrəni göstər");
  });

  window.addEventListener("talkchat:entered", event => {
    showIntro(event.detail?.username);
  });

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && intro && !intro.hidden) closeIntro();
  });

  document.addEventListener("error", event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || image.dataset.tcFallback) return;
    image.dataset.tcFallback = "true";
    image.src = logoFallback;
  }, true);

  for (const id of ["postStatus", "profileStatus"]) {
    const status = document.getElementById(id);
    if (!status) continue;
    new MutationObserver(() => {
      const message = status.textContent.trim();
      if (!message || message.startsWith("Sessiya aktivdir:") || message === "Paylaşılır...") return;
      const isError = /xəta|error|uğursuz|failed/i.test(message);
      showToast(message, isError ? "error" : "success");
    }).observe(status, { childList: true, characterData: true, subtree: true });
  }

  window.TalkChat2027 = { beginFeedLoading, endFeedLoading, searchSkeleton, showToast };
})();
