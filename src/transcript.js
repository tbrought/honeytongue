// Playtest transcripts: an opt-in record of a playthrough, which the player saves themselves and which
// scripts/transcript-to-evals.js turns into draft eval cases. Browser-safe, and it holds only what the player typed
// and how each turn went: never keys, headers, or anything from the environment.
//
//   const transcript = createTranscript({ version, scene: "goblin-camp", story });
//   transcript.start();                          // at the start of each playthrough (again after a restart)
//   const before = snapshot(game);
//   const result = await game.turn(input);
//   transcript.record(input, before, result, game);
//   JSON.stringify(transcript.data)              // what the player saves

/** Bump when the shape of a turn changes, and teach transcript-to-evals.js to read the old one. */
export const TRANSCRIPT_FORMAT = 1;

/** The state a turn was played in: where the player was, and what they knew and carried. */
export function snapshot(game) {
  return { location: game.sceneId, flags: [...game.flags], items: [...game.inventory] };
}

export function createTranscript({ version = null, scene = null, story }) {
  const data = {
    formatVersion: TRANSCRIPT_FORMAT,
    honeytongue: version,
    scene,
    story: story?.title ?? null,
    judge: null, // "jev" or "mock", from the first judged turn
    startedAt: new Date().toISOString(),
    runs: [],
  };
  let run = null;
  return {
    data,
    /** Begin a playthrough: the first, or another after a restart. */
    start() {
      run = { startedAt: new Date().toISOString(), turns: [], ending: null };
      data.runs.push(run);
    },
    /** Add a turn, given the state before it (from snapshot()), what the engine returned, and the game after it. */
    record(input, before, result, game) {
      if (!run) this.start();
      const d = result?.debug ?? null;
      if (!data.judge && d?.source) data.judge = d.source;
      const top = d?.ranked?.[0];
      const finite = (n) => (Number.isFinite(n) ? n : null);
      run.turns.push({
        n: run.turns.length + 1,
        input: String(input),
        ...before,
        action: top ? { id: top[0], p: finite(top[1]) } : d?.verdict === "repeated" ? { id: "(repeat)", p: null } : null,
        verdict: d?.verdict ?? null,
        score: finite(d?.persuasion?.score),
        threshold: finite(d?.threshold),
        tells: d?.threats || d?.insults ? { threats: finite(d.threats?.noul), insults: finite(d.insults?.noul) } : null,
        triggered: d?.triggered ?? [],
        patienceLeft: finite(d?.patienceLeft), // null when patience is unlimited or there's no character
        reply: result?.text ?? "",
      });
      run.ending = game?.scene?.ending ?? null;
    },
  };
}
