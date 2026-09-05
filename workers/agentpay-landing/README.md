# agentpay.so landing worker

Canonical source for the public marketing surface on `agentpay.so`.

Live today this Worker is Cloudflare Worker `agentpay-landing-production`, routes `agentpay.so/*` and `www.agentpay.so/*`. It is **not** the leftover root `index.html` (~3.6k) and it is **not** `apps/docs` (that is `docs.agentpay.so`).

## This week’s public story

- `/` and `/start` — one H1: *Your agent can pay with a card or with crypto. One key. You set the limit.* Primary CTA is get a key / 50 free calls. Launch $0. `$39` is next-step copy, not a buy button.
- Primary install: `npx -y @agentpayxyz/mcp-server`. Optional JS SDK: `@agentpayxyz/sdk`.
- `/docs` — short public docs. API: `https://api.agentpay.so`.
- `$7` Awesome Free Dev Tools, BidDesk, Postizzz, and Ace are off the homepage. BidDesk stays at `/biddesk` (200, `noindex`, off sitemap). Ace and `agentpay.gg` stay dark.

## Verify locally

```bash
node --check worker.js
node --test worker.test.mjs
```

`verify-routing.mjs` hits **production**. Do not treat a local pass of that script as a deploy.

## Deploy (not done in this PR)

Requires Cloudflare auth this repo does not have in CI:

- `CLOUDFLARE_API_TOKEN`
- `CONFIRM_DEPLOY_ROUTING=agentpay.so/routing-404` for `deploy-routing-fix.sh`
- Node >= 22 (wrangler 4.x)

Until someone with zone access deploys `agentpay-landing-production`, production will keep serving the stale Worker (hero `/start` and `/docs` 404, wrong npm names, BidDesk in the live sitemap).

Rollback: `wrangler versions deploy --name agentpay-landing-production` to the previous 100% version id recorded by `deploy-routing-fix.sh`.
