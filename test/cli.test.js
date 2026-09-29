import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const scenes = JSON.parse(readFileSync(new URL("../stories/index.json", import.meta.url), "utf8"));

/** Run the terminal player with typed lines, without a key, and collect what it prints. */
function play(args, lines) {
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
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
    assert.ok(stdout.includes(`${i + 1}) ${s.title} (about ${s.minutes} minutes)`), s.title);
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
