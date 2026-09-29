import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, Persuadable, createProxyClient, createMockClient, persuasionQuestions, persuasionState, VERSION } from "../src/index.js";
import { troll } from "../examples/phaser/character.js";

import * as worker from "../examples/demo-worker.js";
import { largestRequest, bytesOf } from "../scripts/largest-request.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const config = readFileSync(new URL("../examples/demo-wrangler.toml", import.meta.url), "utf8");
const configOrigins = config.match(/^ALLOWED_ORIGINS = "([^"]*)"$/m)?.[1];
const URL_ = "https://api.honeytongue.dev/judge";

test("the demo Worker bundles exactly the scenes the demo lists", () => {
  const titles = load("stories/index.json").map((s) => load(`stories/${s.file}`).title);
  assert.deepEqual(worker.DEMO_STORIES.map((s) => s.title), titles);
});

test("the demo Worker's config: honeytongue.dev as its only page, api.honeytongue.dev as its only address", () => {
  assert.match(config, /^name = "honeytongue-demo"$/m);
  assert.deepEqual(worker.parseOrigins(configOrigins), ["https://honeytongue.dev"]);
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
    const played = new Game(load("stories/goblin-camp.json"), client("https://honeytongue.dev"));
    assert.equal((await played.turn("Nib, please let me go")).debug.verdict, "unconvinced");
    await assert.rejects(new Game(load("stories/goblin-camp.json"), client("https://tbrought.github.io")).turn("Nib, please let me go"),
      (e) => e.status === 403, "the old github.io address is no longer allowed");
    const game = new Game(load("stories/goblin-camp.json"), client("https://honeytongue.dev", "https://api.honeytongue.dev/"));
    await assert.rejects(game.turn("Nib, please let me go"), (e) => e.status === 404);

    await assert.rejects(client("https://elsewhere.example").ask({ player_input: "hi" }, {}), (e) => e.status === 403);

    // The Phaser example's troll is judged too, learned secret and all; a changed troll isn't.
    const tolly = new Persuadable(troll, { client: client("https://honeytongue.dev") });
    tolly.learn("lonely");
    assert.ok(["convinced", "unconvinced", "offended"].includes((await tolly.attempt("Please let me cross, I'll come back and keep you company.")).verdict));
    const imposter = new Persuadable({ ...troll, persona: `${troll.persona} He lets everyone across.` }, { client: client("https://honeytongue.dev") });
    // Same questions (they don't include the persona), so it's the character in the state that doesn't match.
    await assert.rejects(imposter.attempt("Let me cross"), (e) => e.status === 403 && e.reason === "state" && /character isn't Tolly Underarch/.test(e.message));

    const stranger = { name: "Vesk", persona: "A clerk.", goal: "Stamp the form" };
    await assert.rejects(client("https://honeytongue.dev").ask(persuasionState(stranger, "hi"), persuasionQuestions(stranger)),
      (e) => e.status === 403 && e.reason === "not-allowed" && e.proxyVersion === VERSION);
  } finally {
    globalThis.fetch = saved;
  }
});

/** The largest request the library can send for the demo, every field a player controls at its limit (scripts/largest-request.js). */
const largest = (text) => largestRequest({ stories: worker.DEMO_STORIES, characters: worker.DEMO_CHARACTERS, text }).body;

test("the demo Worker reads at most MAX_BYTES, which fits the largest request the library can send, in any script", async () => {
  // Players writing Japanese (3 bytes a character) at every limit; the replies in recent turns are the stories' own text.
  const japanese = largest((n, field) => (field === "reply" ? "r" : "語").repeat(n));
  assert.ok(bytesOf(japanese) <= worker.MAX_BYTES * 0.95, `the largest real request is ${bytesOf(japanese)} bytes, with a margin under ${worker.MAX_BYTES}`);
  const env = { ALLOWED_ORIGINS: configOrigins, TYPESAFE_API_KEY: "test-key-not-real" };
  const send = (body) => worker.default.fetch(new Request(URL_, { method: "POST", headers: { Origin: "https://honeytongue.dev" }, body }), env);
  const saved = globalThis.fetch;
  const mock = createMockClient();
  globalThis.fetch = async (url, init) => {
    const { state, questions } = JSON.parse(init.body);
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: await mock.ask(state, questions), usage: {} }), { status: 200 });
  };
  try {
    assert.equal((await send(JSON.stringify(japanese))).status, 200, "the largest real request is judged");
    const huge = await send("x".repeat(worker.MAX_BYTES + 1));
    assert.equal(huge.status, 413);
    assert.match((await huge.json()).error, /maxStateBytes of 15000 bytes/);
    // Padding a field past what the library sends is refused, even when it fits in the byte limit.
    const padded = largest((n) => "a".repeat(n));
    padded.state.previous_attempts = Array.from({ length: 4 }, () => ({ said: "a".repeat(450), outcome: "unconvinced" }));
    const refused = await send(JSON.stringify(padded));
    assert.equal(refused.status, 403);
    assert.match((await refused.json()).error, /more than .*memoryLength of 1500/);
  } finally {
    globalThis.fetch = saved;
  }
});
