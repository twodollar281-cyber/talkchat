"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { installAIAssistant } = require("../aiAssistant");
const { searchKnowledge } = require("../talkchatKnowledge");

const ROUTES = {
  history: "/api/ai-assistant/history",
  conversations: "/api/ai-assistant/conversations",
  selectConversation: "/api/ai-assistant/conversations/:id/select",
  messages: "/api/ai-assistant/messages"
};
const ACCOUNT_ID = "a".repeat(32);
const TEST_ENV = {
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: "unit-test-placeholder-not-a-credential",
  AI_ENABLED: "true",
  CLOUDFLARE_OWNER_VERIFIED: "true"
};

function successResponse(content = "Test reply") {
  return { ok: true, status: 200, json: async () => ({
    success: true,
    result: { choices: [{ message: { content } }] }
  }) };
}

function makeHarness({ env = TEST_ENV, fetchImpl = async () => successResponse(), initialData = {} } = {}) {
  const routes = new Map();
  const store = JSON.parse(JSON.stringify(initialData));
  const rateCounts = new Map();
  const rateConfigs = [];
  let fetchCount = 0;
  const app = {
    get(path, ...handlers) { routes.set("GET " + path, handlers); },
    delete(path, ...handlers) { routes.set("DELETE " + path, handlers); },
    post(path, ...handlers) { routes.set("POST " + path, handlers); }
  };
  const readJSON = (name, fallback) => store[name] === undefined
    ? JSON.parse(JSON.stringify(fallback))
    : JSON.parse(JSON.stringify(store[name]));
  const saveJSON = (name, value) => { store[name] = JSON.parse(JSON.stringify(value)); };
  const currentUser = req => req.session?.username || null;
  const requireAuth = (req, res, next) => currentUser(req)
    ? next()
    : res.status(401).json({ error: "Unauthenticated" });
  const userRateLimit = (windowMs, limit, message) => {
    rateConfigs.push({ windowMs, limit, message });
    return (req, res, next) => {
      const key = currentUser(req) || "anonymous";
      const count = rateCounts.get(key) || 0;
      if (count >= limit) return res.status(429).json({ error: message });
      rateCounts.set(key, count + 1);
      return next();
    };
  };
  const countingFetch = async (...args) => {
    fetchCount++;
    return fetchImpl(...args);
  };
  installAIAssistant({ app, readJSON, saveJSON, requireAuth, currentUser, userRateLimit, env, fetchImpl: countingFetch });

  async function request(method, path, options = {}) {
    const handlers = routes.get(method.toUpperCase() + " " + path);
    assert.ok(handlers, "route exists: " + method + " " + path);
    const req = {
      session: options.session,
      body: options.body || {},
      query: options.query || {},
      params: options.params || {},
      ip: "127.0.0.1"
    };
    const res = {
      statusCode: 200,
      headers: {},
      body: undefined,
      finished: false,
      set(name, value) { this.headers[name] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; this.finished = true; return this; }
    };
    async function run(index) {
      if (index >= handlers.length || res.finished) return;
      let nextPromise;
      const result = handlers[index](req, res, () => {
        if (!nextPromise) nextPromise = run(index + 1);
        return nextPromise;
      });
      await result;
      if (nextPromise) await nextPromise;
    }
    await run(0);
    return { status: res.statusCode, headers: res.headers, body: res.body };
  }

  return { request, routes, rateConfigs, store, fetchCount: () => fetchCount, resetRateLimitWindow: () => rateCounts.clear() };
}

test("all AI endpoints require authentication before running handlers", async () => {
  const harness = makeHarness();
  for (const [method, path] of [
    ["GET", ROUTES.conversations],
    ["POST", ROUTES.conversations],
    ["POST", ROUTES.selectConversation],
    ["GET", ROUTES.history],
    ["DELETE", ROUTES.history],
    ["POST", ROUTES.messages]
  ]) {
    assert.equal(harness.routes.get(method + " " + path)[0].name, "requireAuth");
    const result = await harness.request(method, path, {
      body: { username: "other-user", message: "hello" },
      params: { id: "other-users-thread" }
    });
    assert.equal(result.status, 401);
  }
  assert.equal(harness.fetchCount(), 0);
});

test("history reads, writes, and deletion are scoped to the authenticated username", async () => {
  const harness = makeHarness({ initialData: { "aiAssistant.json": {
    alice: [{ id: "a1", role: "user", content: "Alice history", createdAt: "2026-01-01T00:00:00.000Z" }],
    bob: [{ id: "b1", role: "user", content: "Bob history", createdAt: "2026-01-01T00:00:00.000Z" }]
  } } });
  const aliceHistory = await harness.request("GET", ROUTES.history, {
    session: { username: "alice" }, query: { username: "bob" }, body: { username: "bob" }
  });
  assert.equal(aliceHistory.status, 200);
  assert.equal(aliceHistory.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(aliceHistory.body.map(item => item.content), ["Alice history"]);

  const posted = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { username: "bob", message: "Alice's new question" }
  });
  assert.equal(posted.status, 200);
  assert.equal(harness.store["aiAssistant.json"].bob[0].content, "Bob history");
  assert.equal(harness.store["aiAssistant.json"].alice.conversations[0].messages.at(-2).content, "Alice's new question");

  await harness.request("DELETE", ROUTES.history, {
    session: { username: "alice" }, body: { username: "bob" }
  });
  const bobHistory = await harness.request("GET", ROUTES.history, { session: { username: "bob" } });
  assert.deepEqual(harness.store["aiAssistant.json"].alice.conversations, []);
  assert.deepEqual(bobHistory.body.map(item => item.content), ["Bob history"]);
});

test("conversation lists and selections stay scoped to the authenticated account", async () => {
  const harness = makeHarness();
  const aliceCreated = await harness.request("POST", ROUTES.conversations, { session: { username: "alice" } });
  const bobCreated = await harness.request("POST", ROUTES.conversations, { session: { username: "bob" } });
  assert.equal(aliceCreated.status, 201);
  assert.equal(bobCreated.status, 201);
  assert.notEqual(aliceCreated.body.currentConversationId, bobCreated.body.currentConversationId);

  const alicePost = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" },
    body: { conversationId: aliceCreated.body.currentConversationId, message: "Alice private AI question" }
  });
  const bobPost = await harness.request("POST", ROUTES.messages, {
    session: { username: "bob" },
    body: { conversationId: bobCreated.body.currentConversationId, message: "Bob private AI question" }
  });
  assert.equal(alicePost.status, 200);
  assert.equal(bobPost.status, 200);

  const aliceList = await harness.request("GET", ROUTES.conversations, { session: { username: "alice" } });
  assert.equal(aliceList.body.conversations.length, 1);
  assert.equal(aliceList.body.currentConversationId, aliceCreated.body.currentConversationId);
  const bobThreadAsAlice = await harness.request("POST", ROUTES.selectConversation, {
    session: { username: "alice" },
    params: { id: bobCreated.body.currentConversationId }
  });
  assert.equal(bobThreadAsAlice.status, 404);
  const aliceHistory = await harness.request("GET", ROUTES.history, {
    session: { username: "alice" },
    query: { conversationId: aliceCreated.body.currentConversationId }
  });
  assert.equal(aliceHistory.body[0].content, "Alice private AI question");
  assert.equal(aliceHistory.body.some(item => item.content.includes("Bob private")), false);
});

test("default billing gate keeps the provider disabled until both flags are enabled", async () => {
  const harness = makeHarness({ env: {
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: TEST_ENV.CLOUDFLARE_API_TOKEN,
    AI_ENABLED: "false",
    CLOUDFLARE_OWNER_VERIFIED: "false"
  } });
  const result = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { message: "hello" }
  });
  assert.equal(result.status, 503);
  assert.match(result.body.error, /billing/i);
  assert.equal(harness.fetchCount(), 0);
});

test("owner verification is required even when AI_ENABLED is true", async () => {
  const harness = makeHarness({ env: { ...TEST_ENV, CLOUDFLARE_OWNER_VERIFIED: "false" } });
  const result = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { message: "hello" }
  });
  assert.equal(result.status, 503);
  assert.match(result.body.error, /billing/i);
  assert.equal(harness.fetchCount(), 0);
});

test("configured per-minute limits apply per authenticated user", async () => {
  const harness = makeHarness({ env: { ...TEST_ENV, AI_ASSISTANT_PER_MINUTE_LIMIT: "2" } });
  const request = () => harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { message: "hello" }
  });
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 200);
  const limited = await request();
  assert.equal(limited.status, 429);
  assert.equal(harness.rateConfigs[0].windowMs, 60 * 1000);
  assert.equal(harness.rateConfigs[0].limit, 2);
  assert.equal(harness.fetchCount(), 2);
});

test("more than eight requests per user and more than fifty globally are allowed", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const seed = {
    "aiAssistantDailyUsage.json": { date: today, count: 50 },
    "aiAssistantUsage.json": { alice: { date: today, count: 40 } }
  };
  const harness = makeHarness({
    env: { ...TEST_ENV, AI_ASSISTANT_DAILY_LIMIT: "8", AI_ASSISTANT_GLOBAL_DAILY_LIMIT: "50" },
    initialData: seed
  });
  for (let i = 0; i < 9; i++) {
    if (i > 0 && i % 3 === 0) harness.resetRateLimitWindow();
    const result = await harness.request("POST", ROUTES.messages, {
      session: { username: "alice" }, body: { message: "question " + i }
    });
    assert.equal(result.status, 200, "user request " + (i + 1));
  }
  assert.equal(harness.fetchCount(), 9);
  assert.deepEqual(harness.store["aiAssistantDailyUsage.json"], seed["aiAssistantDailyUsage.json"]);
  assert.deepEqual(harness.store["aiAssistantUsage.json"], seed["aiAssistantUsage.json"]);

  const globalHarness = makeHarness({
    env: { ...TEST_ENV, AI_ASSISTANT_DAILY_LIMIT: "8", AI_ASSISTANT_GLOBAL_DAILY_LIMIT: "50" }
  });
  for (let user = 0; user < 17; user++) {
    for (let question = 0; question < 3; question++) {
      const result = await globalHarness.request("POST", ROUTES.messages, {
        session: { username: "user-" + user }, body: { message: "question " + question }
      });
      assert.equal(result.status, 200, "shared request " + (user * 3 + question + 1));
    }
  }
  assert.equal(globalHarness.fetchCount(), 51);
});

test("Cloudflare Free quota errors are clear and the next available request works", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const seed = {
    "aiAssistantDailyUsage.json": { date: today, count: 50 },
    "aiAssistantUsage.json": { alice: { date: today, count: 40 } }
  };
  const replies = [
    { ok: false, status: 429, json: async () => ({ success: false, errors: [{ code: 3036, message: "provider quota" }] }) },
    successResponse("Quota renewed")
  ];
  const harness = makeHarness({ initialData: seed, fetchImpl: async () => replies.shift() });
  const exhausted = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { message: "first question" }
  });
  assert.equal(exhausted.status, 429);
  assert.match(exhausted.body.error, /Workers AI Free.*kvota.*yenilənənədək/i);
  assert.match(exhausted.body.error, /ödənişli plan.*billing aktivləşdirmir/i);
  assert.equal(harness.fetchCount(), 1, "quota error is not automatically retried");
  assert.deepEqual(harness.store["aiAssistantDailyUsage.json"], seed["aiAssistantDailyUsage.json"]);
  assert.deepEqual(harness.store["aiAssistantUsage.json"], seed["aiAssistantUsage.json"]);

  const available = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { message: "after quota reset" }
  });
  assert.equal(available.status, 200);
  assert.equal(available.body.message.content, "Quota renewed");
  assert.equal(harness.fetchCount(), 2);
  assert.equal(harness.store["aiAssistantDailyUsage.json"].count, 50);
  assert.equal(harness.store["aiAssistantUsage.json"].alice.count, 40);
});

test("the default three-per-minute limit also caps parallel requests per user", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let releaseProvider;
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const harness = makeHarness({ fetchImpl: async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await providerGate;
    inFlight--;
    return successResponse();
  } });
  const pending = Promise.all(Array.from({ length: 4 }, (_, i) => harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { message: "parallel " + i }
  })));
  await new Promise(resolve => setImmediate(resolve));
  const callsBeforeRelease = harness.fetchCount();
  const concurrentBeforeRelease = inFlight;
  releaseProvider();
  const results = await pending;
  assert.equal(harness.rateConfigs[0].windowMs, 60 * 1000);
  assert.equal(harness.rateConfigs[0].limit, 3);
  assert.equal(callsBeforeRelease, 3);
  assert.equal(concurrentBeforeRelease, 3);
  assert.equal(maxInFlight, 3);
  assert.equal(results.filter(result => result.status === 200).length, 3);
  assert.equal(results.filter(result => result.status === 429).length, 1);
});

test("prompt length is rejected before sending a provider request", async () => {
  const harness = makeHarness();
  const result = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { message: "x".repeat(2001) }
  });
  assert.equal(result.status, 400);
  assert.equal(harness.fetchCount(), 0);
});

test("TalkChat questions receive only matching verified help notes and a safe in-app action", async () => {
  let requestPayload;
  const harness = makeHarness({
    fetchImpl: async (_url, options) => {
      requestPayload = JSON.parse(options.body);
      return successResponse("Profil bölməsindən link əlavə edə bilərsən.");
    }
  });
  const result = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" },
    body: { message: "Profilimə linki necə əlavə edim?" }
  });
  assert.equal(result.status, 200);
  assert.match(requestPayload.messages[0].content, /Link əlavə et/);
  assert.doesNotMatch(requestPayload.messages[0].content, /Admin Paneli/);
  assert.deepEqual(result.body.message.navigation, {
    type: "page", page: "profile", label: "Profili aç"
  });
});

test("general questions do not receive unrelated TalkChat help notes", async () => {
  let requestPayload;
  const harness = makeHarness({
    fetchImpl: async (_url, options) => {
      requestPayload = JSON.parse(options.body);
      return successResponse("4");
    }
  });
  const result = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { message: "What is 2 plus 2?" }
  });
  assert.equal(result.status, 200);
  assert.doesNotMatch(requestPayload.messages[0].content, /Verified TalkChat feature notes/);
  assert.equal(result.body.message.navigation, undefined);
});

test("knowledge retrieval maps current feature questions to the right verified area", () => {
  const cases = [
    ["Reels necə paylaşım?", "share-reel"],
    ["Story-yə necə baxım?", "stories-and-requests"],
    ["Mesajı necə redaktə edim?", "message-edit"],
    ["Video zəng necə edim?", "calls"],
    ["Bildirişlər haradadır?", "notifications"],
    ["Qrup zəngi necə açılır?", "group-calls"]
  ];
  for (const [question, expectedId] of cases) {
    assert.equal(searchKnowledge(question)[0]?.id, expectedId, question);
  }
  assert.deepEqual(searchKnowledge("Can I delete my TalkChat account?"), []);
});


test("founder questions in Azerbaijani, Turkish, and English retrieve the exact answer automatically", async () => {
  const exactAnswer = "TalkChat-in qurucusu Aqil Kərimovdur. O, DevQrxyz adı ilə tanınır.";
  const variants = [
    "TalkChat-in qurucusu kimdir?",
    "TalkChat-i kim yaradıb?",
    "TalkChat-in sahibi kimdir?",
    "Kim yaradıb bu platformanı?",
    "Bu platformanı kim qurub?",
    "TalkChat'in kurucusu kim?",
    "TalkChat'i kim kurdu?",
    "Bu platformu kim kurdu?",
    "Who is the founder of TalkChat?",
    "Who created TalkChat?",
    "Who built this platform?",
    "DevQrxyz kimdir?",
    "Who is DevQrxyz?"
  ];
  for (const question of variants) {
    const match = searchKnowledge(question)[0];
    assert.equal(match?.id, "talkchat-founder", question);
    assert.equal(match.exactAnswer, exactAnswer, question);
    assert.ok(match.guidance.includes(exactAnswer), question);
  }

  for (const [username, question] of [
    ["az-user", "TalkChat-i kim yaradıb?"],
    ["tr-user", "TalkChat'in kurucusu kim?"],
    ["en-user", "Who is the founder of TalkChat?"]
  ]) {
    let systemPrompt = "";
    const harness = makeHarness({ fetchImpl: async (_url, options) => {
      systemPrompt = JSON.parse(options.body).messages[0].content;
      return successResponse("A model paraphrase that should not be shown.");
    } });
    const result = await harness.request("POST", ROUTES.messages, {
      session: { username }, body: { message: question }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.message.content, exactAnswer);
    assert.match(systemPrompt, /repeat it verbatim/);
    assert.ok(systemPrompt.includes(exactAnswer));
  }
});

test("Cloudflare quota, billing/auth, and unavailable-model errors are friendly and never retried", async () => {
  const cases = [
    { status: 429, body: { errors: [{ code: 3036, message: "private provider quota details" }] }, expected: 429, text: /kvota/i },
    { status: 403, body: { errors: [{ code: 5035, message: "private provider plan details" }] }, expected: 503, text: /planı/i },
    { status: 400, body: { errors: [{ code: 5007, message: "private provider model details" }] }, expected: 503, text: /modeli/i }
  ];
  for (const item of cases) {
    const harness = makeHarness({ fetchImpl: async () => ({
      ok: false, status: item.status, json: async () => item.body
    }) });
    const result = await harness.request("POST", ROUTES.messages, {
      session: { username: "alice" }, body: { message: "hello" }
    });
    assert.equal(result.status, item.expected);
    assert.match(result.body.error, item.text);
    assert.doesNotMatch(result.body.error, /private provider/);
    assert.equal(harness.fetchCount(), 1);
  }
});

test("successful requests use the requested model, bounded context, and store false", async () => {
  let calledUrl;
  let calledOptions;
  const history = Array.from({ length: 12 }, (_, index) => ({
    id: "h" + index,
    role: index % 2 ? "assistant" : "user",
    content: "prior-" + index + "-" + "x".repeat(10000),
    createdAt: "2026-01-01T00:00:00.000Z"
  }));
  const harness = makeHarness({
    initialData: { "aiAssistant.json": { alice: history } },
    fetchImpl: async (url, options) => {
      calledUrl = url;
      calledOptions = options;
      return successResponse("Cloudflare answer");
    }
  });
  const result = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { message: "current question" }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.message.content, "Cloudflare answer");
  assert.equal(calledUrl, "https://api.cloudflare.com/client/v4/accounts/" + ACCOUNT_ID + "/ai/run/@cf/zai-org/glm-4.7-flash");
  assert.equal(calledOptions.method, "POST");
  assert.equal(calledOptions.headers.Authorization, "Bearer " + TEST_ENV.CLOUDFLARE_API_TOKEN);
  const payload = JSON.parse(calledOptions.body);
  assert.equal(payload.store, false);
  assert.equal(payload.stream, false);
  assert.equal(payload.max_completion_tokens, 600);
  assert.equal(payload.messages[0].role, "system");
  assert.equal(payload.messages.at(-1).content, "current question");
  const context = payload.messages.slice(1, -1);
  assert.ok(context.length <= 12);
  assert.ok(context.reduce((total, item) => total + item.content.length, 0) <= 8000);
  assert.equal(harness.store["aiAssistant.json"].alice.conversations[0].messages.at(-2).content, "current question");
});
