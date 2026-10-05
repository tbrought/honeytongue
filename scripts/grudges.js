// Grudges: does a good line score lower straight after an insult? Jev holds no grudges by itself (the multi-turn
// calibration found an honest offer after a threat or flattery scores as fresh), so this measures whether one sentence
// in the persona can add one. The bridge troll, with his secret known, says the same winning line fresh, and straight
// after an insult, as he is and with a grudge sentence in his persona. The lines are a real playtest's.
//
//   node scripts/grudges.js [--repeats 3] [--mock]
//
// Calls: repeats x 2 personas x 3 (one fresh attempt, and an insult and the line). 18 at the default.
import { mkdirSync, writeFileSync } from "node:fs";
import { Persuadable } from "../src/persuasion.js";
import { createMockClient } from "../src/mock.js";
import { liveClient, summarize, mean, sd } from "./live-recorder.js";
import { loadLiveEnv } from "./live-env.js";
import { troll } from "../examples/phaser/character.js";

const MOCK = process.argv.includes("--mock");
if (!MOCK) loadLiveEnv(); // the key, from .env.live, for live runs only
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const REPEATS = Number(arg("--repeats", 3));

export const INSULT = "Step aside, oaf. Or I will cast a fireball at you.";
export const LINE = "If you let me pass, we can be best friends.";
export const GRUDGE = "He holds a grudge: after an insult, it takes more than kind words to win him back.";
const personas = {
  "as he is": troll,
  "with a grudge": { ...troll, persona: `${troll.persona} ${GRUDGE}` },
};

const recorded = [];
let current = "";
const mock = createMockClient();
const client = MOCK
  ? { ask: async (...args) => { recorded.push({ label: current, status: 200, ms: 0, tokens: 0 }); return mock.ask(...args); } }
  : liveClient(() => current, recorded);
const out = [];
const say = (line = "") => { console.log(line); out.push(line); };
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : "-");

const results = {};
for (const [name, character] of Object.entries(personas)) {
  const fresh = [], after = [], insults = [];
  for (let i = 0; i < REPEATS; i++) {
    current = `grudges ${name} fresh`;
    const a = new Persuadable(character, { client });
    a.learn("lonely");
    fresh.push(await a.attempt(LINE));

    const b = new Persuadable(character, { client });
    b.learn("lonely");
    current = `grudges ${name} insult`;
    insults.push(await b.attempt(INSULT));
    current = `grudges ${name} after`;
    after.push(await b.attempt(LINE));
  }
  const row = (rs) => ({ scores: rs.map((r) => r.score), mean: mean(rs.map((r) => r.score)), sd: sd(rs.map((r) => r.score)),
    verdicts: rs.map((r) => r.verdict), threshold: rs[0].threshold ?? rs[0].debug?.threshold });
  results[name] = { fresh: row(fresh), afterInsult: row(after), insult: { verdicts: insults.map((r) => r.verdict) } };
}

const threshold = new Persuadable(troll, { client }).character.threshold;
say(`Grudges: "${LINE}" from the bridge troll (secret known, threshold ${fmt(threshold)}), fresh and straight after "${INSULT}"`);
say(`${REPEATS} repeats each${MOCK ? ", on the offline mock (a dry run)" : ", on live Jev"}.`);
say();
say("| Persona | Insult | Fresh: average (verdicts) | After the insult: average (verdicts) | Change |");
say("|---|---|---|---|---|");
for (const [name, r] of Object.entries(results)) {
  const tally = (vs) => Object.entries(vs.reduce((t, v) => ({ ...t, [v]: (t[v] ?? 0) + 1 }), {})).map(([v, n]) => `${v} ${n}/${vs.length}`).join(", ");
  say(`| ${name} | ${tally(r.insult.verdicts)} | ${fmt(r.fresh.mean)} (${tally(r.fresh.verdicts)}) | ${fmt(r.afterInsult.mean)} (${tally(r.afterInsult.verdicts)}) | ${(r.afterInsult.mean - r.fresh.mean >= 0 ? "+" : "") + fmt(r.afterInsult.mean - r.fresh.mean)} |`);
}
say();
say(`The grudge sentence: "${GRUDGE}"`);
say();
say(summarize(recorded));
say(`Calls: ${recorded.length}, tokens: ${recorded.reduce((n, c) => n + (c.tokens ?? 0), 0)}`);

if (!MOCK) {
  mkdirSync(new URL("../live-runs/", import.meta.url), { recursive: true });
  const stamp = Date.now();
  writeFileSync(new URL(`../live-runs/grudges-${stamp}.json`, import.meta.url), JSON.stringify({ repeats: REPEATS, threshold, results }, null, 2));
  writeFileSync(new URL(`../live-runs/grudges-${stamp}.txt`, import.meta.url), out.join("\n") + "\n");
}
