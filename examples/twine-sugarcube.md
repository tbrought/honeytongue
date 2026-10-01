# Honeytongue in Twine (SugarCube 2)

Tested in the Twine web app, Twine 2.12.0 with SugarCube 2.37.3, using the offline stand-in (`createMockClient()`): winning, an empty line, and running out of patience all work, with no console errors. Two parts haven't been tested inside Twine yet: saving and loading (the `:passagestart` handler and `$harry`, added in 0.1.0-alpha.14), and judging with Jev through a proxy.

## 1. Story JavaScript

```js
setup.ready = import("https://cdn.jsdelivr.net/npm/honeytongue@alpha/src/index.js")
  .then(function (hon) {
    setup.harry = new hon.Persuadable({
      name: "Harry",
      persona: "A tired night guard who values honesty and can't stand flattery. A sick child moves him.",
      goal: "Open the gate after curfew",
      patience: 4,
    }, { client: hon.createMockClient() });
  });

// Harry's memory and patience are kept in $harry, so saves, loads, and Back carry them.
$(document).on(":passagestart", function () {
  setup.ready.then(function () {
    if (State.variables.harry) setup.harry.restore(State.variables.harry);
    else setup.harry.reset();
  });
});
```

`setup.ready` finishes once Honeytongue has loaded, a moment after the story starts, so the button waits for it.

Harry's state is a plain object from `setup.harry.snapshot()`, kept in the story variable `$harry` after each attempt. At the start of every passage, `setup.harry.restore()` puts it back, so SugarCube's saves, loads, and Back button all carry his memory and patience. With no `$harry` yet, he starts fresh.

> The save and load part hasn't been tested inside Twine yet. If something doesn't work, please open an issue.

## 2. A passage called "At the gate" (the start passage)

```
Harry blocks the gate.

<<if $reply>>$reply<</if>>

<<textbox "_plea" "">>
<<button "Say it">>
  <<run (function (plea) {
    setup.ready
      .then(function () { return setup.harry.attempt(plea); })
      .then(function (r) {
        State.variables.harry = setup.harry.snapshot();
        State.variables.reply = r.reaction || "Harry glares at you.";
        if (r.verdict === "convinced") { Engine.play("Through the gate"); }
        else if (r.outOfPatience) { Engine.play("The cell"); }
        else { Engine.play("At the gate"); }
      })
      .catch(function () {
        State.variables.reply = "Say something first.";
        Engine.play("At the gate");
      });
  })(_plea)>>
<</button>>
```

`r.reaction` is only set for unconvinced and repeated verdicts, so an offensive line gets "Harry glares at you." An empty line makes `attempt()` throw, and the `catch` asks the player to say something.

## 3. The two endings

A passage called "Through the gate":

```
Harry lifts the bar. You're through! <<link "Play again" "At the gate">><<unset $harry>><<set $reply to "">><</link>>
```

A passage called "The cell":

```
"Enough," Harry says, and calls the watch. <<link "Try again" "At the gate">><<unset $harry>><<set $reply to "">><</link>>
```

## Judging with Jev

> This part hasn't been tested inside Twine yet. If something doesn't work, please open an issue.

Twine stories run in the player's browser, so judging with Jev needs a proxy that keeps your API key private. Deploy `examples/cloudflare-worker.js` first, with your story's published address in `allowedOrigins` and your character in `allowedCharacters` (exactly as the story passes it to `Persuadable`). If you're not sure what that address is, try the story once: the error message names the exact origin to add. Then swap the client:

```js
{ client: hon.createProxyClient({ url: "https://honeytongue-proxy.your-name.workers.dev" }) }
```

With a proxy, an error can also mean the proxy couldn't be reached or refused the request, not only an empty line, so show the error's `message` in the `catch` instead of "Say something first."

## Things to know

- `setup.harry` itself lives in memory; its state lives in `$harry`, which SugarCube saves with everything else. The endings' links unset `$harry`, so the next passage starts Harry fresh.
- A quick double click sends the line twice: if the first doesn't convince, the second counts as a repeat and costs patience too. If that matters, disable the button until the reply comes back.
- Use `setup.harry.learn("secret_id")` in the passage where the player discovers a secret.
