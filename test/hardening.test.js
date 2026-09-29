// The pre-0.1.0 hardening: the proxy's body, nesting, and deadline limits, toNodeListener, the browser guard in Web
// Workers, Persuadable's read-only state, the library's caps on what it sends, and context through a guarded proxy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  createJevClient, createProxyClient, createProxyHandler, toNodeListener, createMockClient, Game, Persuadable,
  judgePersuasion, persuasionState, defineCharacter, VERSION,
} from "../src/index.js";
import { toNodeListener as fromProxyEntry } from "../src/proxy.js";
import { fakeClient } from "./helpers.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const gatehouse = load("stories/gatehouse.json");
const harry = { name: "Harry", persona: "A tired night guard who values honesty.", goal: "Open the gate" };
const valid = { state: { player_input: "hi" }, questions: { x: { type: "noul", instructions: "Anything?" } } };
const open = (options = {}) => createProxyHandler({ client: fakeClient(), rateLimit: false, dangerouslyAllowAnyRequest: true, ...options });
const post = (body, init = {}) => new Request("https://proxy.test/", {
  method: "POST", body: typeof body === "string" || body instanceof ReadableStream ? body : JSON.stringify(body), ...init,
});
/** A proxy client whose requests go straight into a handler, as a page's would. */
const through = (handle) => createProxyClient({ url: "https://proxy.test/", maxRetries: 0, fetch: async (url, init) => handle(new Request(url, init)) });
const stream = (bytes, chunk = 1000) => new ReadableStream({
  start(c) { for (let i = 0; i < bytes; i += chunk) c.enqueue(new TextEncoder().encode("x".repeat(Math.min(chunk, bytes - i)))); c.close(); },
});

// ---- Request bodies, nesting, and the deadline ----

test("a body over maxStateBytes is refused as it streams in, whatever Content-Length says, and the limit is named", async () => {
  let pulled = 0;
  const endless = new ReadableStream({ pull(c) { pulled++; c.enqueue(new TextEncoder().encode("x".repeat(1000))); } });
  const res = await open({ maxStateBytes: 5000 })(post(endless, { duplex: "half" }));
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /maxStateBytes of 5000 bytes/);
  assert.ok(pulled <= 7, `stopped reading after about 5000 bytes (${pulled} chunks)`);
  assert.equal((await open({ maxStateBytes: 5000 })(post(stream(4000), { duplex: "half" }))).status, 400, "under the limit, it's read (and isn't JSON)");
});

test("JSON nested deeper than any real request is refused with a 400, before the guard sees it", async () => {
  const deep = (n) => `{"state":{"player_input":"hi"},"questions":{"x":{"type":"noul","instructions":"x","deep":${"[".repeat(n)}${"]".repeat(n)}}}}`;
  const guarded = createProxyHandler({ client: fakeClient(), rateLimit: false, allowedStories: [gatehouse] });
  for (const handle of [open(), guarded]) {
    const res = await handle(post(deep(7000)));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /nested more than 32 levels/);
  }
  assert.notEqual((await open()(post(deep(20)))).status, 400, "ordinary nesting is fine");
});

test("deadlineMs bounds a Jev call, retries and waits included; without it there's no deadline", async () => {
  const ok = { answers: { x: { type: "noul", noul: 0.1 } } };
  // Always a server error: the retries would take 0.5 + 1 + 2 + 4 seconds, but the deadline stops them early.
  let calls = 0;
  const failing = async () => { calls++; return new Response("{}", { status: 500 }); };
  let started = Date.now();
  await assert.rejects(createJevClient({ apiKey: "k", maxRetries: 5, deadlineMs: 1200, fetch: failing }).ask({}, { x: { type: "noul" } }), /server error/);
  assert.equal(calls, 2, "a retry that couldn't finish in time isn't made");
  assert.ok(Date.now() - started < 1200);
  // A call that hangs is cut off at the deadline, not at the (longer) per-try timeout.
  const hanging = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  started = Date.now();
  await assert.rejects(createJevClient({ apiKey: "k", timeoutMs: 10_000, deadlineMs: 300, fetch: hanging }).ask({}, {}), /ran out of time: no answer within 300ms/);
  assert.ok(Date.now() - started < 2000);
  // No deadline by default.
  calls = 0;
  const flaky = async () => (++calls < 3 ? new Response("{}", { status: 500 }) : new Response(JSON.stringify(ok)));
  assert.equal((await createJevClient({ apiKey: "k", fetch: flaky }).ask({}, { x: { type: "noul" } })).x.noul, 0.1);
  assert.throws(() => createJevClient({ apiKey: "k", deadlineMs: 0 }), /deadlineMs must be/);
});

// ---- toNodeListener ----

test("toNodeListener serves a handler on Node, caps bodies, and passes the socket's address", async () => {
  assert.equal(fromProxyEntry, toNodeListener, "exported from honeytongue/proxy too");
  const handle = createProxyHandler({ client: createMockClient(), allowedCharacters: [harry], rateLimit: { requests: 1, windowMs: 60_000 },
    clientIp: (request, env) => env.remoteAddress });
  const server = createServer(toNodeListener(handle, { maxBytes: 4000 }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    const result = await new Persuadable(harry, { client: createProxyClient({ url, maxRetries: 0 }) }).attempt("Please, I'm honest.");
    assert.equal(result.verdict, "unconvinced", "judged through the Node server");
    const again = await fetch(url, { method: "POST", body: "{}" });
    assert.equal(again.status, 429, "rate-limited by the socket's address, from env.remoteAddress");
    const big = await fetch(url, { method: "POST", body: "x".repeat(10_000) });
    assert.equal(big.status, 413);
    assert.match(await big.text(), /over 4000 bytes/);
  } finally {
    server.close();
  }
});

// ---- The browser guard ----

test("createJevClient refuses a browser's Web Worker too, but not a server's worker", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const as = (userAgent, fn) => {
    globalThis.WorkerGlobalScope = function WorkerGlobalScope() {};
    Object.defineProperty(globalThis, "navigator", { value: { userAgent }, configurable: true });
    try { return fn(); } finally {
      delete globalThis.WorkerGlobalScope;
      if (saved) Object.defineProperty(globalThis, "navigator", saved); else delete globalThis.navigator;
    }
  };
  as("Mozilla/5.0 (Windows NT 10.0) Chrome/140", () => assert.throws(() => createJevClient({ apiKey: "k" }), /expose your API key in the browser/));
  as("Mozilla/5.0 (Windows NT 10.0) Chrome/140", () => assert.doesNotThrow(() => createJevClient({ apiKey: "k", dangerouslyAllowBrowser: true })));
  for (const server of ["Deno/2.5.0", "Bun/1.3.0", "Cloudflare-Workers"]) as(server, () => assert.doesNotThrow(() => createJevClient({ apiKey: "k" }), server));
});

// ---- Persuadable's state ----

test("a Persuadable's state can be read but only changed through its methods", async () => {
  const npc = new Persuadable({ ...harry, patience: 3 }, { client: createMockClient() });
  await npc.attempt("You're the finest guard in the kingdom.");
  npc.learn("secret");
  assert.equal(npc.attempts.length, 1);
  assert.equal(npc.patienceLeft, 2);
  assert.equal(npc.convinced, false);
  assert.deepEqual([...npc.knows], ["secret"]);
  for (const field of ["attempts", "knows", "patienceLeft", "convinced", "outOfPatience"]) {
    assert.throws(() => { npc[field] = null; }, TypeError, `${field} is read-only`);
  }
  assert.throws(() => npc.attempts.push({ said: "x", outcome: "convinced" }), TypeError, "attempts is a frozen copy");
  assert.throws(() => { npc.attempts[0].outcome = "convinced"; }, TypeError, "and so is each attempt");
  npc.knows.add("other");
  assert.deepEqual([...npc.knows], ["secret"], "knows is a copy: learn() adds secrets");
  assert.equal("queue" in npc, false, "the queue is private");
  assert.equal("queue" in new Game(gatehouse, createMockClient()), false, "and so is the engine's");
  npc.reset();
  assert.deepEqual([npc.attempts.length, npc.patienceLeft, npc.knows.size], [0, 3, 0]);
});

test("a Persuadable keeps its last 100 attempts for spotting repeats", () => {
  const npc = new Persuadable(harry, { client: createMockClient() });
  for (let i = 0; i < 105; i++) npc.record(`attempt number ${i} with words word${i}`, null);
  assert.equal(npc.attempts.length, 100);
  assert.equal(npc.attempts[0].said, "attempt number 5 with words word5");
  assert.equal(npc.record("attempt number 104 with words word104", null).verdict, "repeated", "recent ones are still repeats");
});

// ---- What the library sends: the last `memory` attempts, or 1,500 characters of them ----

test("previous attempts sent are the last `memory`, or 1,500 characters of them, whichever runs out first", () => {
  const npc = new Persuadable(harry, { client: createMockClient() });
  for (let i = 0; i < 12; i++) npc.record(`short line ${i} word${i}`, null);
  assert.equal(npc.state("hi").previous_attempts.length, 10, "short lines: the last 10");
  const long = new Persuadable(harry, { client: createMockClient() });
  for (let i = 0; i < 5; i++) long.record(`${String(i).repeat(400)} word${i}`, null);
  const sent = long.state("hi").previous_attempts;
  assert.equal(sent.length, 3, "long lines: as many of the latest as fit in 1,500 characters");
  assert.ok(sent.reduce((n, a) => n + a.said.length, 0) <= 1500);
  assert.equal(sent.at(-1).said, long.attempts.at(-1).said, "the newest are kept");
  // judgePersuasion's previousAttempts are trimmed the same way.
  const many = Array.from({ length: 15 }, (_, i) => ({ said: `line ${i}`, outcome: "unconvinced" }));
  assert.equal(persuasionState(harry, "hi", { previousAttempts: many }).previous_attempts.length, 10);
});

test("recent turns keep the first 200 characters of what the player typed", async () => {
  const game = new Game(gatehouse, createMockClient());
  await game.turn(`Chat with Harry ${"please ".repeat(60)}`);
  assert.equal(game.history[0].player.length, 200);
});

test("a guarded proxy refuses more than the library sends, and names the limit", async () => {
  const handle = createProxyHandler({ client: createMockClient(), rateLimit: false, allowedStories: [gatehouse], allowedCharacters: [harry] });
  const { persuasionQuestions } = await import("../src/index.js");
  const send = async (state, questions) => (await handle(post({ state, questions, honeytongue: VERSION }))).json();
  const long = Array.from({ length: 4 }, (_, i) => ({ said: `${i}`.repeat(450), outcome: "unconvinced" }));
  const attempts = await send({ ...persuasionState(harry, "hi"), previous_attempts: long }, persuasionQuestions(harry));
  assert.match(attempts.error, /previous_attempts total 1800 characters, more than Harry's memoryLength of 1500/);
  const game = new Game(gatehouse, createMockClient());
  const state = game.buildState("hello");
  state.recent_turns = [{ player: "p".repeat(201), result: "r" }];
  const res = await send(state, game.buildQuestions());
  assert.match(res.error, /recent_turns\[0\]\.player is longer than the story's recentTurnLength of 200 characters/);
});

test("memoryLength and recentTurnLength can be raised or lowered, and a guarded proxy enforces each one's own value", async () => {
  const chatty = { ...harry, name: "Chatty", memoryLength: 3000 };
  const npc = new Persuadable(chatty, { client: createMockClient() });
  for (let i = 0; i < 5; i++) npc.record(`${String(i).repeat(400)} word${i}`, null);
  assert.equal(npc.state("hi").previous_attempts.length, 5, "a longer memoryLength sends more of them");
  assert.equal(new Persuadable({ ...harry, memoryLength: 0 }).state("hi").previous_attempts.length, 0);
  const handle = createProxyHandler({ client: createMockClient(), rateLimit: false, allowedCharacters: [chatty] });
  assert.equal((await npc.attempt("A new argument entirely", {}).catch((e) => e)).verdict ?? null, "unconvinced");
  const res = await through(handle).ask(npc.state("A fresh argument"), (await import("../src/index.js")).persuasionQuestions(chatty));
  assert.ok(res, "the proxy accepts 2,000 characters of attempts for a character allowed 3,000");
  assert.throws(() => defineCharacter({ ...harry, memoryLength: -1 }), /"memoryLength" must be a whole number of characters, 0 or more/);

  const terse = { ...gatehouse, recentTurnLength: 50 };
  const game = new Game(terse, createMockClient());
  await game.turn(`Chat with Harry ${"please ".repeat(20)}`);
  assert.equal(game.history[0].player.length, 50);
  const guarded = createProxyHandler({ client: createMockClient(), rateLimit: false, allowedStories: [terse] });
  const state = game.buildState("hello");
  state.recent_turns = [{ player: "p".repeat(51), result: "r" }];
  const refused = await (await guarded(post({ state, questions: game.buildQuestions(), honeytongue: VERSION }))).json();
  assert.match(refused.error, /recentTurnLength of 50 characters/);
  assert.throws(() => new Game({ ...gatehouse, recentTurnLength: 0 }, createMockClient()), /"recentTurnLength" must be a whole number of characters from 1 to 500/);
});

// ---- context, for characters that opt in ----

test("context goes through a guarded proxy only for a character with maxContextLength, and only up to it", async () => {
  const withContext = { ...harry, maxContextLength: 60 };
  const handle = createProxyHandler({ client: createMockClient(), rateLimit: false, allowedCharacters: [harry, { ...withContext, name: "Hazel" }] });
  const client = through(handle);
  // Not opted in: refused, with how to opt in.
  const plain = new Persuadable(harry, { client });
  await assert.rejects(plain.attempt("hello", { context: { gold: 12 } }), /context isn't allowed for Harry: give the character a maxContextLength/);
  // Opted in: accepted up to the limit.
  const hazel = new Persuadable({ ...withContext, name: "Hazel" }, { client });
  assert.equal((await hazel.attempt("hello", { context: { gold: 12 } })).verdict, "unconvinced");
  assert.equal((await hazel.attempt("hello again, friend", {})).verdict, "unconvinced", "and without context too");
  // Over the limit: the library says so before sending anything, and the proxy refuses it anyway.
  await assert.rejects(hazel.attempt("hi there", { context: { note: "x".repeat(80) } }), /context is \d+ characters as JSON, more than its maxContextLength of 60/);
  const state = { ...persuasionState(harry, "hi"), character: persuasionState({ ...withContext, name: "Hazel" }, "hi").character, context: { note: "x".repeat(80) } };
  const { persuasionQuestions } = await import("../src/index.js");
  const res = await (await handle(post({ state, questions: persuasionQuestions({ ...withContext, name: "Hazel" }), honeytongue: VERSION }))).json();
  assert.match(res.error, /context is longer than Hazel's maxContextLength of 60/);
  // Checked when the character is defined, and context must be JSON data.
  assert.throws(() => defineCharacter({ ...harry, maxContextLength: 0 }), /"maxContextLength" must be a whole number of characters above 0/);
  await assert.rejects(judgePersuasion(createMockClient(), withContext, "hi", { context: () => 1 }), /context must be JSON data/);
});
