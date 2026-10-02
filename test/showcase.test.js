import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defineCharacter } from "../src/index.js";
import { decodeShare } from "../docs/playground/designer.js";
import { linkShowcase } from "../scripts/showcase-links.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const suite = JSON.parse(read("evals/showcase.json"));
const characters = JSON.parse(read("stories/characters.json"));

test("the showcase tries every tactic on every preset character", () => {
  assert.deepEqual(suite.lines.map((l) => l.tactic), ["Threat", "Insult", "Plea", "Flattery", "Honest offer", "Plain truth"]);
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
    // Each cell's label says the same verdict, in its colour.
    const labels = [...row.matchAll(/<td data-verdict="([^"]+)"><span class="chip v-([^"]+)">([^<]+)<\/span>/g)];
    assert.deepEqual(labels.map((m) => [m[2], m[3]]), verdicts.map((v) => [v, v]), `${line.tactic}: labels match`);
  }
  assert.match(table, /10 live runs/, "the scores are labelled as live results");
  assert.match(table, /scored with each character on their own, as in the playground/, "the grid says how it was scored");
});

test("each grid cell's Try it link opens the playground with that column's preset and that row's line", () => {
  const html = read("docs/index.html");
  const table = html.slice(html.indexOf('<table class="grid">'), html.indexOf("</table>", html.indexOf('<table class="grid">')));
  const columns = [...table.matchAll(/data-character="([^"]+)"/g)].map((m) => m[1]);
  for (const line of suite.lines) {
    const row = table.match(new RegExp(`<tr data-tactic="${line.tactic}">(.*?)</tr>`))[1];
    const links = [...row.matchAll(/<td data-verdict="[^"]+">.*?<a class="try" href="playground\/(#c=[^"]+)">Try it<span class="vh">(.*?)<\/span><\/a><\/td>/g)];
    assert.equal(links.length, columns.length, `${line.tactic}: a link in every cell`);
    for (const [i, [, hash, spoken]] of links.entries()) {
      assert.deepEqual(decodeShare(hash), { preset: columns[i], knows: [], line: line.input }, `${line.tactic} on ${columns[i]}`);
      assert.ok(spoken.includes(characters[columns[i]].name.split(" ")[0]), `${line.tactic}: the link's text names the character`);
    }
  }
  assert.equal(linkShowcase(html), html, "the links are current: run npm run build:demo");
});

test("every grid cell has the same three lines (verdict, score or a dash, Try it), so a row's links line up", () => {
  const html = read("docs/index.html");
  const table = html.slice(html.indexOf('<table class="grid">'), html.indexOf("</table>", html.indexOf('<table class="grid">')));
  const cells = [...table.matchAll(/<td data-verdict="([^"]+)">([\s\S]*?)<\/td>/g)];
  assert.equal(cells.length, suite.lines.length * Object.keys(characters).length);
  for (const [, verdict, cell] of cells) {
    const parts = [...cell.matchAll(/<(span|a) class="([^"]+)"/g)].map((m) => m[2]).filter((c) => c !== "vh");
    const score = verdict === "offended" ? "dim no-score" : "dim";
    assert.deepEqual(parts, [`chip v-${verdict}`, score, "try"], `${verdict}: ${cell.slice(0, 80)}`);
  }
});

