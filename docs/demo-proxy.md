# Deploying the demo's proxy

The web demo on honeytongue.dev plays with Jev through a Cloudflare Worker named `honeytongue-demo`:

- **Code:** `examples/demo-worker.js`, configured in `examples/demo-wrangler.toml`.
- **Address:** `https://api.honeytongue.dev/judge`. Every other path answers 404, and there's no workers.dev address.
- **Scope:** it only judges the four demo scenes and the Phaser example's troll (`examples/phaser/character.js`, played at honeytongue.dev/phaser/), and only for the pages listed in `ALLOWED_ORIGINS`: `https://honeytongue.dev`. (`https://tbrought.github.io` was removed in 0.1.0-alpha.11: GitHub redirects it to honeytongue.dev.)
- **Limits:** request bodies up to 17,000 bytes (`MAX_BYTES` in the Worker), and nothing longer than the library itself sends: each character's `memoryLength` of remembered attempts, each story's `recentTurnLength` of recent turns, and so on. These cost nothing to refuse, since refused requests never reach Jev.

Without it, or when it can't answer, the demo falls back to the offline stand-in.

Only the maintainer can do these steps, because they involve accounts, keys, and money.

## Before you start

1. **Check TypeSafe's terms.** Read TypeSafe's terms of service for whether one API key may serve a public app used by anonymous players. The API docs don't cover it. If the terms are unclear, ask TypeSafe before going live.
2. **Create a separate key** named `honeytongue-demo-proxy` in the TypeSafe console. Don't reuse `honeytongue-local-dev`: a separate key can be revoked on its own, and its usage shows up on its own.
3. **Cap the spending.** If TypeSafe lets you set a spending limit on the account or the key, set a low one, such as $5 a month.
   - **If there's no spending limit, use prepaid credit instead:** buy a small balance (such as $5), and turn off automatic top-ups so no card is charged again. When the credit runs out, Jev stops answering, and the demo switches to the offline stand-in with a note that the live demo is resting.
   - **If TypeSafe offers neither,** don't go live yet. The only remaining limits would be the rate limits below.

   For scale: a demo turn is about 1,300 input tokens, so about $0.00005 at $0.042 per million. A tab gets at most 50 live turns (under a third of a cent), and $5 covers about 90,000 turns.
4. **Check that `api.honeytongue.dev` is free.** In the Cloudflare dashboard, open the `honeytongue.dev` zone, then DNS > Records. There must be no existing record named `api`. Cloudflare can't attach a Worker to a hostname that already has a CNAME record.

## Deploy

Run these from the repository root, on the commit being released (usually `main` just after the release's pull request is merged). Deploy from the same commit as the site, so the Worker's code, stories, and version match the demo's (the check script below confirms the version).

```
npx wrangler login
npx wrangler deploy --config examples/demo-wrangler.toml
npx wrangler secret put TYPESAFE_API_KEY --config examples/demo-wrangler.toml
```

- **`wrangler deploy`** creates the Worker and gives it the custom domain `api.honeytongue.dev`. The domain is declared in `examples/demo-wrangler.toml` (`routes`, with `custom_domain = true`), so every later deploy keeps it. Cloudflare creates the DNS record and the certificate for you.
- **`wrangler secret put`** asks for the key. Paste the `honeytongue-demo-proxy` key at that prompt, in your own terminal only, and nowhere else. Setting the secret redeploys the Worker with it.

### Confirm the custom domain

In the Cloudflare dashboard, go to Workers & Pages > `honeytongue-demo` > Settings > Domains & Routes.

- `api.honeytongue.dev` should be listed as a Custom domain, and workers.dev should be off.
- **If the domain is missing** (for example, the deploy reported a DNS conflict), fix the conflict. Then add it with Add > Custom domain > `api.honeytongue.dev`, or deploy again.
- The certificate can take a few minutes to become active.

### Add a rate limiting rule

In the Cloudflare dashboard, open the `honeytongue.dev` zone, then Security > WAF > Rate limiting rules > Create rule. The newer dashboard calls this section Security rules. Fill it in as follows:

- **Rule name:** `demo proxy`
- **If incoming requests match:** URI Path equals `/judge`. The Free plan can only match on the path. That's why the Worker answers on `/judge` alone: every request that can spend credit goes through this rule. On a paid plan you can add Hostname equals `api.honeytongue.dev`.
- **With the same characteristics:** IP.
- **When rate exceeds:** 10 requests per 10 seconds. A player sends a turn every few seconds at most. (Kept at this on 2026-09-29, when the Worker's own limits were tightened. If TypeSafe's usage graph shows the demo's credit going faster than players could spend it, tighten this first, for example to 5 requests per 10 seconds.)
- **Then take action:** Block, for 10 seconds.

The Free plan allows one rate limiting rule, with a 10-second period and a 10-second block.

### Check the proxy

Check it from outside, the way the demo uses it:

```
node scripts/check-demo-proxy.js https://api.honeytongue.dev/judge
```

The script acts as the demo's page, `https://honeytongue.dev`, and checks that:

- the page may call the proxy;
- other paths answer 404;
- other sites (the old `https://tbrought.github.io` included) and other characters are refused;
- bodies over 17,000 bytes, and remembered attempts longer than the library sends, are refused;
- the proxy runs this checkout's Honeytongue version.

It then plays one Gatehouse turn and makes one attempt on the Phaser example's troll: two live Jev calls. It doesn't need your key. It should end with "All checks passed."

## Point the demo at it

Once the check passes, the agent prepares a one-line pull request that puts the address in `docs/play/index.html`:

```html
<meta name="honeytongue-proxy" content="https://api.honeytongue.dev/judge">
```

It only changes the website, so it needs no npm release. Once it's merged and GitHub Pages updates, the demo's banner says "Live", with the privacy note.

## How much one request can cost

The guard only accepts requests shaped like the demo's own, with every free-text field capped at what the library sends. So the most a single accepted request can cost is bounded. `node scripts/headroom.js` measures it:
1. It builds a normal turn, and the largest request the guard accepts, padded with random text in several scripts.
2. It checks each one locally against the Worker's own guard.
3. It sends each to Jev once (5 live calls), and reports the input tokens Jev counts.

`--dry-run` does steps 1 and 2 only, with no live calls.

Measured on 2026-09-29, `jev-1.13.0`, 5 live calls (24,880 tokens in all):

| Request | Bytes | Input tokens | Against a normal turn |
|---|---|---|---|
| A normal turn (the Gatehouse, a few turns in) | 4,193 | 1,450 | 1.00× |
| The largest accepted, padded with ASCII | 7,820 | 4,071 | 2.81× |
| The largest accepted, padded with emoji | 11,184 | 5,402 | 3.73× |
| The largest accepted, padded with emoji and Japanese | 12,057 | 6,018 | 4.15× |
| The largest accepted, padded with Japanese | 14,070 | 7,153 | 4.93× |

**The worst case is Japanese text in every field, at about 5 times a normal turn:** about $0.0003 a request at $0.042 per million input tokens. At Cloudflare's rule (10 requests per 10 seconds per IP), one address sending nothing but worst-case requests could spend about $26 a day. More addresses spend it faster, and the spending cap stops all of it.

That's within what the limits were designed for, so nothing was changed. If it ever needs lowering, the cheapest lever is the demo characters' `maxInputLength` and `memoryLength`. Lowering them trims what the demo sends, then the Worker needs redeploying.

## Testing the page locally

When the demo page runs on `localhost` or `127.0.0.1` (for example with `npx serve docs`), it judges offline with a "Local preview" note instead of calling the proxy, which refuses local pages. To test against a proxy that accepts your local address, add `?live` to the page's address.

## Later

- **Every release, whatever it changed:** deploy the Worker again from the release's commit, then rerun the check script (step 8 of "Releasing" in `CLAUDE.md`). The Worker judges a request by its questions and state only, not by the version it came from, so an older Worker keeps judging a newer page until what the library sends changes (new persuasion questions, stories, personas, or the Phaser example's troll). From then on it refuses the page's requests, and the demo explains the version mismatch and uses the offline stand-in. Redeploying on every release means nobody has to work out which case applies, and the check script fails until the Worker runs the release's version.
- **Another page address:** add it to `ALLOWED_ORIGINS` in `examples/demo-wrangler.toml` (comma-separated, no trailing slash), then run `npx wrangler deploy --config examples/demo-wrangler.toml` again. No code changes are needed.
- **Limits, all together:**
  - Cloudflare's rule: 10 requests per 10 seconds per IP. Tighten it if the usage graph shows abuse.
  - The Worker's own limit: 20 requests a minute per address, per Worker instance. Cloudflare runs many instances, so this is only a first line of defence.
  - The request guard: only the demo's own requests, no bigger than the library sends them (a scripted request can cost at most about 5 times a normal turn's tokens: see "How much one request can cost").
  - 50 live turns per tab. This is a courtesy to players, kept in the browser: a script ignores it.
  - The spending cap behind all of them: the only hard limit on cost. If a script uses it up, the demo switches to the offline stand-in until the next top-up.
- **If abuse appears:** tighten Cloudflare's rule first. After that, a daily quota per address (Workers KV or a Durable Object) or Cloudflare Turnstile before the first live turn; both are on the roadmap, only if needed.
- **Logs:** `npx wrangler tail --config examples/demo-wrangler.toml` shows the Worker's logs as they happen. The proxy logs only a status when Jev fails, never what players typed.
- **Turning it off:** empty the `honeytongue-proxy` meta tag and push, so the demo goes back to the offline stand-in. Then run `npx wrangler delete --config examples/demo-wrangler.toml` and revoke the key.
