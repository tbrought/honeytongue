// Angle calibration against live Jev. Needs .env.live; every call is recorded in live-runs/, with the rows saved there.
//
//   node scripts/angles.js coverage [--dry-run]
//     Which appeals real arguments make: every persuasion line in the scene suites, the showcase, the calibration
//     argument sets, and the playtest transcripts in playtests/ (if any), each classified once against three
//     candidate angle sets in one request, to see how many land in "other" and which appeals are missing.
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { defineCharacter, persuasionState } from "../src/persuasion.js";
import { liveClient, summarize } from "./live-recorder.js";
import { loadLiveEnv } from "./live-env.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const presets = load("stories/characters.json");
const scenes = load("stories/index.json");
const sceneCharacter = Object.fromEntries(scenes.map((s) => [s.id, s.character]));

// Candidate angle sets: A as first proposed, B with compassion and honesty, C with three more.
const ANGLES = {
  family: "Family or loved ones: theirs, or the player's",
  money: "Money, payment, goods, or a trade",
  duty: "Duty, rules, orders, their job, or what's right by the law",
  fear: "Fear: danger, threats, or bad consequences if they refuse",
  flattery: "Praise or flattery of them",
  compassion: "Pity or compassion: someone suffering, in danger, or whose life depends on it",
  honesty: "Honesty: plain truth, being straight with them, or a sincere promise",
  reason: "Reasons and evidence: facts, a plan, or proof that agreeing is safe or sensible",
  benefit: "Something they want for themselves other than money: help with their own hopes, a favour, or a chance",
  authority: "Rank or authority: who the player is or claims to be, or orders from someone important",
  other: "Something else, or no real appeal",
};
const SETS = {
  A: ["family", "money", "duty", "fear", "flattery", "other"],
  B: ["family", "money", "duty", "fear", "flattery", "compassion", "honesty", "other"],
  C: ["family", "money", "duty", "fear", "flattery", "compassion", "honesty", "reason", "benefit", "authority", "other"],
};
const question = (name, set) => ({
  type: "choice",
  instructions: `\`player_input\` is what the player says aloud to ${name}, inside the game, to persuade them. ` +
    "What does it mainly appeal to? Pick the one appeal it leans on most.",
  criteria: Object.fromEntries(set.map((a) => [a, ANGLES[a]])),
});

/** Every persuasion line we have, with the character it was said to. */
function lines() {
  const out = [];
  const add = (source, character, input) => { if (input?.trim()) out.push({ source, character, input: input.trim() }); };
  for (const s of scenes) {
    for (const c of load(`evals/${s.file}`).cases) {
      if (c.verdict || c.score || /^persuade/.test(c.expect ?? "")) add(`suite ${s.id}`, s.character, c.input);
    }
  }
  for (const l of load("evals/showcase.json").lines) add("showcase", "harry", l.input);
  for (const [id, set] of Object.entries(load("evals/calibration/arguments.json").sets)) {
    for (const [group, inputs] of Object.entries(set)) if (Array.isArray(inputs) && group !== "knows") for (const i of inputs) add(`arguments ${group}`, id, i);
  }
  const dir = new URL("../playtests/", import.meta.url);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const t = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
      for (const turn of (t.runs ?? []).flatMap((r) => r.turns ?? [])) if (turn.verdict) add(`playtest ${t.scene}`, sceneCharacter[t.scene], turn.input);
    }
  }
  // The same line said to the same character once is enough.
  return out.filter((l, i) => out.findIndex((m) => m.character === l.character && m.input === l.input) === i);
}

async function coverage() {
  const all = lines();
  console.log(`${all.length} lines, one call each`);
  if (process.argv.includes("--dry-run")) return;
  loadLiveEnv();
  const recorded = [];
  const client = liveClient("angles coverage", recorded);
  const rows = [];
  for (const l of all) {
    const c = defineCharacter(presets[l.character]);
    const answers = await client.ask(persuasionState(c, l.input), Object.fromEntries(Object.entries(SETS).map(([k, set]) => [k, question(c.name, set)])));
    rows.push({ ...l, ...Object.fromEntries(Object.keys(SETS).map((k) => [k, { choice: answers[k]?.choice, p: answers[k]?.probabilities?.[answers[k]?.choice] ?? 0 }])) });
  }
  mkdirSync(new URL("../live-runs/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../live-runs/angles-coverage-${Date.now()}.json`, import.meta.url), JSON.stringify(rows, null, 2));

  for (const k of Object.keys(SETS)) {
    const counts = {};
    for (const r of rows) counts[r[k].choice] = (counts[r[k].choice] ?? 0) + 1;
    const confident = rows.filter((r) => r[k].p >= 0.6).length;
    console.log(`\nSet ${k} (${SETS[k].join(", ")}): "other" ${counts.other ?? 0}/${rows.length}; confident (0.6+) ${confident}/${rows.length}`);
    console.log("  " + Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(", "));
  }
  console.log('\nLines in set A\'s "other", with what B and C chose:');
  for (const r of rows.filter((r) => r.A.choice === "other")) {
    console.log(`  B ${r.B.choice} ${r.B.p.toFixed(2)} | C ${r.C.choice} ${r.C.p.toFixed(2)} | ${r.character}: "${r.input.slice(0, 90)}"`);
  }
  console.log("\n" + summarize(recorded));
}

const steps = { coverage };
const step = steps[process.argv[2]];
if (!step) { console.error(`Usage: node scripts/angles.js ${Object.keys(steps).join("|")} [--dry-run]`); process.exit(1); }
await step();
