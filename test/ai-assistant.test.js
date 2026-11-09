"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { installAIAssistant } = require("../aiAssistant");

const ROUTES = {
  history: "/api/ai-assistant/history",
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

  return { request, routes, rateConfigs, store, fetchCount: () => fetchCount };
}

test("all AI endpoints require authentication before running handlers", async () => {
  const harness = makeHarness();
  for (const [method, path] of [
    ["GET", ROUTES.history],
    ["DELETE", ROUTES.history],
    ["POST", ROUTES.messages]
  ]) {
    assert.equal(harness.routes.get(method + " " + path)[0].name, "requireAuth");
    const result = await harness.request(method, path, { body: { username: "other-user", message: "hello" } });
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
  assert.equal(harness.store["aiAssistant.json"].alice.at(-2).content, "Alice's new question");

  await harness.request("DELETE", ROUTES.history, {
    session: { username: "alice" }, body: { username: "bob" }
  });
  const bobHistory = await harness.request("GET", ROUTES.history, { session: { username: "bob" } });
  assert.deepEqual(harness.store["aiAssistant.json"].alice, []);
  assert.deepEqual(bobHistory.body.map(item => item.content), ["Bob history"]);
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

test("configured daily quota is shared across users and blocks further provider calls", async () => {
  const harness = makeHarness({ env: { ...TEST_ENV, AI_ASSISTANT_DAILY_LIMIT: "1" } });
  const first = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { message: "first" }
  });
  const second = await harness.request("POST", ROUTES.messages, {
    session: { username: "bob" }, body: { username: "alice", message: "second" }
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.match(second.body.error, /gündəlik/i);
  assert.equal(harness.fetchCount(), 1);
});

test("prompt length is rejected before sending a provider request", async () => {
  const harness = makeHarness();
  const result = await harness.request("POST", ROUTES.messages, {
    session: { username: "alice" }, body: { message: "x".repeat(2001) }
  });
  assert.equal(result.status, 400);
  assert.equal(harness.fetchCount(), 0);
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
  assert.equal(harness.store["aiAssistant.json"].alice.at(-2).content, "current question");
});
