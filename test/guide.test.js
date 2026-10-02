import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { stripMarkup } from "../src/markup.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const guide = read("docs/guide/index.html");
const unescape = (html) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;|&rsquo;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Every string in a JSON value, with story markup stripped (the guide quotes lines as players see them). */
function strings(value, out = []) {
  if (typeof value === "string") out.push(stripMarkup(value));
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}
const sources = [
  ...readdirSync(new URL("../stories/", import.meta.url)).filter((f) => f.endsWith(".json")).map((f) => `stories/${f}`),
  "evals/calibration/robustness.json", // the characters we wrote to test other developers' styles
].flatMap((path) => strings(JSON.parse(read(path))));

test("every line the guide quotes is word for word from the demo stories or the test characters", () => {
  const quotes = [...guide.matchAll(/<(q|blockquote) class="from-story">([\s\S]*?)<\/\1>/g)].map((m) => unescape(m[2]));
  assert.ok(quotes.length >= 10, `${quotes.length} quotes`);
  for (const quote of quotes) assert.ok(sources.some((s) => s.includes(quote)), `not found in the stories: ${quote}`);
});

test("the guide's clue example is The Gatehouse's own clue", () => {
  const [clue] = JSON.parse(read("stories/gatehouse.json")).scenes.gate.npc.persuasion.clues;
  const text = unescape(guide);
  for (const field of ["id", "when", "reveals"]) assert.ok(text.includes(`"${field}": "${clue[field]}"`), field);
});

test("every section opens with its rule and keeps its measurements in an Evidence box; the brief covers them all", () => {
  const sections = [...guide.matchAll(/<section id="([^"]+)">([\s\S]*?)<\/section>/g)].map(([, id, body]) => ({ id, body }));
  const ruled = sections.filter((s) => !["brief", "checklist"].includes(s.id));
  assert.ok(ruled.length >= 7, `${ruled.length} sections`);
  for (const { id, body } of ruled) {
    assert.match(body, /^\s*<h2>[^<]+<\/h2>\s*<p class="rule"><strong>[^<]+<\/strong><\/p>/, `${id} opens with its rule in one bold line`);
    assert.match(body, /<details class="evidence">\s*<summary>Evidence<\/summary>/, `${id} has an Evidence box`);
  }
  const brief = sections.find((s) => s.id === "brief").body;
  for (const { id } of ruled) assert.ok(brief.includes(`href="#${id}"`), `the brief links to ${id}`);
  assert.ok(sections.some((s) => s.id === "checklist"), "the checklist is at the end");
  assert.doesNotMatch(guide, /<script(?![^>]*\bsrc=)/, "no inline script: the Evidence boxes are plain <details>");
});

test("the guide's links into the docs land on sections that exist, and the docs link back to it", () => {
  const docs = read("docs/index.html");
  for (const [, id] of guide.matchAll(/href="\.\.\/#([^"]+)"/g)) assert.ok(docs.includes(`id="${id}"`), `the docs have #${id}`);
  for (const [, id] of guide.matchAll(/href="#([^"]+)"/g)) assert.ok(guide.includes(`id="${id}"`), `the guide has #${id}`);
  assert.ok(docs.includes('href="guide/"'), "the docs link to the guide");
  const hero = docs.slice(docs.indexOf('<ul class="commands">'), docs.indexOf("</ul>", docs.indexOf('<ul class="commands">')));
  assert.ok(hero.includes('href="guide/"'), "the home page's main links, on its first screen, include the guide");
});

test("the checklist is a plain list with a button that copies it as a Markdown task list", () => {
  const list = guide.slice(guide.indexOf('<ul class="checklist">'), guide.indexOf("</ul>", guide.indexOf('<ul class="checklist">')));
  const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)];
  assert.ok(items.length >= 10, `${items.length} items`);
  assert.doesNotMatch(list, /<input/, "no live checkboxes: ticks wouldn't survive a reload, and the list is for each character");
  assert.match(guide, /<button type="button" class="button" id="copy-checklist">Copy as task list<\/button>/);
  assert.match(read("docs/home.js"), /getElementById\("copy-checklist"\)/);
});
