// Using Honeytongue's persuasion mechanic in your own game, no text adventure needed.
// Run: node examples/standalone.js   (uses the offline mock without TYPESAFE_API_KEY)
import { Persuadable, createJevClient, createMockClient } from "../src/index.js";

const client = process.env.TYPESAFE_API_KEY ? createJevClient() : createMockClient();
if (!process.env.TYPESAFE_API_KEY) console.log("(No TYPESAFE_API_KEY set, so using the offline keyword mock. It's much dumber than Jev.)\n");

// Only name, persona, and goal are required. Levels and threshold have sensible defaults.
const merchant = new Persuadable(
  {
    name: "Old Tobin",
    persona: "A shrewd lantern merchant who respects hard bargaining and honest hardship, but can't stand sob stories he suspects are fake. Secretly fond of children.",
    goal: "Sell the brass lantern for half its price",
    patience: 3,
  },
  { client },
);

for (const line of [
  "Come on, give me a discount.",
  "It's for my kid sister, she's scared of the dark since our house burned down.",
]) {
  const r = await merchant.attempt(line, { context: { player_gold: 12, lantern_price: 20 } });
  console.log(`> ${line}\n  ${r.verdict} (score ${r.score?.toFixed(1) ?? "-"}/${r.maxScore}, patience left ${r.patienceLeft})\n`);
}
