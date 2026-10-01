// Angle calibration against live Jev. Needs .env.live; every call is recorded in live-runs/, with the rows saved there.
//
//   node scripts/angles.js coverage [--dry-run]
//     Which appeals real arguments make: every persuasion line in the scene suites, the showcase, the calibration
//     argument sets, and the playtest transcripts in playtests/ (if any), each classified once against three
//     candidate angle sets in one request, to see how many land in "other" and which appeals are missing.
//   node scripts/angles.js shift [--repeats 2] [--dry-run]
//     Whether asking the clue and angle questions changes the persuasion score: the showcase grid's 24 cells, each
//     scene's winning line (secret learned), and two pleas, judged with and without them.
//   node scripts/angles.js calibrate [--repeats 2] [--dry-run]
//     The library's angle set (ANGLES): evals/calibration/angles.json's clear lines (one appeal each) and mixed
//     arguments, as standalone attempts with each character's full request. A confusion matrix (which angles are
//     mistaken for which), and how often a confident answer is wrong (a jarring reply) at several angleAt values.
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { ANGLES, defineCharacter, persuasionQuestions, persuasionState, readPersuasion } from "../src/persuasion.js";
import { liveClient, summarize } from "./live-recorder.js";
import { loadLiveEnv } from "./live-env.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const presets = load("stories/characters.json");
const scenes = load("stories/index.json");
const sceneCharacter = Object.fromEntries(scenes.map((s) => [s.id, s.character]));

// Candidate angle sets for the coverage step: A as first proposed, B with compassion and honesty, C with three more.
// (These were the first wordings; the library's own set, ANGLES, has sharper ones.)
const CANDIDATES = {
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
  criteria: Object.fromEntries(set.map((a) => [a, CANDIDATES[a]])),
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

async function calibrate() {
  const set = load("evals/calibration/angles.json");
  const repeats = Number(process.argv.includes("--repeats") ? process.argv[process.argv.indexOf("--repeats") + 1] : 2);
  const jobs = [
    ...Object.entries(set.clear).flatMap(([angle, inputs]) => inputs.map((input) => ({ input, ok: [angle], label: angle }))),
    ...set.mixed.map((m) => ({ input: m.line, ok: m.ok, label: "mixed" })),
  ];
  console.log(`${jobs.length} lines x ${set.characters.length} characters x ${repeats} repeats = ${jobs.length * set.characters.length * repeats} calls`);
  if (process.argv.includes("--dry-run")) return;
  loadLiveEnv();
  const recorded = [];
  let current = "";
  const client = liveClient(() => current, recorded);
  const rows = [];
  for (const id of set.characters) {
    const c = defineCharacter({ ...presets[id], angles: true });
    for (const job of jobs) {
      current = `angles ${id} ${job.label}`;
      for (let i = 0; i < repeats; i++) {
        const answers = await client.ask(persuasionState(c, job.input), persuasionQuestions(c));
        const { angle } = readPersuasion(c, answers);
        rows.push({ character: id, ...job, angle: angle?.angle ?? null, confidence: angle?.confidence ?? 0, probabilities: angle?.probabilities ?? {} });
      }
    }
  }
  mkdirSync(new URL("../live-runs/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../live-runs/angles-calibrate-${Date.now()}.json`, import.meta.url), JSON.stringify(rows, null, 2));

  const clear = rows.filter((r) => r.label !== "mixed");
  const short = (a) => a.slice(0, 6);
  console.log("\nConfusion matrix, clear lines (rows: the angle the line leans on; columns: what Jev chose, any confidence):");
  console.log("            " + ANGLES.map((a) => short(a).padStart(7)).join(""));
  for (const label of ANGLES) {
    const mine = clear.filter((r) => r.label === label);
    console.log(`  ${label.padEnd(10)}` + ANGLES.map((a) => String(mine.filter((r) => r.angle === a).length || ".").padStart(7)).join("") + `   of ${mine.length}`);
  }
  console.log("\nBy angle at angleAt 0.6: right and confident / wrong and confident (jarring) / unsure (falls back):");
  for (const label of ANGLES) {
    const mine = clear.filter((r) => r.label === label);
    const right = mine.filter((r) => r.angle === label && r.confidence >= 0.6).length;
    const wrong = mine.filter((r) => r.angle !== label && r.confidence >= 0.6).length;
    console.log(`  ${label.padEnd(10)} ${String(right).padStart(2)} / ${String(wrong).padStart(2)} / ${String(mine.length - right - wrong).padStart(2)}  of ${mine.length}`);
  }
  const pct = (n, d) => `${Math.round((100 * n) / d)}%`;
  console.log("\nWhere angleAt could cut (clear lines right / jarring; mixed lines acceptable / jarring; the rest fall back):");
  const mixed = rows.filter((r) => r.label === "mixed");
  for (const at of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    const conf = (r) => r.confidence >= at;
    const jar = (r) => conf(r) && !r.ok.includes(r.angle) && r.angle !== "other";
    console.log(`  angleAt ${at.toFixed(1)}: clear ${pct(clear.filter((r) => conf(r) && r.ok.includes(r.angle)).length, clear.length)} right,` +
      ` ${pct(clear.filter(jar).length, clear.length)} jarring (${clear.filter(jar).length}); mixed ${pct(mixed.filter((r) => conf(r) && r.ok.includes(r.angle)).length, mixed.length)}` +
      ` acceptable, ${pct(mixed.filter(jar).length, mixed.length)} jarring (${mixed.filter(jar).length})`);
  }
  console.log("\nConfident wrong answers at 0.6:");
  for (const r of rows.filter((x) => x.confidence >= 0.6 && !x.ok.includes(x.angle))) {
    console.log(`  ${r.character} ${r.label} -> ${r.angle} ${r.confidence.toFixed(2)}: "${r.input.slice(0, 80)}"`);
  }
  console.log("\n" + summarize(recorded));
}

async function shift() {
  const repeats = Number(process.argv.includes("--repeats") ? process.argv[process.argv.indexOf("--repeats") + 1] : 2);
  const pairs = [];
  for (const l of load("evals/showcase.json").lines) for (const id of Object.keys(l.expect)) pairs.push({ id, input: l.input, knows: [] });
  const winning = {
    harry: "Harry, I have a letter for the apothecary that includes a recipe for a fever remedy. If you let me through the gate, I will bring the remedy to your daughter.",
    nib: "Nib, please let me out. Come with me to town and I'll help you become a cook in a real kitchen.",
    maude: "Maude, honestly: the captain is skimming the crew's shares. Six of his crates aren't on your manifest. Take me aboard and I'll give you the proof.",
    cobb: "Cobb, the raiders are anchored behind the island and won't sail in this storm, and the shutter can send the beam out to sea only. You know what a dark night cost the Wren. Please light it for my sister.",
  };
  for (const [id, input] of Object.entries(winning)) pairs.push({ id, input, knows: presets[id].secrets.map((s) => s.id) });
  pairs.push({ id: "harry", input: "Harry, please let me through.", knows: [] }, { id: "cobb", input: "Cobb, please light the lamp.", knows: [] });
  console.log(`${pairs.length} pairs x 2 requests x ${repeats} repeats = ${pairs.length * 2 * repeats} calls`);
  if (process.argv.includes("--dry-run")) return;
  loadLiveEnv();
  const recorded = [];
  const client = liveClient("angles shift", recorded);
  const rows = [];
  for (const p of pairs) {
    const full = defineCharacter({ ...presets[p.id], angles: true });
    const base = defineCharacter({ ...presets[p.id], angles: false, clues: [] });
    const score = async (c) => {
      const s = [];
      for (let i = 0; i < repeats; i++) s.push(readPersuasion(c, await client.ask(persuasionState(c, p.input, { knows: p.knows }), persuasionQuestions(c))).score);
      return s.reduce((a, b) => a + b, 0) / s.length;
    };
    const without = await score(base);
    const withThem = await score(full);
    rows.push({ ...p, without, with: withThem, diff: withThem - without, threshold: full.threshold });
  }
  mkdirSync(new URL("../live-runs/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../live-runs/angles-shift-${Date.now()}.json`, import.meta.url), JSON.stringify(rows, null, 2));
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(6)} ${r.without.toFixed(2)} -> ${r.with.toFixed(2)} (${r.diff >= 0 ? "+" : ""}${r.diff.toFixed(2)})  "${r.input.slice(0, 60)}"`);
  }
  const diffs = rows.map((r) => r.diff);
  const crossed = rows.filter((r) => (r.without >= r.threshold) !== (r.with >= r.threshold));
  console.log(`\nMean difference ${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(3)}, largest ${Math.max(...diffs.map(Math.abs)).toFixed(2)}; verdicts that changed: ${crossed.length}`);
  console.log("\n" + summarize(recorded));
}

const steps = { coverage, shift, calibrate };
const step = steps[process.argv[2]];
if (!step) { console.error(`Usage: node scripts/angles.js ${Object.keys(steps).join("|")} [--dry-run]`); process.exit(1); }
await step();
