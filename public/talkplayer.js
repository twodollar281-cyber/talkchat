// TalkPlayer — cihazdakı mahnıları brauzerdə (IndexedDB) saxlayır və oxudur.
// Server yükləməsi tələb olunmur, ona görə "Yükləmə xətası" olmur.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const DB_NAME = "talkplayer", STORE = "songs";
  const MAX_BYTES = 200 * 1024 * 1024;

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>', music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>',
    prev: '<path d="M6 5v14M20 5v14L8 12z" fill="currentColor"/>', next: '<path d="M18 5v14M4 5v14l12-7z" fill="currentColor"/>',
    shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>', repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    down: '<path d="m6 9 6 6 6-6"/>', volume: '<path d="M11 5 6 9H3v6h3l5 4zM16 9a4 4 0 0 1 0 6"/>',
    queue: '<path d="M3 6h14M3 12h14M3 18h8M19 15v6l4-3z"/>', heart: '<path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 4.8 6.8 4.8c2 0 3.5 1.1 5.2 3 1.7-1.9 3.2-3 5.2-3 3.2 0 5.1 3.2 4 6.4-1.7 4.7-9.2 9.3-9.2 9.3z"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/>', timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
  };
  const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ""}</svg>`;
  function paintIcons(root) {
    (root || document).querySelectorAll("[data-icon]").forEach(n => { if (!n.firstChild || n.dataset.iconDone !== n.dataset.icon) { n.innerHTML = svg(n.dataset.icon); n.dataset.iconDone = n.dataset.icon; } });
  }
  const setIcon = (node, name) => { if (node && node.dataset.icon !== name) { node.dataset.icon = name; node.innerHTML = svg(name); node.dataset.iconDone = name; } };

  const toast = msg => {
    const r = $("tcToastRegion"); if (!r) return alert(msg);
    const n = document.createElement("div"); n.className = "tc-toast"; n.textContent = msg; r.appendChild(n); setTimeout(() => n.remove(), 3500);
  };
  const fmt = s => { s = Math.max(0, Math.floor(Number(s) || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  /* ---------- IndexedDB ---------- */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("Bu cihaz yerli mahnı saxlamağı dəstəkləmir."));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Yaddaş açıla bilmədi."));
    });
    return dbp;
  }
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode), s = t.objectStore(STORE); let out;
      Promise.resolve(fn(s)).then(r => { out = r; }).catch(reject);
      t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error("Yaddaş xətası"));
    });
  };
  const idbReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const getAll = () => tx("readonly", s => idbReq(s.getAll()));
  const addSong = rec => tx("readwrite", s => idbReq(s.add(rec)));
  const delSong = id => tx("readwrite", s => idbReq(s.delete(id)));
  const clearAll = () => tx("readwrite", s => idbReq(s.clear()));

  /* ---------- ID3 etiketləri (ad, ifaçı, cover) ---------- */
  async function readTags(file) {
    const out = {};
    try {
      const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
      if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33 || head[3] < 3) return out;
      const ver = head[3], size = ((head[6] & 127) << 21) | ((head[7] & 127) << 14) | ((head[8] & 127) << 7) | (head[9] & 127);
      const buf = new Uint8Array(await file.slice(10, 10 + Math.min(size, 8 * 1024 * 1024)).arrayBuffer());
      const dec = (b, enc) => { try { return new TextDecoder(enc === 1 ? "utf-16" : enc === 2 ? "utf-16be" : enc === 3 ? "utf-8" : "windows-1252").decode(b).split("\0").map(x => x.trim()).filter(Boolean).join(", "); } catch { return ""; } };
      let p = 0;
      while (p + 10 <= buf.length) {
        const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const fs = ver === 4 ? ((buf[p + 4] & 127) << 21) | ((buf[p + 5] & 127) << 14) | ((buf[p + 6] & 127) << 7) | (buf[p + 7] & 127) : buf[p + 4] * 16777216 + (buf[p + 5] << 16) + (buf[p + 6] << 8) + buf[p + 7];
        if (fs <= 0 || p + 10 + fs > buf.length) break;
        const body = buf.subarray(p + 10, p + 10 + fs);
        if (id === "TIT2") out.title = dec(body.subarray(1), body[0]);
        else if (id === "TPE1") out.artist = dec(body.subarray(1), body[0]);
        else if (id === "APIC" && !out.cover) {
          const enc = body[0]; let q = 1; while (q < body.length && body[q] !== 0) q++;
          const mime = String.fromCharCode(...body.subarray(1, q)); q += 2;
          if (enc === 1 || enc === 2) { while (q + 1 < body.length && !(body[q] === 0 && body[q + 1] === 0)) q += 2; q += 2; }
          else { while (q < body.length && body[q] !== 0) q++; q++; }
          const img = body.subarray(q);
          if (img.length > 200) out.cover = new Blob([img], { type: /^image\//.test(mime) ? mime : (img[0] === 0x89 ? "image/png" : "image/jpeg") });
        }
        p += 10 + fs;
      }
    } catch {}
    return out;
  }
  function splitName(name) {
    const m = String(name).match(/^(.{2,60}?)\s+[-–—]\s+(.+)$/);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: "", title: name };
  }
  const putSong = rec => tx("readwrite", s => idbReq(s.put(rec)));
  let backfilling = false;
  async function backfill() {
    if (backfilling) return; backfilling = true;
    try {
      for (const song of songs.filter(x => !x.tagged && x.blob)) {
        const t = await readTags(song.blob), f = splitName(song.title);
        if (t.title) song.title = t.title; else if (f.artist && /^Naməlum/i.test(song.artist || "")) song.title = f.title;
        if (t.artist) song.artist = t.artist; else if (f.artist && /^Naməlum/i.test(song.artist || "")) song.artist = f.artist;
        if (t.cover) song.cover = t.cover;
        song.tagged = true;
        try { await putSong(song); } catch {}
      }
    } finally { backfilling = false; }
    render(true);
  }

  /* ---------- state ---------- */
  const audio = new Audio(); audio.preload = "metadata";
  let songs = [], mix = null, coverCache = new Map(), miniCoverKey = null, query = "", index = -1, shuffle = false, repeat = "off", urlCache = new Map(), sleepTimer = null;

  const visible = () => { const q = query.trim().toLowerCase(); const base = mix ? songs.filter(mix.fn) : songs; return q ? base.filter(s => (s.title + " " + s.artist).toLowerCase().includes(q)) : base; };
  const current = () => songs[index] || null;
  const urlFor = song => { if (!urlCache.has(song.id)) urlCache.set(song.id, URL.createObjectURL(song.blob)); return urlCache.get(song.id); };

  function readableName(file) { return file.name.replace(/\.[^/.]+$/, "").replace(/[_]+/g, " ").trim() || "Naməlum mahnı"; }
  function looksAudio(file) { return /^audio\//.test(file.type) || /\.(mp3|m4a|aac|wav|ogg|opus|flac|webm|mp4)$/i.test(file.name); }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let ok = 0, bad = 0;
    for (const file of files) {
      if (!looksAudio(file)) { bad++; continue; }
      if (file.size > MAX_BYTES) { bad++; toast(file.name + " çox böyükdür (maks. 200 MB)."); continue; }
      try {
        // Android file picker bəzən boş type qaytarır — audio/mpeg kimi qəbul edirik
        const blob = file.type ? file : file.slice(0, file.size, "audio/mpeg");
        const t = await readTags(file), f = splitName(readableName(file));
        await addSong({ title: t.title || f.title, artist: t.artist || f.artist || "Naməlum ifaçı", cover: t.cover || null, tagged: true, blob, size: file.size, addedAt: Date.now() });
        ok++;
      } catch (e) {
        bad++;
        toast(e && e.name === "QuotaExceededError" ? "Cihazda yer çatmır." : "Mahnı saxlanmadı: " + (e && e.message || "xəta"));
      }
    }
    await refresh();
    if (ok) toast(ok === 1 ? "Mahnı əlavə olundu." : ok + " mahnı əlavə olundu.");
    else if (bad && !files.length) toast("Audio fayl seç.");
    else if (bad) toast("Yalnız audio fayllar əlavə olunur.");
  }

  async function refresh() {
    try { songs = (await getAll()).sort((a, b) => a.addedAt - b.addedAt); }
    catch (e) { songs = []; toast(e.message); }
    if (index >= songs.length) index = -1;
    if (mix && !songs.some(mix.fn)) mix = null;
    render();
    backfill();
  }

  /* ---------- playback ---------- */
  async function playSong(i) {
    const song = songs[i]; if (!song) return;
    index = i;
    audio.src = urlFor(song);
    try { await audio.play(); } catch (e) { toast("Mahnı oxuna bilmədi: " + (e && e.message || "format dəstəklənmir")); }
    updateMeta(); render();
  }
  function stepIndex(dir) {
    if (!songs.length) return -1;
    if (shuffle && songs.length > 1) { let n; do { n = Math.floor(Math.random() * songs.length); } while (n === index); return n; }
    return (index + dir + songs.length) % songs.length;
  }
  const next = () => { const n = stepIndex(1); if (n >= 0) playSong(n); };
  const prev = () => { if (audio.currentTime > 3) { audio.currentTime = 0; return; } const n = stepIndex(-1); if (n >= 0) playSong(n); };
  function toggle() {
    if (index < 0) { const list = visible(); if (list.length) playSong(songs.indexOf(list[0])); return; }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }

  audio.addEventListener("ended", () => {
    if (repeat === "one") { audio.currentTime = 0; audio.play().catch(() => {}); }
    else if (repeat === "all" || index + 1 < songs.length) next();
    else updateMeta();
  });
  ["play", "pause"].forEach(ev => audio.addEventListener(ev, () => { updateMeta(); render(true); }));
  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", () => { updateProgress(); const s = current(); if (s && !s.duration && isFinite(audio.duration)) { s.duration = audio.duration; render(true); } });
  audio.addEventListener("error", () => toast("Bu fayl oxuna bilmir."));

  function updateProgress() {
    const dur = isFinite(audio.duration) ? audio.duration : 0, cur = audio.currentTime || 0;
    const seek = $("tcPlayerSeek"); if (seek) { seek.max = String(Math.floor(dur)); seek.value = String(Math.floor(cur)); seek.disabled = !dur; }
    if ($("tcPlayerCur")) $("tcPlayerCur").textContent = fmt(cur);
    if ($("tcPlayerDur")) $("tcPlayerDur").textContent = fmt(dur);
    const bar = $("tcMiniBar"); if (bar) bar.style.width = dur ? (cur / dur * 100) + "%" : "0";
  }

  function updateMeta() {
    const s = current(), playing = !audio.paused && !audio.ended;
    document.body.classList.toggle("tc-player-playing", playing);
    const mini = $("tcMiniPlayer"); if (mini) mini.hidden = !s;
    paintMiniCover(s);
    if ($("tcMiniTitle")) $("tcMiniTitle").textContent = s ? s.title : "TalkPlayer";
    if ($("tcMiniArtist")) $("tcMiniArtist").textContent = s ? s.artist : "";
    if ($("tcPlayerTitle")) $("tcPlayerTitle").textContent = s ? s.title : "Mahnı seçilməyib";
    if ($("tcPlayerArtist")) $("tcPlayerArtist").textContent = s ? s.artist : "";
    setIcon($("tcMiniPlay")?.firstElementChild, playing ? "pause" : "play");
    setIcon($("tcPlayerPlay")?.firstElementChild, playing ? "pause" : "play");
    $("tcPlayerShuffle")?.setAttribute("aria-pressed", String(shuffle));
    $("tcPlayerRepeat")?.setAttribute("aria-pressed", String(repeat !== "off"));
    if ("mediaSession" in navigator && s) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist, album: "TalkPlayer" });
        navigator.mediaSession.playbackState = playing ? "playing" : "paused";
      } catch {}
    }
  }
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", () => audio.play());
      navigator.mediaSession.setActionHandler("pause", () => audio.pause());
      navigator.mediaSession.setActionHandler("nexttrack", next);
      navigator.mediaSession.setActionHandler("previoustrack", prev);
    } catch {}
  }

  /* ---------- song cover ---------- */
  const COVER_GRADS = [["#3b2a14", "#c99342"], ["#0ea5e9", "#4f46e5"], ["#f43f5e", "#f59e0b"], ["#059669", "#0ea5e9"], ["#7c3aed", "#ec4899"], ["#f97316", "#b91c1c"]];
  const gradFor = str => { const h = Array.from(String(str || "")).reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7), g = COVER_GRADS[h % COVER_GRADS.length]; return "linear-gradient(135deg," + g[0] + "," + g[1] + ")"; };
  function coverSrc(song) {
    if (!song) return "";
    const c = song.cover || song.coverUrl;
    if (c instanceof Blob) { const k = "b" + song.id; if (!coverCache.has(k)) coverCache.set(k, URL.createObjectURL(c)); return coverCache.get(k); }
    return typeof c === "string" && /^(https?:\/\/|\/|data:image\/|blob:)/.test(c) && !/default-cover/.test(c) ? c : "";
  }
  function fillCover(c, song) {
    c.textContent = ""; c.style.background = gradFor(song && song.title);
    const letter = (String((song && song.title) || "").trim().match(/[\p{L}\p{N}]/u) || ["♪"])[0].toUpperCase();
    const src = coverSrc(song);
    if (!src) { c.textContent = letter; return c; }
    const img = document.createElement("img"); img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.draggable = false;
    img.onerror = () => { img.remove(); c.textContent = letter; };
    img.src = src; c.appendChild(img); return c;
  }
  function makeCover(song) { const c = document.createElement("span"); c.className = "tp-cover tp-song-cover"; return fillCover(c, song); }
  function paintMiniCover(s) {
    const c = document.querySelector("#tcMiniOpen .tc-mini-cover"), key = s ? s.id + ":" + (s.cover ? 1 : 0) : "none";
    if (!c || key === miniCoverKey) return; miniCoverKey = key;
    if (s) fillCover(c, s); else { c.textContent = "♪"; c.style.background = ""; }
  }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  /* ---------- profil (yalnız header üçün) ---------- */
  async function loadMe() {
    try {
      const r = await fetch("/api/me", { credentials: "same-origin" }); if (!r.ok) return;
      const d = await r.json(), box = $("tcPlayerMe"), nm = $("tcPlayerMeName"), av = $("tcPlayerMeAv"); if (!box || !d || !d.username) return;
      nm.textContent = d.displayName || d.username; av.textContent = "";
      if (d.avatar) { const im = document.createElement("img"); im.alt = ""; im.src = d.avatar; im.onerror = () => { im.remove(); av.textContent = d.username[0].toUpperCase(); }; av.appendChild(im); }
      else av.textContent = d.username[0].toUpperCase();
      box.hidden = false;
    } catch {}
  }
  window.addEventListener("talkchat:entered", loadMe);

  /* ---------- home: Featured + Trending Mixes ---------- */
  function buildMixes() {
    const list = [{ id: "all", name: "Hamısı", sub: songs.length + " mahnı", fn: () => true, ref: songs[songs.length - 1] }];
    const newest = new Set(songs.slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, 10).map(x => x.id));
    if (songs.length > 3) list.push({ id: "new", name: "Son əlavələr", sub: "Yeni gələnlər", fn: x => newest.has(x.id), ref: songs[songs.length - 1] });
    const counts = new Map();
    songs.forEach(x => { const a = (x.artist || "").trim(); if (a && !/^Naməlum/i.test(a)) counts.set(a, (counts.get(a) || 0) + 1); });
    Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([a, n]) => list.push({ id: "a:" + a, name: a, sub: n + " mahnı", fn: x => (x.artist || "").trim() === a, ref: songs.find(x => (x.artist || "").trim() === a) }));
    if (songs.some(x => x.duration >= 240)) list.push({ id: "long", name: "Uzun mahnılar", sub: "4 dəq+", fn: x => x.duration >= 240, ref: songs.find(x => x.duration >= 240) });
    return list.slice(0, 6);
  }
  function renderHome() {
    const home = $("tcPlayerHome"); if (!home) return;
    const scroller = home.querySelector(".tp-mixes"), keep = scroller ? scroller.scrollLeft : 0;
    const show = songs.length > 0 && !query.trim();
    home.hidden = !show; home.textContent = ""; if (!show) return;
    const playing = !audio.paused;
    const fi = index >= 0 ? index : songs.length - 1, fs = songs[fi];

    const sec1 = el("section", "tp-section"); sec1.appendChild(el("div", "tp-sechead")).appendChild(el("h2", "", "Featured Section"));
    const feat = el("button", "tp-feat"); feat.type = "button"; feat.setAttribute("aria-label", fs.title + " — " + fs.artist);
    const fc = el("span", "tp-feat-cover"); fillCover(fc, fs);
    const fp = el("span", "tp-feat-play"); fp.setAttribute("aria-hidden", "true"); fp.innerHTML = svg(fi === index && playing ? "pause" : "play"); fc.appendChild(fp);
    const fi2 = el("span", "tp-feat-info"); fi2.append(el("span", "tp-chip", "Featured"), el("b", "tp-feat-title", fs.title), el("span", "tp-feat-artist", fs.artist));
    feat.append(fc, fi2); feat.onclick = () => { if (fi === index) toggle(); else playSong(fi); };
    sec1.appendChild(feat);

    const sec2 = el("section", "tp-section"); sec2.appendChild(el("div", "tp-sechead")).appendChild(el("h2", "", "Trending Mixes"));
    const row = el("div", "tp-mixes");
    buildMixes().forEach(m => {
      const b = el("button", "tp-mix" + (mix && mix.id === m.id ? " on" : "")); b.type = "button";
      const cv = el("span", "tp-mix-cover"); fillCover(cv, m.ref || { title: m.name, id: m.id });
      cv.style.background = gradFor(m.name); if (m.ref && coverSrc(m.ref)) fillCover(cv, m.ref);
      cv.appendChild(el("span", "tp-mix-label", m.name));
      b.append(cv, el("b", "tp-mix-name", m.name), el("small", "tp-mix-sub", m.sub));
      b.onclick = () => { mix = mix && mix.id === m.id ? null : (m.id === "all" ? null : m); render(true); const h = $("tcPlayerListHead"); if (h) h.scrollIntoView({ behavior: "smooth", block: "start" }); };
      row.appendChild(b);
    });
    sec2.appendChild(row); home.append(sec1, sec2); row.scrollLeft = keep;
  }

  /* ---------- rendering ---------- */
  function render(soft) {
    const list = visible(), ul = $("tcPlayerList"), empty = $("tcPlayerEmpty"), head = $("tcPlayerListHead");
    if (!ul) return;
    const has = songs.length > 0;
    ul.hidden = !has; if (empty) empty.hidden = has;
    if (head) { head.hidden = !has; $("tcPlayerBack") && ($("tcPlayerBack").hidden = !mix); const t = $("tcPlayerListTitle"); if (t) t.textContent = mix ? mix.name + " (" + list.length + ")" : "Your Daily Mixtape"; const c = $("tcPlayerClear"); if (c) c.hidden = !has; }
    const playing = !audio.paused;
    ul.textContent = "";
    list.forEach(song => {
      const i = songs.indexOf(song), isCur = i === index;
      const li = document.createElement("li"); li.className = "tc-player-item" + (isCur ? " current" : "") + (isCur && playing ? " playing" : "");
      const main = document.createElement("button"); main.type = "button"; main.className = "tc-player-item-main";
      const cover = makeCover(song);
      const info = document.createElement("span"); info.className = "tp-song-info";
      const name = document.createElement("span"); name.className = "tc-player-item-name"; name.textContent = song.title; name.title = song.title;
      const sub = document.createElement("small"); sub.className = "tp-song-artist"; sub.textContent = song.artist; sub.title = song.artist;
      info.append(name, sub);
      const dur = document.createElement("span"); dur.className = "tc-player-item-dur"; dur.textContent = song.duration ? fmt(song.duration) : "";
      const go = document.createElement("span"); go.className = "tp-song-go"; go.setAttribute("aria-hidden", "true"); go.innerHTML = svg(isCur && playing ? "pause" : "play");
      main.setAttribute("aria-label", song.title + " — " + song.artist);
      main.append(cover, info, dur, go); main.onclick = () => playSong(i);
      const del = document.createElement("button"); del.type = "button"; del.className = "tc-player-item-menu"; del.setAttribute("aria-label", "Sil"); del.innerHTML = svg("trash");
      del.onclick = async e => {
        e.stopPropagation();
        if (!confirm(`"${song.title}" silinsin?`)) return;
        if (isCur) { audio.pause(); audio.removeAttribute("src"); index = -1; }
        else if (i < index) index--;
        const u = urlCache.get(song.id); if (u) { URL.revokeObjectURL(u); urlCache.delete(song.id); }
        await delSong(song.id); await refresh(); updateMeta();
      };
      li.append(main, del); ul.appendChild(li);
    });
    if (!list.length && has) { const li = document.createElement("li"); li.className = "tc-player-empty"; li.textContent = "Heç nə tapılmadı."; ul.appendChild(li); }
    renderHome();
    paintIcons(document.getElementById("playerPage"));
    if (!soft) updateMeta();
  }

  /* ---------- wiring ---------- */
  function openPicker() { const f = $("tcPlayerFile"); if (f) { f.value = ""; f.click(); } }
  $("tcPlayerAdd")?.addEventListener("click", openPicker);
  $("tcPlayerEmptyAdd")?.addEventListener("click", openPicker);
  $("tcPlayerFile")?.addEventListener("change", async e => { await addFiles(e.target.files); e.target.value = ""; });
  $("tcPlayerSearch")?.addEventListener("input", e => { query = e.target.value; render(true); });
  $("tcPlayerClear")?.addEventListener("click", async () => {
    if (!songs.length || !confirm("Bütün mahnılar silinsin?")) return;
    audio.pause(); audio.removeAttribute("src"); index = -1;
    urlCache.forEach(u => URL.revokeObjectURL(u)); urlCache.clear();
    await clearAll(); await refresh(); updateMeta();
  });
  const np = $("tcPlayerNP");
  const openNP = () => { if (!current() || !np) return; np.hidden = false; requestAnimationFrame(() => np.classList.add("open")); updateMeta(); };
  const closeNP = () => { if (!np) return; np.classList.remove("open"); setTimeout(() => { np.hidden = true; }, 380); };
  $("tcMiniOpen")?.addEventListener("click", openNP);
  $("tcPlayerNPClose")?.addEventListener("click", closeNP);
  $("tcMiniPlay")?.addEventListener("click", toggle);
  $("tcMiniNext")?.addEventListener("click", next);
  $("tcMiniPrev")?.addEventListener("click", prev);
  $("tcPlayerBack")?.addEventListener("click", () => { mix = null; render(true); });
  $("tcPlayerPlay")?.addEventListener("click", toggle);
  $("tcPlayerNext")?.addEventListener("click", next);
  $("tcPlayerPrev")?.addEventListener("click", prev);
  $("tcPlayerShuffle")?.addEventListener("click", () => { shuffle = !shuffle; updateMeta(); });
  $("tcPlayerRepeat")?.addEventListener("click", () => { repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off"; updateMeta(); });
  $("tcPlayerSeek")?.addEventListener("input", e => { audio.currentTime = Number(e.target.value) || 0; });
  $("tcPlayerVolume")?.addEventListener("input", e => { audio.volume = Math.max(0, Math.min(1, Number(e.target.value) / 100)); });
  $("tcPlayerQueueBtn")?.addEventListener("click", closeNP);
  $("tcPlayerSleep")?.addEventListener("click", () => {
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; return toast("Yuxu taymeri söndürüldü."); }
    sleepTimer = setTimeout(() => { audio.pause(); sleepTimer = null; }, 30 * 60 * 1000); toast("30 dəqiqədən sonra dayanacaq.");
  });
  $("tcPlayerThemeBtn")?.addEventListener("click", () => { closeNP(); window.showPage && window.showPage("store"); });
  audio.volume = 0.8;

  paintIcons(document);
  loadMe();
  window.TalkChatPlayer = { load: refresh, add: addFiles };
  window.TalkPlayer = window.TalkChatPlayer;
  refresh();
})();
