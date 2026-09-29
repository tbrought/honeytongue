// Records live Jev calls for measurement: each response, its latency, and its token usage, as JSON lines in
// live-runs/ (git-ignored). It wraps the fetch that createJevClient uses, and never looks at request headers,
// so the API key can't end up on disk. A running token total survives between runs, and calls stop once it
// passes BUDGET.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createJevClient } from "../src/jev.js";

export const BUDGET = 3_000_000; // per phase (3M, as for Phase G; Demo polish uses it for the alpha.8 rerun): archive live-runs/ledger.json at the start of each phase to reset it
const dir = new URL("../live-runs/", import.meta.url);
const ledgerFile = new URL("ledger.json", dir);
const callsFile = new URL("calls.jsonl", dir);

export function readLedger() {
  try {
    return JSON.parse(readFileSync(ledgerFile, "utf8"));
  } catch {
    return { calls: 0, tokens: 0, callsWithoutUsage: 0 };
  }
}

/** Tokens from a response's `usage`, whatever its exact shape. Null when it has no token counts. */
export function tokensIn(usage) {
  if (Number.isFinite(usage)) return usage;
  if (!usage || typeof usage !== "object") return null;
  for (const key of ["total_tokens", "totalTokens", "total", "tokens"]) if (Number.isFinite(usage[key])) return usage[key];
  const parts = Object.entries(usage).filter(([k, v]) => /token|input|output|prompt|completion/i.test(k) && Number.isFinite(v));
  return parts.length ? parts.reduce((sum, [, v]) => sum + v, 0) : null;
}

/** A fetch that records every call. `label` is a string or a function returning one (e.g. the current suite). */
export function recordingFetch(label, sink = []) {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  const redact = (text) => (key ? text.replaceAll(key, "[api key]") : text);
  return async (url, init) => {
    const before = readLedger();
    if (before.tokens > BUDGET) {
      throw new Error(`Budget guard: ${before.tokens} tokens used, over the ${BUDGET} limit. Stopping before this call.`);
    }
    const started = performance.now();
    const res = await globalThis.fetch(url, init);
    const text = redact(await res.clone().text());
    const ms = Math.round(performance.now() - started);
    let body;
    try { body = JSON.parse(text); } catch { body = { unparsed: text.slice(0, 1000) }; }
    const tokens = tokensIn(body?.usage);
    const name = typeof label === "function" ? label() : label;

    const ledger = readLedger();
    ledger.calls++;
    ledger.tokens += tokens ?? 0;
    if (tokens === null) ledger.callsWithoutUsage++;
    mkdirSync(dir, { recursive: true });
    writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
    // The request body is the state and questions; the headers (with the key) are deliberately left out.
    appendFileSync(callsFile, JSON.stringify({ at: new Date().toISOString(), label: name, status: res.status, ms, tokens,
      usage: body?.usage ?? null, model: body?.model ?? null, request: JSON.parse(init.body), response: body }) + "\n");
    sink.push({ label: name, status: res.status, ms, tokens });
    return res;
  };
}

/** A Jev client that records its calls. Retries (429, 5xx) are recorded as separate calls. */
export function liveClient(label, sink) {
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY isn't set in this process.");
  return createJevClient({ fetch: recordingFetch(label, sink) });
}

export const median = (xs) => percentile(xs, 50);
export function percentile(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const sd = (xs) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));

/** One line per label: calls, tokens (median, p95, total), latency (median, p95). */
export function summarize(sink) {
  const groups = new Map(); // by the label's first word: "engine", "standalone", ...
  for (const call of sink) {
    const kind = call.label.split(" ")[0];
    groups.set(kind, [...(groups.get(kind) ?? []), call]);
  }
  const lines = [];
  for (const [label, calls] of groups) {
    const tokens = calls.map((c) => c.tokens).filter(Number.isFinite);
    const ms = calls.map((c) => c.ms);
    lines.push(`${label}: ${calls.length} calls (${calls.filter((c) => c.status !== 200).length} not 200), ` +
      `tokens median ${median(tokens)} p95 ${percentile(tokens, 95)} total ${tokens.reduce((a, b) => a + b, 0)}, ` +
      `latency median ${median(ms)} ms p95 ${percentile(ms, 95)} ms`);
  }
  const ledger = readLedger();
  lines.push(`Running total: ${ledger.calls} calls, ${ledger.tokens} tokens${ledger.callsWithoutUsage ? ` (${ledger.callsWithoutUsage} calls reported no usage)` : ""}`);
  return lines.join("\n");
}
