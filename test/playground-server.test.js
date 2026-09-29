import { test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest, createServer } from "node:http";
import { readFileSync } from "node:fs";
import { startPlayground, runPlayground, openCommand, JUDGE_PATH, TOKEN_HEADER } from "../src/playground-server.js";
import { persuasionQuestions, persuasionState } from "../src/index.js";

const KEY = "ts_test_key_do_not_leak_123";
const harry = { name: "Harry", persona: "An honest guard.", goal: "Open the gate" };

/** A raw HTTP request, so tests can send any Host or Origin they like. */
function send(port, { method = "GET", path = "/playground/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function localConfig(port) {
  const page = await send(port);
  const content = page.body.match(/<meta name="honeytongue-local" content="([^"]*)">/)[1];
  return JSON.parse(content.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
}

const judgeBody = JSON.stringify({ state: persuasionState(harry, "Please open the gate"), questions: persuasionQuestions(harry) });
const judge = (port, token, headers = {}) =>
  send(port, { method: "POST", path: JUDGE_PATH, body: judgeBody, headers: { "Content-Type": "application/json", [TOKEN_HEADER]: token, ...headers } });

async function withPlayground(options, fn) {
  const playground = await startPlayground({ port: 0, ...options });
  try { await fn(playground); } finally { await playground.close(); }
}

test("without a key it judges with the mock, and says so", async () => {
  await withPlayground({ apiKey: "" }, async ({ port, url, judge: mode, address }) => {
    assert.equal(mode, "mock");
    assert.equal(address, "127.0.0.1");
    assert.equal(url, `http://127.0.0.1:${port}/playground/`);
    const local = await localConfig(port);
    assert.equal(local.judge, "mock");
    assert.equal(local.url, JUDGE_PATH);
    const res = await judge(port, local.token);
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).source, "mock");
  });
});

test("with a key it judges with Jev, and the key never reaches the page", async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push(init.headers.Authorization);
    const answers = { persuasion: { type: "score", score: 3, legend: {}, probabilities: { 3: 1 }, confidence: 1 },
      threats: { type: "noul", noul: 0 }, insults: { type: "noul", noul: 0 } };
    return new Response(JSON.stringify({ answers }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await withPlayground({ apiKey: KEY, fetch }, async ({ port, judge: mode }) => {
    assert.equal(mode, "jev");
    const local = await localConfig(port);
    assert.equal(local.judge, "jev");
    const res = await judge(port, local.token);
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).source, "jev");
    assert.deepEqual(seen, [`Bearer ${KEY}`], "the server sends the key to Jev");
    const everything = [res.body, JSON.stringify(res.headers)];
    for (const path of ["/playground/", "/playground/app.js", "/playground/designer.js", "/play/lib/jev.js", "/play/lib/characters.json"]) {
      const file = await send(port, { path });
      everything.push(file.body, JSON.stringify(file.headers));
    }
    assert.ok(everything.every((text) => !text.includes(KEY)), "the key appears in nothing the browser receives");
  });
});

test("--mock judges with the mock even when a key is set", async () => {
  await withPlayground({ apiKey: KEY, mock: true }, async ({ port, judge: mode }) => {
    assert.equal(mode, "mock");
    assert.equal((await localConfig(port)).judge, "mock");
  });
});

test("a malformed key fails at start with a readable message", async () => {
  await assert.rejects(startPlayground({ port: 0, apiKey: `"${KEY}"` }), /wrapped in quote marks/);
});

test("requests for another host are refused, so DNS rebinding can't reach the key", async () => {
  await withPlayground({ apiKey: "" }, async ({ port }) => {
    const { token } = await localConfig(port);
    assert.equal((await send(port, { headers: { Host: "evil.example" } })).status, 403);
    assert.equal((await send(port, { headers: { Host: `evil.example:${port}` } })).status, 403);
    assert.equal((await judge(port, token, { Host: `attacker.test:${port}` })).status, 403);
    assert.equal((await send(port, { headers: { Host: `localhost:${port}` } })).status, 200);
  });
});

test("judging needs this server's token and a same-origin request", async () => {
  await withPlayground({ apiKey: "" }, async ({ port }) => {
    const { token } = await localConfig(port);
    assert.equal((await judge(port, "")).status, 403);
    assert.equal((await judge(port, "wrong-token")).status, 403);
    // A token one character off (never the same character, or it would be the right token).
    assert.equal((await judge(port, token.slice(0, -1) + (token.endsWith("x") ? "y" : "x"))).status, 403);
    assert.equal((await judge(port, token, { Origin: "https://evil.example" })).status, 403);
    assert.equal((await judge(port, token, { Origin: `http://127.0.0.1:${port}` })).status, 200);
    // Each start gets a new token, so a page from an earlier run is told to reload.
    await withPlayground({ apiKey: "" }, async ({ port: other }) => {
      const res = await judge(other, token);
      assert.equal(res.status, 403);
      assert.match(JSON.parse(res.body).error, /Reload/);
    });
  });
});

test("it serves only the playground's files", async () => {
  await withPlayground({ apiKey: "" }, async ({ port }) => {
    for (const path of ["/playground/", "/playground/app.js", "/playground/designer.js", "/style.css", "/theme.js",
      "/play/lib/persuasion.js", "/play/lib/jev.js", "/play/lib/mock.js", "/play/lib/version.js", "/play/lib/characters.json"]) {
      const res = await send(port, { path });
      assert.equal(res.status, 200, path);
      assert.ok(res.headers["content-security-policy"], path);
      assert.equal(res.headers["x-content-type-options"], "nosniff");
    }
    assert.match((await send(port, { path: "/playground/app.js" })).headers["content-type"], /^text\/javascript/);
    for (const path of ["/package.json", "/src/cli.js", "/playground/../package.json", "/%2e%2e/package.json", "/play/lib/engine.js"]) {
      assert.equal((await send(port, { path })).status, 404, path);
    }
    const root = await send(port, { path: "/" });
    assert.equal(root.status, 302);
    assert.equal(root.headers.location, "/playground/");
    assert.equal((await send(port, { method: "POST", path: "/playground/" })).status, 405);
  });
});

test("every module the page imports is served, so a new import in the library can't break the playground", async () => {
  await withPlayground({ apiKey: "" }, async ({ port }) => {
    const seen = new Set();
    const visit = async (path) => {
      if (seen.has(path)) return;
      seen.add(path);
      const res = await send(port, { path });
      assert.equal(res.status, 200, `${path} (imported by the playground) isn't served`);
      for (const [, spec] of res.body.matchAll(/(?:import|export)\s[^"';]*?from\s*"(\.{1,2}\/[^"]+)"|import\(\s*"(\.{1,2}\/[^"]+)"\s*\)/g)) {
        if (spec) await visit(new URL(spec, `http://x${path}`).pathname);
      }
    };
    await visit("/playground/app.js");
    assert.ok(seen.has("/play/lib/version.js"), "the walk reaches the library's imports");
  });
});

test("the web fonts are served as they are, as fonts", async () => {
  await withPlayground({ apiKey: "" }, async ({ port }) => {
    const file = "IBMPlexMono-Regular-Latin1.woff2";
    const bytes = await new Promise((resolve, reject) => {
      httpRequest({ host: "127.0.0.1", port, path: `/assets/fonts/${file}`, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers["content-type"], "font/woff2");
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }).on("error", reject).end();
    });
    assert.ok(bytes.equals(readFileSync(new URL(`../docs/assets/fonts/${file}`, import.meta.url))), "byte for byte");
  });
});

test("a busy port falls back to a free one only when allowed", async () => {
  const blocker = createServer();
  await new Promise((r) => blocker.listen(0, "127.0.0.1", r));
  const busy = blocker.address().port;
  try {
    await assert.rejects(startPlayground({ port: busy, apiKey: "" }), { code: "EADDRINUSE" });
    await withPlayground({ port: busy, fallback: true, apiKey: "" }, async ({ port }) => assert.notEqual(port, busy));
  } finally {
    blocker.close();
  }
});

test("opening the browser escapes the URL for cmd on Windows", () => {
  const url = "http://127.0.0.1:4747/playground/?a=1&b=2^3";
  const win = openCommand(url, "win32");
  assert.equal(win.command, "cmd");
  assert.deepEqual(win.args, ["/c", "start", '""', "http://127.0.0.1:4747/playground/?a=1^&b=2^^3"]);
  assert.equal(win.options.windowsVerbatimArguments, true);
  assert.deepEqual(openCommand(url, "darwin"), { command: "open", args: [url], options: {} });
  assert.deepEqual(openCommand(url, "linux"), { command: "xdg-open", args: [url], options: {} });
});

test("the command prints the address, the judge, and how to stop", async () => {
  const out = [];
  const opened = [];
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    const playground = await runPlayground(["--port", "0"], { log: (s) => out.push(s), open: (url) => opened.push(url) });
    await playground.close();
    assert.deepEqual(out, [
      `Honeytongue playground: ${playground.url}`,
      "Judging with the offline mock (a keyword preview), because TYPESAFE_API_KEY isn't set.",
      "Press Ctrl+C to stop.",
    ]);
    assert.deepEqual(opened, [playground.url]);
    const quiet = await runPlayground(["--port", "0", "--no-open", "--mock"], { log: (s) => out.push(s), open: (url) => opened.push(url) });
    await quiet.close();
    assert.equal(opened.length, 1, "--no-open doesn't open a browser");
    assert.match(out.at(-2), /because --mock is set/);
  } finally {
    if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
  }
});

test("bad options print usage and set a failing exit code", async () => {
  const errors = [];
  for (const args of [["--bogus"], ["--port"], ["--port", "http"], ["--port", "70000"]]) {
    assert.equal(await runPlayground(args, { error: (s) => errors.push(s), log: () => {} }), null);
    assert.equal(process.exitCode, 1);
    process.exitCode = undefined;
  }
  assert.ok(errors.every((e) => e.includes("Usage: npx honeytongue playground")));
});
