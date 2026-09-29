import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createJevClient, createProxyClient, createProxyHandler, createMockClient, Game } from "../src/index.js";
import { fakeClient } from "./helpers.js";
import { stripMarkupDeep } from "../src/markup.js";

const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
const SOURCE = Symbol.for("honeytongue.source");
const reply = (status, body = "", headers = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

test("sends the documented request shape", async () => {
  let sent;
  const answer = { type: "noul", noul: 0.2 };
  const client = createJevClient({ apiKey: "k", fetch: async (url, init) => { sent = { url, ...init }; return ok({ answers: { q: answer } }); } });
  assert.deepEqual(await client.ask({ s: 1 }, { q: { type: "noul" } }), { q: answer, [SOURCE]: "jev" });
  assert.equal(sent.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(sent.headers.Authorization, "Bearer k");
  assert.deepEqual(JSON.parse(sent.body), { model: "jev-1.13.0", state: { s: 1 }, questions: { q: { type: "noul" } } });
});

/** Runs `fn` with TYPESAFE_MODEL set (or removed), restoring it afterwards. */
async function withModelEnv(value, fn) {
  const before = process.env.TYPESAFE_MODEL;
  if (value === undefined) delete process.env.TYPESAFE_MODEL;
  else process.env.TYPESAFE_MODEL = value;
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.TYPESAFE_MODEL;
    else process.env.TYPESAFE_MODEL = before;
  }
}

test("the client's model comes from the option, then TYPESAFE_MODEL, then the pinned default", async () => {
  const modelSent = async (options) => {
    let body;
    const client = createJevClient({ apiKey: "k", ...options, fetch: async (url, init) => { body = JSON.parse(init.body); return ok({ answers: {} }); } });
    await client.ask({}, {});
    return body.model;
  };
  await withModelEnv(undefined, async () => assert.equal(await modelSent({}), "jev-1.13.0"));
  await withModelEnv("jev-from-env", async () => {
    assert.equal(await modelSent({}), "jev-from-env");
    assert.equal(await modelSent({ model: "jev-from-option" }), "jev-from-option");
  });
});

test("retries rate limits and network errors, then succeeds", async () => {
  let n = 0;
  const client = createJevClient({ apiKey: "k", fetch: async () => {
    n++;
    if (n === 1) throw new TypeError("network down");
    if (n === 2) return new Response("slow down", { status: 429 });
    return ok({ answers: { done: true } });
  } });
  assert.deepEqual(await client.ask({}, {}), { done: true, [SOURCE]: "jev" });
  assert.equal(n, 3);
});

test("times out instead of hanging forever, and doesn't retry a timeout", async () => {
  let n = 0;
  const hang = (url, { signal }) => { n++; return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))); };
  const client = createJevClient({ apiKey: "k", timeoutMs: 50, maxRetries: 3, fetch: hang });
  const keepAlive = setTimeout(() => {}, 1000); // abort timers don't hold the event loop open on their own
  try {
    await assert.rejects(client.ask({}, {}), /timed out/);
    assert.equal(n, 1);
  } finally {
    clearTimeout(keepAlive);
  }
});

test("refuses to run in a browser with a real key", () => {
  globalThis.window = { document: {} };
  try {
    assert.throws(() => createJevClient({ apiKey: "k" }), /expose your API key/);
    assert.doesNotThrow(() => createProxyClient({ url: "/api/persuade" }));
  } finally {
    delete globalThis.window;
  }
});

test("unexpected response shapes fail with a readable error", async () => {
  const ask = (body) => createJevClient({ apiKey: "k", fetch: async () => reply(200, body) }).ask({}, { persuasion: { type: "score" } });
  await assert.rejects(ask({ result: {} }), /no "answers" object/);
  await assert.rejects(ask({ answers: {} }), /no answer for question "persuasion"/);
  await assert.rejects(ask({ answers: { persuasion: { score: "high" } } }), /no valid "score"/);
  await assert.rejects(ask("<html>oops</html>"), /isn't JSON/);
});

test("the API key never appears in errors", async () => {
  assert.throws(() => createJevClient({ apiKey: "sk-12 34" }), (err) => /hidden characters/.test(err.message) && !err.message.includes("sk-12"));
  assert.throws(() => createJevClient({ apiKey: '"sk-1234"' }), /quote marks/);
  assert.doesNotThrow(() => createJevClient({ apiKey: "sk-1234\n" })); // a trailing newline is just trimmed
  const leaky = createJevClient({ apiKey: "sk-1234", maxRetries: 0, fetch: async () => { throw new TypeError('bad header "Bearer sk-1234"'); } });
  await assert.rejects(leaky.ask({}, {}), (err) => !err.message.includes("sk-1234") && err.message.includes("[api key]"));
  const rejected = createJevClient({ apiKey: "sk-1234", fetch: async () => reply(401, { error: "invalid key" }) });
  await assert.rejects(rejected.ask({}, {}), (err) => err.status === 401 && /TYPESAFE_API_KEY/.test(err.message) && !err.message.includes("sk-1234"));
});

test("Retry-After is honored, and long waits fail fast instead of stalling", async () => {
  let n = 0;
  const quick = createJevClient({ apiKey: "k", fetch: async () => (++n === 1 ? reply(429, "", { "Retry-After": "0" }) : ok({ answers: {} })) });
  await quick.ask({}, {});
  assert.equal(n, 2);
  n = 0;
  const slow = createJevClient({ apiKey: "k", fetch: async () => { n++; return reply(429, "", { "Retry-After": "120" }); } });
  await assert.rejects(slow.ask({}, {}), /rate limit/);
  assert.equal(n, 1);
});

test("the proxy client explains proxy errors and doesn't retry what the proxy already retried", async () => {
  let n = 0;
  const client = (res) => createProxyClient({ url: "https://proxy.test/", fetch: async () => { n++; return res(); } });
  await assert.rejects(client(() => reply(403, { error: "Origin not allowed" })).ask({}, {}), /allowedOrigins.*Origin not allowed/s);
  n = 0;
  await assert.rejects(client(() => reply(502, { error: "Jev is busy right now. Try again in a moment." })).ask({}, {}), /Jev is busy/);
  assert.equal(n, 1);
});

const post = (body, headers = {}) => new Request("https://proxy.test/", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
const valid = { state: { player_input: "hi" }, questions: { persuasion: { type: "score" } } };

test("proxy forwards valid requests", async () => {
  const handle = createProxyHandler({ client: fakeClient({ score: 2 }) });
  const res = await handle(post(valid));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).answers.persuasion.score, 2);
});

test("proxy rejects bad input, long input, and wrong methods", async () => {
  const handle = createProxyHandler({ client: fakeClient() });
  assert.equal((await handle(new Request("https://proxy.test/"))).status, 405);
  assert.equal((await handle(post({ state: {}, questions: { x: { type: "chat" } } }))).status, 400);
  assert.equal((await handle(post({ ...valid, state: { player_input: "x".repeat(600) } }))).status, 413);
});

test("proxy rate limits per IP and enforces allowed origins", async () => {
  const handle = createProxyHandler({ client: fakeClient(), rateLimit: { requests: 2, windowMs: 60_000 }, allowedOrigins: ["https://game.test"] });
  const from = { "X-Forwarded-For": "1.2.3.4", Origin: "https://game.test" };
  assert.equal((await handle(post(valid, from))).status, 200);
  assert.equal((await handle(post(valid, from))).status, 200);
  assert.equal((await handle(post(valid, from))).status, 429);
  const res = await handle(post(valid, { Origin: "https://evil.test" }));
  assert.equal(res.status, 403);
  const good = await handle(post(valid, { "X-Forwarded-For": "9.9.9.9", Origin: "https://game.test" }));
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("Access-Control-Allow-Origin"), "https://game.test");
});

test("with no allowedOrigins, the proxy only serves its own origin", async () => {
  const handle = createProxyHandler({ client: fakeClient() });
  assert.equal((await handle(post(valid, { Origin: "https://proxy.test" }))).status, 200);
  assert.equal((await handle(post(valid, { Origin: "https://evil.test" }))).status, 403);
  assert.equal((await handle(post(valid))).status, 200); // no Origin: not a browser, so the rate limit is the guard
});

test("a forged CF-Connecting-IP header can't dodge the rate limit", async () => {
  const handle = createProxyHandler({ client: fakeClient(), rateLimit: { requests: 2, windowMs: 60_000 } });
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await handle(post(valid, { "CF-Connecting-IP": `10.0.0.${i}` }))).status);
  assert.deepEqual(statuses, [200, 200, 429, 429]);
  const limited = await handle(post(valid));
  assert.ok(Number(limited.headers.get("Retry-After")) > 0);
});

test("the proxy can be told how to find the client's address", async () => {
  const handle = createProxyHandler({ client: fakeClient(), rateLimit: { requests: 1, windowMs: 60_000 }, clientIp: (req, env) => env.ip });
  assert.equal((await handle(post(valid), { ip: "a" })).status, 200);
  assert.equal((await handle(post(valid), { ip: "b" })).status, 200);
  assert.equal((await handle(post(valid), { ip: "a" })).status, 429);
});

test("the proxy rejects oversized and malformed bodies before calling Jev", async () => {
  const client = fakeClient();
  const handle = createProxyHandler({ client, maxStateBytes: 100 });
  assert.equal((await handle(post({ ...valid, state: { player_input: "é".repeat(60) } }))).status, 413); // 60 characters, 120 bytes
  assert.equal((await handle(post({ state: { a: 1 }, questions: [{ type: "score" }] }))).status, 400);
  assert.equal((await handle(post({ state: null, questions: { q: { type: "score" } } }))).status, 400);
  assert.equal(client.calls.length, 0);
});

test("the proxy tells players when Jev is busy", async () => {
  const busy = { async ask() { throw Object.assign(new Error("overloaded"), { status: 529 }); } };
  const original = console.error;
  console.error = () => {};
  try {
    const res = await createProxyHandler({ client: busy })(post(valid));
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /busy/);
  } finally {
    console.error = original;
  }
});

test("proxy replies say whether Jev or the mock answered, beside the answers", async () => {
  const tell = { state: { player_input: "hi" }, questions: { threats: { type: "noul" } } };
  const mock = await (await createProxyHandler({ client: createMockClient() })(post(tell))).json();
  assert.equal(mock.source, "mock");
  assert.equal("source" in mock.answers, false);

  const jev = createJevClient({ apiKey: "k", fetch: async () => ok({ answers: { persuasion: { type: "score", score: 1 } } }) });
  assert.equal((await (await createProxyHandler({ client: jev })(post(valid))).json()).source, "jev");
  // A client that doesn't say where its answers came from gets no label, not a guess.
  assert.equal((await (await createProxyHandler({ client: fakeClient() })(post(valid))).json()).source, undefined);
});

test("the proxy client reads the source from each reply", async () => {
  const sources = ["mock", "jev", undefined, "something else"];
  let n = 0;
  const client = createProxyClient({ url: "https://proxy.test/", fetch: async () => ok({ answers: {}, source: sources[n++] }) });
  const seen = [];
  for (let i = 0; i < sources.length; i++) seen.push((await client.ask({}, {}))[SOURCE]);
  assert.deepEqual(seen, ["mock", "jev", undefined, undefined]);
});

test("a proxy with no key and no client returns an error, never the mock", async () => {
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return ok({ answers: {} }); };
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const res = await createProxyHandler()(post(valid), {});
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.answers, undefined);
    assert.equal(body.source, undefined);
    assert.equal(fetched, 0);
    assert.match(logged.join("\n"), /Missing TypeSafe API key/);
  } finally {
    console.error = original;
    globalThis.fetch = realFetch;
    if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
  }
});

test("the engine's debug output says which client answered", async () => {
  const story = JSON.parse(readFileSync(new URL("../stories/gatehouse.json", import.meta.url), "utf8"));
  assert.equal((await new Game(story, createMockClient()).turn("Chat with Harry")).debug.source, "mock");
  assert.equal((await new Game(story, fakeClient()).turn("Chat with Harry")).debug.source, undefined);
});

test("a worst-case Gatehouse turn fits the proxy's default size limit", () => {
  const story = JSON.parse(readFileSync(new URL("../stories/gatehouse.json", import.meta.url), "utf8"));
  const game = new Game(story, createMockClient());
  const long = (c) => c.repeat(500);
  game.history = Array.from({ length: 4 }, () => ({ player: long("p"), result: "r".repeat(160) }));
  game.npc.attempts = Array.from({ length: 10 }, (_, i) => ({ said: long(String(i)), outcome: "unconvinced" }));
  game.flags.add("knows_daughter_is_sick");
  const body = JSON.stringify(stripMarkupDeep({ state: game.buildState(long("x")), questions: game.buildQuestions() }));
  const bytes = new TextEncoder().encode(body).length;
  assert.ok(bytes < 16_000, `worst case is ${bytes} bytes`);
});

test("the mock answers threats and insults separately", async () => {
  const mock = createMockClient();
  const tells = async (text) => {
    const a = await mock.ask({ player_input: text }, { threats: { type: "noul" }, insults: { type: "noul" } });
    return [a.threats.noul > 0.7, a.insults.noul > 0.7];
  };
  assert.deepEqual(await tells("open the gate or else"), [true, false]);
  assert.deepEqual(await tells("shut up, you useless old fool"), [false, true]);
  assert.deepEqual(await tells("Fuck you, Harry"), [false, true]);
  assert.deepEqual(await tells("open it, idiot, or I'll break your arm"), [true, true]);
  assert.deepEqual(await tells("please let me in"), [false, false]);
});

test("the mock needs whole words to call something hostile", async () => {
  const mock = createMockClient();
  const hostile = async (text) => (await mock.ask({ player_input: text }, { h: { type: "noul" } })).h.noul;
  assert.ok(await hostile("shut up, you fool") > 0.7);
  assert.ok(await hostile("I have a white horse and a useful skill") < 0.7);
});

test("the mock only rewards secrets the player has learned", async () => {
  const mock = createMockClient();
  const score = async (knows) => (await mock.ask({
    player_input: "Honestly, I can bring medicine for your daughter's fever.",
    character: { persona: "A guard.", secrets: [{ fact: "Her daughter has a fever and needs medicine.", player_knows: knows }] },
  }, { s: { type: "score", criteria: ["0", "1", "2", "3", "4"] } })).s.score;
  assert.ok(await score(true) >= 3.2);
  assert.ok(await score(false) < 2);
});

test("the mock credits an offer to help only alongside a secret the player knows", async () => {
  const mock = createMockClient();
  const score = async (text, knows = true) => (await mock.ask({
    player_input: text,
    character: { persona: "A miller.", secrets: [{ fact: "His mill wheel is broken.", player_knows: knows }] },
  }, { s: { type: "score", criteria: ["0", "1", "2", "3", "4"] } })).s.score;
  const pairs = [
    ["I can help mend your mill wheel.", "I can mend your mill wheel."],
    ["I'll bring a new wheel for your mill.", "I'll find a new wheel for your mill."],
    ["I will take your broken wheel to the smith.", "I will see your broken wheel, smith."],
  ];
  for (const [offer, plain] of pairs) assert.ok(await score(offer) - await score(plain) > 0.79, offer);
  assert.equal(await score("I'll give you a silver coin."), await score("You look busy tonight."));
  assert.equal(await score("I can help mend your mill wheel.", false), await score("Your mill wheel is broken.", false));
});

test("the mock leans toward persuading when the player pleads or speaks to the character by name", async () => {
  const mock = createMockClient();
  const criteria = {
    persuade: "Try to convince or plead with the miller so he lends the player his cart",
    read_note: "Read or look at the note the player carries",
  };
  const choose = async (text) => (await mock.ask(
    { player_input: text, character: { name: "Oswin Tallow" } }, { a: { type: "choice", criteria } })).a;
  for (const text of ["Oswin, I need the cart because my note is urgent.", "My note is urgent, Oswin.", "If you let me borrow it, I'll return the note tonight. Please."]) {
    const a = await choose(text);
    assert.equal(a.choice, "persuade", text);
    assert.ok(a.confidence >= 0.6, `${text}: ${a.confidence}`);
  }
  // Naming him in passing isn't speaking to him, and naming him without making a case isn't persuasion.
  // Two points to one, squared.
  assert.equal((await choose("Show Oswin the note because it's urgent")).probabilities.persuade, 4 / 5);
  assert.equal((await choose("Oswin, read the note")).choice, "read_note");
});

test("the mock acts on one clearly better match even when other options share a word with the input", async () => {
  const criteria = {
    persuade: "Try to convince the guard so he unlocks the cage and lets the player go",
    examine_cage: "Look at, examine, or test the bars and lashings of the cage",
    examine_bedroll: "Look at or examine the guard's bedroll",
    break_bar: "Pull a bar of the cage loose",
    wait: "Sit and wait in the cage",
  };
  const a = (await createMockClient().ask({ player_input: "examine the cage" }, { a: { type: "choice", criteria } })).a;
  assert.equal(a.choice, "examine_cage");
  assert.ok(a.confidence >= 0.6, String(a.confidence));
});

test("the mock matches plurals and -ing forms with the plain word", async () => {
  const criteria = { stow: "Hide inside a crate", look: "Look at the barrels" };
  const a = (await createMockClient().ask({ player_input: "try hiding among the crates" }, { a: { type: "choice", criteria } })).a;
  assert.equal(a.choice, "stow");
  assert.equal(a.confidence, 1);
});

test("the proxy's model comes from the option, then the Worker's TYPESAFE_MODEL, then the process's, then the default", async () => {
  const realFetch = globalThis.fetch;
  const modelSent = async (options, workerEnv, body = valid) => {
    let sent;
    globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return ok({ answers: { persuasion: { score: 1 } } }); };
    try {
      const res = await createProxyHandler(options)(post(body), { TYPESAFE_API_KEY: "k", ...workerEnv });
      assert.equal(res.status, 200);
      return sent.model;
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  await withModelEnv(undefined, async () => {
    assert.equal(await modelSent({}), "jev-1.13.0");
    assert.equal(await modelSent({}, { TYPESAFE_MODEL: "jev-from-worker" }), "jev-from-worker");
    assert.equal(await modelSent({ model: "jev-from-option" }, { TYPESAFE_MODEL: "jev-from-worker" }), "jev-from-option");
  });
  await withModelEnv("jev-from-process", async () => {
    assert.equal(await modelSent({}), "jev-from-process");
    assert.equal(await modelSent({}, { TYPESAFE_MODEL: "jev-from-worker" }), "jev-from-worker");
  });
  // A request can't choose the model.
  assert.equal(await withModelEnv(undefined, () => modelSent({}, {}, { ...valid, model: "jev-chosen-by-player" })), "jev-1.13.0");
});

test("a full engine turn fits within the proxy's default limits", async () => {
  const story = JSON.parse(readFileSync(new URL("../stories/gatehouse.json", import.meta.url), "utf8"));
  const handle = createProxyHandler({ client: createMockClient() });
  const sizes = [];
  const client = createProxyClient({
    url: "https://proxy.test/",
    fetch: async (url, init) => { sizes.push(Object.keys(JSON.parse(init.body).questions).length); return handle(new Request(url, init)); },
  });
  const game = new Game(story, client);
  assert.match((await game.turn("read the letter")).text, /wax seal/);
  assert.deepEqual(sizes, [4]);
});
