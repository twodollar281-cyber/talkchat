from pathlib import Path
from datetime import datetime
import shutil, sys

root = Path(".")
server = root / "server.js"
app = root / "public/app.js"
html = root / "public/index.html"
css = root / "public/style.css"

for f in (server, app, html, css):
    if not f.exists():
        sys.exit(f"Fayl tapılmadı: {f}")

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
backup = root / "backups" / ("upgrade-" + stamp)
backup.mkdir(parents=True, exist_ok=True)

for f in (server, app, html, css):
    shutil.copy2(f, backup / f.name)

s = server.read_text()
a = app.read_text()
h = html.read_text()
c = css.read_text()

if "TALKCHAT_UPGRADE_V1" in s:
    sys.exit("Bu yeniləmə artıq tətbiq olunub. Təkrar icra etmədim.")

# Server: presence, typing, read receipts and reactions
socket_old = '''    socket.on("leaveTalkRoom", roomId => socket.leave("talk-room:" + roomId));

});'''
socket_new = '''    socket.on("leaveTalkRoom", roomId => socket.leave("talk-room:" + roomId));

    // TALKCHAT_UPGRADE_V1 presence and typing
    onlineUsers.set(name, socket.id);
    io.emit("presenceUpdate", { username: name, online: true });

    socket.on("typing", data => {
      if (!data || typeof data.conversationId !== "string") return;
      const convo = conversations().find(c =>
        c.id === data.conversationId && c.participants.includes(name)
      );
      if (!convo) return;
      convo.participants.filter(x => x !== name).forEach(to =>
        io.to(`user:${to}`).emit("typing", {
          conversationId: convo.id, username: name, typing: !!data.typing
        })
      );
    });

    socket.on("disconnect", () => {
      if (onlineUsers.get(name) === socket.id) {
        onlineUsers.delete(name);
        io.emit("presenceUpdate", {
          username: name, online: false, lastSeen: new Date().toISOString()
        });
      }
    });
});'''

if socket_old not in s:
    sys.exit("Socket.IO bağlantı hissəsi uyğun gəlmədi. Fayllara toxunulmadı.")
s = s.replace(socket_old, socket_new, 1)

# In-memory online state before socket connection setup
anchor = 'io.on("connection", socket => {'
if anchor not in s:
    sys.exit("Socket.IO başlanğıcı tapılmadı.")
s = s.replace(anchor, 'const onlineUsers = new Map();\n\n' + anchor, 1)

# Routes inserted before error handler
route_anchor = 'app.use((err, req, res, next) => {'
if route_anchor not in s:
    sys.exit("Server error handler tapılmadı.")

routes = r'''
// TALKCHAT_UPGRADE_V1 APIs
const messageReactions = ["❤️", "😂", "👍", "🔥"];

app.get("/api/presence", requireAuth, (req, res) => {
  const list = users();
  res.json(list.map(u => ({
    username: u.username,
    online: onlineUsers.has(u.username),
    lastSeen: u.lastSeen || null
  })));
});

app.post("/api/conversations/:id/read", requireAuth, (req, res) => {
  const convo = conversations().find(c =>
    c.id === req.params.id && c.participants.includes(currentUser(req))
  );
  if (!convo) return res.status(404).json({error:"Söhbət tapılmadı."});
  const list = messages();
  const now = new Date().toISOString();
  list.forEach(m => {
    if (m.conversationId === convo.id && m.from !== currentUser(req)) {
      m.readBy = Array.isArray(m.readBy) ? m.readBy : [];
      if (!m.readBy.includes(currentUser(req))) m.readBy.push(currentUser(req));
      m.readAt = now;
    }
  });
  saveMessages(list);
  convo.participants.filter(x => x !== currentUser(req)).forEach(to =>
    io.to("user:" + to).emit("messagesRead", {
      conversationId: convo.id, by: currentUser(req)
    })
  );
  res.json({ok:true});
});

app.post("/api/conversations/:id/messages/:messageId/react", requireAuth, (req, res) => {
  const convo = conversations().find(c =>
    c.id === req.params.id && c.participants.includes(currentUser(req))
  );
  if (!convo) return res.status(404).json({error:"Söhbət tapılmadı."});
  const emoji = String((req.body || {}).emoji || "");
  if (!messageReactions.includes(emoji))
    return res.status(400).json({error:"Reaksiya qəbul edilmir."});
  const list = messages();
  const msg = list.find(m =>
    m.id === req.params.messageId && m.conversationId === convo.id
  );
  if (!msg) return res.status(404).json({error:"Mesaj tapılmadı."});
  msg.reactions = msg.reactions || {};
  msg.reactions[emoji] = Array.isArray(msg.reactions[emoji])
    ? msg.reactions[emoji] : [];
  const who = currentUser(req);
  if (msg.reactions[emoji].includes(who))
    msg.reactions[emoji] = msg.reactions[emoji].filter(x => x !== who);
  else
    msg.reactions[emoji].push(who);
  saveMessages(list);
  io.to("user:" + who).emit("messageReaction", {conversationId:convo.id});
  convo.participants.filter(x => x !== who).forEach(to =>
    io.to("user:" + to).emit("messageReaction", {conversationId:convo.id})
  );
  res.json(msg);
});
'''
s = s.replace(route_anchor, routes + "\n" + route_anchor, 1)

# Frontend: reaction UI, read receipt, typing and presence
if "TALKCHAT_UPGRADE_V1" in a:
    sys.exit("Frontend yeniləməsi artıq mövcuddur.")

old_message = '''function messageHTML(m){
  const attachment=m.attachment?`<p><a href="${esc(m.attachment)}" target="_blank" rel="noopener">📎 ${esc(m.attachmentName||"Faylı aç")}</a></p>`:"";
  return `<div class="chat-bubble ${m.from===me?"mine":""}"><b>@${esc(m.from)}</b><div>${esc(m.text||"")}</div>${attachment}<small>${new Date(m.createdAt).toLocaleTimeString("az-AZ")}</small></div>`;
}'''
new_message = r'''function messageHTML(m){
  const attachment=m.attachment
    ? (String(m.attachmentType||"").startsWith("image/")
      ? `<p><img class="tc-chat-image" src="${esc(m.attachment)}" alt="Şəkil"></p>`
      : String(m.attachmentType||"").startsWith("audio/")
      ? `<p><audio controls src="${esc(m.attachment)}"></audio></p>`
      : `<p><a href="${esc(m.attachment)}" target="_blank" rel="noopener">📎 ${esc(m.attachmentName||"Faylı aç")}</a></p>`)
    : "";
  const reactions = ["❤️","😂","👍","🔥"].map(e =>
    `<button type="button" class="tc-reaction" data-react="${e}" data-message="${esc(m.id)}">${e} ${(m.reactions&&m.reactions[e]||[]).length||""}</button>`
  ).join("");
  const receipt = m.from===me ? `<small>${m.readAt ? "✓✓ Oxundu" : "✓ Göndərildi"}</small>` : "";
  return `<div class="chat-bubble ${m.from===me?"mine":""}">
    <b>@${esc(m.from)}</b><div>${esc(m.text||"")}</div>${attachment}
    <div class="tc-reactions">${reactions}</div>
    <small>${new Date(m.createdAt).toLocaleTimeString("az-AZ")}</small>${receipt}
  </div>`;
}'''
if old_message not in a:
    sys.exit("Mesaj görünüşü gözlənilən formada deyil. Fayllara toxunulmadı.")
a = a.replace(old_message, new_message, 1)

# Read receipts after loading a conversation
old_load = '''    $("chatMessages").scrollTop=$("chatMessages").scrollHeight;
    loadConversations();'''
new_load = '''    $("chatMessages").scrollTop=$("chatMessages").scrollHeight;
    api("/api/conversations/"+id+"/read",{method:"POST"}).catch(()=>{});
    loadConversations();'''
if old_load not in a:
    sys.exit("Söhbət yükləmə hissəsi tapılmadı.")
a = a.replace(old_load, new_load, 1)

# Reaction click handler
a += r'''

// TALKCHAT_UPGRADE_V1 frontend events
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-react]");
  if (!b || !activeConversation) return;
  try {
    await api(`/api/conversations/${activeConversation}/messages/${b.dataset.message}/react`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({emoji:b.dataset.react})
    });
    openConversation(activeConversation);
  } catch(err) { alert(err.message); }
});

let tcTypingTimer;
const tcTypingLabel = document.createElement("small");
tcTypingLabel.id = "tcTypingLabel";
tcTypingLabel.className = "tc-typing";
const tcTitle = $("chatTitle");
if (tcTitle) tcTitle.insertAdjacentElement("afterend", tcTypingLabel);

if ($("dmText")) {
  $("dmText").addEventListener("input", () => {
    if (!activeConversation) return;
    socket.emit("typing", {conversationId:activeConversation, typing:true});
    clearTimeout(tcTypingTimer);
    tcTypingTimer = setTimeout(() => {
      socket.emit("typing", {conversationId:activeConversation, typing:false});
    }, 1200);
  });
}

socket.on("typing", data => {
  if (data.conversationId !== activeConversation) return;
  tcTypingLabel.textContent = data.typing ? `@${data.username} yazır...` : "";
});
socket.on("messagesRead", data => {
  if (data.conversationId === activeConversation) openConversation(activeConversation);
});
socket.on("messageReaction", data => {
  if (data.conversationId === activeConversation) openConversation(activeConversation);
});
socket.on("presenceUpdate", data => {
  document.querySelectorAll("[data-presence-user]").forEach(el => {
    if (el.dataset.presenceUser === data.username)
      el.textContent = data.online ? "Onlayn" : "Offlayn";
  });
});
'''

# Add voice recording controls to existing DM form
needle = '<input id="dmText" placeholder="Mesaj yaz..." maxlength="2000" autocomplete="off">'
if needle not in h:
    sys.exit("Mesaj yazma inputu tapılmadı.")
h = h.replace(needle, needle + '''
          <button id="tcVoiceStart" type="button" title="Səs yaz">🎙️</button>
          <button id="tcVoiceStop" type="button" title="Yazını bitir" disabled>⏹</button>
          <span id="tcVoiceStatus" aria-live="polite"></span>''', 1)

# Voice recording is sent through the existing file upload route
a += r'''
let tcRecorder = null, tcChunks = [];
const tcStart = $("tcVoiceStart"), tcStop = $("tcVoiceStop");
if (tcStart && tcStop && navigator.mediaDevices && window.MediaRecorder) {
  tcStart.onclick = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      tcChunks = [];
      tcRecorder = new MediaRecorder(stream);
      tcRecorder.ondataavailable = e => { if(e.data.size) tcChunks.push(e.data); };
      tcRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(tcChunks,{type:tcRecorder.mimeType||"audio/webm"});
        const file = new File([blob],"voice-message.webm",{type:blob.type});
        if (!activeConversation) return;
        const fd = new FormData();
        fd.append("file",file);
        fd.append("text","");
        try {
          await api("/api/conversations/"+activeConversation+"/messages",{method:"POST",body:fd});
          $("tcVoiceStatus").textContent = "Səsli mesaj göndərildi";
          openConversation(activeConversation);
        } catch(e) { $("tcVoiceStatus").textContent = e.message; }
      };
      tcRecorder.start();
      tcStart.disabled = true; tcStop.disabled = false;
      $("tcVoiceStatus").textContent = "Səs yazılır...";
    } catch(e) {
      $("tcVoiceStatus").textContent = "Mikrofon icazəsi verilmədi.";
    }
  };
  tcStop.onclick = () => {
    if (tcRecorder && tcRecorder.state !== "inactive") tcRecorder.stop();
    tcStart.disabled = false; tcStop.disabled = true;
  };
}
'''

c += r'''

/* TALKCHAT_UPGRADE_V1 */
.tc-chat-image{max-width:min(240px,70vw);max-height:280px;object-fit:contain;border-radius:14px;display:block}
.tc-reactions{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.tc-reaction{border:1px solid #6540a0;background:#241735;color:#fff;border-radius:14px;padding:4px 8px;cursor:pointer}
.tc-typing{display:block;color:#bda4ed;font-size:12px;min-height:16px}
#tcVoiceStart,#tcVoiceStop{border:0;border-radius:12px;padding:8px;background:#382052;color:white}
#tcVoiceStart:disabled,#tcVoiceStop:disabled{opacity:.45}
#tcVoiceStatus{font-size:11px;color:#c7a9f4}
'''

server.write_text(s)
app.write_text(a)
html.write_text(h)
css.write_text(c)

print("TalkChat yeniləməsi tətbiq edildi.")
print("Backup:", backup)
print("Dəyişən fayllar: server.js, public/app.js, public/index.html, public/style.css")
