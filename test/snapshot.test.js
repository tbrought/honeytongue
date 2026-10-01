import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Persuadable, Game, HoneytongueError } from "../src/index.js";
import { fakeClient, harry } from "./helpers.js";

const story = () => JSON.parse(readFileSync(new URL("../stories/gatehouse.json", import.meta.url), "utf8"));
const viaJson = (value) => JSON.parse(JSON.stringify(value)); // what a save file does to it
const character = {
  ...harry,
  patience: 6,
  secrets: [{ id: "sick_daughter", fact: "His daughter is ill." }],
  reactions: [{ min: 0, text: ["Low one.", "Low two.", "Low three."] }],
  repeatReaction: ["Again?", "Still again?"],
};

test("a Persuadable's snapshot is plain JSON that restores its memory, patience, secrets, and reply rotation", async () => {
  const client = fakeClient({ score: 1 });
  const npc = new Persuadable(character, { client });
  await npc.attempt("the river is high tonight");
  client.next.insults = 0.95;
  await npc.attempt("move aside, you oaf");
  client.next.insults = 0.01;
  npc.learn("sick_daughter");
  const saved = viaJson(npc.snapshot());
  assert.deepEqual(Object.keys(saved), ["format", "kind", "character", "attempts", "knows", "patienceLeft", "convinced", "replies"]);
  assert.deepEqual(saved.attempts[1], { said: "move aside, you oaf", outcome: "offended", triggered: ["insults"] });

  const copy = new Persuadable(character, { client }).restore(saved);
  assert.deepEqual(copy.attempts, npc.attempts);
  assert.deepEqual([...copy.knows], ["sick_daughter"]);
  assert.equal(copy.patienceLeft, npc.patienceLeft);
  assert.equal(copy.convinced, false);
  // It carries on exactly as the original would: the next variant, the same repeat check, a repeated insult.
  for (const who of [npc, copy]) {
    assert.equal((await who.attempt("my cart broke a wheel")).reaction, "Low two.");
    assert.equal((await who.attempt("the river is high tonight")).verdict, "repeated");
    const again = await who.attempt("move aside, you oaf");
    assert.equal(again.verdict, "offended");
    assert.deepEqual(again.triggered, ["insults"]);
  }
  assert.deepEqual(copy.snapshot(), npc.snapshot());
});

test("unlimited patience survives JSON, which has no Infinity", () => {
  const npc = new Persuadable(harry, { client: fakeClient() });
  const saved = viaJson(npc.snapshot());
  assert.equal(saved.patienceLeft, null);
  assert.equal(new Persuadable(harry, { client: fakeClient() }).restore(saved).patienceLeft, Infinity);
});

test("restoring a Persuadable checks the snapshot, says what's wrong, and leaves the character as it was", async () => {
  const npc = new Persuadable(character, { client: fakeClient({ score: 1 }) });
  await npc.attempt("the river is high tonight");
  const good = viaJson(npc.snapshot());
  const target = new Persuadable(character, { client: fakeClient() });
  const cases = [
    [null, /isn't a Honeytongue snapshot/],
    [{ ...good, format: 2 }, /newer version of Honeytongue \(snapshot format 2\).*Update Honeytongue/],
    [{ ...good, format: "1" }, /"format" should be 1/],
    [{ ...good, kind: "game" }, /a game's \(Game\) snapshot.*game\.restore\(\)/],
    [{ ...good, character: "Nib" }, /for "Nib", not "Harry"/],
    [{ ...good, patienceLeft: 9 }, /"patienceLeft" should be a number from 0 to 6 \(Harry's patience\)/],
    [{ ...good, patienceLeft: null }, /"patienceLeft"/],
    [{ ...good, attempts: [{ said: "hi", outcome: "maybe" }] }, /"attempts"/],
    [{ ...good, attempts: [{ said: "hi", outcome: "offended", triggered: ["rudeness"] }] }, /"attempts"/],
    [{ ...good, knows: "sick_daughter" }, /"knows" should be a list of Harry's secret ids \(their secrets are "sick_daughter"\)/],
    [{ ...good, knows: ["sick_daugter"] }, /"knows" should be a list of Harry's secret ids/],
    [{ ...good, convinced: "no" }, /"convinced" should be true or false/],
    [{ ...good, replies: { "from 0": -1 } }, /"replies"/],
  ];
  for (const [bad, message] of cases) {
    assert.throws(() => target.restore(bad), (e) => e instanceof HoneytongueError && message.test(e.message) && /^Can't restore Harry: /.test(e.message), JSON.stringify(bad)?.slice(0, 80));
    assert.equal(target.attempts.length, 0, "a failed restore changes nothing");
    assert.equal(target.patienceLeft, 6);
  }
});

test("a Game's snapshot restores the scene, items, flags, recent turns, characters, and reply rotation", async () => {
  const s = story();
  s.scenes.gate.npc.hostileReaction = ["@[Harry] glares.", "@[Harry] grips his club.", "@[Harry] spits."];
  const play = async (game, lines) => {
    const out = [];
    for (const [line, next] of lines) { game.jev.next = { ...game.jev.next, ...next }; out.push((await game.turn(line)).text); }
    return out;
  };
  const game = new Game(s, fakeClient({ score: 1 }));
  await play(game, [["read the letter", { action: "read_letter" }], ["let me in", { action: "persuade_guard" }],
    ["open up, idiot", { insults: 0.95 }]]);
  const saved = viaJson(game.snapshot());
  assert.equal(saved.kind, "game");
  assert.equal(saved.scene, "gate");
  assert.deepEqual(saved.flags, ["knows_letter_is_for_apothecary"]);
  assert.deepEqual(Object.keys(saved.npcs), ["harry"]);
  assert.equal(saved.history.length, 3);

  const copy = new Game(s, fakeClient({ score: 1 })).restore(saved);
  assert.equal(copy.sceneId, game.sceneId);
  assert.deepEqual(copy.inventory, game.inventory);
  assert.deepEqual([...copy.flags], [...game.flags]);
  assert.deepEqual(copy.history, game.history);
  assert.equal(copy.npc.patienceLeft, game.npc.patienceLeft);
  // Both carry on the same way: the next hostile variant, the same repeat check, and the same ending.
  const rest = [["open up, idiot", { insults: 0.95 }], ["let me in", { insults: 0.01 }], ["please, it's urgent", {}], ["come on", {}]];
  assert.deepEqual(await play(copy, rest), await play(game, rest));
  assert.equal(copy.over, game.over);
  assert.deepEqual(copy.snapshot(), game.snapshot());
});

test("a snapshot taken mid-question restores the question", async () => {
  const game = new Game(story(), fakeClient());
  game.pending = { options: ["chat_guard", "persuade_guard"], input: "talk to Harry", answers: { action: { type: "choice", choice: "chat_guard" } } };
  const copy = new Game(story(), fakeClient()).restore(viaJson(game.snapshot()));
  assert.deepEqual(copy.pending, game.pending);
});

test("restoring a Game checks the snapshot, says what's wrong, and leaves the game as it was", async () => {
  const game = new Game(story(), fakeClient({ score: 1 }));
  await game.turn("let me in");
  const good = viaJson(game.snapshot());
  const cases = [
    [{ ...good, kind: "persuadable" }, /a character's \(Persuadable\) snapshot.*npc\.restore\(\)/],
    [{ ...good, story: "THE GOBLIN CAMP" }, /of the story "THE GOBLIN CAMP", not "THE GATEHOUSE"/],
    [{ ...good, scene: "moon" }, /"scene" should be the id of a scene in this story/],
    [{ ...good, inventory: [1] }, /"inventory"/],
    [{ ...good, history: Array(5).fill({ player: "x", result: "y" }) }, /"history" should be a list of at most 4/],
    [{ ...good, pending: { options: ["fly_away"], input: "fly", answers: {} } }, /"pending"/],
    [{ ...good, npcs: { nib: good.npcs.harry } }, /"npcs".*\(harry\)/],
    [{ ...good, npcs: { harry: { ...good.npcs.harry, patienceLeft: 99 } } }, /Can't restore Harry Goatleaf: .*"patienceLeft"/],
    [{ ...good, over: "yes" }, /"over"/],
  ];
  const target = new Game(story(), fakeClient());
  for (const [bad, message] of cases) {
    assert.throws(() => target.restore(bad), (e) => e instanceof HoneytongueError && message.test(e.message), JSON.stringify(bad).slice(0, 80));
    assert.equal(target.history.length, 0, "a failed restore changes nothing");
    assert.equal(target.npcs.size, 0);
  }
});
