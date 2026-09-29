import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, createMockClient } from "../src/index.js";
import { createTranscript, snapshot, TRANSCRIPT_FORMAT } from "../src/transcript.js";
import { transcriptToEvals, SUPPORTED_FORMATS } from "../scripts/transcript-to-evals.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const scenes = load("stories/index.json");

/** Play lines through a scene on the mock, recording a transcript as the web demo and CLI do. */
async function playtest(sceneId, lines) {
  const story = load(`stories/${scenes.find((s) => s.id === sceneId).file}`);
  const game = new Game(story, createMockClient());
  const transcript = createTranscript({ version: "9.9.9-test", scene: sceneId, story });
  transcript.start();
  for (const line of lines) {
    const before = snapshot(game);
    transcript.record(line, before, await game.turn(line), game);
  }
  return transcript.data;
}

test("a transcript records each turn: the input, action, verdict, score, threshold, tells, and patience", async () => {
  const data = await playtest("goblin-camp", [
    "Nib, please let me go",
    "Nib, please let me go",
    "ask Nib about his stew",
    "Nib, please let me out. Come with me to town and I'll help you become a cook in a real kitchen.",
  ]);
  assert.equal(data.formatVersion, TRANSCRIPT_FORMAT);
  assert.equal(data.honeytongue, "9.9.9-test");
  assert.equal(data.scene, "goblin-camp");
  assert.equal(data.story, "THE GOBLIN CAMP");
  assert.equal(data.judge, "mock");
  const [plea, repeat, chat, win] = data.runs[0].turns;
  assert.deepEqual(Object.keys(plea).sort(), ["action", "flags", "input", "items", "location", "n", "patienceLeft", "reply", "score", "tells", "threshold", "triggered", "verdict", "judge"].sort());
  assert.equal(plea.judge, "mock");
  assert.equal(repeat.judge, null, "a repeat is caught locally, so nothing judged it");
  assert.equal(plea.action.id, "persuade_nib");
  assert.equal(plea.verdict, "unconvinced");
  assert.equal(plea.threshold, 2.4);
  assert.equal(plea.patienceLeft, 2);
  assert.deepEqual(repeat.action, { id: "(repeat)", p: null });
  assert.equal(repeat.verdict, "repeated");
  assert.equal(chat.verdict, null, "an ordinary action isn't judged");
  assert.deepEqual(win.flags, ["wants_to_be_a_cook"], "the flags the turn was played with");
  assert.equal(win.verdict, "convinced");
  assert.equal(data.runs[0].ending, "You talked your way out");
});

test("a transcript never holds the API key or anything else from the environment", async () => {
  const saved = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "ts_secret_do_not_leak_12345";
  try {
    const text = JSON.stringify(await playtest("gatehouse", ["hello Harry", "read the letter"]));
    assert.doesNotMatch(text, /ts_secret_do_not_leak/);
    assert.doesNotMatch(text, /TYPESAFE|Authorization|Bearer/i);
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  }
});

test("a restart adds another playthrough to the same transcript", async () => {
  const story = load("stories/gatehouse.json");
  const transcript = createTranscript({ scene: "gatehouse", story });
  for (let run = 0; run < 2; run++) {
    transcript.start();
    const game = new Game(story, createMockClient());
    const before = snapshot(game);
    transcript.record("read the letter", before, await game.turn("read the letter"), game);
  }
  assert.equal(transcript.data.runs.length, 2);
  assert.equal(transcript.data.runs[1].turns[0].n, 1);
});

test("transcript-to-evals turns judged turns into draft cases, and skips repeats", async () => {
  const data = await playtest("goblin-camp", ["Nib, please let me go", "Nib, please let me go", "look", "ask Nib about his stew",
    "Nib, please let me out. Come with me to town and I'll help you become a cook in a real kitchen."]);
  const suite = transcriptToEvals(data, scenes);
  assert.equal(suite.story, "../stories/goblin-camp.json");
  assert.deepEqual(suite.cases.map((c) => c.expect), ["persuade_nib", "chat_nib", "persuade_nib"], "no repeat, no 'look'");
  assert.equal(suite.cases[0].verdict, "unconvinced");
  assert.equal(suite.cases[1].verdict, undefined, "ordinary actions have no verdict to check");
  assert.deepEqual(suite.cases[2].flags, ["wants_to_be_a_cook"]);
  assert.ok(suite.cases.every((c) => c.note.startsWith("DRAFT from a playtest judged by mock")));

  // A live demo can fall back to the mock mid-game: each case names the judge of its own turn.
  data.judge = "jev";
  assert.ok(transcriptToEvals(data, scenes).cases.every((c) => c.note.startsWith("DRAFT from a playtest judged by mock")));
});

test("transcript-to-evals refuses a transcript format it doesn't know, with a readable message", () => {
  assert.deepEqual(SUPPORTED_FORMATS, [TRANSCRIPT_FORMAT], "the script reads what the recorder writes");
  assert.throws(() => transcriptToEvals({ formatVersion: 99, runs: [] }, scenes), /format 99.*reads format 1/);
  assert.throws(() => transcriptToEvals({ runs: [] }, scenes), /format \(missing\)/);
  assert.throws(() => transcriptToEvals("nope", scenes), /isn't a Honeytongue transcript/);
});
