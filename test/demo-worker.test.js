import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, createProxyClient, createMockClient, persuasionQuestions, persuasionState, VERSION } from "../src/index.js";

import * as worker from "../examples/demo-worker.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const config = readFileSync(new URL("../examples/demo-wrangler.toml", import.meta.url), "utf8");
const configOrigins = config.match(/^ALLOWED_ORIGINS = "([^"]*)"$/m)?.[1];
const URL_ = "https://api.honeytongue.dev/judge";

test("the demo Worker bundles exactly the scenes the demo lists", () => {
  const titles = load("stories/index.json").map((s) => load(`stories/${s.file}`).title);
  assert.deepEqual(worker.DEMO_STORIES.map((s) => s.title), titles);
});

test("the demo Worker's config: honeytongue.dev first, api.honeytongue.dev as its only address", () => {
  assert.match(config, /^name = "honeytongue-demo"$/m);
  assert.deepEqual(worker.parseOrigins(configOrigins), ["https://honeytongue.dev", "https://tbrought.github.io"]);
  assert.match(config, /^routes = \[\{ pattern = "api\.honeytongue\.dev", custom_domain = true \}\]$/m);
  assert.match(config, /^workers_dev = false$/m, "a workers.dev address would get round the rate limiting rule");
  // Origins come from the variable, so a new address needs no code change.
  assert.deepEqual(worker.parseOrigins(" https://honeytongue.dev/, https://example.org ,"), ["https://honeytongue.dev", "https://example.org"]);
  assert.deepEqual(worker.parseOrigins(undefined), []);
});

test("the demo Worker judges the demo's turns from its pages, only at /judge, and refuses anything else", async () => {
  // The Worker makes its handler on the first request, from these variables.
  const env = { ALLOWED_ORIGINS: configOrigins, TYPESAFE_API_KEY: "test-key-not-real" };
  const fetchVia = (origin) => async (url, init) => worker.default.fetch(new Request(url, { ...init, headers: { ...init.headers, Origin: origin } }), env);
  const client = (origin, url = URL_) => createProxyClient({ url, maxRetries: 0, fetch: fetchVia(origin) });
  const saved = globalThis.fetch;
  // The proxy's Jev client uses fetch too: answer those calls with the mock's answers, as Jev's shape.
  const mock = createMockClient();
  globalThis.fetch = async (url, init) => {
    const { state, questions } = JSON.parse(init.body);
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: await mock.ask(state, questions), usage: {} }), { status: 200 });
  };
  try {
    for (const origin of ["https://honeytongue.dev", "https://tbrought.github.io"]) {
      const game = new Game(load("stories/goblin-camp.json"), client(origin));
      assert.equal((await game.turn("Nib, please let me go")).debug.verdict, "unconvinced", origin);
    }
    const game = new Game(load("stories/goblin-camp.json"), client("https://honeytongue.dev", "https://api.honeytongue.dev/"));
    await assert.rejects(game.turn("Nib, please let me go"), (e) => e.status === 404);

    await assert.rejects(client("https://elsewhere.example").ask({ player_input: "hi" }, {}), (e) => e.status === 403);

    const stranger = { name: "Vesk", persona: "A clerk.", goal: "Stamp the form" };
    await assert.rejects(client("https://honeytongue.dev").ask(persuasionState(stranger, "hi"), persuasionQuestions(stranger)),
      (e) => e.status === 403 && e.reason === "not-allowed" && e.proxyVersion === VERSION);
  } finally {
    globalThis.fetch = saved;
  }
});
