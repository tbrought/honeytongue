// The gatekeeper in examples/browser.html. The page and the proxy (examples/node-proxy.js, allowedCharacters) import
// the same object, so the proxy judges exactly the character the page sends. Do the same in your own game.
export const harry = {
  name: "Harry Goatleaf",
  persona: "A tired night guard who values honesty and despises flattery and bribes.",
  goal: "Open the gate after curfew",
  patience: 4,
  reactions: [
    { min: 0, text: "\"Gate's shut till dawn.\"" },
    { min: 2, text: "He hesitates. \"You'll have to do better than that.\"" },
  ],
};
