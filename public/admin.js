(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const managerRoles = new Set(["owner", "admin", "moderator"]);
  const roleNames = { owner: "[OWNER]", admin: "[ADMIN]", moderator: "[MODERATOR]", member: "[MEMBER]" };
  const durationOptions = `
    <option value="permanent">Daimi</option>
    <option value="24h">24 saat</option>
    <option value="2d">2 gün</option>
    <option value="3d">3 gün</option>`;
  let loading = false;

  function syncRole(role) {
    window.talkChatRole = role || "member";
    const allowed = managerRoles.has(window.talkChatRole);
    const link = $("adminMenuLink");
    if (link) link.hidden = !allowed;
    return allowed;
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Sorğu alınmadı.");
    return data;
  }

  function showStatus(message, error = false) {
    const node = $("adminStatus");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("error", error);
  }

  function stat(title, value, note, icon) {
    return `<article class="tc-admin-stat"><span class="tc-admin-stat-icon">${icon}</span><span class="tc-admin-stat-label">${title}</span><strong>${value}</strong><small>${note}</small></article>`;
  }

  function renderSummary(data) {
    $("adminStats").innerHTML = [
      stat("İstifadəçilər", data.users, "Bütün hesablar", "◉"),
      stat("Adminlər", data.admins, "Aktiv idarəçilər", "◆"),
      stat("Moderatorlar", data.moderators, "Moderasiya komandası", "◇"),
      stat("Banlı hesablar", data.banned, "Müddətli və daimi", "⊘"),
      stat("Gözləyən şikayətlər", data.reports, `${data.reportedPosts} post · ${data.reportedReels} Reels`, "⚑")
    ].join("");
    $("adminAuditList").innerHTML = (data.recentActions || []).map(auditHTML).join("") ||
      `<div class="tc-admin-empty">Hələ idarəetmə qeydi yoxdur.</div>`;
  }

  function auditHTML(item) {
    const labels = {
      owner_verified: "Owner təsdiqləndi",
      role_changed: "Rol dəyişdirildi",
      user_banned: "İstifadəçi banlandı",
      ban_lifted: "Ban qaldırıldı",
      ban_expired: "Banın vaxtı bitdi",
      post_deleted: "Post silindi",
      reel_deleted: "Reels silindi",
      comment_deleted: "Şərh silindi",
      report_rejected: "Şikayət rədd edildi",
      report_resolved: "Şikayət işlənildi"
    };
    return `<article class="tc-admin-audit-row"><span class="tc-admin-audit-mark">•</span><div><b>${escapeHTML(labels[item.actionType] || item.actionType)}</b><small>${escapeHTML(item.actorUsername || "system")} → ${escapeHTML(item.targetUsername || "—")}</small><p>${escapeHTML(item.reason || "—")}</p></div><time>${item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}</time></article>`;
  }

  function userHTML(user) {
    const owner = window.talkChatRole === "owner";
    const self = user.username === window.talkChatUsername;
    const banned = !!user.ban;
    const avatar = user.avatar
      ? `<img class="tc-admin-avatar" src="${escapeHTML(user.avatar)}" alt="">`
      : `<span class="tc-admin-avatar tc-admin-avatar-fallback">${escapeHTML((user.username || "?")[0].toUpperCase())}</span>`;
    return `<article class="tc-admin-user" data-username="${escapeHTML(user.username)}">
      <div class="tc-admin-user-main">${avatar}<div class="tc-admin-user-copy"><b>@${escapeHTML(user.username)} <span class="tc-admin-role">${escapeHTML(roleNames[user.role] || roleNames.member)}</span></b><small>${escapeHTML(user.displayName || user.bio || "TalkChat istifadəçisi")}</small></div><button type="button" class="tc-admin-quiet" data-admin-profile="${escapeHTML(user.username)}">Profilə bax</button></div>
      ${banned ? `<div class="tc-admin-ban-note"><b>Ban aktivdir</b><span>${user.ban.until ? `Bitmə: ${escapeHTML(new Date(user.ban.until).toLocaleString())}` : "Daimi"}</span><small>${escapeHTML(user.ban.reason || "Səbəb göstərilməyib")}</small></div>` : ""}
      <details class="tc-admin-user-actions"><summary>İdarə et</summary><div class="tc-admin-action-box">
        ${owner ? `<label>Rol<select data-user-role="${escapeHTML(user.username)}"><option value="member" ${user.role === "member" ? "selected" : ""}>[MEMBER]</option><option value="moderator" ${user.role === "moderator" ? "selected" : ""}>[MODERATOR]</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>[ADMIN]</option></select></label><input data-role-reason="${escapeHTML(user.username)}" maxlength="500" placeholder="Rol dəyişikliyi səbəbi">${!self ? `<button type="button" class="secondary" data-role-save="${escapeHTML(user.username)}">Rolu yadda saxla</button>` : `<small>Öz rolunu dəyişə bilməzsən.</small>`}` : ""}
        <label>Ban müddəti<select data-ban-duration="${escapeHTML(user.username)}">${durationOptions}</select></label>
        <textarea data-ban-reason="${escapeHTML(user.username)}" maxlength="500" placeholder="Ban səbəbi"></textarea>
        ${!banned && !self ? `<button type="button" class="tc-admin-danger" data-admin-ban="${escapeHTML(user.username)}">Ban et</button>` : ""}
        ${banned && !self ? `<textarea data-unban-reason="${escapeHTML(user.username)}" maxlength="500" placeholder="Banı qaldırma səbəbi"></textarea><button type="button" class="secondary" data-admin-unban="${escapeHTML(user.username)}">Banı qaldır</button>` : ""}
      </div></details>
    </article>`;
  }

  function reportHTML(report) {
    const content = report.content || {};
    let media = "";
    if (content.media && content.mediaType === "video")
      media = `<video class="tc-admin-report-media" src="${escapeHTML(content.media)}" controls playsinline preload="metadata"></video>`;
    else if (content.media)
      media = `<img class="tc-admin-report-media" src="${escapeHTML(content.media)}" alt="Şikayət edilmiş məzmun">`;
    return `<article class="tc-admin-report" data-report="${escapeHTML(report.id)}">
      <header><span class="tc-admin-report-type">${escapeHTML(content.type || report.itemType || "post")}</span><time>${report.createdAt ? new Date(report.createdAt).toLocaleString() : ""}</time></header>
      <p class="tc-admin-report-copy">${escapeHTML(content.text || "Mətn yoxdur")}</p>${media}
      <div class="tc-admin-report-meta"><span>Hesab: <b>@${escapeHTML(content.owner || report.owner || "—")}</b></span><span>Şikayət edən: @${escapeHTML(report.reporter || "—")}</span><span>Səbəb: <b>${escapeHTML(report.reason || "—")}</b></span></div>
      ${report.status && report.status !== "pending" ? `<div class="tc-admin-report-closed">${report.status === "resolved" ? "Həll edildi" : "Rədd edildi"} · ${escapeHTML(report.actionBy || "")} · ${escapeHTML(report.actionReason || "")}</div>` : `<textarea data-report-reason="${escapeHTML(report.id)}" maxlength="500" placeholder="Qərar və ya tədbir səbəbi"></textarea><div class="tc-admin-report-actions"><select data-report-duration="${escapeHTML(report.id)}">${durationOptions}</select><button type="button" class="secondary" data-report-action="resolve" data-report-id="${escapeHTML(report.id)}">Həll et</button><button type="button" class="tc-admin-quiet" data-report-action="reject" data-report-id="${escapeHTML(report.id)}">Rədd et</button><button type="button" class="tc-admin-danger" data-report-action="delete" data-report-id="${escapeHTML(report.id)}">Məzmunu sil</button><button type="button" class="tc-admin-danger" data-report-action="ban" data-report-id="${escapeHTML(report.id)}">Ban et</button></div>`}
    </article>`;
  }

  async function loadUsers(query = $("adminSearchInput")?.value || "") {
    const list = await request("/api/admin/users?q=" + encodeURIComponent(query));
    $("adminUserList").innerHTML = list.map(userHTML).join("") ||
      `<div class="tc-admin-empty">İstifadəçi tapılmadı.</div>`;
  }

  async function loadReports() {
    const status = $("adminReportFilter")?.value || "pending";
    const list = await request("/api/admin/reports?status=" + encodeURIComponent(status));
    $("adminReportList").innerHTML = list.map(reportHTML).join("") ||
      `<div class="tc-admin-empty">Bu filtrdə şikayət yoxdur.</div>`;
  }

  async function load() {
    if (loading) return;
    loading = true;
    showStatus("");
    try {
      const profile = await request("/api/profile");
      window.talkChatUsername = profile.username;
      if (!syncRole(profile.role)) {
        showStatus("Bu panelə giriş icazən yoxdur.", true);
        return;
      }
      const [summary] = await Promise.all([
        request("/api/admin/summary"),
        loadUsers(),
        loadReports()
      ]);
      renderSummary(summary);
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      loading = false;
    }
  }

  async function act(url, body, method = "POST") {
    await request(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    showStatus("Dəyişiklik yadda saxlanıldı.");
    await load();
  }

  $("adminRefresh")?.addEventListener("click", load);
  $("adminSearchForm")?.addEventListener("submit", event => {
    event.preventDefault();
    loadUsers().catch(error => showStatus(error.message, true));
  });
  $("adminReportFilter")?.addEventListener("change", () => loadReports().catch(error => showStatus(error.message, true)));

  document.addEventListener("click", async event => {
    const roleButton = event.target.closest("[data-role-save]");
    const banButton = event.target.closest("[data-admin-ban]");
    const unbanButton = event.target.closest("[data-admin-unban]");
    const profileButton = event.target.closest("[data-admin-profile]");
    const reportButton = event.target.closest("[data-report-action]");
    const deletePostButton = event.target.closest("[data-admin-delete-post]");
    const deleteCommentButton = event.target.closest("[data-admin-delete-comment]");
    try {
      if (roleButton) {
        const username = roleButton.dataset.roleSave;
        const role = document.querySelector(`[data-user-role="${CSS.escape(username)}"]`)?.value;
        const reason = document.querySelector(`[data-role-reason="${CSS.escape(username)}"]`)?.value || "";
        await act(`/api/admin/users/${encodeURIComponent(username)}/role`, { role, reason });
      } else if (banButton) {
        const username = banButton.dataset.adminBan;
        const duration = document.querySelector(`[data-ban-duration="${CSS.escape(username)}"]`)?.value;
        const reason = document.querySelector(`[data-ban-reason="${CSS.escape(username)}"]`)?.value || "";
        await act(`/api/admin/users/${encodeURIComponent(username)}/ban`, { duration, reason });
      } else if (unbanButton) {
        const username = unbanButton.dataset.adminUnban;
        const reason = document.querySelector(`[data-unban-reason="${CSS.escape(username)}"]`)?.value || "";
        await act(`/api/admin/users/${encodeURIComponent(username)}/unban`, { reason });
      } else if (profileButton) {
        const user = await request("/api/users/" + encodeURIComponent(profileButton.dataset.adminProfile));
        const panel = $("adminProfile");
        panel.hidden = false;
        panel.innerHTML = `<div class="tc-admin-profile-head">${user.avatar ? `<img src="${escapeHTML(user.avatar)}" alt="">` : ""}<div><b>@${escapeHTML(user.username)}</b><span>${escapeHTML(roleNames[user.role] || roleNames.member)}</span></div></div><p>${escapeHTML(user.bio || "Bio əlavə edilməyib.")}</p><small>${user.followersCount} izləyici · ${user.followingCount} izlənilən</small>`;
      } else if (reportButton) {
        const id = reportButton.dataset.reportId;
        const card = reportButton.closest("[data-report]");
        const reason = card.querySelector(`[data-report-reason="${CSS.escape(id)}"]`)?.value || "";
        const duration = card.querySelector(`[data-report-duration="${CSS.escape(id)}"]`)?.value;
        await act(`/api/admin/reports/${encodeURIComponent(id)}/action`, {
          action: reportButton.dataset.reportAction, reason, duration
        });
      } else if (deletePostButton || deleteCommentButton) {
        const button = deletePostButton || deleteCommentButton;
        const type = deleteCommentButton ? "comment" : button.dataset.adminDeleteType;
        const id = deleteCommentButton ? button.dataset.adminDeleteComment : button.dataset.adminDeletePost;
        const reason = window.prompt("Məzmunun silinmə səbəbini yaz:");
        if (reason === null) return;
        await request(`/api/admin/content/${type}/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason })
        });
        window.TalkChatSocial?.loadReels?.();
        if (typeof loadFeed === "function") loadFeed();
        if (typeof loadMyPosts === "function") loadMyPosts();
        if (!$("adminPage").hidden) await load();
      }
    } catch (error) {
      showStatus(error.message, true);
    }
  });

  window.TalkChatAdmin = { load, syncRole };
})();
