import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { request } from "node:http";
import { startPlayground } from "../src/playground-server.js";

const PAGES = ["docs/index.html", "docs/play/index.html", "docs/playground/index.html", "docs/phaser/index.html"];
// Phaser builds its default textures from data: images, so its page allows those; images can't run code.
const IMAGES = { "docs/phaser/index.html": ["'self'", "data:"] };
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** The page's Content-Security-Policy as { directive: [sources] }. */
function policy(html) {
  const found = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)];
  assert.equal(found.length, 1, "exactly one CSP meta tag");
  return Object.fromEntries(found[0][1].split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));
}

test("every page has a strict Content Security Policy", () => {
  for (const page of PAGES) {
    const csp = policy(read(page));
    assert.deepEqual(csp["default-src"], ["'none'"], page);
    assert.deepEqual(csp["script-src"], ["'self'"], `${page}: scripts only from the site itself`);
    assert.deepEqual(csp["style-src"], ["'self'"], `${page}: styles only from the site itself`);
    assert.deepEqual(csp["font-src"], ["'self'"], `${page}: fonts only from the site itself (no Google Fonts)`);
    assert.deepEqual(csp["connect-src"], ["'self'", "https://api.honeytongue.dev"], `${page}: talks only to itself and the demo proxy`);
    assert.deepEqual(csp["img-src"], IMAGES[page] ?? ["'self'"], `${page}: images only from the site itself (the favicons are files)`);
    assert.deepEqual(csp["object-src"], ["'none'"], page);
    assert.deepEqual(csp["base-uri"], ["'none'"], page);
    assert.doesNotMatch(JSON.stringify(csp), /unsafe-inline|unsafe-eval|\*/, `${page}: no unsafe-inline, unsafe-eval, or wildcards`);
  }
});

test("no page has inline scripts, inline styles, event-handler attributes, or javascript: links", () => {
  for (const page of PAGES) {
    const html = read(page);
    for (const tag of html.matchAll(/<script\b[^>]*>/g)) assert.match(tag[0], /\ssrc="[^"]+"/, `${page}: ${tag[0]} has no src`);
    assert.doesNotMatch(html, /<style[\s>]/, `${page}: inline <style>`);
    assert.doesNotMatch(html, /\sstyle="/, `${page}: style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+="/i, `${page}: event-handler attribute`);
    assert.doesNotMatch(html, /javascript:/i, `${page}: javascript: link`);
  }
});

test("every local script and stylesheet a page links to exists", () => {
  for (const page of PAGES) {
    const html = read(page);
    const dir = page.slice(0, page.lastIndexOf("/") + 1);
    const refs = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="stylesheet"[^>]*\shref)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
    assert.ok(refs.length >= 2, page);
    for (const ref of refs) assert.ok(existsSync(new URL(`../${dir}${ref}`, import.meta.url)), `${page} links to ${ref}, which doesn't exist`);
  }
});

test("Phaser is pinned: the example's CDN script carries an integrity hash that matches the site's vendored copy", async () => {
  const html = read("examples/phaser/index.html");
  const tag = html.match(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/phaser@(\d+\.\d+\.\d+)\/dist\/phaser\.min\.js"\s+integrity="(sha384-[^"]+)" crossorigin="anonymous"><\/script>/);
  assert.ok(tag, "an exact version, an integrity hash, and crossorigin");
  const [, version, integrity] = tag;
  const vendored = readFileSync(new URL(`../docs/assets/vendor/phaser-${version}.min.js`, import.meta.url));
  const { createHash } = await import("node:crypto");
  assert.equal(`sha384-${createHash("sha384").update(vendored).digest("base64")}`, integrity, "the site's copy is byte-for-byte the pinned file");
  assert.match(read("docs/phaser/index.html"), new RegExp(`<script src="\\.\\./assets/vendor/phaser-${version.replace(/\./g, "\\.")}\\.min\\.js"></script>`), "the site serves the same version itself");
  assert.ok(existsSync(new URL("../docs/assets/vendor/phaser-LICENSE.md", import.meta.url)), "with its licence");
  assert.ok(read("docs/index.html").includes(`phaser@${version}/dist/phaser.min.js"
  integrity="${integrity}"`), "the docs' Visual games snippet shows the same version and hash");
});

test("the web fonts are self-hosted, with their licences, and no page contacts Google Fonts", () => {
  const css = read("docs/style.css");
  const fonts = [...css.matchAll(/url\("(assets\/fonts\/[^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(fonts.length >= 10);
  for (const font of fonts) assert.ok(existsSync(new URL(`../docs/${font}`, import.meta.url)), `${font} exists`);
  for (const licence of ["IBMPlexMono-OFL.txt", "VT323-OFL.txt"]) assert.ok(existsSync(new URL(`../docs/assets/fonts/${licence}`, import.meta.url)), licence);
  for (const page of [...PAGES, "docs/style.css"]) assert.doesNotMatch(read(page), /fonts\.(googleapis|gstatic)\.com/, page);
});

test("scripts never set a style attribute (CSP blocks it; element.style is allowed)", () => {
  for (const dir of ["docs", "docs/play", "docs/playground", "docs/phaser", "examples/phaser"]) {
    for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => f.endsWith(".js"))) {
      assert.doesNotMatch(read(`${dir}/${file}`), /setAttribute\(\s*["']style["']/, `${dir}/${file}`);
    }
  }
});

test("the local playground server serves every stylesheet and image the page uses, under an equally strict policy", async () => {
  const playground = await startPlayground({ port: 0, apiKey: "" });
  const get = (path) => new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port: playground.port, path, headers: { Host: `127.0.0.1:${playground.port}` } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res));
    }).on("error", reject).end();
  });
  try {
    const page = await get("/playground/");
    assert.doesNotMatch(page.headers["content-security-policy"], /unsafe-inline|unsafe-eval/);
    assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.match(page.headers["content-security-policy"], /img-src 'self';/, "images only from the server itself");
    const html = read("docs/playground/index.html");
    const sheets = [...html.matchAll(/<link[^>]*rel="(?:stylesheet|icon|apple-touch-icon)"[^>]*\shref="([^"]+)"|<img[^>]*\ssrc="([^"]+)"/g)]
      .map((m) => m[1] ?? m[2]).filter((u) => !/^https?:/.test(u));
    assert.ok(sheets.some((s) => s.endsWith(".png")), "the page's logo images are among them");
    for (const sheet of sheets) {
      const path = new URL(sheet, "http://x/playground/").pathname;
      assert.equal((await get(path)).statusCode, 200, `${path} is served`);
    }
  } finally {
    await playground.close();
  }
});
