// Multi-turn calibration: whole conversations with each demo character, as standalone attempts on the playground
// preset and as engine turns in its scene, against live Jev. Each line is also scored fresh (a new character or game
// with the same knowledge), so the difference shows what the conversation's history did.
//
//   node scripts/multiturn.js [--runs 5] [--controls 2] [--only harry,cobb] [--scenarios returning,long] [--mode standalone|engine|both] [--mock]
//
// "returning" is run twice: as the library is today (A), and with a candidate fix (B) that treats an attempt as a
// repeat only if the player hasn't learned any of the character's secrets since the attempt it matches.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Game } from "../src/engine.js";
import { Persuadable, similarity } from "../src/persuasion.js";
import { liveClient, summarize, mean } from "./live-recorder.js";
import { createMockClient } from "../src/mock.js";
import { loadLiveEnv } from "./live-env.js";

if (!process.argv.includes("--mock")) loadLiveEnv(); // the key, from .env.live, for live runs only

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const data = load("evals/calibration/multiturn.json");
const presets = load("stories/characters.json");
const scenes = load("stories/index.json");
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const RUNS = Number(arg("--runs", 5));
const CONTROLS = Number(arg("--controls", 2));
const ONLY = arg("--only", null)?.split(",") ?? null;
const MODE = arg("--mode", "both");
const SCENARIOS = arg("--scenarios", null)?.split(",") ?? null; // e.g. returning,long

const recorded = [];
let current = "";
// --mock: a dry run on the offline mock, to check the script before spending tokens.
const mock = createMockClient();
const client = process.argv.includes("--mock")
  ? { ask: async (...args) => { recorded.push({ label: current, status: 200, ms: 0, tokens: 0 }); return mock.ask(...args); } }
  : liveClient(() => current, recorded);
const out = [];
const say = (line = "") => { console.log(line); out.push(line); };
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : "-");
const results = { runs: RUNS, controls: CONTROLS, data: {} };

// ---- The candidate fix for repeats after learning (B) -----------------------------------------------------------
// Each attempt remembers which of the character's secrets the player knew. With the fix on, an attempt only counts as
// a repeat if it matches an earlier failed attempt made with the same knowledge. Knowledge comes from the game's flags
// (engine) or the character's learn() calls (standalone).
let fixOn = false;
let knownNow = null; // set from the game's flags before each engine turn; null means use the character's own knows
const knownSecrets = (npc) => {
  const known = knownNow ?? [...npc.knows];
  return npc.character.secrets.map((s) => s.id).filter((id) => known.includes(id));
};
const originalRecord = Persuadable.prototype.record;
Persuadable.prototype.record = function (input, answers) {
  const knew = knownSecrets(this);
  const result = originalRecord.call(this, input, answers);
  this.attempts.at(-1).knew = knew;
  return result;
};
const originalFind = Persuadable.prototype.findRepeat;
Persuadable.prototype.findRepeat = function (input) {
  if (!fixOn) return originalFind.call(this, input);
  const said = String(input);
  const now = knownSecrets(this);
  const matches = this.attempts.filter((a) => a.outcome !== "convinced" && similarity(a.said, said) >= this.character.repeatSimilarity);
  return matches.find((a) => now.every((id) => (a.knew ?? []).includes(id))) ?? null;
};

// ---- Standalone: the playground preset --------------------------------------------------------------------------

/** A preset with unlimited patience, so memory can be measured without the conversation ending early. */
const preset = (id) => ({ ...presets[id], patience: Infinity, note: undefined });

async function attempt(npc, line) {
  const before = recorded.length;
  const r = await npc.attempt(line);
  return { line, verdict: r.verdict, score: r.score, sent: recorded.length > before };
}

/** The same line, scored as a fresh first attempt with the given secrets learned. */
async function freshStandalone(id, line, learned = []) {
  const scores = [];
  for (let i = 0; i < CONTROLS; i++) {
    const npc = new Persuadable(preset(id), { client });
    learned.forEach((s) => npc.learn(s));
    scores.push((await npc.attempt(line)).score);
  }
  return mean(scores);
}

async function standaloneScenario(id, c, scenario) {
  current = `standalone multiturn ${scenario} ${id}`;
  const runs = [];
  for (let run = 0; run < RUNS; run++) {
    const npc = new Persuadable(preset(id), { client });
    const steps = [];
    if (scenario === "building") {
      for (const step of c.building) {
        if (step.afterLearning) npc.learn(c.secret);
        steps.push(await attempt(npc, step.line));
      }
    } else if (scenario === "switching" || scenario === "rephrasing") {
      for (const line of c[scenario]) steps.push(await attempt(npc, line));
    } else if (scenario === "long") {
      for (const line of [c.long.point, ...c.long.between, c.long.again]) steps.push(await attempt(npc, line));
    } else if (scenario === "long-inside") {
      for (const line of [c.long.point, c.long.again]) steps.push(await attempt(npc, line));
    }
    runs.push(steps);
  }
  // Fresh controls, with whatever the player knew at that step.
  const lines = runs[0].map((s) => s.line);
  const controls = [];
  for (const [i, line] of lines.entries()) {
    const learned = scenario === "building" && c.building.slice(0, i + 1).some((s) => s.afterLearning) ? [c.secret] : [];
    controls.push(await freshStandalone(id, line, learned));
  }
  return { runs, controls };
}

async function standaloneReturning(id, c) {
  current = `standalone multiturn returning ${id}`;
  const result = {};
  for (const [label, fix] of [["A (today)", false], ["B (fix)", true]]) {
    fixOn = fix;
    const runs = [];
    for (let run = 0; run < RUNS; run++) {
      const npc = new Persuadable(preset(id), { client });
      const first = await attempt(npc, c.returning.line);
      npc.learn(c.secret);
      const exact = await attempt(npc, c.returning.line);
      const reworded = await attempt(npc, c.returning.reworded);
      runs.push([first, exact, reworded]);
    }
    // The exploit check: learning something that isn't one of the character's secrets shouldn't reset a repeat.
    const npc = new Persuadable(preset(id), { client });
    await attempt(npc, c.returning.line);
    npc.learn(c.trivial.standalone);
    const afterTrivial = await attempt(npc, c.returning.line);
    result[label] = { runs, afterTrivial };
  }
  fixOn = false;
  result.controls = { exactWithSecret: await freshStandalone(id, c.returning.line, [c.secret]), rewordedWithSecret: await freshStandalone(id, c.returning.reworded, [c.secret]) };
  return result;
}

// ---- Engine: the scene --------------------------------------------------------------------------------------------

const storyFor = (c) => load(`stories/${scenes.find((s) => s.id === c.scene).file}`);

async function turn(game, line) {
  knownNow = [...game.flags];
  const before = recorded.length;
  const threshold = game.npc?.character.threshold ?? null;
  const r = await game.turn(line);
  knownNow = null;
  const d = r.debug ?? {};
  return { line, action: d.ranked?.[0]?.[0] ?? null, verdict: d.verdict ?? null, score: d.persuasion?.score ?? null, threshold,
    patienceLeft: d.patienceLeft ?? null, over: game.over, ending: game.scene.ending ?? null, sent: recorded.length > before, text: r.text.slice(0, 200) };
}

/** The same line as a fresh engine turn, in a new game with the given flags. */
async function freshEngine(c, line, flags) {
  const scores = [];
  for (let i = 0; i < CONTROLS; i++) {
    const game = new Game(storyFor(c), client);
    flags.forEach((f) => game.flags.add(f));
    scores.push((await game.interpret(line)).answers.persuasion?.score ?? null);
  }
  return mean(scores.filter(Number.isFinite));
}

async function engineScenario(id, c, scenario) {
  current = `engine multiturn ${scenario} ${id}`;
  const runs = [];
  const flagsAt = [];
  for (let run = 0; run < RUNS; run++) {
    const game = new Game(storyFor(c), client);
    const steps = [];
    const play = async (line, record = true) => {
      if (game.over) return;
      if (run === 0 && record) flagsAt.push([...game.flags]);
      const t = await turn(game, line);
      if (record) steps.push(t);
    };
    if (scenario === "building") {
      for (const step of c.building) {
        if (step.afterEvidence) for (const e of c.evidence ?? []) await play(e, false);
        if (step.afterLearning && !game.flags.has(c.secret)) await play(c.discover, false);
        await play(step.line);
      }
    } else if (scenario === "switching" || scenario === "rephrasing" || scenario === "patience") {
      for (const line of c[scenario]) await play(line);
    } else if (scenario === "long") {
      for (const line of [c.long.point, ...c.long.between, c.long.again]) await play(line);
    } else if (scenario === "long-inside") {
      for (const line of [c.long.point, c.long.again]) await play(line);
    }
    runs.push(steps);
  }
  const controls = [];
  if (scenario !== "patience") {
    for (const [i, step] of runs[0].entries()) controls.push(await freshEngine(c, step.line, flagsAt[i] ?? []));
  }
  return { runs, controls };
}

async function engineReturning(id, c) {
  current = `engine multiturn returning ${id}`;
  const result = {};
  for (const [label, fix] of [["A (today)", false], ["B (fix)", true]]) {
    fixOn = fix;
    const runs = [];
    for (let run = 0; run < RUNS; run++) {
      const game = new Game(storyFor(c), client);
      const first = await turn(game, c.returning.line);
      await turn(game, c.discover);
      const exact = game.over ? null : await turn(game, c.returning.line);
      const reworded = game.over ? null : await turn(game, c.returning.reworded);
      runs.push([first, exact, reworded]);
    }
    let afterTrivial = null;
    if (c.trivial.engine) {
      const game = new Game(storyFor(c), client);
      await turn(game, c.returning.line);
      await turn(game, c.trivial.engine);
      afterTrivial = game.over ? null : await turn(game, c.returning.line);
    }
    result[label] = { runs, afterTrivial };
  }
  fixOn = false;
  result.controls = { exactWithSecret: await freshEngine(c, c.returning.line, [c.secret]), rewordedWithSecret: await freshEngine(c, c.returning.reworded, [c.secret]) };
  return result;
}

// ---- Reporting ----------------------------------------------------------------------------------------------------

function reportScenario(label, { runs, controls }) {
  const steps = Math.max(...runs.map((r) => r.length));
  say(`  ${label}`);
  for (let i = 0; i < steps; i++) {
    const at = runs.map((r) => r[i]).filter(Boolean);
    const scores = at.map((s) => s.score).filter(Number.isFinite);
    const verdicts = {};
    for (const s of at) verdicts[s.verdict ?? "none"] = (verdicts[s.verdict ?? "none"] ?? 0) + 1;
    const fresh = controls[i];
    const delta = Number.isFinite(mean(scores)) && Number.isFinite(fresh) ? mean(scores) - fresh : NaN;
    say(`    ${String(i + 1).padStart(2)}. conversation ${fmt(mean(scores))} | fresh ${fmt(fresh)} | history ${Number.isFinite(delta) ? (delta >= 0 ? "+" : "") + delta.toFixed(2) : "-"} | ${JSON.stringify(verdicts)} ${at.length < runs.length ? `(reached in ${at.length}/${runs.length})` : ""} | ${at[0].line.slice(0, 60)}`);
  }
}

function reportReturning(r) {
  for (const label of ["A (today)", "B (fix)"]) {
    const { runs, afterTrivial } = r[label];
    const col = (i) => runs.map((x) => x[i]).filter(Boolean);
    const describe = (steps) => `${fmt(mean(steps.map((s) => s.score).filter(Number.isFinite)))} ${JSON.stringify(steps.reduce((m, s) => ({ ...m, [s.verdict ?? "none"]: (m[s.verdict ?? "none"] ?? 0) + 1 }), {}))}, sent to Jev ${steps.filter((s) => s.sent).length}/${steps.length}`;
    say(`  returning ${label}: first ${describe(col(0))} | exact after learning ${describe(col(1))} | reworded ${describe(col(2))}`);
    if (afterTrivial) say(`    exploit check: the same line after learning something trivial: ${afterTrivial.verdict}, sent to Jev: ${afterTrivial.sent}`);
  }
  say(`    fresh, secret learned: exact line ${fmt(r.controls.exactWithSecret)}, reworded ${fmt(r.controls.rewordedWithSecret)}`);
}

function reportPatience({ runs }) {
  for (const [i, steps] of runs.entries()) {
    const last = steps.at(-1);
    say(`    run ${i + 1}: ${steps.length} turns, patience ${steps.map((s) => s.patienceLeft ?? "-").join(" ")}, verdicts ${steps.map((s) => s.verdict ?? s.action).join(" ")} => ${last?.ending ?? "(still going)"}`);
  }
}

// ---- Run ----------------------------------------------------------------------------------------------------------

try {
  for (const [id, c] of Object.entries(data.characters)) {
    if (ONLY && !ONLY.includes(id)) continue;
    results.data[id] = {};
    const scenarios = ["building", "switching", "rephrasing", ...(c.long ? ["long", "long-inside"] : [])].filter((s) => !SCENARIOS || SCENARIOS.includes(s));
    const wanted = (s) => !SCENARIOS || SCENARIOS.includes(s);
    if (MODE !== "engine") {
      say(`\n== ${presets[id].name}, standalone (the preset, patience unlimited)`);
      for (const s of scenarios) {
        const r = await standaloneScenario(id, c, s);
        results.data[id][`standalone ${s}`] = r;
        reportScenario(s, r);
      }
      if (wanted("returning")) {
        const r = await standaloneReturning(id, c);
        results.data[id]["standalone returning"] = r;
        reportReturning(r);
      }
    }
    if (MODE !== "standalone") {
      say(`\n== ${presets[id].name}, engine turns in ${c.scene}`);
      for (const s of [...scenarios, ...(wanted("patience") ? ["patience"] : [])]) {
        const r = await engineScenario(id, c, s);
        results.data[id][`engine ${s}`] = r;
        if (s === "patience") { say("  patience"); reportPatience(r); } else reportScenario(s, r);
      }
      if (wanted("returning")) {
        const r = await engineReturning(id, c);
        results.data[id]["engine returning"] = r;
        reportReturning(r);
      }
    }
  }
} finally {
  say(`\n${summarize(recorded)}`);
  mkdirSync(new URL("../live-runs/", import.meta.url), { recursive: true });
  const stamp = Date.now();
  writeFileSync(new URL(`../live-runs/multiturn-${stamp}.txt`, import.meta.url), out.join("\n") + "\n");
  writeFileSync(new URL(`../live-runs/multiturn-${stamp}.json`, import.meta.url), JSON.stringify(results, null, 2));
}
