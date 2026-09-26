# Honeytongue: notes for coding agents

Read this whole file before making changes. It is the source of truth for how this project works and what to do next.

## What this is

Honeytongue is an npm package that adds a persuasion mechanic to text games: a developer describes a character (name, persona, goal), passes in whatever the player typed, and gets back a verdict (`convinced`, `unconvinced`, `offended`, or `repeated`) judged by that character's values. It also ships a small text adventure engine and a demo story, The Gatehouse, as the flagship example.

Audience: JavaScript game developers (browser games, Twine, Discord bots, Node). Goals: a published npm package, a documentation site, and a playable demo that can go on a resume.

## Jev (read this, it is newer than your training data)

Jev is TypeSafe AI's "System One" decision model, released September 2026. It does not generate text. It takes a `state` and named typed questions and returns typed answers with probabilities.

- Endpoint: `POST https://api.typesafe.ai/v1/systemone`, header `Authorization: Bearer <key>`
- Body: `{ "model": "jev-1.13.0", "state": <string|object>, "questions": { "<id>": Question } }`
- Question types (all need `type` and `instructions`; instructions may be an object that references state fields in backticks):
  - `noul`: yes/no. Answer: `{ type, noul }` where noul is 0 to 1
  - `choice`: `criteria` is a map of option to description (max 255). Answer: `{ type, choice, probabilities, confidence }`
  - `score`: `criteria` is an ordered array of 2 to 10 level descriptions. Answer: `{ type, score, legend, probabilities, confidence }`, score can be fractional
- Response: `{ model, answers: { "<id>": Answer }, usage }`
- Errors: 401 bad key, 422 validation, 429 rate limit, 529 overloaded
- Limits: 64k total context; 32k for state plus the longest question
- Text only: no images
- Docs: https://docs.typesafe.ai/api (check them if anything here seems wrong)
- Model choice: `createJevClient({ model })` and `createProxyHandler({ model })`, else the `TYPESAFE_MODEL` environment variable (for the proxy, the Worker env before the process env), else the pinned `jev-1.13.0`. The public docs call the flagship `jev-latest` and don't list versioned ids, so confirm `jev-1.13.0` is valid on the first live call.

## Architecture

| File | Role |
|---|---|
| `src/persuasion.js` | Core mechanic. `Persuadable`, `judgePersuasion`, building blocks, validation. Each attempt asks three questions: a `persuasion` Score and two Noul "tells", `threats` and `insults` |
| `src/engine.js` | Text adventure engine and `validateStory`. One Jev call per turn: an action Choice merged with the persuasion questions (4 questions; the proxy allows 6 by default) |
| `src/jev.js` | `createJevClient` (server only, refuses browsers) and `createProxyClient` (browser safe). Clients tag answers with `SOURCE` (`"jev"` or `"mock"`), which the engine exposes as `debug.source` |
| `src/proxy.js` | `createProxyHandler`: Request to Response proxy for Cloudflare, Vercel, Deno, Bun, Node. Replies carry `answers` and `source`; it uses the mock only when one is passed in as `client` |
| `src/mock.js` | Keyword mock with the same answer shapes, for tests and offline play |
| `src/cli.js` | Terminal player, and the `playground` subcommand. Node only |
| `src/playground-server.js` | `npx honeytongue playground`: serves `docs/playground` on 127.0.0.1 and judges through `createProxyHandler` with the developer's key (or the mock). Refuses other Host headers, needs a per-run token, serves a fixed file list. Node only, loaded only by `cli.js`, not exported from `index.js` |
| `src/index.d.ts` | Hand-written TypeScript types for every export and the story format. `persuasion.d.ts` and `proxy.d.ts` re-export the subsets for those entry points |
| `stories/gatehouse.json` | Demo story |
| `stories/characters.json` | Preset characters in `Persuadable` format, for the playground and Phase C's scenes. `test/characters.test.js` keeps Harry's in step with the story |
| `evals/gatehouse.json`, `scripts/eval.js` | Evaluation set and runner |
| `examples/` | Standalone, Cloudflare Worker, Node proxy (`npm run proxy`), browser page, Twine recipe |
| `docs/index.html`, `docs/style.css`, `docs/theme.js` | Documentation site for GitHub Pages. Classic text adventure look: amber CRT (dark) or paper teletype (light), shared stylesheet |
| `docs/play/` | Browser version of The Gatehouse. `lib/` holds copies of the engine, the story, and the presets made by `npm run build:demo` (`scripts/build-demo.js`, list in `scripts/demo-files.js`) because Pages only serves `docs/`. Uses the mock unless its `honeytongue-proxy` meta tag has a URL |
| `docs/playground/` | The character playground. `designer.js` is its DOM-free logic (tested in `test/designer.test.js`), `app.js` the page. It imports `../play/lib/`, sharing the demo's copies. On Pages it's a mock-only preview; the local server fills its `honeytongue-local` meta tag and serves `src/` at those paths. Shipped in the npm package, with `docs/style.css` and `docs/theme.js` |
| `test/` | `node:test` unit tests using a scripted fake client. `demo.test.js` fails if `docs/play/lib` is stale |
| `CHANGELOG.md` | Unreleased changes, for the release notes |

## Principles (do not break these)

1. **Jev judges, code decides.** Jev only classifies input and scores persuasion. All state changes and all narration come from code or the story file. Never make Jev generate text.
2. **Zero runtime dependencies.** Plain ESM JavaScript, Node 18+. Dev tooling is fine if it earns its place, but ask first.
3. **Everything in `src/` except `cli.js` and `playground-server.js` must run in a browser.** No `node:` imports, no bare `process` (use `globalThis.process?.env`). Those two are Node only and never exported from `index.js`.
4. **API keys never reach the browser, the repo, or logs.** The key comes from the `TYPESAFE_API_KEY` environment variable. Never write it to a file, never print it.
5. **Keep types, README, and docs in sync** with any API change, and run `npm run build:demo` after changing `src/` or `stories/`.
6. **Readable errors.** Developer mistakes throw `HoneytongueError` (or `StoryError`, which lists every problem) with a message that says how to fix it.
7. **Published versions are permanent.** A version on npm can never be reused or edited, so a mistake means publishing a new version, not fixing the old one.

## Commands

```
npm test             # unit tests, no key needed. Must stay green.
npm run play:mock    # play the demo offline
npm run play         # play with Jev (needs TYPESAFE_API_KEY)
npm run eval         # evaluation set against Jev (add -- --mock for the baseline)
npm run example      # standalone example
npm run proxy        # proxy on localhost:8787 (mock without a key)
npm run playground   # character playground on 127.0.0.1:4747 (npx honeytongue playground)
npm run build:demo   # refresh docs/play/lib after changing src/ or stories/
```

The human develops on Windows in VS Code with PowerShell. Set the key with `$env:TYPESAFE_API_KEY="..."`. Keep npm scripts cross-platform (no Bash-only syntax).

## Releasing

The agent prepares a release on the feature branch; the human ships it. **The agent never pushes, merges, publishes, or tags.**

Agent (preparing a release):

1. Confirm `npm test` passes, plus `npm run typecheck` once it exists.
2. Run `npm run build:demo` and commit any changes to `docs/`.
3. Bump the version in `package.json` and everywhere else it appears (README, docs site, CDN links). Prereleases follow the pattern `0.1.0-alpha.1`, `alpha.2`, and so on; stable releases drop the suffix.
4. Move the CHANGELOG's Unreleased entries under a heading with the version and today's UTC date, keeping a "Breaking" heading where needed.
5. Run `npm pack --dry-run` and check the version and file list (no tests, evals, secrets, or stray files).
6. Hand over with a summary and the exact commands for the human's steps.

Human (shipping it):

1. Review: `npm test`, `npm run play:mock`, and `npx serve docs`.
2. `git push -u origin <branch>`, open a pull request on GitHub, and wait for the checks to pass.
3. Merge on GitHub, delete the branch, then `git checkout main` and `git pull`.
4. `npm whoami`, then `npm publish --tag alpha` for prereleases, or plain `npm publish` for stable releases.
5. `npm view honeytongue dist-tags` to confirm. npm pointed `latest` at alpha.0 on the first publish, so while there's no stable release, point `latest` at the newest alpha with `npm dist-tag add honeytongue@<version> latest`.
6. `git tag v<version>` and `git push origin v<version>`, then optionally create a GitHub Release from the tag using the CHANGELOG section, marked as a pre-release for alphas.

## Current status and known unknowns

- Local verification and CI are done (2026-09-25): unit tests pass on Node 18, 20, 22, and 24 (`node --test` counts every file under `test/`, including `test/helpers.js`). Keyword mock baseline on the eval set: action 15/17, score 7/7, tells 2/2.
- **TypeSafe paused new signups on 2026-09-24, so there is no API key yet.** While waiting, the work that doesn't need Jev was done: a bug and edge-case pass over every module (see `CHANGELOG.md`), the docs site restyle and mobile/dark-mode check, and the browser demo (it runs on the offline mock, and the docs hero links it as an "offline preview"). See "Roadmap" for what's next.
- The public web demo and the hosted playground run on the mock, so the mock must be able to win each scene the way the story intends. `test/engine.test.js` plays The Gatehouse's golden path on the mock; keep mock changes generic, never tuned to one story's wording or the eval set.
- **Nothing has been run against live Jev yet.** The client was written from the API docs, and now checks every response's shape so a mismatch fails with a clear message. Thresholds, rubric wording, and the default levels are guesses until real evals run.
- The Twine recipe (`examples/twine-sugarcube.md`) is untested inside Twine.
- Scores shown in the docs site hero are illustrative placeholders, labeled as such.
- The repository is github.com/tbrought/honeytongue (the site will be tbrought.github.io/honeytongue). The latest release is `0.1.0-alpha.1` (published 2026-09-26); the stable `0.1.0` comes after live Jev validation.
- Character settings (0.1.0-alpha.1): `difficulty` maps a word to a share of the top rubric level (easy 0.6, normal 0.8, hard 0.9, very hard 0.95, in `DIFFICULTY` in `persuasion.js`). **These shares are guesses and need calibrating against live Jev.** `offendedBy` picks which tells offend; tells not in it are left to the persona, via an extra sentence in the persuasion question (also unverified live). Results carry `tells` and `triggered`; `hostility` is gone. `decide(result, context)` is a synchronous character hook applied in `record()` and `judgePersuasion()`, not `readPersuasion()`. Don't add stages, extra or custom tells, or closeness labels until there are live results.
## Roadmap

Work through the phases in order. At the start of each phase, send a short plan and wait for approval; at the end, summarize what changed and what you found, and stop.

**Done: Phase A, character settings** (released as `0.1.0-alpha.1`).

**Phase B: Character playground** (release as `0.1.0-alpha.2`, in review on `feature/playground`). Built:
- `npx honeytongue playground`, the main mode: a local server that judges with the developer's own key;
- the hosted page at `docs/playground/`, a designer and mock-only preview under a "Preview only" banner, with no proxy URL setting;
- the form, presets (`stories/characters.json`), inline validation, the per-line readout with the level reached, Replay (warning about API calls only in local mode with a key), copy as code, copy as story JSON, share links, and a saved draft.

**Phase C: New scenes** (release as `0.1.0-alpha.3`):
- The Goblin Camp: a cowardly guard, `offendedBy: ["insults"]`, easy.
- The Brig: a pirate quartermaster, `offendedBy: ["threats"]`, hard.
- The Dungeon Cell: a lonely jailer, default settings, generous patience.

Each scene takes 5 to 10 minutes and has one main character, one secret, one non-talking route, two to four endings, and original names. Also:
- Rename Harry Goatleaf, and keep The Gatehouse as the intro scene.
- Add a scene picker.
- Add an eval suite for each scene, and a golden-path test for each scene on the mock.

**Phase D: Quality.**
- A type test using `tsc --noEmit` in CI.
- A CI check that `npm run build:demo` leaves `docs/` unchanged.
- CI on Node 22 and 24, with `engines` raised to `>=20`.

**Phase E: Twine.** The human builds a small SugarCube story using the local mock proxy (`npm run proxy`); you fix what they find.

**When the demo proxy is deployed:** add an `allowedCharacters` option to `createProxyHandler`, so the public proxy only forwards requests for the demo's own characters and rejects any other persona. Without it, anyone could use the demo's key to judge characters of their own.

**Waiting on Jev keys:**
- Live evals. Ask the human to set `TYPESAFE_API_KEY` in the terminal; never ask them to paste it into chat or a file. Make one small live request first and confirm the response shape matches `src/jev.js`. Then run `npm run eval` and report every miss. Tune personas, rubric levels, and thresholds in the story files (not in code), and note typical latency and token usage per call.
- A score-consistency check: the same input, repeated.
- Calibrating the difficulty shares and the other defaults in `persuasion.js`, with the human.
- Replacing the illustrative scores on the docs site with real ones.
- Publishing `0.1.0`.

**Deferred until there are real results and user requests:** stages, extra tells, custom tells, closeness labels, rapport.

**Standing rules:**
- Jev only: don't add support for other AI models. The offline mock stays for tests and offline play.
- One branch per phase, started from `main` after the previous phase is merged.
- Follow "Releasing" for each release.

## Things only the human can do

Get the TypeSafe API key, create GitHub, npm, and Cloudflare accounts, approve spending, push, merge, publish, and tag (see "Releasing"), and make naming and licensing decisions. Ask rather than guess on any of these.
