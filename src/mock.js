// A deliberately dumb stand-in for Jev so you can play and test offline.
// It returns the same answer shapes as the real API, but judges by keywords.
// Real Jev will be far better at both parsing and persuasion scoring.

import { SOURCE } from "./jev.js";

const STOP = new Set(
  "the and you your with for about into that this try them her his are not any from over other way out let she him who what".split(" ")
);
const words = (s) => (String(s).toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
// A trailing "e" goes too, so crate and crates, or hide and hiding, meet in the middle.
const stem = (w) => w.replace(/(ing|ed|es|s)$/, "").replace(/e$/, "");
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
// Plain appeals to the person in front of you.
const APPEAL = /\b(please|if you (let|allow)|let me (in|through|pass)|i beg|i'?m begging)\b/;
// Offers to do something for them.
const OFFER = /\b(give|bring|help|fetch|deliver|take\b[^.!?]*\bto)\b/;
// Options whose description is about persuading someone.
const PERSUADE_OPTION = /\b(convince|persuade|plead|argue|reason with)\b/;
// The tells, answered by question id. Any other yes/no question gets "either one".
const THREAT = /\b(kill|stab|punch|hit|hurt|beat you|threat\w*|or else|or i'?ll|i'?ll make you|you'?ll regret|break your|cut your|slit your|gut you)\b/;
const INSULT = /\b(idiot\w*|fool\w*|moron\w*|stupid|useless|shut up|coward\w*|worm|pathetic|imbecile|halfwit|dimwit|oaf|scum|fuck\w*|shit\w*|bastard\w*|asshole|dumb\w*)\b/;
const TELL = { threats: THREAT, insults: INSULT };
const mockNoul = (id, input) => {
  const t = lower(input);
  const hit = TELL[id] ? TELL[id].test(t) : THREAT.test(t) || INSULT.test(t);
  return { type: "noul", noul: hit ? 0.9 : 0.05 };
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "Harry, ..." or "..., Harry": speaking to the character by full or first name. */
function addresses(input, name) {
  const names = [...new Set([name, name.split(/\s+/)[0]])].filter((n) => n.length > 1).map(escape);
  return names.length > 0 && new RegExp(`(^|,)\\s*(${names.join("|")})\\s*([,!?.:;]|$)`).test(input);
}

function mockChoice(input, criteria, character) {
  const said = stems(input);
  const t = lower(input);
  const arguing = ARGUING.some((re) => re.test(t));
  // Arguing while speaking to them directly, or pleading outright, is almost certainly persuasion.
  const pleading = arguing && (APPEAL.test(t) || addresses(t, lower(character?.name ?? "")));
  const raw = {};
  for (const [option, desc] of Object.entries(criteria)) {
    const text = `${option.replace(/_/g, " ")} ${typeof desc === "string" ? desc : ""}`;
    raw[option] = [...stems(text)].filter((w) => said.has(w)).length;
    // Saying every word of an option's name ("examine the cage" for examine_cage) is a strong sign.
    const named = stems(option.replace(/_/g, " "));
    if (named.size && [...named].every((w) => said.has(w))) raw[option] += 2;
    if (arguing && PERSUADE_OPTION.test(text.toLowerCase())) raw[option] += pleading ? 4 : 2;
  }
  // Squaring sharpens the odds, so one clearly better match isn't read as a toss-up with every option sharing a word.
  for (const option of Object.keys(raw)) raw[option] **= 2;
  let total = Object.values(raw).reduce((a, b) => a + b, 0);
  if (total === 0 && "unclear" in raw) { raw.unclear = 1; total = 1; }
  const probabilities = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, total ? v / total : 0]));
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  return { type: "choice", choice, probabilities, confidence: probabilities[choice] };
}

// A persona that suggests threats would work, for characters not offended by them.
const TIMID = /\b(coward\w*|timid|nervous|scared|afraid|fearful|easily (frightened|scared|intimidated))\b/;

/** Scores on a 0-4 scale, then stretches to the rubric's length. */
function mockScore(input, levels, character, instructions) {
  const t = lower(input);
  const said = stems(input);
  const overlap = (text) => [...stems(text)].filter((w) => said.has(w)).length;
  const secrets = character?.secrets ?? [];
  const known = secrets.filter((s) => s.player_knows).map((s) => s.fact).join(" ");
  const unknown = secrets.filter((s) => !s.player_knows).map((s) => s.fact).join(" ");

  let score = 0.5;
  if (HONEST.test(t)) score += 0.8;
  score += Math.min(2.4, overlap(known) * 0.9);          // speaks to what they care about
  if (overlap(known) > 0 && OFFER.test(t)) score += 0.8;  // and offers to help with it
  score += Math.min(0.6, overlap(character?.persona ?? "") * 0.3);
  if (overlap(unknown) > overlap(known)) score -= 0.3;   // knows things they shouldn't: suspicious
  if (FLATTERY.test(t)) score -= 1.2;
  if (DEMAND.test(t)) score -= 1.2;
  if (INJECTION.test(t)) score = Math.min(score, 0.5);  // claims about scores have no authority
  // persuasionQuestions() only says threats aren't automatically weak when they don't offend.
  const threatsTolerated = /threats or intimidation/i.test(JSON.stringify(instructions ?? ""));
  if (threatsTolerated && THREAT.test(t) && TIMID.test(lower(character?.persona ?? ""))) score += 3;

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
        if (q.type === "choice") answers[id] = mockChoice(input, q.criteria, state?.character);
        else if (q.type === "score") answers[id] = mockScore(input, q.criteria, state?.character, q.instructions);
        else if (q.type === "noul") answers[id] = mockNoul(id, input);
      }
      answers[SOURCE] = "mock";
      return answers;
    },
  };
}
