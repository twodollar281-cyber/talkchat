"use strict";

// Verified navigation and feature notes from the active TalkChat UI and routes.
// Update these entries alongside public/index.html, public/app.js, public/social.js,
// public/calls.js, public/group-calls.js, public/admin.js and the matching server routes.
const KNOWLEDGE = [
  {
    id: "home",
    title: "Ana səhifə və lent",
    aliases: ["ana səhifə", "home", "lent", "feed", "izlədiklərim", "kəşf lent"],
    guidance: "Ana səhifə aşağı naviqasiya menyusundadır; lentdə hamının paylaşımını və ya izlədiklərini seçmək olur.",
    navigation: { type: "page", page: "home", label: "Ana səhifəni aç" },
    sources: ["public/index.html", "public/app.js", "server.js"]
  },
  {
    id: "discover",
    title: "Discover və istifadəçi axtarışı",
    aliases: ["discover", "kəşf et", "axtarış", "istifadəçi axtar", "dost tap", "insan tap"],
    guidance: "Discover aşağı naviqasiya menyusundan açılır; istifadəçi adı ilə axtarış və dostluq sorğuları oradadır.",
    navigation: { type: "page", page: "discover", label: "Discover-i aç" },
    sources: ["public/index.html", "public/app.js", "server.js"]
  },
  {
    id: "ai-assistant",
    title: "TalkChat AI Assistant",
    aliases: ["talkchat ai", "ai assistant", "süni intellekt", "yeni ai söhbəti", "ai tarixçə"],
    guidance: "AI Assistant Mesajlar səhifəsinin başlığındakı AI Assistant düyməsindən və üç xətli menyudan açılır. Söhbət tarixçəsi və yeni söhbət düymələri ayrıca tam ekranlı səhifədədir.",
    navigation: { type: "page", page: "ai", label: "AI Assistant-i aç" },
    sources: ["public/index.html", "public/app.js", "public/ai-assistant.js"]
  },
  {
    id: "profile-link",
    title: "Profil və profil linki",
    aliases: ["profil link", "profilə link", "profil", "link", "link əlavə", "website profil", "bio", "profilimi redaktə", "profile link"],
    guidance: "Aşağı naviqasiya menyusu → Profil → Link əlavə et; ünvanı daxil edib Profili yadda saxla düyməsini bas.",
    navigation: { type: "page", page: "profile", label: "Profili aç" },
    sources: ["public/index.html", "public/app.js", "server.js"]
  },
  {
    id: "profile-settings",
    title: "Profil, məxfilik və hesab ayarları",
    aliases: ["profil ayar", "hesab ayar", "məxfilik", "privacy", "onlayn görün", "son görülmə", "dil dəyiş", "mövzu rəngi"],
    guidance: "Aşağı naviqasiya menyusu → Profil. Ad, açıqlama, link, profil görünüşü, onlayn/son görülmə və profil, post, Story, mesaj və dostluq sorğusu məxfiliyi burada redaktə olunur.",
    navigation: { type: "page", page: "profile", label: "Profil ayarlarını aç" },
    sources: ["public/index.html", "public/app.js", "server.js"]
  },
  {
    id: "share-post",
    title: "Post paylaşmaq",
    aliases: ["post paylaş", "post necə", "post", "paylaşım et", "paylaş", "şəkil paylaş", "yeni post", "share post"],
    guidance: "Üç xəttli menyu → Post Paylaş. Mətn və şəkil əlavə edib Post Paylaş düyməsini bas.",
    navigation: { type: "share", mode: "post", label: "Post paylaşma pəncərəsini aç" },
    sources: ["public/index.html", "public/social.js", "server.js"]
  },
  {
    id: "share-story",
    title: "Story paylaşmaq",
    aliases: ["story paylaş", "story necə", "paylaş", "hekayə paylaş", "story əlavə", "share story"],
    guidance: "Üç xəttli menyu → Story Paylaş. Şəkil və ya video seçib paylaş; Story 24 saat görünür.",
    navigation: { type: "share", mode: "story", label: "Story paylaşma pəncərəsini aç" },
    sources: ["public/index.html", "public/social.js", "server.js"]
  },
  {
    id: "share-reel",
    title: "Reels paylaşmaq",
    aliases: ["reels paylaş", "reel paylaş", "reels necə", "reels", "paylaş", "reels əlavə", "video paylaş", "share reel"],
    guidance: "Üç xəttli menyu → Reels Paylaş. MP4 və ya WebM video seçib paylaş.",
    navigation: { type: "share", mode: "reel", label: "Reels paylaşma pəncərəsini aç" },
    sources: ["public/index.html", "public/social.js", "server.js"]
  },
  {
    id: "reels",
    title: "Reels lenti",
    aliases: ["reels", "reel videolar", "reels lent", "reels bax"],
    guidance: "Reels bölməsi üç xətli menyudadır. Yeni Reels paylaşmaq üçün həmin bölmədəki Reels Paylaş düyməsini və ya menyudakı paylaşma seçimini istifadə et.",
    navigation: { type: "page", page: "reels", label: "Reels bölməsini aç" },
    sources: ["public/index.html", "public/social.js", "server.js"]
  },
  {
    id: "post-actions",
    title: "Post və Reels əməliyyatları",
    aliases: ["post bəyən", "post şərh", "postu paylaş", "paylaşımı göndər", "post yadda saxla", "reels bəyən", "reels şərh"],
    guidance: "Ana səhifədə postu bəyənmək, şərh yazmaq, söhbətə göndərmək və yadda saxlamaq üçün paylaşımın altındakı düymələr var. Yadda saxlanmış kolleksiyalar Profil bölməsindədir. Reels üçün oxşar bəyənmə, şərh, göndərmə və yadda saxlama əməliyyatları Reels lentində mövcuddur.",
    navigation: { type: "page", page: "home", label: "Ana səhifəni aç" },
    sources: ["public/app.js", "public/social.js", "public/index.html", "server.js"]
  },
  {
    id: "messages",
    title: "Şəxsi mesajlar və yeni söhbət",
    aliases: ["mesajlar", "messages", "message", "şəxsi mesaj", "dm", "yeni söhbət", "yeni mesaj", "chat başlat", "çat aç"],
    guidance: "Mesajlar aşağı naviqasiya menyusundadır. Yeni söhbət üçün Mesajlar bölməsində sağ yuxarıdakı qələm düyməsinə bas, istifadəçi adını yaz və Söhbət aç seç.",
    navigation: { type: "page", page: "messages", label: "Mesajları aç" },
    sources: ["public/index.html", "public/app.js", "server.js"]
  },
  {
    id: "groups",
    title: "Qrup söhbəti",
    aliases: ["qrup yarat", "qrup söhbət", "qrup chat", "group chat", "qrupa əlavə"],
    guidance: "Mesajlar bölməsində yeni mesaj qələminə bas; açılan hissədə Qrup yarat bölməsini genişləndir, qrup adını və iştirakçı istifadəçi adlarını daxil et.",
    navigation: { type: "page", page: "messages", label: "Mesajları aç" },
    sources: ["public/index.html", "public/app.js", "server.js", "public/group-calls.js"]
  },
  {
    id: "stories-and-requests",
    title: "Story-lər və mesaj sorğuları",
    aliases: ["story gör", "story", "story bax", "hekayələrə bax", "hekayə", "mesaj sorğusu", "message request", "sorğunu qəbul", "story-lər"],
    guidance: "Mesajlar bölməsində Hekayə və mesaj istəkləri hissəsini aç. Aktiv Story-lər və mesaj sorğuları orada görünür.",
    navigation: { type: "page", page: "messages", label: "Mesajları aç" },
    sources: ["public/index.html", "public/app.js", "server.js"]
  },
  {
    id: "message-edit",
    title: "Mesajı redaktə etmək",
    aliases: ["mesaj redaktə", "mesaj dəyiş", "mesajı edit", "edit message", "edit", "message", "mesaj", "redaktə", "redakte"],
    guidance: "Mesajlar bölməsində öz mesajının üzərinə basıb saxla (kompüterdə sağ klik); menyuda Redaktə et seçimi varsa, oradan dəyiş. Yalnız öz mesajını redaktə etmək mümkündür.",
    navigation: { type: "page", page: "messages", label: "Mesajları aç" },
    sources: ["public/app.js", "server.js", "test/server-review-fixes.test.js"]
  },
  {
    id: "message-actions",
    title: "Mesaj əməliyyatları",
    aliases: ["mesaj sil", "mesaj yönləndir", "mesaj forward", "mesaj cavab", "mesaja reaksiya", "mesaj emoji"],
    guidance: "Mesajın üzərinə basıb saxla (kompüterdə sağ klik) — əməliyyat menyusu açılır. Mövcud seçimlərə cavab vermək, yönləndirmək, reaksiya əlavə etmək və öz mesajını silmək daxildir; icazə qaydaları tətbiq olunur.",
    navigation: { type: "page", page: "messages", label: "Mesajları aç" },
    sources: ["public/app.js", "server.js", "test/server-review-fixes.test.js"]
  },
  {
    id: "message-tools",
    title: "Mesaj axtarışı və fayllar",
    aliases: ["mesaj axtar", "söhbətdə axtar", "çat faylları", "fayl göndər", "şəkil göndər", "səsli mesaj", "voice message", "gif göndər", "sticker göndər"],
    guidance: "Söhbət başlığındakı axtarış işarəsi mesajları axtarır, fayl işarəsi paylaşılan faylları açır. Mesaj yazma sahəsində şəkil, kamera, fayl, səsli mesaj, GIF və sticker düymələri var.",
    navigation: { type: "page", page: "messages", label: "Mesajları aç" },
    sources: ["public/index.html", "public/app.js", "public/social.js", "server.js"]
  },
  {
    id: "calls",
    title: "Səsli və video zənglər",
    aliases: ["video zəng", "videozəng", "səsli zəng", "zəng et", "call", "arama"],
    guidance: "Birbaşa söhbəti aç. Söhbət başlığındakı telefon işarəsi səsli, kamera işarəsi video zəng üçündür. Zənglər şəxsi söhbətdə işləyir; kamera/mikrofon icazəsi və təhlükəsiz bağlantı tələb oluna bilər.",
    navigation: { type: "page", page: "messages", label: "Mesajları aç" },
    sources: ["public/index.html", "public/calls.js", "server.js"]
  },
  {
    id: "group-calls",
    title: "Qrup zəngləri",
    aliases: ["qrup zəngi", "group call", "qrup video zəng", "qrup səsli zəng"],
    guidance: "Qrup söhbətini aç; qrup zəngi idarələri həmin söhbət üçün görünür. Qrup zəngi üçün mikrofon və kamera icazəsi lazım ola bilər.",
    navigation: { type: "page", page: "messages", label: "Mesajları aç" },
    sources: ["public/group-calls.js", "server.js"]
  },
  {
    id: "notifications",
    title: "Bildirişlər",
    aliases: ["bildiriş", "notifications", "notification", "xəbərdarlıq"],
    guidance: "Bildirişlər aşağı naviqasiya menyusundadır.",
    navigation: { type: "page", page: "notifications", label: "Bildirişləri aç" },
    sources: ["public/index.html", "public/app.js", "server.js"]
  },
  {
    id: "live-streams",
    title: "Canlı yayımlar",
    aliases: ["canlı yayım", "live stream", "live yayım", "canlı başlat", "yayım yarat"],
    guidance: "Üç xətli menyu → Canlı yayımlar. Canlı yayım yarat, başlıq yaz və Canlı başlat seç. Mövcud layihə WebRTC istifadə edir; şəbəkə və TURN quruluşu qoşulmaya təsir edə bilər.",
    navigation: { type: "page", page: "live", label: "Canlı yayımları aç" },
    sources: ["public/index.html", "public/live-streams.js", "liveStreams.js"]
  },
  {
    id: "saved-collections",
    title: "Yadda saxlanmış kolleksiyalar",
    aliases: ["yadda saxlanan", "kolleksiya", "saved post", "saxladığım paylaşım"],
    guidance: "Profil səhifəsində Yadda saxlanmış kolleksiyalar bölməsindən kolleksiya yarat və idarə et.",
    navigation: { type: "page", page: "profile", label: "Profil kolleksiyalarını aç" },
    sources: ["public/index.html", "public/saved-collections.js", "savedCollections.js"]
  },
  {
    id: "chat-themes",
    title: "Söhbət mövzusu",
    aliases: ["çat mövzusu", "söhbət mövzusu", "chat theme", "rəng dəyiş çat"],
    guidance: "Şəxsi söhbəti aç və başlıqdakı Çat mövzusu düyməsindən mövzu seç.",
    navigation: { type: "page", page: "messages", label: "Mesajları aç" },
    sources: ["public/index.html", "public/chat-themes.js", "chatThemes.js"]
  },
  {
    id: "privacy-and-safety",
    title: "İzləmə, bloklama və şikayət",
    aliases: ["istifadəçini blok", "blokla", "izləmədən çıx", "dostluq sorğusu", "istifadəçini şikayət", "postu şikayət"],
    guidance: "İstifadəçinin profilində İzlə, dostluq, Blokla və Hesabı şikayət et seçimləri var. Post və Reels menyularında Şikayət et seçimi mövcuddur. Şəxsi məlumatları yalnız icazəli istifadəçilər görə bilər.",
    navigation: { type: "page", page: "discover", label: "Discover-i aç" },
    sources: ["public/app.js", "public/social.js", "server.js"]
  },
  {
    id: "admin",
    title: "Admin və moderasiya paneli",
    aliases: ["admin panel", "moderator", "şikayətləri idarə", "istifadəçini ban", "rol dəyiş"],
    guidance: "Admin Paneli üç xətli menyuda yalnız uyğun rolu olan hesablara görünür. Moderator və daha yüksək rol şikayətləri, istifadəçi axtarışı və audit məlumatlarını görə bilər; rol dəyişmək və hesabı təsdiqləmək yalnız Owner üçündür. Server də hər sorğuda rol yoxlayır.",
    navigation: { type: "page", page: "admin", label: "Admin panelini aç" },
    sources: ["public/index.html", "public/admin.js", "server.js", "moderationPolicy.js"]
  },
  {
    id: "account-access",
    title: "Hesab yaratmaq və daxil olmaq",
    aliases: ["hesab yarat", "qeydiyyat", "daxil ol", "login", "şifrəni unut"],
    guidance: "TalkChat-in giriş səhifəsində Daxil ol və Hesab yarat tabları var. Bu layihədə şifrəni unutma axını təsdiqlənməyib; belə seçim görünmürsə, mövcud giriş dəstəyinə müraciət et.",
    sources: ["public/index.html", "public/app.js", "server.js"]
  }
];

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("az")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchKnowledge(question, limit = 3) {
  const query = normalizeText(question);
  if (!query) return [];
  const words = new Set(query.split(" ").filter(word => word.length > 2));
  const ranked = KNOWLEDGE.map(entry => {
    let score = 0;
    for (const alias of entry.aliases) {
      const normalized = normalizeText(alias);
      if (normalized.includes(" ") && query.includes(normalized)) score += 5;
      else if (query === normalized) score += 4;
      else if (words.has(normalized)) score += 3;
      else if (normalized.length >= 3 && [...words].some(word => word.startsWith(normalized))) score += 3;
      else if (normalized.length >= 4 && query.includes(normalized)) score += 2;
    }
    return { ...entry, score };
  }).filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  if (!ranked.length) return [];
  const minimumRelevantScore = Math.max(3, ranked[0].score * 0.45);
  return ranked.filter(entry => entry.score >= minimumRelevantScore)
    .slice(0, Math.max(0, Math.min(5, Number(limit) || 0)));
}

module.exports = { KNOWLEDGE, searchKnowledge, normalizeText };
