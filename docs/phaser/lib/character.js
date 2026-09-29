// The troll who guards the bridge: a Honeytongue character, written the way you'd write one for your own game.
// The demo proxy judges this exact character, so a change here needs the demo Worker redeployed.
export const troll = {
  name: "Tolly Underarch",
  persona:
    "An old bridge troll who charges a toll of one gold crown, which no traveller has ever paid. He is proud of his " +
    "bridge and suspicious of flattery. Threats make him laugh, since he is twice your size, but insults offend him. " +
    "Money and sad stories don't move him; only a traveller who understands what he really wants gets across for free.",
  goal: "Let the player cross the bridge without paying the toll",
  offendedBy: ["insults"],
  patience: 5,
  // What he really wants. Jev only hears it once the player has read the sign by the bridge (learn("lonely")), so
  // an argument that uses it can only win after that.
  secrets: [{
    id: "lonely",
    fact: "Nobody has stopped to talk to him in twenty years. He is lonely: what he really wants is company, and a " +
      "promise to come back and visit him would win him over.",
  }],
  reactions: [
    { min: 0, text: "\"Toll's one gold crown,\" Tolly rumbles. \"Always has been.\"" },
    { min: 1.5, text: "Tolly scratches his chin. \"Hmm. Go on.\"" },
    { min: 2.5, text: "Tolly's ears twitch. \"Nobody's said that to me in a long while.\"" },
  ],
  repeatReaction: "\"Heard you the first time,\" Tolly says.",
};
