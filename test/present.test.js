import { test } from "node:test";
import assert from "node:assert/strict";
import { VERDICT_LABELS, spokenLabel, typingSpeed, endingSummary, scoreLine, difficultyTag } from "../docs/play/present.js";

test("every verdict has a label, the repeated one included", () => {
  assert.deepEqual(VERDICT_LABELS, { convinced: "CONVINCED", offended: "OFFENDED", repeated: "REPEATED" });
  assert.equal(spokenLabel("convinced"), "Convinced.");
  assert.equal(spokenLabel("unconvinced"), "", "an ordinary unconvinced turn has no label: the reply and meter say it");
  assert.equal(spokenLabel(null), "");
});

test("typed text is instant under reduced motion or when turned off, and never takes more than a few seconds", () => {
  assert.equal(typingSpeed(300, { reducedMotion: true }), 0);
  assert.equal(typingSpeed(300, { typed: false }), 0);
  assert.equal(typingSpeed(0), 0);
  assert.equal(typingSpeed(100), 90, "a short reply types at the base pace");
  assert.ok(2000 / typingSpeed(2000) <= 2.5, "a long reply speeds up to finish within 2.5 seconds");
});

test("the ending summary lists the arguments that landed and the closest misses", () => {
  const t = (input, verdict, score) => ({ input, verdict, score, threshold: 3.2, maxScore: 4 });
  const summary = endingSummary([
    t("please", "unconvinced", 0.95),
    t("you fool", "offended", 0.2),
    t("please", "repeated", null),
    t("think of your girl", "unconvinced", 2.9),
    t("i've got her medicine", "unconvinced", 3.1),
    t("the letter is her remedy", "convinced", 3.82),
  ]);
  assert.equal(summary.attempts, 6);
  assert.deepEqual(summary.landed.map((x) => x.input), ["the letter is her remedy"]);
  assert.deepEqual(summary.closest.map((x) => x.input), ["i've got her medicine", "think of your girl"]);
  assert.equal(scoreLine(summary.landed[0]), "3.82 of 4, needed 3.2");
});

test("a scene's difficulty tag says the word, with a class for its colour", () => {
  assert.deepEqual(difficultyTag("easy"), { label: "Easy", className: "tag tag-easy" });
  assert.deepEqual(difficultyTag("very hard"), { label: "Very hard", className: "tag tag-very-hard" });
  assert.equal(difficultyTag(undefined), null);
  assert.equal(difficultyTag("toString"), null);
});
