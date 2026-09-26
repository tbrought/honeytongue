import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, validateStory, StoryError } from "../src/index.js";
import { fakeClient } from "./helpers.js";

const story = () => JSON.parse(readFileSync(new URL("../stories/gatehouse.json", import.meta.url), "utf8"));

test("the demo story is valid", () => {
  assert.doesNotThrow(() => validateStory(story()));
});

test("validation lists every problem at once", () => {
  const s = story();
  s.start = "nope";
  s.scenes.gate.actions.leave.goto = "nowhere";
  s.scenes.gate.npc.persuasion.threshold = 9;
  const err = (() => { try { validateStory(s); } catch (e) { return e; } })();
  assert.ok(err instanceof StoryError);
  assert.equal(err.problems.length, 3);
});

test("a convincing argument wins", async () => {
  const game = new Game(story(), fakeClient({ score: 3.6 }));
  const r = await game.turn("an honest plea");
  assert.match(r.text, /lifts the bar/);
  assert.equal(game.over, true);
});

test("failures end in the cell when patience runs out", async () => {
  const client = fakeClient({ score: 1 });
  const game = new Game(story(), client);
  for (const line of ["let me in", "I have business inside", "it's important", "come on, open up"]) await game.turn(line);
  assert.equal(game.over, true);
  assert.equal(game.sceneId, "cell");
});

test("insults are noticed even when not persuading", async () => {
  const game = new Game(story(), fakeClient({ action: "chat_guard", hostile: 0.95 }));
  const r = await game.turn("how's your shift, idiot");
  assert.match(r.text, /club at his belt/);
});

test("repeating a failed argument doesn't call Jev again", async () => {
  const client = fakeClient({ score: 1 });
  const game = new Game(story(), client);
  await game.turn("please let me through");
  const r = await game.turn("Please, let me through");
  assert.match(r.text, /said that already/);
  assert.equal(client.calls.length, 1);
});

test("uncertain input asks for clarification", async () => {
  const client = fakeClient({ action: "chat_guard", p: 0.5 });
  client.ask = async () => ({ action: { probabilities: { chat_guard: 0.5, persuade_guard: 0.4, unclear: 0.1 } }, persuasion: { score: 0 }, hostile: { noul: 0 } });
  const game = new Game(story(), client);
  assert.match((await game.turn("talk to him")).text, /Did you mean/);
  assert.match((await game.turn("1")).text, /double shift/);
});

test("locked actions explain why, and the game refuses turns after the end", async () => {
  const game = new Game(story(), fakeClient({ action: "climb_wall" }));
  assert.match((await game.turn("climb")).text, /something to climb/);
  game.flags.add("found_ivy");
  await game.turn("climb");
  assert.equal(game.over, true);
  assert.match((await game.turn("hello?")).text, /story has ended/);
});

test("the player's knowledge reaches Jev", async () => {
  const client = fakeClient({ action: "chat_guard" });
  const game = new Game(story(), client);
  await game.turn("how are you");
  await game.turn("anything new?");
  assert.equal(client.calls[1].state.character.secrets[0].player_knows, true);
});

// A client that answers every turn the same way, with full control over the action probabilities.
const scripted = (probabilities, { score = 0, hostile = 0.01 } = {}) => {
  const client = { calls: [], async ask(state, questions) {
    client.calls.push({ state, questions });
    return { action: { probabilities }, persuasion: { score }, hostile: { noul: hostile } };
  } };
  return client;
};

test("an insult is noticed even when the action is ambiguous or unclear", async () => {
  const ambiguous = new Game(story(), scripted({ chat_guard: 0.5, persuade_guard: 0.45, unclear: 0.05 }, { hostile: 0.95 }));
  const r = await ambiguous.turn("hey you idiot, what's that toy");
  assert.match(r.text, /club at his belt/);
  assert.doesNotMatch(r.text, /Did you mean/);
  assert.equal(ambiguous.pending, null);
  const unclear = new Game(story(), scripted({ unclear: 1 }, { hostile: 0.95 }));
  const u = await unclear.turn("you absolute worm");
  assert.match(u.text, /club at his belt/);
  assert.doesNotMatch(u.text, /not sure how/);
});

test("'Did you mean' accepts numbers and words", async () => {
  for (const pick of ["1", "1.", "1)", "one", "first", "the first one", "#1"]) {
    const game = new Game(story(), scripted({ chat_guard: 0.5, persuade_guard: 0.4, unclear: 0.1 }));
    await game.turn("talk to him");
    assert.match((await game.turn(pick)).text, /double shift/, `"${pick}" should pick option 1`);
  }
});

test("running out of patience plays its effect once, and then the NPC stops listening", async () => {
  const s = story();
  s.scenes.gate.npc.outOfPatience = { text: "Harry turns his back on you.", giveItems: ["bruise"] };
  const game = new Game(s, scripted({ chat_guard: 0.9, unclear: 0.1 }, { hostile: 0.95 }));
  let text = "";
  for (const line of ["rude one", "rude two", "rude three", "rude four"]) text += (await game.turn(line)).text;
  assert.equal(text.split("turns his back").length - 1, 1);
  assert.deepEqual(game.inventory.filter((i) => i === "bruise"), ["bruise"]);
  game.jev = scripted({ persuade_guard: 0.9, unclear: 0.1 }, { score: 4 });
  game.npc.client = game.jev;
  assert.match((await game.turn("the perfect argument")).text, /stopped listening/);
});

test("a convinced NPC isn't persuaded twice", async () => {
  const s = story();
  s.scenes.gate.npc.persuasion.success = { text: "Harry hands you a pass.", giveItems: ["gate pass"] };
  const game = new Game(s, scripted({ persuade_guard: 0.9, unclear: 0.1 }, { score: 4 }));
  assert.match((await game.turn("an honest plea")).text, /hands you a pass/);
  assert.match((await game.turn("another honest plea")).text, /already agreed/);
  assert.deepEqual(game.inventory.filter((i) => i === "gate pass"), ["gate pass"]);
});

test("the NPC you insulted reacts, not the one in the scene you move to", async () => {
  const s = {
    title: "Two rooms", start: "a",
    scenes: {
      a: { description: "Room A.", npc: { id: "x", name: "X", persona: "p", hostileReaction: "X glares.", persuasion: { goal: "g", success: { text: "ok" } } },
        actions: { go: { description: "go to room b", text: "You go.", goto: "b" } } },
      b: { description: "Room B.", npc: { id: "y", name: "Y", persona: "p", hostileReaction: "Y glares.", persuasion: { goal: "g", success: { text: "ok" } } },
        actions: { wait: { description: "wait", text: "You wait." } } },
    },
  };
  const game = new Game(s, scripted({ go: 0.9, unclear: 0.1 }, { hostile: 0.95 }));
  const r = await game.turn("going, you fool");
  assert.match(r.text, /X glares/);
  assert.doesNotMatch(r.text, /Y glares/);
});

test("options Jev shouldn't have returned don't crash the game", async () => {
  const game = new Game(story(), scripted({ toString: 0.9, bogus: 0.1 }));
  assert.match((await game.turn("hmm")).text, /not sure how/);
  const fallback = new Game(story(), { async ask() { return { action: { choice: "read_letter" }, persuasion: { score: 0 }, hostile: { noul: 0 } }; } });
  assert.match((await fallback.turn("read it")).text, /wax seal/);
});

test("turns sent at the same time run in order", async () => {
  const client = fakeClient({ score: 1 });
  const game = new Game(story(), client);
  const [, second] = await Promise.all([game.turn("please let me through"), game.turn("please let me through")]);
  assert.match(second.text, /said that already/);
  assert.equal(client.calls.length, 1);
});

test("a story that starts on an ending is already over", async () => {
  const s = story();
  s.start = "cell";
  const game = new Game(s, fakeClient());
  assert.equal(game.over, true);
  assert.match((await game.turn("hello")).text, /story has ended/);
});

test("a missing client gets a readable error", () => {
  assert.throws(() => new Game(story()), /second argument/);
});

test("validation reports malformed stories instead of crashing", () => {
  const s = story();
  s.player.inventory = "silver coin";
  s.scenes.broken = null;
  s.scenes.gate.actions.nothing = null;
  s.scenes.gate.actions.climb_wall.requires = { flags: "found_ivy" };
  s.scenes.gate.actions.read_letter.giveItems = ["ok", 3];
  s.scenes.gate.npc.persuasion.hostileAt = 5;
  s.scenes.twin = { description: "Another gate.", npc: { ...s.scenes.gate.npc, persona: "Someone else entirely" }, actions: { wait: { description: "wait", text: "ok" } } };
  s.scenes.empty = { description: "An empty room.", actions: { wait: { description: "wait", text: "ok", patience: -1 } } };
  s.scenes.cell.ending = true;
  const err = (() => { try { validateStory(s); } catch (e) { return e; } })();
  assert.ok(err instanceof StoryError, `expected a StoryError, got ${err}`);
  for (const expected of [/player.inventory/, /"broken" must be an object/, /"nothing" must be an object/, /"requires"/, /"giveItems"/, /hostileAt/, /npc id "harry" is also used/, /"patience" needs an npc/, /"ending" must be/]) {
    assert.ok(err.problems.some((p) => expected.test(p)), `missing a problem matching ${expected}:\n${err.message}`);
  }
});
