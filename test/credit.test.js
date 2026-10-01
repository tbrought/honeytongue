import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, createJevClient, createProxyClient, createProxyHandler, createMockClient } from "../src/index.js";
import { createFallbackClient } from "../docs/play/fallback.js";

// When prepaid credit runs out, TypeSafe's API answers HTTP 402 with a billing_error (confirmed by TypeSafe on
// 2026-10-01). The status is what Honeytongue acts on; the body's exact layout isn't documented, so this one is a
// plausible example that names the billing_error.
const outOfCredit = () => new Response(JSON.stringify({ type: "error", error: { type: "billing_error", message: "Your prepaid credit has run out." } }),
  { status: 402, headers: { "Content-Type": "application/json" } });
const gatehouse = JSON.parse(readFileSync(new URL("../stories/gatehouse.json", import.meta.url), "utf8"));

test("out of credit (402 billing_error): the Jev client fails at once, without retrying, and says so", async () => {
  let calls = 0;
  const jev = createJevClient({ apiKey: "test-key-not-real", maxRetries: 3, fetch: async () => { calls++; return outOfCredit(); } });
  const err = await jev.ask({ player_input: "hi" }, { q: { type: "noul", instructions: "?" } }).then(() => null, (e) => e);
  assert.equal(err?.status, 402);
  assert.match(err.message, /prepaid credit has run out/i);
  assert.match(err.message, /billing_error/);
  assert.equal(calls, 1, "a 402 isn't retried: more credit won't appear in a few seconds");
});

test("out of credit: a guarded proxy reports it as unavailable, and the demo judges with the mock for the rest of the session", async () => {
  let jevCalls = 0;
  const saved = globalThis.fetch;
  const logged = console.error;
  console.error = () => {};
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://api.typesafe.ai/")) { jevCalls++; return outOfCredit(); }
    throw new Error(`unexpected fetch to ${url}`);
  };
  try {
    // A real proxy, judging with Jev (no client passed in), in front of the demo's fallback, in a real game.
    const handle = createProxyHandler({ apiKey: "test-key-not-real", allowedStories: [gatehouse], rateLimit: false });
    const res = await handle(new Request("https://proxy.test/", { method: "POST", body: JSON.stringify({ state: {}, questions: {} }) }));
    assert.equal(res.status, 400, "the proxy still checks requests before spending anything");

    const live = createProxyClient({ url: "https://proxy.test/", fetch: async (url, init) => handle(new Request(url, init)) });
    const changes = [];
    const fallback = createFallbackClient({ live, mock: createMockClient(), onChange: (c) => changes.push(`${c.mode}:${c.why}`) });
    const game = new Game(gatehouse, fallback);
    const first = await game.turn("Harry, please let me through.");
    assert.equal(first.debug.source, "mock", "the turn is still answered");
    assert.deepEqual(changes, ["off:unavailable"]);
    assert.equal(jevCalls, 1, "one call to Jev: neither the proxy nor the page retried it");
    await game.turn("I have a letter for the apothecary.");
    assert.equal(jevCalls, 1, "and Jev isn't tried again this session");
  } finally {
    globalThis.fetch = saved;
    console.error = logged;
  }
});
