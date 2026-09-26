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

const handle = createProxyHandler({
  // The pages your game runs on. If you're unsure of the exact origin (itch.io games, for example,
  // run in a frame on itch's own domain), try the game once: the error message names the origin to add.
  allowedOrigins: ["https://your-game.example", "http://localhost:8000"],
  rateLimit: { requests: 30, windowMs: 60_000 },
});

export default {
  fetch: (request, env) => handle(request, env),
};
