// Turns a playtest transcript (saved from the web demo or `npx honeytongue --transcript`) into draft eval cases,
// for a person to review before adding any to evals/. Nothing here is trusted automatically: every case is marked
// as a draft, and the verdicts are whatever the playtest's judge said, which may have been the offline mock.
//
//   node scripts/transcript-to-evals.js playtest.json               prints a draft suite
//   node scripts/transcript-to-evals.js playtest.json --out draft.json
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Transcript formats this script can read (see TRANSCRIPT_FORMAT in src/transcript.js). */
export const SUPPORTED_FORMATS = [1];

/** A draft eval suite from a transcript. `scenes` is stories/index.json, to find the story file. */
export function transcriptToEvals(transcript, scenes = []) {
  if (!transcript || typeof transcript !== "object" || !Array.isArray(transcript.runs)) {
    throw new Error("That isn't a Honeytongue transcript: expected an object with formatVersion and runs");
  }
  if (!SUPPORTED_FORMATS.includes(transcript.formatVersion)) {
    throw new Error(`This transcript is format ${transcript.formatVersion ?? "(missing)"}, but this script reads format ` +
      `${SUPPORTED_FORMATS.join(" or ")}. Update Honeytongue's scripts, or save the transcript again with a matching version.`);
  }
  const scene = scenes.find((s) => s.id === transcript.scene);
  const cases = [];
  transcript.runs.forEach((run, r) => {
    for (const turn of run.turns ?? []) {
      // Repeats are caught locally and meta commands (look, help) aren't judged, so neither replays as a fresh case.
      if (!turn.action || turn.action.id === "(repeat)") continue;
      const c = { input: turn.input, expect: turn.action.id };
      if (turn.flags?.length) c.flags = turn.flags;
      if (turn.items?.length) c.items = turn.items;
      if (["convinced", "unconvinced", "offended"].includes(turn.verdict)) c.verdict = turn.verdict;
      const scored = Number.isFinite(turn.score) && Number.isFinite(turn.threshold) ? `: scored ${turn.score.toFixed(2)} against ${turn.threshold}` : "";
      c.note = `DRAFT from a playtest judged by ${transcript.judge ?? "an unknown judge"} (run ${r + 1}, turn ${turn.n})${scored}. Review before adding.`;
      cases.push(c);
    }
  });
  return {
    story: scene ? `../stories/${scene.file}` : null,
    draftFrom: { scene: transcript.scene, story: transcript.story, honeytongue: transcript.honeytongue, judge: transcript.judge, startedAt: transcript.startedAt },
    cases,
  };
}

// Run as a script.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
  if (!file) {
    console.error("Usage: node scripts/transcript-to-evals.js <transcript.json> [--out draft.json]");
    process.exit(1);
  }
  try {
    const scenes = JSON.parse(readFileSync(new URL("../stories/index.json", import.meta.url), "utf8"));
    const suite = transcriptToEvals(JSON.parse(readFileSync(file, "utf8")), scenes);
    const text = JSON.stringify(suite, null, 2) + "\n";
    if (out) {
      writeFileSync(out, text);
      console.log(`Wrote ${suite.cases.length} draft cases to ${out}. Review them before adding any to evals/.`);
    } else {
      process.stdout.write(text);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
