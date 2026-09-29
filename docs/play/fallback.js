// The web demo's judge when it has a live proxy: Jev through the proxy, falling back to the offline mock when
// that doesn't work, so the game never stops. DOM-free, so test/fallback.test.js can check the policy:
//
// - Refused (a 403: the proxy doesn't accept this page, or runs another version), or Jev unavailable (a bad key,
//   or no credit left): the mock judges for the rest of the session.
// - Busy (rate-limited, a server error, a timeout, or no network): the mock judges that turn, and Jev is tried
//   again after about a minute.
// - After TURN_CAP live turns in this tab, the mock judges from then on, so one visitor can't spend the demo's credit.

export const TURN_CAP = 50;
export const RETRY_AFTER_MS = 60_000;
const COUNT_KEY = "honeytongue-live-turns";

/** Why the mock is judging instead of Jev, from a failed request: an off reason (for the session) or "busy". */
export function whyFailed(err) {
  if (err?.status === 403) return err.reason === "version" ? "version" : "refused";
  if (err?.reason === "unavailable") return "unavailable";
  return "busy";
}

/**
 * A client that asks `live` and falls back to `mock`. `onChange({ mode, why, err })` is called when it
 * switches: mode "live", "paused" (busy: the mock for now), or "off" (the mock for the session), with why
 * "busy", "version", "refused", "unavailable", or "cap". `storage` (sessionStorage) keeps the turn count per tab.
 */
export function createFallbackClient({ live, mock, cap = TURN_CAP, retryAfterMs = RETRY_AFTER_MS, now = Date.now, storage, onChange = () => {} }) {
  let off = null;          // why the mock judges for the rest of the session
  let pausedUntil = 0;     // while busy, the mock judges until then
  const read = () => { try { return Number(storage?.getItem(COUNT_KEY)) || 0; } catch { return 0; } };
  let turns = read();
  const count = () => {
    turns = Math.max(turns, read()) + 1; // another page of the demo in this tab may have counted too
    try { storage?.setItem(COUNT_KEY, String(turns)); } catch { /* private mode: the count lasts as long as the page */ }
  };
  const turnOff = (why, err) => { off = why; onChange({ mode: "off", why, err }); };

  return {
    get turnsUsed() { return turns; },
    get mode() { return off ? "off" : now() < pausedUntil ? "paused" : "live"; },

    async ask(state, questions) {
      if (!off && Math.max(turns, read()) >= cap) turnOff("cap");
      if (off || now() < pausedUntil) return mock.ask(state, questions);
      const wasPaused = pausedUntil > 0;
      count();
      try {
        const answers = await live.ask(state, questions);
        if (wasPaused) { pausedUntil = 0; onChange({ mode: "live" }); }
        return answers;
      } catch (err) {
        const why = whyFailed(err);
        if (why === "busy") {
          pausedUntil = now() + retryAfterMs;
          onChange({ mode: "paused", why, err });
        } else {
          turnOff(why, err);
        }
        return mock.ask(state, questions);
      }
    },
  };
}
