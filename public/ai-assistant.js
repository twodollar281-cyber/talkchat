(() => {
  const $ = id => document.getElementById(id);
  const root = $("aiAssistantMessages");
  if (!root) return;
  let messages = [];
  let busy = false;

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Sorğu alınmadı. Yenidən cəhd et.");
    return body;
  }
  function setStatus(message = "", error = false) {
    const status = $("aiAssistantStatus");
    status.textContent = message;
    status.classList.toggle("error", error);
  }
  function appendMessage(message, pending = false) {
    const article = document.createElement("article");
    article.className = `tc-ai-message ${message.role === "assistant" ? "assistant" : "user"}${pending ? " pending" : ""}`;
    const label = document.createElement("strong");
    label.textContent = message.role === "assistant" ? "TalkChat AI" : "Sən";
    const content = document.createElement("p");
    content.textContent = message.content || "Cavab hazırlanır…";
    article.append(label, content);
    return article;
  }
  function render() {
    root.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "tc-ai-empty";
      empty.textContent = "Sualını göndər. Cavablar Cloudflare Workers AI-dan alınır; TalkChat sənin digər çatlarını AI ilə paylaşmır.";
      root.append(empty);
    } else {
      messages.forEach(message => root.append(appendMessage(message)));
    }
    $("aiClearHistory").disabled = !messages.length || busy;
    root.scrollTop = root.scrollHeight;
  }
  function setBusy(value) {
    busy = value;
    $("aiAssistantSend").disabled = value;
    $("aiAssistantInput").disabled = value;
    $("aiClearHistory").disabled = value || !messages.length;
  }
  async function load() {
    setStatus("");
    root.setAttribute("aria-busy", "true");
    try {
      messages = await request("/api/ai-assistant/history");
      render();
    } catch (error) {
      root.replaceChildren();
      setStatus(error.message, true);
    } finally {
      root.removeAttribute("aria-busy");
    }
  }

  $("aiAssistantForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    const input = $("aiAssistantInput");
    const message = input.value.trim();
    if (!message) return;
    setBusy(true);
    setStatus("Cavab hazırlanır…");
    const pending = appendMessage({ role: "assistant", content: "" }, true);
    root.append(pending);
    root.setAttribute("aria-busy", "true");
    root.scrollTop = root.scrollHeight;
    try {
      const result = await request("/api/ai-assistant/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      messages.push(result.userMessage, result.message);
      messages = messages.slice(-60);
      input.value = "";
      setStatus("");
      render();
    } catch (error) {
      pending.remove();
      setStatus(error.message, true);
    } finally {
      root.removeAttribute("aria-busy");
      setBusy(false);
      $("aiClearHistory").disabled = !messages.length;
      input.focus();
    }
  });

  $("aiClearHistory").addEventListener("click", async () => {
    if (busy || !messages.length) return;
    if (!window.confirm("TalkChat AI söhbət tarixçən öz hesabından silinsin?")) return;
    $("aiClearHistory").disabled = true;
    try {
      await request("/api/ai-assistant/history", { method: "DELETE" });
      messages = [];
      render();
      setStatus("AI tarixçəsi silindi.");
    } catch (error) {
      setStatus(error.message, true);
      $("aiClearHistory").disabled = false;
    }
  });

  window.TalkChatAI = { load };
})();
