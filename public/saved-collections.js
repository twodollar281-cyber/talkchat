(() => {
  const $ = id => document.getElementById(id);
  let pendingPostId = "";
  let collections = [];

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
  function setStatus(id, message, error = false) {
    const target = $(id);
    if (!target) return;
    target.textContent = message || "";
    target.classList.toggle("error", error);
  }

  function renderCollections() {
    const root = $("savedCollectionsList");
    if (!root) return;
    root.innerHTML = collections.length ? collections.map(collection => `
      <article class="tc-collection-card">
        <header class="tc-collection-card-head">
          <div><h3>${escapeHTML(collection.name)}</h3><small>${Number(collection.count) || 0} paylaşım · yalnız sən görə bilərsən</small></div>
          <div class="tc-collection-actions">
            <button type="button" data-collection-rename="${escapeHTML(collection.id)}">Adını dəyiş</button>
            <button type="button" class="tc-collection-delete" data-collection-delete="${escapeHTML(collection.id)}">Sil</button>
          </div>
        </header>
        <div class="tc-collection-posts">${(collection.posts || []).map(post => `
          <div class="tc-collection-post">
            <div><b>@${escapeHTML(post.username)}</b><p>${escapeHTML(post.text || (post.kind === "reel" ? "Reels videosu" : "Şəkilli paylaşım"))}</p></div>
            <button type="button" data-collection-unsave="${escapeHTML(collection.id)}" data-post-id="${escapeHTML(post.id)}">Yaddaşdan çıxar</button>
          </div>`).join("") || `<p class="tc-collection-empty">Bu kolleksiyada hazırda görünən paylaşım yoxdur.</p>`}
        </div>
      </article>`).join("") : `<div class="tc-collection-empty">Hələ kolleksiya yoxdur. Bir kolleksiya yarat, sonra paylaşımı yadda saxla.</div>`;
  }

  async function load() {
    if (!$("savedCollectionsList")) return;
    try {
      collections = await request("/api/collections");
      renderCollections();
      setStatus("savedCollectionsStatus", "");
    } catch (error) {
      setStatus("savedCollectionsStatus", error.message, true);
    }
  }

  async function savePost(collectionId, postId) {
    await request(`/api/collections/${encodeURIComponent(collectionId)}/posts/${encodeURIComponent(postId)}`, { method: "POST" });
    setStatus("savedCollectionPickerStatus", "Paylaşım kolleksiyaya əlavə edildi.");
    $("savedCollectionPicker")?.close();
    pendingPostId = "";
    await load();
  }

  async function openPicker(postId) {
    pendingPostId = postId;
    setStatus("savedCollectionPickerStatus", "Kolleksiyalar yüklənir…");
    try {
      const list = await request("/api/collections");
      const options = $("savedCollectionPickerOptions");
      options.innerHTML = list.length ? list.map(item =>
        `<button type="button" data-pick-collection="${escapeHTML(item.id)}">${escapeHTML(item.name)}<small>${Number(item.count) || 0} paylaşım</small></button>`
      ).join("") : `<p class="tc-collection-empty">Əvvəl kolleksiya yarat, sonra bu paylaşımı əlavə et.</p>`;
      setStatus("savedCollectionPickerStatus", "");
      $("savedCollectionPicker")?.showModal();
    } catch (error) {
      setStatus("savedCollectionPickerStatus", error.message, true);
      $("savedCollectionPicker")?.showModal();
    }
  }

  $("savedCollectionCreateForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const input = $("savedCollectionName");
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      await request("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.value })
      });
      input.value = "";
      setStatus("savedCollectionsStatus", "Kolleksiya yaradıldı.");
      await load();
    } catch (error) { setStatus("savedCollectionsStatus", error.message, true); }
    finally { button.disabled = false; }
  });

  $("savedCollectionPickerCreateForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const input = $("savedCollectionPickerName");
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const collection = await request("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.value })
      });
      input.value = "";
      await savePost(collection.id, pendingPostId);
    } catch (error) { setStatus("savedCollectionPickerStatus", error.message, true); }
    finally { button.disabled = false; }
  });

  $("savedCollectionPickerOptions")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-pick-collection]");
    if (!button || !pendingPostId) return;
    button.disabled = true;
    try { await savePost(button.dataset.pickCollection, pendingPostId); }
    catch (error) { setStatus("savedCollectionPickerStatus", error.message, true); button.disabled = false; }
  });

  $("savedCollectionsList")?.addEventListener("click", async event => {
    const remove = event.target.closest("[data-collection-delete]");
    const rename = event.target.closest("[data-collection-rename]");
    const unsave = event.target.closest("[data-collection-unsave]");
    try {
      if (remove) {
        if (!window.confirm("Bu kolleksiyanı və onun yadda saxlanmış siyahısını silmək istəyirsən?")) return;
        await request(`/api/collections/${encodeURIComponent(remove.dataset.collectionDelete)}`, { method: "DELETE" });
      } else if (rename) {
        const current = collections.find(item => item.id === rename.dataset.collectionRename);
        const name = window.prompt("Yeni kolleksiya adı:", current?.name || "");
        if (name === null) return;
        await request(`/api/collections/${encodeURIComponent(rename.dataset.collectionRename)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name })
        });
      } else if (unsave) {
        await request(`/api/collections/${encodeURIComponent(unsave.dataset.collectionUnsave)}/posts/${encodeURIComponent(unsave.dataset.postId)}`, { method: "DELETE" });
      } else return;
      setStatus("savedCollectionsStatus", "Dəyişiklik yadda saxlanıldı.");
      await load();
    } catch (error) { setStatus("savedCollectionsStatus", error.message, true); }
  });

  $("savedCollectionPickerClose")?.addEventListener("click", () => $("savedCollectionPicker").close());
  $("savedCollectionPicker")?.addEventListener("click", event => {
    if (event.target === $("savedCollectionPicker")) $("savedCollectionPicker").close();
  });
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-save-post]");
    if (button) openPicker(button.dataset.savePost);
  });

  window.TalkChatCollections = { load };
})();
