(() => {
  "use strict";
  if (window.TalkChatGroupCalls) return;

  const ICE = window.TC_ICE_SERVERS || [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ];
  let state = null;
  const queued = new Map();

  const panel = document.createElement("section");
  panel.id = "tcGroupCall";
  panel.hidden = true;
  panel.style.cssText = "position:fixed;z-index:99999;left:12px;right:12px;bottom:18px;background:#20232b;color:white;padding:16px;border-radius:16px;font:14px sans-serif";
  const status = document.createElement("div");
  const muteBtn = document.createElement("button");
  const leaveBtn = document.createElement("button");
  muteBtn.type = leaveBtn.type = "button";
  leaveBtn.textContent = "Zəngdən çıx";
  [muteBtn, leaveBtn].forEach(b => {
    b.style.cssText = "padding:10px 14px;margin:8px 8px 0 0;border:0;border-radius:10px";
    panel.appendChild(b);
  });
  panel.insertBefore(status, muteBtn);
  (document.body || document.documentElement).appendChild(panel);

  function update() {
    if (!state) return;
    status.textContent = `İştirakçılar (${state.peers.size + 1}/5): ${[me, ...state.peers.keys()].join(", ")}`;
    muteBtn.textContent = state.muted ? "Mikrofonu aç" : "Mikrofonu susdur";
    panel.hidden = false;
  }

  async function getMic() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Mikrofon əlçatan deyil.");
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
  }

  async function ensureState(convo) {
    if (state?.convo === convo) return state;
    if (state) await leave();
    state = { convo, local: await getMic(), peers: new Map(), muted: false };
    update();
    return state;
  }

  function signal(to, data) {
    if (state) socket.emit("group-call:signal", {
      conversationId: state.convo, to, signal: data
    });
  }

  async function makePeer(username, offer) {
    if (!state || state.peers.has(username)) return state?.peers.get(username);

    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, audio: null, pending: [] };
    state.peers.set(username, peer);
    state.local.getTracks().forEach(t => pc.addTrack(t, state.local));

    pc.onicecandidate = e => {
      if (e.candidate) signal(username, { candidate: e.candidate });
    };

    pc.ontrack = e => {
      if (!peer.audio) {
        peer.audio = document.createElement("audio");
        peer.audio.autoplay = true;
        peer.audio.playsInline = true;
        peer.audio.hidden = true;
        document.body.appendChild(peer.audio);
      }
      peer.audio.srcObject = e.streams?.[0] || new MediaStream([e.track]);
      peer.audio.play().catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) removePeer(username);
    };

    if (offer) {
      const desc = await pc.createOffer();
      await pc.setLocalDescription(desc);
      signal(username, { description: pc.localDescription });
    }
    return peer;
  }

  async function handleSignal(from, data) {
    if (!state || !from || !data) return;
    let peer = state.peers.get(from);

    if (!peer && data.description?.type === "offer") {
      peer = await makePeer(from, false);
    }
    if (!peer) {
      const q = queued.get(from) || [];
      q.push(data);
      queued.set(from, q);
      return;
    }

    const pc = peer.pc;
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      for (const c of peer.pending.splice(0)) {
        await pc.addIceCandidate(c).catch(() => {});
      }
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
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    state.peers.delete(name);
    update();
  }

  async function leave(notify = true) {
    if (!state) { panel.hidden = true; return; }
    const old = state;
    state = null;
    if (notify) socket.emit("group-call:leave", { conversationId: old.convo });
    old.peers.forEach(p => {
      try { p.pc.close(); } catch (_) {}
      if (p.audio) p.audio.remove();
    });
    old.local.getTracks().forEach(t => t.stop());
    queued.clear();
    panel.hidden = true;
  }

  async function startCall(conversationId) {
    const conv = conversationsCache.find(c => c.id === conversationId);
    if (!conv || conv.type !== "group") return;
    if (state) return alert("Artıq qrup zəngindəsən.");
    try {
      await ensureState(conversationId);
      socket.emit("group-call:start", { conversationId });
    } catch (e) {
      await leave(false);
      alert(e.message || "Mikrofon açıla bilmədi.");
    }
  }

  async function joinCall(conversationId) {
    try {
      await ensureState(conversationId);
      socket.emit("group-call:join", { conversationId });
    } catch (e) {
      await leave(false);
      alert(e.message || "Mikrofon açıla bilmədi.");
    }
  }

  muteBtn.onclick = () => {
    if (!state) return;
    state.muted = !state.muted;
    state.local.getAudioTracks().forEach(t => t.enabled = !state.muted);
    update();
  };
  leaveBtn.onclick = () => leave();

  socket.on("group-call:incoming", async d => {
    if (!d?.conversationId || state) return;
    const conv = conversationsCache.find(c => c.id === d.conversationId);
    if (confirm(`${conv?.name || "Qrup"}: ${d.from || "İstifadəçi"} zəng başladıb. Qoşulmaq istəyirsən?`)) {
      await joinCall(d.conversationId);
    }
  });

  socket.on("group-call:joined", async d => {
    if (!state || d?.conversationId !== state.convo) return;
    for (const name of (Array.isArray(d.participants) ? d.participants : [])) {
      await makePeer(name, false);
      const q = queued.get(name) || [];
      queued.delete(name);
      for (const s of q) await handleSignal(name, s);
    }
    update();
  });

  socket.on("group-call:peer-joined", async d => {
    if (!state || d?.conversationId !== state.convo || !d.username || d.username === me) return;
    try {
      await makePeer(d.username, true);
      update();
    } catch (e) {
      console.error("Qrup peer xətası:", e);
    }
  });

  socket.on("group-call:signal", d => {
    if (state && d?.conversationId === state.convo) {
      handleSignal(d.from, d.signal).catch(console.error);
    }
  });

  socket.on("group-call:peer-left", d => {
    if (state && d?.conversationId === state.convo) removePeer(d.username);
  });

  socket.on("group-call:error", async d => {
    if (!state || (d?.conversationId && d.conversationId !== state.convo)) return;
    const msg = d?.message || "Qrup zəngi xətası.";
    await leave(false);
    alert(msg);
  });

  socket.on("disconnect", () => {
    if (state) leave(false);
  });

  window.TalkChatGroupCalls = { startCall, joinCall, leave };
})();
