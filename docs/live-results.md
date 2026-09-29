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

## Reproducing

With `TYPESAFE_API_KEY` set:

```bash
npm run eval -- --all --record --repeats 10   # every suite, with the reliability check
node scripts/live.js routes --repeats 10      # every scene route
node scripts/live.js consistency              # ten lines, ten times each
node scripts/calibrate.js arguments           # difficulty calibration (also secrets, injections, threats, flattery, robustness)
```

Calls are recorded in `live-runs/` (git-ignored), with a running token total that stops at a budget set in `scripts/live-recorder.js`. `--patch <file>` tries a candidate rubric or persona from `evals/calibration/` before it's adopted.
