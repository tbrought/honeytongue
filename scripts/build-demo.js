// Copies the browser-safe engine, the demo story, and the preset characters into docs/play/lib, because GitHub Pages
// only serves the docs folder. Run it after changing src/ or stories/: npm run build:demo
// (test/demo.test.js fails if the copies are out of date.)
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { DEMO_FILES, VERSION_FILE, versionJson } from "./demo-files.js";

const root = new URL("../", import.meta.url);
await mkdir(new URL("docs/play/lib/", root), { recursive: true });
for (const [source, copy] of DEMO_FILES) await copyFile(new URL(source, root), new URL(copy, root));
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
await writeFile(new URL(VERSION_FILE, root), versionJson(pkg));
console.log(`Copied ${DEMO_FILES.length} files into docs/play/lib, and wrote version.json (${pkg.version})`);
