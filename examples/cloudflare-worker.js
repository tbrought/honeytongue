// A proxy for browser games, deployed as a Cloudflare Worker.
//
//   npm create cloudflare@latest honeytongue-proxy   (choose "Hello World" Worker)
//   npm install honeytongue
//   replace src/index.js with this file
//   npx wrangler secret put TYPESAFE_API_KEY
//   npx wrangler deploy
//
// Then point createProxyClient({ url }) at the deployed Worker URL.
// To change the Jev model without redeploying code, add TYPESAFE_MODEL to the "vars" in your Wrangler config.

import { createProxyHandler } from "honeytongue/proxy";

// Your game's characters (or stories), in the same form your game passes them to Honeytongue.
const harry = {
  name: "Harry Goatleaf",
  persona: "A gatekeeper at the east gate of Ashford. Loyal to the lord, suspicious of strangers.",
  goal: "Let the player through the gate",
};

const handle = createProxyHandler({
  // The pages your game runs on. If you're unsure of the exact origin (itch.io games, for example,
  // run in a frame on itch's own domain), try the game once: the error message names the origin to add.
  allowedOrigins: ["https://your-game.example", "http://localhost:8000"],
  // Only judge Honeytongue's own requests for these characters, so nobody else can use your key for
  // their own Jev questions. For the text adventure engine, pass allowedStories: [story] instead.
  // Deploy again whenever you change a character or update Honeytongue.
  allowedCharacters: [harry],
  rateLimit: { requests: 30, windowMs: 60_000 },
});

export default {
  fetch: (request, env) => handle(request, env),
};
