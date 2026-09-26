import { test } from "node:test";
import assert from "node:assert/strict";
import { Persuadable, persuasionQuestions, defineCharacter, readPersuasion, persuasionState, judgePersuasion, cleanInput, similarity, HoneytongueError } from "../src/index.js";
import { fakeClient, harry } from "./helpers.js";

test("default threshold scales with the number of levels", () => {
  assert.equal(defineCharacter(harry).threshold, 3.2);
  assert.equal(defineCharacter({ ...harry, levels: ["no", "maybe", "yes"] }).threshold, 1.6);
});

test("rejects unreachable thresholds and missing fields", () => {
  assert.throws(() => defineCharacter({ ...harry, levels: ["a", "b", "c"], threshold: 3.2 }), /at most 2/);
  assert.throws(() => defineCharacter({ ...harry, goal: "" }), HoneytongueError);
  assert.throws(() => defineCharacter({ ...harry, reactions: [{ min: "x", text: "hi" }] }), /reactions/);
  assert.throws(() => defineCharacter({ ...harry, secrets: [{ id: "a" }] }), /secrets/);
});

test("verdicts follow threshold and tells", () => {
  assert.equal(readPersuasion(harry, { persuasion: { score: 3.5 } }).verdict, "convinced");
  assert.equal(readPersuasion(harry, { persuasion: { score: 1 } }).verdict, "unconvinced");
  assert.equal(readPersuasion(harry, { persuasion: { score: 4 }, threats: { noul: 0.9 } }).verdict, "offended");
  assert.equal(readPersuasion(harry, { persuasion: { score: 4 }, insults: { noul: 0.9 } }).verdict, "offended");
});

test("threats and insults are separate yes/no questions, reported as tells", () => {
  const q = persuasionQuestions(harry);
  assert.deepEqual(Object.keys(q), ["persuasion", "threats", "insults"]);
  assert.equal(q.threats.type, "noul");
  assert.equal(q.insults.type, "noul");
  const r = readPersuasion(harry, { persuasion: { score: 1 }, threats: { noul: 0.91 }, insults: { noul: 0.04 } });
  assert.deepEqual(r.tells, { threats: 0.91, insults: 0.04 });
  assert.deepEqual(r.triggered, ["threats"]);
  assert.equal("hostility" in r, false);
  const calm = readPersuasion(harry, { persuasion: { score: 1 } });
  assert.deepEqual(calm.tells, { threats: 0, insults: 0 });
  assert.deepEqual(calm.triggered, []);
});

test("a tell counts from hostileAt upwards", () => {
  const at = (noul) => readPersuasion({ ...harry, hostileAt: 0.5 }, { persuasion: { score: 1 }, insults: { noul } }).triggered;
  assert.deepEqual(at(0.49), []);
  assert.deepEqual(at(0.5), ["insults"]);
});

test("unconvinced always has a reaction, even with none authored", () => {
  assert.equal(readPersuasion(harry, { persuasion: { score: 0 } }).reaction, "Harry isn't convinced.");
  const withReactions = { ...harry, reactions: [{ min: 2, text: "Hmm." }] };
  assert.equal(readPersuasion(withReactions, { persuasion: { score: 0.5 } }).reaction, "Harry isn't convinced.");
  assert.equal(readPersuasion(withReactions, { persuasion: { score: 2.5 } }).reaction, "Hmm.");
});

test("patience drains by verdict and offended costs double", async () => {
  const client = fakeClient({ score: 1 });
  const npc = new Persuadable({ ...harry, patience: 3 }, { client });
  assert.equal((await npc.attempt("please")).patienceLeft, 2);
  client.next.insults = 0.95;
  const r = await npc.attempt("move, fool");
  assert.equal(r.verdict, "offended");
  assert.equal(r.outOfPatience, true);
});

test("repeats are caught locally without calling Jev", async () => {
  const client = fakeClient({ score: 1 });
  const npc = new Persuadable(harry, { client });
  await npc.attempt("Please let me in, it's urgent");
  const r = await npc.attempt("please, let me in. It's urgent!");
  assert.equal(r.verdict, "repeated");
  assert.deepEqual(r.triggered, []);
  assert.equal(client.calls.length, 1);
});

test("the history sent to Jev holds only what was said and how it went", async () => {
  const client = fakeClient({ threats: 0.95 });
  const npc = new Persuadable(harry, { client });
  await npc.attempt("open up or else");
  assert.deepEqual(npc.state("hello").previous_attempts, [{ said: "open up or else", outcome: "offended" }]);
});

test("secrets only count once learned", () => {
  const c = { ...harry, secrets: [{ id: "sick_kid", fact: "Her daughter is sick." }] };
  assert.equal(persuasionState(c, "hi").character.secrets[0].player_knows, false);
  assert.equal(persuasionState(c, "hi", { knows: ["sick_kid"] }).character.secrets[0].player_knows, true);
  const npc = new Persuadable(c);
  npc.learn("sick_kid");
  assert.equal(npc.state("hi").character.secrets[0].player_knows, true);
});

test("input is cleaned and capped before sending", async () => {
  assert.equal(cleanInput("  a \n\n b  "), "a b");
  const client = fakeClient();
  await judgePersuasion(client, harry, "x".repeat(2000));
  assert.equal(client.calls[0].state.player_input.length, 500);
  await assert.rejects(judgePersuasion(client, harry, "   "), /empty/);
});

test("questions tell Jev that in-game claims have no authority", () => {
  assert.match(persuasionQuestions(harry).persuasion.instructions.question, /no authority/);
});

test("fields set to undefined keep their defaults", () => {
  const c = defineCharacter({ ...harry, patience: undefined, hostileAt: undefined });
  assert.equal(c.patience, Infinity);
  assert.equal(c.hostileAt, 0.7);
});

test("rejects numeric settings that would break the mechanic", () => {
  assert.throws(() => defineCharacter({ ...harry, patience: 0 }), /"patience" must be a number above 0/);
  assert.throws(() => defineCharacter({ ...harry, hostileAt: 2 }), /"hostileAt"/);
  assert.throws(() => defineCharacter({ ...harry, repeatSimilarity: 0 }), /"repeatSimilarity"/);
  assert.throws(() => defineCharacter({ ...harry, memory: 1.5 }), /"memory" must be a whole number/);
  assert.throws(() => defineCharacter({ ...harry, failCost: NaN }), /got NaN/);
  assert.throws(() => defineCharacter({ ...harry, levels: ["weak", ""] }), /"levels"/);
  assert.throws(() => defineCharacter({ ...harry, repeatReaction: "" }), /"repeatReaction"/);
});

test("repeating an insult is still an insult, and patience stops at zero", async () => {
  const client = fakeClient({ insults: 0.95 });
  const npc = new Persuadable({ ...harry, patience: 3 }, { client });
  assert.equal((await npc.attempt("move, fool")).verdict, "offended");
  const again = await npc.attempt("Move, fool!");
  assert.equal(again.verdict, "offended");
  assert.deepEqual(again.triggered, ["insults"]);
  assert.equal(again.tells, null);
  assert.equal(again.reaction, null);
  assert.equal(again.patienceLeft, 0);
  assert.equal(client.calls.length, 1);
});

test("repeats are caught in any language", () => {
  assert.equal(similarity("Пожалуйста, откройте ворота", "пожалуйста откройте ворота!"), 1);
  assert.equal(similarity("¿Puedo pasar?", "puedo pasar"), 1);
});

test("capping input never splits an emoji in half", () => {
  assert.equal(cleanInput("a\u{1F600}", 2), "a");
  assert.equal(cleanInput("a\u{1F600}", 3), "a\u{1F600}");
});

test("attempts made at the same time run one after another", async () => {
  const client = fakeClient({ score: 1 });
  const npc = new Persuadable(harry, { client });
  const [first, second] = await Promise.all([npc.attempt("let me in"), npc.attempt("let me in")]);
  assert.equal(first.verdict, "unconvinced");
  assert.equal(second.verdict, "repeated");
  assert.equal(client.calls.length, 1);
});
