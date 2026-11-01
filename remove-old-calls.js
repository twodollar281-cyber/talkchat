// Kullanım:  node remove-old-calls.js public/app.js
// app.js içindeki eski "TALKCHAT_AUDIO_CALLS_V2" arama bloğunu siler (önce .bak yedeği alır).
// Yeni arama kodu calls.js dosyasındadır; ikisi aynı anda açık kalırsa arama iki kez tetiklenir.
const fs = require("fs");
const file = process.argv[2];
if (!file) { console.error("Kullanım: node remove-old-calls.js public/app.js"); process.exit(1); }

const src = fs.readFileSync(file, "utf8");
const start = src.indexOf("/* TALKCHAT_AUDIO_CALLS_V2 */");
if (start < 0) { console.log("Eski arama bloğu zaten yok (ya da daha önce silinmiş). Dosya değişmedi."); process.exit(0); }
const end = src.indexOf("\n})();", start); // blok bir (() => { ... })(); içinde
if (end < 0) { console.error("Bloğun sonu bulunamadı, dosya değişmedi."); process.exit(1); }

fs.writeFileSync(file + ".bak", src);
fs.writeFileSync(file, src.slice(0, start).replace(/\s+$/, "\n") + src.slice(end + "\n})();".length).replace(/^\s*\n/, "\n"));
console.log("Eski arama bloğu silindi. Yedek: " + file + ".bak");
