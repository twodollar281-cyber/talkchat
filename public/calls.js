/* TALKCHAT_CALLS_V3
   Sesli arama: sessize alma + ekran paylaşımı (WebRTC).
   app.js'ten SONRA yüklenir; app.js'teki socket, me, conversationsCache, activeConversation değişkenlerini kullanır.
   Mevcut socket olay adlarıyla uyumludur:
   call:invite / call:incoming / call:accept / call:accepted / call:reject / call:rejected / call:signal / call:end / call:ended
   (hepsi { conversationId } taşır; call:signal ayrıca { signal } taşır)
   Yeni: signal içinde { muted: true|false } ve { screen: true|false } alanları da gönderilir. */
(() => {
  "use strict";
  if (typeof socket === "undefined" || window.__tccLoaded) return;
  window.__tccLoaded = true;

  const RING_MS = window.TCC_RING_MS || 40000; // arayan bu kadar bekler
  // Farklı ağlar (mobil veri <-> Wi-Fi) için TURN eklemek istersen: window.TC_ICE_SERVERS = [...]
  const ICE = window.TC_ICE_SERVERS || [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

  /* ---------- metinler (tr / az / en) ---------- */
  const LANG = () => { try { return localStorage.getItem("talkchat-language") || "tr"; } catch { return "tr"; } };
  const S = {
    calling:    { tr: "Aranıyor…", az: "Zəng edilir…", en: "Calling…" },
    connecting: { tr: "Bağlanıyor…", az: "Qoşulur…", en: "Connecting…" },
    incoming:   { tr: "Sesli arama", az: "Səsli zəng", en: "Voice call" },
    accept:     { tr: "Cevapla", az: "Qəbul et", en: "Answer" },
    decline:    { tr: "Reddet", az: "Rədd et", en: "Decline" },
    mute:       { tr: "Sessize al", az: "Səssiz", en: "Mute" },
    unmute:     { tr: "Sesi aç", az: "Səsi aç", en: "Unmute" },
    share:      { tr: "Ekran paylaş", az: "Ekranı paylaş", en: "Share screen" },
    stopShare:  { tr: "Paylaşımı durdur", az: "Paylaşımı dayandır", en: "Stop sharing" },
    hangup:     { tr: "Bitir", az: "Bitir", en: "End" },
    remoteMuted:{ tr: "Karşı taraf mikrofonu kapattı", az: "Qarşı tərəf mikrofonu bağladı", en: "They muted their microphone" },
    youShare:   { tr: "Ekranını paylaşıyorsun", az: "Ekranını paylaşırsan", en: "You are sharing your screen" },
    ended:      { tr: "Arama bitti", az: "Zəng bitdi", en: "Call ended" },
    noAnswer:   { tr: "Yanıt vermedi", az: "Cavab vermədi", en: "No answer" },
    declined:   { tr: "Arama reddedildi", az: "Zəng rədd edildi", en: "Call declined" },
    dropped:    { tr: "Bağlantı koptu", az: "Bağlantı kəsildi", en: "Connection lost" },
    weak:       { tr: "Bağlantı zayıf…", az: "Bağlantı zəifdir…", en: "Weak connection…" },
    failed:     { tr: "Bağlantı kurulamadı", az: "Bağlantı qurulmadı", en: "Could not connect" },
    micDenied:  { tr: "Mikrofon izni verilmedi. Tarayıcı ayarlarından mikrofona izin ver.",
                  az: "Mikrofon icazəsi verilmədi. Brauzer ayarlarından mikrofona icazə ver.",
                  en: "Microphone permission was denied. Allow the microphone in your browser settings." },
    needHttps:  { tr: "Sesli arama için güvenli bağlantı (HTTPS) gerekli.\n\nAynı cihazdaysan http://localhost kullan. Başka cihazdan bağlanıyorsan sunucuyu HTTPS ile aç.",
                  az: "Səsli zəng üçün təhlükəsiz bağlantı (HTTPS) lazımdır.\n\nEyni cihazdasansa http://localhost istifadə et. Başqa cihazdan qoşulursansa serveri HTTPS ilə aç.",
                  en: "Voice calls need a secure connection (HTTPS).\n\nOn the same device use http://localhost. From another device, run the server over HTTPS." },
    noRtc:      { tr: "Bu tarayıcı sesli aramayı desteklemiyor.", az: "Bu brauzer səsli zəngi dəstəkləmir.", en: "This browser does not support voice calls." },
    noScreen:   { tr: "Bu tarayıcı ekran paylaşımını desteklemiyor.\n\nGenelde bilgisayardaki Chrome, Edge, Firefox ve Safari destekler; telefon tarayıcılarının çoğu desteklemez. Karşı tarafın paylaştığı ekranı ise yine de görebilirsin.",
                  az: "Bu brauzer ekran paylaşımını dəstəkləmir.\n\nÇox vaxt kompüterdəki Chrome, Edge, Firefox və Safari dəstəkləyir; telefon brauzerlərinin çoxu dəstəkləmir. Qarşı tərəfin paylaşdığı ekranı isə görə bilərsən.",
                  en: "This browser does not support screen sharing.\n\nDesktop Chrome, Edge, Firefox and Safari usually do; most phone browsers do not. You can still see a screen the other person shares." },
    group:      { tr: "Arama sadece birebir sohbetlerde yapılabilir.", az: "Zəng yalnız şəxsi söhbətdə mümkündür.", en: "Calls are only available in one-to-one chats." },
    already:    { tr: "Zaten bir aramadasın.", az: "Artıq zəngdəsən.", en: "You are already in a call." },
    noPeer:     { tr: "Önce bir sohbet seç.", az: "Əvvəlcə söhbət seç.", en: "Select a chat first." },
    offline:    { tr: "Sunucuya bağlı değilsin. Birazdan tekrar dene.", az: "Serverə qoşulu deyilsən. Bir az sonra yenidən yoxla.", en: "You are not connected to the server. Try again shortly." },
    shareFail:  { tr: "Ekran paylaşımı başlatılamadı: ", az: "Ekran paylaşımı başlamadı: ", en: "Could not start screen sharing: " },
  };
  const tx = (k) => (S[k] && (S[k][LANG()] || S[k].tr)) || k;

  /* ---------- arayüz ---------- */
  const IC = {
    phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
    hang:  '<svg viewBox="0 0 24 24"><path d="M3 14c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-7 0V15l-3 1.5z"/></svg>',
    mic:   '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    micoff:'<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/></svg>',
    screen:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M9 11l3-3 3 3M12 8v6"/></svg>',
  };
  const btn = (id, cls) => `<button type="button" id="${id}" class="tcc-btn ${cls}"><span class="tcc-ic"></span><span class="tcc-lb"></span></button>`;

  const box = document.createElement("section");
  box.id = "tccBox";
  box.className = "tcc";
  box.hidden = true;
  box.innerHTML = `
    <video id="tccVideo" class="tcc-video" autoplay playsinline muted hidden></video>
    <div class="tcc-mid">
      <div id="tccAvatar" class="tcc-avatar"></div>
      <strong id="tccName" class="tcc-name"></strong>
      <p id="tccStatus" class="tcc-status"></p>
      <p id="tccNote" class="tcc-note"></p>
    </div>
    <div class="tcc-bar tcc-bar-in">${btn("tccDecline", "end")}${btn("tccAccept", "ok")}</div>
    <div class="tcc-bar tcc-bar-call">${btn("tccMute", "")}${btn("tccScreen", "")}${btn("tccHang", "end")}</div>
    <audio id="tccAudio" autoplay playsinline></audio>`;
  document.body.appendChild(box);
  const $ = (id) => document.getElementById(id);
  const el = { video: $("tccVideo"), avatar: $("tccAvatar"), name: $("tccName"), status: $("tccStatus"), note: $("tccNote"),
               audio: $("tccAudio"), mute: $("tccMute"), screen: $("tccScreen"), accept: $("tccAccept"), decline: $("tccDecline"), hang: $("tccHang") };
  const setText = (node, t) => { if (node.textContent !== t) node.textContent = t; };
  const setIcon = (b, svg) => { const s = b.querySelector(".tcc-ic"); if (s.dataset.i !== svg) { s.innerHTML = IC[svg]; s.dataset.i = svg; } };
  const label = (b, t) => setText(b.querySelector(".tcc-lb"), t);
  const fmt = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

  /* ---------- durum ---------- */
  let cur = null; // aktif arama
  let inc = null; // gelen arama (henüz cevaplanmadı)
  const busy = () => (cur && !cur.over) || !!inc;
  const newCall = (o) => ({ pc: null, vTrans: null, pending: [], cands: [], remoteSet: false, making: false, ignore: false,
    accepted: false, muted: false, sharing: false, remoteMuted: false, remoteSharing: false, over: false, connectedAt: 0,
    tick: null, ringTimer: null, warn: "", endText: "", screenTrack: null, ...o });
  const emit = (ev, convo, extra) => socket.emit(ev, { conversationId: convo, ...(extra || {}) });
  const sig = (c, signal) => emit("call:signal", c.convo, { signal });

  function paint() {
    const c = cur, i = inc;
    const who = c ? c.peer : i ? i.peer : "";
    box.hidden = !who;
    if (!who) return;
    const video = !!(c && c.remoteSharing && !c.over);
    box.classList.toggle("is-incoming", !c && !!i);
    box.classList.toggle("has-video", video);
    el.video.hidden = !video;
    setText(el.avatar, who[0].toUpperCase());
    setText(el.name, who);
    let status;
    if (!c) status = tx("incoming");
    else if (c.over) status = c.endText || tx("ended");
    else if (c.connectedAt) status = c.warn || fmt(Math.floor((Date.now() - c.connectedAt) / 1000));
    else status = tx(c.stage);
    setText(el.status, status);
    const notes = [];
    if (c && c.remoteMuted && !c.over) notes.push(tx("remoteMuted"));
    if (c && c.sharing && !c.over) notes.push(tx("youShare"));
    setText(el.note, notes.join(" · "));

    setIcon(el.accept, "phone"); label(el.accept, tx("accept"));
    setIcon(el.decline, "hang"); label(el.decline, tx("decline"));
    setIcon(el.hang, "hang"); label(el.hang, tx("hangup"));
    setIcon(el.mute, c && c.muted ? "micoff" : "mic");
    label(el.mute, c && c.muted ? tx("unmute") : tx("mute"));
    el.mute.classList.toggle("on", !!(c && c.muted));
    setIcon(el.screen, "screen");
    label(el.screen, c && c.sharing ? tx("stopShare") : tx("share"));
    el.screen.classList.toggle("on", !!(c && c.sharing));
  }

  /* ---------- zil sesi + bildirim ---------- */
  let ringCtx = null, ringTimer = null;
  function startRing() {
    stopRing();
    try {
      ringCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (ringCtx.resume) ringCtx.resume();
      const beep = () => {
        const o = ringCtx.createOscillator(), g = ringCtx.createGain();
        o.frequency.value = 480; g.gain.value = 0.12;
        o.connect(g); g.connect(ringCtx.destination);
        o.start(); o.stop(ringCtx.currentTime + 0.45);
        if (navigator.vibrate) navigator.vibrate([350, 150, 350]);
      };
      beep();
      ringTimer = setInterval(beep, 2200);
    } catch {}
  }
  function stopRing() {
    clearInterval(ringTimer); ringTimer = null;
    try { if (ringCtx) ringCtx.close(); } catch {}
    ringCtx = null;
    try { if (navigator.vibrate) navigator.vibrate(0); } catch {}
  }
  const askNotify = () => { try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {} };
  const notify = (who) => { try { if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification(tx("incoming") + ": " + who); } catch {} };

  let wake = null;
  const takeWake = async () => { try { if (navigator.wakeLock) wake = await navigator.wakeLock.request("screen"); } catch {} };
  const dropWake = () => { try { if (wake) wake.release(); } catch {} wake = null; };

  /* ---------- WebRTC ---------- */
  const problem = () => {
    if (!window.RTCPeerConnection) return tx("noRtc");
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return tx("needHttps");
    return "";
  };
  const getMic = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });

  async function createPC(c) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    c.pc = pc;
    c.local.getTracks().forEach((t) => pc.addTrack(t, c.local));
    // Ekran paylaşımı için baştan hazır video hattı: paylaşırken yeniden pazarlık gerekmez
    c.vTrans = pc.addTransceiver("video", { direction: "sendrecv" });

    pc.ontrack = (e) => {
      const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
      if (e.track.kind === "audio") { el.audio.srcObject = stream; el.audio.play().catch(() => {}); }
      else { el.video.srcObject = new MediaStream([e.track]); el.video.play().catch(() => {}); }
    };
    pc.onicecandidate = (e) => { if (e.candidate) sig(c, { candidate: e.candidate }); };
    pc.onnegotiationneeded = async () => {
      if (c.role === "callee" && !c.remoteSet) return; // ilk teklifi arayan verir
      try {
        c.making = true;
        await pc.setLocalDescription();
        sig(c, { description: pc.localDescription });
      } catch (e) { console.error("Zəng təklifi:", e); } finally { c.making = false; }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        c.warn = "";
        if (!c.connectedAt) { c.connectedAt = Date.now(); c.tick = setInterval(paint, 1000); takeWake(); }
      } else if (s === "disconnected") c.warn = tx("weak");
      else if (s === "failed") {
        c.warn = tx("failed");
        setTimeout(() => { if (cur === c && !c.over) hangUp(tx("failed")); }, 2500);
      }
      paint();
    };
    for (const s of c.pending.splice(0)) await handleSignal(c, s);
  }

  // "Mükemmel pazarlık": callee kibar taraf, çakışmada teklifi geri alır
  async function handleSignal(c, s) {
    if (!s) return;
    if (!c.pc) { c.pending.push(s); return; }
    const pc = c.pc;
    try {
      if (s.description) {
        const collision = s.description.type === "offer" && (c.making || pc.signalingState !== "stable");
        c.ignore = c.role !== "callee" && collision;
        if (c.ignore) return;
        await pc.setRemoteDescription(s.description);
        c.remoteSet = true;
        for (const k of c.cands.splice(0)) await pc.addIceCandidate(k).catch(() => {});
        if (s.description.type === "offer") {
          await pc.setLocalDescription();
          sig(c, { description: pc.localDescription });
        }
      } else if (s.candidate) {
        if (!c.remoteSet) c.cands.push(s.candidate);
        else await pc.addIceCandidate(s.candidate).catch((e) => { if (!c.ignore) console.warn("ICE:", e); });
      } else if ("muted" in s) { c.remoteMuted = !!s.muted; paint(); }
      else if ("screen" in s) { c.remoteSharing = !!s.screen; paint(); }
    } catch (e) { console.error("Zəng siqnalı:", e); }
  }

  /* ---------- arama akışı ---------- */
  async function startCall() {
    if (busy()) return alert(tx("already"));
    const conv = conversationsCache.find((x) => x.id === activeConversation);
    if (!conv || conv.type === "group") return alert(conv ? tx("group") : tx("noPeer"));
    const peer = (conv.participants || []).find((p) => p !== me) || conv.name;
    if (!peer || peer === me) return alert(tx("noPeer"));
    const p = problem();
    if (p) return alert(p);
    if (!socket.connected) return alert(tx("offline"));
    askNotify();
    let local;
    try { local = await getMic(); } catch { return alert(tx("micDenied")); }
    if (busy()) { local.getTracks().forEach((t) => t.stop()); return; }
    const c = (cur = newCall({ convo: conv.id, peer, role: "caller", local, stage: "calling" }));
    paint();
    emit("call:invite", c.convo);
    c.ringTimer = setTimeout(() => { if (cur === c && !c.accepted && !c.over) hangUp(tx("noAnswer")); }, RING_MS);
  }

  function showIncoming(d) {
    inc = { convo: d.conversationId, peer: d.from || "?" };
    paint();
    startRing();
    notify(inc.peer);
  }
  function dismissIncoming() {
    inc = null;
    stopRing();
    paint();
  }
  function declineIncoming() {
    const i = inc;
    if (!i) return;
    dismissIncoming();
    emit("call:reject", i.convo);
  }

  async function acceptIncoming() {
    const i = inc;
    if (!i || (cur && !cur.over)) return;
    const p = problem();
    if (p) { alert(p); return declineIncoming(); }
    let local;
    try { local = await getMic(); } catch { alert(tx("micDenied")); return declineIncoming(); }
    if (inc !== i) { local.getTracks().forEach((t) => t.stop()); return; } // bu arada arama bitti
    inc = null;
    stopRing();
    const c = (cur = newCall({ convo: i.convo, peer: i.peer, role: "callee", local, stage: "connecting", accepted: true }));
    paint();
    try { await createPC(c); } catch (e) { emit("call:end", c.convo); endLocal(c, tx("failed")); return; }
    if (c.over) return;
    emit("call:accept", c.convo); // hazır olduktan sonra kabul et ki arayanın teklifi kaçmasın
  }

  function endLocal(c, text) {
    if (c.over) return;
    c.over = true;
    c.endText = text || "";
    clearTimeout(c.ringTimer);
    clearInterval(c.tick);
    if (c.sharing) { c.sharing = false; }
    try { if (c.screenTrack) c.screenTrack.stop(); } catch {}
    try { c.local.getTracks().forEach((t) => t.stop()); } catch {}
    try { if (c.pc) c.pc.close(); } catch {}
    el.audio.srcObject = null;
    el.video.srcObject = null;
    dropWake();
    paint();
    setTimeout(() => { if (cur === c) { cur = null; paint(); } }, text ? 1400 : 0);
  }

  function hangUp(text) {
    const c = cur;
    if (!c || c.over) return;
    emit("call:end", c.convo);
    endLocal(c, typeof text === "string" ? text : "");
  }

  /* ---------- mikrofon & ekran paylaşımı ---------- */
  function toggleMute() {
    const c = cur;
    if (!c || c.over || !c.local) return;
    c.muted = !c.muted;
    c.local.getAudioTracks().forEach((t) => (t.enabled = !c.muted));
    sig(c, { muted: c.muted });
    paint();
  }

  async function toggleShare() {
    const c = cur;
    if (!c || c.over) return;
    if (c.sharing) return stopShare(c);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return alert(tx("noScreen"));
    if (!c.vTrans) return;
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const t = ds.getVideoTracks()[0];
      if ("contentHint" in t) t.contentHint = "detail";
      await c.vTrans.sender.replaceTrack(t);
      c.screenTrack = t;
      c.sharing = true;
      t.onended = () => stopShare(c); // tarayıcının "Paylaşımı durdur" düğmesi
      sig(c, { screen: true });
      paint();
    } catch (e) {
      if (e && e.name !== "NotAllowedError" && e.name !== "AbortError") alert(tx("shareFail") + e.message);
    }
  }
  function stopShare(c) {
    if (!c.sharing) return;
    c.sharing = false;
    try { c.screenTrack.stop(); } catch {}
    c.screenTrack = null;
    if (!c.over) {
      c.vTrans.sender.replaceTrack(null).catch(() => {});
      sig(c, { screen: false });
    }
    paint();
  }

  /* ---------- socket olayları ---------- */
  socket.on("call:incoming", (d) => {
    if (!d || !d.conversationId) return;
    if (busy()) { emit("call:reject", d.conversationId); return; } // meşgul: arayan boşuna beklemesin
    if (cur && cur.over) cur = null;
    showIncoming(d);
  });
  socket.on("call:accepted", async (d) => {
    const c = cur;
    if (!c || c.over || c.role !== "caller" || !d || d.conversationId !== c.convo) return;
    c.accepted = true;
    clearTimeout(c.ringTimer);
    c.stage = "connecting";
    paint();
    try { await createPC(c); } catch (e) { emit("call:end", c.convo); endLocal(c, tx("failed")); }
  });
  socket.on("call:signal", (d) => {
    const c = cur;
    if (c && !c.over && d && d.conversationId === c.convo) handleSignal(c, d.signal);
  });
  socket.on("call:rejected", (d) => {
    const c = cur;
    if (c && !c.over && d && d.conversationId === c.convo) endLocal(c, tx("declined"));
  });
  socket.on("call:ended", (d) => {
    if (!d) return;
    if (inc && inc.convo === d.conversationId) dismissIncoming();
    const c = cur;
    if (c && !c.over && c.convo === d.conversationId) endLocal(c, c.connectedAt ? "" : tx("noAnswer"));
  });
  socket.on("disconnect", () => {
    if (inc) dismissIncoming();
    const c = cur;
    if (c && !c.over && !c.connectedAt) endLocal(c, tx("dropped")); // bağlanmış arama p2p devam eder
  });

  /* ---------- düğmeler ---------- */
  el.accept.onclick = acceptIncoming;
  el.decline.onclick = declineIncoming;
  el.mute.onclick = toggleMute;
  el.screen.onclick = toggleShare;
  el.hang.onclick = () => hangUp();
  // Sohbet başlığındaki telefon düğmesi (id ile; eski aria-label de çalışır, dil çevirisi aria-label'i değiştirse bile id yeter)
  document.addEventListener("click", (e) => {
    if (e.target.closest('#tcCallBtn, [data-talk-original-aria-label="Səsli zəng"], [aria-label="Səsli zəng"]')) startCall();
  });
  window.addEventListener("beforeunload", () => { if (cur && !cur.over) emit("call:end", cur.convo); });
})();
