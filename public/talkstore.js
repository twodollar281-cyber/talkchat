(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const KEY = "tcStoreCollected", FAV_KEY = "tcStoreFavorites", APPLIED_KEY = "tcStoreApplied", PREV_KEY = "tcStorePrevTheme";

  /* Static catalog. Everything is free; nothing here charges money or fakes a purchase. */
  const CATALOG = {
    apps: [
      { id: "app-player", icon: "🎵", name: "TalkPlayer", desc: "Cihazındakı mahnıları oxut, arxa fonda dinlə.", page: "player" },
      { id: "app-live", icon: "●", name: "Canlı yayımlar", desc: "Dostlarınla canlı yayım başlat və izlə.", page: "live" },
      { id: "app-reels", icon: "▶", name: "Reels", desc: "Qısa videolar paylaş və kəşf et.", page: "reels" },
      { id: "app-ai", icon: "✦", name: "TalkChat AI", desc: "Köməkçi ilə söhbət et.", page: "ai" },
      { id: "app-messages", icon: "▣", name: "Mesajlar", desc: "Fərdi və qrup söhbətləri, səsli və video zənglər.", page: "messages" }
    ],
    themes: [
      { id: "theme-cyber", pop: true, name: "Cyber Night Theme", desc: "Müasir və qaranlıq mövzu. TalkChat-ı daha gözəl və stil sahibi edir.", theme: { background: "#120a2a", incoming: "#2a1b52", outgoing: "#8b3dff", incomingText: "#f3ecff", outgoingText: "#ffffff", bubbleStyle: "rounded" } },
      { id: "theme-royal", pop: true, name: "Royal Crown Theme", desc: "Qızılı vurğulu zərif tünd mövzu.", theme: { background: "#16110a", incoming: "#2d2412", outgoing: "#f5b942", incomingText: "#fff6e0", outgoingText: "#1c1303", bubbleStyle: "rounded" } },
      { id: "theme-midnight", name: "Midnight", desc: "Tünd göy fon, mavi bubble.", theme: { background: "#10101a", incoming: "#202033", outgoing: "#36c5ff", incomingText: "#ffffff", outgoingText: "#06121a", bubbleStyle: "rounded" } },
      { id: "theme-violet", pop: true, name: "Violet Night", desc: "TalkChat bənövşəyisi.", theme: { background: "#17112b", incoming: "#2a2149", outgoing: "#7c5cff", incomingText: "#f2eeff", outgoingText: "#ffffff", bubbleStyle: "rounded" } },
      { id: "theme-forest", name: "Forest", desc: "Sakit yaşıl tonlar.", theme: { background: "#0e1a15", incoming: "#1b2e25", outgoing: "#2ea36b", incomingText: "#e8fff3", outgoingText: "#ffffff", bubbleStyle: "soft" } },
      { id: "theme-sunset", name: "Sunset", desc: "İsti narıncı vurğu.", theme: { background: "#1c1210", incoming: "#33201a", outgoing: "#ff7a45", incomingText: "#fff1ea", outgoingText: "#1c0d07", bubbleStyle: "rounded" } },
      { id: "theme-paper", name: "Paper", desc: "Açıq fon, düz künclər.", theme: { background: "#f4f4f8", incoming: "#ffffff", outgoing: "#4f6bff", incomingText: "#1b1b24", outgoingText: "#ffffff", bubbleStyle: "square" } }
    ],
    items: [
      { id: "item-frame-neon", kind: "frame", pop: true, fresh: true, name: "Neon Çərçivə", desc: "Mavi neon işıqlı profil çərçivəsi.", ring: ["#2f7bff", "#8a3dff"], crown: true },
      { id: "item-frame-galaxy", kind: "frame", pop: true, fresh: true, name: "Qalaktika", desc: "Ulduzlu bənövşəyi qalaktika halqası.", ring: ["#c04dff", "#36c5ff"] },
      { id: "item-frame-royal", kind: "frame", fresh: true, name: "Şahzadə Çərçivəsi", desc: "Qızılı yarpaqlı kral çərçivəsi.", ring: ["#ffd45e", "#c8901a"], crown: true },
      { id: "item-frame-cyber", kind: "frame", fresh: true, name: "Kiber Çərçivə", desc: "Elektrik göy-bənövşəyi kiber halqa.", ring: ["#36c5ff", "#7c3aed"] },
      { id: "item-badge-star", kind: "badge", icon: "⭐", name: "Ulduz nişanı", desc: "Kolleksiyana əlavə et." },
      { id: "item-badge-fire", kind: "badge", icon: "🔥", name: "Alov nişanı", desc: "Kolleksiyana əlavə et." },
      { id: "item-pack-cats", kind: "pack", pop: true, icon: "🐱", name: "Pişik emoji paketi", desc: "🐱 😺 😸 😻 🙀", emojis: ["🐱", "😺", "😸", "😻", "🙀", "😹"] },
      { id: "item-pack-food", kind: "pack", name: "Yemək emoji paketi", desc: "🍕 🍔 🍟 🍩 🍉", icon: "🍕", emojis: ["🍕", "🍔", "🍟", "🍩", "🍉", "🌮"] },
      { id: "item-pack-space", kind: "pack", fresh: true, name: "Kosmos emoji paketi", desc: "🚀 🌙 ⭐ 🪐 ☄️", icon: "🚀", emojis: ["🚀", "🌙", "⭐", "🪐", "☄️", "🛸"] }
    ]
  };

  const TABS = {
    themes: { title: "Mövzular", kind: "theme" },
    stickers: { title: "Stiker Paketləri", kind: "pack" },
    frames: { title: "Profil Çərçivələri", kind: "frame" },
    all: { title: "Bütün Məhsullar", kind: "all" }
  };
  const SVG = {
    dl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 4.8 6.8 4.8c2 0 3.5 1.1 5.2 3 1.7-1.9 3.2-3 5.2-3 3.2 0 5.1 3.2 4 6.4-1.7 4.7-9.2 9.3-9.2 9.3z"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z"/></svg>',
    open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>'
  };

  const readSet = k => { try { const v = JSON.parse(localStorage.getItem(k) || "[]"); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } };
  const writeSet = (k, set) => { try { localStorage.setItem(k, JSON.stringify([...set])); } catch {} };
  const readStr = k => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  const writeStr = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} };

  let view = "home", tab = "themes", sort = "popular", query = "", current = null, from = "home";
  let collected = readSet(KEY), favs = readSet(FAV_KEY), applied = readStr(APPLIED_KEY);
  let prevTheme = null;
  try { const p = JSON.parse(localStorage.getItem(PREV_KEY) || "null"); if (isTheme(p)) prevTheme = p; } catch {}
  const save = () => writeSet(KEY, collected);

  const all = () => [...CATALOG.themes.map(x => ({ ...x, type: "theme" })), ...CATALOG.items.map(x => ({ ...x, type: x.kind })), ...CATALOG.apps.map(x => ({ ...x, type: "app" }))];
  const byType = kind => all().filter(x => x.type === kind || (kind === "frame" && x.type === "badge"));
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const svgSpan = (html, cls) => { const s = el("span", cls); s.setAttribute("aria-hidden", "true"); s.innerHTML = html; return s; };
  function isTheme(t) { return !!t && typeof t === "object" && ["background", "incoming", "outgoing", "incomingText", "outgoingText"].every(k => /^#[0-9a-fA-F]{6}$/.test(String(t[k] || ""))) && ["rounded", "soft", "square"].includes(t.bubbleStyle); }
  const isDark = hex => { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) < 140; };
  const toast = msg => {
    const region = $("tcToastRegion"); if (!region) return;
    const node = el("div", "tc-toast", msg);
    region.appendChild(node); setTimeout(() => node.remove(), 3200);
  };

  /* ---------- theme API (unchanged contract) ---------- */
  async function applyTheme(item) {
    try {
      let before = null;
      try {
        const g = await fetch("/api/chat-themes/default", { credentials: "same-origin" });
        if (g.ok) { const gb = await g.json().catch(() => null); const cand = gb && (gb.theme || gb); if (isTheme(cand)) before = { background: cand.background, incoming: cand.incoming, outgoing: cand.outgoing, incomingText: cand.incomingText, outgoingText: cand.outgoingText, bubbleStyle: cand.bubbleStyle }; }
      } catch {}
      const res = await fetch("/api/chat-themes/default", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.theme) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Mövzu tətbiq olunmadı.");
      if (before && JSON.stringify(before) !== JSON.stringify(item.theme)) { prevTheme = before; try { localStorage.setItem(PREV_KEY, JSON.stringify(before)); } catch {} }
      applied = item.id; writeStr(APPLIED_KEY, applied);
      toast(item.name + " standart söhbət mövzusu oldu.");
      try { window.TalkChatThemes?.reload?.(); } catch {}
      return true;
    } catch (e) { toast(e.message); return false; }
  }
  async function revertTheme() {
    if (!prevTheme) return;
    try {
      const res = await fetch("/api/chat-themes/default", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prevTheme) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Əvvəlki mövzu bərpa olunmadı.");
      applied = ""; writeStr(APPLIED_KEY, ""); prevTheme = null; writeStr(PREV_KEY, "");
      toast("Əvvəlki mövzu bərpa olundu.");
      try { window.TalkChatThemes?.reload?.(); } catch {}
      go("home");
    } catch (e) { toast(e.message); }
  }

  /* ---------- art ---------- */
  function themeArt(item, big) {
    const a = el("div", "ts-art ts-theme-art" + (big ? " big" : "")); a.setAttribute("aria-hidden", "true");
    const t = item.theme; a.style.setProperty("--bg", t.background); a.style.setProperty("--in", t.incoming); a.style.setProperty("--out", t.outgoing);
    a.style.setProperty("--in-t", t.incomingText); a.style.setProperty("--out-t", t.outgoingText);
    a.append(el("i", "glow"), el("i", "bub l"), el("i", "bub r"), el("i", "bub l s"));
    if (big) { const bar = el("div", "ts-phone-bar"); bar.append(el("i"), el("b", null, "TalkChat"), el("small", null, "online")); a.prepend(bar); }
    return a;
  }
  function frameArt(item, big) {
    const a = el("div", "ts-art ts-frame-art" + (big ? " big" : "")); a.setAttribute("aria-hidden", "true");
    const ring = el("div", "ts-ring"); ring.style.setProperty("--c1", item.ring[0]); ring.style.setProperty("--c2", item.ring[1]);
    ring.append(el("i", "spark s1"), el("i", "spark s2")); if (item.crown) ring.appendChild(el("span", "crown", "👑"));
    a.appendChild(ring); return a;
  }
  function packArt(item, big) {
    const a = el("div", "ts-art ts-pack-art" + (big ? " big" : "")); a.setAttribute("aria-hidden", "true");
    (item.emojis || [item.icon]).slice(0, big ? 6 : 4).forEach(e => a.appendChild(el("span", null, e)));
    return a;
  }
  function badgeArt(item) { const a = el("div", "ts-art ts-badge-art"); a.setAttribute("aria-hidden", "true"); a.appendChild(el("span", null, item.icon)); return a; }
  function art(item, big) { return item.type === "theme" ? themeArt(item, big) : item.type === "frame" ? frameArt(item, big) : item.type === "pack" ? packArt(item, big) : badgeArt(item); }

  /* ---------- state helpers ---------- */
  const isOwned = item => item.type === "theme" ? applied === item.id : collected.has(item.id);
  function collect(item) {
    if (collected.has(item.id)) return;
    collected.add(item.id); save(); toast(item.name + " kolleksiyaya əlavə olundu."); render();
  }
  function toggleFav(item) {
    if (favs.has(item.id)) { favs.delete(item.id); toast("Sevimlilərdən çıxarıldı."); } else { favs.add(item.id); toast(item.name + " sevimlilərə əlavə olundu."); }
    writeSet(FAV_KEY, favs); render();
  }
  function go(v) {
    if (v === "detail" && (view === "home" || view === "list")) from = view;
    view = v; render(); window.scrollTo?.(0, 0);
  }
  function back() {
    if (view === "apply") return go("detail");
    if (view === "detail") return go(from === "list" ? "list" : "home");
    if (view === "done") return go("home");
    if (view === "list") { query = ""; const s = $("tcStoreSearch"); if (s) s.value = ""; return go("home"); }
  }
  function openCategory(t, s) { tab = TABS[t] ? t : "themes"; sort = s || "popular"; go("list"); }
  function open(name) { query = ""; const s = $("tcStoreSearch"); if (s) s.value = ""; openCategory(name === "looks" ? "themes" : name); }

  /* ---------- views ---------- */
  function card(item) {
    const li = el("li", "ts-card tc-store-card" + (isOwned(item) ? " owned" : ""));
    const hit = el("button", "ts-card-hit"); hit.type = "button"; hit.setAttribute("aria-label", item.name);
    hit.onclick = () => { current = item; go("detail"); };
    if (item.type === "app") {
      li.classList.add("app");
      const icon = el("span", "ts-app-ico", item.icon); icon.setAttribute("aria-hidden", "true");
      const info = el("div", "ts-app-info"); info.append(el("b", null, item.name), el("small", null, item.desc));
      const btn = el("button", "ts-pill-btn tc-store-btn", "Aç"); btn.type = "button"; btn.onclick = () => window.showPage && window.showPage(item.page);
      li.append(icon, info, btn); return li;
    }
    const a = art(item, false);
    if (isOwned(item)) { const ok = svgSpan(SVG.check, "ts-badge-ok"); a.appendChild(ok); }
    const name = el("b", "ts-card-name", item.name);
    const meta = el("div", "ts-card-meta");
    const free = el("span", "ts-free"); free.append(svgSpan(SVG.star, "ts-star-ico"), el("span", null, "Pulsuz"));
    const dl = el("button", "ts-dl"); dl.type = "button"; dl.setAttribute("aria-label", item.type === "theme" ? item.name + " — ətraflı" : collected.has(item.id) ? "Kolleksiyadadır" : item.name + " — yüklə");
    dl.innerHTML = item.type !== "theme" && collected.has(item.id) ? SVG.check : SVG.dl;
    dl.onclick = e => { e.stopPropagation(); if (item.type === "theme") { current = item; go("detail"); } else collect(item); };
    meta.append(free, dl);
    li.append(a, name, meta, hit); return li;
  }

  function listItems() {
    const q = query.trim().toLowerCase();
    let rows = tab === "all" || q ? all() : byType(TABS[tab].kind);
    if (!q && tab === "all") rows = rows.filter(x => x.type !== "app");
    if (q) rows = rows.filter(x => (x.name + " " + x.desc).toLowerCase().includes(q));
    if (sort === "mine") rows = rows.filter(x => x.type !== "app" && (collected.has(x.id) || favs.has(x.id) || applied === x.id));
    else if (sort === "new") rows = rows.filter(x => x.fresh).concat(rows.filter(x => !x.fresh));
    else rows = rows.filter(x => x.pop).concat(rows.filter(x => !x.pop));
    return rows;
  }

  function renderHome() {
    const pop = $("tcStorePopular"), apps = $("tcStoreApps"); if (!pop || !apps) return;
    pop.textContent = ""; apps.textContent = "";
    all().filter(x => x.pop).slice(0, 4).forEach(x => pop.appendChild(card(x)));
    CATALOG.apps.forEach(x => apps.appendChild(card({ ...x, type: "app" })));
  }

  function renderList() {
    const list = $("tcStoreList"); if (!list) return;
    list.textContent = "";
    const rows = listItems();
    rows.forEach(x => list.appendChild(card(x)));
    const empty = $("tcStoreEmpty"); if (empty) { empty.hidden = rows.length > 0; empty.textContent = sort === "mine" && !query ? "Hələ heç nə əlavə etməmisən." : "Heç nə tapılmadı."; }
    document.querySelectorAll("[data-store-sort]").forEach(b => { const on = b.dataset.storeSort === sort; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
  }

  function checklist(item) {
    const ul = el("ul", "ts-checks");
    let rows;
    if (item.type === "theme") rows = ["Tam tətbiq mövzusu", isDark(item.theme.background) ? "Qaranlıq dizayn" : "Açıq dizayn", "Bubble üslubu: " + ({ rounded: "yumru", soft: "yumşaq", square: "düz" })[item.theme.bubbleStyle]];
    else if (item.type === "frame") rows = ["Profil üçün çərçivə dizaynı", "Kolleksiyana əlavə olunur", "Tamamilə pulsuz"];
    else if (item.type === "pack") rows = [(item.emojis || []).length + " emoji", "Kolleksiyana əlavə olunur", "Tamamilə pulsuz"];
    else rows = ["Kolleksiyana əlavə olunur", "Tamamilə pulsuz"];
    rows.forEach(r => { const li = el("li"); li.append(svgSpan(SVG.check, "ts-check"), el("span", null, r)); ul.appendChild(li); });
    return ul;
  }

  function renderDetail() {
    const box = $("tcStoreDetail"); if (!box || !current) return;
    box.textContent = "";
    const item = current, hero = el("div", "ts-detail-hero " + item.type);
    hero.appendChild(art(item, true));
    const head = el("div", "ts-detail-head"); head.append(el("h2", null, item.name));
    const free = el("span", "ts-free-pill", "Pulsuz"); head.appendChild(free);
    const sub = el("p", "ts-detail-sub"); sub.append(svgSpan(SVG.star, "ts-star-ico"), el("span", null, item.type === "theme" ? "Söhbət mövzusu" : item.type === "frame" ? "Profil çərçivəsi" : item.type === "pack" ? "Emoji paketi" : "Nişan"));
    const desc = el("p", "ts-detail-desc", item.type === "pack" ? item.name + " — söhbətlərdə istifadə üçün emoji kolleksiyası." : item.desc);
    box.append(hero, head, sub, desc);
    if (item.type === "pack") { const grid = el("div", "ts-emoji-grid"); (item.emojis || []).forEach(e => grid.appendChild(el("span", null, e))); box.appendChild(grid); }
    box.appendChild(checklist(item));
    const primary = el("button", "ts-primary"); primary.type = "button";
    if (item.type === "theme") { primary.append(svgSpan(SVG.dl), el("span", null, applied === item.id ? "Tətbiq olunub ✓" : "Tətbiq Et")); primary.onclick = () => go("apply"); }
    else { const has = collected.has(item.id); primary.append(svgSpan(has ? SVG.check : SVG.dl), el("span", null, has ? "Kolleksiyadadır" : item.type === "pack" ? "Yüklə" : "Kolleksiyaya əlavə et")); primary.disabled = has; primary.onclick = () => collect(item); }
    const fav = el("button", "ts-secondary" + (favs.has(item.id) ? " on" : "")); fav.type = "button";
    fav.append(svgSpan(SVG.heart), el("span", null, favs.has(item.id) ? "Sevimlilərdən çıxar" : "Sevimlilərimə Əlavə Et")); fav.onclick = () => toggleFav(item);
    box.append(primary, fav);
  }

  function renderApply() {
    const box = $("tcStoreApply"); if (!box || !current) return;
    box.textContent = "";
    const item = current, t = item.theme;
    const phone = el("div", "ts-phone"); phone.style.setProperty("--bg", t.background); phone.style.setProperty("--in", t.incoming); phone.style.setProperty("--out", t.outgoing); phone.style.setProperty("--in-t", t.incomingText); phone.style.setProperty("--out-t", t.outgoingText);
    phone.setAttribute("role", "img"); phone.setAttribute("aria-label", item.name + " söhbət önizləməsi");
    const bar = el("div", "ts-phone-bar"); bar.append(el("i"), el("b", null, "TalkChat"), el("small", null, "online")); phone.appendChild(bar);
    const chat = el("div", "ts-chat");
    [["l", "Salam! 👋", "09:41"], ["r", "Necəsən? 💜", "09:42"], ["l", "Çox yaxşıyam!", "09:42"]].forEach(([side, txt, time]) => { const b = el("div", "ts-msg " + side); b.append(el("span", null, txt), el("small", null, time)); chat.appendChild(b); });
    phone.appendChild(chat);
    const inp = el("div", "ts-chat-input"); inp.append(el("span", null, "Mesaj yaz..."), el("i")); phone.appendChild(inp);
    const btn = el("button", "ts-primary sticky"); btn.type = "button"; btn.textContent = "Tətbiq Et";
    btn.onclick = async () => { btn.disabled = true; btn.textContent = "Tətbiq olunur..."; const ok = await applyTheme(item); if (ok) go("done"); else { btn.disabled = false; btn.textContent = "Tətbiq Et"; } };
    box.append(phone, btn);
  }

  function renderDone() {
    const box = $("tcStoreDone"); if (!box) return;
    box.textContent = "";
    const ring = el("div", "ts-done-ring"); ring.append(el("i", "d d1"), el("i", "d d2"), el("i", "d d3"), svgSpan(SVG.check, "ts-done-check"));
    const ok = el("button", "ts-primary"); ok.type = "button"; ok.textContent = "Tamam"; ok.onclick = () => go("home");
    box.append(ring, el("h2", null, "Uğurla tətbiq edildi!"), el("p", null, "Yeni mövzu uğurla aktivləşdirildi."), ok);
    if (prevTheme) { const rv = el("button", "ts-secondary"); rv.type = "button"; rv.append(svgSpan(SVG.undo), el("span", null, "Əvvəlki Mövzuya Qayıt")); rv.onclick = revertTheme; box.appendChild(rv); }
  }

  function render() {
    const views = { home: "tcStoreHome", list: "tcStoreListView", detail: "tcStoreDetail", apply: "tcStoreApply", done: "tcStoreDone" };
    const q = query.trim();
    if (q && view === "home") { tab = "all"; view = "list"; }
    Object.entries(views).forEach(([k, id]) => { const n = $(id); if (n) n.hidden = k !== view; });
    const backBtn = $("tcStoreBack"); if (backBtn) backBtn.hidden = view === "home";
    const title = $("tcStoreTitle"); if (title) title.textContent = view === "home" || view === "done" ? "TalkStore" : view === "apply" ? "Mövzunu Tətbiq Et" : q ? "Axtarış" : (TABS[tab] || TABS.themes).title;
    const search = document.querySelector(".ts-search"); if (search) search.hidden = view === "detail" || view === "apply" || view === "done";
    const gems = $("tcStoreGems"); if (gems) gems.textContent = String(collected.size);
    const chip = $("tcStoreGemChip"); if (chip) chip.hidden = view === "apply" || view === "done";
    const count = $("tcStoreCollected"); if (count) count.textContent = collected.size ? collected.size + " element kolleksiyanda" : "";
    document.querySelectorAll(".ts-cat[data-store-tab]").forEach(b => b.classList.toggle("active", view === "list" && b.dataset.storeTab === tab && !q));
    if (view === "home") renderHome(); else if (view === "list") renderList(); else if (view === "detail") renderDetail(); else if (view === "apply") renderApply(); else renderDone();
  }

  function load() { view = "home"; query = ""; const s = $("tcStoreSearch"); if (s) s.value = ""; render(); }
  document.querySelectorAll(".ts-cat[data-store-tab]").forEach(b => b.addEventListener("click", () => { query = ""; const s = $("tcStoreSearch"); if (s) s.value = ""; openCategory(b.dataset.storeTab); }));
  document.querySelectorAll("[data-store-sort]").forEach(b => b.addEventListener("click", () => { sort = b.dataset.storeSort; render(); }));
  $("tcStoreSearch")?.addEventListener("input", e => { query = e.target.value; render(); });
  $("tcStoreBack")?.addEventListener("click", back);
  $("tcStoreStart")?.addEventListener("click", () => openCategory("themes"));
  $("tcStoreAll")?.addEventListener("click", () => openCategory("all"));
  window.TalkChatStore = { load, open, catalog: CATALOG };
})();
