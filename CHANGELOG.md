# Changelog

## Unreleased

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
