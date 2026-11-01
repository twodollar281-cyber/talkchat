from pathlib import Path
from datetime import datetime
import shutil, subprocess, sys

files = ["public/index.html", "public/app.js", "public/style.css", "server.js"]
for f in files:
    if not Path(f).is_file():
        sys.exit("Fayl tapılmadı: " + f)

html, js, css, server = [Path(f).read_text() for f in files]

# Əvvəlcə bütün vacib kod hissələrini yoxla.
checks = [
    ('id="messagesPage"' in html, "Direct bölməsi"),
    ('id="conversationList"' in html, "Söhbət siyahısı"),
    ("async function loadConversations()" in js, "Söhbət funksiyası"),
    ("// TALKCHAT ROOMS FRONTEND" in js, "Rooms JS bloku"),
    ("/* TALKCHAT_PRESENCE_CLIENT_V1 */" in js, "Rooms JS son sərhədi"),
    ('app.get("/api/conversations"' in server, "Söhbət API-si"),
    ('io.on("connection"' in server, "Socket bağlantısı"),
]
for ok, name in checks:
    print(("OK: " if ok else "YOX: ") + name)
if not all(x[0] for x in checks):
    sys.exit("Kod quruluşu uyğun deyil. Fayllara toxunulmadı.")

# Rooms interfeysini Direct səhifəsindən çıxar.
a = html.find('<details class="group-create tc-ig-group" id="talkRoomsPanel">')
b = html.find("</details>", a)
if a < 0 or b < 0:
    sys.exit("Rooms HTML tapılmadı.")
new_html = html[:a] + html[b+len("</details>"):]

# Rooms frontend blokunu çıxar, serverdəki Rooms məlumatları saxlanılır.
a = js.find("// TALKCHAT ROOMS FRONTEND")
b = js.find("/* TALKCHAT_PRESENCE_CLIENT_V1 */", a)
if a < 0 or b < 0:
    sys.exit("Rooms JS sərhədləri tapılmadı.")
new_js = js[:a] + js[b:]

# Son mesajı və vaxtını söhbət API cavabına əlavə et.
old = '''app.get("/api/conversations", requireAuth, (req, res) => {
    const me = currentUser(req);
    res.json(conversations().filter(c => c.participants.includes(me)).map(c => ({
        id: c.id, type: c.type, name: c.type === "group" ? c.name : c.participants.find(x => x !== me),
        participants: c.participants
    })));
});'''
new = '''app.get("/api/conversations", requireAuth, (req, res) => {
    const me = currentUser(req);
    const allMessages = messages();
    res.json(conversations().filter(c => c.participants.includes(me)).map(c => {
        const last = allMessages.filter(m => m.conversationId === c.id).slice(-1)[0] || null;
        return {
            id: c.id, type: c.type,
            name: c.type === "group" ? c.name : c.participants.find(x => x !== me),
            participants: c.participants,
            lastMessage: last ? (last.text || last.attachmentName || "Fayl") : "",
            lastMessageAt: last ? last.createdAt : ""
        };
    }));
});'''
if old not in server:
    sys.exit("Söhbət API kodu uyğun gəlmədi.")
new_server = server.replace(old, new, 1)

# Söhbət siyahısında son mesaj və vaxt.
old = '''      const subtitle = c.type === "group"
        ? "Qrup söhbəti · " + c.participants.length + " iştirakçı"
        : "Şəxsi söhbət";'''
new = '''      const subtitle = c.lastMessage || (c.type === "group"
        ? "Qrup söhbəti · " + c.participants.length + " iştirakçı"
        : "Şəxsi söhbət");
      const lastTime = c.lastMessageAt
        ? new Date(c.lastMessageAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})
        : "";'''
if old not in new_js:
    sys.exit("Söhbət önbaxış kodu tapılmadı.")
new_js = new_js.replace(old, new, 1)

old = ''''<small class="tc-conversation-preview">' + esc(subtitle) + '</small>' +'''
new = ''''<small class="tc-conversation-preview">' + esc(subtitle) + '</small>' +
        '<small class="tc-conversation-time">' + esc(lastTime) + '</small>' +'''
if old not in new_js:
    sys.exit("Söhbət HTML nöqtəsi tapılmadı.")
new_js = new_js.replace(old, new, 1)

# Serverdə zəng siqnallarını yalnız eyni şəxsi söhbətin iştirakçılarına ötür.
anchor = '    socket.on("joinTalkRoom", roomId => {'
call_server = '''
    const validCallTarget = (conversationId, target) => {
      const c = conversations().find(x =>
        x.id === conversationId && x.type !== "group" &&
        x.participants.includes(name) && x.participants.includes(target)
      );
      return !!c && target !== name;
    };
    const relayCall = (event, outgoing) => {
      socket.on(event, data => {
        if (!data || !validCallTarget(data.conversationId, data.to)) return;
        io.to(`user:${data.to}`).emit(outgoing, {
          conversationId: data.conversationId, from: name,
          ...(data.signal ? {signal:data.signal} : {})
        });
      });
    };
    relayCall("call:invite", "call:incoming");
    relayCall("call:accept", "call:accepted");
    relayCall("call:reject", "call:rejected");
    relayCall("call:signal", "call:signal");
    relayCall("call:end", "call:ended");

'''
if anchor not in new_server:
    sys.exit("Socket əlavə etmə nöqtəsi tapılmadı.")
new_server = new_server.replace(anchor, call_server + anchor, 1)

# Zəng pəncərəsi və WebRTC.
call_js = r'''
/* TALKCHAT_AUDIO_CALLS */
(() => {
  let pc=null, local=null, remote=null, peer="", convo="", muted=false;
  const box=document.createElement("section");
  box.id="tcCallBox"; box.className="tc-call-box"; box.hidden=true;
  box.innerHTML=`<div class="tc-call-card">
    <strong id="tcCallTitle">Səsli zəng</strong><p id="tcCallStatus"></p>
    <audio id="tcRemoteAudio" autoplay></audio>
    <div class="tc-call-buttons">
    <button id="tcAccept">Qəbul et</button><button id="tcReject">Rədd et</button>
    <button id="tcMute">Mikrofonu susdur</button>
    <button id="tcScreen">Ekranı paylaş</button><button id="tcHangup">Bitir</button>
    </div></div>`;
  document.body.appendChild(box);
  const el=id=>document.getElementById(id);
  const show=(title,status)=>{box.hidden=false;el("tcCallTitle").textContent=title;el("tcCallStatus").textContent=status;};
  const send=(event,extra={})=>socket.emit(event,{conversationId:convo,to:peer,...extra});
  function clean(){
    if(pc){pc.ontrack=null;pc.onicecandidate=null;pc.close();}
    pc=null;
    if(local)local.getTracks().forEach(t=>t.stop());
    local=null;remote=null;muted=false;box.hidden=true;
  }
  async function setup(){
    pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
    remote=new MediaStream();el("tcRemoteAudio").srcObject=remote;
    pc.ontrack=e=>e.streams[0].getTracks().forEach(t=>remote.addTrack(t));
    pc.onicecandidate=e=>{if(e.candidate)send("call:signal",{signal:{candidate:e.candidate}});};
    local=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    local.getTracks().forEach(t=>pc.addTrack(t,local));
  }
  document.addEventListener("click",e=>{
    if(!e.target.closest('[aria-label="Səsli zəng"]'))return;
    const c=conversationsCache.find(x=>x.id===activeConversation);
    if(!c||c.type==="group"){alert("Zəng yalnız şəxsi söhbətdə mümkündür.");return;}
    convo=c.id;peer=c.name;
    start();
  });
  async function start(){
    if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection){
      alert("Brauzer səsli zəngi dəstəkləmir.");return;
    }
    show(peer,"Zəng edilir...");
    try{
      await setup();send("call:invite");
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      send("call:signal",{signal:{description:pc.localDescription}});
    }catch(e){clean();alert("Zəng baş tutmadı: "+e.message);}
  }
  socket.on("call:incoming",d=>{
    convo=d.conversationId;peer=d.from;show(peer,peer+" səni arıyor!");
    if("Notification"in window){
      if(Notification.permission==="granted")new Notification(peer+" səni arıyor!");
      else if(Notification.permission==="default")Notification.requestPermission();
    }
  });
  el("tcAccept").onclick=async()=>{
    try{await setup();send("call:accept");el("tcCallStatus").textContent="Zəng aktivdir";}
    catch(e){clean();alert("Mikrofon icazəsi alınmadı: "+e.message);}
  };
  el("tcReject").onclick=()=>{send("call:reject");clean();};
  socket.on("call:accepted",()=>el("tcCallStatus").textContent="Zəng aktivdir");
  socket.on("call:rejected",()=>{clean();alert("Zəng rədd edildi.");});
  socket.on("call:signal",async d=>{
    if(d.conversationId!==convo)return;
    try{
      if(!pc)await setup();
      if(d.signal?.description){
        await pc.setRemoteDescription(d.signal.description);
        if(d.signal.description.type==="offer"){
          const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
          send("call:signal",{signal:{description:pc.localDescription}});
          el("tcCallStatus").textContent="Zəng aktivdir";
        }
      }else if(d.signal?.candidate)await pc.addIceCandidate(d.signal.candidate);
    }catch(e){console.error(e);clean();}
  });
  el("tcMute").onclick=()=>{
    if(!local)return;muted=!muted;
    local.getAudioTracks().forEach(t=>t.enabled=!muted);
    el("tcMute").textContent=muted?"Mikrofonu aç":"Mikrofonu susdur";
  };
  el("tcScreen").onclick=async()=>{
    if(!pc||!navigator.mediaDevices?.getDisplayMedia){
      alert("Bu cihaz ekran paylaşımını dəstəkləmir.");return;
    }
    try{
      const stream=await navigator.mediaDevices.getDisplayMedia({video:true});
      const track=stream.getVideoTracks()[0];const sender=pc.addTrack(track,stream);
      track.onended=()=>pc?.removeTrack(sender);
    }catch(e){alert("Ekran paylaşımı alınmadı: "+e.message);}
  };
  el("tcHangup").onclick=()=>{send("call:end");clean();};
  socket.on("call:ended",clean);
})();
'''
if "/* TALKCHAT_AUDIO_CALLS */" not in new_js:
    new_js += "\n" + call_js

new_css = css + r'''
/* TALKCHAT DIRECT UPDATE */
.tc-ig-workspace,.tc-ig-sidebar,.tc-ig-chat{min-height:0}
.tc-ig-sidebar,.tc-ig-conversations{
 overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch
}
.tc-ig-chat-content{min-height:0;display:flex;flex-direction:column}
.tc-ig-chat-header{flex:0 0 auto;position:sticky;top:0;z-index:5}
.tc-ig-messages{min-height:0;flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.tc-ig-compose{flex:0 0 auto;position:sticky;bottom:0;z-index:5}
.tc-conversation-time{margin-left:auto;white-space:nowrap;font-size:11px;opacity:.65}
.bottom-nav{backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-top:1px solid rgba(255,255,255,.1)}
.bottom-nav .nav-item{border:0;border-radius:14px;background:transparent}
.bottom-nav .nav-item.active{background:rgba(145,90,255,.16);color:var(--primary,#a879ff)}
.bottom-nav .nav-item span{display:block;font-size:21px;line-height:1.2}
.tc-call-box{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:18px;background:#000b}
.tc-call-box[hidden]{display:none}
.tc-call-card{width:min(100%,380px);padding:24px;border-radius:22px;background:var(--card,#211b30);color:var(--text,#fff);text-align:center}
.tc-call-buttons{display:flex;flex-wrap:wrap;justify-content:center;gap:9px;margin-top:18px}
.tc-call-buttons button{border:0;border-radius:12px;padding:11px 14px;background:var(--primary,#8054db);color:white}
'''

# Backup və dəyişikliklərin təhlükəsiz tətbiqi.
backup=Path("backups")/("direct-update-"+datetime.now().strftime("%Y%m%d-%H%M%S"))
backup.mkdir(parents=True)
for f in files: shutil.copy2(f,backup/Path(f).name)

contents={
 "public/index.html":new_html,
 "public/app.js":new_js,
 "public/style.css":new_css,
 "server.js":new_server
}
try:
    for f,s in contents.items(): Path(f+".tmp").write_text(s)
    for f in ["public/app.js","server.js"]:
        check_file = f + ".check.js"
        Path(check_file).write_text(Path(f + ".tmp").read_text())
        r=subprocess.run(["node","--check",check_file],capture_output=True,text=True)
        Path(check_file).unlink(missing_ok=True)
        if r.returncode: raise Exception(r.stderr or r.stdout)
    for f,s in contents.items(): Path(f).write_text(s)
    r=subprocess.run(["git","diff","--check"],capture_output=True,text=True)
    if r.returncode and "trailing whitespace" not in (r.stderr + r.stdout): raise Exception(r.stderr or r.stdout)
except Exception as e:
    for f in files: shutil.copy2(backup/Path(f).name,f)
    for f in contents: Path(f+".tmp").unlink(missing_ok=True)
    sys.exit("Xəta oldu, əvvəlki fayllar bərpa edildi:\n"+str(e))

for f in contents: Path(f+".tmp").unlink(missing_ok=True)
print("\nDəyişikliklər tətbiq edildi.")
print("Backup:",backup)
print("GitHub-a göndərilməyib.")
print("Qeyd: STUN zəngləri hər şəbəkədə işləməyə bilər; TURN serveri tələb oluna bilər.")
