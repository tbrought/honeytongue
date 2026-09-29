// Honeytongue in a Phaser game: set up the judge and the character, then start the game.
//
// To run it from the repository: npx serve . (in the repository's folder), then open
// http://localhost:3000/examples/phaser/ (browsers won't run modules from a file:// address).
//
// This imports Honeytongue from the repository's own files, so it runs straight from a clone or from
// node_modules/honeytongue. In your own project, import it from the package or a CDN instead:
//   import { Persuadable, createMockClient, createProxyClient } from "honeytongue";        (with a bundler)
//   import { ... } from "https://cdn.jsdelivr.net/npm/honeytongue@alpha/src/index.js";   (no build step)
import { Persuadable, createMockClient, createProxyClient } from "../../src/index.js";
import { troll } from "./character.js";
import { startGame } from "./game.js";

// Who judges: "" uses the offline stand-in (keyword matching, no key needed). Set it to your proxy's URL to play
// with Jev (see examples/cloudflare-worker.js, and add the troll to its allowedCharacters). Never put a key here.
const PROXY_URL = "";
const client = PROXY_URL ? createProxyClient({ url: PROXY_URL }) : createMockClient();

// Phaser comes from the <script> tag in index.html, as window.Phaser.
startGame(window.Phaser, { parent: "game", createNpc: () => new Persuadable(troll, { client }) });
