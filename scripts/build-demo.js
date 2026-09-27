// Copies the browser-safe engine, the demo story, and the preset characters into docs/play/lib, because GitHub Pages
// only serves the docs folder. Run it after changing src/ or stories/: npm run build:demo
// (test/demo.test.js fails if the copies are out of date.)
import { copyFile, mkdir } from "node:fs/promises";
import { DEMO_FILES } from "./demo-files.js";

const root = new URL("../", import.meta.url);
await mkdir(new URL("docs/play/lib/", root), { recursive: true });
for (const [source, copy] of DEMO_FILES) await copyFile(new URL(source, root), new URL(copy, root));
console.log(`Copied ${DEMO_FILES.length} files into docs/play/lib`);
