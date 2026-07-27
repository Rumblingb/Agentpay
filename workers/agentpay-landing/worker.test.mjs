import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { handleRequest, isRankPath, parseRankAgent, rankSnapshotFor } = require('./worker.js')
const moduleWorker = (await import('./worker-entry.mjs')).default
const wranglerConfig = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8')
const deployScript = readFileSync(new URL('./deploy-postizzz-review.sh', import.meta.url), 'utf8')

const originalFetch = globalThis.fetch
let fetchCalled = false

globalThis.fetch = async () => {
  fetchCalled = true
  return new Response('origin passthrough', { status: 299 })
}

try {
  assert.match(wranglerConfig, /name = "agentpay-landing-production"/)
  assert.match(wranglerConfig, /main = "worker-entry\.mjs"/)
  assert.match(wranglerConfig, /compatibility_date = "2026-06-21"/)
  assert.match(wranglerConfig, /workers_dev = false/)
  assert.match(wranglerConfig, /pattern = "agentpay\.so\/\*"/)
  assert.match(wranglerConfig, /pattern = "www\.agentpay\.so\/\*"/)
  assert.doesNotMatch(wranglerConfig, /^\s*\[env\.production\]\s*$/m)
  assert.doesNotMatch(deployScript, /--env production/)
  assert.match(deployScript, /deploy --strict --dry-run/)
  assert.match(deployScript, /versions upload worker-entry\.mjs/)
  assert.match(deployScript, /versions deploy/)
  assert.match(deployScript, /Automatic rollback after Postizzz public verification failure/)

  const moduleHealthResponse = await moduleWorker.fetch(new Request('https://agentpay.so/health'))
  assert.equal(moduleHealthResponse.status, 200)
  assert.equal((await moduleHealthResponse.json()).status, 'ok')

  assert.equal(parseRankAgent('/rank/agentpay-demo'), 'agentpay-demo')
  assert.equal(parseRankAgent('/rank/agent.pay:demo_01/'), 'agent.pay:demo_01')
  assert.equal(parseRankAgent('/rank/bad/extra'), null)
  assert.equal(parseRankAgent('/rank/%3Cscript%3E'), null)
  assert.equal(isRankPath('/rank'), true)
  assert.equal(isRankPath('/rank/agentpay-demo'), true)
  assert.equal(isRankPath('/docs'), false)

  const rankResponse = await handleRequest(new Request('https://agentpay.so/rank/agentpay-demo'))
  assert.equal(rankResponse.status, 200)
  assert.match(rankResponse.headers.get('content-type'), /text\/html/)
  const rankHtml = await rankResponse.text()
  assert.match(rankHtml, /Public AgentRank/)
  assert.match(rankHtml, /<link rel="canonical" href="https:\/\/agentpay.so\/rank\/agentpay-demo">/)
  assert.match(rankHtml, /<meta property="og:type" content="profile">/)
  assert.match(rankHtml, /<script type="application\/ld\+json">/)

  const escapedResponse = await handleRequest(new Request('https://agentpay.so/rank/%3Cscript%3E'))
  assert.equal(escapedResponse.status, 404)
  assert.match(await escapedResponse.text(), /AgentRank profile not found/)

  const nestedRankResponse = await handleRequest(new Request('https://agentpay.so/rank/bad/extra'))
  assert.equal(nestedRankResponse.status, 404)

  const healthResponse = await handleRequest(new Request('https://agentpay.so/health'))
  assert.equal(healthResponse.status, 200)
  assert.equal(healthResponse.headers.get('content-type'), 'application/json')
  assert.equal(healthResponse.headers.get('cache-control'), 'no-store')
  const healthBody = await healthResponse.json()
  assert.equal(healthBody.scope, 'edge')
  assert.equal(healthBody.services.landing, 'green')

  // The edge worker cannot verify backend capabilities, so it must not claim them.
  // Reporting these as 'green' is the exact defect #165 exists to remove.
  assert.equal(healthBody.services.escrow, 'not_implemented')
  assert.equal(healthBody.services.kya, 'not_implemented')
  assert.equal(healthBody.services.behavioral_oracle, 'not_implemented')
  assert.equal(healthBody.services.database, 'not_probed')
  assert.equal(healthBody.services.agentrank, 'demo_only')
  for (const [name, state] of Object.entries(healthBody.services)) {
    if (name !== 'landing') {
      assert.notEqual(state, 'green', `${name} is not verifiable from the edge and must not report green`)
    }
  }

  // /api/health must reach the origin rather than being shadowed by the edge stub.
  fetchCalled = false
  const apiHealthResponse = await handleRequest(new Request('https://agentpay.so/api/health'))
  assert.equal(apiHealthResponse.status, 299)
  assert.equal(fetchCalled, true)

  const postizzzResponse = await handleRequest(new Request('https://agentpay.so/postizzz'))
  assert.equal(postizzzResponse.status, 200)
  const postizzzHtml = await postizzzResponse.text()
  assert.match(postizzzHtml, /Postizzz/)
  assert.match(postizzzHtml, /TikTok Login Kit/)
  assert.match(postizzzHtml, /Content Posting API/)
  assert.match(postizzzHtml, /href="\/privacy"/)
  assert.match(postizzzHtml, /href="\/terms"/)

  const bidDeskResponse = await handleRequest(new Request('https://agentpay.so/biddesk'))
  assert.equal(bidDeskResponse.status, 200)
  assert.match(bidDeskResponse.headers.get('content-type'), /text\/html/)
  const bidDeskHtml = await bidDeskResponse.text()
  assert.match(bidDeskHtml, /BidDesk/)
  assert.match(bidDeskHtml, /Cleaning &amp; FM tender responses/)
  assert.match(bidDeskHtml, /Compliance-checked SQ and ITT responses/)
  assert.match(bidDeskHtml, /No win guarantees/)
  assert.match(bidDeskHtml, /mailto:biddesk@agentpay\.so\?subject=Draft%20Desk/)
  assert.doesNotMatch(bidDeskHtml, /Win more/)

  const bidDeskTrailingSlashResponse = await handleRequest(new Request('https://agentpay.so/biddesk/'))
  assert.equal(bidDeskTrailingSlashResponse.status, 200)

  const productResponse = await handleRequest(new Request('https://agentpay.so/awesome-free-dev-tools'))
  assert.equal(productResponse.status, 200)
  const productHtml = await productResponse.text()
  assert.match(productHtml, /Awesome Free Dev Tools Premium/)
  assert.match(productHtml, /href="https:\/\/buy\.stripe\.com\/9B614pehNgAke6ccfh1oI03"/)
  assert.match(productHtml, /weekly update notes/)
  assert.match(productHtml, /fulfillment is being hardened/)

  const productStatusResponse = await handleRequest(new Request('https://agentpay.so/awesome-free-dev-tools/status.json'))
  assert.equal(productStatusResponse.status, 200)
  assert.match(productStatusResponse.headers.get('content-type'), /application\/json/)
  const productStatus = await productStatusResponse.json()
  assert.equal(productStatus.product, 'Awesome Free Dev Tools Premium')
  assert.equal(productStatus.product_id, 'prod_UTImgIPBjML5Rl')
  assert.equal(productStatus.access_model, 'checkout_email_with_manual_backup')
  assert.equal(productStatus.buyer_access_request_url, 'mailto:rajiv_baskaran@agentpay.so?subject=Awesome%20Free%20Dev%20Tools%20access')
  assert.equal(productStatus.manual_access_sla_hours, 24)
  assert.deepEqual(productStatus.fulfillment_steps, [
    'Stripe Checkout collects payment and purchase email',
    'Buyer keeps the Checkout session id from the success URL',
    'If automated access is not visible, buyer emails support from the purchase email with the session id',
    'AgentPay manually verifies the Stripe session and sends access while automation is being proven'
  ])
  assert.equal(productStatus.current_status, 'checkout_live_manual_fulfillment_backup')
  assert.deepEqual(productStatus.proof_required_for_full_automation, [
    'fresh checkout.session.completed after post-fix checkout',
    'fresh payment_intent.succeeded after post-fix checkout',
    'automated access-delivery receipt'
  ])

  const productSuccessResponse = await handleRequest(new Request('https://agentpay.so/awesome-free-dev-tools/success?session_id=cs_live_test_1234567890'))
  assert.equal(productSuccessResponse.status, 200)
  assert.equal(productSuccessResponse.headers.get('cache-control'), 'no-store')
  const productSuccessHtml = await productSuccessResponse.text()
  assert.match(productSuccessHtml, /Payment received/)
  assert.match(productSuccessHtml, /cs_live_test_1234567890/)
  assert.match(productSuccessHtml, /Access checklist/)
  assert.match(productSuccessHtml, /request access/)
  assert.match(productSuccessHtml, /Stripe%20session%3A%20cs_live_test_1234567890/)
  assert.match(productSuccessHtml, /View fulfillment status JSON/)

  const termsResponse = await handleRequest(new Request('https://agentpay.so/terms'))
  assert.equal(termsResponse.status, 200)
  assert.match(await termsResponse.text(), /AgentPay Terms of Service/)

  const privacyResponse = await handleRequest(new Request('https://agentpay.so/privacy'))
  assert.equal(privacyResponse.status, 200)
  const privacyHtml = await privacyResponse.text()
  assert.match(privacyHtml, /authorization tokens/)
  assert.match(privacyHtml, /Disconnecting an account stops future access/)
  assert.doesNotMatch(privacyHtml, /What we collect[\s\S]*?<strong>Nothing\.<\/strong>/)

  const medVoicePrivacyResponse = await handleRequest(new Request('https://agentpay.so/privacy/med-voice'))
  assert.equal(medVoicePrivacyResponse.status, 200)
  assert.match(medVoicePrivacyResponse.headers.get('content-type'), /text\/html/)
  const medVoicePrivacyHtml = await medVoicePrivacyResponse.text()
  assert.match(medVoicePrivacyHtml, /Med Voice Privacy Policy/)
  assert.match(medVoicePrivacyHtml, /Effective 9 July 2026/)
  assert.match(medVoicePrivacyHtml, /no accounts, no ads, no analytics/)
  assert.match(medVoicePrivacyHtml, /stored only in local storage on your device \(AsyncStorage\)/)
  assert.match(medVoicePrivacyHtml, /never uploaded, transmitted, or shared/)
  assert.match(medVoicePrivacyHtml, /vishar\.rumbling@gmail\.com/)

  const medVoicePrivacyTrailingSlash = await handleRequest(new Request('https://agentpay.so/privacy/med-voice/'))
  assert.equal(medVoicePrivacyTrailingSlash.status, 200)

  const voiceFlashPrivacyResponse = await handleRequest(new Request('https://agentpay.so/privacy/voice-flash'))
  assert.equal(voiceFlashPrivacyResponse.status, 200)
  assert.match(voiceFlashPrivacyResponse.headers.get('content-type'), /text\/html/)
  const voiceFlashPrivacyHtml = await voiceFlashPrivacyResponse.text()
  assert.match(voiceFlashPrivacyHtml, /Voice Flash Privacy Policy/)
  assert.match(voiceFlashPrivacyHtml, /Effective 11 July 2026/)
  assert.match(voiceFlashPrivacyHtml, /stored locally on your device/)
  assert.match(voiceFlashPrivacyHtml, /does not upload or share that audio/)
  assert.match(voiceFlashPrivacyHtml, /vishar\.rumbling@gmail\.com/)

  const voiceFlashPrivacyTrailingSlash = await handleRequest(new Request('https://agentpay.so/privacy/voice-flash/'))
  assert.equal(voiceFlashPrivacyTrailingSlash.status, 200)

  const landingResponse = await handleRequest(new Request('https://agentpay.so/'))
  const landingHtml = await landingResponse.text()
  assert.match(landingHtml, /href="\/privacy">Privacy<\/a>/)
  assert.match(landingHtml, /href="\/terms">Terms<\/a>/)
  assert.match(landingHtml, /href="\/awesome-free-dev-tools">Free Dev Tools<\/a>/)
  assert.match(landingHtml, /Awesome Free Dev Tools Premium/)
  assert.match(landingHtml, /href="\/awesome-free-dev-tools" class="btn-primary">View paid product<\/a>/)
  assert.match(landingHtml, /href="\/postizzz">Social publishing<\/a>/)
  assert.match(landingHtml, /AgentPay Labs is shipping small paid tools and operational rails in public/)
  assert.match(landingHtml, /Owner-authorized accounts/)
  assert.match(landingHtml, /Fail-closed routing/)

  const indexResponse = await handleRequest(new Request('https://agentpay.so/index.html'))
  assert.equal(indexResponse.status, 200)

  // Unknown paths must 404. A catch-all 200 hides broken links (it previously
  // made /awesome-free-dev-tools/buy indistinguishable from a dead route) and
  // lets crawlers index unlimited duplicate copies of the landing page.
  for (const deadPath of ['/nonexistent-route-xyz123', '/awesome-free-dev-tools/bogus', '/terms/extra']) {
    const missingResponse = await handleRequest(new Request(`https://agentpay.so${deadPath}`))
    assert.equal(missingResponse.status, 404, `${deadPath} should 404`)
    const missingHtml = await missingResponse.text()
    assert.match(missingHtml, /name="robots" content="noindex"/)
    assert.doesNotMatch(missingHtml, /AgentPay Labs is shipping small paid tools/)
  }

  const apiResponse = await handleRequest(new Request('https://agentpay.so/api/agentrank'))
  assert.equal(apiResponse.status, 299)
  assert.equal(fetchCalled, true)

  const scoreA = rankSnapshotFor('agentpay-demo').score
  const scoreB = rankSnapshotFor('agentpay-demo').score
  assert.equal(scoreA, scoreB)

  console.log('agentpay landing worker smoke tests passed')
} finally {
  globalThis.fetch = originalFetch
}
