# Changelog

## Unreleased

Everything below was built and tested without access to live Jev. It still needs a first live run (see "Known unknowns" in CLAUDE.md) before release.

### Added

- `model` option for `createProxyHandler()`, and a `TYPESAFE_MODEL` environment variable for both `createJevClient()` and the proxy (the Worker's env first, then the process environment). Precedence: the option, then `TYPESAFE_MODEL`, then the pinned `jev-1.13.0`. Players can't choose the model through the proxy.
- `clientIp` option for `createProxyHandler()`, and `rateLimit: false` to turn rate limiting off.
- A playable browser version of The Gatehouse in `docs/play/`, and a restyled documentation site with a classic text adventure look (amber screen or paper teletype).
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
- `npm run eval` failed with an absolute path to a suite.
- The mock called "white" and "skill" hostile.
- `examples/browser.html` told you to serve on a port the example proxy didn't allow.
- The Twine recipe showed nothing when the player was offensive, swallowed network errors, and double clicks cost patience twice.
