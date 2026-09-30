import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, validateStory, StoryError, Persuadable } from "../src/index.js";
import { fakeClient, harry } from "./helpers.js";

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
  const game = new Game(story(), fakeClient({ action: "chat_guard", insults: 0.95 }));
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
  client.ask = async () => ({ action: { probabilities: { chat_guard: 0.5, persuade_guard: 0.4, unclear: 0.1 } }, persuasion: { score: 0 } });
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
const scripted = (probabilities, { score = 0, threats = 0.01, insults = 0.01 } = {}) => {
  const client = { calls: [], async ask(state, questions) {
    client.calls.push({ state, questions });
    return { action: { probabilities }, persuasion: { score }, threats: { noul: threats }, insults: { noul: insults } };
  } };
  return client;
};

test("an insult is noticed even when the action is ambiguous or unclear", async () => {
  const ambiguous = new Game(story(), scripted({ chat_guard: 0.5, persuade_guard: 0.45, unclear: 0.05 }, { insults: 0.95 }));
  const r = await ambiguous.turn("hey you idiot, what's that toy");
  assert.match(r.text, /club at his belt/);
  assert.doesNotMatch(r.text, /Did you mean/);
  assert.equal(ambiguous.pending, null);
  const unclear = new Game(story(), scripted({ unclear: 1 }, { insults: 0.95 }));
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
  const game = new Game(s, scripted({ chat_guard: 0.9, unclear: 0.1 }, { insults: 0.95 }));
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
  const game = new Game(s, scripted({ go: 0.9, unclear: 0.1 }, { insults: 0.95 }));
  const r = await game.turn("going, you fool");
  assert.match(r.text, /X glares/);
  assert.doesNotMatch(r.text, /Y glares/);
});

test("options Jev shouldn't have returned don't crash the game", async () => {
  const game = new Game(story(), scripted({ toString: 0.9, bogus: 0.1 }));
  assert.match((await game.turn("hmm")).text, /not sure how/);
  const fallback = new Game(story(), { async ask() { return { action: { choice: "read_letter" }, persuasion: { score: 0 } }; } });
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

test("NPCs react during other actions only to tells in their offendedBy", async () => {
  const s = story();
  s.scenes.gate.npc.persuasion.offendedBy = ["insults"];
  const threatened = new Game(s, scripted({ chat_guard: 0.9, unclear: 0.1 }, { threats: 0.95 }));
  const t = await threatened.turn("how's your shift? answer or else");
  assert.doesNotMatch(t.text, /club at his belt/);
  assert.match(t.text, /double shift/);
  const insulted = new Game(s, scripted({ chat_guard: 0.9, unclear: 0.1 }, { insults: 0.95 }));
  assert.match((await insulted.turn("how's your shift, idiot")).text, /club at his belt/);
  const unclear = new Game(s, scripted({ unclear: 1 }, { threats: 0.95 }));
  assert.match((await unclear.turn("grr")).text, /not sure how/);
});

test("by default threats get the same reaction as insults", async () => {
  const game = new Game(story(), scripted({ chat_guard: 0.9, unclear: 0.1 }, { threats: 0.95 }));
  assert.match((await game.turn("talk, or I'll hurt you")).text, /club at his belt/);
});

test("story NPCs take difficulty and offendedBy in their persuasion block", async () => {
  const s = story();
  delete s.scenes.gate.npc.persuasion.threshold;
  s.scenes.gate.npc.persuasion.difficulty = "easy";
  s.scenes.gate.npc.persuasion.offendedBy = ["insults"];
  const game = new Game(s, fakeClient({ score: 2.5, threats: 0.95 }));
  assert.equal(game.npc.character.threshold, 2.4);
  assert.deepEqual(game.npc.character.offendedBy, ["insults"]);
  assert.match((await game.turn("let me through or you'll regret it")).text, /lifts the bar/);
});

test("validation reports difficulty and offendedBy mistakes", () => {
  const s = story();
  s.scenes.gate.npc.persuasion.difficulty = "hard"; // threshold is set too
  const twin = structuredClone(s.scenes.gate);
  twin.npc.id = "twin";
  delete twin.npc.persuasion.difficulty;
  twin.npc.persuasion.offendedBy = ["rudeness"];
  s.scenes.twin = twin;
  const err = (() => { try { validateStory(s); } catch (e) { return e; } })();
  assert.ok(err instanceof StoryError);
  assert.ok(err.problems.some((p) => /Scene "gate".*set "difficulty" or "threshold", not both/.test(p)), err.message);
  assert.ok(err.problems.some((p) => /Scene "twin".*"offendedBy".*got "rudeness"/.test(p)), err.message);
});

test("hostileReaction is only required when something can offend the NPC", () => {
  const s = story();
  delete s.scenes.gate.npc.hostileReaction;
  assert.throws(() => validateStory(s), /needs a "hostileReaction"/);
  s.scenes.gate.npc.persuasion.offendedBy = [];
  assert.doesNotThrow(() => validateStory(s));
  s.scenes.gate.npc.hostileReaction = "";
  assert.throws(() => validateStory(s), /needs a "hostileReaction"/);
});

test("hostile reactions may be a list of variants, used in turn", async () => {
  const s = story();
  s.scenes.gate.npc.patience = 100;
  s.scenes.gate.npc.hostileReaction = ["@[Harry] glares.", "@[Harry] grips his club."];
  const game = new Game(s, fakeClient({ score: 0, threats: 0.95 }));
  const said = [];
  for (const line of ["open up or else", "move or I'll hurt you", "last warning, guard"]) said.push((await game.turn(line)).text);
  assert.match(said[0], /Harry glares\./);
  assert.match(said[1], /Harry grips his club\./);
  assert.match(said[2], /Harry glares\./);
});

test("validateStory checks each reply variant", () => {
  const s = story();
  s.scenes.gate.npc.hostileReaction = [];
  s.scenes.gate.npc.persuasion.reactions[0].text = ["Fine.", "@[Harry shrugs."];
  s.scenes.gate.npc.repeatReaction = ["Again?", ""];
  const err = (() => { try { validateStory(s); } catch (e) { return e; } })();
  assert.ok(err instanceof StoryError);
  assert.ok(err.problems.some((p) => /needs a "hostileReaction"/.test(p)), err.message);
  assert.ok(err.problems.some((p) => /reactions\.0\.text\.1/.test(p)), err.message);
  assert.ok(err.problems.some((p) => /"repeatReaction"/.test(p)), err.message);
});

test("a decide hook works in stories built in code", async () => {
  const s = story();
  s.scenes.gate.npc.persuasion.decide = (result) => (result.triggered.includes("threats") ? "offended" : undefined);
  s.scenes.gate.npc.persuasion.offendedBy = [];
  delete s.scenes.gate.npc.hostileReaction;
  const game = new Game(s, fakeClient({ score: 4, threats: 0.95 }));
  const r = await game.turn("let me in or else");
  assert.match(r.text, /Harry Goatleaf takes offence/);
  assert.equal(game.over, false);
});

test("each turn's debug says how it went for the scene's character", async () => {
  const client = fakeClient({ score: 1 });
  const game = new Game(story(), client);
  const judged = (await game.turn("an honest but weak plea")).debug;
  assert.equal(judged.verdict, "unconvinced");
  assert.equal(judged.threshold, 3.2);
  assert.deepEqual(judged.triggered, []);
  assert.equal(judged.patienceLeft, 3);

  const repeat = (await game.turn("an honest but weak plea")).debug;
  assert.deepEqual(repeat.ranked, [], "a repeat is caught locally");
  assert.equal(repeat.verdict, "repeated");
  assert.equal(repeat.patienceLeft, 2);

  client.next = { ...client.next, action: "read_letter" };
  const plain = (await game.turn("read the letter")).debug;
  assert.equal(plain.verdict, null, "an ordinary action isn't judged");
  assert.equal(plain.threshold, 3.2);

  client.next = { ...client.next, action: "chat_guard", insults: 0.95 };
  const rude = (await game.turn("how's your shift, idiot")).debug;
  assert.equal(rude.verdict, "offended");
  assert.deepEqual(rude.triggered, ["insults"]);
  assert.equal(rude.patienceLeft, 0, "Harry has run out, and the turn says so");
});

test("each turn's attempt is how the scene's character judged it: attempt()'s fields plus threshold, or null", async () => {
  const client = fakeClient({ score: 1 });
  const game = new Game(story(), client);
  const judged = await game.turn("an honest but weak plea");
  const direct = await new Persuadable(harry, { client: fakeClient({ score: 1 }) }).attempt("Please open the gate.");
  assert.deepEqual(Object.keys(judged.attempt).sort(), [...Object.keys(direct), "threshold"].sort(), "the same fields as attempt(), plus threshold");
  assert.equal(judged.attempt.verdict, "unconvinced");
  assert.equal(judged.attempt.score, 1);
  assert.equal(judged.attempt.threshold, 3.2);
  assert.equal(judged.attempt.patienceLeft, 3);
  assert.equal(judged.attempt.outOfPatience, false);
  assert.ok(judged.attempt.reaction, "with the character's reaction");
  assert.equal(judged.attempt.verdict, judged.debug.verdict, "debug agrees");

  const repeat = await game.turn("an honest but weak plea");
  assert.equal(repeat.attempt.verdict, "repeated");
  assert.equal(repeat.attempt.score, null, "a repeat isn't sent to Jev");

  client.next = { ...client.next, action: "read_letter" };
  assert.equal((await game.turn("read the letter")).attempt, null, "an ordinary action isn't judged");
  assert.equal((await game.turn("look")).attempt, null, "nor is a command answered without Jev");

  client.next = { ...client.next, action: "chat_guard", insults: 0.95 };
  const rude = await game.turn("how's your shift, idiot");
  assert.equal(rude.attempt.verdict, "offended", "an insult during another action is judged too");
  assert.deepEqual(rude.attempt.triggered, ["insults"]);
  assert.equal(rude.attempt.patienceLeft, 0);
  assert.equal(rude.attempt.outOfPatience, true);
  assert.equal(rude.attempt.reaction, null);
});

test("one penalty per turn: hostile words with a costly action are charged once, at the larger cost", async () => {
  const load = (f) => JSON.parse(readFileSync(new URL(`../stories/${f}`, import.meta.url), "utf8"));
  // Grabbing Cobb's key costs 3; a threat alone costs 2. Together: 3, not 5.
  const lighthouse = new Game(load("lighthouse.json"), fakeClient({ action: "grab_key", threats: 0.95 }));
  const grab = await lighthouse.turn("give me that key or I'll hurt you");
  assert.equal(lighthouse.npc.patienceLeft, 7);
  assert.match(grab.text, /stronger than it looks/, "the action still happens");
  assert.match(grab.text, /I'll not be spoken to like that/, "and he still takes offence");
  // Grabbing at Nib's keys costs 1; an insult costs 2. Together: 2, not 3.
  const camp = new Game(load("goblin-camp.json"), fakeClient({ action: "grab_keys", insults: 0.95 }));
  await camp.turn("give me those keys, you worm");
  assert.equal(camp.npc.patienceLeft, 1);
  // Without hostility, the action costs what it says.
  const calm = new Game(load("lighthouse.json"), fakeClient({ action: "grab_key" }));
  await calm.turn("snatch the key");
  assert.equal(calm.npc.patienceLeft, 7);
});

test("the attempt that uses up the last of a character's patience shows only the out-of-patience text", async () => {
  const game = new Game(story(), fakeClient({ score: 1 }));
  for (const line of ["let me in", "I have business inside", "it's important"]) {
    assert.match((await game.turn(line)).text, /Gate's shut till dawn/, "ordinary failures get a reaction");
  }
  const last = await game.turn("come on, open up");
  assert.doesNotMatch(last.text, /Gate's shut till dawn/);
  assert.match(last.text, /Enough\./);
  assert.equal(game.sceneId, "cell");

  const rude = new Game(story(), fakeClient({ score: 1 }));
  for (const line of ["let me in", "I have business inside", "it's important"]) await rude.turn(line);
  rude.jev.next = { ...rude.jev.next, insults: 0.95 };
  const insult = await rude.turn("open it, you useless fool");
  assert.doesNotMatch(insult.text, /hand drops to the club/, "no offended reaction before the end");
  assert.match(insult.text, /Enough\./);
});
