// How the web demo presents a game: DOM-free choices about wording and pacing, tested in test/present.test.js.
// This is one example of styling Honeytongue's result.parts; the library itself only says what each part means.

/** The label shown on a judged reply, by verdict. */
export const VERDICT_LABELS = {
  convinced: "CONVINCED",
  unconvinced: "NOT YET",
  offended: "OFFENDED",
  repeated: "REPEATED",
};

/** The spoken form of a label, for screen readers: "Not yet." */
export const spokenLabel = (verdict) => {
  const label = VERDICT_LABELS[verdict];
  return label ? `${label[0]}${label.slice(1).toLowerCase()}.` : "";
};

/**
 * Typing pace for a turn's text: characters per second, faster for long replies so no turn types out for more than
 * about `maxSeconds`. Returns 0 (show at once) when typing is off or the system asks for reduced motion.
 */
export function typingSpeed(chars, { typed = true, reducedMotion = false, base = 90, maxSeconds = 2.5 } = {}) {
  if (!typed || reducedMotion || chars <= 0) return 0;
  return Math.max(base, Math.ceil(chars / maxSeconds));
}

/**
 * What the ending screen shows about the arguments, from the judged turns of a playthrough
 * ({ input, verdict, score, threshold, maxScore }): the lines that convinced, and up to `misses` closest attempts
 * that didn't (highest score first; repeats and offences aren't arguments that nearly worked).
 */
export function endingSummary(judged, { misses = 2 } = {}) {
  const scored = judged.filter((t) => Number.isFinite(t.score));
  return {
    attempts: judged.length,
    landed: scored.filter((t) => t.verdict === "convinced"),
    closest: scored.filter((t) => t.verdict === "unconvinced").sort((a, b) => b.score - a.score).slice(0, misses),
  };
}

/** "3.82 of 4, needed 3.2" */
export const scoreLine = (t) => `${t.score.toFixed(2)} of ${t.maxScore}${Number.isFinite(t.threshold) ? `, needed ${t.threshold}` : ""}`;
