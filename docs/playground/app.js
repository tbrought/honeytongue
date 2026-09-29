// The character playground's page: the form, the conversation, and the buttons. The logic behind them is in
// designer.js (tested in Node). The library comes from ../play/lib, the same copies the demo uses; when the page
// is served by `npx honeytongue playground`, the server hands out the originals from src/ instead.
import { createMockClient } from "../play/lib/mock.js";
import { createProxyClient } from "../play/lib/jev.js";
import { defineCharacter, DEFAULT_LEVELS } from "../play/lib/persuasion.js";
import {
  FIELDS, TELLS, fieldErrors, minimalCharacter, characterCode, storyJson, readDraft, encodeShare, decodeShare, readPresets,
  tryLine, replay, conversation,
} from "./designer.js";

const $ = (id) => document.getElementById(id);
const STORE = "honeytongue-playground";
const HOSTED = "https://tbrought.github.io/honeytongue/playground/";
const MAX_LINE = 500;

/** Build an element. Text is always set as text, never parsed as HTML. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

// ---- The judge ----------------------------------------------------------------------

// `npx honeytongue playground` fills this in; on GitHub Pages it's empty and lines are judged by the mock.
const local = (() => {
  try { return JSON.parse(document.querySelector('meta[name="honeytongue-local"]')?.content || "null"); }
  catch { return null; }
})();
const client = local ? createProxyClient({ url: local.url, headers: { "X-Honeytongue-Token": local.token } }) : createMockClient();
const costly = local?.judge === "jev"; // the only mode that makes paid calls

if (local) {
  const mode = $("mode");
  mode.replaceChildren(...(costly
    ? [el("strong", {}, "Judging with Jev"), " through your local server, using your TYPESAFE_API_KEY. Each line you try is one API call."]
    : [el("strong", {}, "Offline preview."), " No TYPESAFE_API_KEY is set, so lines are judged by simple keyword matching, a stand-in for Jev that understands far less. Set the key and restart ",
      el("code", {}, "npx honeytongue playground"), " to judge with Jev."]));
  $("footer-local").textContent = costly ? " except to Jev, through the server on your machine" : "";
}

/** A readable message for a failed line, in the words of whichever mode this is. */
function failure(err) {
  if (!local) return err.message;
  if (err.status === 403) return "The playground server has restarted. Reload this page.";
  if (err.status === 502) return "Jev didn't answer. The terminal running npx honeytongue playground says why.";
  if (!err.status && /failed|timed out/.test(err.message)) return "Can't reach the playground server. Is npx honeytongue playground still running?";
  return err.message;
}

// ---- Saved draft ------------------------------------------------------------------------

function saveDraft(draft) {
  try { localStorage.setItem(STORE, JSON.stringify(draft)); } catch { /* not saved this time */ }
}
function savedDraft() {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? readDraft(JSON.parse(raw)) : null;
  } catch { return null; } // blocked, empty, or stale: start from a preset instead
}

// ---- The form -------------------------------------------------------------------------

const form = $("character");
const fieldInput = (field) => form.querySelector(`[data-field="${field}"]`);
let rowIds = 0;

function removeButton(list, what) {
  const button = el("button", { type: "button", className: "key", textContent: "Remove" });
  button.addEventListener("click", () => {
    const row = button.closest("li");
    const next = row.nextElementSibling ?? row.previousElementSibling;
    row.remove();
    changed();
    (next?.querySelector("textarea, input") ?? $(`add-${what}`)).focus();
  });
  return button;
}

function secretRow({ id = "", fact = "" } = {}, known = false) {
  const n = ++rowIds;
  const factInput = el("textarea", { id: `secret-fact-${n}`, rows: 2, value: fact });
  factInput.dataset.k = "fact";
  const idInput = el("input", { type: "text", id: `secret-id-${n}`, value: id, spellcheck: false });
  idInput.dataset.k = "id";
  const knownInput = el("input", { type: "checkbox", checked: known });
  knownInput.dataset.k = "known";
  const remove = removeButton($("secrets"), "secret");
  const row = el("li", {},
    el("label", { className: "vh", htmlFor: factInput.id, textContent: "Secret" }), factInput,
    el("div", { className: "row-foot" },
      el("span", { className: "grow" }, el("label", { htmlFor: idInput.id, textContent: "Id, for learn()" }), idInput),
      el("label", { className: "check" }, knownInput, " Player knows this"),
      remove));
  remove.setAttribute("aria-label", "Remove this secret");
  return row;
}

function reactionRow({ min = "", text = "" } = {}) {
  const n = ++rowIds;
  const textInput = el("textarea", { id: `reaction-text-${n}`, rows: 2, value: text });
  textInput.dataset.k = "text";
  const minInput = el("input", { type: "number", id: `reaction-min-${n}`, value: String(min), step: "0.1", inputMode: "decimal" });
  minInput.dataset.k = "min";
  const remove = removeButton($("reactions"), "reaction");
  remove.setAttribute("aria-label", "Remove this reaction");
  return el("li", {},
    el("label", { className: "vh", htmlFor: textInput.id, textContent: "Reaction" }), textInput,
    el("div", { className: "row-foot" },
      el("span", { className: "min" }, el("label", { htmlFor: minInput.id, textContent: "From score" }), minInput),
      remove));
}

function writeForm({ character: given, knows }) {
  // A threshold that matches a difficulty word (Harry's 3.2 of 4 is "normal") is shown as that word.
  let c = given;
  try {
    const smallest = minimalCharacter(given);
    if (given.threshold !== undefined && smallest.threshold === undefined) {
      c = { ...given, threshold: undefined, difficulty: smallest.difficulty ?? "normal" };
    }
  } catch { /* invalid: shown as it is, with its errors */ }
  for (const field of ["name", "persona", "goal", "repeatReaction"]) fieldInput(field).value = c[field] ?? "";
  fieldInput("difficulty").value = ["easy", "normal", "hard", "very hard"].includes(c.difficulty) ? c.difficulty : "normal";
  for (const field of ["patience", "threshold", "hostileAt"]) {
    fieldInput(field).value = Number.isFinite(c[field]) ? String(c[field]) : "";
  }
  fieldInput("levels").value = (c.levels ?? []).join("\n");
  for (const box of form.querySelectorAll("[data-tell]")) box.checked = (c.offendedBy ?? TELLS).includes(box.dataset.tell);
  $("secrets").replaceChildren(...(c.secrets ?? []).map((s) => secretRow(s, knows.includes(s.id))));
  $("reactions").replaceChildren(...(c.reactions ?? []).map((r) => reactionRow(r)));
  $("advanced").open = [c.threshold, c.levels, c.hostileAt].some((v) => v !== undefined);
}

const number = (input) => (input.value.trim() === "" ? undefined : Number(input.value));

function readForm() {
  const c = {};
  for (const field of ["name", "persona", "goal"]) c[field] = fieldInput(field).value;
  const threshold = number(fieldInput("threshold"));
  if (threshold !== undefined) c.threshold = threshold;
  else c.difficulty = fieldInput("difficulty").value; // a threshold overrides the difficulty
  const patience = number(fieldInput("patience"));
  if (patience !== undefined) c.patience = patience;
  c.offendedBy = [...form.querySelectorAll("[data-tell]")].filter((b) => b.checked).map((b) => b.dataset.tell);
  const knows = [];
  const secrets = [...$("secrets").children].map((row) => {
    const get = (k) => row.querySelector(`[data-k="${k}"]`);
    const secret = { id: get("id").value.trim(), fact: get("fact").value.trim() };
    if (get("known").checked && secret.id) knows.push(secret.id);
    return secret;
  }).filter((s) => s.id || s.fact);
  if (secrets.length) c.secrets = secrets;
  const reactions = [...$("reactions").children].map((row) => {
    const min = row.querySelector('[data-k="min"]').value.trim();
    return { min: min === "" ? 0 : Number(min), text: row.querySelector('[data-k="text"]').value.trim() };
  }).filter((r) => r.text || r.min);
  if (reactions.length) c.reactions = reactions;
  const repeat = fieldInput("repeatReaction").value.trim();
  if (repeat) c.repeatReaction = repeat;
  const levels = fieldInput("levels").value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (levels.length) c.levels = levels;
  const hostileAt = number(fieldInput("hostileAt"));
  if (hostileAt !== undefined) c.hostileAt = hostileAt;
  return { character: c, knows };
}

/** Show defineCharacter()'s messages next to their fields. Returns true when the character is valid. */
function showErrors(errors) {
  for (const field of FIELDS) {
    $(`e-${field}`).textContent = errors[field] ?? "";
    const input = fieldInput(field);
    if (input) input.setAttribute("aria-invalid", errors[field] ? "true" : "false");
  }
  if (["levels", "threshold", "hostileAt"].some((f) => errors[f])) $("advanced").open = true;
  return Object.keys(errors).length === 0;
}

/** Hints that depend on other fields: what the difficulty works out to, and the default rubric. */
function updateHints(character) {
  const custom = character.levels;
  const levels = custom && custom.length >= 2 && custom.length <= 10 ? custom : DEFAULT_LEVELS; // bad levels are flagged already
  const max = levels.length - 1;
  const threshold = (() => {
    try { return defineCharacter({ name: "x", persona: "x", goal: "x", levels, difficulty: fieldInput("difficulty").value }).threshold; }
    catch { return null; }
  })();
  const overridden = character.threshold !== undefined;
  $("h-difficulty").textContent = overridden
    ? "Overridden by the threshold in Advanced settings."
    : threshold === null ? "" : `Convinced at a score of ${threshold} out of ${max}.`;
  fieldInput("difficulty").disabled = overridden;
  fieldInput("threshold").placeholder = threshold === null ? "" : `${threshold} (from difficulty)`;
  fieldInput("levels").placeholder = DEFAULT_LEVELS.join("\n");
}

// ---- The conversation -----------------------------------------------------------------------

let draft = null;         // what the form holds now
let valid = false;
let current = null;       // { key, character, npc } for the conversation on screen
let lines = [];           // [{ said, result }] in this conversation
let previous = [];        // the lines of the conversation before the last change or reset, for Replay
let generation = 0;       // bumped by every fresh conversation, so late answers from an older one are dropped
let busy = false;

const list = $("attempts");
const notice = (text) => { $("notice").textContent = text; };
const fixed = (n) => (Number.isFinite(n) ? n.toFixed(2) : "?");

function meter(score, max, threshold, className = "meter") {
  const m = el("span", { className, ariaHidden: "true" }, el("i"), el("b"));
  m.style.setProperty("--score", `${Math.max(0, Math.min(100, ((score ?? 0) / max) * 100))}%`);
  m.style.setProperty("--mark", `${(threshold / max) * 100}%`);
  return m;
}

function distributionBars(probabilities) {
  const label = probabilities.map((p, i) => `level ${i}: ${Math.round(p * 100)}%`).join(", ");
  const bars = el("span", { className: "dist", role: "img", ariaLabel: `Chance of each level: ${label}` });
  for (const p of probabilities) {
    const bar = el("i");
    bar.style.setProperty("--p", String(Math.max(0, Math.min(1, p))));
    bars.append(bar);
  }
  return bars;
}

function patienceText(result, character) {
  if (character.patience === Infinity) return "patience unlimited";
  return `patience ${result.patienceLeft} of ${character.patience} left`;
}

/** One attempt: the line, its verdict and score, and why. `before` is the same line's result before a change. */
function attemptCard(said, result, character, before) {
  const max = result.maxScore;
  const card = el("li", { className: "attempt" }, el("p", { className: "cmd", textContent: said }));
  const scored = result.score !== null;
  const verdict = el("span", { className: `verdict${result.verdict === "convinced" ? " won" : ""}`, textContent: result.verdict });
  card.append(el("p", { className: "readout" },
    verdict,
    scored && meter(result.score, max, result.threshold),
    scored ? el("span", {}, `${fixed(result.score)} / ${max}, needs ${result.threshold}`) : el("span", {}, "not judged again: a repeat"),
    result.source !== undefined || scored ? el("span", { className: "tag" }, `[${result.source ?? "unknown"}]`) : null));
  if (before) {
    const wasScored = before.score !== null;
    card.append(el("p", { className: "readout was" },
      el("span", {}, "before:"),
      wasScored && meter(before.score, before.maxScore, before.threshold, "meter small"),
      el("span", {}, `${wasScored ? `${fixed(before.score)} / ${before.maxScore}` : "repeat"}, ${before.verdict}`)));
  }
  const tells = result.triggered.length ? `triggered ${result.triggered.join(" and ")}` : "no tells triggered";
  card.append(el("p", { className: "readout" }, el("span", {}, tells), el("span", {}, patienceText(result, character))));
  if (result.level) {
    card.append(el("div", { className: "why" },
      el("p", {}, `Why: level ${result.level.index} of ${max}, the nearest to ${fixed(result.score)}`,
        result.distribution ? " " : "", result.distribution ? distributionBars(result.distribution) : null),
      el("q", { textContent: result.level.text })));
  }
  if (result.reaction) card.append(el("p", { className: "reaction", textContent: result.reaction }));
  if (result.verdict === "convinced") card.append(el("p", { className: "hint", textContent: "Convinced. In a game, the scene would move on here." }));
  else if (result.outOfPatience && !(before?.outOfPatience)) card.append(el("p", { className: "hint", textContent: "Out of patience. In a game, their out-of-patience effect would play here." }));
  return card;
}

function updateStats() {
  if (!current) { $("stats").textContent = "Fix the character's settings to start a conversation."; return; }
  const c = current.character;
  const patience = c.patience === Infinity ? "unlimited" : `${current.npc.patienceLeft} of ${c.patience}`;
  $("stats").replaceChildren("Convinced at ", el("strong", {}, `${c.threshold} / ${c.maxScore}`),
    c.difficulty ? ` (${c.difficulty})` : "", ". Patience: ", el("strong", {}, patience), ".");
}

function updateButtons() {
  $("send").disabled = !valid || busy;
  $("replay").disabled = !valid || busy || previous.length === 0;
  $("replay").textContent = previous.length ? `Replay ${previous.length} line${previous.length === 1 ? "" : "s"}` : "Replay";
  for (const id of ["copy-code", "copy-story"]) $(id).disabled = !valid;
}

/** Start a fresh conversation with the form's character. The old one's lines are kept for Replay. */
function freshConversation() {
  generation++;
  if (lines.length) previous = lines;
  lines = [];
  list.replaceChildren();
  busy = false;
  current = valid ? { key: JSON.stringify(draft), character: defineCharacter(draft.character), npc: conversation(draft.character, draft.knows) } : null;
  updateStats();
  updateButtons();
}

let changeTimer;
/** The form changed: check it, save it, and start over if the character is now different. */
function changed() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(applyForm, 250);
}

function applyForm({ quiet = false } = {}) {
  draft = readForm();
  valid = showErrors(fieldErrors(draft.character));
  updateHints(draft.character);
  saveDraft(draft);
  if (current && valid && current.key === JSON.stringify(draft)) return;
  const had = lines.length;
  freshConversation();
  if (quiet) return;
  if (!valid) notice("The character has a problem, marked in red on the left. Fix it to keep trying lines.");
  else if (had) notice(`You changed the character, so the conversation started fresh. Replay reruns your ${had} line${had === 1 ? "" : "s"} against the new settings.`);
  else notice("");
}

function load(next, message = "") {
  writeForm(next);
  applyForm({ quiet: true });
  previous = [];
  updateButtons();
  notice(message);
}

async function send(text) {
  if (!valid || busy) return;
  const said = text.replace(/\s+/g, " ").trim().slice(0, MAX_LINE);
  if (!said) return;
  const gen = generation;
  const { npc, character } = current;
  busy = true;
  updateButtons();
  const pending = el("li", { className: "attempt" }, el("p", { className: "cmd", textContent: said }), el("p", { className: "readout thinking", textContent: "judging" }));
  list.append(pending);
  pending.scrollIntoView({ block: "nearest" });
  try {
    const result = await tryLine(npc, said, client);
    if (gen !== generation) return;
    lines.push({ said: result.said, result });
    pending.replaceWith(attemptCard(result.said, result, character));
    $("line").value = "";
    updateCount();
  } catch (err) {
    if (gen !== generation) return;
    pending.replaceWith(el("li", { className: "attempt" }, el("p", { className: "cmd", textContent: said }),
      el("p", { className: "error", textContent: `Couldn't judge that line: ${failure(err)}` })));
  } finally {
    if (gen === generation) { busy = false; updateStats(); updateButtons(); }
  }
  list.lastElementChild?.scrollIntoView({ block: "nearest" });
}

async function replayLines() {
  if (!valid || busy || !previous.length) return;
  const old = previous;
  const calls = old.filter((l) => l.result.score !== null).length;
  if (costly && !confirm(`Replay sends ${old.length} line${old.length === 1 ? "" : "s"} to Jev, about ${calls} API call${calls === 1 ? "" : "s"} on your key. Continue?`)) return;
  lines = [];
  freshConversation();
  previous = old;
  const gen = generation;
  const { npc, character } = current;
  busy = true;
  updateButtons();
  notice(`Replaying ${old.length} line${old.length === 1 ? "" : "s"} against the current settings.`);
  try {
    await replay(npc, old.map((l) => l.said), client, (result, i) => {
      if (gen !== generation) throw new Error("stale");
      lines.push({ said: result.said, result });
      list.append(attemptCard(result.said, result, character, old[i].result));
      list.lastElementChild.scrollIntoView({ block: "nearest" });
    });
    notice("Replay done. Under each line is its score from the earlier conversation.");
  } catch (err) {
    if (gen !== generation) return;
    notice(`Replay stopped: ${failure(err)}`);
  } finally {
    if (gen === generation) { busy = false; updateStats(); updateButtons(); }
  }
}

// ---- Copy and share ---------------------------------------------------------------------------

/** Show copied text, and put it on the clipboard if the browser allows. `what` is like "the code". */
async function output(text, what, after = "") {
  const box = $("output");
  box.value = text;
  box.hidden = false;
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch { /* shown below to copy by hand */ }
  $("output-status").textContent = (copied ? `Copied ${what}. It's also below.` : `Couldn't copy automatically. Select ${what} below and copy it.`) + after;
  if (!copied) { box.focus(); box.select(); }
}

$("copy-code").addEventListener("click", () => {
  if (valid) output(characterCode(draft.character, { knows: draft.knows }), "the code");
});
$("copy-story").addEventListener("click", () => {
  if (valid) output(storyJson(draft.character), "the story JSON", " Replace each [TODO: ...] before you use it.");
});
$("copy-link").addEventListener("click", () => {
  try {
    // A link to this machine's server is no use to anyone else, so local links point at the hosted playground.
    const base = local ? HOSTED : location.href.split("#")[0];
    output(base + encodeShare(draft), "the link");
  } catch (err) {
    $("output-status").textContent = err.message;
  }
});
$("clear-saved").addEventListener("click", () => {
  try { localStorage.removeItem(STORE); } catch { /* nothing was saved */ }
  clearTimeout(changeTimer);
  $("output-status").textContent = "Cleared the saved draft. The character on screen stays until you reload, and editing it saves it again.";
});

// ---- Wiring --------------------------------------------------------------------------------------

form.addEventListener("input", changed);
form.addEventListener("change", changed);
form.addEventListener("submit", (e) => e.preventDefault());
$("add-secret").addEventListener("click", () => {
  const row = secretRow({ id: `secret_${$("secrets").children.length + 1}` });
  $("secrets").append(row);
  row.querySelector("textarea").focus();
  changed();
});
$("add-reaction").addEventListener("click", () => {
  const row = reactionRow({ min: 0 });
  $("reactions").append(row);
  row.querySelector('[data-k="text"]').focus();
  changed();
});

const lineInput = $("line");
const updateCount = () => { $("line-count").textContent = `${lineInput.value.length} / ${MAX_LINE}`; };
lineInput.addEventListener("input", updateCount);
lineInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(lineInput.value); }
});
$("try").addEventListener("submit", (e) => { e.preventDefault(); send(lineInput.value); });
$("replay").addEventListener("click", replayLines);
$("reset").addEventListener("click", () => {
  const had = lines.length;
  freshConversation();
  notice(had ? `Started a fresh conversation. Replay reruns your ${had} line${had === 1 ? "" : "s"}.` : "Started a fresh conversation.");
  lineInput.focus();
});

// ---- Start ----------------------------------------------------------------------------------------

const BLANK = { character: { name: "", persona: "", goal: "" }, knows: [] };
let presets = [];
try {
  const response = await fetch("../play/lib/characters.json");
  presets = readPresets(await response.json());
} catch (err) {
  notice(`Couldn't load the preset characters: ${err.message}`);
}
for (const { id, character, note } of [...presets, { id: "blank", character: null }]) {
  const button = el("button", { type: "button", className: "key", textContent: character ? character.name : "Blank" });
  button.addEventListener("click", () => {
    load(character ? { character: structuredClone(character), knows: [] } : structuredClone(BLANK),
      character ? `Loaded ${character.name}. ${note ? `${note} ` : ""}The player doesn't know any secrets yet: tick "Player knows this" to try arguments that use one.` : "Started a blank character.");
    fieldInput("name").focus();
  });
  button.dataset.preset = id;
  $("presets").append(button);
}

/** The character in a share link, if the address has one: { draft, message }. */
function fromLink() {
  try {
    const draft = decodeShare(location.hash);
    if (!draft) return { draft: null, message: "" };
    history.replaceState(null, "", location.pathname + location.search); // later edits aren't what the link holds
    return { draft, message: `Loaded ${draft.character.name || "a shared character"} from the link.` };
  } catch (err) {
    return { draft: null, message: err.message };
  }
}

const link = fromLink();
load(link.draft ?? savedDraft() ?? (presets[0] ? { character: structuredClone(presets[0].character), knows: [] } : structuredClone(BLANK)), link.message);
updateCount();
// A link pasted into a tab that already has the playground open only changes the hash, without reloading.
addEventListener("hashchange", () => {
  const { draft: shared, message } = fromLink();
  if (shared) load(shared, message);
  else if (message) notice(message);
});
