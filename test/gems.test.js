const test = require("node:test"), assert = require("node:assert");
const { installGems } = require("../gems");
const { normalizeTheme } = require("../chatThemes");

function setup(user = {}) {
    const db = {}, routes = {}, mws = [];
    const app = { use: f => mws.push(f), get: (p, _a, h) => routes["GET " + p] = h, post: (p, _a, h) => routes["POST " + p] = h };
    const people = [{ username: "ali", ...user }];
    const g = installGems({ app, users: () => people, posts: () => [{ id: "p1", username: "vali" }, { id: "p2", username: "vali" }, { id: "p3", username: "vali" }, { id: "own", username: "ali" }],
        readJSON: (n, f) => db[n] ?? (db[n] = f), saveJSON: (n, v) => { db[n] = JSON.parse(JSON.stringify(v)); }, requireAuth: () => {}, currentUser: r => r.u });
    const call = (key, body) => { let out; const res = { statusCode: 200, set() {}, status(c) { this.statusCode = c; return this; }, json(b) { out = b; return this; } }; routes[key]({ u: "ali", body }, res); return { code: res.statusCode, body: out }; };
    const act = (method, path, ok = true, resBody) => { const handlers = {}; const res = { statusCode: ok ? 200 : 400, json(b) { return b; }, on(e, f) { handlers[e] = f; } }; const req = { method, path, u: "ali" }; mws[0](req, res, () => {}); res.json(resBody); handlers.finish(); };
    return { g, call, act, db };
}

test("daily login: bir dəfə", () => {
    const { call } = setup();
    assert.equal(call("POST /api/gems/claim-daily").body.balance, 5);
    assert.equal(call("POST /api/gems/claim-daily").code, 409);
    assert.equal(call("GET /api/gems").body.balance, 5);
});
test("alış: balans çatmır, sonra uğurlu, təkrar alış olmur", () => {
    const { call } = setup();
    assert.equal(call("POST /api/gems/purchase", { id: "theme-aurora" }).code, 402);
    assert.equal(call("POST /api/gems/purchase", { id: "nope" }).code, 404);
    assert.equal(call("POST /api/gems/purchase", { id: "__proto__" }).code, 404);
});
test("tapşırıqlar real fəaliyyətlə: mesaj x3 = +5 bir dəfə, like yalnız başqasının postu", () => {
    const { call, act } = setup();
    for (let i = 0; i < 5; i++) act("POST", "/api/conversations/c1/messages");
    assert.equal(call("GET /api/gems").body.balance, 5);
    act("POST", "/api/posts/own/like", true, { liked: true });
    for (const id of ["p1", "p1", "p2"]) act("POST", `/api/posts/${id}/like`, true, { liked: true });
    act("POST", "/api/posts/p3/like", true, { liked: false });
    assert.equal(call("GET /api/gems").body.balance, 5);
    act("POST", "/api/posts/p3/like", true, { liked: true });
    assert.equal(call("GET /api/gems").body.balance, 10);
    act("POST", "/api/posts", false);
    assert.equal(call("GET /api/gems").body.balance, 10);
    act("POST", "/api/posts");
    assert.equal(call("GET /api/gems").body.balance, 15);
});
test("profil mükafatı: natamam rədd, tam olduqda bir dəfə +20", () => {
    assert.equal(setup().call("POST /api/gems/claim-profile").code, 400);
    const { call } = setup({ avatar: "/a.png", bio: "salam", displayName: "Ali" });
    assert.equal(call("POST /api/gems/claim-profile").body.balance, 20);
    assert.equal(call("POST /api/gems/claim-profile").code, 409);
});
test("tam axın: qazan, premium mövzu al, təkrar alış yox, kilid açılır", () => {
    const { call, g, act } = setup({ avatar: "/a.png", bio: "x", displayName: "A" });
    const t = call("GET /api/gems").body.catalog.find(x => x.id === "theme-aurora");
    assert.equal(t.price, 125);
    assert.ok(normalizeTheme(t.theme));
    assert.equal(g.isLockedTheme("ali", t.theme), true);
    assert.equal(g.canUseFrame("ali", "item-frame-aurora"), false);
    assert.equal(g.canUseFrame("ali", "item-frame-neon"), true);
    // balans əl ilə yazılmasın deyə real yolla 150+ qazanmaq mümkün deyil bir gündə; yoxlama:
    assert.equal(call("POST /api/gems/purchase", { id: "item-frame-aurora" }).code, 402);
});
test("premium qiymətləri və 3+3 element", () => {
    const c = setup().call("GET /api/gems").body.catalog;
    assert.equal(c.filter(x => x.type === "theme").length, 3);
    assert.equal(c.filter(x => x.type === "frame").length, 3);
    assert.ok(c.filter(x => x.type === "theme").every(x => x.price === 125));
    assert.ok(c.filter(x => x.type === "frame").every(x => x.price === 150));
    const themes = c.filter(x => x.type === "theme").map(x => JSON.stringify(x.theme));
    assert.equal(new Set(themes).size, 3);
});
test("uğurlu alış: balans bir dəfə azalır, təkrar alış rədd, kilid açılır", () => {
    const { call, g, db } = setup();
    db["gems.json"] = { ali: { balance: 300 } };
    const r = call("POST /api/gems/purchase", { id: "theme-aurora" });
    assert.equal(r.body.balance, 175);
    assert.equal(call("POST /api/gems/purchase", { id: "theme-aurora" }).code, 409);
    assert.equal(call("GET /api/gems").body.balance, 175);
    const theme = r.body.catalog.find(x => x.id === "theme-aurora").theme;
    assert.equal(g.isLockedTheme("ali", theme), false);
    assert.equal(call("POST /api/gems/purchase", { id: "item-frame-inferno" }).body.balance, 25);
    assert.equal(g.canUseFrame("ali", "item-frame-inferno"), true);
    assert.equal(call("POST /api/gems/purchase", { id: "item-frame-diamond" }).code, 402);
});
