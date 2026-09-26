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
| `src/jev.js` | `createJevClient` (server only, refuses browsers) and `createProxyClient` (browser safe) |
| `src/proxy.js` | `createProxyHandler`: Request to Response proxy for Cloudflare, Vercel, Deno, Bun, Node |
| `src/mock.js` | Keyword mock with the same answer shapes, for tests and offline play |
| `src/cli.js` | Terminal player (the only file allowed to use Node built-ins) |
| `src/index.d.ts` | Hand-written TypeScript types for every export and the story format. `persuasion.d.ts` and `proxy.d.ts` re-export the subsets for those entry points |
| `stories/gatehouse.json` | Demo story |
| `evals/gatehouse.json`, `scripts/eval.js` | Evaluation set and runner |
| `examples/` | Standalone, Cloudflare Worker, Node proxy (`npm run proxy`), browser page, Twine recipe |
| `docs/index.html`, `docs/style.css`, `docs/theme.js` | Documentation site for GitHub Pages. Classic text adventure look: amber CRT (dark) or paper teletype (light), shared stylesheet |
| `docs/play/` | Browser version of The Gatehouse. `lib/` holds copies of the engine and story made by `npm run build:demo` (`scripts/build-demo.js`, list in `scripts/demo-files.js`) because Pages only serves `docs/`. Uses the mock unless its `honeytongue-proxy` meta tag has a URL |
| `test/` | `node:test` unit tests using a scripted fake client. `demo.test.js` fails if `docs/play/lib` is stale |
| `CHANGELOG.md` | Unreleased changes, for the release notes |

## Principles (do not break these)

1. **Jev judges, code decides.** Jev only classifies input and scores persuasion. All state changes and all narration come from code or the story file. Never make Jev generate text.
2. **Zero runtime dependencies.** Plain ESM JavaScript, Node 18+. Dev tooling is fine if it earns its place, but ask first.
3. **Everything in `src/` except `cli.js` must run in a browser.** No `node:` imports, no bare `process` (use `globalThis.process?.env`).
4. **API keys never reach the browser, the repo, or logs.** The key comes from the `TYPESAFE_API_KEY` environment variable. Never write it to a file, never print it.
5. **Keep types, README, and docs in sync** with any API change, and run `npm run build:demo` after changing `src/` or `stories/`.
6. **Readable errors.** Developer mistakes throw `HoneytongueError` (or `StoryError`, which lists every problem) with a message that says how to fix it.

## Commands

```
npm test             # unit tests, no key needed. Must stay green.
npm run play:mock    # play the demo offline
npm run play         # play with Jev (needs TYPESAFE_API_KEY)
npm run eval         # evaluation set against Jev (add -- --mock for the baseline)
npm run example      # standalone example
npm run proxy        # proxy on localhost:8787 (mock without a key)
npm run build:demo   # refresh docs/play/lib after changing src/ or stories/
```

The human develops on Windows in VS Code with PowerShell. Set the key with `$env:TYPESAFE_API_KEY="..."`. Keep npm scripts cross-platform (no Bash-only syntax).

## Current status and known unknowns

- Phase 1 is done (2026-09-25). Unit tests pass (57, which includes `test/helpers.js`: `node --test` counts every file under `test/`) on Node 18, 20, 22, and 24. Keyword mock baseline on the eval set: action 15/17, score 7/7, tells 2/2.
- **TypeSafe paused new signups on 2026-09-24, so there is no API key yet.** While waiting, the work that doesn't need Jev was done ahead of order: a bug and edge-case pass over every module (see `CHANGELOG.md`), the docs site restyle and mobile/dark-mode check from Phase 4, and the browser demo from Phase 5 (it runs on the offline mock, and the docs hero links it as an "offline preview").
- **Nothing has been run against live Jev yet.** The client was written from the API docs, and now checks every response's shape so a mismatch fails with a clear message. Thresholds, rubric wording, and the default levels are guesses until real evals run.
- The Twine recipe (`examples/twine-sugarcube.md`) is untested inside Twine.
- Scores shown in the docs site hero are illustrative placeholders, labeled as such.
- The repository is github.com/tbrought/honeytongue (the site will be tbrought.github.io/honeytongue). The version is `0.1.0-alpha.0`, to be published with `npm publish --tag alpha` to hold the name; the stable `0.1.0` comes after live Jev validation.
- Character settings (0.1.0-alpha.1): `difficulty` maps a word to a share of the top rubric level (easy 0.6, normal 0.8, hard 0.9, very hard 0.95, in `DIFFICULTY` in `persuasion.js`). **These shares are guesses and need calibrating against live Jev.** `offendedBy` picks which tells offend; tells not in it are left to the persona, via an extra sentence in the persuasion question (also unverified live). Results carry `tells` and `triggered`; `hostility` is gone. `decide(result, context)` is a synchronous character hook applied in `record()` and `judgePersuasion()`, not `readPersuasion()`. Don't add stages, extra or custom tells, or closeness labels until there are live results.
- The npm name `honeytongue` was available on 2026-09-25 (`npm view` returned 404). Check again before release.
- The folder isn't a git repository yet, so the CI workflow hasn't run.

## Plan

Work through these phases in order. At the end of each phase, stop, summarize what changed and what you found, and wait for approval before starting the next.

**Phase 1: Verify locally.** Run `npm test`, `npm run play:mock`, `npm run example`, and `npm run eval -- --mock` on this machine. Fix anything that fails on Windows. Add a `.github/workflows/test.yml` that runs `npm test` on current Node LTS versions.

**Phase 2: Live Jev validation.** Ask the human to set `TYPESAFE_API_KEY` in the terminal (never ask them to paste it into chat or a file). Make one small live request first and confirm the response shape matches `src/jev.js`. Then run `npm run eval` and report every miss. Tune Harry's persona, the rubric levels, and thresholds in the story file (not in code) until results are sensible, rerunning evals after each change. Record final eval results in the README. Also note typical latency and token usage per call.

**Phase 3: Hardening from real results.** Based on Phase 2, decide with the human whether the defaults in `persuasion.js` (levels, difficulty shares, hostileAt, repeatSimilarity) need to change. Add eval cases for any failure you discover.

**Phase 4: Docs site.** Replace the hero's illustrative scores with real ones from Phase 2, fix the GitHub link, and check the page on a narrow mobile width and in dark mode. The human will enable GitHub Pages from `/docs`.

**Phase 5: Proxy and playable demo.** Help the human deploy `examples/cloudflare-worker.js`. Build a browser version of The Gatehouse (it can reuse `Game` from `src/engine.js` with `createProxyClient`) and link it from the docs site.

**Phase 6: Release.** Confirm the npm name is free (`npm view honeytongue`), bump the version, check `npm pack --dry-run` contents, and prepare release notes. The human runs `npm login` and `npm publish` themselves.

## Things only the human can do

Get the TypeSafe API key, create GitHub, npm, and Cloudflare accounts, approve spending, run `npm publish`, and make naming and licensing decisions. Ask rather than guess on any of these.
