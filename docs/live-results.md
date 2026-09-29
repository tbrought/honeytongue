# Live Jev results (0.1.0-alpha.4)

Honeytongue was built on an offline mock until September 2026. This is what calibrating it against live Jev found, and what changed as a result. The raw outputs aren't in the repository; the scripts that produce them are (see "Reproducing").

- **Model:** `jev-1.13.0`, the only model TypeSafe lists (`jev-latest` and `jev-preview` point to it).
- **Scale:** 2,626 calls, 2.58 million input tokens and 0.27 million output tokens, about $0.11. Every call returned 200.
- **Date:** 2026-09-28.

## Headline results

| | Result |
|---|---|
| Response shape | Matched `src/jev.js` for all three question types on the first call |
| Scene and showcase suites | Verdicts 43/43, scores 18/18, threats 8/8, insults 7/7, actions 64/67 |
| Reliability | Every scripted winning and losing line gave its intended verdict in 10 of 10 repeats (33 suite cases, 8 scene routes) |
| Prompt injection | More than 50 attempts across 16 characters; none won |
| Consistency | Identical attempts vary by a standard deviation of 0.09 at most; no verdict flipped in 130 repeats |
| Cost | About 780 tokens per attempt, 1,400 per text adventure turn; about 30 and 50 cents per 10,000 |
| Speed | About 100 ms median, 150 ms at the 95th percentile |

The three action misses are reasonable readings: "sing a sea shanty" read as chatting to the guard, a threat to throw Cobb down the stairs as grabbing his key (he's still offended), and flattery aimed at Maude as small talk.

## What changed

1. **The default rubric (rubric C).** The old rubric's lowest level called "flattery they'd see through, obvious lies, demands" counterproductive in general, which stopped a coward folding to a threat whatever his persona said. The new one judges each attempt only by how it moves this person, and adds fear beside values.

   | | Old rubric | Rejected alternative (B) | New rubric (C) |
   |---|---|---|---|
   | Threats that convinced cowards (Nib, a timid clerk) | 0/10 | 9/10 | 9/10, and 5/5 for Nib with an explicit persona |
   | Median compelling argument (Maude / Nib) | 3.60 / 3.62 | 3.24 / 3.41 | 3.64 / 3.61 |
   | Flattery on honest characters (Harry, Maude, Cobb) | 0.56 at most | raised (Maude 0.47 to 1.02) | 1.10 at most |
   | Flattery on a vain character | not tested | not tested | 4/4 targeted lines won |
   | Injection attempts that won | 0 | 1 | 0 |

   B compressed the top of the scale and let an injection through, so it was rejected.

2. **Secrets are only sent once learned.** Telling Jev that a fact was unknown to the player didn't stop arguments using it from scoring higher. Three approaches were tested; leaving unlearned secrets out entirely gave the widest gap between learned and unlearned (0.55 to 1.03 points) without lowering learned scores. It can't stop a lucky guess, which is judged like any other argument.

3. **Personas.** Nib's persona now says a firm threat makes him give in, since Jev only lets a coward fold when the persona says so. Cobb's now says he fears guiding the raiders to the town, because an opening plea used to win his scene on the first turn; his playground preset notes that he's tougher outside his scene.

4. **Scripted lines.** Each scene's suite has a standing check that a bare opening plea doesn't win, and every scripted line meets a reliability rule: its intended verdict in 10 of 10 repeats, with an average at least 0.1 from the threshold.

## Difficulty

Each character got 15 compelling arguments (secret learned), 10 middling, and 5 weak, scored on the new rubric. Today's fractions match the meanings they were given, so they didn't change:

| Word | Meaning | Measured |
|---|---|---|
| easy (0.6) | A reasonable, specific argument wins, even without the secret | Nib: 9 of 10 middling arguments passed |
| normal (0.8) | An argument that speaks to what they care about wins | 14 to 15 of 15 compelling passed (Nib, Maude) |
| hard (0.9) | About two in three compelling arguments pass | 18 of 30 (Nib and Maude) |
| very hard (0.95) | About one in three pass | 12 of 30 |

Difficulty is relative to how strict the persona is: a suspicious detective or a proud smith stays hard to move at any word. On custom rubrics of 3 or 7 levels, the same arguments scored 0.10 to 0.14 of the top level lower than on the default, so the words are only approximate there.

## Robustness: characters we didn't design

Twelve characters written the way other developers might (short and long personas; modern, sci-fi, mystery, child, and fantasy; greedy, vain, cowardly, honest, suspicious, kind, proud, and bored), 12 lines each.

- **Tactics follow the persona.** Bribes moved the greedy characters and not the honest officer (0.01). Flattery moved the vain poet (3.04) and not the others (1.63 at most, apart from a nervous troll at 2.48). A threat moved the cowardly troll (2.57) but not past his threshold, because his persona didn't say it would.
- **Personas that only say what the character dislikes don't work.** A bouncer written as "proud, can't stand being disrespected" scored good arguments 1.3 to 2.7. Personas that demand evidence the player can't show in dialogue are nearly unwinnable without it.
- **Tells.** Insults were caught 12 of 12, threats 11 of 12 (the miss was veiled: "or I'll come back with my friends", 0.61). Four threats also counted as insults (0.71 to 0.90), so a character offended only by insults can be offended by a contemptuous threat.
- **Edge cases.** "pls", "ok fine", and "no" never won and triggered no tells. Inputs near the 500-character limit behaved normally, and a fake "SYSTEM NOTE" inside one changed nothing (3.09 to 3.17 with it, 3.10 to 3.14 without). Spanish, French, and Japanese scored within about 0.2 of the English, and their threats and insults were caught.

## Consistency

Ten lines were each sent ten times to Harry, and three lines ten times each as full engine turns. The largest standard deviation was 0.09, most were 0.02 or less, and no verdict flipped. The scene around an engine turn can shift the tells slightly (an insult to Maude scored 0.62 standalone and 0.72 to 0.76 in her scene), so engine turns and standalone attempts aren't interchangeable, but each is stable.

## Conversations and playtests (0.1.0-alpha.5)

Whole conversations with each demo character, 5 runs each, as standalone attempts and as scene turns, with every line also scored fresh for comparison (1,153 calls), then the author's first four playtests (one per scene, two won and two lost).

| What was tested | What happened | What changed |
|---|---|---|
| Building: a weak opening, then lines adding new information | Later lines scored 0.3 to 0.8 higher than they would alone | Nothing; documented |
| Switching: flattery, a threat, then an honest offer | The honest offer scored as well as it would alone: offence costs patience, not goodwill | Nothing; documented |
| Rephrasing the same point | Harry and Maude gave it 0.3 to 0.8 less each time; Cobb, who needs reassurance, gave it more | The docs' claim is now precise |
| Returning to a failed line after learning a secret | Word for word, it's caught as a repeat; letting it through to Jev didn't help, since Jev's memory discounted it too (0 of 20 won either way) | Not adopted; players are told to say what they've learned in new words |
| A point made again after 4 other attempts | It regained its full weight (2.41 against 2.45 fresh; inside memory, 1.59) | Memory is now 10 attempts: 1.45 against 2.43 |
| Patience | Maude's and Nib's 3 ran out before a good argument got a second try; in a playtest, Maude's "Close" (3.44 of 3.6) came with one attempt left | Maude 5 and a near miss that says what's missing (then an improved argument won 10 of 10); Nib waits for players who don't know the scenes |
| Spoken threats (from a playtest) | "…or I'll punch you" was read as attacking, which ends two scenes, and a threat to Cobb as grabbing the key, costing 5 patience in one turn | Descriptions fixed in every scene (all eight threats now go to the character); a turn is charged once, at the larger cost |
| Maude's banter | An insult in front of her evidence line cost it 0.51 | Persona fix (now 0.26); the claims say she isn't offended by insults, but they don't help |

Final checks for alpha.5: every suite verdict held but one (53 cases; the miss is a documented borderline insult to Nib, which offended him in 10 of 10 scene turns in a separate check), every scripted line was reliable in 10 of 10 repeats (39 suite cases and 8 scene routes), and every spoken threat went to the character.

## The live demo (0.1.0-alpha.6)

The web demo now plays through a public proxy that only accepts the requests Honeytongue itself sends for the four scenes. Two live checks:

- **Nothing real is refused.** Every scene route, 10 times over, went through a proxy guarded like the demo's (`node scripts/live.js routes --repeats 10 --via-proxy`): 112 calls, no refusals, every route reached its ending, and every winning line won 10 of 10 times. The full eval rerun matched alpha.5: verdicts 52 of 52 plus Nib's borderline case, reliable 39 of 39, actions 84 of 86.
- **End to end in a browser.** The demo in headless Edge, against a local proxy configured like the Worker, with live Jev:
  - Live turns were judged by Jev, one request each.
  - A page from another version got the version-mismatch note.
  - Forced failures behaved as intended. A 429, a 500, or a dropped connection: the stand-in answered that turn, and Jev was tried again after a minute. A refusal or no credit: the stand-in judged for the rest of the session.
  - The 50-turn cap held.

  The proxy's check script, run against the real Worker module, passed.

The phase used 590 calls and about 757,000 tokens.

## Reproducing

With `TYPESAFE_API_KEY` set:

```bash
npm run eval -- --all --record --repeats 10   # every suite, with the reliability check
node scripts/live.js routes --repeats 10      # every scene route
node scripts/live.js consistency              # ten lines, ten times each
node scripts/calibrate.js arguments           # difficulty calibration (also secrets, injections, threats, flattery, robustness)
node scripts/multiturn.js                     # whole conversations with each demo character
```

Calls are recorded in `live-runs/` (git-ignored), with a running token total that stops at a budget set in `scripts/live-recorder.js`. `--patch <file>` tries a candidate rubric or persona from `evals/calibration/` before it's adopted.
