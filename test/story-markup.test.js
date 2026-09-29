import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, validateStory, createMockClient, Persuadable, parseMarkup, stripMarkup } from "../src/index.js";
import { stripMarkupDeep } from "../src/markup.js";
import { fakeClient } from "./helpers.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const scenes = load("stories/index.json");
const stories = scenes.map((s) => [s.id, load(`stories/${s.file}`)]);

/** A client that records every request and answers with the mock. */
function recording() {
  const mock = createMockClient();
  const sent = [];
  return { sent, ask: async (state, questions) => { sent.push(JSON.stringify({ state, questions })); return mock.ask(state, questions); } };
}

const tiny = (overrides = {}) => ({
  title: "Tiny",
  start: "gate",
  scenes: {
    gate: {
      name: "Gate",
      description: '@[Harry] leans on his spear. A #[toy horse] pokes out of his pocket. "Evening," he says.',
      npc: {
        id: "harry", name: "Harry", persona: "An honest gatekeeper.", patience: 3,
        hostileReaction: "@[Harry] scowls.",
        outOfPatience: { text: "@[Harry] calls the watch.", goto: "cell" },
        persuasion: { goal: "Open the gate", success: { text: '"Fine," says @[Harry].', goto: "city" }, reactions: [{ min: 0, text: '@[Harry] shrugs. "No."' }] },
      },
      actions: {
        persuade_harry: { description: "Try to talk Harry into opening the gate", persuade: true, label: "Talk @[Harry] round" },
        look_horse: { description: "Look at the toy horse", text: "The #[toy horse] is hand-carved." },
      },
      ...overrides,
    },
    city: { description: "You're in.", ending: "You got in" },
    cell: { description: "A cold cell.", ending: "Caught" },
  },
});

test("the demo scenes' requests to Jev are exactly the same with their markup as without it", async () => {
  for (const [id, story] of stories) {
    assert.ok(JSON.stringify(story).includes("@["), `${id} uses markup`);
    const plain = stripMarkupDeep(story);
    // What the proxy's guard expects: the scene and the questions. (The character comes along for its limits; its
    // reactions keep their markup, but they're never sent to Jev.)
    const expects = (s) => Game.requests(s).map(({ scene, questions }) => ({ scene, questions }));
    assert.deepEqual(expects(story), expects(plain), `${id}: Game.requests`);
    // Play the same lines through both, and compare every request sent.
    const [a, b] = [recording(), recording()];
    const [marked, unmarked] = [new Game(story, a), new Game(plain, b)];
    for (const line of ["look around", "hello there", "tell me about yourself", "please, I need your help", "examine everything"]) {
      const [x, y] = [await marked.turn(line), await unmarked.turn(line)];
      assert.equal(x.text, y.text, `${id}: "${line}" reads the same`);
    }
    assert.ok(a.sent.length > 0);
    assert.deepEqual(a.sent, b.sent, `${id}: identical requests`);
    for (const request of a.sent) assert.doesNotMatch(request, /[@#]\[/, `${id}: no markup reaches Jev`);
  }
});

test("story text sent to Jev is stripped at one point, and what the player typed goes exactly as typed", async () => {
  // A judge that never convinces, so every line is an unconvinced attempt and the game goes on.
  const client = fakeClient({ action: "persuade_harry", p: 0.95, score: 0 });
  const game = new Game(tiny(), client);
  const typed = ["ask @[Harry] about the #[toy horse] \\@[not markup]", "please @[open] up, #[now]", "what about the <b>weather</b> & #[rain]?"];
  for (const line of typed) await game.turn(line);
  assert.equal(client.calls.length, 3, "every line went to Jev");
  const [first, , third] = client.calls;
  // Story text: stripped.
  assert.equal(first.state.scene, 'Harry leans on his spear. A toy horse pokes out of his pocket. "Evening," he says.');
  assert.doesNotMatch(JSON.stringify(first.questions), /[@#]\[/);
  // Player text: never read as markup, in any field.
  assert.equal(first.state.player_input, typed[0]);
  assert.equal(third.state.player_input, typed[2]);
  assert.deepEqual(third.state.recent_turns.map((t) => t.player), typed.slice(0, 2));
  assert.ok(third.state.previous_attempts.some((a) => a.said === typed[1]), "earlier attempts keep their exact words");
  for (const turn of third.state.recent_turns) assert.doesNotMatch(turn.result, /[@#]\[/, "the engine's replies are plain");
});

test("result.text stays plain, and result.parts carries the same paragraphs as meaningful pieces", async () => {
  const game = new Game(tiny(), fakeClient({ action: "look_horse", p: 0.95 }));
  const look = await game.turn("look");
  assert.equal(look.text, 'Harry leans on his spear. A toy horse pokes out of his pocket. "Evening," he says.');
  assert.deepEqual(look.parts, [[
    { kind: "character", text: "Harry" }, { kind: "text", text: " leans on his spear. A " }, { kind: "item", text: "toy horse" },
    { kind: "text", text: " pokes out of his pocket. " }, { kind: "speech", text: '"Evening,"' }, { kind: "text", text: " he says." },
  ]]);
  const horse = await game.turn("look at the horse");
  assert.deepEqual(horse.parts, [[{ kind: "text", text: "The " }, { kind: "item", text: "toy horse" }, { kind: "text", text: " is hand-carved." }]]);
  assert.equal(game.intro(), 'Tiny\n\nHarry leans on his spear. A toy horse pokes out of his pocket. "Evening," he says.');
});

test("the engine's own lines are 'system' parts, and the ending is an 'ending' part", async () => {
  const client = fakeClient({ action: "unclear", p: 0.9 });
  const game = new Game(tiny(), client);
  assert.deepEqual((await game.turn("xyzzy")).parts, [[{ kind: "system", text: "You're not sure how to do that. Try saying it another way." }]]);
  assert.equal((await game.turn("inventory")).parts[0][0].kind, "system");
  client.next = { ...client.next, action: "persuade_harry", p: 0.95, score: 4 };
  const won = await game.turn("please open up");
  assert.deepEqual(won.parts.map((p) => p.map((x) => x.kind)), [["speech", "text", "character", "text"], ["text"], ["ending"]]);
  assert.equal(won.parts.at(-1)[0].text, "— You got in —");
  assert.deepEqual(won.text.split("\n\n"), won.parts.map((p) => p.map((x) => x.text).join("")), "paragraph i of text is parts[i]");
});

test("did-you-mean choices show labels without their markup", async () => {
  const client = fakeClient({ action: "persuade_harry", p: 0.5 });
  const answers = client.ask.bind(client);
  client.ask = async (s, q) => ({ ...(await answers(s, q)), action: { type: "choice", choice: "persuade_harry", probabilities: { persuade_harry: 0.5, look_horse: 0.45 } } });
  const result = await new Game(tiny(), client).turn("horse, please");
  assert.match(result.text, /1\) Talk Harry round/);
  assert.equal(result.parts[0][0].kind, "system");
});

test("parts line up with text on every turn of every demo scene", async () => {
  for (const [id, story] of stories) {
    const game = new Game(story, createMockClient());
    for (const line of ["look", "inventory", "help", "hello", "please let me go", "please let me go", "xyzzy", "examine everything"]) {
      const r = await game.turn(line);
      assert.deepEqual(r.text ? r.text.split("\n\n") : [], r.parts.map((p) => p.map((x) => x.text).join("")), `${id}: "${line}"`);
    }
  }
});

test("markup is only allowed in text players read; elsewhere validateStory says why", () => {
  assert.doesNotThrow(() => validateStory(tiny()));
  const bad = tiny();
  bad.scenes.gate.npc.persona = "An honest @[gatekeeper].";
  bad.scenes.gate.npc.persuasion.goal = "Open the #[gate]";
  bad.scenes.gate.npc.secrets = [{ id: "girl", fact: "His @[daughter] is ill." }];
  bad.scenes.gate.actions.look_horse.description = "Look at the #[toy horse]";
  bad.scenes.gate.actions.look_horse.giveItems = ["#[horse]"];
  bad.scenes.gate.npc.name = "@[Harry]";
  const err = (() => { try { validateStory(bad); } catch (e) { return e; } })();
  assert.equal(err?.name, "StoryError");
  for (const field of ["npc.persona", "npc.persuasion.goal", "npc.secrets.0.fact", "actions.look_horse.description", "actions.look_horse.giveItems.0", "npc.name"]) {
    assert.ok(err.problems.some((p) => p.startsWith(`Scene "gate", ${field}: markup (@[...] or #[...]) only works in text players read`)), field);
  }
  assert.match(err.problems.join("\n"), /write it plainly/);

  const broken = tiny({ description: "@[Harry leans on his spear." });
  assert.throws(() => validateStory(broken), /Scene "gate", description: @\[ isn't closed with \] \(write \\@\[ for a literal @\[\)/);
});

test("markup stays optional: a plain story plays exactly as before, with plain parts", async () => {
  const plain = stripMarkupDeep(tiny());
  const game = new Game(plain, fakeClient({ action: "look_horse", p: 0.95 }));
  const r = await game.turn("look at the horse");
  assert.equal(r.text, "The toy horse is hand-carved.");
  assert.deepEqual(r.parts, [[{ kind: "text", text: "The toy horse is hand-carved." }]]);
});

test("Persuadable is unaffected by markup: it neither parses nor strips it", async () => {
  const npc = new Persuadable({ name: "Harry", persona: "An honest guard.", goal: "Open the gate",
    reactions: [{ min: 0, text: "@[Harry] shrugs." }] }, { client: fakeClient({ score: 0 }) });
  const result = await npc.attempt("please");
  assert.equal(result.reaction, "@[Harry] shrugs.");
  assert.equal("parts" in result, false);
  // The helpers are there for anyone who wants them.
  assert.equal(stripMarkup(result.reaction), "Harry shrugs.");
  assert.equal(parseMarkup(result.reaction)[0].kind, "character");
});
