# agentpay.so landing worker

Canonical source for the public marketing surface on `agentpay.so`.

Live today this Worker is Cloudflare Worker `agentpay-landing-production`, routes `agentpay.so/*` and `www.agentpay.so/*`. It is **not** the leftover root `index.html` (~3.6k) and it is **not** `apps/docs` (that is `docs.agentpay.so`).

## This week’s public story

- `/` — hosted MCP. Hero CTAs `/start` and `/docs`. Primary install: `npx -y @agentpayxyz/mcp-server`. Optional JS SDK: `@agentpayxyz/sdk`.
- `/start` — Launch $0 on-ramp, **50** free calls, no card. Paid SKU: MCP Builder $39/mo + 75 bps on funded actions.
- `/docs` — short public docs. API: `https://api.agentpay.so`.
- BidDesk stays at `/biddesk` (live paid URL) but is `noindex`, omitted from `sitemap.xml`, and `Disallow` in `robots.txt`.
- Ace and `agentpay.gg` stay dark.

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
