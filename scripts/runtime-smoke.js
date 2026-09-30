// The proxy on Deno, Bun, and Node, served by each runtime's own HTTP server, with requests sent through it the way a
// browser game sends them. It uses the offline mock: no key, no Jev calls. CI runs it on Deno and Bun.
//
//   deno run --allow-net scripts/runtime-smoke.js
//   bun scripts/runtime-smoke.js
//   node scripts/runtime-smoke.js
import { createProxyHandler, toNodeListener, createProxyClient, createMockClient, persuasionQuestions, persuasionState, Game, Persuadable, VERSION } from "../src/index.js";
import gatehouse from "../stories/gatehouse.json" with { type: "json" };
import { harry } from "../examples/harry.js";

const runtime = globalThis.Deno ? `Deno ${Deno.version.deno}` : globalThis.Bun ? `Bun ${Bun.version}` : `Node ${process.version}`;
const MAX = 16_000;
const handle = createProxyHandler({ client: createMockClient(), allowedStories: [gatehouse], allowedCharacters: [harry], rateLimit: false, maxStateBytes: MAX });

// Serve it with the runtime's own server, on a free port on this machine.
let url, stop;
if (globalThis.Deno) {
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => handle(request));
  url = `http://127.0.0.1:${server.addr.port}/`;
  stop = () => server.shutdown();
} else if (globalThis.Bun) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handle(request) });
  url = `http://127.0.0.1:${server.port}/`;
  stop = () => server.stop(true);
} else {
  const { createServer } = await import("node:http");
  const server = createServer(toNodeListener(handle, { maxBytes: MAX }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/`;
  stop = () => new Promise((resolve) => server.close(resolve));
}

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` (${detail})` : ""}`);
};
const post = (body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });

try {
  const client = createProxyClient({ url, maxRetries: 0 });
  const turn = await new Game(gatehouse, client).turn("Chat with Harry");
  check(turn.debug?.source === "mock" && turn.text.length > 0, "a text adventure turn is judged through the proxy");
  const attempt = await new Persuadable(harry, { client }).attempt("Please, I'm honestly carrying medicine.");
  check(["convinced", "unconvinced", "offended"].includes(attempt.verdict), "a character's attempt is judged through the proxy", attempt.verdict);

  const stranger = { name: "Vesk", persona: "A bored clerk.", goal: "Stamp the form" };
  const refused = await post(JSON.stringify({ state: persuasionState(stranger, "hi"), questions: persuasionQuestions(stranger), honeytongue: VERSION }));
  check(refused.status === 403 && (await refused.json()).reason === "not-allowed", "a character it wasn't given is refused", String(refused.status));

  const big = await post("x".repeat(MAX + 1));
  check(big.status === 413, "a body over maxStateBytes is refused", String(big.status));

  const deep = `{"state":{"player_input":"hi"},"questions":{"q":{"type":"noul","instructions":"x","deep":${"[".repeat(5000)}${"]".repeat(5000)}}}}`;
  const nested = await post(deep);
  check(nested.status === 400, "deeply nested JSON is refused", String(nested.status));
} catch (err) {
  check(false, "the smoke test ran to the end", err?.stack ?? String(err));
} finally {
  await stop();
}

console.log(failed ? `\n${failed} check(s) failed on ${runtime}.` : `\nThe proxy works on ${runtime}.`);
if (failed) (globalThis.Deno ? Deno.exit : process.exit)(1);
