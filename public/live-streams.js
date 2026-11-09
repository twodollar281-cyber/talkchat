(() => {
  const $ = id => document.getElementById(id);
  const socket = window.TalkChatSocket;
  const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  const state = {
    username: "",
    role: "member",
    streams: [],
    stream: null,
    media: null,
    isHost: false,
    peers: new Map(),
    pendingCandidates: new Map(),
    comments: new Set()
  };

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Sorğunu yerinə yetirmək olmadı.");
    return data;
  }

  function showStatus(message, error = false) {
    const target = $("liveStatus");
    if (!target) return;
    target.textContent = message || "";
    target.classList.toggle("error", error);
  }

  function setViewerCount(count) {
    $("liveViewerCount").textContent = `${Number(count) || 0} izləyici`;
  }

  function renderStreams() {
    const list = $("liveStreamList");
    if (!list) return;
    const streams = state.streams.filter(item =>
      item.status === "live" || (item.username === state.username && item.status === "preview")
    );
    list.innerHTML = streams.length ? streams.map(stream => {
      const own = stream.username === state.username;
      const isLive = stream.status === "live";
      const action = isLive
        ? `<button class="primary" type="button" data-live-open="${escapeHTML(stream.id)}">${own ? "Yayımı idarə et" : "Canlıya qoşul"}</button>`
        : `<button class="secondary" type="button" data-live-resume="${escapeHTML(stream.id)}">Önizləməyə qayıt</button>`;
      return `<article class="tc-live-card">
        <div class="tc-live-card-mark" aria-hidden="true">${isLive ? '<span class="tc-live-badge">● CANLI</span>' : '<span class="tc-live-preview-label">Önizləmə</span>'}</div>
        <div class="tc-live-card-copy"><h2>${escapeHTML(stream.title)}</h2><p>@${escapeHTML(stream.username)}${isLive ? ` · ${Number(stream.viewerCount) || 0} izləyici` : " · hələ başlamayıb"}</p></div>
        ${action}
      </article>`;
    }).join("") : `<div class="tc-live-empty"><b>Hazırda canlı yayım yoxdur</b><p>Öz yayımını başladıb ilk canlı söhbəti aça bilərsən.</p></div>`;
  }

  async function load() {
    if (!$("livePage") || $("livePage").hidden) return;
    showStatus("Canlı yayımlar yüklənir…");
    $("liveStreamList").innerHTML = `<div class="tc-live-empty" aria-busy="true">Yüklənir…</div>`;
    try {
      const [streams, me] = await Promise.all([
        request("/api/live-streams"),
        request("/api/me")
      ]);
      state.username = me.username || window.TalkChatCurrentUsername || "";
      state.role = me.role || "member";
      state.streams = Array.isArray(streams) ? streams : [];
      renderStreams();
      showStatus("");
    } catch (error) {
      showStatus(error.message, true);
      $("liveStreamList").innerHTML = `<div class="tc-live-empty">Yayımlar yüklənmədi. Yenidən cəhd et.</div>`;
    }
  }

  function stopMedia() {
    if (state.media) state.media.getTracks().forEach(track => track.stop());
    state.media = null;
    $("livePreviewVideo").srcObject = null;
    if (state.isHost) $("liveRoomVideo").srcObject = null;
  }

  function closePeers() {
    for (const peer of state.peers.values()) peer.close();
    state.peers.clear();
    state.pendingCandidates.clear();
  }

  function closeRoom({ leave = true } = {}) {
    if (state.stream && !state.isHost && leave) socket?.emit("live:leave", { streamId: state.stream.id });
    closePeers();
    $("liveRoomVideo").srcObject = null;
    $("liveRoomEmpty").hidden = false;
    $("liveRoom").hidden = true;
    $("liveStreamList").hidden = false;
    state.comments.clear();
    $("liveComments").replaceChildren();
    if (!state.isHost) state.stream = null;
    load();
  }

  async function startPreview(existing = null) {
    showStatus("");
    $("liveCreateButton").disabled = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Bu brauzer kamera və mikrofon girişini dəstəkləmir.");
      state.media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      $("livePreviewVideo").srcObject = state.media;
      $("liveTitle").value = existing?.title || "";
      $("liveComposer").hidden = false;
      $("liveStreamList").hidden = true;
      state.stream = existing;
      state.isHost = false;
      $("liveTitle").focus();
    } catch (error) {
      stopMedia();
      showStatus(error.message || "Kameraya və mikrofona giriş alınmadı.", true);
    } finally {
      $("liveCreateButton").disabled = false;
    }
  }

  function ack(eventName, data) {
    return new Promise((resolve, reject) => {
      if (!socket?.connected) return reject(new Error("Canlı yayım serverinə qoşulma yoxdur."));
      socket.timeout(6000).emit(eventName, data, (error, result) => {
        if (error) return reject(new Error("Canlı yayım serveri cavab vermədi."));
        if (!result?.ok) return reject(new Error(result?.error || "Canlı yayım bağlantısı qurulmadı."));
        resolve(result);
      });
    });
  }

  async function startStream() {
    const title = $("liveTitle").value.trim();
    if (title.length < 3 || title.length > 120) {
      showStatus("Başlıq 3–120 simvol arasında olmalıdır.", true);
      return;
    }
    $("liveStartButton").disabled = true;
    showStatus("Canlı yayım hazırlanır…");
    let draft = state.stream;
    try {
      if (!draft) draft = await request("/api/live-streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      else if (draft.title !== title) {
        await request(`/api/live-streams/${encodeURIComponent(draft.id)}`, { method: "DELETE" });
        draft = await request("/api/live-streams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title })
        });
      }
      await ack("live:host", { streamId: draft.id });
      state.stream = await request(`/api/live-streams/${encodeURIComponent(draft.id)}/start`, { method: "POST" });
      state.isHost = true;
      openRoom(state.stream, true);
      showStatus("");
    } catch (error) {
      showStatus(error.message, true);
      if (draft?.id) await request(`/api/live-streams/${encodeURIComponent(draft.id)}`, { method: "DELETE" }).catch(() => {});
      state.stream = null;
      stopMedia();
    } finally {
      $("liveStartButton").disabled = false;
    }
  }

  function openRoom(stream, asHost = false) {
    state.stream = stream;
    state.isHost = asHost;
    $("liveComposer").hidden = true;
    $("liveStreamList").hidden = true;
    $("liveRoom").hidden = false;
    $("liveRoomTitle").textContent = stream.title;
    $("liveRoomHost").textContent = `@${stream.username}`;
    $("liveRoomStatus").textContent = asHost
      ? "Sən canlı yayımdasan. Səhifə və bağlantı açıq qalmalıdır."
      : "Yayım videosuna qoşulur…";
    $("liveEndButton").hidden = !(asHost || ["moderator", "admin", "owner"].includes(state.role));
    $("liveRoomVideo").muted = asHost;
    $("liveRoomVideo").srcObject = asHost ? state.media : null;
    $("liveRoomEmpty").hidden = asHost;
    setViewerCount(stream.viewerCount || 0);
    $("liveComments").replaceChildren();
    state.comments.clear();
    request(`/api/live-streams/${encodeURIComponent(stream.id)}/comments`)
      .then(items => items.forEach(addComment))
      .catch(error => { $("liveRoomStatus").textContent = error.message; });
    if (!asHost) {
      ack("live:join", { streamId: stream.id })
        .then(result => {
          state.stream = result.stream || stream;
          $("liveRoomStatus").textContent = "Canlı yayıma qoşuldun.";
          setViewerCount(state.stream.viewerCount);
        })
        .catch(error => {
          $("liveRoomStatus").textContent = error.message;
          window.setTimeout(() => closeRoom(), 1200);
        });
    }
  }

  function addComment(comment) {
    if (!comment?.id || state.comments.has(comment.id)) return;
    state.comments.add(comment.id);
    const row = document.createElement("div");
    row.className = "tc-live-comment";
    row.dataset.commentId = comment.id;
    const text = document.createElement("span");
    text.textContent = `@${comment.username}: ${comment.text}`;
    row.appendChild(text);
    const rank = { member: 0, moderator: 1, admin: 2, owner: 3 };
    const canModerateComment = (rank[state.role] || 0) > (rank[comment.role] || 0);
    if (comment.username === state.username || state.stream?.username === state.username || canModerateComment) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "tc-live-comment-remove";
      remove.textContent = "Sil";
      remove.setAttribute("aria-label", "Şərhi sil");
      remove.addEventListener("click", async () => {
        try {
          await request(`/api/live-streams/${encodeURIComponent(state.stream.id)}/comments/${encodeURIComponent(comment.id)}`, { method: "DELETE" });
        } catch (error) { $("liveRoomStatus").textContent = error.message; }
      });
      row.appendChild(remove);
    }
    $("liveComments").appendChild(row);
    $("liveComments").scrollTop = $("liveComments").scrollHeight;
  }

  function signal(peerId, payload) {
    socket?.emit("live:signal", { streamId: state.stream?.id, to: peerId, signal: payload });
  }

  function createPeer(peerId, publisher) {
    const existing = state.peers.get(peerId);
    if (existing) existing.close();
    const peer = new RTCPeerConnection(rtcConfig);
    state.peers.set(peerId, peer);
    state.pendingCandidates.set(peerId, []);
    if (publisher && state.media) {
      for (const track of state.media.getTracks()) peer.addTrack(track, state.media);
    }
    peer.onicecandidate = event => {
      if (event.candidate) signal(peerId, { candidate: event.candidate.toJSON() });
    };
    peer.ontrack = event => {
      if (state.isHost || !state.stream) return;
      $("liveRoomVideo").srcObject = event.streams[0] || new MediaStream([event.track]);
      $("liveRoomEmpty").hidden = true;
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
        $("liveRoomStatus").textContent = "Birbaşa media bağlantısı qurulmadı. Bu şəbəkədə TURN xidməti lazım ola bilər.";
      }
    };
    return peer;
  }

  async function flushCandidates(peerId, peer) {
    const queued = state.pendingCandidates.get(peerId) || [];
    state.pendingCandidates.set(peerId, []);
    for (const candidate of queued) await peer.addIceCandidate(candidate).catch(() => {});
  }

  socket?.on("live:viewer-joined", async data => {
    if (!state.isHost || !state.stream || data?.streamId !== state.stream.id) return;
    try {
      const peer = createPeer(data.viewerSocketId, true);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      signal(data.viewerSocketId, { description: { type: offer.type, sdp: offer.sdp } });
    } catch (error) { $("liveRoomStatus").textContent = error.message; }
  });
  socket?.on("live:viewer-left", data => {
    if (!state.isHost || data?.streamId !== state.stream?.id) return;
    const peer = state.peers.get(data.viewerSocketId);
    peer?.close();
    state.peers.delete(data.viewerSocketId);
    state.pendingCandidates.delete(data.viewerSocketId);
  });

  socket?.on("live:signal", async data => {
    if (!state.stream || data?.streamId !== state.stream.id || typeof data.from !== "string") return;
    try {
      let peer = state.peers.get(data.from);
      const description = data.signal?.description;
      if (!peer && !state.isHost && description?.type === "offer") peer = createPeer(data.from, false);
      if (!peer) return;
      if (description) {
        await peer.setRemoteDescription(description);
        await flushCandidates(data.from, peer);
        if (description.type === "offer") {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          signal(data.from, { description: { type: answer.type, sdp: answer.sdp } });
        }
      } else if (data.signal?.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(data.signal.candidate);
        else state.pendingCandidates.get(data.from)?.push(data.signal.candidate);
      }
    } catch (error) { $("liveRoomStatus").textContent = `Media bağlantısı alınmadı: ${error.message}`; }
  });

  socket?.on("live:comment", addComment);
  socket?.on("live:comment-deleted", data => {
    if (data?.streamId !== state.stream?.id) return;
    state.comments.delete(data.commentId);
    $("liveComments").querySelectorAll(".tc-live-comment").forEach(row => {
      if (row.dataset.commentId === data.commentId) row.remove();
    });
  });
  socket?.on("live:viewers", data => {
    if (data?.streamId === state.stream?.id) setViewerCount(data.viewerCount);
  });
  socket?.on("live:ended", data => {
    if (data?.streamId !== state.stream?.id) return;
    $("liveRoomStatus").textContent = "Canlı yayım bitdi.";
    closePeers();
    if (state.isHost) stopMedia();
    state.isHost = false;
    state.stream = null;
    window.setTimeout(() => {
      $("liveRoom").hidden = true;
      $("liveStreamList").hidden = false;
      load();
    }, 800);
  });
  socket?.on("disconnect", () => {
    if (state.isHost && state.stream) {
      stopMedia();
      $("liveRoomStatus").textContent = "Server bağlantısı kəsildi. Canlı yayım dayandırılır.";
    }
    closePeers();
  });

  $("liveCreateButton")?.addEventListener("click", () => startPreview());
  $("liveStartButton")?.addEventListener("click", startStream);
  $("liveCancelButton")?.addEventListener("click", async () => {
    if (state.stream?.status === "preview") {
      await request(`/api/live-streams/${encodeURIComponent(state.stream.id)}`, { method: "DELETE" }).catch(() => {});
    }
    socket?.emit("live:leave", { streamId: state.stream?.id });
    stopMedia();
    state.stream = null;
    $("liveComposer").hidden = true;
    $("liveStreamList").hidden = false;
    showStatus("");
    await load();
  });
  $("liveStreamList")?.addEventListener("click", async event => {
    const watch = event.target.closest("[data-live-open]");
    const resume = event.target.closest("[data-live-resume]");
    const stream = state.streams.find(item => item.id === (watch?.dataset.liveOpen || resume?.dataset.liveResume));
    if (!stream) return;
    if (resume) return startPreview(stream);
    if (stream.username === state.username && state.stream?.id === stream.id && state.isHost)
      return openRoom(stream, true);
    if (stream.username === state.username) {
      showStatus("Bu yayım artıq aktiv görünür. Canlı yayımı idarə edən cihazı yoxla.", true);
      return;
    }
    openRoom(stream, false);
  });
  $("liveLeaveButton")?.addEventListener("click", () => {
    if (!state.isHost) closeRoom();
    else {
      $("liveRoom").hidden = true;
      $("liveStreamList").hidden = false;
      load();
    }
  });
  $("liveEndButton")?.addEventListener("click", async () => {
    if (!state.stream || !window.confirm("Bu canlı yayımı bitirmək istəyirsən?")) return;
    try { await request(`/api/live-streams/${encodeURIComponent(state.stream.id)}/end`, { method: "POST" }); }
    catch (error) { $("liveRoomStatus").textContent = error.message; }
  });
  $("liveCommentForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!state.stream) return;
    const input = $("liveCommentInput");
    const button = $("liveCommentForm").querySelector("button");
    button.disabled = true;
    try {
      const comment = await request(`/api/live-streams/${encodeURIComponent(state.stream.id)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.value })
      });
      addComment(comment);
      input.value = "";
      $("liveRoomStatus").textContent = "";
    } catch (error) { $("liveRoomStatus").textContent = error.message; }
    finally { button.disabled = false; }
  });

  window.TalkChatLive = { load };
})();
