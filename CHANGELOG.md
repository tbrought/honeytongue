# Changelog

## Unreleased

### Added

- **Save and load:** `snapshot()` gives a `Persuadable`'s or a `Game`'s state as plain JSON for a save file, and `restore(snapshot)` puts it back.
  - A character's snapshot covers its memory, patience, learned secrets, and reply rotation; a game's adds the scene, items, flags, recent turns, a pending question, and every character met so far.
  - Snapshots carry a format version. `restore()` checks everything first, and throws a readable `HoneytongueError` (leaving the state as it was) for another character or story, a newer format, or a damaged field.
  - The Twine recipe keeps Harry's snapshot in `$harry`, so SugarCube's saves, loads, and Back button carry his memory and patience.
- **Clues:** a character's `clues` (`{ id, when, reveals }`) are things a line can do that teach the player a secret, such as guessing at the character's family.
  - Characters with clues ask Jev one more question per attempt, and every result carries `clue` (`{ id, reveals, confidence, revealed }`, or `null`). Characters without clues send exactly what they did before.
  - A match on a secret the player hasn't learned, in a line that doesn't offend, reveals it: the `Persuadable` learns it, and that attempt costs no patience. Later lines matching the same clue are judged and charged as usual.
  - In stories, `clueReplies` give the character's line for each clue. The engine checks clues on every turn the character is present: on a persuasion attempt the reply replaces the usual reaction, and on another action it comes after the action's own effects (an action that already teaches the secret isn't repeated).
  - Each demo character has a clue. In The Gatehouse, a guess about Harry's son gets his daughter's fever.
  - Calibrated against live Jev (`docs/live-results.md`): at `clueAt` 0.8, the default, 97% of guesses matched and none of 114 near misses, injection attempts, and plain lines did. The question's options are numbered, so a line can't pick one by typing a clue's id.
- **Angles:** with `angles: true`, every judged result carries `angle` (`{ angle, confidence, probabilities }`): what the line appealed to, from a fixed set exported as `ANGLES`. The angles are family, compassion, money, benefit (something the character wants other than money), duty, authority, fear, flattery, honesty, reason, and other.
  - The set is public API, chosen from the appeals 171 real lines make (`docs/live-results.md`), and changing it will count as a breaking change.
  - Honeytongue doesn't pick a reply; your game can. In stories, `angleReplies` give the character's line per angle and turn the question on. The engine uses one for an unconvinced attempt at `angleAt` (0.7) or above, and a reaction band marked `"nearMiss": true` keeps its hint instead.
  - Calibrated against live Jev (`docs/live-results.md`): at 0.7, 94% of 396 clear lines got the right angle and none got a confident wrong one, and mixed arguments either got an acceptable angle or fell back to the score band's reaction.
  - Every demo character replies to five or six angles in their own voice. Characters that don't ask send exactly what they did before.
- **The proxy allows 8 questions per request by default** (was 6): an engine turn sends 5 with clues, and 6 with clues and angles. The demo Worker's body limit is 17,000 bytes (was 15,000), since the fixed questions make the largest request longer.

### Changed

- **`learn()` rejects secret ids the character doesn't have**, with an error naming their secrets, so a typo (`learn("sick_daugter")`) no longer fails silently. `restore()` checks a snapshot's learned secrets the same way. The `knows` option of `attempt()` is unchanged: ids that aren't secrets are ignored there, as the engine passes all its flags.

### Repository

- **Favicons search results can show:** every page also declares the 192x192 logo as a favicon, since Google only shows square favicons whose size is a multiple of 48px. `docs/favicon.ico` holds the 32x32 and 192x192 logos unchanged, for crawlers that ask for `/favicon.ico` (written by `npm run build:demo`). The page tests and the browser checks cover both.

## 0.1.0-alpha.13 (2026-09-30)

### Added

- **Replies with variants:** a reaction's `text`, `repeatReaction`, and a story character's `hostileReaction` may each be a list of lines instead of one.
  - A `Persuadable` (and so the engine) uses each list in turn, per reaction band, so a player who keeps landing in the same band hears something new each time.
  - `judgePersuasion`, which remembers nothing, gives the first line.
  - Plain strings work as before, and nothing sent to Jev changes.
  - The playground edits variants one per line, and `validateStory` checks each one's markup.

### Changed

- **The demo scenes say more.** Every character has three replies per score band, and three each when offended and when repeated, so replies rarely repeat.
  - Each character also has a near-miss band just below their threshold. It signals closeness in that character's own voice ("Now we're haggling," "Ooh"), and points towards what would move them without giving the answer.
  - Nothing sent to Jev changed.
- **The Gatehouse is now clearly the easiest scene**, since it's everyone's first:
  - Harry is `"easy"` (a threshold of 2.4, was 3.2) with patience 6 (was 4).
  - Reading the letter alone now makes a winning argument, without finding his secret.
  - The preset in `stories/characters.json` changed with him. For the old Harry, set `threshold: 3.2` and `patience: 4`.
- **The scenes are listed easiest first**, each with its difficulty: The Gatehouse and The Goblin Camp (easy), The Dark Lighthouse (normal), The Tidy Profit (hard).
  - The web demo's scene list shows it as a coloured tag with the word on it, and the terminal's menu names it.
  - Both read it from the scene's character, and every demo character now sets `difficulty` (Cobb's `"normal"` is written out).
  - The demo's scene list also says what to expect: characters judge rather than chat, and every reply is hand-written.
- **A sixth line in "Same words, different people":** the plain truth wins over Harry alone.
  - The grid now says it's scored with each character on their own, as in the playground.
  - Each cell has a **Try it** link that opens the playground with that character and the line ready to send.
  - The links are the playground's share links, which can now name a preset (so they stay short and open the preset as it is now) and carry a line to prefill. `npm run build:demo` writes them from `evals/showcase.json`.
- **No label on an ordinary unconvinced turn**, in the web demo, the playground, the terminal, and the docs' examples: the reply and the meter already say it.
  - The labels CONVINCED, OFFENDED, and REPEATED stay.
  - Screen readers no longer hear "Not yet." before an unconvinced reply.

### Repository

- **The site is easier for search engines to list:**
  - `docs/sitemap.xml` lists its four pages, and `docs/robots.txt` allows everything and points to the sitemap.
  - Every page gives its honeytongue.dev address as canonical.
  - Every title starts with "Honeytongue", and every page has its own description (the home page's is shortened to fit search results).
  - `test/pages.test.js` checks all of this.

## 0.1.0-alpha.12 (2026-09-30)

### Added

- **`result.attempt` on every engine turn:** how the scene's character judged it, with the same fields as a `Persuadable`'s `attempt()` result (`verdict`, `score`, `maxScore`, `confidence`, `tells`, `triggered`, `reaction`, `patienceLeft`, `outOfPatience`) plus the character's `threshold`, or `null` when no character judged the turn. It's a stable part of the API, for labelling replies and showing patience. The web demo uses it.

### Changed

- **`result.debug` is documented as diagnostics** (the ranked actions, Jev's raw answers, and who answered) that may change in any version. Use `result.attempt` for anything a game builds on.

- **Honeytongue needs Node 22.13 or later** (`engines` was `>=22`). From 22.13, Node's `require()` loads ES modules without a flag or a warning, so CommonJS projects can `require("honeytongue")` as well as `import` it. The package check tests both, on Node 22.13.0 and 24.

### Repository

- **The proxy is tested on Deno and Bun** as well as Node and Cloudflare Workers: CI serves it with each runtime's own server and sends requests through it (`scripts/runtime-smoke.js`, on the mock). The docs now name the platforms it's tested on, and say it should run on other hosts with the standard `Request` and `Response`, such as Vercel, which isn't tested yet.
- CI tests the oldest supported Node, 22.13.0, exactly.
- **Spoken input, measured:** lines as speech recognition writes them got the same verdicts as typed ones (20 of 20, scores within 0.25), while long winning lines lost 0.03 to 0.59 when spoken or misheard, and two of eight fell just short. The docs say so, and suggest cleaning up transcripts first (`docs/live-results.md`, 52 live calls).
- **The showcase keeps five lines:** no sincere line convinced one character reliably without knowing its scene's secrets (the best convinced Cobb 10 of 10 times, but sat on Nib's threshold). The grid now says why its sincere lines win no one over, and that arguments win once they speak to what a character cares about (`docs/live-results.md`, 127 live calls).

- Issues and feedback are welcome, with a bug-report template; pull requests aren't being accepted for now (README).

- **The key for live runs moves to `.env.live`**, a git-ignored file at the repository root that npm never packs. Only commands that call live Jev load it: the live scripts load it themselves, and `npm run play`, `example`, `proxy`, and `playground` use `node --env-file-if-exists=.env.live`. Everything else runs without the key. Package users are unaffected: the library still reads `TYPESAFE_API_KEY` from its environment.
- `node scripts/headroom.js` measures how many tokens the largest request the demo Worker accepts can cost, against a normal turn. At worst, with Japanese text in every field, it's about 5 times a normal turn (`docs/demo-proxy.md`).
- The package check refuses to pack any environment or credential file.
- **Redeploy the demo Worker after every release**, whatever changed, so it always runs the site's version (the release steps in `CLAUDE.md` and `docs/demo-proxy.md`). Those docs no longer say an older Worker refuses a newer page: it judges only a request's questions and state, so it keeps working until those change, and the version only explains a refusal.
- `package-lock.json` carries the package's version again (it had stayed at 0.1.0-alpha.9).

## 0.1.0-alpha.11 (2026-09-29)

Hardening before 0.1.0, from a review of the whole project: a proxy that's secure by default, limits on what the library sends that a proxy enforces, and the site's browser checks in CI. This release has breaking changes.

### Breaking

- **`createProxyHandler()` needs `allowedStories` or `allowedCharacters`.** Without them it throws, because the proxy would answer any Jev question on your key (and TypeSafe's terms forbid offering Jev as a standalone service). A local tool that must forward anything can pass `dangerouslyAllowAnyRequest: true`. In TypeScript, the options must now include one of the three.
- **A `Persuadable`'s state is read-only.** `attempts`, `knows`, `patienceLeft`, and `convinced` can still be read (`attempts` as a frozen copy, `knows` as a copy of the set), but only its methods change them: `learn()`, `losePatience()`, `record()`, and `reset()`. Its queue, and the engine's, are private.

### Changed

- **What the library sends is capped, and only long conversations of long lines are affected.** Memory is now the last 10 attempts, or 1,500 characters of them, whichever runs out first (`memory` and the new `memoryLength`), and each recent turn keeps the first 200 characters of what the player typed (a story's new `recentTurnLength`). Typical lines are about 80 characters, so players in ordinary conversations see no difference. `state()` shows exactly what an attempt sends. A proxy with `allowedCharacters` or `allowedStories` enforces each character's and story's own values, so raising them stays safe.
- `judgePersuasion()`'s `previousAttempts` are trimmed the same way (to `memory`, then `memoryLength`).
- **A `Persuadable` keeps its last 100 attempts** for spotting repeats, instead of every attempt.
- **Every refusal from a guarded proxy names the limit it hit**, such as "longer than Harry's maxInputLength of 500 characters". Oversized bodies say the byte limit.
- **The demo proxy** reads at most 15,000 bytes (the largest request the library can send for the demo, in any script, plus a margin), and no longer accepts pages on `tbrought.github.io`, which GitHub redirects to honeytongue.dev.
- `examples/node-proxy.js` listens on 127.0.0.1 only, and allows the demo scenes and the character in `examples/browser.html` (now in `examples/harry.js`, shared by both).
- The package ships only the font weights the playground uses, and leaves out the demo's own Worker and Wrangler config: 221 KB packed, down from 306 KB.

### Added

- **`context` through a guarded proxy:** give a character a `maxContextLength` (the most characters of `context`, as JSON) and `attempt(input, { context })` works through a proxy with `allowedCharacters`. `attempt()` checks the limit too, so you find out before you deploy.
- **`toNodeListener(handle, { maxBytes, env })`**, exported from `honeytongue/proxy`: runs the proxy on a plain Node server, refusing bodies over the limit as they arrive, and passing the socket's address as `env.remoteAddress` for `clientIp`. The docs have a short "Node servers" example.
- **`deadlineMs` for `createJevClient()`:** the most time a whole call may take, retries and waits included. None by default; the proxy uses 12 seconds, so it stops before a page's usual 15-second timeout.
- `npm run check:browser` (in CI too): every page in headless Chrome or Edge, for CSP violations, hostile text, contrast, and the demo and Phaser walk-throughs. `npm run check:screenshots` compares the demo pixel for pixel against a baseline, locally. The checks' browser runs with no API keys or tokens in its environment and with crash reporting off, so a crash can't write a key into a crash report.
- Dependabot keeps the workflows' pinned actions current.

### Fixed

- The proxy read a request's whole body before checking its size when the size wasn't declared; it now stops reading at `maxStateBytes`.
- JSON nested thousands of levels deep crashed the request guard; it's now refused with a 400.
- `createJevClient()`'s browser check also covers browsers' Web Workers.
- The docs' screenshot loads lazily.
- **The Phaser example's dialogue box could reopen by itself.** Phaser hands a frame's key events to its keydown listeners again whenever another key event arrives in the same frame, so a letter typed in the box, followed by Escape within a frame, could open the box again. The example now remembers which key events it has handled, so each press acts once. It keeps using keydown events rather than Phaser's `JustDown`, which misses a press and release within one frame, as on-screen keyboards, voice control, and other assistive tools send. The browser checks test both, and that E, R, spaces, and Enter type into the box normally.

### Docs

- `allowedOrigins` only controls browsers: scripts send no `Origin`, so the allowlists and your spending limit are what protect your key.
- Off Cloudflare, clients with no reported address share one rate-limit bucket: set `clientIp`.
- `attempt()` still asks Jev once a conversation is over (convinced or out of patience): check first if your game shouldn't pay for that.

## 0.1.0-alpha.10 (2026-09-29)

Site polish: the docs home page and the playground now match the demo, so the whole site feels like one design, and the Phaser example has pixel-art sprites. The library itself is unchanged.

### Changed

- **The playground's replies look like the demo's:** each reply carries the demo's label (CONVINCED, NOT YET, OFFENDED, REPEATED, spoken as words to screen readers) and a coloured rule, with speech and the character's name styled. The meter moves from the last reading to the new one, patience is shown as pips that pulse when one is lost (neither moves under reduced motion), and the preset characters' names use the demo's name colour. Reactions are shown exactly as written: story markup isn't read, as in a `Persuadable`. Reactions are no longer italic, so the playground loads one font file fewer (about 14 KB less).
- The verdict labels, patience pips, and meter motion moved from the demo's stylesheet into `docs/style.css`, shared by every page. The demo looks exactly the same (checked by comparing screenshots before and after).

### Added (website)

- **Syntax highlighting** in the docs' code blocks, in the demo's colours, generated at build time as static markup (`scripts/highlight-docs.js`, run by `npm run build:demo`): no script or library on the page, and nothing new for the CSP to allow. Longer blocks name their language, and story markup inside strings is shown as the demo shows it.
- **Colour with meaning:** the example transcript on the home page shows replies as the demo does; the showcase grid and the Verdicts table colour each verdict (with the demo's labels named under the table, so they read as the same verdicts); characters' names are styled in the tables; and the story markup example shows how it looks on screen.
- **More rhythm on the home page:** larger section headers with a rule, more room between sections, title cards with the logo for each part of the docs, and the logo in the footer. The home page grows by about 2 KB over the wire.

### Changed (the Phaser example)

- **The Phaser example has pixel-art sprites** for the player, the troll, and the sign (`examples/phaser/assets/`, by Tristan Broughton, under the project's MIT license), in place of the placeholder shapes. They're 32x32, loaded with `this.load.image`, and drawn at 2x with `pixelArt: true`, so they stay crisp. The player turns to face the way they walk; the river, the bridge, and where you can read the sign or talk to the troll are sized to the new sprites; and whatever stands lower on the screen is drawn in front. The troll now climbs down off the bridge into the water when he's convinced. `startGame()` takes an `assets` option for where the sprites are (`"assets/"` by default).
- Sprites load as plain images (`loader.imageLoadType: "HTMLImageElement"`) rather than through `blob:` URLs, so the site's CSP still allows images only from itself (plus the `data:` images Phaser builds). `npm run build:demo` copies them to honeytongue.dev/phaser/, and the docs' screenshot shows them.

### Changed (docs)

- **The Twine recipe is tested** in Twine 2.12.0 with SugarCube 2.37.3, using the offline stand-in: winning, an empty line, and running out of patience. `examples/twine-sugarcube.md` and the docs' Twine section now show exactly that setup. Judging with Jev through a proxy in Twine isn't tested yet, and is marked so.

## 0.1.0-alpha.9 (2026-09-29)

Positioning, a Phaser example, and the logo, plus the website security changes (the site went out with that pull request; its playground changes ship here).

### Added

- **A Phaser example** (`examples/phaser/`, about 200 lines): walk up to a troll, read the sign by his bridge, and talk your way across. A `Persuadable` character judges what you type in an HTML dialogue box over the game; reading the sign teaches the troll's secret with `learn()`. It uses the offline stand-in until you set `PROXY_URL`, and loads Phaser 4.2.1 (MIT) from a CDN, pinned, with an integrity hash. Play it at honeytongue.dev/phaser/, judged live by the demo proxy with the same fallback, turn cap, and privacy note as the demo scenes. The docs gain a "Visual games" section.
- **The logo:** favicons, Open Graph and Twitter card images on every page, beside the wordmark on the site (the local playground, `npx honeytongue playground`, included), and at the top of the README.
- `package.json` has an `author` and 20 keywords, using the most common spelling where there's a choice, plus distinctive terms few packages use (such as `charisma-check`), so searches for them find Honeytongue first.

### Changed

- **Honeytongue is described as a persuasion mechanic for any game where players type or speak to characters**, not only text games: the tagline's subtitle, the docs, the README, and the package description. Spoken input works once turned into text; engines outside JavaScript aren't supported yet (an HTTP endpoint is planned).
- **The web fonts are served from the site itself** (IBM Plex Mono from IBM's own web fonts, and VT323, both under the SIL Open Font License), so pages no longer contact Google Fonts, and every page's CSP allows styles and fonts only from 'self'. The fonts ship in the package for the local playground.
- The demo proxy (`examples/demo-worker.js`) also judges the Phaser example's troll, through `allowedCharacters`.

### Changed

- **The playground's copied code and story JSON write `<` as `\u003c`** (the same character in JavaScript and JSON), so text like `</script>` in a character can't close a `<script>` element if the code is pasted into an HTML page, such as a Twine story's JavaScript. Line separators (U+2028, U+2029) are escaped too.
- **Every page has a strict Content Security Policy:** scripts and styles only from the site itself (plus Google Fonts), connections only to the site and the demo's proxy, and no inline scripts or styles. The local playground server's policy matches, and also forbids framing.

### Added

- Tests that open playground share links with hostile text in every field, and check it round-trips exactly, is escaped in the copied code, and can't pollute prototypes or add fields; oversized and damaged links fail with a readable error. A test keeps every page's CSP strict and free of inline code.

## 0.1.0-alpha.8 (2026-09-29)

Demo polish. Stories can mark who and what matters, the engine says what each piece of a reply means, and the web demo and the terminal player each show one way to style it. You bring the styling: nothing in the library says how anything looks.

### Added

- **Story markup:** `@[Harry Goatleaf]` for a character and `#[toy horse]` for an item or anything to interact with, in the text players read. Speech is found from straight or curly double quotes; when they don't pair up, nothing is marked. `\@[` and `\#[` write a literal. Markup is optional, and `validateStory` explains any that's badly formed, or used where it can't be (names, personas, goals, secrets, action descriptions, item names).
- **`result.parts`** on every turn: the reply as meaningful pieces, one array per paragraph, with kinds `text`, `speech`, `character`, `item`, `system` (the engine's own lines), and `ending`. `result.text` stays plain. `parseMarkup()` and `stripMarkup()` are exported for story text you show yourself.
- **The terminal player uses colour** for characters, items, speech, and its own messages, labels each judged reply (`[convinced]`, `[not yet]`, `[offended]`, `[repeated]`), and shows a title card for a named scene. `--no-color`, `NO_COLOR`, or output that isn't a terminal gives plain text.
- **The web demo:**
  - colours with meaning, meeting WCAG AA contrast in both themes;
  - verdict labels on every judged reply (CONVINCED, NOT YET, OFFENDED, REPEATED);
  - title cards;
  - text that types out, and shows at once on a click, a key, or a new command, or under reduced motion (a setting turns it off, and screen readers get each reply whole);
  - an optional CRT mode, still and never flashing;
  - the meter and patience pips animate when they change;
  - an ending screen with the turns taken, the arguments that landed, and the closest misses.

  Everything the demo shows (story text, replies, what players type, title cards, the ending screen) is inserted as text, never as HTML; a test plays hostile input such as `<img src=x onerror=alert(1)>` through to the ending screen to check it.

### Changed

- Markup never reaches Jev: the engine strips it from the story text it sends, in one place. What players type is never read as markup, and reaches Jev exactly as typed. The four demo scenes are marked up, and stripped they're exactly as before, so Jev, the evals, and the deployed demo proxy see the same requests.
- **A local preview of the web demo judges offline.** On localhost or 127.0.0.1 the page uses the offline stand-in, with a "Local preview: judged offline" note, instead of calling the live proxy (which refuses local pages). Add `?live` to the address to use the proxy anyway.
- `Game.intro()` returns plain text, and no longer leaves an extra blank line when a story has no intro.
- The terminal player's output now includes the verdict labels and title cards, as text, even without colour.

## 0.1.0-alpha.7 (2026-09-29)

Quality and release tooling. This is the first release staged from GitHub Actions with npm trusted publishing and approved on npmjs.com with two-factor authentication, so it carries a provenance statement and no npm token is stored anywhere.

### Breaking

- **Node 22 or later is required** (`engines` is now `>=22`, up from `>=18`). Node 18 and 20 have reached end of life. Honeytongue is tested on Node 22, 24, and 26, on Linux and Windows.

### Changed

- **`validateStory()` takes any value and returns a `Story`** in the TypeScript types (it was `validateStory<T>(story: T): T`). A story imported from JSON can now be passed in without a cast: TypeScript widens JSON strings like `"hard"` to `string`, so on its own it can't tell they're a valid `difficulty`. At runtime nothing changed.
- In the types, `Game.requests()` returns defined characters (`DefinedCharacter`), as it always did at runtime.

### Added

- The TypeScript types are tested against TypeScript 7.0 and 5.9, the oldest version supported, including the `honeytongue/persuasion` and `honeytongue/proxy` subpaths.
- The README has badges, and says Honeytongue is built on Jev by TypeSafe AI and not affiliated with TypeSafe.
- `SECURITY.md`: report vulnerabilities privately through GitHub.

## 0.1.0-alpha.6 (2026-09-29)

The live demo. The web demo can now play with Jev through a public proxy that only judges its own scenes, and falls back to the offline stand-in when it can't. The demo goes live once its proxy is deployed at `https://api.honeytongue.dev/judge`.

### Added

- **`allowedCharacters` and `allowedStories` on `createProxyHandler`.** The proxy then only judges requests that match what Honeytongue sends for those characters, or those stories' scenes: exactly the library's questions, the characters as written (with only learned secrets), the story's own item and flag names, and every part players control capped at what the library sends (what they typed, previous attempts at the character's `memory`, the engine's last 4 turns, and each entry's length). Anything else gets a 403 with a `reason`: `"not-allowed"`, `"state"`, or `"version"`. Without either option the proxy works as before, so set one on any public proxy.
- **`VERSION`**, exported from the package. `createProxyClient()` sends it with each request, so a guarded proxy running a different version can say so: "Questions don't match: proxy is 0.1.0-alpha.6, request is from 0.1.0-alpha.7".
- **Proxy failures carry a `reason`**: a 502 when Jev can't answer says `"busy"`, `"error"`, or `"unavailable"` (a bad key or no credit left). Errors from `createProxyClient()` keep the `reason`, and a 403's `proxyVersion` and `requestVersion`.
- **The web demo can run live.** With a proxy URL in its `honeytongue-proxy` meta tag, Jev judges, and the offline stand-in takes over when it can't: for the rest of the session if the proxy refuses the page, runs another version, or has no credit; for about a minute if it's busy, erroring, or unreachable. Each tab gets 50 live turns. While live, the banner says that what you type is sent to TypeSafe's Jev model to be judged. A version mismatch gets its own note.
- `examples/demo-worker.js` and `examples/demo-wrangler.toml`: the demo's own proxy (the Cloudflare Worker `honeytongue-demo` at `https://api.honeytongue.dev/judge`), locked to the four scenes, answering only on `/judge` so one Cloudflare rate limiting rule covers it, with its allowed pages in the `ALLOWED_ORIGINS` variable (`https://honeytongue.dev`, then `https://tbrought.github.io`). `scripts/check-demo-proxy.js` checks a deployed one from outside. `examples/cloudflare-worker.js` now shows `allowedCharacters`.
- A "Share a playtest" issue template, linked from the demo beside "Save transcript".
- Transcripts record each turn's `judge`, since a live demo can fall back to the stand-in partway through. The format is still 1: the field is new, and nothing else changed.

### Changed

- **The proxy never logs what players type.** It used to log the whole error when Jev failed, and an error can quote Jev's reply; now it logs only the status.
- The documentation, demo, and playground links now use https://honeytongue.dev (the old tbrought.github.io addresses redirect there).

## 0.1.0-alpha.5 (2026-09-29)

Whole conversations, and real play. Multi-turn calibration against live Jev and the author's first playtests changed how memory, patience, and threats work, and added opt-in playtest transcripts. The findings are in `docs/live-results.md`.

### Changed

- **A turn is charged once for hostility.** When a costly action comes with hostile words (a threat while grabbing Cobb's key), only the larger of the two patience costs applies, not both. A playtest lost 5 of Cobb's 10 patience in one turn this way.
- **The attempt that uses up a character's last patience shows only their out-of-patience text**, instead of an ordinary reaction ("Go on...") followed by the end of the scene.
- **Spoken threats are judged as speech in every scene.** "Open the gate or I'll punch you" used to be read as attacking Harry, which ends The Gatehouse; the same happened in The Tidy Profit, and in The Dark Lighthouse threats were read as grabbing the key. Each scene's physical actions now say they mean actually doing it, and each persuasion action lists threatening, so threats go to the character (who may take offence) while physical commands still do what they say. Each scene's suite checks it.
- **Maude has 5 patience instead of 3**, and her near-miss reaction now says what's missing ("Close. Now tell me what's in it for me, and how you'd prove it."). In a playtest, a good argument (3.44 against her 3.6) came with only one attempt left; with the hint and the extra patience, an improved argument won 10 of 10 times.
- **Maude takes insults as banter, and the docs now say exactly what that means**: she isn't offended by them, but they don't help your case. Her persona now says she likes a bit of cheek and judges what's said, not how politely, which halved what an insult in front of a good argument costs (0.51 to 0.26).
- **Characters remember their last 10 attempts instead of 4 (`memory`).** Live testing of whole conversations showed that once a point dropped out of a 4-attempt memory, a reworded version of it regained its full weight (2.41 against 2.45 fresh, where inside memory it scored 1.59). With 10, it's discounted as it should be (1.45 against 2.43). Each remembered attempt adds about 40 input tokens for a short line, so long conversations cost a little more. To keep the old behaviour, set `memory: 4`.

### Added

- After a failed attempt against a character with limited patience, `npx honeytongue` shows how much patience is left, as the web demo's status line does.
- `scripts/multiturn.js` runs whole conversations with each demo character against live Jev (building an argument, switching tactics, rephrasing, returning after learning a secret, and running out of patience), each line also scored fresh for comparison. Each scene's suite gains the author's playtest lines and checks that spoken threats are judged as speech.
- Docs on how conversations work: reworded points usually count for less (but reassurance can help some characters), word-for-word repeats are always repeats, characters hold no grudges beyond the patience cost, building an argument helps, the memory limit, and that remarks belittling a character's situation can register as insults.

- Playtest transcripts, off by default: tick "Record playtest" in the web demo and press "Save transcript", or play with `npx honeytongue --transcript play.json`. Each turn records the input, the action chosen, the verdict, the score and threshold, the tells triggered, the patience left, and the flags and items the player had, with the Honeytongue version, the scene, and a `formatVersion`. Nothing is sent anywhere, and no keys are included. `scripts/transcript-to-evals.js` turns a transcript into draft eval cases for review.
- The engine's per-turn `debug` also reports the scene character's `verdict`, `threshold`, `triggered` tells, and `patienceLeft`, and a repeat (caught locally) now has a `debug` too, with an empty `ranked`.

## 0.1.0-alpha.4 (2026-09-28)

The first release tested against live Jev. About 2,600 live calls calibrated the defaults, the demo characters, and the docs; the findings are in `docs/live-results.md`.

### Changed

- **The default rubric (`DEFAULT_LEVELS`) judges each attempt by how it moves this particular character, not by tactics in general.** Flattery, threats, and bribes now land only when the persona says they would, so a coward can fold to a threat and a vain character can be won over by flattery. Honest characters still score flattery low. Characters that use the default rubric may score differently. To keep the old behaviour, pass the old five levels as `levels`:

  ```js
  levels: [
    "Not a real attempt, or counterproductive given who they are: flattery they'd see through, obvious lies, demands",
    "Weak: generic pleading or excuses that give them nothing they care about",
    "Reasonable and polite, but no strong reason for them in particular to agree",
    "Honest and specific, touching something they value, but not quite enough",
    "Genuinely compelling to them: speaks directly to what they care about most",
  ],
  ```

  The difficulty words keep their shares (easy 0.6, normal 0.8, hard 0.9, very hard 0.95): live calibration showed they match their meanings on the new rubric. If a character now plays too easy or too hard for you, set an explicit `threshold`.
- **Secrets the player hasn't learned are no longer sent to Jev.** Telling Jev a fact was unknown to the player didn't stop arguments using it from scoring higher; now Jev can't draw on it at all. `persuasionState()` includes only learned secrets (each with `player_knows: true`), and the persuasion question no longer mentions unlearned ones. A lucky guess is judged like any other argument.
- Nib's persona says a firm threat makes him give in, and Cobb's says he fears guiding the raiders to the town, so an opening plea no longer wins The Dark Lighthouse. Cobb's talking route now uses the evidence the player finds. Cobb's playground preset carries a note that he was written for his scene; presets can have an optional `note`, which the playground shows.
- The showcase's insult is now "Out of my way, you useless fool.", since the old line also read as a threat.
- The README is now a short quick start; everything else is on the docs site, reordered from simple to advanced, with a Reference that documents every option once.

### Added

- Real results everywhere scores were illustrative: the docs site's hero, and the "Same words, different people" grid (averages of ten live runs).
- Docs on writing personas, what the difficulty words mean, secrets and lucky guesses, how tells behave, custom rubrics, languages and very short inputs, measured cost and speed, and a reliability rule for story authors: a scripted winning or losing line should give its intended verdict in 10 of 10 repeats.
- Each scene's eval suite checks that a bare opening plea doesn't win. `npm run eval` gains `--repeats N` (the reliability check), `--record` (latency and tokens, saved in the git-ignored `live-runs/`), and `--patch <file>` (try a candidate rubric or persona first). `scripts/live.js` and `scripts/calibrate.js` run the live checks and calibration sets in `evals/calibration/`.

### Fixed

- Cost figures: an attempt is about 780 tokens and a text adventure turn about 1,400, so 10,000 attempts cost about 30 cents (the docs said 40).

## 0.1.0-alpha.3 (2026-09-26)

Three new demo scenes, each built around a different kind of character. Like the earlier alphas, this was built and tested with the offline mock only.

### Added

- Three new demo scenes, each about 5 to 10 minutes long, with one main character, one secret to discover, a way through that doesn't involve talking, and three or four endings:
  - The Goblin Camp: escape a cowardly goblin guard's cage before the war chief gets back (Nib Wortle: easy, offended only by insults, so threats may work on him).
  - The Tidy Profit: bargain your way aboard a pirate ship before bounty hunters arrive (Maude Keelhaven: hard, offended only by threats; insults are banter to her).
  - The Dark Lighthouse: convince a keeper under orders to light the lamp for your sister's boat (Cobb Lanterly: default settings, patience 10).
- `npx honeytongue` with no story path shows a menu of the bundled scenes, with each one's hook and play time. A story path still plays that story.
- The web demo lists the scenes, and each has its own link, like `play/#goblin-camp`.
- `stories/index.json` lists the scenes in order, with a title, hook, play time, and character.
- A "Same words, different people" section on the docs site and in the README: five lines (a threat, an insult, a plea, flattery, and an honest offer) tried on all four characters, with the expected verdicts. The scores shown are illustrative until there are live Jev results.
- Eval suites for each new scene, covering tactics that should work and ones that should backfire, and `evals/showcase.json` for the grid. `scripts/eval.js` now checks expected verdicts, takes several suites or `--all`, and can set items as well as flags.

### Changed

- Maude Keelhaven's and Cobb Lanterly's presets in `stories/characters.json` now match their scenes. Maude decides who comes aboard as a passenger, rather than guarding a prisoner. Cobb is a lighthouse keeper, rather than a night jailer, with a new goal and secret. Their difficulty, `offendedBy`, and patience are unchanged.
- The offline mock matches actions more sharply. One clearly better option is no longer read as a toss-up with every option sharing a word. Saying every word of an option's name ("examine the cage") counts strongly, and plurals and -ing forms match the plain word ("crates" and "crate"). It also recognises a bargain ("take me aboard and I'll show you", "I can prove") as persuasion, and credits more offers ("send", "show", "prove", "I'll get you"), so plainly worded arguments can win the offline demo, not just carefully chosen ones. If your tests assert the mock's exact `probabilities` or scores, expect different numbers.
- The Gatehouse's "search along the wall" action now mentions searching in its description, so the mock matches it.

### Fixed

- The docs site, README, and examples loaded Honeytongue from `cdn.jsdelivr.net/npm/honeytongue@0.1/`, which doesn't resolve while only prereleases exist. They now load `@alpha`.

## 0.1.0-alpha.2 (2026-09-26)

The character playground, and an offline mock that can win The Gatehouse the way the story intends. Like the earlier alphas, this was built and tested with the offline mock only.

### Added

- A character playground for designing a character and tuning it by trying lines against it, without writing code. Each line shows the verdict, the score against the threshold, the tells it triggered, the patience left, the judge (`[jev]`, `[mock]`, or `[unknown]`), and the rubric level it landed on, with the probability of each level when Jev gives them. Editing the character starts a fresh conversation, and Replay reruns the previous lines, showing each one's old and new score. It can copy the character as a `new Persuadable({...})` snippet (only the settings that differ from the defaults, keeping the difficulty word) or as a story's `npc` block (with `[TODO: ...]` placeholders for story-only text), and share it as a link. Invalid settings are flagged next to their field with `defineCharacter()`'s own message.
- `npx honeytongue playground` (or `npm run playground` in the repository) runs the playground on your machine and judges with your `TYPESAFE_API_KEY`, or with the offline mock when there's no key or with `--mock`. The server listens on 127.0.0.1 only and the key never reaches the page. It refuses requests addressed to any other host and requires a per-run token. Options: `--port`, `--mock`, and `--no-open`.
- A hosted preview of the playground at `docs/playground/`, linked from the docs site and the README. It judges with the keyword mock and sends nothing anywhere.
- `stories/characters.json`: four preset characters. Harry Goatleaf from The Gatehouse, plus three for upcoming scenes: Nib Wortle, a cowardly goblin guard (easy, offended only by insults); Maude Keelhaven, a pirate quartermaster (hard, offended only by threats); and Cobb Lanterly, a lonely night jailer (default settings, patience 10).

- Proxy replies say which one answered, with `"source": "jev"` or `"mock"` beside `answers`. The engine passes it on per turn as `debug.source`. The proxy only uses the mock when one is passed in as `client` (as `npm run proxy` does without a key); a deployed proxy with no key still returns an error.
- Debug output in the terminal player and the web demo is labelled `[jev]` or `[mock]` by who actually answered, or `[unknown]` when the client doesn't say, instead of always `[jev]`.
- The web demo's offline banner now says that characters are judged by simple keyword matching. It also switches to that banner if a proxy turns out to be running the mock.

### Fixed

- The offline mock can now win The Gatehouse the way the story intends. It credits an offer to help ("give", "bring", "help", "take … to") when the argument also uses a secret the player has learned. It also leans toward the persuade action when the player pleads or speaks to the character by name, so an obvious plea no longer triggers "Did you mean".

## 0.1.0-alpha.1 (2026-09-26)

Character settings a designer can use without touching the rubric. Like 0.1.0-alpha.0, this was built and tested with the offline mock only; the new questions and the difficulty shares still need a live Jev run.

### Breaking

- Results no longer have `hostility`. Use `tells` (`{ threats, insults }`, each a probability) and `triggered` (the tells at or above `hostileAt`).
- The single `hostile` question is now two, `threats` and `insults`. If you merge `persuasionQuestions()` into your own request, or fake Jev's answers in tests, answer those ids instead.
- The engine's debug output (`TurnDebug`) has `threats` and `insults` instead of `hostile`.
- Eval suites use `"threats": true/false` and `"insults": true/false` instead of `"hostile"`.

### Added

- `difficulty`: `"easy"`, `"normal"`, `"hard"`, or `"very hard"`, a threshold of 60%, 80%, 90%, or 95% of the top rubric level. `"normal"` matches the old default. Case and surrounding spaces are ignored, and `"very-hard"` or `"very_hard"` also work. A defined character keeps the word (in its standard spelling) next to the threshold it resolves to. Setting a `threshold` that disagrees with `difficulty` is an error; values that agree, as in a copy like `{ ...npc.character, patience: 5 }`, are fine.
- `offendedBy`: which tells offend a character, default `["threats", "insults"]`. A tell left out doesn't offend, and the persona decides whether it persuades, so a cowardly character can be intimidated.
- `tells` and `triggered` on every result. A repeated offence reports the tells the original triggered.
- `decide(result, context)`: an optional, synchronous character function that can overrule the verdict. Patience and memory follow what it returns. It isn't applied by `readPersuasion()` and isn't available in JSON stories.
- Story NPCs accept `difficulty` and `offendedBy` in their `persuasion` block, and stories built in code can use `decide`.

### Changed

- The proxy's `maxQuestions` default is now 6. The engine sends 4 questions per turn (action, persuasion, threats, insults), exactly the old limit.
- `hostileReaction` is only required for NPCs that something can offend.
- The keyword mock answers threats and insults separately, recognizes basic profanity as an insult, and lets a timid persona give in to threats when threats don't offend.
- The README and docs site split character settings into "Out of the box", "Shaping a character", and "Full control", with a new Intimidation section.

### Fixed

- Three-column tables on the docs site squeezed their last column to a sliver on narrow phones. They now scroll sideways.

## 0.1.0-alpha.0 (2026-09-26)

First published alpha, to hold the name. Built and tested with the offline mock only.

### Added

- `model` option for `createProxyHandler()`, and a `TYPESAFE_MODEL` environment variable for both `createJevClient()` and the proxy (the Worker's env first, then the process environment). Precedence: the option, then `TYPESAFE_MODEL`, then the pinned `jev-1.13.0`. Players can't choose the model through the proxy.
- `clientIp` option for `createProxyHandler()`, and `rateLimit: false` to turn rate limiting off.
- A playable browser version of The Gatehouse in `docs/play/`, and a restyled documentation site with a classic text adventure look (amber screen or paper teletype). (Repository only, not in the npm package.)
- `examples/node-proxy.js` and `npm run proxy`: the proxy on plain Node, using the offline mock until a key is set.
- Optional scene `name` in stories, for status lines.
- Types for the story format, Jev answers, `Game` state, and per-entry type files for `honeytongue/persuasion` and `honeytongue/proxy`.
- `HoneytongueError.status` on HTTP failures.

### Changed

- The Gatehouse's guard, Sergeant Maren, is now Harry Goatleaf, the gatekeeper: a nod to the gatekeeper at Bree in The Lord of the Rings.
- The proxy now enforces "same-origin only" when `allowedOrigins` is empty. Before, cross-origin requests were served anyway.
- The proxy trusts `CF-Connecting-IP` only on Cloudflare and otherwise uses the last `X-Forwarded-For` entry, so a forged header can't dodge the rate limit. Rate-limited responses include `Retry-After`.
- The proxy's request size limit counts bytes and checks `Content-Length` before reading the body.
- Clients honor `Retry-After`, fail fast on waits over 10 seconds, and no longer retry timeouts. The browser client no longer retries failures the proxy already retried.
- Client responses are checked for a well-formed answer to every question, and errors explain the likely cause.
- The keyword mock scores any character by their persona and the secrets the player has learned, instead of keywords written for The Gatehouse (baseline: action 15/17, score 7/7, hostile 1/1, up from 11/17 and 5/7).
- `giveItems` doesn't give an item the player already carries.

### Fixed

- An insult the parser couldn't match to an action (or matched ambiguously) went unnoticed. The NPC now reacts.
- Repeating an insult counted as a harmless repeat. It's now `offended` again.
- An NPC who ran out of patience replayed their `outOfPatience` effect on every later insult, and could still be persuaded.
- A convinced NPC could be persuaded again, repeating the success effects.
- After an action moved the player to another scene, an insult was answered by the new scene's NPC.
- Characters with a field set to `undefined` (such as story NPCs without `patience`) lost the default, leaving patience as `NaN`.
- Invalid numbers (a patience of 0, `hostileAt` above 1, a `repeatSimilarity` of 0 that made every attempt a repeat) were accepted.
- Patience could go negative.
- Repeats weren't detected in languages outside a-z, and capping input could split an emoji.
- Two turns or attempts sent at once could interleave. They now run in order.
- Malformed stories (a null scene or action, `requires` or item lists that aren't arrays, conflicting NPC ids) crashed instead of listing problems.
- A story whose start scene is an ending crashed on the first turn.
- Unknown or missing options in Jev's answer crashed the game.
- "Did you mean" only accepted exactly `1` or `2`. It now also takes `1.`, `one`, `first`, and similar.
- An API key containing whitespace or control characters could be echoed in fetch's error message. Keys are validated up front and redacted from all errors.
- `npm run eval` failed with an absolute path to a suite. (Repository only, not in the npm package.)
- The mock called "white" and "skill" hostile.
- `examples/browser.html` told you to serve on a port the example proxy didn't allow.
- The Twine recipe showed nothing when the player was offensive, swallowed network errors, and double clicks cost patience twice.
