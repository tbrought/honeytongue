// The demo scenes in a browser: the same Game the terminal player uses, with an old-school screen around it.
// The files in ./lib are copies of src/ and stories/, refreshed by `npm run build:demo`,
// because GitHub Pages only serves the docs folder. The address's hash picks the scene (#goblin-camp);
// with none, the page lists them.
import { Game } from "./lib/engine.js";
import { createProxyClient } from "./lib/jev.js";
import { createMockClient } from "./lib/mock.js";
import { createTranscript, snapshot } from "./lib/transcript.js";

const $ = (id) => document.getElementById(id);
const log = $("log");
const choices = $("choices");
const form = $("prompt");
const input = $("cmd");
const proxyUrl = document.querySelector('meta[name="honeytongue-proxy"]')?.content.trim();
const client = proxyUrl ? createProxyClient({ url: proxyUrl }) : createMockClient();
const finePointer = matchMedia("(pointer: fine)").matches;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

let scenes = [];       // stories/index.json: id, file, title, hook, minutes
const stories = new Map(); // id -> story, fetched on first play
let scene;
let story;
let game;
let moves = 0;
let debug = false;
// An opt-in playtest transcript for the current scene, saved by the player as a file. Nothing is sent anywhere.
let transcript = null;
let version = null; // lib/version.json, for the transcript
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
  if (!d.ranked.length) { // a repeat is caught locally, so nothing answered it
    box.append(el("p", {}, `[local] ${d.verdict ?? "repeated"}: too close to an earlier attempt, not sent to Jev`));
    log.append(box);
    return;
  }
  const tag = `[${d.source ?? "unknown"}]`; // who answered this turn: jev, mock, or unknown if the proxy didn't say
  box.append(el("p", {}, `${tag} action: ${d.ranked.map(([id, p]) => `${id} ${p.toFixed(2)}`).join(" · ")}`));
  if (d.persuasion) {
    const max = d.maxScore ?? 4;
    box.append(el("p", { className: "readout" }, `${tag} persuasion`, meter(d.persuasion.score, max, threshold), `${d.persuasion.score.toFixed(2)} / ${max}`));
  }
  const tells = ["threats", "insults"].filter((t) => d[t]).map((t) => `${t} ${d[t].noul.toFixed(2)}`);
  if (tells.length) box.append(el("p", {}, `${tag} ${tells.join(" · ")}`));
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
  patience.replaceChildren(el("span", { className: "label" }, `${npc.character.name.split(" ")[0]}'s patience`), pips);
}

/** Buttons for "Did you mean", and for starting again at the end. */
function updateChoices() {
  const key = (label, say) => el("button", { type: "button", className: "key", onclick: () => submit(say) }, label);
  choices.replaceChildren();
  if (game.over) {
    choices.append(key("Restart", "restart"), el("a", { href: "#", className: "key" }, "Choose another scene"),
      el("a", { href: "../", className: "key" }, "Back to the docs"));
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
  if ($("record").checked) {
    // One transcript per scene; a restart adds another playthrough to it.
    if (transcript?.data.scene !== scene.id) transcript = createTranscript({ version, scene: scene.id, story });
    transcript.start();
    line("Recording this playtest. Nothing is sent anywhere: use Save transcript to download it.", "dim");
  }
  settle(false);
}

$("record").addEventListener("change", () => {
  const on = $("record").checked;
  $("save-transcript").hidden = !on;
  if (!on) { transcript = null; line("Stopped recording. The transcript so far is discarded.", "dim"); return settle(); }
  if (!game) return;
  transcript = createTranscript({ version, scene: scene.id, story });
  transcript.start();
  line("Recording this playtest from here. Nothing is sent anywhere: use Save transcript to download it.", "dim");
  settle();
});

$("save-transcript").addEventListener("click", () => {
  if (!transcript) return;
  const file = new Blob([JSON.stringify(transcript.data, null, 2) + "\n"], { type: "application/json" });
  const link = el("a", { href: URL.createObjectURL(file), download: `honeytongue-${transcript.data.scene}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

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
    line(`Debug view ${debug ? "on: you'll see how each turn was judged" : "off"}.`, "dim");
    return settle();
  }
  if (/^(quit|exit|q)$/.test(said)) { line("There's no quitting in a browser. Type RESTART to begin again, or just close the tab."); return settle(); }

  busy = true;
  input.readOnly = true;
  const thinking = line("Thinking", "dim thinking");
  const threshold = game.npc?.character.threshold;
  const playing = game;
  try {
    const before = snapshot(game);
    const result = await game.turn(text);
    if (game !== playing) return; // the player switched scenes while this turn was out
    transcript?.record(text, before, result, game);
    moves++;
    thinking.remove();
    showMode(result.debug?.source);
    showDebug(result.debug, threshold);
    showText(result.text);
    if (game.over) line("Type RESTART to play again.", "dim");
  } catch (err) {
    thinking.remove();
    line(`(Something went wrong talking to Jev: ${err.message})`, "error");
  } finally {
    if (game === playing) {
      busy = false;
      input.readOnly = false;
      settle();
    }
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

/** The banner above the game: live Jev, or the offline mock (directly, or behind a local proxy). */
let shownSource;
function showMode(source) {
  if (!source || source === shownSource) return;
  shownSource = source;
  const mode = $("mode");
  mode.hidden = false;
  mode.replaceChildren(source === "jev"
    ? el("span", {}, el("strong", {}, "Live: "), "Jev judges everything you type, through the Honeytongue proxy.")
    : el("span", {}, el("strong", {}, "Offline preview. "), "Characters here are judged by simple keyword matching, a stand-in for Jev that understands far less. Plain, direct sentences work best."));
}
showMode(proxyUrl ? "jev" : "mock");

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

/** Show the scene list, or play the scene the hash names. */
async function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  const chosen = scenes.find((s) => s.id === id);
  $("picker").hidden = Boolean(chosen);
  $("play").hidden = !chosen;
  document.querySelector(".moves").hidden = !chosen;
  busy = false;
  input.readOnly = false;
  if (!chosen) {
    scene = story = game = null;
    $("title").textContent = "Demo Scenes";
    $("room").textContent = "Demo scenes";
    $("patience").hidden = true;
    document.title = "Honeytongue Demo Scenes";
    if (id) history.replaceState(null, "", location.pathname + location.search); // an unknown scene: just list them
    return;
  }
  scene = chosen;
  $("title").textContent = scene.title;
  document.title = `${scene.title} · Honeytongue`;
  try {
    if (!stories.has(scene.id)) stories.set(scene.id, await fetchJson(`lib/${scene.file}`));
    if (scene !== chosen) return; // another scene was picked while this one loaded
    story = stories.get(scene.id);
    start();
  } catch (err) {
    log.replaceChildren();
    line(`(The story couldn't be loaded: ${err.message})`, "error");
  }
}

/** A link per scene: title, hook, and roughly how long it takes. */
function showScenes() {
  $("scenes").replaceChildren(...scenes.map((s) => el("li", {},
    el("a", { className: "scene", href: `#${s.id}` },
      el("b", {}, s.title), el("span", {}, s.hook), el("span", { className: "dim" }, `About ${s.minutes} minutes`)))));
}

addEventListener("hashchange", async () => {
  await route();
  // Keyboard and screen reader users land at the top of what just appeared.
  if (!game || !finePointer) $("title").focus({ preventScroll: true });
  scrollTo(0, 0);
});

try {
  version = (await fetchJson("lib/version.json")).version;
} catch {
  version = null; // transcripts still work without it
}
try {
  scenes = await fetchJson("lib/index.json");
  showScenes();
  await route();
} catch (err) {
  $("play").hidden = false;
  line(`(The scenes couldn't be loaded: ${err.message})`, "error");
}
