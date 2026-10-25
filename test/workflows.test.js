import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../.github/workflows/", import.meta.url);
const workflows = readdirSync(dir).filter((f) => f.endsWith(".yml")).map((f) => [f, readFileSync(new URL(f, dir), "utf8")]);

/** Each `uses: actions/setup-node@...` step, as the lines of its block. */
function setupNodeSteps(yaml) {
  const lines = yaml.split("\n");
  const steps = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)- uses: actions\/setup-node@/);
    if (!m) return;
    const block = [line];
    for (let j = i + 1; j < lines.length; j++) {
      const indent = lines[j].match(/^\s*/)[0].length;
      if (lines[j].trim() && indent <= m[1].length) break;
      block.push(lines[j]);
    }
    steps.push({ line: i + 1, block: block.join("\n") });
  });
  return steps;
}

test("every workflow's Node setup takes the newest patch release, not the runner's cached copy", () => {
  const steps = workflows.flatMap(([file, yaml]) => setupNodeSteps(yaml).map((s) => ({ file, ...s })));
  assert.ok(steps.length >= 5, `${steps.length} setup-node steps`);
  for (const { file, line, block } of steps) {
    assert.match(block, /^\s+check-latest: true$/m,
      `${file}:${line}: add "check-latest: true" to setup-node, so security releases (such as Node's for CVE-2026-111497) apply at once`);
  }
});
