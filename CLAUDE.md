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
- Model choice: `createJevClient({ model })` and `createProxyHandler({ model })`, else the `TYPESAFE_MODEL` environment variable (for the proxy, the Worker env before the process env), else the pinned `jev-1.13.0`. Confirmed live on 2026-09-28: `jev-1.13.0` is TypeSafe's only model, and the `jev-latest` and `jev-preview` aliases point to it. Pricing: $0.042 per million input tokens, output free; `usage` has `input_tokens` and `output_tokens`.

## Architecture

| File | Role |
|---|---|
| `src/persuasion.js` | Core mechanic. `Persuadable`, `judgePersuasion`, building blocks, validation. Each attempt asks three questions: a `persuasion` Score and two Noul "tells", `threats` and `insults` |
| `src/engine.js` | Text adventure engine and `validateStory`. One Jev call per turn: an action Choice merged with the persuasion questions (4 questions; the proxy allows 6 by default) |
| `src/jev.js` | `createJevClient` (server only, refuses browsers) and `createProxyClient` (browser safe, sends `honeytongue: VERSION` with each request and keeps a proxy's `reason` on its errors). Clients tag answers with `SOURCE` (`"jev"` or `"mock"`), which the engine exposes as `debug.source` |
| `src/proxy.js` | `createProxyHandler`: Request to Response proxy for Cloudflare, Vercel, Deno, Bun, Node. Replies carry `answers` and `source`; it uses the mock only when one is passed in as `client`. Failures carry a `reason` (403: `version`, `not-allowed`, `state`; 502: `busy`, `error`, `unavailable`). Logs only a status, never player input |
| `src/guard.js` | The proxy's exact-request guard for `allowedStories` and `allowedCharacters`: the library's exact questions (`Game.requests(story)`, `persuasionQuestions`), the character as written with learned secrets only, the story's own item and flag names, and caps on every free-form part (`previous_attempts` at `memory`, `recent_turns` at the engine's `HISTORY`, entry lengths). A mismatch from a different `VERSION` is reported as `version` |
| `src/version.js` | `VERSION`, kept equal to `package.json` by `test/version.test.js`; used by the CLI and demo transcripts and sent with proxy requests |
| `src/mock.js` | Keyword mock with the same answer shapes, for tests and offline play |
| `src/cli.js` | Terminal player (a menu of the bundled scenes when no story path is given; `--transcript <file>` saves a playtest transcript), and the `playground` subcommand. Node only |
| `src/transcript.js`, `scripts/transcript-to-evals.js` | Opt-in playtest transcripts (browser-safe, not exported from `index.js`), used by the CLI and the web demo's "Record playtest", and a script that turns one into draft eval cases. `TRANSCRIPT_FORMAT` is the format version: bump it when a turn's shape changes, and teach the script to read the old one. Playtests go in the git-ignored `playtests/` |
| `src/playground-server.js` | `npx honeytongue playground`: serves `docs/playground` on 127.0.0.1 and judges through `createProxyHandler` with the developer's key (or the mock). Refuses other Host headers, needs a per-run token, serves a fixed file list. Node only, loaded only by `cli.js`, not exported from `index.js` |
| `src/index.d.ts` | Hand-written TypeScript types for every export and the story format. `persuasion.d.ts` and `proxy.d.ts` re-export the subsets for those entry points |
| `stories/*.json` | The demo scenes: `gatehouse` (the introductory scene), `goblin-camp`, `tidy-profit`, `lighthouse`. `stories/index.json` lists them in order with a hook and play time, for the CLI menu and the web demo's picker |
| `stories/characters.json` | Preset characters in `Persuadable` format, one per scene, for the playground. `test/characters.test.js` keeps each scene's character identical to its preset |
| `evals/*.json`, `scripts/eval.js` | An eval suite per scene (actions, score ranges, tells, verdicts), plus `showcase.json`: five tactics tried on every preset, shown as the docs site's "Same words, different people" grid (`test/showcase.test.js` keeps the grid in step). `npm run eval -- <suite>` or `-- --all` |
| `examples/` | Standalone, Cloudflare Worker, Node proxy (`npm run proxy`), browser page, Twine recipe, and the demo's own proxy: `demo-worker.js` with `demo-wrangler.toml` (Worker `honeytongue-demo` at `https://api.honeytongue.dev/judge`, locked to the four scenes, origins in the `ALLOWED_ORIGINS` var). `docs/demo-proxy.md` has the human's deployment steps; `scripts/check-demo-proxy.js <url>` checks a deployed one |
| `docs/index.html`, `docs/style.css`, `docs/theme.js` | Documentation site for GitHub Pages. Classic text adventure look: amber CRT (dark) or paper teletype (light), shared stylesheet |
| `docs/play/` | Browser version of the demo scenes: a picker, and `#<scene id>` plays one. `lib/` holds copies of the engine, the stories, the scene list, and the presets made by `npm run build:demo` (`scripts/build-demo.js`, list in `scripts/demo-files.js`) because Pages only serves `docs/`. Uses the mock unless its `honeytongue-proxy` meta tag has a URL; then `fallback.js` (DOM-free, tested in `test/fallback.test.js`) judges with Jev and falls back to the mock: for the session on a 403 or `unavailable`, for about a minute when busy or unreachable, and after 50 live turns per tab (sessionStorage) |
| `docs/playground/` | The character playground. `designer.js` is its DOM-free logic (tested in `test/designer.test.js`), `app.js` the page. It imports `../play/lib/`, sharing the demo's copies. On Pages it's a mock-only preview; the local server fills its `honeytongue-local` meta tag and serves `src/` at those paths. Shipped in the npm package, with `docs/style.css` and `docs/theme.js` |
| `evals/calibration/`, `scripts/calibrate.js`, `scripts/live.js`, `scripts/live-recorder.js`, `scripts/patches.js` | Live calibration (Phase F): argument sets for the difficulty words, secrets, injections, threats, flattery, and 12 characters we didn't design, plus candidate patches tried with `--patch` before adoption. The recorder wraps the Jev client's fetch to log each response's latency and tokens to the git-ignored `live-runs/` (never headers, so never the key), with a running token budget. `live.js --via-proxy` sends every call through a proxy guarded like the demo's |
| `docs/live-results.md` | Readable summary of the live calibration; raw outputs stay in `live-runs/` |
| `test/` | `node:test` unit tests using a scripted fake client. `scenes.test.js` plays every scene's talking and non-talking routes on the mock. `demo.test.js` fails if `docs/play/lib` is stale |
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
npm run eval         # evaluation set against Jev (-- --all, --repeats 10, --record, --patch <file>, --mock)
npm run example      # standalone example
npm run proxy        # proxy on localhost:8787 (mock without a key)
npm run playground   # character playground on 127.0.0.1:4747 (npx honeytongue playground)
npm run build:demo   # refresh docs/play/lib after changing src/ or stories/
```

The human develops on Windows in VS Code with PowerShell. Set the key with `$env:TYPESAFE_API_KEY="..."`. Keep npm scripts cross-platform (no Bash-only syntax).

## Releasing

The agent prepares a release on the feature branch; the human ships it. **The agent never pushes, merges, publishes, or tags.**

**Versioning.** The next stable release is `0.1.0`, not `1.0.0`. `1.0` is saved for when the API has settled with real users, because it promises no breaking changes without a major version bump. Until then, a `0.x` minor bump (`0.1` to `0.2`) may contain breaking changes, and they're always listed under "Breaking" in the CHANGELOG.

Agent (preparing a release):

1. Confirm `npm test` passes, plus `npm run typecheck` once it exists.
2. Run `npm run build:demo` and commit any changes to `docs/`.
3. Bump the version in `package.json`, `src/version.js` (`test/version.test.js` checks they match), and everywhere else it appears (README, docs site, CDN links). Prereleases follow the pattern `0.1.0-alpha.1`, `alpha.2`, and so on; stable releases drop the suffix.
   CDN links (docs site, README, `examples/`) load `honeytongue@alpha` while only prereleases exist, because jsDelivr can't resolve a range like `@0.1` to a prerelease. **When `0.1.0` ships, switch them back to a version range such as `@0.1`.**
4. Move the CHANGELOG's Unreleased entries under a heading with the version and today's UTC date, keeping a "Breaking" heading where needed.
5. Run `npm pack --dry-run` and check the version and file list (no tests, evals, secrets, or stray files).
   **If the release changes stories, personas, or scene logic, run a full live rerun first**: `npm run eval -- --all --repeats 10` and `node scripts/live.js routes --repeats 10`, fixing anything that fails. Unit tests run on the mock, so they can't catch a change in how Jev routes or scores a line.
6. Hand over with a summary and the exact commands for the human's steps.

Human (shipping it):

1. Review: `npm test`, `npm run play:mock`, and `npx serve docs`.
2. `git push -u origin <branch>`, open a pull request on GitHub, and wait for the checks to pass.
3. Merge on GitHub, delete the branch, then `git checkout main` and `git pull`.
4. `npm whoami`, then `npm publish --tag alpha` for prereleases, or plain `npm publish` for stable releases.
5. `npm view honeytongue dist-tags` to confirm. npm pointed `latest` at alpha.0 on the first publish, so while there's no stable release, point `latest` at the newest alpha with `npm dist-tag add honeytongue@<version> latest`.
6. `git tag v<version>` and `git push origin v<version>`, then optionally create a GitHub Release from the tag using the CHANGELOG section, marked as a pre-release for alphas.
7. **If the release changes the persuasion questions, the stories, or the personas, redeploy the demo Worker** (`honeytongue-demo`) with the new version: `npx wrangler deploy --config examples/demo-wrangler.toml` from `main`, then `node scripts/check-demo-proxy.js https://api.honeytongue.dev/judge`. It only accepts requests that match its own copy of the library exactly, so an old Worker refuses the new demo's requests, and the demo falls back to the offline mock with a note about the version mismatch.

(Phase D replaces steps 4 to 6 with publishing from GitHub Actions: the human pushes the tag and approves the run.)

**Rollback.** Published versions can't be edited or reused. If a release is broken, first run `npm dist-tag add honeytongue@<previous version> latest` to point new installs back at the last good version, then fix it and publish a patch release (such as `0.1.1`).

**Launch checklist for stable `0.1.0`**, on top of the steps above:
- **Prerequisite:** Phase G is live, with the demo proxy's spending ceiling and rate limits in place before any announcement.
- **Behaviour changes:** anything that changes how existing characters play (such as recalibrated difficulty fractions) goes under "Breaking" or "Changed" in the CHANGELOG, with how to keep the old behaviour (for example, setting an explicit `threshold`).
- **Test the published package, not the repo:** after publishing, install `honeytongue` from npm into an empty folder on Windows and on Linux, and run the quick start, `npx honeytongue`, and `npx honeytongue playground`.
- **Tags:** point `latest` at `0.1.0`, then deprecate the prereleases with `npm deprecate honeytongue@"<0.1.0" "Prerelease. Please upgrade to 0.1.0."` so alpha users see a gentle warning.
- **Release notes:** tell alpha users to switch CDN links from `@alpha` to `@0.1`.

## Current status and known unknowns

- Local verification and CI are done (2026-09-25): unit tests pass on Node 18, 20, 22, and 24 (`node --test` counts every file under `test/`, including `test/helpers.js`).
- **Live Jev validation is done (Phase F, 2026-09-28; details in `docs/live-results.md`).** 2,626 calls, about $0.11. On the final defaults: scene and showcase suite verdicts 43/43, scores 18/18, threats 8/8, insults 7/7, actions 64/67; every scripted line reliable in 10 of 10 repeats; no injection attempt won (over 50 tried); identical attempts vary by a standard deviation of 0.09 at most. An attempt is about 780 tokens (723 input), an engine turn about 1,400 (1,237 input), about 100 ms median and 150 ms at the 95th percentile. The keyword mock's baseline: action 57/67, verdict 41/43.
- **Defaults after calibration:** `DEFAULT_LEVELS` is rubric C, which judges an attempt only by how it moves the persona (the old rubric, quoted in the CHANGELOG, called flattery, lies, and demands counterproductive in general, so cowards couldn't fold). Unlearned secrets aren't sent to Jev at all (`persuasionState` includes only learned ones), because marking them unknown didn't stop them helping. The difficulty shares (easy 0.6, normal 0.8, hard 0.9, very hard 0.95) were kept: they match their meanings on rubric C (easy: a reasonable argument wins without the secret; normal: an argument that speaks to what they care about wins; hard: about 2 in 3 compelling arguments; very hard: about 1 in 3). `hostileAt` 0.7 and the parser's `ACT_AT` 0.6 and `CLARIFY_AT` 0.3 were kept.
- **Multi-turn calibration (2026-09-29, `scripts/multiturn.js`):** building an argument helps (+0.3 to +0.8 over fresh); no grudges (an honest offer after flattery and a threat scores as fresh); reworded points count for less for Harry and Maude (−0.3 to −0.8) but reassurance helps Cobb (+0.25 to +1.36); word-for-word repeats after learning a secret are caught locally, and letting them through to Jev ("fix B") didn't help, since Jev's memory discounts them anyway, so it wasn't adopted. A point regained full weight once it left a 4-attempt memory, so the default `memory` is now 10. A remark belittling Nib's situation registers as an insult (a documented borderline case in his suite). Patience values for Maude and Nib wait on the human's playtests.
- **What the data says about personas:** say what moves a character, not only what they dislike; say plainly if a tactic works on them (a coward needs "a firm threat makes him give in"); pass in evidence a persona demands; difficulty is relative to how strict the persona is; custom rubrics of other lengths score 0.10 to 0.14 of the top lower, so the difficulty words are approximate there.
- **Reliability rule for scripted lines** (scene routes, eval cases with a verdict, the showcase): the intended verdict in 10 of 10 repeats, with the average at least 0.1 from the threshold, repeated the way players meet the line (engine turns for scenes, standalone attempts for the showcase). Scores barely vary between repeats but bunch up near the top (the best arguments score about 3.7 to 3.9 of 4), so a hard character's winning line necessarily sits close to its threshold. Check with `npm run eval -- --all --repeats 10` and `node scripts/live.js routes --repeats 10`. Each scene's suite also checks that a bare opening plea doesn't win.
- **The API key** (`honeytongue-local-dev`) is a Windows user environment variable, `TYPESAFE_API_KEY`, set by the human. Never ask them to paste it, and never print, log, or write it anywhere; check it's set without printing it. Live runs go through `scripts/live-recorder.js`, which keeps a running token total and stops at its budget (raise it only with the human's say-so).
- The public web demo and the hosted playground run on the mock, so the mock must be able to win each scene the way the story intends. `test/scenes.test.js` plays each scene's talking route to its success ending, and its non-talking route to its ending, on the mock; keep mock changes generic, never tuned to one story's wording or the eval set.
- The Twine recipe (`examples/twine-sugarcube.md`) is untested inside Twine.
- **Harry Goatleaf keeps his name.** It's a deliberate nod to Tolkien, and the human has settled it: don't rename him or suggest renaming him. Every other character, place, and line should be original; web-search any new character's full name before proposing it.
- The repository is github.com/tbrought/honeytongue. The site is https://honeytongue.dev (GitHub Pages with a custom domain, `docs/CNAME`; tbrought.github.io/honeytongue redirects there). The human owns honeytongue.dev on Cloudflare. The latest release is `0.1.0-alpha.6` (prepared 2026-09-29: the live demo's proxy guard, fallback, turn cap, and Worker; alpha.5 is published).
- **Phase G (live demo) is built; going live waits on the human.** They deploy the Worker `honeytongue-demo` at `https://api.honeytongue.dev/judge` with the `honeytongue-demo-proxy` key, a spending ceiling, and a rate limiting rule (steps in `docs/demo-proxy.md`), and run `node scripts/check-demo-proxy.js https://api.honeytongue.dev/judge`. Then the agent prepares a one-line pull request setting the demo's `honeytongue-proxy` meta tag to that address: website only, no npm release. How TypeSafe reports running out of credit isn't documented; the proxy treats Jev's 401, 402, and 403 as `unavailable`.
- Character settings: `difficulty` maps a word to a share of the top rubric level (`DIFFICULTY` in `persuasion.js`). `offendedBy` picks which tells offend; tells not in it are left to the persona. Results carry `tells` and `triggered`. `decide(result, context)` is a synchronous character hook applied in `record()` and `judgePersuasion()`, not `readPersuasion()`. Don't add stages, extra or custom tells, or closeness labels until multi-turn results and users call for them.
## Roadmap

Work through the phases in order. At the start of each phase, send a short plan and wait for approval; at the end, summarize what changed and what you found, and stop.

**Done:**
- Phase A, character settings (`0.1.0-alpha.1`).
- The mock fix and Phase B, the character playground (`0.1.0-alpha.2`).
- Phase C, scenes and the "Same words, different people" showcase (`0.1.0-alpha.3`).
- Phase F, live Jev validation (`0.1.0-alpha.4`): calibration, rubric C, secrets sent only once learned, the reliability rule, and the docs restructured from simple to advanced. See `docs/live-results.md`.
- Multi-turn calibration and playtest tooling (`0.1.0-alpha.5`): opt-in transcripts, memory 10, one penalty per turn, the out-of-patience text alone on the last turn, spoken threats judged as speech, patience shown in the terminal, and Maude's patience and banter.
- Phase G, live demo (`0.1.0-alpha.6`): the proxy's exact-request guard (`allowedStories`, `allowedCharacters`, `VERSION`), the demo's fallback and 50-turn cap, and the demo Worker. Going live is the human's deployment plus a one-line website pull request (see "Current status").

**In order from here:**

1. **Turn on the live demo** once the human has deployed the Worker and the check script passes: a one-line pull request setting the meta tag (website only, no npm release).
2. **Phase D, quality.** A type test (`tsc --noEmit`) in CI, a CI check that `npm run build:demo` leaves `docs/` unchanged, a package smoke test, CI on Node 20, 22, and 24 on Ubuntu and Windows (with `engines` raised to match), `.gitattributes`, README badges, and `SECURITY.md`.
   - Publishing from GitHub Actions with npm trusted publishing (OIDC) and provenance, instead of from the human's laptop, so no long-lived npm token is stored anywhere. A release workflow triggered by pushing a version tag (`v*`) runs the full test suite, the typecheck, and the package check, then publishes prereleases with `--tag alpha` and stable versions as `latest`. It waits for the human's approval through a protected GitHub environment before publishing.
   - Tell the human exactly what to configure on npmjs.com (the trusted publisher) and in GitHub's settings (the protected environment and its reviewers), since only they can.
   - Update "Releasing" to match: the human's steps become pushing the tag and approving the run, instead of running `npm publish`.
3. **Phase E, positioning.** Reposition from "text games" to any game where players type or speak to characters, and add a Phaser example showing an NPC in a visual web game.
   - **Discoverability.** npm search weighs the name, description, and keywords, so expand `package.json`'s `keywords` and update its `description` to match the new positioning at the same time.
     - Keep the list relevant and honest: only terms for things Honeytongue supports at that release. Around 20 keywords at most, all lowercase and hyphenated.
     - Starting list to refine: persuasion, npc, npc-dialogue, dialogue, dialogue-system, game-mechanic, gamedev, rpg, charisma, charisma-check, speech-check, social-mechanic, text-game, text-based-game, text-adventure, interactive-fiction, twine, sugarcube, browser-game, ai-npc, jev, typesafe.
     - Add `phaser` only once the Phaser example ships in that same release. Don't add unity, godot, unreal, renpy, or visual-novel until the engine-agnostic endpoint exists.
     - Check each term against what's already popular on npm (for example, `gamedev` or `game-dev`) and prefer the more common spelling.
     - Give the human a matching list of GitHub repository topics (up to 20) and an updated one-line repository description, since only they can set those in the repository's About settings.
4. **Stable `0.1.0`** (not `1.0`; see "Versioning" under "Releasing"). Remove the alpha notice, switch CDN links from `@alpha` to a `0.1` range, point `latest` at `0.1.0`, and follow the launch checklist under "Releasing".

**In the next npm release, whichever phase it comes from:** add "Built on Jev by TypeSafe AI, and not affiliated with TypeSafe" to the README, as the docs site's footer already says (TypeSafe's terms; see the standing rules).

**Anytime:** the human tests the Twine recipe; you fix what they find.

**After Phase G, once people who don't know the scenes have played:** revisit Nib's patience (3). The human's own playtest isn't good evidence for difficulty, since they wrote the scenes; use playtest transcripts from other players (the web demo's "Record playtest").

**After launch:** persona hints in the playground, gently flagging personas that only describe dislikes and never say what would move the character. An engine-agnostic persuasion endpoint for Unity, Godot, Unreal, and Ren'Py games over plain HTTP. Then stages, extra tells, custom tells, closeness labels, and rapport, only if real results and users call for them.

**Standing rules:**
- Jev only: no other AI models, including open-weight alternatives. The offline mock stays for tests and offline play.
- Harry Goatleaf keeps his name.
- One branch per phase, started from `main` after the previous phase is merged.
- Stop points before building: send a plan and wait for approval.
- Follow "Releasing" for each release.
- **TypeSafe's terms** (their Master Customer Agreement and Acceptable Use Policy):
  - Never use Jev's outputs (eval results, `live-runs/` data, transcripts) to train or fine-tune any model. TypeSafe's terms prohibit it. They're for evaluation only.
  - Never stress-test, probe, or security-test TypeSafe's service itself. Our tests target Honeytongue's own behaviour.
  - Describe Honeytongue as built on Jev and not affiliated with TypeSafe. Never use TypeSafe's logo or imply endorsement.
  - Only publish TypeSafe details that are already public, such as their documentation and publicly listed pricing.
  - The demo proxy's exact-request guard (`src/guard.js`, `allowedStories` in `examples/demo-worker.js`) is a compliance requirement, not just a cost control: TypeSafe's terms forbid offering Jev as a standalone service. Never loosen it.

## Things only the human can do

Get the TypeSafe API key, create GitHub, npm, and Cloudflare accounts, approve spending, push, merge, publish, and tag (see "Releasing"), and make naming and licensing decisions. Ask rather than guess on any of these.
