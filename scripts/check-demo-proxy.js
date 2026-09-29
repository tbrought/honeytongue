// Checks a deployed demo proxy (examples/demo-worker.js) from the outside, the way the web demo uses it:
//
//   node scripts/check-demo-proxy.js https://honeytongue-demo.<your-subdomain>.workers.dev
//   node scripts/check-demo-proxy.js <url> --origin https://tbrought.github.io     (the page origin to act as)
//
// It checks the preflight, that another site and another character are refused, that the proxy runs this
// checkout's Honeytongue version, and plays one Gatehouse turn, which is one live Jev call (about 1,300 tokens).
import { readFileSync } from "node:fs";
import { Game, createProxyClient, persuasionQuestions, persuasionState, VERSION } from "../src/index.js";

const args = process.argv.slice(2);
const url = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--origin");
const origin = args.includes("--origin") ? args[args.indexOf("--origin") + 1] : "https://tbrought.github.io";
if (!url) {
  console.error("Usage: node scripts/check-demo-proxy.js <proxy url> [--origin <page origin>]");
  process.exit(1);
}

let failed = 0;
const report = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
};
const asPage = (from) => (u, init) => fetch(u, { ...init, headers: { ...init.headers, Origin: from } });

const preflight = await fetch(url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
report(preflight.status === 204 && preflight.headers.get("Access-Control-Allow-Origin") === origin,
  `the demo's pages (${origin}) may call it`, `${preflight.status}, allow-origin ${preflight.headers.get("Access-Control-Allow-Origin") ?? "(none)"}`);

const elsewhere = await fetch(url, { method: "POST", headers: { Origin: "https://elsewhere.example", "Content-Type": "application/json" }, body: "{}" });
report(elsewhere.status === 403, "other sites are refused", String(elsewhere.status));

const stranger = { name: "Vesk", persona: "A bored clerk.", goal: "Stamp the form" };
const client = (from) => createProxyClient({ url, maxRetries: 0, fetch: asPage(from) });
const refusal = await client(origin).ask(persuasionState(stranger, "Please stamp it."), persuasionQuestions(stranger)).then(() => null, (e) => e);
report(refusal?.status === 403 && refusal.reason === "not-allowed", "other characters are refused", refusal ? `${refusal.status} ${refusal.reason}` : "it answered");
if (refusal?.proxyVersion) report(refusal.proxyVersion === VERSION, "the proxy runs this checkout's version", `proxy ${refusal.proxyVersion}, here ${VERSION}`);

const story = JSON.parse(readFileSync(new URL("../stories/gatehouse.json", import.meta.url), "utf8"));
const game = new Game(story, client(origin));
try {
  const result = await game.turn("Please let me through, I need to see my sick mother in the city.");
  const d = result.debug;
  report(d?.source === "jev", "a Gatehouse turn is judged by Jev", `source ${d?.source}, action ${d?.ranked?.[0]?.[0]}, verdict ${d?.verdict}, score ${d?.persuasion?.score?.toFixed(2)}`);
} catch (err) {
  report(false, "a Gatehouse turn is judged by Jev", `${err.status ?? ""} ${err.reason ?? ""} ${err.message}`.trim());
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
