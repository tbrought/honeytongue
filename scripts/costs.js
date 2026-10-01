// What calls cost, by whether a character uses clues and angles: the input tokens Jev charges for, and latency, for
// standalone attempts on each preset character and for text adventure turns in each scene. The figures in the docs'
// "Cost and speed" come from this. Needs .env.live; every call is recorded in live-runs/.
//
//   node scripts/costs.js              about 52 live calls
//   node scripts/costs.js --dry-run    count them, make none
import { readFileSync } from "node:fs";
import { Game } from "../src/engine.js";
import { defineCharacter, persuasionQuestions, persuasionState } from "../src/persuasion.js";
import { liveClient, percentile } from "./live-recorder.js";
import { loadLiveEnv } from "./live-env.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const presets = load("stories/characters.json");
const scenes = load("stories/index.json");
const PRICE = 0.042 / 1_000_000; // dollars per input token

// A character or story with or without each feature.
const CONFIGS = { neither: [false, false], clues: [true, false], angles: [false, true], both: [true, true] };
const character = (id, [clues, angles]) => ({ ...presets[id], clues: clues ? presets[id].clues : [], angles });
function story(file, [clues, angles]) {
  const s = load(`stories/${file}`);
  for (const scene of Object.values(s.scenes)) {
    const npc = scene.npc;
    if (!npc?.persuasion) continue;
    if (!clues) { delete npc.persuasion.clues; delete npc.clueReplies; }
    if (!angles) delete npc.angleReplies;
  }
  return s;
}
const ATTEMPT_LINES = ["Please, I'm begging you. I'm in real trouble, and I've nowhere else to turn.",
  "I'll be honest: I can't pay much now, but help me tonight and I'll pay you back twice over, in writing, with my name on it."];
const TURNS = { gatehouse: ["ask Harry about his shift", "Harry, please let me through."],
  "goblin-camp": ["ask Nib about his stew", "Nib, please let me out."],
  "tidy-profit": ["ask Maude about the voyage", "Maude, please take me aboard."],
  lighthouse: ["ask Cobb about himself", "Cobb, please light the lamp."] };

const attempts = Object.keys(presets).flatMap((id) => Object.keys(CONFIGS).flatMap((config) => ATTEMPT_LINES.map((line) => ({ id, config, line }))));
// Every scene with and without both; the Gatehouse also with each one alone.
const turns = scenes.flatMap((s) => Object.keys(CONFIGS).filter((c) => s.id === "gatehouse" || c === "neither" || c === "both").map((config) => ({ scene: s, config })));
const calls = attempts.length + turns.length * 2;
console.log(`${attempts.length} attempts and ${turns.length * 2} turns: ${calls} calls`);
if (process.argv.includes("--dry-run")) process.exit(0);

loadLiveEnv();
const sink = [];
let label = "";
const client = liveClient(() => label, sink);
const results = [];
for (const a of attempts) {
  label = `costs attempt ${a.id} ${a.config}`;
  const c = defineCharacter(character(a.id, CONFIGS[a.config]));
  await client.ask(persuasionState(c, a.line), persuasionQuestions(c));
  results.push({ kind: "attempt", config: a.config, who: a.id, ...sink.at(-1) });
}
for (const t of turns) {
  const game = new Game(story(t.scene.file, CONFIGS[t.config]), client);
  for (const line of TURNS[t.scene.id]) {
    label = `costs turn ${t.scene.id} ${t.config}`;
    await game.turn(line);
    results.push({ kind: "turn", config: t.config, who: t.scene.id, ...sink.at(-1) });
  }
}

const input = (r) => r.usage?.input_tokens ?? r.tokens;
const median = (xs) => percentile(xs, 50);
console.log("\nInput tokens (median, and the range across characters or scenes), latency, and the cost of 10,000:");
for (const kind of ["attempt", "turn"]) {
  for (const config of Object.keys(CONFIGS)) {
    const rows = results.filter((r) => r.kind === kind && r.config === config);
    if (!rows.length) continue;
    const byWho = [...new Set(rows.map((r) => r.who))].map((w) => median(rows.filter((r) => r.who === w).map(input)));
    const m = median(rows.map(input));
    console.log(`  ${kind.padEnd(7)} ${config.padEnd(7)} ${String(Math.round(m)).padStart(5)} input tokens (${Math.round(Math.min(...byWho))} to ${Math.round(Math.max(...byWho))}),` +
      ` ${median(rows.map((r) => r.ms))} ms median, ${percentile(rows.map((r) => r.ms), 95)} ms p95, $${(m * 10_000 * PRICE).toFixed(2)} per 10,000`);
  }
}
const total = results.reduce((n, r) => n + (r.tokens ?? 0), 0);
console.log(`\n${results.length} live calls, ${total} tokens.`);
