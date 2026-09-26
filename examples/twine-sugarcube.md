# Honeytongue in Twine (SugarCube 2)

> This recipe hasn't been tested in Twine yet. If something doesn't work, please open an issue.

Twine stories run in the player's browser, so you need a proxy to keep your API key private. Deploy `examples/cloudflare-worker.js` first and add your story's published address to `allowedOrigins`. If you're not sure what that address is, try the story once: the error message names the exact origin to add.

## 1. Story JavaScript

```js
import("https://cdn.jsdelivr.net/npm/honeytongue@0.2/src/index.js").then(({ Persuadable, createProxyClient }) => {
  const client = createProxyClient({ url: "https://honeytongue-proxy.your-name.workers.dev" });

  setup.harry = new Persuadable({
    name: "Harry Goatleaf",
    persona: "A tired night guard who values honesty and despises flattery and bribes.",
    goal: "Open the gate after curfew",
    patience: 4,
  }, { client });
});

// Called by the "Say it" button. Ignores empty input and double clicks, and shows errors instead of hiding them.
setup.say = function (plea) {
  if (setup.busy || !setup.harry || !String(plea ?? "").trim()) return;
  setup.busy = true;
  setup.harry.attempt(plea)
    .then(function (r) {
      if (r.verdict === "convinced") return Engine.play("Through the gate");
      if (r.outOfPatience) return Engine.play("The cell");
      State.variables.reaction = r.verdict === "offended" ? "Harry's hand drops to his club." : r.reaction;
      Engine.play("At the gate");
    })
    .catch(function (err) {
      State.variables.reaction = "(Couldn't reach the proxy: " + err.message + ")";
      Engine.play("At the gate");
    })
    .finally(function () { setup.busy = false; });
};
```

## 2. A passage called "At the gate"

```
Harry Goatleaf, the gatekeeper, blocks the gate.

<<if $reaction>>$reaction<</if>>

<<textbox "_plea" "">>
<<button "Say it">><<run setup.say(_plea)>><</button>>
```

Add passages called "Through the gate" and "The cell" for the two endings.

## Things to know

- `setup.harry` lives in memory, so its patience and memory aren't included in SugarCube saves. Reset it when a new game starts with `setup.harry.reset()`.
- The import finishes a moment after the story loads. Until then `setup.say` does nothing, so if players can reach the gate on the very first passage, tell them to wait a second or disable the button until `setup.harry` exists.
- Use `setup.harry.learn("secret_id")` in the passage where the player discovers a secret.
