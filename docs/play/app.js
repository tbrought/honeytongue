// The Gatehouse in a browser: the same Game the terminal player uses, with an old-school screen around it.
// The files in ./lib are copies of src/ and stories/, refreshed by `npm run build:demo`,
// because GitHub Pages only serves the docs folder.
import { Game } from "./lib/engine.js";
import { createProxyClient } from "./lib/jev.js";
import { createMockClient } from "./lib/mock.js";

const $ = (id) => document.getElementById(id);
const log = $("log");
const choices = $("choices");
const form = $("prompt");
const input = $("cmd");
const proxyUrl = document.querySelector('meta[name="honeytongue-proxy"]')?.content.trim();
const client = proxyUrl ? createProxyClient({ url: proxyUrl }) : createMockClient();
const finePointer = matchMedia("(pointer: fine)").matches;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

let story;
let game;
let moves = 0;
let debug = false;
let busy = false;
const typed = [];      // command history for the up and down arrows
let typedAt = 0;

/** Build an element. Text is always set as text, never parsed as HTML. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}
const line = (text, className = "") => log.appendChild(el("p", { className }, text));

function meter(score, max, threshold) {
  const m = el("span", { className: "meter", ariaHidden: "true" }, el("i"), el("b"));
  m.style.setProperty("--score", `${Math.max(0, Math.min(100, (score / max) * 100))}%`);
  if (threshold !== undefined) m.style.setProperty("--mark", `${(threshold / max) * 100}%`);
  else m.lastChild.remove();
  return m;
}

// ---- Output ----------------------------------------------------------------------

/** Engine text: paragraphs separated by blank lines. Room descriptions get their room name first. */
function showText(text) {
  for (const paragraph of text.split("\n\n")) {
    const ending = paragraph.match(/^— (.+) —$/);
    if (ending) { line(ending[1], "ending"); continue; }
    if (paragraph === game.scene.description && game.scene.name) line(game.scene.name, "room-name");
    line(paragraph);
  }
}

/** The same view as the terminal player's --debug. */
function showDebug(d, threshold) {
  if (!debug || !d) return;
  const box = el("div", { className: "debug" });
  box.append(el("p", {}, `[jev] action: ${d.ranked.map(([id, p]) => `${id} ${p.toFixed(2)}`).join(" · ")}`));
  if (d.persuasion) {
    const max = d.maxScore ?? 4;
    box.append(el("p", { className: "readout" }, "[jev] persuasion", meter(d.persuasion.score, max, threshold), `${d.persuasion.score.toFixed(2)} / ${max}`));
  }
  if (d.hostile) box.append(el("p", {}, `[jev] hostile: ${d.hostile.noul.toFixed(2)}`));
  log.append(box);
}

function updateStatus() {
  $("room").textContent = game.scene.name ?? story.title;
  $("moves").textContent = String(moves);
  const npc = game.over ? null : game.npc;
  const patience = $("patience");
  patience.hidden = !(npc && Number.isFinite(npc.character.patience));
  if (patience.hidden) return;
  const { patienceLeft } = npc;
  const total = npc.character.patience;
  const pips = el("span", { className: "pips", role: "img", ariaLabel: `${patienceLeft} of ${total}` },
    ...Array.from({ length: total }, (_, i) => el("i", { className: i < patienceLeft ? "on" : "" })));
  patience.replaceChildren(el("span", { className: "label" }, `${npc.character.name.split(" ").pop()}'s patience`), pips);
}

/** Buttons for "Did you mean", and for starting again at the end. */
function updateChoices() {
  const key = (label, say) => el("button", { type: "button", className: "key", onclick: () => submit(say) }, label);
  choices.replaceChildren();
  if (game.over) {
    choices.append(key("Restart", "restart"), el("a", { href: "../", className: "key" }, "Back to the docs"));
  } else if (game.pending) {
    game.pending.options.forEach((id, i) => {
      const action = game.scene.actions[id];
      choices.append(key(el("span", {}, el("b", {}, `${i + 1}) `), action.label ?? action.description), String(i + 1)));
    });
  }
}

function settle(scroll = true) {
  updateStatus();
  updateChoices();
  if (scroll) form.scrollIntoView({ block: "end", behavior: reducedMotion.matches ? "auto" : "smooth" });
  if (finePointer) input.focus({ preventScroll: true });
}

// ---- Input -----------------------------------------------------------------------

function start() {
  game = new Game(story, client);
  moves = 0;
  log.replaceChildren();
  if (story.intro) line(story.intro);
  showText(game.scene.description);
  settle(false);
}

async function submit(raw) {
  if (busy || !game) return;
  const text = String(raw).trim();
  line(text, "cmd");
  if (text && typed[typed.length - 1] !== text) typed.push(text);
  typedAt = typed.length;

  const said = text.toLowerCase();
  if (!text) { line("I beg your pardon?"); return settle(); }
  if (/^(restart|new game)$/.test(said)) return start();
  if (said === "debug") {
    debug = !debug;
    $("debug-key").setAttribute("aria-pressed", String(debug));
    line(`Debug view ${debug ? "on: you'll see what Jev decided each turn" : "off"}.`, "dim");
    return settle();
  }
  if (/^(quit|exit|q)$/.test(said)) { line("There's no quitting in a browser. Type RESTART to begin again, or just close the tab."); return settle(); }

  busy = true;
  input.readOnly = true;
  const thinking = line("Thinking", "dim thinking");
  const threshold = game.npc?.character.threshold;
  try {
    const result = await game.turn(text);
    moves++;
    thinking.remove();
    showDebug(result.debug, threshold);
    showText(result.text);
    if (game.over) line("Type RESTART to play again.", "dim");
  } catch (err) {
    thinking.remove();
    line(`(Something went wrong talking to Jev: ${err.message})`, "error");
  } finally {
    busy = false;
    input.readOnly = false;
    settle();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy) return;
  const text = input.value;
  input.value = "";
  submit(text);
});

// Up and down arrows walk through earlier commands, like a real terminal.
input.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  if (!typed.length) return;
  event.preventDefault();
  typedAt = Math.max(0, Math.min(typed.length, typedAt + (event.key === "ArrowUp" ? -1 : 1)));
  input.value = typed[typedAt] ?? "";
  input.setSelectionRange(input.value.length, input.value.length);
});

for (const button of document.querySelectorAll("[data-say]")) {
  button.addEventListener("click", () => submit(button.dataset.say));
}

// ---- Boot ------------------------------------------------------------------------

const mode = $("mode");
mode.hidden = false;
mode.append(proxyUrl
  ? el("span", {}, el("strong", {}, "Live: "), "Jev judges everything you type, through the Honeytongue proxy.")
  : el("span", {}, el("strong", {}, "Offline preview: "), "a simple keyword matcher stands in for Jev, so it understands far less than the real thing. Plain, direct sentences work best."));

try {
  const res = await fetch("lib/gatehouse.json");
  if (!res.ok) throw new Error(`the story file returned ${res.status}`);
  story = await res.json();
  start();
} catch (err) {
  line(`(The story couldn't be loaded: ${err.message})`, "error");
}
