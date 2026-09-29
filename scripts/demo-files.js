// The files the browser demo (docs/play) and the playground (docs/playground) need, as [source, copy] pairs relative to the repository root.
// Shared by scripts/build-demo.js, which copies them, and test/demo.test.js, which checks the copies are current.
export const DEMO_FILES = [
  "src/engine.js",
  "src/persuasion.js",
  "src/jev.js",
  "src/mock.js",
  "src/transcript.js",
  "stories/index.json",
  "stories/gatehouse.json",
  "stories/goblin-camp.json",
  "stories/tidy-profit.json",
  "stories/lighthouse.json",
  "stories/characters.json",
].map((source) => [source, `docs/play/lib/${source.split("/").pop()}`]);

// The package version, for the demo's playtest transcripts. Written by build-demo.js, checked by demo.test.js.
export const VERSION_FILE = "docs/play/lib/version.json";
export const versionJson = (pkg) => JSON.stringify({ version: pkg.version }) + "\n";
