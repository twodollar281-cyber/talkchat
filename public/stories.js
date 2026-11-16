/* TalkChat Stories v2 — rail + viewer + editor. Server: /api/stories*, qaydalar stories.js-dədir. */
(() => {
  "use strict";

  /* ================= PURE CORE (testable) ================= */
  const BACKGROUNDS = ["violet", "aurora", "sunset", "ocean", "forest", "rose", "midnight", "mono"];
  const STICKERS = [
    { id: "time", label: "Saat" }, { id: "date", label: "Tarix" }, { id: "love", label: "💜 LOVE" }, { id: "wow", label: "WOW!" },
    { id: "fire", label: "🔥 FIRE" }, { id: "new", label: "NEW ✨" }, { id: "vibe", label: "VIBE" }, { id: "cool", label: "COOL 😎" }
  ];
  const REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👏"];
  const EMOJIS = ("😀 😂 🥹 😍 🥰 😎 🤩 😭 😡 🤯 🥳 😴 🤔 🙄 😇 😜 👍 👎 👏 🙌 🙏 💪 🤝 ✌️ 🤞 👀 💜 ❤️ 🧡 💛 💚 💙 🖤 💔 🔥 ✨ ⭐ 🌟 💯 🎉 🎂 🎁 🎵 🎧 📸 🌈 ☀️ 🌙 ⚡ 🌸 🍕 🍔 ☕ 🍿 ⚽ 🏀 🚗 ✈️ 🏖️ 🐶 🐱 🦋 🌍").split(" ");
  const COLORS = ["#ffffff", "#111111", "#8257ff", "#36c5ff", "#ff5fa2", "#ffd23f", "#3ddc97", "#ff4d4d"];
  const IMAGE_MS = 5000;
  const MONTHS = ["YAN", "FEV", "MAR", "APR", "MAY", "İYN", "İYL", "AVQ", "SEN", "OKT", "NOY", "DEK"];
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function timeAgo(iso, now = Date.now()) {
    const seconds = (now - Date.parse(iso)) / 1000;
    if (!Number.isFinite(seconds)) return "";
    if (seconds < 60) return "İndi";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + " dəq";
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? hours + " saat" : Math.floor(hours / 24) + " gün";
  }
  function groupStories(list) {
    const map = new Map();
    for (const story of list || []) {
      let group = map.get(story.username);
      if (!group) {
        group = { username: story.username, displayName: story.displayName || "", avatar: story.avatar || "", mine: !!story.mine, muted: !!story.muted, stories: [] };
        map.set(story.username, group);
      }
      group.stories.push(story);
    }
    const groups = Array.from(map.values());
    for (const group of groups) {
      group.stories.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      group.latest = Date.parse(group.stories[group.stories.length - 1].createdAt) || 0;
    }
    return groups;
  }
  const allViewed = group => group.stories.every(story => story.viewed);
  function sortGroups(groups) {
    const rank = group => group.mine ? 0 : group.muted ? 3 : allViewed(group) ? 2 : 1;
    return groups.slice().sort((a, b) => rank(a) - rank(b) || b.latest - a.latest);
  }
  const firstUnviewed = group => Math.max(0, group.stories.findIndex(story => !story.viewed));
  // Açılış ardıcıllığı: susdurulmuş hesab yalnız özü açılanda göstərilir və avtomatik keçidə girmir.
  function buildSequence(groups, username) {
    const target = groups.find(group => group.username === username);
    if (!target) return { seq: [], index: -1 };
    if (target.muted) return { seq: [target], index: 0 };
    const seq = groups.filter(group => !group.muted && group.stories.length);
    return { seq, index: seq.indexOf(target) };
  }
  function nextPos(seq, gi, si) {
    if (si < seq[gi].stories.length - 1) return { gi, si: si + 1 };
    return gi < seq.length - 1 ? { gi: gi + 1, si: 0 } : null;
  }
  function prevPos(seq, gi, si) {
    if (si > 0) return { gi, si: si - 1 };
    return gi > 0 ? { gi: gi - 1, si: seq[gi - 1].stories.length - 1 } : null;
  }
  function contrastOn(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#111111";
    const n = parseInt(m[1], 16);
    const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return lum > 0.6 ? "#111111" : "#ffffff";
  }
  function textStyle(o) {
    if (o.bg === "solid") return { color: contrastOn(o.color), background: o.color };
    return { color: o.color || "#ffffff", background: "" };
  }
  const clampPos = (x, y) => ({ x: clamp(x, 0.04, 0.96), y: clamp(y, 0.1, 0.88) });
  function stickerText(id, createdAt) {
    const date = new Date(createdAt || Date.now());
    if (id === "time") return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
    if (id === "date") return date.getDate() + " " + MONTHS[date.getMonth()];
    return (STICKERS.find(item => item.id === id) || {}).label || "";
  }
  const core = { timeAgo, groupStories, sortGroups, allViewed, firstUnviewed, buildSequence, nextPos, prevPos, contrastOn, textStyle, clampPos, stickerText, BACKGROUNDS, STICKERS, REACTIONS, IMAGE_MS };
  if (typeof document === "undefined") { if (typeof module !== "undefined") module.exports = core; return; }

  /* ================= DOM HELPERS ================= */
  const ICONS = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>', dots: '<circle cx="5" cy="12" r="1.6" class="f"/><circle cx="12" cy="12" r="1.6" class="f"/><circle cx="19" cy="12" r="1.6" class="f"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', heart: '<path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.7 3.7 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.3 0 5.3 3.2 4.2 6.6-1.7 4.8-9.2 9.4-9.2 9.4z"/>',
    plane: '<path d="M21 3L3 10.5l6.5 2.5L12 20z"/><path d="M9.5 13L21 3"/>', eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.2A9.7 9.7 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.5 6.6C3.7 8.3 2 12 2 12s3.6 7 10 7a9.8 9.8 0 004.2-.9"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/>', text: '<path d="M4 20l6-15 6 15M6.5 14h7"/><path d="M18 8h3M19.5 8v8"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2.5 4 2.5S16 14 16 14M9 9.5h.01M15 9.5h.01"/>', image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/>',
    camera: '<path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.6"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10.5l5-3v9l-5-3z"/>', palette: '<path d="M12 3a9 9 0 100 18c1.4 0 2-.9 2-1.8 0-1.3-1-1.5-1-2.7 0-1 .8-1.6 1.8-1.6H17a4 4 0 004-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1" class="f"/><circle cx="10" cy="7" r="1" class="f"/><circle cx="15" cy="7.5" r="1" class="f"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', back: '<path d="M15 5l-7 7 7 7"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', vol: '<path d="M4 9.5v5h4l5 4v-13l-5 4z"/><path d="M16.5 9a4 4 0 010 6M18.8 6.5a7.5 7.5 0 010 11"/>',
    volOff: '<path d="M4 9.5v5h4l5 4v-13l-5 4z"/><path d="M17 9.5l4 5M21 9.5l-4 5"/>', mute: '<path d="M6 8a6 6 0 0112 0c0 5 2 6 2 7H4c0-1 2-2 2-7zM10 19a2 2 0 004 0M3 3l18 18"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', alignL: '<path d="M4 6h16M4 12h10M4 18h14"/>', alignC: '<path d="M4 6h16M7 12h10M5 18h14"/>', alignR: '<path d="M4 6h16M10 12h10M6 18h14"/>',
    box: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 15l2-6 2 6M8.7 13h2.6"/>', stack: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>'
  };
  const icon = (name, extra = "") => `<svg class="tcs-ico ${extra}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${(ICONS[name] || "").replace(/class="f"/g, 'fill="currentColor" stroke="none"')}</svg>`;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === false || value === null || value === undefined) continue;
      if (key === "class") el.className = value;
      else if (key === "html") el.innerHTML = value;
      else if (key === "text") el.textContent = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const JSON_HEADERS = { "Content-Type": "application/json" };
  async function req(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Xəta baş verdi.");
    return data;
  }
  const post = (url, body) => req(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body || {}) });
  function toast(message, tone = "success") {
    if (window.TalkChat2027?.showToast) window.TalkChat2027.showToast(message, tone);
  }
  function avatarNode(person, cls = "") {
    const inner = person.avatar ? h("img", { src: person.avatar, alt: "", loading: "lazy", decoding: "async" })
      : h("span", { class: "tcs-avatar-fb", text: (person.displayName || person.username || "?").trim().charAt(0) });
    return inner;
  }
  const displayOf = person => person.displayName || person.username;
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Android geri düyməsi / brauzer geri: açıq qatı bağlayır ---- */
  const layers = [];
  let ignorePop = 0;
  function pushLayer(closeFn) {
    layers.push(closeFn);
    try { history.pushState({ tcsLayer: layers.length }, ""); } catch { /* ignore */ }
  }
  function releaseLayer(closeFn) {
    const index = layers.lastIndexOf(closeFn);
    if (index < 0) return;
    layers.splice(index, 1);
    if (history.state && history.state.tcsLayer) { ignorePop++; try { history.back(); } catch { ignorePop--; } }
  }
  window.addEventListener("popstate", () => {
    if (ignorePop > 0) { ignorePop--; return; }
    const closeFn = layers.pop();
    if (closeFn) closeFn({ fromPop: true });
  });

  /* ---- Alt panel (sheet) ---- */
  function makeSheet(host, { title = "", onClose } = {}) {
    const wrap = h("div", { class: "tcs-modal-host" });
    const backdrop = h("div", { class: "tcs-backdrop" });
    const body = h("div", { class: "tcs-sheet-body" });
    const sheet = h("div", { class: "tcs-sheet", role: "dialog", "aria-modal": "true", "aria-label": title || "Menyu" },
      h("div", { class: "tcs-sheet-grip" }), title ? h("h3", { text: title }) : null, body);
    wrap.append(backdrop, sheet);
    host.append(wrap);
    let closed = false;
    const api = {
      el: sheet, body, wrap,
      close() { if (closed) return; closed = true; wrap.remove(); if (onClose) onClose(); }
    };
    backdrop.addEventListener("click", api.close);
    return api;
  }
  function confirmSheet(host, { title, text, okLabel = "Təsdiq et", danger = false, onOpen, onClose }) {
    return new Promise(resolve => {
      let answer = false;
      const sheet = makeSheet(host, { title, onClose: () => { if (onClose) onClose(); resolve(answer); } });
      const done = value => { answer = value; sheet.close(); };
      sheet.body.append(h("div", { class: "tcs-confirm" }, h("p", { text }),
        h("div", { class: "row" }, h("button", { class: "tcs-btn", type: "button", text: "Ləğv et", onclick: () => done(false) }),
          h("button", { class: "tcs-btn " + (danger ? "danger" : "primary"), type: "button", text: okLabel, onclick: () => done(true) }))));
      if (onOpen) onOpen(sheet);
    });
  }

  /* ================= STORY CANVAS (viewer + editor + preview eyni render) ================= */
  function overlayNode(o, ctx = {}) {
    const el = h("div", { class: "tcs-ov " + o.type });
    el.style.left = (o.x * 100) + "%";
    el.style.top = (o.y * 100) + "%";
    el.style.fontSize = `calc(var(--u, 1px) * ${o.size})`;
    if (o.type === "text") {
      const style = textStyle(o);
      el.textContent = o.text;
      el.style.color = style.color;
      el.style.textAlign = o.align || "center";
      if (o.bg === "solid") { el.classList.add("bg-solid"); el.style.background = style.background; }
      else if (o.bg === "soft") el.classList.add("bg-soft");
    } else if (o.type === "emoji") {
      el.textContent = o.emoji;
    } else if (o.type === "sticker") {
      el.classList.add("st-" + o.sticker);
      el.textContent = stickerText(o.sticker, ctx.createdAt);
    }
    return el;
  }
  // Canvas: fon (media / gradient), overlay təbəqəsi. `--u` = canvas eni / 360, beləliklə ölçülər hər ekranda eyni nisbətdədir.
  function renderCanvas(story, opts = {}) {
    const canvas = h("div", { class: "tcs-canvas" });
    const overlays = h("div", { class: "tcs-ovs" });
    const result = { el: canvas, overlays, video: null };
    const setUnit = () => { const w = canvas.clientWidth || canvas.getBoundingClientRect().width; if (w) canvas.style.setProperty("--u", (w / 360) + "px"); };
    if (typeof ResizeObserver !== "undefined") { const ro = new ResizeObserver(setUnit); ro.observe(canvas); result.ro = ro; }
    else window.addEventListener("resize", setUnit);
    requestAnimationFrame(setUnit);
    const ready = () => { loader?.remove(); if (opts.onReady) opts.onReady(result); };
    const fail = () => { loader?.remove(); canvas.append(h("div", { class: "tcs-failed", text: "Media yüklənmədi." })); if (opts.onError) opts.onError(result); };
    let loader = null;
    if (story.mediaType === "image" && story.media) {
      loader = h("div", { class: "tcs-loading", role: "status", "aria-label": "Yüklənir" });
      const blur = h("div", { class: "tcs-blur" });
      blur.style.backgroundImage = `url("${story.media.replace(/"/g, "%22")}")`;
      const img = h("img", { class: "tcs-media", src: story.media, alt: story.text || "Story şəkli", draggable: "false", decoding: "async" });
      img.addEventListener("load", ready); img.addEventListener("error", fail);
      canvas.append(blur, img, loader);
      if (img.complete && img.naturalWidth) queueMicrotask(ready);
    } else if (story.mediaType === "video" && story.media) {
      loader = h("div", { class: "tcs-loading", role: "status", "aria-label": "Yüklənir" });
      const video = h("video", { class: "tcs-media", src: story.media, playsinline: true, preload: "auto", "webkit-playsinline": "true" });
      video.setAttribute("playsinline", ""); video.disablePictureInPicture = true;
      if (opts.loopVideo) { video.loop = true; video.muted = true; video.autoplay = true; }
      video.addEventListener("loadeddata", ready); video.addEventListener("error", fail);
      result.video = video;
      canvas.append(video, loader);
    } else {
      canvas.classList.add("tcs-bg-" + (BACKGROUNDS.includes(story.background) ? story.background : "violet"));
      queueMicrotask(ready);
    }
    canvas.append(overlays);
    const list = Array.isArray(story.overlays) ? story.overlays : [];
    if (!opts.manualOverlays) for (const o of list) overlays.append(overlayNode(o, { createdAt: story.createdAt }));
    if (!list.length && story.text && !opts.manualOverlays) canvas.append(h("div", { class: "tcs-caption", text: story.text }));
    return result;
  }

  /* ================= RAIL ================= */
  const Rail = { groups: [], me: null, hosts: new Set(), loaded: false, loading: null, at: 0, error: "" };
  async function loadMe() {
    if (Rail.me) return Rail.me;
    try { Rail.me = await req("/api/profile"); } catch { Rail.me = { username: typeof me === "string" ? me : "", avatar: "", displayName: "" }; }
    return Rail.me;
  }
  function ringClass(group) {
    if (group.muted) return "tcs-ring muted seen";
    return "tcs-ring" + (allViewed(group) ? " seen" : "");
  }
  function renderRail(host) {
    host.textContent = "";
    if (!Rail.loaded && !Rail.error) {
      const skel = h("div", { class: "tcs-rail", "aria-busy": "true" });
      for (let i = 0; i < 6; i++) skel.append(h("div", { class: "tcs-skel" }, h("i"), h("b")));
      host.append(skel); return;
    }
    if (Rail.error && !Rail.groups.length && !Rail.me) {
      host.append(h("div", { class: "tcs-err" }, Rail.error + " ", h("button", { type: "button", text: "Yenidən yoxla", onclick: () => refresh(true) }))); return;
    }
    const rail = h("div", { class: "tcs-rail", role: "list", "aria-label": "Story-lər" });
    const meInfo = Rail.me || {};
    const mineGroup = Rail.groups.find(group => group.mine);
    const selfName = mineGroup ? "Story-n" : "Story əlavə et";
    const selfOpen = h("button", { class: "tcs-open", type: "button", "aria-label": mineGroup ? "Öz Story-nə bax" : "Story əlavə et", onclick: e => mineGroup ? openGroup(mineGroup.username, e.currentTarget) : openEditor({ opener: e.currentTarget }) },
      h("span", { class: mineGroup ? "tcs-ring seen" : "tcs-ring none" }, h("span", { class: "tcs-ring-in" }, avatarNode(meInfo))), h("span", { class: "tcs-name", text: selfName }));
    rail.append(h("div", { class: "tcs-item", role: "listitem", "data-self": "1" }, selfOpen,
      h("button", { class: "tcs-plus", type: "button", "aria-label": "Yeni Story paylaş", onclick: e => openEditor({ opener: e.currentTarget }) }, h("span", { html: icon("plus") }))));
    const others = sortGroups(Rail.groups.filter(group => !group.mine));
    for (const group of others) {
      const name = displayOf(group);
      const seen = allViewed(group);
      rail.append(h("div", { class: "tcs-item" + (group.muted ? " muted-item" : seen ? " seen-item" : ""), role: "listitem" },
        h("button", { class: "tcs-open", type: "button", title: name, "data-story-user": group.username, "aria-label": `${name} — ${seen ? "baxılıb" : "yeni Story"}${group.muted ? " (səssizdə)" : ""}`, onclick: e => openGroup(group.username, e.currentTarget) },
          h("span", { class: ringClass(group) }, h("span", { class: "tcs-ring-in" }, avatarNode(group))), h("span", { class: "tcs-name", text: name }))));
    }
    if (!others.length) {
      rail.append(h("div", { class: "tcs-empty", role: "note" }, h("span", { html: icon("stack") }),
        h("span", {}, h("b", { text: "Hələ Story yoxdur" }), "İzlədiyin insanların Story-ləri burada görünəcək.")));
    }
    host.append(rail);
  }
  function renderAllRails() { Rail.hosts.forEach(renderRail); markDirectRail(); }
  async function refresh(force) {
    if (Rail.loading) return Rail.loading;
    if (!force && Rail.loaded && Date.now() - Rail.at < 15000) return;
    Rail.loading = (async () => {
      try {
        const [list] = await Promise.all([req("/api/stories?scope=following"), loadMe()]);
        Rail.groups = groupStories(list);
        Rail.error = "";
      } catch (error) { Rail.error = error.message || "Story-lər yüklənmədi."; }
      Rail.loaded = true; Rail.at = Date.now(); Rail.loading = null;
      renderAllRails();
    })();
    return Rail.loading;
  }
  function mountRail(host) {
    if (!host || Rail.hosts.has(host)) return;
    Rail.hosts.add(host);
    host.classList.add("tcs-rail-wrap");
    renderRail(host);
    refresh(true);
    if (typeof IntersectionObserver !== "undefined") {
      new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) refresh(); }).observe(host);
    }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Rail.hosts.size) refresh(); });
  function markDirectRail() {
    document.querySelectorAll("#directStoryRail .direct-story-item[data-story-user]").forEach(item => {
      const group = Rail.groups.find(g => g.username === item.dataset.storyUser && !g.muted);
      item.querySelector(".direct-story-ring")?.classList.toggle("tcs-has", !!group && !allViewed(group));
    });
  }
  function hasStory(username) { return Rail.groups.some(group => group.username === username && group.stories.length); }

  /* ================= VIEWER ================= */
  let V = null;

  function openGroup(username, opener) {
    const { seq, index } = buildSequence(Rail.groups, username);
    if (index < 0) return false;
    openViewer(seq, index, firstUnviewed(seq[index]), opener);
    return true;
  }
  function openViewer(seq, gi, si, opener) {
    if (V || !seq.length) return;
    const stage = h("div", { class: "tcs-stage" });
    const root = h("div", { class: "tcs-viewer", role: "dialog", "aria-modal": "true", "aria-label": "Story görüntüləyicisi", tabindex: "-1" }, stage);
    V = { seq, gi, si, root, stage, opener, reasons: new Set(), elapsed: 0, duration: IMAGE_MS, raf: 0, last: 0, canvas: null, muted: false, sentViews: new Set(), touch: null, sheet: null };
    stage.append(h("div", { class: "tcs-canvas-host" }));
    stage.append(h("div", { class: "tcs-scrim-top" }), h("div", { class: "tcs-scrim-bottom" }));
    const hit = h("div", { class: "tcs-hit" });
    stage.append(hit, h("div", { class: "tcs-top" }), h("div", { class: "tcs-bottom" }), h("div", { class: "tcs-modal-host" }));
    V.host = stage.querySelector(".tcs-canvas-host");
    V.host.style.cssText = "position:absolute;inset:0";
    V.top = stage.querySelector(".tcs-top"); V.bottom = stage.querySelector(".tcs-bottom"); V.modals = stage.querySelector(".tcs-modal-host");
    V.modals.style.pointerEvents = "none";
    document.body.append(root);
    document.documentElement.classList.add("tcs-lock");
    bindHit(hit);
    root.addEventListener("keydown", onViewerKey);
    document.addEventListener("visibilitychange", onVisibility);
    pushLayer(closeViewer);
    showStory("fade");
    root.focus({ preventScroll: true });
  }
  const curGroup = () => V.seq[V.gi];
  const curStory = () => V.seq[V.gi].stories[V.si];
  const isPlaying = () => V && V.reasons.size === 0;
  function onVisibility() { if (!V) return; if (document.hidden) pause("hidden"); else resume("hidden"); }
  function pause(reason) { if (!V) return; V.reasons.add(reason); stopFrame(); V.canvas?.video?.pause(); }
  function resume(reason) { if (!V) return; V.reasons.delete(reason); kick(); }
  function stopFrame() { if (V && V.raf) { cancelAnimationFrame(V.raf); V.raf = 0; } }
  function kick() {
    if (!V || !isPlaying() || V.raf) return;
    const video = V.canvas?.video;
    if (video) {
      video.muted = V.muted;
      const attempt = video.play();
      if (attempt && attempt.catch) attempt.catch(() => { V.muted = true; video.muted = true; updateSoundBtn(); video.play().catch(() => {}); });
    }
    V.last = performance.now();
    V.raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    if (!V) return;
    V.raf = 0;
    if (!isPlaying()) return;
    const video = V.canvas?.video;
    let progress;
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      progress = video.currentTime / video.duration;
      if (video.ended) progress = 1;
    } else if (video) {
      progress = 0; // metadata hələ yoxdur
    } else {
      V.elapsed += now - V.last;
      progress = V.elapsed / V.duration;
    }
    V.last = now;
    setBar(progress);
    if (progress >= 1) { next(); return; }
    V.raf = requestAnimationFrame(frame);
  }
  function setBar(progress) {
    const fill = V.top.querySelectorAll(".tcs-bar i")[V.si];
    if (fill) fill.style.transform = `scaleX(${clamp(progress, 0, 1)})`;
  }
  function renderBars() {
    const bars = h("div", { class: "tcs-bars", role: "progressbar", "aria-label": `Story ${V.si + 1} / ${curGroup().stories.length}` });
    curGroup().stories.forEach((_, index) => bars.append(h("span", { class: "tcs-bar" }, h("i", { style: { transform: index < V.si ? "scaleX(1)" : "scaleX(0)" } }))));
    return bars;
  }
  function showStory(dir) {
    stopFrame();
    V.canvas?.video?.pause();
    V.canvas?.ro?.disconnect();
    V.elapsed = 0; V.duration = IMAGE_MS;
    V.reasons.delete("loading");
    const group = curGroup(), story = curStory();
    const canvas = renderCanvas(story, {
      onReady: result => {
        if (!V || V.canvas !== result) return;
        V.reasons.delete("loading");
        if (result.video) V.duration = (result.video.duration || 15) * 1000;
        kick();
      },
      onError: result => { if (!V || V.canvas !== result) return; V.reasons.delete("loading"); kick(); }
    });
    V.canvas = canvas;
    if (story.mediaType === "image" || story.mediaType === "video") V.reasons.add("loading");
    if (canvas.video) canvas.video.addEventListener("ended", () => { if (V && V.canvas === canvas) next(); });
    if (dir && !reduceMotion()) canvas.el.classList.add(dir === "next" ? "enter-next" : dir === "prev" ? "enter-prev" : "enter-fade");
    V.host.textContent = ""; V.host.append(canvas.el);
    renderTop(group, story);
    renderBottom(group, story);
    markViewed(story);
    preloadNext();
    kick();
  }
  function renderTop(group, story) {
    const name = displayOf(group);
    V.top.textContent = "";
    const sound = h("button", { class: "tcs-icon-btn tcs-sound", type: "button", "aria-label": "Səsi aç/bağla", hidden: story.mediaType !== "video", html: icon(V.muted ? "volOff" : "vol"), onclick: () => { V.muted = !V.muted; if (V.canvas?.video) V.canvas.video.muted = V.muted; updateSoundBtn(); } });
    if (story.mediaType !== "video") sound.hidden = true;
    V.top.append(renderBars(), h("div", { class: "tcs-head" },
      h("button", { class: "tcs-head-user", type: "button", "aria-label": `${name} profilinə keç`, onclick: () => { const u = group.username; closeViewer(); if (typeof openPublicProfile === "function" && !group.mine) openPublicProfile(u); } },
        h("span", { class: "tcs-ring" }, h("span", { class: "tcs-ring-in" }, avatarNode(group))),
        h("span", { class: "tcs-head-line" }, h("span", { class: "tcs-head-name", text: group.mine ? "Sən" : name }), h("span", { class: "tcs-head-time", text: timeAgo(story.createdAt) }))),
      sound,
      h("button", { class: "tcs-icon-btn tcs-menu-btn", type: "button", "aria-label": "Daha çox", "aria-haspopup": "menu", html: icon("dots"), onclick: openMenu }),
      h("button", { class: "tcs-icon-btn tcs-close", type: "button", "aria-label": "Bağla", html: icon("close"), onclick: () => closeViewer() })));
  }
  function updateSoundBtn() { const b = V?.top.querySelector(".tcs-sound"); if (b) b.innerHTML = icon(V.muted ? "volOff" : "vol"); }
  function renderBottom(group, story) {
    V.bottom.textContent = "";
    V.root.classList.remove("replying");
    if (story.mine) {
      V.bottom.append(h("div", { class: "tcs-own" },
        h("button", { class: "tcs-pill tcs-viewers-btn", type: "button", "aria-label": `${story.viewsCount} baxış, siyahıya bax`, onclick: openViewers, html: icon("eye") + `<span>${story.viewsCount} baxış</span>` + (story.reactionsCount ? `<span>· ${story.reactionsCount} ♥</span>` : "") }),
        h("button", { class: "tcs-pill", type: "button", "aria-label": "Yeni Story əlavə et", onclick: () => { closeViewer(); openEditor(); }, html: icon("plus") + "<span>Yeni</span>" })));
      return;
    }
    const emojiRow = h("div", { class: "tcs-emoji-row", role: "group", "aria-label": "Sürətli reaksiyalar" });
    REACTIONS.forEach(emoji => emojiRow.append(h("button", { type: "button", "aria-label": `${emoji} reaksiyası`, class: story.myReaction === emoji ? "on" : "", text: emoji, onclick: () => react(emoji) })));
    const input = h("input", { class: "tcs-reply-input", type: "text", maxlength: "500", placeholder: `${displayOf(group)}-ə cavab yaz…`, "aria-label": "Story-yə cavab yaz", enterkeyhint: "send", autocomplete: "off" });
    const send = h("button", { class: "tcs-send", type: "submit", hidden: true, html: icon("plane") + "<span>Göndər</span>" });
    const heart = h("button", { class: "tcs-icon-btn tcs-react-btn" + (story.myReaction === "❤️" ? " on" : ""), type: "button", "aria-label": "Bəyən", html: icon("heart"), onclick: () => react("❤️") });
    const share = h("button", { class: "tcs-icon-btn tcs-share-btn", type: "button", "aria-label": "Story-ni DM ilə göndər", html: icon("plane"), onclick: openShare });
    const form = h("form", { class: "tcs-reply", autocomplete: "off" }, input, send, heart, share);
    let blurTimer = 0;
    input.addEventListener("focus", () => { clearTimeout(blurTimer); V.root.classList.add("replying"); pause("input"); });
    input.addEventListener("blur", () => { blurTimer = setTimeout(() => { if (!V || input.value.trim()) return; V.root.classList.remove("replying"); resume("input"); }, 220); });
    input.addEventListener("input", () => { const has = !!input.value.trim(); send.hidden = !has; form.classList.toggle("has-text", has); });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || send.disabled) return;
      send.disabled = true;
      try {
        await post(`/api/stories/${encodeURIComponent(story.id)}/reply`, { text });
        input.value = ""; send.hidden = true; form.classList.remove("has-text");
        input.blur(); vToast("Cavab göndərildi");
      } catch (error) { vToast(error.message, true); }
      send.disabled = false;
    });
    V.bottom.append(emojiRow, form);
  }
  function vToast(message, isError) {
    if (!V) return;
    V.stage.querySelector(".tcs-toast")?.remove();
    const el = h("div", { class: "tcs-toast" + (isError ? " err" : ""), role: "status", text: message });
    V.stage.append(el);
    setTimeout(() => el.remove(), 2600);
  }
  async function react(emoji) {
    const story = curStory();
    if (story.mine) return;
    try {
      const result = await post(`/api/stories/${encodeURIComponent(story.id)}/react`, { emoji });
      story.myReaction = result.myReaction; story.viewed = true;
      if (!V || curStory() !== story) return;
      V.bottom.querySelector(".tcs-react-btn")?.classList.toggle("on", story.myReaction === "❤️");
      V.bottom.querySelectorAll(".tcs-emoji-row button").forEach(btn => btn.classList.toggle("on", btn.textContent === story.myReaction));
      if (result.myReaction) {
        const fly = h("div", { class: "tcs-float", text: result.myReaction, "aria-hidden": "true" });
        V.stage.append(fly); setTimeout(() => fly.remove(), 1200);
        if (navigator.vibrate) navigator.vibrate(8);
      }
    } catch (error) { vToast(error.message, true); }
  }
  function markViewed(story) {
    if (story.mine || V.sentViews.has(story.id)) return;
    V.sentViews.add(story.id);
    story.viewed = true;
    post(`/api/stories/${encodeURIComponent(story.id)}/view`).catch(() => V && V.sentViews.delete(story.id));
  }
  function preloadNext() {
    const pos = nextPos(V.seq, V.gi, V.si);
    const story = pos && V.seq[pos.gi].stories[pos.si];
    if (story && story.mediaType === "image" && story.media) { const img = new Image(); img.src = story.media; }
  }
  function go(pos, dir) { if (!pos) return false; V.gi = pos.gi; V.si = pos.si; showStory(dir); return true; }
  function next() { if (!V) return; if (!go(nextPos(V.seq, V.gi, V.si), "next")) closeViewer(); }
  function prev() { if (!V) return; if (!go(prevPos(V.seq, V.gi, V.si), "prev")) { V.elapsed = 0; showStory("fade"); } }
  function jumpGroup(delta) {
    const gi = V.gi + delta;
    if (gi < 0) { V.elapsed = 0; showStory("fade"); return; }
    if (gi >= V.seq.length) { closeViewer(); return; }
    V.gi = gi; V.si = delta > 0 ? firstUnviewed(V.seq[gi]) : 0; showStory(delta > 0 ? "next" : "prev");
  }
  function bindHit(hit) {
    hit.addEventListener("pointerdown", e => {
      if (e.button > 0 || V.touch) return;
      try { hit.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const t = V.touch = { x: e.clientX, y: e.clientY, moved: false, holding: false, dx: 0, dy: 0, id: e.pointerId };
      t.timer = setTimeout(() => { if (V && V.touch === t && !t.moved) { t.holding = true; V.root.classList.add("holding"); pause("hold"); } }, 220);
    });
    hit.addEventListener("pointermove", e => {
      const t = V.touch; if (!t || e.pointerId !== t.id) return;
      t.dx = e.clientX - t.x; t.dy = e.clientY - t.y;
      if (!t.moved && (Math.abs(t.dx) > 12 || Math.abs(t.dy) > 12)) { t.moved = true; clearTimeout(t.timer); if (t.holding) { t.holding = false; V.root.classList.remove("holding"); resume("hold"); } }
      if (t.moved && t.dy > 0 && Math.abs(t.dy) > Math.abs(t.dx)) {
        pause("drag");
        V.stage.style.transition = "none";
        V.stage.style.transform = `translateY(${t.dy}px) scale(${1 - Math.min(t.dy, 320) / 1600})`;
      }
    });
    const finish = (e, cancelled) => {
      const t = V && V.touch; if (!t || (e && e.pointerId !== t.id)) return;
      clearTimeout(t.timer); V.touch = null;
      V.stage.style.transition = ""; V.stage.style.transform = "";
      if (t.holding) { V.root.classList.remove("holding"); resume("hold"); }
      if (V.reasons.has("drag")) resume("drag");
      if (cancelled) return;
      if (t.dy > 110 && t.dy > Math.abs(t.dx)) { closeViewer(); return; }
      if (t.moved && Math.abs(t.dx) > 70 && Math.abs(t.dx) > Math.abs(t.dy)) { jumpGroup(t.dx < 0 ? 1 : -1); return; }
      if (t.moved || t.holding) return;
      const rect = V.stage.getBoundingClientRect();
      if (t.x - rect.left < rect.width * 0.33) prev(); else next();
    };
    hit.addEventListener("pointerup", e => finish(e, false));
    hit.addEventListener("pointercancel", e => finish(e, true));
    hit.addEventListener("contextmenu", e => e.preventDefault());
  }
  function onViewerKey(e) {
    if (e.key === "Escape") { e.preventDefault(); if (V.sheet) V.sheet.close(); else closeViewer(); return; }
    if (e.target.matches("input, textarea")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    else if (e.key === "Tab") {
      const nodes = Array.from(V.root.querySelectorAll("button:not([hidden]):not([disabled]), input, [href]")).filter(el => el.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function closeViewer(opts = {}) {
    if (!V) return;
    const current = V;
    stopFrame();
    current.canvas?.video?.pause();
    current.canvas?.ro?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    current.root.remove();
    document.documentElement.classList.remove("tcs-lock");
    V = null;
    if (!opts.fromPop) releaseLayer(closeViewer);
    try { current.opener?.isConnected && current.opener.focus({ preventScroll: true }); } catch { /* ignore */ }
    renderAllRails();
    refresh(true);
  }
  function viewerSheet(title) {
    if (V.sheet) V.sheet.close();
    pause("sheet");
    V.modals.style.pointerEvents = "auto";
    const sheet = makeSheet(V.modals, { title, onClose: () => { if (!V) return; V.sheet = null; V.modals.style.pointerEvents = "none"; resume("sheet"); } });
    V.sheet = sheet;
    return sheet;
  }
  function action(iconName, label, onclick, { danger = false, hint = "" } = {}) {
    return h("button", { class: "tcs-action" + (danger ? " danger" : ""), type: "button", role: "menuitem", onclick },
      h("span", { html: icon(iconName) }), h("span", {}, label, hint ? h("small", { text: hint }) : null));
  }
  function openMenu() {
    const group = curGroup(), story = curStory();
    const sheet = viewerSheet("");
    sheet.el.setAttribute("role", "menu");
    if (story.mine) {
      sheet.body.append(
        action("eye", "Baxanlar", () => { sheet.close(); openViewers(); }),
        action("trash", "Story-ni sil", () => confirmDelete(sheet), { danger: true }));
    } else {
      sheet.body.append(
        action("plane", "DM ilə göndər", () => { sheet.close(); openShare(); }),
        action("mute", group.muted ? "Səssizdən çıxar" : "Səssizə al", () => setPref(group.muted ? "unmute" : "mute"), { hint: "Story-ləri lentin sonunda görünür, avtomatik açılmır" }),
        action("eyeoff", "Gizlət", () => setPref("hide"), { hint: `@${group.username} Story-ləri lentindən silinir` }),
        action("flag", "Şikayət et", () => reportStory(sheet), { danger: true }));
    }
  }
  async function confirmDelete(menuSheet) {
    menuSheet.close();
    const story = curStory();
    pause("sheet");
    const ok = await confirmSheet(V.modals, { title: "Story silinsin?", text: "Bu Story hamı üçün silinəcək və geri qaytarıla bilməz.", okLabel: "Sil", danger: true, onOpen: () => { V.modals.style.pointerEvents = "auto"; }, onClose: () => { if (V) V.modals.style.pointerEvents = "none"; } });
    if (!V) return;
    if (!ok) { resume("sheet"); return; }
    try {
      await req(`/api/stories/${encodeURIComponent(story.id)}`, { method: "DELETE" });
      const group = curGroup();
      group.stories = group.stories.filter(item => item.id !== story.id);
      if (!group.stories.length) {
        Rail.groups = Rail.groups.filter(g => g !== group);
        V.seq.splice(V.gi, 1);
        if (!V.seq.length) { resume("sheet"); closeViewer(); return; }
        V.gi = Math.min(V.gi, V.seq.length - 1); V.si = 0;
      } else V.si = Math.min(V.si, group.stories.length - 1);
      toast("Story silindi.");
      resume("sheet");
      showStory("fade");
    } catch (error) { resume("sheet"); vToast(error.message, true); }
  }
  async function setPref(actionName) {
    const group = curGroup();
    V.sheet?.close();
    try {
      await req(`/api/stories/prefs/${encodeURIComponent(group.username)}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ action: actionName }) });
      toast({ mute: "Story-lər səssizə alındı.", unmute: "Səssizdən çıxarıldı.", hide: "Story-lər gizlədildi." }[actionName]);
      if (actionName === "hide") Rail.groups = Rail.groups.filter(g => g !== group);
      else group.muted = actionName === "mute";
      closeViewer();
    } catch (error) { vToast(error.message, true); }
  }
  function reportStory(menuSheet) {
    const story = curStory();
    menuSheet.close();
    pause("sheet");
    const submit = window.TalkChatSocial && window.TalkChatSocial.submitReport;
    if (!submit) { resume("sheet"); vToast("Şikayət hazırda əlçatan deyil.", true); return; }
    Promise.resolve().then(() => submit("story", story.id)).catch(error => vToast(error.message, true)).finally(() => resume("sheet"));
  }
  async function openViewers() {
    const story = curStory();
    const sheet = viewerSheet(`${story.viewsCount} baxış`);
    sheet.body.append(h("div", { class: "tcs-note", text: "Yüklənir…" }));
    try {
      const data = await req(`/api/stories/${encodeURIComponent(story.id)}/viewers`);
      story.viewsCount = data.count; story.reactionsCount = data.reactionsCount;
      sheet.el.querySelector("h3").textContent = `${data.count} baxış${data.reactionsCount ? " · " + data.reactionsCount + " reaksiya" : ""}`;
      sheet.body.textContent = "";
      if (!data.viewers.length) sheet.body.append(h("div", { class: "tcs-note", text: "Hələ baxan yoxdur." }));
      data.viewers.forEach(person => sheet.body.append(h("div", { class: "tcs-row" },
        h("span", { class: "tcs-ring" }, h("span", { class: "tcs-ring-in" }, avatarNode(person))),
        h("div", { class: "tcs-row-main" }, h("b", { text: displayOf(person) }), h("small", { text: `@${person.username} · ${timeAgo(person.viewedAt)}` })),
        person.reaction ? h("span", { class: "tcs-react", text: person.reaction, "aria-label": "Reaksiya" }) : null)));
    } catch (error) { sheet.body.textContent = ""; sheet.body.append(h("div", { class: "tcs-note", text: error.message })); }
  }
  async function openShare() {
    const story = curStory();
    const sheet = viewerSheet("Story-ni göndər");
    const search = h("input", { class: "tcs-search", type: "search", placeholder: "İstifadəçi adı axtar…", "aria-label": "İstifadəçi adı", autocomplete: "off", autocapitalize: "off", maxlength: "20" });
    const list = h("div", { class: "tcs-sheet-body" });
    sheet.body.style.display = "flex"; sheet.body.style.flexDirection = "column";
    sheet.body.append(search, list);
    let friends = [];
    const sent = new Set();
    const sendTo = async (username, button) => {
      button.disabled = true; button.textContent = "…";
      try {
        await post(`/api/stories/${encodeURIComponent(story.id)}/share`, { username });
        sent.add(username); button.textContent = "Göndərildi ✓";
      } catch (error) { button.disabled = false; button.textContent = "Göndər"; vToast(error.message, true); }
    };
    const row = (person, label) => {
      const btn = h("button", { class: "tcs-btn primary", type: "button", text: sent.has(person.username) ? "Göndərildi ✓" : "Göndər", disabled: sent.has(person.username) });
      btn.addEventListener("click", () => sendTo(person.username, btn));
      return h("div", { class: "tcs-row" }, h("span", { class: "tcs-ring" }, h("span", { class: "tcs-ring-in" }, avatarNode(person))),
        h("div", { class: "tcs-row-main" }, h("b", { text: displayOf(person) }), h("small", { text: "@" + person.username })), btn);
    };
    const draw = () => {
      const q = search.value.trim().replace(/^@/, "").toLowerCase();
      list.textContent = "";
      const matches = friends.filter(f => !q || f.username.toLowerCase().includes(q) || (f.displayName || "").toLowerCase().includes(q));
      matches.forEach(f => list.append(row(f)));
      if (q && /^[a-zA-Z0-9_]{3,20}$/.test(q) && !friends.some(f => f.username.toLowerCase() === q))
        list.append(row({ username: q, displayName: "", avatar: "" }));
      if (!list.children.length) list.append(h("div", { class: "tcs-note", text: q ? "Nəticə yoxdur." : "Dostun yoxdur. İstifadəçi adını yazıb göndərə bilərsən." }));
    };
    search.addEventListener("input", draw);
    draw();
    try { friends = await req("/api/friends"); draw(); } catch { /* manual ad ilə davam */ }
  }

  /* ================= EDITOR ================= */
  let E = null;
  const IMG_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const VID_TYPES = ["video/mp4", "video/webm"];
  let uid = 0;

  function openEditor(opts = {}) {
    if (E) return;
    if (V) closeViewer();
    const root = h("div", { class: "tcs-editor", role: "dialog", "aria-modal": "true", "aria-label": "Story redaktoru", tabindex: "-1" });
    E = { root, opener: opts.opener, file: null, kind: "", url: "", background: "violet", overlays: [], sel: null, previewing: false, busy: false, step: "pick", dirty: false };
    const input = (id, accept, capture) => { const el = h("input", { type: "file", accept, hidden: true, "data-input": id }); if (capture) el.setAttribute("capture", capture); el.addEventListener("change", () => { const file = el.files && el.files[0]; el.value = ""; if (file) pickFile(file); }); return el; };
    E.inputs = { gallery: input("gallery", [...IMG_TYPES, ...VID_TYPES].join(",")), photo: input("photo", "image/*", "environment"), video: input("video", "video/*", "environment") };
    root.append(E.inputs.gallery, E.inputs.photo, E.inputs.video);
    document.body.append(root);
    document.documentElement.classList.add("tcs-lock");
    root.addEventListener("keydown", e => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); requestClose(); } });
    pushLayer(closeEditorLayer);
    showPicker();
    root.focus({ preventScroll: true });
  }
  function closeEditorLayer(opts) { if (opts && opts.fromPop) { if (E && (E.dirty && !E.busy)) { E.stale = true; } } requestClose(opts); }
  async function requestClose(opts = {}) {
    if (!E) return;
    if (E.busy) { if (opts.fromPop) pushLayer(closeEditorLayer); return; }
    if (E.dirty) {
      if (E.confirming) return;
      E.confirming = true;
      const ok = await confirmSheet(E.root, { title: "Story silinsin?", text: "Etdiyin dəyişikliklər itəcək.", okLabel: "Sil", danger: true });
      if (!E) return;
      E.confirming = false;
      if (!ok) { if (opts.fromPop) pushLayer(closeEditorLayer); return; }
    }
    destroyEditor(opts);
  }
  function destroyEditor(opts = {}) {
    if (!E) return;
    const current = E;
    if (current.url) URL.revokeObjectURL(current.url);
    current.ro?.disconnect();
    current.canvas?.video?.pause();
    current.root.remove();
    document.documentElement.classList.remove("tcs-lock");
    E = null;
    if (!opts.fromPop) releaseLayer(closeEditorLayer);
    try { current.opener?.isConnected && current.opener.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
  function clearRoot() { Array.from(E.root.children).forEach(child => { if (!child.matches("input[type=file]")) child.remove(); }); }
  const chromeBtn = (iconName, label, onclick, cls = "") => h("button", { class: "tcs-icon-btn " + cls, type: "button", "aria-label": label, title: label, html: icon(iconName), onclick });

  function showPicker() {
    E.step = "pick"; clearRoot();
    const tile = (iconName, title, sub, onclick) => h("button", { class: "tcs-tile", type: "button", onclick }, h("span", { class: "badge", html: icon(iconName) }), h("span", {}, h("b", { text: title }), h("small", { text: sub })));
    E.root.append(
      h("div", { class: "tcs-editor-chrome" }, chromeBtn("close", "Bağla", () => requestClose()), h("h2", { text: "Yeni Story" }), h("span", { style: { width: "42px" } })),
      h("div", { class: "tcs-picker" },
        h("h1", { text: "Nə paylaşmaq istəyirsən?" }), h("p", { text: "Story 24 saat görünür, sonra avtomatik silinir." }),
        tile("image", "Qalereya", "Foto və ya video seç", () => E.inputs.gallery.click()),
        tile("camera", "Foto çək", "Kamera ilə yeni şəkil", () => E.inputs.photo.click()),
        tile("video", "Video çək", "Kamera ilə yeni video", () => E.inputs.video.click()),
        tile("text", "Mətn Story", "Rəngli və ya gradient fonda yaz", () => { E.dirty = true; showEditor(); addText(); }),
        h("div", { class: "tcs-status err", id: "tcsPickErr", role: "alert" })));
  }
  function pickError(message) {
    const el = E.root.querySelector("#tcsPickErr, .tcs-status");
    if (el) { el.textContent = message; el.classList.add("err"); }
    toast(message, "error");
  }
  async function pickFile(file) {
    if (!E) return;
    const isImage = IMG_TYPES.includes(file.type), isVideo = VID_TYPES.includes(file.type);
    if (!isImage && !isVideo) return pickError("Yalnız JPG, PNG, WebP, GIF, MP4 və ya WebM faylı seç.");
    if (isVideo && file.size > 30 * 1024 * 1024) return pickError("Video maksimum 30 MB ola bilər.");
    if (isImage && file.size > 40 * 1024 * 1024) return pickError("Şəkil çox böyükdür.");
    if (E.url) URL.revokeObjectURL(E.url);
    E.file = file; E.kind = isVideo ? "video" : "image"; E.url = URL.createObjectURL(file); E.dirty = true;
    showEditor();
  }
  // Böyük kamera şəkillərini göndərməzdən əvvəl kiçildir (server limiti 12 MB).
  async function prepareImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= 3.5 * 1024 * 1024) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 2160 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.88));
      if (blob && blob.size < file.size) return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
    } catch { /* orijinal faylla davam */ }
    return file;
  }

  function draftStory() {
    return { media: E.url, mediaType: E.kind, background: E.background, overlays: E.overlays, text: "", createdAt: new Date().toISOString() };
  }
  const selected = () => E.overlays.find(o => o._id === E.sel) || null;

  function showEditor() {
    E.step = "edit"; E.previewing = false; clearRoot();
    E.root.classList.remove("previewing");
    const hasMedia = !!E.file;
    const tools = h("div", { class: "tcs-tools" },
      chromeBtn("text", "Mətn əlavə et", () => addText()),
      chromeBtn("smile", "Emoji və stiker", openStickerSheet),
      hasMedia ? chromeBtn("swap", "Mediyanı dəyiş", () => E.inputs.gallery.click()) : chromeBtn("palette", "Fon", () => { E.sel = null; renderPanel(); }, "bg-tool"));
    E.chrome = h("div", { class: "tcs-editor-chrome" }, chromeBtn("back", "Geri", () => { if (E.overlays.length || E.file) requestClose(); else showPicker(); }), h("h2", { text: "Story" }), tools);
    E.wrap = h("div", { class: "tcs-stage-wrap" });
    E.panel = h("div", { class: "tcs-panel" });
    E.root.append(E.chrome, E.wrap, E.panel);
    renderStage(); renderPanel();
  }
  function renderStage() {
    E.canvas?.video?.pause(); E.ro?.disconnect();
    E.wrap.textContent = "";
    const stage = h("div", { class: "tcs-estage" });
    const canvas = renderCanvas({ ...draftStory(), overlays: [] }, { manualOverlays: true, loopVideo: true });
    E.canvas = canvas; E.stage = stage;
    stage.append(canvas.el);
    E.trash = h("div", { class: "tcs-trash", html: icon("trash"), "aria-hidden": "true" });
    stage.append(E.trash);
    stage.addEventListener("pointerdown", e => { if (e.target === stage || e.target.closest(".tcs-canvas") && !e.target.closest(".tcs-ov")) { if (E.sel) { E.sel = null; renderOverlays(); renderPanel(); } } });
    E.wrap.append(stage);
    renderOverlays();
  }
  function renderOverlays() {
    const layer = E.canvas.overlays;
    layer.textContent = "";
    for (const o of E.overlays) {
      const node = overlayNode(o, { createdAt: new Date() });
      node.dataset.id = o._id;
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", "0");
      node.setAttribute("aria-label", o.type === "text" ? `Mətn: ${o.text}` : o.type === "emoji" ? `Emoji ${o.emoji}` : "Stiker");
      if (E.sel === o._id && !E.previewing) node.classList.add("sel");
      node.addEventListener("pointerdown", e => startDrag(e, o, node));
      node.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectOverlay(o._id); } else if (e.key === "Delete" || e.key === "Backspace") { if (e.target === node) { e.preventDefault(); removeOverlay(o._id); } } });
      layer.append(node);
    }
  }
  function selectOverlay(id) { E.sel = id; renderOverlays(); renderPanel(); }
  function startDrag(e, o, node) {
    if (E.previewing) return;
    e.preventDefault(); e.stopPropagation();
    const rect = E.stage.getBoundingClientRect();
    const wasSelected = E.sel === o._id;
    const drag = { id: e.pointerId, ox: o.x - (e.clientX - rect.left) / rect.width, oy: o.y - (e.clientY - rect.top) / rect.height, moved: false, sx: e.clientX, sy: e.clientY };
    try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!wasSelected) { E.sel = o._id; node.parentElement.querySelectorAll(".sel").forEach(n => n.classList.remove("sel")); node.classList.add("sel"); renderPanel(); }
    const move = ev => {
      if (ev.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 6) return;
      if (!drag.moved) { drag.moved = true; node.classList.add("dragging"); E.trash.classList.add("show"); }
      const pos = clampPos(drag.ox + (ev.clientX - rect.left) / rect.width, drag.oy + (ev.clientY - rect.top) / rect.height);
      o.x = pos.x; o.y = pos.y; node.style.left = pos.x * 100 + "%"; node.style.top = pos.y * 100 + "%";
      const t = E.trash.getBoundingClientRect();
      E.trash.classList.toggle("hot", ev.clientX > t.left - 14 && ev.clientX < t.right + 14 && ev.clientY > t.top - 14 && ev.clientY < t.bottom + 14);
    };
    const up = ev => {
      if (ev.pointerId !== drag.id) return;
      node.removeEventListener("pointermove", move); node.removeEventListener("pointerup", up); node.removeEventListener("pointercancel", up);
      const hot = E.trash.classList.contains("hot");
      E.trash.classList.remove("show", "hot"); node.classList.remove("dragging");
      if (hot && drag.moved) { removeOverlay(o._id); return; }
      if (!drag.moved && wasSelected && o.type === "text") E.panel.querySelector(".tcs-textarea")?.focus();
      if (drag.moved) E.dirty = true;
    };
    node.addEventListener("pointermove", move); node.addEventListener("pointerup", up); node.addEventListener("pointercancel", up);
  }
  function addOverlay(o) {
    if (E.overlays.length >= 20) { toast("Story-də ən çox 20 element ola bilər.", "error"); return null; }
    const item = { _id: ++uid, x: 0.5, y: 0.45, size: 34, ...o };
    // Üst-üstə düşməsin deyə kiçik sürüşdürmə
    item.y = clamp(item.y + (E.overlays.length % 5) * 0.06, 0.12, 0.86);
    E.overlays.push(item); E.sel = item._id; E.dirty = true;
    renderOverlays(); renderPanel();
    return item;
  }
  function addText() {
    const item = addOverlay({ type: "text", text: "", color: "#ffffff", align: "center", bg: "none", size: 36 });
    if (item) { renderOverlays(); setTimeout(() => E?.panel.querySelector(".tcs-textarea")?.focus(), 60); }
  }
  function removeOverlay(id) {
    E.overlays = E.overlays.filter(o => o._id !== id);
    if (E.sel === id) E.sel = null;
    renderOverlays(); renderPanel();
  }
  function openStickerSheet() {
    const sheet = makeSheet(E.root, { title: "Emoji və stiker" });
    let tab = "emoji";
    const body = h("div");
    const tabs = h("div", { class: "tcs-tabs" });
    const draw = () => {
      tabs.textContent = ""; body.textContent = "";
      [["emoji", "Emoji"], ["sticker", "Stiker"]].forEach(([id, label]) => tabs.append(h("button", { type: "button", class: tab === id ? "on" : "", text: label, onclick: () => { tab = id; draw(); } })));
      if (tab === "emoji") {
        const grid = h("div", { class: "tcs-grid" });
        EMOJIS.forEach(emoji => grid.append(h("button", { type: "button", "aria-label": emoji, text: emoji, onclick: () => { addOverlay({ type: "emoji", emoji, size: 64 }); sheet.close(); } })));
        body.append(grid);
      } else {
        const grid = h("div", { class: "tcs-stk-grid" });
        STICKERS.forEach(stk => { const preview = overlayNode({ type: "sticker", sticker: stk.id, x: 0, y: 0, size: 1 }, { createdAt: new Date() }); preview.style.fontSize = "15px"; preview.style.left = preview.style.top = "auto";
          grid.append(h("button", { type: "button", "aria-label": `${stk.label} stikeri`, onclick: () => { addOverlay({ type: "sticker", sticker: stk.id, size: 28 }); sheet.close(); } }, preview)); });
        body.append(grid);
      }
    };
    sheet.body.append(tabs, h("div", { style: { height: "12px" } }), body);
    draw();
  }
  function renderPanel() {
    const panel = E.panel; panel.textContent = "";
    const o = selected();
    if (!o) {
      if (!E.file) {
        const row = h("div", { class: "tcs-panel-row scroll", role: "radiogroup", "aria-label": "Fon" });
        BACKGROUNDS.forEach(id => row.append(h("button", { type: "button", role: "radio", "aria-checked": String(E.background === id), "aria-label": `Fon: ${id}`, class: `tcs-bgsw tcs-bg-${id}${E.background === id ? " on" : ""}`, onclick: () => { E.background = id; E.dirty = true; E.canvas.el.className = E.canvas.el.className.replace(/tcs-bg-\w+/, "tcs-bg-" + id); renderPanel(); } })));
        panel.append(row);
      }
      panel.append(
        h("div", { class: "tcs-status", id: "tcsStatus", role: "status" }),
        h("div", { class: "tcs-actions" },
          h("button", { class: "tcs-btn", type: "button", text: "Önizləmə", onclick: showPreview }),
          h("button", { class: "tcs-btn primary", type: "button", text: "Paylaş", onclick: publish })));
      return;
    }
    const update = fn => { fn(o); E.dirty = true; const node = E.canvas.overlays.querySelector(`[data-id="${o._id}"]`); if (node) { const fresh = overlayNode(o, { createdAt: new Date() }); fresh.dataset.id = o._id; fresh.classList.add("sel"); fresh.setAttribute("role", "button"); fresh.setAttribute("tabindex", "0"); fresh.addEventListener("pointerdown", ev => startDrag(ev, o, fresh)); node.replaceWith(fresh); } };
    if (o.type === "text") {
      const ta = h("textarea", { class: "tcs-textarea", maxlength: "200", rows: "2", placeholder: "Yaz…", "aria-label": "Story mətni" });
      ta.value = o.text;
      ta.addEventListener("input", () => update(item => { item.text = ta.value; }));
      panel.append(ta);
      const swatches = h("div", { class: "tcs-panel-row scroll", role: "radiogroup", "aria-label": "Mətn rəngi" });
      COLORS.forEach(color => { const b = h("button", { type: "button", role: "radio", "aria-checked": String(o.color === color), "aria-label": `Rəng ${color}`, class: "tcs-swatch" + (o.color === color ? " on" : "") }); b.style.background = color; b.addEventListener("click", () => { update(item => { item.color = color; }); swatches.querySelectorAll(".tcs-swatch").forEach(s => s.classList.toggle("on", s === b)); }); swatches.append(b); });
      panel.append(swatches);
      const seg = (name, values, current, apply) => { const wrap = h("div", { class: "tcs-seg", role: "group", "aria-label": name }); values.forEach(([value, iconName, label]) => { const b = h("button", { type: "button", "aria-label": label, "aria-pressed": String(current() === value), class: current() === value ? "on" : "", html: icon(iconName) }); b.addEventListener("click", () => { apply(value); wrap.querySelectorAll("button").forEach((x, i) => { const on = values[i][0] === value; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); }); }); wrap.append(b); }); return wrap; };
      panel.append(h("div", { class: "tcs-panel-row" },
        seg("Hizalanma", [["left", "alignL", "Sola"], ["center", "alignC", "Mərkəzə"], ["right", "alignR", "Sağa"]], () => o.align, value => update(item => { item.align = value; })),
        seg("Mətn fonu", [["none", "text", "Fonsuz"], ["solid", "box", "Dolu fon"], ["soft", "stack", "Yumşaq fon"]], () => o.bg, value => update(item => { item.bg = value; })),
        sizeRange(o, update)));
    } else {
      panel.append(h("div", { class: "tcs-panel-row" }, sizeRange(o, update)));
    }
    panel.append(h("div", { class: "tcs-actions" },
      h("button", { class: "tcs-btn danger", type: "button", html: icon("trash") + " Sil", style: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px" }, onclick: () => removeOverlay(o._id) }),
      h("button", { class: "tcs-btn primary", type: "button", text: "Hazırdır", onclick: () => { if (o.type === "text" && !o.text.trim()) { removeOverlay(o._id); return; } E.sel = null; renderOverlays(); renderPanel(); } })));
  }
  function sizeRange(o, update) {
    const range = h("input", { class: "tcs-range", type: "range", min: "14", max: "120", step: "1", value: String(o.size), "aria-label": "Ölçü" });
    range.addEventListener("input", () => update(item => { item.size = Number(range.value); }));
    return range;
  }

  function showPreview() {
    if (!hasContent()) { setStatus("Mətn və ya emoji əlavə et.", true); return; }
    E.previewing = true; E.sel = null; E.root.classList.add("previewing");
    E.chrome.hidden = true;
    renderOverlays();
    E.canvas.overlays.querySelectorAll(".tcs-ov").forEach(n => { n.style.pointerEvents = "none"; });
    const mini = { username: Rail.me?.username || "", displayName: "Sən", avatar: Rail.me?.avatar || "" };
    const preview = h("div", { class: "tcs-preview-top" }, h("div", { class: "tcs-bars" }, h("span", { class: "tcs-bar" }, h("i"))),
      h("div", { class: "tcs-head" }, h("span", { class: "tcs-ring" }, h("span", { class: "tcs-ring-in" }, avatarNode(mini))), h("span", { class: "tcs-head-line" }, h("span", { class: "tcs-head-name", text: "Sən" }), h("span", { class: "tcs-head-time", text: "İndi" }))));
    E.stage.append(h("div", { class: "tcs-scrim-top" }), preview);
    E.canvas.video?.play?.().catch(() => {});
    E.panel.textContent = "";
    E.panel.append(h("div", { class: "tcs-status", id: "tcsStatus", role: "status" }),
      h("div", { class: "tcs-actions" },
        h("button", { class: "tcs-btn", type: "button", text: "Geri", onclick: showEditor }),
        h("button", { class: "tcs-btn primary", type: "button", text: "Paylaş", onclick: publish })));
  }
  function hasContent() { return !!E.file || E.overlays.some(o => o.type !== "text" || o.text.trim()); }
  function setStatus(message, isError) {
    const el = E.root.querySelector("#tcsStatus");
    if (el) { el.textContent = message; el.classList.toggle("err", !!isError); }
  }
  function serializeOverlays() {
    return E.overlays.filter(o => o.type !== "text" || o.text.trim()).map(({ _id, ...rest }) => ({ ...rest, text: rest.text ? rest.text.trim() : undefined }));
  }
  async function publish() {
    if (!E || E.busy) return;
    if (!hasContent()) { setStatus("Mətn və ya emoji əlavə et.", true); return; }
    if (!E.file && !serializeOverlays().length) { setStatus("Mətn və ya emoji əlavə et.", true); return; }
    E.busy = true;
    const buttons = E.panel.querySelectorAll("button");
    buttons.forEach(b => { b.disabled = true; });
    setStatus("Hazırlanır…");
    try {
      const data = new FormData();
      if (E.file) data.append("media", await prepareImage(E.file));
      else data.append("background", E.background);
      data.append("overlays", JSON.stringify(serializeOverlays()));
      const bar = h("div", { class: "tcs-progress", role: "progressbar", "aria-label": "Yükləmə" }, h("i"));
      E.panel.insertBefore(bar, E.panel.firstChild);
      await upload("/api/stories", data, percent => { bar.firstChild.style.width = percent + "%"; setStatus(`Yüklənir… ${percent}%`); });
      toast("Story paylaşıldı! 24 saat sonra silinəcək.");
      E.dirty = false; E.busy = false;
      destroyEditor();
      refresh(true);
    } catch (error) {
      if (!E) return;
      E.busy = false;
      E.panel.querySelector(".tcs-progress")?.remove();
      E.panel.querySelectorAll("button").forEach(b => { b.disabled = false; });
      setStatus(error.message || "Story paylaşılmadı.", true);
      toast(error.message || "Story paylaşılmadı.", "error");
    }
  }
  function upload(url, data, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url); xhr.withCredentials = true;
      xhr.upload.addEventListener("progress", e => { if (e.lengthComputable) onProgress(Math.min(100, Math.round(e.loaded / e.total * 100))); });
      xhr.addEventListener("load", () => {
        let body = {}; try { body = JSON.parse(xhr.responseText || "{}"); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body); else reject(new Error(body.error || "Xəta baş verdi."));
      });
      xhr.addEventListener("error", () => reject(new Error("Yükləmə alınmadı. Yenidən yoxla.")));
      xhr.addEventListener("timeout", () => reject(new Error("Yükləmə çox çəkdi. Yenidən yoxla.")));
      xhr.timeout = 180000;
      xhr.send(data);
    });
  }

  /* ================= INIT ================= */
  function init() {
    const host = document.getElementById("tcStoryRail");
    if (host) mountRail(host);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.TalkChatStories = {
    mountRail, refresh, openEditor, hasStory, markDirectRail,
    openUser: username => hasStory(username) && openGroup(username, document.activeElement),
    _core: core
  };
})();
