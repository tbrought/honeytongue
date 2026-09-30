// The website's browser checks, in a real headless Chrome or Edge: npm run check:browser (and in CI).
//
// - Every page, at phone and desktop widths in both themes: no Content Security Policy violations, console errors, or
//   requests to other hosts; no sideways scrolling; and every piece of text meets WCAG AA contrast.
// - Hostile text (a playground share link, and a line typed into the demo) is shown as text, never run.
// - The demo scene and the Phaser game, played through to their endings.
// - The local playground server (npx honeytongue playground), with its own CSP header.
//
// Nothing here calls Jev: pages served from this machine judge with the offline stand-in. Waits are explicit, with
// timeouts, and each walk-through gets one retry, so a slow machine is slower rather than flaky. The pixel-for-pixel
// screenshot comparison is a separate, local-only tool: scripts/check-screenshots.js.
import { openBrowser, serveFolder, sleep } from "./browser.js";
import { encodeShare } from "../docs/playground/designer.js";
import { startPlayground } from "../src/playground-server.js";

const PAGES = [["home", "/"], ["demo picker", "/play/"], ["demo scene", "/play/#goblin-camp"], ["playground", "/playground/"], ["Phaser game", "/phaser/"]];
const THEMES = ["dark", "light"];
const WIDTHS = [390, 1280];

let passed = 0;
const failures = [];
const check = (ok, what, detail = "") => {
  if (ok) passed++; else failures.push(`${what}${detail ? `: ${detail}` : ""}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok && detail ? `  (${detail})` : ""}`);
};

// Before any of a page's own scripts: record CSP violations, and make alert() count instead of blocking.
const WATCH = `window.__csp = []; window.__alerts = 0; window.alert = () => { window.__alerts++; };
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + (e.blockedURI || "inline")));`;
// Keep a handle on the Phaser game for these checks only, by wrapping Phaser.Game as the Phaser script defines it.
const PHASER_HOOK = `(() => { let P; Object.defineProperty(window, "Phaser", { configurable: true, get: () => P,
  set: (v) => { const G = v.Game; v.Game = class extends G { constructor(c) { super(c); window.__game = this; } }; P = v; } }); })()`;

// Every element with its own text (and ::before labels): its colour against the first opaque background behind it.
const CONTRAST = `(() => {
  const rgb = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.a > 0.5) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
  const bad = []; let n = 0;
  const test = (el, s, what) => {
    if (s.visibility === "hidden" || s.display === "none" || el.closest(".vh, [hidden], canvas")) return;
    const size = parseFloat(s.fontSize), large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const r = ratio(rgb(s.color), bgOf(el)); n++;
    if (r < (large ? 3 : 4.5)) bad.push(what + " " + r.toFixed(2));
  };
  for (const el of document.querySelectorAll("body *")) {
    if ([...el.childNodes].some((c) => c.nodeType === 3 && c.data.trim())) test(el, getComputedStyle(el), el.tagName + "." + el.className + " '" + el.textContent.trim().slice(0, 30) + "'");
    const before = getComputedStyle(el, "::before");
    if (/^"[^"]+"$/.test(before.content)) test(el, before, el.tagName + "." + el.className + "::before");
  }
  return JSON.stringify({ n, bad: [...new Set(bad)] });
})()`;

const browser = await openBrowser();
const site = await serveFolder(new URL("../docs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const page = await browser.newPage();
await page.onNewDocument(WATCH);
await page.onNewDocument(PHASER_HOOK);

/** Load a page fresh, in a theme, with reduced motion (so typed text appears at once). */
async function open(path, { scheme = "dark", width = 1280 } = {}) {
  await page.go("about:blank");
  await page.viewport(width, width < 500 ? 844 : 900);
  await page.media({ scheme });
  page.problems.length = 0;
  await page.go(site.url + path);
  await page.settle(width);
}
const violations = async () => [...JSON.parse(await page.eval("JSON.stringify(window.__csp ?? [])")), ...page.problems];
const must = (ok, message) => { if (!ok) throw new Error(message); };
/** Run a walk-through, once more if it fails: it throws on its first failed step. */
async function walkThrough(what, run) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { await run(); check(true, what); return; } catch (err) {
      if (attempt === 2) check(false, what, err.message);
      else console.log(`     (retrying: ${what}: ${err.message})`);
    }
  }
}

try {
  // ---- Every page, both themes, phone and desktop ----
  for (const scheme of THEMES) {
    for (const width of WIDTHS) {
      for (const [name, path] of PAGES) {
        const label = `${name}, ${width}px, ${scheme}`;
        await open(path, { scheme, width });
        if (name === "Phaser game") await page.waitFor("window.__game?.scene?.getScene?.('bridge')?.player", { what: "the Phaser scene to start" });
        if (name === "playground") await page.waitFor("document.querySelector('#presets button')", { what: "the playground's presets" });
        await sleep(300); // anything the page does just after loading
        const hosts = JSON.parse(await page.eval(`JSON.stringify([...new Set(performance.getEntriesByType("resource").map(e => new URL(e.name).host))])`));
        const bad = await violations();
        check(bad.length === 0, `${label}: no CSP violations or console errors`, bad.join("; ").slice(0, 300));
        check(hosts.every((h) => h === new URL(site.url).host), `${label}: nothing is fetched from other hosts`, hosts.join(", "));
        check(!(await page.eval("document.documentElement.scrollWidth > innerWidth")), `${label}: no sideways scrolling`);
        if (name !== "Phaser game") {
          const { n, bad: low } = JSON.parse(await page.eval(CONTRAST));
          check(low.length === 0 && n > 0, `${label}: all ${n} pieces of text meet WCAG AA contrast`, low.slice(0, 5).join(" | "));
        }
      }
    }
  }

  // ---- Hostile text is shown as text ----
  const IMG = "<img src=x onerror=alert(1)>";
  const CLOSE = "</textarea><script>alert(1)</script>";
  const hostile = { name: `Nib ${IMG}`, persona: `A guard ${CLOSE} who likes stew`, goal: `Open the cage ${IMG}`, repeatReaction: `Again ${CLOSE}`,
    secrets: [{ id: "stew", fact: `He wants to cook ${IMG}` }], reactions: [{ min: 0, text: `He sniffs. "${CLOSE}"` }] };
  await open(`/playground/${encodeShare({ character: hostile, knows: ["stew"] })}`);
  await page.waitFor("document.getElementById('f-name').value", { what: "the share link to load" });
  await page.eval(`(() => { const i = document.getElementById("line"); i.value = ${JSON.stringify(`Please ${IMG} ${CLOSE}`)}; document.getElementById("try").requestSubmit(); return true; })()`);
  await page.waitFor("document.querySelector('#attempts .attempt .reply')", { what: "the hostile line to be judged" });
  // A second, plain line gets the character's (hostile) reaction: the first may convince, since the link teaches the secret.
  await page.eval(`(() => { const i = document.getElementById("line"); i.value = "Please, I just want to go home."; document.getElementById("try").requestSubmit(); return true; })()`);
  await page.waitFor("document.querySelectorAll('#attempts .attempt .reply').length === 2", { what: "the second line to be judged" });
  await page.eval(`document.getElementById("copy-code").click(); true`);
  await page.waitFor("document.getElementById('output').value", { what: "the copied code" });
  const pg = JSON.parse(await page.eval(`JSON.stringify({ name: document.getElementById("f-name").value, persona: document.getElementById("f-persona").value,
    said: document.querySelector("#attempts .cmd").textContent, reply: [...document.querySelectorAll("#attempts .reaction")].pop()?.textContent ?? "",
    code: document.getElementById("output").value, imgs: document.querySelectorAll("img:not(.logo)").length,
    scripts: document.querySelectorAll("script:not([src])").length, alerts: window.__alerts })`));
  check(pg.name === hostile.name && pg.persona === hostile.persona, "playground: a hostile share link's fields show literally");
  check(pg.said === `Please ${IMG} ${CLOSE}` && pg.reply === hostile.reactions[0].text, "playground: the hostile line and reaction show literally", pg.reply);
  check(pg.code.includes("\\u003cimg") && !pg.code.includes("<"), "playground: the copied code keeps it as escaped data");
  check(pg.imgs === 0 && pg.scripts === 0 && pg.alerts === 0, "playground: nothing hostile was created or run", JSON.stringify(pg).slice(0, 120));
  check((await violations()).length === 0, "playground: no CSP violations with hostile input", (await violations()).join("; "));

  // A Try it link in the home page's grid opens the playground with that preset and line, ready to send.
  await open("/");
  const tryHref = await page.eval(`document.querySelector('tr[data-tactic="Plain truth"] td a.try').getAttribute("href")`);
  await open(`/${tryHref}`);
  await page.waitFor("document.getElementById('f-name').value && document.getElementById('line').value", { what: "the Try it link to load" });
  const tried = JSON.parse(await page.eval(`JSON.stringify({ name: document.getElementById("f-name").value, line: document.getElementById("line").value,
    focused: document.activeElement?.id })`));
  check(tried.name === "Harry Goatleaf" && tried.line.startsWith("I won't flatter you") && tried.focused === "line",
    "home: a Try it link opens the playground with its preset and line, ready to send", JSON.stringify(tried));
  await page.eval(`document.getElementById("try").requestSubmit(); true`);
  await page.waitFor("document.querySelector('#attempts .attempt .reply')", { what: "the Try it line to be judged" });
  check((await violations()).length === 0, "home: the Try it link's page has no CSP violations", (await violations()).join("; "));

  await open("/play/#goblin-camp");
  await page.waitFor("document.getElementById('cmd')", { what: "the demo's prompt" });
  await page.eval(`(() => { const i = document.getElementById("cmd"); i.value = ${JSON.stringify(`${IMG} ${CLOSE}`)}; document.getElementById("prompt").requestSubmit(); return true; })()`);
  await page.waitFor("[...document.querySelectorAll('#log .cmd')].length && !document.querySelector('#log .thinking')", { what: "the demo to answer" });
  const demo = JSON.parse(await page.eval(`JSON.stringify({ said: [...document.querySelectorAll("#log .cmd")].pop().textContent,
    imgs: document.querySelectorAll("#log img").length, alerts: window.__alerts })`));
  check(demo.said === `${IMG} ${CLOSE}` && demo.imgs === 0 && demo.alerts === 0, "demo: a hostile line is echoed literally, and nothing runs", JSON.stringify(demo).slice(0, 120));

  // ---- The demo scene, played to its ending (CRT mode on, in the dark theme; off in the light one) ----
  for (const scheme of THEMES) {
    await walkThrough(`demo: The Goblin Camp plays to its ending (${scheme}, CRT ${scheme === "dark" ? "on" : "off"})`, async () => {
      await open("/play/", { scheme });
      await page.eval(`localStorage.setItem("honeytongue-crt", "${scheme === "dark" ? "on" : "off"}"); sessionStorage.clear(); true`);
      await open("/play/#goblin-camp", { scheme });
      await page.waitFor("document.getElementById('cmd')", { what: "the demo's prompt" });
      const say = async (text) => {
        const before = await page.eval("document.querySelectorAll('#log .cmd').length");
        await page.eval(`(() => { const i = document.getElementById("cmd"); i.value = ${JSON.stringify(text)}; document.getElementById("prompt").requestSubmit(); return true; })()`);
        await page.waitFor(`document.querySelectorAll('#log .cmd').length > ${before} && !document.querySelector('#log .thinking')`, { what: `an answer to "${text}"` });
      };
      for (const line of ["debug", "Nib, you fool", "ask Nib about his stew", "Nib, please let me out. Come with me to town and I'll help you become a cook in a real kitchen."]) await say(line);
      const ending = await page.waitFor("document.querySelector('#log .ending-title')?.textContent", { what: "the ending screen" });
      must(ending === "You talked your way out", `the ending was "${ending}"`);
      const seen = JSON.parse(await page.eval(`JSON.stringify({ crt: document.body.classList.contains("crt"), meters: document.querySelectorAll("#log .meter").length,
        chips: [...document.querySelectorAll("#log .chip")].map(c => c.textContent), lost: document.querySelectorAll(".status .pips i:not(.on)").length })`));
      must(seen.crt === (scheme === "dark"), `CRT mode is ${seen.crt ? "on" : "off"}`);
      must(seen.meters > 0 && seen.chips.includes("OFFENDED") && seen.chips.includes("CONVINCED"), `the replies were labelled ${seen.chips.join(", ")}`);
      const bad = await violations();
      must(bad.length === 0, `CSP violations or console errors: ${bad.join("; ")}`);
    });
  }

  // ---- The Phaser game, played to its ending ----
  await walkThrough("Phaser: read the sign, fail, convince the troll, and cross the bridge", async () => {
    await open("/phaser/");
    await page.waitFor("window.__game?.scene?.getScene?.('bridge')?.player", { what: "the Phaser scene to start" });
    const state = async () => JSON.parse(await page.eval(`(() => { const s = __game.scene.getScene("bridge"); return JSON.stringify({
      x: s.player.x, y: s.player.y, flip: s.player.flipX, passed: s.passed, ended: s.ended, talking: s.talking, trollY: s.troll.y,
      sprites: ["player", "troll", "sign"].every((k) => s.textures.exists(k)), speaker: document.querySelector("#dialogue-log p b")?.textContent ?? null,
      verdicts: [...document.querySelectorAll("#dialogue-log p[data-verdict]")].map((p) => p.dataset.verdict) }); })()`));
    const bridge = `__game.scene.getScene("bridge")`;
    /** What the game looks like right now, for a failure message. */
    const diagnose = () => page.eval(`(() => { const s = ${bridge}, k = s.keys, loop = __game.loop;
      return "player at " + s.player.x.toFixed(1) + "," + s.player.y.toFixed(1) + "; talking " + s.talking + ", passed " + s.passed + ", ended " + s.ended +
        "; keys held: " + ["UP", "DOWN", "LEFT", "RIGHT"].filter((n) => k[n].isDown).join(" ") + "; " + loop.actualFps.toFixed(0) + " fps, delta " + loop.delta.toFixed(0) +
        " ms, loop running " + loop.running + "; page " + document.visibilityState + ", focused " + document.hasFocus() +
        ", active element " + (document.activeElement?.id || document.activeElement?.tagName); })()`).catch((e) => `(no diagnosis: ${e.message})`);
    /**
     * Hold a key until the condition on the scene holds (or give up). The key press is sent again every quarter of a
     * second, as a held key repeats: Phaser forgets held keys when the window loses focus, which headless browsers on
     * some systems do on their own.
     */
    const walk = async (key, until, what) => {
      const started = Date.now();
      let pressed = 0;
      try {
        // Checked often, so the player stops close to the spot; pressed again every 250 ms.
        while (!(await page.eval(`Boolean(${until})`))) {
          if (Date.now() - started > 15_000) throw new Error(`Timed out after 15000 ms waiting for ${what} (${await diagnose()})`);
          if (Date.now() - pressed >= 250) { await page.key(key, true); pressed = Date.now(); }
          await sleep(30);
        }
      } finally { await page.key(key, false); }
    };
    const mustGame = async (ok, message) => { if (!ok) throw new Error(`${message} (${await diagnose()})`); };
    // A real key press lasts longer than a frame, and the game reads single presses once a frame (JustDown).
    const talk = async () => { await page.key("e", true); await sleep(100); await page.key("e", false); await page.waitFor(`${bridge}.talking`, { what: "the dialogue box" }); };
    const say = async (line, verdicts) => {
      await page.eval(`(() => { const i = document.getElementById("dialogue-input"); i.value = ${JSON.stringify(line)}; document.getElementById("dialogue-form").requestSubmit(); return true; })()`);
      await page.waitFor(`document.querySelectorAll("#dialogue-log p[data-verdict]").length >= ${verdicts}`, { what: `Tolly's answer to "${line}"` });
    };
    const leave = async () => { await page.eval(`document.getElementById("dialogue-close").click(); true`); await page.waitFor(`!${bridge}.talking`, { what: "the box to close" }); };

    await mustGame((await state()).sprites, "the sprites didn't load");
    await walk("ArrowUp", `${bridge}.player.y <= 95`, "the player to walk up");
    await walk("ArrowRight", `${bridge}.player.x >= 110`, "the player to reach the sign");
    await talk();
    await mustGame((await state()).speaker === "Sign: ", "the sign wasn't read");
    await leave();
    await walk("ArrowDown", `${bridge}.player.y >= 134`, "the player to walk down to the bridge");
    await walk("ArrowRight", `${bridge}.player.x >= 180`, "the player to reach the troll");
    for (let i = 0; i < 3; i++) { await page.key("ArrowRight", true); await sleep(200); } // keep pushing against the river
    await page.key("ArrowRight", false);
    await mustGame((await state()).x <= 182.5, "the river didn't stop the player");
    await talk();
    await mustGame((await state()).speaker === "Tolly Underarch: ", "the troll didn't answer");
    await say("Please let me cross the bridge.", 1);
    await mustGame((await state()).verdicts.join() === "unconvinced", "a bare plea should fail");
    await say("Please let me cross, and I'll come back and visit you.", 2);
    await mustGame((await state()).passed, "the right argument should convince him (the sign teaches his secret)");
    await leave();
    await page.waitFor(`${bridge}.troll.y >= 207`, { what: "the troll to step aside" });
    await walk("ArrowLeft", `${bridge}.player.flipX`, "walking left to mirror the player");
    await walk("ArrowRight", `${bridge}.ended`, "the player to cross the bridge");
    const bad = await violations();
    must(bad.length === 0, `CSP violations or console errors: ${bad.join("; ")}`);
  });

  // ---- The Phaser game's keys: each press acts once, even when several arrive in one frame ----
  // Phaser hands a frame's key events to its keydown listeners again whenever another key event arrives, so without
  // the game's guard a key already handled can act again. And a press and release within one frame, as on-screen
  // keyboards and assistive tools send, must still count.
  const phaserAt = async (x, y) => {
    await open("/phaser/");
    await page.waitFor("window.__game?.scene?.getScene?.('bridge')?.player", { what: "the Phaser scene to start" });
    await page.eval(`__game.scene.getScene("bridge").player.setPosition(${x}, ${y}); true`);
    await page.settle(1280);
  };
  const oneFrame = (steps) => page.eval(`(() => {
    const key = (type, key, code, keyCode) => dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, bubbles: true }));
    const press = (k, code, keyCode) => { key("keydown", k, code, keyCode); key("keyup", k, code, keyCode); };
    ${steps}
    return true;
  })()`);
  const talking = () => page.eval(`__game.scene.getScene("bridge").talking`);

  await phaserAt(115, 92); // next to the sign
  await oneFrame(`press("e", "KeyE", 69);`);
  await sleep(200);
  check(await talking(), "Phaser: a press and release within one frame (as on-screen keyboards send) opens the sign");

  await phaserAt(115, 92);
  await oneFrame(`press("e", "KeyE", 69); document.getElementById("dialogue-close").click(); press("ArrowDown", "ArrowDown", 40);`);
  await sleep(200);
  check(!(await talking()), "Phaser: E, Leave, and an arrow key in one frame leave the box closed");

  await phaserAt(115, 92);
  await page.key("e", true); await sleep(100); await page.key("e", false);
  const opened = await page.waitFor(`__game.scene.getScene("bridge").talking`, { what: "the sign's box" }).catch(() => false);
  await oneFrame(`press("e", "KeyE", 69); press("Escape", "Escape", 27);`); // a letter typed in the box, then Escape
  await sleep(200);
  check(opened && !(await talking()), "Phaser: a letter typed in the box and Escape, in one frame, leave the box closed");

  // Typing to the troll with real keystrokes: E, R, spaces, and capitals appear in the box, and Enter says the line,
  // without reading the sign again, restarting, or moving the player.
  await phaserAt(182, 135); // next to the troll
  await page.key("e", true); await sleep(100); await page.key("e", false);
  await page.waitFor(`__game.scene.getScene("bridge").talking && document.activeElement?.id === "dialogue-input"`, { what: "the troll's box, ready to type in" });
  await page.eval(`window.__player = __game.scene.getScene("bridge").player; true`);
  const typed = "Rest here, Tolly. Everyone needs a friend, eh? Enter";
  const KEYS = { " ": ["Space", 32], ",": ["Comma", 188], ".": ["Period", 190], "?": ["Slash", 191] };
  for (const ch of typed) {
    const [code, keyCode] = KEYS[ch] ?? [`Key${ch.toUpperCase()}`, ch.toUpperCase().charCodeAt(0)];
    const modifiers = ch !== ch.toLowerCase() || ch === "?" ? 8 : 0; // Shift
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, code, text: ch, unmodifiedText: ch.toLowerCase(), windowsVirtualKeyCode: keyCode, modifiers });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code, windowsVirtualKeyCode: keyCode, modifiers });
  }
  const inBox = await page.eval(`document.getElementById("dialogue-input").value`);
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await page.waitFor(`[...document.querySelectorAll("#dialogue-log p")].length >= 3`, { what: "the troll's answer" }).catch(() => {});
  const after = JSON.parse(await page.eval(`(() => { const s = __game.scene.getScene("bridge"); return JSON.stringify({
    said: [...document.querySelectorAll("#dialogue-log p")].map((p) => p.textContent).find((t) => t.startsWith("You: ")) ?? null,
    speaker: document.querySelector("#dialogue-log p b")?.textContent, talking: s.talking, samePlayer: s.player === window.__player,
    x: Math.round(s.player.x), y: Math.round(s.player.y), cleared: document.getElementById("dialogue-input").value === "" }); })()`));
  check(inBox === typed, "Phaser: E, R, spaces, and capitals type into the box normally", JSON.stringify(inBox));
  check(after.said === `You: ${typed}` && after.cleared, "Phaser: Enter says the typed line to the troll", JSON.stringify(after));
  check(after.talking && after.speaker === "Tolly Underarch: " && after.samePlayer && after.x === 182 && after.y === 135,
    "Phaser: typing never reads the sign, restarts the game, or moves the player", JSON.stringify(after));

  // Hostile text said to the troll is shown as text: nothing it names is created or run.
  const hostileLine = '<img src=x onerror=alert(1)> </textarea><script>alert(1)</script>';
  await page.eval(`(() => { const i = document.getElementById("dialogue-input"); i.value = ${JSON.stringify(hostileLine)}; document.getElementById("dialogue-form").requestSubmit(); return true; })()`);
  await page.waitFor(`[...document.querySelectorAll("#dialogue-log p")].some((p) => p.textContent === "You: " + ${JSON.stringify(hostileLine)})`, { what: "the hostile line in the log" }).catch(() => {});
  const phaserHostile = JSON.parse(await page.eval(`JSON.stringify({ shown: [...document.querySelectorAll("#dialogue-log p")].some((p) => p.textContent === "You: " + ${JSON.stringify(hostileLine)}),
    imgs: document.querySelectorAll("#dialogue img, #dialogue script").length, alerts: window.__alerts })`));
  check(phaserHostile.shown && phaserHostile.imgs === 0 && phaserHostile.alerts === 0, "Phaser: hostile text said to the troll is shown literally, and nothing runs", JSON.stringify(phaserHostile));

  // ---- The local playground server ----
  const local = await startPlayground({ port: 0, apiKey: "", mock: true });
  try {
    const header = (await fetch(local.url)).headers.get("content-security-policy") ?? "";
    check(/frame-ancestors 'none'/.test(header) && /script-src 'self'/.test(header), "local playground: served with its own strict CSP header");
    await page.go("about:blank");
    page.problems.length = 0;
    await page.go(local.url);
    await page.waitFor("document.querySelector('#presets button')", { what: "the local playground" });
    await page.eval(`(() => { const i = document.getElementById("line"); i.value = "Please let me go"; document.getElementById("try").requestSubmit(); return true; })()`);
    await page.waitFor("document.querySelector('#attempts .attempt .reply')", { what: "a line judged through the local server" });
    const bad = await violations();
    check(bad.length === 0, "local playground: judges through its server, with no CSP violations", bad.join("; "));
  } finally {
    await local.close();
  }
} catch (err) {
  check(false, "the checks ran to the end", err.stack ?? err.message);
} finally {
  await browser.close();
  await site.close();
}

console.log(`\n${passed} passed, ${failures.length} failed.`);
if (failures.length) {
  console.log(`\nFailed:\n  - ${failures.join("\n  - ")}`);
  process.exitCode = 1;
}
