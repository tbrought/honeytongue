import { test } from "node:test";
import assert from "node:assert/strict";
import { characterCode, storyJson, readDraft, encodeShare, decodeShare, MAX_SHARE_LENGTH } from "../docs/playground/designer.js";
import { HoneytongueError } from "../docs/play/lib/persuasion.js";

const IMG = "<img src=x onerror=alert(1)>";
const CLOSE = "</textarea><script>alert(1)</script>";
const LS = String.fromCharCode(0x2028); // a line separator, which old JavaScript didn't allow in strings

/** A character with hostile text in every text field a share link carries. */
const hostile = {
  name: `Nib ${IMG}`,
  persona: `A guard ${CLOSE} who ${LS} likes stew ${IMG}`,
  goal: `Open the cage ${CLOSE}`,
  repeatReaction: `"Again?" ${IMG}`,
  secrets: [{ id: `stew${CLOSE}`, fact: `He wants to cook ${IMG}` }],
  reactions: [{ min: 1, text: `He sniffs. ${CLOSE}` }],
};

test("a share link with hostile text round-trips to exactly the same text, never interpreted", () => {
  const hash = encodeShare({ character: hostile, knows: [hostile.secrets[0].id] });
  assert.match(hash, /^#c=[A-Za-z0-9_-]+$/, "the link itself is plain base64url");
  const { character, knows } = decodeShare(hash);
  assert.deepEqual(character, hostile);
  assert.deepEqual(knows, [hostile.secrets[0].id]);
});

test("copied code and story JSON keep hostile text as data: nothing in them can close a <script> element", () => {
  const code = characterCode(hostile, { knows: [hostile.secrets[0].id] });
  const json = storyJson(hostile);
  for (const [what, text] of [["code", code], ["story JSON", json]]) {
    assert.doesNotMatch(text, /</, `${what} contains no raw "<", so no </script> or </textarea>`);
    assert.ok(!text.includes(LS), `${what} has no raw line separator`);
  }
  // The story JSON parses back to exactly the text.
  const npc = JSON.parse(json);
  assert.equal(npc.name, hostile.name);
  assert.equal(npc.persona, hostile.persona);
  assert.equal(npc.persuasion.goal, hostile.goal);
  assert.deepEqual(npc.secrets, hostile.secrets);
  assert.deepEqual(npc.persuasion.reactions, hostile.reactions);
  // The code's character literal evaluates to exactly the text too, and learn() gets the exact secret id.
  const literal = code.match(/new Persuadable\((\{[\s\S]*\}), \{ client \}\);/)[1];
  const evaluated = new Function(`return ${literal};`)();
  assert.equal(evaluated.persona, hostile.persona);
  assert.equal(evaluated.goal, hostile.goal);
  assert.deepEqual(evaluated.secrets, hostile.secrets);
  const learned = code.match(/\.learn\((".*")\);/)[1];
  assert.equal(JSON.parse(learned), hostile.secrets[0].id);
});

test("oversized, damaged, and malicious share links fail safely with a readable error", () => {
  const damaged = (hash, why) => {
    const err = (() => { try { decodeShare(hash); } catch (e) { return e; } })();
    assert.ok(err instanceof HoneytongueError, `${why}: throws a HoneytongueError`);
    assert.match(err.message, /^This character couldn't be loaded: /, why);
  };
  damaged(`#c=${"A".repeat(MAX_SHARE_LENGTH)}`, "too long");
  damaged("#c=%%%not-base64%%%", "not base64");
  damaged("#c=" + Buffer.from("{not json").toString("base64url"), "not JSON");
  damaged("#c=" + Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url"), "not UTF-8");
  damaged("#c=", "empty");
  for (const [value, why] of [
    [[], "an array"],
    [{ character: "Nib" }, "character isn't an object"],
    [{ character: { name: 42 } }, "a name that isn't text"],
    [{ character: { name: "Nib", secrets: [{ id: 1, fact: "x" }] } }, "a malformed secret"],
    [{ character: { name: "Nib", reactions: "hi" } }, "reactions that aren't a list"],
    [{ character: { name: "Nib" }, knows: [{}] }, "knows that aren't ids"],
  ]) damaged("#c=" + Buffer.from(JSON.stringify(value)).toString("base64url"), why);
  // Not a share link at all: nothing happens.
  assert.equal(decodeShare("#goblin-camp"), null);
  assert.equal(decodeShare(""), null);
});

test("a share link can't pollute prototypes or smuggle extra fields into the form", () => {
  const sneaky = JSON.parse('{"character":{"name":"Nib","persona":"p","goal":"g","__proto__":{"polluted":true},"constructor":{"x":1},"onclick":"alert(1)",' +
    '"secrets":[{"id":"a","fact":"b","__proto__":{"evil":1},"html":"<b>"}]},"knows":["a"],"extra":"ignored"}');
  const { character, knows } = decodeShare("#c=" + Buffer.from(JSON.stringify(sneaky)).toString("base64url"));
  assert.deepEqual(Object.keys(character).sort(), ["goal", "name", "persona", "secrets"]);
  assert.deepEqual(character.secrets, [{ id: "a", fact: "b" }]);
  assert.deepEqual(knows, ["a"]);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(character), Object.prototype);
});

test("a saved draft is read the same careful way as a share link", () => {
  assert.deepEqual(readDraft({ character: hostile, knows: [] }).character, hostile);
  assert.throws(() => readDraft(JSON.parse('{"character":{"persona":["<script>"]}}')), /"persona" should be text/);
});
