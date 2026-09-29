// A tiny server-side handler that keeps your TypeSafe key off players' machines.
// Standard Request -> Response, so it runs on Cloudflare Workers, Vercel,
// Deno, Bun, and Node 22+ (see examples/node-proxy.js).
//
//   export default { fetch: createProxyHandler({ allowedOrigins: ["https://mygame.com"], allowedCharacters: [harry] }) };
//
// On Cloudflare Workers the key is read from the TYPESAFE_API_KEY secret automatically.
//
// It needs allowedStories and/or allowedCharacters, so it only judges your own game's requests (see src/guard.js):
// without them it would answer any Jev question on your key. dangerouslyAllowAnyRequest: true turns that off, for
// local tools only. The proxy never logs what players type. On a plain Node server, wrap it in toNodeListener().

import { createJevClient, SOURCE } from "./jev.js";
import { HoneytongueError } from "./persuasion.js";
import { createRequestGuard } from "./guard.js";

const ALLOWED_TYPES = new Set(["choice", "score", "noul"]);
const MAX_TRACKED_IPS = 10_000;
// Honeytongue's requests nest about 5 levels deep; anything far deeper is refused before it's examined.
const MAX_DEPTH = 32;
// The whole time the proxy may spend on Jev, retries included: shorter than a browser client's usual timeout (the
// demo's is 15 seconds), so the proxy never keeps paying for an answer the page has stopped waiting for.
const DEADLINE_MS = 12_000;
const DEFAULT_MAX_BYTES = 16_000;

/** A request body's bytes, read as a stream and abandoned past `max` bytes (null), whatever Content-Length said. */
async function readBody(request, max) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}

/** Whether a parsed JSON value nests deeper than `limit` levels (checked without recursion). */
function tooDeep(value, limit) {
  const stack = [[value, 1]];
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (v === null || typeof v !== "object") continue;
    if (depth > limit) return true;
    for (const child of Object.values(v)) stack.push([child, depth + 1]);
  }
  return false;
}

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
  maxStateBytes = DEFAULT_MAX_BYTES, // limit on the whole request body, in bytes
  maxInputLength = 500,
  rateLimit = { requests: 30, windowMs: 60_000 }, // per IP, per server instance; false turns it off
  clientIp = defaultClientIp,  // (request, env) => string, for hosts that report the address differently
  allowedStories,              // e.g. [story]: only judge the requests these stories' scenes send
  allowedCharacters,           // e.g. [character]: only judge persuasion attempts on these characters
  dangerouslyAllowAnyRequest = false, // forward any well-formed request: for local tools only, never a public proxy
} = {}) {
  if (rateLimit && !(Number.isInteger(rateLimit.requests) && rateLimit.requests > 0 && rateLimit.windowMs > 0)) {
    throw new HoneytongueError("createProxyHandler: rateLimit must be { requests: whole number above 0, windowMs: above 0 }, or false");
  }
  const guard = createRequestGuard({ allowedStories, allowedCharacters });
  if (!guard && dangerouslyAllowAnyRequest !== true) {
    throw new HoneytongueError(
      "createProxyHandler needs allowedStories and/or allowedCharacters: the stories and characters your game judges, " +
      "so the proxy only answers your game's requests. Without them, anyone who finds the proxy could use your API key " +
      "for any Jev question. For a local tool that must forward anything, pass dangerouslyAllowAnyRequest: true.",
    );
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

    // Check the declared size before reading anything, then stop reading as soon as the real size is too big.
    const tooLarge = { error: `Request too large: over this proxy's maxStateBytes of ${maxStateBytes} bytes` };
    if (Number(request.headers.get("Content-Length")) > maxStateBytes) return reply(413, tooLarge, origin);
    const bytes = await readBody(request, maxStateBytes);
    if (!bytes) return reply(413, tooLarge, origin);

    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply(400, { error: "Body must be JSON" }, origin); }
    if (tooDeep(body, MAX_DEPTH)) return reply(400, { error: `Body is nested more than ${MAX_DEPTH} levels deep` }, origin);

    const { state, questions } = body ?? {};
    const validState = typeof state === "string" ? state.length > 0 : state !== null && typeof state === "object";
    const qs = questions && typeof questions === "object" && !Array.isArray(questions) ? Object.values(questions) : [];
    if (!validState || !qs.length || qs.length > maxQuestions || qs.some((q) => !ALLOWED_TYPES.has(q?.type))) {
      return reply(400, { error: `Send { state, questions } with 1 to ${maxQuestions} choice, score, or noul questions` }, origin);
    }
    if (typeof state.player_input === "string" && state.player_input.length > maxInputLength) {
      return reply(413, { error: `player_input is longer than ${maxInputLength} characters` }, origin);
    }
    const refused = guard?.check(body);
    if (refused) return reply(403, refused, origin);

    try {
      // Few retries, and one deadline for all of them, so the browser gets an answer before its own timeout.
      // Players can't pick the model: it comes from you, never from the request.
      jev ??= createJevClient({
        apiKey: apiKey ?? workerEnv?.TYPESAFE_API_KEY,
        model: model || workerEnv?.TYPESAFE_MODEL,
        timeoutMs: 10_000,
        maxRetries: 2,
        deadlineMs: DEADLINE_MS,
      });
    } catch (err) {
      console.error(`honeytongue proxy: ${err.message}`); // a setup mistake, like a missing key: nothing from the request
      return reply(502, { error: "The proxy can't use Jev right now.", reason: "unavailable" }, origin);
    }
    try {
      // Only a client passed in can be the mock: without one, a missing key is an error, never a quiet fallback.
      const answers = await jev.ask(state, questions);
      return reply(200, { answers, source: answers?.[SOURCE] }, origin);
    } catch (err) {
      // Only the status: an error's message can quote Jev's reply, which can quote what the player typed.
      console.error(`honeytongue proxy: no answer from Jev (${err?.status ?? err?.name ?? "error"})`);
      // The reason tells the page what to do: "busy" and "error" may pass, "unavailable" (a bad key, or no
      // credit left; TypeSafe doesn't document which status that is) won't until you fix it.
      const reason = err?.status === 429 || err?.status === 529 ? "busy" : [401, 402, 403].includes(err?.status) ? "unavailable" : "error";
      const error = { busy: "Jev is busy right now. Try again in a moment.", unavailable: "The proxy can't use Jev right now.",
        error: "The proxy couldn't get an answer from Jev." }[reason];
      return reply(502, { error, reason }, origin);
    }
  };
}

/**
 * A Node http listener for a handler made by createProxyHandler: http.createServer(toNodeListener(handle)).
 * The body is read as a stream and refused past `maxBytes` (match the handler's maxStateBytes). The handler's second
 * argument is `env` plus `remoteAddress`, the socket's address, which a `clientIp` option can use when nothing sits in
 * front of the server. No node: imports, so this module still loads anywhere.
 */
export function toNodeListener(handle, { maxBytes = DEFAULT_MAX_BYTES, env = {} } = {}) {
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  return async function listener(req, res) {
    try {
      const chunks = [];
      let size = 0;
      if (!["GET", "HEAD"].includes(req.method)) {
        for await (const chunk of req) {
          size += chunk.byteLength;
          // Stop reading at once; the connection closes after the reply rather than draining the rest.
          if (size > maxBytes) return send(res, 413, { error: `Request too large: over ${maxBytes} bytes` }, { Connection: "close" });
          chunks.push(chunk);
        }
      }
      const body = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) { body.set(chunk, at); at += chunk.byteLength; }
      const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, {
        method: req.method,
        headers: Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]),
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      });
      const response = await handle(request, { ...env, remoteAddress: req.socket?.remoteAddress });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(new Uint8Array(await response.arrayBuffer()));
    } catch (err) {
      // The error's name only: a message could quote the request.
      console.error(`honeytongue proxy: unexpected error (${err?.name ?? "error"})`);
      if (!res.headersSent) send(res, 500, { error: "Proxy error" });
      else res.end();
    }
  };
}
