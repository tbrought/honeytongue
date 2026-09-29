# Deploying the demo's proxy

The web demo on honeytongue.dev plays with Jev through a Cloudflare Worker named `honeytongue-demo`:

- **Code:** `examples/demo-worker.js`, configured in `examples/demo-wrangler.toml`.
- **Address:** `https://api.honeytongue.dev/judge`. Every other path answers 404, and there's no workers.dev address.
- **Scope:** it only judges the four demo scenes, and only for the pages listed in `ALLOWED_ORIGINS`: `https://honeytongue.dev` first, with `https://tbrought.github.io` as a fallback.

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

Run these from the repository root, on the commit being released (usually `main` just after the release's pull request is merged). The Worker's code, stories, and version must match the demo's exactly.

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
- **When rate exceeds:** 10 requests per 10 seconds. A player sends a turn every few seconds at most.
- **Then take action:** Block, for 10 seconds.

The Free plan allows one rate limiting rule, with a 10-second period and a 10-second block.

### Check the proxy

Check it from outside, the way the demo uses it:

```
node scripts/check-demo-proxy.js https://api.honeytongue.dev/judge
```

The script acts as the demo's pages, `https://honeytongue.dev` and then `https://tbrought.github.io`, and checks that:

- both pages may call the proxy;
- other paths answer 404;
- other sites and other characters are refused;
- the proxy runs this checkout's Honeytongue version.

It then plays one Gatehouse turn, which is one live Jev call. It doesn't need your key. It should end with "All checks passed."

## Point the demo at it

Once the check passes, the agent prepares a one-line pull request that puts the address in `docs/play/index.html`:

```html
<meta name="honeytongue-proxy" content="https://api.honeytongue.dev/judge">
```

It only changes the website, so it needs no npm release. Once it's merged and GitHub Pages updates, the demo's banner says "Live", with the privacy note.

## Later

- **Every release that changes the persuasion questions, the stories, or the personas:** deploy the Worker again from the release's commit, then rerun the check script (Releasing, step 7). Until you do, the demo explains the version mismatch and uses the offline stand-in.
- **Another page address:** add it to `ALLOWED_ORIGINS` in `examples/demo-wrangler.toml` (comma-separated, no trailing slash), then run `npx wrangler deploy --config examples/demo-wrangler.toml` again. No code changes are needed. Once GitHub stops redirecting from `tbrought.github.io`, you can remove that address the same way.
- **Rate limits, all together:**
  - Cloudflare's rule: 10 requests per 10 seconds per IP.
  - The Worker's own limit: 20 requests a minute per address, per Worker instance.
  - 50 live turns per tab.
  - The spending cap behind all of them.
- **Logs:** `npx wrangler tail --config examples/demo-wrangler.toml` shows the Worker's logs as they happen. The proxy logs only a status when Jev fails, never what players typed.
- **Turning it off:** empty the `honeytongue-proxy` meta tag and push, so the demo goes back to the offline stand-in. Then run `npx wrangler delete --config examples/demo-wrangler.toml` and revoke the key.
