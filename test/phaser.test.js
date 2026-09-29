import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Persuadable, createMockClient, defineCharacter } from "../src/index.js";
import { troll } from "../examples/phaser/character.js";

const attempt = async (line, { knows = false } = {}) => {
  const npc = new Persuadable(troll, { client: createMockClient() });
  if (knows) npc.learn("lonely");
  return npc.attempt(line);
};

test("the Phaser example's troll is a valid character, with the secret the sign teaches", () => {
  const c = defineCharacter(troll);
  assert.deepEqual(c.secrets.map((s) => s.id), ["lonely"]);
  assert.match(readFileSync(new URL("../examples/phaser/game.js", import.meta.url), "utf8"), /this\.npc\.learn\("lonely"\)/, "reading the sign teaches it");
});

test("on the offline stand-in, the troll can be won only after reading the sign, as the site's fallback needs", async () => {
  const caring = "Please let me cross, and I'll come back and visit you.";
  assert.equal((await attempt(caring)).verdict, "unconvinced", "without the sign's secret");
  assert.equal((await attempt(caring, { knows: true })).verdict, "convinced", "with it");
  assert.equal((await attempt("Please let me cross the bridge.", { knows: true })).verdict, "unconvinced", "a bare plea doesn't win");
  assert.equal((await attempt("Out of my way, you stupid lump.")).verdict, "offended");
});
