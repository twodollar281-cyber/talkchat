(() => {
  const $ = id => document.getElementById(id);
  const defaults = {
    background: "#10101a",
    incoming: "#202033",
    outgoing: "#36c5ff",
    incomingText: "#ffffff",
    outgoingText: "#ffffff",
    bubbleStyle: "rounded"
  };
  let settings = { default: null, conversations: {} };

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Mövzunu saxlamaq olmadı.");
    return body;
  }
  function setStatus(message, error = false) {
    const node = $("tcChatThemeStatus");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("error", error);
  }
  function activeId() {
    return String(window.TalkChatActiveConversationId || "");
  }
  function themeFor(id = activeId()) {
    return (id && settings.conversations[id]) || settings.default || null;
  }
  function applyTheme(theme) {
    const root = $("messagesPage");
    if (!root) return;
    const value = theme || defaults;
    root.classList.toggle("tc-chat-themed", !!theme);
    for (const key of ["background", "incoming", "outgoing", "incomingText", "outgoingText"])
      root.style.setProperty(`--tc-chat-${key}`, value[key]);
    const radius = value.bubbleStyle === "square" ? "5px" : value.bubbleStyle === "soft" ? "12px" : "22px";
    root.style.setProperty("--tc-chat-bubble-radius", radius);
  }
  function applyFor(id = activeId()) {
    applyTheme(themeFor(id));
  }
  async function loadSettings() {
    try {
      const value = await request("/api/chat-themes");
      settings = {
        default: value.default || null,
        conversations: value.conversations && typeof value.conversations === "object" ? value.conversations : {}
      };
      applyFor();
    } catch (error) {
      setStatus(error.message, true);
    }
  }
  function formTheme() {
    return {
      background: $("tcThemeBackground").value,
      incoming: $("tcThemeIncoming").value,
      outgoing: $("tcThemeOutgoing").value,
      incomingText: $("tcThemeIncomingText").value,
      outgoingText: $("tcThemeOutgoingText").value,
      bubbleStyle: $("tcThemeBubbleStyle").value
    };
  }
  function fillForm(theme) {
    const value = theme || defaults;
    $("tcThemeBackground").value = value.background;
    $("tcThemeIncoming").value = value.incoming;
    $("tcThemeOutgoing").value = value.outgoing;
    $("tcThemeIncomingText").value = value.incomingText;
    $("tcThemeOutgoingText").value = value.outgoingText;
    $("tcThemeBubbleStyle").value = value.bubbleStyle;
    const id = activeId();
    $("tcChatThemeScope").textContent = id ? "Bu söhbət üçün dəyişiklik və ya ümumi standart seç." : "Aktiv söhbət yoxdur — standart mövzunu redaktə et.";
    $("tcThemeSaveConversation").disabled = !id;
    $("tcThemeResetConversation").disabled = !id || !settings.conversations[id];
  }
  async function openEditor() {
    await loadSettings();
    fillForm(themeFor());
    setStatus("");
    $("tcChatThemeDialog").showModal();
  }

  $("tcChatThemeButton")?.addEventListener("click", openEditor);
  $("tcChatThemeClose")?.addEventListener("click", () => $("tcChatThemeDialog").close());
  $("tcChatThemeDialog")?.addEventListener("click", event => {
    if (event.target === $("tcChatThemeDialog")) $("tcChatThemeDialog").close();
  });
  $("tcThemeSaveDefault")?.addEventListener("click", async () => {
    try {
      const result = await request("/api/chat-themes/default", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formTheme())
      });
      settings.default = result.default;
      applyFor();
      setStatus("Standart mövzu saxlanıldı.");
    } catch (error) { setStatus(error.message, true); }
  });
  $("tcThemeSaveConversation")?.addEventListener("click", async () => {
    const id = activeId();
    if (!id) return setStatus("Əvvəl söhbət seç.", true);
    try {
      const result = await request(`/api/chat-themes/conversations/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formTheme())
      });
      settings.conversations[id] = result.theme;
      applyFor(id);
      setStatus("Bu söhbətin mövzusu saxlanıldı.");
      fillForm(result.theme);
    } catch (error) { setStatus(error.message, true); }
  });
  $("tcThemeResetConversation")?.addEventListener("click", async () => {
    const id = activeId();
    if (!id) return;
    try {
      await request(`/api/chat-themes/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      delete settings.conversations[id];
      applyFor(id);
      fillForm(themeFor(id));
      setStatus("Bu söhbət standart mövzuya qaytarıldı.");
    } catch (error) { setStatus(error.message, true); }
  });
  $("tcThemeResetDefault")?.addEventListener("click", async () => {
    try {
      await request("/api/chat-themes/default", { method: "DELETE" });
      settings.default = null;
      applyFor();
      fillForm(themeFor());
      setStatus("Standart mövzu sıfırlandı.");
    } catch (error) { setStatus(error.message, true); }
  });
  window.addEventListener("talkchat:active-conversation", event => {
    applyFor(event.detail?.id || "");
    if ($("tcChatThemeDialog")?.open) fillForm(themeFor(event.detail?.id || ""));
  });

  loadSettings();
  window.TalkChatChatThemes = { load: loadSettings };
})();
