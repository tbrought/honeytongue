import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const PAGES = {
  "docs/index.html": "https://honeytongue.dev/",
  "docs/play/index.html": "https://honeytongue.dev/play/",
  "docs/playground/index.html": "https://honeytongue.dev/playground/",
  "docs/phaser/index.html": "https://honeytongue.dev/phaser/",
};
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const meta = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`))?.[1];
/** A PNG's width and height, from its header. */
const size = (path) => { const b = readFileSync(new URL(`../${path}`, import.meta.url)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("every page has the logo as its favicon and touch icon", () => {
  for (const page of Object.keys(PAGES)) {
    const html = read(page);
    const dir = page.slice(0, page.lastIndexOf("/") + 1);
    const icon = html.match(/<link rel="icon" type="image\/png" sizes="32x32" href="([^"]+)">/)?.[1];
    const touch = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/)?.[1];
    assert.ok(icon && touch, page);
    assert.deepEqual(size(new URL(icon, `file:///x/${dir}`).pathname.slice(3)), [32, 32], `${page} favicon`);
    assert.deepEqual(size(new URL(touch, `file:///x/${dir}`).pathname.slice(3)), [192, 192], `${page} touch icon`);
  }
});

test("every page has Open Graph and Twitter card tags, so shared links show the logo", () => {
  assert.deepEqual(size("docs/assets/social-preview.png"), [1280, 640]);
  for (const [page, url] of Object.entries(PAGES)) {
    const html = read(page);
    assert.equal(meta(html, "property", "og:url"), url, page);
    assert.equal(meta(html, "property", "og:image"), "https://honeytongue.dev/assets/social-preview.png", page);
    assert.equal(meta(html, "property", "og:image:width"), "1280", page);
    assert.equal(meta(html, "property", "og:image:height"), "640", page);
    assert.equal(meta(html, "name", "twitter:card"), "summary_large_image", page);
    for (const [attr, name] of [["property", "og:title"], ["property", "og:description"], ["property", "og:image:alt"], ["name", "twitter:title"], ["name", "twitter:description"], ["name", "twitter:image"]]) {
      assert.ok(meta(html, attr, name)?.length > 10, `${page}: ${name}`);
    }
    assert.equal(meta(html, "property", "og:description"), meta(html, "name", "description"), `${page}: the same description everywhere`);
  }
});

test("the README shows the logo by its absolute URL, so it appears on npm too", () => {
  const readme = read("README.md");
  assert.match(readme.split("\n")[0], /^<p align="center"><img src="https:\/\/honeytongue\.dev\/assets\/honeytongue-logo-512\.png" alt="[^"]+"/);
  assert.ok(existsSync(new URL("../docs/assets/honeytongue-logo-512.png", import.meta.url)));
  assert.match(readme, /not affiliated with TypeSafe/);
});

test("package.json describes the new positioning, with an author and relevant keywords", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.description, /games where players type or speak/);
  assert.equal(pkg.author, "Tristan Broughton (https://honeytongue.dev)");
  assert.ok(pkg.keywords.length >= 15 && pkg.keywords.length <= 20, `${pkg.keywords.length} keywords`);
  for (const k of pkg.keywords) assert.match(k, /^[a-z0-9]+(-[a-z0-9]+)*$/, `"${k}" is lowercase and hyphenated`);
  assert.ok(pkg.keywords.includes("phaser"), "the Phaser example ships, so the keyword can too");
  assert.equal(pkg.bugs.url, "https://github.com/tbrought/honeytongue/issues");
});
