(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const html = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
  const menuDialog = $("menuDialog");
  const shareDialog = $("shareDialog");
  const allowedImages = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const allowedVideos = new Set(["video/mp4", "video/webm"]);
  let activeShareMode = "post";
  let activeCommentPost = null;
  let reelObserver = null;
  const objectUrls = new Map();

  function toast(message, tone = "success") {
    if (window.TalkChat2027?.showToast) window.TalkChat2027.showToast(message, tone);
    else window.alert(message);
  }

  function setMenu(open) {
    if (!menuDialog) return;
    if (open && !menuDialog.open) menuDialog.showModal();
    if (!open && menuDialog.open) menuDialog.close();
    $("menuButton")?.setAttribute("aria-expanded", String(open));
  }

  function setShareMode(mode) {
    activeShareMode = mode;
    const names = { post: "Post Paylaş", story: "Story Paylaş", reel: "Reels Paylaş" };
    $("shareDialogTitle").textContent = names[mode] || "Yeni paylaşım";
    document.querySelectorAll(".share-form").forEach(form => {
      form.hidden = form.id !== ({ post: "postForm", story: "storyForm", reel: "reelForm" }[mode]);
    });
    document.querySelectorAll("[data-share-mode]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.shareMode === mode));
    });
  }
  function chooseReportReason() {
    const options = ["Spam", "Taciz", "Uygunsuz içerik", "Sahte hesap", "Diğer"];
    const answer = window.prompt("Şikayət səbəbini seç:\n" + options.map((value, index) => `${index + 1}. ${value}`).join("\n"), "1");
    if (answer === null) return null;
    const index = Number.parseInt(answer, 10) - 1;
    return options[index] || null;
  }
  async function submitReport(itemType, itemId) {
    const reason = chooseReportReason();
    if (reason === null) return;
    if (!reason) { toast("Siyahıdan etibarlı səbəb seç.", "error"); return; }
    const description = window.prompt("Əlavə izah (istəyə bağlı, maksimum 1000 simvol):", "");
    if (description === null) return;
    await api("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemType, itemId, reason, description: description.trim() })
    });
    toast("Şikayət moderator yoxlaması üçün göndərildi.");
  }

  function openShare(mode = "post") {
    setMenu(false);
    setShareMode(mode);
    if (!shareDialog.open) shareDialog.showModal();
    const target = ({ post: "postText", story: "storyText", reel: "reelText" }[mode]);
    window.setTimeout(() => $(target)?.focus(), 80);
  }

  function resetPreview(inputId, previewId) {
    const old = objectUrls.get(previewId);
    if (old) URL.revokeObjectURL(old);
    objectUrls.delete(previewId);
    const preview = $(previewId);
    if (preview) {
      preview.hidden = true;
      preview.innerHTML = "";
    }
    const input = $(inputId);
    if (input) input.value = "";
  }

  function validateFile(file, kind) {
    if (!file) return "Fayl seç.";
    if (kind === "image") {
      if (!allowedImages.has(file.type)) return "Şəkil JPG, PNG, WebP və ya GIF olmalı və 12 MB-dan böyük olmamalıdır.";
      if (file.size > 12 * 1024 * 1024) return "Şəkil maksimum 12 MB ola bilər.";
      return "";
    }
    if (kind === "video") {
      if (!allowedVideos.has(file.type)) return "Video MP4 və ya WebM olmalı və 30 MB-dan böyük olmamalıdır.";
      if (file.size > 30 * 1024 * 1024) return "Video MP4 və ya WebM olmalı və 30 MB-dan böyük olmamalıdır.";
      return "";
    }
    if (allowedImages.has(file.type)) {
      if (file.size > 12 * 1024 * 1024) return "Şəkil maksimum 12 MB ola bilər.";
      return "";
    }
    if (allowedVideos.has(file.type)) {
      if (file.size > 30 * 1024 * 1024) return "Video MP4 və ya WebM olmalı və 30 MB-dan böyük olmamalıdır.";
      return "";
    }
    return "Yalnız JPG, PNG, WebP, GIF, MP4 və ya WebM faylı seç.";
  }

  function showPreview(inputId, previewId, kind) {
    const input = $(inputId);
    const file = input?.files?.[0];
    const preview = $(previewId);
    if (!input || !preview) return;
    if (!file) {
      resetPreview(inputId, previewId);
      return;
    }
    const error = validateFile(file, kind);
    if (error) {
      resetPreview(inputId, previewId);
      toast(error, "error");
      return;
    }
    const previous = objectUrls.get(previewId);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(file);
    objectUrls.set(previewId, url);
    preview.innerHTML = allowedVideos.has(file.type)
      ? `<video src="${url}" controls playsinline preload="metadata"></video><span>${html(file.name)}</span>`
      : `<img src="${url}" alt=""><span>${html(file.name)}</span>`;
    preview.hidden = false;
  }

  function uploadWithProgress(url, formData, progress, status) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.withCredentials = true;
      xhr.upload.addEventListener("progress", event => {
        if (!event.lengthComputable) return;
        const percent = Math.min(100, Math.round(event.loaded / event.total * 100));
        if (progress) {
          progress.hidden = false;
          progress.value = percent;
        }
        if (status) status.textContent = `Yüklənir… ${percent}%`;
      });
      xhr.addEventListener("load", () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText || "{}"); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error || "Xəta baş verdi."));
      });
      xhr.addEventListener("error", () => reject(new Error("Yükləmə alınmadı. Yenidən yoxla.")));
      xhr.send(formData);
    });
  }

  function bindPreview(inputId, previewId, kind) {
    $(inputId)?.addEventListener("change", () => showPreview(inputId, previewId, kind));
  }

  $("menuButton")?.addEventListener("click", () => setMenu(true));
  $("closeMenu")?.addEventListener("click", () => setMenu(false));
  $("closeShare")?.addEventListener("click", () => shareDialog.close());
  menuDialog?.addEventListener("close", () => $("menuButton")?.setAttribute("aria-expanded", "false"));
  menuDialog?.addEventListener("click", event => {
    if (event.target === menuDialog) setMenu(false);
  });
  shareDialog?.addEventListener("click", event => {
    if (event.target === shareDialog) shareDialog.close();
  });

  bindPreview("postMedia", "postPreview", "image");
  bindPreview("storyMedia", "storyPreview", "media");
  bindPreview("reelMedia", "reelPreview", "video");
  $("postForm")?.addEventListener("reset", () => window.setTimeout(() => {
    const url = objectUrls.get("postPreview");
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete("postPreview");
    $("postPreview").hidden = true;
    $("postPreview").innerHTML = "";
  }, 0));

  document.addEventListener("click", event => {
    const pageButton = event.target.closest("[data-page]");
    if (pageButton) setMenu(false);

    const shareButton = event.target.closest("[data-open-share]");
    if (shareButton) {
      event.preventDefault();
      openShare(shareButton.dataset.openShare);
      return;
    }
    const modeButton = event.target.closest("[data-share-mode]");
    if (modeButton) {
      setShareMode(modeButton.dataset.shareMode);
      return;
    }

    const sharePostButton = event.target.closest("[data-share-post]");
    if (sharePostButton) {
      event.preventDefault();
      openPostShare(sharePostButton.dataset.sharePost);
      return;
    }

    const focusCommentButton = event.target.closest("[data-focus-comment]");
    if (focusCommentButton) {
      focusCommentButton.closest("[data-post]")?.querySelector("[data-comment] input[name='text']")?.focus();
      return;
    }

    const commentButton = event.target.closest("[data-reel-comments]");
    if (commentButton) {
      openComments(commentButton.dataset.reelComments);
      return;
    }

    const likeButton = event.target.closest("[data-like]");
    if (likeButton && !likeButton.closest("#feed")) {
      event.preventDefault();
      api("/api/posts/" + encodeURIComponent(likeButton.dataset.like) + "/like", { method: "POST" })
        .then(result => {
          likeButton.textContent = `${result.liked ? "♥" : "♡"} ${result.likes} bəyənmə`;
          likeButton.classList.toggle("liked", result.liked);
        }).catch(error => toast(error.message, "error"));
      return;
    }

    const editButton = event.target.closest("[data-edit-post]");
    if (editButton) {
      const article = editButton.closest("[data-post]");
      const current = article?.querySelector(".post-text")?.textContent || "";
      const text = window.prompt("Paylaşımın yeni mətnini yaz", current);
      if (text === null) return;
      api("/api/posts/" + encodeURIComponent(editButton.dataset.editPost), {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text })
      }).then(() => refreshSocialViews()).catch(error => toast(error.message, "error"));
      return;
    }

    const deleteButton = event.target.closest("[data-delete-post]");
    if (deleteButton) {
      if (!window.confirm("Bu paylaşımı silmək istəyirsən?")) return;
      api("/api/posts/" + encodeURIComponent(deleteButton.dataset.deletePost), { method: "DELETE" })
        .then(() => refreshSocialViews()).catch(error => toast(error.message, "error"));
      return;
    }

    const reportButton = event.target.closest("[data-report-post]");
    if (reportButton) {
      const card = reportButton.closest("[data-kind]");
      submitReport(card?.dataset.kind === "reel" ? "reel" : "post", reportButton.dataset.reportPost)
        .catch(error => toast(error.message, "error"));
      return;
    }

    const reportComment = event.target.closest("[data-report-comment]");
    if (reportComment) {
      const [, commentId] = reportComment.dataset.reportComment.split(":");
      submitReport("comment", commentId).catch(error => toast(error.message, "error"));
      return;
    }

    const reportUser = event.target.closest("[data-report-user]");
    const reportStory = event.target.closest("[data-report-story]");
    const reportMessage = event.target.closest("[data-report-message]");
    if (reportUser) {
      submitReport("user", reportUser.dataset.reportUser).catch(error => toast(error.message, "error"));
      return;
    }
    if (reportStory) {
      submitReport("story", reportStory.dataset.reportStory).catch(error => toast(error.message, "error"));
      return;
    }
    if (reportMessage) {
      submitReport("message", reportMessage.dataset.reportMessage).catch(error => toast(error.message, "error"));
    }
  });

  function refreshSocialViews() {
    if ($("homePage") && !$("homePage").hidden) loadFeed();
    if ($("profilePage") && !$("profilePage").hidden) loadMyPosts();
    if ($("publicProfilePage") && !$("publicProfilePage").hidden) {
      const username = $("publicProfile")?.querySelector(".public-username")?.textContent?.replace(/^@/, "");
      if (username) api("/api/users/" + encodeURIComponent(username) + "/posts")
        .then(list => { $("publicPosts").innerHTML = list.map(postHTML).join("") || "<div class='tc-empty-state'><b>Hələ paylaşım yoxdur</b></div>"; })
        .catch(error => toast(error.message, "error"));
    }
    if ($("reelsPage") && !$("reelsPage").hidden) loadReels(true);
  }

  function openPostShare(postId) {
    let dialog = $("postShareDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "postShareDialog";
      dialog.className = "tc-share-dialog tc-send-dialog";
      dialog.innerHTML = `<div class="tc-share-panel"><header class="tc-share-header"><div><span class="eyebrow">TALKCHAT · DIRECT</span><h2>Paylaşımı göndər</h2></div><button class="icon-button" type="button" data-close-dialog aria-label="Bağla">×</button></header><form id="postShareForm"><label class="profile-field-label" for="shareUsername">İstifadəçi adı ilə göndər</label><input id="shareUsername" maxlength="20" placeholder="@username" autocomplete="off" required><button class="primary full" type="submit">Göndər</button><p class="status" id="postShareStatus" aria-live="polite"></p></form></div>`;
      document.body.appendChild(dialog);
      dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });
      dialog.addEventListener("click", e => { if (e.target.closest("[data-close-dialog]")) dialog.close(); });
      $("postShareForm").addEventListener("submit", async e => {
        e.preventDefault();
        const status = $("postShareStatus");
        status.textContent = "Göndərilir…";
        try {
          await api("/api/posts/" + encodeURIComponent(dialog.dataset.postId) + "/share", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: $("shareUsername").value })
          });
          dialog.close();
          $("postShareForm").reset();
          toast("Paylaşım uğurla göndərildi.");
        } catch (error) { status.textContent = error.message; }
      });
    }
    dialog.dataset.postId = postId;
    $("postShareForm").reset();
    $("postShareStatus").textContent = "";
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => $("shareUsername").focus(), 80);
  }

  function reelHTML(post) {
    const liked = (post.likes || []).includes(me);
    const avatar = post.authorAvatar
      ? `<img src="${html(post.authorAvatar)}" alt="">`
      : `<span>${html((post.username || "?")[0].toUpperCase())}</span>`;
    const own = post.username === me;
    const canModerate = ["owner", "admin", "moderator"].includes(window.talkChatRole);
    const badge = window.TalkChatRoleBadge ? window.TalkChatRoleBadge(post.authorRole) : "";
    return `<article class="reel-slide" data-post="${html(post.id)}" data-kind="reel">
      <video class="reel-video" src="${html(post.media)}" muted loop playsinline preload="metadata" aria-label="${html(post.text || "Reels videosu")}"></video>
      <div class="reel-shade"></div>
      <div class="reel-volume" aria-hidden="true">♫ <span>Səs bağlı</span></div>
      <div class="reel-action-rail">
        <button type="button" class="reel-action${liked ? " liked" : ""}" data-like="${html(post.id)}" aria-label="Bəyən"><span>${liked ? "♥" : "♡"}</span><small>${(post.likes || []).length}</small></button>
        <button type="button" class="reel-action" data-reel-comments="${html(post.id)}" aria-label="Şərh yaz"><span>▢</span><small>${(post.comments || []).length}</small></button>
        <button type="button" class="reel-action" data-share-post="${html(post.id)}" aria-label="Göndər"><span>➤</span><small>Göndər</small></button>
        <details class="reel-more"><summary aria-label="Əlavə əməliyyatlar">···</summary><div class="post-more-menu">
          ${own ? `<button type="button" data-edit-post="${html(post.id)}">Redaktə et</button><button type="button" data-delete-post="${html(post.id)}">Paylaşımı sil</button>` : canModerate ? `<button type="button" data-admin-delete-post="${html(post.id)}" data-admin-delete-type="reel">Məzmunu sil</button>` : `<button type="button" data-report-post="${html(post.id)}">Şikayət et</button>`}
        </div></details>
      </div>
      <div class="reel-caption">
        <div class="reel-author"><span class="reel-avatar">${avatar}</span><span><b>${html(post.authorName || post.username)} ${badge}</b><small>@${html(post.username)}</small></span><span class="reel-badge">REELS</span></div>
        ${post.text ? `<p>${html(post.text)}</p>` : ""}
      </div>
    </article>`;
  }

  async function loadReels(preservePosition = false) {
    const feed = $("reelsFeed");
    if (!feed) return;
    const previous = preservePosition ? feed.scrollTop : 0;
    if (reelObserver) reelObserver.disconnect();
    feed.setAttribute("aria-busy", "true");
    feed.innerHTML = `<div class="tc-empty-state reels-loading"><span class="tc-spinner" aria-hidden="true"></span><b>Reels yüklənir…</b></div>`;
    try {
      const list = await api("/api/reels");
      if (!list.length) {
        feed.innerHTML = `<div class="tc-empty-state reels-empty"><span aria-hidden="true">▶</span><b>Hələ Reels yoxdur</b><p>Şaquli videonu paylaş, lentdə görünsün.</p><button class="share-action share-reel" type="button" data-open-share="reel">Reels Paylaş</button></div>`;
        return;
      }
      feed.innerHTML = list.map(reelHTML).join("");
      feed.scrollTop = previous;
      if (reelObserver) reelObserver.disconnect();
      reelObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const video = entry.target.querySelector("video");
          if (!video) return;
          if (entry.isIntersecting && entry.intersectionRatio > 0.65) {
            video.play().catch(() => {});
          } else {
            video.pause();
          }
        });
      }, { root: feed, threshold: [0, 0.65, 1] });
      feed.querySelectorAll(".reel-slide").forEach(slide => reelObserver.observe(slide));
      feed.querySelectorAll(".reel-video").forEach(video => video.addEventListener("click", () => {
        video.muted = !video.muted;
        const label = video.closest(".reel-slide")?.querySelector(".reel-volume span");
        if (label) label.textContent = video.muted ? "Səs bağlı" : "Səs açıq";
      }));
    } catch (error) {
      feed.innerHTML = `<div class="tc-empty-state"><b>${html(error.message)}</b><button type="button" class="secondary" data-reload-reels>Yenidən yoxla</button></div>`;
    } finally {
      feed.removeAttribute("aria-busy");
    }
  }

  function openComments(postId) {
    let dialog = $("reelCommentsDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "reelCommentsDialog";
      dialog.className = "tc-comments-dialog";
      dialog.innerHTML = `<section class="tc-comments-panel"><header><div><span class="eyebrow">TALKCHAT · REELS</span><h2>Şərhlər</h2></div><button type="button" class="icon-button" data-close-dialog aria-label="Bağla">×</button></header><div id="reelCommentList" class="reel-comment-list"></div><form id="reelCommentForm"><input name="text" maxlength="500" placeholder="Şərh yaz..." required><button class="primary" type="submit">Göndər</button></form></section>`;
      document.body.appendChild(dialog);
      dialog.addEventListener("click", e => { if (e.target === dialog || e.target.closest("[data-close-dialog]")) dialog.close(); });
      $("reelCommentForm").addEventListener("submit", async e => {
        e.preventDefault();
        const text = new FormData(e.currentTarget).get("text");
        try {
          await api("/api/posts/" + encodeURIComponent(dialog.dataset.postId) + "/comments", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text })
          });
          e.currentTarget.reset();
          await renderComments(dialog.dataset.postId);
          await loadReels(true);
        } catch (error) { toast(error.message, "error"); }
      });
    }
    dialog.dataset.postId = postId;
    renderComments(postId).catch(error => toast(error.message, "error"));
    if (!dialog.open) dialog.showModal();
  }

  async function renderComments(postId) {
    const list = await api("/api/reels");
    const post = list.find(item => item.id === postId);
    const canModerate = ["owner", "admin", "moderator"].includes(window.talkChatRole);
    $("reelCommentList").innerHTML = (post?.comments || []).map(comment =>
      `<article class="reel-comment"><span class="avatar-fallback">${html((comment.username || "?")[0].toUpperCase())}</span><p><b>@${html(comment.username)}</b> ${window.TalkChatRoleBadge ? window.TalkChatRoleBadge(comment.role) : ""} ${html(comment.text)}<br><button type="button" class="tc-inline-mod" ${canModerate ? `data-admin-delete-comment="${html(comment.id)}"` : `data-report-comment="${html(postId)}:${html(comment.id)}"`}>${canModerate ? "Sil" : "Şikayət et"}</button></p></article>`
    ).join("") || `<div class="tc-empty-state"><b>Hələ şərh yoxdur</b><p>İlk şərhi sən yaz.</p></div>`;
  }

  $("storyForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const file = $("storyMedia").files[0];
    const error = validateFile(file, "media");
    if (error) { $("storyStatus").textContent = error; return; }
    const data = new FormData();
    data.append("media", file);
    data.append("text", $("storyText").value);
    $("storyStatus").textContent = "Yüklənir…";
    try {
      await uploadWithProgress("/api/stories", data, $("storyProgress"), $("storyStatus"));
      $("storyForm").reset();
      resetPreview("storyMedia", "storyPreview");
      $("storyProgress").hidden = true;
      shareDialog.close();
      loadTalkChatExtras();
      toast("Story paylaşıldı! 24 saat sonra silinəcək.");
    } catch (error) {
      $("storyStatus").textContent = error.message;
      toast(error.message, "error");
    }
  });

  $("reelForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const file = $("reelMedia").files[0];
    const error = validateFile(file, "video");
    if (error) { $("reelStatus").textContent = error; return; }
    const data = new FormData();
    data.append("media", file);
    data.append("text", $("reelText").value);
    $("reelStatus").textContent = "Yüklənir…";
    try {
      await uploadWithProgress("/api/reels", data, $("reelProgress"), $("reelStatus"));
      $("reelForm").reset();
      resetPreview("reelMedia", "reelPreview");
      $("reelProgress").hidden = true;
      shareDialog.close();
      toast("Reels paylaşıldı.");
      showPage("reels");
    } catch (error) {
      $("reelStatus").textContent = error.message;
      toast(error.message, "error");
    }
  });

  document.addEventListener("click", event => {
    if (event.target.closest("[data-reload-reels]")) loadReels();
  });

  document.addEventListener("submit", async event => {
    const form = event.target.closest("[data-comment]");
    if (!form || form.closest("#feed")) return;
    event.preventDefault();
    try {
      await api("/api/posts/" + encodeURIComponent(form.dataset.comment) + "/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: new FormData(form).get("text") })
      });
      form.reset();
      if (form.closest("#myPosts")) loadMyPosts();
      else if (form.closest("#publicPosts")) {
        const name = $("publicProfile")?.querySelector(".public-username")?.textContent?.replace(/^@/, "");
        if (name) api("/api/users/" + encodeURIComponent(name) + "/posts").then(list => {
          $("publicPosts").innerHTML = list.map(postHTML).join("");
        });
      }
    } catch (error) { toast(error.message, "error"); }
  });

  window.TalkChatSocial = { loadReels, refreshMenuProfile: async () => {
    try {
      const user = await api("/api/profile");
      window.talkChatRole = user.role || "member";
      window.TalkChatAdmin?.syncRole(window.talkChatRole);
      $("menuDisplayName").textContent = user.displayName || user.username;
      $("menuUsername").textContent = "@" + user.username;
      if ($("menuRoleBadge") && window.TalkChatRoleBadge) $("menuRoleBadge").innerHTML = window.TalkChatRoleBadge(user.role);
      $("menuAvatar").innerHTML = user.avatar
        ? `<img src="${html(user.avatar)}" alt="">`
        : html((user.username || "?")[0].toUpperCase());
    } catch {}
  } };
})();
