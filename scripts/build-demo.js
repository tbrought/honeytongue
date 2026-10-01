// Copies the browser-safe engine, the demo stories, and the preset characters into docs/play/lib, and the Phaser
// example's game into docs/phaser/lib and its sprites into docs/phaser/assets, because GitHub Pages only serves the
// docs folder. Run it after changing src/, stories/, or examples/phaser/: npm run build:demo
// It also highlights the docs' code blocks (scripts/highlight-docs.js), writes the showcase grid's "Try it" links
// (scripts/showcase-links.js), and writes docs/favicon.ico from the logos (scripts/favicon.js).
// (test/demo.test.js fails if the copies are out of date, test/highlight.test.js if the highlighting is, and
// test/showcase.test.js if the links are.)
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { DEMO_FILES } from "./demo-files.js";
import { HIGHLIGHTED, highlightPage } from "./highlight-docs.js";
import { linkShowcase } from "./showcase-links.js";
import { ICON_SOURCES, buildIco } from "./favicon.js";

const root = new URL("../", import.meta.url);
for (const [source, copy] of DEMO_FILES) {
  await mkdir(new URL(copy.slice(0, copy.lastIndexOf("/") + 1), root), { recursive: true });
  await copyFile(new URL(source, root), new URL(copy, root));
}
console.log(`Copied ${DEMO_FILES.length} files into docs/play/lib, docs/phaser/lib, and docs/phaser/assets`);
for (const page of HIGHLIGHTED) {
  const url = new URL(page, root);
  await writeFile(url, highlightPage(await readFile(url, "utf8")));
}
console.log(`Highlighted the code in ${HIGHLIGHTED.join(", ")}`);
const home = new URL("docs/index.html", root);
await writeFile(home, linkShowcase(await readFile(home, "utf8")));
console.log("Wrote the showcase grid's Try it links in docs/index.html");
const icons = await Promise.all(ICON_SOURCES.map(async ([path, size]) => [await readFile(new URL(path, root)), size]));
await writeFile(new URL("docs/favicon.ico", root), buildIco(icons));
console.log(`Wrote docs/favicon.ico (${ICON_SOURCES.map(([, size]) => `${size}x${size}`).join(" and ")})`);
