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

  /* ---------- state ---------- */
  const audio = new Audio(); audio.preload = "metadata";
  let songs = [], query = "", index = -1, shuffle = false, repeat = "off", urlCache = new Map(), sleepTimer = null;

  const visible = () => { const q = query.trim().toLowerCase(); return q ? songs.filter(s => (s.title + " " + s.artist).toLowerCase().includes(q)) : songs; };
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
        await addSong({ title: readableName(file), artist: "Naməlum ifaçı", blob, size: file.size, addedAt: Date.now() });
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
    render();
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

  /* ---------- rendering ---------- */
  function render(soft) {
    const list = visible(), ul = $("tcPlayerList"), empty = $("tcPlayerEmpty"), head = $("tcPlayerListHead");
    if (!ul) return;
    const has = songs.length > 0;
    ul.hidden = !has; if (empty) empty.hidden = has;
    if (head) { head.hidden = !has; $("tcPlayerBack") && ($("tcPlayerBack").hidden = true); const t = $("tcPlayerListTitle"); if (t) t.textContent = "Kitabxana (" + songs.length + ")"; const c = $("tcPlayerClear"); if (c) c.hidden = !has; }
    const playing = !audio.paused;
    ul.textContent = "";
    list.forEach(song => {
      const i = songs.indexOf(song), isCur = i === index;
      const li = document.createElement("li"); li.className = "tc-player-item" + (isCur ? " current" : "") + (isCur && playing ? " playing" : "");
      const main = document.createElement("button"); main.type = "button"; main.className = "tc-player-item-main";
      const cover = document.createElement("span"); cover.className = "tc-mini-cover"; cover.textContent = "♪";
      const info = document.createElement("span"); info.style.minWidth = "0"; info.style.display = "grid";
      const name = document.createElement("span"); name.className = "tc-player-item-name"; name.textContent = song.title;
      const sub = document.createElement("small"); sub.textContent = song.artist;
      info.append(name, sub);
      const dur = document.createElement("span"); dur.className = "tc-player-item-dur"; dur.textContent = song.duration ? fmt(song.duration) : "";
      main.append(cover, info, dur); main.onclick = () => playSong(i);
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
  window.TalkChatPlayer = { load: refresh, add: addFiles };
  window.TalkPlayer = window.TalkChatPlayer;
  refresh();
})();
