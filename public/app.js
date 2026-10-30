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
  const response = await fetch(url, options);
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
  if (name === "discover") $("searchInput").focus();
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
    $("homePage").hidden=true;$("discoverPage").hidden=true;$("messagesPage").hidden=true;$("notificationsPage").hidden=true;$("profilePage").hidden=true;$("publicProfilePage").hidden=false;
    $("publicProfile").innerHTML=`${avatarHTML(u,"avatar")}<h2>@${esc(u.username)}</h2><p>${esc(u.bio||"")}</p><div class="stats">${u.followersCount} izləyici · ${u.followingCount} izlənilən</div><button class="primary" id="followButton">${u.isFollowing?"İzləmədən çıx":"İzlə"}</button>`;
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
async function loadConversations(){
  try{
    conversationsCache=await api("/api/conversations");
    $("conversationList").innerHTML=conversationsCache.map(c=>`<button class="conversation-item ${activeConversation===c.id?"active":""}" data-convo="${esc(c.id)}">${esc(c.name||"Qrup")}</button>`).join("")||"<p class='muted'>Hələ söhbət yoxdur.</p>";
  }catch(e){$("conversationList").textContent=e.message;}
}
$("conversationList").onclick=e=>{
  const b=e.target.closest("[data-convo]");if(b)openConversation(b.dataset.convo);
};
async function openConversation(id){
  activeConversation=id;const c=conversationsCache.find(x=>x.id===id);
  $("chatTitle").textContent=c?.name||"Söhbət";
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
checkSession();
