#!/usr/bin/env node

const base = (process.argv[2] || 'https://agentpay.so').replace(/\/$/, '')
const checks = [
  {
    path: '/',
    required: ['AgentPay', 'Social publishing', 'Privacy', 'Terms'],
  },
  {
    path: '/postizzz',
    required: ['Postizzz', 'TikTok Login Kit', 'Content Posting API', 'Privacy Policy', 'Terms of Service'],
  },
  {
    path: '/terms',
    required: ['AgentPay Terms of Service', 'Authorized use', 'Connected accounts'],
  },
  {
    path: '/privacy',
    required: ['AgentPay Privacy Policy', 'authorization tokens', 'Disconnecting an account stops future access'],
  },
]

const results = []
for (const check of checks) {
  const url = `${base}${check.path}`
  const response = await fetch(url, { redirect: 'follow' })
  const body = await response.text()
  const missing = check.required.filter(text => !body.includes(text))
  results.push({ url, status: response.status, ok: response.ok && missing.length === 0, missing })
}

const health = await fetch(`${base}/health`)
const healthBody = await health.json().catch(() => null)
results.push({
  url: `${base}/health`,
  status: health.status,
  ok: health.ok && healthBody?.status === 'ok',
  missing: healthBody?.status === 'ok' ? [] : ['status=ok'],
})

const receipt = {
  checkedAt: new Date().toISOString(),
  base,
  ok: results.every(result => result.ok),
  results,
}
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
if (!receipt.ok) process.exitCode = 1
