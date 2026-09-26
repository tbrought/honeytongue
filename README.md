# Honeytongue

**Characters your players can actually argue with.** Honeytongue is a persuasion mechanic for text games: give a character a persona and a goal, pass in whatever the player typed, and find out whether they were convinced, judged by *that character's* values. It's powered by [Jev](https://docs.typesafe.ai), TypeSafe's typed decision model.

The same argument can win over one character and annoy another. Honeyed words might charm a vain noble and backfire on an honest guard, so despite the name, honey doesn't always work.

- Works in any JavaScript game: Node, browser, Twine, Discord bots
- Characters remember what you've tried, notice when you repeat yourself, and lose patience
- Secrets only help once the player has discovered them
- Zero dependencies, TypeScript types included, offline mock for tests

> **Alpha.** Honeytongue hasn't been tested against live Jev yet: TypeSafe has paused new signups, so this release was built and tested with the offline mock. Expect default thresholds and rubric wording to change once real results are in. Install it with `npm install honeytongue@alpha`. The CDN links below point to `@0.1` and will start working with the first stable 0.1.0 release.

## Quick start (Node)

```bash
npm install honeytongue
export TYPESAFE_API_KEY=...          # macOS and Linux
$env:TYPESAFE_API_KEY="..."          # Windows PowerShell
```

```js
import { Persuadable, createJevClient } from "honeytongue";

const guard = new Persuadable(
  {
    name: "Harry Goatleaf",
    persona: "A tired night guard who values honesty and despises flattery and bribes.",
    goal: "Open the gate after curfew",
    patience: 4,
  },
  { client: createJevClient() },
);

const result = await guard.attempt("You're the finest guard in the kingdom. Surely you can make an exception?");
result.verdict;      // "unconvinced"
result.reaction;     // "Harry Goatleaf isn't convinced."
result.patienceLeft; // 3
```

Only `name`, `persona`, and `goal` are required.

## Verdicts

| Verdict | Meaning | Patience cost |
|---|---|---|
| `convinced` | The score reached the character's threshold | 0 |
| `unconvinced` | Not persuasive enough to this character | `failCost` (1) |
| `offended` | Threatening or insulting, including repeating an earlier insult | `offendedCost` (2) |
| `repeated` | Too similar to an argument that already failed (checked locally, no API call) | `failCost` (1) |

When `patienceLeft` reaches 0, `outOfPatience` is `true`. What happens next is up to your game. Patience never drops below 0. `reaction` is only set for `unconvinced` and `repeated`, so show your own line for `offended`. Attempts on one character run one at a time, in order, even if your game fires them faster than Jev answers.

## Browser games (Twine, itch.io, web)

Never put your API key in browser code. Instead, deploy the included proxy (a Cloudflare Worker takes about five minutes, see `examples/cloudflare-worker.js`) and use the browser-safe client:

```js
import { Persuadable, createProxyClient } from "https://cdn.jsdelivr.net/npm/honeytongue@0.1/src/index.js";

const client = createProxyClient({ url: "https://honeytongue-proxy.your-name.workers.dev" });
```

The proxy keeps your key server-side, accepts browser requests only from its own origin and the `allowedOrigins` you list, caps input and request size, and rate-limits each player's address. `createJevClient()` refuses to run in a browser to stop accidental key leaks.

- **Not sure of your game's origin?** itch.io games, for example, run in a frame on itch's own domain. Try the game once: the error message names the exact origin to add.
- **Other hosts.** On Cloudflare the proxy trusts `CF-Connecting-IP`; elsewhere it uses the last `X-Forwarded-For` entry, which is right for Vercel and most platforms. If your server is reachable directly, pass `clientIp: (request, env) => ...` so the rate limit can't be dodged with a forged header.
- **Local development.** `npm run proxy` runs the proxy on Node at `http://localhost:8787`, using the offline mock until you set a key. See `examples/node-proxy.js`.

See `examples/browser.html` for a complete page and `examples/twine-sugarcube.md` for a Twine recipe.

## Characters in depth

| Field | Default | Purpose |
|---|---|---|
| `name`, `persona`, `goal` | required | Who they are and what the player wants from them |
| `levels` | 5-level rubric | Your own ordered rubric, 2 to 10 descriptions from weakest to strongest |
| `threshold` | 80% of top level | Score needed to convince (3.2 on the default 0 to 4 scale) |
| `patience` | Infinity | Patience before they give up (above 0) |
| `reactions` | generic line | `[{ min, text }]` flavor text for unconvinced attempts |
| `repeatReaction` | generic line | What they say when the player repeats themselves |
| `secrets` | none | `[{ id, fact }]` facts that only help once learned |
| `failCost`, `offendedCost` | 1, 2 | Patience lost per failed or offensive attempt |
| `hostileAt`, `repeatSimilarity`, `memory`, `maxInputLength` | 0.7, 0.8, 4, 500 | Fine tuning |

Mistakes throw a `HoneytongueError` with a readable message, such as a threshold higher than your rubric allows or a patience of 0. Fields you set to `undefined` keep their defaults.

### Secrets

Put hidden motivations in `secrets` rather than `persona`, so players can't win on a replay by guessing:

```js
secrets: [{ id: "sick_daughter", fact: "His daughter has a fever and the apothecary is closed." }]
```

Call `guard.learn("sick_daughter")` when the player discovers it. Before that, arguments leaning on it won't help.

## Choosing a model

Honeytongue uses `jev-1.13.0` unless you say otherwise. The default is pinned on purpose: a newer model can score the same argument differently, which would quietly change how hard your characters are to convince.

To switch, pass `model`, or set the `TYPESAFE_MODEL` environment variable to change it without touching code:

```js
createJevClient({ model: "jev-latest" });
createProxyHandler({ model: "jev-latest", allowedOrigins: ["https://your-game.example"] });
```

The option wins, then `TYPESAFE_MODEL`, then the pinned default. On Cloudflare, add `TYPESAFE_MODEL` to the vars in your Wrangler config (the Worker's value is used before the process environment's). Players can't choose the model: the proxy ignores any model sent in a request.

After switching, rerun `npm run eval` or playtest your characters. Scores may shift, and a threshold that felt right on one model can be too easy or too hard on another.

## Lower-level API

| Export | Use it when |
|---|---|
| `judgePersuasion(client, character, input, options)` | You want a one-off judgement with no memory or patience |
| `persuasionQuestions`, `persuasionState`, `readPersuasion` | You're already calling Jev and want persuasion merged into the same request |
| `createMockClient()` | Tests and offline development (keyword-based, much dumber than Jev) |
| `createProxyHandler(options)` | Your own server: Cloudflare, Vercel, Deno, Bun, or Node 18+ |

Client errors are `HoneytongueError`s that say what probably went wrong (a rejected key, a proxy that doesn't allow your page's origin, an unexpected response shape) and carry the HTTP `status` when there is one. Your API key is never included in an error message.

## Flagship example: The Gatehouse

A complete text adventure built on Honeytongue, with a free-text parser and a JSON story format. You must get into the city after curfew, and Harry Goatleaf, the gatekeeper, is in the way.

```bash
npm run play        # with Jev, showing its reasoning each turn
npm run play:mock   # offline, no key needed
```

There's also a browser version in `docs/play/`, styled like an old Infocom screen, that runs on the offline mock until it's pointed at a proxy. It uses copies of the engine; run `npm run build:demo` after changing `src/` or `stories/`.

Stories are validated when loaded, so mistakes like a `goto` to a missing scene or two different characters sharing an id are all reported up front. Scenes can have a `name` (like "East Gate") for interfaces with a status line. See `stories/gatehouse.json` to write your own, and `src/index.d.ts` for the full story format.

## Testing and tuning

```bash
npm test                 # unit tests, no API key needed
npm run eval             # scores the phrasing test set against Jev
npm run eval -- --mock   # keyword baseline (currently action 15/17, score 7/7, hostile 1/1)
```

`evals/gatehouse.json` covers parsing, persuasion score ranges, hostility, prompt-injection attempts, and arguments using secrets the player hasn't learned. Run it after changing a persona or rubric. You can pass another suite: `npm run eval -- path/to/suite.json`.

## Cost

Jev charges about $0.042 per million input tokens and nothing for output. A persuasion attempt is typically under 1,000 tokens, so 10,000 attempts cost around 40 cents. Repeats are caught locally and cost nothing.

## License

MIT
