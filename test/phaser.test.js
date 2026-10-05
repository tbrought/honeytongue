import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Persuadable, createMockClient, defineCharacter } from "../src/index.js";
import { troll } from "../examples/phaser/character.js";
import { LINES, tollyReply } from "../examples/phaser/game.js";

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

test("the Phaser example draws its own 32x32 sprites, crisp, at a whole-number scale, loaded without blob: URLs", async () => {
  const game = readFileSync(new URL("../examples/phaser/game.js", import.meta.url), "utf8");
  const { DEMO_FILES } = await import("../scripts/demo-files.js");
  for (const name of ["player", "troll", "sign"]) {
    const file = `phaser-demo-${name}-32.png`;
    const png = readFileSync(new URL(`../examples/phaser/assets/${file}`, import.meta.url));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[25]], [32, 32, 6], `${file} is 32x32 with transparency`);
    assert.ok(game.includes(`${name}: "${file}"`), `game.js loads ${file}`);
    assert.ok(DEMO_FILES.some(([source, copy]) => source === `examples/phaser/assets/${file}` && copy === `docs/phaser/assets/${file}`), `the site gets ${file}`);
  }
  assert.match(game, /this\.load\.image\(key, assets \+ file\)/);
  assert.match(game, /pixelArt: true/);
  assert.ok(Number.isInteger(Number(game.match(/const SCALE = (\d+);/)?.[1])) && /setScale\(SCALE\)/.test(game), "a whole-number scale");
  assert.match(game, /imageLoadType: "HTMLImageElement"/, "no blob: URLs, so the page's CSP needs no blob: images");
  assert.match(game, /setFlipX\(dx < 0\)/, "the player faces the way they walk");
  assert.match(game, /Sprites \(assets\/\*\.png\) by Tristan Broughton, under the project's MIT license/);
});

test("Tolly laughs at threats, in turn, after the turns that end the talking or change the game", async () => {
  const npc = new Persuadable(troll, { client: createMockClient() });
  const threat = await npc.attempt("I will kill you");
  assert.equal(threat.verdict, "unconvinced", "threats don't offend him or win");
  assert.deepEqual(threat.triggered, ["threats"]);
  assert.deepEqual(tollyReply(threat, 0), { text: LINES.laughs[0], laugh: true });
  assert.equal(tollyReply(threat, 1).text, LINES.laughs[1], "the next laugh is a different line");
  assert.equal(tollyReply(threat, LINES.laughs.length).text, LINES.laughs[0], "and they come round again");

  const again = await npc.attempt("I will kill you");
  assert.equal(again.verdict, "repeated");
  assert.deepEqual(tollyReply(again, 1), { text: troll.repeatReaction, laugh: false }, "a repeated threat is just a repeat");

  const rude = await npc.attempt("Move, you stupid lump, or I will kill you.");
  assert.deepEqual(rude.triggered, ["threats", "insults"]);
  assert.deepEqual(tollyReply(rude, 1), { text: LINES.offended, laugh: false }, "an insulting threat still offends");

  const plain = await attempt("Please let me cross the bridge.");
  assert.deepEqual(tollyReply(plain, 0), { text: plain.reaction, laugh: false }, "an ordinary line gets his reaction");
  const won = await attempt("Please let me cross, and I'll come back and visit you.", { knows: true });
  assert.deepEqual(tollyReply(won, 0), { text: LINES.convinced, laugh: false });
  assert.deepEqual(tollyReply({ ...threat, outOfPatience: true }, 0), { text: LINES.outOfPatience, laugh: false }, "the last word ends the talking");
});
