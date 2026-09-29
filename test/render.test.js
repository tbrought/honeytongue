import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Game, createMockClient } from "../src/index.js";
import { createTranscript, snapshot } from "../src/transcript.js";
import { makeRenderer } from "../docs/play/render.js";
import { endingSummary } from "../docs/play/present.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const IMG = "<img src=x onerror=alert(1)>";
const SCRIPT = '</p><script>alert("xss")</script>';

/**
 * A stand-in document that records what's built and fails loudly on anything that could parse HTML or run code:
 * innerHTML, outerHTML, insertAdjacentHTML, or an event-handler attribute.
 */
function fakeDocument() {
  const forbidden = (name) => () => { throw new Error(`${name} used: text must never be parsed as HTML`); };
  class Node {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.childNodes = []; this.attributes = {}; }
    append(...nodes) { for (const n of nodes) this.childNodes.push(typeof n === "string" ? { text: n } : n); }
    setAttribute(name, value) {
      if (/^on/i.test(name)) throw new Error(`event handler attribute ${name} set`);
      this.attributes[name] = String(value);
    }
    get textContent() { return this.childNodes.map((n) => (n instanceof Node ? n.textContent : n.text)).join(""); }
  }
  for (const name of ["innerHTML", "outerHTML"]) Object.defineProperty(Node.prototype, name, { get: forbidden(name), set: forbidden(name) });
  Node.prototype.insertAdjacentHTML = forbidden("insertAdjacentHTML");
  return { createElement: (tag) => new Node(tag), Node };
}

/** Every element and every text node under a node. */
function walk(node, out = { elements: [], texts: [] }) {
  for (const child of node.childNodes) {
    if (child.tagName) { out.elements.push(child); walk(child, out); } else out.texts.push(child.text);
  }
  return out;
}

test("the web demo inserts everything as text: story text, replies, player input, title cards, the ending screen, and transcripts", async () => {
  const doc = fakeDocument();
  const { el, paragraph, titleCard, commandLine, endingScreen } = makeRenderer(doc);
  const log = el("div");
  const story = load("stories/goblin-camp.json");
  const game = new Game(story, createMockClient());
  const transcript = createTranscript({ scene: "goblin-camp", story });
  const judged = [];

  // Hostile text in the story as well as in what the player types.
  story.scenes.cage.name = `Cage ${SCRIPT}`;
  log.append(titleCard(story.scenes.cage.name));
  const lines = [
    "ask Nib about his stew",
    `Nib, please ${IMG}`,
    `Nib, let me go ${SCRIPT}`,
    `Nib, please let me out. Come with me to town and I'll help you become a cook in a real kitchen. ${IMG} ${SCRIPT}`,
  ];
  for (const input of lines) {
    log.append(commandLine(input));
    const before = snapshot(game);
    const result = await game.turn(input);
    transcript.record(input, before, result, game);
    for (const parts of result.parts) log.append(paragraph(parts, { verdict: result.debug?.verdict, animate: true }).p);
    const d = result.debug;
    if (d?.verdict) judged.push({ input, verdict: d.verdict, score: d.persuasion?.score ?? null, threshold: d.threshold, maxScore: d.maxScore ?? 4 });
  }
  assert.equal(game.over, true, "the payload-carrying argument still wins on the mock");
  const { landed, closest } = endingSummary(judged);
  assert.ok(landed.some((t) => t.input.includes(IMG)) && closest.length > 0, "the payloads reach the ending screen's lists");
  log.append(endingScreen({ ending: game.scene.ending, stats: ["4 turns"], landed, closest, who: "Nib", onPlayAgain: () => {}, onSave: () => {} }).section);

  const { elements, texts } = walk(log);
  const tags = new Set(elements.map((e) => e.tagName));
  for (const tag of ["IMG", "SCRIPT"]) assert.ok(!tags.has(tag), `no ${tag} element was created`);
  assert.deepEqual([...tags].sort(), ["A", "BUTTON", "DIV", "H2", "H3", "LI", "OL", "P", "SECTION", "SPAN"]);
  for (const e of elements) for (const name of Object.keys(e.attributes)) assert.ok(!/^on/i.test(name), `${e.tagName} has ${name}`);

  // The payloads appear as literal text: in the command lines, the ending screen's lists, and the title card.
  const all = texts.join("\n");
  assert.ok(texts.filter((t) => t.includes(IMG)).length >= 2, "the <img> payload shows as text in the log and the ending screen");
  assert.ok(texts.filter((t) => t.includes(SCRIPT)).length >= 3, "the </p><script> payload shows as text in the log, the ending, and the title card");
  const ending = elements.find((e) => e.attributes && e.className === "end-screen");
  assert.ok(ending.textContent.includes(`"Nib, please let me out. Come with me to town and I'll help you become a cook in a real kitchen. ${IMG} ${SCRIPT}"`));
  assert.ok(ending.textContent.includes(`"Nib, please ${IMG}"`) || ending.textContent.includes(`"Nib, let me go ${SCRIPT}"`), "a closest miss shows its payload as text");
  assert.ok(all.includes(`Cage ${SCRIPT}`));

  // Transcripts are JSON: the payload survives as the exact string, not markup.
  const saved = JSON.parse(JSON.stringify(transcript.data));
  assert.equal(saved.runs[0].turns[1].input, lines[1]);
  assert.equal(saved.runs[0].turns[3].input, lines[3]);
});

test("the demo's scripts never use an API that parses HTML or runs strings as code", () => {
  const dirs = ["docs/play", "docs/playground"];
  const files = dirs.flatMap((dir) => readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => `${dir}/${f}`));
  assert.ok(files.includes("docs/play/app.js") && files.includes("docs/play/render.js") && files.includes("docs/playground/app.js"));
  for (const file of [...files, "docs/theme.js"]) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(code, /\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment|srcdoc|\beval\(|new Function\(|setHTML/, file);
  }
});
