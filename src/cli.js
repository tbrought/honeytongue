#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import readline from "node:readline";
import { argv, env, stdin, stdout } from "node:process";
import { Game, StoryError } from "./engine.js";
import { defineCharacter } from "./persuasion.js";
import { parseMarkup, stripMarkup } from "./markup.js";
import { createJevClient } from "./jev.js";
import { createMockClient } from "./mock.js";
import { createTranscript, snapshot } from "./transcript.js";
import { VERSION } from "./version.js";

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

// ---- Colour: one example of styling result.parts. Off with --no-color or NO_COLOR, and when output isn't a terminal
// (FORCE_COLOR turns it on anyway). The engine only says what each part means; these codes are this player's choice.
const STYLE = {
  character: "1;36", // bold cyan
  item: "4;94",      // underlined bright blue
  speech: "33",      // yellow
  system: "2",       // dim
  ending: "1",       // bold
  title: "1",
};
// Labels for judged replies. An ordinary unconvinced turn has none: the reply says it, and the patience line follows.
const VERDICT = {
  convinced: ["convinced", "32"],
  offended: ["offended", "31"],
  repeated: ["repeated", "35"],
};
let color = false;
const paint = (code, text) => (color && code ? `\x1b[${code}m${text}\x1b[0m` : text);

/**
 * A paragraph of parts, word-wrapped like wrap() and coloured by kind. Wrapping works on the plain characters, each
 * carrying its part's style, so colour codes never count toward the line width.
 */
function wrapParts(parts, width = 72) {
  if (!color) return wrap(parts.map((p) => p.text).join(""), width);
  const chars = parts.flatMap((p) => [...p.text].map((ch) => ({ ch, code: p.code ?? STYLE[p.kind] })));
  const lines = [[]];
  for (const c of chars) c.ch === "\n" ? lines.push([]) : lines[lines.length - 1].push(c);
  const render = (cs) => {
    let out = "";
    let run = "";
    let code;
    for (const c of cs) {
      if (c.code !== code) { out += paint(code, run); run = ""; code = c.code; }
      run += c.ch;
    }
    return out + paint(code, run);
  };
  return lines.map((line) => {
    const indent = line.findIndex((c) => c.ch !== " ");
    const lead = indent === -1 ? [] : line.slice(0, indent);
    const words = [[]];
    for (const c of line.slice(Math.max(0, indent))) c.ch === " " ? words.push([]) : words[words.length - 1].push(c);
    const out = [];
    let cur = [];
    for (const word of words.filter((w) => w.length)) {
      if (cur.length && cur.length + 1 + word.length > width) { out.push(cur); cur = [...word]; }
      else cur = cur.length ? [...cur, { ch: " ", code: cur[cur.length - 1].code === word[0].code ? word[0].code : undefined }, ...word] : [...word];
    }
    out.push(cur);
    return out.map((l) => render([...lead, ...l])).join("\n");
  }).join("\n");
}

/** A turn's reply: each paragraph wrapped and coloured, with a title card where a new named scene begins. */
function printReply(result, { verdict, scene } = {}) {
  const paragraphs = result.parts?.length ? result.parts : result.text ? [[{ kind: "text", text: result.text }]] : [];
  // The verdict label starts the first paragraph, so it's wrapped with it.
  const labelled = verdict && VERDICT[verdict] && paragraphs.length
    ? [[{ kind: "label", text: `[${VERDICT[verdict][0]}] `, code: VERDICT[verdict][1] }, ...paragraphs[0]], ...paragraphs.slice(1)]
    : paragraphs;
  const out = labelled.map((p) => wrapParts(p));
  if (scene) {
    // The new scene's description is in the reply: put its title card just before it.
    const at = paragraphs.findIndex((p) => p.map((x) => x.text).join("") === stripMarkup(scene.description));
    if (at !== -1) out.splice(at, 0, titleCard(scene.name));
  }
  if (out.length) console.log("\n" + out.join("\n\n"));
}

const titleCard = (name) => paint(STYLE.title, `── ${name.toUpperCase()} ──`);

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
  const presets = JSON.parse(await readFile(new URL("../stories/characters.json", import.meta.url), "utf8"));
  console.log("Choose a scene:\n");
  scenes.forEach((s, i) => {
    // The difficulty comes from the scene's character, as on the web demo's scene list.
    const word = presets[s.character] && defineCharacter(presets[s.character]).difficulty;
    const difficulty = word ? `${word[0].toUpperCase()}${word.slice(1)}, ` : "";
    console.log(`  ${i + 1}) ${s.title} (${difficulty}about ${s.minutes} minutes)\n     ${s.hook}`);
  });
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

/**
 * Play a story in the terminal: `honeytongue [story.json] [--mock] [--debug] [--no-color] [--transcript file]`. With no
 * story, pick a bundled scene.
 */
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

  color = !args.includes("--no-color") && !env.NO_COLOR && (stdout.isTTY || Boolean(env.FORCE_COLOR && env.FORCE_COLOR !== "0"));
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
    transcript = createTranscript({ version: VERSION, scene: basename(String(storyPath instanceof URL ? storyPath.pathname : storyPath), ".json"), story });
    transcript.start();
    console.log(`(Recording a transcript to ${transcriptPath}. It stays on your computer.)\n`);
  }

  // The title, the intro, then the first scene (with its title card if it has a name).
  const opening = [paint(STYLE.title, stripMarkup(story.title))];
  if (story.intro) opening.push(wrapParts(parseMarkup(story.intro)));
  if (game.scene.name) opening.push(titleCard(game.scene.name));
  opening.push(wrapParts(parseMarkup(game.scene.description)));
  console.log(opening.join("\n\n"));
  console.log("\n" + paint(STYLE.system, "(Type 'help' for tips.)"));

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
      const sceneBefore = game.sceneId;
      const result = await game.turn(input);
      if (transcript) {
        transcript.record(input, before, result, game);
        writeFileSync(transcriptPath, JSON.stringify(transcript.data, null, 2) + "\n"); // after every turn, so quitting keeps it
      }
      if (debug && result.debug) printDebug(result.debug);
      const d = result.debug;
      const entered = game.sceneId !== sceneBefore && game.scene.name && !game.scene.ending ? game.scene : null;
      printReply(result, { verdict: d?.verdict, scene: entered });
      // After a failed attempt, say how much patience is left, as the web demo's pips do.
      const npc = game.npc;
      if (!game.over && npc && ["unconvinced", "offended", "repeated"].includes(d?.verdict) && Number.isFinite(npc.character.patience)) {
        console.log("\n" + paint(STYLE.system, `(${npc.character.name.split(" ")[0]}'s patience: ${npc.patienceLeft} of ${npc.character.patience} left)`));
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
