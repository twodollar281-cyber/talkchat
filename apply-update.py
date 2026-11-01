from pathlib import Path
from datetime import datetime
import shutil
import subprocess
import sys

files = [Path("server.js"), Path("public/app.js"), Path("public/style.css")]

for f in files:
    if not f.exists():
        sys.exit(f"XƏTA: {f} tapılmadı. Heç nə dəyişdirilmədi.")

backup = Path("backups") / ("talkchat-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
backup.mkdir(parents=True)

for f in files:
    shutil.copy2(f, backup / f.name)

server = files[0].read_text()
app = files[1].read_text()
css = files[2].read_text()

# Serverdə zəngləri söhbətin digər iştirakçısına yönləndir.
start = server.find("const validCallTarget =")
end_marker = 'relayCall("call:end", "call:ended");'
end = server.find(end_marker, start)

if start < 0 or end < 0:
    sys.exit("Zəng server bloku tapılmadı. Ehtiyat nüsxə: " + str(backup))

end += len(end_marker)

server_block = r'''
const callEvents = {
  "call:invite": "call:incoming",
  "call:accept": "call:accepted",
  "call:reject": "call:rejected",
  "call:signal": "call:signal",
  "call:end": "call:ended"
};

function getCallPeer(conversationId) {
  const c = conversations().find(x =>
    x.id === conversationId &&
    x.type === "direct" &&
    Array.isArray(x.participants) &&
    x.participants.includes(name)
  );
  if (!c) return null;
  return c.participants.find(p => p !== name) || null;
}

for (const [incoming, outgoing] of Object.entries(callEvents)) {
  socket.on(incoming, data => {
    if (!data || typeof data.conversationId !== "string") return;
    const target = getCallPeer(data.conversationId);
    if (!target) return;

    io.to(`user:${target}`).emit(outgoing, {
      conversationId: data.conversationId,
      from: name,
      to: target,
      ...(data.signal ? { signal: data.signal } : {})
    });
  });
}
'''

server = server[:start] + server_block + server[end:]

# Köhnə zəng blokunun yerini tap.
marker = "/* TALKCHAT_AUDIO_CALLS */"
pos = app.find(marker)

if pos < 0:
    sys.exit("app.js-də zəng bloku tapılmadı. Ehtiyat nüsxə: " + str(backup))

client_block = r'''
/* TALKCHAT_AUDIO_CALLS_V2 */
(() => {
  let pc = null, localStream = null, remoteStream = null;
  let peer = "", convo = "", muted = false, state = "idle";
  let pendingCandidates = [];

  const box = document.createElement("section");
  box.id = "tcCallBox";
  box.className = "tc-call-box";
  box.hidden = true;
  box.innerHTML = `
    <div class="tc-call-card">
      <div class="tc-call-avatar" id="tcCallAvatar">T</div>
      <strong id="tcCallTitle">Səsli zəng</strong>
      <p id="tcCallStatus"></p>
      <audio id="tcRemoteAudio" autoplay playsinline></audio>
      <div class="tc-call-buttons">
        <button id="tcAccept" type="button">Qəbul et</button>
        <button id="tcReject" type="button">Rədd et</button>
        <button id="tcMute" type="button">Mikrofonu susdur</button>
        <button id="tcScreen" type="button">Ekranı paylaş</button>
        <button id="tcHangup" type="button">Zəngi bitir</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  const el = id => document.getElementById(id);

  function show(title, status) {
    box.hidden = false;
    el("tcCallTitle").textContent = title;
    el("tcCallStatus").textContent = status;
    el("tcCallAvatar").textContent = (title || "T")[0].toUpperCase();
  }

  function send(event, extra = {}) {
    if (convo) socket.emit(event, { conversationId: convo, ...extra });
  }

  function cleanup() {
    if (pc) pc.close();
    pc = null;
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    remoteStream = null;
    el("tcRemoteAudio").srcObject = null;
    pendingCandidates = [];
    muted = false;
    state = "idle";
    box.hidden = true;
    el("tcMute").textContent = "Mikrofonu susdur";
  }

  async function setupPeer() {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      throw new Error("Brauzer səsli zəngi dəstəkləmir.");
    }

    pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    remoteStream = new MediaStream();
    el("tcRemoteAudio").srcObject = remoteStream;

    pc.ontrack = e => {
      const tracks = e.streams?.[0]?.getTracks() || [e.track];
      tracks.forEach(t => {
        if (!remoteStream.getTracks().some(x => x.id === t.id)) {
          remoteStream.addTrack(t);
        }
      });
      el("tcRemoteAudio").play().catch(() => {});
    };

    pc.onicecandidate = e => {
      if (e.candidate) send("call:signal", { signal: { candidate: e.candidate } });
    };

    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === "connected") {
        el("tcCallStatus").textContent = "Zəng aktivdir";
      } else if (pc && ["failed", "disconnected"].includes(pc.connectionState)) {
        el("tcCallStatus").textContent = "Bağlantı kəsildi";
      }
    };

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));
  }

  async function flushCandidates() {
    if (!pc?.remoteDescription) return;
    for (const candidate of pendingCandidates.splice(0)) {
      try { await pc.addIceCandidate(candidate); }
      catch (e) { console.warn("ICE:", e); }
    }
  }

  document.addEventListener("click", async e => {
    if (!e.target.closest('[aria-label="Səsli zəng"]')) return;

    const c = conversationsCache.find(x => x.id === activeConversation);
    if (!c || c.type === "group") {
      alert("Zəng yalnız şəxsi söhbətdə mümkündür.");
      return;
    }
    if (state !== "idle") {
      alert("Artıq zəngdəsən.");
      return;
    }

    peer = c.participants?.find(p => p !== me) || c.name;
    if (!peer || peer === me) {
      alert("Söhbət iştirakçısı tapılmadı.");
      return;
    }

    convo = c.id;
    state = "calling";
    show(peer, "Zəng edilir...");
    send("call:invite");
  });

  socket.on("call:incoming", d => {
    if (!d?.conversationId || state !== "idle") return;
    convo = d.conversationId;
    peer = d.from;
    state = "incoming";
    show(peer, `${peer} səni arıyor!`);

    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(`${peer} səni arıyor!`);
      } else if (Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }
  });

  socket.on("call:accepted", async d => {
    if (d?.conversationId !== convo || state !== "calling") return;
    state = "connecting";
    el("tcCallStatus").textContent = "Qarşı tərəf qəbul etdi...";
    try {
      await setupPeer();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send("call:signal", { signal: { description: pc.localDescription } });
    } catch (e) {
      send("call:end");
      cleanup();
      alert("Zəng baş tutmadı: " + e.message);
    }
  });

  el("tcAccept").onclick = async () => {
    if (state !== "incoming") return;
    try {
      state = "connecting";
      await setupPeer();
      send("call:accept");
      el("tcCallStatus").textContent = "Bağlantı qurulur...";
    } catch (e) {
      send("call:reject");
      cleanup();
      alert("Mikrofon icazəsi alınmadı: " + e.message);
    }
  };

  el("tcReject").onclick = () => {
    if (convo) send("call:reject");
    cleanup();
  };

  socket.on("call:signal", async d => {
    if (!d || d.conversationId !== convo || !pc) return;
    try {
      const signal = d.signal || {};
      if (signal.description) {
        await pc.setRemoteDescription(signal.description);
        await flushCandidates();

        if (signal.description.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send("call:signal", { signal: { description: pc.localDescription } });
        }
      } else if (signal.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
        else pendingCandidates.push(signal.candidate);
      }
    } catch (e) {
      console.error("Zəng siqnalı:", e);
      el("tcCallStatus").textContent = "Bağlantı xətası";
    }
  });

  socket.on("call:rejected", d => {
    if (d?.conversationId !== convo) return;
    cleanup();
    alert("Zəng rədd edildi.");
  });

  el("tcMute").onclick = () => {
    if (!localStream) return;
    muted = !muted;
    localStream.getAudioTracks().forEach(t => t.enabled = !muted);
    el("tcMute").textContent = muted ? "Mikrofonu aç" : "Mikrofonu susdur";
  };

  el("tcScreen").onclick = async () => {
    if (!pc || !navigator.mediaDevices?.getDisplayMedia) {
      alert("Bu cihaz ekran paylaşımını dəstəkləmir.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const sender = pc.addTrack(track, stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send("call:signal", { signal: { description: pc.localDescription } });
      track.onended = () => pc?.removeTrack(sender);
    } catch (e) {
      alert("Ekran paylaşımı alınmadı: " + e.message);
    }
  };

  el("tcHangup").onclick = () => {
    if (convo) send("call:end");
    cleanup();
  };

  socket.on("call:ended", d => {
    if (d?.conversationId === convo) cleanup();
  });

  socket.on("disconnect", () => {
    if (state !== "idle") cleanup();
  });
})();
'''

app = app[:pos] + client_block + "\n"

extra_css = r'''

/* TALKCHAT DIRECT MOBILE UPDATE */
.talk-direct.tc-instagram {
  min-height: 0;
  overflow: hidden;
}
.tc-ig-workspace {
  min-height: 0;
  height: min(78vh, 820px);
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  overflow: hidden;
  border-radius: 18px;
}
.tc-ig-sidebar {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.tc-ig-chat {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.tc-ig-chat-header {
  flex: 0 0 auto;
  position: sticky;
  top: 0;
  z-index: 4;
}
#chatMessages {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
#dmForm {
  flex: 0 0 auto;
  position: sticky;
  bottom: 0;
  z-index: 4;
}
.tc-call-box[hidden] { display: none !important; }
.tc-call-box {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(10,7,20,.8);
  backdrop-filter: blur(12px);
}
.tc-call-card {
  width: min(100%,390px);
  padding: 28px 20px;
  border: 1px solid rgba(180,140,255,.28);
  border-radius: 24px;
  text-align: center;
  color: white;
  background: linear-gradient(145deg,#211535,#11101b);
}
.tc-call-avatar {
  width: 76px;
  height: 76px;
  margin: 0 auto 16px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: white;
  font-size: 30px;
  font-weight: 800;
  background: linear-gradient(135deg,#a855f7,#6d28d9);
}
.tc-call-card strong { display: block; font-size: 21px; }
.tc-call-card p { color: #c9bfd8; }
.tc-call-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 9px;
  margin-top: 20px;
}
.tc-call-buttons button {
  border: 0;
  border-radius: 12px;
  padding: 11px 14px;
  color: white;
  background: #713bd1;
  font-weight: 700;
}
@media (max-width:700px) {
  .tc-ig-workspace {
    height: calc(100dvh - 190px);
    min-height: 360px;
    display: block;
    border-radius: 0;
  }
  .tc-ig-sidebar {
    width: 100%;
    height: 100%;
    overflow-y: auto;
  }
  .tc-ig-chat {
    display: none;
    width: 100%;
    height: 100%;
  }
  #messagesPage.tc-chat-open .tc-ig-sidebar { display: none; }
  #messagesPage.tc-chat-open .tc-ig-chat { display: flex; }
  .tc-ig-chat-header {
    padding-top: max(10px,env(safe-area-inset-top));
  }
  #dmForm {
    padding-bottom: max(8px,env(safe-area-inset-bottom));
  }
}
'''

if "TALKCHAT DIRECT MOBILE UPDATE" not in css:
    css += "\n" + extra_css

server_path, app_path, css_path = files
server_path.write_text(server)
app_path.write_text(app)
css_path.write_text(css)

print("Dəyişikliklər tətbiq edildi.")
print("Ehtiyat nüsxə:", backup)

for f in ("server.js", "public/app.js"):
    result = subprocess.run(["node", "--check", f], capture_output=True, text=True)
    if result.returncode:
        print("SINTAKSIS XƏTASI:", f)
        print(result.stderr)
        sys.exit(1)
    print("OK:", f)

print("GitHub-a heç nə göndərilməyib.")
