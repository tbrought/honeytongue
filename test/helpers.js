// A scripted stand-in for Jev: returns whatever answers each test sets up.
export function fakeClient({ action = "persuade_guard", p = 0.9, score = 0, hostile = 0.01 } = {}) {
  const client = {
    calls: [],
    next: { action, p, score, hostile },
    async ask(state, questions) {
      client.calls.push({ state, questions });
      const n = client.next;
      const answers = {};
      if (questions.action) answers.action = { type: "choice", choice: n.action, probabilities: { [n.action]: n.p, unclear: 1 - n.p } };
      if (questions.persuasion) answers.persuasion = { type: "score", score: n.score, confidence: 0.9 };
      if (questions.hostile) answers.hostile = { type: "noul", noul: n.hostile };
      return answers;
    },
  };
  return client;
}

export const maren = {
  name: "Maren",
  persona: "An honest guard who hates flattery.",
  goal: "Open the gate",
};
