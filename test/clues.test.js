import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Persuadable, Game, defineCharacter, persuasionQuestions, readPersuasion, judgePersuasion, validateStory, StoryError, stripMarkup } from "../src/index.js";
import { fakeClient, harry } from "./helpers.js";

const story = () => JSON.parse(readFileSync(new URL("../stories/gatehouse.json", import.meta.url), "utf8"));
const guard = {
  ...harry,
  patience: 4,
  secrets: [{ id: "sick_daughter", fact: "His daughter has a fever." }],
  clues: [{ id: "family", when: "Asks about or guesses at his family", reveals: "sick_daughter" }],
};
/** A scripted client that also answers the clue question: `clue` is the matched clue id, or "none". */
function clueClient({ clue = "none", p = 0.9, ...rest } = {}) {
  const client = fakeClient(rest);
  const ask = client.ask;
  client.next.clue = clue;
  client.next.clueP = p;
  client.ask = async (state, questions) => {
    const answers = await ask(state, questions);
    if (questions.clue) {
      const choice = client.next.clue;
      answers.clue = { type: "choice", choice, probabilities: { [choice]: client.next.clueP } };
    }
    return answers;
  };
  return client;
}

test("a character without clues sends exactly what it did before; one with clues adds a single clue question", () => {
  assert.deepEqual(Object.keys(persuasionQuestions(harry)), ["persuasion", "threats", "insults"]);
  const q = persuasionQuestions(guard).clue;
  assert.equal(q.type, "choice");
  assert.deepEqual(q.criteria, { none: q.criteria.none, family: "Asks about or guesses at his family" });
  assert.equal(defineCharacter(harry).clueAt, 0.6);
});

test("clues are checked when a character is defined", () => {
  const bad = (clues, extra = {}) => () => defineCharacter({ ...guard, ...extra, clues });
  assert.throws(bad([{ id: "family", when: "x" }]), /"clues" must be an array of \{ id, when, reveals \}/);
  assert.throws(bad([{ id: "none", when: "x", reveals: "sick_daughter" }]), /can't be called "none"/);
  assert.throws(bad([guard.clues[0], guard.clues[0]]), /two clues are called "family"/);
  assert.throws(bad([{ id: "family", when: "x", reveals: "lost_boat" }]), /reveals "lost_boat", which isn't one of its secrets \("sick_daughter"\)/);
  assert.throws(bad([{ id: "family", when: "x".repeat(256), reveals: "sick_daughter" }]), /keep it to 255/);
  assert.throws(() => defineCharacter({ ...guard, clueAt: 0 }), /"clueAt" must be a probability/);
});

test("a clue is a signal on every result: which clue, what it reveals, how sure, and whether it's news", () => {
  const answers = { persuasion: { score: 1 }, clue: { type: "choice", choice: "family", probabilities: { family: 0.8 } } };
  assert.deepEqual(readPersuasion(guard, answers).clue, { id: "family", reveals: "sick_daughter", confidence: 0.8, revealed: true });
  assert.equal(readPersuasion(guard, answers, { knows: ["sick_daughter"] }).clue.revealed, false, "already learned");
  assert.equal(readPersuasion(guard, { ...answers, clue: { choice: "family", probabilities: { family: 0.5 } } }).clue, null, "below clueAt");
  assert.equal(readPersuasion(guard, { ...answers, clue: { choice: "none", probabilities: { none: 0.9 } } }).clue, null);
  assert.equal(readPersuasion(harry, answers).clue, null, "no clues, no clue");
  assert.equal(readPersuasion(guard, { ...answers, insults: { noul: 0.95 } }).clue.revealed, false, "an insult reveals nothing");
});

test("the attempt that reveals a secret is free; later lines matching the same clue are judged and charged as usual", async () => {
  const client = clueClient({ score: 1, clue: "family" });
  const npc = new Persuadable(guard, { client });
  const first = await npc.attempt("is that your son's toy?");
  assert.equal(first.verdict, "unconvinced");
  assert.deepEqual(first.clue, { id: "family", reveals: "sick_daughter", confidence: 0.9, revealed: true });
  assert.equal(first.patienceLeft, 4, "the reveal costs no patience");
  assert.deepEqual([...npc.knows], ["sick_daughter"]);
  // A player farming the clue with more family-themed lines gets nothing for free.
  const lines = ["how is your family doing?", "do you have kids at home?", "your wife must worry about you"];
  for (const [i, line] of lines.entries()) {
    const r = await npc.attempt(line);
    assert.equal(r.clue.revealed, false, line);
    assert.equal(r.patienceLeft, 3 - i, line);
  }
  assert.equal(npc.patienceLeft, 1, "three charged lines after the free reveal");
});

test("an offensive line reveals nothing, even when decide() is what makes it offensive", async () => {
  const client = clueClient({ score: 1, clue: "family", insults: 0.95 });
  const npc = new Persuadable(guard, { client });
  const r = await npc.attempt("your brat's toy is ugly");
  assert.equal(r.verdict, "offended");
  assert.equal(r.clue.revealed, false);
  assert.deepEqual([...npc.knows], []);

  const strict = new Persuadable({ ...guard, decide: () => "offended" }, { client: clueClient({ score: 1, clue: "family" }) });
  const s = await strict.attempt("how's your family?");
  assert.equal(s.clue.revealed, false);
  assert.equal(s.patienceLeft, 2, "charged as offended");
});

test("judgePersuasion reports a clue without learning anything, using the knows it was given", async () => {
  const client = clueClient({ score: 1, clue: "family" });
  assert.equal((await judgePersuasion(client, guard, "how's your family?")).clue.revealed, true);
  assert.equal((await judgePersuasion(client, guard, "how's your family?", { knows: ["sick_daughter"] })).clue.revealed, false);
});

test("a repeated line asks nothing, so it carries no clue", async () => {
  const client = clueClient({ score: 1, clue: "none" });
  const npc = new Persuadable(guard, { client });
  await npc.attempt("let me through, I beg you");
  client.next.clue = "family";
  const again = await npc.attempt("let me through, I beg you");
  assert.equal(again.verdict, "repeated");
  assert.equal(again.clue, null);
});

// ---- In stories ----------------------------------------------------------------

test("in a story, a persuasion attempt that reveals the secret gets the clue's reply, sets the flag, and costs nothing", async () => {
  const game = new Game(story(), clueClient({ score: 1, clue: "family_at_home" }));
  const r = await game.turn("is that your son's horse?");
  assert.match(r.text, /fever three days/);
  assert.doesNotMatch(r.text, /keeping this job|Curfew's curfew|all say at this hour/, "the clue's reply, not the band reaction");
  assert.ok(game.flags.has("knows_daughter_is_sick"));
  assert.equal(r.attempt.clue.revealed, true);
  assert.equal(game.npc.patienceLeft, 6);
  // Family-themed lines after that get ordinary replies and cost patience.
  const again = await game.turn("tell me about your children");
  assert.doesNotMatch(again.text, /fever three days/);
  assert.equal(again.attempt.clue.revealed, false);
  assert.equal(game.npc.patienceLeft, 5);
});

test("a chat action that teaches the secret itself isn't repeated by the clue", async () => {
  const game = new Game(story(), clueClient({ action: "chat_guard", clue: "family_at_home" }));
  const r = await game.turn("ask Harry about his family");
  assert.equal((r.text.match(/fever three days/g) ?? []).length, 1, "one reveal: the chat's own");
  assert.ok(game.flags.has("knows_daughter_is_sick"));
});

test("another action with a matching line reveals the secret after the action's own text", async () => {
  const game = new Game(story(), clueClient({ action: "read_letter", clue: "family_at_home" }));
  const r = await game.turn("read the letter, and ask if it's for his kid");
  assert.match(r.text, /wax seal[\s\S]*fever three days/);
  assert.ok(game.flags.has("knows_daughter_is_sick"));
  assert.equal(r.attempt, null, "not a persuasion attempt");
  assert.equal(game.npc.patienceLeft, 6);
});

test("a hostile line reveals nothing in a story either", async () => {
  const game = new Game(story(), clueClient({ action: "chat_guard", clue: "family_at_home", insults: 0.95 }));
  game.story.scenes.gate.actions.chat_guard = { ...game.story.scenes.gate.actions.chat_guard, setFlags: [] };
  const r = await game.turn("how's your snivelling brat?");
  assert.equal(game.flags.has("knows_daughter_is_sick"), false);
  assert.match(r.text, /club|cell|keys/);
});

test("validateStory needs a reply for every clue, and no replies for clues that don't exist", () => {
  const s = story();
  s.scenes.gate.npc.clueReplies = { family_at_home: [], stranger: "Hm." };
  const err = (() => { try { validateStory(s); } catch (e) { return e; } })();
  assert.ok(err instanceof StoryError);
  assert.ok(err.problems.some((p) => /clue "family_at_home" needs a reply in "clueReplies"/.test(p)), err.message);
  assert.ok(err.problems.some((p) => /"clueReplies" has "stranger", which isn't one of the npc's clues/.test(p)), err.message);
  const marked = story();
  marked.scenes.gate.npc.persuasion.clues[0].when = "Asks about @[Harry]'s family";
  assert.throws(() => validateStory(marked), /markup .* only works in text players read/);
});

test("every demo scene's clue reveals that scene's secret, with a reply for it", () => {
  for (const file of ["gatehouse", "goblin-camp", "lighthouse", "tidy-profit"]) {
    const s = JSON.parse(readFileSync(new URL(`../stories/${file}.json`, import.meta.url), "utf8"));
    const npc = Object.values(s.scenes).find((x) => x.npc).npc;
    assert.equal(npc.persuasion.clues.length, 1, file);
    const [clue] = npc.persuasion.clues;
    assert.equal(clue.reveals, npc.secrets[0].id, file);
    assert.ok(stripMarkup([npc.clueReplies[clue.id]].flat()[0]).length > 20, file);
  }
});
