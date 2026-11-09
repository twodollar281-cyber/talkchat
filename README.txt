TALKCHAT — SESLİ ARAMA YAMASI (calls.js v1)
===========================================

Bu pakette:
  calls.js            yeni arama kodu (sessize alma + ekran paylaşımı + gelen arama ekranı)
  calls.css           arama ekranının tasarımı (TalkChat moru)
  index.html          düzeltilmiş sayfa (aşağıdaki "index.html'de ne değişti" bölümüne bak)
  remove-old-calls.js app.js içindeki eski arama bloğunu güvenle siler

KURULUM (Termux)
----------------
1) Zip'i ayrı bir klasöre çıkar, sadece gereken dosyaları public/ içine kopyala:
     cd ~/talkchat
     mkdir -p ~/tc-patch && unzip -o ~/storage/downloads/talkchat-calls-v3.zip -d ~/tc-patch
     cp public/index.html public/index.html.bak
     cp ~/tc-patch/calls.js ~/tc-patch/calls.css ~/tc-patch/index.html public/

2) Eski arama bloğunu app.js'ten sil (yedek alır):
     node ~/tc-patch/remove-old-calls.js public/app.js

3) Sunucuyu yeniden başlat:  npm start
   Tarayıcıda sayfayı sert yenile (önbellek temizle) — index.html dosya sürümlerini zaten yükseltti.

index.html'de ne değişti
------------------------
- Arama düğmesi büyüteç (⌕) yerine telefon simgesi oldu ve id="tcCallBtn" aldı.
  (Dil çevirisi aria-label'i değiştirebildiği için düğme artık id ile bulunuyor.)
- 115. satırda ekranda görünen "\n" yazısı silindi  (</details>\n  ->  </details>).
- calls.css ve calls.js eklendi, app.js sürümü yükseltildi.
- Dosyanın sonundaki "~/talkchat $" terminal satırı temizlendi.

ÖNEMLİ: HTTPS
-------------
Tarayıcılar mikrofonu sadece güvenli bağlantıda açar. İstisna: http://localhost (sunucuyla aynı cihaz).
Başka telefon/bilgisayar http://192.168.x.x:3000 ile bağlanırsa mikrofon ve ekran paylaşımı ÇALIŞMAZ.
Bu durumda arama ekranı açıklayıcı bir uyarı gösterir. Çözüm: sunucuyu HTTPS ile aç
(kendinden imzalı sertifika yeterli). Bunun için server.js'e bakmam gerekir.

SUNUCU GEREKSİNİMİ
------------------
calls.js senin mevcut socket olaylarını kullanır; sunucunun bunları karşı tarafa AYNEN iletmesi gerekir:
  call:invite   {conversationId}               -> karşıya call:incoming {conversationId, from}
  call:accept   {conversationId}               -> arayana  call:accepted {conversationId}
  call:reject   {conversationId}               -> arayana  call:rejected {conversationId}
  call:end      {conversationId}               -> karşıya  call:ended    {conversationId}
  call:signal   {conversationId, signal}       -> karşıya  call:signal   {conversationId, signal}
Yeni olan: signal içinde { muted: true/false } ve { screen: true/false } de gönderilir.
Sunucu "signal" nesnesini olduğu gibi iletmiyor, sadece description/candidate'i geçiriyorsa
sessize alma bildirimi ve ekran paylaşımı karşı tarafta görünmez.

FARKLI AĞLAR (mobil veri <-> Wi-Fi)
-----------------------------------
Varsayılan olarak Google'ın ücretsiz STUN sunucusu kullanılır. Bazı operatörlerde doğrudan bağlantı kurulamaz,
o zaman TURN sunucusu gerekir. index.html'de calls.js'ten ÖNCE şunu ekleyebilirsin:
  <script>window.TC_ICE_SERVERS=[{urls:"stun:stun.l.google.com:19302"},{urls:"turn:turn.ornek.com:3478",username:"kullanici",credential:"sifre"}];</script>

EKRAN PAYLAŞIMI TARAYICI DESTEĞİ
--------------------------------
Çoğunlukla bilgisayardaki Chrome, Edge, Firefox, Safari destekler. Telefon tarayıcılarının çoğu paylaşamaz;
destek yoksa düğmeye basınca açıklama çıkar. Karşı tarafın paylaştığı ekranı ise her cihazda görürsün.

SINIRLAR
--------
- Sadece birebir sohbetlerde (grupta arama yok).
- Zil, sayfa açıkken çalar; sayfa arka plandaysa tarayıcı bildirimi gösterilir (izin verilmişse).
- Cevapsız arama kaydı sohbete düşmez (bunun için sunucu tarafı gerekir).
- Kodda ayrıca iki yerde "newMessage" dinleyicisi var; bu her mesajda sohbetin iki kez yenilenmesine yol açar (bu yama ona dokunmadı).


GIF MESSAGING
-------------
GIF search uses the official GIPHY API through the TalkChat server. Set the server-side environment variable GIPHY_API_KEY in the host secret store; never add the key to browser code or commit its value. Without the key, search and category endpoints return a clear configuration error; existing messages, favorites, recent GIFs, and sticker messaging remain available. The picker displays the required Powered by GIPHY attribution. Historical Tenor GIF URLs remain supported so previously stored messages and favorites continue to display; no Tenor API calls remain.

LIVE STREAMING
--------------
Live streams use peer-to-peer WebRTC without a paid provider or API key. Browser HTTPS, a camera/microphone permission, and a compatible network are required. The current implementation supports up to 10 viewers; see docs/live-streaming.md for limitations and setup details.

TALKCHAT AI ASSISTANT
---------------------
The assistant uses Cloudflare Workers AI with @cf/zai-org/glm-4.7-flash. Keep CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the Render server environment only. AI is disabled unless AI_ENABLED=true and CLOUDFLARE_OWNER_VERIFIED=true are set after an adult account owner verifies the Cloudflare billing settings; both flags default to false. Default caps are 8 requests per account per UTC day and 3 per user per minute; configured values are clamped to 40/day and 6/minute. These request limits do not guarantee a dollar ceiling. Workers Free has a 10,000-Neuron daily allocation; Workers Paid bills usage above it. See docs/ai-assistant.md before enabling.
