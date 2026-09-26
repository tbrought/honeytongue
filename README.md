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
| `offended` | A triggered tell in the character's `offendedBy` (threats and insults by default), including repeating an earlier offence | `offendedCost` (2) |
| `repeated` | Too similar to an argument that already failed (checked locally, no API call) | `failCost` (1) |

When `patienceLeft` reaches 0, `outOfPatience` is `true`. What happens next is up to your game. Patience never drops below 0. `reaction` is only set for `unconvinced` and `repeated`, so show your own line for `offended`. Every result also has `tells` and `triggered` (see [Intimidation](#intimidation)). Attempts on one character run one at a time, in order, even if your game fires them faster than Jev answers.

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

## Characters

### Out of the box

`name`, `persona`, and `goal` are all a character needs. The persona does most of the work: Jev judges each attempt by the values it describes, so "values honesty, despises flattery" makes flattery fail and plain speaking land. With nothing else set, a character:

- is convinced at `"normal"` difficulty (a score of 3.2 on the default 0 to 4 rubric)
- takes offence at threats and insults
- never runs out of patience

### Shaping a character

| Field | Default | What it does |
|---|---|---|
| `difficulty` | `"normal"` | How hard they are to convince (see below) |
| `offendedBy` | `["threats", "insults"]` | Which tells offend them. `[]` means nothing does |
| `patience` | Infinity | Attempts before they give up (above 0) |
| `secrets` | none | `[{ id, fact }]` facts that only help once learned |
| `reactions` | generic line | `[{ min, text }]` lines for unconvinced attempts, by the highest `min` reached |
| `repeatReaction` | generic line | What they say when the player repeats themselves |

Each difficulty word sets the score needed as a share of the top rubric level, so it still works if you write your own rubric:

| `difficulty` | Share of the top level | Threshold on the default 0 to 4 rubric |
|---|---|---|
| `"easy"` | 60% | 2.4 |
| `"normal"` | 80% | 3.2 |
| `"hard"` | 90% | 3.6 |
| `"very hard"` | 95% | 3.8 |

Case and surrounding spaces don't matter, and `"very-hard"` or `"very_hard"` work too. `defineCharacter()` and `character` on a `Persuadable` keep the word, in the spelling above, next to the `threshold` it works out to. So a copy like `{ ...guard.character, patience: 5 }` works; if a copy changes `difficulty` or `levels`, leave out its `threshold`. These shares are first guesses and may change once they've been calibrated against live Jev.

### Intimidation

Every attempt is checked for two tells, `threats` and `insults`, each asked as its own yes/no question in the same Jev request. Every result reports both: `tells` holds each probability, and `triggered` lists the ones at or above `hostileAt` (0.7), whether or not they caused offence.

A triggered tell in `offendedBy` makes the verdict `offended`, whatever the score. A tell left out of `offendedBy` doesn't offend, and the persona alone decides whether it helps or hurts. A cowardly guard who can be bullied but hates being laughed at:

```js
const snag = new Persuadable(
  {
    name: "Snag",
    persona: "A cowardly goblin guard, jumpy and easily frightened. Hates being laughed at.",
    goal: "Unlock the prisoner's cage",
    difficulty: "easy",
    offendedBy: ["insults"],
  },
  { client },
);

const result = await snag.attempt("Open this cage, or I'll feed you to the wolves.");
result.verdict;   // "convinced", if Jev judges that the threat works on Snag
result.triggered; // ["threats"], so your game can narrate it as intimidation
```

Mocking Snag is still `offended`.

### Secrets

Put hidden motivations in `secrets` rather than `persona`, so players can't win on a replay by guessing:

```js
secrets: [{ id: "sick_daughter", fact: "His daughter has a fever and the apothecary is closed." }]
```

Call `guard.learn("sick_daughter")` when the player discovers it. Before that, arguments leaning on it won't help.

### Full control

| Field | Default | What it does |
|---|---|---|
| `threshold` | set by `difficulty` | An exact score to convince, above 0 and at most the top level. Use it instead of `difficulty`; if you set both, they must agree |
| `levels` | 5-level rubric | Your own ordered rubric, 2 to 10 descriptions from weakest to strongest |
| `hostileAt` | 0.7 | Probability at which a tell counts as triggered |
| `decide` | none | `(result, context) => verdict`, your own rule for the final verdict |
| `failCost`, `offendedCost` | 1, 2 | Patience lost per failed or offensive attempt |
| `repeatSimilarity`, `memory`, `maxInputLength` | 0.8, 4, 500 | Word overlap that counts as a repeat, previous attempts sent as context, input cap |

`decide` runs after the verdict is computed (repeats included) and before anything changes. It gets a frozen copy of the result and `{ input, character, previousAttempts, patienceLeft }`, and returns a verdict, or nothing to keep the original. Patience, the reaction, and the character's memory follow the verdict it returns:

```js
const guard = new Persuadable(
  {
    name: "Harry Goatleaf",
    persona: "A tired night guard who values honesty.",
    goal: "Open the gate after curfew",
    // Harry never gives in to the very first attempt, however good it is.
    decide: (result, { previousAttempts }) =>
      result.verdict === "convinced" && previousAttempts.length === 0 ? "unconvinced" : undefined,
  },
  { client },
);
```

- It must be synchronous. Returning anything other than a verdict or `undefined`, including a Promise, throws a `HoneytongueError` and leaves the character unchanged.
- It runs in `attempt()`, `record()`, and `judgePersuasion()`. It isn't applied when you call `readPersuasion()` directly, which stays a plain reading of Jev's answers.
- JSON stories can't hold functions, so `decide` isn't available in them. Stories built in code can set it in an NPC's `persuasion` block.

Mistakes throw a `HoneytongueError` with a readable message, such as a threshold higher than your rubric allows, an unknown difficulty word, or a `threshold` that disagrees with `difficulty`. Fields you set to `undefined` keep their defaults.

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
| `persuasionQuestions`, `persuasionState`, `readPersuasion` | You're already calling Jev and want persuasion merged into the same request. `readPersuasion` doesn't apply `decide`; pass the answers to `record()` if you want it |
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

Stories are validated when loaded, so mistakes like a `goto` to a missing scene or two different characters sharing an id are all reported up front. Scenes can have a `name` (like "East Gate") for interfaces with a status line. An NPC's `persuasion` block takes the same settings as a character, such as `difficulty`, `offendedBy`, and `threshold`, and `hostileReaction` is only needed when something can offend them. See `stories/gatehouse.json` to write your own, and `src/index.d.ts` for the full story format.

## Testing and tuning

```bash
npm test                 # unit tests, no API key needed
npm run eval             # scores the phrasing test set against Jev
npm run eval -- --mock   # keyword baseline (currently action 15/17, score 7/7, tells 2/2)
```

`evals/gatehouse.json` covers parsing, persuasion score ranges, threats and insults, prompt-injection attempts, and arguments using secrets the player hasn't learned. Run it after changing a persona or rubric. You can pass another suite: `npm run eval -- path/to/suite.json`.

## Cost

Jev charges about $0.042 per million input tokens and nothing for output. A persuasion attempt is typically under 1,000 tokens, so 10,000 attempts cost around 40 cents. Repeats are caught locally and cost nothing.

## License

MIT
