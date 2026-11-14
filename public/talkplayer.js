(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const DB_NAME = "talkchat-player", STORE = "tracks", PREF_KEY = "tcPlayerPrefs", ORDER_KEY = "tcPlayerOrder";
  const CHUNK = 393216; // bytes per native staging chunk (multiple of 3)

  const audio = new Audio();           // website playback + fallback engine
  audio.preload = "metadata";
  let tracks = [];                     // [{ id, name, title, artist, ext, size, duration }]
  let index = -1;                      // current track index
  let currentUrl = null;               // current object URL (web engine)
  let prefs = { volume: 0.8, repeat: "off", shuffle: false };
  let seeking = false;
  let ready = false;
  let loadToken = 0;

  /* ---------- native bridge (Android TalkMediaService via TalkMediaPlugin) ---------- */
  let nativeOn = false;                // true when native engine is the active engine
  let nState = null;                   // last snapshot received from native
  let nHandles = [];
  const staging = new Map();           // id -> Promise (in-flight staging)
  const stagedOk = new Set();
  const plugin = () => { try { return window.Capacitor?.Plugins?.TalkMedia || null; } catch { return null; } };
  const isNativeApp = () => { try { return !!(window.Capacitor?.isNativePlatform?.() && plugin()); } catch { return false; } };

  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || "{}")); } catch {}
  audio.volume = Math.min(1, Math.max(0, Number(prefs.volume) || 0));
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} };

  /* ---------- IndexedDB (no dependencies) ---------- */
  const openDb = () => new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB yoxdur"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, fn) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(out && out.result !== undefined ? out.result : undefined); };
      t.onerror = t.onabort = () => { db.close(); reject(t.error); };
    });
  };
  const dbAll = () => tx("readonly", s => s.getAll());
  const dbPut = rec => tx("readwrite", s => s.put(rec));
  const dbDel = id => tx("readwrite", s => s.delete(id));
  const dbGet = id => tx("readonly", s => s.get(id));

  /* ---------- helpers ---------- */
  const fmt = sec => {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  };
  const cleanName = n => String(n || "Naməlum").replace(/\.[a-z0-9]{2,5}$/i, "");
  const extOf = (name, type) => {
    const m = /\.([a-z0-9]{2,5})$/i.exec(name || "");
    if (m) return m[1].toLowerCase();
    const t = String(type || "").toLowerCase();
    return t.includes("mpeg") ? "mp3" : t.includes("mp4") || t.includes("aac") ? "m4a" : t.includes("ogg") ? "ogg" : t.includes("wav") ? "wav" : t.includes("flac") ? "flac" : "mp3";
  };
  // "Artist - Title" -> { artist, title }
  const parseInfo = name => {
    const clean = cleanName(name).replace(/_/g, " ").trim();
    const m = /^(.{1,80}?)\s+[-–—]\s+(.+)$/.exec(clean);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: "TalkPlayer", title: clean || "Naməlum" };
  };
  const toTrack = r => {
    const info = parseInfo(r.name);
    return { id: r.id, name: r.name, title: info.title, artist: info.artist, ext: r.ext || extOf(r.name, r.blob && r.blob.type), size: r.size || (r.blob && r.blob.size) || 0, duration: r.duration || 0, addedAt: r.addedAt || 0 };
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const toast = msg => {
    const region = $("tcToastRegion");
    if (!region) return;
    const el = document.createElement("div");
    el.className = "tc-toast"; el.textContent = msg;
    region.appendChild(el); setTimeout(() => el.remove(), 3200);
  };
  const keepAlive = active => {
    try { window.Capacitor?.Plugins?.CallService?.setMediaKeepAlive?.({ active: !!active }); } catch {}
  };
  const cur = () => tracks[index] || null;

  /* ---------- native staging: copy the IndexedDB blob into the app cache so the service can play it ---------- */
  const blobToBase64 = blob => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = () => reject(fr.error || new Error("Oxuna bilmədi"));
    fr.readAsDataURL(blob);
  });
  function ensureStaged(t) {
    const p = plugin();
    if (!p || !t) return Promise.resolve(false);
    if (stagedOk.has(t.id)) return Promise.resolve(true);
    if (staging.has(t.id)) return staging.get(t.id);
    const job = (async () => {
      const has = await p.hasTrack({ id: t.id, ext: t.ext, size: t.size });
      if (has && has.exists) { stagedOk.add(t.id); return true; }
      const rec = await dbGet(t.id);
      if (!rec || !rec.blob) throw new Error("Fayl tapılmadı");
      const blob = rec.blob;
      for (let off = 0; off < blob.size || off === 0; off += CHUNK) {
        const end = Math.min(blob.size, off + CHUNK);
        await p.stageChunk({ id: t.id, ext: t.ext, data: await blobToBase64(blob.slice(off, end)), first: off === 0, last: end >= blob.size });
        if (end >= blob.size) break;
      }
      stagedOk.add(t.id);
      return true;
    })().finally(() => staging.delete(t.id));
    staging.set(t.id, job);
    return job;
  }
  const queuePayload = () => tracks.map(t => ({ id: t.id, title: t.title, artist: t.artist, ext: t.ext }));
  const syncQueue = () => {
    const p = plugin();
    if (!nativeOn || !p) return;
    p.setQueue({ tracks: queuePayload(), currentId: cur()?.id || null }).catch(() => {});
  };
  function prestageNeighbours() {
    if (!nativeOn || !nState) return;
    [nState.nextId, nState.prevId].forEach(id => {
      const t = tracks.find(x => x.id === id);
      if (t) ensureStaged(t).catch(() => {});
    });
  }

  function onNativeState(s) {
    if (!s) return;
    const prevId = nState && nState.id, prevPlaying = nState && nState.playing;
    nState = s;
    if (s.playing && s.id !== prevId) noteRecent();
    if (s.id !== prevId) {
      const i = tracks.findIndex(t => t.id === s.id);
      if (i >= 0) index = i;
      updateMeta();
      prestageNeighbours();
      render();
    } else if (s.playing !== prevPlaying) render();
    if (s.volume !== undefined && Math.abs(s.volume - prefs.volume) > 0.001) { prefs.volume = s.volume; savePrefs(); }
    keepAlive(!!s.playing);
    updateProgress();
    const t = cur();
    if (t && s.duration > 0 && Math.abs((t.duration || 0) - s.duration / 1000) > 1) { t.duration = Math.round(s.duration / 1000); renderListDuration(); persistDuration(t); }
  }
  async function onTrackNeeded(ev) {
    const t = tracks.find(x => x.id === ev.id);
    const p = plugin();
    if (!t || !p) return;
    try { await ensureStaged(t); await p.trackReady({ id: t.id }); }
    catch (e) { toast("Mahnı hazırlanmadı: " + (e.message || e)); fallbackToWeb(); }
  }
  function attachNative() {
    const p = plugin();
    if (!isNativeApp() || nHandles.length) return;
    nativeOn = true;
    const add = (name, fn) => { try { const h = p.addListener(name, fn); if (h && h.then) h.then(x => nHandles.push(x)); else if (h) nHandles.push(h); } catch {} };
    add("state", onNativeState);
    add("trackNeeded", onTrackNeeded);
    add("error", ev => toast((ev && ev.message) || "Oxutma xətası"));
    nHandles.push(null);
    p.setVolume({ volume: prefs.volume }).catch(() => {});
    p.setShuffle({ enabled: !!prefs.shuffle }).catch(() => {});
    p.setRepeat({ mode: prefs.repeat }).catch(() => {});
  }
  // native failed: keep the website player usable
  function fallbackToWeb() {
    if (!nativeOn) return;
    nativeOn = false; nState = null;
    try { plugin()?.stop?.(); } catch {}
    toast("Android oxuducu işləmədi, brauzer oxuducusuna keçildi.");
    if (index >= 0) loadTrack(index, true);
  }
  // reflect a service that kept playing while the page was reloaded
  async function adoptNativeState() {
    const p = plugin();
    if (!nativeOn || !p) return;
    try {
      const r = await p.getState();
      if (r && r.running && r.state && r.state.id) { onNativeState(r.state); }
    } catch {}
  }

  /* ---------- engine abstraction ---------- */
  const isPlaying = () => nativeOn ? !!(nState && nState.playing) : (!audio.paused && !audio.ended);
  const positionSec = () => nativeOn ? ((nState && nState.position) || 0) / 1000 : audio.currentTime;
  const durationSec = () => nativeOn ? ((nState && nState.duration) || 0) / 1000 || (cur() ? cur().duration : 0) : audio.duration;
  const hasSource = () => nativeOn ? !!(nState && nState.id) : !!audio.src;

  async function loadTrack(i, autoplay, startSec) {
    if (i < 0 || i >= tracks.length) return;
    const token = ++loadToken;
    index = i;
    const t = tracks[i];
    updateMeta(); render();
    if (nativeOn) {
      try {
        if (autoplay) {
          await ensureStaged(t);
          if (token !== loadToken) return;
          await plugin().play({ id: t.id, position: Math.round((startSec || 0) * 1000), autoplay: true, tracks: queuePayload() });
        } else {
          // just select: stage lazily; nothing is started natively
          ensureStaged(t).catch(() => {});
          nState = Object.assign({}, nState || {}, { id: null, playing: false, position: 0, duration: (t.duration || 0) * 1000 });
        }
      } catch (e) {
        if (token !== loadToken) return;
        if (e && /Fayl tapılmadı/.test(e.message || "")) { toast("Fayl tapılmadı, siyahıdan silinir."); await removeTrack(t.id); return; }
        fallbackToWeb();
      }
      return;
    }
    const rec = await dbGet(t.id).catch(() => null);
    if (token !== loadToken) return;
    if (!rec || !rec.blob) { toast("Fayl tapılmadı, siyahıdan silinir."); await removeTrack(t.id); return; }
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(rec.blob);
    audio.src = currentUrl;
    if (startSec > 0) audio.currentTime = startSec;
    render();
    if (autoplay) {
      try { await audio.play(); } catch (e) { if (e && e.name !== "AbortError") toast("Oxutmaq mümkün olmadı: " + (e.message || e.name)); }
    }
  }

  // JS-side next index (web engine, and native when service has no queue yet)
  function nextIndex(dir) {
    if (!tracks.length) return -1;
    if (prefs.shuffle && tracks.length > 1) {
      let n; do { n = Math.floor(Math.random() * tracks.length); } while (n === index);
      return n;
    }
    const n = index + dir;
    if (n >= 0 && n < tracks.length) return n;
    return prefs.repeat === "all" ? (n < 0 ? tracks.length - 1 : 0) : -1;
  }
  const nativeHasQueue = () => nativeOn && nState && nState.queueSize > 0 && nState.id;
  const next = () => {
    if (nativeHasQueue()) { plugin().next().catch(() => {}); return; }
    const n = nextIndex(1);
    if (n >= 0) loadTrack(n, true); else if (!nativeOn) audio.pause();
  };
  const prev = () => {
    if (nativeHasQueue()) { plugin().previous().catch(() => {}); return; }
    if (positionSec() > 3) { seekTo(0); return; }
    const n = nextIndex(-1); if (n >= 0) loadTrack(n, true);
  };
  const pause = () => { if (nativeOn) plugin().pause().catch(() => {}); else audio.pause(); };
  const toggle = () => {
    if (index < 0 && tracks.length) return loadTrack(0, true);
    if (nativeOn) {
      if (nativeHasQueue()) return plugin().toggle().catch(() => {});
      return loadTrack(index, true);          // selected but not started natively yet
    }
    if (!audio.src) return;
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  };
  const seekTo = sec => {
    if (!Number.isFinite(sec)) return;
    if (nativeOn) { if (nativeHasQueue()) plugin().seekTo({ position: Math.round(sec * 1000) }).catch(() => {}); }
    else audio.currentTime = sec;
  };
  const setVolume = v => {
    prefs.volume = Math.min(1, Math.max(0, v)); savePrefs();
    audio.volume = prefs.volume;
    if (nativeOn) plugin().setVolume({ volume: prefs.volume }).catch(() => {});
  };
  const setShuffle = on => { prefs.shuffle = !!on; savePrefs(); if (nativeOn) plugin().setShuffle({ enabled: prefs.shuffle }).catch(() => {}); render(); };
  const setRepeat = mode => { prefs.repeat = mode; savePrefs(); if (nativeOn) plugin().setRepeat({ mode }).catch(() => {}); render(); };

  /* ---------- library, queue, favourites, playlists ---------- */
  const loadJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const saveJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const LIKED_KEY = "tcPlayerLiked", PL_KEY = "tcPlayerPlaylists", RECENT_KEY = "tcPlayerRecent";
  let library = [];
  let queueAll = true;
  let liked = new Set(loadJson(LIKED_KEY, []));
  let playlists = loadJson(PL_KEY, []);
  let recent = loadJson(RECENT_KEY, []);
  let sleepTimer = null, sleepMin = 0;
  const ui = { tab: "browse", list: null, q: "", np: false };
  const byId = id => library.find(t => t.id === id);
  const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const gradFor = s => `linear-gradient(135deg, hsl(${hue(s)} 70% 45%), hsl(${(hue(s) + 50) % 360} 75% 60%))`;
  const saveOrder = () => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(library.map(t => t.id))); } catch {} };
  const savePl = () => saveJson(PL_KEY, playlists);
  async function persistDuration(t) {
    try { const rec = await dbGet(t.id); if (rec && rec.duration !== t.duration) { rec.duration = t.duration; await dbPut(rec); } } catch {}
  }
  function noteRecent() {
    const t = cur(); if (!t) return;
    recent = [t.id, ...recent.filter(x => x !== t.id)].slice(0, 20);
    saveJson(RECENT_KEY, recent);
  }
  async function addFiles(fileList) {
    const files = [...(fileList || [])].filter(f => f.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|opus|flac|weba)$/i.test(f.name));
    if (!files.length) { toast("Audio fayl seçilmədi."); return; }
    let added = 0;
    for (const f of files) {
      const id = uid(), name = cleanName(f.name), ext = extOf(f.name, f.type), addedAt = Date.now();
      try { await dbPut({ id, name, ext, size: f.size, blob: f, addedAt }); }
      catch { toast("Yaddaş doludur və ya icazə yoxdur: " + f.name); continue; }
      const t = toTrack({ id, name, ext, size: f.size, addedAt });
      library.push(t);
      if (queueAll) tracks.push(t);
      added++;
    }
    saveOrder(); syncQueue(); render();
    if (added) {
      toast(added + " mahnı əlavə olundu.");
      if (index < 0) { tracks = library.slice(); queueAll = true; loadTrack(0, false); }
    }
  }
  async function removeTrack(id) {
    if (!byId(id)) return;
    await dbDel(id).catch(() => {});
    stagedOk.delete(id);
    try { plugin()?.unstage?.({ id }); } catch {}
    library = library.filter(t => t.id !== id);
    liked.delete(id); saveJson(LIKED_KEY, [...liked]);
    playlists.forEach(p => { p.ids = p.ids.filter(x => x !== id); }); savePl();
    recent = recent.filter(x => x !== id); saveJson(RECENT_KEY, recent);
    const i = tracks.findIndex(t => t.id === id);
    if (i >= 0) {
      const wasCurrent = i === index;
      tracks.splice(i, 1);
      if (wasCurrent) {
        loadToken++;
        if (nativeOn) { try { await plugin().setQueue({ tracks: queuePayload(), currentId: null }); } catch {} nState = null; }
        else { audio.pause(); audio.removeAttribute("src"); audio.load(); }
        index = -1;
        if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
      } else if (i < index) index--;
    }
    if (queueAll) tracks = library.slice();
    saveOrder(); syncQueue(); updateMeta(); render();
  }
  function moveTrack(i, dir) {
    const j = i + dir;
    if (!queueAll || i < 0 || j < 0 || j >= tracks.length) return;
    [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    if (index === i) index = j; else if (index === j) index = i;
    library = tracks.slice(); saveOrder(); syncQueue(); render();
  }
  function playNext(id) {
    const t = byId(id); if (!t || index < 0) { if (t) playFromList([t], 0); return; }
    const k = tracks.findIndex(x => x.id === id);
    if (k >= 0) { tracks.splice(k, 1); if (k < index) index--; }
    tracks.splice(index + 1, 0, t); queueAll = false;
    syncQueue(); render(); toast("Növbəti oxunacaq: " + t.title);
  }
  async function clearAll() {
    if (!library.length) return;
    if (!window.confirm("Bütün mahnılar siyahıdan silinsin?")) return;
    loadToken++;
    if (nativeOn) { try { await plugin().stop(); await plugin().clearStaged(); } catch {} nState = null; stagedOk.clear(); }
    else { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    for (const t of library) await dbDel(t.id).catch(() => {});
    library = []; tracks = []; index = -1; queueAll = true;
    liked.clear(); recent = []; playlists.forEach(p => { p.ids = []; });
    saveJson(LIKED_KEY, []); saveJson(RECENT_KEY, []); savePl();
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
    ui.list = null; saveOrder(); syncQueue(); updateMeta(); render();
  }
  function toggleLike(id) {
    if (!id) return;
    if (liked.has(id)) liked.delete(id); else liked.add(id);
    saveJson(LIKED_KEY, [...liked]); render();
  }
  function createPlaylist(name, firstId) {
    const n = String(name || "").trim().slice(0, 40); if (!n) return null;
    const p = { id: uid(), name: n, ids: firstId ? [firstId] : [] };
    playlists.push(p); savePl(); render(); return p;
  }
  function addToPlaylist(pid, id) {
    const p = playlists.find(x => x.id === pid); if (!p || !byId(id)) return;
    if (p.ids.includes(id)) { toast("Bu mahnı artıq “" + p.name + "” playlistindədir."); return; }
    p.ids.push(id); savePl(); render(); toast("“" + p.name + "” playlistinə əlavə olundu.");
  }
  function playFromList(list, i) {
    const t = list[i]; if (!t) return;
    const same = list.length === tracks.length && list.every((x, k) => x.id === tracks[k].id);
    if (cur() && cur().id === t.id && hasSource()) { toggle(); return; }
    if (!same) { tracks = list.slice(); queueAll = tracks.length === library.length && tracks.every((x, k) => x.id === library[k].id); }
    loadTrack(tracks.findIndex(x => x.id === t.id), true);
  }
  function setSleep(min) {
    clearTimeout(sleepTimer); sleepTimer = null; sleepMin = min;
    if (min > 0) {
      sleepTimer = setTimeout(() => { pause(); sleepMin = 0; sleepTimer = null; toast("Yuxu taymeri bitdi, musiqi dayandırıldı."); render(); }, min * 60000);
      toast("Yuxu taymeri: " + min + " dəq.");
    } else toast("Yuxu taymeri söndürüldü.");
    render();
  }

  /* ---------- media session (website / WebView lock screen controls) ---------- */
  function updateMeta() {
    const t = cur();
    if ("mediaSession" in navigator && window.MediaMetadata && !nativeOn) {
      try { navigator.mediaSession.metadata = t ? new MediaMetadata({ title: t.title, artist: t.artist, album: "TalkPlayer" }) : null; } catch {}
    }
  }
  function setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch {} };
    set("play", () => { if (nativeOn) toggle(); else audio.play().catch(() => {}); });
    set("pause", () => pause());
    set("previoustrack", prev); set("nexttrack", next);
    set("seekto", d => { if (d && Number.isFinite(d.seekTime)) seekTo(d.seekTime); });
    set("seekbackward", d => seekTo(Math.max(0, positionSec() - ((d && d.seekOffset) || 10))));
    set("seekforward", d => seekTo(Math.min(durationSec() || 0, positionSec() + ((d && d.seekOffset) || 10))));
  }
  function syncPosition() {
    if (nativeOn || !("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate || 1 }); } catch {}
  }

  /* ---------- UI helpers ---------- */
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const svg = (p, extra = "") => `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${p}</svg>`;
  const fillSvg = p => `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">${p}</svg>`;
  const ICON = {
    play: fillSvg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>'),
    pause: fillSvg('<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>'),
    prev: fillSvg('<rect x="5" y="5" width="2.4" height="14" rx="1"/><path d="M19 6.2v11.6a.8.8 0 0 1-1.25.66l-8.2-5.8a.8.8 0 0 1 0-1.32l8.2-5.8A.8.8 0 0 1 19 6.2z"/>'),
    next: fillSvg('<rect x="16.6" y="5" width="2.4" height="14" rx="1"/><path d="M5 6.2v11.6a.8.8 0 0 0 1.25.66l8.2-5.8a.8.8 0 0 0 0-1.32l-8.2-5.8A.8.8 0 0 0 5 6.2z"/>'),
    shuffle: svg('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>'),
    repeat: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
    repeat1: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1.5v4"/>'),
    heart: svg('<path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 4.8 6.8 4.8c2 0 3.5 1.1 5.2 3 1.7-1.9 3.2-3 5.2-3 3.2 0 5.1 3.2 4 6.4-1.7 4.7-9.2 9.3-9.2 9.3z"/>'),
    heartOn: fillSvg('<path d="M12 20.8s-7.7-4.7-9.4-9.5C1.4 7.9 3.4 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.4 0 5.4 3.4 4.2 6.8-1.7 4.8-9.4 9.5-9.4 9.5z"/>'),
    down: svg('<path d="m6 9 6 6 6-6"/>'), back: svg('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>'),
    queue: svg('<path d="M3 6h13"/><path d="M3 12h13"/><path d="M3 18h8"/><path d="M19 15v6"/><path d="M16 18h6"/>'),
    timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9.5 2.5h5"/>'),
    plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'), search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    more: fillSvg('<circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>'),
    palette: svg('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7H16a5 5 0 0 0 5-5c0-3.7-4-7-9-7z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>'),
    music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    volume: svg('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>')
  };
  const setIcon = (node, name) => { if (node && node.dataset.iconNow !== name) { node.innerHTML = ICON[name] || ""; node.dataset.iconNow = name; } };
  const hydrateIcons = () => document.querySelectorAll("#playerPage [data-icon], #tcPlayerNP [data-icon], #tcMiniPlayer [data-icon]").forEach(node => setIcon(node, node.dataset.icon));

  function openSheet(title, actions) {
    document.querySelector(".tp-sheet-backdrop")?.remove();
    const back = el("div", "tp-sheet-backdrop"), sheet = el("div", "tp-sheet");
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", title);
    sheet.appendChild(el("p", "tp-sheet-title", title));
    const close = () => back.remove();
    actions.forEach(a => { const b = el("button", "tp-sheet-item" + (a.danger ? " danger" : ""), a.label); b.type = "button"; b.onclick = () => { close(); a.fn(); }; sheet.appendChild(b); });
    const c = el("button", "tp-sheet-item cancel", "Bağla"); c.type = "button"; c.onclick = close; sheet.appendChild(c);
    back.onclick = e => { if (e.target === back) close(); };
    back.appendChild(sheet); document.body.appendChild(back);
  }
  function trackMenu(t, list) {
    const acts = [
      { label: "Oxut", fn: () => playFromList(list, list.findIndex(x => x.id === t.id)) },
      { label: "Növbəti oxut", fn: () => playNext(t.id) },
      { label: liked.has(t.id) ? "Bəyənmədən çıxar" : "Bəyən", fn: () => toggleLike(t.id) },
      { label: "Playlistə əlavə et", fn: () => pickPlaylist(t.id) }
    ];
    if (ui.list?.type === "playlist") acts.push({ label: "Bu playlistdən çıxar", fn: () => { const p = playlists.find(x => x.id === ui.list.value); if (p) { p.ids = p.ids.filter(x => x !== t.id); savePl(); render(); } } });
    if (queueAll && !ui.q && ui.list?.type === "all") {
      const qi = tracks.findIndex(x => x.id === t.id);
      if (qi > 0) acts.push({ label: "Yuxarı apar", fn: () => moveTrack(qi, -1) });
      if (qi >= 0 && qi < tracks.length - 1) acts.push({ label: "Aşağı apar", fn: () => moveTrack(qi, 1) });
    }
    acts.push({ label: "Mahnını sil", danger: true, fn: () => removeTrack(t.id) });
    openSheet(t.title, acts);
  }
  function pickPlaylist(id) {
    const acts = playlists.map(pl => ({ label: pl.name + " (" + pl.ids.length + ")", fn: () => addToPlaylist(pl.id, id) }));
    acts.push({ label: "+ Yeni playlist", fn: () => { const n = window.prompt("Playlist adı:"); if (n) { const pl = createPlaylist(n, id); if (pl) toast("“" + pl.name + "” yaradıldı."); } } });
    openSheet("Playlistə əlavə et", acts);
  }
  function iconBtn(cls, icon, label, fn) {
    const b = el("button", cls); b.type = "button"; b.innerHTML = ICON[icon] || "";
    b.setAttribute("aria-label", label); b.onclick = e => { e.stopPropagation(); fn(); }; return b;
  }
  function rowFor(t, list, i) {
    const isCur = cur() && cur().id === t.id, playing = isCur && isPlaying();
    const li = el("li", "tc-player-item" + (isCur ? " current" : "") + (playing ? " playing" : ""));
    const open = el("button", "tc-player-item-main"); open.type = "button";
    const cover = el("span", "tp-cover", (t.title[0] || "♪").toUpperCase());
    cover.style.background = gradFor(t.title + t.artist); cover.setAttribute("aria-hidden", "true");
    const txt = el("span", "tp-row-text"), name = el("span", "tc-player-item-name", t.title), artist = el("small", null, t.artist);
    txt.append(name, artist);
    const dur = el("span", "tc-player-item-dur", t.duration ? fmt(t.duration) : ""); dur.dataset.dur = t.id;
    open.append(cover, txt, dur); open.onclick = () => playFromList(list, i);
    const like = iconBtn("tp-row-like" + (liked.has(t.id) ? " on" : ""), liked.has(t.id) ? "heartOn" : "heart", liked.has(t.id) ? "Bəyənmədən çıxar" : "Bəyən", () => toggleLike(t.id));
    const more = iconBtn("tc-player-item-menu", "more", "Əlavə seçimlər: " + t.title, () => trackMenu(t, list));
    li.append(open, like, more); return li;
  }
  function renderListDuration() {
    document.querySelectorAll("#playerPage [data-dur]").forEach(n => { const t = byId(n.dataset.dur); if (t && t.duration) n.textContent = fmt(t.duration); });
  }
  const artists = () => {
    const m = new Map(); library.forEach(t => m.set(t.artist, (m.get(t.artist) || 0) + 1));
    return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  };
  function currentList() {
    const q = ui.q.trim().toLowerCase();
    if (q) return { title: "Nəticələr", items: library.filter(t => (t.title + " " + t.artist).toLowerCase().includes(q)), clearable: false };
    const f = ui.list; if (!f) return null;
    if (f.type === "all") return { title: "Cihazdakı mahnılar", items: library, clearable: true };
    if (f.type === "liked") return { title: "Bəyənilən mahnılar", items: library.filter(t => liked.has(t.id)) };
    if (f.type === "artist") return { title: f.value, items: library.filter(t => t.artist === f.value) };
    if (f.type === "recent") return { title: "Son oxunanlar", items: recent.map(byId).filter(Boolean) };
    if (f.type === "playlist") { const pl = playlists.find(x => x.id === f.value); return pl ? { title: pl.name, items: pl.ids.map(byId).filter(Boolean), playlist: pl } : null; }
    return null;
  }
  const section = (title, actionLabel, fn) => {
    const w = el("section", "tp-section"), h = el("div", "tp-sechead"); h.appendChild(el("h2", null, title));
    if (actionLabel) { const b = el("button", "tp-link", actionLabel); b.type = "button"; b.onclick = fn; h.appendChild(b); }
    w.appendChild(h); return w;
  };
  const openList = (type, value) => {
    ui.list = { type, value }; ui.q = "";
    const search = $("tcPlayerSearch"); if (search) search.value = "";
    render(); window.scrollTo?.(0, 0);
  };
  function renderHome(home) {
    home.textContent = "";
    if (!library.length) return;
    if (ui.tab === "browse") {
      const a = artists(), cats = section("İfaçılar", a.length > 8 ? "Hamısı" : null, () => openList("all"));
      const row = el("div", "tp-cats");
      a.slice(0, 8).forEach(x => {
        const c = el("button", "tp-cat"); c.type = "button"; c.style.background = gradFor(x.name);
        c.append(el("b", null, x.name), el("small", null, x.n + " mahnı"));
        c.onclick = () => openList("artist", x.name); row.appendChild(c);
      });
      cats.appendChild(row); home.appendChild(cats);
      const pl = section("Playlistlər"), prow = el("div", "tp-pls");
      const add = el("button", "tp-pl tp-pl-new"); add.type = "button";
      add.append(el("span", "tp-pl-plus", "+"), el("b", null, "Yeni playlist"));
      add.onclick = () => { const n = window.prompt("Playlist adı:"); if (n) createPlaylist(n); };
      prow.appendChild(add);
      playlists.forEach(plItem => {
        const c = el("button", "tp-pl"); c.type = "button"; c.style.background = gradFor(plItem.name);
        c.append(el("b", null, plItem.name), el("small", null, plItem.ids.length + " mahnı"));
        c.onclick = () => openList("playlist", plItem.id); prow.appendChild(c);
      });
      pl.appendChild(prow); home.appendChild(pl);
      const fresh = library.slice().sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0)).slice(0, 5);
      const nr = section("Yeni əlavə olunanlar", "Hamısı", () => openList("all")), ul = el("ul", "tc-player-list");
      fresh.forEach((t, i) => ul.appendChild(rowFor(t, fresh, i))); nr.appendChild(ul); home.appendChild(nr);
    } else {
      const rows = [
        ["heart", "Bəyənilən mahnılar", liked.size + " mahnı", () => openList("liked")],
        ["music", "Cihazdakı mahnılar", library.length + " mahnı", () => openList("all")],
        ["queue", "Playlistlər", playlists.length + " playlist", () => { ui.tab = "browse"; render(); }],
        ["palette", "İfaçılar", artists().length + " ifaçı", () => { ui.tab = "browse"; render(); }]
      ];
      const box = el("div", "tp-libs");
      rows.forEach(([ic, name, sub, fn]) => {
        const b = el("button", "tp-lib"); b.type = "button";
        const ico = el("span", "tp-lib-ico"); ico.innerHTML = ICON[ic];
        const txt = el("span", "tp-row-text"); txt.append(el("b", null, name), el("small", null, sub));
        const ch = el("span", "tp-chev"); ch.innerHTML = ICON.back;
        b.append(ico, txt, ch); b.onclick = fn; box.appendChild(b);
      });
      home.appendChild(box);
      const rl = recent.map(byId).filter(Boolean).slice(0, 6);
      if (rl.length) {
        const rs = section("Son oxunanlar", "Hamısı", () => openList("recent")), ul = el("ul", "tc-player-list");
        rl.forEach((t, i) => ul.appendChild(rowFor(t, rl, i))); rs.appendChild(ul); home.appendChild(rs);
      }
    }
  }
  function render() {
    hydrateIcons();
    const t = cur(), title = t ? t.title : "Mahnı seçilməyib";
    [["tcPlayerTitle", title], ["tcMiniTitle", title], ["tcPlayerArtist", t ? t.artist : ""], ["tcMiniArtist", t ? t.artist : ""]].forEach(([id, txt]) => { const n = $(id); if (n) n.textContent = txt; });
    const art = $("tcPlayerArt");
    if (art) { art.textContent = t ? (t.title[0] || "♪").toUpperCase() : "♪"; art.style.background = t ? gradFor(t.title + t.artist) : ""; }
    const cover = document.querySelector(".tc-mini-cover");
    if (cover) { cover.textContent = t ? (t.title[0] || "♪").toUpperCase() : "♪"; cover.style.background = t ? gradFor(t.title + t.artist) : ""; }
    const playing = isPlaying();
    document.body.classList.toggle("tc-player-playing", playing);
    ["tcPlayerPlay", "tcMiniPlay"].forEach(id => {
      const b = $(id); if (b) { setIcon(b, playing ? "pause" : "play"); b.setAttribute("aria-label", playing ? "Dayandır" : "Oxut"); b.dataset.state = playing ? "playing" : "paused"; }
    });
    const rep = $("tcPlayerRepeat");
    if (rep) { setIcon(rep, prefs.repeat === "one" ? "repeat1" : "repeat"); rep.classList.toggle("on", prefs.repeat !== "off"); rep.setAttribute("aria-pressed", prefs.repeat !== "off"); }
    const sh = $("tcPlayerShuffle");
    if (sh) { sh.classList.toggle("on", !!prefs.shuffle); sh.setAttribute("aria-pressed", !!prefs.shuffle); }
    const lk = $("tcPlayerLike");
    if (lk) { const on = !!(t && liked.has(t.id)); setIcon(lk, on ? "heartOn" : "heart"); lk.classList.toggle("on", on); lk.setAttribute("aria-pressed", on); lk.disabled = !t; }
    const sl = $("tcPlayerSleep");
    if (sl) { sl.classList.toggle("on", sleepMin > 0); sl.title = sleepMin ? "Yuxu taymeri: " + sleepMin + " dəq." : "Yuxu taymeri"; }
    const vol = $("tcPlayerVolume");
    if (vol && document.activeElement !== vol) { vol.value = Math.round((nativeOn ? prefs.volume : audio.volume) * 100); vol.style.setProperty("--fill", vol.value + "%"); }
    document.querySelectorAll("#tcPlayerTabs [data-ptab]").forEach(b => { const on = b.dataset.ptab === ui.tab; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
    const empty = $("tcPlayerEmpty"); if (empty) empty.hidden = library.length > 0;
    const cl = currentList(), home = $("tcPlayerHome"), head = $("tcPlayerListHead"), list = $("tcPlayerList"), tabs = $("tcPlayerTabs");
    const showList = !!cl && library.length > 0;
    if (home) { home.hidden = showList; if (!showList) renderHome(home); }
    if (tabs) tabs.hidden = showList || !library.length;
    if (head) {
      head.hidden = !showList;
      if (showList) { $("tcPlayerListTitle").textContent = cl.title + " · " + cl.items.length; $("tcPlayerClear").hidden = !cl.clearable; }
    }
    if (list) {
      list.textContent = ""; list.hidden = !showList;
      if (showList) {
        if (!cl.items.length) list.appendChild(el("li", "tp-noresult", ui.q ? "Heç nə tapılmadı." : "Bu siyahı boşdur."));
        cl.items.forEach((tr, i) => list.appendChild(rowFor(tr, cl.items, i)));
      }
    }
    updateMini();
  }
  function setNP(open) {
    const np = $("tcPlayerNP"); if (!np) return;
    ui.np = !!open && !!cur();
    if (ui.np) { np.hidden = false; requestAnimationFrame(() => np.classList.add("open")); }
    else { np.classList.remove("open"); setTimeout(() => { if (!ui.np) np.hidden = true; }, 280); }
    document.body.classList.toggle("tc-np-open", ui.np); updateMini();
  }
  function updateMini() {
    const mini = $("tcMiniPlayer"); if (!mini) return;
    const appVisible = !$("app")?.hidden;
    mini.hidden = !(index >= 0 && appVisible && !ui.np);
    document.body.classList.toggle("tc-has-mini-player", !mini.hidden);
  }
  function updateProgress() {
    if (seeking) return;
    const d = durationSec(), c = positionSec(), seek = $("tcPlayerSeek");
    if (seek) {
      seek.max = Number.isFinite(d) && d > 0 ? Math.floor(d) : 0; seek.value = Math.floor(c) || 0;
      seek.disabled = !(d > 0) || (nativeOn && !nativeHasQueue());
      seek.style.setProperty("--fill", (d > 0 ? Math.min(100, c / d * 100) : 0) + "%");
    }
    const curEl = $("tcPlayerCur"), dur = $("tcPlayerDur");
    if (curEl) curEl.textContent = fmt(c);
    if (dur) dur.textContent = fmt(d);
    const bar = $("tcMiniBar"); if (bar) bar.style.width = (d > 0 ? Math.min(100, c / d * 100) : 0) + "%";
  }
  function bind() {
    $("tcPlayerPlay")?.addEventListener("click", toggle);
    $("tcMiniPlay")?.addEventListener("click", e => { e.stopPropagation(); toggle(); });
    $("tcMiniNext")?.addEventListener("click", e => { e.stopPropagation(); next(); });
    $("tcMiniOpen")?.addEventListener("click", () => { if ($("playerPage")?.hidden && window.showPage) window.showPage("player"); setNP(true); });
    $("tcPlayerNext")?.addEventListener("click", next); $("tcPlayerPrev")?.addEventListener("click", prev);
    const pick = () => $("tcPlayerFile")?.click();
    $("tcPlayerAdd")?.addEventListener("click", pick); $("tcPlayerEmptyAdd")?.addEventListener("click", pick);
    $("tcPlayerFile")?.addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
    $("tcPlayerShuffle")?.addEventListener("click", () => setShuffle(!prefs.shuffle));
    $("tcPlayerRepeat")?.addEventListener("click", () => setRepeat(prefs.repeat === "off" ? "all" : prefs.repeat === "all" ? "one" : "off"));
    $("tcPlayerLike")?.addEventListener("click", () => toggleLike(cur()?.id));
    $("tcPlayerNPClose")?.addEventListener("click", () => setNP(false));
    $("tcPlayerQueueBtn")?.addEventListener("click", () => { setNP(false); openList("all"); });
    $("tcPlayerSleep")?.addEventListener("click", () => setSleep(sleepMin === 0 ? 15 : sleepMin === 15 ? 30 : sleepMin === 30 ? 60 : 0));
    $("tcPlayerThemeBtn")?.addEventListener("click", () => { if (window.showPage) window.showPage("store"); window.TalkChatStore?.open?.("looks"); });
    $("tcPlayerBack")?.addEventListener("click", () => { ui.list = null; ui.q = ""; const search = $("tcPlayerSearch"); if (search) search.value = ""; render(); });
    $("tcPlayerClear")?.addEventListener("click", clearAll);
    $("tcPlayerSearch")?.addEventListener("input", e => { ui.q = e.target.value; render(); });
    document.querySelectorAll("#tcPlayerTabs [data-ptab]").forEach(b => b.addEventListener("click", () => { ui.tab = b.dataset.ptab; ui.list = null; render(); }));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && ui.np) setNP(false); });
    const seek = $("tcPlayerSeek");
    if (seek) {
      seek.addEventListener("input", () => { seeking = true; const c = $("tcPlayerCur"); if (c) c.textContent = fmt(Number(seek.value)); seek.style.setProperty("--fill", (seek.max > 0 ? Number(seek.value) / seek.max * 100 : 0) + "%"); });
      seek.addEventListener("change", () => { seekTo(Number(seek.value)); seeking = false; updateProgress(); });
    }
    $("tcPlayerVolume")?.addEventListener("input", e => { setVolume(Number(e.target.value) / 100); e.target.style.setProperty("--fill", e.target.value + "%"); });
  }

  /* ---------- web engine events ---------- */
  audio.addEventListener("play", () => { if (nativeOn) return; noteRecent(); keepAlive(true); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; render(); });
  audio.addEventListener("pause", () => { if (nativeOn) return; if (!audio.ended) keepAlive(false); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; render(); });
  audio.addEventListener("ended", () => {
    if (nativeOn) return;
    if (prefs.repeat === "one") { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    const n = nextIndex(1);
    if (n >= 0) loadTrack(n, true); else { keepAlive(false); render(); }
  });
  audio.addEventListener("timeupdate", () => { if (!nativeOn) updateProgress(); });
  audio.addEventListener("loadedmetadata", () => {
    if (nativeOn) return;
    const t = cur();
    if (t && Number.isFinite(audio.duration) && audio.duration > 0 && Math.abs((t.duration || 0) - audio.duration) > 1) { t.duration = Math.round(audio.duration); renderListDuration(); persistDuration(t); }
    updateProgress(); syncPosition();
  });
  audio.addEventListener("seeked", syncPosition);
  audio.addEventListener("error", () => { if (!nativeOn && audio.src) toast("Bu audio formatı oxuna bilmir."); });

  async function load() {
    attachNative();
    if (ready) { render(); return; }
    ready = true;
    try {
      const rows = await dbAll();
      let order = []; try { order = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]"); } catch {}
      const rank = id => { const k = order.indexOf(id); return k < 0 ? Infinity : k; };
      library = (rows || []).sort((a, b) => (rank(a.id) - rank(b.id)) || ((a.addedAt || 0) - (b.addedAt || 0))).map(toTrack);
      tracks = library.slice(); queueAll = true;
      saveOrder();
    } catch (e) { toast("Musiqi yaddaşı açılmadı: " + e.message); }
    await adoptNativeState();
    if (tracks.length && index < 0) await loadTrack(0, false);
    syncQueue(); render();
  }

  bind(); setupMediaSession();
  window.addEventListener("talkchat:entered", () => { load(); });
  window.addEventListener("talkchat:pagechange", updateMini);
  window.TalkChatPlayer = {
    load, toggle, next, prev, pause, seekTo, setVolume, setShuffle, setRepeat, addFiles, updateMini,
    removeTrack, moveTrack, playNext, clear: clearAll, toggleLike, createPlaylist, addToPlaylist, setSleep,
    openNowPlaying: () => setNP(true), closeNowPlaying: () => setNP(false),
    play: i => loadTrack(i, true),
    isLiked: id => liked.has(id),
    playlists: () => playlists.map(pl => ({ id: pl.id, name: pl.name, count: pl.ids.length })),
    getState: () => ({ native: nativeOn, playing: isPlaying(), index, track: cur(), queue: tracks.slice(), library: library.slice(), position: positionSec(), duration: durationSec(), shuffle: !!prefs.shuffle, repeat: prefs.repeat, volume: prefs.volume })
  };
})();
