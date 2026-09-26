// The proxy on plain Node, for local development or any Node host.
//
//   npm run proxy                      (uses the offline mock if TYPESAFE_API_KEY isn't set)
//   PORT=9000 npm run proxy            (bash)    $env:PORT=9000; npm run proxy   (PowerShell)
//
// Then point createProxyClient({ url: "http://localhost:8787" }) at it.
// Node's http server speaks IncomingMessage, not Request, so this file converts between them.

import { createServer } from "node:http";
import { createProxyHandler, createMockClient } from "../src/index.js";

const port = Number(process.env.PORT ?? 8787);
const useMock = !process.env.TYPESAFE_API_KEY;

const handle = createProxyHandler({
  // Pages allowed to call this proxy. Add your game's address when you serve it from somewhere else.
  allowedOrigins: ["http://localhost:8000", "http://127.0.0.1:8000"],
  client: useMock ? createMockClient() : undefined,
  // Nothing sits in front of this server, so use the socket's address, not a header a client could forge.
  clientIp: (request, env) => env.remoteAddress,
});

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://${req.headers.host ?? `localhost:${port}`}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request, { remoteAddress: req.socket.remoteAddress });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error("node-proxy:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Proxy error" }));
  }
}).listen(port, () => {
  console.log(`Honeytongue proxy on http://localhost:${port} (${useMock ? "offline mock" : "Jev"})`);
});
