// How many tokens can one request the demo Worker accepts cost, against a normal turn? Makes 5 live Jev calls
// (recorded in live-runs/, within the live recorder's budget), each only after checking locally that the demo
// Worker's guard accepts it:
//
//   node scripts/headroom.js
//   node scripts/headroom.js --dry-run     (the local checks only: no live calls, no key needed)
//
// 1. A normal turn: the Gatehouse, a few turns into a conversation, with ordinary lines.
// 2 to 5. The largest request the guard accepts (every field a script controls, filled to the limit the library
//    sends), padded with random ASCII, Japanese, emoji, and emoji and Japanese mixed. Random rather than repeated
//    characters, because repeats compress into fewer tokens and would understate the worst case.
import { Game, createMockClient, createJevClient, VERSION } from "../src/index.js";
import { stripMarkupDeep } from "../src/markup.js";
import worker, { DEMO_STORIES, DEMO_CHARACTERS } from "../examples/demo-worker.js";
import { largestRequest, bytesOf } from "./largest-request.js";
import { recordingFetch, readLedger } from "./live-recorder.js";
import { loadLiveEnv } from "./live-env.js";

const dryRun = process.argv.includes("--dry-run");
if (!dryRun && !loadLiveEnv()) {
  console.error("TYPESAFE_API_KEY isn't set: put it in .env.live at the repository root (see scripts/live-env.js).");
  process.exit(1);
}

// A seeded random source, so each run sends the same padding.
let seed = 20260929;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (from, to) => String.fromCodePoint(from + Math.floor(random() * (to - from + 1)));
const ascii = () => pick(0x21, 0x7e);
const japanese = () => (random() < 0.3 ? pick(0x3041, 0x3093) : pick(0x4e00, 0x9fa5)); // hiragana and kanji
const emoji = () => pick(0x1f300, 0x1f64f); // two UTF-16 code units each
/** n UTF-16 code units of `next()`, with a space every few characters, as text would have. */
const fill = (next) => (n) => {
  let s = "";
  while (s.length < n) {
    const c = s.length % 12 === 11 ? " " : next();
    if (s.length + c.length > n) { s += " "; continue; }
    s += c;
  }
  return s;
};
const mixed = () => (random() < 0.5 ? emoji() : japanese());

// A normal turn: a few ordinary lines into the Gatehouse, then the next one.
const game = new Game(DEMO_STORIES[0], createMockClient());
for (const line of ["examine the lantern", "Chat with Harry", "Please, I need to get into the city tonight."]) await game.turn(line);
const normal = { ...stripMarkupDeep({ state: game.buildState("I have a letter for the apothecary, and it's urgent."), questions: game.buildQuestions() }), honeytongue: VERSION };

const cases = [
  ["a normal turn", normal],
  ...[["ASCII", ascii], ["Japanese", japanese], ["emoji", emoji], ["emoji and Japanese", mixed]].map(([name, next]) =>
    [`the largest accepted request, padded with ${name}`, largestRequest({ stories: DEMO_STORIES, characters: DEMO_CHARACTERS, text: fill(next) }).body]),
];

// Check each one locally against the demo Worker's own guard (a mock answers; nothing reaches Jev).
const env = { ALLOWED_ORIGINS: "https://honeytongue.dev", TYPESAFE_API_KEY: "not-used-here" };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith("https://api.typesafe.ai")) return realFetch(url, init);
  const { state, questions } = JSON.parse(init.body);
  return new Response(JSON.stringify({ answers: await createMockClient().ask(state, questions) }), { status: 200 });
};
for (const [name, body] of cases) {
  const res = await worker.fetch(new Request("https://api.honeytongue.dev/judge", { method: "POST", headers: { Origin: "https://honeytongue.dev" }, body: JSON.stringify(body) }), env);
  if (res.status !== 200) throw new Error(`The demo Worker refuses ${name} (${res.status}): ${(await res.text()).slice(0, 200)}. Not sending it.`);
}
globalThis.fetch = realFetch;
if (dryRun) {
  for (const [name, body] of cases) console.log(`${name}: ${bytesOf(body)} bytes, accepted by the demo Worker's guard`);
  process.exit(0);
}

// Then one live call each, with no retries, recording the input tokens Jev reports.
const before = readLedger();
const results = [];
for (const [name, body] of cases) {
  let usage = null;
  const record = recordingFetch(`headroom ${name}`);
  const jev = createJevClient({ maxRetries: 0, fetch: async (url, init) => {
    const res = await record(url, init);
    usage = (await res.clone().json().catch(() => null))?.usage ?? null;
    return res;
  } });
  await jev.ask(body.state, body.questions);
  results.push({ name, bytes: bytesOf(body), input: usage?.input_tokens ?? null });
}
const base = results[0].input;
for (const r of results) console.log(`${r.name}: ${r.bytes} bytes, ${r.input} input tokens (${(r.input / base).toFixed(2)}x a normal turn)`);
const after = readLedger();
console.log(`\n${after.calls - before.calls} live calls, ${after.tokens - before.tokens} tokens in all.`);
