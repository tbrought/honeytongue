import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Persuadable, Game, ANGLES, defineCharacter, persuasionQuestions, readPersuasion, validateStory, StoryError, stripMarkup } from "../src/index.js";
import { fakeClient, harry } from "./helpers.js";

const story = () => JSON.parse(readFileSync(new URL("../stories/gatehouse.json", import.meta.url), "utf8"));
/** A scripted client that also answers the angle question (and says no clue matched). */
function angleClient({ angle = "other", p = 0.9, ...rest } = {}) {
  const client = fakeClient(rest);
  const ask = client.ask;
  Object.assign(client.next, { angle, angleP: p });
  client.ask = async (state, questions) => {
    const answers = await ask(state, questions);
    if (questions.angle) {
      const { angle: choice, angleP } = client.next;
      answers.angle = { type: "choice", choice, probabilities: Object.fromEntries(ANGLES.map((a) => [a, a === choice ? angleP : (1 - angleP) / 10])) };
    }
    if (questions.clue) answers.clue = { type: "choice", choice: "none", probabilities: { none: 0.95 } };
    return answers;
  };
  return client;
}

test("the angles are a fixed, public set: changing it changes every game's results, so it must be on purpose", () => {
  assert.deepEqual([...ANGLES], ["family", "compassion", "money", "benefit", "duty", "authority", "fear", "flattery", "honesty", "reason", "other"]);
  assert.ok(Object.isFrozen(ANGLES));
  const q = persuasionQuestions({ ...harry, angles: true }).angle;
  assert.deepEqual(Object.keys(q.criteria), [...ANGLES]);
  for (const [angle, text] of Object.entries(q.criteria)) assert.ok(text.length <= 255, angle);
});

test("only a character that asks for angles sends the angle question", () => {
  assert.equal(persuasionQuestions(harry).angle, undefined);
  assert.equal(defineCharacter(harry).angles, false);
  assert.throws(() => defineCharacter({ ...harry, angles: "yes" }), /"angles" must be true or false/);
  assert.throws(() => defineCharacter({ ...harry, angleAt: 2 }), /"angleAt" must be a probability/);
  assert.throws(() => defineCharacter({ ...harry, reactions: [{ min: 0, text: "Hm.", nearMiss: "yes" }] }), /"nearMiss" must be true or false/);
});

test("the angle is a signal on every judged result: the appeal, how sure, and every angle's probability", async () => {
  const answers = { persuasion: { score: 1 }, angle: { choice: "money", probabilities: { money: 0.7, honesty: 0.2 } } };
  const r = readPersuasion({ ...harry, angles: true }, answers);
  assert.equal(r.angle.angle, "money");
  assert.equal(r.angle.confidence, 0.7);
  assert.deepEqual(Object.keys(r.angle.probabilities), [...ANGLES]);
  assert.equal(r.angle.probabilities.honesty, 0.2);
  assert.equal(readPersuasion(harry, answers).angle, null, "not asked, not reported");
  assert.equal(readPersuasion({ ...harry, angles: true }, { angle: { choice: "bribery" } }).angle, null, "not an angle");

  const npc = new Persuadable({ ...harry, angles: true }, { client: angleClient({ score: 1, angle: "honesty" }) });
  assert.equal((await npc.attempt("I swear it's true")).angle.angle, "honesty");
  assert.equal((await npc.attempt("I swear it's true")).angle, null, "a repeat isn't sent to Jev, so it has no angle");
});

// ---- In stories ----------------------------------------------------------------

const withAngles = () => {
  const s = story();
  s.scenes.gate.npc.angleReplies = { money: ["@[Harry] waves the coin away.", "\"Keep it,\" @[Harry] says."], flattery: "@[Harry] snorts." };
  return s;
};

test("a story with angle replies asks for the angle; one without sends the same requests as before", () => {
  assert.ok(Game.requests(withAngles()).every((r) => !r.character || r.questions.angle));
  const plain = story();
  delete plain.scenes.gate.npc.angleReplies;
  assert.ok(Game.requests(plain).every((r) => !r.questions.angle));
});

test("a confident angle gets its reply, in turn; an unsure one, or one with no reply, gets the score band's reaction", async () => {
  const game = new Game(withAngles(), angleClient({ score: 0.5, angle: "money", p: 0.9 }));
  const said = [];
  for (const line of ["take this coin", "here's some silver", "gold for you"]) said.push((await game.turn(line)).text);
  assert.match(said[0], /waves the coin away/);
  assert.match(said[1], /Keep it/);
  assert.match(said[2], /waves the coin away/);

  const unsure = new Game(withAngles(), angleClient({ score: 0.5, angle: "money", p: 0.4 }));
  const r = await unsure.turn("take this coin, I suppose");
  assert.doesNotMatch(r.text, /coin away|Keep it/);
  assert.equal(r.attempt.angle.angle, "money", "the signal is still there for a game to use");

  const noReply = new Game(withAngles(), angleClient({ score: 0.5, angle: "duty", p: 0.9 }));
  assert.ok((await noReply.turn("it's your duty")).text.includes(stripMarkup(story().scenes.gate.npc.persuasion.reactions[0].text[0])));
});

test("a near-miss band keeps its hint, whatever the angle; offended and convinced turns aren't angle replies", async () => {
  const near = new Game(withAngles(), angleClient({ score: 2.2, angle: "money", p: 0.95 }));
  const hint = (await near.turn("take this coin, it's all I have")).text;
  assert.doesNotMatch(hint, /coin away|Keep it/);
  const band = story().scenes.gate.npc.persuasion.reactions.find((x) => x.nearMiss);
  assert.ok(band, "Harry's hint band is marked nearMiss");
  assert.ok(band.text.some((t) => hint.includes(stripMarkup(t))), hint);

  const rude = new Game(withAngles(), angleClient({ score: 0.5, angle: "money", insults: 0.95 }));
  assert.doesNotMatch((await rude.turn("take the coin, you oaf")).text, /coin away|Keep it/);
  const won = new Game(withAngles(), angleClient({ score: 3.9, angle: "money" }));
  assert.match((await won.turn("a fortune for you")).text, /lifts the bar/);
});

test("validateStory checks angle replies: real angles only, never \"other\", and each with text", () => {
  const s = story();
  s.scenes.gate.npc.angleReplies = { bribery: "No.", other: "Hm.", money: [] };
  const err = (() => { try { validateStory(s); } catch (e) { return e; } })();
  assert.ok(err instanceof StoryError);
  assert.ok(err.problems.some((p) => /"angleReplies" has "bribery", which isn't an angle/.test(p)), err.message);
  assert.ok(err.problems.some((p) => /"angleReplies" has "other"/.test(p)), err.message);
  assert.ok(err.problems.some((p) => /angle reply "money" must be a non-empty string/.test(p)), err.message);
});

test("every demo character has angle replies, and a near-miss band that keeps its hints", () => {
  for (const file of ["gatehouse", "goblin-camp", "lighthouse", "tidy-profit"]) {
    const s = JSON.parse(readFileSync(new URL(`../stories/${file}.json`, import.meta.url), "utf8"));
    const npc = Object.values(s.scenes).find((x) => x.npc).npc;
    assert.ok(Object.keys(npc.angleReplies).length >= 5, file);
    const reactions = npc.persuasion.reactions;
    const top = reactions.reduce((a, b) => (b.min > a.min ? b : a));
    assert.equal(top.nearMiss, true, `${file}: the top band is the near miss`);
    assert.equal(reactions.filter((r) => r.nearMiss).length, 1, file);
  }
});
