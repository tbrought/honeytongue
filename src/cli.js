#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import readline from "node:readline";
import { argv, env, stdin, stdout } from "node:process";
import { Game, StoryError } from "./engine.js";
import { createJevClient } from "./jev.js";
import { createMockClient } from "./mock.js";

const args = argv.slice(2);
const storyPath = args.find((a) => !a.startsWith("--")) ?? new URL("../stories/gatehouse.json", import.meta.url);
let story;
try {
  story = JSON.parse(await readFile(storyPath, "utf8"));
} catch (err) {
  console.error(`Couldn't read story file ${storyPath}: ${err.message}`);
  process.exit(1);
}

const useMock = args.includes("--mock") || !env.TYPESAFE_API_KEY;
if (useMock && !args.includes("--mock")) {
  console.log("(No TYPESAFE_API_KEY set, so using the offline keyword mock. It's much dumber than Jev.)\n");
}
let debug = args.includes("--debug");
let game;
try {
  game = new Game(story, useMock ? createMockClient() : createJevClient());
} catch (err) {
  console.error(err instanceof StoryError ? err.message : `Couldn't start: ${err.message}`);
  process.exit(1);
}

const wrap = (text, width = 72) =>
  text.split("\n").map((line) => {
    const indent = line.match(/^\s*/)[0];
    const out = [];
    let cur = "";
    for (const word of line.trim().split(" ")) {
      if ((cur + " " + word).trim().length > width) { out.push(indent + cur); cur = word; }
      else cur = (cur + " " + word).trim();
    }
    return [...out, indent + cur].join("\n");
  }).join("\n");

const bar = (value, max, width = 20) => {
  const filled = Math.round((Math.max(0, value) / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
};

function printDebug(d) {
  const tag = `[${d.source ?? "unknown"}]`; // who answered this turn: jev, mock, or unknown if the client didn't say
  const top = d.ranked.map(([k, p]) => `${k} ${p.toFixed(2)}`).join(" · ");
  console.log(`\n  ${tag} action: ${top}`);
  if (d.persuasion) {
    const max = d.maxScore ?? Math.max(1, Object.keys(d.persuasion.legend ?? {}).length - 1);
    console.log(`  ${tag} persuasion ${bar(d.persuasion.score, max)} ${d.persuasion.score.toFixed(2)} / ${max}`);
  }
  const tells = ["threats", "insults"].filter((t) => d[t]).map((t) => `${t} ${d[t].noul.toFixed(2)}`);
  if (tells.length) console.log(`  ${tag} ${tells.join(" · ")}`);
}

console.log(wrap(game.intro()));
console.log("\n(Type 'help' for tips.)");

const rl = readline.createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

while (!game.over) {
  stdout.write("\n> ");
  const { value, done } = await lines.next();
  if (done) break;
  const input = value.trim();
  if (!stdin.isTTY) console.log(input);
  if (/^(quit|exit|q)$/i.test(input)) break;
  if (input === "debug") { debug = !debug; console.log(`Debug view ${debug ? "on" : "off"}.`); continue; }

  try {
    const result = await game.turn(input);
    if (debug && result.debug) printDebug(result.debug);
    if (result.text) console.log("\n" + wrap(result.text));
  } catch (err) {
    console.log(`\n(Something went wrong talking to Jev: ${err.message})`);
  }
}
rl.close();
