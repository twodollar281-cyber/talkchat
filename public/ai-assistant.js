(() => {
  const $ = id => document.getElementById(id);
  const root = $("aiAssistantMessages");
  if (!root) return;

  let messages = [];
  let conversations = [];
  let currentConversationId = null;
  let busy = false;
  let loading = false;
  let recognition = null;

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

  function preferredLanguage(text = "") {
    const selected = $("talkLanguage")?.value;
    if (/[əƏ]/.test(text)) return "az";
    const lower = text.toLocaleLowerCase();
    if (/[ıİ]/.test(text) || /\b(merhaba|nasıl|için|lütfen|misin|mısın|nedir)\b/.test(lower)) return "tr";
    if (selected === "tr" && /[ğşçöü]/i.test(text)) return "tr";
    if (/\b(the|and|what|how|where|which|can|could|please|thanks|is|are)\b/i.test(text)) return "en";
    return ["az", "tr", "en", "ru"].includes(selected) ? selected : "en";
  }

  function speechLocale(text) {
    return ({ az: "az-AZ", tr: "tr-TR", en: "en-US", ru: "ru-RU" })[preferredLanguage(text)] || "en-US";
  }

  function speak(text, button) {
    if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
      setStatus("Bu brauzerdə səsli oxutma dəstəklənmir.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = speechLocale(text);
    const voices = window.speechSynthesis.getVoices?.() || [];
    const prefix = utterance.lang.split("-")[0];
    utterance.voice = voices.find(voice => voice.lang?.toLowerCase().startsWith(prefix)) || null;
    utterance.onend = utterance.onerror = () => {
      if (button?.isConnected) button.textContent = "🔊 Dinlə";
    };
    button.textContent = "■ Dayandır";
    window.speechSynthesis.speak(utterance);
  }

  function runNavigation(navigation) {
    if (!navigation) return;
    $("aiPage").classList.remove("tc-ai-show-history");
    $("aiHistoryToggle").setAttribute("aria-expanded", "false");
    if (navigation.type === "share") {
      const trigger = document.querySelector(`#menuDialog [data-open-share="${navigation.mode}"]`) ||
        document.querySelector(`[data-open-share="${navigation.mode}"]`);
      if (trigger) trigger.click();
      else setStatus("Paylaşma pəncərəsi tapılmadı.", true);
      return;
    }
    if (navigation.type === "page") {
      if (navigation.page === "admin" && $("adminMenuLink")?.hidden) {
        setStatus("Admin Paneli yalnız uyğun rolu olan hesablar üçün görünür.");
        return;
      }
      if (typeof window.showPage === "function") window.showPage(navigation.page);
    }
  }

  function appendMessage(message, pending = false) {
    const article = document.createElement("article");
    article.className = `tc-ai-message ${message.role === "assistant" ? "assistant" : "user"}${pending ? " pending" : ""}`;
    const label = document.createElement("strong");
    label.textContent = message.role === "assistant" ? "TalkChat AI" : "Sən";
    const content = document.createElement("p");
    content.textContent = message.content || "Cavab hazırlanır…";
    article.append(label, content);

    if (!pending && message.role === "assistant") {
      const actions = document.createElement("div");
      actions.className = "tc-ai-message-actions";
      if (message.navigation) {
        const go = document.createElement("button");
        go.type = "button";
        go.textContent = message.navigation.label || "Bölməni aç";
        go.addEventListener("click", () => runNavigation(message.navigation));
        actions.append(go);
      }
      if ("speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function") {
        const listen = document.createElement("button");
        listen.type = "button";
        listen.textContent = "🔊 Dinlə";
        listen.setAttribute("aria-label", "AI cavabını səsləndir");
        listen.addEventListener("click", () => {
          if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            listen.textContent = "🔊 Dinlə";
          } else {
            speak(message.content, listen);
          }
        });
        actions.append(listen);
      }
      if (actions.childElementCount) article.append(actions);
    }
    return article;
  }

  function renderMessages() {
    root.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "tc-ai-empty";
      empty.textContent = "Sualını yaz və ya mikrofonla de. TalkChat AI tətbiqin yoxlanmış funksiyaları ilə yanaşı ümumi suallara da cavab verir.";
      root.append(empty);
    } else {
      messages.forEach(message => root.append(appendMessage(message)));
    }
    root.scrollTop = root.scrollHeight;
    $("aiClearHistory").disabled = !conversations.length || busy;
  }

  function renderConversations() {
    const list = $("aiConversationList");
    list.replaceChildren();
    $("aiConversationCount").textContent = String(conversations.length);
    if (!conversations.length) {
      const empty = document.createElement("p");
      empty.className = "tc-ai-no-history";
      empty.textContent = "Hələ söhbət yoxdur. Yeni söhbət başlat.";
      list.append(empty);
      $("aiClearHistory").disabled = true;
      return;
    }
    conversations.forEach(conversation => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "tc-ai-thread" + (conversation.id === currentConversationId ? " active" : "");
      item.dataset.aiConversation = conversation.id;
      item.setAttribute("role", "listitem");
      const title = document.createElement("strong");
      title.textContent = conversation.title || "Yeni söhbət";
      const preview = document.createElement("span");
      preview.textContent = conversation.preview || "Söhbət boşdur";
      item.append(title, preview);
      list.append(item);
    });
    $("aiClearHistory").disabled = busy;
  }

  function render() {
    renderConversations();
    renderMessages();
  }

  function setBusy(value) {
    busy = value;
    $("aiAssistantSend").disabled = value;
    $("aiAssistantInput").disabled = value;
    $("aiNewConversation").disabled = value;
    $("aiClearHistory").disabled = value || !conversations.length;
    $("aiVoiceInput").disabled = value;
    document.querySelectorAll(".tc-ai-thread").forEach(button => { button.disabled = value; });
  }

  async function loadConversation(id) {
    const selected = await request(`/api/ai-assistant/conversations/${encodeURIComponent(id)}/select`, { method: "POST" });
    currentConversationId = selected.currentConversationId;
    messages = await request(`/api/ai-assistant/history?conversationId=${encodeURIComponent(currentConversationId)}`);
    $("aiPage").classList.remove("tc-ai-show-history");
    $("aiHistoryToggle").setAttribute("aria-expanded", "false");
    setStatus("");
    render();
  }

  async function createConversation() {
    const result = await request("/api/ai-assistant/conversations", { method: "POST" });
    currentConversationId = result.currentConversationId;
    conversations = [result.conversation, ...conversations.filter(item => item.id !== currentConversationId)];
    conversations = conversations.slice(0, 12);
    messages = [];
    $("aiPage").classList.remove("tc-ai-show-history");
    $("aiHistoryToggle").setAttribute("aria-expanded", "false");
    setStatus("");
    render();
    $("aiAssistantInput").focus();
  }

  async function load() {
    if (loading || busy) return;
    loading = true;
    setBusy(true);
    setStatus("");
    root.setAttribute("aria-busy", "true");
    try {
      const data = await request("/api/ai-assistant/conversations");
      conversations = Array.isArray(data.conversations) ? data.conversations : [];
      currentConversationId = data.currentConversationId || conversations[0]?.id || null;
      if (!currentConversationId) {
        messages = [];
        render();
        return;
      }
      if (currentConversationId !== data.currentConversationId) {
        await request(`/api/ai-assistant/conversations/${encodeURIComponent(currentConversationId)}/select`, { method: "POST" });
      }
      messages = await request(`/api/ai-assistant/history?conversationId=${encodeURIComponent(currentConversationId)}`);
      render();
    } catch (error) {
      root.replaceChildren();
      setStatus(error.message, true);
    } finally {
      loading = false;
      root.removeAttribute("aria-busy");
      setBusy(false);
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
        body: JSON.stringify({ message, conversationId: currentConversationId })
      });
      messages.push(result.userMessage, result.message);
      messages = messages.slice(-60);
      currentConversationId = result.currentConversationId;
      conversations = [result.conversation, ...conversations.filter(item => item.id !== currentConversationId)].slice(0, 12);
      input.value = "";
      setStatus("");
      render();
    } catch (error) {
      pending.remove();
      setStatus(error.message, true);
    } finally {
      root.removeAttribute("aria-busy");
      setBusy(false);
      input.focus();
    }
  });

  $("aiNewConversation").addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    try {
      await createConversation();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  });

  $("aiConversationList").addEventListener("click", async event => {
    const button = event.target.closest("[data-ai-conversation]");
    if (!button || busy || button.dataset.aiConversation === currentConversationId) return;
    setBusy(true);
    try {
      await loadConversation(button.dataset.aiConversation);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  });

  $("aiHistoryToggle").addEventListener("click", () => {
    const open = !$("aiPage").classList.contains("tc-ai-show-history");
    $("aiPage").classList.toggle("tc-ai-show-history", open);
    $("aiHistoryToggle").setAttribute("aria-expanded", String(open));
  });

  $("aiClearHistory").addEventListener("click", async () => {
    if (busy || !conversations.length) return;
    if (!window.confirm("Bütün AI söhbətlərini bu hesabdan silmək istəyirsən?")) return;
    setBusy(true);
    try {
      await request("/api/ai-assistant/history", { method: "DELETE" });
      conversations = [];
      currentConversationId = null;
      messages = [];
      render();
      setStatus("AI söhbət tarixçəsi silindi.");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  });

  $("aiAssistantInput").addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("aiAssistantForm").requestSubmit();
    }
  });

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (typeof Recognition === "function") {
    try {
      recognition = new Recognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => {
        $("aiVoiceInput").classList.add("listening");
        $("aiVoiceInput").setAttribute("aria-pressed", "true");
        setStatus("Dinləyir… danışıb qurtaranda sual göndəriləcək.");
      };
      recognition.onresult = event => {
        const transcript = String(event.results?.[0]?.[0]?.transcript || "").trim();
        if (!transcript) {
          setStatus("Səs tanınmadı. Sualını mətnlə yaz.");
          return;
        }
        $("aiAssistantInput").value = transcript.slice(0, 2000);
        $("aiAssistantForm").requestSubmit();
      };
      recognition.onerror = event => {
        const message = event.error === "not-allowed"
          ? "Mikrofon icazəsi verilmədi. Mətnlə davam edə bilərsən."
          : "Səs tanınmadı. Yenidən yoxla və ya mətnlə yaz.";
        setStatus(message, event.error !== "no-speech");
      };
      recognition.onend = () => {
        $("aiVoiceInput").classList.remove("listening");
        $("aiVoiceInput").setAttribute("aria-pressed", "false");
      };
    } catch {
      recognition = null;
    }
  }
  if (!recognition) {
    $("aiVoiceInput").hidden = true;
  } else {
    $("aiVoiceInput").addEventListener("click", () => {
      if (busy) return;
      try {
        recognition.lang = speechLocale($("aiAssistantInput").value || "");
        recognition.start();
      } catch {
        setStatus("Mikrofon başladılmadı. Yenidən yoxla və ya mətnlə yaz.", true);
      }
    });
  }

  window.TalkChatAI = { load };
})();
