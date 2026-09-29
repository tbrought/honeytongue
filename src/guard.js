// The proxy's request guard: with allowedStories or allowedCharacters set, createProxyHandler only forwards
// requests that match what Honeytongue itself would send for those stories and characters. The questions must
// be exactly the library's, and every free-form part of the state is capped: the player's words, the previous
// attempts (at the character's memory), and the recent turns (at the engine's history). Anything else could turn
// a public proxy into free access to Jev for any prompt, paid for by the proxy's key.

import { Game, HISTORY, MAX_INPUT, RESULT_LENGTH } from "./engine.js";
import { defineCharacter, persuasionQuestions, persuasionState, HoneytongueError } from "./persuasion.js";
import { VERSION } from "./version.js";

const OUTCOMES = ["convinced", "unconvinced", "offended", "repeated"];
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** JSON with object keys sorted, so two requests compare equal whatever order their keys arrived in. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Every name a story can put in the player's inventory or knowledge. */
function vocabulary(story) {
  const items = new Set(story.player?.inventory ?? []);
  const flags = new Set(story.player?.flags ?? []);
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) {
      for (const i of Array.isArray(v.giveItems) ? v.giveItems : []) items.add(i);
      for (const f of Array.isArray(v.setFlags) ? v.setFlags : []) flags.add(f);
      Object.values(v).forEach(walk);
    }
  };
  walk(story.scenes);
  return { items, flags };
}

/** Problems with an object's keys, if they aren't exactly `keys`. */
function exactKeys(value, keys, where) {
  if (!isObject(value)) return [`${where} must be an object`];
  const extra = Object.keys(value).filter((k) => !keys.includes(k));
  const missing = keys.filter((k) => !Object.hasOwn(value, k));
  return [
    ...(extra.length ? [`${where} has unexpected field(s) ${extra.join(", ")}`] : []),
    ...(missing.length ? [`${where} is missing ${missing.join(", ")}`] : []),
  ];
}

const text = (v, max, where, { empty = true } = {}) =>
  typeof v !== "string" ? [`${where} must be a string`]
    : !empty && !v.trim() ? [`${where} is empty`]
      : v.length > max ? [`${where} is longer than ${max} characters`] : [];

/** The character's part of the state: its description (with learned secrets only), previous attempts, and input. */
function checkCharacterState(state, c) {
  const problems = [];
  // Secrets are sent only once learned, in the character's order: rebuild what the library would send.
  const sent = Array.isArray(state.character?.secrets) ? state.character.secrets : [];
  const learned = c.secrets.filter((s) => sent.some((x) => x?.fact === s.fact)).map((s) => s.id);
  const expected = persuasionState(c, "", { knows: learned }).character;
  if (canonical(state.character) !== canonical(expected)) problems.push(`character isn't ${c.name} as this proxy knows them`);

  const attempts = state.previous_attempts;
  if (!Array.isArray(attempts)) problems.push("previous_attempts must be an array");
  else {
    if (attempts.length > c.memory) problems.push(`previous_attempts has ${attempts.length} entries, more than ${c.name}'s memory of ${c.memory}`);
    attempts.slice(0, c.memory).forEach((a, i) => {
      problems.push(...exactKeys(a, ["said", "outcome"], `previous_attempts[${i}]`));
      if (isObject(a)) {
        problems.push(...text(a.said, c.maxInputLength, `previous_attempts[${i}].said`));
        if (!OUTCOMES.includes(a.outcome)) problems.push(`previous_attempts[${i}].outcome must be one of ${OUTCOMES.join(", ")}`);
      }
    });
  }
  problems.push(...text(state.player_input, c.maxInputLength, "player_input", { empty: false }));
  return problems;
}

/** The engine's part of the state: the scene, the player's items and knowledge, and the recent turns. */
function checkSceneState(state, entry) {
  const keys = ["scene", "player", "recent_turns", "player_input", ...(entry.character ? ["character", "previous_attempts"] : [])];
  const problems = exactKeys(state, keys, "state");
  if (problems.length) return problems;
  if (state.scene !== entry.scene) problems.push("scene isn't this story's description of it");

  problems.push(...exactKeys(state.player, ["inventory", "knows"], "player"));
  for (const [key, known] of [["inventory", entry.items], ["knows", entry.flags]]) {
    const list = state.player?.[key];
    if (!Array.isArray(list)) { problems.push(`player.${key} must be an array`); continue; }
    if (new Set(list).size !== list.length) problems.push(`player.${key} has duplicates`);
    if (list.some((x) => !known.has(x))) problems.push(`player.${key} has names this story doesn't use`);
  }

  const turns = state.recent_turns;
  if (!Array.isArray(turns)) problems.push("recent_turns must be an array");
  else {
    if (turns.length > HISTORY) problems.push(`recent_turns has ${turns.length} entries, more than the engine's ${HISTORY}`);
    turns.slice(0, HISTORY).forEach((t, i) => {
      problems.push(...exactKeys(t, ["player", "result"], `recent_turns[${i}]`));
      if (isObject(t)) {
        problems.push(...text(t.player, MAX_INPUT, `recent_turns[${i}].player`));
        problems.push(...text(t.result, RESULT_LENGTH, `recent_turns[${i}].result`));
      }
    });
  }

  if (entry.character) problems.push(...checkCharacterState(state, entry.character));
  else problems.push(...text(state.player_input, MAX_INPUT, "player_input", { empty: false }));
  return problems;
}

/**
 * A guard for createProxyHandler, or null when neither list is given (the proxy then forwards any well-formed
 * request, as before). `check(body)` returns null for an allowed request, or { reason, error } for a refused one.
 */
export function createRequestGuard({ allowedStories, allowedCharacters } = {}) {
  if (allowedStories === undefined && allowedCharacters === undefined) return null;
  for (const [name, list] of [["allowedStories", allowedStories], ["allowedCharacters", allowedCharacters]]) {
    if (list !== undefined && !Array.isArray(list)) {
      throw new HoneytongueError(`createProxyHandler: ${name} must be an array (of ${name === "allowedStories" ? "story objects" : "characters"})`);
    }
  }

  const byQuestions = new Map(); // canonical questions -> the entries that send them
  const add = (questions, entry) => {
    const key = canonical(questions);
    byQuestions.set(key, [...(byQuestions.get(key) ?? []), entry]);
  };
  for (const story of allowedStories ?? []) {
    const { items, flags } = vocabulary(story);
    for (const r of Game.requests(story)) add(r.questions, { kind: "scene", scene: r.scene, character: r.character, items, flags });
  }
  for (const character of allowedCharacters ?? []) {
    const c = defineCharacter(character);
    add(persuasionQuestions(c), { kind: "character", character: c });
  }

  return {
    check(body) {
      const requestVersion = typeof body?.honeytongue === "string" ? body.honeytongue.slice(0, 40) : null;
      const refuse = (reason, error) => requestVersion === VERSION
        ? { reason, error, proxyVersion: VERSION, requestVersion }
        : {
            // A different version is the likeliest cause of any mismatch, so say that first.
            reason: "version", proxyVersion: VERSION, requestVersion,
            error: `Questions don't match: proxy is ${VERSION}, request is from ${requestVersion ?? "a version that doesn't say (older than 0.1.0-alpha.6)"}. ` +
              "Deploy the proxy with the same Honeytongue version as the page.",
          };

      const entries = byQuestions.get(canonical(body?.questions)) ?? [];
      if (!entries.length) return refuse("not-allowed", "This proxy only judges its own stories and characters, and these questions aren't theirs");
      let problems = [];
      for (const entry of entries) {
        const found = entry.kind === "scene"
          ? checkSceneState(body.state, entry)
          : [...exactKeys(body.state, ["character", "previous_attempts", "player_input"], "state"), ...(isObject(body.state) ? checkCharacterState(body.state, entry.character) : [])];
        if (!found.length) return null;
        if (!problems.length || found.length < problems.length) problems = found;
      }
      return refuse("state", `The state isn't what Honeytongue sends: ${problems.slice(0, 3).join("; ")}`);
    },
  };
}
