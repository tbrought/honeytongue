// A small Phaser game with a Honeytongue character: walk to the bridge, read the sign, and talk the troll into
// letting you cross. Phaser draws the world; Honeytongue judges what you say; this file decides what happens.
//
// startGame(Phaser, { parent, createNpc }) needs a <div id="dialogue"> dialogue box on the page (see index.html)
// and a createNpc() that returns a new Persuadable (see main.js). Everything is drawn with shapes: no image files.

const W = 480, H = 270;                                   // the game's size; Phaser scales it to fit the page
const RIVER = { left: 200, right: 280 };                  // where the water is
const BRIDGE = { top: 118, bottom: 152 };                 // the band you can cross on, once the troll steps aside
const SPEED = 90;                                         // walking speed, pixels per second

export function startGame(Phaser, { parent, createNpc }) {
  const box = document.getElementById("dialogue");
  const log = document.getElementById("dialogue-log");
  const form = document.getElementById("dialogue-form");
  const input = document.getElementById("dialogue-input");

  class Bridge extends Phaser.Scene {
    create() {
      this.npc = createNpc();          // a fresh Persuadable each time the scene starts
      this.passed = false;             // has the troll stepped aside?
      this.talking = false;            // is the dialogue box open?
      this.ended = false;              // has the player crossed?
      this.target = null;              // where a tap asked the player to walk

      // The world: grass, the river, the bridge, the sign, and the far bank's flag.
      this.add.rectangle(W / 2, H / 2, W, H, 0x5a8f3c);
      this.add.rectangle((RIVER.left + RIVER.right) / 2, H / 2, RIVER.right - RIVER.left, H, 0x2f6f9f);
      this.add.rectangle(240, 135, 100, BRIDGE.bottom - BRIDGE.top, 0x8a5a2b);
      for (let x = 196; x < 290; x += 10) this.add.rectangle(x, 135, 2, 34, 0x6b4420);
      this.add.rectangle(160, 112, 4, 24, 0x6b4420);
      this.sign = this.add.rectangle(160, 100, 26, 14, 0xc89b5c);
      this.add.rectangle(440, 118, 3, 30, 0x3a2a14);
      this.add.triangle(452, 110, 0, 0, 22, 7, 0, 14, 0xf2b34d);

      // The troll (a big green block with eyes) and the player (a small amber one).
      this.troll = this.add.container(240, 128, [
        this.add.rectangle(0, 0, 30, 38, 0x6b8f3a),
        this.add.rectangle(-7, -8, 5, 5, 0xffffff), this.add.rectangle(7, -8, 5, 5, 0xffffff),
        this.add.rectangle(-7, -8, 2, 2, 0x000000), this.add.rectangle(7, -8, 2, 2, 0x000000),
      ]);
      this.player = this.add.rectangle(60, 135, 12, 16, 0xf2b34d);
      this.prompt = this.add.text(0, 0, "", { fontFamily: "VT323, monospace", fontSize: "16px", color: "#ffffff", backgroundColor: "#000000aa" })
        .setPadding(3, 1).setResolution(4).setVisible(false);

      // Arrow keys or WASD to walk, E, Space, or Enter to read or talk. No key capture, so typing in the box works.
      this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE,ENTER,R", false);
      this.input.keyboard.on("keydown", (event) => {
        if (this.talking) return;
        if (["e", " ", "Enter"].includes(event.key)) this.interact();
        if (event.key === "r" && (this.ended || this.npc.outOfPatience)) this.scene.restart();
      });
      // On a phone, tap where to walk, or tap the sign or the troll when you're next to them.
      this.input.on("pointerdown", (pointer) => {
        if (this.talking) return;
        const near = this.nearby();
        const tapped = near && Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, near.x, near.y) < 30;
        if (tapped) this.interact(); else this.target = { x: pointer.worldX, y: pointer.worldY };
      });
      form.onsubmit = (event) => { event.preventDefault(); this.say(input.value); };
      document.getElementById("dialogue-close").onclick = () => this.closeDialogue();
    }

    /** The sign or the troll, if the player is close enough to use them. */
    nearby() {
      const d = (thing) => Phaser.Math.Distance.Between(this.player.x, this.player.y, thing.x, thing.y);
      if (d(this.sign) < 34) return { x: this.sign.x, y: this.sign.y, what: "read", thing: "sign" };
      if (!this.passed && d(this.troll) < 60) return { x: this.troll.x, y: this.troll.y, what: "talk", thing: "troll" };
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
      const length = Math.hypot(dx, dy) || 1, step = (SPEED * delta) / 1000;
      let x = this.player.x + (dx / length) * step, y = this.player.y + (dy / length) * step;
      // The river: impassable, except on the bridge once the troll has stepped aside.
      const onBridge = y > BRIDGE.top + 8 && y < BRIDGE.bottom - 8;
      if (x > RIVER.left - 8 && x < RIVER.right + 8 && !(this.passed && onBridge)) x = this.player.x < RIVER.left ? RIVER.left - 8 : RIVER.right + 8;
      this.player.setPosition(Phaser.Math.Clamp(x, 8, W - 8), Phaser.Math.Clamp(y, 16, H - 10));

      const near = this.nearby();
      this.prompt.setVisible(Boolean(near));
      if (near) this.prompt.setText(`E: ${near.what}`).setPosition(this.player.x - 16, this.player.y - 30);
      if (this.player.x > 430) this.win();
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
      this.tweens.add({ targets: this.troll, y: 186, duration: 700, ease: "Sine.easeInOut" });
    }

    win() {
      this.ended = true;
      this.add.rectangle(W / 2, H / 2, 300, 70, 0x000000, 0.75);
      this.add.text(W / 2, H / 2, "You crossed the bridge!\nPress R, or tap, to play again.", { fontFamily: "VT323, monospace", fontSize: "22px", color: "#f2b34d", align: "center" })
        .setOrigin(0.5).setResolution(4);
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
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  game.scene.add("bridge", Bridge, true);
  return game;
}
