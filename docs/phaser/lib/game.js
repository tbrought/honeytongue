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

// What the sign says. The scratched line is the clue (it teaches his secret), so it's emphasised: { em } parts are
// shown in an <em>, which the page's stylesheet colours.
export const SIGN = ["TOLL: ONE GOLD CROWN. Scratched underneath: \"", { em: "Nobody has stopped to talk to him in twenty years." }, "\""];

// Tolly's own lines. Honeytongue judges what the player said; the game picks what he says back.
export const LINES = {
  // His greeting points to the sign until the player has read it: the sign teaches what he really wants.
  greeting: "\"Toll's one gold crown. Can't pay? Then you'd best talk.\"",
  greetingUnread: "\"Toll's one gold crown. Says so on the sign, if you can read. Can't pay? Then you'd best talk.\"",
  turnedAway: "Tolly has turned his back on you.", // the box offers "Start again (R)" below it
  convinced: "Tolly heaves a sigh and steps aside. \"Go on, then. And come back, mind.\"",
  offended: "Tolly's face darkens. \"Say that again and you'll swim.\"",
  outOfPatience: "Tolly turns his back on you. The talking's over.",
  // Threats don't move him (his persona says they make him laugh), but Jev still notices them: result.triggered
  // names the threat, so he laughs at it instead of quoting the toll. Used in turn, so a second threat sounds new.
  laughs: [
    "Tolly throws back his head and laughs until the bridge shakes. \"You? You couldn't reach my knees without a ladder.\"",
    "Tolly wipes a tear from his eye. \"Oh, that's a good one. Still one gold crown, mind.\"",
    "Tolly leans down until his nose nearly touches yours. \"Boo.\" Then he chuckles all the way back up.",
  ],
};

/**
 * What Tolly says to a judged line, and whether he laughs. A turn that ends the talking or changes the game comes
 * first, then a laugh at a threat that didn't offend him, then his reaction for how close the line came. `laughed`
 * counts his laughs so far, to take the next line in turn.
 */
export function tollyReply(result, laughed = 0) {
  if (result.outOfPatience) return { text: LINES.outOfPatience, laugh: false };
  if (result.verdict === "convinced" || result.verdict === "offended") return { text: LINES[result.verdict], laugh: false };
  if (result.verdict === "unconvinced" && result.triggered.includes("threats")) {
    return { text: LINES.laughs[laughed % LINES.laughs.length], laugh: true };
  }
  return { text: result.reaction, laugh: false };
}

export function startGame(Phaser, { parent, createNpc, assets = "assets/" }) {
  const box = document.getElementById("dialogue");
  const log = document.getElementById("dialogue-log");
  const form = document.getElementById("dialogue-form");
  const input = document.getElementById("dialogue-input");
  const restart = document.getElementById("dialogue-restart");

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
      this.laughed = 0;                // how many threats he's laughed at

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
      // A "!" over the sign until it's read, as games mark something worth a look. It bobs, except under reduced motion.
      this.mark = this.add.text(this.sign.x, this.sign.y - 48, "!", { fontFamily: "VT323, monospace", fontSize: "38px",
        color: "#f2b34d", stroke: "#3a2a14", strokeThickness: 5 }).setOrigin(0.5).setResolution(4).setDepth(TOP - 1);
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        this.tweens.add({ targets: this.mark, y: this.mark.y - 4, duration: 450, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      }

      // Arrow keys or WASD to walk, E, Space, or Enter to read or talk. No key capture, so typing in the box works.
      this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE,ENTER,R", false);
      // Single presses come from Phaser's keydown events, not from polling JustDown in update(): JustDown misses a
      // press and release within one frame, which on-screen keyboards, voice control, and other assistive tools send.
      // But Phaser hands a frame's key events to its listeners again whenever another key event arrives in the same
      // frame, so remember which ones were handled: each press acts once. (Otherwise a letter typed in the box, then
      // Escape, or an E then an arrow key, within one frame, would open the box again.)
      const handled = new WeakSet();
      this.input.keyboard.on("keydown", (event) => {
        if (handled.has(event)) return;
        handled.add(event);
        if (event.ctrlKey || event.metaKey || event.altKey) return; // the browser's shortcuts, such as Ctrl+R
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key; // so Caps Lock's E and R work too
        // R starts again once the game is over, even with the box open: the text field is disabled then, so an "r"
        // can't be part of a line. And never while the field has focus and takes typing, whatever the game's state.
        const typing = event.target === input && !input.disabled;
        if (key === "r" && this.over() && !typing) {
          event.preventDefault();
          this.startAgain();
          return;
        }
        if (this.talking) return;
        // A press that opens the box moves focus into it while the browser is still handling that press, so cancel
        // its default action: otherwise E or Space would type into the box, and Enter would press its Leave button.
        if (["e", " ", "Enter"].includes(key) && this.interact()) event.preventDefault();
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
      restart.onclick = () => this.startAgain(); // for touch and screen readers, which have no R
    }

    /** Is the game over: crossed, or Tolly out of patience? Then R (or the box's button) starts again. */
    over() {
      return this.ended || this.npc.outOfPatience;
    }

    /** A new game. The dialogue box is the page's, not the scene's, so close and reset it first. */
    startAgain() {
      this.closeDialogue();
      restart.hidden = true;
      this.scene.restart();
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
      this.mark?.setVisible(near?.thing !== "sign"); // next to the sign, "E: read" takes its place
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

    /** Read the sign or talk to the troll, if the player is next to one. True if it opened the dialogue box. */
    interact() {
      const near = this.nearby();
      if (near?.thing === "sign") {
        // Reading the sign teaches the player the troll's secret: now arguments that use it can count.
        this.npc.learn("lonely");
        this.mark?.destroy();
        this.mark = null;
        this.openDialogue("Sign", SIGN, false);
      } else if (near?.thing === "troll") {
        const greeting = this.npc.outOfPatience ? LINES.turnedAway : this.npc.knows.has("lonely") ? LINES.greeting : LINES.greetingUnread;
        this.openDialogue("Tolly Underarch", greeting, !this.npc.outOfPatience, this.npc.outOfPatience);
      }
      return Boolean(near);
    }

    async say(line) {
      if (!line.trim()) return;
      input.value = "";
      this.addLine("You", line);
      input.disabled = true;
      try {
        // The one Honeytongue call: judge what the player said, as Tolly.
        const result = await this.npc.attempt(line);
        const reply = tollyReply(result, this.laughed);
        this.addLine("Tolly", reply.text, result.verdict);
        if (reply.laugh) { this.laughed++; this.laugh(); }
        if (result.verdict === "convinced") this.stepAside();
      } catch (err) {
        this.addLine("", `(Couldn't reach the judge: ${err.message})`);
      } finally {
        input.disabled = this.npc.outOfPatience || this.passed;
        restart.hidden = !this.npc.outOfPatience; // his last reply: offer to start again, and focus it
        if (!input.disabled) input.focus();
        else if (!restart.hidden) restart.focus();
      }
    }

    /** He shakes with laughter, and so does the bridge. Not under reduced motion: the reply says it anyway. */
    laugh() {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      this.tweens.killTweensOf(this.troll);
      this.troll.y = (BRIDGE.top + BRIDGE.bottom) / 2; // back on his spot, if he was still laughing at the last one
      this.tweens.add({ targets: this.troll, y: this.troll.y - 4, duration: 90, yoyo: true, repeat: 3, ease: "Sine.easeOut" });
      this.cameras.main.shake(250, 0.004);
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

    openDialogue(speaker, text, canReply, canRestart = false) {
      this.talking = true;  // while the box is open, the scene ignores keys, so typing never moves the player
      this.prompt.setVisible(false);
      log.replaceChildren();
      this.addLine(speaker, text);
      form.hidden = !canReply;
      // The box is the page's, not the scene's, so it outlives a restart (R): set it from this game every time.
      input.disabled = !canReply;
      restart.hidden = !canRestart;
      box.hidden = false;
      (canReply ? input : canRestart ? restart : document.getElementById("dialogue-close")).focus();
    }

    closeDialogue() {
      box.hidden = true;
      this.talking = false;
    }

    /**
     * One line in the box: a string, or a list of strings and { em } parts to emphasise. Text only, never HTML: what
     * players type can't become markup.
     */
    addLine(who, text, verdict) {
      const p = document.createElement("p");
      if (who) p.append(Object.assign(document.createElement("b"), { textContent: `${who}: ` }));
      for (const part of [text].flat()) {
        p.append(typeof part === "string" ? part : Object.assign(document.createElement("em"), { textContent: part.em }));
      }
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
