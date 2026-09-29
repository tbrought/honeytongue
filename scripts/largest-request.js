// The largest requests a guarded proxy accepts for some stories and characters: every field a player (or a script)
// controls filled to the limit the library itself sends, with `text(length, field)` supplying the filler. Used by
// test/demo-worker.test.js (the demo Worker's byte limit) and scripts/headroom.js (tokens against a normal turn).
import { Game, defineCharacter, persuasionQuestions, persuasionState, VERSION } from "../src/index.js";
import { stripMarkupDeep } from "../src/markup.js";
import { HISTORY, MAX_INPUT, RESULT_LENGTH, TURN_INPUT_LENGTH } from "../src/engine.js";

/** Every item and flag name a story can put in the player's state. */
function vocabulary(story) {
  const items = new Set(story.player?.inventory ?? []), flags = new Set(story.player?.flags ?? []);
  JSON.stringify(story, (k, v) => { if (k === "giveItems") v.forEach((i) => items.add(i)); if (k === "setFlags") v.forEach((f) => flags.add(f)); return v; });
  return { items: [...items], flags: [...flags] };
}

/** Previous attempts at the character's limits: `memory` of them, sharing `memoryLength` characters. */
const attemptsFor = (c, text) => Array.from({ length: c.memory }, () => ({ said: text(Math.floor(c.memoryLength / c.memory), "attempt"), outcome: "unconvinced" }));

/**
 * One request per playable scene and per character, each { label, body } where body is what the proxy client sends.
 * `text(n, field)` returns n UTF-16 code units of filler; field is "input", "attempt", "turn", or "reply".
 */
export function largestRequests({ stories = [], characters = [], text }) {
  const requests = [];
  for (const story of stories) {
    const { items, flags } = vocabulary(story);
    for (const r of Game.requests(story)) {
      const c = r.character;
      const state = {
        scene: r.scene,
        player: { inventory: items, knows: flags },
        recent_turns: Array.from({ length: HISTORY }, () => ({ player: text(story.recentTurnLength ?? TURN_INPUT_LENGTH, "turn"), result: text(RESULT_LENGTH, "reply") })),
        ...(c && { ...persuasionState(c, "", { knows: c.secrets.map((s) => s.id) }), previous_attempts: attemptsFor(c, text) }),
        player_input: text(c?.maxInputLength ?? MAX_INPUT, "input"),
      };
      requests.push({ label: `${story.title}: ${r.scene.slice(0, 40)}`, body: { ...stripMarkupDeep({ state, questions: r.questions }), honeytongue: VERSION } });
    }
  }
  for (const ch of characters) {
    const c = defineCharacter(ch);
    const state = { ...persuasionState(c, "", { knows: c.secrets.map((s) => s.id) }), previous_attempts: attemptsFor(c, text), player_input: text(c.maxInputLength, "input") };
    requests.push({ label: c.name, body: { state, questions: persuasionQuestions(c), honeytongue: VERSION } });
  }
  return requests;
}

/** The request's size in bytes, as sent. */
export const bytesOf = (body) => new TextEncoder().encode(JSON.stringify(body)).length;

/** The largest of them, in bytes. */
export const largestRequest = (options) => largestRequests(options).reduce((a, b) => (bytesOf(b.body) > bytesOf(a.body) ? b : a));
