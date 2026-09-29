// A small headless-browser driver for the site's checks (scripts/browser-check.js, scripts/check-screenshots.js):
// it finds an installed Chrome or Edge, talks to it over the DevTools protocol with Node's own WebSocket, and serves
// a folder over HTTP. No dependencies. Waits are explicit (a condition polled until a timeout), so a slow machine
// takes longer rather than failing.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, extname, join, resolve } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain",
};

/** Serve a folder on 127.0.0.1 (a free port). Resolves to { url, close }. */
export async function serveFolder(folder) {
  const root = resolve(folder);
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = resolve(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

/** The browser to use: $BROWSER_PATH, else Chrome, Chromium, or Edge where they're usually installed. */
export function findBrowser() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  const onPath = (names) => names.flatMap((n) => (process.env.PATH ?? "").split(delimiter).map((d) => join(d, n)));
  const candidates = process.platform === "win32"
    ? ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].flatMap((v) => (process.env[v]
      ? [join(process.env[v], "Google/Chrome/Application/chrome.exe"), join(process.env[v], "Microsoft/Edge/Application/msedge.exe")] : []))
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
      : onPath(["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome, Chromium, or Edge found. Install one, or set BROWSER_PATH to its executable.");
  return found;
}

/**
 * The environment the browser runs with: this one, minus anything that looks like a secret. A browser that crashes
 * can write its environment into a crash dump, so API keys (TYPESAFE_API_KEY among them) never reach it.
 */
export function browserEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|TYPESAFE|NPM_|GITHUB_/i.test(name)));
}

/** Start a headless browser. Resolves to { newPage(), close() }. */
export async function openBrowser({ timeoutMs = 30_000 } = {}) {
  if (typeof WebSocket !== "function") throw new Error("These checks need Node 22.4 or later (for its built-in WebSocket).");
  const profile = mkdtempSync(join(tmpdir(), "honeytongue-browser-"));
  const args = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio",
    // No crash reports: they'd be written to disk and could be uploaded.
    "--disable-breakpad", "--disable-crash-reporter",
    // CI containers often can't use the browser's sandbox; only there, turn it off.
    ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []), "about:blank"];
  const proc = spawn(findBrowser(), args, { stdio: "ignore", env: browserEnv() });
  // The browser writes the port it chose to DevToolsActivePort in its profile folder.
  const portFile = join(profile, "DevToolsActivePort");
  const started = Date.now();
  while (!existsSync(portFile) || !readFileSync(portFile, "utf8").includes("\n")) {
    if (Date.now() - started > timeoutMs) { proc.kill(); throw new Error("The browser didn't start in time."); }
    await sleep(100);
  }
  const base = `http://127.0.0.1:${readFileSync(portFile, "utf8").split("\n")[0].trim()}`;
  const pages = [];
  return {
    async newPage() {
      const target = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
      const page = await connect(target.webSocketDebuggerUrl);
      pages.push(page);
      return page;
    },
    async close() {
      for (const page of pages) page.detach();
      // Ask the browser to close, so nothing is killed mid-write; kill it only if it doesn't.
      const exited = new Promise((r) => { if (proc.exitCode !== null) r(true); else proc.once("exit", () => r(true)); });
      try {
        const { webSocketDebuggerUrl } = await (await fetch(`${base}/json/version`)).json();
        const ws = new WebSocket(webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
        ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      } catch { /* already gone, or not answering: killed below */ }
      if (!(await Promise.race([exited, sleep(5000).then(() => false)]))) {
        proc.kill();
        await Promise.race([exited, sleep(3000)]);
      }
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold a file; it's in tmp */ }
    },
  };
}

/** One page (tab), over its DevTools WebSocket. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolveOpen, reject) => { ws.addEventListener("open", resolveOpen, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  const problems = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.exceptionThrown") problems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") problems.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ""}`.trim());
    for (const l of listeners) l(msg);
  });
  const send = (method, params = {}) => new Promise((resolveSend, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`${method} timed out`)); }, 30_000);
    pending.set(n, (m) => { clearTimeout(timer); if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolveSend(m.result); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  const page = {
    /** Console errors, uncaught exceptions, and error log entries (CSP violations among them) since the last clear. */
    problems,
    /** Any other DevTools protocol command, such as Emulation.setCPUThrottlingRate. */
    send,
    /** Run a script in every new document before its own scripts (CDP evaluation isn't subject to the page's CSP). */
    onNewDocument: (source) => send("Page.addScriptToEvaluateOnNewDocument", { source }),
    viewport: (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 }),
    media: ({ scheme = "light", reducedMotion = "reduce" } = {}) => send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: reducedMotion }] }),
    /** Navigate and wait for the load event and the page's fonts. */
    async go(url, { timeoutMs = 30_000 } = {}) {
      let done;
      const loaded = new Promise((r) => { done = r; });
      const listener = (m) => { if (m.method === "Page.loadEventFired") done(); };
      listeners.add(listener);
      try {
        await send("Page.navigate", { url });
        await Promise.race([loaded, sleep(timeoutMs).then(() => { throw new Error(`${url} didn't load within ${timeoutMs} ms`); })]);
      } finally { listeners.delete(listener); }
      if (url !== "about:blank") await page.eval("document.fonts.ready.then(() => true)");
    },
    async eval(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`In the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    },
    /** Poll `expression` until it's truthy; returns its value, or throws saying what didn't happen. */
    async waitFor(expression, { timeoutMs = 15_000, what = expression, every = 50 } = {}) {
      const started = Date.now();
      // Objects come back as true: only simple values cross from the page.
      const probe = `(() => { const v = (${expression}); return v !== null && typeof v === "object" ? true : v; })()`;
      for (;;) {
        const value = await page.eval(probe);
        if (value) return value;
        if (Date.now() - started > timeoutMs) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
        await sleep(every);
      }
    },
    /** Wait until the page is laid out at `width` and two frames have been drawn, so nothing is caught mid-change. */
    async settle(width) {
      if (width) await page.waitFor(`innerWidth === ${width}`, { what: `the page to be ${width}px wide` });
      await page.eval("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))");
    },
    /** Press or release a key, as the page sees it. */
    key: (key, down) => page.eval(`dispatchEvent(new KeyboardEvent("${down ? "keydown" : "keyup"}", { key: ${JSON.stringify(key)},
      code: ${JSON.stringify(key.length === 1 ? `Key${key.toUpperCase()}` : key)}, keyCode: ${({ ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40, Escape: 27 })[key] ?? key.toUpperCase().charCodeAt(0)},
      bubbles: true })); true`),
    async shot(path, { fullPage = false } = {}) {
      const params = { format: "png" };
      if (fullPage) {
        const { cssContentSize } = await send("Page.getLayoutMetrics");
        Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 8000), scale: 1 } });
      }
      const { data } = await send("Page.captureScreenshot", params);
      writeFileSync(path, Buffer.from(data, "base64"));
    },
    detach() { try { ws.close(); } catch { /* already closed */ } },
  };
  return page;
}
