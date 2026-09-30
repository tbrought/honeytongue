import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const scenes = JSON.parse(readFileSync(new URL("../stories/index.json", import.meta.url), "utf8"));
const characters = JSON.parse(readFileSync(new URL("../stories/characters.json", import.meta.url), "utf8"));

/** Run the terminal player with typed lines, without a key, and collect what it prints. */
function play(args, lines, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.TYPESAFE_API_KEY;
  for (const [k, v] of Object.entries(extraEnv)) if (v === undefined) delete env[k];
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [cli, ...args], { env, timeout: 10000 }, (err, stdout, stderr) => {
      if (err && err.code !== 1) reject(err);
      else resolve({ stdout, stderr, code: child.exitCode });
    });
    child.stdin.end(lines.map((l) => `${l}\n`).join(""));
  });
}

test("with no story, the terminal player offers every bundled scene", async () => {
  const { stdout, code } = await play(["--mock"], ["q"]);
  assert.equal(code, 0);
  scenes.forEach((s, i) => {
    const word = characters[s.character].difficulty;
    assert.ok(stdout.includes(`${i + 1}) ${s.title} (${word[0].toUpperCase()}${word.slice(1)}, about ${s.minutes} minutes)`), s.title);
    assert.ok(stdout.includes(s.hook), s.hook);
  });
});

test("a scene can be picked by number or by name, and asks again after a bad answer", async () => {
  const byNumber = await play(["--mock"], ["2", "quit"]);
  assert.match(byNumber.stdout, /THE GOBLIN CAMP/);
  const byName = await play(["--mock"], ["nope", "lighthouse", "quit"]);
  assert.match(byName.stdout, /Type a number from 1 to 4/);
  assert.match(byName.stdout, /THE DARK LIGHTHOUSE/);
});

test("a story path still plays that story, with no menu", async () => {
  const { stdout } = await play([fileURLToPath(new URL("../stories/tidy-profit.json", import.meta.url)), "--mock"], ["quit"]);
  assert.match(stdout, /THE TIDY PROFIT/);
  assert.doesNotMatch(stdout, /Choose a scene/);
});

test("--transcript saves a playtest transcript as you play, and a scene picked from the menu names it", async () => {
  const { mkdtempSync, readFileSync: read, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const file = join(mkdtempSync(join(tmpdir(), "honeytongue-")), "play.json");
  const { stdout } = await play(["--mock", "--transcript", file], ["2", "ask Nib about his stew", "quit"]);
  assert.match(stdout, /Recording a transcript to .*play\.json/);
  assert.ok(existsSync(file));
  const transcript = JSON.parse(read(file, "utf8"));
  assert.equal(transcript.formatVersion, 1);
  assert.equal(transcript.scene, "goblin-camp");
  assert.equal(transcript.judge, "mock");
  assert.deepEqual(transcript.runs[0].turns.map((t) => t.action.id), ["chat_nib"], "quit isn't a turn");

  const bare = await play(["--mock", "--transcript"], ["q"]);
  assert.equal(bare.code, 1);
  assert.match(bare.stderr, /--transcript needs a file name/);
});

test("after a failed attempt, the terminal says how much patience is left", async () => {
  const { stdout } = await play(["--mock"], ["2", "Nib, please let me go", "ask Nib about his stew", "quit"]);
  assert.match(stdout, /\(Nib's patience: 2 of 3 left\)/);
  assert.equal(stdout.match(/patience: /g).length, 1, "not after an ordinary action");
  const cobb = await play(["--mock"], ["3", "Cobb, please light the lamp", "quit"]);
  assert.match(cobb.stdout, /\(Cobb's patience: 9 of 10 left\)/);
});

const ESC = "\x1b[";
const plain = { NO_COLOR: undefined, FORCE_COLOR: undefined };

test("the terminal shows markup as colour, labels verdicts, and puts a title card before a named scene", async () => {
  const { stdout } = await play(["--mock"], ["1", "ask Harry about the toy horse", "Out of my way, you fool", "quit"], { ...plain, FORCE_COLOR: "1" });
  assert.ok(stdout.includes(`${ESC}1;36mHarry Goatleaf${ESC}0m`), "a character");
  assert.ok(stdout.includes(`${ESC}4;94mtoy horse${ESC}0m`), "an item");
  assert.match(stdout, /\x1b\[33m"Third double shift/, "speech");
  assert.ok(stdout.includes(`${ESC}31m[offended]${ESC}0m ${ESC}1;36mHarry`), "an offended verdict, labelled in red");
  assert.ok(stdout.includes(`${ESC}1m── EAST GATE ──${ESC}0m`), "the scene's title card");
  assert.doesNotMatch(stdout, /[@#]\[/, "markup itself never shows");
});

test("colour is off with NO_COLOR, with --no-color, and when output isn't a terminal", async () => {
  const lines = ["1", "ask Harry about the toy horse", "Out of my way, you fool", "quit"];
  for (const [args, env] of [[["--mock"], { ...plain, NO_COLOR: "1", FORCE_COLOR: "1" }], [["--mock", "--no-color"], { ...plain, FORCE_COLOR: "1" }], [["--mock"], plain]]) {
    const { stdout } = await play(args, lines, env);
    assert.ok(!stdout.includes(ESC), `${args.join(" ")} ${JSON.stringify(env)}`);
    assert.match(stdout, /Harry Goatleaf, the/);
    assert.match(stdout, /\[offended\] Harry's hand drops/, "the verdict label is text, so it shows without colour too");
    assert.match(stdout, /── EAST GATE ──/);
    assert.doesNotMatch(stdout, /[@#]\[/);
  }
});

test("coloured lines wrap at the same width as plain ones", async () => {
  const lines = ["1", "ask Harry about the toy horse", "quit"];
  const coloured = (await play(["--mock"], lines, { ...plain, FORCE_COLOR: "1" })).stdout.replace(/\x1b\[[0-9;]*m/g, "");
  const uncoloured = (await play(["--mock"], lines, plain)).stdout;
  assert.equal(coloured, uncoloured);
});
