// Where the TypeSafe key may go: only .env.live, which git ignores and npm never packs, and only commands that call
// live Jev load it (see scripts/live-env.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json"));

test(".env.live is ignored by git and outside every packed path", () => {
  // --no-index: whether git would ignore it, even if no such file exists here.
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "-q", ".env.live"], { cwd: new URL("..", import.meta.url) }).length === 0;
  assert.ok(ignored);
  for (const entry of pkg.files.filter((f) => !f.startsWith("!"))) {
    assert.ok(!/^\.env|^\.$|^\*/.test(entry), `package.json files entry ${entry} could include .env.live`);
  }
});

test("only the commands that call live Jev load .env.live", () => {
  const LIVE = ["play", "example", "proxy", "playground"];
  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (LIVE.includes(name)) assert.match(command, /^node --env-file-if-exists=\.env\.live /, `${name} loads the key`);
    else assert.doesNotMatch(command, /env-file|\.env\.live/, `${name} must not load the key`);
  }
  // The live scripts load it themselves; eval and multiturn only for a live run, never with --mock.
  for (const script of ["scripts/eval.js", "scripts/live.js", "scripts/calibrate.js", "scripts/multiturn.js"]) {
    assert.match(read(script), /loadLiveEnv\(\)/, script);
  }
  assert.match(read("scripts/eval.js"), /if \(!process\.argv\.includes\("--mock"\)\) loadLiveEnv\(\);/);
  // Nothing else in the repository loads it.
  for (const file of ["scripts/browser-check.js", "scripts/check-screenshots.js", "scripts/check-package.js", "scripts/check-demo-proxy.js", "scripts/build-demo.js"]) {
    assert.doesNotMatch(read(file), /loadLiveEnv|loadEnvFile|env-file/, file); // mentioning the file, as a guard does, is fine
  }
});
