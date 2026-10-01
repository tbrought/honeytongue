import { test } from "node:test";
import assert from "node:assert/strict";
import { Persuadable, persuasionQuestions, defineCharacter, readPersuasion, persuasionState, judgePersuasion, cleanInput, similarity, HoneytongueError } from "../src/index.js";
import { fakeClient, harry } from "./helpers.js";
import { createMockClient } from "../src/mock.js";

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

test("a reply may be a list of variants: a Persuadable uses each band's in turn, and judging once gives the first", async () => {
  const c = {
    ...harry,
    reactions: [{ min: 0, text: ["Low one.", "Low two."] }, { min: 2, text: ["High one.", "High two.", "High three."] }],
    repeatReaction: ["Again?", "Still again?"],
  };
  assert.equal(readPersuasion(c, { persuasion: { score: 2.5 } }).reaction, "High one.");
  const client = fakeClient({ score: 2.5 });
  assert.equal((await judgePersuasion(client, c, "the river is high")).reaction, "High one.");

  const npc = new Persuadable(c, { client });
  const said = [];
  for (const [line, score] of [["the river is high", 2.5], ["my cart broke down", 0.5], ["a storm is coming in", 2.5],
    ["I carry a letter for the mayor", 2.5], ["my aunt waits for me inside", 2.5], ["every inn out here is full", 0.5],
    ["every inn out here is full", 0], ["every inn out here is full", 0], ["every inn out here is full", 0]]) {
    client.next.score = score;
    said.push((await npc.attempt(line)).reaction);
  }
  assert.deepEqual(said, ["High one.", "Low one.", "High two.", "High three.", "High one.", "Low two.", "Again?", "Still again?", "Again?"]);
  npc.reset();
  client.next.score = 2.5;
  assert.equal((await npc.attempt("the river is high")).reaction, "High one.", "reset() starts the variants again");
});

test("reply variants must be a non-empty list of text", () => {
  for (const bad of [[], [""], ["ok", 3]]) {
    assert.throws(() => defineCharacter({ ...harry, reactions: [{ min: 0, text: bad }] }), /"reactions".*list of strings/);
    assert.throws(() => defineCharacter({ ...harry, repeatReaction: bad }), /"repeatReaction".*list of them/);
  }
  assert.doesNotThrow(() => defineCharacter({ ...harry, reactions: [{ min: 0, text: ["One.", "Two."] }], repeatReaction: ["Again?"] }));
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

test("secrets are only sent to Jev once learned", () => {
  const c = { ...harry, secrets: [{ id: "sick_kid", fact: "Her daughter is sick." }, { id: "debt", fact: "He owes the captain money." }] };
  assert.equal(persuasionState(c, "hi").character.secrets, undefined, "nothing learned, nothing sent");
  assert.deepEqual(persuasionState(c, "hi", { knows: ["sick_kid"] }).character.secrets, [{ fact: "Her daughter is sick.", player_knows: true }]);
  assert.doesNotMatch(JSON.stringify(persuasionState(c, "hi", { knows: ["sick_kid"] })), /owes the captain/);
  const npc = new Persuadable(c);
  npc.learn("sick_kid");
  assert.throws(() => npc.learn("sick_kidd"), /Harry has no secret "sick_kidd" to learn: their secrets are "sick_kid", "debt"/);
  assert.throws(() => new Persuadable(harry).learn("x"), /they have no secrets/);
  assert.deepEqual([...npc.knows], ["sick_kid"], "a refused id isn't learned");
  assert.deepEqual(npc.state("hi").character.secrets.map((s) => s.fact), ["Her daughter is sick."]);
  assert.doesNotMatch(JSON.stringify(persuasionQuestions(c)), /player_knows/, "the questions don't need to explain unlearned secrets");
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

test("offendedBy defaults to both tells, and the default questions don't mention pressure", () => {
  assert.deepEqual(defineCharacter(harry).offendedBy, ["threats", "insults"]);
  assert.doesNotMatch(persuasionQuestions(harry).persuasion.instructions.question, /not automatically weak/);
});

test("each offendedBy setting decides which tells offend", () => {
  const answers = {
    none: {},
    threats: { threats: { noul: 0.9 } },
    insults: { insults: { noul: 0.9 } },
    both: { threats: { noul: 0.9 }, insults: { noul: 0.9 } },
  };
  // offendedBy -> verdict for each kind of input, all with a convincing score.
  const table = [
    [undefined, { none: "convinced", threats: "offended", insults: "offended", both: "offended" }],
    [["insults"], { none: "convinced", threats: "convinced", insults: "offended", both: "offended" }],
    [["threats"], { none: "convinced", threats: "offended", insults: "convinced", both: "offended" }],
    [[], { none: "convinced", threats: "convinced", insults: "convinced", both: "convinced" }],
  ];
  const triggered = { none: [], threats: ["threats"], insults: ["insults"], both: ["threats", "insults"] };
  for (const [offendedBy, expected] of table) {
    for (const [kind, verdict] of Object.entries(expected)) {
      const r = readPersuasion({ ...harry, offendedBy }, { persuasion: { score: 4 }, ...answers[kind] });
      const label = `offendedBy ${JSON.stringify(offendedBy)}, ${kind}`;
      assert.equal(r.verdict, verdict, label);
      assert.deepEqual(r.triggered, triggered[kind], label);
      assert.deepEqual(r.tells, { threats: answers[kind].threats ? 0.9 : 0, insults: answers[kind].insults ? 0.9 : 0 }, label);
    }
  }
});

test("tells and triggered are reported on every verdict", async () => {
  const client = fakeClient({ score: 1, threats: 0.9 });
  const npc = new Persuadable({ ...harry, offendedBy: ["insults"] }, { client });
  const unconvinced = await npc.attempt("open it or else");
  assert.equal(unconvinced.verdict, "unconvinced");
  assert.deepEqual(unconvinced.triggered, ["threats"]);
  assert.equal(unconvinced.tells.threats, 0.9);
  const repeated = await npc.attempt("Open it, or else!");
  assert.equal(repeated.verdict, "repeated");
  assert.deepEqual(repeated.triggered, []);
  assert.equal(repeated.tells, null);
  client.next = { ...client.next, threats: 0.01, insults: 0.9 };
  const offended = await npc.attempt("you worm");
  assert.equal(offended.verdict, "offended");
  assert.deepEqual(offended.triggered, ["insults"]);
  client.next = { ...client.next, insults: 0.01, threats: 0.95, score: 4 };
  const convinced = await npc.attempt("I'll break your arm");
  assert.equal(convinced.verdict, "convinced");
  assert.deepEqual(convinced.triggered, ["threats"]);
  assert.deepEqual(convinced.tells, { threats: 0.95, insults: 0.01 });
});

test("tells a character isn't offended by are left to the persona", () => {
  const q = (offendedBy) => persuasionQuestions({ ...harry, offendedBy }).persuasion.instructions.question;
  assert.match(q(["insults"]), /Threats or intimidation are not automatically weak/);
  assert.doesNotMatch(q(["insults"]), /insults or mockery/i);
  assert.match(q(["threats"]), /Insults or mockery are not automatically weak/);
  assert.match(q([]), /Threats or intimidation and insults or mockery are not automatically weak/);
});

test("offendedBy is validated, and duplicates are dropped", () => {
  assert.throws(() => defineCharacter({ ...harry, offendedBy: ["threat"] }), /"offendedBy" must be an array of "threats" and\/or "insults".*got "threat"/);
  assert.throws(() => defineCharacter({ ...harry, offendedBy: "insults" }), /"offendedBy".*got "insults"/);
  assert.throws(() => defineCharacter({ ...harry, offendedBy: [null] }), /"offendedBy".*got null/);
  assert.deepEqual(defineCharacter({ ...harry, offendedBy: ["insults", "threats", "insults"] }).offendedBy, ["threats", "insults"]);
  const once = defineCharacter({ ...harry, offendedBy: ["insults"] });
  assert.deepEqual(defineCharacter(once).offendedBy, ["insults"]);
});

test("the mock lets a timid persona cave to threats only when threats don't offend", async () => {
  const mock = createMockClient();
  const goblin = { name: "Snag", persona: "A cowardly goblin guard who hates being laughed at.", goal: "Unlock the cage" };
  const threat = "Open this cage or I'll gut you";
  assert.equal((await judgePersuasion(mock, { ...goblin, offendedBy: ["insults"] }, threat)).verdict, "convinced");
  assert.equal((await judgePersuasion(mock, goblin, threat)).verdict, "offended");
  const brave = { ...goblin, persona: "A grizzled veteran guard.", offendedBy: [] };
  assert.equal((await judgePersuasion(mock, brave, threat)).verdict, "unconvinced");
});

test("difficulty words map to a share of the top rubric score", () => {
  const three = ["no", "maybe", "yes"];
  for (const [difficulty, five, onThree] of [["easy", 2.4, 1.2], ["normal", 3.2, 1.6], ["hard", 3.6, 1.8], ["very hard", 3.8, 1.9]]) {
    assert.equal(defineCharacter({ ...harry, difficulty }).threshold, five, difficulty);
    assert.equal(defineCharacter({ ...harry, difficulty, levels: three }).threshold, onThree, `${difficulty} on 3 levels`);
  }
  assert.equal(defineCharacter(harry).threshold, defineCharacter({ ...harry, difficulty: "normal" }).threshold);
  assert.equal(defineCharacter({ ...harry, difficulty: undefined }).threshold, 3.2);
});

test("difficulty words ignore case, surrounding spaces, and very-hard or very_hard", () => {
  for (const [word, canonical, threshold] of [
    ["Hard", "hard", 3.6], ["  EASY ", "easy", 2.4], ["Normal", "normal", 3.2],
    ["very-hard", "very hard", 3.8], ["very_hard", "very hard", 3.8], ["Very Hard", "very hard", 3.8], ["very  hard", "very hard", 3.8],
  ]) {
    const c = defineCharacter({ ...harry, difficulty: word });
    assert.equal(c.difficulty, canonical, JSON.stringify(word));
    assert.equal(c.threshold, threshold, JSON.stringify(word));
  }
});

test("difficulty rejects unknown words and a threshold that disagrees with it", () => {
  for (const word of ["medium", "veryhard", "very hard!", "", "   ", 3, null, ["hard"]]) {
    assert.throws(() => defineCharacter({ ...harry, difficulty: word }),
      /"difficulty" must be one of "easy", "normal", "hard", or "very hard", got/, String(word));
  }
  assert.throws(() => defineCharacter({ ...harry, difficulty: "hard", threshold: 3 }),
    (e) => e instanceof HoneytongueError &&
      /set "difficulty" or "threshold", not both: difficulty "hard" is a threshold of 3.6 with 5 levels, but "threshold" is 3\. If you copied a defined character and changed its difficulty or levels, leave out its "threshold"/.test(e.message));
  // Checked against the rubric in use: 3.6 is "hard" on 5 levels, not on 3.
  assert.throws(() => defineCharacter({ ...harry, difficulty: "hard", threshold: 3.6, levels: ["no", "maybe", "yes"] }), /threshold of 1.8 with 3 levels/);
  // An invalid threshold is reported as such, not as a conflict.
  assert.throws(() => defineCharacter({ ...harry, difficulty: "hard", threshold: "3.6" }), /"threshold" must be above 0 and at most 4/);
});

test("difficulty and threshold can both be set when they agree", () => {
  const c = defineCharacter({ ...harry, difficulty: "Very_Hard", threshold: 3.8 });
  assert.equal(c.difficulty, "very hard");
  assert.equal(c.threshold, 3.8);
  assert.equal(defineCharacter({ ...harry, difficulty: "easy", threshold: 1.2, levels: ["no", "maybe", "yes"] }).threshold, 1.2);
});

test("a character defined with a difficulty word keeps it next to the threshold", () => {
  const once = defineCharacter({ ...harry, difficulty: "Hard" });
  assert.equal(once.difficulty, "hard");
  assert.equal(once.threshold, 3.6);
  assert.equal("difficulty" in defineCharacter(harry), false);
  assert.equal("difficulty" in defineCharacter({ ...harry, threshold: 3 }), false);
  const npc = new Persuadable({ ...harry, difficulty: "easy" }, { client: fakeClient() });
  assert.equal(npc.character.difficulty, "easy");
  assert.equal(npc.character.threshold, 2.4);
});

test("a defined character can be defined again, and a changed rubric or difficulty is recomputed", () => {
  const once = defineCharacter({ ...harry, difficulty: "easy" });
  assert.deepEqual(defineCharacter(once), once);
  assert.equal(readPersuasion(once, { persuasion: { score: 2.5 } }).verdict, "convinced");
  assert.ok(persuasionQuestions(once).persuasion);
  // Editing a defined character in place still works: the threshold follows the word.
  once.difficulty = "very hard";
  assert.equal(defineCharacter(once).threshold, 3.8);
  once.levels = ["no", "maybe", "yes"];
  assert.equal(defineCharacter(once).threshold, 1.9);
  // A threshold set by hand that disagrees with the word is still an error.
  once.threshold = 1;
  assert.throws(() => defineCharacter(once), /set "difficulty" or "threshold", not both/);
});

test("a copy of a defined character works, unless its difficulty or rubric changes without its threshold", () => {
  const npc = new Persuadable({ ...harry, difficulty: "hard" }, { client: fakeClient() });
  const calmer = new Persuadable({ ...npc.character, patience: 5 });
  assert.equal(calmer.character.patience, 5);
  assert.equal(calmer.character.difficulty, "hard");
  assert.equal(calmer.character.threshold, 3.6);
  const copy = { ...npc.character };
  assert.throws(() => defineCharacter({ ...copy, difficulty: "easy" }), /not both.*If you copied a defined character and changed its difficulty or levels, leave out its "threshold"/);
  assert.throws(() => defineCharacter({ ...copy, levels: ["no", "maybe", "yes"] }), /not both/);
  const { threshold, ...withoutThreshold } = copy;
  assert.equal(defineCharacter({ ...withoutThreshold, difficulty: "easy" }).threshold, 2.4);
});

test("decide can return each verdict, and patience follows it", async () => {
  const cases = [
    // [what Jev's answers give, what decide returns, patience cost, reaction]
    [{ score: 1 }, "convinced", 0, null],
    [{ score: 1 }, "offended", 2, null],
    [{ score: 1 }, "repeated", 1, "Harry has heard that already."],
    [{ score: 4 }, "unconvinced", 1, "Harry isn't convinced."],
    [{ score: 1 }, "unconvinced", 1, "Harry isn't convinced."],
  ];
  for (const [next, verdict, cost, reaction] of cases) {
    const client = fakeClient(next);
    const npc = new Persuadable({ ...harry, patience: 5, decide: () => verdict }, { client });
    const r = await npc.attempt("let me in");
    assert.equal(r.verdict, verdict);
    assert.equal(r.patienceLeft, 5 - cost, verdict);
    assert.equal(r.reaction, reaction, verdict);
    assert.equal(npc.convinced, verdict === "convinced");
    assert.deepEqual(npc.attempts.at(-1), { said: "let me in", outcome: verdict });
  }
});

test("decide returning nothing keeps the verdict", async () => {
  const npc = new Persuadable({ ...harry, patience: 3, decide: () => undefined }, { client: fakeClient({ score: 1 }) });
  const r = await npc.attempt("let me in");
  assert.equal(r.verdict, "unconvinced");
  assert.equal(r.patienceLeft, 2);
});

test("decide sees a frozen result and what happened so far", async () => {
  const seen = [];
  const decide = (result, context) => { seen.push({ result, context }); };
  const npc = new Persuadable({ ...harry, patience: 3, decide }, { client: fakeClient({ score: 1, threats: 0.9 }) });
  await npc.attempt("open up or else");
  await npc.attempt("open up or else"); // a repeat: decide runs for it too
  const [first, second] = seen;
  assert.equal(first.result.verdict, "offended");
  assert.deepEqual(first.result.triggered, ["threats"]);
  assert.equal(first.context.input, "open up or else");
  assert.equal(first.context.character.name, "Harry");
  assert.equal(first.context.patienceLeft, 3);
  assert.deepEqual(first.context.previousAttempts, []);
  assert.throws(() => { first.result.verdict = "convinced"; }, TypeError);
  assert.throws(() => { first.result.triggered.push("insults"); }, TypeError);
  assert.equal(second.result.verdict, "offended");
  assert.deepEqual(second.context.previousAttempts, [{ said: "open up or else", outcome: "offended" }]);
  assert.equal(second.context.patienceLeft, 1);
});

test("decide must return a verdict synchronously, and a bad answer changes nothing", async () => {
  for (const [bad, message] of [
    ["win", /decide\(\) must return "convinced", "unconvinced", "offended", or "repeated", or nothing to keep the verdict, got "win"/],
    [{ verdict: "convinced" }, /got \{"verdict":"convinced"\}/],
    [null, /got null/],
    [true, /got true/],
  ]) {
    const npc = new Persuadable({ ...harry, patience: 3, decide: () => bad }, { client: fakeClient({ score: 1 }) });
    await assert.rejects(npc.attempt("let me in"), (e) => e instanceof HoneytongueError && message.test(e.message));
    assert.equal(npc.attempts.length, 0);
    assert.equal(npc.patienceLeft, 3);
  }
  for (const decide of [async () => "convinced", () => Promise.reject(new Error("nope"))]) {
    const npc = new Persuadable({ ...harry, decide }, { client: fakeClient({ score: 1 }) });
    await assert.rejects(npc.attempt("let me in"), /decide\(\) must be synchronous and return a verdict, but it returned a Promise/);
  }
});

test("decide must be a function", () => {
  assert.throws(() => defineCharacter({ ...harry, decide: "convinced" }), /"decide" must be a function.*got "convinced"/);
});

test("judgePersuasion applies decide, readPersuasion doesn't", async () => {
  const lenient = { ...harry, decide: (r) => (r.score >= 2 ? "convinced" : undefined) };
  const r = await judgePersuasion(fakeClient({ score: 2.5 }), lenient, "let me in");
  assert.equal(r.verdict, "convinced");
  assert.equal(r.reaction, null);
  assert.equal(readPersuasion(lenient, { persuasion: { score: 2.5 } }).verdict, "unconvinced");
});

test("characters remember their last 10 attempts by default", async () => {
  const npc = new Persuadable(harry, { client: fakeClient({ score: 1 }) });
  for (let i = 0; i < 12; i++) await npc.attempt(`attempt number ${i} with its own distinct wording ${"x".repeat(i)}`);
  const sent = npc.state("one more").previous_attempts;
  assert.equal(sent.length, 10);
  assert.match(sent[0].said, /attempt number 2 /, "the oldest two have dropped out");
  assert.equal(defineCharacter(harry).memory, 10);
});
