import { test } from "node:test";
import assert from "node:assert/strict";
import { createFallbackClient, whyFailed, TURN_CAP } from "../docs/play/fallback.js";

const error = (status, reason) => Object.assign(new Error(`failed ${status}`), { status, reason });
const answer = (source) => ({ [Symbol.for("honeytongue.source")]: source });

/** A live client that answers, or throws each error in `failures` in turn (null means answer). */
function setup({ failures = [], cap, storage } = {}) {
  let t = 0;
  const calls = { live: 0, mock: 0 };
  const changes = [];
  const client = createFallbackClient({
    live: { async ask() { calls.live++; const f = failures.shift(); if (f) throw f; return answer("jev"); } },
    mock: { async ask() { calls.mock++; return answer("mock"); } },
    cap, storage, now: () => t,
    onChange: (c) => changes.push(c.why ? `${c.mode}:${c.why}` : c.mode),
  });
  return { client, calls, changes, wait: (ms) => { t += ms; } };
}
const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test("whyFailed sorts proxy failures into the demo's fallback policy", () => {
  assert.equal(whyFailed(error(403, "version")), "version");
  assert.equal(whyFailed(error(403, "not-allowed")), "refused");
  assert.equal(whyFailed(error(403, "state")), "refused");
  assert.equal(whyFailed(error(403)), "refused", "an origin refusal has no reason");
  assert.equal(whyFailed(error(502, "unavailable")), "unavailable");
  for (const e of [error(429), error(502, "busy"), error(502, "error"), error(503), new Error("Request timed out"), new Error("network")]) {
    assert.equal(whyFailed(e), "busy", e.message);
  }
});

test("refused, a version mismatch, or no credit: the mock judges for the rest of the session", async () => {
  for (const [failure, why] of [[error(403, "version"), "version"], [error(403, "not-allowed"), "refused"], [error(502, "unavailable"), "unavailable"]]) {
    const { client, calls, changes, wait } = setup({ failures: [failure] });
    const source = async () => (await client.ask({}, {}))[Symbol.for("honeytongue.source")];
    assert.equal(await source(), "mock", "the failed turn is still answered");
    wait(10 * 60_000);
    assert.equal(await source(), "mock");
    assert.deepEqual(calls, { live: 1, mock: 2 }, "Jev isn't tried again");
    assert.deepEqual(changes, [`off:${why}`]);
    assert.equal(client.mode, "off");
  }
});

test("busy, a server error, or no network: the mock answers that turn, and Jev is tried again after a minute", async () => {
  const { client, calls, changes, wait } = setup({ failures: [error(429), null] });
  await client.ask({}, {});
  assert.equal(client.mode, "paused");
  wait(30_000);
  await client.ask({}, {});
  assert.deepEqual(calls, { live: 1, mock: 2 }, "still the mock within the minute");
  wait(31_000);
  await client.ask({}, {});
  assert.deepEqual(calls, { live: 2, mock: 2 }, "Jev again after it");
  assert.deepEqual(changes, ["paused:busy", "live"]);
  assert.equal(client.mode, "live");
});

test("after the turn cap, the mock judges for the rest of the tab, even after a reload", async () => {
  assert.equal(TURN_CAP, 50);
  const storage = memoryStorage();
  const first = setup({ cap: 3, storage });
  for (let i = 0; i < 5; i++) await first.client.ask({}, {});
  assert.deepEqual(first.calls, { live: 3, mock: 2 });
  assert.deepEqual(first.changes, ["off:cap"]);

  const reloaded = setup({ cap: 3, storage });
  await reloaded.client.ask({}, {});
  assert.deepEqual(reloaded.calls, { live: 0, mock: 1 });
  assert.equal(reloaded.client.turnsUsed, 3);
});

test("the cap still works when storage is blocked", async () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const { client, calls } = setup({ cap: 2, storage: blocked });
  for (let i = 0; i < 4; i++) await client.ask({}, {});
  assert.deepEqual(calls, { live: 2, mock: 2 });
});
