// The proxy on plain Node, for local development or any Node host.
//
//   npm run proxy                      (uses the offline mock if TYPESAFE_API_KEY isn't set)
//   PORT=9000 npm run proxy            (bash)    $env:PORT=9000; npm run proxy   (PowerShell)
//
// Then point createProxyClient({ url: "http://127.0.0.1:8787" }) at it. It listens on this machine only
// (127.0.0.1), and only judges the demo scenes and examples/browser.html's character. In your own project, import
// from "honeytongue/proxy" and allow your own stories or characters.

import { createServer } from "node:http";
import { createProxyHandler, toNodeListener } from "../src/proxy.js";
import { createMockClient } from "../src/mock.js";
import gatehouse from "../stories/gatehouse.json" with { type: "json" };
import goblinCamp from "../stories/goblin-camp.json" with { type: "json" };
import tidyProfit from "../stories/tidy-profit.json" with { type: "json" };
import lighthouse from "../stories/lighthouse.json" with { type: "json" };
import { harry } from "./harry.js";

const port = Number(process.env.PORT ?? 8787);
const useMock = !process.env.TYPESAFE_API_KEY;
const maxStateBytes = 16_000;

const handle = createProxyHandler({
  // Pages allowed to call this proxy. Add your game's address when you serve it from somewhere else.
  allowedOrigins: ["http://localhost:8000", "http://127.0.0.1:8000"],
  // Only these stories' and characters' requests, so nobody can use your key for other Jev questions.
  allowedStories: [gatehouse, goblinCamp, tidyProfit, lighthouse],
  allowedCharacters: [harry],
  client: useMock ? createMockClient() : undefined,
  maxStateBytes,
  // Nothing sits in front of this server, so use the socket's address, not a header a client could forge.
  clientIp: (request, env) => env.remoteAddress,
});

// toNodeListener turns Node's request into a standard Request, refusing bodies over the limit as they arrive.
createServer(toNodeListener(handle, { maxBytes: maxStateBytes })).listen(port, "127.0.0.1", () => {
  console.log(`Honeytongue proxy on http://127.0.0.1:${port} (${useMock ? "offline mock" : "Jev"})`);
});
