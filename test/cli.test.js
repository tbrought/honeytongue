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
