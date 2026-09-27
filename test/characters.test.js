import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defineCharacter } from "../src/index.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const characters = load("stories/characters.json");
const scenes = load("stories/index.json");

test("every preset character is valid", () => {
  for (const [id, character] of Object.entries(characters)) {
    assert.doesNotThrow(() => defineCharacter(character), `preset "${id}"`);
  }
});

test("preset names are unique", () => {
  const names = Object.values(characters).map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
});

test("each scene's character matches its preset", () => {
  for (const scene of scenes) {
    const story = load(`stories/${scene.file}`);
    const npc = Object.values(story.scenes).find((s) => s.npc?.id === scene.character).npc;
    const { success, ...persuasion } = npc.persuasion;
    const fromStory = { name: npc.name, persona: npc.persona, patience: npc.patience, secrets: npc.secrets, repeatReaction: npc.repeatReaction, ...persuasion };
    assert.deepEqual(defineCharacter(characters[scene.character]), defineCharacter(fromStory), scene.id);
  }
  assert.deepEqual(scenes.map((s) => s.character).sort(), Object.keys(characters).sort(), "every preset has a scene");
});

test("the new scenes' characters have the settings their scenes are built around", () => {
  const settings = (id) => {
    const { difficulty, offendedBy, patience } = defineCharacter(characters[id]);
    return { difficulty, offendedBy, patience };
  };
  assert.deepEqual(settings("nib"), { difficulty: "easy", offendedBy: ["insults"], patience: 3 });
  assert.deepEqual(settings("maude"), { difficulty: "hard", offendedBy: ["threats"], patience: 3 });
  const overridden = ["difficulty", "threshold", "offendedBy", "levels", "hostileAt"].filter((k) => k in characters.cobb);
  assert.deepEqual(overridden, [], "the keeper uses the default settings");
  assert.ok(characters.cobb.patience >= 8, "the keeper's patience is generous");
});
