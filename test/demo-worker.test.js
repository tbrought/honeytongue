import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, createProxyClient, createMockClient, persuasionQuestions, persuasionState, VERSION } from "../src/index.js";

// The Worker imports the stories as JSON modules, which Node supports from 18.20.
const worker = await import("../examples/demo-worker.js").catch(() => null);
const skip = worker ? false : "this Node can't import JSON modules";
const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const PAGES = "https://tbrought.github.io";

test("the demo Worker bundles exactly the scenes the demo lists", { skip }, () => {
  const titles = load("stories/index.json").map((s) => load(`stories/${s.file}`).title);
  assert.deepEqual(worker.DEMO_STORIES.map((s) => s.title), titles);
});

test("the demo Worker's origins come from ALLOWED_ORIGINS, so a new address needs no code change", { skip }, () => {
  assert.deepEqual(worker.parseOrigins(" https://tbrought.github.io, https://honeytongue.dev/ ,"), ["https://tbrought.github.io", "https://honeytongue.dev"]);
  assert.deepEqual(worker.parseOrigins(undefined), []);
  assert.match(readFileSync(new URL("../examples/demo-wrangler.toml", import.meta.url), "utf8"), /^name = "honeytongue-demo"$/m);
});

test("the demo Worker judges the demo's turns from its pages, and refuses anything else", { skip }, async () => {
  // The Worker makes its handler on the first request, from these variables.
  const env = { ALLOWED_ORIGINS: `${PAGES},https://honeytongue.dev`, TYPESAFE_API_KEY: "test-key-not-real" };
  const fetchVia = (origin) => async (url, init) => {
    const request = new Request(url, { ...init, headers: { ...init.headers, Origin: origin } });
    return worker.default.fetch(request, env);
  };
  const saved = globalThis.fetch;
  // The proxy's Jev client uses fetch too: answer those calls with the mock's answers, as Jev's shape.
  const mock = createMockClient();
  globalThis.fetch = async (url, init) => {
    const { state, questions } = JSON.parse(init.body);
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: await mock.ask(state, questions), usage: {} }), { status: 200 });
  };
  try {
    const game = new Game(load("stories/goblin-camp.json"), createProxyClient({ url: "https://honeytongue-demo.test/", maxRetries: 0, fetch: fetchVia(PAGES) }));
    const result = await game.turn("Nib, please let me go");
    assert.equal(result.debug.verdict, "unconvinced");

    const other = createProxyClient({ url: "https://honeytongue-demo.test/", maxRetries: 0, fetch: fetchVia("https://elsewhere.example") });
    await assert.rejects(other.ask({ player_input: "hi" }, {}), (e) => e.status === 403);

    const stranger = { name: "Vesk", persona: "A clerk.", goal: "Stamp the form" };
    const ours = createProxyClient({ url: "https://honeytongue-demo.test/", maxRetries: 0, fetch: fetchVia("https://honeytongue.dev") });
    await assert.rejects(ours.ask(persuasionState(stranger, "hi"), persuasionQuestions(stranger)), (e) => e.status === 403 && e.reason === "not-allowed" && e.proxyVersion === VERSION);
  } finally {
    globalThis.fetch = saved;
  }
});
