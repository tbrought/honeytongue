import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEMO_FILES, VERSION_FILE, versionJson } from "../scripts/demo-files.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the browser demo's copies of the engine and story are up to date", () => {
  for (const [source, copy] of DEMO_FILES) {
    assert.ok(read(copy) === read(source), `${copy} is out of date with ${source}. Run: npm run build:demo`);
  }
  assert.equal(read(VERSION_FILE), versionJson(JSON.parse(read("package.json"))), `${VERSION_FILE} is out of date. Run: npm run build:demo`);
});
