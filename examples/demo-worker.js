// The public demo's proxy: the Cloudflare Worker "honeytongue-demo", which lets the web demo on GitHub Pages
// play with Jev. It only judges the four demo scenes (allowedStories), so it can't be used as free access to Jev,
// and it's deployed from this repository at the same commit as the release, so its questions match the demo's.
//
//   npx wrangler secret put TYPESAFE_API_KEY --config examples/demo-wrangler.toml   (the honeytongue-demo-proxy key)
//   npx wrangler deploy --config examples/demo-wrangler.toml
//
// The pages allowed to call it are the ALLOWED_ORIGINS variable in examples/demo-wrangler.toml (comma-separated),
// so adding an address (like a custom domain) is a config change, not a code change.
// Your own game's proxy is simpler: see cloudflare-worker.js.

import { createProxyHandler } from "../src/proxy.js";
import gatehouse from "../stories/gatehouse.json" with { type: "json" };
import goblinCamp from "../stories/goblin-camp.json" with { type: "json" };
import tidyProfit from "../stories/tidy-profit.json" with { type: "json" };
import lighthouse from "../stories/lighthouse.json" with { type: "json" };

export const DEMO_STORIES = [gatehouse, goblinCamp, tidyProfit, lighthouse];

/** "https://a.example, https://b.example" -> ["https://a.example", "https://b.example"] */
export const parseOrigins = (value) => String(value ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);

let handle = null; // made on the first request, when the Worker's variables are available

export default {
  fetch(request, env) {
    handle ??= createProxyHandler({
      allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
      allowedStories: DEMO_STORIES,
      // Per address, per Worker instance: a first line of defence. The demo's 50-turn cap per tab and the
      // spending limit on the key are the others.
      rateLimit: { requests: 20, windowMs: 60_000 },
    });
    return handle(request, env);
  },
};
