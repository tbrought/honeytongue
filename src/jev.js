// Clients for TypeSafe's System One endpoint (the API behind Jev).
// Plain fetch, zero dependencies. Docs: https://docs.typesafe.ai/api
//
// createJevClient   -> server-side only, holds your API key
// createProxyClient -> browser-safe, talks to your own proxy (see proxy.js)

import { HoneytongueError } from "./persuasion.js";
import { VERSION } from "./version.js";

const DEFAULT_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-1.13.0"; // pinned so behaviour doesn't shift under you
const MAX_RETRY_WAIT = 10_000; // a Retry-After longer than this fails now instead of stalling the game
const env = globalThis.process?.env ?? {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A page, or a browser's Web Worker (which has no window). Workers on servers (Deno, Bun, Cloudflare) don't report a
// browser's "Mozilla/" user agent, so they still count as servers.
const inBrowser = () => (typeof window !== "undefined" && typeof window.document !== "undefined") ||
  (typeof globalThis.WorkerGlobalScope !== "undefined" && /^Mozilla\//.test(globalThis.navigator?.userAgent ?? ""));
const isTimeout = (err) => err?.name === "TimeoutError" || err?.name === "AbortError";

const httpError = (message, status, extra) => Object.assign(new HoneytongueError(message), { status }, extra);

/** How long to wait before retrying: the server's Retry-After if it sent one, else exponential backoff. */
function retryDelay(res, attempt) {
  const header = res.headers?.get?.("Retry-After")?.trim();
  const seconds = !header ? NaN : /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 500 * 2 ** attempt;
}

/**
 * A readable error for a failed response: what probably went wrong, then what the server said. A proxy's
 * `reason` (why it refused, or why Jev didn't answer) is kept on the error, with the versions it compared.
 */
async function failure(url, res, hints) {
  let detail = "";
  let why = {};
  try { detail = (await res.text()).trim(); } catch { /* body unreadable; the status is enough */ }
  try {
    const body = JSON.parse(detail);
    if (typeof body?.reason === "string") why = { reason: body.reason, proxyVersion: body.proxyVersion ?? null, requestVersion: body.requestVersion ?? null };
    detail = body?.error ?? detail;
  } catch { /* not JSON */ }
  if (typeof detail !== "string") detail = JSON.stringify(detail);
  if (detail.length > 300) detail = `${detail.slice(0, 300)}...`;
  const hint = hints.reasons?.[why.reason] ?? hints[res.status] ?? (res.status >= 500 ? hints[500] : null) ?? "Request failed.";
  return httpError(`${hint} (${res.status} from ${url}${detail ? `: ${detail}` : ""})`, res.status, why);
}

/**
 * POST JSON with a timeout, retrying network errors and the statuses `retryOn` accepts. `deadlineMs` bounds the whole
 * call, retries and waits included: each try gets at most what's left, and a retry that couldn't finish in time isn't made.
 */
async function postWithRetry(url, { headers, body, timeoutMs, maxRetries, retryOn, hints, fetchImpl, deadlineMs = Infinity }) {
  if (typeof fetchImpl !== "function") throw new HoneytongueError("No fetch() available here: pass { fetch } in the client options");
  const started = Date.now();
  const left = () => deadlineMs - (Date.now() - started);
  const outOfTime = () => new HoneytongueError(`Request to ${url} ran out of time: no answer within ${deadlineMs}ms, retries included`);
  for (let attempt = 0; ; attempt++) {
    const budget = Math.min(timeoutMs, left());
    if (budget <= 0) throw outOfTime();
    let res;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(budget),
      });
    } catch (err) {
      // A timeout already used the whole budget, so it isn't retried.
      if (isTimeout(err)) throw budget < timeoutMs ? outOfTime() : new HoneytongueError(`Request to ${url} timed out after ${timeoutMs}ms`);
      if (attempt < maxRetries && 500 * 2 ** attempt < left()) { await sleep(500 * 2 ** attempt); continue; }
      const reason = [err?.message, err?.cause?.message].filter(Boolean).join(": ");
      throw new HoneytongueError(`Request to ${url} failed: ${reason || "network error"}`);
    }
    if (!res.ok && retryOn(res.status) && attempt < maxRetries) {
      const wait = retryDelay(res, attempt);
      if (wait <= MAX_RETRY_WAIT && wait < left()) {
        await res.body?.cancel().catch(() => {});
        await sleep(wait);
        continue;
      }
    }
    if (!res.ok) throw await failure(url, res, hints);
    try {
      return await res.json();
    } catch (err) {
      if (isTimeout(err)) throw new HoneytongueError(`Request to ${url} timed out after ${timeoutMs}ms`);
      throw new HoneytongueError(`${url} sent a response that isn't JSON`);
    }
  }
}

/**
 * Where a set of answers came from, "jev" or "mock", so debug views can say which one judged.
 * Kept under a symbol so it can't clash with a question id and never ends up in JSON.
 */
export const SOURCE = Symbol.for("honeytongue.source");
const from = (answers, source) => {
  if (source === "jev" || source === "mock") answers[SOURCE] = source;
  return answers;
};

const FIELD = { choice: "choice", score: "score", noul: "noul" };

/** Check the response has a well-formed answer for every question, so shape surprises fail loudly here. */
function readAnswers(data, questions, url) {
  const unexpected = (what) =>
    new HoneytongueError(`Unexpected response from ${url}: ${what}. Got: ${JSON.stringify(data)?.slice(0, 300)}`);
  const answers = data?.answers;
  if (!answers || typeof answers !== "object") throw unexpected('no "answers" object');
  for (const [id, question] of Object.entries(questions ?? {})) {
    const answer = answers[id];
    if (!answer || typeof answer !== "object") throw unexpected(`no answer for question "${id}"`);
    const field = FIELD[question?.type];
    const valid = field === "choice" ? typeof answer.choice === "string" : !field || Number.isFinite(answer[field]);
    if (!valid) throw unexpected(`the answer for "${id}" has no valid "${field}"`);
  }
  return answers;
}

const JEV_HINTS = {
  401: "TypeSafe rejected the API key. Check TYPESAFE_API_KEY (or the apiKey option).",
  402: "Your TypeSafe prepaid credit has run out (a billing_error). Top up your balance, then try again.",
  422: "TypeSafe says the request is invalid.",
  429: "TypeSafe's rate limit was hit. Slow down, or try again shortly.",
  529: "TypeSafe is overloaded right now. Try again shortly.",
  500: "TypeSafe had a server error. Try again shortly.",
};

export function createJevClient({
  apiKey = env.TYPESAFE_API_KEY,
  url = env.TYPESAFE_URL || DEFAULT_URL,
  model,  // the option, then TYPESAFE_MODEL, then DEFAULT_MODEL
  timeoutMs = 15000,
  maxRetries = 3,
  deadlineMs = Infinity, // the whole call, retries and waits included; none by default
  dangerouslyAllowBrowser = false,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  if (inBrowser() && !dangerouslyAllowBrowser) {
    throw new HoneytongueError(
      "createJevClient() would expose your API key in the browser. " +
      "Use createProxyClient() with a small server running createProxyHandler() instead."
    );
  }
  const key = typeof apiKey === "string" ? apiKey.trim() : apiKey;
  if (!key) throw new HoneytongueError("Missing TypeSafe API key: set TYPESAFE_API_KEY or pass { apiKey }");
  // Checked here because fetch() quotes invalid header values, key included, in its error messages.
  if (typeof key !== "string" || /[\s\x00-\x1f\x7f]/.test(key)) {
    throw new HoneytongueError("The TypeSafe API key contains spaces, line breaks, or hidden characters. Set it again, copying only the key.");
  }
  if (/^["'].*["']$/.test(key)) throw new HoneytongueError("The TypeSafe API key is wrapped in quote marks. Set it again without them.");
  if (!(deadlineMs > 0)) throw new HoneytongueError(`deadlineMs must be a number of milliseconds above 0 (or leave it out for none), got ${String(deadlineMs)}`);
  const chosenModel = [model, env.TYPESAFE_MODEL].map((m) => (typeof m === "string" ? m.trim() : m)).find(Boolean) ?? DEFAULT_MODEL;
  if (typeof chosenModel !== "string") throw new HoneytongueError(`The Jev model must be a string like "${DEFAULT_MODEL}", got ${String(chosenModel)}`);
  const redact = (err) => {
    if (err instanceof Error) err.message = err.message.replaceAll(key, "[api key]");
    return err;
  };

  return {
    async ask(state, questions) {
      try {
        const data = await postWithRetry(url, {
          headers: { Authorization: `Bearer ${key}` },
          body: { model: chosenModel, state, questions },
          timeoutMs, maxRetries, fetchImpl, deadlineMs,
          retryOn: (status) => status === 429 || status >= 500,
          hints: JEV_HINTS,
        });
        return from(readAnswers(data, questions, url), "jev");
      } catch (err) {
        throw redact(err);
      }
    },
  };
}

const proxyHints = () => ({
  400: "Your proxy rejected the request.",
  403: `Your proxy doesn't accept requests from this page. Add ${globalThis.location?.origin ?? "this page's origin"} to allowedOrigins in createProxyHandler().`,
  404: "Nothing was found at the proxy URL. Check the { url } you passed to createProxyClient().",
  405: "The proxy URL doesn't accept POST requests. Check the { url } you passed to createProxyClient().",
  413: "The request was too big for your proxy. Raise maxStateBytes or maxInputLength in createProxyHandler().",
  429: "Too many requests to your proxy. Wait a moment and try again.",
  500: "Your proxy couldn't get an answer from Jev. Check the proxy's logs and its TYPESAFE_API_KEY secret.",
  reasons: {
    version: "Your proxy runs a different Honeytongue version from this page. Deploy them together.",
    "not-allowed": "Your proxy only judges the stories and characters in its allowedStories and allowedCharacters.",
    state: "Your proxy refused this request's state, which isn't what Honeytongue sends.",
    unavailable: "Your proxy can't use Jev: check its TYPESAFE_API_KEY secret and your TypeSafe credit.",
  },
});

/** Browser-safe client that sends requests to your own proxy endpoint. */
export function createProxyClient({ url, headers = {}, timeoutMs = 20000, maxRetries = 2, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!url) throw new HoneytongueError("createProxyClient needs the { url } of your proxy");
  return {
    async ask(state, questions) {
      const data = await postWithRetry(url, {
        // The version lets a proxy with allowedStories or allowedCharacters explain a mismatch.
        headers, body: { state, questions, honeytongue: VERSION }, timeoutMs, maxRetries, fetchImpl,
        // The proxy already retries Jev, so only its own rate limit and platform hiccups are retried here.
        retryOn: (status) => status === 429 || status === 503,
        hints: proxyHints(),
      });
      // The proxy says which one answered, per reply: what's behind it can change between calls.
      return from(readAnswers(data, questions, url), data.source);
    },
  };
}
