// Grudges: does a good line score lower straight after an insult? Jev holds no grudges by itself (the multi-turn
// calibration found an honest offer after a threat or flattery scores as fresh), so this measures whether a sentence in
// the persona can add one. Each experiment is a character, with its secret known, saying a line fresh, and straight
// after an insult. The troll's insult and "best friends" line are a real playtest's.
//
//   node scripts/grudges.js [--repeats 3] [--only troll-grudge-strong,harry] [--mock]
//
// Calls: repeats x 3 per experiment (one fresh attempt, and the insult and the line).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Persuadable } from "../src/persuasion.js";
import { createMockClient } from "../src/mock.js";
import { liveClient, summarize, mean, sd } from "./live-recorder.js";
import { loadLiveEnv } from "./live-env.js";
import { troll } from "../examples/phaser/character.js";

const MOCK = process.argv.includes("--mock");
if (!MOCK) loadLiveEnv(); // the key, from .env.live, for live runs only
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const REPEATS = Number(arg("--repeats", 3));
const ONLY = arg("--only", null)?.split(",") ?? null;

const presets = JSON.parse(readFileSync(new URL("../stories/characters.json", import.meta.url), "utf8"));
const harry = (Array.isArray(presets) ? presets : Object.values(presets)).map((p) => p.character ?? p).find((c) => c.name === "Harry Goatleaf");

export const GRUDGE = "He holds a grudge: after an insult, it takes more than kind words to win him back.";
export const FIRM = "He never forgives an insult, and won't let anyone who has insulted him across.";
const withPersona = (character, sentence) => ({ ...character, persona: `${character.persona} ${sentence}` });

const TROLL = {
  secret: "lonely",
  insult: "Step aside, oaf. Or I will cast a fireball at you.",
  bestFriends: "If you let me pass, we can be best friends.",
  strong: "Please let me cross, and I'll come back and visit you.",
};
const HARRY = {
  secret: "knows_daughter_is_sick",
  insult: "Open the gate, you useless old fool.",
  strong: "I won't lie to you, this letter carries a fever remedy for Ilse the apothecary. Let me through and I'll ask her to come see your daughter tonight.",
};
const EXPERIMENTS = {
  "troll": { label: "Tolly as he is", character: troll, ...TROLL, line: TROLL.bestFriends },
  "troll-grudge": { label: "Tolly with the grudge sentence", character: withPersona(troll, GRUDGE), ...TROLL, line: TROLL.bestFriends },
  "troll-strong": { label: "Tolly as he is", character: troll, ...TROLL, line: TROLL.strong },
  "troll-grudge-strong": { label: "Tolly with the grudge sentence", character: withPersona(troll, GRUDGE), ...TROLL, line: TROLL.strong },
  "troll-firm-strong": { label: "Tolly with the firm sentence", character: withPersona(troll, FIRM), ...TROLL, line: TROLL.strong },
  "troll-firm": { label: "Tolly with the firm sentence", character: withPersona(troll, FIRM), ...TROLL, line: TROLL.bestFriends },
  "harry": { label: "Harry as he is", character: harry, ...HARRY, line: HARRY.strong },
  "harry-grudge": { label: "Harry with the grudge sentence", character: withPersona(harry, GRUDGE), ...HARRY, line: HARRY.strong },
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
const tally = (vs) => Object.entries(vs.reduce((t, v) => ({ ...t, [v]: (t[v] ?? 0) + 1 }), {})).map(([v, n]) => `${v} ${n}/${vs.length}`).join(", ");
const row = (rs) => ({ scores: rs.map((r) => r.score), mean: mean(rs.map((r) => r.score)), sd: sd(rs.map((r) => r.score)), verdicts: rs.map((r) => r.verdict) });

const results = {};
for (const [id, x] of Object.entries(EXPERIMENTS)) {
  if (ONLY && !ONLY.includes(id)) continue;
  const fresh = [], after = [], insults = [];
  for (let i = 0; i < REPEATS; i++) {
    current = `grudges ${id} fresh`;
    const a = new Persuadable(x.character, { client });
    a.learn(x.secret);
    fresh.push(await a.attempt(x.line));

    const b = new Persuadable(x.character, { client });
    b.learn(x.secret);
    current = `grudges ${id} insult`;
    insults.push(await b.attempt(x.insult));
    current = `grudges ${id} after`;
    after.push(await b.attempt(x.line));
  }
  const threshold = new Persuadable(x.character, { client }).character.threshold;
  results[id] = { label: x.label, line: x.line, insult: x.insult, threshold, fresh: row(fresh), afterInsult: row(after), insults: row(insults) };
}

say(`Grudges: each line fresh, and straight after an insult, with the character's secret known. ${REPEATS} repeats each${MOCK ? ", on the offline mock (a dry run)" : ", on live Jev"}.`);
say(`The grudge sentence: "${GRUDGE}"`);
say(`The firm sentence: "${FIRM}"`);
say();
say("| Experiment | Line | Threshold | Insult | Fresh: average (range), verdicts | After the insult | Change |");
say("|---|---|---|---|---|---|---|");
for (const [id, r] of Object.entries(results)) {
  const range = (x) => `${fmt(x.mean)} (${fmt(Math.min(...x.scores))} to ${fmt(Math.max(...x.scores))}), ${tally(x.verdicts)}`;
  const change = r.afterInsult.mean - r.fresh.mean;
  say(`| ${id}: ${r.label} | "${r.line}" | ${fmt(r.threshold)} | ${tally(r.insults.verdicts)} | ${range(r.fresh)} | ${range(r.afterInsult)} | ${change >= 0 ? "+" : ""}${fmt(change)} |`);
}
say();
say(summarize(recorded));
say(`Calls: ${recorded.length}, tokens: ${recorded.reduce((n, c) => n + (c.tokens ?? 0), 0)}`);

if (!MOCK) {
  mkdirSync(new URL("../live-runs/", import.meta.url), { recursive: true });
  const stamp = Date.now();
  writeFileSync(new URL(`../live-runs/grudges-${stamp}.json`, import.meta.url), JSON.stringify({ repeats: REPEATS, results }, null, 2));
  writeFileSync(new URL(`../live-runs/grudges-${stamp}.txt`, import.meta.url), out.join("\n") + "\n");
}
