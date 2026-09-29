// Runs evaluation suites against Jev (or the mock with --mock) and reports parser accuracy,
// whether persuasion scores land in range, the threats and insults tells, and verdicts.
//
//   npm run eval                                 The Gatehouse's suite
//   npm run eval -- evals/goblin-camp.json       one or more suites by path
//   npm run eval -- --all                        every suite in evals/ (more Jev calls)
//   npm run eval -- --all --record               also record each call's latency and tokens in live-runs/
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
import { liveClient, summarize } from "./live-recorder.js";

const evalsDir = new URL("../evals/", import.meta.url);
// Suite paths given on the command line are relative to where you ran it (or absolute).
const files = process.argv.includes("--all")
  ? (await readdir(evalsDir)).filter((f) => f.endsWith(".json")).sort().map((f) => new URL(f, evalsDir))
  : process.argv.filter((a) => a.endsWith(".json")).map((f) => pathToFileURL(resolve(f)));
if (!files.length) files.push(new URL("gatehouse.json", evalsDir));

const useMock = process.argv.includes("--mock") || !process.env.TYPESAFE_API_KEY;
const record = !useMock && process.argv.includes("--record");
let current = ""; // what's being run, for the recording: "engine <suite>" or "standalone <suite>"
const recorded = [];
const client = useMock ? createMockClient() : record ? liveClient(() => current, recorded) : createJevClient();
const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));

const tally = { action: [0, 0], score: [0, 0], threats: [0, 0], insults: [0, 0], verdict: [0, 0], errors: [0, 0] };
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
    const { verdict } = readPersuasion(character, answers);
    notes.push(`${verdict} ${mark("verdict", verdict === expected)}${verdict === expected ? "" : ` (want ${expected})`}`);
  }
  return notes;
}

async function sceneSuite(suite, url) {
  const story = await readJson(new URL(suite.story, url));
  current = `engine ${url.pathname.split("/").pop()}`;
  for (const c of suite.cases) {
    const game = new Game(story, client);
    for (const f of c.flags ?? []) game.flags.add(f);
    for (const i of c.items ?? []) if (!game.inventory.includes(i)) game.inventory.push(i);
    let answers, ranked;
    try {
      ({ answers, ranked } = await game.interpret(c.input));
    } catch (err) {
      console.log(`"${c.input.slice(0, 60)}"
   ERROR ${err.message}`);
      mark("errors", false);
      continue;
    }
    const [top, p] = ranked[0];
    const notes = [];
    if (c.expect) notes.push(`action ${top} ${p.toFixed(2)} ${mark("action", top === c.expect)}${top === c.expect ? "" : ` (want ${c.expect})`}`);
    if (game.npc) notes.push(...check(c, answers, game.npc.character));
    console.log(`"${c.input.slice(0, 60)}"\n   ${notes.join(" | ")}${c.note ? `  [${c.note}]` : ""}`);
  }
}

async function characterSuite(suite, url) {
  const characters = await readJson(new URL(suite.characters, url));
  current = `standalone ${url.pathname.split("/").pop()}`;
  for (const line of suite.lines) {
    console.log(`${line.tactic}: "${line.input.slice(0, 60)}"`);
    for (const [id, verdict] of Object.entries(line.expect)) {
      const character = defineCharacter(characters[id]);
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
      console.log(`   ${character.name.padEnd(16)} persuasion ${answers.persuasion.score.toFixed(2)} | ${notes.join(" | ")}`);
    }
  }
}

const count = async (url) => {
  const suite = await readJson(url);
  return suite.lines ? suite.lines.reduce((n, l) => n + Object.keys(l.expect).length, 0) : suite.cases.length;
};
const calls = (await Promise.all(files.map(count))).reduce((a, b) => a + b, 0);
console.log(`Running ${calls} cases against ${useMock ? "the keyword mock" : "Jev"}`);

for (const url of files) {
  const suite = await readJson(url);
  console.log(`\n== ${url.pathname.split("/").pop()} ==`);
  await (suite.lines ? characterSuite(suite, url) : sceneSuite(suite, url));
}

console.log("");
for (const [kind, [hit, total]] of Object.entries(tally)) {
  if (kind === "errors") { if (total) console.log(`errors   ${total} case(s) failed to run`); }
  else if (total) console.log(`${kind.padEnd(8)} ${hit}/${total}`);
}
if (record) console.log(`
${summarize(recorded)}`);
