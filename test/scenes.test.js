import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Game, validateStory, createMockClient, defineCharacter } from "../src/index.js";
import { stripMarkup } from "../src/markup.js";

const load = (file) => JSON.parse(readFileSync(new URL(`../stories/${file}`, import.meta.url), "utf8"));
const scenes = load("index.json");

// Each scene's intended routes, played on the offline mock so none can become unwinnable in the web demo.
// The talking route ends where the character's success goes; the other route never persuades anyone.
const ROUTES = {
  gatehouse: {
    talk: [
      "Ask Harry about the toy horse",
      "read the letter",
      "Harry, I have an urgent letter for Ilse the apothecary. It details an urgent fever remedy. If you let me pass, I will give the remedy to your daughter.",
    ],
    other: ["search along the wall", "climb the ivy"],
    otherEnding: "You snuck in",
  },
  "goblin-camp": {
    talk: [
      "ask Nib about his stew",
      "Nib, please let me out. Come with me to town and I'll help you become a cook in a real kitchen.",
    ],
    other: ["examine the cage", "work the loose bar free"],
    otherEnding: "You slipped the cage",
  },
  "tidy-profit": {
    talk: [
      "ask Maude about the voyage",
      "look over the cargo",
      "Maude, honestly: the captain is skimming the crew's shares. Six of his crates aren't on your manifest. Take me aboard and I'll give you the proof.",
    ],
    other: ["examine the crates", "hide in one of the captain's crates"],
    otherEnding: "You stowed away",
  },
  lighthouse: {
    talk: [
      "look through the spyglass", "examine the lamp", "ask Cobb about himself",
      "Cobb, the raiders are anchored behind the island and won't sail in this storm, and the shutter can send the beam out to sea only. You know what a dark night cost the Wren. Please light it for my sister.",
    ],
    other: ["search the stores", "light a beacon on the headland"],
    otherEnding: "You lit the beacon",
  },
};

test("the scene list covers every bundled story, and each one is valid", () => {
  const files = readdirSync(new URL("../stories/", import.meta.url)).filter((f) => !["index.json", "characters.json"].includes(f));
  assert.deepEqual(scenes.map((s) => s.file).sort(), files.sort());
  assert.deepEqual(scenes.map((s) => s.id).sort(), Object.keys(ROUTES).sort(), "every scene has routes to test");
  for (const scene of scenes) {
    const story = validateStory(load(scene.file));
    assert.equal(story.title.toLowerCase(), scene.title.toLowerCase(), scene.id);
    assert.ok(scene.hook.length > 10 && scene.hook.length <= 90, `${scene.id}: a one-line hook`);
    assert.ok(Number.isInteger(scene.minutes) && scene.minutes >= 5 && scene.minutes <= 10, `${scene.id}: 5 to 10 minutes`);
    const endings = Object.values(story.scenes).filter((s) => s.ending);
    assert.ok(endings.length >= 2 && endings.length <= 4, `${scene.id}: two to four endings`);
  }
  assert.equal(scenes[0].id, "gatehouse", "The Gatehouse stays the introductory scene");
});

test("scenes are listed easiest first, The Gatehouse clearly the easiest, and each says its difficulty out loud", () => {
  const characters = JSON.parse(readFileSync(new URL("../stories/characters.json", import.meta.url), "utf8"));
  const defined = scenes.map((s) => defineCharacter(characters[s.character]));
  for (const [i, c] of defined.entries()) {
    assert.ok(characters[scenes[i].character].difficulty, `${scenes[i].id}: a difficulty word, for the scene list's tag`);
    if (i) assert.ok(c.threshold >= defined[i - 1].threshold, `${scenes[i].id} is no easier than the scene before it`);
  }
  const [gatehouse, ...rest] = defined;
  assert.ok(rest.every((c) => gatehouse.threshold < c.threshold || (gatehouse.threshold === c.threshold && gatehouse.patience > c.patience)),
    "The Gatehouse is easier than every other scene: a lower threshold, or the same with more patience");
});

test("each scene has one main character, with one secret to discover", () => {
  for (const scene of scenes) {
    const story = load(scene.file);
    const npcs = new Set(Object.values(story.scenes).filter((s) => s.npc).map((s) => s.npc.id));
    assert.deepEqual([...npcs], [scene.character], scene.id);
    const npc = Object.values(story.scenes).find((s) => s.npc).npc;
    assert.equal(npc.secrets.length, 1, scene.id);
    const reveals = Object.values(story.scenes).flatMap((s) => Object.values(s.actions ?? {}))
      .filter((a) => a.setFlags?.includes(npc.secrets[0].id));
    assert.ok(reveals.length >= 1, `${scene.id}: something reveals the secret`);
  }
});

// One plainly worded winning line per scene, once its clues are found, so the offline demo doesn't only accept test wording.
// The mock is a stand-in for Jev: keep these few, and keep its fixes generic.
const NATURAL = {
  gatehouse: [["knows_daughter_is_sick", "knows_letter_is_for_apothecary"], "Harry, this letter has a fever remedy for the apothecary. Let me through and I'll send her to your daughter."],
  "goblin-camp": [["wants_to_be_a_cook"], "Nib, let me out and I'll get you a job as a cook in town."],
  "tidy-profit": [["suspects_the_captain", "found_unlisted_crates"], "I can prove the captain is stealing from the crew. Take me with you and the proof is yours."],
  lighthouse: [["lost_a_boat"], "Cobb, my sister is out there. Please light the lamp before she hits the rocks."],
};

test("a plainly worded argument can win every scene on the mock", async () => {
  for (const scene of scenes) {
    const [flags, line] = NATURAL[scene.id];
    const story = load(scene.file);
    const game = new Game(story, createMockClient());
    for (const f of flags) game.flags.add(f);
    await game.turn(line);
    const success = Object.values(story.scenes).find((s) => s.npc).npc.persuasion.success.goto;
    assert.equal(game.sceneId, success, `${scene.id}: ${line}`);
  }
});

for (const scene of scenes) {
  const routes = ROUTES[scene.id];

  test(`the mock can win ${scene.title} by talking`, async () => {
    const story = load(scene.file);
    const npc = Object.values(story.scenes).find((s) => s.npc).npc;
    const game = new Game(story, createMockClient());
    let last;
    for (const line of routes.talk) last = await game.turn(line);
    assert.ok(last.text.includes(stripMarkup(npc.persuasion.success.text)), last.text);
    assert.equal(game.sceneId, npc.persuasion.success.goto);
    assert.equal(game.over, true);
  });

  test(`the mock can finish ${scene.title} without talking anyone round`, async () => {
    const game = new Game(load(scene.file), createMockClient());
    for (const line of routes.other) await game.turn(line);
    assert.equal(game.scene.ending, routes.otherEnding);
    assert.equal(game.npc?.convinced ?? false, false);
  });
}
