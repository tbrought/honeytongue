#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import readline from "node:readline";
import { argv, env, stdin, stdout } from "node:process";
import { Game, StoryError } from "./engine.js";
import { createJevClient } from "./jev.js";
import { createMockClient } from "./mock.js";
import { createTranscript, snapshot } from "./transcript.js";

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
  // A repeat is caught locally, so nothing answered it.
  if (!d.ranked.length) { console.log(`\n  [local] ${d.verdict ?? "repeated"}: too close to an earlier attempt, not sent to Jev`); return; }
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

/** Ask which bundled scene to play. Returns its file's URL, or null if the player quits first. */
async function chooseScene(lines) {
  const scenes = JSON.parse(await readFile(new URL("../stories/index.json", import.meta.url), "utf8"));
  console.log("Choose a scene:\n");
  scenes.forEach((s, i) => console.log(`  ${i + 1}) ${s.title} (about ${s.minutes} minutes)\n     ${s.hook}`));
  for (;;) {
    stdout.write(`\nScene (1-${scenes.length}): `);
    const { value, done } = await lines.next();
    if (done) return null;
    const answer = value.trim();
    if (!stdin.isTTY) console.log(answer);
    if (/^(quit|exit|q)$/i.test(answer)) return null;
    // A number, or enough of a title to be sure ("goblin", "lighthouse").
    const scene = scenes[Number(answer) - 1] ?? (answer.length > 2 ? scenes.find((s) => s.title.toLowerCase().includes(answer.toLowerCase())) : undefined);
    if (scene) {
      console.log("");
      return new URL(`../stories/${scene.file}`, import.meta.url);
    }
    console.log(`Type a number from 1 to ${scenes.length}.`);
  }
}

/** Play a story in the terminal: `honeytongue [story.json] [--mock] [--debug]`. With no story, pick a bundled scene. */
async function play(args) {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
  try {
    await run(args, rl[Symbol.asyncIterator]());
  } finally {
    rl.close();
  }
}

async function run(args, lines) {
  // --transcript <file> saves a playtest transcript as you play; its file name isn't a story.
  const transcriptPath = args.includes("--transcript") ? args[args.indexOf("--transcript") + 1] : null;
  if (args.includes("--transcript") && !transcriptPath) {
    console.error("--transcript needs a file name, like --transcript play.json");
    process.exitCode = 1;
    return;
  }
  const storyPath = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--transcript") ?? await chooseScene(lines);
  if (!storyPath) return;
  let story;
  try {
    story = JSON.parse(await readFile(storyPath, "utf8"));
  } catch (err) {
    console.error(`Couldn't read story file ${storyPath}: ${err.message}`);
    process.exitCode = 1;
    return;
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
    process.exitCode = 1;
    return;
  }

  let transcript = null;
  if (transcriptPath) {
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    transcript = createTranscript({ version, scene: basename(String(storyPath instanceof URL ? storyPath.pathname : storyPath), ".json"), story });
    transcript.start();
    console.log(`(Recording a transcript to ${transcriptPath}. It stays on your computer.)\n`);
  }

  console.log(wrap(game.intro()));
  console.log("\n(Type 'help' for tips.)");

  while (!game.over) {
    stdout.write("\n> ");
    const { value, done } = await lines.next();
    if (done) break;
    const input = value.trim();
    if (!stdin.isTTY) console.log(input);
    if (/^(quit|exit|q)$/i.test(input)) break;
    if (input === "debug") { debug = !debug; console.log(`Debug view ${debug ? "on" : "off"}.`); continue; }

    try {
      const before = snapshot(game);
      const result = await game.turn(input);
      if (transcript) {
        transcript.record(input, before, result, game);
        writeFileSync(transcriptPath, JSON.stringify(transcript.data, null, 2) + "\n"); // after every turn, so quitting keeps it
      }
      if (debug && result.debug) printDebug(result.debug);
      if (result.text) console.log("\n" + wrap(result.text));
      // After a failed attempt, say how much patience is left, as the web demo's pips do.
      const d = result.debug;
      const npc = game.npc;
      if (!game.over && npc && ["unconvinced", "offended", "repeated"].includes(d?.verdict) && Number.isFinite(npc.character.patience)) {
        console.log(`\n(${npc.character.name.split(" ")[0]}'s patience: ${npc.patienceLeft} of ${npc.character.patience} left)`);
      }
    } catch (err) {
      console.log(`\n(Something went wrong talking to Jev: ${err.message})`);
    }
  }
}

const args = argv.slice(2);
if (args[0] === "playground") {
  // The character playground's server is Node-only, so it's loaded only when asked for.
  const { runPlayground } = await import("./playground-server.js");
  await runPlayground(args.slice(1));
} else {
  await play(args);
}
