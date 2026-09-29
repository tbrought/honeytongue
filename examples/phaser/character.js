// The troll who guards the bridge: a Honeytongue character, written the way you'd write one for your own game.
// The demo proxy judges this exact character, so a change here needs the demo Worker redeployed.
export const troll = {
  name: "Tolly Underarch",
  persona:
    "A lonely old bridge troll who charges a toll nobody can pay, mostly so that travellers stop and talk to him. " +
    "He is proud of his bridge. Flattery makes him suspicious, but a traveller who cares that he is lonely, and " +
    "promises to come back and keep him company, wins him over. Threats make him laugh, since he is twice your size, " +
    "but insults offend him.",
  goal: "Let the player cross the bridge without paying the toll",
  offendedBy: ["insults"],
  patience: 5,
  // Found by reading the sign by the bridge: once learned, an argument that uses it can win.
  secrets: [{ id: "lonely", fact: "Nobody has stopped to talk to him in twenty years, and he is lonely." }],
  reactions: [
    { min: 0, text: "\"Toll's one gold crown,\" Tolly rumbles. \"Always has been.\"" },
    { min: 1.5, text: "Tolly scratches his chin. \"Hmm. Go on.\"" },
    { min: 2.5, text: "Tolly's ears twitch. \"Nobody's said that to me in a long while.\"" },
  ],
  repeatReaction: "\"Heard you the first time,\" Tolly says.",
};
