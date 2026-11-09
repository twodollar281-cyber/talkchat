/* TALKCHAT_CALLS_V4
   Sesli arama: sessize alma + ekran paylaşımı (WebRTC).
   app.js'ten SONRA yüklenir; app.js'teki socket, me, conversationsCache, activeConversation değişkenlerini kullanır.
   Mevcut socket olay adlarıyla uyumludur:
   call:invite / call:incoming / call:accept / call:accepted / call:reject / call:rejected / call:signal / call:end / call:ended
   (hepsi { conversationId } taşır; call:signal ayrıca { signal } taşır)
   Yeni: signal içinde { muted: true|false } ve { screen: true|false } alanları da gönderilir.
   V4: TURN bilgisi süre dolunca yenilenir, hata önbelleğe alınmaz; bağlantı zaman aşımı + ICE yeniden başlatma;
       olay işleyicileri artık await'lerden ÖNCE atanır; anlaşılır hata mesajları. */
(() => {
  "use strict";
  if (typeof socket === "undefined" || window.__tccLoaded) return;
  window.__tccLoaded = true;

  const RING_MS = window.TCC_RING_MS || 40000; // arayan bu kadar bekler
  const CONNECT_MS = window.TCC_CONNECT_MS || 30000; // kabul edildikten sonra bağlantı kurulma süresi
  // Farklı ağlar (mobil veri <-> Wi-Fi) için TURN: sunucudaki /api/calls/ice (Turnix) kullanılır.
  const STUN_ONLY = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const ICE = window.TC_ICE_SERVERS || STUN_ONLY;
  /* ICE_LOADER_START */
  const iceState = { servers: null, expires: 0, pending: null, turn: false, error: "" };
  const hasTurn = (list) => Array.isArray(list) && list.some((s) => [].concat((s && s.urls) || []).some((u) => /^turns?:/i.test(String(u))));
  const getIceServers = () => {
    if (Array.isArray(window.TC_ICE_SERVERS) && window.TC_ICE_SERVERS.length) { iceState.turn = hasTurn(window.TC_ICE_SERVERS); return Promise.resolve(window.TC_ICE_SERVERS); }
    if (iceState.servers && Date.now() < iceState.expires) return Promise.resolve(iceState.servers);
    if (iceState.pending) return iceState.pending;
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 12000) : null;
    iceState.pending = fetch("/api/calls/ice", { credentials: "same-origin", cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then((r) => { if (!r.ok) throw new Error("ICE HTTP " + r.status); return r.json(); })
      .then((d) => {
        if (!d || !Array.isArray(d.iceServers) || !d.iceServers.length) throw new Error("ICE response invalid");
        const exp = d.expiresAt ? Date.parse(d.expiresAt) : NaN;
        const ttl = Number.isFinite(exp) ? Math.max(exp - Date.now() - 90000, 0) : 50 * 60 * 1000;
        iceState.error = ""; iceState.servers = d.iceServers; iceState.expires = Date.now() + ttl; iceState.turn = hasTurn(d.iceServers);
        return d.iceServers;
      })
      .catch((e) => { iceState.error = (e && e.message) || "unknown"; console.error("TalkChat: /api/calls/ice alınamadı — TURN YOK, yalnız STUN ile denenecek (" + iceState.error + "). Farklı ağlardaki aramalar başarısız olabilir."); iceState.turn = false; return ICE; })
      .finally(() => { clearTimeout(timer); iceState.pending = null; });
    return iceState.pending;
  };
  /* ICE_LOADER_END */
  window.TalkChatICE = window.TalkChatICE || {};
  window.TalkChatICE.get = getIceServers;
  window.TalkChatICE.hasTurn = () => iceState.turn;
  window.TalkChatNativeScreen = window.TalkChatNativeScreen || {
    async start(onStopped) {
      const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CallService;
      if (!P || !P.startScreenShare || !P.addListener || !HTMLCanvasElement.prototype.captureStream) throw new Error("Android screen capture is not installed in this app build.");
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { alpha: false });
      canvas.width = 960; canvas.height = 540;
      let stopped = false, decoding = false;
      const frameHandle = await P.addListener("screenFrame", data => {
        if (stopped || decoding || !data || !data.frame) return;
        decoding = true;
        const image = new Image();
        image.onload = () => { if (!stopped) { canvas.width = image.naturalWidth || canvas.width; canvas.height = image.naturalHeight || canvas.height; ctx.drawImage(image, 0, 0, canvas.width, canvas.height); } decoding = false; };
        image.onerror = () => { decoding = false; };
        image.src = "data:image/jpeg;base64," + data.frame;
      });
      const stopHandle = await P.addListener("screenCaptureStopped", () => { if (!stopped && onStopped) onStopped(); });
      const stream = canvas.captureStream(12);
      try { await P.startScreenShare(); }
      catch (error) { stopped = true; frameHandle.remove(); stopHandle.remove(); stream.getTracks().forEach(t => t.stop()); throw error; }
      return { stream, async stop(nativeStopped = false) { if (stopped) return; stopped = true; frameHandle.remove(); stopHandle.remove(); stream.getTracks().forEach(t => t.stop()); if (!nativeStopped && P.stopScreenShare) await P.stopScreenShare(); } };
    }
  };


  /* ---------- metinler (tr / az / en) ---------- */
  const LANG = () => { try { return localStorage.getItem("talkchat-language") || "tr"; } catch { return "tr"; } };
  const S = {
    calling:    { tr: "Aranıyor…", az: "Zəng edilir…", en: "Calling…", ru: "Вызов…" },
    connecting: { tr: "Bağlanıyor…", az: "Qoşulur…", en: "Connecting…", ru: "Подключение…" },
    incoming:   { tr: "Sesli arama", az: "Səsli zəng", en: "Voice call", ru: "Голосовой звонок" },
    accept:     { tr: "Cevapla", az: "Qəbul et", en: "Answer", ru: "Ответить" },
    decline:    { tr: "Reddet", az: "Rədd et", en: "Decline", ru: "Отклонить" },
    mute:       { tr: "Sessize al", az: "Səssiz", en: "Mute", ru: "Без звука" },
    unmute:     { tr: "Sesi aç", az: "Səsi aç", en: "Unmute", ru: "Включить звук" },
    share:      { tr: "Ekran paylaş", az: "Ekranı paylaş", en: "Share screen", ru: "Поделиться экраном" },
    stopShare:  { tr: "Paylaşımı durdur", az: "Paylaşımı dayandır", en: "Stop sharing", ru: "Остановить показ" },
    hangup:     { tr: "Bitir", az: "Bitir", en: "End", ru: "Завершить" },
    videoIncoming:{ tr: "Görüntülü arama", az: "Video zəng", en: "Video call", ru: "Видеозвонок" },
    cameraOn:   { tr: "Kamerayı kapat", az: "Kameranı bağla", en: "Turn camera off", ru: "Выключить камеру" },
    cameraOff:  { tr: "Kamerayı aç", az: "Kameranı aç", en: "Turn camera on", ru: "Включить камеру" },
    switchCamera:{ tr: "Kamerayı değiştir", az: "Kameranı dəyiş", en: "Switch camera", ru: "Переключить камеру" },
    cameraFail: { tr: "Kamera açılamadı.", az: "Kamera açıla bilmədi.", en: "Could not access the camera.", ru: "Не удалось включить камеру." },
    reconnecting:{ tr: "Bağlantı yenileniyor…", az: "Bağlantı yenilənir…", en: "Reconnecting…", ru: "Переподключение…" },
    remoteMuted:{ tr: "Karşı taraf mikrofonu kapattı", az: "Qarşı tərəf mikrofonu bağladı", en: "They muted their microphone", ru: "Собеседник выключил микрофон" },
    youShare:   { tr: "Ekranını paylaşıyorsun", az: "Ekranını paylaşırsan", en: "You are sharing your screen", ru: "Вы показываете экран" },
    ended:      { tr: "Arama bitti", az: "Zəng bitdi", en: "Call ended", ru: "Звонок завершён" },
    noAnswer:   { tr: "Yanıt vermedi", az: "Cavab vermədi", en: "No answer", ru: "Нет ответа" },
    declined:   { tr: "Arama reddedildi", az: "Zəng rədd edildi", en: "Call declined", ru: "Звонок отклонён" },
    dropped:    { tr: "Bağlantı koptu", az: "Bağlantı kəsildi", en: "Connection lost", ru: "Соединение прервано" },
    weak:       { tr: "Bağlantı zayıf…", az: "Bağlantı zəifdir…", en: "Weak connection…", ru: "Слабое соединение…" },
    failed:     { tr: "Bağlantı kurulamadı", az: "Bağlantı qurulmadı", en: "Could not connect", ru: "Не удалось соединиться" },
    noTurn:     { tr: "Bağlantı kurulamadı. Farklı ağlardaki cihazlar için TURN sunucusuna ulaşılamadı.",
                  az: "Bağlantı qurulmadı. Fərqli şəbəkələrdəki cihazlar üçün TURN serverinə çatmaq mümkün olmadı.",
                  en: "Could not connect. The TURN relay server was unavailable for devices on different networks.", ru: "Не удалось соединиться. Сервер TURN для устройств в разных сетях недоступен." },
    turnDown:   { tr: "TURN sunucusu alınamadı: yalnız aynı ağdaki aramalar çalışabilir.", az: "TURN serveri alınmadı: yalnız eyni şəbəkədəki zənglər işləyə bilər.", en: "TURN server unavailable: only same-network calls may work.", ru: "TURN-сервер недоступен: могут работать только звонки в одной сети." },
    micDenied:  { tr: "Mikrofon izni verilmedi. Tarayıcı ayarlarından mikrofona izin ver.",
                  az: "Mikrofon icazəsi verilmədi. Brauzer ayarlarından mikrofona icazə ver.",
                  en: "Microphone permission was denied. Allow the microphone in your browser settings.", ru: "Нет доступа к микрофону. Разрешите его в настройках браузера." },
    needHttps:  { tr: "Sesli arama için güvenli bağlantı (HTTPS) gerekli.\n\nAynı cihazdaysan http://localhost kullan. Başka cihazdan bağlanıyorsan sunucuyu HTTPS ile aç.",
                  az: "Səsli zəng üçün təhlükəsiz bağlantı (HTTPS) lazımdır.\n\nEyni cihazdasansa http://localhost istifadə et. Başqa cihazdan qoşulursansa serveri HTTPS ilə aç.",
                  en: "Voice calls need a secure connection (HTTPS).\n\nOn the same device use http://localhost. From another device, run the server over HTTPS.", ru: "Для голосового звонка нужно защищённое соединение (HTTPS).\n\nНа этом же устройстве используйте http://localhost. С другого устройства откройте сервер по HTTPS." },
    noRtc:      { tr: "Bu tarayıcı sesli aramayı desteklemiyor.", az: "Bu brauzer səsli zəngi dəstəkləmir.", en: "This browser does not support voice calls.", ru: "Этот браузер не поддерживает голосовые звонки." },
    noScreen:   { tr: "Bu tarayıcı ekran paylaşımını desteklemiyor.\n\nGenelde bilgisayardaki Chrome, Edge, Firefox ve Safari destekler; telefon tarayıcılarının çoğu desteklemez. Karşı tarafın paylaştığı ekranı ise yine de görebilirsin.",
                  az: "Bu brauzer ekran paylaşımını dəstəkləmir.\n\nÇox vaxt kompüterdəki Chrome, Edge, Firefox və Safari dəstəkləyir; telefon brauzerlərinin çoxu dəstəkləmir. Qarşı tərəfin paylaşdığı ekranı isə görə bilərsən.",
                  en: "This browser does not support screen sharing.\n\nDesktop Chrome, Edge, Firefox and Safari usually do; most phone browsers do not. You can still see a screen the other person shares.", ru: "Этот браузер не поддерживает показ экрана.\n\nОбычно поддерживают Chrome, Edge, Firefox и Safari на компьютере; большинство браузеров телефонов — нет. Экран собеседника вы всё равно сможете видеть." },
    group:      { tr: "Arama sadece birebir sohbetlerde yapılabilir.", az: "Zəng yalnız şəxsi söhbətdə mümkündür.", en: "Calls are only available in one-to-one chats.", ru: "Звонки доступны только в чатах один на один." },
    already:    { tr: "Zaten bir aramadasın.", az: "Artıq zəngdəsən.", en: "You are already in a call.", ru: "Вы уже в звонке." },
    noPeer:     { tr: "Önce bir sohbet seç.", az: "Əvvəlcə söhbət seç.", en: "Select a chat first.", ru: "Сначала выберите чат." },
    offline:    { tr: "Sunucuya bağlı değilsin. Birazdan tekrar dene.", az: "Serverə qoşulu deyilsən. Bir az sonra yenidən yoxla.", en: "You are not connected to the server. Try again shortly.", ru: "Нет подключения к серверу. Попробуйте позже." },
    busy: { tr: "Karşı taraf şu anda başka bir aramada.", az: "Qarşı tərəf hazırda başqa zəngdədir.", en: "The other person is already in a call.", ru: "Собеседник уже разговаривает." },
  callDenied: { tr: "Bu sohbet için arama iznin yok.", az: "Bu söhbət üçün zəng icazən yoxdur.", en: "You are not allowed to call from this chat.", ru: "Вам нельзя звонить из этого чата." },
  callFailed: { tr: "Arama başlatılamadı. Tekrar dene.", az: "Zəng başlatmaq alınmadı. Yenidən yoxla.", en: "The call could not start. Try again.", ru: "Не удалось начать звонок. Попробуйте ещё раз." },
  shareFail:  { tr: "Ekran paylaşımı başlatılamadı: ", az: "Ekran paylaşımı başlamadı: ", en: "Could not start screen sharing: ", ru: "Не удалось начать показ экрана: " },
  };
  const tx = (k) => (S[k] && (S[k][LANG()] || S[k].tr)) || k;

  /* ---------- arayüz ---------- */
  const IC = {
    phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
    hang:  '<svg viewBox="0 0 24 24"><path d="M3 14c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-7 0V15l-3 1.5z"/></svg>',
    mic:   '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    micoff:'<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/></svg>',
    camera:'<svg viewBox="0 0 24 24"><path d="M14 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zM16 10l5-3v10l-5-3"/></svg>',
    cameraOff:'<svg viewBox="0 0 24 24"><path d="M14 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zM16 10l5-3v10l-5-3M3 3l18 18"/></svg>',
    switch:'<svg viewBox="0 0 24 24"><path d="M7 7h13l-3-3M17 17H4l3 3M20 7l-3 3M4 17l3-3"/></svg>',
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
    <div class="tcc-bar tcc-bar-call">${btn("tccMute", "")}${btn("tccCamera", "")}${btn("tccSwitch", "")}${btn("tccScreen", "")}${btn("tccHang", "end")}</div>
    <audio id="tccAudio" autoplay playsinline></audio>`;
  document.body.appendChild(box);
  const screenVideo = document.createElement("video");
  screenVideo.id = "tccScreenVideo"; screenVideo.className = "tcc-video tcc-screen-video";
  screenVideo.autoplay = true; screenVideo.playsInline = true; screenVideo.muted = true; screenVideo.hidden = true;
  box.insertBefore(screenVideo, box.querySelector(".tcc-mid"));
  const localVideo = document.createElement("video");
  localVideo.id = "tccLocalVideo"; localVideo.className = "tcc-local-video";
  localVideo.autoplay = true; localVideo.playsInline = true; localVideo.muted = true; localVideo.hidden = true;
  box.appendChild(localVideo);
  const $ = (id) => document.getElementById(id);
  const el = { video: $("tccVideo"), screenVideo, localVideo, avatar: $("tccAvatar"), name: $("tccName"), status: $("tccStatus"), note: $("tccNote"),
               audio: $("tccAudio"), mute: $("tccMute"), camera: $("tccCamera"), switchCamera: $("tccSwitch"), screen: $("tccScreen"), accept: $("tccAccept"), decline: $("tccDecline"), hang: $("tccHang") };
  const setText = (node, t) => { if (node.textContent !== t) node.textContent = t; };
  const setIcon = (b, svg) => { const s = b.querySelector(".tcc-ic"); if (s.dataset.i !== svg) { s.innerHTML = IC[svg]; s.dataset.i = svg; } };
  const label = (b, t) => setText(b.querySelector(".tcc-lb"), t);
  const fmt = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

  /* ---------- durum ---------- */
  let cur = null; // aktif arama
  let inc = null; // gelen arama (henüz cevaplanmadı)
  const busy = () => (cur && !cur.over) || !!inc;
  const newCall = (o) => ({ callId: null, mediaType: "audio", pc: null, vTrans: null, pending: [], cands: [], remoteSet: false, making: false, ignore: false,
    accepted: false, muted: false, sharing: false, remoteMuted: false, remoteSharing: false, over: false, connectedAt: 0,
    tick: null, ringTimer: null, warn: "", endText: "", screenTrack: null, relayCount: 0, turn: false, restartCount: 0, dg: { so: 0, sa: 0, ro: 0, ra: 0, cs: 0, cr: 0, err: "" },
    connectTimer: null, failTimer: null, dropTimer: null, ...o });
  const emit = (ev, convo, extra) => {
    const active = cur && cur.convo === convo ? cur : inc && inc.convo === convo ? inc : null;
    socket.emit(ev, { conversationId: convo, ...(active && active.callId ? { callId: active.callId } : {}), ...(extra || {}) });
  };
  const matchesCall = (call, data) => !!call && !!data && data.conversationId === call.convo && (!data.callId || !call.callId || data.callId === call.callId);
  const sig = (c, signal) => {
    try { if (signal.description) { if (signal.description.type === "offer") c.dg.so++; else c.dg.sa++; } else if (signal.candidate) c.dg.cs++; } catch {}
    emit("call:signal", c.convo, { signal });
  };

  function paint() {
    const c = cur, i = inc, who = c ? c.peer : i ? i.peer : "";
    box.hidden = !who; if (!who) return;
    const remoteCamera = !!(c && !c.over && c.mediaType === "video" && c.remoteCameraOn && el.video.srcObject);
    const remoteScreen = !!(c && !c.over && c.remoteSharing && el.screenVideo.srcObject);
    const localCamera = !!(c && !c.over && c.mediaType === "video" && c.cameraOn && c.local.getVideoTracks().length);
    box.classList.toggle("is-incoming", !c && !!i);
    box.classList.toggle("has-video", remoteCamera || remoteScreen);
    box.classList.toggle("is-sharing", remoteScreen);
    el.video.hidden = !remoteCamera; el.screenVideo.hidden = !remoteScreen; el.localVideo.hidden = !localCamera;
    el.avatar.hidden = remoteCamera || remoteScreen;
    setText(el.avatar, who[0].toUpperCase()); setText(el.name, who);
    let status;
    if (!c) status = tx(i.mediaType === "video" ? "videoIncoming" : "incoming");
    else if (c.over) status = c.endText || tx("ended");
    else if (c.connectedAt) status = c.warn || fmt(Math.floor((Date.now() - c.connectedAt) / 1000));
    else status = c.warn || tx(c.stage);
    setText(el.status, status);
    const notes = [];
    if (c && c.remoteMuted && !c.over) notes.push(tx("remoteMuted"));
    if (c && c.remoteCameraOn === false && c.mediaType === "video" && !c.over) notes.push(tx("cameraOff"));
    if (c && c.sharing && !c.over) notes.push(tx("youShare"));
    if (c && !c.over && !c.connectedAt && c.pc && window.TCC_DIAG !== false) {
      const p = c.pc, t = c.candTypes || {}, d = c.dg;
      notes.push("ICE " + p.iceConnectionState + " | conn " + p.connectionState + " | sig " + p.signalingState + " | TURN " + (c.turn ? "var" : "YOK") + " | tr " + p.getTransceivers().length +
        " | aday h" + (t.host || 0) + " s" + (t.srflx || 0) + " r" + (t.relay || 0) + " | gonder o" + d.so + " a" + d.sa + " c" + d.cs + " | al o" + d.ro + " a" + d.ra + " c" + d.cr + (d.err ? " | HATA " + d.err : ""));
    }
    setText(el.note, notes.join(" · "));
    setIcon(el.accept, "phone"); label(el.accept, tx("accept"));
    setIcon(el.decline, "hang"); label(el.decline, tx("decline"));
    setIcon(el.hang, "hang"); label(el.hang, tx("hangup"));
    setIcon(el.mute, c && c.muted ? "micoff" : "mic"); label(el.mute, c && c.muted ? tx("unmute") : tx("mute"));
    el.mute.classList.toggle("on", !!(c && c.muted));
    const hasCamera = !!(c && c.mediaType === "video" && c.local.getVideoTracks().length);
    el.camera.hidden = !hasCamera; el.switchCamera.hidden = !hasCamera;
    setIcon(el.camera, c && c.cameraOn ? "camera" : "cameraOff");
    label(el.camera, c && c.cameraOn ? tx("cameraOn") : tx("cameraOff"));
    el.camera.classList.toggle("on", !!(c && !c.cameraOn));
    setIcon(el.switchCamera, "switch"); label(el.switchCamera, tx("switchCamera"));
    setIcon(el.screen, "screen"); label(el.screen, c && c.sharing ? tx("stopShare") : tx("share"));
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
  const getMedia = (mode, facing = "user") => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: mode === "video" ? { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } : false });
  const NATIVE_T = { tr: "Arama devam ediyor", az: "Zəng davam edir", en: "Call in progress", ru: "Идёт звонок" };
  const nativeCall = (m, args) => {
    try {
      const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CallService;
      if (P && P[m]) P[m](args || {}).catch(() => {});
    } catch {}
  };
  const MIC_T = {
    tr: ["Mikrofon izni alınamadı.", "Hata", "Ek bilgi yok."],
    az: ["Mikrofon icazəsi alınmadı.", "Xəta", "Əlavə məlumat yoxdur."],
    en: ["Could not get microphone access.", "Error", "No additional information."],
    ru: ["Не удалось получить доступ к микрофону.", "Ошибка", "Дополнительных данных нет."],
  };
  const micErrorText = (e) => { const t = MIC_T[LANG()] || MIC_T.tr; return `${t[0]}\n\n${t[1]}: ${e && e.name ? e.name : "UnknownError"}\n${e && e.message ? e.message : t[2]}`; };

  // Otomatik oynatma engellenirse bir sonraki dokunuşta yeniden dene (ses gelmeme sorunu)
  const playMedia = (node) => {
    const p = node.play();
    if (p && p.catch) p.catch(() => { document.addEventListener("pointerdown", () => { node.play().catch(() => {}); }, { once: true }); });
  };
  // Bağlantı kurulamazsa: TURN yoksa / röle adayı hiç oluşmadıysa bunu açıkça söyle
  const failureText = (c) => (!c.turn || c.relayCount === 0 ? tx("noTurn") : tx("failed"));
  const clearTimers = (c) => { clearTimeout(c.ringTimer); clearTimeout(c.connectTimer); clearTimeout(c.failTimer); clearTimeout(c.dropTimer); clearInterval(c.tick); };
  // ICE yeniden başlatma yalnız arayan tarafta (teklifi o verir) ve en fazla 2 kez
  function restartIce(c) {
    if (!c || c.over || !c.pc || c.role !== "caller" || c.restartCount >= 2) return false;
    c.restartCount++;
    getIceServers().then((list) => {
      if (c.over || !c.pc) return;
      try { c.pc.setConfiguration({ ...c.pc.getConfiguration(), iceServers: list }); } catch (e) { console.warn("ICE yapılandırması:", e && e.message); }
      try { c.pc.restartIce(); } catch (e) { console.warn("restartIce:", e && e.message); }
    });
    return true;
  }

  // Gerçekte hangi yolun seçildiğini (host/srflx/relay) kaydet. IP adresleri loglanmaz.
  async function logPath(c, why) {
    try {
      if (!c.pc) return;
      const stats = await c.pc.getStats(), byId = {}; let pair = null;
      stats.forEach((r) => { byId[r.id] = r; });
      stats.forEach((r) => { if (r.type === "transport" && r.selectedCandidatePairId && byId[r.selectedCandidatePairId]) pair = byId[r.selectedCandidatePairId]; });
      if (!pair) stats.forEach((r) => { if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded") pair = r; });
      const l = pair && byId[pair.localCandidateId], rm = pair && byId[pair.remoteCandidateId];
      c.pathType = l ? l.candidateType + "/" + (rm ? rm.candidateType : "?") : "none";
      console.info("TalkChat yol (" + why + "):", c.pathType, "| protokol:", l && l.protocol, "| aday türleri:", JSON.stringify(c.candTypes), "| TURN listede:", c.turn, "| ICE hata:", iceState.error || "yok");
    } catch (e) { console.warn("TalkChat getStats:", e && e.message); }
  }
  // Callee: teklifteki m-line'lara bağlanan transceiver'ları bul ve yerel parçaları onlara bağla.
  async function attachCalleeMedia(c) {
    const pc = c.pc; if (!pc || c.audioTrans) return;
    const all = pc.getTransceivers();
    const kindOf = (t) => (t.receiver && t.receiver.track && t.receiver.track.kind) || "";
    const audio = all.find((t) => kindOf(t) === "audio"), videos = all.filter((t) => kindOf(t) === "video");
    c.audioTrans = audio; c.cameraTrans = videos[0]; c.screenTrans = videos[1];
    for (const t of [audio, videos[0], videos[1]]) if (t) { try { t.direction = "sendrecv"; } catch {} }
    const audioTrack = c.local.getAudioTracks()[0], cameraTrack = c.local.getVideoTracks()[0];
    if (audio && audioTrack) await audio.sender.replaceTrack(audioTrack);
    if (videos[0] && cameraTrack) await videos[0].sender.replaceTrack(cameraTrack);
    console.info("TalkChat: callee transceiver sayısı:", all.length, "(3 olmalı)");
  }

  async function createPC(c) {
    const iceServers = await getIceServers();
    c.turn = hasTurn(iceServers); c.candTypes = { host: 0, srflx: 0, relay: 0 };
    if (!c.turn) { console.error("TalkChat: bu arama TURN olmadan başlıyor."); c.warn = tx("turnDown"); }
    const pc = new RTCPeerConnection({ iceServers });
    c.pc = pc;
    // Olay işleyicileri HER ZAMAN await'lerden önce atanır: aksi halde negotiationneeded kaçabilir ve teklif hiç gönderilmez.
    const negotiate = async () => {
      if (c.over || c.pc !== pc) return;
      if (c.role === "callee" && !c.remoteSet) return;
      try { c.making = true; await pc.setLocalDescription(); sig(c, { description: pc.localDescription }); }
      catch (e) { c.dg.err = "offer " + (e && e.name) + ": " + (e && e.message); console.error("Zəng təklifi:", e); } finally { c.making = false; }
    };
    pc.onnegotiationneeded = negotiate;
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const m = / typ (host|srflx|prflx|relay)/.exec(e.candidate.candidate || "");
      if (m && c.candTypes[m[1]] !== undefined) c.candTypes[m[1]]++;
      if (m && m[1] === "relay") c.relayCount++;
      sig(c, { candidate: e.candidate });
    };
    clearInterval(c.tick); c.tick = setInterval(paint, 1000);
    pc.onicecandidateerror = (e) => console.warn("TalkChat ICE aday hatası:", e.errorCode, e.errorText, e.url || "");
    pc.ontrack = (e) => {
      const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
      if (e.track.kind === "audio") { el.audio.srcObject = stream; playMedia(el.audio); }
      else {
        const vi = pc.getTransceivers().filter((t) => t.receiver && t.receiver.track && t.receiver.track.kind === "video").indexOf(e.transceiver);
        if (vi === 0) { el.video.srcObject = stream; el.video.play().catch(() => {}); }
        else if (vi === 1) { el.screenVideo.srcObject = stream; el.screenVideo.play().catch(() => {}); }
      }
      paint();
    };
    pc.oniceconnectionstatechange = () => { console.info("TalkChat ICE:", pc.iceConnectionState, "| toplama:", pc.iceGatheringState, "| relay adayı:", c.relayCount, "| TURN:", c.turn); if (pc.iceConnectionState === "failed") logPath(c, "ice-failed"); }
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        c.warn = ""; logPath(c, "connected"); clearTimeout(c.connectTimer); clearTimeout(c.failTimer); clearTimeout(c.dropTimer);
        if (!c.connectedAt) { c.connectedAt = Date.now(); clearInterval(c.tick); c.tick = setInterval(paint, 1000); takeWake(); }
      } else if (s === "disconnected") {
        c.warn = tx("weak");
        clearTimeout(c.dropTimer);
        c.dropTimer = setTimeout(() => { if (cur === c && !c.over && pc.connectionState === "disconnected") restartIce(c); }, 4000);
      } else if (s === "failed") {
        c.warn = tx("reconnecting");
        if (!restartIce(c)) {
          clearTimeout(c.failTimer);
          c.failTimer = setTimeout(() => { if (cur === c && !c.over && pc.connectionState === "failed") hangUp(failureText(c), 4500); }, c.role === "callee" ? 12000 : 2500);
        }
      }
      paint();
    };
    // Yalnız arayan transceiver oluşturur. addTransceiver ile oluşturulanlar karşı tarafın teklifiyle eşleşmez (yalnız addTrack ile oluşturulanlar eşleşir),
    // bu yüzden callee transceiver'ları teklif uygulandıktan sonra attachCalleeMedia() ile bağlar.
    const audioTrack = c.local.getAudioTracks()[0], cameraTrack = c.local.getVideoTracks()[0];
    if (c.role === "caller") {
      c.audioTrans = pc.addTransceiver("audio", { direction: "sendrecv" });
      c.cameraTrans = pc.addTransceiver("video", { direction: "sendrecv" });
      c.screenTrans = pc.addTransceiver("video", { direction: "sendrecv" });
      if (audioTrack) await c.audioTrans.sender.replaceTrack(audioTrack);
      if (cameraTrack) await c.cameraTrans.sender.replaceTrack(cameraTrack);
    }
    c.cameraOn = !!cameraTrack;
    if (cameraTrack) { el.localVideo.srcObject = new MediaStream([cameraTrack]); el.localVideo.play().catch(() => {}); }
    nativeCall("start", { title: "TalkChat", text: NATIVE_T[LANG()] || NATIVE_T.tr, camera: c.mediaType === "video" });
    // Güvence: negotiationneeded gelmediyse arayan taraf teklifi kendisi başlatır
    if (c.role === "caller") setTimeout(() => { if (!c.over && c.pc === pc && !c.making && !pc.localDescription && pc.signalingState === "stable") negotiate(); }, 400);
    // Bağlantı belirli sürede kurulmazsa sonsuza kadar "Bağlanıyor…" kalma
    c.connectTimer = setTimeout(() => { if (cur === c && !c.over && !c.connectedAt) { logPath(c, "timeout"); console.error("TalkChat: bağlantı zaman aşımı | ICE:", pc.iceConnectionState, "| conn:", pc.connectionState, "| sinyal:", pc.signalingState, "| aday:", JSON.stringify(c.candTypes)); hangUp(failureText(c), 4500); } }, CONNECT_MS);
    for (const s of c.pending.splice(0)) await handleSignal(c, s);
  }

  // "Mükemmel pazarlık": callee kibar taraf, çakışmada teklifi geri alır
  async function handleSignal(c, s) {
    if (!s) return;
    if (!c.pc) { c.pending.push(s); return; }
    const pc = c.pc;
    try {
      if (s.description) {
        if (s.description.type === "offer") c.dg.ro++; else c.dg.ra++;
        const collision = s.description.type === "offer" && (c.making || pc.signalingState !== "stable");
        c.ignore = c.role !== "callee" && collision;
        if (c.ignore) return;
        await pc.setRemoteDescription(s.description);
        c.remoteSet = true;
        if (s.description.type === "offer" && c.role === "callee") await attachCalleeMedia(c);
        for (const k of c.cands.splice(0)) await pc.addIceCandidate(k).catch(() => {});
        if (s.description.type === "offer") {
          await pc.setLocalDescription();
          sig(c, { description: pc.localDescription });
        }
      } else if (s.candidate) {
        c.dg.cr++;
        if (!c.remoteSet) c.cands.push(s.candidate);
        else await pc.addIceCandidate(s.candidate).catch((e) => { if (!c.ignore) console.warn("ICE:", e); });
      } else if ("muted" in s) { c.remoteMuted = !!s.muted; paint(); }
      else if ("screen" in s) { c.remoteSharing = !!s.screen; paint(); }
      else if ("camera" in s) { c.remoteCameraOn = !!s.camera; paint(); }
    } catch (e) { c.dg.err = (e && e.name) + ": " + (e && e.message); console.error("Zəng siqnalı:", e); }
  }

  /* ---------- arama akışı ---------- */
  async function startCall(mode = "audio") {
    if (busy()) return alert(tx("already"));
    const conv = conversationsCache.find((x) => x.id === activeConversation);
    if (!conv || conv.type === "group") return alert(conv ? tx("group") : tx("noPeer"));
    const peer = (conv.participants || []).find((p) => p !== me) || conv.name;
    if (!peer || peer === me) return alert(tx("noPeer"));
    const p = problem();
    if (p) return alert(p);
    if (!socket.connected) return alert(tx("offline"));
    askNotify();
    getIceServers().catch(() => {}); // TURN bilgisini önceden ısıt
    let local;
    try { local = await getMedia(mode); } catch (e) { console.error("TalkChat media error:", e); return alert(micErrorText(e)); }
    if (busy()) { local.getTracks().forEach((t) => t.stop()); return; }
    const mediaType = mode === "video" ? "video" : "audio";
    const c = (cur = newCall({ convo: conv.id, peer, role: "caller", local, stage: "calling", mediaType, cameraOn: mediaType === "video", remoteCameraOn: true, facing: "user" }));
    paint();
    emit("call:invite", c.convo, { mediaType: c.mediaType });
    c.ringTimer = setTimeout(() => { if (cur === c && !c.accepted && !c.over) hangUp(tx("noAnswer")); }, RING_MS);
  }

  function showIncoming(d) {
    inc = { callId: d.callId || null, mediaType: d.mediaType === "video" ? "video" : "audio", convo: d.conversationId, peer: d.from || "?" };
    getIceServers().catch(() => {}); // kabul edilince beklememek için zil çalarken yükle
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
    try { local = await getMedia(i.mediaType); } catch (e) { console.error("TalkChat media error:", e); alert(micErrorText(e)); return declineIncoming(); }
    if (inc !== i) { local.getTracks().forEach((t) => t.stop()); return; } // bu arada arama bitti
    inc = null;
    stopRing();
    const c = (cur = newCall({ callId: i.callId, mediaType: i.mediaType, convo: i.convo, peer: i.peer, role: "callee", local, stage: "connecting", accepted: true, cameraOn: i.mediaType === "video", remoteCameraOn: true, facing: "user" }));
    paint();
    try { await createPC(c); } catch (e) { emit("call:end", c.convo); endLocal(c, tx("failed")); return; }
    if (c.over) return;
    emit("call:accept", c.convo); // hazır olduktan sonra kabul et ki arayanın teklifi kaçmasın
  }

  function endLocal(c, text, hold) {
    if (c.over) return;
    c.over = true; c.endText = text || ""; clearTimers(c); c.sharing = false;
    try { if (c.nativeShare) c.nativeShare.stop().catch(() => {}); } catch {}
    try { if (c.screenTrack) c.screenTrack.stop(); } catch {}
    try { if (c.local) c.local.getTracks().forEach((t) => t.stop()); } catch {}
    try { if (c.pc) c.pc.close(); } catch {}
    el.audio.srcObject = null; el.video.srcObject = null; el.screenVideo.srcObject = null; el.localVideo.srcObject = null;
    dropWake(); nativeCall("stop", { camera: c.mediaType === "video" }); paint();
    setTimeout(() => { if (cur === c) { cur = null; paint(); } }, text ? (hold || 1400) : 0);
  }

  function hangUp(text, hold) {
    const c = cur;
    if (!c || c.over) return;
    emit("call:end", c.convo);
    endLocal(c, typeof text === "string" ? text : "", hold);
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

  function toggleCamera() {
    const c = cur, track = c && c.local && c.local.getVideoTracks()[0];
    if (!c || c.over || c.mediaType !== "video" || !track) return;
    c.cameraOn = !c.cameraOn; track.enabled = c.cameraOn; sig(c, { camera: c.cameraOn }); paint();
  }
  async function switchCamera() {
    const c = cur; if (!c || c.over || c.mediaType !== "video") return;
    const facing = c.facing === "environment" ? "user" : "environment";
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
    catch (e) { alert(tx("cameraFail") + " " + (e.message || "")); return; }
    const next = stream.getVideoTracks()[0], old = c.local.getVideoTracks()[0];
    try { await c.cameraTrans.sender.replaceTrack(next); } catch (e) { next.stop(); alert(tx("cameraFail")); return; }
    if (old) { c.local.removeTrack(old); old.stop(); }
    c.local.addTrack(next); c.facing = facing; next.enabled = c.cameraOn;
    el.localVideo.srcObject = new MediaStream([next]); el.localVideo.play().catch(() => {}); paint();
  }
  async function toggleShare() {
    const c = cur; if (!c || c.over || !c.screenTrans) return;
    if (c.sharing) return stopShare(c);
    let stream = null, nativeShare = null;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      else if (window.TalkChatNativeScreen) { nativeShare = await window.TalkChatNativeScreen.start(() => stopShare(c, true)); stream = nativeShare.stream; }
      else return alert(tx("noScreen"));
      if (!cur || cur !== c || c.over) { stream.getTracks().forEach(t => t.stop()); if (nativeShare) await nativeShare.stop(); return; }
      const track = stream.getVideoTracks()[0]; if (!track) throw new Error("No screen video track");
      if ("contentHint" in track) track.contentHint = "detail";
      await c.screenTrans.sender.replaceTrack(track);
      c.screenStream = stream; c.screenTrack = track; c.nativeShare = nativeShare; c.sharing = true;
      track.onended = () => stopShare(c, true); sig(c, { screen: true }); paint();
    } catch (e) {
      if (nativeShare) await nativeShare.stop().catch(() => {});
      if (e && e.name !== "NotAllowedError" && e.name !== "AbortError") alert(tx("shareFail") + (e.message || ""));
    }
  }
  async function stopShare(c, nativeStopped = false) {
    if (!c || !c.sharing) return;
    c.sharing = false; const share = c.nativeShare, track = c.screenTrack;
    c.nativeShare = null; c.screenTrack = null; c.screenStream = null;
    try { if (track && track.readyState !== "ended") track.stop(); } catch {}
    try { if (share) await share.stop(nativeStopped); } catch {}
    if (!c.over && c.screenTrans) { c.screenTrans.sender.replaceTrack(null).catch(() => {}); sig(c, { screen: false }); }
    paint();
  }

  /* ---------- socket olayları ---------- */
  socket.on("call:created", (d) => {
    const c = cur;
    if (!c || c.over || !d || d.conversationId !== c.convo || typeof d.callId !== "string") return;
    c.callId = d.callId;
    c.mediaType = d.mediaType === "video" ? "video" : "audio";
    paint();
  });
  socket.on("call:answered", (d) => { if (inc && matchesCall(inc, d)) dismissIncoming(); });
  socket.on("call:error", (d) => {
    const c = cur;
    if (!c || c.over || !matchesCall(c, d)) return;
    const key = d.code === "busy" ? "busy" : d.code === "not-authorized" ? "callDenied" : "callFailed";
    endLocal(c, tx(key));
  });
  socket.on("call:incoming", (d) => {
    if (!d || !d.conversationId) return;
    // Sunucu aynı çağrıyı yeniden gönderdiyse (yeniden bağlanma) tekrar işleme / reddetme
    if (d.callId && ((inc && inc.callId === d.callId) || (cur && !cur.over && cur.callId === d.callId))) return;
    if (busy()) { emit("call:reject", d.conversationId); return; } // meşgul: arayan boşuna beklemesin
    if (cur && cur.over) cur = null;
    showIncoming(d);
  });
  socket.on("call:accepted", async (d) => {
    const c = cur;
    if (!c || c.over || c.role !== "caller" || !matchesCall(c, d)) return;
    c.callId = d.callId || c.callId;
    c.mediaType = d.mediaType === "video" ? "video" : c.mediaType;
    if (c.pc || c.creating) return; // aynı çağrı için ikinci PeerConnection oluşturma
    c.creating = true;
    c.accepted = true;
    clearTimeout(c.ringTimer);
    c.stage = "connecting";
    paint();
    try { await createPC(c); } catch (e) { emit("call:end", c.convo); endLocal(c, tx("failed")); }
  });
  socket.on("call:signal", (d) => {
    const c = cur;
    if (c && !c.over && matchesCall(c, d)) handleSignal(c, d.signal);
  });
  socket.on("call:rejected", (d) => {
    const c = cur;
    if (c && !c.over && matchesCall(c, d)) endLocal(c, tx("declined"));
  });
  socket.on("call:ended", (d) => {
    if (!d) return;
    if (inc && matchesCall(inc, d)) dismissIncoming();
    const c = cur;
    if (c && !c.over && matchesCall(c, d)) {
      // Kabul edilmiş ama hiç bağlanamamış çağrıda karşı taraf kapattıysa "Yanıt vermedi" değil, bağlantı hatası göster
      const text = d.reason === "disconnected" ? tx("dropped") : d.reason === "no-answer" ? tx("noAnswer") : c.connectedAt ? "" : c.accepted ? failureText(c) : tx("noAnswer");
      endLocal(c, text, c.accepted && !c.connectedAt ? 4500 : undefined);
    }
  });
  socket.on("disconnect", () => {
    if (inc) dismissIncoming();
    const c = cur;
    if (c && !c.over) { c.warn = tx("reconnecting"); paint(); }
  });
  socket.on("call:peer-reconnecting", d => {
    const c = cur; if (!c || c.over || !matchesCall(c, d)) return;
    c.warn = tx("reconnecting"); paint();
  });
  socket.on("call:peer-reconnected", d => {
    const c = cur; if (!c || c.over || !matchesCall(c, d)) return;
    c.warn = ""; if (c.pc && c.pc.connectionState !== "connected") restartIce(c); paint();
  });
  socket.on("call:resumed", d => {
    const c = cur;
    if (!d || !d.conversationId) return;
    // Sayfa yenilendiyse bu cihazda arama yok: sunucuda "hayalet" arama kalıp herkesi "meşgul" yapmasın
    if (!c || c.over || !matchesCall(c, d)) { socket.emit("call:end", { conversationId: d.conversationId, ...(d.callId ? { callId: d.callId } : {}) }); return; }
    c.callId = d.callId || c.callId; c.warn = "";
    if (c.pc && c.pc.connectionState !== "connected") restartIce(c); paint();
  });

  /* ---------- düğmeler ---------- */
  el.accept.onclick = acceptIncoming;
  el.decline.onclick = declineIncoming;
  el.mute.onclick = toggleMute;
  el.camera.onclick = toggleCamera;
  el.switchCamera.onclick = switchCamera;
  el.screen.onclick = toggleShare;
  el.hang.onclick = () => hangUp();
  // Sohbet başlığındaki telefon düğmesi (id ile; eski aria-label de çalışır, dil çevirisi aria-label'i değiştirse bile id yeter)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest('#tcCallBtn, #tcVideoCallBtn, [data-talk-original-aria-label="Səsli zəng"], [aria-label="Səsli zəng"]');
    if (!btn) return;
    const mode = btn.id === "tcVideoCallBtn" ? "video" : "audio";
    const conv = conversationsCache.find(x => x.id === activeConversation);
    if (conv && conv.type === "group") {
      if (window.TalkChatGroupCalls) { e.preventDefault(); window.TalkChatGroupCalls.startCall(activeConversation, mode); }
      return;
    }
    startCall(mode);
  });
  window.addEventListener("beforeunload", () => { if (cur && !cur.over) emit("call:end", cur.convo); });
})();
