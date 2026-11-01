window.addEventListener("error", e => {
  const status = document.getElementById("authStatus");
  if (status) status.textContent = "JAVASCRIPT XƏTASI: " + e.message + " | Sətir: " + e.lineno;
});
const $ = id => document.getElementById(id);
const socket = io();
let me = "";
let scope = "all";
let activeConversation = null;
let conversationsCache = [];

function esc(value="") {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
async function api(url, options={}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Xəta baş verdi.");
  return data;
}
function formDataFile(field, file, extra={}) {
  const fd = new FormData();
  Object.entries(extra).forEach(([k,v]) => fd.append(k,v));
  if (file) fd.append(field,file);
  return fd;
}
function showPage(name) {
  document.querySelectorAll(".page").forEach(p => p.hidden = true);
  const page = $(name + "Page");
  if (page) page.hidden = false;
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === name));
  if (name === "home") loadFeed();
  if (name === "profile") loadMyProfile();
  if (name === "notifications") loadNotifications();
  if (name === "messages") loadConversations();
  if (name === "discover") { $("searchInput").focus(); loadFriendCenter(); }
  if (name === "messages") loadDirectStoryRail();
  if (name === "messages") loadTalkChatExtras();
}
document.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
$("loginTab").onclick = () => setAuthMode("login");
$("registerTab").onclick = () => setAuthMode("register");
let authMode = "login";
function setAuthMode(mode) {
  authMode = mode;
  $("loginTab").classList.toggle("active",mode==="login");
  $("registerTab").classList.toggle("active",mode==="register");
  $("authSubmit").textContent = mode==="login" ? "Daxil ol" : "Hesab yarat";
  $("authPassword").autocomplete = mode==="login" ? "current-password" : "new-password";
  $("authStatus").textContent = "";
}
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("authSubmit").disabled = true;
  try {
    const data = await api("/api/"+(authMode==="login"?"login":"register"), {
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:$("authUsername").value,password:$("authPassword").value})
    });
    me = data.username;
    $("authPassword").value = "";
    enterApp();
  } catch(err) { $("authStatus").textContent = err.message; }
  finally { $("authSubmit").disabled = false; }
});
function enterApp() {
  $("authPage").hidden = true; $("app").hidden = false;
  socket.connect(); showPage("home");
  setTimeout(() => { try { /* registerPush(); */ } catch(e) { console.error(e); } }, 4000);
}

// ---- Push bildirişləri (yalnız Android tətbiqində) ----
window.__pushToken = null;
let __pushStarted = false;
async function sendPushToken(token) {
  try {
    await api("/api/push/register", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({token, lang: currentLang()})});
  } catch(e) { console.error("Push token göndərilmədi:", e.message); }
}
async function registerPush() {
  if (__pushStarted) return;
  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
  const PN = cap.Plugins && cap.Plugins.PushNotifications;
  if (!PN) return;
  __pushStarted = true;
  try {
    PN.addListener("registration", t => { window.__pushToken = t.value; sendPushToken(t.value); });
    PN.addListener("registrationError", e => console.error("Push qeydiyyat xətası:", e));
    const perm = await PN.requestPermissions();
    if (perm.receive !== "granted") return;
    await PN.register();
  } catch(e) { console.error("Push xətası:", e); }
}
async function checkSession() {
  try {
    const d = await api("/api/me");
    me = d.username;
    $("authStatus").textContent = "Sessiya aktivdir: " + me;
    enterApp();
  } catch (err) {
    console.error("SESSION CHECK ERROR:", err);
    $("authPage").hidden = false;
    $("app").hidden = true;
    $("authStatus").textContent = "Sessiya yoxlanmadı: " + err.message;
  }
}
$("logoutButton").onclick = async () => {
  try { await api("/api/logout",{method:"POST"}); } catch {}
  socket.disconnect(); me=""; activeConversation=null;
  $("app").hidden=true; $("authPage").hidden=false;
};
document.querySelectorAll(".feed-tab").forEach(b => b.onclick = () => {
  scope=b.dataset.scope;
  document.querySelectorAll(".feed-tab").forEach(x=>x.classList.toggle("active",x===b));
  loadFeed();
});
function avatarHTML(user,sizeClass="avatar") {
  return user.avatar ? `<img class="${sizeClass}" src="${esc(user.avatar)}" alt="">` : `<span class="avatar-fallback">${esc((user.username||"?")[0].toUpperCase())}</span>`;
}
function postHTML(p) {
  const liked=(p.likes||[]).includes(me);
  const media=p.mediaType==="video" ? `<video class="post-media" src="${esc(p.media)}" controls playsinline></video>` : p.media ? `<img class="post-media" src="${esc(p.media)}" alt="Paylaşım şəkli">` : "";
  const comments=(p.comments||[]).slice(-4).map(c=>`<div><b>@${esc(c.username)}</b> ${esc(c.text)}</div>`).join("");
  return `<article class="post-card" data-post="${esc(p.id)}">
    <div class="post-head"><span class="avatar-fallback">${esc(p.username[0].toUpperCase())}</span><div><div class="post-user">@${esc(p.username)}</div><div class="post-date">${new Date(p.createdAt).toLocaleString("az-AZ")}</div></div></div>
    ${p.text?`<div class="post-text">${esc(p.text)}</div>`:""}${media}
    <div class="post-actions"><button data-like="${esc(p.id)}">${liked?"♥":"♡"} ${p.likes?.length||0} bəyənmə</button><button data-focus-comment="${esc(p.id)}">Şərh (${p.comments?.length||0})</button></div>
    <div class="comment-list">${comments}</div>
    <form class="comment-form" data-comment="${esc(p.id)}"><input name="text" placeholder="Şərh yaz..." maxlength="500" required><button class="primary">Göndər</button></form>
  </article>`;
}
async function loadFeed() {
  try {
    const list=await api("/api/feed?scope="+scope);
    $("feed").innerHTML=list.length?list.map(postHTML).join(""):"<p class='muted'>Hələ paylaşım yoxdur. İlk paylaşımı sən et! 💜</p>";
  } catch(e) { $("feed").textContent=e.message; }
}
$("feed").addEventListener("click",async e=>{
  const like=e.target.closest("[data-like]");
  if(like){try{await api("/api/posts/"+like.dataset.like+"/like",{method:"POST"});loadFeed();}catch(err){alert(err.message);}}
});
$("feed").addEventListener("submit",async e=>{
  const form=e.target.closest("[data-comment]");if(!form)return;e.preventDefault();
  try{await api("/api/posts/"+form.dataset.comment+"/comments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:new FormData(form).get("text")})});loadFeed();}
  catch(err){alert(err.message);}
});
$("postForm").onsubmit=async e=>{
  e.preventDefault();$("postStatus").textContent="Paylaşılır...";
  try{
    const fd=formDataFile("media",$("postMedia").files[0],{text:$("postText").value});
    await api("/api/posts",{method:"POST",body:fd});
    $("postText").value="";$("postMedia").value="";$("postStatus").textContent="Paylaşıldı! 💜";loadFeed();
  }catch(err){$("postStatus").textContent=err.message;}
};
let searchTimer;
$("searchInput").addEventListener("input",()=>{
  clearTimeout(searchTimer);
  searchTimer=setTimeout(async()=>{
    const q=$("searchInput").value.trim();if(!q){$("searchResults").innerHTML="";return;}
    try{
      const list=await api("/api/search?q="+encodeURIComponent(q));
      $("searchResults").innerHTML=list.map(u=>`<div class="user-row">${avatarHTML(u)}<div class="user-info"><b>@${esc(u.username)}</b><small>${esc(u.bio||"TalkChat istifadəçisi")}</small></div><button class="primary" data-open-user="${esc(u.username)}">Profil</button></div>`).join("")||"<p class='muted'>İstifadəçi tapılmadı.</p>";
    }catch(e){$("searchResults").textContent=e.message;}
  },250);
});
$("searchResults").addEventListener("click",e=>{
  const b=e.target.closest("[data-open-user]");if(b)openPublicProfile(b.dataset.openUser);
});
async function loadMyProfile(){
  try{
    const u=await api("/api/profile");
    $("myUsername").textContent="@"+u.username;
    $("myBio").value=u.bio||"";
    $("myStats").textContent=`${u.followersCount} izləyici · ${u.followingCount} izlənilən`;
    $("avatarFallback").textContent=u.username[0].toUpperCase();
    $("myAvatar").src=u.avatar||"";
    $("myAvatar").style.display=u.avatar?"block":"none";
    $("avatarFallback").style.display=u.avatar?"none":"grid";
  }catch(e){$("profileStatus").textContent=e.message;}
}
$("saveBio").onclick=async()=>{
  try{await api("/api/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({bio:$("myBio").value})});$("profileStatus").textContent="Profil yadda saxlanıldı!";}
  catch(e){$("profileStatus").textContent=e.message;}
};
$("avatarFile").onchange=async()=>{
  const file=$("avatarFile").files[0];if(!file)return;
  try{await api("/api/profile/avatar",{method:"POST",body:formDataFile("file",file)});$("profileStatus").textContent="Profil şəkli yeniləndi!";loadMyProfile();}
  catch(e){$("profileStatus").textContent=e.message;}
};
async function openPublicProfile(name){
  try{
    const u=await api("/api/users/"+encodeURIComponent(name));
    const [friendList, friendRequests] = await Promise.all([
      api("/api/friends"),
      api("/api/friend-requests")
    ]);
    const isFriend = friendList.some(x => x.username === u.username);
    const incoming = friendRequests.incoming.some(x => x.username === u.username);
    const outgoing = friendRequests.outgoing.some(x => x.username === u.username);
    $("homePage").hidden=true;$("discoverPage").hidden=true;$("messagesPage").hidden=true;$("notificationsPage").hidden=true;$("profilePage").hidden=true;$("publicProfilePage").hidden=false;
    $("publicProfile").innerHTML=`${avatarHTML(u,"avatar")}<h2>@${esc(u.username)}</h2><p>${esc(u.bio||"")}</p><div class="stats">${u.followersCount} izləyici · ${u.followingCount} izlənilən</div><button class="primary" id="followButton">${u.isFollowing?"İzləmədən çıx":"İzlə"}</button>${u.username===me?"":`<button class="secondary" id="friendButton" ${isFriend||outgoing?"disabled":""}>${isFriend?"Dostsunuz":incoming?"Dostluğu qəbul et":outgoing?"Sorğu göndərilib":"＋ Dostluq əlavə et"}</button>`}`;
    $("friendButton")?.addEventListener("click", async()=>{
      try {
        if(incoming) {
          await api("/api/friends/accept/"+encodeURIComponent(u.username),{method:"POST"});
        } else {
          await api("/api/friends/request/"+encodeURIComponent(u.username),{method:"POST"});
        }
        openPublicProfile(u.username);
      } catch(e) { alert(e.message); }
    });
    $("followButton").onclick=async()=>{
      try{await api("/api/follow/"+encodeURIComponent(name),{method:u.isFollowing?"DELETE":"POST"});openPublicProfile(name);}
      catch(e){alert(e.message);}
    };
    const feed=await api("/api/feed?scope=all");
    $("publicPosts").innerHTML=feed.filter(p=>p.username===name).map(postHTML).join("")||"<p class='muted'>Hələ paylaşım yoxdur.</p>";
  }catch(e){alert(e.message);}
}
$("backFromPublic").onclick=()=>showPage("discover");
async function loadNotifications(){
  try{
    const list=await api("/api/notifications");
    $("notificationList").innerHTML=list.map(n=>`<div class="notification">@${esc(n.from)} ${n.type==="follow"?"səni izləməyə başladı.":n.type==="like"?"paylaşımını bəyəndi.":n.type==="comment"?"paylaşımına şərh yazdı.":"sənə mesaj göndərdi."}</div>`).join("")||"<p class='muted'>Hələ bildiriş yoxdur.</p>";
  }catch(e){$("notificationList").textContent=e.message;}
}

// TALKCHAT_STORIES_V1 UI
async function loadTalkChatExtras() {
  const page = $("messagesPage");
  if (!page) return;
  let root = $("talkChatExtras");
  if (!root) {
    root = document.createElement("section");
    root.id = "talkChatExtras";
    root.className = "tc-extras";
    root.innerHTML = `
      <div class="tc-extra-card">
        <h3>📸 Story paylaş</h3>
        <form id="tcStoryForm">
          <input id="tcStoryFile" type="file" accept="image/*,video/mp4,video/webm" required>
          <input id="tcStoryText" maxlength="250" placeholder="Story haqqında yaz...">
          <button class="primary" type="submit">Paylaş</button>
        </form>
        <div id="tcStories" class="tc-stories"></div>
      </div>
      <div class="tc-extra-card">
        <h3>✉️ Mesaj sorğuları</h3>
        <form id="tcRequestForm">
          <input id="tcRequestUser" placeholder="İstifadəçi adı" required>
          <button class="primary" type="submit">Sorğu göndər</button>
        </form>
        <div id="tcRequests"></div>
      </div>`;
    (document.getElementById("tcExtrasSlot") || page).prepend(root);

    $("tcStoryForm").onsubmit = async e => {
      e.preventDefault();
      const file = $("tcStoryFile").files[0];
      if (!file) return alert("Şəkil və ya video seç.");
      const fd = new FormData();
      fd.append("media", file);
      fd.append("text", $("tcStoryText").value);
      try {
        await api("/api/stories", {method:"POST", body:fd});
        $("tcStoryForm").reset();
        await loadTalkChatExtras();
        alert("Story paylaşıldı! 24 saat sonra silinəcək.");
      } catch(err) { alert(err.message); }
    };

    $("tcRequestForm").onsubmit = async e => {
      e.preventDefault();
      try {
        await api("/api/message-requests", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({username:$("tcRequestUser").value})
        });
        $("tcRequestForm").reset();
        alert("Mesaj sorğusu göndərildi.");
        await loadTalkChatExtras();
      } catch(err) { alert(err.message); }
    };

    root.onclick = async e => {
      const accept = e.target.closest("[data-tc-accept]");
      const reject = e.target.closest("[data-tc-reject]");
      const del = e.target.closest("[data-tc-story-delete]");
      const view = e.target.closest("[data-tc-story-view]");
      try {
        if (accept) {
          const result = await api("/api/message-requests/" + accept.dataset.tcAccept + "/accept", {method:"POST"});
          await loadConversations();
          if (result.conversation) openConversation(result.conversation.id);
          await loadTalkChatExtras();
        }
        if (reject) {
          await api("/api/message-requests/" + reject.dataset.tcReject, {method:"DELETE"});
          await loadTalkChatExtras();
        }
        if (del) {
          await api("/api/stories/" + del.dataset.tcStoryDelete, {method:"DELETE"});
          await loadTalkChatExtras();
        }
        if (view) {
          const item = JSON.parse(decodeURIComponent(view.dataset.tcStoryView));
          let dlg = $("tcStoryDialog");
          if (!dlg) {
            dlg = document.createElement("dialog");
            dlg.id = "tcStoryDialog";
            dlg.className = "tc-story-dialog";
            document.body.appendChild(dlg);
          }
          dlg.innerHTML = `<button class="tc-dialog-close" type="button">✕</button>
            <h3>@${esc(item.username)}</h3>
            ${item.mediaType === "video"
              ? `<video src="${esc(item.media)}" controls autoplay playsinline></video>`
              : `<img src="${esc(item.media)}" alt="Story">`}
            <p>${esc(item.text || "")}</p>
            <small>${item.viewsCount || 0} baxış · 24 saatlıq Story</small>`;
          dlg.querySelector("button").onclick = () => dlg.close();
          dlg.showModal();
        }
      } catch(err) { alert(err.message); }
    };
  }

  try {
    const list = await api("/api/stories");
    $("tcStories").innerHTML = list.map(x => `
      <div class="tc-story">
        <button type="button" class="tc-story-open" data-tc-story-view="${encodeURIComponent(JSON.stringify(x))}">
          <span class="tc-story-ring">${x.mediaType === "video" ? "▶" : "●"}</span>
          <b>@${esc(x.username)}</b>
        </button>
        ${x.mine ? `<button type="button" class="tc-delete-story" data-tc-story-delete="${esc(x.id)}">Sil</button>` : ""}
      </div>`).join("") || "<p class='muted'>Hələ aktiv Story yoxdur.</p>";
  } catch(err) {
    $("tcStories").textContent = err.message;
  }

  try {
    const req = await api("/api/message-requests");
    const incoming = req.incoming.map(x => `
      <div class="tc-request">
        <span>@${esc(x.from)}</span>
        <button type="button" data-tc-accept="${esc(x.id)}">Qəbul et</button>
        <button type="button" data-tc-reject="${esc(x.id)}">Rədd et</button>
      </div>`).join("");
    const outgoing = req.outgoing.map(x => `
      <div class="tc-request"><span>@${esc(x.to)} — gözləyir</span>
        <button type="button" data-tc-reject="${esc(x.id)}">Ləğv et</button>
      </div>`).join("");
    $("tcRequests").innerHTML = incoming + outgoing || "<p class='muted'>Mesaj sorğusu yoxdur.</p>";
  } catch(err) {
    $("tcRequests").textContent = err.message;
  }
}

const languageSelect = $("talkLanguage");
const originalText = new WeakMap();
const translations = {
  tr: {
    "Ana səhifə": "Ana Sayfa",
    "Nələr baş verir?": "Neler oluyor?",
    "Kəşf et": "Keşfet",
    "İzlədiklərim": "Takip ettiklerim",
    "Nə paylaşmaq istəyirsən?": "Ne paylaşmak istiyorsun?",
    "Şəkil / Video": "Fotoğraf / Video",
    "＋ Şəkil / Video": "＋ Fotoğraf / Video",
    "İstifadəçi adı ilə axtar: @aqil": "Kullanıcı adıyla ara: @aqil",
    "İstifadəçi axtar...": "Kullanıcı ara...",
    "İstifadəçi tapılmadı.": "Kullanıcı bulunamadı.",
    "İstifadəçi tapılmadı": "Kullanıcı bulunamadı",
    "Mesajlarda və insanlarda axtar...": "Mesajlarda ve kişilerde ara...",
    "Hekayələr və dostlar": "Hikayeler ve arkadaşlar",
    "Hekayə və mesaj istəkləri": "Hikaye ve mesaj istekleri",
    "Dostların": "Arkadaşların",
    "Dostlar yüklənir...": "Arkadaşlar yükleniyor...",
    "Şəxsi söhbətlərin": "Özel sohbetlerin",
    "Söhbət seç": "Sohbet seç",
    "Mesaj yaz": "Mesaj gönder",
    "Göndər": "Gönder",
    "İstifadəçi adı": "Kullanıcı adı",
    "Yeni söhbət": "Yeni sohbet",
    "Söhbət aç": "Sohbet aç",
    "Qrup yarat": "Grup oluştur",
    "Qrup": "Grup",
    "Qrup söhbəti": "Grup sohbeti",
    "Qrupun adı": "Grup adı",
    "İstifadəçi adları (vergüllə)": "Kullanıcı adları (virgülle)",
    "Bildirişlər": "Bildirimler",
    "Bildiriş": "Bildirim",
    "Axtarış": "Ara",
    "Axtar": "Ara",
    "Mənim profilim": "Profilim",
    "Profil şəklini dəyiş": "Profil fotoğrafını değiştir",
    "Özün haqqında yaz...": "Kendinden bahset...",
    "Profili yadda saxla": "Profili kaydet",
    "Profil yadda saxlanıldı!": "Profil kaydedildi!",
    "Profil şəkli yeniləndi!": "Profil fotoğrafı güncellendi!",
    "Çıxış": "Çıkış",
    "Qeydiyyat": "Kayıt ol",
    "Daxil ol": "Giriş yap",
    "Hesab yarat": "Hesap oluştur",
    "İstifadəçi adı (@ olmadan)": "Kullanıcı adı (@ olmadan)",
    "Şifrə (ən azı 8 simvol)": "Şifre (en az 8 karakter)",
    "Şərh yaz...": "Yorum yaz...",
    "Şərh": "Yorum",
    "İzlə": "Takip et",
    "İzləmədən çıx": "Takibi bırak",
    "Dostluq əlavə et": "Arkadaş ekle",
    "＋ Dostluq əlavə et": "＋ Arkadaş ekle",
    "Dostsunuz": "Arkadaşsınız",
    "Dostluq sorğusu göndərdi": "Arkadaşlık isteği gönderdi",
    "Dostluq sorğuları": "Arkadaşlık istekleri",
    "Qəbul et": "Kabul et",
    "Rədd et": "Reddet",
    "Dostluğu qəbul et": "Arkadaşlığı kabul et",
    "Sorğun gözləyir": "İsteğin bekliyor",
    "Sorğu göndərilib": "İstek gönderildi",
    "Dostun": "Arkadaşın",
    "Gələn sorğu yoxdur.": "Gelen istek yok.",
    "Göndərdiyim sorğular": "Gönderdiğim istekler",
    "Gözləyən sorğun yoxdur.": "Bekleyen isteğin yok.",
    "Dostlarım": "Arkadaşlarım",
    "Hələ dostun yoxdur.": "Henüz arkadaşın yok.",
    "Hələ dostun yoxdur. Dost əlavə etdikcə burada görünəcəklər.": "Henüz arkadaşın yok. Arkadaş ekledikçe burada görünecekler.",
    "Hələ paylaşım yoxdur.": "Henüz gönderi yok.",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et! 💜": "Henüz gönderi yok. İlk gönderiyi sen paylaş! 💜",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et!💜": "Henüz gönderi yok. İlk gönderiyi sen paylaş! 💜",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et! 💜 ": "Henüz gönderi yok. İlk gönderiyi sen paylaş! 💜",
    "Paylaşılır...": "Paylaşılıyor...",
    "Hələ bildiriş yoxdur.": "Henüz bildirim yok.",
    "Hələ söhbət yoxdur.": "Henüz sohbet yok.",
    "Hələ mesaj yoxdur. İlk mesajı sən yaz!": "Henüz mesaj yok. İlk mesajı sen yaz!",
    "Story paylaş": "Hikaye paylaş",
    "Story haqqında yaz...": "Hikaye hakkında yaz...",
    "Story haqqında yazı": "Hikaye açıklaması",
    "Hələ aktiv story yoxdur.": "Henüz aktif hikaye yok.",
    "Hələ aktiv Story yoxdur.": "Henüz aktif hikaye yok.",
    "Şəkil və ya video seç.": "Fotoğraf veya video seç.",
    "Story paylaşıldı! 24 saat sonra silinəcək.": "Hikaye paylaşıldı! 24 saat sonra silinecek.",
    "Hikaye paylaşıldı! 24 saat sonra silinəcək.": "Hikaye paylaşıldı! 24 saat sonra silinecek.",
    "baxış · 24 saatlıq Story": "görüntüleme · 24 saatlık hikaye",
    "Mesaj sorğuları": "Mesaj istekleri",
    "Sorğu göndər": "İstek gönder",
    "Mesaj sorğusu göndərildi.": "Mesaj isteği gönderildi.",
    "Mesaj sorğusu yoxdur.": "Mesaj isteği yok.",
    "Ləğv et": "İptal et",
    "Bağla": "Kapat",
    "Mesaj silinsin?": "Mesaj silinsin mi?",
    "Mətni kopyala": "Metni kopyala",
    "Söhbətlərə qayıt": "Sohbetlere dön",
    "Profilə bax": "Profile bak",
    "Cavabı ləğv et": "Yanıtı iptal et",
    "Şəkil göndər": "Fotoğraf gönder",
    "Fayl göndər": "Dosya gönder",
    "Fayl seç": "Dosya seç",
    "Əvvəlcə söhbət seç.": "Önce bir sohbet seç.",
    "Kimi axtarırsan?": "Kimi arıyorsun?",
    "Yüklənir…": "Yükleniyor…",
    "Mesaj göndərilmədi.": "Mesaj gönderilemedi.",
    "Xəta baş verdi.": "Bir hata oluştu.",
    "Sessiya yoxlanmadı:": "Oturum kontrol edilemedi:",
    "Son görülmə:": "Son görülme:",
    "yazır…": "yazıyor…",
    "Göründü": "Görüldü",
    "Göndərildi": "Gönderildi",
    "Çatdırıldı": "İletildi",
    "indicə": "az önce",
    "Dünən": "Dün",
    "Bu gün": "Bugün",
    "Sən:": "Sen:",
    "iştirakçı": "katılımcı",
    "Şərh yazdı.": "Yorum yazdı.",
    "səni izləməyə başladı.": "seni takip etmeye başladı.",
    "paylaşımını bəyəndi.": "gönderini beğendi.",
    "paylaşımına şərh yazdı.": "gönderine yorum yaptı.",
    "sənə mesaj göndərdi.": "sana mesaj gönderdi.",
    "Səsli zəng": "Sesli arama",
    "Səssiz": "Sessiz",
    "Zəng edilir…": "Aranıyor…",
    "Qoşulur…": "Bağlanıyor…",
    "Zəng bitdi": "Arama bitti",
    "Zəng rədd edildi": "Arama reddedildi",
    "Cavab vermədi": "Yanıt vermedi",
    "Bağlantı kəsildi": "Bağlantı kesildi",
    "Bağlantı zəifdir…": "Bağlantı zayıf…",
    "Bağlantı qurulmadı": "Bağlantı kurulamadı",
    "Artıq zəngdəsən.": "Zaten bir aramadasın.",
    "Zəng yalnız şəxsi söhbətdə mümkündür.": "Arama yalnızca birebir sohbette yapılabilir.",
    "Serverə qoşulu deyilsən. Bir az sonra yenidən yoxla.": "Sunucuya bağlı değilsin. Birazdan tekrar dene.",
    "Mikrofon icazəsi verilmədi. Brauzer ayarlarından mikrofona icazə ver.": "Mikrofon izni verilmedi. Tarayıcı ayarlarından mikrofona izin ver.",
    "Qarşı tərəf mikrofonu bağladı": "Karşı taraf mikrofonu kapattı",
    "Karşı tərəf mikrofonu bağladı": "Karşı taraf mikrofonu kapattı",
    "Paylaşımı dayandır": "Paylaşımı durdur",
    "Səsi aç": "Sesi aç",
    "Bu brauzer səsli zəngi dəstəkləmir.": "Bu tarayıcı sesli aramayı desteklemiyor.",
    "Giriş tələb olunur": "Giriş gerekli",
    "Çox sayda cəhd edildi. Bir az sonra yenidən yoxla.": "Çok fazla deneme yapıldı. Biraz sonra tekrar dene.",
    "Əvvəlcə giriş et.": "Önce giriş yap.",
    "Bu fayl növünə icazə verilmir.": "Bu dosya türüne izin verilmiyor.",
    "Məlumatlar düzgün deyil.": "Bilgiler doğru değil.",
    "İstifadəçi adı 3-20 simvol olmalı, yalnız hərf, rəqəm və _ işlənməlidir.": "Kullanıcı adı 3-20 karakter olmalı, yalnızca harf, rakam ve _ içermelidir.",
    "Şifrə 8-72 simvol arasında olmalıdır.": "Şifre 8-72 karakter arasında olmalıdır.",
    "Bu istifadəçi adı artıq mövcuddur.": "Bu kullanıcı adı zaten var.",
    "Server xətası.": "Sunucu hatası.",
    "İstifadəçi adı və ya şifrə yanlışdır.": "Kullanıcı adı veya şifre yanlış.",
    "Giriş edilməyib.": "Giriş yapılmadı.",
    "Çıxış edildi.": "Çıkış yapıldı.",
    "Bio maksimum 160 simvol ola bilər.": "Biyografi en fazla 160 karakter olabilir.",
    "Profil şəkli üçün şəkil faylı seç.": "Profil fotoğrafı için bir resim dosyası seç.",
    "Özünü izləyə bilməzsən.": "Kendini takip edemezsin.",
    "Çox sorğu göndərdin. Bir az gözlə.": "Çok fazla istek gönderdin. Biraz bekle.",
    "Özünə sorğu göndərə bilməzsən.": "Kendine istek gönderemezsin.",
    "Artıq dostsunuz.": "Zaten arkadaşsınız.",
    "Bu şəxslə artıq gözləyən dostluq sorğusu var.": "Bu kişiyle bekleyen bir arkadaşlık isteği var.",
    "Dostluq sorğusu tapılmadı.": "Arkadaşlık isteği bulunamadı.",
    "Mətn və ya media əlavə et.": "Metin veya medya ekle.",
    "Paylaşım üçün yalnız şəkil və video seç.": "Paylaşım için yalnızca fotoğraf ve video seç.",
    "Paylaşım tapılmadı.": "Gönderi bulunamadı.",
    "Şərh boş ola bilməz.": "Yorum boş olamaz.",
    "Qrup adı və ən azı bir başqa iştirakçı lazımdır.": "Grup adı ve en az bir katılımcı gerekli.",
    "Söhbət tapılmadı.": "Sohbet bulunamadı.",
    "Mesaj boş ola bilməz.": "Mesaj boş olamaz.",
    "Mesaj tapılmadı.": "Mesaj bulunamadı.",
    "Yalnız öz mesajını silə bilərsən.": "Yalnızca kendi mesajını silebilirsin.",
    "Yalnız şəkil və video paylaşmaq olar.": "Yalnızca fotoğraf ve video paylaşılabilir.",
    "Story tapılmadı.": "Hikaye bulunamadı.",
    "Bu Story sənə aid deyil.": "Bu hikaye sana ait değil.",
    "Bu şəxslə artıq söhbətin var.": "Bu kişiyle zaten bir sohbetin var.",
    "Sorğu artıq göndərilib.": "İstek zaten gönderildi.",
    "Mesaj sorğusu tapılmadı.": "Mesaj isteği bulunamadı.",
    "Sorğu tapılmadı.": "İstek bulunamadı.",
    "Fayl çox böyükdür və ya yükləmə xətası baş verdi (maksimum 30 MB).": "Dosya çok büyük veya yükleme hatası oluştu (en fazla 30 MB).",
    "Söhbətə başla": "Sohbete başla",
    "Aktivdir": "Aktif",
    "📷 Şəkil": "📷 Fotoğraf",
    "📸 Story paylaş": "📸 Hikaye paylaş",
    "✉️ Mesaj sorğuları": "✉️ Mesaj istekleri",
    "Sən": "Sen",
    "Şəxsi mesajlaşmaq üçün bir söhbət seç və ya yeni söhbət başlat.": "Özel mesajlaşmak için bir sohbet seç veya yeni sohbet başlat.",
  },
  en: {
    "Ana səhifə": "Home",
    "Nələr baş verir?": "What's happening?",
    "Kəşf et": "Discover",
    "İzlədiklərim": "Following",
    "Nə paylaşmaq istəyirsən?": "What would you like to share?",
    "Şəkil / Video": "Photo / Video",
    "＋ Şəkil / Video": "＋ Photo / Video",
    "Paylaş": "Share",
    "İstifadəçi adı ilə axtar: @aqil": "Search by username: @aqil",
    "İstifadəçi axtar...": "Search users...",
    "İstifadəçi tapılmadı.": "User not found.",
    "İstifadəçi tapılmadı": "User not found",
    "Mesajlar": "Messages",
    "Mesajların": "Your messages",
    "Mesajlarda və insanlarda axtar...": "Search messages and people...",
    "Hekayələr və dostlar": "Stories and friends",
    "Hekayə və mesaj istəkləri": "Stories and message requests",
    "Dostların": "Your friends",
    "Dostlar yüklənir...": "Loading friends...",
    "Şəxsi söhbətlərin": "Your private chats",
    "Söhbət seç": "Select a chat",
    "Sohbet seç": "Select a chat",
    "Mesaj yaz...": "Write a message...",
    "Mesaj yaz": "Send message",
    "Göndər": "Send",
    "Gönder": "Send",
    "İstifadəçi adı": "Username",
    "Yeni söhbət": "New chat",
    "Yeni mesaj": "New message",
    "Söhbət aç": "Start chat",
    "Qrup yarat": "Create group",
    "Qrup": "Group",
    "Qrup söhbəti": "Group chat",
    "Qrupun adı": "Group name",
    "İstifadəçi adları (vergüllə)": "Usernames (comma separated)",
    "Bildirişlər": "Notifications",
    "Bildiriş": "Notifications",
    "Axtarış": "Search",
    "Axtar": "Search",
    "Profil": "Profile",
    "Mənim profilim": "My profile",
    "Profilim": "My profile",
    "Profil şəklini dəyiş": "Change profile photo",
    "Özün haqqında yaz...": "Write about yourself...",
    "Profili yadda saxla": "Save profile",
    "Profil yadda saxlanıldı!": "Profile saved!",
    "Profil şəkli yeniləndi!": "Profile picture updated!",
    "Çıxış": "Log out",
    "Giriş": "Log in",
    "Qeydiyyat": "Sign up",
    "Daxil ol": "Log in",
    "Hesab yarat": "Create account",
    "İstifadəçi adı (@ olmadan)": "Username (without @)",
    "Şifrə (ən azı 8 simvol)": "Password (at least 8 characters)",
    "Şərh yaz...": "Write a comment...",
    "Şərh": "Comment",
    "İzlə": "Follow",
    "İzləmədən çıx": "Unfollow",
    "Dostluq əlavə et": "Add friend",
    "＋ Dostluq əlavə et": "＋ Add friend",
    "Dostsunuz": "Friends",
    "Dostluq sorğusu göndərdi": "Sent a friend request",
    "Dostluq sorğuları": "Friend requests",
    "Qəbul et": "Accept",
    "Rədd et": "Reject",
    "Dostluğu qəbul et": "Accept friendship",
    "Sorğun gözləyir": "Request pending",
    "İsteğin bekliyor": "Request pending",
    "Sorğu göndərilib": "Request sent",
    "Dostun": "Your friend",
    "Sil": "Remove",
    "Gələn sorğu yoxdur.": "No incoming requests.",
    "Göndərdiyim sorğular": "Sent requests",
    "Gözləyən sorğun yoxdur.": "No pending requests.",
    "Dostlarım": "My friends",
    "Hələ dostun yoxdur.": "You have no friends yet.",
    "Hələ dostun yoxdur. Dost əlavə etdikcə burada görünəcəklər.": "No friends yet. Friends will appear here when you add them.",
    "Hələ paylaşım yoxdur.": "No posts yet.",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et! 💜": "No posts yet. Be the first to share! 💜",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et!💜": "No posts yet. Be the first to share! 💜",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et! 💜 ": "No posts yet. Be the first to share! 💜",
    "Paylaşıldı! 💜": "Posted! 💜",
    "Paylaşılır...": "Posting...",
    "Hələ bildiriş yoxdur.": "No notifications yet.",
    "Hələ söhbət yoxdur.": "No conversations yet.",
    "Hələ mesaj yoxdur. İlk mesajı sən yaz!": "No messages yet. Write the first one!",
    "Story paylaş": "Share a story",
    "Hikaye paylaş": "Share a story",
    "Story haqqında yaz...": "Write about your story...",
    "Hikaye hakkında yaz...": "Write about your story...",
    "Story haqqında yazı": "Story caption",
    "Hələ aktiv story yoxdur.": "No active stories yet.",
    "Hələ aktiv Story yoxdur.": "No active stories yet.",
    "Şəkil və ya video seç.": "Choose a photo or video.",
    "Fotoğraf veya video seç.": "Choose a photo or video.",
    "Story paylaşıldı! 24 saat sonra silinəcək.": "Story posted! It will disappear after 24 hours.",
    "Hikaye paylaşıldı! 24 saat sonra silinəcək.": "Story posted! It will disappear after 24 hours.",
    "baxış · 24 saatlıq Story": "views · 24-hour story",
    "Mesaj sorğuları": "Message requests",
    "Sorğu göndər": "Send request",
    "Mesaj sorğusu göndərildi.": "Message request sent.",
    "Mesaj sorğusu yoxdur.": "No message requests.",
    "Ləğv et": "Cancel",
    "Bağla": "Close",
    "Mesajı sil": "Delete message",
    "Mesaj silindi": "Message deleted",
    "Mesaj silinsin?": "Delete this message?",
    "Mətni kopyala": "Copy text",
    "Geri": "Back",
    "← Geri": "← Back",
    "Söhbətlərə qayıt": "Back to chats",
    "Profilə bax": "View profile",
    "Cavabı ləğv et": "Cancel reply",
    "Kamera": "Camera",
    "Şəkil göndər": "Send photo",
    "Fayl göndər": "Send file",
    "Fayl seç": "Choose file",
    "Dosya seç": "Choose file",
    "Önce bir sohbet seç.": "Select a chat first.",
    "Əvvəlcə söhbət seç.": "Select a chat first.",
    "Kimi axtarırsan?": "Who are you looking for?",
    "Kimi arıyorsun?": "Who are you looking for?",
    "Yüklənir…": "Loading…",
    "Mesaj göndərilmədi.": "Message could not be sent.",
    "Xəta baş verdi.": "Something went wrong.",
    "Sessiya yoxlanmadı:": "Session check failed:",
    "Son görülmə:": "Last seen:",
    "yazır…": "typing…",
    "Göründü": "Seen",
    "Göndərildi": "Sent",
    "Çatdırıldı": "Delivered",
    "indicə": "just now",
    "Dünən": "Yesterday",
    "Bu gün": "Today",
    "Sən:": "You:",
    "iştirakçı": "member",
    "Şərh yazdı.": "Commented.",
    "səni izləməyə başladı.": "started following you.",
    "paylaşımını bəyəndi.": "liked your post.",
    "paylaşımına şərh yazdı.": "commented on your post.",
    "sənə mesaj göndərdi.": "sent you a message.",
    "Dil": "Language",
    "Səsli zəng": "Voice call",
    "Səssiz": "Muted",
    "Zəng edilir…": "Calling…",
    "Aranıyor…": "Ringing…",
    "Qoşulur…": "Connecting…",
    "Bağlanıyor…": "Connecting…",
    "Zəng bitdi": "Call ended",
    "Zəng rədd edildi": "Call declined",
    "Cavab vermədi": "No answer",
    "Bağlantı kəsildi": "Connection lost",
    "Bağlantı zəifdir…": "Weak connection…",
    "Bağlantı zayıf…": "Weak connection…",
    "Bağlantı qurulmadı": "Connection failed",
    "Bağlantı kurulamadı": "Connection failed",
    "Bağlantı koptu": "Connection dropped",
    "Artıq zəngdəsən.": "You are already in a call.",
    "Zəng yalnız şəxsi söhbətdə mümkündür.": "Calls are only possible in private chats.",
    "Serverə qoşulu deyilsən. Bir az sonra yenidən yoxla.": "You are not connected to the server. Try again shortly.",
    "Mikrofon icazəsi verilmədi. Brauzer ayarlarından mikrofona icazə ver.": "Microphone permission was denied. Allow the microphone in your browser settings.",
    "Qarşı tərəf mikrofonu bağladı": "The other person muted the microphone",
    "Karşı tərəf mikrofonu bağladı": "The other person muted the microphone",
    "Ekran paylaş": "Share screen",
    "Ekranı paylaş": "Share screen",
    "Paylaşımı dayandır": "Stop sharing",
    "Paylaşımı durdur": "Stop sharing",
    "Səsi aç": "Unmute",
    "Sesi aç": "Unmute",
    "Bu brauzer səsli zəngi dəstəkləmir.": "This browser does not support voice calls.",
    "Ekran paylaşımı başlatılamadı:": "Could not start screen sharing:",
    "Ekran paylaşımı başlamadı:": "Screen sharing did not start:",
    "Ekranını paylaşıyorsun": "You are sharing your screen",
    "Ekranını paylaşırsan": "If you share your screen",
    "Giriş tələb olunur": "Login required",
    "Çox sayda cəhd edildi. Bir az sonra yenidən yoxla.": "Too many attempts. Try again later.",
    "Əvvəlcə giriş et.": "Log in first.",
    "Bu fayl növünə icazə verilmir.": "This file type is not allowed.",
    "Məlumatlar düzgün deyil.": "The information is invalid.",
    "İstifadəçi adı 3-20 simvol olmalı, yalnız hərf, rəqəm və _ işlənməlidir.": "Username must be 3-20 characters and contain only letters, numbers and _.",
    "Şifrə 8-72 simvol arasında olmalıdır.": "Password must be 8-72 characters.",
    "Bu istifadəçi adı artıq mövcuddur.": "This username is already taken.",
    "Server xətası.": "Server error.",
    "İstifadəçi adı və ya şifrə yanlışdır.": "Wrong username or password.",
    "Giriş edilməyib.": "Not logged in.",
    "Çıxış edildi.": "Logged out.",
    "Bio maksimum 160 simvol ola bilər.": "Bio can be at most 160 characters.",
    "Profil şəkli üçün şəkil faylı seç.": "Choose an image file for the profile picture.",
    "Özünü izləyə bilməzsən.": "You cannot follow yourself.",
    "Çox sorğu göndərdin. Bir az gözlə.": "Too many requests. Please wait a moment.",
    "Özünə sorğu göndərə bilməzsən.": "You cannot send a request to yourself.",
    "Artıq dostsunuz.": "You are already friends.",
    "Bu şəxslə artıq gözləyən dostluq sorğusu var.": "A friend request with this person is already pending.",
    "Dostluq sorğusu tapılmadı.": "Friend request not found.",
    "Mətn və ya media əlavə et.": "Add text or media.",
    "Paylaşım üçün yalnız şəkil və video seç.": "Only photos and videos can be shared.",
    "Paylaşım tapılmadı.": "Post not found.",
    "Şərh boş ola bilməz.": "Comment cannot be empty.",
    "Qrup adı və ən azı bir başqa iştirakçı lazımdır.": "A group name and at least one other member are required.",
    "Söhbət tapılmadı.": "Chat not found.",
    "Mesaj boş ola bilməz.": "Message cannot be empty.",
    "Mesaj tapılmadı.": "Message not found.",
    "Yalnız öz mesajını silə bilərsən.": "You can only delete your own messages.",
    "Yalnız şəkil və video paylaşmaq olar.": "Only photos and videos can be shared.",
    "Story tapılmadı.": "Story not found.",
    "Bu Story sənə aid deyil.": "This story is not yours.",
    "Bu şəxslə artıq söhbətin var.": "You already have a chat with this person.",
    "Sorğu artıq göndərilib.": "Request already sent.",
    "Mesaj sorğusu tapılmadı.": "Message request not found.",
    "Sorğu tapılmadı.": "Request not found.",
    "Fayl çox böyükdür və ya yükləmə xətası baş verdi (maksimum 30 MB).": "The file is too large or the upload failed (max 30 MB).",
    "Söhbətə başla": "Start a chat",
    "Mesaj": "Message",
    "Aktivdir": "Active",
    "📷 Şəkil": "📷 Photo",
    "📸 Story paylaş": "📸 Share a story",
    "✉️ Mesaj sorğuları": "✉️ Message requests",
    "Sən": "You",
    "Şəxsi mesajlaşmaq üçün bir söhbət seç və ya yeni söhbət başlat.": "Pick a chat or start a new one to send private messages.",
  },
  ru: {
    "Ana səhifə": "Главная",
    "Nələr baş verir?": "Что нового?",
    "Kəşf et": "Обзор",
    "İzlədiklərim": "Подписки",
    "Nə paylaşmaq istəyirsən?": "Чем хотите поделиться?",
    "Şəkil / Video": "Фото / Видео",
    "＋ Şəkil / Video": "＋ Фото / Видео",
    "Paylaş": "Опубликовать",
    "İstifadəçi adı ilə axtar: @aqil": "Поиск по имени: @aqil",
    "İstifadəçi axtar...": "Поиск пользователей...",
    "İstifadəçi tapılmadı.": "Пользователь не найден.",
    "İstifadəçi tapılmadı": "Пользователь не найден",
    "Mesajlar": "Сообщения",
    "Mesajların": "Ваши сообщения",
    "Mesajlarda və insanlarda axtar...": "Поиск сообщений и людей...",
    "Hekayələr və dostlar": "Истории и друзья",
    "Hekayə və mesaj istəkləri": "Истории и запросы сообщений",
    "Dostların": "Ваши друзья",
    "Dostlar yüklənir...": "Загрузка друзей...",
    "Şəxsi söhbətlərin": "Ваши личные чаты",
    "Söhbət seç": "Выберите чат",
    "Sohbet seç": "Выберите чат",
    "Mesaj yaz...": "Напишите сообщение...",
    "Mesaj yaz": "Написать",
    "Göndər": "Отправить",
    "Gönder": "Отправить",
    "İstifadəçi adı": "Имя пользователя",
    "Yeni söhbət": "Новый чат",
    "Yeni mesaj": "Новое сообщение",
    "Söhbət aç": "Начать чат",
    "Qrup yarat": "Создать группу",
    "Qrup": "Группа",
    "Qrup söhbəti": "Групповой чат",
    "Qrupun adı": "Название группы",
    "İstifadəçi adları (vergüllə)": "Имена пользователей (через запятую)",
    "Bildirişlər": "Уведомления",
    "Bildiriş": "Уведомления",
    "Axtarış": "Поиск",
    "Axtar": "Поиск",
    "Profil": "Профиль",
    "Mənim profilim": "Мой профиль",
    "Profilim": "Мой профиль",
    "Profil şəklini dəyiş": "Сменить фото профиля",
    "Özün haqqında yaz...": "Расскажите о себе...",
    "Profili yadda saxla": "Сохранить профиль",
    "Profil yadda saxlanıldı!": "Профиль сохранён!",
    "Profil şəkli yeniləndi!": "Фото профиля обновлено!",
    "Çıxış": "Выйти",
    "Giriş": "Вход",
    "Qeydiyyat": "Регистрация",
    "Daxil ol": "Войти",
    "Hesab yarat": "Создать аккаунт",
    "İstifadəçi adı (@ olmadan)": "Имя пользователя (без @)",
    "Şifrə (ən azı 8 simvol)": "Пароль (минимум 8 символов)",
    "Şərh yaz...": "Напишите комментарий...",
    "Şərh": "Комментарий",
    "İzlə": "Подписаться",
    "İzləmədən çıx": "Отписаться",
    "Dostluq əlavə et": "Добавить в друзья",
    "＋ Dostluq əlavə et": "＋ Добавить в друзья",
    "Dostsunuz": "Вы друзья",
    "Dostluq sorğusu göndərdi": "Отправил(а) запрос в друзья",
    "Dostluq sorğuları": "Запросы в друзья",
    "Qəbul et": "Принять",
    "Rədd et": "Отклонить",
    "Dostluğu qəbul et": "Принять в друзья",
    "Sorğun gözləyir": "Запрос ожидает ответа",
    "İsteğin bekliyor": "Запрос ожидает ответа",
    "Sorğu göndərilib": "Запрос отправлен",
    "Dostun": "Ваш друг",
    "Sil": "Удалить",
    "Gələn sorğu yoxdur.": "Входящих запросов нет.",
    "Göndərdiyim sorğular": "Отправленные запросы",
    "Gözləyən sorğun yoxdur.": "Ожидающих запросов нет.",
    "Dostlarım": "Мои друзья",
    "Hələ dostun yoxdur.": "Друзей пока нет.",
    "Hələ dostun yoxdur. Dost əlavə etdikcə burada görünəcəklər.": "Друзей пока нет. Они появятся здесь, когда вы их добавите.",
    "Hələ paylaşım yoxdur.": "Публикаций пока нет.",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et! 💜": "Публикаций пока нет. Поделитесь первым! 💜",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et!💜": "Публикаций пока нет. Поделитесь первым! 💜",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et! 💜 ": "Публикаций пока нет. Поделитесь первым! 💜",
    "Paylaşıldı! 💜": "Опубликовано! 💜",
    "Paylaşılır...": "Публикация...",
    "Hələ bildiriş yoxdur.": "Уведомлений пока нет.",
    "Hələ söhbət yoxdur.": "Чатов пока нет.",
    "Hələ mesaj yoxdur. İlk mesajı sən yaz!": "Сообщений пока нет. Напишите первое!",
    "Story paylaş": "Поделиться историей",
    "Hikaye paylaş": "Поделиться историей",
    "Story haqqında yaz...": "Напишите об истории...",
    "Hikaye hakkında yaz...": "Напишите об истории...",
    "Story haqqında yazı": "Подпись к истории",
    "Hələ aktiv story yoxdur.": "Активных историй пока нет.",
    "Hələ aktiv Story yoxdur.": "Активных историй пока нет.",
    "Şəkil və ya video seç.": "Выберите фото или видео.",
    "Fotoğraf veya video seç.": "Выберите фото или видео.",
    "Story paylaşıldı! 24 saat sonra silinəcək.": "История опубликована! Она исчезнет через 24 часа.",
    "Hikaye paylaşıldı! 24 saat sonra silinəcək.": "История опубликована! Она исчезнет через 24 часа.",
    "baxış · 24 saatlıq Story": "просмотры · история на 24 часа",
    "Mesaj sorğuları": "Запросы сообщений",
    "Sorğu göndər": "Отправить запрос",
    "Mesaj sorğusu göndərildi.": "Запрос на сообщение отправлен.",
    "Mesaj sorğusu yoxdur.": "Запросов сообщений нет.",
    "Ləğv et": "Отмена",
    "Bağla": "Закрыть",
    "Mesajı sil": "Удалить сообщение",
    "Mesaj silindi": "Сообщение удалено",
    "Mesaj silinsin?": "Удалить сообщение?",
    "Mətni kopyala": "Копировать текст",
    "Geri": "Назад",
    "← Geri": "← Назад",
    "Söhbətlərə qayıt": "Назад к чатам",
    "Profilə bax": "Открыть профиль",
    "Cavabı ləğv et": "Отменить ответ",
    "Kamera": "Камера",
    "Şəkil göndər": "Отправить фото",
    "Fayl göndər": "Отправить файл",
    "Fayl seç": "Выбрать файл",
    "Dosya seç": "Выбрать файл",
    "Önce bir sohbet seç.": "Сначала выберите чат.",
    "Əvvəlcə söhbət seç.": "Сначала выберите чат.",
    "Kimi axtarırsan?": "Кого вы ищете?",
    "Kimi arıyorsun?": "Кого вы ищете?",
    "Yüklənir…": "Загрузка…",
    "Mesaj göndərilmədi.": "Не удалось отправить сообщение.",
    "Xəta baş verdi.": "Произошла ошибка.",
    "Sessiya yoxlanmadı:": "Не удалось проверить сессию:",
    "Son görülmə:": "Был(а) в сети:",
    "yazır…": "печатает…",
    "Göründü": "Прочитано",
    "Göndərildi": "Отправлено",
    "Çatdırıldı": "Доставлено",
    "indicə": "только что",
    "Dünən": "Вчера",
    "Bu gün": "Сегодня",
    "Sən:": "Вы:",
    "iştirakçı": "участник",
    "Şərh yazdı.": "Прокомментировал(а).",
    "səni izləməyə başladı.": "подписался(-ась) на вас.",
    "paylaşımını bəyəndi.": "оценил(а) вашу публикацию.",
    "paylaşımına şərh yazdı.": "прокомментировал(а) вашу публикацию.",
    "sənə mesaj göndərdi.": "отправил(а) вам сообщение.",
    "Dil": "Язык",
    "Səsli zəng": "Голосовой звонок",
    "Səssiz": "Без звука",
    "Zəng edilir…": "Вызов…",
    "Aranıyor…": "Вызов…",
    "Qoşulur…": "Подключение…",
    "Bağlanıyor…": "Подключение…",
    "Zəng bitdi": "Звонок завершён",
    "Zəng rədd edildi": "Звонок отклонён",
    "Cavab vermədi": "Нет ответа",
    "Bağlantı kəsildi": "Соединение потеряно",
    "Bağlantı zəifdir…": "Слабое соединение…",
    "Bağlantı zayıf…": "Слабое соединение…",
    "Bağlantı qurulmadı": "Не удалось соединиться",
    "Bağlantı kurulamadı": "Не удалось соединиться",
    "Bağlantı koptu": "Соединение прервано",
    "Artıq zəngdəsən.": "Вы уже в звонке.",
    "Zəng yalnız şəxsi söhbətdə mümkündür.": "Звонки возможны только в личных чатах.",
    "Serverə qoşulu deyilsən. Bir az sonra yenidən yoxla.": "Нет подключения к серверу. Попробуйте позже.",
    "Mikrofon icazəsi verilmədi. Brauzer ayarlarından mikrofona icazə ver.": "Нет доступа к микрофону. Разрешите его в настройках браузера.",
    "Qarşı tərəf mikrofonu bağladı": "Собеседник выключил микрофон",
    "Karşı tərəf mikrofonu bağladı": "Собеседник выключил микрофон",
    "Ekran paylaş": "Поделиться экраном",
    "Ekranı paylaş": "Поделиться экраном",
    "Paylaşımı dayandır": "Остановить показ",
    "Paylaşımı durdur": "Остановить показ",
    "Səsi aç": "Включить звук",
    "Sesi aç": "Включить звук",
    "Bu brauzer səsli zəngi dəstəkləmir.": "Этот браузер не поддерживает голосовые звонки.",
    "Ekran paylaşımı başlatılamadı:": "Не удалось начать показ экрана:",
    "Ekran paylaşımı başlamadı:": "Показ экрана не начался:",
    "Ekranını paylaşıyorsun": "Вы показываете экран",
    "Ekranını paylaşırsan": "Если вы поделитесь экраном",
    "Giriş tələb olunur": "Требуется вход",
    "Çox sayda cəhd edildi. Bir az sonra yenidən yoxla.": "Слишком много попыток. Попробуйте позже.",
    "Əvvəlcə giriş et.": "Сначала войдите.",
    "Bu fayl növünə icazə verilmir.": "Этот тип файла не разрешён.",
    "Məlumatlar düzgün deyil.": "Данные неверны.",
    "İstifadəçi adı 3-20 simvol olmalı, yalnız hərf, rəqəm və _ işlənməlidir.": "Имя пользователя: 3–20 символов, только буквы, цифры и _.",
    "Şifrə 8-72 simvol arasında olmalıdır.": "Пароль должен быть от 8 до 72 символов.",
    "Bu istifadəçi adı artıq mövcuddur.": "Это имя пользователя уже занято.",
    "Server xətası.": "Ошибка сервера.",
    "İstifadəçi adı və ya şifrə yanlışdır.": "Неверное имя пользователя или пароль.",
    "Giriş edilməyib.": "Вы не вошли.",
    "Çıxış edildi.": "Вы вышли.",
    "Bio maksimum 160 simvol ola bilər.": "Био может содержать не более 160 символов.",
    "Profil şəkli üçün şəkil faylı seç.": "Выберите файл изображения для фото профиля.",
    "Özünü izləyə bilməzsən.": "Нельзя подписаться на себя.",
    "Çox sorğu göndərdin. Bir az gözlə.": "Слишком много запросов. Подождите немного.",
    "Özünə sorğu göndərə bilməzsən.": "Нельзя отправить запрос самому себе.",
    "Artıq dostsunuz.": "Вы уже друзья.",
    "Bu şəxslə artıq gözləyən dostluq sorğusu var.": "С этим пользователем уже есть ожидающий запрос в друзья.",
    "Dostluq sorğusu tapılmadı.": "Запрос в друзья не найден.",
    "Mətn və ya media əlavə et.": "Добавьте текст или медиа.",
    "Paylaşım üçün yalnız şəkil və video seç.": "Можно загружать только фото и видео.",
    "Paylaşım tapılmadı.": "Публикация не найдена.",
    "Şərh boş ola bilməz.": "Комментарий не может быть пустым.",
    "Qrup adı və ən azı bir başqa iştirakçı lazımdır.": "Нужны название группы и хотя бы один другой участник.",
    "Söhbət tapılmadı.": "Чат не найден.",
    "Mesaj boş ola bilməz.": "Сообщение не может быть пустым.",
    "Mesaj tapılmadı.": "Сообщение не найдено.",
    "Yalnız öz mesajını silə bilərsən.": "Можно удалять только свои сообщения.",
    "Yalnız şəkil və video paylaşmaq olar.": "Можно отправлять только фото и видео.",
    "Story tapılmadı.": "История не найдена.",
    "Bu Story sənə aid deyil.": "Эта история не ваша.",
    "Bu şəxslə artıq söhbətin var.": "У вас уже есть чат с этим пользователем.",
    "Sorğu artıq göndərilib.": "Запрос уже отправлен.",
    "Mesaj sorğusu tapılmadı.": "Запрос сообщения не найден.",
    "Sorğu tapılmadı.": "Запрос не найден.",
    "Fayl çox böyükdür və ya yükləmə xətası baş verdi (maksimum 30 MB).": "Файл слишком большой или произошла ошибка загрузки (максимум 30 МБ).",
    "Söhbətə başla": "Начните чат",
    "Mesaj": "Сообщение",
    "Aktivdir": "В сети",
    "📷 Şəkil": "📷 Фото",
    "📸 Story paylaş": "📸 Поделиться историей",
    "✉️ Mesaj sorğuları": "✉️ Запросы сообщений",
    "Sən": "Вы",
    "Şəxsi mesajlaşmaq üçün bir söhbət seç və ya yeni söhbət başlat.": "Выберите чат или начните новый, чтобы писать личные сообщения.",
  },
  az: {}
};

const TRANSLATE_RULES = [
  [/(\d+) izləyici · (\d+) izlənilən/, {tr:"$1 takipçi · $2 takip", en:"$1 followers · $2 following", ru:"$1 подписчиков · $2 подписок"}],
  [/(\d+) dəq əvvəl/, {tr:"$1 dk önce", en:"$1 min ago", ru:"$1 мин назад"}],
  [/(\d+) saat əvvəl/, {tr:"$1 saat önce", en:"$1 h ago", ru:"$1 ч назад"}],
  [/(\d+) gün əvvəl/, {tr:"$1 gün önce", en:"$1 d ago", ru:"$1 дн. назад"}],
  [/Dostlarım \((\d+)\)/, {tr:"Arkadaşlarım ($1)", en:"My friends ($1)", ru:"Мои друзья ($1)"}],
  [/Şərh \((\d+)\)/, {tr:"Yorum ($1)", en:"Comments ($1)", ru:"Комментарии ($1)"}],
  [/(\d+) bəyənmə/, {tr:"$1 beğeni", en:"$1 likes", ru:"$1 лайков"}],
  [/^Sessiya aktivdir: /, {tr:"Oturum açık: ", en:"Session active: ", ru:"Сессия активна: "}],
  [/^(@\S+) — gözləyir/, {tr:"$1 — bekliyor", en:"$1 — pending", ru:"$1 — ожидает"}],
  [/^Sən: /, {tr:"Sen: ", en:"You: ", ru:"Вы: "}],
  [/^JAVASCRIPT XƏTASI: /, {tr:"JAVASCRIPT HATASI: ", en:"JAVASCRIPT ERROR: ", ru:"ОШИБКА JAVASCRIPT: "}],
  [/ \| Sətir: /, {tr:" | Satır: ", en:" | Line: ", ru:" | Строка: "}],
  [/dostluqdan silinsin\?/, {tr:"arkadaşlıktan çıkarılsın mı?", en:"remove from friends?", ru:"удалить из друзей?"}],
];

function currentLang() {
  try { return localStorage.getItem("talkchat-language") || "tr"; } catch { return "tr"; }
}

// Mətni seçilmiş dilə çevirir: əvvəl tam uyğunluq, sonra say/şablon qaydaları
function translateText(original, lang) {
  if (!lang || lang === "az") return original;
  const dict = translations[lang] || translations.tr;
  const trimmed = original.trim();
  if (!trimmed) return original;
  if (dict[trimmed] !== undefined) return original.replace(trimmed, dict[trimmed]);
  let out = original;
  for (const [re, rep] of TRANSLATE_RULES) {
    if (rep[lang]) out = out.replace(re, rep[lang]);
  }
  return out;
}

function translateElement(root, lang) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    node.nodeValue = translateText(originalText.get(node), lang);
  }
  const attrs = ["placeholder", "aria-label", "title"];
  root.querySelectorAll?.("*").forEach(el => {
    for (const attr of attrs) {
      if (!el.hasAttribute(attr)) continue;
      const key = "data-talk-original-" + attr;
      if (!el.hasAttribute(key)) el.setAttribute(key, el.getAttribute(attr));
      el.setAttribute(attr, translateText(el.getAttribute(key), lang));
    }
  });
}

function applyTalkLanguage(lang) {
  if (!translations[lang]) lang = "tr";
  translateElement(document.body, lang);
  document.documentElement.lang = lang;
  localStorage.setItem("talkchat-language", lang);
  if (languageSelect) languageSelect.value = lang;
  if (window.__pushToken) sendPushToken(window.__pushToken);
}

if (languageSelect) {
  const savedLanguage = currentLang();
  languageSelect.value = savedLanguage;
  languageSelect.addEventListener("change", () => applyTalkLanguage(languageSelect.value));
  applyTalkLanguage(savedLanguage);
}

// Yeni yaradılan mesaj, bildiriş, Story və digər elementləri də tərcümə et.
const talkLanguageObserver = new MutationObserver(records => {
  const lang = currentLang();
  for (const record of records) {
    for (const added of record.addedNodes) {
      if (added.nodeType === Node.ELEMENT_NODE) {
        translateElement(added, lang);
      } else if (added.nodeType === Node.TEXT_NODE) {
        if (!originalText.has(added)) originalText.set(added, added.nodeValue);
        added.nodeValue = translateText(originalText.get(added), lang);
      }
    }
  }
});
talkLanguageObserver.observe(document.body, {childList:true, subtree:true});

// alert və confirm mesajlarını da seçilmiş dilə çevir
const nativeAlert = window.alert.bind(window);
const nativeConfirm = window.confirm.bind(window);
window.alert = msg => nativeAlert(translateText(String(msg), currentLang()));
window.confirm = msg => nativeConfirm(translateText(String(msg), currentLang()));

async function loadFriendCenter() {
  const box = $("friendCenter");
  if (!box) return;

  try {
    const [friends, requests] = await Promise.all([
      api("/api/friends"),
      api("/api/friend-requests")
    ]);

    const incoming = requests.incoming.map(u => `
      <div class="user-row">
        ${avatarHTML(u)}
        <div class="user-info"><b>@${esc(u.username)}</b><small>Dostluq sorğusu göndərdi</small></div>
        <button class="primary" data-friend-accept="${esc(u.username)}">Qəbul et</button>
        <button class="secondary" data-friend-reject="${esc(u.username)}">Rədd et</button>
      </div>`).join("");

    const outgoing = requests.outgoing.map(u => `
      <div class="user-row">
        ${avatarHTML(u)}
        <div class="user-info"><b>@${esc(u.username)}</b><small>Sorğun gözləyir</small></div>
      </div>`).join("");

    const friendRows = friends.map(u => `
      <div class="user-row">
        ${avatarHTML(u)}
        <div class="user-info"><b>@${esc(u.username)}</b><small>Dostun</small></div>
        <button class="secondary" data-friend-remove="${esc(u.username)}">Sil</button>
      </div>`).join("");

    box.innerHTML = `
      <h2>Dostluq sorğuları</h2>
      ${incoming || '<p class="muted">Gələn sorğu yoxdur.</p>'}
      <h2>Göndərdiyim sorğular</h2>
      ${outgoing || '<p class="muted">Gözləyən sorğun yoxdur.</p>'}
      <h2>Dostlarım (${friends.length})</h2>
      ${friendRows || '<p class="muted">Hələ dostun yoxdur.</p>'}`;
  } catch (e) {
    box.textContent = e.message;
  }
}

$("friendCenter").addEventListener("click", async e => {
  const accept = e.target.closest("[data-friend-accept]");
  const reject = e.target.closest("[data-friend-reject]");
  const remove = e.target.closest("[data-friend-remove]");
  const button = accept || reject || remove;
  if (!button) return;

  const name = button.dataset.friendAccept ||
               button.dataset.friendReject ||
               button.dataset.friendRemove;

  try {
    if (accept) {
      await api("/api/friends/accept/" + encodeURIComponent(name), {method:"POST"});
    } else if (reject) {
      await api("/api/friends/reject/" + encodeURIComponent(name), {method:"POST"});
    } else {
      if (!confirm("@" + name + " dostluqdan silinsin?")) return;
      await api("/api/friends/" + encodeURIComponent(name), {method:"DELETE"});
    }
    await loadFriendCenter();
  } catch (err) {
    alert(err.message);
  }
});


async function loadDirectStoryRail() {
  const rail = $("directStoryRail");
  if (!rail) return;
  try {
    const friends = await api("/api/friends");
    rail.innerHTML = friends.length ? friends.map(u => `
      <button class="direct-story-item" data-story-user="${esc(u.username)}">
        <span class="direct-story-ring">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : `<span class="avatar">${esc((u.username||"?")[0].toUpperCase())}</span>`}</span>
        <small>@${esc(u.username)}</small>
      </button>`).join("") :
      '<div class="direct-story-loading">Hələ dostun yoxdur. Dost əlavə etdikcə burada görünəcəklər.</div>';
  } catch (e) {
    rail.textContent = e.message;
  }
}

document.getElementById("directStoryRail")?.addEventListener("click", e => {
  const item = e.target.closest("[data-story-user]");
  if (item) openPublicProfile(item.dataset.storyUser);
});

checkSession();


/* TALKCHAT_PRESENCE_CLIENT_V1 */
const talkchatPresence = new Map();

socket.on("presenceUpdate", data => {
  if (!data || !data.username) return;
  talkchatPresence.set(data.username, data);
  document.querySelectorAll("[data-presence-user]").forEach(el => {
    if (el.dataset.presenceUser === data.username) {
      el.textContent = data.online ? "● Onlayn" : "○ Oflayn";
      el.classList.toggle("online", !!data.online);
    }
  });
});

/* =====================================================================
   TALKCHAT DIRECT — Instagram tipli mesajlaşma
   Söhbət siyahısı, axtarış, cavab, silmə, oxundu/çatdırıldı, aktivlik,
   yazır göstəricisi, şəkil/kamera/fayl göndərmə.
   Socket və səsli zəng (calls.js) ilə uyğun işləyir.
   ===================================================================== */
const IG = { profiles: new Map(), online: new Set(), lastSeen: {}, msgs: [], replyTo: null, pendingFile: null, typers: {}, lastTyping: 0 };
const igEl = id => document.getElementById(id);
const igSvg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const IGI = {
  cam: igSvg('<path d="M3 7h3.5L8.5 4h7l2 3H21v13H3z"/><circle cx="12" cy="13" r="4"/>'),
  img: igSvg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5.5-5.5L7 19"/>'),
  clip: igSvg('<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1L13.9 4.4a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L16 8.2"/>'),
  x: igSvg('<path d="M6 6l12 12M18 6L6 18"/>'),
};

function igAv(name, avatar, small) {
  const init = esc(String(name || "?").charAt(0).toUpperCase());
  return `<span class="ig-av${small ? " sm" : ""}">${avatar ? `<img src="${esc(avatar)}" alt="">` : `<b>${init}</b>`}</span>`;
}
function igIsOnline(name) { return IG.online.has(name); }
function igAgo(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return "indicə";
  if (s < 3600) return Math.floor(s / 60) + " dəq əvvəl";
  if (s < 86400) return Math.floor(s / 3600) + " saat əvvəl";
  return Math.floor(s / 86400) + " gün əvvəl";
}
function igStatus(name) {
  if (igIsOnline(name)) return "Aktivdir";
  const t = IG.lastSeen[name];
  return t ? "Son görülmə: " + igAgo(t) : "";
}
async function igProfile(name) {
  if (!name) return { username: name, avatar: "" };
  if (IG.profiles.has(name)) return IG.profiles.get(name);
  let p;
  try { p = await api("/api/users/" + encodeURIComponent(name)); } catch { p = { username: name, avatar: "" }; }
  IG.profiles.set(name, p);
  return p;
}
function igConv() { return conversationsCache.find(c => c.id === activeConversation) || null; }
function igShort(m) {
  if (!m) return "Mesaj";
  if (m.deleted) return "Mesaj silindi";
  if (m.text) return m.text.length > 60 ? m.text.slice(0, 60) + "…" : m.text;
  if ((m.attachmentType || "").startsWith("image/")) return "📷 Şəkil";
  return "📎 " + (m.attachmentName || "Fayl");
}
function igDayLabel(ts) {
  const d = new Date(ts), now = new Date(), y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Bu gün";
  if (d.toDateString() === y.toDateString()) return "Dünən";
  return d.toLocaleDateString("az-AZ", { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
const igTime = ts => new Date(ts).toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" });

/* ---------- söhbət siyahısı ---------- */
async function loadConversations() {
  try {
    conversationsCache = await api("/api/conversations");
    await Promise.all(conversationsCache.map(c => (c.type === "group" ? null : igProfile(c.name))));
    const pr = await api("/api/presence");
    IG.online = new Set(pr.online || []);
    IG.lastSeen = pr.lastSeen || {};
    igEl("igMe").textContent = "@" + me;
    igRenderList();
    igRenderHead();
  } catch (e) {
    igEl("conversationList").textContent = e.message;
  }
}

function igRenderList() {
  const q = (igEl("dmSearch").value || "").trim().toLowerCase();
  const list = conversationsCache.filter(c => !q || String(c.name || "").toLowerCase().includes(q));
  igEl("conversationList").innerHTML = list.length
    ? list.map(c => {
        const group = c.type === "group";
        const name = group ? (c.name || "Qrup") : (c.name || "");
        const p = group ? null : IG.profiles.get(c.name);
        const on = !group && igIsOnline(c.name);
        const prev = c.lastMessage ? (c.lastFrom === me ? "Sən: " : "") + c.lastMessage : (group ? "Qrup söhbəti" : "Söhbətə başla");
        return `<button type="button" class="ig-item${c.unread ? " unread" : ""}${c.id === activeConversation ? " on" : ""}" data-convo="${esc(c.id)}">
          <span class="ig-avw">${group ? igAv("Q") : igAv(name, p && p.avatar)}${on ? '<i class="ig-dot"></i>' : ""}</span>
          <span class="ig-mid"><span class="ig-name">${esc(name)}</span><span class="ig-prev">${esc(prev)}</span></span>
          ${c.unread ? `<span class="ig-badge">${c.unread > 99 ? "99+" : c.unread}</span>` : ""}
        </button>`;
      }).join("")
    : `<p class="ig-none">${q ? "Nəticə tapılmadı" : "Hələ söhbət yoxdur"}</p>`;
}

/* ---------- söhbət başlığı ---------- */
function igRenderHead() {
  const c = igConv();
  if (!c) return;
  const group = c.type === "group";
  const name = group ? (c.name || "Qrup") : c.name;
  const p = group ? null : IG.profiles.get(c.name);
  igEl("chatTitle").textContent = name;
  igEl("chatAv").innerHTML = group ? igAv("Q") : igAv(name, p && p.avatar, true);
  const typing = IG.typers[c.id] && Date.now() < IG.typers[c.id];
  const sub = typing ? "yazır…" : group ? c.participants.length + " iştirakçı" : igStatus(c.name);
  igEl("chatSub").textContent = sub;
  igEl("chatSub").classList.toggle("on", !typing && !group && igIsOnline(c.name));
}

/* ---------- mesajlar ---------- */
async function igLoadMessages(markRead) {
  const id = activeConversation;
  if (!id) return;
  try {
    const list = await api("/api/conversations/" + id + "/messages");
    if (id !== activeConversation) return;
    IG.msgs = list;
    igRenderMsgs();
    if (markRead) {
      await api("/api/conversations/" + id + "/read", { method: "POST" }).catch(() => {});
      loadConversations();
    }
  } catch (e) {
    igEl("chatMessages").textContent = e.message;
  }
}

function igReceipt(m, c) {
  const seenAt = c.reads && c.reads[c.name];
  if (seenAt && new Date(seenAt) >= new Date(m.createdAt)) return "Göründü";
  return m.deliveredAt ? "Çatdırıldı" : "Göndərildi";
}

function igBubble(m, byId) {
  if (m.deleted) return '<span class="ig-bub del"><i class="ig-del">Mesaj silindi</i></span>';
  let quote = "";
  if (m.replyTo) {
    const r = byId.get(m.replyTo);
    quote = `<span class="ig-quote"><b>${esc(r ? (r.from === me ? "Sən" : "@" + r.from) : "Mesaj")}</b>${esc(igShort(r))}</span>`;
  }
  const isImg = (m.attachmentType || "").startsWith("image/");
  let body = "";
  if (m.attachment) {
    body += isImg
      ? `<a href="${esc(m.attachment)}" target="_blank" rel="noopener"><img src="${esc(m.attachment)}" alt="Şəkil" loading="lazy"></a>`
      : `<a class="ig-file" href="${esc(m.attachment)}" target="_blank" rel="noopener">📎 ${esc(m.attachmentName || "Fayl")}</a>`;
  }
  if (m.text) body += `<span class="ig-t">${esc(m.text)}</span>`;
  const cls = m.attachment && isImg && !m.text ? " img" : "";
  return `<span class="ig-bub${cls}">${quote}${body}</span>`;
}

function igRenderMsgs() {
  const box = igEl("chatMessages");
  const c = igConv();
  if (!c) { box.innerHTML = ""; return; }
  const list = IG.msgs;
  const byId = new Map(list.map(m => [m.id, m]));
  const mineList = list.filter(m => m.from === me);
  const lastMine = mineList[mineList.length - 1];
  let html = "", lastDay = "", prev = null;
  for (const m of list) {
    const day = new Date(m.createdAt).toDateString();
    if (day !== lastDay) {
      html += `<div class="ig-day">${igDayLabel(m.createdAt)} · ${igTime(m.createdAt)}</div>`;
      lastDay = day; prev = null;
    } else if (prev && new Date(m.createdAt) - new Date(prev.createdAt) > 3600000) {
      html += `<div class="ig-day">${igTime(m.createdAt)}</div>`;
      prev = null;
    }
    const mineMsg = m.from === me;
    const cont = prev && prev.from === m.from && new Date(m.createdAt) - new Date(prev.createdAt) < 300000;
    html += `<div class="ig-row${mineMsg ? " me" : ""}${cont ? " cont" : ""}" data-mid="${esc(m.id)}">${igBubble(m, byId)}</div>`;
    if (mineMsg && lastMine && m.id === lastMine.id && c.type !== "group") html += `<div class="ig-rcpt">${igReceipt(m, c)}</div>`;
    prev = m;
  }
  box.innerHTML = html || '<p class="ig-none">Hələ mesaj yoxdur. İlk mesajı sən yaz!</p>';
  box.scrollTop = box.scrollHeight;
  box.querySelectorAll("img").forEach(img => img.addEventListener("load", () => (box.scrollTop = box.scrollHeight), { once: true }));
}

async function openConversation(id) {
  activeConversation = id;
  IG.replyTo = null;
  IG.pendingFile = null;
  igRenderReply();
  igRenderPending();
  igEl("messagesPage").classList.add("tc-chat-open");
  igRenderHead();
  igRenderList();
  igEl("chatMessages").innerHTML = '<p class="ig-none">Yüklənir…</p>';
  await igLoadMessages(true);
  igRenderList();
}

function igRenderReply() {
  const r = IG.replyTo;
  igEl("igReply").hidden = !r;
  if (r) igEl("igReplyText").innerHTML = `<b>${esc(r.from === me ? "Özünə" : "@" + r.from)}</b> ${esc(igShort(r))}`;
}
function igRenderPending() {
  const f = IG.pendingFile;
  igEl("igPending").hidden = !f;
  if (f) igEl("igPending").innerHTML = `<span>📎 ${esc(f.name)}</span><button type="button" id="igPendingX" class="ig-hbtn" aria-label="Sil">${IGI.x}</button>`;
}

/* ---------- mesaj menyusu (bubble-a toxunduqda) ---------- */
function igOpenSheet(mid) {
  const m = IG.msgs.find(x => x.id === mid);
  if (!m) return;
  const acts = [["reply", "Cavab ver"]];
  if (m.text) acts.push(["copy", "Mətni kopyala"]);
  if (m.from === me) acts.push(["del", "Mesajı sil", "danger"]);
  igEl("igSheetBody").innerHTML =
    acts.map(([a, t, k]) => `<button type="button" class="ig-sheet-btn${k ? " danger" : ""}" data-a="${a}" data-mid="${esc(m.id)}">${t}</button>`).join("") +
    '<button type="button" class="ig-sheet-btn cancel" data-a="close">Bağla</button>';
  igEl("igSheet").hidden = false;
}

/* ---------- göndərmə ---------- */
async function igSendTo(text) {
  const fd = new FormData();
  fd.append("text", text);
  if (IG.replyTo) fd.append("replyTo", IG.replyTo.id);
  if (IG.pendingFile) fd.append("file", IG.pendingFile);
  return api("/api/conversations/" + activeConversation + "/messages", { method: "POST", body: fd });
}

async function igStartWith(username) {
  const c = await api("/api/conversations/direct", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
  igEl("dmSearch").value = "";
  igEl("dmSearchResults").innerHTML = "";
  await loadConversations();
  await openConversation(c.id);
}

/* ---------- hadisələr ---------- */
(function igBind() {
  igEl("conversationList").addEventListener("click", e => {
    const b = e.target.closest("[data-convo]");
    if (b) openConversation(b.dataset.convo);
  });

  igEl("chatMessages").addEventListener("click", e => {
    if (e.target.closest("a")) return;
    const row = e.target.closest("[data-mid]");
    if (row) igOpenSheet(row.dataset.mid);
  });

  igEl("igSheet").addEventListener("click", async e => {
    if (e.target.id === "igSheet") { igEl("igSheet").hidden = true; return; }
    const b = e.target.closest("[data-a]");
    if (!b) return;
    igEl("igSheet").hidden = true;
    const a = b.dataset.a;
    if (a === "close") return;
    const m = IG.msgs.find(x => x.id === b.dataset.mid);
    if (!m) return;
    if (a === "reply") { IG.replyTo = m; igRenderReply(); igEl("dmText").focus(); }
    if (a === "copy") { try { await navigator.clipboard.writeText(m.text); } catch { alert(m.text); } }
    if (a === "del") {
      if (!confirm("Mesaj silinsin?")) return;
      try {
        await api("/api/conversations/" + activeConversation + "/messages/" + m.id, { method: "DELETE" });
        await igLoadMessages(false);
        loadConversations();
      } catch (err) { alert(err.message); }
    }
  });

  igEl("igReplyX").onclick = () => { IG.replyTo = null; igRenderReply(); };
  igEl("igPending").addEventListener("click", e => {
    if (e.target.closest("#igPendingX")) { IG.pendingFile = null; igRenderPending(); }
  });
  igEl("tcMobileBack").onclick = () => {
    igEl("messagesPage").classList.remove("tc-chat-open");
    activeConversation = null;
    igRenderList();
  };
  igEl("igInfo").onclick = () => {
    const c = igConv();
    if (c && c.type !== "group") openPublicProfile(c.name);
  };

  igEl("igNewBtn").onclick = igEl("igEmptyNew").onclick = () => {
    const p = igEl("igNewChat");
    p.hidden = !p.hidden;
    if (!p.hidden) igEl("dmUsername").focus();
  };
  igEl("startDM").onclick = async () => {
    const u = igEl("dmUsername").value.trim().replace(/^@/, "");
    if (!u) return;
    try {
      await igStartWith(u);
      igEl("dmUsername").value = "";
      igEl("igNewChat").hidden = true;
    } catch (e) { alert(e.message); }
  };
  igEl("createGroup").onclick = async () => {
    try {
      const usernames = igEl("groupMembers").value.split(",").map(x => x.trim()).filter(Boolean);
      const c = await api("/api/conversations/group", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: igEl("groupName").value, usernames }) });
      igEl("groupName").value = "";
      igEl("groupMembers").value = "";
      igEl("igNewChat").hidden = true;
      await loadConversations();
      await openConversation(c.id);
    } catch (e) { alert(e.message); }
  };

  let searchT;
  igEl("dmSearch").addEventListener("input", () => {
    igRenderList();
    clearTimeout(searchT);
    const q = igEl("dmSearch").value.trim();
    if (!q) { igEl("dmSearchResults").innerHTML = ""; return; }
    searchT = setTimeout(async () => {
      try {
        const found = await api("/api/search?q=" + encodeURIComponent(q));
        igEl("dmSearchResults").innerHTML = found.filter(u => u.username !== me).map(u =>
          `<button type="button" class="ig-res" data-start="${esc(u.username)}">${igAv(u.username, u.avatar)}<span class="ig-mid"><span class="ig-name">${esc(u.username)}</span><span class="ig-prev">${esc(u.bio || "TalkChat istifadəçisi")}</span></span></button>`
        ).join("") || '<p class="ig-none">İstifadəçi tapılmadı</p>';
      } catch (e) { igEl("dmSearchResults").textContent = e.message; }
    }, 250);
  });
  igEl("dmSearchResults").addEventListener("click", async e => {
    const b = e.target.closest("[data-start]");
    if (!b) return;
    try { await igStartWith(b.dataset.start); } catch (err) { alert(err.message); }
  });

  igEl("dmForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!activeConversation) return alert("Əvvəlcə söhbət seç.");
    const text = igEl("dmText").value.trim();
    if (!text && !IG.pendingFile) return;
    const btn = igEl("dmSend");
    btn.disabled = true;
    try {
      await igSendTo(text);
      igEl("dmText").value = "";
      IG.replyTo = null;
      IG.pendingFile = null;
      igRenderReply();
      igRenderPending();
      await igLoadMessages(false);
      loadConversations();
    } catch (err) {
      alert(err.message || "Mesaj göndərilmədi.");
    } finally {
      btn.disabled = false;
    }
  });

  igEl("dmText").addEventListener("input", () => {
    if (!activeConversation || Date.now() - IG.lastTyping < 2000) return;
    IG.lastTyping = Date.now();
    socket.emit("typing", { conversationId: activeConversation });
  });

  ["dmCamera", "dmImage", "dmFile"].forEach(id => igEl(id).addEventListener("change", e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (!activeConversation) return alert("Əvvəlcə söhbət seç.");
    IG.pendingFile = f;
    igRenderPending();
  }));

  // Socket hadisələri
  socket.on("newMessage", d => {
    if (!d) return;
    loadConversations();
    if (d.conversationId === activeConversation) igLoadMessages(true);
  });
  socket.on("messagesChanged", async d => {
    await loadConversations();
    if (!d || !d.conversationId || d.conversationId === activeConversation) igLoadMessages(false);
  });
  socket.on("typing", d => {
    if (!d || !d.conversationId) return;
    IG.typers[d.conversationId] = Date.now() + 2500;
    igRenderHead();
    setTimeout(igRenderHead, 2600);
  });
  socket.on("presenceUpdate", d => {
    if (!d || !d.username) return;
    if (d.online) IG.online.add(d.username);
    else {
      IG.online.delete(d.username);
      if (d.lastSeen) IG.lastSeen[d.username] = d.lastSeen;
    }
    igRenderList();
    igRenderHead();
  });
})();
