import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defineCharacter } from "../src/index.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const suite = JSON.parse(read("evals/showcase.json"));
const characters = JSON.parse(read("stories/characters.json"));

test("the showcase tries every tactic on every preset character", () => {
  assert.deepEqual(suite.lines.map((l) => l.tactic), ["Threat", "Insult", "Plea", "Flattery", "Honest offer"]);
  for (const line of suite.lines) assert.deepEqual(Object.keys(line.expect).sort(), Object.keys(characters).sort(), line.tactic);
});

test("a showcase line offends exactly the characters whose offendedBy includes its tell", () => {
  for (const line of suite.lines) {
    const tells = ["threats", "insults"].filter((t) => line[t]);
    for (const [id, verdict] of Object.entries(line.expect)) {
      const offends = tells.some((t) => defineCharacter(characters[id]).offendedBy.includes(t));
      assert.equal(verdict === "offended", offends, `${line.tactic} on ${id}`);
    }
  }
});

test("the docs site's grid shows the showcase suite's expected verdicts", () => {
  const html = read("docs/index.html");
  const table = html.slice(html.indexOf('<table class="grid">'), html.indexOf("</table>", html.indexOf('<table class="grid">')));
  const columns = [...table.matchAll(/data-character="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(columns, Object.keys(suite.lines[0].expect));
  for (const line of suite.lines) {
    const row = table.match(new RegExp(`<tr data-tactic="${line.tactic}">(.*?)</tr>`))?.[1];
    assert.ok(row, `a row for ${line.tactic}`);
    assert.ok(row.includes(line.input.replace(/'/g, "&rsquo;")), `${line.tactic} shows its line`);
    const verdicts = [...row.matchAll(/data-verdict="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(verdicts, columns.map((id) => line.expect[id]), line.tactic);
  }
  assert.match(table, /10 live runs/, "the scores are labelled as live results");
});
