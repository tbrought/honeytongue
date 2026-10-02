import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/index.js";
import { STAMPED, serialNumber, stampRelease } from "../scripts/release-stamp.js";

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

test("the docs' credits name the version and its release date, Infocom style", () => {
  const { version } = JSON.parse(read("package.json"));
  const serial = serialNumber(read("CHANGELOG.md"), version);
  assert.match(serial, /^\d{6}$/);
  for (const page of STAMPED) {
    const html = read(page);
    assert.equal(stampRelease(html, version, serial, page), html, `${page}'s release line is stale: run npm run build:demo`);
  }
});

test("the release stamp explains a missing CHANGELOG heading or a reworded credits line", () => {
  const changelog = "## Unreleased\n\n## 1.2.0-alpha.3 (2027-01-09)\n\n## 1.2.0-alpha.30 (2027-02-01)\n";
  assert.equal(serialNumber(changelog, "1.2.0-alpha.3"), "270109");
  assert.throws(() => serialNumber(changelog, "1.2.0"), /no heading for 1\.2\.0\. Move the Unreleased entries/);
  const stamped = '<p>Release <a href="https://www.npmjs.com/package/honeytongue/v/0.2.0">0.2.0</a>&nbsp;/ Serial number 270109</p>';
  assert.equal(stampRelease("<p>Release 0.1&nbsp;/ Serial number 260101</p>", "0.2.0", "270109"), stamped);
  assert.equal(stampRelease(stamped, "0.2.0", "270109"), stamped, "stamping twice changes nothing");
  assert.throws(() => stampRelease("<p>Release 0.1</p>", "0.2.0", "270109", "x.html"), /x\.html should have one "Release <version> \/"/);
});
