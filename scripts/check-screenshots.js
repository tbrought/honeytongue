// Checks that a change doesn't alter how the demo looks, pixel for pixel: a local tool, not run in CI (font rendering
// differs between machines, so screenshots are only comparable on the same one).
//
//   npm run check:screenshots -- --save before     (before the change: screenshots and computed styles into ./before)
//   npm run check:screenshots -- --compare before  (after it: takes them again and compares)
//
// It plays The Goblin Camp mid-way and to its ending screen, with CRT mode off and on, in both themes, at phone and
// desktop widths, and records every element's computed style too. Both runs use reduced motion, so nothing is caught
// mid-animation. Nothing calls Jev: a local page judges with the offline stand-in. Screenshots match when no pixel
// differs by more than NOISE levels in any colour: the CRT mode's gradients can dither a few pixels by one level
// between runs, which isn't a change anyone could see.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
import { join, resolve } from "node:path";
import { openBrowser, serveFolder, sleep } from "./browser.js";

const args = process.argv.slice(2);
const mode = args.includes("--save") ? "save" : args.includes("--compare") ? "compare" : null;
const folder = args[args.indexOf(`--${mode}`) + 1];
if (!mode || !folder) {
  console.error("Usage: npm run check:screenshots -- --save <folder>   (then, after your change)   --compare <folder>");
  process.exit(1);
}
const out = mode === "save" ? resolve(folder) : mkdtempSync(join(tmpdir(), "honeytongue-shots-"));
mkdirSync(out, { recursive: true });

const NOISE = 2;

/** A PNG's pixels (8-bit RGB or RGBA, as the browser writes them), without a library. */
function decodePng(file) {
  const b = readFileSync(file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), bpp = b[25] === 6 ? 4 : 3;
  const idat = [];
  for (let p = 8; p < b.length;) {
    const len = b.readUInt32BE(p);
    if (b.toString("ascii", p + 4, p + 8) === "IDAT") idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const r = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, up = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      const paeth = () => { const q = a + up - c, pa = Math.abs(q - a), pb = Math.abs(q - up), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? up : c; };
      px[y * stride + x] = (r + [0, a, up, (a + up) >> 1, paeth()][filter]) & 255;
    }
  }
  return { w, h, bpp, px };
}

/** How many pixels differ by more than NOISE levels, or null when the images are different sizes. */
function changedPixels(fileA, fileB) {
  const A = decodePng(fileA), B = decodePng(fileB);
  if (A.w !== B.w || A.h !== B.h) return null;
  let changed = 0;
  for (let i = 0; i < A.w * A.h; i++) {
    for (let c = 0; c < 3; c++) if (Math.abs(A.px[i * A.bpp + c] - B.px[i * B.bpp + c]) > NOISE) { changed++; break; }
  }
  return changed;
}

const STYLE = ["color", "backgroundColor", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textTransform",
  "textShadow", "borderLeft", "borderTop", "borderBottom", "padding", "margin", "display", "width", "height", "boxShadow", "textDecorationLine",
  "animationName", "transitionProperty", "transform", "opacity", "verticalAlign", "gap"];
// Layout is forced first (reading offsetHeight), so auto margins and the like are read as laid out.
const STYLES = `document.body.offsetHeight, JSON.stringify([...document.querySelectorAll("body, body *")].map((e) => { const s = getComputedStyle(e);
  return e.tagName + "." + e.className + " " + ${JSON.stringify(STYLE)}.map((p) => s[p]).join("|"); }))`;

const browser = await openBrowser();
const site = await serveFolder(new URL("../docs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const page = await browser.newPage();
const styles = {};
try {
  for (const scheme of ["dark", "light"]) {
    for (const width of [390, 1280]) {
      for (const crt of ["off", "on"]) {
        const key = `${scheme}-${width}-crt${crt}`;
        await page.go("about:blank");
        await page.viewport(width, width < 500 ? 844 : 900);
        await page.media({ scheme });
        await page.go(`${site.url}/play/`);
        await page.eval(`localStorage.clear(); localStorage.setItem("honeytongue-crt", "${crt}"); sessionStorage.clear(); true`);
        await page.go("about:blank");
        await page.go(`${site.url}/play/#goblin-camp`);
        await page.waitFor("document.getElementById('cmd')", { what: "the demo's prompt" });
        const say = async (text) => {
          const before = await page.eval("document.querySelectorAll('#log .cmd').length");
          await page.eval(`(() => { const i = document.getElementById("cmd"); i.value = ${JSON.stringify(text)}; document.getElementById("prompt").requestSubmit(); return true; })()`);
          await page.waitFor(`document.querySelectorAll('#log .cmd').length > ${before} && !document.querySelector('#log .thinking')`, { what: `an answer to "${text}"` });
        };
        for (const line of ["debug", "look", "Nib, you fool", "ask Nib about his stew"]) await say(line);
        await page.eval("scrollTo(0, document.documentElement.scrollHeight); true");
        await page.settle(width);
        await sleep(400); // let the compositor finish its last frame, so screenshots are the same from run to run
        await page.shot(join(out, `mid-${key}.png`));
        const mid = JSON.parse(await page.eval(STYLES));
        await say("Nib, please let me out. Come with me to town and I'll help you become a cook in a real kitchen.");
        await page.waitFor("document.querySelector('#log .end-screen')", { what: "the ending screen" });
        await page.eval(`document.querySelector("#log .end-screen").scrollIntoView({ block: "center" }); true`);
        await page.settle(width);
        await sleep(400);
        await page.shot(join(out, `end-${key}.png`));
        styles[key] = { mid, end: JSON.parse(await page.eval(STYLES)) };
      }
    }
  }
} finally {
  await browser.close();
  await site.close();
}
writeFileSync(join(out, "styles.json"), JSON.stringify(styles));

if (mode === "save") {
  console.log(`Saved ${readdirSync(out).length - 1} screenshots and the computed styles to ${out}.`);
} else {
  const base = resolve(folder);
  const shots = readdirSync(out).filter((f) => f.endsWith(".png"));
  const identical = shots.filter((f) => readFileSync(join(base, f)).equals(readFileSync(join(out, f))));
  const differ = shots.filter((f) => !identical.includes(f)).flatMap((f) => {
    const changed = changedPixels(join(base, f), join(out, f));
    return changed === 0 ? [] : [`${f} (${changed === null ? "a different size" : `${changed} pixels`})`];
  });
  const sameStyles = readFileSync(join(base, "styles.json"), "utf8") === readFileSync(join(out, "styles.json"), "utf8");
  console.log(`${shots.length - differ.length} of ${shots.length} screenshots match (${identical.length} byte for byte, the rest within ${NOISE} colour levels)` +
    `${differ.length ? `; different: ${differ.join(", ")}` : ""}.`);
  console.log(sameStyles ? "Every element's computed style matches." : "Computed styles differ.");
  console.log(`This run's screenshots are in ${out}.`);
  if (differ.length || !sameStyles) process.exitCode = 1;
}
