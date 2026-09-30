import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/index.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("VERSION matches package.json, so a proxy can explain a version mismatch", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(VERSION, pkg.version, "bump src/version.js with package.json");
});

test("the version is the same everywhere it appears, so a release can't miss a file", () => {
  const { version } = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.version, version, "package-lock.json: run `npm version <version> --no-git-tag-version`, which bumps both");
  assert.equal(lock.packages[""].version, version, "package-lock.json's root package: run `npm version <version> --no-git-tag-version`");

  const quoted = (path) => read(path).match(/export const VERSION = "([^"]+)"/)?.[1];
  assert.equal(quoted("src/version.js"), version, "bump src/version.js with package.json");
  assert.equal(quoted("docs/play/lib/version.js"), version, "the demo's copy is stale: run `npm run build:demo`");

  // The README names the current prerelease in its alpha notice; any other prerelease version there is a missed bump.
  // (A stable release drops the notice, and then no prerelease version should be left behind.)
  const named = [...read("README.md").matchAll(/\b\d+\.\d+\.\d+-[0-9A-Za-z.-]+\b/g)].map((m) => m[0]);
  for (const v of named) assert.equal(v, version, `README.md names ${v}: change it to ${version}`);
  if (version.includes("-")) assert.ok(named.includes(version), `README.md's alpha notice should name ${version}`);
});
