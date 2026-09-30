<p align="center"><img src="https://honeytongue.dev/assets/honeytongue-logo-512.png" alt="The Honeytongue logo: a pixel-art speech bubble dripping with honey" width="128" height="128"></p>

# Honeytongue

[![CI](https://github.com/tbrought/honeytongue/actions/workflows/test.yml/badge.svg)](https://github.com/tbrought/honeytongue/actions/workflows/test.yml)
[![npm (alpha)](https://img.shields.io/npm/v/honeytongue/alpha?label=npm%20alpha)](https://www.npmjs.com/package/honeytongue)
[![License: MIT](https://img.shields.io/npm/l/honeytongue)](LICENSE)

**Characters your players can actually argue with.** Give a character a name, a persona, and a goal, pass in whatever the player typed, and Honeytongue tells you whether they were convinced, judged by *that character's* values. The same line can win over a greedy merchant and offend an honest guard. It's for any game where players type or speak to characters, and it's powered by [Jev](https://docs.typesafe.ai), TypeSafe's typed decision model. It works in JavaScript games: browser games (there's a [Phaser example](https://honeytongue.dev/#visual)), Twine stories, and anything that runs on Node, such as a Discord bot. Spoken input works too, once your game turns speech into text: in tests, lines as speech recognition writes them got the same verdicts as typed ones, though long arguments scored a little lower ([details](https://honeytongue.dev/#spoken)). Engines outside JavaScript (Unity, Godot, Unreal, Ren'Py) aren't supported yet; a plain HTTP endpoint for them is on the roadmap. It has no dependencies, ships TypeScript types (TypeScript 5.9 or later), and works with `import` or `require()` (on Node 22.12 itself, `require()` prints an experimental-feature warning; 22.13 and later don't).

**You only need three fields and one method. Everything else is optional.**

> **Alpha, tested against live Jev.** Version 0.1.0-alpha.11 has been calibrated and checked with about 6,000 live calls, whole conversations included (see [the results](https://github.com/tbrought/honeytongue/blob/main/docs/live-results.md)). Defaults may still change before 0.1.0.

## Quick start

You need Node 22.12 or later. In an empty folder:

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

## Feedback

Issues and feedback are welcome: [report a bug or share a playtest](https://github.com/tbrought/honeytongue/issues/new/choose). Honeytongue is a solo project, so pull requests aren't being accepted for now. Security problems go to private reporting instead (see [SECURITY.md](SECURITY.md)).

## License

MIT. Built on Jev by TypeSafe AI, and not affiliated with TypeSafe.
