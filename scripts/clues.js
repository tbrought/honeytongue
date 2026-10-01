// Clue calibration against live Jev: each demo character's clue, tried with lines that should match it (guesses,
// including ones with the details wrong) and lines that shouldn't (near misses, injection attempts, plain lines).
// Standalone attempts on the presets, with nothing learned. Every call is recorded in live-runs/, and the rows are
// saved there for analysis. Needs .env.live.
//
//   node scripts/clues.js                 3 repeats of every line in evals/calibration/clues.json
//   node scripts/clues.js --repeats 1
//   node scripts/clues.js --dry-run       count the calls, make none
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { defineCharacter, persuasionQuestions, persuasionState, readPersuasion } from "../src/persuasion.js";
import { liveClient, summarize } from "./live-recorder.js";
import { loadLiveEnv } from "./live-env.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const REPEATS = Number(arg("--repeats", 3));
const set = load("evals/calibration/clues.json");
const presets = load("stories/characters.json");
const SHOULD_MATCH = new Set(["guess", "wrong"]);

const jobs = Object.entries(set.characters).flatMap(([id, groups]) =>
  Object.entries(groups).flatMap(([group, lines]) => lines.map((line) => ({ id, group, line }))));
console.log(`${jobs.length} lines x ${REPEATS} repeats = ${jobs.length * REPEATS} calls`);
if (process.argv.includes("--dry-run")) process.exit(0);

loadLiveEnv();
const recorded = [];
let current = "";
const client = liveClient(() => current, recorded);
const rows = [];
for (const { id, group, line } of jobs) {
  const c = defineCharacter(presets[id]);
  current = `clues ${id} ${group}`;
  for (let i = 0; i < REPEATS; i++) {
    const answers = await client.ask(persuasionState(c, line), persuasionQuestions(c));
    const judged = readPersuasion(c, answers);
    const key = Object.keys(persuasionQuestions(c).clue.criteria).find((k) => k !== "none"); // the one clue's option
    rows.push({ id, group, line, choice: answers.clue?.choice, p: answers.clue?.probabilities?.[key] ?? 0,
      verdict: judged.verdict, score: judged.score, matched: Boolean(judged.clue) });
  }
}

mkdirSync(new URL("../live-runs/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../live-runs/clues-${Date.now()}.json`, import.meta.url), JSON.stringify({ repeats: REPEATS, rows }, null, 2));

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
console.log("\nBy character and group (matched at clueAt 0.6; mean probability of the clue):");
for (const id of Object.keys(set.characters)) {
  for (const group of Object.keys(set.characters[id])) {
    const g = rows.filter((r) => r.id === id && r.group === group);
    const mean = g.reduce((a, r) => a + r.p, 0) / g.length;
    console.log(`  ${id.padEnd(6)} ${group.padEnd(9)} matched ${String(g.filter((r) => r.matched).length).padStart(2)}/${g.length}  mean p ${mean.toFixed(2)}`);
  }
}
console.log("\nMisses and false matches:");
for (const r of rows) {
  const wrong = SHOULD_MATCH.has(r.group) ? !r.matched : r.matched;
  if (wrong) console.log(`  ${r.id} ${r.group}: p ${r.p.toFixed(2)} (${r.choice}) "${r.line.slice(0, 80)}"`);
}
console.log("\nWhere clueAt could cut (rate of matches among lines that should match, and of false matches among the rest):");
for (const at of [0.4, 0.5, 0.6, 0.7, 0.8]) {
  const hit = (r) => r.choice !== "none" && r.p >= at;
  const should = rows.filter((r) => SHOULD_MATCH.has(r.group));
  const shouldNot = rows.filter((r) => !SHOULD_MATCH.has(r.group));
  const injections = rows.filter((r) => r.group === "injection");
  console.log(`  clueAt ${at.toFixed(1)}: matches ${pct(should.filter(hit).length, should.length)}, false ${pct(shouldNot.filter(hit).length, shouldNot.length)}` +
    ` (${shouldNot.filter(hit).length}/${shouldNot.length}), injections ${injections.filter(hit).length}/${injections.length}`);
}
console.log("\n" + summarize(recorded));
