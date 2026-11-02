// FCM push bildirişləri. FIREBASE_SERVICE_ACCOUNT env dəyişəni təyin olunmayıbsa, push sadəcə söndürülür (server işləməyə davam edir).
const TEXT = {
    tr: { call: n => `${n} seni arıyor!`, message: n => `${n} mesaj attı!`, groupCall: n => `${n} grup sesli araması başlattı!` },
    az: { call: n => `${n} sənə zəng edir!`, message: n => `${n} mesaj göndərdi!`, groupCall: n => `${n} qrup səsli zəngi başlatdı!` },
    en: { call: n => `${n} is calling you!`, message: n => `${n} sent you a message!`, groupCall: n => `${n} started a group voice call!` },
    ru: { call: n => `${n} звонит вам!`, message: n => `${n} отправил(а) вам сообщение!`, groupCall: n => `${n} начал(а) групповой звонок!` }
};

let messagingInstance; // undefined = hələ yoxlanmayıb, false = söndürülüb, object = aktiv
function getMessaging() {
    if (messagingInstance !== undefined) return messagingInstance;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        console.log("FCM söndürülüb: FIREBASE_SERVICE_ACCOUNT təyin edilməyib.");
        messagingInstance = false;
        return messagingInstance;
    }
    try {
        const admin = require("firebase-admin");
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
        messagingInstance = admin.messaging();
    } catch (e) {
        console.error("FCM başladıla bilmədi:", e.message);
        messagingInstance = false;
    }
    return messagingInstance;
}

function createPush({ readJSON, saveJSON }) {
    const load = () => readJSON("pushTokens.json");

    return {
        register(username, token, lang) {
            const list = load().filter(x => x.token !== token);
            list.push({ username, token, lang: TEXT[lang] ? lang : "tr", updatedAt: new Date().toISOString() });
            saveJSON("pushTokens.json", list);
        },
        async send(username, kind, fromName, extraData = {}) {
            const messaging = getMessaging();
            if (!messaging) { console.log("FCM: messaging yoxdur"); return; }
            const mine = load().filter(x => x.username === username);
            console.log("FCM: token sayi", username, mine.length);
            for (const t of mine) {
                const texts = TEXT[t.lang] || TEXT.tr;
                const body = kind === "call" ? texts.call(fromName)
                    : kind === "group-call" ? texts.groupCall(fromName)
                    : texts.message(fromName);
                try {
                    const r = await messaging.send({
                        token: t.token,
                        notification: { title: "TalkChat", body },
                        data: { kind, sender: String(fromName || ""), ...Object.fromEntries(Object.entries(extraData).map(([k, v]) => [k, String(v)])) },
                        android: {
                            priority: "high",
                            notification: { channelId: kind === "call" ? "calls" : "messages" }
                        }
                    });
                    console.log("FCM gonderildi:", username, kind, r);
                } catch (e) {
                    const code = e.code || e.message || "";
                    console.error("FCM xeta:", code, e.message);
                    if (/registration-token-not-registered|invalid-registration-token/.test(code)) {
                        saveJSON("pushTokens.json", load().filter(x => x.token !== t.token));
                    } else {
                        console.error("Push göndərilmədi:", code);
                    }
                }
            }
        }
    };
}

module.exports = { createPush };
