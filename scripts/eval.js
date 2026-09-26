// Runs the phrasing test set against Jev (or the mock with --mock) and reports
// parser accuracy, whether persuasion scores land in range, and hostility checks.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Game } from "../src/engine.js";
import { createJevClient } from "../src/jev.js";
import { createMockClient } from "../src/mock.js";

// A suite path given on the command line is relative to where you ran it (or absolute).
const file = process.argv.find((a) => a.endsWith(".json"));
const evalUrl = file ? pathToFileURL(resolve(file)) : new URL("../evals/gatehouse.json", import.meta.url);
const suite = JSON.parse(await readFile(evalUrl, "utf8"));
const story = JSON.parse(await readFile(new URL(suite.story, evalUrl), "utf8"));
const useMock = process.argv.includes("--mock") || !process.env.TYPESAFE_API_KEY;
const client = useMock ? createMockClient() : createJevClient();
console.log(`Running ${suite.cases.length} cases against ${useMock ? "the keyword mock" : "Jev"}\n`);

const tally = { action: [0, 0], score: [0, 0], hostile: [0, 0] };
const mark = (kind, ok) => { tally[kind][1]++; if (ok) tally[kind][0]++; return ok ? "ok" : "MISS"; };

for (const c of suite.cases) {
  const game = new Game(story, client);
  for (const f of c.flags ?? []) game.flags.add(f);
  const { answers, ranked } = await game.interpret(c.input);
  const [top, p] = ranked[0];
  const notes = [];
  if (c.expect) notes.push(`action ${top} ${p.toFixed(2)} ${mark("action", top === c.expect)}${top === c.expect ? "" : ` (want ${c.expect})`}`);
  if (c.score) {
    const s = answers.persuasion.score;
    notes.push(`persuasion ${s.toFixed(2)} ${mark("score", s >= c.score[0] && s <= c.score[1])} (want ${c.score[0]}-${c.score[1]})`);
  }
  if (c.hostile !== undefined) {
    const h = answers.hostile.noul;
    notes.push(`hostile ${h.toFixed(2)} ${mark("hostile", (h >= 0.7) === c.hostile)}`);
  }
  console.log(`"${c.input.slice(0, 60)}"\n   ${notes.join(" | ")}${c.note ? `  [${c.note}]` : ""}`);
}

console.log("");
for (const [kind, [hit, total]] of Object.entries(tally)) if (total) console.log(`${kind.padEnd(8)} ${hit}/${total}`);
