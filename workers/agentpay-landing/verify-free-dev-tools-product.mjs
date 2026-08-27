import assert from 'node:assert/strict'

const base = (process.argv[2] || 'https://agentpay.so').replace(/\/$/, '')

const checks = [
  {
    path: '/awesome-free-dev-tools',
    expect: [
      /Awesome Free Dev Tools Premium/,
      /https:\/\/buy\.stripe\.com\/9B614pehNgAke6ccfh1oI03/,
      /weekly update notes/,
      /fulfillment is being hardened/
    ]
  },
  {
    path: '/awesome-free-dev-tools/success?session_id=cs_live_verifier_1234567890',
    expect: [
      /Payment received/,
      /Stripe has handled the payment/,
      /cs_live_verifier_1234567890/,
      /Access checklist/,
      /request access/,
      /Stripe%20session%3A%20cs_live_verifier_1234567890/,
      /View fulfillment status JSON/
    ]
  },
  {
    path: '/',
    expect: [
      /href="\/awesome-free-dev-tools">Free Dev Tools<\/a>/
    ]
  }
]

const results = []

for (const check of checks) {
  const url = `${base}${check.path}`
  const response = await fetch(url)
  const body = await response.text()

  assert.equal(response.status, 200, `${url} returned ${response.status}`)
  for (const pattern of check.expect) {
    assert.match(body, pattern, `${url} missing ${pattern}`)
  }

  results.push({
    url,
    status: response.status,
    contentType: response.headers.get('content-type'),
    matched: check.expect.map(String)
  })
}

const statusUrl = `${base}/awesome-free-dev-tools/status.json`
const statusResponse = await fetch(statusUrl)
assert.equal(statusResponse.status, 200, `${statusUrl} returned ${statusResponse.status}`)
assert.match(statusResponse.headers.get('content-type') || '', /application\/json/)
const status = await statusResponse.json()
assert.equal(status.product, 'Awesome Free Dev Tools Premium')
assert.equal(status.product_id, 'prod_UTImgIPBjML5Rl')
assert.equal(status.payment_link, 'https://buy.stripe.com/9B614pehNgAke6ccfh1oI03')
assert.equal(status.access_model, 'checkout_email_with_manual_backup')
assert.equal(status.buyer_access_request_url, 'mailto:rajiv_baskaran@agentpay.so?subject=Awesome%20Free%20Dev%20Tools%20access')
assert.equal(status.manual_access_sla_hours, 24)
assert.deepEqual(status.fulfillment_steps, [
  'Stripe Checkout collects payment and purchase email',
  'Buyer keeps the Checkout session id from the success URL',
  'If automated access is not visible, buyer emails support from the purchase email with the session id',
  'AgentPay manually verifies the Stripe session and sends access while automation is being proven'
])
assert.equal(status.current_status, 'checkout_live_manual_fulfillment_backup')
assert.ok(status.proof_required_for_full_automation.includes('automated access-delivery receipt'))

results.push({
  url: statusUrl,
  status: statusResponse.status,
  contentType: statusResponse.headers.get('content-type'),
  matched: [
    'product',
    'product_id',
    'payment_link',
    'access_model',
    'current_status',
    'proof_required_for_full_automation'
  ]
})

console.log(JSON.stringify({
  ok: true,
  base,
  checkedAt: new Date().toISOString(),
  results
}, null, 2))
