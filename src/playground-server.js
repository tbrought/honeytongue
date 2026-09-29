// The local character playground: `npx honeytongue playground`.
// Serves docs/playground on 127.0.0.1 and judges with the developer's own TYPESAFE_API_KEY, which stays in
// this process: the page only ever talks to this server. Without a key it judges with the offline mock.
// Node only, like cli.js (its only user), so it isn't exported from index.js.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import process from "node:process";
import { createProxyHandler } from "./proxy.js";
import { createJevClient } from "./jev.js";
import { createMockClient } from "./mock.js";

const root = new URL("../", import.meta.url);
export const DEFAULT_PORT = 4747;
export const JUDGE_PATH = "/api/judge";
export const TOKEN_HEADER = "X-Honeytongue-Token";

// Every file the page may load: its path on this server, and where it lives in the package. The page asks for
// the library at ../play/lib/, where GitHub Pages keeps its copies; here it gets the originals in src/.
const FILES = {
  "/playground/": "docs/playground/index.html",
  "/playground/app.js": "docs/playground/app.js",
  "/playground/designer.js": "docs/playground/designer.js",
  "/playground/playground.css": "docs/playground/playground.css",
  "/style.css": "docs/style.css",
  "/theme.js": "docs/theme.js",
  "/play/lib/persuasion.js": "src/persuasion.js",
  "/play/lib/jev.js": "src/jev.js",
  "/play/lib/mock.js": "src/mock.js",
  "/play/lib/version.js": "src/version.js",
  "/play/lib/characters.json": "stories/characters.json",
  // The logo, as the page's favicon, touch icon, and header image.
  "/assets/honeytongue-logo-32.png": "docs/assets/honeytongue-logo-32.png",
  "/assets/honeytongue-logo-192.png": "docs/assets/honeytongue-logo-192.png",
  // The web fonts docs/style.css loads: every file in docs/assets/fonts, as shipped in the package.
  ...Object.fromEntries(readdirSync(new URL("../docs/assets/fonts/", import.meta.url))
    .filter((f) => f.endsWith(".woff2")).map((f) => [`/assets/fonts/${f}`, `docs/assets/fonts/${f}`])),
};
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json; charset=utf-8", woff2: "font/woff2", png: "image/png" };
const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  // As strict as the page's own policy (no inline scripts or styles), and only this server to talk to. A header can
  // also forbid framing, which a page's meta tag can't.
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; " +
    "font-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
};
// The page's placeholder for how to reach this server. Empty on GitHub Pages, which means "preview only".
const LOCAL_META = '<meta name="honeytongue-local" content="">';

const escapeAttribute = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const sameToken = (given, token) => {
  const a = Buffer.from(String(given ?? "")), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The command that opens a URL in the default browser. On Windows, `start` runs through cmd, with its special characters escaped. */
export function openCommand(url, platform = process.platform) {
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", '""', url.replace(/[&^|<>()%!"]/g, "^$&")], options: { windowsVerbatimArguments: true } };
  }
  return { command: platform === "darwin" ? "open" : "xdg-open", args: [url], options: {} };
}

function openBrowser(url, onFail) {
  const { command, args, options } = openCommand(url);
  try {
    const child = spawn(command, args, { ...options, stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", onFail);
    child.on("exit", (code) => code && onFail());
    child.unref();
  } catch {
    onFail();
  }
}

/**
 * Start the playground server on 127.0.0.1. Resolves to { url, port, address, judge, close }.
 * `judge` is "jev" when an API key is set (and `mock` isn't), else "mock". `fetch` is passed to the Jev client.
 * With `fallback`, a busy port is swapped for any free one.
 */
export async function startPlayground({
  port = DEFAULT_PORT,
  fallback = false,
  apiKey = process.env.TYPESAFE_API_KEY,
  mock = false,
  model,
  fetch,
} = {}) {
  const key = mock ? "" : String(apiKey ?? "").trim();
  const judge = key ? "jev" : "mock";
  // Built now, so a malformed key fails here with a readable message rather than on the first line tried.
  const client = key ? createJevClient({ apiKey: key, model, fetch, timeoutMs: 15_000, maxRetries: 2 }) : createMockClient();
  const handle = createProxyHandler({ client, rateLimit: false });
  const token = randomBytes(24).toString("base64url");
  const local = JSON.stringify({ url: JUDGE_PATH, token, judge });
  let hosts = new Set();

  async function respond(req) {
    // Only this machine's names for this server. A web page that points its own domain at 127.0.0.1
    // (DNS rebinding) sends its own Host, so it's turned away here.
    if (!hosts.has(req.headers.host)) return { status: 403, type: TYPES.json, body: JSON.stringify({ error: "Unknown host" }) };
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === JUDGE_PATH) return judgeRequest(req);
    if (req.method !== "GET" && req.method !== "HEAD") return { status: 405, type: TYPES.json, body: JSON.stringify({ error: "Use GET" }) };
    if (path === "/" || path === "/playground") return { status: 302, headers: { Location: "/playground/" } };
    const file = FILES[path];
    if (!file) return { status: 404, type: TYPES.json, body: JSON.stringify({ error: "Not found" }) };
    // Bytes as they are (fonts are binary); only the page itself is edited, to say how to reach this server.
    let body = await readFile(new URL(file, root));
    if (path === "/playground/") body = body.toString("utf8").replace(LOCAL_META, `<meta name="honeytongue-local" content="${escapeAttribute(local)}">`);
    return { status: 200, type: TYPES[file.split(".").pop()], body };
  }

  async function judgeRequest(req) {
    // Same-origin only (the proxy handler checks Origin), and only for the page this server handed out.
    if (req.method === "POST" && !sameToken(req.headers[TOKEN_HEADER.toLowerCase()], token)) {
      return { status: 403, type: TYPES.json, body: JSON.stringify({ error: "Reload the playground page: this server has restarted." }) };
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request);
    return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) };
  }

  const server = createServer(async (req, res) => {
    try {
      const { status, type, headers = {}, body } = await respond(req);
      res.writeHead(status, { ...HEADERS, ...(type && { "Content-Type": type }), ...headers });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (err) {
      console.error("honeytongue playground:", err);
      res.writeHead(500, { ...HEADERS, "Content-Type": TYPES.json });
      res.end(JSON.stringify({ error: "Playground server error" }));
    }
  });

  const listen = (p) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(p, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  try {
    await listen(port);
  } catch (err) {
    if (!(fallback && err.code === "EADDRINUSE")) throw err;
    await listen(0);
  }
  const actual = server.address().port;
  hosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
  return {
    url: `http://127.0.0.1:${actual}/playground/`,
    port: actual,
    address: server.address().address,
    judge,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }),
  };
}

const USAGE = `Usage: npx honeytongue playground [--port <number>] [--mock] [--no-open]

  --port <number>  Port on 127.0.0.1 (default ${DEFAULT_PORT}, or any free port if that's taken)
  --mock           Judge with the offline mock even if TYPESAFE_API_KEY is set
  --no-open        Don't open a browser; just print the address`;

/** `npx honeytongue playground [options]`, from cli.js. */
export async function runPlayground(args, { log = console.log, error = console.error, open = openBrowser } = {}) {
  const options = { fallback: true, mock: false };
  let openPage = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--mock") options.mock = true;
    else if (arg === "--no-open") openPage = false;
    else if (arg === "--port") {
      const port = Number(args[++i]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) return fail(`--port needs a number from 0 to 65535, got ${args[i] ?? "nothing"}`);
      Object.assign(options, { port, fallback: false });
    } else if (arg === "--help" || arg === "-h") { log(USAGE); return null; }
    else return fail(`Unknown option ${arg}`);
  }

  let playground;
  try {
    playground = await startPlayground(options);
  } catch (err) {
    if (err.code === "EADDRINUSE") return fail(`Port ${options.port} is already in use. Pick another with --port, or leave it out to use any free port.`, false);
    return fail(`Couldn't start the playground: ${err.message}`, false);
  }
  log(`Honeytongue playground: ${playground.url}`);
  log(playground.judge === "jev"
    ? "Judging with Jev, using TYPESAFE_API_KEY from your environment. Each line you try is one API call."
    : `Judging with the offline mock (a keyword preview), because ${options.mock ? "--mock is set" : "TYPESAFE_API_KEY isn't set"}.`);
  log("Press Ctrl+C to stop.");
  if (openPage) open(playground.url, () => log("Couldn't open a browser. Open the address above yourself."));
  return playground;

  function fail(message, usage = true) {
    error(usage ? `${message}\n\n${USAGE}` : message);
    process.exitCode = 1;
    return null;
  }
}
