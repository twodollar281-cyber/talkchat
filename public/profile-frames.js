// TalkStore çərçivələri: profilə tətbiq + hər yerdə görünmə
(() => {
  const NAMES = {
    "item-frame-neon": "Neon Çərçivə",
    "item-frame-galaxy": "Qalaktika",
    "item-frame-royal": "Şahzadə Çərçivəsi",
    "item-frame-cyber": "Kiber Çərçivə",
    "item-frame-aurora": "Aurora Çərçivəsi",
    "item-frame-inferno": "İnferno Çərçivəsi",
    "item-frame-diamond": "Almaz Çərçivəsi"
  };
  const PREMIUM = new Set(["item-frame-aurora", "item-frame-inferno", "item-frame-diamond"]);
  let serverOwned = [];
  const valid = id => Object.prototype.hasOwnProperty.call(NAMES, id);
  const attr = id => (valid(id) ? ` data-frame="${id}"` : "");
  const set = (el, id) => { if (!el) return; if (valid(id)) el.setAttribute("data-frame", id); else el.removeAttribute("data-frame"); };

  function owned() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem("tcStoreCollected") || "[]"); } catch {}
    return (Array.isArray(list) ? list.filter(id => valid(id) && !PREMIUM.has(id)) : []).concat(serverOwned.filter(valid));
  }

  let current = "";
  function paintMine(frame) {
    current = valid(frame) ? frame : "";
    set(document.querySelector("#profilePage .avatar-wrap"), current);
    set(document.getElementById("menuAvatar"), current);
  }

  async function save(frame) {
    const status = document.getElementById("tcFrameStatus");
    try {
      const res = await fetch("/api/profile/frame", {
        method: "PUT", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Çərçivə saxlanmadı.");
      paintMine(body.frame);
      if (status) status.textContent = body.frame ? "Çərçivə tətbiq olundu!" : "Çərçivə götürüldü.";
      renderOptions();
      try { window.loadMyProfile && window.loadMyProfile(); } catch {}
    } catch (e) { if (status) status.textContent = e.message; }
  }

  function option(id, label, text) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button"; b.className = "tc-frame-opt" + (current === id ? " active" : "");
    const prev = document.createElement("span"); prev.className = "tc-frame-prev"; prev.textContent = text;
    if (id) prev.setAttribute("data-frame", id);
    const name = document.createElement("span"); name.textContent = label;
    b.append(prev, name); b.onclick = () => save(id); li.appendChild(b); return li;
  }
  function renderOptions() {
    const grid = document.getElementById("tcFrameGrid"); if (!grid) return;
    grid.textContent = "";
    const mine = owned();
    grid.appendChild(option("", "Çərçivəsiz", "∅"));
    if (!mine.length) {
      const li = document.createElement("li"); li.className = "tc-frame-empty";
      li.textContent = "Hələ çərçivən yoxdur. TalkStore-dan çərçivə yüklə.";
      grid.appendChild(li);
    }
    mine.forEach(id => grid.appendChild(option(id, NAMES[id], (document.getElementById("myUsername")?.textContent || "?").replace("@", "").charAt(0).toUpperCase() || "?")));
  }
  async function openDialog() {
    try { const r = await fetch("/api/gems", { credentials: "same-origin" }); if (r.ok) serverOwned = ((await r.json()).owned || []).filter(id => PREMIUM.has(id)); } catch {}
    const dlg = document.getElementById("tcFrameDialog"); if (!dlg) return;
    const status = document.getElementById("tcFrameStatus"); if (status) status.textContent = "";
    renderOptions();
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  }

  document.getElementById("tcFrameOpen")?.addEventListener("click", openDialog);
  document.getElementById("tcFrameClose")?.addEventListener("click", () => document.getElementById("tcFrameDialog").close());
  document.getElementById("tcFrameStoreLink")?.addEventListener("click", () => {
    document.getElementById("tcFrameDialog").close();
    window.showPage && window.showPage("store");
    setTimeout(() => window.TalkChatStore?.open?.("frames"), 50);
  });

  window.TalkFrames = { names: NAMES, valid, attr, set, paintMine, owned };
})();
