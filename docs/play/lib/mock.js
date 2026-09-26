// A deliberately dumb stand-in for Jev so you can play and test offline.
// It returns the same answer shapes as the real API, but judges by keywords.
// Real Jev will be far better at both parsing and persuasion scoring.

const STOP = new Set(
  "the and you your with for about into that this try them her his are not any from over other way out let she him who what".split(" ")
);
const words = (s) => (String(s).toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, "");
const stems = (s) => new Set(words(s).map(stem));
// Lowercase, with curly apostrophes (common on phone keyboards) made straight.
const lower = (s) => String(s).toLowerCase().replace(/[‘’]/g, "'");

// Signs that the player is making a case, and how a typical character takes it.
const HONEST = /\b(please|sorry|honest(ly)?|truth|truly|swear|promise|i won'?t lie|understand)\b/;
const FLATTERY = /\b(finest|greatest|beautiful|handsome|strongest|smartest|wisest|bravest|kindest)\b/;
const DEMAND = /\b(i order|i command|you must|obey|do you know who i am|by order of)\b/;
const REQUEST = /\b(let me|open (the|this|that|up)|need to|have to|beg|urgent|because)\b/;
const INJECTION = /\b(system|ignore (all |any )?(previous|prior|earlier)|instructions?|rate this|score|maximally|rules of (this|the) game)\b/;
const ARGUING = [HONEST, FLATTERY, DEMAND, REQUEST, INJECTION];
// Options whose description is about persuading someone.
const PERSUADE_OPTION = /\b(convince|persuade|plead|argue|reason with)\b/;
const HOSTILE = /\b(kill|stab|punch|hit|hurt|threat\w*|or else|idiot|fool\w*|moron|stupid|useless|shut up)\b/i;

function mockChoice(input, criteria) {
  const said = stems(input);
  const arguing = ARGUING.some((re) => re.test(lower(input)));
  const raw = {};
  for (const [option, desc] of Object.entries(criteria)) {
    const text = `${option.replace(/_/g, " ")} ${typeof desc === "string" ? desc : ""}`;
    raw[option] = [...stems(text)].filter((w) => said.has(w)).length;
    if (arguing && PERSUADE_OPTION.test(text.toLowerCase())) raw[option] += 2;
  }
  let total = Object.values(raw).reduce((a, b) => a + b, 0);
  if (total === 0 && "unclear" in raw) { raw.unclear = 1; total = 1; }
  const probabilities = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, total ? v / total : 0]));
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  return { type: "choice", choice, probabilities, confidence: probabilities[choice] };
}

/** Scores on a 0-4 scale, then stretches to the rubric's length. */
function mockScore(input, levels, character) {
  const t = lower(input);
  const said = stems(input);
  const overlap = (text) => [...stems(text)].filter((w) => said.has(w)).length;
  const secrets = character?.secrets ?? [];
  const known = secrets.filter((s) => s.player_knows).map((s) => s.fact).join(" ");
  const unknown = secrets.filter((s) => !s.player_knows).map((s) => s.fact).join(" ");

  let score = 0.5;
  if (HONEST.test(t)) score += 0.8;
  score += Math.min(2.4, overlap(known) * 0.9);          // speaks to what they care about
  score += Math.min(0.6, overlap(character?.persona ?? "") * 0.3);
  if (overlap(unknown) > overlap(known)) score -= 0.3;   // knows things they shouldn't: suspicious
  if (FLATTERY.test(t)) score -= 1.2;
  if (DEMAND.test(t)) score -= 1.2;
  if (INJECTION.test(t)) score = Math.min(score, 0.5);  // claims about scores have no authority

  const max = levels.length - 1;
  score = Math.max(0, Math.min(max, (score * max) / 4));
  const legend = Object.fromEntries(levels.map((l, i) => [String(i), String(l)]));
  return { type: "score", score, legend, probabilities: {}, confidence: 0.5 };
}

export function createMockClient() {
  return {
    async ask(state, questions) {
      const input = String(state?.player_input ?? (typeof state === "string" ? state : ""));
      const answers = {};
      for (const [id, q] of Object.entries(questions)) {
        if (q.type === "choice") answers[id] = mockChoice(input, q.criteria);
        else if (q.type === "score") answers[id] = mockScore(input, q.criteria, state?.character);
        else if (q.type === "noul") answers[id] = { type: "noul", noul: HOSTILE.test(input) ? 0.9 : 0.05 };
      }
      return answers;
    },
  };
}
