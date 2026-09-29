# Honeytongue

**Characters your players can actually argue with.** Give a character a name, a persona, and a goal, pass in whatever the player typed, and Honeytongue tells you whether they were convinced, judged by *that character's* values. The same line can win over a greedy merchant and offend an honest guard. It's powered by [Jev](https://docs.typesafe.ai), TypeSafe's typed decision model, and works in any JavaScript game: Node, the browser, Twine, or a Discord bot. It has no dependencies and ships TypeScript types.

**You only need three fields and one method. Everything else is optional.**

> **Alpha, tested against live Jev.** Version 0.1.0-alpha.6 has been calibrated and checked with about 6,000 live calls, whole conversations included (see [the results](https://github.com/tbrought/honeytongue/blob/main/docs/live-results.md)). Defaults may still change before 0.1.0.

## Quick start

You need Node 18 or later. In an empty folder:

```bash
npm install honeytongue
```

Save this as `try.mjs`:

```js
import { Persuadable, createJevClient, createMockClient } from "honeytongue";

const guard = new Persuadable(
  {
    name: "Harry",
    persona: "A tired night guard who values honesty and can't stand flattery.",
    goal: "Open the gate after curfew",
  },
  // With a TypeSafe key, Jev judges. Without one, a simple offline stand-in does.
  { client: process.env.TYPESAFE_API_KEY ? createJevClient() : createMockClient() },
);

const result = await guard.attempt("Please, I'm honestly carrying medicine for a sick child inside the walls.");
console.log(result.verdict, result.score);
```

Then run it:

```bash
node try.mjs
```

It prints a verdict and a score out of 4, like `unconvinced 2.84`. To use Jev, get a key from [TypeSafe](https://docs.typesafe.ai) and set it before running: `export TYPESAFE_API_KEY=...` on macOS and Linux, or `$env:TYPESAFE_API_KEY="..."` in Windows PowerShell. Never put the key in browser code.

## Reading the verdict

Every attempt gets one of four verdicts: `convinced`, `unconvinced`, `offended` (a threat or insult), or `repeated`. Your game decides what happens:

```js
if (result.verdict === "convinced") openTheGate();
else if (result.outOfPatience) callTheWatch();
else say(result.reaction ?? "Harry's hand drops to his club.");
```

## Where next

- **[Documentation](https://honeytongue.dev/)**: writing personas, difficulty, secrets, patience, and every option, from simple to advanced.
- **Playground**: tune a character by trying lines against it, with `npx honeytongue playground`, or [in your browser](https://honeytongue.dev/playground/).
- **Demo**: [four short scenes](https://honeytongue.dev/play/) built with Honeytongue's text adventure engine, or `npx honeytongue` in a terminal.
- **Browser games and Twine**: keep your key on a small proxy that ships with Honeytongue and only judges your own characters. See [Browser games](https://honeytongue.dev/#browser).

## License

MIT
