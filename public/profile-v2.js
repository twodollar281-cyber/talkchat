// TalkChat Profile v2: redaktə dialoqu, ayarlar, post grid, cihaz tənzimləmələri
(() => {
  const $ = id => document.getElementById(id);
  const KEY = "tcProfilePrefs";
  const DEFAULTS = { notifFollow: true, notifLike: true, notifComment: true, notifMessage: true, compact: false, reduceMotion: false };
  const TYPE_PREF = { follow: "notifFollow", like: "notifLike", comment: "notifComment", message: "notifMessage" };
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let prefs = { ...DEFAULTS };
  try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {}
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} };
  const applyPrefs = () => {
    document.body.classList.toggle("tc-compact", !!prefs.compact);
    document.body.classList.toggle("tc-reduce-motion", !!prefs.reduceMotion);
    document.querySelectorAll("[data-pref]").forEach(i => { i.checked = !!prefs[i.dataset.pref]; });
  };

  let lastPosts = [];
  const EMPTY = "<div class='tc-empty-state'><span aria-hidden='true'>✦</span><b>Hələ paylaşım yoxdur</b><p>İlk postunu və ya Reels videonu paylaş.</p><button class='share-action share-post' type='button' data-open-share='post'>Post Paylaş</button></div>";

  function setView(mode) {
    const grid = $("myPostsGrid"), list = $("myPosts");
    if (!grid || !list) return;
    grid.hidden = mode !== "grid";
    list.hidden = mode !== "list";
    document.querySelectorAll("[data-pf-view]").forEach(b => b.classList.toggle("active", b.dataset.pfView === mode));
  }

  function renderGrid(posts) {
    lastPosts = Array.isArray(posts) ? posts : [];
    const grid = $("myPostsGrid");
    if (!grid) return;
    if (!lastPosts.length) { grid.innerHTML = EMPTY; return; }
    grid.innerHTML = lastPosts.map(p => {
      const isVideo = p.mediaType === "video";
      const inner = p.media
        ? (isVideo ? `<video src="${esc(p.media)}#t=0.1" muted playsinline preload="metadata"></video><i class="pf-tile-badge" aria-hidden="true">▶</i>`
                   : `<img src="${esc(p.media)}" alt="" loading="lazy">`)
        : `<span class="pf-tile-text">${esc((p.text || "").slice(0, 90))}</span>`;
      return `<button type="button" class="pf-tile" data-pf-open="${esc(p.id)}" aria-label="Paylaşımı aç">${inner}</button>`;
    }).join("");
  }

  async function savePartial(body) {
    const st = $("psetStatus");
    try {
      const res = await fetch("/api/profile", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Yadda saxlanmadı.");
      if (st) st.textContent = "Yadda saxlanıldı ✓";
      if (typeof applyProfileCustomization === "function") applyProfileCustomization(document.querySelector("#profilePage .profile-card"), data);
    } catch (e) {
      if (st) st.textContent = e.message;
      try { window.loadMyProfile && window.loadMyProfile(); } catch {}
    }
  }

  function autosaveBody(el) {
    const id = el.id;
    if (id === "profileTheme") return { profileTheme: el.value };
    if (id === "profileColor") return { profileColor: el.value };
    if (id === "onlineVisibility") return { onlineVisibility: el.value };
    if (id === "lastSeenVisibility") return { lastSeenVisibility: el.value };
    const map = { privacyProfile: "profile", privacyPosts: "posts", privacyStories: "stories", privacyMessages: "messageRequests", privacyFriends: "friendRequests" };
    return map[id] ? { privacySettings: { [map[id]]: el.value } } : null;
  }

  function openSettings(tab) {
    $("profileMain").hidden = true; $("profileSettings").hidden = false;
    if (tab) selectTab(tab);
    $("psetStatus").textContent = "";
    window.scrollTo({ top: 0 });
  }
  function closeSettings() {
    const s = $("profileSettings"), m = $("profileMain");
    if (s) s.hidden = true; if (m) m.hidden = false;
  }
  function selectTab(name) {
    document.querySelectorAll("[data-pset]").forEach(b => b.classList.toggle("active", b.dataset.pset === name));
    document.querySelectorAll(".pf-pane").forEach(p => { p.hidden = p.id !== "pset-" + name; });
  }
  function openEdit() {
    const d = $("editProfileDialog"); if (!d) return;
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }

  document.addEventListener("click", e => {
    const t = e.target.closest("button, [data-open-edit]"); if (!t) return;
    if (t.id === "editProfileOpen" || t.hasAttribute("data-open-edit")) openEdit();
    else if (t.id === "editProfileClose") $("editProfileDialog").close();
    else if (t.id === "profileSettingsOpen") openSettings("account");
    else if (t.id === "profileSettingsBack") closeSettings();
    else if (t.dataset.pset) selectTab(t.dataset.pset);
    else if (t.dataset.pfView) setView(t.dataset.pfView);
    else if (t.dataset.pfOpen) {
      setView("list");
      const post = $("myPosts")?.querySelector(`[data-post="${CSS.escape(t.dataset.pfOpen)}"]`);
      if (post) post.scrollIntoView({ block: "start", behavior: prefs.reduceMotion ? "auto" : "smooth" });
    } else if (t.id === "pfResetPrefs") {
      prefs = { ...DEFAULTS }; savePrefs(); applyPrefs(); $("psetStatus").textContent = "Cihaz tənzimləmələri sıfırlandı ✓";
    } else if (t.closest("[data-page]")) closeSettings();
  });

  document.addEventListener("change", e => {
    const el = e.target;
    if (el.dataset && el.dataset.pref) { prefs[el.dataset.pref] = el.checked; savePrefs(); applyPrefs(); $("psetStatus").textContent = "Yadda saxlanıldı ✓"; return; }
    if (el.matches && el.matches("#profileSettings [data-autosave]")) {
      const body = autosaveBody(el); if (body) savePartial(body);
    }
  });
  document.addEventListener("input", e => {
    if (e.target.id === "myBio") { const c = $("myBioCount"); if (c) c.textContent = `${e.target.value.length}/160`; }
    if (e.target.id === "profileColor") {
      const card = document.querySelector("#profilePage .profile-card");
      if (card && /^#[0-9a-fA-F]{6}$/.test(e.target.value)) card.style.setProperty("--profile-accent", e.target.value);
    }
  });
  $("editProfileDialog")?.addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  applyPrefs();
  window.TalkChatProfileV2 = {
    renderGrid, openSettings, closeSettings,
    notifAllowed: type => { const k = TYPE_PREF[type]; return k ? prefs[k] !== false : true; },
    prefs: () => ({ ...prefs })
  };
  setView("grid");
})();
