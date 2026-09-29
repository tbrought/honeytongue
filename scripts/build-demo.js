// Copies the browser-safe engine, the demo stories, and the preset characters into docs/play/lib, and the Phaser
// example's game into docs/phaser/lib, because GitHub Pages only serves the docs folder. Run it after changing src/,
// stories/, or examples/phaser/: npm run build:demo
// (test/demo.test.js fails if the copies are out of date.)
import { copyFile, mkdir } from "node:fs/promises";
import { DEMO_FILES } from "./demo-files.js";

const root = new URL("../", import.meta.url);
for (const [source, copy] of DEMO_FILES) {
  await mkdir(new URL(copy.slice(0, copy.lastIndexOf("/") + 1), root), { recursive: true });
  await copyFile(new URL(source, root), new URL(copy, root));
}
console.log(`Copied ${DEMO_FILES.length} files into docs/play/lib and docs/phaser/lib`);
