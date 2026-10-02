import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HIGHLIGHTED, highlightBlock, highlightPage, languageOf } from "../scripts/highlight-docs.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** The text a block's markup shows, as a browser would: spans dropped, entities decoded. */
const shown = (markup) => markup.replace(/<\/?span[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const blocks = (page) => [...page.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => m[1]);

test("the docs' code highlighting is up to date", () => {
  for (const page of HIGHLIGHTED) {
    const html = read(page);
    assert.ok(highlightPage(html) === html, `${page}'s code highlighting is out of date. Run: npm run build:demo`);
    const minimum = page === "docs/index.html" ? 10 : 1; // the docs have many blocks; the guide a few
    assert.ok(blocks(html).length >= minimum && blocks(html).every((b) => b.includes('<span class="')), `every block in ${page} is highlighted`);
  }
});

test("highlighting never changes what a code block says", () => {
  for (const block of blocks(read("docs/index.html"))) {
    const text = shown(block);
    assert.equal(shown(highlightBlock(text).markup), text);
  }
});

test("code can't become markup: every <, >, and & is written back escaped", () => {
  const hostile = [
    'const x = "</code></pre><script>alert(1)</script>"; // <img src=x onerror=alert(1)>',
    "<script>alert(1)</script>\n<img src=x onerror=alert(1)>",
    'npm run x -- "<b>" # a && b > c',
    '"description": "@[<b>Harry</b>] &amp; #[<i>]"',
  ];
  for (const text of hostile) {
    const { markup } = highlightBlock(text);
    assert.equal(shown(markup), text);
    const tags = [...markup.matchAll(/<\/?([a-z]+)[^>]*>/g)].map((m) => m[0]);
    assert.ok(tags.every((t) => /^<span class="(k|s|n|f|c|part-character|part-item)">$|^<\/span>$/.test(t)), `only the highlighter's own spans: ${tags.join(" ")}`);
  }
});

test("each language gets its own tokens", () => {
  assert.equal(languageOf("npm install honeytongue"), "shell");
  assert.equal(languageOf('<script src="x.js"></script>'), "html");
  assert.equal(languageOf('"description": "text"'), "json");
  assert.equal(languageOf("const a = 1;\nexport TYPESAFE_MODEL=jev-latest"), "js");

  const js = highlightBlock('import { a } from "b";\nconst n = await guard.attempt("hi", 3); // why\nif (x === null) say();').markup;
  for (const piece of ['<span class="k">import</span>', '<span class="s">"b"</span>', '<span class="k">await</span>', '<span class="f">attempt</span>',
    '<span class="n">3</span>', '<span class="c">// why</span>', '<span class="n">null</span>', '<span class="f">say</span>']) assert.ok(js.includes(piece), piece);

  const mixed = highlightBlock('createJevClient({ model: "x" });\n\nexport TYPESAFE_MODEL=jev-latest       # macOS and Linux').markup;
  assert.ok(mixed.includes('<span class="f">export</span>') && mixed.includes('<span class="c"># macOS and Linux</span>'), "a shell line in JavaScript is highlighted as shell");

  const shell = highlightBlock('npm run eval -- --all   # every suite\n$env:TYPESAFE_API_KEY="your-key"').markup;
  for (const piece of ['<span class="f">npm</span>', '<span class="n">--all</span>', '<span class="c"># every suite</span>', '<span class="f">$env:TYPESAFE_API_KEY</span>', '<span class="s">"your-key"</span>']) {
    assert.ok(shell.includes(piece), piece);
  }

  const html = highlightBlock('<script src="a.js" crossorigin="anonymous"></script>\n<script type="module">\n  const t = new Persuadable();\n</script>').markup;
  for (const piece of ['<span class="k">&lt;script</span>', '<span class="f">src</span>', '<span class="s">"a.js"</span>', '<span class="k">const</span>', '<span class="f">Persuadable</span>']) {
    assert.ok(html.includes(piece), piece);
  }
});

test("story markup inside a string is shown as the demo shows it", () => {
  const { markup } = highlightBlock('"description": "@[Harry Goatleaf] holds a #[toy horse]."');
  assert.ok(markup.includes('<span class="part-character">@[Harry Goatleaf]</span>'));
  assert.ok(markup.includes('<span class="part-item">#[toy horse]</span>'));
});

test("longer blocks name their language, and a one-line command doesn't", () => {
  const page = highlightPage("<pre><code>npm test</code></pre>\n<pre><code>const a = 1;\nconst b = 2;</code></pre>");
  assert.match(page, /^<pre><code><span class="f">npm<\/span> test<\/code><\/pre>/);
  assert.match(page, /<pre data-lang="JavaScript"><code>/);
  assert.equal(highlightPage(page), page, "running it again changes nothing");
});
