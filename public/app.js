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
}
async function checkSession() {
  try { const d = await api("/api/me"); me=d.username; enterApp(); }
  catch { $("authPage").hidden=false; $("app").hidden=true; }
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
    page.prepend(root);

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

async function loadConversations(){
  try{
    conversationsCache = await api("/api/conversations");

    const profiles = await Promise.all(conversationsCache.map(async c => {
      if(c.type === "group") return null;
      try {
        return await api("/api/users/" + encodeURIComponent(c.name));
      } catch {
        return { username: c.name, avatar: "" };
      }
    }));

    $("conversationList").innerHTML = conversationsCache.map((c, i) => {
      const user = profiles[i];
      const name = c.type === "group" ? (c.name || "Qrup") : (user?.username || c.name || "İstifadəçi");
      const avatar = c.type === "group"
        ? '<div class="tc-avatar-fallback">👥</div>'
        : user?.avatar
          ? '<img class="tc-conversation-avatar" src="' + esc(user.avatar) + '" alt="">'
          : '<div class="tc-avatar-fallback">' + esc(name.charAt(0).toUpperCase()) + '</div>';

      const subtitle = c.type === "group"
        ? "Qrup söhbəti · " + c.participants.length + " iştirakçı"
        : "Şəxsi söhbət";

      return '<button class="conversation-item tc-conversation-item ' +
        (activeConversation === c.id ? "active" : "") +
        '" data-convo="' + esc(c.id) + '">' +
        avatar +
        '<span class="tc-conversation-info">' +
        '<b class="tc-conversation-name">' + esc(name) + '</b>' +
        '<small class="tc-conversation-preview">' + esc(subtitle) + '</small>' +
        '</span></button>';
    }).join("") || "<p class='muted'>Hələ söhbət yoxdur.</p>";
  }catch(e){$("conversationList").textContent=e.message;}
}
$("conversationList").onclick=e=>{
  const b=e.target.closest("[data-convo]");if(b)openConversation(b.dataset.convo);
};
async function openConversation(id){
  activeConversation=id;const c=conversationsCache.find(x=>x.id===id);
  $("chatTitle").textContent=c?.name||"Söhbət";
  $("messagesPage").classList.add("tc-chat-open");
  const chatHeader = $("chatTitle").parentElement;
  if (chatHeader && !document.getElementById("tcMobileBack")) {
    const back = document.createElement("button");
    back.id = "tcMobileBack";
    back.className = "tc-mobile-back";
    back.type = "button";
    back.textContent = "‹";
    back.setAttribute("aria-label", "Söhbətlərə qayıt");
    back.onclick = () => $("messagesPage").classList.remove("tc-chat-open");
    chatHeader.prepend(back);
  }
  try{
    const list=await api("/api/conversations/"+id+"/messages");
    $("chatMessages").innerHTML=list.map(messageHTML).join("");
    $("chatMessages").scrollTop=$("chatMessages").scrollHeight;
    loadConversations();
  }catch(e){$("chatMessages").textContent=e.message;}
}
function messageHTML(m){
  const attachment=m.attachment?`<p><a href="${esc(m.attachment)}" target="_blank" rel="noopener">📎 ${esc(m.attachmentName||"Faylı aç")}</a></p>`:"";
  return `<div class="chat-bubble ${m.from===me?"mine":""}"><b>@${esc(m.from)}</b><div>${esc(m.text||"")}</div>${attachment}<small>${new Date(m.createdAt).toLocaleTimeString("az-AZ")}</small></div>`;
}


// TALKCHAT_DIRECT_CLICK_FIX
document.addEventListener("click", async function(e) {
  const btn = e.target.closest("button[data-direct-user]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  if (btn.dataset.busy === "1") return;
  btn.dataset.busy = "1";

  try {
    const c = await api("/api/conversations/direct", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({username: btn.dataset.directUser})
    });
    if (!c || !c.id) throw new Error("Söhbət yaradıla bilmədi.");
    directSearch.value = "";
    directResults.innerHTML = "";
    await loadConversations();
    await openConversation(c.id);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.dataset.busy = "0";
  }
}, true);


// TALKCHAT_DM_SUBMIT_CAPTURE_V1
document.addEventListener("submit", async function(e) {
  const form = e.target;
  if (!form || form.id !== "dmForm") return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  if (form.dataset.sending === "1") return;

  const conversationId = activeConversation;
  if (!conversationId) {
    alert("Əvvəlcə söhbət seç.");
    return;
  }

  const text = $("dmText").value;
  const file = $("dmFile").files[0];

  if (!text.trim() && !file) return;

  form.dataset.sending = "1";
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  try {
    const fd = new FormData();
    fd.append("text", text);
    if (file) fd.append("file", file);

    await api("/api/conversations/" + conversationId + "/messages", {
      method: "POST",
      body: fd
    });

    $("dmText").value = "";
    $("dmFile").value = "";
    await openConversation(conversationId);
  } catch (err) {
    alert(err.message || "Mesaj göndərilmədi.");
  } finally {
    form.dataset.sending = "0";
    if (button) button.disabled = false;
  }
}, true);

// TALKCHAT_DIRECT_LANGUAGE_V3
const directSearch = $("dmSearch");
const directResults = $("dmSearchResults");

if (directSearch && directResults) {
  directSearch.addEventListener("input", async () => {
    const q = directSearch.value.trim();
    if (q.length < 1) {
      directResults.innerHTML = "";
      return;
    }
    try {
      const found = await api("/api/search?q=" + encodeURIComponent(q));
      directResults.innerHTML = found
        .filter(u => u.username !== me)
        .map(u => `
          <div class="user-row">
            ${avatarHTML(u)}
            <div class="user-info"><b>@${esc(u.username)}</b></div>
            <button type="button" class="primary" data-direct-user="${esc(u.username)}">Mesaj yaz</button>
          </div>`).join("") || '<p class="muted">İstifadəçi tapılmadı.</p>';
    } catch (e) {
      directResults.textContent = e.message;
    }
  });

  directResults.addEventListener("click", async e => {
    const btn = e.target.closest("[data-direct-user]");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    try {
      const c = await api("/api/conversations/direct", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({username: btn.dataset.directUser})
      });

      directSearch.value = "";
      directResults.innerHTML = "";
      await loadConversations();
      openConversation(c.id);
    } catch (e) {
      alert(e.message);
    }
  });
}

const languageSelect = $("talkLanguage");
const originalText = new WeakMap();
const translations = {
  tr: {
    "Ana səhifə":"Ana Sayfa", "Nələr baş verir?":"Neler oluyor?",
    "Kəşf et":"Keşfet", "İzlədiklərim":"Takip ettiklerim",
    "Nə paylaşmaq istəyirsən?":"Ne paylaşmak istiyorsun?",
    "Şəkil / Video":"Fotoğraf / Video", "Paylaş":"Paylaş",
    "İstifadəçi adı ilə axtar: @aqil":"Kullanıcı adıyla ara: @aqil",
    "İstifadəçi axtar...":"Kullanıcı ara...",
    "İstifadəçi tapılmadı.":"Kullanıcı bulunamadı.",
    "Mesajlar":"Mesajlar", "TalkChat Direct":"TalkChat Direct",
    "Mesajlarda və insanlarda axtar...":"Mesajlarda ve kişilerde ara...",
    "Hekayələr və dostlar":"Hikayeler ve arkadaşlar",
    "Dostların":"Arkadaşların", "Dostlar yüklənir...":"Arkadaşlar yükleniyor...",
    "Şəxsi söhbətlərin":"Özel sohbetlerin",
    "Söhbət seç":"Sohbet seç", "Mesaj yaz...":"Mesaj yaz...",
    "Göndər":"Gönder", "İstifadəçi adı":"Kullanıcı adı",
    "Yeni söhbət":"Yeni sohbet", "Qrup yarat":"Grup oluştur",
    "Qrupun adı":"Grup adı",
    "İstifadəçi adları (vergüllə)":"Kullanıcı adları (virgülle)",
    "Bildirişlər":"Bildirimler", "Mənim profilim":"Profilim",
    "Profil şəklini dəyiş":"Profil fotoğrafını değiştir",
    "Özün haqqında yaz...":"Kendinden bahset...",
    "Profili yadda saxla":"Profili kaydet", "Çıxış":"Çıkış",
    "Giriş":"Giriş", "Qeydiyyat":"Kayıt ol",
    "Daxil ol":"Giriş yap", "Hesab yarat":"Hesap oluştur",
    "İstifadəçi adı (@ olmadan)":"Kullanıcı adı (@ olmadan)",
    "Şifrə (ən azı 8 simvol)":"Şifre (en az 8 karakter)",
    "Şərh yaz...":"Yorum yaz...", "Şərh":"Yorum",
    "İzlə":"Takip et", "İzləmədən çıx":"Takibi bırak",
    "Dostluq əlavə et":"Arkadaş ekle", "Dostsunuz":"Arkadaşsınız",
    "Dostluq sorğusu göndərdi":"Arkadaşlık isteği gönderdi",
    "Qəbul et":"Kabul et", "Rədd et":"Reddet",
    "Sorğun gözləyir":"İsteğin bekliyor", "Dostun":"Arkadaşın",
    "Sil":"Sil", "Dostluq sorğuları":"Arkadaşlık istekleri",
    "Gələn sorğu yoxdur.":"Gelen istek yok.",
    "Göndərdiyim sorğular":"Gönderdiğim istekler",
    "Gözləyən sorğun yoxdur.":"Bekleyen isteğin yok.",
    "Dostlarım":"Arkadaşlarım", "Hələ dostun yoxdur.":"Henüz arkadaşın yok.",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et! 💜":"Henüz gönderi yok. İlk gönderiyi sen paylaş! 💜",
    "Hələ paylaşım yoxdur.":"Henüz gönderi yok.",
    "Paylaşıldı! 💜":"Paylaşıldı! 💜",
    "Profil yadda saxlanıldı!":"Profil kaydedildi!",
    "Profil şəkli yeniləndi!":"Profil fotoğrafı güncellendi!",
    "Axtarış":"Ara", "Bildiriş":"Bildirim",
    "Hələ bildiriş yoxdur.":"Henüz bildirim yok.",
    "Hələ söhbət yoxdur.":"Henüz sohbet yok.",
    "Story paylaş":"Hikaye paylaş", "Story haqqında yaz...":"Hikaye hakkında yaz...",
    "Şəkil və ya video seç.":"Fotoğraf veya video seç.",
    "Story paylaşıldı! 24 saat sonra silinəcək.":"Hikaye paylaşıldı! 24 saat sonra silinecek.",
    "Mesaj sorğuları":"Mesaj istekleri", "Sorğu göndər":"İstek gönder",
    "Mesaj sorğusu göndərildi.":"Mesaj isteği gönderildi.",
    "Mesaj sorğusu yoxdur.":"Mesaj isteği yok.",
    "Rədd et":"Reddet", "Ləğv et":"İptal et",
    "Hələ dostun yoxdur. Dost əlavə etdikcə burada görünəcəklər.":"Henüz arkadaşın yok. Arkadaş ekledikçe burada görünecekler.",
    "baxış · 24 saatlıq Story":"görüntüleme · 24 saatlik hikaye",
    "səni izləməyə başladı.":"seni takip etmeye başladı.",
    "paylaşımını bəyəndi.":"gönderini beğendi.",
    "paylaşımına şərh yazdı.":"gönderine yorum yaptı.",
    "sənə mesaj göndərdi.":"sana mesaj gönderdi.",
    "Əvvəlcə söhbət seç.":"Önce bir sohbet seç.",
    "Kimi axtarırsan?":"Kimi arıyorsun?",
    "Mesaj yaz":"Mesaj gönder", "Geri":"Geri"
  },
  en: {
    "Ana səhifə":"Home", "Nələr baş verir?":"What's happening?",
    "Kəşf et":"Discover", "İzlədiklərim":"Following",
    "Nə paylaşmaq istəyirsən?":"What would you like to share?",
    "Şəkil / Video":"Photo / Video", "Paylaş":"Share",
    "İstifadəçi adı ilə axtar: @aqil":"Search by username: @aqil",
    "İstifadəçi axtar...":"Search users...",
    "İstifadəçi tapılmadı.":"User not found.",
    "Mesajlar":"Messages", "TalkChat Direct":"TalkChat Direct",
    "Mesajlarda və insanlarda axtar...":"Search messages and people...",
    "Hekayələr və dostlar":"Stories and friends",
    "Dostların":"Your friends", "Dostlar yüklənir...":"Loading friends...",
    "Şəxsi söhbətlərin":"Your private chats",
    "Söhbət seç":"Select a chat", "Mesaj yaz...":"Write a message...",
    "Göndər":"Send", "İstifadəçi adı":"Username",
    "Yeni söhbət":"New chat", "Qrup yarat":"Create group",
    "Qrupun adı":"Group name",
    "İstifadəçi adları (vergüllə)":"Usernames (comma-separated)",
    "Bildirişlər":"Notifications", "Mənim profilim":"My profile",
    "Profil şəklini dəyiş":"Change profile picture",
    "Özün haqqında yaz...":"Write about yourself...",
    "Profili yadda saxla":"Save profile", "Çıxış":"Log out",
    "Giriş":"Login", "Qeydiyyat":"Register",
    "Daxil ol":"Log in", "Hesab yarat":"Create account",
    "İstifadəçi adı (@ olmadan)":"Username (without @)",
    "Şifrə (ən azı 8 simvol)":"Password (at least 8 characters)",
    "Şərh yaz...":"Write a comment...", "Şərh":"Comment",
    "İzlə":"Follow", "İzləmədən çıx":"Unfollow",
    "Dostluq əlavə et":"Add friend", "Dostsunuz":"Friends",
    "Dostluq sorğusu göndərdi":"Sent a friend request",
    "Qəbul et":"Accept", "Rədd et":"Reject",
    "Sorğun gözləyir":"Request pending", "Dostun":"Your friend",
    "Sil":"Remove", "Dostluq sorğuları":"Friend requests",
    "Gələn sorğu yoxdur.":"No incoming requests.",
    "Göndərdiyim sorğular":"Sent requests",
    "Gözləyən sorğun yoxdur.":"No pending requests.",
    "Dostlarım":"My friends", "Hələ dostun yoxdur.":"You have no friends yet.",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et! 💜":"No posts yet. Be the first to share! 💜",
    "Hələ paylaşım yoxdur.":"No posts yet.",
    "Paylaşıldı! 💜":"Posted! 💜",
    "Profil yadda saxlanıldı!":"Profile saved!",
    "Profil şəkli yeniləndi!":"Profile picture updated!",
    "Axtarış":"Search", "Bildiriş":"Notifications",
    "Hələ bildiriş yoxdur.":"No notifications yet.",
    "Hələ söhbət yoxdur.":"No conversations yet.",
    "Story paylaş":"Share a story", "Story haqqında yaz...":"Write about your story...",
    "Şəkil və ya video seç.":"Choose a photo or video.",
    "Story paylaşıldı! 24 saat sonra silinəcək.":"Story posted! It will disappear after 24 hours.",
    "Mesaj sorğuları":"Message requests", "Sorğu göndər":"Send request",
    "Mesaj sorğusu göndərildi.":"Message request sent.",
    "Mesaj sorğusu yoxdur.":"No message requests.",
    "Ləğv et":"Cancel",
    "Hələ dostun yoxdur. Dost əlavə etdikcə burada görünəcəklər.":"No friends yet. Friends will appear here when you add them.",
    "baxış · 24 saatlıq Story":"views · 24-hour story",
    "səni izləməyə başladı.":"started following you.",
    "paylaşımını bəyəndi.":"liked your post.",
    "paylaşımına şərh yazdı.":"commented on your post.",
    "sənə mesaj göndərdi.":"sent you a message.",
    "Əvvəlcə söhbət seç.":"Select a chat first.",
    "Kimi axtarırsan?":"Who are you looking for?",
    "Mesaj yaz":"Send message", "Geri":"Back",
    "Story haqqında yazı":"Story caption",
    "Hələ aktiv story yoxdur.":"No active stories yet.",
    "Dosya seç":"Choose file",
    "Fayl seç":"Choose file",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et!💜":"No posts yet. Be the first to share! 💜",
    "Hələ paylaşım yoxdur. İlk paylaşımı sən et! 💜":"No posts yet. Be the first to share! 💜"
  },
  az: {}
};

function translateElement(root, lang) {
  const dict = translations[lang] || translations.tr;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;

  while ((node = walker.nextNode())) {
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const original = originalText.get(node);
    const trimmed = original.trim();
    if (dict[trimmed] !== undefined) {
      node.nodeValue = original.replace(trimmed, dict[trimmed]);
    } else {
      node.nodeValue = original;
    }
  }

  const attrs = ["placeholder", "aria-label", "title"];
  root.querySelectorAll?.("*").forEach(el => {
    for (const attr of attrs) {
      if (!el.hasAttribute(attr)) continue;
      const key = "talkOriginal" + attr;
      if (!el.dataset[key]) el.dataset[key] = el.getAttribute(attr);
      const original = el.dataset[key];
      el.setAttribute(attr, dict[original] ?? original);
    }
  });
}

function applyTalkLanguage(lang) {
  if (!translations[lang]) lang = "tr";
  translateElement(document.body, lang);
  document.documentElement.lang = lang;
  localStorage.setItem("talkchat-language", lang);
  if (languageSelect) languageSelect.value = lang;
}

if (languageSelect) {
  const savedLanguage = localStorage.getItem("talkchat-language") || "tr";
  languageSelect.value = savedLanguage;
  languageSelect.addEventListener("change", () => applyTalkLanguage(languageSelect.value));
  applyTalkLanguage(savedLanguage);
}

// Yeni yaradılan mesaj, bildiriş, Story və digər elementləri də tərcümə et.
const talkLanguageObserver = new MutationObserver(records => {
  const lang = localStorage.getItem("talkchat-language") || "tr";
  for (const record of records) {
    for (const added of record.addedNodes) {
      if (added.nodeType === Node.ELEMENT_NODE) {
        translateElement(added, lang);
      } else if (added.nodeType === Node.TEXT_NODE) {
        const dict = translations[lang] || translations.tr;
        const original = added.nodeValue.trim();
        if (dict[original] !== undefined) {
          added.nodeValue = added.nodeValue.replace(original, dict[original]);
        }
      }
    }
  }
});
talkLanguageObserver.observe(document.body, {childList:true, subtree:true});

$("startDM").onclick=async()=>{
  try{const c=await api("/api/conversations/direct",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:$("dmUsername").value})});await loadConversations();openConversation(c.id);}
  catch(e){alert(e.message);}
};
$("dmForm").onsubmit=async e=>{
  e.preventDefault();if(!activeConversation)return alert("Əvvəlcə söhbət seç.");
  try{
    const fd=formDataFile("file",$("dmFile").files[0],{text:$("dmText").value});
    await api("/api/conversations/"+activeConversation+"/messages",{method:"POST",body:fd});
    $("dmText").value="";$("dmFile").value="";openConversation(activeConversation);
  }catch(err){alert(err.message);}
};
$("createGroup").onclick=async()=>{
  try{
    const usernames=$("groupMembers").value.split(",").map(x=>x.trim()).filter(Boolean);
    const c=await api("/api/conversations/group",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:$("groupName").value,usernames})});
    $("groupName").value="";$("groupMembers").value="";await loadConversations();openConversation(c.id);
  }catch(e){alert(e.message);}
};
socket.on("newMessage",data=>{
  if(activeConversation===data.conversationId)openConversation(activeConversation);
  if(!$("messagesPage").hidden)loadConversations();
});

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


// TALKCHAT ROOMS FRONTEND
(() => {
  const $r = id => document.getElementById(id);
  let activeTalkRoom = null;

  async function refreshTalkRooms() {
    const list = $r("talkRoomList");
    if (!list) return;
    try {
      const rooms = await api("/api/rooms/discover");
      list.innerHTML = rooms.length ? rooms.map(r => `
        <div class="talk-room-entry">
          <span><b>${esc(r.name)}</b> · ${r.memberCount} üzv</span>
          <button type="button" data-room-open="${esc(r.id)}">${r.joined ? "Aç" : "Qoşul"}</button>
        </div>`).join("") : "<p>Hələ otaq yoxdur. İlk otağı sən yarat!</p>";
    } catch (e) {
      list.textContent = e.message;
    }
  }

  async function openTalkRoom(id) {
    try {
      const rooms = await api("/api/rooms/discover");
      const room = rooms.find(r => r.id === id);
      if (!room) throw new Error("Otaq tapılmadı.");
      if (!room.joined) await api("/api/rooms/" + encodeURIComponent(id) + "/join", {method:"POST"});
      if (activeTalkRoom) socket.emit("leaveTalkRoom", activeTalkRoom);
      activeTalkRoom = id;
      socket.emit("joinTalkRoom", id);
      $r("talkRoomActive").hidden = false;
      $r("talkRoomTitle").textContent = room.name;
      await loadTalkRoomMessages();
      await refreshTalkRooms();
    } catch (e) { alert(e.message); }
  }

  async function loadTalkRoomMessages() {
    if (!activeTalkRoom) return;
    try {
      const messages = await api("/api/rooms/" + encodeURIComponent(activeTalkRoom) + "/messages");
      const box = $r("talkRoomMessages");
      box.innerHTML = messages.map(m => {
        const reactions = m.reactions || {};
        return `<div class="talk-room-message">
          <b>${esc(m.username)}</b>
          <p>${esc(m.text)}</p>
          <small>${new Date(m.createdAt).toLocaleString()}</small>
          <div class="talk-room-reactions">
            ${["❤️","😂","👍","🔥"].map(e => `<button type="button" data-room-react="${e}" data-message-id="${esc(m.id)}">${e} ${Array.isArray(reactions[e]) ? reactions[e].length : 0}</button>`).join("")}
          </div>
        </div>`;
      }).join("") || "<p>İlk mesajı sən yaz!</p>";
      box.scrollTop = box.scrollHeight;
    } catch (e) { console.error(e); }
  }

  $r("talkRoomCreate")?.addEventListener("click", async () => {
    const input = $r("talkRoomName");
    try {
      const room = await api("/api/rooms", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name:input.value})
      });
      input.value = "";
      await refreshTalkRooms();
      await openTalkRoom(room.id);
    } catch (e) { alert(e.message); }
  });

  $r("talkRoomList")?.addEventListener("click", e => {
    const btn = e.target.closest("[data-room-open]");
    if (btn) openTalkRoom(btn.dataset.roomOpen);
  });

  $r("talkRoomForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    if (!activeTalkRoom) return;
    const input = $r("talkRoomText");
    const text = input.value.trim();
    if (!text) return;
    try {
      await api("/api/rooms/" + encodeURIComponent(activeTalkRoom) + "/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({text})
      });
      input.value = "";
      await loadTalkRoomMessages();
    } catch (err) { alert(err.message); }
  });

  $r("talkRoomMessages")?.addEventListener("click", async e => {
    const btn = e.target.closest("[data-room-react]");
    if (!btn || !activeTalkRoom) return;
    try {
      await api("/api/rooms/" + encodeURIComponent(activeTalkRoom) + "/messages/" +
        encodeURIComponent(btn.dataset.messageId) + "/react", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({emoji:btn.dataset.roomReact})
        });
      await loadTalkRoomMessages();
    } catch (err) { alert(err.message); }
  });

  $r("talkRoomMembers")?.addEventListener("click", async () => {
    if (!activeTalkRoom) return;
    try {
      const data = await api("/api/rooms/" + encodeURIComponent(activeTalkRoom) + "/members");
      alert("Otağın üzvləri:\\n" + data.members.join("\\n"));
    } catch (e) { alert(e.message); }
  });

  socket.on("roomMessage", message => {
    if (activeTalkRoom === message.roomId) loadTalkRoomMessages();
  });
  socket.on("roomReaction", message => {
    if (activeTalkRoom === message.roomId) loadTalkRoomMessages();
  });

  refreshTalkRooms();
})();
