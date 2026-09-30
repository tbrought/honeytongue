// The demo scenes in a browser: the same Game the terminal player uses, with an old-school screen around it.
// Its look (colours for each kind of part, typed text, title cards, the ending screen) is one example of styling
// Honeytongue's result.parts; the library only says what each part means.
// The files in ./lib are copies of src/ and stories/, refreshed by `npm run build:demo`,
// because GitHub Pages only serves the docs folder. The address's hash picks the scene (#goblin-camp);
// with none, the page lists them.
import { Game } from "./lib/engine.js";
import { defineCharacter } from "./lib/persuasion.js";
import { createProxyClient } from "./lib/jev.js";
import { createMockClient } from "./lib/mock.js";
import { createTranscript, snapshot } from "./lib/transcript.js";
import { VERSION } from "./lib/version.js";
import { parseMarkup, stripMarkup } from "./lib/markup.js";
import { createFallbackClient, chooseJudge, fallbackNote, banner, TURN_CAP } from "./fallback.js";
import { typingSpeed, endingSummary, difficultyTag } from "./present.js";
import { makeRenderer } from "./render.js";

const $ = (id) => document.getElementById(id);
const log = $("log");
const choices = $("choices");
const form = $("prompt");
const input = $("cmd");
const PICKER_TITLE = document.title; // the page's own <title>, shown again when back at the scene list
// The live proxy, unless the page is being previewed locally, which the proxy would refuse (see chooseJudge).
const { judge, url: proxyUrl } = chooseJudge({
  proxyUrl: document.querySelector('meta[name="honeytongue-proxy"]')?.content,
  hostname: location.hostname,
  search: location.search,
});
let tabStorage = null; // for the live turn count; reading sessionStorage can throw when storage is blocked
try { tabStorage = sessionStorage; } catch { /* the count then lasts as long as the page */ }
let fallback = null;  // why the mock is judging instead of Jev, when there's a proxy: { mode, why, err }
let note = null;      // a line about that, shown with the next reply
// With a proxy, Jev judges and the mock stands in when it can't (see fallback.js). No retries here: a failed
// turn goes to the mock straight away, and the proxy already retries Jev itself.
const client = proxyUrl
  ? createFallbackClient({
      live: createProxyClient({ url: proxyUrl, maxRetries: 0, timeoutMs: 15_000 }),
      mock: createMockClient(),
      storage: tabStorage,
      onChange: (change) => { fallback = change.mode === "live" ? null : change; note = fallbackNote(change, VERSION); },
    })
  : createMockClient();
const finePointer = matchMedia("(pointer: fine)").matches;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

let scenes = [];       // stories/index.json: id, file, title, hook, minutes
let presets = {};      // stories/characters.json: each scene's character, for its difficulty tag
const stories = new Map(); // id -> story, fetched on first play
let scene;
let story;
let game;
let moves = 0;
let debug = false;
// An opt-in playtest transcript for the current scene, saved by the player as a file. Nothing is sent anywhere.
let transcript = null;
let busy = false;
const typed = [];      // command history for the up and down arrows
let typedAt = 0;
let judged = [];       // this playthrough's judged turns, for the ending screen
let lastNpc = null;    // the character the player last spoke to, for the ending screen's patience
let lastScore = 0;     // the debug meter's last reading (%), so the next one moves from there

/** Display settings, per browser. Storage can be blocked, so reads and writes are guarded. */
const setting = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const saveSetting = (key, value) => { try { localStorage.setItem(key, value); } catch { /* kept for this page only */ } };
let typedText = setting("honeytongue-typed-text", "on") === "on";
let crt = setting("honeytongue-crt", "off") === "on";

// Every element is built by render.js, which only ever sets text as text, never as HTML.
const { el, paragraph, titleCard, commandLine, endingScreen, bannerNode } = makeRenderer(document);
const line = (text, className = "") => log.appendChild(el("p", { className }, text));

function meter(score, max, threshold) {
  const m = el("span", { className: "meter", ariaHidden: "true" }, el("i"), el("b"));
  // Start at the last reading and move to this one, so a change is easy to see (instant under reduced motion).
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  m.style.setProperty("--score", `${lastScore}%`);
  requestAnimationFrame(() => requestAnimationFrame(() => m.style.setProperty("--score", `${pct}%`)));
  lastScore = pct;
  if (threshold !== undefined) m.style.setProperty("--mark", `${(threshold / max) * 100}%`);
  else m.lastChild.remove();
  return m;
}

// ---- Output ----------------------------------------------------------------------

// ---- Typed text: never in the way. A click, any key, or a new command shows the rest at once. ----
let typing = null;
function skipTyping() { typing?.finish(); }
const nearBottom = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 120;

function typeOut(bodies) {
  const nodes = [];
  for (const body of bodies) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push([walker.currentNode, walker.currentNode.data]);
  }
  const total = nodes.reduce((n, [, t]) => n + t.length, 0);
  const cps = typingSpeed(total, { typed: typedText, reducedMotion: reducedMotion.matches });
  if (!cps) return;
  skipTyping();
  for (const [node] of nodes) node.data = "";
  const follow = nearBottom();
  const job = { finish() { for (const [node, text] of nodes) node.data = text; if (typing === job) typing = null; if (follow) form.scrollIntoView({ block: "end" }); } };
  typing = job;
  const started = performance.now();
  const frame = (now) => {
    if (typing !== job) return;
    let left = Math.floor(((now - started) / 1000) * cps);
    if (left >= total) return job.finish();
    for (const [node, text] of nodes) { node.data = text.slice(0, Math.max(0, left)); left -= text.length; }
    if (follow) form.scrollIntoView({ block: "end" });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
addEventListener("keydown", (event) => { if (typing && !event.ctrlKey && !event.metaKey && !event.altKey) skipTyping(); }, true);
addEventListener("pointerdown", () => skipTyping(), true);

/**
 * A turn's reply from result.parts: the verdict label on its first paragraph, a title card before a new named
 * scene, the engine's own lines in the system style, and the ending left to the ending screen.
 */
function showReply(result, { verdict, entered } = {}) {
  const shown = (result.parts ?? []).filter((parts) => !(parts.length === 1 && parts[0].kind === "ending"));
  const animate = typingSpeed(result.text.length, { typed: typedText, reducedMotion: reducedMotion.matches }) > 0;
  const block = el("div", { className: verdict ? `reply v-${verdict}` : "reply" });
  const bodies = [];
  shown.forEach((parts, i) => {
    if (entered?.name && parts.map((x) => x.text).join("") === stripMarkup(entered.description)) block.append(titleCard(entered.name));
    const system = parts.every((x) => x.kind === "system");
    const { p, body } = paragraph(parts, { verdict: i === 0 ? verdict : null, animate, className: system ? "system" : "" });
    block.append(p);
    bodies.push(body);
  });
  if (!block.childElementCount) return;
  log.append(block);
  if (animate) typeOut(bodies);
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
  let pips = patience.querySelector(".pips");
  if (!pips || pips.childElementCount !== total || patience.dataset.npc !== npc.character.name) {
    pips = el("span", { className: "pips", role: "img" }, ...Array.from({ length: total }, () => el("i")));
    patience.replaceChildren(el("span", { className: "label" }, `${npc.character.name.split(" ")[0]}'s patience`), pips);
    patience.dataset.npc = npc.character.name;
  }
  pips.setAttribute("aria-label", `${patienceLeft} of ${total}`);
  [...pips.children].forEach((pip, i) => {
    const on = i < patienceLeft;
    if (pip.classList.contains("on") && !on) {
      pip.classList.add("lost");
      pip.addEventListener("animationend", () => pip.classList.remove("lost"), { once: true });
    }
    pip.classList.toggle("on", on);
  });
}

/** Buttons for "Did you mean", and for starting again at the end. */
function updateChoices() {
  const key = (label, say) => el("button", { type: "button", className: "key", onclick: () => submit(say) }, label);
  choices.replaceChildren();
  if (!game.over && game.pending) {
    game.pending.options.forEach((id, i) => {
      const action = game.scene.actions[id];
      choices.append(key(el("span", {}, el("b", {}, `${i + 1}) `), stripMarkup(action.label ?? action.description)), String(i + 1)));
    });
  }
}

function settle(scroll = true) {
  updateStatus();
  updateChoices();
  $("prompt").hidden = game.over;
  if (game.over) return;
  if (scroll) form.scrollIntoView({ block: "end", behavior: reducedMotion.matches ? "auto" : "smooth" });
  if (finePointer) input.focus({ preventScroll: true });
}

/** The ending screen: the ending, the turns taken, the arguments that landed and the closest misses, and what next. */
function showEnding() {
  const { attempts, landed, closest } = endingSummary(judged);
  const who = lastNpc?.character.name.split(" ")[0];
  const stats = [`${moves} ${moves === 1 ? "turn" : "turns"}`, `${attempts} ${attempts === 1 ? "attempt" : "attempts"}`];
  if (lastNpc && Number.isFinite(lastNpc.character.patience)) stats.push(`${who}'s patience ${lastNpc.patienceLeft} of ${lastNpc.character.patience} left`);
  const { section, again } = endingScreen({
    ending: game.scene.ending, stats, landed, closest, who,
    onPlayAgain: () => start(),
    onSave: transcript ? () => $("save-transcript").click() : null,
  });
  log.append(section);
  section.scrollIntoView({ block: "start", behavior: reducedMotion.matches ? "auto" : "smooth" });
  again.focus({ preventScroll: true });
}

// ---- Input -----------------------------------------------------------------------

function start() {
  skipTyping();
  game = new Game(story, client);
  moves = 0;
  judged = [];
  lastNpc = null;
  lastScore = 0;
  log.replaceChildren();
  // The opening shows at once: only replies type out.
  if (story.intro) log.append(paragraph(parseMarkup(story.intro)).p);
  if (game.scene.name) log.append(titleCard(game.scene.name));
  log.append(paragraph(parseMarkup(game.scene.description)).p);
  if ($("record").checked) {
    // One transcript per scene; a restart adds another playthrough to it.
    if (transcript?.data.scene !== scene.id) transcript = createTranscript({ version: VERSION, scene: scene.id, story });
    transcript.start();
    line("Recording this playtest. Nothing is sent anywhere: use Save transcript to download it.", "dim");
  }
  settle(false);
}

$("record").addEventListener("change", () => {
  const on = $("record").checked;
  $("save-transcript").hidden = !on;
  $("share").hidden = !on;
  if (!on) { transcript = null; line("Stopped recording. The transcript so far is discarded.", "dim"); return settle(); }
  if (!game) return;
  transcript = createTranscript({ version: VERSION, scene: scene.id, story });
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
  skipTyping();
  if (busy || !game) return;
  const text = String(raw).trim();
  log.append(commandLine(text));
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
  const npcBefore = game.npc;
  const sceneBefore = game.sceneId;
  try {
    const before = snapshot(game);
    const result = await game.turn(text);
    if (game !== playing) return; // the player switched scenes while this turn was out
    transcript?.record(text, before, result, game);
    moves++;
    thinking.remove();
    const d = result.debug; // diagnostics, for the debug view only
    const a = result.attempt; // how the scene's character judged the turn (stable), or null
    if (a) {
      judged.push({ input: text, verdict: a.verdict, score: a.score, threshold: a.threshold, maxScore: a.maxScore });
      lastNpc = npcBefore;
    }
    showNote();
    showMode(d?.source);
    showDebug(d, threshold);
    const entered = game.sceneId !== sceneBefore && !game.scene.ending ? game.scene : null;
    showReply(result, { verdict: a?.verdict ?? null, entered });
    if (game.over) showEnding();
  } catch (err) {
    thinking.remove();
    showNote();
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

// ---- Settings: typed text (on by default, always instant under reduced motion) and CRT mode (off by default) ----
function showSettings() {
  $("typed-key").textContent = `Typed text: ${typedText ? "on" : "off"}`;
  $("typed-key").setAttribute("aria-pressed", String(typedText));
  $("crt-key").textContent = `CRT: ${crt ? "on" : "off"}`;
  $("crt-key").setAttribute("aria-pressed", String(crt));
  document.body.classList.toggle("crt", crt);
}
$("typed-key").addEventListener("click", () => {
  typedText = !typedText;
  saveSetting("honeytongue-typed-text", typedText ? "on" : "off");
  if (!typedText) skipTyping();
  showSettings();
});
$("crt-key").addEventListener("click", () => {
  crt = !crt;
  saveSetting("honeytongue-crt", crt ? "on" : "off");
  showSettings();
});
showSettings();

// ---- Boot ------------------------------------------------------------------------

function showNote() {
  if (note) line(note, "dim");
  note = null;
}

/** The banner above the game: who's judging, and the privacy note while it's Jev. */
let shown;
function showMode(source) {
  const key = `${source}:${fallback?.why ?? ""}`;
  if (!source || key === shown) return;
  shown = key;
  $("mode").hidden = false;
  $("mode").replaceChildren(bannerNode(banner({ source, fallback, judge, proxyUrl })));
}
if (proxyUrl && client.turnsUsed >= TURN_CAP) fallback = { mode: "off", why: "cap" }; // used up before a reload
showMode(proxyUrl && !fallback ? "jev" : "mock");

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
    document.title = PICKER_TITLE;
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

/** A link per scene: title, difficulty (from its character's own settings), hook, and roughly how long it takes. */
function showScenes() {
  $("scenes").replaceChildren(...scenes.map((s) => {
    let tag = null;
    try { tag = difficultyTag(defineCharacter(presets[s.character]).difficulty); } catch { /* no tag without a character */ }
    const title = tag
      ? el("b", {}, s.title, " ", el("span", { className: tag.className }, el("span", { className: "vh" }, "Difficulty: "), tag.label))
      : el("b", {}, s.title);
    return el("li", {}, el("a", { className: "scene", href: `#${s.id}` },
      title, el("span", {}, s.hook), el("span", { className: "dim" }, `About ${s.minutes} minutes`)));
  }));
}

addEventListener("hashchange", async () => {
  await route();
  // Keyboard and screen reader users land at the top of what just appeared.
  if (!game || !finePointer) $("title").focus({ preventScroll: true });
  scrollTo(0, 0);
});

try {
  scenes = await fetchJson("lib/index.json");
  presets = await fetchJson("lib/characters.json").catch(() => ({})); // without them, the list just has no tags
  showScenes();
  await route();
} catch (err) {
  $("play").hidden = false;
  line(`(The scenes couldn't be loaded: ${err.message})`, "error");
}
