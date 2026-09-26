// A tiny server-side handler that keeps your TypeSafe key off players' machines.
// Standard Request -> Response, so it runs on Cloudflare Workers, Vercel,
// Deno, Bun, and Node 18+ (see examples/node-proxy.js).
//
//   export default { fetch: createProxyHandler({ allowedOrigins: ["https://mygame.com"] }) };
//
// On Cloudflare Workers the key is read from the TYPESAFE_API_KEY secret automatically.

import { createJevClient, SOURCE } from "./jev.js";
import { HoneytongueError } from "./persuasion.js";

const ALLOWED_TYPES = new Set(["choice", "score", "noul"]);
const MAX_TRACKED_IPS = 10_000;

/**
 * The address to rate-limit by. CF-Connecting-IP is only trusted on Cloudflare (where requests
 * carry `request.cf`), because anywhere else a client could send it themselves. Otherwise the
 * last X-Forwarded-For entry, which is the one added by your host's own proxy.
 */
function defaultClientIp(request) {
  if (request.cf) return request.headers.get("CF-Connecting-IP") ?? "unknown";
  return request.headers.get("X-Forwarded-For")?.split(",").pop().trim() || "unknown";
}

export function createProxyHandler({
  apiKey,
  model,                       // Jev model; else the TYPESAFE_MODEL variable; else the pinned default
  client,                      // optional: inject a client (useful for tests and offline development)
  allowedOrigins = [],         // e.g. ["https://mygame.example"]; same-origin requests are always allowed
  maxQuestions = 6,            // the engine sends 4 (action, persuasion, threats, insults)
  maxStateBytes = 16_000,      // limit on the whole request body
  maxInputLength = 500,
  rateLimit = { requests: 30, windowMs: 60_000 }, // per IP, per server instance; false turns it off
  clientIp = defaultClientIp,  // (request, env) => string, for hosts that report the address differently
} = {}) {
  if (rateLimit && !(Number.isInteger(rateLimit.requests) && rateLimit.requests > 0 && rateLimit.windowMs > 0)) {
    throw new HoneytongueError("createProxyHandler: rateLimit must be { requests: whole number above 0, windowMs: above 0 }, or false");
  }
  let jev = client;
  const hits = new Map();

  const sameOrigin = (request, origin) => {
    try { return new URL(request.url).origin === origin; } catch { return false; }
  };

  const cors = (origin) =>
    origin && allowedOrigins.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" }
      : {};

  const reply = (status, body, origin, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin), ...headers } });

  /** Milliseconds until this address may call again, or 0 if it may call now. */
  function wait(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < rateLimit.windowMs);
    recent.push(now);
    // Only the latest requests + 1 timestamps can affect the answer, so that's all we keep.
    const kept = recent.slice(-(rateLimit.requests + 1));
    hits.set(ip, kept);
    if (hits.size > MAX_TRACKED_IPS) {
      for (const [key, times] of hits) if (now - times[times.length - 1] >= rateLimit.windowMs) hits.delete(key);
      if (hits.size > MAX_TRACKED_IPS) hits.clear(); // still full of active addresses: start over
    }
    if (recent.length <= rateLimit.requests) return 0;
    return kept[kept.length - rateLimit.requests] + rateLimit.windowMs - now;
  }

  return async function handle(request, workerEnv) {
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins.includes(origin) && !sameOrigin(request, origin)) {
      return reply(403, { error: "Origin not allowed" });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return reply(405, { error: "Use POST" }, origin);

    if (rateLimit) {
      const ms = wait(String(clientIp(request, workerEnv) ?? "unknown"));
      if (ms > 0) return reply(429, { error: "Too many requests, slow down" }, origin, { "Retry-After": String(Math.ceil(ms / 1000)) });
    }

    // Check the declared size before reading anything, then the real size in bytes.
    if (Number(request.headers.get("Content-Length")) > maxStateBytes) return reply(413, { error: "Request too large" }, origin);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > maxStateBytes) return reply(413, { error: "Request too large" }, origin);

    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply(400, { error: "Body must be JSON" }, origin); }

    const { state, questions } = body ?? {};
    const validState = typeof state === "string" ? state.length > 0 : state !== null && typeof state === "object";
    const qs = questions && typeof questions === "object" && !Array.isArray(questions) ? Object.values(questions) : [];
    if (!validState || !qs.length || qs.length > maxQuestions || qs.some((q) => !ALLOWED_TYPES.has(q?.type))) {
      return reply(400, { error: `Send { state, questions } with 1 to ${maxQuestions} choice, score, or noul questions` }, origin);
    }
    if (typeof state.player_input === "string" && state.player_input.length > maxInputLength) {
      return reply(413, { error: `player_input is longer than ${maxInputLength} characters` }, origin);
    }

    try {
      // Few retries and a short timeout, so the browser gets an answer before its own timeout.
      // Players can't pick the model: it comes from you, never from the request.
      jev ??= createJevClient({
        apiKey: apiKey ?? workerEnv?.TYPESAFE_API_KEY,
        model: model || workerEnv?.TYPESAFE_MODEL,
        timeoutMs: 10_000,
        maxRetries: 2,
      });
      // Only a client passed in can be the mock: without one, a missing key is an error, never a quiet fallback.
      const answers = await jev.ask(state, questions);
      return reply(200, { answers, source: answers?.[SOURCE] }, origin);
    } catch (err) {
      console.error("honeytongue proxy:", err);
      const busy = err?.status === 429 || err?.status === 529;
      return reply(502, { error: busy ? "Jev is busy right now. Try again in a moment." : "The proxy couldn't get an answer from Jev." }, origin);
    }
  };
}
