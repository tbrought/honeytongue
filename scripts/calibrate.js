// Calibration runs against live Jev (step 4b of Phase F). Needs TYPESAFE_API_KEY; every call is recorded in
// live-runs/, and results are saved there as JSON for analysis. Add --patch <file> (repeatable) to try a
// candidate rubric or persona first.
//
//   node scripts/calibrate.js arguments     score distributions per character, and where each difficulty word cuts
//   node scripts/calibrate.js secrets       unlearned-secret arguments vs plain pleas, under three approaches
//   node scripts/calibrate.js injections    prompt-injection attempts, standalone and as engine turns
//   node scripts/calibrate.js threats       threats on cowardly characters, with controls
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Game } from "../src/engine.js";
import { defineCharacter, judgePersuasion } from "../src/persuasion.js";
import { liveClient, summarize, mean, percentile } from "./live-recorder.js";
import { loadPatches, describePatches, patchCharacter, patchStory } from "./patches.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const patches = loadPatches();
const presets = load("stories/characters.json");
// A rubric patch can't change a character with its own levels (Harry), so rerunning it would only repeat a result.
const unaffected = (id) => patches.some((p) => p.levels) && !patches.some((p) => p.characters?.[id]) && Boolean(presets[id]?.levels);
const character = (id, extra = {}) => defineCharacter(patchCharacter(id, presets[id] ?? extra[id], patches));
const recorded = [];
let current = "";
const client = liveClient(() => current, recorded);
const out = [];
const say = (line = "") => { console.log(line); out.push(line); };
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n));
const results = { patches: describePatches(patches), step: process.argv[2], data: {} };

/** Judge one line and keep Jev's raw answers alongside the verdict. */
async function judge(c, line, knows = [], via = client) {
  let answers;
  const recording = { ask: async (...args) => (answers = await via.ask(...args)) };
  const result = await judgePersuasion(recording, c, line, { knows });
  return { line, score: result.score, verdict: result.verdict, threats: result.tells.threats, insults: result.tells.insults,
    confidence: answers.persuasion.confidence, probabilities: answers.persuasion.probabilities };
}

// ---- Difficulty: define, then fit ----------------------------------------------------

const DIFFICULTY = { easy: 0.6, normal: 0.8, hard: 0.9, "very hard": 0.95 };

async function argumentsStep() {
  const suite = load("evals/calibration/arguments.json");
  current = `standalone calibrate-arguments ${describePatches(patches)}`;
  for (const [id, set] of Object.entries(suite.sets)) {
    if (unaffected(id)) { say(`
== ${id}: skipped, it has its own levels so the rubric patch doesn't apply`); continue; }
    const c = character(id);
    const scored = {};
    for (const kind of ["compelling", "middling", "weak"]) {
      scored[kind] = [];
      for (const line of set[kind]) scored[kind].push(await judge(c, line, kind === "compelling" ? set.knows : []));
    }
    results.data[id] = { maxScore: c.maxScore, threshold: c.threshold, scored };
    const s = (kind) => scored[kind].map((r) => r.score);
    say(`\n== ${c.name} (max ${c.maxScore}, current threshold ${c.threshold})`);
    for (const kind of ["compelling", "middling", "weak"]) {
      const xs = s(kind).sort((a, b) => a - b);
      say(`  ${kind.padEnd(10)} n=${xs.length} min ${fmt(xs[0])} p25 ${fmt(percentile(xs, 25))} median ${fmt(percentile(xs, 50))} p75 ${fmt(percentile(xs, 75))} max ${fmt(xs.at(-1))}`);
      say(`             ${xs.map(fmt).join(" ")}`);
    }
    for (const [word, share] of Object.entries(DIFFICULTY)) {
      const cut = Math.round(c.maxScore * share * 100) / 100;
      const pass = (kind) => `${s(kind).filter((x) => x >= cut).length}/${s(kind).length}`;
      say(`  ${word.padEnd(10)} at ${fmt(cut)}: compelling ${pass("compelling")}, middling ${pass("middling")}, weak ${pass("weak")} pass`);
    }
  }
}

// ---- Secrets: three approaches ---------------------------------------------------------

const TODAY = " Facts in `character.secrets` marked player_knows: false are unknown to the player; " +
  "arguments relying on them should not score higher, and may seem suspicious.";
const TIGHTENED = " Facts in `character.secrets` marked player_knows: false are unknown to the player. " +
  "Score an argument that relies on one as if that fact had not been mentioned at all, or lower if it seems suspicious that the player knows it.";

/** A client that rewrites each request for approach (a) today's wording, (b) tightened wording, or (c) unlearned secrets never sent. */
function secretsClient(mode) {
  return {
    async ask(state, questions) {
      const q = structuredClone(questions);
      const s = structuredClone(state);
      const text = q.persuasion.instructions.question;
      if (!text.includes(TODAY)) throw new Error("The secrets sentence in persuasionQuestions() changed; update calibrate.js");
      if (mode === "b") q.persuasion.instructions.question = text.replace(TODAY, TIGHTENED);
      if (mode === "c") {
        q.persuasion.instructions.question = text.replace(TODAY, "");
        const known = (s.character.secrets ?? []).filter((x) => x.player_knows);
        if (known.length) s.character.secrets = known;
        else delete s.character.secrets;
      }
      return client.ask(s, q);
    },
  };
}

async function secretsStep() {
  const suite = load("evals/calibration/secrets.json");
  for (const mode of ["a", "b", "c"]) {
    current = `standalone calibrate-secrets-${mode} ${describePatches(patches)}`;
    const via = secretsClient(mode);
    say(`\n== approach (${mode}) ${{ a: "today's wording", b: "tightened wording", c: "unlearned secrets not sent" }[mode]}`);
    results.data[mode] = {};
    for (const [id, set] of Object.entries(suite.sets)) {
      const c = character(id);
      const pleas = [], unlearned = [], learned = [];
      for (const line of set.pleas) pleas.push(await judge(c, line, [], via));
      for (const line of set.lines) {
        unlearned.push(await judge(c, line, [], via));
        learned.push(await judge(c, line, [set.secret], via));
      }
      results.data[mode][id] = { pleas, unlearned, learned };
      const m = (rs) => mean(rs.map((r) => r.score));
      const topPlea = Math.max(...pleas.map((r) => r.score));
      const above = unlearned.filter((r) => r.score > topPlea + 0.05).length;
      const wins = unlearned.filter((r) => r.verdict === "convinced").length;
      say(`  ${c.name.padEnd(16)} pleas ${fmt(m(pleas))} (max ${fmt(topPlea)}) | unlearned ${fmt(m(unlearned))} [${unlearned.map((r) => fmt(r.score)).join(" ")}]` +
        ` | learned ${fmt(m(learned))} | unlearned above the best plea: ${above}/5, unlearned wins: ${wins}/5`);
    }
  }
}

// ---- Injections ---------------------------------------------------------------------

async function injectionsStep() {
  const suite = load("evals/calibration/injections.json");
  current = `standalone calibrate-injections ${describePatches(patches)}`;
  results.data.standalone = {};
  for (const id of Object.keys(presets)) {
    if (unaffected(id)) { say(`  ${id}: skipped, it has its own levels`); continue; }
    const c = character(id);
    const rs = [];
    for (const line of suite.lines) rs.push(await judge(c, line));
    results.data.standalone[id] = rs;
    say(`  ${c.name.padEnd(16)} scores ${rs.map((r) => fmt(r.score)).join(" ")} | max ${fmt(Math.max(...rs.map((r) => r.score)))} | convinced ${rs.filter((r) => r.verdict === "convinced").length}/${rs.length}`);
  }
  if (patches.some((p) => p.levels)) return; // The Gatehouse's Harry has his own levels, so a rubric patch changes nothing there
  current = `engine calibrate-injections ${describePatches(patches)}`;
  const story = patchStory(load("stories/gatehouse.json"), patches);
  results.data.engine = [];
  say("\n  The Gatehouse, as engine turns:");
  for (const line of [...suite.lines, ...suite.engine.extra]) {
    const game = new Game(story, client);
    const r = await game.turn(line);
    const d = r.debug;
    const row = { line, action: d?.ranked?.[0], score: d?.persuasion?.score, over: game.over, ending: game.scene.ending ?? null };
    results.data.engine.push(row);
    say(`    ${d ? `${d.ranked[0][0]} ${fmt(d.ranked[0][1])}` : "-"} persuasion ${fmt(d?.persuasion?.score)} ${game.over ? `ENDED: ${game.scene.ending}` : ""} | ${line.slice(0, 60)}`);
  }
}

// ---- Threats on cowards --------------------------------------------------------------

async function threatsStep() {
  const suite = load("evals/calibration/threats.json");
  current = `standalone calibrate-threats ${describePatches(patches)}`;
  for (const [id, set] of Object.entries(suite.sets)) {
    const c = character(id, suite.extraCharacters);
    const threats = [];
    for (const line of set.threats) threats.push(await judge(c, line));
    const controls = {};
    for (const [kind, line] of Object.entries(set.controls)) controls[kind] = await judge(c, line);
    results.data[id] = { threshold: c.threshold, threats, controls };
    say(`\n  ${c.name} (threshold ${c.threshold}, offended by ${c.offendedBy.join(", ") || "nothing"})`);
    say(`    threats: scores ${threats.map((r) => fmt(r.score)).join(" ")} | threats tell ${threats.map((r) => fmt(r.threats)).join(" ")} | convinced ${threats.filter((r) => r.verdict === "convinced").length}/${threats.length}`);
    for (const [kind, r] of Object.entries(controls)) say(`    ${kind.padEnd(7)} ${fmt(r.score)} ${r.verdict} (threats ${fmt(r.threats)}, insults ${fmt(r.insults)})`);
  }
}

// ---- Run ----------------------------------------------------------------------------

const steps = { arguments: argumentsStep, secrets: secretsStep, injections: injectionsStep, threats: threatsStep };
const step = process.argv[2];
if (!steps[step]) {
  console.error(`Usage: node scripts/calibrate.js ${Object.keys(steps).join("|")} [--patch <file>]...`);
  process.exit(1);
}
say(`${step}, patches: ${describePatches(patches)}`);
try {
  await steps[step]();
} finally {
  say(`\n${summarize(recorded)}`);
  mkdirSync(new URL("../live-runs/", import.meta.url), { recursive: true });
  const name = `calibrate-${step}-${describePatches(patches).replace(/[^a-z0-9]+/gi, "_")}-${Date.now()}`;
  writeFileSync(new URL(`../live-runs/${name}.txt`, import.meta.url), out.join("\n") + "\n");
  writeFileSync(new URL(`../live-runs/${name}.json`, import.meta.url), JSON.stringify(results, null, 2));
}
