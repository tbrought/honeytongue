// The site's playable copy of the Phaser example (examples/phaser), judged live by the demo proxy, with the same
// fallback, turn cap, and privacy note as the demo scenes. lib/ holds copies of the example's game and character,
// made by npm run build:demo; the library comes from the demo's copies in ../play/lib.
import { Persuadable } from "../play/lib/persuasion.js";
import { createProxyClient } from "../play/lib/jev.js";
import { createMockClient } from "../play/lib/mock.js";
import { VERSION } from "../play/lib/version.js";
import { createFallbackClient, chooseJudge, fallbackNote, banner, TURN_CAP } from "../play/fallback.js";
import { makeRenderer } from "../play/render.js";
import { troll } from "./lib/character.js";
import { startGame } from "./lib/game.js";

const { bannerNode } = makeRenderer(document);
const $ = (id) => document.getElementById(id);
const { judge, url: proxyUrl } = chooseJudge({
  proxyUrl: document.querySelector('meta[name="honeytongue-proxy"]')?.content,
  hostname: location.hostname,
  search: location.search,
});
let storage = null;
try { storage = sessionStorage; } catch { /* the turn count then lasts as long as the page */ }

let fallback = null; // why the stand-in is judging instead of Jev, if it is
const show = (source) => {
  $("mode").hidden = false;
  $("mode").replaceChildren(bannerNode(banner({ source, fallback, judge, proxyUrl })));
};
const client = proxyUrl
  ? createFallbackClient({
      live: createProxyClient({ url: proxyUrl, maxRetries: 0, timeoutMs: 15_000 }),
      mock: createMockClient(),
      storage,
      onChange: (change) => {
        fallback = change.mode === "live" ? null : change;
        $("note").textContent = fallbackNote(change, VERSION);
        show(change.mode === "live" ? "jev" : "mock");
      },
    })
  : createMockClient();
if (proxyUrl && client.turnsUsed >= TURN_CAP) fallback = { mode: "off", why: "cap" }; // used up before a reload
show(proxyUrl && !fallback ? "jev" : "mock");

// Phaser draws its own text, so wait for the pixel font before starting.
await document.fonts.load('16px "VT323"').catch(() => {});
startGame(window.Phaser, { parent: "game", createNpc: () => new Persuadable(troll, { client }) });
