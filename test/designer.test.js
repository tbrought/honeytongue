import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fieldErrors, minimalCharacter, characterCode, characterLiteral, variableName, storyNpc, storyJson, TODO,
  readDraft, encodeShare, decodeShare, MAX_SHARE_LENGTH, readPresets, levelFor, distribution, tryLine, replay, conversation,
  VERDICT_LABELS, spokenLabel, replyParts, linesToText, textToLines,
} from "../docs/playground/designer.js";
import * as present from "../docs/play/present.js";
// The playground runs on the copies in docs/play/lib, so it's checked against those (demo.test.js keeps them current).
import { defineCharacter, HoneytongueError, DEFAULT_LEVELS } from "../docs/play/lib/persuasion.js";
import { validateStory } from "../docs/play/lib/engine.js";
import { createMockClient } from "../docs/play/lib/mock.js";
import { SOURCE } from "../docs/play/lib/jev.js";

const presets = readPresets(JSON.parse(readFileSync(new URL("../stories/characters.json", import.meta.url), "utf8")));
const preset = (id) => presets.find((p) => p.id === id).character;
const simple = { name: "Tess", persona: "A kind baker.", goal: "Share the recipe" };

/** Run a generated snippet with stand-ins for its import, and return the Persuadable it makes. */
function runSnippet(code, character) {
  const body = code.replace(/^import .*\n/, "") + `\nreturn ${variableName(character.name)};`;
  class Persuadable {
    constructor(c, { client }) { this.character = defineCharacter(c); this.client = client; this.knows = new Set(); }
    learn(id) { this.knows.add(id); }
  }
  return new Function("Persuadable", "createJevClient", body)(Persuadable, () => "client");
}

test("a preset's note is shown by the playground, and isn't part of the character", () => {
  const cobb = presets.find((p) => p.id === "cobb");
  assert.match(cobb.note, /tougher on his own/);
  assert.equal("note" in cobb.character, false);
  assert.equal(presets.find((p) => p.id === "harry").note, undefined);
  assert.throws(() => readPresets({ x: { note: "hi" } }), /Preset "x" is invalid/);
});

// The same character once defined. "normal" is the default difficulty, so saying it or not is the same.
const settled = (character) => {
  const { difficulty, ...rest } = defineCharacter(character);
  return difficulty === undefined || difficulty === "normal" ? rest : { difficulty, ...rest };
};

test("generated code round-trips through defineCharacter()", () => {
  for (const { id, character } of presets) {
    const made = runSnippet(characterCode(character), character);
    assert.deepEqual(settled(made.character), settled(character), `preset "${id}"`);
    assert.equal(made.client, "client");
  }
  const literal = new Function(`return ${characterLiteral(simple)}`)();
  assert.deepEqual(defineCharacter(literal), defineCharacter(simple));
});

test("generated code learns the secrets the player knows", () => {
  const nib = preset("nib");
  const made = runSnippet(characterCode(nib, { knows: ["wants_to_be_a_cook", "not_a_secret"] }), nib);
  assert.deepEqual([...made.knows], ["wants_to_be_a_cook"]);
});

test("generated code only includes settings that differ from the defaults", () => {
  assert.deepEqual(minimalCharacter({ ...simple, difficulty: "normal", patience: Infinity, offendedBy: ["insults", "threats"],
    levels: DEFAULT_LEVELS, hostileAt: 0.7, secrets: [], reactions: [] }), simple);
  assert.doesNotMatch(characterCode(simple), /difficulty|threshold|patience|levels|offendedBy/);
});

test("generated code keeps the difficulty word, not a threshold", () => {
  assert.deepEqual(minimalCharacter({ ...simple, difficulty: " Very-Hard " }).difficulty, "very hard");
  assert.equal(minimalCharacter({ ...simple, difficulty: "hard" }).threshold, undefined);
  // A threshold that matches a word becomes the word; 3.2 of 4 is "normal", the default.
  assert.equal(minimalCharacter({ ...simple, threshold: 3.6 }).difficulty, "hard");
  assert.equal(minimalCharacter({ ...simple, threshold: 3.6 }).threshold, undefined);
  assert.deepEqual(Object.keys(minimalCharacter(preset("harry"))).includes("threshold"), false);
  // Any other threshold stays a number.
  assert.equal(minimalCharacter({ ...simple, threshold: 3 }).threshold, 3);
  assert.equal(minimalCharacter({ ...simple, threshold: 3 }).difficulty, undefined);
});

test("variable names come from the first name and stay valid", () => {
  assert.equal(variableName("Nib Wortle"), "nib");
  assert.equal(variableName("  Maude Keelhaven"), "maude");
  assert.equal(variableName("Class"), "character", "reserved words aren't used");
  assert.equal(variableName("9 Lives"), "character");
  assert.equal(variableName("Élodie"), "lodie");
  assert.equal(variableName(""), "character");
});

test("story JSON is a valid npc block, with unmistakable placeholders", () => {
  for (const { id, character } of presets) {
    const npc = JSON.parse(storyJson(character, { id }));
    const story = {
      title: "Test", start: "room",
      scenes: {
        room: { description: "A room.", npc, actions: { talk: { description: "Persuade them", persuade: true } } },
      },
    };
    assert.doesNotThrow(() => validateStory(story), `preset "${id}"`);
    assert.equal(npc.persuasion.success.text, TODO.success);
    assert.match(npc.persuasion.success.text, /^\[TODO: .+\]$/);
    // Everything the playground knows carries over unchanged.
    const { success, ...persuasion } = npc.persuasion;
    const back = { name: npc.name, persona: npc.persona, patience: npc.patience, secrets: npc.secrets, repeatReaction: npc.repeatReaction, ...persuasion };
    assert.deepEqual(settled(back), settled(character), `preset "${id}"`);
  }
});

test("story JSON leaves out placeholders the character doesn't need", () => {
  const npc = storyNpc({ ...simple, offendedBy: [] });
  assert.equal(npc.hostileReaction, undefined);
  assert.equal(npc.outOfPatience, undefined);
  assert.equal(npc.id, "tess");
  assert.equal(storyNpc(preset("cobb")).outOfPatience.text, TODO.outOfPatience);
  assert.equal(storyNpc(preset("cobb")).hostileReaction, TODO.hostileReaction);
});

test("share links round-trip, including text outside ASCII", () => {
  for (const { character } of presets) {
    const draft = { character, knows: character.secrets.map((s) => s.id) };
    assert.deepEqual(decodeShare(encodeShare(draft)), draft);
  }
  const draft = { character: { ...simple, name: "Zoë 🍞", persona: "Bäckerin, 面包师" }, knows: [] };
  const hash = encodeShare(draft);
  assert.match(hash, /^#c=[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeShare(hash), draft);
  // Invalid values still travel, so the form can show what's wrong with them.
  const broken = { character: { ...simple, patience: -1 }, knows: [] };
  assert.deepEqual(decodeShare(encodeShare(broken)), broken);
});

test("damaged or unrelated hashes give readable errors, or nothing", () => {
  assert.equal(decodeShare(""), null);
  assert.equal(decodeShare("#section-2"), null);
  assert.throws(() => decodeShare("#c=not!base64"), (e) => e instanceof HoneytongueError && /damaged/.test(e.message));
  assert.throws(() => decodeShare("#c=" + btoa('{"character":{"patience":"lots"}}')), /"patience" should be a number/);
  assert.throws(() => decodeShare("#c=" + btoa("[1,2]")), /isn't an object/);
  assert.throws(() => decodeShare("#c=" + "A".repeat(MAX_SHARE_LENGTH)), /too long/);
  assert.throws(() => encodeShare({ character: { ...simple, persona: "x".repeat(MAX_SHARE_LENGTH) } }), /too long to share.*Copy as code/);
});

test("drafts keep only known fields", () => {
  const draft = readDraft({ character: { ...simple, decide: "x", secrets: [{ id: "a", fact: "b", extra: 1 }] }, knows: ["a"], other: 1 });
  assert.deepEqual(draft, { character: { ...simple, secrets: [{ id: "a", fact: "b" }] }, knows: ["a"] });
  assert.throws(() => readDraft({ character: simple, knows: "a" }), /"knows"/);
  assert.throws(() => readDraft({ character: { ...simple, reactions: [{ min: "1", text: "x" }] } }), /"reactions"/);
});

test("every preset is valid, and a broken preset names itself", () => {
  assert.deepEqual(presets.map((p) => p.id), ["harry", "nib", "maude", "cobb"]);
  assert.throws(() => readPresets({ ghost: { name: "Ghost" } }), /Preset "ghost" is invalid: .*"persona"/);
});

test("field errors use defineCharacter()'s messages, next to the right field", () => {
  assert.deepEqual(fieldErrors(simple), {});
  for (const { character } of presets) assert.deepEqual(fieldErrors(character), {});
  const errors = fieldErrors({ name: "Tess", persona: "", goal: "Share", patience: -1, hostileAt: 2, levels: ["only one"] });
  assert.deepEqual(Object.keys(errors).sort(), ["hostileAt", "levels", "patience", "persona"]);
  assert.equal(errors.persona, 'Character is missing "persona" (a non-empty string)');
  assert.equal(errors.patience, '"patience" must be a number above 0 (or Infinity for unlimited), got -1');
  assert.match(errors.levels, /^"levels" must be an array of 2 to 10/);
  assert.equal(fieldErrors({ goal: "x", persona: "y" }).name, 'Character is missing "name" (a non-empty string)');
  // A threshold is checked against the levels it will be used with.
  assert.deepEqual(fieldErrors({ ...simple, levels: ["a", "b", "c"], threshold: 3 }).threshold,
    '"threshold" must be above 0 and at most 2 (the top level for 3 levels), got 3');
  assert.deepEqual(fieldErrors({ ...simple, levels: ["a", "b", "c", "d", "e", "f"], threshold: 4.5 }), {});
  // Errors that involve two fields land on the advanced one.
  assert.match(fieldErrors({ ...simple, difficulty: "easy", threshold: 3 }).threshold, /set "difficulty" or "threshold", not both/);
});

test("the level a score lands on is the nearest one, quoted in full", () => {
  const levels = ["no", "weak", "fair", "good", "great"];
  assert.deepEqual(levelFor(3.49, levels), { index: 3, text: "good" });
  assert.deepEqual(levelFor(3.5, levels), { index: 4, text: "great" });
  assert.deepEqual(levelFor(-1, levels), { index: 0, text: "no" });
  assert.equal(levelFor(null, levels), null);
  assert.deepEqual(distribution({ probabilities: { 0: 0.1, 4: 0.9 } }, levels), [0.1, 0, 0, 0, 0.9]);
  assert.equal(distribution({ probabilities: {} }, levels), null);
  assert.equal(distribution(undefined, levels), null);
});

test("trying a line reports the verdict, source, level, and patience", async () => {
  const nib = preset("nib");
  const npc = conversation(nib, ["wants_to_be_a_cook"]);
  const client = createMockClient();
  const first = await tryLine(npc, "Hello there", client);
  assert.equal(first.verdict, "unconvinced");
  assert.equal(first.source, "mock");
  assert.equal(first.patienceLeft, 2);
  assert.equal(first.threshold, defineCharacter(nib).threshold);
  assert.equal(first.level.text, defineCharacter(nib).levels[first.level.index]);
  const repeat = await tryLine(npc, "Hello there", client);
  assert.equal(repeat.verdict, "repeated");
  assert.equal(repeat.source, undefined, "repeats are judged locally");
  assert.equal(repeat.level, null);
  const won = await tryLine(npc, "Please let me go, I could help you get a job as a cook in a town kitchen", client);
  assert.equal(won.verdict, "convinced");
});

test("the distribution is shown when the judge gives one", async () => {
  const client = {
    async ask() {
      const answers = { persuasion: { type: "score", score: 3, legend: {}, probabilities: { 3: 0.75, 4: 0.25 }, confidence: 0.75 },
        threats: { type: "noul", noul: 0 }, insults: { type: "noul", noul: 0.9 } };
      answers[SOURCE] = "jev";
      return answers;
    },
  };
  const result = await tryLine(conversation(simple), "You idiot", client);
  assert.equal(result.source, "jev");
  assert.equal(result.verdict, "offended");
  assert.deepEqual(result.triggered, ["insults"]);
  assert.deepEqual(result.distribution, [0, 0, 0, 0.75, 0.25]);
});

test("replay reruns every line, in order, against a fresh conversation", async () => {
  const lines = ["Hello", "Hello", "Please let me go, I could help you get a job as a cook in a town kitchen"];
  const seen = [];
  const results = await replay(conversation(preset("nib"), ["wants_to_be_a_cook"]), lines, createMockClient(), (r, i) => seen.push(i));
  assert.deepEqual(seen, [0, 1, 2]);
  assert.deepEqual(results.map((r) => r.verdict), ["unconvinced", "repeated", "convinced"]);
  // Without the secret, the same argument falls short.
  const unknown = await replay(conversation(preset("nib")), lines.slice(2), createMockClient());
  assert.ok(unknown[0].score < results[2].score);
});

test("replies are labelled with the demo's words", () => {
  assert.deepEqual(VERDICT_LABELS, present.VERDICT_LABELS);
  for (const verdict of [...Object.keys(VERDICT_LABELS), "unconvinced"]) assert.equal(spokenLabel(verdict), present.spokenLabel(verdict));
});

test("a reaction's speech and the character's name are styled, and nothing else changes", () => {
  const kinds = (parts) => parts.map((p) => `${p.kind}:${p.text}`);
  const reaction = "\"Everyone's got a reason,\" Harry says. \"Mine's keeping this job.\"";
  const parts = replyParts(reaction, "Harry Goatleaf");
  assert.deepEqual(kinds(parts), ["speech:\"Everyone's got a reason,\"", "text: ", "character:Harry", "text: says. ", "speech:\"Mine's keeping this job.\""]);
  assert.deepEqual(kinds(replyParts("Harry Goatleaf sighs; Harrying won't help.", "Harry Goatleaf")),
    ["character:Harry Goatleaf", "text: sighs; Harrying won't help."], "the full name, and never inside another word");
  assert.deepEqual(kinds(replyParts("A (weird) name.", "(weird)")), ["text:A ", "character:(weird)", "text: name."], "names are matched literally");
  // A Persuadable never reads story markup, so it's shown exactly as written.
  for (const text of ["@[Harry] waves.", "He holds a #[key].", "A literal \\@[ here.", "Odd \"quote."]) {
    assert.equal(replyParts(text, "Harry").map((p) => p.text).join(""), text, text);
  }
  assert.deepEqual(kinds(replyParts("@[Harry] says \"no\".", "")), ["text:@[Harry] says \"no\"."]);
  for (const text of [reaction, "Harry, Harry, Harry!", "", "\"\""]) assert.equal(replyParts(text, "Harry").map((p) => p.text).join(""), text);
});

test("replies with variants: one per line in the form, kept as lists in drafts and in the character", () => {
  assert.equal(linesToText(["One.", "Two."]), "One.\nTwo.");
  assert.equal(linesToText("One."), "One.");
  assert.equal(linesToText(undefined), "");
  assert.deepEqual(textToLines(" One. \n\n Two. \n"), ["One.", "Two."]);
  assert.equal(textToLines("  One.  "), "One.");
  assert.equal(textToLines(" \n "), "");

  const character = {
    name: "Nib", persona: "A jumpy goblin.", goal: "Open the cage",
    reactions: [{ min: 0, text: ["Low one.", "Low two."] }], repeatReaction: ["Again?", "Still again?"],
  };
  const draft = readDraft({ character, knows: [] });
  assert.deepEqual(draft.character.reactions, character.reactions);
  assert.deepEqual(draft.character.repeatReaction, character.repeatReaction);
  assert.notEqual(draft.character.reactions[0].text, character.reactions[0].text, "copied, not shared");
  assert.throws(() => readDraft({ character: { ...character, repeatReaction: ["ok", 3] } }), /"repeatReaction"/);
  assert.throws(() => readDraft({ character: { ...character, reactions: [{ min: 0, text: [1] }] } }), /"reactions"/);
  const smallest = minimalCharacter(character);
  assert.deepEqual(smallest.reactions, character.reactions);
  assert.deepEqual(smallest.repeatReaction, character.repeatReaction);
  assert.equal(fieldErrors({ ...character, repeatReaction: [] }).repeatReaction !== undefined, true);
});

test("a share link may name a preset instead of copying it, and carry a line to prefill", () => {
  const hash = encodeShare({ preset: "harry", line: "  The plain truth.  " });
  assert.deepEqual(decodeShare(hash), { preset: "harry", knows: [], line: "The plain truth." });
  assert.ok(hash.length < 300, "short, since it names the preset");
  assert.equal(decodeShare(encodeShare({ character: simple, knows: [], line: "Hello" })).line, "Hello");
  assert.equal("line" in decodeShare(encodeShare({ character: simple, knows: [] })), false, "no line, no key");
  assert.throws(() => readDraft({ preset: 3 }), /"preset"/);
  assert.throws(() => readDraft({ preset: "harry", line: 5 }), /"line"/);
  assert.equal(readDraft({ preset: "harry", line: "x".repeat(600) }).line.length, 500, "no longer than the playground sends");
});

test("clues: kept in drafts, share links, generated code, and story JSON, where each gets a reply placeholder", () => {
  const character = { name: "Harry", persona: "A guard.", goal: "Open the gate",
    secrets: [{ id: "sick_daughter", fact: "His daughter is ill." }],
    clues: [{ id: "family", when: "Asks about his family", reveals: "sick_daughter" }] };
  assert.deepEqual(readDraft({ character }).character.clues, character.clues);
  assert.deepEqual(decodeShare(encodeShare({ character, knows: [] })).character.clues, character.clues);
  assert.deepEqual(minimalCharacter(character).clues, character.clues);
  const npc = JSON.parse(storyJson(character, { id: "harry" }));
  assert.deepEqual(npc.persuasion.clues, character.clues);
  assert.deepEqual(npc.clueReplies, { family: TODO.clueReply });
  assert.match(fieldErrors({ ...character, clues: [{ id: "family", when: "x", reveals: "nope" }] }).clues, /isn't one of its secrets/);
  assert.throws(() => readDraft({ character: { ...character, clues: [{ id: 1 }] } }), /"clues"/);
});

