// Checks the package as npm would publish it, then installs it the way a user would and tries it:
//
//   npm run check:package            (add -- --keep to leave the scratch project for a look)
//
// 1. `npm pack`: the version matches src/version.js, and only the files meant to ship are in the tarball.
// 2. Installs the tarball into a scratch project outside the repository, then imports all three entry points, makes
//    one attempt on the mock and one request through a guarded proxy, typechecks a TypeScript file against the
//    installed types, and plays the CLI with input piped in. No API key is passed to anything.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const keep = process.argv.includes("--keep");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const { VERSION } = await import(new URL("../src/version.js", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "honeytongue-package-"));
// Nothing here needs a key, and the smoke tests must prove it.
const env = { ...process.env, TYPESAFE_API_KEY: "", NO_COLOR: "1" };

let failed = 0;
const report = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
};
/** Run a command line (through the shell, so npm and npx work on Windows too). */
const run = (command, cwd, input) => spawnSync(command, { cwd, env, input, shell: true, encoding: "utf8", timeout: 120_000 });
const quote = (path) => `"${path}"`;

// Files that ship: the library, the scenes, the examples, the playground page and its styles, and the basics.
const SHIPS = [/^src\//, /^stories\//, /^examples\//, /^docs\/playground\//, /^docs\/assets\/fonts\//, /^docs\/assets\/honeytongue-logo-(32|192)\.png$/, /^docs\/(style\.css|theme\.js)$/, /^(package\.json|README\.md|LICENSE)$/];
const MUST = ["package.json", "README.md", "LICENSE", "src/index.js", "src/index.d.ts", "src/persuasion.d.ts", "src/proxy.d.ts",
  "src/cli.js", "src/version.js", "stories/index.json", "docs/playground/index.html"];

try {
  // ---- 1. What npm would publish ----
  const packed = run(`npm pack --json --pack-destination ${quote(scratch)}`, root);
  if (packed.status !== 0) throw new Error(`npm pack failed:\n${packed.stderr}`);
  const [info] = JSON.parse(packed.stdout.slice(packed.stdout.indexOf("[")));
  const files = info.files.map((f) => f.path.replaceAll("\\", "/"));
  report(info.version === pkg.version && pkg.version === VERSION, "the version is the same everywhere",
    `package ${info.version}, package.json ${pkg.version}, src/version.js ${VERSION}`);
  const stray = files.filter((f) => !SHIPS.some((re) => re.test(f)));
  report(stray.length === 0, "only the files meant to ship are packed", stray.length ? `unexpected: ${stray.join(", ")}` : `${files.length} files`);
  const missing = MUST.filter((f) => !files.includes(f));
  report(missing.length === 0, "the files a user needs are packed", missing.length ? `missing: ${missing.join(", ")}` : "");
  const tracked = new Set(run("git ls-files", root).stdout.split(/\r?\n/).filter(Boolean));
  const unshipped = [...tracked].filter((f) => /^(src|stories)\//.test(f) && !files.includes(f));
  report(unshipped.length === 0, "every library and scene file is packed", unshipped.join(", "));
  // A file git doesn't know about (a local .env, a scratch file) must never ship just because it sits in src/.
  // Environment files hold keys (.env.live is where the TypeSafe key lives): none may ever ship, tracked or not.
  const envFiles = files.filter((f) => /(^|\/)\.env(\.|$)|(^|\/)\.dev\.vars$|(^|\/)\.npmrc$/.test(f));
  report(envFiles.length === 0, "no environment or credential file is packed", envFiles.join(", "));
  const untracked = files.filter((f) => !tracked.has(f));
  report(untracked.length === 0, "every packed file is tracked by git", untracked.length ? `untracked: ${untracked.join(", ")}` : "");

  // ---- 2. Installed the way a user would ----
  const project = join(scratch, "project");
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "honeytongue-smoke", private: true, type: "module" }, null, 2));
  const installed = run(`npm install ${quote(join(scratch, info.filename))} --no-audit --no-fund`, project);
  report(installed.status === 0, "the tarball installs", installed.status === 0 ? "" : installed.stderr.trim().slice(-500));
  if (installed.status !== 0) throw new Error("can't continue without an installed package");

  writeFileSync(join(project, "smoke.js"), `
import assert from "node:assert/strict";
import { Persuadable, createMockClient, Game, VERSION } from "honeytongue";
import { judgePersuasion } from "honeytongue/persuasion";
import { createProxyHandler } from "honeytongue/proxy";
import { readFileSync } from "node:fs";

assert.equal(VERSION, ${JSON.stringify(pkg.version)});
const harry = { name: "Harry", persona: "An honest gatekeeper who hates flattery.", goal: "Open the gate" };
const npc = new Persuadable(harry, { client: createMockClient() });
const result = await npc.attempt("Please open the gate, my daughter is sick.");
assert.ok(["convinced", "unconvinced", "offended"].includes(result.verdict));
assert.ok((await judgePersuasion(createMockClient(), harry, "hello")).verdict);

// A request through a guarded proxy, as a browser game would send it: allowed for Harry, refused for anyone else.
const story = JSON.parse(readFileSync(new URL("./node_modules/honeytongue/stories/gatehouse.json", import.meta.url), "utf8"));
const handle = createProxyHandler({ client: createMockClient(), allowedStories: [story], allowedCharacters: [harry], rateLimit: false });
const game = new Game(story, { ask: async (state, questions) => {
  const res = await handle(new Request("https://proxy.test/", { method: "POST", body: JSON.stringify({ state, questions, honeytongue: VERSION }) }));
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()).answers;
} });
await game.turn("Please let me through, Harry.");
const stranger = await handle(new Request("https://proxy.test/", { method: "POST", body: JSON.stringify({ state: { player_input: "hi" }, questions: { q: { type: "noul", instructions: "?" } } }) }));
assert.equal(stranger.status, 403);
console.log("smoke ok");
`);
  const smoke = run("node smoke.js", project);
  report(smoke.status === 0 && smoke.stdout.includes("smoke ok"), "the entry points import and work (mock attempt, guarded proxy)", (smoke.stderr || smoke.stdout).trim().slice(-800));

  writeFileSync(join(project, "smoke.ts"), `
import { Persuadable, createMockClient, validateStory, Game, type AttemptResult } from "honeytongue";
import { createProxyHandler } from "honeytongue/proxy";
import { judgePersuasion } from "honeytongue/persuasion";
const npc = new Persuadable({ name: "Harry", persona: "An honest gatekeeper.", goal: "Open the gate" }, { client: createMockClient() });
const result: Promise<AttemptResult> = npc.attempt("Please.");
const game = new Game(validateStory({}), createMockClient());
export { result, game, createProxyHandler, judgePersuasion };
`);
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, module: "nodenext", moduleResolution: "nodenext",
    target: "es2022", lib: ["es2022", "dom"], types: [], noEmit: true }, files: ["smoke.ts"] }, null, 2));
  for (const [label, tsc] of [["7", "node_modules/typescript/bin/tsc"], ["5.9 (oldest supported)", "node_modules/typescript-5/bin/tsc"]]) {
    if (!existsSync(join(root, tsc))) { report(false, `TypeScript ${label} is installed in the repository (npm ci)`); continue; }
    const checked = run(`node ${quote(join(root, tsc))} -p ${quote(project)}`, project);
    report(checked.status === 0, `the installed types compile with TypeScript ${label}`, (checked.stdout + checked.stderr).trim().slice(-800));
  }

  const cli = run("npx --no-install honeytongue --mock", project, "1\nlook\nquit\n");
  report(cli.status === 0 && /THE GATEHOUSE/i.test(cli.stdout) && cli.stdout.includes("Harry Goatleaf"), "the CLI plays a scene with piped input (npx honeytongue --mock)",
    cli.status === 0 ? "" : `exit ${cli.status}: ${(cli.stderr || cli.stdout).trim().slice(-500)}`);
} catch (err) {
  report(false, "the package check ran to the end", err.message);
} finally {
  if (keep) console.log(`\nScratch project kept at ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nThe package is good to publish.");
process.exit(failed ? 1 : 0);
