// The playground's logic, kept free of the DOM so Node can import and test it (test/designer.test.js).
// A "draft" is what the form edits and share links carry: { character, knows }, where `character` holds
// only the settings the designer filled in, and `knows` lists the secret ids the player has learned.
import { defineCharacter, persuasionQuestions, DEFAULT_LEVELS, HoneytongueError, Persuadable } from "../play/lib/persuasion.js";
import { SOURCE } from "../play/lib/jev.js";

const DIFFICULTIES = ["easy", "normal", "hard", "very hard"];
const TELLS = ["threats", "insults"];
const isText = (v) => typeof v === "string" && v.trim().length > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Validation ---------------------------------------------------------------

// Fields the form edits, each checked on its own so every problem shows at once, next to its field.
export const FIELDS = ["name", "persona", "goal", "difficulty", "patience", "offendedBy", "secrets", "reactions",
  "repeatReaction", "levels", "threshold", "hostileAt"]; // levels before threshold, which is checked against them
const CHECK_NAME = "__playground_check__";
const BASE = { name: CHECK_NAME, persona: "p", goal: "g" };

/** defineCharacter()'s message without the character's name, which is redundant next to the field. */
const tidy = (message, name) =>
  [CHECK_NAME, name].filter(isText).reduce((m, n) => m.replaceAll(`Character "${n}"`, "Character"), message).replace(/^Character: /, "");

/** { field: message } for every field defineCharacter() rejects, using its own messages. Empty when valid. */
export function fieldErrors(character) {
  const errors = {};
  const check = (field, extra = {}) => {
    try { defineCharacter({ ...BASE, ...extra, [field]: character[field] }); }
    catch (err) { errors[field] = tidy(err.message, character.name); }
  };
  for (const field of FIELDS) {
    // A threshold's limit depends on the levels, so it's checked with them when they're valid.
    check(field, field === "threshold" && !errors.levels ? { levels: character.levels } : {});
  }
  if (Object.keys(errors).length === 0) {
    try { defineCharacter(character); }
    catch (err) {
      const message = tidy(err.message, character.name);
      // A clash between difficulty and threshold belongs to the threshold, the advanced setting that overrides.
      const field = ["threshold", ...FIELDS].find((f) => message.includes(`"${f}"`)) ?? "name";
      errors[field] = message;
    }
  }
  return errors;
}

// ---- The smallest equivalent character ------------------------------------------

/** The difficulty word whose threshold this is, for these levels, if any. */
function wordFor(threshold, levels) {
  return DIFFICULTIES.find((difficulty) => defineCharacter({ ...BASE, levels, difficulty }).threshold === threshold);
}

// Output order, most important first. Anything else defineCharacter accepts goes after, in its own order.
const ORDER = ["name", "persona", "goal", "difficulty", "threshold", "offendedBy", "patience", "secrets", "reactions",
  "repeatReaction", "levels", "hostileAt"];

/**
 * The same character with only the settings that differ from the defaults. A threshold that matches a
 * difficulty word becomes that word ("normal" is left out). Throws HoneytongueError if it isn't valid.
 */
export function minimalCharacter(character) {
  const c = defineCharacter(character);
  const defaults = defineCharacter(BASE);
  const out = { name: c.name.trim(), persona: c.persona.trim(), goal: c.goal.trim() };
  const levels = same(c.levels, DEFAULT_LEVELS) ? undefined : c.levels;
  const word = c.difficulty ?? wordFor(c.threshold, c.levels);
  if (word && word !== "normal") out.difficulty = word;
  if (!word) out.threshold = c.threshold;
  if (!same(c.offendedBy, defaults.offendedBy)) out.offendedBy = c.offendedBy;
  if (c.patience !== Infinity) out.patience = c.patience;
  if (c.secrets.length) out.secrets = c.secrets.map(({ id, fact }) => ({ id, fact }));
  if (c.reactions.length) out.reactions = [...c.reactions].sort((a, b) => a.min - b.min).map(({ min, text }) => ({ min, text }));
  if (c.repeatReaction) out.repeatReaction = c.repeatReaction;
  if (levels) out.levels = levels;
  for (const [key, value] of Object.entries(c)) {
    if (key in out || ["levels", "threshold", "difficulty", "maxScore", "decide"].includes(key)) continue;
    if (!same(value, defaults[key]) && value !== undefined) out[key] = value;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => rank(a) - rank(b)));
}
const rank = (key) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);

// ---- Copy as code -------------------------------------------------------------

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set(("break case catch class const continue debugger default delete do else enum export extends false " +
  "finally for function if import in instanceof let new null return static super switch this throw true try typeof var void " +
  "while with yield await client Persuadable createJevClient").split(" "));

/** A JavaScript literal, on one line when it fits and indented otherwise. */
function literal(value, indent = "") {
  if (Array.isArray(value) || (value && typeof value === "object")) {
    const inner = indent + "  ";
    const entries = Array.isArray(value)
      ? value.map((v) => literal(v, inner))
      : Object.entries(value).map(([k, v]) => `${IDENTIFIER.test(k) ? k : JSON.stringify(k)}: ${literal(v, inner)}`);
    const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{ ", " }"];
    const oneLine = entries.length ? `${open}${entries.join(", ")}${close}` : Array.isArray(value) ? "[]" : "{}";
    // Small records like { id, fact } read best on one line, however long their text.
    const record = !Array.isArray(value) && entries.length <= 3 && Object.values(value).every((v) => v === null || typeof v !== "object");
    if ((record || oneLine.length + indent.length <= 80) && !oneLine.includes("\n")) return oneLine;
    return `${open.trim()}\n${entries.map((e) => `${inner}${e},`).join("\n")}\n${indent}${close.trim()}`;
  }
  return JSON.stringify(value);
}

/** A variable name from the character's first name: "Nib Wortle" -> "nib". */
export function variableName(name) {
  const first = String(name ?? "").trim().split(/\s+/)[0].replace(/[^A-Za-z0-9_$]/g, "");
  const candidate = first.charAt(0).toLowerCase() + first.slice(1);
  return IDENTIFIER.test(candidate) && !RESERVED.has(candidate) ? candidate : "character";
}

/** The character as an object literal, for new Persuadable(...). */
export function characterLiteral(character) {
  return literal(minimalCharacter(character));
}

/** A complete snippet: new Persuadable({...}), plus learn() for the secrets the player knows. */
export function characterCode(character, { knows = [] } = {}) {
  const c = minimalCharacter(character);
  const name = variableName(c.name);
  const ids = new Set((c.secrets ?? []).map((s) => s.id));
  const learned = knows.filter((id) => ids.has(id)).map((id) => `${name}.learn(${JSON.stringify(id)});\n`).join("");
  return 'import { Persuadable, createJevClient } from "honeytongue";\n\n' +
    "// On a server. In a browser, use createProxyClient({ url }) with your proxy instead.\n" +
    "const client = createJevClient();\n\n" +
    `const ${name} = new Persuadable(${literal(c)}, { client });\n` + learned;
}

// ---- Copy as story JSON -------------------------------------------------------

/** Placeholder text for what the playground can't know. Unmistakable if it ever reaches a player. */
export const TODO = {
  hostileReaction: "[TODO: what they say or do when the player offends them]",
  outOfPatience: "[TODO: what happens when they run out of patience]",
  success: "[TODO: what happens when they're convinced]",
};

/** A scene's "npc" block for the text adventure engine, with [TODO: ...] text for the story-only parts. */
export function storyNpc(character, { id } = {}) {
  const { name, persona, patience, secrets, repeatReaction, ...persuasion } = minimalCharacter(character);
  const offendable = !persuasion.offendedBy || persuasion.offendedBy.length > 0;
  return {
    id: id ?? variableName(name),
    name,
    persona,
    ...(patience !== undefined && { patience }),
    ...(secrets && { secrets }),
    ...(offendable && { hostileReaction: TODO.hostileReaction }),
    ...(repeatReaction && { repeatReaction }),
    ...(patience !== undefined && { outOfPatience: { text: TODO.outOfPatience } }),
    persuasion: { ...persuasion, success: { text: TODO.success } },
  };
}

export const storyJson = (character, options) => JSON.stringify(storyNpc(character, options), null, 2);

// ---- Drafts and share links -----------------------------------------------------

const TEXT_FIELDS = ["name", "persona", "goal", "difficulty", "repeatReaction"];
const NUMBER_FIELDS = ["patience", "threshold", "hostileAt", "failCost", "offendedCost", "memory", "repeatSimilarity", "maxInputLength"];
const damaged = (what) => new HoneytongueError(`This character couldn't be loaded: ${what}.`);

/**
 * Check a draft's shape and keep only known fields, so a hand-edited link or stale saved data can't break
 * the form. Values that are the right type but invalid (a patience of -1) are kept, for the form to flag.
 */
export function readDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw damaged("it isn't an object");
  const given = value.character;
  if (!given || typeof given !== "object" || Array.isArray(given)) throw damaged('"character" is missing');
  const character = {};
  for (const f of TEXT_FIELDS) {
    if (given[f] === undefined) continue;
    if (typeof given[f] !== "string") throw damaged(`"${f}" should be text`);
    character[f] = given[f];
  }
  for (const f of NUMBER_FIELDS) {
    if (given[f] === undefined) continue;
    if (typeof given[f] !== "number") throw damaged(`"${f}" should be a number`);
    character[f] = given[f];
  }
  const list = (f, isItem, what) => {
    if (given[f] === undefined) return;
    if (!Array.isArray(given[f]) || !given[f].every(isItem)) throw damaged(`"${f}" should be ${what}`);
    character[f] = given[f].map((item) => (typeof item === "object" ? { ...item } : item));
  };
  list("offendedBy", (t) => typeof t === "string", "a list of tells");
  list("levels", (l) => typeof l === "string", "a list of level descriptions");
  list("secrets", (s) => typeof s?.id === "string" && typeof s?.fact === "string", "a list of { id, fact }");
  list("reactions", (r) => typeof r?.min === "number" && typeof r?.text === "string", "a list of { min, text }");
  if (character.secrets) character.secrets = character.secrets.map(({ id, fact }) => ({ id, fact }));
  if (character.reactions) character.reactions = character.reactions.map(({ min, text }) => ({ min, text }));
  const knows = value.knows ?? [];
  if (!Array.isArray(knows) || !knows.every((k) => typeof k === "string")) throw damaged('"knows" should be a list of secret ids');
  return { character, knows: [...knows] };
}

/** Links longer than this are refused: they get cut off when pasted into chats. */
export const MAX_SHARE_LENGTH = 8000;
const SHARE_KEY = "c=";

const toBase64Url = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64Url = (text) => {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
};

/** The URL hash that opens the playground with this draft, e.g. "#c=eyJ...". */
export function encodeShare(draft) {
  const { character, knows } = readDraft(draft);
  const hash = `#${SHARE_KEY}${toBase64Url(JSON.stringify({ character, ...(knows.length && { knows }) }))}`;
  if (hash.length > MAX_SHARE_LENGTH) {
    throw new HoneytongueError(`This character is too long to share as a link (${hash.length} characters, the limit is ${MAX_SHARE_LENGTH}). Use "Copy as code" instead.`);
  }
  return hash;
}

/** The draft in a URL hash, or null if the hash isn't a share link. Throws HoneytongueError if it's damaged. */
export function decodeShare(hash) {
  const value = String(hash ?? "").replace(/^#/, "");
  if (!value.startsWith(SHARE_KEY)) return null;
  if (value.length > MAX_SHARE_LENGTH) throw damaged("the link is too long");
  let parsed;
  try { parsed = JSON.parse(fromBase64Url(value.slice(SHARE_KEY.length))); }
  catch { throw damaged("the link is incomplete or damaged. Ask for it again, or check it was copied in full"); }
  return readDraft(parsed);
}

// ---- Presets --------------------------------------------------------------------

/** stories/characters.json as a list of { id, character, note }, checking each one. A preset's optional note is for the playground, not the character. */
export function readPresets(json) {
  if (!json || typeof json !== "object") throw new HoneytongueError("The preset characters file isn't an object");
  return Object.entries(json).map(([id, { note, ...character }]) => {
    try { defineCharacter(character); }
    catch (err) { throw new HoneytongueError(`Preset "${id}" is invalid: ${err.message}`); }
    return { id, character: readDraft({ character }).character, ...(typeof note === "string" && note && { note }) };
  });
}

// ---- Trying lines -----------------------------------------------------------------

/** The rubric level a score landed on (the nearest one), quoted in full. */
export function levelFor(score, levels) {
  if (!Number.isFinite(score) || !levels?.length) return null;
  const index = Math.max(0, Math.min(levels.length - 1, Math.round(score)));
  return { index, text: levels[index] };
}

/** Per-level probabilities, weakest first, or null when the judge didn't give any. */
export function distribution(answer, levels) {
  const p = answer?.probabilities;
  if (!p || typeof p !== "object" || Object.keys(p).length === 0) return null;
  return levels.map((_, i) => (Number.isFinite(p[i]) ? p[i] : Number.isFinite(p[String(i)]) ? p[String(i)] : 0));
}

/**
 * Judge one line against a Persuadable, like attempt(), but keep the raw persuasion answer and who gave it.
 * Repeats are handled locally, without a call, just as attempt() does.
 */
export async function tryLine(npc, input, client) {
  const answers = npc.findRepeat(input) ? null : await client.ask(npc.state(input), persuasionQuestions(npc.character));
  const result = npc.record(input, answers);
  const levels = npc.character.levels;
  return {
    ...result,
    said: npc.attempts.at(-1).said,
    threshold: npc.character.threshold,
    source: answers?.[SOURCE],
    level: levelFor(result.score, levels),
    distribution: result.score === null ? null : distribution(answers?.persuasion, levels),
  };
}

/** A fresh conversation with this character, with the given secrets already learned. */
export function conversation(character, knows = []) {
  const npc = new Persuadable(character);
  const ids = new Set(npc.character.secrets.map((s) => s.id));
  for (const id of knows) if (ids.has(id)) npc.learn(id);
  return npc;
}

/** Rerun lines, in order, in a conversation (usually a fresh one). onResult(result, index) fires after each one. */
export async function replay(npc, lines, client, onResult = () => {}) {
  const results = [];
  for (const [i, line] of lines.entries()) {
    const result = await tryLine(npc, line, client);
    results.push(result);
    onResult(result, i);
  }
  return results;
}

export { TELLS, DIFFICULTIES };
