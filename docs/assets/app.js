const translations = {
  az: {
    navExperience:"Təcrübə",navFeatures:"Xüsusiyyətlər",navAbout:"Haqqımızda",navDownload:"Yüklə",
    eyebrow:"Sənin sosial məkanın",heroTitle:'Söhbət başlayır.<br><span class="gradient-text">Dünya yaxınlaşır.</span>',
    heroText:"Dostlarınla əlaqədə qal, anlarını paylaş və maraqlı məzmunları kəşf et. TalkChat ünsiyyət üçün yaratdığın məkandır.",
    downloadAndroid:"Android üçün yüklə",explore:"Kəşf et",heroMeta:"TalkChat-in rəsmi təqdimat səhifəsi",
    experienceTitle:'Sosial həyatın, <span class="gradient-text">öz ritmində.</span>',
    experienceText:"Söhbətlərdən paylaşımlara qədər — gündəlik ünsiyyətin üçün vahid təcrübə.",
    messagesTitle:"Söhbəti davam etdir.",messagesText:"Şəxsi və qrup söhbətləri ilə əlaqəni qoruyub saxla.",
    storiesTitle:"Anlarını paylaş.",storiesText:"Gündəlik anlarını Stories formatında paylaş.",
    reelsTitle:"Kəşf et və yarat.",reelsText:"Qısa videoları izlə və öz yaradıcılığını paylaş.",
    featuresTitle:'Lazım olanlar.<br><span class="gradient-text">Bir məkanda.</span>',
    featuresText:"TalkChat-in müxtəlif bölmələri bir-birini tamamlayaraq sosial təcrübəni bir araya gətirir.",
    postsText:"Fikirlərini və şəkillərini paylaş.",profilesText:"Öz profilini qur və insanları tanı.",
    discoverText:"Yeni məzmun və maraqlı profillər tap.",notificationsText:"Yeniliklərdən xəbərdar ol.",
    downloadTitle:'TalkChat-ə<br><span class="gradient-text">qoşulmağa hazırsan?</span>',
    downloadText:"Tətbiqi Android cihazına yüklə və TalkChat təcrübəsini kəşf et.",
    downloadButton:"Android APK yüklə",downloadNote:"Rəsmi APK faylı bu səhifəyə əlavə edildikdən sonra yükləmə aktiv olacaq.",
    aboutTitle:'Ünsiyyət üçün<br><span class="gradient-text">yaradılmışdır.</span>',
    aboutText:"TalkChat insanları, söhbətləri və paylaşımları bir araya gətirmək məqsədi ilə hazırlanmış sosial platformadır. Bu sayt TalkChat-in rəsmi təqdimat məkanıdır.",
    footerLine:"Sənin sosial məkanın.",privacy:"Məxfilik",contact:"Əlaqə",rights:"Bütün hüquqlar qorunur."
  },
  en: {
    navExperience:"Experience",navFeatures:"Features",navAbout:"About",navDownload:"Download",
    eyebrow:"Your social space",heroTitle:'Where conversations begin.<br><span class="gradient-text">And worlds come closer.</span>',
    heroText:"Stay connected with friends, share your moments and discover content that inspires you. TalkChat is your space to connect.",
    downloadAndroid:"Get it for Android",explore:"Explore",heroMeta:"The official TalkChat presentation",
    experienceTitle:'Your social life, <span class="gradient-text">your own rhythm.</span>',
    experienceText:"From conversations to sharing — one connected experience for everyday communication.",
    messagesTitle:"Keep the conversation going.",messagesText:"Stay in touch through personal and group conversations.",
    storiesTitle:"Share your moments.",storiesText:"Share everyday moments through Stories.",
    reelsTitle:"Discover and create.",reelsText:"Watch short videos and share your creativity.",
    featuresTitle:'Everything you need.<br><span class="gradient-text">In one space.</span>',
    featuresText:"Different parts of TalkChat come together to create one social experience.",
    postsText:"Share your thoughts and photos.",profilesText:"Build your profile and get to know people.",
    discoverText:"Find fresh content and interesting profiles.",notificationsText:"Stay up to date with activity.",
    downloadTitle:'Ready to join<br><span class="gradient-text">the TalkChat space?</span>',
    downloadText:"Get the app on your Android device and explore the TalkChat experience.",
    downloadButton:"Download Android APK",downloadNote:"The download becomes available once the official APK is added to this page.",
    aboutTitle:'Created for<br><span class="gradient-text">connection.</span>',
    aboutText:"TalkChat is a social platform created to bring people, conversations and sharing together. This is the official presentation space for TalkChat.",
    footerLine:"Your social space.",privacy:"Privacy",contact:"Contact",rights:"All rights reserved."
  }
};
let currentLang = "az";
const langButton = document.getElementById("languageToggle");
langButton?.addEventListener("click", () => {
  currentLang = currentLang === "az" ? "en" : "az";
  document.documentElement.lang = currentLang;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const value = translations[currentLang][el.dataset.i18n];
    if (value) el.innerHTML = value;
  });
  langButton.innerHTML = currentLang.toUpperCase() + " <span>⌄</span>";
});
const menuToggle = document.getElementById("menuToggle");
const nav = document.querySelector(".desktop-nav");
menuToggle?.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(open));
});
nav?.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
  nav.classList.remove("open");
  menuToggle?.setAttribute("aria-expanded", "false");
}));
document.getElementById("year").textContent = new Date().getFullYear();
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }
  });
}, {threshold: 0.12});
document.querySelectorAll(".experience-card,.feature-item,.section-heading,.download-panel,.about-inner").forEach(el => {
  el.classList.add("reveal");
  observer.observe(el);
});
// Prevent a broken-looking download until the APK is actually added.
document.getElementById("apkDownload")?.addEventListener("click", event => {
  const link = event.currentTarget.getAttribute("href");
  if (!link || link === "#") {
    event.preventDefault();
    alert(currentLang === "az" ? "APK faylı hələ əlavə edilməyib." : "The APK file has not been added yet.");
  }
});