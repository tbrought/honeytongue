// The web demo's judge when it has a live proxy: Jev through the proxy, falling back to the offline mock when
// that doesn't work, so the game never stops. DOM-free, so test/fallback.test.js can check the policy:
//
// - Refused (a 403: the proxy doesn't accept this page, or runs another version), or Jev unavailable (a bad key,
//   or no credit left): the mock judges for the rest of the session.
// - Busy (rate-limited, a server error, a timeout, or no network): the mock judges that turn, and Jev is tried
//   again after about a minute.
// - After TURN_CAP live turns in this tab, the mock judges from then on, so one visitor can't spend the demo's credit.

/** Addresses a page is served from when someone previews the site on their own computer. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

/**
 * Which judge the page uses: "live" (the proxy in the page's honeytongue-proxy meta tag), "offline" (no proxy set),
 * or "local" (previewing on this computer, which the live proxy would refuse, so the stand-in judges instead).
 * Adding ?live to a local address uses the proxy anyway, for testing one that accepts it.
 */
export function chooseJudge({ proxyUrl, hostname = "", search = "" }) {
  const url = String(proxyUrl ?? "").trim();
  if (!url) return { judge: "offline", url: "" };
  const local = LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost");
  if (local && !new URLSearchParams(search).has("live")) return { judge: "local", url: "" };
  return { judge: "live", url };
}

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

// ---- What the page tells the player about who's judging (shared by the demo scenes and the Phaser page) ----

export const STAND_IN = "Characters here are judged by simple keyword matching, a stand-in for Jev that understands far less. Plain, direct sentences work best.";

/** The note shown with the next reply when the live judge steps aside, or comes back. `version` is this page's. */
export function fallbackNote({ mode, why, err }, version) {
  if (mode === "live") return "Jev is back: it judges your turns again.";
  return {
    busy: "Jev is busy, so the offline stand-in judged that turn. Jev will be tried again in about a minute.",
    version: `This page (Honeytongue ${version}) and the live judge (${err?.proxyVersion ?? "another version"}) are on different versions, ` +
      "so the offline stand-in judges from here on. Reload later: they're usually updated together within minutes.",
    refused: "The live judge turned this page's request away, so the offline stand-in judges from here on.",
    unavailable: "The live demo is resting (its Jev credit may have run out), so the offline stand-in judges from here on. Reload later to try Jev again.",
    cap: `That's this tab's ${TURN_CAP} live turns, so the offline stand-in judges from here on. Thanks for playing so long!`,
  }[why];
}

/**
 * The banner above the game: { label, detail, privacy }. Live Jev comes with the privacy note; the offline stand-in
 * says why Jev stepped aside, if it did, and keeps the privacy note while Jev may come back (a busy pause).
 */
export function banner({ source, fallback, judge, proxyUrl }) {
  if (source === "jev") return { label: "Live: ", detail: "Jev judges everything you type, through the Honeytongue proxy. ", privacy: true };
  const why = fallback && {
    busy: "Jev is busy, so this turn was judged offline; Jev will be tried again shortly. ",
    version: "The live judge is on a different Honeytongue version. ",
    refused: "The live judge turned this page away. ",
    unavailable: "The live demo is resting. ",
    cap: `You've used this tab's ${TURN_CAP} live turns. `,
  }[fallback.why];
  const label = judge === "local" ? "Local preview: judged offline. " : proxyUrl ? "Offline stand-in. " : "Offline preview. ";
  return { label, detail: (why || "") + STAND_IN, privacy: fallback?.mode === "paused" };
}
