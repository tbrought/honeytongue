// Runs evaluation suites against Jev (or the mock with --mock) and reports parser accuracy,
// whether persuasion scores land in range, the threats and insults tells, and verdicts.
//
//   npm run eval                                 The Gatehouse's suite
//   npm run eval -- evals/goblin-camp.json       one or more suites by path
//   npm run eval -- --all                        every suite in evals/ (more Jev calls)
//   npm run eval -- --all --record               also record each call's latency and tokens in live-runs/
//   npm run eval -- --all --patch <file>         try a candidate rubric or persona first (see scripts/patches.js)
//   npm run eval -- --all --repeats 10           also check every scripted verdict is reliable (see reliability())
//
// A scene suite plays each case in a fresh Game. A character suite (like showcase.json) sends each line
// to every character in a presets file, with no scene around it.
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Game } from "../src/engine.js";
import { defineCharacter, judgePersuasion, readPersuasion } from "../src/persuasion.js";
import { createJevClient } from "../src/jev.js";
import { createMockClient } from "../src/mock.js";
import { liveClient, summarize, mean } from "./live-recorder.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { loadPatches, describePatches, patchCharacter, patchStory } from "./patches.js";

const evalsDir = new URL("../evals/", import.meta.url);
// Suite paths given on the command line are relative to where you ran it (or absolute).
const patches = loadPatches();
const files = process.argv.includes("--all")
  ? (await readdir(evalsDir)).filter((f) => f.endsWith(".json")).sort().map((f) => new URL(f, evalsDir))
  : process.argv.filter((a, i) => a.endsWith(".json") && process.argv[i - 1] !== "--patch").map((f) => pathToFileURL(resolve(f)));
if (!files.length) files.push(new URL("gatehouse.json", evalsDir));

const useMock = process.argv.includes("--mock") || !process.env.TYPESAFE_API_KEY;
const record = !useMock && process.argv.includes("--record");
let current = ""; // what's being run, for the recording: "engine <suite>" or "standalone <suite>"
const recorded = [];
const client = useMock ? createMockClient() : record ? liveClient(() => current, recorded) : createJevClient();
const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));

const REPEATS = process.argv.includes("--repeats") ? Number(process.argv[process.argv.indexOf("--repeats") + 1]) : 1;
const GAP = 0.1; // see reliability()
const rows = []; // every case's results, saved with --record for the docs' numbers
const tally = { action: [0, 0], score: [0, 0], threats: [0, 0], insults: [0, 0], verdict: [0, 0], reliable: [0, 0], borderline: [0, 0], errors: [0, 0] };
const mark = (kind, ok) => { tally[kind][1]++; if (ok) tally[kind][0]++; return ok ? "ok" : "MISS"; };

/** Checks shared by both kinds of suite: the score range, each tell, and the verdict. */
function check(c, answers, character, expected = c.verdict) {
  const notes = [];
  if (c.score) {
    const s = answers.persuasion.score;
    notes.push(`persuasion ${s.toFixed(2)} ${mark("score", s >= c.score[0] && s <= c.score[1])} (want ${c.score[0]}-${c.score[1]})`);
  }
  for (const tell of ["threats", "insults"]) {
    if (c[tell] === undefined) continue;
    const n = answers[tell].noul;
    notes.push(`${tell} ${n.toFixed(2)} ${mark(tell, (n >= character.hostileAt) === c[tell])}`);
  }
  if (expected) {
    const { verdict, score } = readPersuasion(character, answers);
    notes.push(`${verdict} ${mark("verdict", verdict === expected)}${verdict === expected ? "" : ` (want ${expected})`}`);
  }
  return notes;
}

/**
 * Reliability rule: a scripted winning or losing line must give its intended verdict in every one of REPEATS
 * tries, with its average score at least GAP from the threshold. Scores barely vary between identical attempts,
 * but they bunch up near the top of the scale, so a hard character's winning line necessarily sits close to its
 * threshold; repeats are how to check it. Offended verdicts are decided by the tells, so they aren't repeated.
 */
async function reliability(first, again, character, expected) {
  if (REPEATS < 2 || !["convinced", "unconvinced"].includes(expected)) return null;
  const results = [readPersuasion(character, first)];
  for (let i = 1; i < REPEATS; i++) results.push(readPersuasion(character, await again()));
  const hits = results.filter((r) => r.verdict === expected).length;
  const average = mean(results.map((r) => r.score));
  const gap = average - character.threshold;
  const ok = hits === REPEATS && Math.abs(gap) >= GAP;
  return { hits, average, note: `reliable ${hits}/${REPEATS}, average ${average.toFixed(2)} (${gap >= 0 ? "+" : ""}${gap.toFixed(2)}) ${mark("reliable", ok) === "ok" ? "ok" : "UNRELIABLE"}` };
}

async function sceneSuite(suite, url) {
  const story = patchStory(await readJson(new URL(suite.story, url)), patches);
  current = `engine ${url.pathname.split("/").pop()}`;
  for (const c of suite.cases) {
    const game = new Game(story, client);
    for (const f of c.flags ?? []) game.flags.add(f);
    for (const i of c.items ?? []) if (!game.inventory.includes(i)) game.inventory.push(i);
    const fresh = () => {
      const g = new Game(story, client);
      for (const f of c.flags ?? []) g.flags.add(f);
      for (const i of c.items ?? []) if (!g.inventory.includes(i)) g.inventory.push(i);
      return g;
    };
    let answers, ranked;
    try {
      ({ answers, ranked } = await game.interpret(c.input));
    } catch (err) {
      console.log(`"${c.input.slice(0, 60)}"\n   ERROR ${err.message}`);
      mark("errors", false);
      continue;
    }
    if (c.borderline) {
      // A documented borderline case (it sits at a threshold, so it can go either way): report its range across
      // the repeats, but don't count it as a pass or a fail, so the totals stay trustworthy.
      const all = [answers];
      for (let i = 1; i < REPEATS; i++) all.push((await fresh().interpret(c.input)).answers);
      const character = game.npc?.character;
      const range = (xs) => `${Math.min(...xs).toFixed(2)} to ${Math.max(...xs).toFixed(2)}`;
      const verdicts = {};
      for (const a of all) { const v = character ? readPersuasion(character, a).verdict : "-"; verdicts[v] = (verdicts[v] ?? 0) + 1; }
      const tells = ["threats", "insults"].filter((t) => c[t] !== undefined).map((t) => `${t} ${range(all.map((a) => a[t].noul))}`);
      tally.borderline[1]++;
      console.log(`"${c.input.slice(0, 60)}"\n   BORDERLINE (not counted): ${JSON.stringify(verdicts)} over ${all.length}, ${[...tells, `persuasion ${range(all.map((a) => a.persuasion?.score ?? 0))}`].join(", ")}${c.note ? `  [${c.note}]` : ""}`);
      continue;
    }
    const [top, p] = ranked[0];
    const notes = [];
    if (c.expect) notes.push(`action ${top} ${p.toFixed(2)} ${mark("action", top === c.expect)}${top === c.expect ? "" : ` (want ${c.expect})`}`);
    let repeated = null;
    if (game.npc) {
      notes.push(...check(c, answers, game.npc.character));
      repeated = await reliability(answers, async () => (await fresh().interpret(c.input)).answers, game.npc.character, c.verdict);
      if (repeated) notes.push(repeated.note);
    }
    rows.push({ suite: current, input: c.input, action: top, score: answers.persuasion?.score ?? null, average: repeated?.average ?? null, hits: repeated?.hits ?? null });
    console.log(`"${c.input.slice(0, 60)}"\n   ${notes.join(" | ")}${c.note ? `  [${c.note}]` : ""}`);
  }
}

async function characterSuite(suite, url) {
  const characters = await readJson(new URL(suite.characters, url));
  current = `standalone ${url.pathname.split("/").pop()}`;
  for (const line of suite.lines) {
    console.log(`${line.tactic}: "${line.input.slice(0, 60)}"`);
    for (const [id, verdict] of Object.entries(line.expect)) {
      const character = defineCharacter(patchCharacter(id, characters[id], patches));
      let answers; // kept from the one call, so the checks read Jev's raw answers
      const recording = { ask: async (...args) => (answers = await client.ask(...args)) };
      try {
        await judgePersuasion(recording, character, line.input);
      } catch (err) {
        console.log(`   ${character.name.padEnd(16)} ERROR ${err.message}`);
        mark("errors", false);
        continue;
      }
      const notes = check({ ...line, verdict }, answers, character);
      const again = async () => {
        let a;
        await judgePersuasion({ ask: async (...args) => (a = await client.ask(...args)) }, character, line.input);
        return a;
      };
      const repeated = await reliability(answers, again, character, verdict);
      if (repeated) notes.push(repeated.note);
      const result = readPersuasion(character, answers);
      rows.push({ suite: current, tactic: line.tactic, character: id, input: line.input, verdict: result.verdict, score: result.score, average: repeated?.average ?? null, hits: repeated?.hits ?? null });
      console.log(`   ${character.name.padEnd(16)} persuasion ${answers.persuasion.score.toFixed(2)} | ${notes.join(" | ")}`);
    }
  }
}

const count = async (url) => {
  const suite = await readJson(url);
  return suite.lines ? suite.lines.reduce((n, l) => n + Object.keys(l.expect).length, 0) : suite.cases.length;
};
const calls = (await Promise.all(files.map(count))).reduce((a, b) => a + b, 0);
console.log(`Running ${calls} cases against ${useMock ? "the keyword mock" : "Jev"}, patches: ${describePatches(patches)}`);

for (const url of files) {
  const suite = await readJson(url);
  console.log(`\n== ${url.pathname.split("/").pop()} ==`);
  await (suite.lines ? characterSuite(suite, url) : sceneSuite(suite, url));
}

console.log("");
for (const [kind, [hit, total]] of Object.entries(tally)) {
  if (kind === "errors") { if (total) console.log(`errors   ${total} case(s) failed to run`); }
  else if (kind === "borderline") { if (total) console.log(`borderline ${total} documented case(s), reported but not counted`); }
  else if (total) console.log(`${kind.padEnd(8)} ${hit}/${total}`);
}
if (record) {
  mkdirSync(new URL("../live-runs/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../live-runs/eval-rows-${Date.now()}.json`, import.meta.url), JSON.stringify({ repeats: REPEATS, rows }, null, 2));
}
if (record) console.log(`
${summarize(recorded)}`);
