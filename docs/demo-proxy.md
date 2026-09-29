# Deploying the demo's proxy

The web demo plays with Jev through a Cloudflare Worker named `honeytongue-demo` (`examples/demo-worker.js`, configured in `examples/demo-wrangler.toml`). It only judges the four demo scenes, and it only accepts requests from the pages in `ALLOWED_ORIGINS`. Without it, or when it can't answer, the demo falls back to the offline stand-in.

Only the maintainer can do these steps, because they involve accounts, keys, and money.

## Before you start

1. **Check TypeSafe's terms.** Read TypeSafe's terms of service for whether one API key may serve a public app used by anonymous players. The API docs don't cover it. If the terms are unclear, ask TypeSafe before going live.
2. **Create a separate key** named `honeytongue-demo-proxy` in the TypeSafe console. Don't reuse `honeytongue-local-dev`: a separate key can be revoked on its own, and its usage shows up on its own.
3. **Cap the spending.** If TypeSafe lets you set a spending limit on the account or the key, set a low one, such as $5 a month.
   - **If there's no spending limit, use prepaid credit instead:** buy a small balance (such as $5), and turn off automatic top-ups so no card is charged again. When the credit runs out, Jev stops answering, and the demo switches to the offline stand-in with a note that the live demo is resting.
   - **If TypeSafe offers neither,** don't go live yet. The only remaining limits would be the rate limits below.

   For scale: a demo turn is about 1,300 input tokens, so about $0.00005 at $0.042 per million. A tab gets at most 50 live turns (under a third of a cent), and $5 covers about 90,000 turns.

## Deploy

Run these from the repository root, on the commit being released (usually `main` just after the release's pull request is merged), so the Worker's questions match the demo's. The Worker's code, stories, and version must match the demo's exactly.

```
npx wrangler login
npx wrangler deploy --config examples/demo-wrangler.toml
npx wrangler secret put TYPESAFE_API_KEY --config examples/demo-wrangler.toml
```

- `wrangler deploy` prints the Worker's address, like `https://honeytongue-demo.<your-subdomain>.workers.dev`.
- `wrangler secret put` asks for the key. Paste the `honeytongue-demo-proxy` key at that prompt, in your own terminal only, and nowhere else. Setting the secret redeploys the Worker with it.

Then check the proxy from outside, the way the demo uses it:

```
node scripts/check-demo-proxy.js https://honeytongue-demo.<your-subdomain>.workers.dev
```

It checks that the demo's pages may call the proxy, that other sites and other characters are refused, and that the proxy runs this checkout's Honeytongue version. It then plays one Gatehouse turn, which is one live Jev call. It should end with "All checks passed."

## Point the demo at it

Put the address in `docs/play/index.html`:

```html
<meta name="honeytongue-proxy" content="https://honeytongue-demo.<your-subdomain>.workers.dev">
```

Commit and push it, or send the address to the agent to prepare the change. The address isn't secret. Once GitHub Pages updates, the demo's banner says "Live", with the privacy note.

## Later

- **Every release that changes the persuasion questions, the stories, or the personas:** deploy the Worker again from the release's commit, then rerun the check script (Releasing, step 7). Until you do, the demo explains the version mismatch and uses the offline stand-in.
- **Another address, such as honeytongue.dev:** add it to `ALLOWED_ORIGINS` in `examples/demo-wrangler.toml` (comma-separated, no trailing slash), then run `npx wrangler deploy --config examples/demo-wrangler.toml` again. No code changes are needed.
- **Rate limits:**
  - **Now:** the Worker allows 20 requests a minute per address, per Worker instance. Each tab gets 50 live turns. The spending cap backs both up.
  - **With your own domain:** once honeytongue.dev routes to the Worker, you can also add a Cloudflare rate limiting rule on that domain. Such rules work on domains you own, not on workers.dev.
- **Logs:** `npx wrangler tail --config examples/demo-wrangler.toml` shows the Worker's logs as they happen. The proxy logs only a status when Jev fails, never what players typed.
- **Turning it off:** empty the `honeytongue-proxy` meta tag and push, so the demo goes back to the offline stand-in. Then run `npx wrangler delete --config examples/demo-wrangler.toml` and revoke the key.
