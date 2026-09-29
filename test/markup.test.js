import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkup, stripMarkup, stripMarkupDeep, markupProblems, hasMarkup } from "../src/markup.js";

const kinds = (text) => parseMarkup(text).map((p) => [p.kind, p.text, ...(p.inSpeech ? ["inSpeech"] : [])]);

test("@[...] marks a character and #[...] an item; stripping leaves the plain text", () => {
  const text = "@[Harry Goatleaf] leans on his spear, a #[toy horse] in his pocket.";
  assert.deepEqual(kinds(text), [["character", "Harry Goatleaf"], ["text", " leans on his spear, a "], ["item", "toy horse"], ["text", " in his pocket."]]);
  assert.equal(stripMarkup(text), "Harry Goatleaf leans on his spear, a toy horse in his pocket.");
  assert.equal(parseMarkup(text).map((p) => p.text).join(""), stripMarkup(text), "the parts spell out the plain text");
});

test("text without markup is unchanged", () => {
  const plain = "Rain drips from the arch. Nothing here is marked, not even @ or # or [brackets].";
  assert.equal(stripMarkup(plain), plain);
  assert.deepEqual(kinds(plain), [["text", plain]]);
  assert.equal(hasMarkup(plain), false);
});

test("\\@[ and \\#[ write a literal @[ or #[", () => {
  const text = "Type \\@[name] or \\#[thing] to mark them, like @[Nib].";
  assert.equal(stripMarkup(text), "Type @[name] or #[thing] to mark them, like Nib.");
  assert.deepEqual(kinds(text), [["text", "Type @[name] or #[thing] to mark them, like "], ["character", "Nib"], ["text", "."]]);
  assert.deepEqual(markupProblems(text), []);
});

test("speech is found from straight or curly double quotes, quotes included", () => {
  assert.deepEqual(kinds('@[Harry] shrugs. "Gate\'s shut till dawn." He looks away.'),
    [["character", "Harry"], ["text", " shrugs. "], ["speech", '"Gate\'s shut till dawn."'], ["text", " He looks away."]]);
  assert.deepEqual(kinds("She laughs. “You’re late.” Then, “Come in.”"),
    [["text", "She laughs. "], ["speech", "“You’re late.”"], ["text", " Then, "], ["speech", "“Come in.”"]]);
  // A name inside speech keeps its kind, and says it's spoken.
  assert.deepEqual(kinds('"Tell @[Ilse] it\'s for Harry\'s girl."'),
    [["speech", '"Tell '], ["character", "Ilse", "inSpeech"], ["speech", ' it\'s for Harry\'s girl."']]);
});

test("when the quotes don't pair up, nothing is styled as speech", () => {
  for (const unsure of [
    'He says "wait and walks off.',             // odd number of straight quotes
    "“Wait,” he says, “and",                     // an opening curly quote with no close
    "”Backwards“ quotes",                        // curly quotes out of order
    '"Straight" and “curly” mixed',              // both kinds in one paragraph
    "The board is 6\" wide and 2\" thick, and 4\" deep.", // inch marks
  ]) {
    assert.ok(parseMarkup(unsure).every((p) => p.kind !== "speech"), unsure);
    assert.equal(stripMarkup(unsure), unsure);
  }
});

test("apostrophes and single quotes never mark speech", () => {
  for (const text of ["It's Cobb's lamp, and the keepers' log.", "He calls it 'the old light'.", "‘Maybe,’ she says."]) {
    assert.deepEqual(kinds(text), [["text", text]]);
  }
});

test("quotes inside a name or item don't count toward speech", () => {
  assert.deepEqual(kinds('@[Harry "the Gate" Goatleaf] nods. "Fine."'),
    [["character", 'Harry "the Gate" Goatleaf'], ["text", " nods. "], ["speech", '"Fine."']]);
});

test("markupProblems explains unclosed, empty, and nested markup, and how to write a literal", () => {
  assert.deepEqual(markupProblems("fine @[Harry] and #[a letter]"), []);
  assert.match(markupProblems("a @[Harry")[0], /@\[ isn't closed with \] \(write \\@\[ for a literal @\[\)/);
  assert.match(markupProblems("a #[\nletter]")[0], /isn't closed/, "markup can't span lines");
  assert.match(markupProblems("an @[ ] here")[0], /is empty/);
  assert.match(markupProblems("@[Harry #[horse]]")[0], /can't be nested/);
  // Unclosed markup is shown as written rather than lost.
  assert.equal(stripMarkup("a @[Harry"), "a @[Harry");
});

test("stripMarkupDeep strips every string in state and questions, and copies rather than changes them", () => {
  const state = { scene: "@[Harry] waits.", recent_turns: [{ player: "hi", result: "#[letter] read." }], n: 3, flag: true, none: null };
  const plain = stripMarkupDeep(state);
  assert.deepEqual(plain, { scene: "Harry waits.", recent_turns: [{ player: "hi", result: "letter read." }], n: 3, flag: true, none: null });
  assert.equal(state.scene, "@[Harry] waits.");
});
