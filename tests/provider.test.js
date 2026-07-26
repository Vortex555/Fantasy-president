import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

/**
 * The local-model path, against a real HTTP server rather than a mocked
 * `fetch`.
 *
 * Everything here is a failure a player actually hits when the model runs on a
 * different machine from the game: the machine is asleep, the runner is not up
 * yet, the address changed, the model was swapped, a 7B is simply slower than
 * the timeout. None of it was covered, and two of the cases below were real
 * bugs — a discovery failure cached for the life of the process, and an
 * availability check that only ever confirmed a URL had been typed.
 */

// --- A stand-in for whatever the player is running --------------------------

/**
 * A fake local runner. `routes` maps path → handler, so each test describes the
 * server it wants to fail against.
 */
async function runner(routes) {
  const server = http.createServer((req, res) => {
    const handler = routes[new URL(req.url, "http://x").pathname];
    if (!handler) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end('{"error":"not found"}');
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(req, res, body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1`,
    port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const json = (res, code, payload) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
};

const modelList = (...ids) => ({ object: "list", data: ids.map((id) => ({ id, object: "model" })) });

const completion = (content, model = "test-model") => ({
  model,
  choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 11, completion_tokens: 22 },
});

/** A port nothing is listening on, for the machine-is-asleep cases. */
async function deadPort() {
  const s = await runner({});
  const { port } = s;
  await s.close();
  return port;
}

// --- Fresh module state per test --------------------------------------------

import * as openai from "../src/ai/openai.js";
import * as provider from "../src/ai/provider.js";
import { anthropicInfo } from "../src/ai/anthropic.js";

const AI = { ...openai, ...provider, anthropicInfo };

/**
 * Reset the adapter between tests.
 *
 * The module graph is imported once, exactly as the server imports it — a
 * cache-busting `?t=n` query gives you a second copy of `openai.js` while
 * `provider.js` keeps importing the first, so `discoverModel` and `complete`
 * end up looking at two different caches and the tests quietly lie to you.
 * `resetProviderHealth` exists for this, and clears the discovered model too.
 */
async function freshAi(env = {}) {
  process.env.FP_PROVIDER = "local";
  process.env.FP_LOCAL_RETRY_MS = "0";      // no waiting around for a retry window
  process.env.FP_LOCAL_TIMEOUT_MS = "2000";
  delete process.env.FP_LOCAL_MODEL;
  delete process.env.FP_LOCAL_CHAT_MODEL;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
  AI.resetProviderHealth();
  return AI;
}

// ---------------------------------------------------------------------------
// Reaching the machine
// ---------------------------------------------------------------------------

test("a model that is there is found without being named", async () => {
  const local = await runner({ "/v1/models": (q, res) => json(res, 200, modelList("qwen2.5:7b")) });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url });
    assert.equal(await ai.discoverModel(), "qwen2.5:7b");
    const probe = await ai.probeLocal();
    assert.equal(probe.reachable, true);
    assert.equal(probe.model, "qwen2.5:7b");
    assert.equal(probe.error, null);
  } finally {
    await local.close();
  }
});

test("a machine that is not there is reported as not there", async () => {
  const port = await deadPort();
  const ai = await freshAi({ FP_LOCAL_URL: `http://127.0.0.1:${port}/v1` });
  const probe = await ai.probeLocal();
  assert.equal(probe.reachable, false);
  assert.match(probe.error, /Could not reach/);
  // The reason has to be actionable, not "fetch failed".
  assert.match(probe.error, /nothing is listening|not reachable|could not be found/);
});

test("configured is not the same question as answering", async () => {
  // This is the bug in one assertion: a URL that goes nowhere still counts as
  // configured, which is exactly why the game needs to probe before it boasts.
  const port = await deadPort();
  const ai = await freshAi({ FP_LOCAL_URL: `http://127.0.0.1:${port}/v1` });
  assert.equal(ai.aiAvailable(), true, "a URL was configured");
  assert.equal((await ai.probeProvider()).reachable, false, "and nothing is there");
});

test("a runner with no model listing is still a runner", async () => {
  // llama.cpp answers /models with a 404 and serves completions perfectly well.
  const local = await runner({
    "/v1/chat/completions": (q, res) => json(res, 200, completion('{"ok":1}', "local.gguf")),
  });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url, FP_LOCAL_MODEL: "local.gguf" });
    const probe = await ai.probeLocal();
    assert.equal(probe.reachable, true, "the connection worked, which is what reachable means");
    assert.equal(probe.listed, false, "it just would not list anything");
    assert.equal(probe.model, "local.gguf", "so the configured name is used");
    const out = await ai.completeOpenAI({ system: "s", messages: [{ role: "user", content: "u" }] });
    assert.equal(out.text, '{"ok":1}');
  } finally {
    await local.close();
  }
});

test("reachable but empty is a problem, and says which problem", async () => {
  const local = await runner({ "/v1/models": (q, res) => json(res, 200, modelList()) });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url });
    const probe = await ai.probeLocal();
    assert.equal(probe.reachable, true);
    assert.equal(probe.model, "");
    assert.match(probe.error, /no model loaded/);
  } finally {
    await local.close();
  }
});

// ---------------------------------------------------------------------------
// The bug: one failure used to last forever
// ---------------------------------------------------------------------------

test("a machine that was asleep at startup is found once it wakes", async () => {
  // The original defect. Discovery failed once, cached the empty string, and
  // `discovered !== null` meant it never asked again — so a game started before
  // the model server came up played its whole term on the offline engine.
  const port = await deadPort();
  const ai = await freshAi({ FP_LOCAL_URL: `http://127.0.0.1:${port}/v1` });

  assert.equal(await ai.discoverModel(), "", "nothing there yet");

  // The player starts their model server. Same port, now listening.
  const server = http.createServer((req, res) => json(res, 200, modelList("llama3.1:8b")));
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  try {
    assert.equal(await ai.discoverModel(), "llama3.1:8b",
      "the game has to ask again — this is the whole bug");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("a found model is not re-interrogated on every turn", async () => {
  let asked = 0;
  const local = await runner({
    "/v1/models": (q, res) => { asked += 1; json(res, 200, modelList("qwen2.5:7b")); },
  });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url });
    await ai.discoverModel();
    await ai.discoverModel();
    await ai.discoverModel();
    assert.equal(asked, 1, "success is cached; only failure is retried");
  } finally {
    await local.close();
  }
});

test("forgetting lets a player switch models without a restart", async () => {
  let which = "first:7b";
  const local = await runner({ "/v1/models": (q, res) => json(res, 200, modelList(which)) });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url });
    assert.equal(await ai.discoverModel(), "first:7b");
    which = "second:14b";
    assert.equal(await ai.discoverModel(), "first:7b", "still cached");
    ai.forgetModel();
    assert.equal(await ai.discoverModel(), "second:14b");
  } finally {
    await local.close();
  }
});

// ---------------------------------------------------------------------------
// Generating
// ---------------------------------------------------------------------------

test("a completion comes back normalised, whatever the runner calls things", async () => {
  const local = await runner({
    "/v1/models": (q, res) => json(res, 200, modelList("qwen2.5:7b")),
    "/v1/chat/completions": (q, res) => json(res, 200, completion('{"approvalChange":-2}', "qwen2.5:7b")),
  });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url });
    const out = await ai.completeOpenAI({ system: "s", messages: [{ role: "user", content: "u" }] });
    assert.equal(out.text, '{"approvalChange":-2}');
    assert.equal(out.model, "qwen2.5:7b");
    assert.deepEqual(out.usage, { in: 11, out: 22, cached: 0 });
  } finally {
    await local.close();
  }
});

test("the request carries the model, the system prompt and the JSON demand", async () => {
  let seen = null;
  const local = await runner({
    "/v1/chat/completions": (q, res, body) => { seen = JSON.parse(body); json(res, 200, completion("{}")); },
  });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url, FP_LOCAL_MODEL: "m1" });
    await ai.completeOpenAI({ system: "be terse", messages: [{ role: "user", content: "hi" }], json: true });
    assert.equal(seen.model, "m1");
    assert.equal(seen.stream, false);
    assert.equal(seen.messages[0].role, "system");
    assert.equal(seen.messages[0].content, "be terse");
    assert.equal(seen.response_format.type, "json_object");
  } finally {
    await local.close();
  }
});

test("the cheap tier can be a different model from the judge", async () => {
  let seen = null;
  const local = await runner({
    "/v1/chat/completions": (q, res, body) => { seen = JSON.parse(body); json(res, 200, completion("{}")); },
  });
  try {
    const ai = await freshAi({
      FP_LOCAL_URL: local.url, FP_LOCAL_MODEL: "big:14b", FP_LOCAL_CHAT_MODEL: "small:3b",
    });
    await ai.completeOpenAI({ system: "s", messages: [], tier: "chat" });
    assert.equal(seen.model, "small:3b");
    await ai.completeOpenAI({ system: "s", messages: [], tier: "judge" });
    assert.equal(seen.model, "big:14b");
  } finally {
    await local.close();
  }
});

test("nothing loaded is an error a player can act on", async () => {
  const local = await runner({ "/v1/models": (q, res) => json(res, 200, modelList()) });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url });
    await assert.rejects(
      () => ai.completeOpenAI({ system: "s", messages: [] }),
      (err) => /No local model available/.test(err.message) && /FP_LOCAL_MODEL/.test(err.message));
  } finally {
    await local.close();
  }
});

test("a runner that errors says so, with its status", async () => {
  const local = await runner({
    "/v1/chat/completions": (q, res) => json(res, 500, { error: "out of memory" }),
  });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url, FP_LOCAL_MODEL: "m" });
    await assert.rejects(
      () => ai.completeOpenAI({ system: "s", messages: [] }),
      (err) => /500/.test(err.message) && /out of memory/.test(err.message));
  } finally {
    await local.close();
  }
});

test("a model that has been swapped out is not asked for twice", async () => {
  // 404 on a completion means the name we hold is not a name it has.
  const local = await runner({
    "/v1/models": (q, res) => json(res, 200, modelList("new:8b")),
    "/v1/chat/completions": (q, res) => json(res, 404, { error: "model not found" }),
  });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url });
    assert.equal(await ai.discoverModel(), "new:8b");
    await assert.rejects(() => ai.completeOpenAI({ system: "s", messages: [] }), /404/);
    // The stale name has been dropped, so the next turn re-discovers.
    let asked = 0;
    const counted = await runner({
      "/v1/models": (q, res) => { asked += 1; json(res, 200, modelList("new:8b")); },
    });
    try {
      process.env.FP_LOCAL_URL = counted.url;
      await ai.discoverModel();
      assert.equal(asked, 1, "the failure invalidated the cache");
    } finally {
      await counted.close();
    }
  } finally {
    await local.close();
  }
});

test("a model slower than the timeout fails with advice, not a stack trace", async () => {
  const local = await runner({
    // Never answers. The timeout has to be what ends this.
    "/v1/chat/completions": () => {},
  });
  try {
    const ai = await freshAi({
      FP_LOCAL_URL: local.url, FP_LOCAL_MODEL: "slow:70b", FP_LOCAL_TIMEOUT_MS: 250,
    });
    await assert.rejects(
      () => ai.completeOpenAI({ system: "s", messages: [] }),
      (err) => /did not answer within/.test(err.message) && /FP_LOCAL_TIMEOUT_MS/.test(err.message));
  } finally {
    await local.close();
  }
});

test("the timeout is read when the call is made, not when the file was loaded", async () => {
  const local = await runner({ "/v1/chat/completions": () => {} });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url, FP_LOCAL_MODEL: "m" });
    process.env.FP_LOCAL_TIMEOUT_MS = "150";
    const started = process.hrtime.bigint();
    await assert.rejects(() => ai.completeOpenAI({ system: "s", messages: [] }), /did not answer/);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 2000, `the new timeout was ignored — waited ${Math.round(ms)}ms`);
  } finally {
    await local.close();
  }
});

// ---------------------------------------------------------------------------
// Telling the player the truth
// ---------------------------------------------------------------------------

test("health starts unknown, then reflects what actually happened", async () => {
  const local = await runner({
    "/v1/models": (q, res) => json(res, 200, modelList("m")),
    "/v1/chat/completions": (q, res) => json(res, 200, completion("{}", "m")),
  });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url });
    assert.equal(ai.providerHealth().ok, null, "nothing has been asked yet");
    assert.equal(ai.providerHealth().engine, "local");

    await ai.complete({ system: "s", messages: [] });
    assert.equal(ai.providerHealth().ok, true);
    assert.equal(ai.providerHealth().engine, "local");
    assert.equal(ai.providerHealth().failures, 0);
  } finally {
    await local.close();
  }
});

test("a failed call marks the engine as offline, which is what is really playing", async () => {
  const port = await deadPort();
  const ai = await freshAi({ FP_LOCAL_URL: `http://127.0.0.1:${port}/v1`, FP_LOCAL_MODEL: "m" });

  await assert.rejects(() => ai.complete({ system: "s", messages: [] }));
  const health = ai.providerHealth();
  assert.equal(health.ok, false);
  assert.equal(health.engine, "offline", "the offline engine is what answered the month");
  assert.equal(health.configured, true, "even though a model was configured");
  assert.equal(health.failures, 1);
  assert.match(health.reason, /Could not reach/);
});

test("recovery is reported too — a badge that never goes green is no use", async () => {
  const port = await deadPort();
  const ai = await freshAi({ FP_LOCAL_URL: `http://127.0.0.1:${port}/v1`, FP_LOCAL_MODEL: "m" });
  await assert.rejects(() => ai.complete({ system: "s", messages: [] }));
  assert.equal(ai.providerHealth().ok, false);

  const server = http.createServer((req, res) => json(res, 200, completion("{}", "m")));
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  try {
    await ai.complete({ system: "s", messages: [] });
    const health = ai.providerHealth();
    assert.equal(health.ok, true);
    assert.equal(health.engine, "local");
    assert.equal(health.failures, 0, "the failure count resets on success");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("a recorded turn-level fallback counts, so the badge sees it", async () => {
  const local = await runner({ "/v1/models": (q, res) => json(res, 200, modelList("m")) });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url });
    ai.recordModelFailure("the model returned prose instead of JSON");
    const health = ai.providerHealth();
    assert.equal(health.ok, false);
    assert.equal(health.engine, "offline");
    assert.match(health.reason, /prose/);
  } finally {
    await local.close();
  }
});

test("a reset forgets both the health and the model, so a re-check is honest", async () => {
  const local = await runner({ "/v1/models": (q, res) => json(res, 200, modelList("m")) });
  try {
    const ai = await freshAi({ FP_LOCAL_URL: local.url });
    ai.recordModelFailure("boom");
    assert.equal(ai.providerHealth().ok, false);
    ai.resetProviderHealth();
    assert.equal(ai.providerHealth().ok, null);
    assert.equal(ai.providerHealth().failures, 0);
  } finally {
    await local.close();
  }
});

test("with no provider configured, nothing pretends otherwise", async () => {
  const ai = await freshAi({ FP_PROVIDER: "off" });
  assert.equal(ai.aiAvailable(), false);
  assert.equal(ai.providerHealth().engine, "offline");
  assert.equal((await ai.probeProvider()).reachable, false);
  await assert.rejects(() => ai.complete({ system: "s", messages: [] }), /No model provider/);
});

// ---------------------------------------------------------------------------
// The hosted path
//
// A request to Anthropic cannot be made from a test without spending money, so
// what is checked here is everything around it: which model each tier picks, and
// the fact that a key is taken at its word because verifying it costs a token.
// ---------------------------------------------------------------------------

test("the hosted tiers are two different models, and the env overrides both", async () => {
  const ai = await freshAi({
    FP_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test",
    FP_MODEL: undefined, FP_CHAT_MODEL: undefined,
  });
  const stock = ai.anthropicInfo();
  assert.match(stock.model, /sonnet/, "the judge is the good model");
  assert.match(stock.chatModel, /haiku/, "the flavour is the cheap one");
  assert.equal(stock.local, false);

  process.env.FP_MODEL = "claude-opus-4-8";
  process.env.FP_CHAT_MODEL = "claude-haiku-4-5";
  assert.equal(ai.anthropicInfo().model, "claude-opus-4-8");
  delete process.env.FP_MODEL;
  delete process.env.FP_CHAT_MODEL;
});

test("a hosted key is taken at its word; a missing one is not", async () => {
  const ai = await freshAi({ FP_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" });
  assert.equal(ai.aiAvailable(), true);
  const probe = await ai.probeProvider();
  assert.equal(probe.reachable, true, "verifying a key costs a token, so it is trusted");
  assert.equal(probe.id, "anthropic");

  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(ai.aiAvailable(), false);
  const missing = await ai.probeProvider();
  assert.equal(missing.reachable, false);
  assert.match(missing.error, /ANTHROPIC_API_KEY/);
});

test("switching provider invalidates what we learned about the last one", async () => {
  const port = await deadPort();
  const ai = await freshAi({ FP_LOCAL_URL: `http://127.0.0.1:${port}/v1`, FP_LOCAL_MODEL: "m" });
  await assert.rejects(() => ai.complete({ system: "s", messages: [] }));
  assert.equal(ai.providerHealth().ok, false);

  // The same process, now pointed at the hosted API. The local failure says
  // nothing about it, so the badge must not carry the red over.
  process.env.FP_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "sk-test";
  const health = ai.providerHealth();
  assert.equal(health.id, "anthropic");
  assert.equal(health.ok, null, "nothing has been asked of this provider yet");
  assert.equal(health.engine, "anthropic");
  delete process.env.ANTHROPIC_API_KEY;
});

test("the hosted title-screen copy names the model doing the work", async () => {
  const ai = await freshAi({ FP_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" });
  const info = await ai.providerInfo();
  assert.equal(info.id, "anthropic");
  assert.equal(info.available, true);
  assert.match(info.detail, /generated by/);
  delete process.env.ANTHROPIC_API_KEY;
});

test("the title-screen copy admits it when the machine is not answering", async () => {
  const port = await deadPort();
  const ai = await freshAi({ FP_LOCAL_URL: `http://127.0.0.1:${port}/v1`, FP_LOCAL_MODEL: "qwen:7b" });
  const info = await ai.providerInfo();
  assert.equal(info.id, "local");
  assert.equal(info.reachable, false);
  assert.match(info.detail, /Could not reach/);
  assert.ok(!/nothing is sent anywhere/.test(info.detail),
    "the reassuring copy is for when it is actually running");
});
