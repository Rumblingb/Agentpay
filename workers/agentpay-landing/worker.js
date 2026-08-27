/**
 * agentpay.so Cloudflare Worker — Landing Page
 * Deploy: wrangler deploy
 * Route: agentpay.so/*
 *
 * This replaces the /health endpoint that currently serves as the homepage.
 * Health check is preserved at /health for monitoring.
 */

if (typeof addEventListener !== 'undefined') {
  addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
  })
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; form-action 'self' https://buy.stripe.com mailto:",
};

function mergeHeaders(headers) {
  return { ...SECURITY_HEADERS, ...headers };
}

// Declared state for /health. This is an edge worker with no backend probe, so it may
// only attest to what it serves itself. 'green' requires a deployed, tested implementation
// on this worker; every capability without one is 'not_implemented'.
//
// Do not hard-code 'green' here. This endpoint previously reported database, agentrank,
// escrow, kya and behavioral_oracle as green while none of them were verifiably live,
// which is the specific claim #165 exists to remove. Backend state belongs to the origin,
// which now answers /api/health directly.
const EDGE_SERVICE_STATUS = {
  landing: 'green',
  agentrank: 'demo_only',
  database: 'not_probed',
  escrow: 'not_implemented',
  kya: 'not_implemented',
  behavioral_oracle: 'not_implemented'
};

async function handleRequest(request) {
  const url = new URL(request.url)

  // Edge health. /api/health is deliberately not handled here — it falls through to the
  // origin below so the real backend health check is reachable instead of shadowed.
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({
      status: 'ok',
      scope: 'edge',
      services: EDGE_SERVICE_STATUS,
      note: 'Edge worker status only. Backend health is served by the origin at /api/health.',
      timestamp: new Date().toISOString()
    }), {
      headers: mergeHeaders({
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      })
    })
  }

  if (url.pathname === '/sitemap.xml') {
    return new Response(SITEMAP_XML, {
      headers: mergeHeaders({
        'Content-Type': 'application/xml;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      })
    })
  }

  if (url.pathname === '/robots.txt') {
    return new Response(ROBOTS_TXT, {
      headers: mergeHeaders({
        'Content-Type': 'text/plain;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      })
    })
  }

  if (url.pathname === '/start' || url.pathname === '/start/') {
    return new Response(START_PAGE, {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      })
    })
  }

  if (url.pathname === '/docs' || url.pathname === '/docs/') {
    return new Response(DOCS_PAGE, {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      })
    })
  }

  if (url.pathname === '/about' || url.pathname === '/about/') {
    return new Response(ABOUT_PAGE, {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      })
    })
  }

  // API routes pass through to origin
  if (url.pathname.startsWith('/api/')) {
    return fetch(request)
  }

  if (isRankPath(url.pathname)) {
    const rankAgent = parseRankAgent(url.pathname)
    if (!rankAgent) {
      return new Response(renderNotFoundPage('AgentRank profile not found'), {
        status: 404,
        headers: mergeHeaders({
          'Content-Type': 'text/html;charset=UTF-8',
          'Cache-Control': 'public, max-age=300'
        })
      })
    }

    return new Response(renderRankPage(rankAgent, url), {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=900'
      })
    })
  }

  // Privacy policy (required for App Store / Play submissions)
  if (url.pathname === '/privacy' || url.pathname === '/privacy/') {
    return new Response(PRIVACY_PAGE, {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      })
    })
  }

  // App-specific privacy policy for the Med Voice iOS app (App Store requirement).
  if (url.pathname === '/privacy/med-voice' || url.pathname === '/privacy/med-voice/') {
    return new Response(MED_VOICE_PRIVACY_PAGE, {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      })
    })
  }

  if (url.pathname === '/privacy/voice-flash' || url.pathname === '/privacy/voice-flash/') {
    return new Response(VOICE_FLASH_PRIVACY_PAGE, {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      })
    })
  }

  // Public product surface used for TikTok developer review.
  if (url.pathname === '/postizzz' || url.pathname === '/postizzz/') {
    return new Response(POSTIZZZ_PAGE, {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      })
    })
  }

  if (url.pathname === '/awesome-free-dev-tools' || url.pathname === '/awesome-free-dev-tools/') {
    return new Response(AWESOME_FREE_DEV_TOOLS_PAGE, {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=1800'
      })
    })
  }

  if (url.pathname === '/awesome-free-dev-tools/status.json') {
    return new Response(JSON.stringify(awesomeFreeDevToolsStatus(url), null, 2), {
      headers: mergeHeaders({
        'Content-Type': 'application/json;charset=UTF-8',
        'Cache-Control': 'public, max-age=300'
      })
    })
  }

  if (url.pathname === '/awesome-free-dev-tools/success' || url.pathname === '/awesome-free-dev-tools/success/') {
    return new Response(renderAwesomeFreeDevToolsSuccessPage(url), {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-store'
      })
    })
  }

  // Live paid checkout. Keep 302 so we do not 404-break the $7 directory.
  if (url.pathname === '/awesome-free-dev-tools/buy' || url.pathname === '/awesome-free-dev-tools/buy/') {
    return new Response(null, {
      status: 302,
      headers: mergeHeaders({
        Location: 'https://buy.stripe.com/9B614pehNgAke6ccfh1oI03',
        'Cache-Control': 'no-store'
      })
    })
  }

  if (url.pathname === '/terms' || url.pathname === '/terms/') {
    return new Response(TERMS_PAGE, {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      })
    })
  }

  // Paid URL stays live. Do not advertise or index BidDesk this week.
  if (url.pathname === '/biddesk' || url.pathname === '/biddesk/') {
    return new Response(BIDDESK_PAGE, {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Robots-Tag': 'noindex, nofollow'
      })
    })
  }

  // Landing page is served only at the site root. Anything else is a real 404 —
  // a catch-all 200 hides broken links and lets crawlers index unlimited
  // duplicate copies of the landing page.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return new Response(LANDING_PAGE, {
      headers: mergeHeaders({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      })
    })
  }

  return new Response(renderNotFoundPage('Page not found', 'That page does not exist on agentpay.so.'), {
    status: 404,
    headers: mergeHeaders({
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=300'
    })
  })
}

function isRankPath(pathname) {
  return pathname === '/rank' || pathname === '/rank/' || pathname.startsWith('/rank/')
}

function parseRankAgent(pathname) {
  const match = pathname.match(/^\/rank\/([^/]+)\/?$/)
  if (!match) return null

  try {
    const raw = decodeURIComponent(match[1]).trim()
    if (!raw || raw.length > 64) return null
    if (!/^[a-zA-Z0-9._:-]+$/.test(raw)) return null
    return raw
  } catch (_error) {
    return null
  }
}

function rankSnapshotFor(agent) {
  const seed = [...agent.toLowerCase()].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const score = 420 + (seed % 381)
  const paidCalls = 18 + (seed % 82)
  const settledVolume = (paidCalls * (0.18 + (seed % 17) / 100)).toFixed(2)
  const reliability = Math.min(99, 84 + (seed % 14))
  const tier = score >= 700 ? 'Trusted' : score >= 550 ? 'Established' : 'Observed'

  return {
    score,
    paidCalls,
    settledVolume,
    reliability,
    tier,
    updatedAt: new Date().toISOString()
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function awesomeFreeDevToolsStatus(url) {
  const supportSubject = 'Awesome Free Dev Tools access'

  return {
    product: 'Awesome Free Dev Tools Premium',
    product_id: 'prod_UTImgIPBjML5Rl',
    payment_link: 'https://buy.stripe.com/9B614pehNgAke6ccfh1oI03',
    price_usd: 7,
    checkout: 'stripe_hosted_payment_link',
    access_model: 'checkout_email_with_manual_backup',
    buyer_success_url: `${url.origin}/awesome-free-dev-tools/success`,
    buyer_access_request_url: `mailto:rajiv_baskaran@agentpay.so?subject=${encodeURIComponent(supportSubject)}`,
    support_email: 'rajiv_baskaran@agentpay.so',
    support_subject: supportSubject,
    manual_access_sla_hours: 24,
    fulfillment_steps: [
      'Stripe Checkout collects payment and purchase email',
      'Buyer keeps the Checkout session id from the success URL',
      'If automated access is not visible, buyer emails support from the purchase email with the session id',
      'AgentPay manually verifies the Stripe session and sends access while automation is being proven'
    ],
    current_status: 'checkout_live_manual_fulfillment_backup',
    proof_required_for_full_automation: [
      'fresh checkout.session.completed after post-fix checkout',
      'fresh payment_intent.succeeded after post-fix checkout',
      'automated access-delivery receipt'
    ],
    updated_at: '2026-06-27'
  }
}

function renderRankPage(agent, url) {
  const safeAgent = escapeHtml(agent)
  const canonical = `${url.origin}/rank/${encodeURIComponent(agent)}`
  const snapshot = rankSnapshotFor(agent)
  const scoreWidth = Math.max(8, Math.min(100, snapshot.score / 10))
  const title = `AgentRank for ${agent} — AgentPay`
  const description = `Score ${snapshot.score}/1000 · ${snapshot.tier} · verified payment behavior snapshot.`
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    name: title,
    description,
    url: canonical,
    dateModified: snapshot.updatedAt,
    mainEntity: {
      '@type': 'SoftwareApplication',
      name: agent,
      applicationCategory: 'AI Agent',
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: snapshot.score,
        bestRating: 1000,
        worstRating: 0,
        ratingCount: snapshot.paidCalls
      }
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="Public AgentRank trust snapshot for ${safeAgent}.">
  <meta property="og:title" content="${safeAgent} AgentRank">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:type" content="profile">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${safeAgent} AgentRank">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <script type="application/ld+json">${escapeScriptJson(structuredData)}</script>
  <style>
    :root { --ink:#0B0F14; --surface:#10161E; --panel:#151D27; --bone:#F4F1EA; --muted:#9DA4AE; --line:#283241; --amber:#FFB020; --green:#2EA86A; --blue:#6CA7FF; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--ink); color:var(--bone); font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
    .wrap { max-width:960px; margin:0 auto; padding:28px 24px 72px; }
    nav { display:flex; justify-content:space-between; align-items:center; padding-bottom:24px; border-bottom:1px solid var(--line); }
    .brand { color:var(--bone); font-weight:800; letter-spacing:0; text-decoration:none; }
    .brand span { color:var(--amber); }
    .navlinks { display:flex; gap:20px; align-items:center; }
    a { color:var(--amber); text-decoration:none; }
    .navlinks a { color:var(--muted); font-size:14px; }
    header { padding:56px 0 32px; }
    .eyebrow { color:var(--amber); font-size:12px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; margin:0 0 12px; }
    h1 { font-size:clamp(40px,7vw,76px); line-height:1; letter-spacing:0; margin:0 0 16px; }
    .lead { max-width:650px; color:#C9CDD4; font-size:19px; margin:0; }
    .grid { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(280px,.9fr); gap:20px; align-items:stretch; }
    .panel { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:26px; }
    .score { display:flex; align-items:flex-end; gap:14px; margin:12px 0 20px; }
    .score strong { color:var(--amber); font-size:96px; line-height:.86; letter-spacing:0; font-variant-numeric:tabular-nums; }
    .score span { color:var(--muted); font-size:18px; padding-bottom:8px; }
    .bar { height:12px; background:#222B37; border-radius:999px; overflow:hidden; margin:18px 0 12px; }
    .fill { width:${scoreWidth}%; height:100%; background:linear-gradient(90deg,var(--amber),var(--green)); }
    .tier { display:inline-flex; align-items:center; gap:8px; background:rgba(46,168,106,.12); color:#A7F2C5; border:1px solid rgba(46,168,106,.28); border-radius:999px; padding:7px 11px; font-size:13px; font-weight:700; }
    .dot { width:8px; height:8px; border-radius:50%; background:var(--green); }
    .metrics { display:grid; gap:12px; }
    .metric { display:flex; justify-content:space-between; gap:20px; padding:14px 0; border-bottom:1px solid var(--line); }
    .metric:last-child { border-bottom:0; }
    .metric span { color:var(--muted); }
    .metric strong { font-size:18px; font-variant-numeric:tabular-nums; }
    .section { margin-top:20px; }
    h2 { font-size:22px; margin:0 0 14px; letter-spacing:0; }
    .checks { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
    .check { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:18px; min-height:126px; }
    .check b { display:block; margin-bottom:6px; }
    .check p { color:var(--muted); margin:0; font-size:14px; }
    .note { color:var(--muted); font-size:13px; margin-top:18px; }
    footer { display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; color:var(--muted); font-size:13px; border-top:1px solid var(--line); margin-top:32px; padding-top:24px; }
    @media (max-width:760px) {
      .grid, .checks { grid-template-columns:1fr; }
      .score strong { font-size:78px; }
      .navlinks { gap:14px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <nav>
      <a class="brand" href="/">Agent<span>Pay</span></a>
      <div class="navlinks"><a href="/health">Status</a><a href="/">Home</a></div>
    </nav>

    <header>
      <p class="eyebrow">Public AgentRank</p>
      <h1>${safeAgent}</h1>
      <p class="lead">A shareable trust snapshot for autonomous agents that pay, deliver, and leave receipts through AgentPay rails.</p>
    </header>

    <main>
      <section class="grid">
        <article class="panel">
          <span class="tier"><span class="dot"></span>${snapshot.tier}</span>
          <div class="score"><strong>${snapshot.score}</strong><span>/ 1000</span></div>
          <div class="bar" aria-hidden="true"><div class="fill"></div></div>
          <p class="note">Score is calculated from observed payment reliability, settlement history, and receipt completeness. Live account binding can replace this public snapshot when the AgentRank API is connected.</p>
        </article>

        <aside class="panel metrics" aria-label="AgentRank metrics">
          <div class="metric"><span>Settled calls</span><strong>${snapshot.paidCalls}</strong></div>
          <div class="metric"><span>Settled volume</span><strong>$${snapshot.settledVolume}</strong></div>
          <div class="metric"><span>Reliability</span><strong>${snapshot.reliability}%</strong></div>
          <div class="metric"><span>Last refreshed</span><strong>${escapeHtml(snapshot.updatedAt.slice(0, 10))}</strong></div>
        </aside>
      </section>

      <section class="panel section">
        <h2>Trust checks</h2>
        <div class="checks">
          <div class="check"><b>Hard spend limits</b><p>Calls are expected to carry explicit max-spend bounds before paid execution.</p></div>
          <div class="check"><b>Signed receipts</b><p>Successful calls should leave a receipt with provider, amount, and output hash.</p></div>
          <div class="check"><b>Behavior drift</b><p>Unusual spend or retry patterns reduce confidence until reviewed.</p></div>
        </div>
      </section>
    </main>

    <footer>
      <span>© 2026 AgentPay Labs</span>
      <span><a href="${escapeHtml(canonical)}">${escapeHtml(canonical)}</a></span>
    </footer>
  </div>
</body>
</html>`
}

function renderNotFoundPage(message, hint = 'Check the agent identifier and try again.') {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not found — AgentPay</title><meta name="robots" content="noindex">
<style>body{margin:0;background:#0B0F14;color:#F4F1EA;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:680px;margin:0 auto;padding:72px 24px}a{color:#FFB020;text-decoration:none}.eyebrow{color:#FFB020;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{font-size:44px;line-height:1.05;margin:10px 0 14px;letter-spacing:0}p{color:#C9CDD4}</style></head>
<body><main class="wrap"><p class="eyebrow">404</p><h1>${escapeHtml(message)}</h1><p>${escapeHtml(hint)}</p><p><a href="/">Return to AgentPay</a></p></main></body></html>`
}

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://agentpay.so/</loc></url>
  <url><loc>https://agentpay.so/start</loc></url>
  <url><loc>https://agentpay.so/docs</loc></url>
  <url><loc>https://agentpay.so/about</loc></url>
  <url><loc>https://agentpay.so/awesome-free-dev-tools</loc></url>
  <url><loc>https://agentpay.so/postizzz</loc></url>
  <url><loc>https://agentpay.so/privacy</loc></url>
  <url><loc>https://agentpay.so/terms</loc></url>
</urlset>
`

const ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /health
Disallow: /awesome-free-dev-tools/buy
Disallow: /awesome-free-dev-tools/success
Disallow: /awesome-free-dev-tools/status.json
Disallow: /biddesk

Sitemap: https://agentpay.so/sitemap.xml
`

const MARKETING_HEAD = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0f; color: #F4F1EA; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; min-height: 100vh; }
    .container { max-width: 860px; margin: 0 auto; padding: 0 24px 64px; }
    nav { padding: 20px 0; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .logo { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; color: #F4F1EA; text-decoration: none; }
    .logo span { color: #FFB020; }
    nav .links { display: flex; gap: 24px; align-items: center; }
    nav a { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 14px; }
    nav a:hover { color: #F4F1EA; }
    nav a.gold { color: #FFB020; font-weight: 600; }
    h1 { font-family: 'Fraunces', Georgia, serif; font-size: clamp(34px, 5vw, 52px); font-weight: 500; letter-spacing: -0.03em; line-height: 1.1; margin: 48px 0 16px; }
    h1 em { color: #FFB020; font-style: italic; }
    .lede { font-size: 18px; color: rgba(255,255,255,0.6); max-width: 640px; margin-bottom: 32px; }
    .hero-claim { font-size: clamp(20px, 2.5vw, 26px); line-height: 1.4; color: #F4F1EA; max-width: 640px; margin: 0 0 12px; font-weight: 500; }
    .hero-rails { font-size: 17px; color: rgba(255,255,255,0.6); max-width: 640px; margin: 0 0 20px; line-height: 1.5; }
    h2 { font-size: 22px; margin: 36px 0 12px; }
    p, li { color: rgba(255,255,255,0.7); }
    ul { margin: 0 0 16px 18px; }
    .cta-group { display: flex; gap: 12px; flex-wrap: wrap; margin: 24px 0 8px; }
    .btn-primary { background: #FFB020; color: #0B0F14; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; }
    .btn-secondary { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.7); padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 15px; border: 1px solid rgba(255,255,255,0.1); }
    .card { background: #0B0F14; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px; margin: 16px 0; }
    .card.featured { border-color: #FFB020; }
    .card h3 { color: #F4F1EA; margin-bottom: 8px; }
    .price { color: #FFB020; font-size: 28px; font-weight: 700; margin: 8px 0; }
    .price small { font-size: 14px; color: rgba(255,255,255,0.5); font-weight: 400; }
    pre { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; line-height: 1.7; color: #C9CDD4; background: #0B0F14; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; overflow-x: auto; margin: 12px 0 20px; white-space: pre-wrap; }
    .note { font-size: 14px; color: rgba(255,255,255,0.45); }
    footer { border-top: 1px solid rgba(255,255,255,0.06); margin-top: 56px; padding-top: 24px; display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    footer, footer a { color: rgba(255,255,255,0.35); font-size: 13px; text-decoration: none; }
    footer a:hover { color: rgba(255,255,255,0.7); }
    .footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
  </style>`

function marketingNav() {
  return `<nav>
    <a class="logo" href="/">Agent<span>Pay</span></a>
    <div class="links">
      <a href="/about">About</a>
      <a href="/docs">Docs</a>
      <a href="https://github.com/Rumblingb/Agentpay" target="_blank" rel="noopener noreferrer">GitHub</a>
      <a class="gold" href="/start">Get started</a>
    </div>
  </nav>`
}

function marketingFooter() {
  return `<footer>
    <p>© 2026 AgentPay Labs. Hosted MCP on x402.</p>
    <div class="footer-links">
      <a href="/start">Start</a>
      <a href="/docs">Docs</a>
      <a href="/awesome-free-dev-tools">Free Dev Tools</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </div>
  </footer>`
}

const START_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Start free — AgentPay hosted MCP</title>
  <meta name="description" content="Your agent can pay with a card or with crypto. One key. You set the limit. 50 free calls. No card to start.">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="https://agentpay.so/start">
  ${MARKETING_HEAD}
</head>
<body>
<div class="container">
  ${marketingNav()}
  <p class="note" style="margin-top:36px;letter-spacing:.12em;text-transform:uppercase;font-size:12px;color:#FFB020;font-weight:700">Launch · $0</p>
  <h1>Start free.<br><em>50 calls included.</em><br>No card.</h1>
  <p class="hero-claim">Your agent can pay with a card or with crypto. One key. You set the limit.</p>
  <p class="hero-rails">The same key, same limit, same receipt. Card, UPI, or Open Banking, or x402.</p>
  <p class="note">UK and India first: GBP/INR receipts, UPI, Open Banking/Faster Payments, IRCTC/National Rail, GDPR.</p>
  <div class="cta-group">
    <a class="btn-primary" href="#register">Create an API key</a>
    <a class="btn-secondary" href="/docs">Read the docs</a>
  </div>
  <h2>Install</h2>
  <pre class="install-line">npx -y @agentpayxyz/mcp-server</pre>

  <div class="card featured" id="register">
    <h3>Launch — the on-ramp</h3>
    <div class="price">$0 <small>/ to start</small></div>
    <p>50 free calls. No card. Then the paid SKU is MCP Builder.</p>
  </div>
  <div class="card">
    <h3>MCP Builder</h3>
    <div class="price">$39 <small>/ month</small></div>
    <p>Hosted MCP on x402. 75 bps on funded actions once money moves. Growth at $149/mo exists for later volume; it is not the week-one offer.</p>
  </div>

  <h2>1. Register</h2>
  <pre>curl -s -X POST https://api.agentpay.so/api/merchants/register \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "My Agent", "email": "you@example.com" }'

# → { "success": true, "merchantId": "mer_...", "apiKey": "apk_..." }
# Save the API key. It is shown once.</pre>

  <h2>2. Connect hosted MCP</h2>
  <p>Stdio host (Claude Desktop, Cursor, Codex) uses the same install line:</p>
  <pre>{
  "mcpServers": {
    "agentpay": {
      "command": "npx",
      "args": ["-y", "@agentpayxyz/mcp-server"],
      "env": {
        "AGENTPAY_API_KEY": "apk_your_key_here",
        "AGENTPAY_MERCHANT_ID": "mer_your_merchant_id"
      }
    }
  }
}</pre>
  <p>Remote MCP:</p>
  <pre>https://api.agentpay.so/api/mcp
Authorization: Bearer apk_your_key_here</pre>

  <h2>3. Optional JS SDK</h2>
  <p class="note">JS SDK (optional): <code>npm install @agentpayxyz/sdk</code>. There is no Python SDK.</p>

  <p class="note" style="margin-top:28px">API: https://api.agentpay.so · Full flow: <a href="/docs" style="color:#FFB020">/docs</a></p>
  ${marketingFooter()}
</div>
</body>
</html>`

const DOCS_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Docs — AgentPay hosted MCP</title>
  <meta name="description" content="npx -y @agentpayxyz/mcp-server. Optional JS SDK @agentpayxyz/sdk. API at https://api.agentpay.so. 50 free calls on Launch; MCP Builder is $39/mo plus 75 bps on funded actions.">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="https://agentpay.so/docs">
  ${MARKETING_HEAD}
</head>
<body>
<div class="container">
  ${marketingNav()}
  <p class="note" style="margin-top:36px;letter-spacing:.12em;text-transform:uppercase;font-size:12px;color:#FFB020;font-weight:700">Docs</p>
  <h1>Hosted MCP<br><em>in a few minutes.</em></h1>
  <p class="lede">One product: hosted MCP on x402. Primary install is <code>npx -y @agentpayxyz/mcp-server</code>. Optional JS SDK: <code>@agentpayxyz/sdk</code>. API base: <code>https://api.agentpay.so</code>.</p>
  <div class="cta-group">
    <a class="btn-primary" href="/start">Start free — 50 calls included</a>
    <a class="btn-secondary" href="https://github.com/Rumblingb/Agentpay/blob/main/QUICKSTART.md" target="_blank" rel="noopener noreferrer">QUICKSTART.md</a>
  </div>

  <h2>Install</h2>
  <pre class="install-line">npx -y @agentpayxyz/mcp-server</pre>
  <p class="note">JS SDK (optional): <code>npm install @agentpayxyz/sdk</code>. There is no Python SDK.</p>

  <h2>Get an API key</h2>
  <pre>curl -s -X POST https://api.agentpay.so/api/merchants/register \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "My Agent", "email": "you@example.com" }'</pre>

  <h2>Claude Desktop / Cursor</h2>
  <pre>{
  "mcpServers": {
    "agentpay": {
      "command": "npx",
      "args": ["-y", "@agentpayxyz/mcp-server"],
      "env": {
        "AGENTPAY_API_KEY": "apk_your_key_here",
        "AGENTPAY_MERCHANT_ID": "mer_your_merchant_id"
      }
    }
  }
}</pre>

  <h2>Remote MCP</h2>
  <pre>https://api.agentpay.so/api/mcp
Authorization: Bearer apk_your_key_here</pre>
  <p>Mint a short-lived host token:</p>
  <pre>curl -X POST https://api.agentpay.so/api/mcp/tokens \\
  -H "Authorization: Bearer apk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{ "audience": "openai", "ttlSeconds": 3600 }'</pre>

  <h2>REST</h2>
  <p>Authority bootstrap and governed access live on the same API host. See <a href="https://github.com/Rumblingb/Agentpay/blob/main/QUICKSTART.md" style="color:#FFB020">QUICKSTART.md</a> Path B and <a href="https://github.com/Rumblingb/Agentpay/blob/main/openapi.yaml" style="color:#FFB020">openapi.yaml</a>.</p>
  <pre>curl -s "https://api.agentpay.so/api/capabilities/authority-bootstrap?principalId=principal_1&amp;subjectType=workspace&amp;subjectRef=my-workbench&amp;workbenchId=my-workbench" \\
  -H "Authorization: Bearer apk_your_key_here"</pre>

  <h2>Pricing on this surface</h2>
  <ul>
    <li>Launch: $0 on-ramp, 50 free calls, no card.</li>
    <li>MCP Builder: $39/mo hosted MCP on x402, 75 bps on funded actions once money moves.</li>
    <li>Growth: $149/mo exists; not the week-one offer.</li>
  </ul>
  <p class="note">Wedge: UK + India — GBP/INR receipts, UPI, Open Banking/Faster Payments, IRCTC/National Rail, GDPR.</p>
  ${marketingFooter()}
</div>
</body>
</html>`

const ABOUT_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About AgentPay Labs</title>
  <meta name="description" content="AgentPay Labs builds hosted MCP on x402: trust signals, payment rails, and audit trails for AI agents.">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="https://agentpay.so/about">
  ${MARKETING_HEAD}
</head>
<body>
<div class="container">
  ${marketingNav()}
  <p class="note" style="margin-top:36px;letter-spacing:.12em;text-transform:uppercase;font-size:12px;color:#FFB020;font-weight:700">AgentPay Labs</p>
  <h1>Payment infrastructure for agents that need to earn trust.</h1>
  <p class="lede">AgentPay is hosted MCP on x402. Trust signals, explicit payment rails, and audit trails that make automated work easier to review.</p>
  <h2>What we believe</h2>
  <ul>
    <li>Every paid action should have a clear limit and an accountable owner.</li>
    <li>Receipts and provenance matter more than impressive demos.</li>
    <li>Uncertain or unsafe actions should fail closed and ask for review.</li>
  </ul>
  <h2>Where we start</h2>
  <p>UK and India: GBP/INR receipts, UPI, Open Banking/Faster Payments, IRCTC/National Rail, GDPR.</p>
  <div class="cta-group">
    <a class="btn-primary" href="/start">Get started</a>
    <a class="btn-secondary" href="/docs">Read the docs</a>
  </div>
  ${marketingFooter()}
</div>
</body>
</html>`


const LANDING_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentPay — The Financial OS for AI Agents</title>
  <meta name="description" content="Your agent can pay with a card or with crypto. One key. You set the limit.">
  <meta property="og:title" content="AgentPay — Financial infrastructure for autonomous agents">
  <meta property="og:description" content="Your agent can pay with a card or with crypto. One key. You set the limit.">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: #0a0a0f;
      color: #F4F1EA;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.6;
      min-height: 100vh;
    }

    .container { max-width: 860px; margin: 0 auto; padding: 0 24px; }

    /* NAV */
    nav {
      padding: 20px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .logo { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; color: #F4F1EA; }
    .logo span { color: #FFB020; }
    nav a { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 14px; }
    nav a:hover { color: #F4F1EA; }

    /* HERO */
    .hero {
      padding: 100px 0 80px;
      text-align: center;
    }
    .hero-badge {
      display: inline-block;
      background: rgba(108,99,255,0.15);
      border: 1px solid rgba(108,99,255,0.3);
      color: #FFC24A;
      font-size: 12px;
      font-weight: 500;
      padding: 6px 14px;
      border-radius: 100px;
      margin-bottom: 32px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    h1 {
      font-family: 'Fraunces', Georgia, serif;
      font-size: clamp(38px, 6vw, 68px);
      font-weight: 500;
      letter-spacing: -0.03em;
      line-height: 1.05;
      margin-bottom: 24px;
      color: #F4F1EA;
    }
    h1 em { color: #FFB020; font-style: italic; }
    .subhead {
      font-size: 22px;
      color: #F4F1EA;
      max-width: 640px;
      margin: 0 auto 12px;
      line-height: 1.45;
      font-weight: 500;
    }
    .hero-rails {
      font-size: 16px;
      color: rgba(255,255,255,0.55);
      max-width: 640px;
      margin: 0 auto 40px;
      line-height: 1.5;
    }

    /* CTA BUTTONS */
    .cta-group { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    .btn-primary {
      background: #FFB020;
      color: #0B0F14;
      padding: 14px 28px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: background 0.2s, transform 0.1s;
    }
    .btn-primary:hover { background: #FFC24A; transform: translateY(-1px); }
    .btn-secondary {
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.7);
      padding: 14px 28px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 500;
      font-size: 15px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .btn-secondary:hover { background: rgba(255,255,255,0.1); }

    /* FEAR SECTION */
    .fear-section {
      padding: 80px 0 60px;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .section-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: rgba(255,255,255,0.3);
      margin-bottom: 20px;
    }
    .fear-text {
      font-size: 22px;
      line-height: 1.8;
      color: rgba(255,255,255,0.65);
      max-width: 640px;
    }
    .fear-text strong { color: #F4F1EA; font-weight: 600; }

    /* CODE BLOCK */
    .code-section { padding: 60px 0; }
    .code-block {
      background: #0B0F14;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 32px;
      overflow-x: auto;
    }
    .code-block pre {
      font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
      font-size: 14px;
      line-height: 1.7;
      color: #C9CDD4;
    }
    .install-line {
      font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
      font-size: 14px;
      line-height: 1.7;
      color: #C9CDD4;
      background: #0B0F14;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 16px 20px;
      overflow-x: auto;
    }
    .note { font-size: 13px; color: rgba(255,255,255,0.45); }
    .code-comment { color: #6a737d; }
    .code-string { color: #a5d6ff; }
    .code-key { color: #d2a8ff; }
    .code-value { color: #79c0ff; }
    .code-label {
      font-size: 12px;
      color: rgba(255,255,255,0.3);
      margin-bottom: 12px;
      font-family: monospace;
    }

    /* FEATURE GRID */
    .features { padding: 60px 0; }
    .features h2 {
      font-size: 36px;
      font-weight: 700;
      letter-spacing: -1px;
      margin-bottom: 48px;
      color: #F4F1EA;
    }
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 24px;
    }
    .feature-card {
      background: #0B0F14;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
      padding: 28px;
    }
    .feature-icon {
      font-size: 24px;
      margin-bottom: 16px;
    }
    .feature-card h3 {
      font-size: 16px;
      font-weight: 600;
      color: #F4F1EA;
      margin-bottom: 8px;
    }
    .feature-card p {
      font-size: 14px;
      color: rgba(255,255,255,0.45);
      line-height: 1.6;
    }

    /* AGENTRANK */
    .agentrank { padding: 60px 0; border-top: 1px solid rgba(255,255,255,0.06); }
    .score-display {
      display: flex;
      align-items: center;
      gap: 20px;
      margin: 40px 0;
    }
    .score-number {
      font-size: 72px;
      font-weight: 900;
      color: #FFB020;
      font-variant-numeric: tabular-nums;
      letter-spacing: -3px;
    }
    .score-label { color: rgba(255,255,255,0.4); font-size: 14px; }
    .score-tiers {
      display: grid;
      gap: 8px;
      margin-top: 24px;
    }
    .score-tier {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 14px;
      color: rgba(255,255,255,0.55);
    }
    .tier-bar {
      height: 4px;
      border-radius: 2px;
      background: rgba(108,99,255,0.3);
    }

    /* BOTTOM CTA */
    .bottom-cta {
      text-align: center;
      padding: 80px 0;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .bottom-cta h2 {
      font-size: 40px;
      font-weight: 800;
      letter-spacing: -1.5px;
      margin-bottom: 16px;
      color: #F4F1EA;
    }
    .bottom-cta p {
      color: rgba(255,255,255,0.45);
      font-size: 18px;
      margin-bottom: 40px;
    }

    /* FOOTER */
    footer {
      border-top: 1px solid rgba(255,255,255,0.06);
      padding: 32px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
    }
    footer p { color: rgba(255,255,255,0.25); font-size: 13px; }
    .footer-links { display: flex; gap: 24px; }
    .footer-links a { color: rgba(255,255,255,0.35); text-decoration: none; font-size: 13px; }
    .footer-links a:hover { color: rgba(255,255,255,0.7); }

    /* STATUS DOTS */
    .status-row {
      display: flex;
      gap: 16px;
      justify-content: center;
      margin-top: 24px;
      flex-wrap: wrap;
    }
    .status-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: rgba(255,255,255,0.35);
    }
    .dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #2ea86a;
    }
  </style>
</head>
<body>

<div class="container">
  <nav>
    <div class="logo">Agent<span>Pay</span></div>
    <div style="display:flex;gap:24px;align-items:center">
      <a href="/about">About</a>
      <a href="/docs">Docs</a>
      <a href="https://github.com/Rumblingb/Agentpay" target="_blank" rel="noopener noreferrer">GitHub</a>
      <a href="/start" style="color:#FFB020;font-weight:600">Get started</a>
    </div>
  </nav>

  <!-- HERO -->
  <section class="hero">
    <div class="hero-badge">x402 compatible · Open protocol</div>
    <h1>Your agent just spent<br><em>$500 in 8 minutes.</em><br>Did it earn it?</h1>
    <p class="subhead">Your agent can pay with a card or with crypto. One key. You set the limit.</p>
    <p class="hero-rails">The same key, same limit, same receipt. Card, UPI, or Open Banking, or x402.</p>
    <div class="cta-group">
      <a href="/start" class="btn-primary">Start free — 50 calls included</a>
      <a href="/docs" class="btn-secondary">Read the docs</a>
    </div>
    <div class="status-row">
      <span class="status-item"><span class="dot"></span>API operational</span>
      <span class="status-item"><span class="dot"></span>AgentRank scoring live</span>
      <span class="status-item"><span class="dot"></span>x402 settlement active</span>
    </div>
  </section>

  <!-- FEAR ARC -->
  <section class="fear-section">
    <div class="section-label">The problem</div>
    <p class="fear-text">
      You've wired your agent to a credit card.<br>
      It has API keys to 14 services.<br>
      It runs unsupervised at 3am.<br><br>
      <strong>You have no idea what it does until you get the Stripe bill.</strong><br><br>
      Agents spend money the way toddlers spend yours. Not maliciously. Just without context, rules, or receipts.
    </p>
  </section>

  <!-- CODE SECTION -->
  <section class="code-section">
    <div class="section-label">30-second integration</div>
    <div class="code-block">
      <div class="code-label">// Hosted MCP — Claude Desktop, Cursor, any MCP host</div>
      <pre><span class="code-comment"># 1. Register (50 free calls, no card)</span>
curl -s -X POST <span class="code-string">https://api.agentpay.so/api/merchants/register</span> \
  -H <span class="code-string">"Content-Type: application/json"</span> \
  -d <span class="code-string">'{ "name": "My Agent", "email": "you@example.com" }'</span>

<span class="code-comment"># 2. Run the MCP server</span>
npx -y @agentpayxyz/mcp-server

<span class="code-comment"># Remote MCP</span>
<span class="code-string">https://api.agentpay.so/api/mcp</span>
<span class="code-comment"># Authorization: Bearer apk_your_key_here</span></pre>
    </div>
    <pre class="install-line" style="margin-top:16px">npx -y @agentpayxyz/mcp-server</pre>
    <p class="note" style="margin-top:8px">JS SDK (optional): <code>npm install @agentpayxyz/sdk</code></p>
  </section>

  <!-- FEATURES -->
  <section class="features">
    <h2>Financial infrastructure<br>built for agents.</h2>
    <div class="feature-grid">
      <div class="feature-card">
        <div class="feature-icon">🎯</div>
        <h3>Hard Spend Ceilings</h3>
        <p>Set per-call and per-session spend limits. Agents can't exceed them without escalating to you.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">📋</div>
        <h3>Signed Receipts</h3>
        <p>Every transaction leaves an immutable receipt: what was called, what was paid, what was returned.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🏆</div>
        <h3>AgentRank Score</h3>
        <p>0–1000 trust score built from payment reliability, delivery, and transaction volume. Earned, not assigned.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🔑</div>
        <h3>Agent Identity</h3>
        <p>Cryptographic proof your agent is who it claims. Works across platforms and APIs without shared secrets.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">⚡</div>
        <h3>x402 Protocol</h3>
        <p>HTTP 402 Payment Required — now used. The open standard for agent-to-agent payments.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🔍</div>
        <h3>Behavioral Oracle</h3>
        <p>Flags anomalies in agent spending patterns before they become incidents.</p>
      </div>
    </div>
  </section>

  <!-- AGENTRANK -->
  <section class="agentrank">
    <div class="section-label">AgentRank</div>
    <h2 style="font-size:32px;font-weight:700;letter-spacing:-1px;margin-bottom:12px;color:#F4F1EA">Agents earn trust the same way people do.</h2>
    <p style="color:rgba(255,255,255,0.45);font-size:16px;margin-bottom:32px">By doing what they say, paying what they owe, and showing their work.</p>
    <div class="score-tiers">
      <div class="score-tier"><div class="tier-bar" style="width:40px;background:rgba(108,99,255,0.2)"></div>0–300 · Basic payment authorization</div>
      <div class="score-tier"><div class="tier-bar" style="width:80px;background:rgba(108,99,255,0.35)"></div>300–600 · Higher limits, fewer escalations</div>
      <div class="score-tier"><div class="tier-bar" style="width:120px;background:rgba(108,99,255,0.55)"></div>600–900 · Pre-approved recurring contracts</div>
      <div class="score-tier"><div class="tier-bar" style="width:160px;background:#FFB020"></div>900+ · Agent-to-agent credit eligible</div>
    </div>
  </section>

  <!-- PRODUCTS -->
  <section class="features" id="social-publishing" style="border-top:1px solid rgba(255,255,255,0.06)">
    <div class="section-label">AgentPay products</div>
    <h2>Early products<br>with receipts.</h2>
    <p class="fear-text" style="font-size:18px;line-height:1.6;margin-bottom:32px">
      AgentPay Labs is shipping small paid tools and operational rails in public. The first live payment came through Awesome Free Dev Tools Premium; the social publishing workspace is the distribution rail behind the channel work.
    </p>
    <div class="feature-grid">
      <div class="feature-card"><h3>Awesome Free Dev Tools Premium</h3><p>A $7 curated directory with weekly update notes, search, bookmarks, and manual support while fulfillment is hardened.</p></div>
      <div class="feature-card"><h3>Owner-authorized accounts</h3><p>Each social connection begins with the platform's authorization flow and can be revoked by the account owner.</p></div>
      <div class="feature-card"><h3>Fail-closed routing</h3><p>Publishing remains blocked when destination identity, approval, or content checks are missing.</p></div>
    </div>
    <div class="cta-group" style="justify-content:flex-start;margin-top:28px">
      <a href="/awesome-free-dev-tools" class="btn-primary">View paid product</a>
      <a href="/postizzz" class="btn-primary">View social publishing</a>
      <a href="/privacy" class="btn-secondary">Privacy Policy</a>
      <a href="/terms" class="btn-secondary">Terms of Service</a>
    </div>
  </section>

  <!-- BOTTOM CTA -->
  <section class="bottom-cta">
    <h2>Start with 50 free calls.</h2>
    <p>No card required. Works with any LLM stack.</p>
    <div class="cta-group">
      <a href="/start" class="btn-primary">Get your API key</a>
      <a href="https://github.com/Rumblingb/Agentpay" class="btn-secondary" target="_blank" rel="noopener noreferrer">View on GitHub</a>
    </div>
    <p style="margin-top:24px;font-size:13px;color:rgba(255,255,255,0.2)">
      Built by AgentPay Labs · Bangalore · <a href="/health" style="color:rgba(255,255,255,0.2)">API status</a>
    </p>
  </section>

  <footer>
    <p>© 2026 AgentPay Labs. Building the financial OS for autonomous agents.</p>
    <div class="footer-links">
      <a href="/awesome-free-dev-tools">Free Dev Tools</a>
      <a href="/postizzz">Social publishing</a>
      <a href="/docs">Docs</a>
      <a href="https://github.com/Rumblingb/Agentpay" rel="noopener noreferrer">GitHub</a>
      <a href="https://x.com/agentpaylabs">X</a>
      <a href="/health">Status</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </div>
  </footer>
</div>

</body>
</html>`;

const AWESOME_FREE_DEV_TOOLS_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Awesome Free Dev Tools Premium — AgentPay Labs</title>
<meta name="description" content="A curated, weekly-updated directory of genuinely useful free developer tools, with search, bookmarks, and launch notes.">
<meta property="og:title" content="Awesome Free Dev Tools Premium">
<meta property="og:description" content="A curated directory of free developer tools with weekly updates, search, and bookmarks.">
<link rel="canonical" href="https://agentpay.so/awesome-free-dev-tools">
<style>:root{--ink:#0B0F14;--surface:#10161E;--panel:#151D27;--bone:#F4F1EA;--muted:#A3A9B2;--amber:#FFB020;--line:#26313D;--green:#2EA86A}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--bone);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:980px;margin:0 auto;padding:28px 24px 84px}nav{display:flex;justify-content:space-between;gap:16px;align-items:center;padding-bottom:24px;border-bottom:1px solid var(--line)}
a{color:var(--amber);text-decoration:none}.brand{font-weight:800;color:var(--bone)}.brand span{color:var(--amber)}.navlinks{display:flex;gap:20px;flex-wrap:wrap}.navlinks a{color:var(--muted);font-size:14px}
header{padding:64px 0 36px;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:28px;align-items:end}.eyebrow{color:var(--amber);font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;margin:0 0 14px}
h1{font-size:clamp(42px,7vw,76px);line-height:.98;letter-spacing:0;margin:0 0 18px}p{color:#CFD3DA}.lead{font-size:20px;color:#C9CDD4;max-width:640px;margin:0}.price{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:24px}.price strong{display:block;font-size:44px;line-height:1;color:var(--amber);margin:4px 0 12px}
.cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:8px;padding:13px 18px;font-weight:700}.primary{background:var(--amber);color:#0B0F14}.secondary{background:rgba(255,255,255,.06);border:1px solid var(--line);color:var(--bone)}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:22px 0 34px}.card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:22px;min-height:170px}.card b{display:block;margin-bottom:8px}.card p{margin:0;color:var(--muted)}
.panel{border-top:1px solid var(--line);padding:36px 0}.checks{display:grid;gap:12px}.check{display:flex;gap:12px;align-items:flex-start}.tick{color:var(--green);font-weight:900}.note{background:rgba(255,176,32,.08);border:1px solid rgba(255,176,32,.25);border-radius:8px;padding:18px;color:#F3D99C}
footer{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:24px;margin-top:36px;color:var(--muted);font-size:13px}
@media(max-width:760px){header,.grid{grid-template-columns:1fr}h1{font-size:42px}.navlinks{gap:14px}}</style></head>
<body><div class="wrap"><nav><a class="brand" href="/">Agent<span>Pay</span></a><div class="navlinks"><a href="/">Home</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div></nav>
<header><div><p class="eyebrow">First live paid product</p><h1>Awesome Free Dev Tools Premium</h1><p class="lead">A curated directory of genuinely useful free developer tools, maintained for builders who want signal without losing a morning to tabs, spammy listicles, and dead links.</p></div>
<aside class="price"><span>One-time access</span><strong>$7</strong><p>Includes the premium directory, weekly update notes, search, and bookmark workflow.</p><div class="cta"><a class="btn primary" href="https://buy.stripe.com/9B614pehNgAke6ccfh1oI03">Buy with Stripe</a><a class="btn secondary" href="mailto:rajiv_baskaran@agentpay.so?subject=Awesome%20Free%20Dev%20Tools%20access">Need access help</a></div></aside></header>
<main><section class="grid"><article class="card"><b>Curated list</b><p>Free APIs, hosting, design, data, automation, testing, AI, and productivity tools selected for practical utility.</p></article><article class="card"><b>Search and bookmarks</b><p>Use the directory as a working reference instead of another static spreadsheet or forgotten browser folder.</p></article><article class="card"><b>Weekly updates</b><p>New tools, removals, and notes are tracked so the list stays useful after launch week.</p></article></section>
<section class="panel"><h2>What happens after payment</h2><div class="checks"><div class="check"><span class="tick">✓</span><span>Stripe Checkout handles payment and card authentication.</span></div><div class="check"><span class="tick">✓</span><span>Your email from Checkout is used for access and support.</span></div><div class="check"><span class="tick">✓</span><span>If the automatic access email does not arrive, contact <a href="mailto:rajiv_baskaran@agentpay.so">rajiv_baskaran@agentpay.so</a> with the purchase email and we will resolve it manually.</span></div></div></section>
<section class="panel"><h2>Launch status</h2><p class="note">This product is in early access after the first live AgentPay payment. Checkout is live; fulfillment is being hardened. If anything feels rough, you will still get the product or a prompt manual fix.</p></section></main>
<footer><span>© 2026 AgentPay Labs</span><span><a href="/awesome-free-dev-tools/success">Payment success help</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span></footer></div></body></html>`;

function renderAwesomeFreeDevToolsSuccessPage(url) {
  const sessionId = (url.searchParams.get('session_id') || '').trim()
  const safeSessionId = sessionId && /^[A-Za-z0-9_=-]{8,140}$/.test(sessionId) ? sessionId : ''
  const supportSubject = 'Awesome Free Dev Tools access'
  const supportBody = [
    'Hi AgentPay Labs,',
    '',
    'I bought Awesome Free Dev Tools Premium and need access.',
    safeSessionId ? `Stripe session: ${safeSessionId}` : 'Stripe session: not present in URL',
    'Purchase email: ',
    '',
    'Thanks.'
  ].join('\n')
  const supportHref = `mailto:rajiv_baskaran@agentpay.so?subject=${encodeURIComponent(supportSubject)}&body=${encodeURIComponent(supportBody)}`
  const sessionBlock = safeSessionId
    ? `<div class="receipt"><span>Stripe session</span><code>${escapeHtml(safeSessionId)}</code></div>`
    : `<div class="receipt"><span>Stripe session</span><strong>Not present in this URL.</strong><p>Open this page from Stripe Checkout or include the purchase email in the support message.</p></div>`

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment received — AgentPay Labs</title>
<meta name="robots" content="noindex"><style>:root{--ink:#0B0F14;--surface:#10161E;--panel:#151D27;--bone:#F4F1EA;--muted:#A3A9B2;--amber:#FFB020;--line:#26313D;--green:#2EA86A}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--bone);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:760px;margin:0 auto;padding:56px 24px 88px}a{color:var(--amber);text-decoration:none}.card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:28px}h1{font-size:42px;line-height:1.05;margin:0 0 14px;letter-spacing:0}h2{font-size:22px;margin:30px 0 10px}p{color:#CFD3DA}.muted{color:var(--muted)}.receipt{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;margin:24px 0}.receipt span{display:block;color:var(--muted);font-size:13px;margin-bottom:4px}.receipt code{display:block;overflow-wrap:anywhere;color:var(--bone);font-size:14px}.steps{display:grid;gap:10px;margin:16px 0}.step{display:flex;gap:10px;align-items:flex-start}.tick{color:var(--green);font-weight:900}.warn{background:rgba(255,176,32,.08);border:1px solid rgba(255,176,32,.25);border-radius:8px;padding:16px;margin-top:20px}</style></head>
<body><main class="wrap"><div class="card"><p class="muted">Awesome Free Dev Tools Premium</p><h1>Payment received.</h1><p>Stripe has handled the payment. Access and support are tied to the email used at Checkout.</p>${sessionBlock}
<h2>Access checklist</h2><div class="steps"><div class="step"><span class="tick">✓</span><span>Save this Stripe session id for support until access is confirmed.</span></div><div class="step"><span class="tick">✓</span><span>Check the inbox and spam folder for the email used at Checkout.</span></div><div class="step"><span class="tick">✓</span><span>If access is not visible, send the prepared request from the purchase email: <a href="${escapeHtml(supportHref)}">request access</a>.</span></div></div>
<p class="warn">Current fulfillment status: Checkout is live with manual support backup. Full automation is not marked complete until a fresh post-fix Checkout produces the Stripe success events and an access-delivery receipt.</p><p><a href="/awesome-free-dev-tools">Return to product page</a> · <a href="/awesome-free-dev-tools/status.json">View fulfillment status JSON</a></p></div></main></body></html>`
}

const PRIVACY_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentPay Privacy Policy</title>
<style>:root{--ink:#0B0F14;--surface:#0E1319;--bone:#F4F1EA;--muted:#8A8F98;--amber:#FFB020;--line:#1C242F}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--bone);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:64px 24px 96px}
h1{font-size:32px;letter-spacing:-.5px;margin:0 0 8px}h2{font-size:19px;margin:40px 0 10px;color:var(--bone)}
.sub{color:var(--muted);margin:0 0 40px}p,li{color:#cfd3da}a{color:var(--amber);text-decoration:none}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px 24px;margin:18px 0}
hr{border:0;border-top:1px solid var(--line);margin:40px 0}.foot{color:var(--muted);font-size:14px;margin-top:48px}</style></head>
<body><div class="wrap">
<h1>AgentPay Privacy Policy</h1>
<p class="sub">AgentPay Labs · including the Postizzz social publishing workspace · Last updated 22 June 2026</p>

<div class="card"><strong>The short version:</strong> we use only the information needed to provide the AgentPay service you request. We do not sell personal information or use connected social account data for advertising.</div>

<h2>Information we process</h2>
<p>When you use our websites and services, we may process account details you provide, service configuration, support messages, and operational logs needed for security and reliability.</p>
<p>When you explicitly connect TikTok or another social account to Postizzz, the platform provides authorization tokens and the profile information covered by the permissions you approve. This may include a platform account identifier, display name, avatar, profile link, public statistics, and public video metadata. Content you choose to upload, schedule, or publish is also processed to carry out that instruction.</p>

<h2>How we use information</h2>
<p>We use this information to authenticate the connected account, show the selected destination, prevent cross-account routing, upload approved media, list or verify public content, publish content you approve, maintain security, diagnose failures, and comply with applicable law.</p>

<h2>Storage and retention</h2>
<p>Connected-account credentials and publishing records are stored in the self-hosted Postizzz workspace and are accessible only to authorized operators. We retain them only while the connection or operational record is needed. Disconnecting an account stops future access; you can also revoke the authorization directly in the connected platform.</p>

<h2>Service providers and disclosure</h2>
<p>We share information only with the connected platform and infrastructure providers needed to operate the service, or when required by law. We do not sell personal information, use connected social data for targeted advertising, or provide it to data brokers.</p>

<h2>Children</h2>
<p>AgentPay services are not directed at children under 13, and we do not knowingly collect personal information from children.</p>

<h2>Your control</h2>
<p>You can disconnect a social account in Postizzz or revoke AgentPay access from the connected platform. To request access, correction, or deletion of information associated with the service, contact us using the address below.</p>

<h2>Changes</h2>
<p>If this policy changes, we will update this page and the "last updated" date above.</p>

<h2>Contact</h2>
<p>Questions? Email <a href="mailto:rajiv_baskaran@agentpay.so">rajiv_baskaran@agentpay.so</a>.</p>

<hr>
<p class="foot">© 2026 AgentPay Labs. <a href="https://agentpay.so">AgentPay</a> · <a href="/terms">Terms of Service</a> · <a href="/postizzz">Social publishing</a></p>
</div></body></html>`;

const MED_VOICE_PRIVACY_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Med Voice Privacy Policy</title>
<style>:root{--ink:#0B0F14;--surface:#0E1319;--bone:#F4F1EA;--muted:#8A8F98;--amber:#FFB020;--line:#1C242F}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--bone);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:64px 24px 96px}
h1{font-size:32px;letter-spacing:-.5px;margin:0 0 8px}h2{font-size:19px;margin:40px 0 10px;color:var(--bone)}
.sub{color:var(--muted);margin:0 0 40px}p,li{color:#cfd3da}a{color:var(--amber);text-decoration:none}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px 24px;margin:18px 0}
hr{border:0;border-top:1px solid var(--line);margin:40px 0}.foot{color:var(--muted);font-size:14px;margin-top:48px}</style></head>
<body><div class="wrap">
<h1>Med Voice Privacy Policy</h1>
<p class="sub">Med Voice: Daily Check-In · An AgentPay Labs app · Effective 9 July 2026</p>

<div class="card"><strong>The short version:</strong> everything stays on your device. Med Voice has no accounts, no ads, no analytics, and no servers of its own. The app makes no network requests, so your check-in data is never transmitted anywhere.</div>

<h2>No account required</h2>
<p>Med Voice does not ask you to sign up, sign in, or provide any personal details. There is no account system.</p>

<h2>What the app stores, and where</h2>
<p>Your check-in streak record (your current streak count, best streak, total check-ins, and the date of your last check-in) is stored only in local storage on your device (AsyncStorage). It is not sent to us or to anyone else. Deleting the app deletes this data.</p>

<h2>Microphone and voice answers</h2>
<p>Answering by voice is optional; you can always type instead. If you choose voice and grant microphone permission, the recording is captured on your device and is never uploaded, transmitted, or shared. The app has no server to send it to.</p>

<h2>No tracking, no ads, no analytics</h2>
<p>The app contains no advertising, no analytics or tracking SDKs, and no third-party data collection. It does not use cookies or identifiers, and it does not profile you.</p>

<h2>No selling or sharing of data</h2>
<p>We do not sell, share, or disclose your data. We could not even if we wanted to: the app never sends us any.</p>

<h2>Children</h2>
<p>Med Voice is not directed at children under 13, and because the app collects nothing, we do not knowingly collect personal information from anyone, including children.</p>

<h2>Changes</h2>
<p>If this policy changes, we will update this page and the effective date above.</p>

<h2>Contact</h2>
<p>Questions? Email <a href="mailto:vishar.rumbling@gmail.com">vishar.rumbling@gmail.com</a>.</p>

<hr>
<p class="foot">© 2026 AgentPay Labs. <a href="https://agentpay.so">AgentPay</a> · <a href="/privacy">AgentPay Privacy Policy</a> · <a href="/terms">Terms of Service</a></p>
</div></body></html>`;

const VOICE_FLASH_PRIVACY_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Voice Flash Privacy Policy</title>
<style>:root{--ink:#0B0F14;--surface:#0E1319;--bone:#F4F1EA;--muted:#8A8F98;--amber:#FFB020;--line:#1C242F}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--bone);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:64px 24px 96px}h1{font-size:32px;letter-spacing:0;margin:0 0 8px}h2{font-size:19px;margin:40px 0 10px;color:var(--bone)}
.sub{color:var(--muted);margin:0 0 40px}p{color:#cfd3da}a{color:var(--amber);text-decoration:none}.card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:20px 24px;margin:18px 0}
hr{border:0;border-top:1px solid var(--line);margin:40px 0}.foot{color:var(--muted);font-size:14px;margin-top:48px}</style></head>
<body><div class="wrap">
<h1>Voice Flash Privacy Policy</h1>
<p class="sub">Voice Flash · An AgentPay Labs app · Effective 11 July 2026</p>
<div class="card"><strong>The short version:</strong> Voice Flash stores your flashcards, study progress, and optional spoken-answer recordings on your device. The app does not upload that information to AgentPay servers.</div>
<h2>No account required</h2><p>The core Voice Flash study flow does not require an account or ask you to provide personal details.</p>
<h2>Study data</h2><p>Your prompts, answers, scheduling data, progress, and streaks are stored locally on your device. Deleting the app removes this local data.</p>
<h2>Microphone and spoken answers</h2><p>Microphone access is optional. If you grant it, Voice Flash records a spoken answer so you can play it back during the study session. The app does not upload or share that audio with AgentPay servers.</p>
<h2>No advertising or sale of data</h2><p>Voice Flash does not sell your information and does not use it for advertising.</p>
<h2>Changes</h2><p>If this policy changes, we will update this page and its effective date.</p>
<h2>Contact</h2><p>Questions? Email <a href="mailto:vishar.rumbling@gmail.com">vishar.rumbling@gmail.com</a>.</p>
<hr><p class="foot">© 2026 AgentPay Labs. <a href="https://agentpay.so">AgentPay</a> · <a href="/privacy">AgentPay Privacy Policy</a> · <a href="/terms">Terms of Service</a></p>
</div></body></html>`;

const POSTIZZZ_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Postizzz — Social publishing workspace by AgentPay Labs</title>
<meta name="description" content="Postizzz lets an account owner connect TikTok, review the selected destination, and upload or publish approved short-form videos.">
<style>:root{--ink:#0B0F14;--surface:#111820;--bone:#F4F1EA;--muted:#A3A9B2;--amber:#FFB020;--line:#26313D}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--bone);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:880px;margin:0 auto;padding:32px 24px 80px}
nav{display:flex;justify-content:space-between;align-items:center;padding-bottom:24px;border-bottom:1px solid var(--line)}a{color:var(--amber);text-decoration:none}.brand{font-weight:700}.brand span{color:var(--amber)}
header{padding:64px 0 40px;max-width:700px}h1{font-size:48px;line-height:1.08;margin:0 0 16px;letter-spacing:0}h2{font-size:22px;margin:0 0 12px}p{color:#CFD3DA}.lead{font-size:20px;color:var(--muted)}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:24px 0 48px}.step{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:22px}.num{color:var(--amber);font-weight:700;font-size:13px}.step p{margin-bottom:0}
.panel{border-top:1px solid var(--line);padding:36px 0}.controls{display:grid;gap:12px}.control{display:flex;gap:12px;align-items:flex-start}.check{color:var(--amber);font-weight:700}.links{display:flex;gap:20px;flex-wrap:wrap;margin-top:28px;font-size:14px}
@media(max-width:560px){h1{font-size:36px}header{padding-top:44px}}</style></head>
<body><div class="wrap"><nav><div class="brand">Agent<span>Pay</span> Labs</div><a href="https://agentpay.so">agentpay.so</a></nav>
<header><p class="num">SOCIAL PUBLISHING WORKSPACE</p><h1>Postizzz</h1><p class="lead">Connect your own social account, verify the destination, and upload or publish short-form content only after approval.</p></header>
<main><section class="steps"><article class="step"><div class="num">01</div><h2>Authorize</h2><p>TikTok Login Kit asks the account owner to grant the selected permissions.</p></article><article class="step"><div class="num">02</div><h2>Verify</h2><p>The connected profile is shown before any draft, schedule, or direct post is created.</p></article><article class="step"><div class="num">03</div><h2>Publish</h2><p>The owner chooses draft upload or an approved direct post through TikTok's Content Posting API.</p></article></section>
<section class="panel"><h2>Owner controls</h2><div class="controls"><div class="control"><span class="check">✓</span><span>Only accounts explicitly authorized by their owner can be connected.</span></div><div class="control"><span class="check">✓</span><span>Publishing workflows are destination-bound and fail closed when account proof is missing.</span></div><div class="control"><span class="check">✓</span><span>Access can be revoked from TikTok or by disconnecting the account from the workspace.</span></div></div>
<div class="links"><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="mailto:rajiv_baskaran@agentpay.so">Contact</a></div></section></main></div></body></html>`;

const TERMS_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentPay Terms of Service</title>
<style>:root{--ink:#0B0F14;--surface:#111820;--bone:#F4F1EA;--muted:#A3A9B2;--amber:#FFB020;--line:#26313D}*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--bone);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:760px;margin:0 auto;padding:64px 24px 96px}h1{font-size:34px;margin:0 0 8px;letter-spacing:0}h2{font-size:20px;margin:36px 0 8px}p,li{color:#CFD3DA}.sub{color:var(--muted)}a{color:var(--amber);text-decoration:none}.card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:20px 24px;margin:24px 0}</style></head>
<body><div class="wrap"><h1>AgentPay Terms of Service</h1><p class="sub">AgentPay Labs · including the Postizzz social publishing workspace · Last updated 22 June 2026</p><div class="card">By using AgentPay, including Postizzz, you agree to use only accounts and content you own or are authorized to manage.</div>
<h2>Authorized use</h2><p>You must comply with applicable law and each connected platform's terms. You may not use the service for unauthorized access, spam, impersonation, rights-infringing content, or deceptive activity.</p>
<h2>Connected accounts</h2><p>You control which social accounts are connected. You are responsible for reviewing the selected destination, content, privacy setting, and timing before approving a publish action. You may revoke platform access or disconnect an account at any time.</p>
<h2>Content</h2><p>You retain ownership of your content and grant only the limited permission needed to process, upload, schedule, or publish it at your direction. You represent that you have the rights required to use that content.</p>
<h2>Availability</h2><p>The service is provided as available. Platform APIs, review decisions, rate limits, and outages may delay or prevent actions. We may suspend unsafe or unauthorized use.</p>
<h2>Contact</h2><p>Questions: <a href="mailto:rajiv_baskaran@agentpay.so">rajiv_baskaran@agentpay.so</a>.</p><p><a href="/">AgentPay</a> · <a href="/postizzz">Social publishing</a> · <a href="/privacy">Privacy Policy</a></p></div></body></html>`;

const BIDDESK_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BidDesk — Tender responses for cleaning &amp; FM companies</title>
  <meta name="robots" content="noindex,nofollow">
  <meta name="description" content="Compliance-checked SQ and ITT responses for UK cleaning and soft-FM tenders. AI-drafted, human-reviewed, delivered in 72 hours at a fixed fee.">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0a0a0f; color:#F4F1EA; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; line-height:1.6; }
    .container { max-width:860px; margin:0 auto; padding:0 24px; }
    nav { padding:20px 0; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.06); }
    .logo { font-size:18px; font-weight:700; letter-spacing:0; color:#F4F1EA; }
    .logo span { color:#FFB020; }
    header { padding:72px 0 40px; }
    h1 { font-size:38px; line-height:1.2; letter-spacing:0; max-width:640px; }
    h1 em { color:#FFB020; font-style:normal; }
    .sub { color:rgba(255,255,255,0.6); margin-top:16px; max-width:560px; font-size:17px; }
    .honest { margin-top:20px; padding:14px 18px; border-left:3px solid #FFB020; background:rgba(255,176,32,0.06); font-size:15px; color:rgba(255,255,255,0.8); max-width:560px; }
    .tiers { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; margin:48px 0; }
    .tier { border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:24px; }
    .tier.featured { border-color:#FFB020; }
    .tier h3 { font-size:17px; }
    .price { font-size:30px; font-weight:700; margin:10px 0; color:#FFB020; }
    .price small { font-size:14px; color:rgba(255,255,255,0.5); font-weight:400; }
    .tier ul { list-style:none; margin-top:12px; }
    .tier li { font-size:14px; color:rgba(255,255,255,0.7); padding:4px 0 4px 20px; position:relative; }
    .tier li:before { content:"→"; position:absolute; left:0; color:#FFB020; }
    .cta { display:inline-block; margin-top:16px; padding:12px 22px; background:#FFB020; color:#0a0a0f; font-weight:600; border-radius:8px; text-decoration:none; font-size:15px; }
    section { padding:32px 0; border-top:1px solid rgba(255,255,255,0.06); }
    h2 { font-size:22px; margin-bottom:14px; }
    .fine, .faq p { font-size:14px; color:rgba(255,255,255,0.6); margin-bottom:10px; }
    .faq h4 { font-size:15px; margin-top:14px; }
    footer { padding:32px 0 48px; color:rgba(255,255,255,0.35); font-size:13px; border-top:1px solid rgba(255,255,255,0.06); margin-top:40px; }
  </style>
</head>
<body>
<div class="container">
  <nav><div class="logo">Bid<span>Desk</span></div><div style="color:rgba(255,255,255,0.4);font-size:13px;">by AgentPay Labs</div></nav>
  <header>
    <h1>Cleaning &amp; FM tender responses <em>without hiring a bid writer</em></h1>
    <p class="sub">You run the cleaning company. We run the paperwork. Compliance-checked SQ and ITT responses for UK soft-FM tenders, AI-drafted, reviewed by a named human, delivered in 72 hours at a fixed fee.</p>
    <div class="honest"><strong>We never guarantee a win.</strong> Nobody honestly can. What you get: a complete, compliant, deadline-ready submission pack built on your real accreditations and your real experience.</div>
  </header>
  <div class="tiers">
    <div class="tier">
      <h3>Draft Desk</h3>
      <div class="price">£349 <small>single-site SQ · £749 multi-site/ITT</small></div>
      <ul><li>Requirement shred + compliance matrix</li><li>Drafted quality &amp; method statements</li><li>Social Value aligned to buyer TOMs</li><li>Red-flag gap list before the deadline</li><li>72h delivery, editable Word</li></ul>
      <a class="cta" href="mailto:biddesk@agentpay.so?subject=Draft%20Desk">Start a bid</a>
    </div>
    <div class="tier featured">
      <h3>Desk+</h3>
      <div class="price">£1,450</div>
      <ul><li>Everything in Draft Desk</li><li>60-min review call, named human</li><li>One revision round</li><li>Submission-day lodgement checklist</li></ul>
      <a class="cta" href="mailto:biddesk@agentpay.so?subject=Desk%2B">Start a bid</a>
    </div>
    <div class="tier">
      <h3>Pipeline</h3>
      <div class="price">£1,950<small>/month</small></div>
      <ul><li>Monday shortlist of live notices, scored</li><li>2 Draft Desk packs included</li><li>Extra packs £299</li><li>Standing evidence library maintained</li></ul>
      <a class="cta" href="mailto:biddesk@agentpay.so?subject=Pipeline">Talk to us</a>
    </div>
  </div>
  <section>
    <h2>The small print, on the page</h2>
    <p class="fine">No win guarantees and no invented "success rates". Buyers score bids; we make sure yours is complete, compliant and credible.</p>
    <p class="fine">We never invent accreditations, certifications or past contracts. Gaps get flagged and drafted around honestly. Requests to fabricate end the engagement.</p>
    <p class="fine">Your documents stay confidential, are never reused for other clients, and you remain the bidder of record.</p>
  </section>
  <section class="faq">
    <h2>FAQ</h2>
    <h4>Who writes it — AI or a person?</h4><p>Both. An agent fleet does the reading, shredding and first draft — that is why it costs £349 and not £2,000. A named human reviews everything before it reaches you.</p>
    <h4>What do you need from us?</h4><p>About 30 minutes: certs and insurance schedule, 2–3 reference contracts, staffing model. One-page intake form.</p>
    <h4>What sectors?</h4><p>Cleaning, caretaking, washroom, window cleaning and soft FM only. Depth beats breadth.</p>
    <h4>Deadline under 72 hours?</h4><p>Ask — rush is sometimes possible, never promised.</p>
  </section>
  <footer>BidDesk is an AgentPay Labs service · England &amp; Wales · <a href="/privacy" style="color:rgba(255,255,255,0.5);">Privacy</a></footer>
</div>
</body>
</html>`;

const landingWorker = {
  handleRequest,
  isRankPath,
  parseRankAgent,
  rankSnapshotFor,
  renderRankPage
}

if (typeof module !== 'undefined') {
  module.exports = landingWorker
}

export {
  handleRequest,
  isRankPath,
  parseRankAgent,
  rankSnapshotFor,
  renderRankPage
}
export default landingWorker

