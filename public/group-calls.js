/* TALKCHAT_GROUP_CALLS_V2 — qrup zəngi (mesh WebRTC, maksimum 5 nəfər).
   Server hadisələri dəyişməyib: group-call:start/join/leave/signal və incoming/joined/peer-joined/peer-left/error. */
(() => {
  "use strict";
  if (window.TalkChatGroupCalls) return;

  const MAX = 5;
  const ICE = window.TC_ICE_SERVERS || [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ];
  const getIce = () => window.TalkChatICE && window.TalkChatICE.get ? window.TalkChatICE.get() : Promise.resolve(ICE);

  /* ---------- dillər ---------- */
  const LANG = () => { try { return localStorage.getItem("talkchat-language") || "tr"; } catch { return "tr"; } };
  const S = {
    title:      { tr: "Grup araması", az: "Qrup zəngi", en: "Group call", ru: "Групповой звонок" },
    incoming:   { tr: "grup araması başlattı", az: "qrup zəngi başladıb", en: "started a group call", ru: "начал(а) групповой звонок" },
    join:       { tr: "Katıl", az: "Qoşul", en: "Join", ru: "Присоединиться" },
    decline:    { tr: "Reddet", az: "Rədd et", en: "Decline", ru: "Отклонить" },
    mute:       { tr: "Sessize al", az: "Səssiz", en: "Mute", ru: "Без звука" },
    unmute:     { tr: "Sesi aç", az: "Səsi aç", en: "Unmute", ru: "Включить звук" },
    leave:      { tr: "Ayrıl", az: "Çıx", en: "Leave", ru: "Выйти" },
    you:        { tr: "Sen", az: "Sən", en: "You", ru: "Вы" },
    connecting: { tr: "Bağlanıyor…", az: "Qoşulur…", en: "Connecting…", ru: "Подключение…" },
    weak:       { tr: "Bağlantı zayıf", az: "Bağlantı zəifdir", en: "Weak connection", ru: "Слабое соединение" },
    already:    { tr: "Zaten bir grup aramasındasın.", az: "Artıq qrup zəngindəsən.", en: "You are already in a group call.", ru: "Вы уже в групповом звонке." },
    busy1:      { tr: "Önce mevcut aramayı bitir.", az: "Əvvəlcə mövcud zəngi bitir.", en: "End your current call first.", ru: "Сначала завершите текущий звонок." },
    noMic:      { tr: "Mikrofon kullanılamıyor.", az: "Mikrofon əlçatan deyil.", en: "Microphone is not available.", ru: "Микрофон недоступен." },
    micFail:    { tr: "Mikrofon açılamadı.", az: "Mikrofon açıla bilmədi.", en: "Could not open the microphone.", ru: "Не удалось включить микрофон." },
    error:      { tr: "Grup araması hatası.", az: "Qrup zəngi xətası.", en: "Group call error.", ru: "Ошибка группового звонка." },
    native:     { tr: "Grup araması devam ediyor", az: "Qrup zəngi davam edir", en: "Group call in progress", ru: "Идёт групповой звонок" },
    cameraOn:   { tr: "Kamerayı kapat", az: "Kameranı bağla", en: "Turn camera off", ru: "Выключить камеру" },
    cameraOff:  { tr: "Kamerayı aç", az: "Kameranı aç", en: "Turn camera on", ru: "Включить камеру" },
    switchCamera:{ tr: "Kamerayı değiştir", az: "Kameranı dəyiş", en: "Switch camera", ru: "Переключить камеру" },
    share:      { tr: "Ekran paylaş", az: "Ekranı paylaş", en: "Share screen", ru: "Поделиться экраном" },
    stopShare:  { tr: "Paylaşımı durdur", az: "Paylaşımı dayandır", en: "Stop sharing", ru: "Остановить показ" },
    sharing:    { tr: "Ekran paylaşıyor", az: "Ekran paylaşır", en: "Sharing screen", ru: "Демонстрирует экран" },
    cameraFail: { tr: "Kamera açılamadı.", az: "Kamera açıla bilmədi.", en: "Could not access the camera.", ru: "Не удалось включить камеру." },
    screenFail: { tr: "Ekran paylaşımı başlatılamadı.", az: "Ekran paylaşımı başlatılmadı.", en: "Could not start screen sharing.", ru: "Не удалось начать показ экрана." },
    back:       { tr: "Geri", az: "Geri", en: "Back", ru: "Назад" },
    more:       { tr: "Daha çok", az: "Daha çox", en: "More", ru: "Ещё" },
    participants:{ tr: "Katılımcılar", az: "İştirakçılar", en: "Participants", ru: "Участники" },
    report:     { tr: "Şikayet et", az: "Şikayət et", en: "Report", ru: "Пожаловаться" },
    mutePerson: { tr: "Katılımcıyı sessize al", az: "İştirakçını səssizə al", en: "Mute participant", ru: "Отключить микрофон участника" },
    unmutePerson:{ tr: "Katılımcının sesini aç", az: "İştirakçının səsini aç", en: "Unmute participant", ru: "Включить микрофон участника" },
    micOn:      { tr: "Mikrofon açık", az: "Mikrofon açıq", en: "Microphone on", ru: "Микрофон включён" },
    micOff:     { tr: "Mikrofon kapalı", az: "Mikrofon bağlı", en: "Microphone off", ru: "Микрофон выключен" },
  };
  const tx = (k) => (S[k] && (S[k][LANG()] || S[k].tr)) || k;

  /* ---------- stillər ---------- */
  const css = `
  #tcGroupCall.tcg{position:fixed;inset:0;z-index:100002;display:flex;flex-direction:column;color:#fff;
    background:radial-gradient(ellipse at 50% 12%,rgba(134,77,225,.34),transparent 55%),radial-gradient(ellipse at 90% 100%,rgba(83,45,145,.25),transparent 45%),#0d0a17;
    font-family:inherit;-webkit-tap-highlight-color:transparent}
  #tcGroupCall.tcg[hidden]{display:none!important}
  #tcGroupCall .tcg-top{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center;gap:8px;padding:calc(10px + env(safe-area-inset-top)) 14px 6px;text-align:center}
  #tcGroupCall .tcg-top-copy{min-width:0}
  #tcGroupCall .tcg-back,#tcGroupCall .tcg-more{width:42px;height:42px;display:grid;place-items:center;border:1px solid rgba(190,150,255,.3);border-radius:14px;background:rgba(255,255,255,.08);color:#fff;font:inherit;font-size:22px;cursor:pointer}
  #tcGroupCall .tcg-back[hidden],#tcGroupCall .tcg-more[hidden]{display:none!important}
  #tcGroupCall .tcg-menu{position:absolute;z-index:12;top:calc(66px + env(safe-area-inset-top));right:14px;width:min(92vw,390px);max-height:64vh;overflow:auto;padding:14px;border:1px solid rgba(190,150,255,.28);border-radius:18px;background:rgba(22,16,37,.97);box-shadow:0 18px 55px rgba(0,0,0,.45)}
  #tcGroupCall .tcg-menu[hidden]{display:none!important}
  #tcGroupCall .tcg-menu-title{display:block;margin:0 0 10px;font-size:14px}
  #tcGroupCall .tcg-roster-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.08)}
  #tcGroupCall .tcg-roster-avatar{width:38px;height:38px;display:grid;place-items:center;overflow:hidden;border-radius:50%;background:linear-gradient(135deg,#b18aff,#6036ad);flex:none;font-weight:800}
  #tcGroupCall .tcg-roster-avatar img{width:100%;height:100%;object-fit:cover}
  #tcGroupCall .tcg-roster-info{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
  #tcGroupCall .tcg-roster-info strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
  #tcGroupCall .tcg-roster-info small{color:#c9bfd8;font-size:11px}
  #tcGroupCall .tcg-roster-action,#tcGroupCall .tcg-menu-mic{border:1px solid rgba(190,150,255,.3);border-radius:10px;background:rgba(255,255,255,.08);color:#fff;padding:8px 10px;font:inherit;font-size:11px;cursor:pointer}
  #tcGroupCall .tcg-menu-mic{width:100%;margin-top:12px}
  #tcGroupCall .tcg-title{display:block;font-size:20px;font-weight:800;letter-spacing:-.3px}
  #tcGroupCall .tcg-sub{display:block;margin-top:2px;color:#c9bfd8;font-size:14px;font-variant-numeric:tabular-nums}
  #tcGroupCall .tcg-grid{flex:1;min-height:0;display:grid;gap:12px;padding:10px 14px;grid-auto-rows:minmax(0,1fr);grid-template-columns:1fr}
  #tcGroupCall .tcg-grid[data-n="3"],#tcGroupCall .tcg-grid[data-n="4"],#tcGroupCall .tcg-grid[data-n="5"]{grid-template-columns:1fr 1fr}
  #tcGroupCall .tcg-tile:last-child:nth-child(odd){grid-column:1/-1}
  #tcGroupCall .tcg-tile{position:relative;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
    padding:8px;border-radius:22px;background:rgba(255,255,255,.06);border:2px solid rgba(190,150,255,.16);overflow:hidden;
    transition:border-color .18s,box-shadow .18s,background .18s}
  #tcGroupCall .tcg-tile.speaking{border-color:#2ecc71;background:rgba(46,204,113,.09);box-shadow:0 0 0 2px rgba(46,204,113,.45),0 0 26px rgba(46,204,113,.28)}
  #tcGroupCall .tcg-av{width:clamp(48px,min(34vw,14vh),108px);aspect-ratio:1/1;display:grid;place-items:center;border-radius:50%;
    font-size:clamp(20px,min(14vw,6vh),44px);font-weight:800;border:3px solid rgba(255,255,255,.28);flex:none}
  #tcGroupCall .tcg-nm{max-width:100%;padding:0 6px;font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #tcGroupCall .tcg-st{min-height:16px;font-size:12px;color:#f5c451}
  #tcGroupCall .tcg-badge{position:absolute;top:10px;right:10px;width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:#ed4956}
  #tcGroupCall .tcg-badge[hidden]{display:none}
  #tcGroupCall .tcg-badge svg{width:16px;height:16px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  #tcGroupCall .tcg-inc{flex:1;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:20px;text-align:center}
  #tcGroupCall .tcg-inc-av{width:112px;height:112px;display:grid;place-items:center;border-radius:50%;font-size:46px;font-weight:800;
    background:linear-gradient(135deg,#b18aff,#6036ad);border:3px solid rgba(197,163,255,.55);animation:tcgPulse 1.6s ease-out infinite}
  #tcGroupCall .tcg-inc-nm{font-size:26px;font-weight:800;letter-spacing:-.4px}
  #tcGroupCall .tcg-inc-tx{color:#c9bfd8;font-size:16px;margin:0}
  @keyframes tcgPulse{0%{box-shadow:0 0 0 0 rgba(155,114,255,.55)}100%{box-shadow:0 0 0 30px rgba(155,114,255,0)}}
  #tcGroupCall.is-incoming .tcg-inc{display:flex}
  #tcGroupCall.is-incoming .tcg-grid,#tcGroupCall.is-incoming .tcg-top,#tcGroupCall.is-incoming .tcg-bar-call{display:none}
  #tcGroupCall:not(.is-incoming) .tcg-bar-in{display:none}
  #tcGroupCall .tcg-bar{display:flex;justify-content:center;gap:26px;padding:12px 16px calc(26px + env(safe-area-inset-bottom))}
  #tcGroupCall button.tcg-btn{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:74px;padding:0;border:0;border-radius:0;background:none;box-shadow:none;color:#fff;font-size:12px;transform:none;cursor:pointer}
  #tcGroupCall button.tcg-btn:hover{background:none;transform:none}
  #tcGroupCall .tcg-ic{width:64px;height:64px;display:grid;place-items:center;border-radius:50%;background:rgba(255,255,255,.1);border:1px solid rgba(190,150,255,.28);transition:background .2s,transform .15s}
  #tcGroupCall button.tcg-btn:active .tcg-ic{transform:scale(.92)}
  #tcGroupCall .tcg-ic svg{width:28px;height:28px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  #tcGroupCall button.tcg-btn.on .tcg-ic{background:#fff;color:#17102a}
  #tcGroupCall button.tcg-btn.end .tcg-ic{background:#ed4956;border-color:transparent}
  #tcGroupCall button.tcg-btn.ok .tcg-ic{background:#2ecc71;border-color:transparent}
  @media (min-width:700px){
    #tcGroupCall .tcg-grid{max-width:1000px;width:100%;margin:0 auto}
    #tcGroupCall .tcg-grid[data-n="2"]{grid-template-columns:1fr 1fr}
    #tcGroupCall .tcg-grid[data-n="3"],#tcGroupCall .tcg-grid[data-n="5"]{grid-template-columns:repeat(3,1fr)}
    #tcGroupCall .tcg-tile:last-child:nth-child(odd){grid-column:auto}
  }
  @media (prefers-reduced-motion:reduce){#tcGroupCall *{animation:none!important;transition:none!important}}`;
  const styleEl = document.createElement("style");
  styleEl.id = "tcgStyles";
  styleEl.textContent = css + "\n#tcGroupCall .tcg-tile video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}\n#tcGroupCall .tcg-tile video[hidden]{display:none!important}\n#tcGroupCall .tcg-tile .tcg-camera{z-index:0}\n#tcGroupCall .tcg-tile .tcg-screen{z-index:2;object-fit:contain}\n#tcGroupCall .tcg-share-label{position:absolute;z-index:4;top:8px;left:8px;padding:5px 9px;border-radius:999px;background:rgba(12,10,18,.72);font-size:11px}\n#tcGroupCall .tcg-share-label[hidden]{display:none}\n#tcGroupCall .tcg-av,#tcGroupCall .tcg-nm,#tcGroupCall .tcg-st,#tcGroupCall .tcg-badge{position:relative;z-index:3}\n#tcGroupCall .tcg-tile.has-camera .tcg-av{display:none}\n#tcGroupCall .tcg-tile.has-camera .tcg-nm{align-self:flex-start;margin-top:auto;background:rgba(12,10,18,.62);border-radius:999px;padding:5px 10px}\n#tcGroupCall .tcg-bar{gap:clamp(7px,2vw,22px)}\n@media(max-width:520px){#tcGroupCall .tcg-ic{width:52px;height:52px}#tcGroupCall .tcg-grid{gap:7px;padding:7px}}";
  styleEl.textContent += "\n#tcGroupCall .tcg-av{overflow:hidden}#tcGroupCall .tcg-av img{width:100%;height:100%;object-fit:cover}#tcGroupCall .tcg-av span{position:absolute}";
  document.head.appendChild(styleEl);

  /* ---------- arayüz ---------- */
  const IC = {
    mic:    '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    micoff: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/></svg>',
    hang:   '<svg viewBox="0 0 24 24"><path d="M3 14c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-7 0V15l-3 1.5z"/></svg>',
    phone:  '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M14 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zM16 10l5-3v10l-5-3"/></svg>',
    cameraOff: '<svg viewBox="0 0 24 24"><path d="M14 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zM16 10l5-3v10l-5-3M3 3l18 18"/></svg>',
    switch: '<svg viewBox="0 0 24 24"><path d="M7 7h13l-3-3M17 17H4l3 3M20 7l-3 3M4 17l3-3"/></svg>',
    screen: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M9 11l3-3 3 3M12 8v6"/></svg>'
  };
    const mkBtn = (cls, icon) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tcg-btn " + cls;
    const ic = document.createElement("span"); ic.className = "tcg-ic"; ic.innerHTML = icon;
    const lb = document.createElement("span"); lb.className = "tcg-lb";
    b.append(ic, lb);
    return b;
  };
  const setText = (node, t) => { if (node.textContent !== t) node.textContent = t; };
  const setLabel = (b, t) => setText(b.querySelector(".tcg-lb"), t);

  const panel = document.createElement("section");
  panel.id = "tcGroupCall";
  panel.className = "tcg";
  panel.hidden = true;
  const top = document.createElement("header"); top.className = "tcg-top";
  const backBtn = document.createElement("button"); backBtn.type = "button"; backBtn.className = "tcg-back"; backBtn.textContent = "←"; backBtn.setAttribute("aria-label", tx("back"));
  const topCopy = document.createElement("div"); topCopy.className = "tcg-top-copy";
  const titleEl = document.createElement("strong"); titleEl.className = "tcg-title";
  const subEl = document.createElement("span"); subEl.className = "tcg-sub";
  topCopy.append(titleEl, subEl);
  const moreBtn = document.createElement("button"); moreBtn.type = "button"; moreBtn.className = "tcg-more"; moreBtn.textContent = "⋮"; moreBtn.setAttribute("aria-label", tx("more")); moreBtn.setAttribute("aria-expanded", "false");
  top.append(backBtn, topCopy, moreBtn);
  const menu = document.createElement("div"); menu.className = "tcg-menu"; menu.hidden = true;
  const menuTitle = document.createElement("strong"); menuTitle.className = "tcg-menu-title";
  const menuRoster = document.createElement("div"); menuRoster.className = "tcg-roster";
  menu.append(menuTitle, menuRoster);
  const incBox = document.createElement("div"); incBox.className = "tcg-inc";
  const incAv = document.createElement("div"); incAv.className = "tcg-inc-av";
  const incNm = document.createElement("strong"); incNm.className = "tcg-inc-nm";
  const incTx = document.createElement("p"); incTx.className = "tcg-inc-tx";
  incBox.append(incAv, incNm, incTx);
  const grid = document.createElement("div"); grid.className = "tcg-grid";
  const barCall = document.createElement("div"); barCall.className = "tcg-bar tcg-bar-call";
  const muteBtn = mkBtn("", IC.mic);
  const cameraBtn = mkBtn("", IC.camera);
  const switchBtn = mkBtn("", IC.switch);
  const screenBtn = mkBtn("", IC.screen);
  const leaveBtn = mkBtn("end", IC.hang);
  barCall.append(muteBtn, cameraBtn, switchBtn, screenBtn, leaveBtn);
  const barIn = document.createElement("div"); barIn.className = "tcg-bar tcg-bar-in";
  const declineBtn = mkBtn("end", IC.hang);
  const joinBtn = mkBtn("ok", IC.phone);
  barIn.append(declineBtn, joinBtn);
  panel.append(top, menu, incBox, grid, barCall, barIn);
  (document.body || document.documentElement).appendChild(panel);

  /* ---------- durum ---------- */
  let state = null;          // aktiv zəng
  let inc = null;            // gələn zəng (hələ qoşulmayıb)
  let incTimer = null;
  const queued = new Map();  // peer hələ yaranmamış siqnallar
  const earlyMuted = new Map();
  const tiles = new Map();
  const observedCalls = new Map();

  const hue = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const fmt = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  const oneToOneVisible = () => { const b = document.getElementById("tccBox"); return !!(b && !b.hidden); };
  const personName = person => String(person && (person.displayName || person.username) || "");
  const groupPerson = (s, username) => (Array.isArray(s && s.participants) && s.participants.find(person => person.username === username)) || { username };
  function updateFace(node, person) {
    const image = node.querySelector("img"), fallback = node.querySelector("span");
    if (!image || !fallback) return;
    const url = typeof person?.avatar === "string" ? person.avatar : "";
    if (image.dataset.src !== url) { image.dataset.src = url; image.dataset.failed = "false"; if (url) image.src = url; else image.removeAttribute("src"); }
    image.hidden = !url || image.dataset.failed === "true";
    image.alt = personName(person);
    image.onerror = () => { image.dataset.failed = "true"; image.hidden = true; fallback.hidden = false; };
    image.onload = () => { image.dataset.failed = "false"; image.hidden = false; fallback.hidden = true; };
    setText(fallback, (personName(person).trim()[0] || "?").toUpperCase());
    fallback.hidden = !!url && image.dataset.failed !== "true";
  }
  function updateGroupBanner(conversationId, callData) {
    const key = "group-call:" + conversationId;
    if (!callData || !callData.active) { window.TalkChatCallBanners?.update(key, null); return; }
    window.TalkChatCallBanners?.update(key, {
      active: true,
      conversationId,
      text: (LANG() === "en" ? "📞 Call in progress — Tap to rejoin" : LANG() === "ru" ? "📞 Звонок продолжается — Нажмите, чтобы вернуться" : LANG() === "tr" ? "📞 Arama devam ediyor — Katılmak için dokun" : "📞 Zəng davam edir — Qoşulmaq üçün toxun"),
      onJoin: () => {
        if (state && state.convo === conversationId) { state.minimized = false; menu.hidden = true; paint(); }
        else joinCall(conversationId, callData.mediaType || "audio");
      }
    });
  }
  function applyGroupState(data) {
    if (!data || !data.conversationId) return;
    if (data.active === false) {
      observedCalls.delete(data.conversationId);
      updateGroupBanner(data.conversationId, null);
      if (state && state.convo === data.conversationId) leave(false);
      return;
    }
    observedCalls.set(data.conversationId, data);
    updateGroupBanner(data.conversationId, data);
    if (!state || state.convo !== data.conversationId) return;
    state.callId = data.callId || state.callId;
    state.startedAt = Number(data.startedAt) || state.startedAt;
    state.participants = Array.isArray(data.participants) ? data.participants : state.participants;
    const self = groupPerson(state, me);
    if (self.username === me) {
      state.muted = self.muted === true;
      state.local.getAudioTracks().forEach(track => { track.enabled = !state.muted; });
    }
    for (const [username, peer] of state.peers) {
      const participant = groupPerson(state, username);
      peer.muted = participant.muted === true || participant.moderatorMuted === true;
      peer.moderatorMuted = participant.moderatorMuted === true;
    }
    paint();
  }
  function renderGroupMenu() {
    if (!state || menu.hidden) return;
    const people = Array.isArray(state.participants) ? state.participants.filter(p => p && p.username) : [];
    const self = people.find(p => p.username === me);
    const canModerate = !!self && ["owner", "admin", "moderator"].includes(self.role);
    menuTitle.textContent = tx("participants") + (people.length ? " · " + people.length : "");
    menuRoster.replaceChildren();
    for (const person of people) {
      const row = document.createElement("div"); row.className = "tcg-roster-row";
      const avatar = document.createElement("div"); avatar.className = "tcg-roster-avatar"; avatar.innerHTML = "<img alt=\"\"><span></span>"; updateFace(avatar, person);
      const info = document.createElement("div"); info.className = "tcg-roster-info";
      const name = document.createElement("strong"); name.textContent = personName(person);
      const status = document.createElement("small"); status.textContent = person.muted || person.moderatorMuted ? tx("micOff") : tx("micOn");
      info.append(name, status); row.append(avatar, info);
      if (person.username !== me && canModerate) {
        const mod = document.createElement("button"); mod.type = "button"; mod.className = "tcg-roster-action";
        mod.textContent = person.moderatorMuted ? tx("unmutePerson") : tx("mutePerson");
        mod.onclick = () => socket.emit("group-call:moderator-mute", { conversationId: state.convo, target: person.username, muted: !person.moderatorMuted });
        row.appendChild(mod);
      }
      if (person.username !== me) {
        const report = document.createElement("button"); report.type = "button"; report.className = "tcg-roster-action"; report.textContent = tx("report");
        report.onclick = () => window.TalkChatCallReports?.submit(person, { callId: state.callId, convo: state.convo });
        row.appendChild(report);
      }
      menuRoster.appendChild(row);
    }
    const ownMute = document.createElement("button"); ownMute.type = "button"; ownMute.className = "tcg-menu-mic";
    ownMute.textContent = state.muted ? tx("unmute") : tx("mute");
    ownMute.disabled = !!(self && self.moderatorMuted && state.muted);
    ownMute.onclick = () => muteBtn.click();
    menuRoster.appendChild(ownMute);
  }
  window.addEventListener("talkchat:active-conversation", event => {
    const conversationId = event.detail && event.detail.id;
    const conv = conversationsCache.find(item => item.id === conversationId);
    if (conv && conv.type === "group" && socket.connected) socket.emit("group-call:status", { conversationId });
    window.TalkChatCallBanners?.refresh?.();
  });

  /* ---------- səs səviyyəsi (kim danışır) ---------- */
  let actx = null;
  const audioCtx = () => {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume().catch(() => {});
    } catch { actx = null; }
    return actx;
  };
  function makeMeter(stream) {
    const c = audioCtx();
    if (!c || !stream || !stream.getAudioTracks || !stream.getAudioTracks().length) return null;
    try {
      const src = c.createMediaStreamSource(stream);
      const an = c.createAnalyser();
      an.fftSize = 256;
      src.connect(an); // destination-a qoşulmur: səs təkrarlanmasın
      return { src, an, buf: new Uint8Array(an.fftSize) };
    } catch { return null; }
  }
  function level(m) {
    m.an.getByteTimeDomainData(m.buf);
    let sum = 0;
    for (let i = 0; i < m.buf.length; i++) { const x = (m.buf[i] - 128) / 128; sum += x * x; }
    return Math.sqrt(sum / m.buf.length);
  }
  const dropMeter = (m) => { try { if (m) m.src.disconnect(); } catch {} };

  /* ---------- zəng səsi, ekran, native xidmət ---------- */
  let ringCtx = null, ringInt = null;
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
      ringInt = setInterval(beep, 2200);
    } catch {}
  }
  function stopRing() {
    clearInterval(ringInt); ringInt = null;
    try { if (ringCtx) ringCtx.close(); } catch {}
    ringCtx = null;
    try { if (navigator.vibrate) navigator.vibrate(0); } catch {}
  }
  let wake = null;
  const takeWake = async () => { try { if (navigator.wakeLock) wake = await navigator.wakeLock.request("screen"); } catch {} };
  const dropWake = () => { try { if (wake) wake.release(); } catch {} wake = null; };
  const nativeCall = (m, args) => {
    try {
      const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CallService;
      if (P && P[m]) P[m](args || {}).catch(() => {});
    } catch {}
  };
  // ---------- TALKCHAT GROUP CALL OVERLAY ----------
const callNativePlugin =
  window.Capacitor?.Plugins?.CallService;

const appNativePlugin =
  window.Capacitor?.Plugins?.App;

function syncGroupNativeOverlay(show = false) {
  if (!state) return;

  const names = Array.from(new Set([
    me,
    ...(state.participants || [])
      .map(person => person.username)
      .filter(Boolean),
    ...state.peers.keys()
  ]));

  const participants = names.map(username => {
    const person = (state.participants || [])
      .find(item => item.username === username);

    return {
      username,
      displayName:
        person?.displayName ||
        person?.name ||
        username,
      avatar: person?.avatar || ""
    };
  });

  const seconds = state.startedAt
    ? Math.floor((Date.now() - state.startedAt) / 1000)
    : 0;

  const data = {
    title: state.name || tx("title"),
    duration: fmt(seconds),
    speaker: "",
    participants: JSON.stringify(participants),
    mediaType: state.mediaType || "audio",
    micMuted: !!state.muted,
    cameraOn: !!state.cameraOn,
    isGroup: true
  };

  nativeCall(
    show ? "showOverlay" : "updateOverlay",
    data
  );
}

// Overlay düymələrinin idarəsi
if (callNativePlugin?.addListener) {
  callNativePlugin.addListener("overlayAction", ({ action } = {}) => {
    if (!action) return;

    switch (action) {
      case "mic":
        if (state) muteBtn.click();
        break;

      case "camera":
        if (state) toggleCamera();
        break;

      case "end":
        if (state) leave();
        break;

      case "hide":
        nativeCall("hideOverlay");
        break;

      case "returnToCall":
        nativeCall("hideOverlay");

        if (state) {
          state.minimized = false;

          if (typeof showPage === "function") {
            showPage("messages");
          }

          paint();
        }
        break;
    }
  }).catch(console.error);
}

// Tətbiq arxa plana keçəndə overlay göstər
if (appNativePlugin?.addListener) {
  appNativePlugin.addListener(
    "appStateChange",
    ({ isActive }) => {
      if (!state) return;

      if (isActive) {
        nativeCall("hideOverlay");
      } else {
        syncGroupNativeOverlay(true);
      }
    }
  ).catch(console.error);
}

  /* ---------- çəkmə ---------- */
  function mkTile(name) {
    const t = document.createElement("div"); t.className = "tcg-tile"; t.dataset.name = name;
    const camera = document.createElement("video"); camera.className = "tcg-camera"; camera.autoplay = true; camera.playsInline = true; camera.muted = true; camera.hidden = true;
    const screen = document.createElement("video"); screen.className = "tcg-screen"; screen.autoplay = true; screen.playsInline = true; screen.muted = true; screen.hidden = true;
    const shareLabel = document.createElement("span"); shareLabel.className = "tcg-share-label"; shareLabel.hidden = true;
    const av = document.createElement("div"); av.className = "tcg-av"; av.innerHTML = "<img alt=\"\"><span></span>";
    const h = hue(name); av.style.background = "linear-gradient(135deg,hsl(" + h + " 72% 64%),hsl(" + ((h + 42) % 360) + " 58% 36%))";
    const nm = document.createElement("div"); nm.className = "tcg-nm";
    const st = document.createElement("div"); st.className = "tcg-st";
    const badge = document.createElement("span"); badge.className = "tcg-badge"; badge.innerHTML = IC.micoff; badge.hidden = true;
    t.append(camera, screen, shareLabel, av, nm, st, badge); return t;
  }

  function paint() {
    const visible = !!(state || inc); panel.hidden = !visible || !!(state && state.minimized); panel.classList.toggle("is-incoming", !state && !!inc);
    if (!visible) return;
    if (state) syncGroupNativeOverlay(false);
    backBtn.hidden = !state;
    moreBtn.hidden = !state;
    moreBtn.setAttribute("aria-expanded", String(!menu.hidden));
    if (!state && inc) { setText(incAv, (inc.name[0] || "?").toUpperCase()); setText(incNm, inc.name); setText(incTx, inc.from + " " + tx("incoming")); setLabel(declineBtn, tx("decline")); setLabel(joinBtn, tx("join")); return; }
    const activePeople = Array.isArray(state.participants) ? state.participants.filter(person => person && person.username) : [];
    const names = Array.from(new Set([me, ...activePeople.map(person => person.username), ...state.peers.keys()]));
    for (const [n, el] of tiles) if (!names.includes(n)) { el.remove(); tiles.delete(n); }
    for (const n of names) { if (!tiles.has(n)) tiles.set(n, mkTile(n)); grid.appendChild(tiles.get(n)); }
    grid.dataset.n = String(names.length);
    let anyoneSharing = false;
    for (const n of names) {
      const t = tiles.get(n), isMe = n === me, p = isMe ? null : state.peers.get(n);
      const person = groupPerson(state, n);
      setText(t.querySelector(".tcg-nm"), (personName(person) || n) + (isMe ? " (" + tx("you") + ")" : ""));
      updateFace(t.querySelector(".tcg-av"), person);
      const cameraTrack = isMe ? state.cameraTrack : p && p.cameraStream && p.cameraStream.getVideoTracks()[0];
      const cameraStream = isMe ? (state.cameraTrack ? (state.localCameraStream || (state.localCameraStream = new MediaStream([state.cameraTrack]))) : null) : (p && p.cameraStream);
      const cameraEl = t.querySelector(".tcg-camera");
      if (cameraEl.srcObject !== cameraStream) cameraEl.srcObject = cameraStream;
      const cameraOn = isMe ? state.cameraOn : !!(p && p.cameraOn);
      cameraEl.hidden = !cameraStream || !cameraOn; t.classList.toggle("has-camera", !cameraEl.hidden);
      const screenStream = isMe ? state.screenStream : p && p.screenStream;
      const screenEl = t.querySelector(".tcg-screen");
      if (screenEl.srcObject !== screenStream) screenEl.srcObject = screenStream || null;
      const sharing = isMe ? state.sharing : !!(p && p.sharing);
      screenEl.hidden = !sharing || !screenStream; anyoneSharing = anyoneSharing || sharing;
      const shareLabel = t.querySelector(".tcg-share-label"); shareLabel.hidden = !sharing; setText(shareLabel, (isMe ? tx("you") : n) + " · " + tx("sharing"));
      const muted = isMe ? state.muted : (p ? !!p.muted : person.muted === true || person.moderatorMuted === true); t.querySelector(".tcg-badge").hidden = !muted;
      let status = ""; if (!isMe && p) status = p.conn === "connected" ? (p.sharing ? tx("sharing") : "") : p.conn === "weak" ? tx("weak") : tx("connecting");
      setText(t.querySelector(".tcg-st"), status); if (muted) t.classList.remove("speaking");
    }
    panel.classList.toggle("is-sharing", anyoneSharing);
    setText(titleEl, state.name || tx("title"));
    const secs = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
    setText(subEl, names.length + "/" + MAX + (state.startedAt ? " · " + fmt(secs) : ""));
    const mic = state.muted, micIcon = muteBtn.querySelector(".tcg-ic"), want = mic ? "micoff" : "mic";
    if (micIcon.dataset.i !== want) { micIcon.innerHTML = IC[want]; micIcon.dataset.i = want; }
    setLabel(muteBtn, mic ? tx("unmute") : tx("mute")); muteBtn.classList.toggle("on", mic);
    const hasCamera = !!state.cameraTrack; cameraBtn.hidden = !hasCamera; switchBtn.hidden = !hasCamera;
    const cameraIcon = cameraBtn.querySelector(".tcg-ic"), cameraWant = state.cameraOn ? "camera" : "cameraOff";
    if (cameraIcon.dataset.i !== cameraWant) { cameraIcon.innerHTML = IC[cameraWant]; cameraIcon.dataset.i = cameraWant; }
    setLabel(cameraBtn, state.cameraOn ? tx("cameraOn") : tx("cameraOff")); cameraBtn.classList.toggle("on", !state.cameraOn);
    const switchIcon = switchBtn.querySelector(".tcg-ic"); if (switchIcon.dataset.i !== "switch") { switchIcon.innerHTML = IC.switch; switchIcon.dataset.i = "switch"; }
    setLabel(switchBtn, tx("switchCamera"));
    const screenIcon = screenBtn.querySelector(".tcg-ic"); if (screenIcon.dataset.i !== "screen") { screenIcon.innerHTML = IC.screen; screenIcon.dataset.i = "screen"; }
    setLabel(screenBtn, state.sharing ? tx("stopShare") : tx("share")); screenBtn.classList.toggle("on", state.sharing);
    setLabel(leaveBtn, tx("leave"));
    renderGroupMenu();
  }

  function pollSpeaking() {
    if (!state) return;
    for (const [n, t] of tiles) {
      const isMe = n === me;
      const p = isMe ? null : state.peers.get(n);
      const meter = isMe ? state.meter : p && p.meter;
      const muted = isMe ? state.muted : !!(p && p.muted);
      const on = !!meter && !muted && level(meter) > 0.035;
      if (t.classList.contains("speaking") !== on) t.classList.toggle("speaking", on);
    }
  }

  /* ---------- mikrofon və vəziyyət ---------- */
  async function getMedia(mediaType) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error(tx("noMic"));
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: mediaType === "video" ? { facingMode: { ideal: "user" }, width: { ideal: 960 }, height: { ideal: 540 } } : false });
  }

  async function ensureState(convo, mediaType = "audio") {
    if (state && state.convo === convo) return state;
    if (state) await leave();
    const conv = (typeof conversationsCache !== "undefined" && conversationsCache.find(c => c.id === convo)) || null;
    const local = await getMedia(mediaType);
    state = { convo, name: (conv && conv.name) || "", mediaType, local, cameraTrack: local.getVideoTracks()[0] || null, cameraOn: mediaType === "video", facing: "user", screenTrack: null, screenStream: null, screenHandle: null, sharing: false, peers: new Map(), participants: [], callId: null, muted: false, startedAt: 0, tick: null, poll: null, meter: makeMeter(local), rejoining: false, minimized: false };
    state.tick = setInterval(paint, 1000); state.poll = setInterval(pollSpeaking, 160);
    nativeCall("start", { title: "TalkChat", text: tx("native"), camera: mediaType === "video" }); takeWake(); paint(); return state;
  }


  const signal = (to, data) => {
    if (state) socket.emit("group-call:signal", { conversationId: state.convo, to, signal: data });
  };

  async function makePeer(username, offer) {
    if (!state || state.peers.has(username)) return state && state.peers.get(username);
    const pc = new RTCPeerConnection({ iceServers: await getIce() });
    const peer = { pc, audio: null, pending: [], muted: earlyMuted.get(username) === true, cameraOn: state.mediaType === "video", sharing: false, cameraStream: null, screenStream: null, conn: "connecting", meter: null };
    earlyMuted.delete(username);
    peer.audioTrans = pc.addTransceiver("audio", { direction: "sendrecv" });
    peer.cameraTrans = pc.addTransceiver("video", { direction: "sendrecv" });
    peer.screenTrans = pc.addTransceiver("video", { direction: "sendrecv" });
    state.peers.set(username, peer); paint();
    const audioTrack = state.local.getAudioTracks()[0];
    if (audioTrack) await peer.audioTrans.sender.replaceTrack(audioTrack);
    if (state.cameraTrack) await peer.cameraTrans.sender.replaceTrack(state.cameraTrack);
    if (state.screenTrack) await peer.screenTrans.sender.replaceTrack(state.screenTrack);
    pc.onicecandidate = e => { if (e.candidate) signal(username, { candidate: e.candidate }); };
    pc.ontrack = e => {
      const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
      if (e.track.kind === "audio") {
        peer.audio = peer.audio || document.createElement("audio"); peer.audio.autoplay = true; peer.audio.playsInline = true; peer.audio.hidden = true;
        if (!peer.audio.isConnected) document.body.appendChild(peer.audio);
        peer.audio.srcObject = new MediaStream([e.track]); peer.audio.play().catch(() => {});
        dropMeter(peer.meter); peer.meter = makeMeter(peer.audio.srcObject);
      } else if (e.transceiver === peer.cameraTrans) { peer.cameraStream = stream; const tile = tiles.get(username); if (tile) { tile.querySelector(".tcg-camera").srcObject = stream; tile.querySelector(".tcg-camera").play().catch(() => {}); } }
      else if (e.transceiver === peer.screenTrans) { peer.screenStream = stream; const tile = tiles.get(username); if (tile) { tile.querySelector(".tcg-screen").srcObject = stream; tile.querySelector(".tcg-screen").play().catch(() => {}); } }
      paint();
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") { peer.conn = "connected"; if (state && state.muted) signal(username, { muted: true }); if (state && !state.cameraOn) signal(username, { camera: false }); if (state && state.sharing) signal(username, { screen: true }); }
      else if (s === "disconnected") peer.conn = "weak";
      else if (s === "failed" || s === "closed") { removePeer(username); return; }
      else peer.conn = "connecting";
      paint();
    };
    if (offer) { const desc = await pc.createOffer(); await pc.setLocalDescription(desc); signal(username, { description: pc.localDescription }); }
    paint(); return peer;
  }

  async function handleSignal(from, data) {
    if (!state || !from || !data) return;
    if (typeof data.muted === "boolean") { const p = state.peers.get(from); if (p) { p.muted = data.muted; paint(); } else earlyMuted.set(from, data.muted); return; }
    let peer = state.peers.get(from);
    if (!peer && data.description && data.description.type === "offer") peer = await makePeer(from, false);
    if (!peer) { const q = queued.get(from) || []; q.push(data); queued.set(from, q); return; }
    if (typeof data.camera === "boolean") { peer.cameraOn = data.camera; paint(); return; }
    if (typeof data.screen === "boolean") { peer.sharing = data.screen; paint(); return; }
    const pc = peer.pc;
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (data.description.type === "offer") { const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); signal(from, { description: pc.localDescription }); }
    } else if (data.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {}); else peer.pending.push(data.candidate); }
  }

  function removePeer(name) {
    if (!state) return;
    const p = state.peers.get(name); if (!p) return;
    try { p.pc.close(); } catch (_) {}
    dropMeter(p.meter); if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    const tile = tiles.get(name); if (tile) { tile.querySelector(".tcg-camera").srcObject = null; tile.querySelector(".tcg-screen").srcObject = null; }
    state.peers.delete(name); paint();
  }

  async function leave(notify = true) {
    if (!state) { paint(); return; }
    const old = state; state = null;
    if (notify) socket.emit("group-call:leave", { conversationId: old.convo });
    clearInterval(old.tick); clearInterval(old.poll);
    old.peers.forEach(p => { try { p.pc.close(); } catch (_) {} dropMeter(p.meter); if (p.audio) { p.audio.srcObject = null; p.audio.remove(); } });
    dropMeter(old.meter);
    if (old.screenHandle) await old.screenHandle.stop().catch(() => {});
    if (old.screenTrack && old.screenTrack.readyState !== "ended") old.screenTrack.stop();
    old.local.getTracks().forEach(t => t.stop()); if (old.cameraTrack && !old.local.getTracks().includes(old.cameraTrack)) old.cameraTrack.stop();
    queued.clear(); earlyMuted.clear();
    for (const el of tiles.values()) { el.querySelector(".tcg-camera").srcObject = null; el.querySelector(".tcg-screen").srcObject = null; el.remove(); }
    tiles.clear();
    dropWake();
    nativeCall("hideOverlay");
    nativeCall("stop");
    paint();
  }

  async function startCall(conversationId, mediaType = "audio") {
    const conv = conversationsCache.find(c => c.id === conversationId);
    if (!conv || conv.type !== "group") return;
    if (state) return alert(tx("already"));
    if (oneToOneVisible()) return alert(tx("busy1"));
    try { await ensureState(conversationId, mediaType === "video" ? "video" : "audio"); socket.emit("group-call:start", { conversationId, mediaType: state.mediaType }); }
    catch (e) { await leave(false); alert((e && e.message) || tx("micFail")); }
  }

  async function joinCall(conversationId, mediaType = "audio") {
    try { await ensureState(conversationId, mediaType === "video" ? "video" : "audio"); socket.emit("group-call:join", { conversationId }); }
    catch (e) { await leave(false); alert((e && e.message) || tx("micFail")); }
  }

  async function toggleCamera() {
    if (!state) return;
    if (!state.cameraTrack) {
      let stream; try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: state.facing }, width: { ideal: 960 }, height: { ideal: 540 } }, audio: false }); }
      catch (e) { alert(tx("cameraFail") + " " + (e.message || "")); return; }
      state.cameraTrack = stream.getVideoTracks()[0]; state.localCameraStream = new MediaStream([state.cameraTrack]); state.cameraOn = true;
      for (const p of state.peers.values()) await p.cameraTrans.sender.replaceTrack(state.cameraTrack).catch(() => {});
    } else { state.cameraOn = !state.cameraOn; state.cameraTrack.enabled = state.cameraOn; }
    for (const name of state.peers.keys()) signal(name, { camera: state.cameraOn }); paint();
  }

  async function switchCamera() {
    if (!state || !state.cameraTrack) return;
    const facing = state.facing === "environment" ? "user" : "environment";
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 960 }, height: { ideal: 540 } }, audio: false }); }
    catch (e) { alert(tx("cameraFail") + " " + (e.message || "")); return; }
    const next = stream.getVideoTracks()[0], old = state.cameraTrack;
    for (const p of state.peers.values()) await p.cameraTrans.sender.replaceTrack(next).catch(() => {});
    next.enabled = state.cameraOn; state.cameraTrack = next; state.localCameraStream = new MediaStream([next]); state.facing = facing; old.stop(); paint();
  }

  async function toggleShare() {
    if (!state) return;
    if (state.sharing) return stopShare();
    let stream = null, handle = null;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      else if (window.TalkChatNativeScreen) { handle = await window.TalkChatNativeScreen.start(() => stopShare(true)); stream = handle.stream; }
      else return alert(tx("noScreen"));
      if (!state) { stream.getTracks().forEach(t => t.stop()); if (handle) await handle.stop(); return; }
      const track = stream.getVideoTracks()[0]; if (!track) throw new Error("No screen video track");
      if ("contentHint" in track) track.contentHint = "detail";
      state.screenStream = stream; state.screenTrack = track; state.screenHandle = handle; state.sharing = true;
      for (const p of state.peers.values()) await p.screenTrans.sender.replaceTrack(track);
      for (const name of state.peers.keys()) signal(name, { screen: true });
      track.onended = () => stopShare(true); paint();
    } catch (e) { if (handle) await handle.stop().catch(() => {}); if (e && e.name !== "NotAllowedError" && e.name !== "AbortError") alert(tx("screenFail") + " " + (e.message || "")); }
  }

  async function stopShare(nativeStopped = false) {
    if (!state || !state.sharing) return;
    const old = state; old.sharing = false; const handle = old.screenHandle, track = old.screenTrack;
    old.screenHandle = null; old.screenTrack = null; old.screenStream = null;
    if (track && track.readyState !== "ended") track.stop(); if (handle) await handle.stop(nativeStopped).catch(() => {});
    for (const p of old.peers.values()) p.screenTrans.sender.replaceTrack(null).catch(() => {});
    for (const name of old.peers.keys()) signal(name, { screen: false }); paint();
  }

  /* ---------- gələn zəng ---------- */
  function dismissIncoming() {
    inc = null;
    clearTimeout(incTimer); incTimer = null;
    stopRing();
    paint();
  }

  muteBtn.onclick = () => {
    if (!state) return;
    const self = groupPerson(state, me);
    if (state.muted && self.moderatorMuted) return;
    state.muted = !state.muted;
    state.local.getAudioTracks().forEach(t => (t.enabled = !state.muted));
    for (const name of state.peers.keys()) signal(name, { muted: state.muted });
    paint();
  };
  cameraBtn.onclick = toggleCamera;
  switchBtn.onclick = switchCamera;
  screenBtn.onclick = toggleShare;
  leaveBtn.onclick = () => leave();
  backBtn.onclick = () => {
    if (!state) return;
    state.minimized = true;
    menu.hidden = true;
    moreBtn.setAttribute("aria-expanded", "false");
    if (typeof showPage === "function") showPage("messages");
    panel.hidden = true;
    window.TalkChatCallBanners?.refresh?.();
    paint();
  };
  moreBtn.onclick = () => {
    if (!state) return;
    menu.hidden = !menu.hidden;
    moreBtn.setAttribute("aria-expanded", String(!menu.hidden));
    renderGroupMenu();
  };
  document.addEventListener("click", event => {
    if (!menu.hidden && !event.target.closest("#tcGroupCall .tcg-menu, #tcGroupCall .tcg-more")) {
      menu.hidden = true;
      moreBtn.setAttribute("aria-expanded", "false");
    }
  });
  declineBtn.onclick = () => {
    if (inc) socket.emit("group-call:decline", { conversationId: inc.convo });
    dismissIncoming();
  };
  joinBtn.onclick = async () => {
    const i = inc;
    if (!i) return;
    dismissIncoming();
    audioCtx(); // istifadəçi jestində səs kontekstini aç
    await joinCall(i.convo, i.mediaType);
  };

  socket.on("group-call:incoming", d => {
    if (!d || !d.conversationId || state || inc || oneToOneVisible()) return;
    const conv = conversationsCache.find(c => c.id === d.conversationId);
    inc = { convo: d.conversationId, name: (conv && conv.name) || tx("title"), from: d.from || "?", mediaType: d.mediaType === "video" ? "video" : "audio" };
    paint();
    startRing();
    incTimer = setTimeout(dismissIncoming, 45000);
  });

  socket.on("group-call:joined", async d => {
    if (!state || !d || d.conversationId !== state.convo) return;
    state.rejoining = false;
    state.callId = d.callId || state.callId;
    if (Number(d.startedAt)) state.startedAt = Number(d.startedAt);
    if (Array.isArray(d.participantDetails)) {
      const byName = new Map(state.participants.map(person => [person.username, person]));
      d.participantDetails.forEach(person => { if (person && person.username) byName.set(person.username, person); });
      state.participants = Array.from(byName.values());
    }
    for (const name of (Array.isArray(d.participants) ? d.participants : [])) {
      if (name === me) continue;
      await makePeer(name, false);
      const q = queued.get(name) || [];
      queued.delete(name);
      for (const s of q) await handleSignal(name, s);
    }
    paint();
  });

  socket.on("group-call:peer-joined", async d => {
    if (!state || !d || d.conversationId !== state.convo || !d.username || d.username === me) return;
    if (d.participant) {
      const byName = new Map(state.participants.map(person => [person.username, person]));
      byName.set(d.username, d.participant);
      state.participants = Array.from(byName.values());
    }
    try {
      await makePeer(d.username, true);
      paint();
    } catch (e) {
      console.error("Qrup peer xətası:", e);
    }
  });

  socket.on("group-call:signal", d => {
    if (state && d && d.conversationId === state.convo) handleSignal(d.from, d.signal).catch(console.error);
  });

  socket.on("group-call:peer-left", d => {
    if (state && d && d.conversationId === state.convo) {
      removePeer(d.username);
      if (!d.reconnecting) state.participants = state.participants.filter(person => person.username !== d.username);
      paint();
    }
  });
  socket.on("group-call:state", applyGroupState);
  socket.on("group-call:resumed", applyGroupState);
  socket.on("group-call:ended", d => {
    if (!d || !d.conversationId) return;
    applyGroupState({ ...d, active: false });
  });
  socket.on("group-call:participant-muted", d => {
    if (!state || !d || d.conversationId !== state.convo) return;
    state.participants = state.participants.map(person => person.username === d.username
      ? { ...person, muted: d.muted === true, moderatorMuted: d.moderatorMuted === true }
      : person);
    const peer = state.peers.get(d.username);
    if (peer) { peer.muted = d.muted === true; peer.moderatorMuted = d.moderatorMuted === true; }
    if (d.username === me) {
      state.muted = d.muted === true;
      state.local.getAudioTracks().forEach(track => { track.enabled = !state.muted; });
    }
    paint();
  });

  socket.on("group-call:error", async d => {
    if (!state || (d && d.conversationId && d.conversationId !== state.convo)) return;
    const msg = (d && d.message) || tx("error");
    await leave(false);
    alert(msg);
  });

  socket.on("disconnect", () => {
    if (inc) dismissIncoming();
    if (!state) return;
    state.rejoining = true;
    for (const name of Array.from(state.peers.keys())) removePeer(name);
    paint();
  });

  socket.on("connect", () => {
    const conversationId = window.TalkChatActiveConversationId;
    const conversation = conversationsCache.find(item => item.id === conversationId);
    if (conversation && conversation.type === "group") socket.emit("group-call:status", { conversationId });
    if (!state || !state.rejoining) return;
    socket.emit("group-call:join", { conversationId: state.convo });
  });

  window.TalkChatGroupCalls = {
  startCall,
  joinCall,
  leave,
  toggleMute: () => muteBtn.click(),
  toggleCamera
};
})();
