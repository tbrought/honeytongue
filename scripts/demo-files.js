// The files the browser demo (docs/play) and the playground (docs/playground) need, as [source, copy] pairs relative to the repository root.
// Shared by scripts/build-demo.js, which copies them, and test/demo.test.js, which checks the copies are current.
export const DEMO_FILES = [
  "src/engine.js",
  "src/persuasion.js",
  "src/jev.js",
  "src/mock.js",
  "stories/gatehouse.json",
  "stories/characters.json",
].map((source) => [source, `docs/play/lib/${source.split("/").pop()}`]);
