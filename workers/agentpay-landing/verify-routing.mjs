#!/usr/bin/env node

// Public verification gate for the routing fix: every known route must keep
// working, the paid product route must reach Stripe, and unknown paths must
// 404. The old catch-all returned 200 for everything, which made a dead route
// indistinguishable from a live one — that is exactly what this asserts against.

const base = (process.argv[2] || 'https://agentpay.so').replace(/\/$/, '')
const results = []

function record(url, ok, detail) {
  results.push({ url, ok, detail })
}

async function expectOk(path, required = []) {
  const url = `${base}${path}`
  const response = await fetch(url, { redirect: 'follow' })
  const body = await response.text()
  const missing = required.filter(text => !body.includes(text))
  record(url, response.status === 200 && missing.length === 0, {
    status: response.status,
    missing,
  })
}

// Unknown paths must 404 and must not be a copy of the landing page.
async function expectNotFound(path) {
  const url = `${base}${path}`
  const response = await fetch(url, { redirect: 'manual' })
  const body = await response.text()
  const looksLikeLanding = body.includes('AgentPay Labs is shipping small paid tools')
  record(url, response.status === 404 && !looksLikeLanding, {
    status: response.status,
    looksLikeLanding,
  })
}

// The paid route must redirect to Stripe, not fall through to the landing page.
async function expectStripeRedirect(path) {
  const url = `${base}${path}`
  const response = await fetch(url, { redirect: 'manual' })
  const location = response.headers.get('location') ?? ''
  record(url, response.status === 302 && location.startsWith('https://buy.stripe.com/'), {
    status: response.status,
    location,
  })
}

await expectOk('/', ['AgentPay', 'Privacy', 'Terms', 'Start free — 50 calls included', 'Your agent can pay with a card or with crypto. One key. You set the limit.', 'npx -y @agentpayxyz/mcp-server', 'npm install @agentpayxyz/sdk'])
await expectOk('/index.html', ['AgentPay'])
await expectOk('/start', ['50 calls included', 'Your agent can pay with a card or with crypto. One key. You set the limit.', 'MCP Builder', 'npx -y @agentpayxyz/mcp-server', 'npm install @agentpayxyz/sdk'])
await expectOk('/docs', ['npx -y @agentpayxyz/mcp-server', 'npm install @agentpayxyz/sdk', 'https://api.agentpay.so'])
await expectOk('/about', ['hosted MCP on x402'])
await expectOk('/awesome-free-dev-tools', ['Awesome Free Dev Tools'])
await expectOk('/terms', ['AgentPay Terms of Service'])
await expectOk('/privacy', ['AgentPay Privacy Policy'])
await expectOk('/postizzz', ['Postizzz'])
await expectOk('/rank/agentpay-demo', ['AgentRank'])
await expectOk('/awesome-free-dev-tools/status.json', ['payment_link'])
await expectOk('/sitemap.xml', ['https://agentpay.so/start', 'https://agentpay.so/docs'])

await expectStripeRedirect('/awesome-free-dev-tools/buy')

await expectNotFound('/nonexistent-route-xyz123')
await expectNotFound('/awesome-free-dev-tools/bogus')
await expectNotFound('/terms/extra')

const health = await fetch(`${base}/health`)
const healthBody = await health.json().catch(() => null)
record(`${base}/health`, health.ok && healthBody?.status === 'ok', {
  status: health.status,
  reported: healthBody?.status ?? null,
})

const failed = results.filter(result => !result.ok)
console.log(JSON.stringify({ base, ok: failed.length === 0, results }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
