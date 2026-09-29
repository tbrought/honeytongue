// A small Phaser game with a Honeytongue character: walk to the bridge, read the sign, and talk the troll into
// letting you cross. Phaser draws the world; Honeytongue judges what you say; this file decides what happens.
//
// startGame(Phaser, { parent, createNpc, assets }) needs a <div id="dialogue"> dialogue box on the page (see
// index.html), a createNpc() that returns a new Persuadable (see main.js), and the sprites in `assets` (a folder
// URL, "assets/" by default, relative to the page).
//
// Sprites (assets/*.png) by Tristan Broughton, under the project's MIT license. They're 32x32 pixel art, drawn at a
// whole-number scale with pixelArt on, so they stay crisp. The player faces right and the troll faces left.

const W = 480, H = 270;                                   // the game's size; Phaser scales it to fit the page
const SCALE = 2;                                          // sprites are drawn at 2x: 32x32 pixels become 64x64
const RIVER = { left: 196, right: 292 };                  // where the water is
const BRIDGE = { left: 184, right: 304, top: 106, bottom: 164 }; // the deck you can cross on, once the troll steps aside
const SPEED = 90;                                         // walking speed, pixels per second
const TOP = 1000;                                         // depth for text over the world, in front of every sprite
// The player's feet (the robe's hem and boots), in pixels from the sprite's centre at 2x, from the art's rows
// 19 to 28. They decide where the player can stand: on grass, or on the deck once the troll has moved.
const FEET = { left: -12, right: 14, top: 6, bottom: 24 };
const SPRITES = { player: "phaser-demo-player-32.png", troll: "phaser-demo-troll-32.png", sign: "phaser-demo-sign-32.png" };

export function startGame(Phaser, { parent, createNpc, assets = "assets/" }) {
  const box = document.getElementById("dialogue");
  const log = document.getElementById("dialogue-log");
  const form = document.getElementById("dialogue-form");
  const input = document.getElementById("dialogue-input");

  class Bridge extends Phaser.Scene {
    preload() {
      for (const [key, file] of Object.entries(SPRITES)) if (!this.textures.exists(key)) this.load.image(key, assets + file);
    }

    create() {
      this.npc = createNpc();          // a fresh Persuadable each time the scene starts
      this.passed = false;             // has the troll stepped aside?
      this.talking = false;            // is the dialogue box open?
      this.ended = false;              // has the player crossed?
      this.target = null;              // where a tap asked the player to walk

      // The world: grass, the river, the bridge's deck and planks, and the far bank's flag.
      const deckY = (BRIDGE.top + BRIDGE.bottom) / 2, deckHeight = BRIDGE.bottom - BRIDGE.top;
      this.add.rectangle(W / 2, H / 2, W, H, 0x5a8f3c);
      this.add.rectangle((RIVER.left + RIVER.right) / 2, H / 2, RIVER.right - RIVER.left, H, 0x2f6f9f);
      this.add.rectangle((BRIDGE.left + BRIDGE.right) / 2, deckY, BRIDGE.right - BRIDGE.left, deckHeight, 0x8a5a2b);
      for (let x = BRIDGE.left + 8; x < BRIDGE.right; x += 12) this.add.rectangle(x, deckY, 2, deckHeight, 0x6b4420);
      this.add.rectangle(440, 118, 3, 30, 0x3a2a14);
      this.add.triangle(452, 110, 0, 0, 22, 7, 0, 14, 0xf2b34d);

      // The sign, the troll standing on the bridge, and the player. Whatever stands lower on the screen is drawn in
      // front (depth follows the feet).
      this.sign = this.add.image(130, 92, "sign").setScale(SCALE).setDepth(92 + 32);
      this.troll = this.add.image((RIVER.left + RIVER.right) / 2, deckY, "troll").setScale(SCALE);
      this.troll.setDepth(this.troll.y + 32);
      this.player = this.add.image(60, 140, "player").setScale(SCALE);
      this.prompt = this.add.text(0, 0, "", { fontFamily: "VT323, monospace", fontSize: "16px", color: "#ffffff", backgroundColor: "#000000aa" })
        .setPadding(3, 1).setResolution(4).setVisible(false).setDepth(TOP);

      // Arrow keys or WASD to walk, E, Space, or Enter to read or talk. No key capture, so typing in the box works.
      this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE,ENTER,R", false);
      // Phaser hands this frame's key events to listeners again each time another key event arrives, so remember
      // which ones were handled: each press acts once. (Otherwise an E just handled, or a letter typed in the box,
      // could reopen the box when the next key arrives in the same frame, such as Escape or an arrow key.)
      const handled = new WeakSet();
      this.input.keyboard.on("keydown", (event) => {
        if (handled.has(event)) return;
        handled.add(event);
        if (this.talking) return;
        if (["e", " ", "Enter"].includes(event.key)) this.interact();
        if (event.key === "r" && (this.ended || this.npc.outOfPatience)) this.scene.restart();
      });
      // On a phone, tap where to walk, or tap the sign or the troll when you're next to them.
      this.input.on("pointerdown", (pointer) => {
        if (this.talking) return;
        const near = this.nearby();
        const tapped = near && Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, near.x, near.y) < 40;
        if (tapped) this.interact(); else this.target = { x: pointer.worldX, y: pointer.worldY };
      });
      form.onsubmit = (event) => { event.preventDefault(); this.say(input.value); };
      document.getElementById("dialogue-close").onclick = () => this.closeDialogue();
    }

    /** The sign or the troll, if the player is close enough to use them. */
    nearby() {
      const d = (thing) => Phaser.Math.Distance.Between(this.player.x, this.player.y, thing.x, thing.y);
      if (d(this.sign) < 56) return { x: this.sign.x, y: this.sign.y, what: "read", thing: "sign" };
      if (!this.passed && d(this.troll) < 72) return { x: this.troll.x, y: this.troll.y, what: "talk", thing: "troll" };
      return null;
    }

    update(time, delta) {
      if (this.talking || this.ended) return;
      // Walk: keys first, otherwise towards a tapped spot.
      let dx = (this.keys.RIGHT.isDown || this.keys.D.isDown) - (this.keys.LEFT.isDown || this.keys.A.isDown);
      let dy = (this.keys.DOWN.isDown || this.keys.S.isDown) - (this.keys.UP.isDown || this.keys.W.isDown);
      if (dx || dy) this.target = null;
      else if (this.target) {
        const tx = this.target.x - this.player.x, ty = this.target.y - this.player.y;
        if (Math.hypot(tx, ty) < 3) this.target = null; else [dx, dy] = [tx, ty];
      }
      if (dx) this.player.setFlipX(dx < 0);   // the art faces right; walking left mirrors it
      const length = Math.hypot(dx, dy) || 1, step = (SPEED * delta) / 1000;
      const x = Phaser.Math.Clamp(this.player.x + (dx / length) * step, 24, W - 24);
      const y = Phaser.Math.Clamp(this.player.y + (dy / length) * step, 30, H - FEET.bottom - 2);
      // Move if the feet stay on dry land (or the deck), else slide along the bank, else stay put.
      const spot = [[x, y], [x, this.player.y], [this.player.x, y]].find(([px, py]) => this.canStand(px, py));
      if (spot) this.player.setPosition(...spot);
      this.player.setDepth(this.player.y + FEET.bottom);

      const near = this.nearby();
      this.prompt.setVisible(Boolean(near));
      if (near) this.prompt.setText(`E: ${near.what}`).setPosition(this.player.x - 16, Math.max(0, this.player.y - 54));
      if (this.player.x > 430) this.win();
    }

    /** Can the player stand here? Not with their feet in the river, except on the deck once the troll has moved. */
    canStand(x, y) {
      const inWater = x + FEET.right > RIVER.left && x + FEET.left < RIVER.right;
      const onDeck = y + FEET.top >= BRIDGE.top && y + FEET.bottom <= BRIDGE.bottom;
      return !inWater || (this.passed && onDeck);
    }

    interact() {
      const near = this.nearby();
      if (near?.thing === "sign") {
        // Reading the sign teaches the player the troll's secret: now arguments that use it can count.
        this.npc.learn("lonely");
        this.openDialogue("Sign", "TOLL: ONE GOLD CROWN. Scratched underneath: \"Nobody has stopped to talk to him in twenty years.\"", false);
      } else if (near?.thing === "troll") {
        this.openDialogue("Tolly Underarch", this.npc.outOfPatience ? "Tolly has turned his back on you. (Press R to start again.)" : "\"Toll's one gold crown. Can't pay? Then you'd best talk.\"", !this.npc.outOfPatience);
      }
    }

    async say(line) {
      if (!line.trim()) return;
      input.value = "";
      this.addLine("You", line);
      input.disabled = true;
      try {
        // The one Honeytongue call: judge what the player said, as Tolly.
        const result = await this.npc.attempt(line);
        const reply = {
          convinced: "Tolly heaves a sigh and steps aside. \"Go on, then. And come back, mind.\"",
          offended: "Tolly's face darkens. \"Say that again and you'll swim.\"",
        }[result.verdict] ?? result.reaction;
        this.addLine("Tolly", result.outOfPatience ? "Tolly turns his back on you. The talking's over." : reply, result.verdict);
        if (result.verdict === "convinced") this.stepAside();
      } catch (err) {
        this.addLine("", `(Couldn't reach the judge: ${err.message})`);
      } finally {
        input.disabled = this.npc.outOfPatience || this.passed;
        if (!input.disabled) input.focus();
      }
    }

    stepAside() {
      this.passed = true;
      // He climbs down off the deck into the shallows, out of the way (and back under his bridge).
      this.tweens.add({ targets: this.troll, y: BRIDGE.bottom + 44, duration: 700, ease: "Sine.easeInOut",
        onUpdate: () => this.troll.setDepth(this.troll.y + 32) });
    }

    win() {
      this.ended = true;
      this.add.rectangle(W / 2, H / 2, 300, 70, 0x000000, 0.75).setDepth(TOP);
      this.add.text(W / 2, H / 2, "You crossed the bridge!\nPress R, or tap, to play again.", { fontFamily: "VT323, monospace", fontSize: "22px", color: "#f2b34d", align: "center" })
        .setOrigin(0.5).setResolution(4).setDepth(TOP);
      this.input.once("pointerdown", () => this.scene.restart());
    }

    // ---- The dialogue box: plain HTML over the game, so typing and screen readers just work ----

    openDialogue(speaker, text, canReply) {
      this.talking = true;  // while the box is open, the scene ignores keys, so typing never moves the player
      this.prompt.setVisible(false);
      log.replaceChildren();
      this.addLine(speaker, text);
      form.hidden = !canReply;
      box.hidden = false;
      (canReply ? input : document.getElementById("dialogue-close")).focus();
    }

    closeDialogue() {
      box.hidden = true;
      this.talking = false;
    }

    /** One line in the box. Text only, never HTML: what players type can't become markup. */
    addLine(who, text, verdict) {
      const p = document.createElement("p");
      if (who) p.append(Object.assign(document.createElement("b"), { textContent: `${who}: ` }));
      p.append(text);
      if (verdict) p.dataset.verdict = verdict;
      log.append(p);
      log.scrollTop = log.scrollHeight;
    }
  }

  addEventListener("keydown", (event) => { if (event.key === "Escape" && !box.hidden) game.scene.getScene("bridge").closeDialogue(); });
  const game = new Phaser.Game({
    type: Phaser.AUTO, width: W, height: H, parent, pixelArt: true, backgroundColor: "#000000",
    audio: { noAudio: true },
    // Load sprites as plain <img> elements, not through blob: URLs, so a strict CSP's img-src 'self' is enough.
    loader: { imageLoadType: "HTMLImageElement" },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  game.scene.add("bridge", Bridge, true);
  return game;
}
