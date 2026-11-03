/* TALKCHAT_GROUP_CALLS_V2 — qrup zəngi (mesh WebRTC, maksimum 5 nəfər).
   Server hadisələri dəyişməyib: group-call:start/join/leave/signal və incoming/joined/peer-joined/peer-left/error. */
(() => {
  "use strict";
  if (window.TalkChatGroupCalls) return;

  const MAX = 5;
  const ICE = window.TC_ICE_SERVERS || [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ];

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
  };
  const tx = (k) => (S[k] && (S[k][LANG()] || S[k].tr)) || k;

  /* ---------- stillər ---------- */
  const css = `
  #tcGroupCall.tcg{position:fixed;inset:0;z-index:100002;display:flex;flex-direction:column;color:#fff;
    background:radial-gradient(ellipse at 50% 12%,rgba(134,77,225,.34),transparent 55%),radial-gradient(ellipse at 90% 100%,rgba(83,45,145,.25),transparent 45%),#0d0a17;
    font-family:inherit;-webkit-tap-highlight-color:transparent}
  #tcGroupCall.tcg[hidden]{display:none!important}
  #tcGroupCall .tcg-top{padding:calc(14px + env(safe-area-inset-top)) 18px 6px;text-align:center}
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
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ---------- arayüz ---------- */
  const IC = {
    mic:    '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    micoff: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/></svg>',
    hang:   '<svg viewBox="0 0 24 24"><path d="M3 14c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-7 0V15l-3 1.5z"/></svg>',
    phone:  '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
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
  const titleEl = document.createElement("strong"); titleEl.className = "tcg-title";
  const subEl = document.createElement("span"); subEl.className = "tcg-sub";
  top.append(titleEl, subEl);
  const incBox = document.createElement("div"); incBox.className = "tcg-inc";
  const incAv = document.createElement("div"); incAv.className = "tcg-inc-av";
  const incNm = document.createElement("strong"); incNm.className = "tcg-inc-nm";
  const incTx = document.createElement("p"); incTx.className = "tcg-inc-tx";
  incBox.append(incAv, incNm, incTx);
  const grid = document.createElement("div"); grid.className = "tcg-grid";
  const barCall = document.createElement("div"); barCall.className = "tcg-bar tcg-bar-call";
  const muteBtn = mkBtn("", IC.mic);
  const leaveBtn = mkBtn("end", IC.hang);
  barCall.append(muteBtn, leaveBtn);
  const barIn = document.createElement("div"); barIn.className = "tcg-bar tcg-bar-in";
  const declineBtn = mkBtn("end", IC.hang);
  const joinBtn = mkBtn("ok", IC.phone);
  barIn.append(declineBtn, joinBtn);
  panel.append(top, incBox, grid, barCall, barIn);
  (document.body || document.documentElement).appendChild(panel);

  /* ---------- durum ---------- */
  let state = null;          // aktiv zəng
  let inc = null;            // gələn zəng (hələ qoşulmayıb)
  let incTimer = null;
  const queued = new Map();  // peer hələ yaranmamış siqnallar
  const earlyMuted = new Map();
  const tiles = new Map();

  const hue = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const fmt = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  const oneToOneVisible = () => { const b = document.getElementById("tccBox"); return !!(b && !b.hidden); };

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

  /* ---------- çəkmə ---------- */
  function mkTile(name) {
    const t = document.createElement("div");
    t.className = "tcg-tile";
    t.dataset.name = name;
    const av = document.createElement("div");
    av.className = "tcg-av";
    av.textContent = (String(name)[0] || "?").toUpperCase();
    const h = hue(name);
    av.style.background = `linear-gradient(135deg,hsl(${h} 72% 64%),hsl(${(h + 42) % 360} 58% 36%))`;
    const nm = document.createElement("div"); nm.className = "tcg-nm";
    const st = document.createElement("div"); st.className = "tcg-st";
    const badge = document.createElement("span"); badge.className = "tcg-badge"; badge.innerHTML = IC.micoff; badge.hidden = true;
    t.append(av, nm, st, badge);
    return t;
  }

  function paint() {
    const visible = !!(state || inc);
    panel.hidden = !visible;
    panel.classList.toggle("is-incoming", !state && !!inc);
    if (!visible) return;

    if (!state && inc) {
      setText(incAv, (inc.name[0] || "?").toUpperCase());
      setText(incNm, inc.name);
      setText(incTx, `${inc.from} ${tx("incoming")}`);
      setLabel(declineBtn, tx("decline"));
      setLabel(joinBtn, tx("join"));
      return;
    }

    const names = [me, ...state.peers.keys()];
    for (const [n, el] of tiles) if (!names.includes(n)) { el.remove(); tiles.delete(n); }
    for (const n of names) {
      if (!tiles.has(n)) tiles.set(n, mkTile(n));
      grid.appendChild(tiles.get(n)); // sıranı qoruyur
    }
    grid.dataset.n = String(names.length);

    for (const n of names) {
      const t = tiles.get(n);
      const isMe = n === me;
      const p = isMe ? null : state.peers.get(n);
      setText(t.querySelector(".tcg-nm"), isMe ? `${n} (${tx("you")})` : n);
      const muted = isMe ? state.muted : !!(p && p.muted);
      t.querySelector(".tcg-badge").hidden = !muted;
      let st = "";
      if (!isMe && p) st = p.conn === "connected" ? "" : p.conn === "weak" ? tx("weak") : tx("connecting");
      setText(t.querySelector(".tcg-st"), st);
      if (muted) t.classList.remove("speaking");
    }

    setText(titleEl, state.name || tx("title"));
    const secs = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
    setText(subEl, `${names.length}/${MAX}` + (state.startedAt ? ` · ${fmt(secs)}` : ""));
    const mic = state.muted;
    const ic = muteBtn.querySelector(".tcg-ic");
    const want = mic ? "micoff" : "mic";
    if (ic.dataset.i !== want) { ic.innerHTML = IC[want]; ic.dataset.i = want; }
    setLabel(muteBtn, mic ? tx("unmute") : tx("mute"));
    muteBtn.classList.toggle("on", mic);
    setLabel(leaveBtn, tx("leave"));
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
  async function getMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error(tx("noMic"));
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
  }

  async function ensureState(convo) {
    if (state && state.convo === convo) return state;
    if (state) await leave();
    const conv = (typeof conversationsCache !== "undefined" && conversationsCache.find(c => c.id === convo)) || null;
    const local = await getMic();
    state = { convo, name: (conv && conv.name) || "", local, peers: new Map(), muted: false, startedAt: 0, tick: null, poll: null, meter: makeMeter(local) };
    state.tick = setInterval(paint, 1000);
    state.poll = setInterval(pollSpeaking, 160);
    nativeCall("start", { title: "TalkChat", text: tx("native") });
    takeWake();
    paint();
    return state;
  }

  const signal = (to, data) => {
    if (state) socket.emit("group-call:signal", { conversationId: state.convo, to, signal: data });
  };

  async function makePeer(username, offer) {
    if (!state || state.peers.has(username)) return state && state.peers.get(username);

    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, audio: null, pending: [], muted: earlyMuted.get(username) === true, conn: "connecting", meter: null };
    earlyMuted.delete(username);
    state.peers.set(username, peer);
    state.local.getTracks().forEach(t => pc.addTrack(t, state.local));

    pc.onicecandidate = e => { if (e.candidate) signal(username, { candidate: e.candidate }); };

    pc.ontrack = e => {
      const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
      if (!peer.audio) {
        peer.audio = document.createElement("audio");
        peer.audio.autoplay = true;
        peer.audio.playsInline = true;
        peer.audio.hidden = true;
        document.body.appendChild(peer.audio);
      }
      peer.audio.srcObject = stream;
      peer.audio.play().catch(() => {});
      if (!peer.meter) peer.meter = makeMeter(stream);
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        peer.conn = "connected";
        if (state && state.muted) signal(username, { muted: true }); // yeni qoşulana vəziyyətimizi bildir
      } else if (s === "disconnected") peer.conn = "weak";
      else if (s === "failed" || s === "closed") { removePeer(username); return; }
      else peer.conn = "connecting";
      paint();
    };

    if (offer) {
      const desc = await pc.createOffer();
      await pc.setLocalDescription(desc);
      signal(username, { description: pc.localDescription });
    }
    paint();
    return peer;
  }

  async function handleSignal(from, data) {
    if (!state || !from || !data) return;

    if (typeof data.muted === "boolean") {
      const p = state.peers.get(from);
      if (p) { p.muted = data.muted; paint(); } else earlyMuted.set(from, data.muted);
      return;
    }

    let peer = state.peers.get(from);
    if (!peer && data.description && data.description.type === "offer") peer = await makePeer(from, false);
    if (!peer) {
      const q = queued.get(from) || [];
      q.push(data);
      queued.set(from, q);
      return;
    }

    const pc = peer.pc;
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (data.description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signal(from, { description: pc.localDescription });
      }
    } else if (data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pending.push(data.candidate);
    }
  }

  function removePeer(name) {
    if (!state) return;
    const p = state.peers.get(name);
    if (!p) return;
    try { p.pc.close(); } catch (_) {}
    dropMeter(p.meter);
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    state.peers.delete(name);
    paint();
  }

  async function leave(notify = true) {
    if (!state) { paint(); return; }
    const old = state;
    state = null;
    if (notify) socket.emit("group-call:leave", { conversationId: old.convo });
    clearInterval(old.tick); clearInterval(old.poll);
    old.peers.forEach(p => {
      try { p.pc.close(); } catch (_) {}
      dropMeter(p.meter);
      if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    });
    dropMeter(old.meter);
    old.local.getTracks().forEach(t => t.stop());
    queued.clear(); earlyMuted.clear();
    for (const el of tiles.values()) el.remove();
    tiles.clear();
    dropWake();
    nativeCall("stop");
    paint();
  }

  async function startCall(conversationId) {
    const conv = conversationsCache.find(c => c.id === conversationId);
    if (!conv || conv.type !== "group") return;
    if (state) return alert(tx("already"));
    if (oneToOneVisible()) return alert(tx("busy1"));
    try {
      await ensureState(conversationId);
      socket.emit("group-call:start", { conversationId });
    } catch (e) {
      await leave(false);
      alert((e && e.message) || tx("micFail"));
    }
  }

  async function joinCall(conversationId) {
    try {
      await ensureState(conversationId);
      socket.emit("group-call:join", { conversationId });
    } catch (e) {
      await leave(false);
      alert((e && e.message) || tx("micFail"));
    }
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
    state.muted = !state.muted;
    state.local.getAudioTracks().forEach(t => (t.enabled = !state.muted));
    for (const name of state.peers.keys()) signal(name, { muted: state.muted });
    paint();
  };
  leaveBtn.onclick = () => leave();
  declineBtn.onclick = () => dismissIncoming();
  joinBtn.onclick = async () => {
    const i = inc;
    if (!i) return;
    dismissIncoming();
    audioCtx(); // istifadəçi jestində səs kontekstini aç
    await joinCall(i.convo);
  };

  socket.on("group-call:incoming", d => {
    if (!d || !d.conversationId || state || inc || oneToOneVisible()) return;
    const conv = conversationsCache.find(c => c.id === d.conversationId);
    inc = { convo: d.conversationId, name: (conv && conv.name) || tx("title"), from: d.from || "?" };
    paint();
    startRing();
    incTimer = setTimeout(dismissIncoming, 45000);
  });

  socket.on("group-call:joined", async d => {
    if (!state || !d || d.conversationId !== state.convo) return;
    if (!state.startedAt) state.startedAt = Date.now();
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
    if (state && d && d.conversationId === state.convo) removePeer(d.username);
  });

  socket.on("group-call:error", async d => {
    if (!state || (d && d.conversationId && d.conversationId !== state.convo)) return;
    const msg = (d && d.message) || tx("error");
    await leave(false);
    alert(msg);
  });

  socket.on("disconnect", () => {
    if (inc) dismissIncoming();
    if (state) leave(false);
  });

  window.TalkChatGroupCalls = { startCall, joinCall, leave };
})();
