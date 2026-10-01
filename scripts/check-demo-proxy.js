// Checks a deployed demo proxy (examples/demo-worker.js) from the outside, the way the web demo uses it:
//
//   node scripts/check-demo-proxy.js https://api.honeytongue.dev/judge
//   node scripts/check-demo-proxy.js <url> --origin <page origin>     (act as another page; repeat for more)
//
// By default it acts as the demo's page, https://honeytongue.dev. It checks that the page may call the proxy; that
// other paths, other sites (the old https://tbrought.github.io included), other characters, oversized bodies, and
// histories longer than the library sends are refused; and that the proxy runs this checkout's Honeytongue version.
// Then it plays one Gatehouse turn and makes one attempt on the Phaser example's troll: two live Jev calls (about
// 2,100 tokens). The refusals cost nothing: they never reach Jev.
import { readFileSync } from "node:fs";
import { Game, Persuadable, createProxyClient, persuasionQuestions, persuasionState, VERSION } from "../src/index.js";
import { MAX_BYTES } from "../examples/demo-worker.js";
import { troll } from "../examples/phaser/character.js";

const args = process.argv.slice(2);
const url = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--origin");
const given = args.flatMap((a, i) => (a === "--origin" && args[i + 1] ? [args[i + 1]] : []));
const origins = given.length ? given : ["https://honeytongue.dev"];
if (!url) {
  console.error("Usage: node scripts/check-demo-proxy.js <proxy url> [--origin <page origin>]...");
  process.exit(1);
}

let failed = 0;
const report = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
};
const asPage = (from) => (u, init) => fetch(u, { ...init, headers: { ...init.headers, Origin: from } });
const json = { "Content-Type": "application/json" };

for (const origin of origins) {
  const preflight = await fetch(url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
  report(preflight.status === 204 && preflight.headers.get("Access-Control-Allow-Origin") === origin,
    `pages on ${origin} may call it`, `${preflight.status}, allow-origin ${preflight.headers.get("Access-Control-Allow-Origin") ?? "(none)"}`);
}
const origin = origins[0];

const root = new URL("/", url).href;
if (root !== new URL(url).href) {
  const other = await fetch(root, { method: "POST", headers: { ...json, Origin: origin }, body: "{}" });
  report(other.status === 404, "other paths answer 404, so the rate limiting rule sees every request", String(other.status));
}

for (const site of ["https://elsewhere.example", "https://tbrought.github.io"]) {
  const other = await fetch(url, { method: "POST", headers: { ...json, Origin: site }, body: "{}" });
  report(other.status === 403, `pages on ${site} are refused`, String(other.status));
}

// Its limits: a body over MAX_BYTES (this checkout's, which the deployed Worker should match), and more remembered
// attempts than the library sends (Tolly's memoryLength is 1,500 characters). Neither reaches Jev.
const huge = await fetch(url, { method: "POST", headers: { ...json, Origin: origin }, body: "x".repeat(MAX_BYTES + 1) });
report(huge.status === 413, `bodies over ${MAX_BYTES.toLocaleString("en")} bytes are refused`, String(huge.status));
const padded = { state: { ...persuasionState(troll, "Let me cross."), previous_attempts: Array.from({ length: 4 }, (_, i) => ({ said: `${i}`.repeat(450), outcome: "unconvinced" })) },
  questions: persuasionQuestions(troll), honeytongue: VERSION };
const long = await fetch(url, { method: "POST", headers: { ...json, Origin: origin }, body: JSON.stringify(padded) });
const longBody = await long.json().catch(() => ({}));
report(long.status === 403 && /memoryLength of 1500/.test(longBody.error ?? ""), "histories longer than the library sends are refused, naming the limit", `${long.status} ${longBody.error ?? ""}`.slice(0, 140));

const stranger = { name: "Vesk", persona: "A bored clerk.", goal: "Stamp the form" };
const client = createProxyClient({ url, maxRetries: 0, fetch: asPage(origin) });
const refusal = await client.ask(persuasionState(stranger, "Please stamp it."), persuasionQuestions(stranger)).then(() => null, (e) => e);
report(refusal?.status === 403 && refusal.reason === "not-allowed", "other characters are refused", refusal ? `${refusal.status} ${refusal.reason}` : "it answered");
if (refusal?.proxyVersion) report(refusal.proxyVersion === VERSION, "the proxy runs this checkout's version", `proxy ${refusal.proxyVersion}, here ${VERSION}`);

const story = JSON.parse(readFileSync(new URL("../stories/gatehouse.json", import.meta.url), "utf8"));
const game = new Game(story, client);
try {
  const result = await game.turn("Please let me through, I need to see my sick mother in the city.");
  const d = result.debug;
  report(d?.source === "jev", "a Gatehouse turn is judged by Jev", `source ${d?.source}, action ${d?.ranked?.[0]?.[0]}, verdict ${d?.verdict}, score ${d?.persuasion?.score?.toFixed(2)}`);
} catch (err) {
  report(false, "a Gatehouse turn is judged by Jev", `${err.status ?? ""} ${err.reason ?? ""} ${err.message}`.trim());
}

// The Phaser page's troll, judged on his own (one more live call).
try {
  const tolly = new Persuadable(troll, { client });
  tolly.learn("lonely");
  const r = await tolly.attempt("Please let me cross. I'll come back and keep you company, so you're never lonely again.");
  report(r.verdict !== undefined, "the Phaser example's troll is judged", `verdict ${r.verdict}, score ${r.score?.toFixed(2)}`);
} catch (err) {
  report(false, "the Phaser example's troll is judged", `${err.status ?? ""} ${err.reason ?? ""} ${err.message}`.trim());
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
