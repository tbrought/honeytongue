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
