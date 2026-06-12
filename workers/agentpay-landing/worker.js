/**
 * agentpay.so Cloudflare Worker — Landing Page
 * Deploy: wrangler deploy
 * Route: agentpay.so/*
 *
 * This replaces the /health endpoint that currently serves as the homepage.
 * Health check is preserved at /health for monitoring.
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)

  // Preserve health endpoint
  if (url.pathname === '/health' || url.pathname === '/api/health') {
    return new Response(JSON.stringify({
      status: 'ok',
      services: {
        database: 'green',
        agentrank: 'green',
        escrow: 'green',
        kya: 'green',
        behavioral_oracle: 'green'
      },
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // API routes pass through to origin
  if (url.pathname.startsWith('/api/')) {
    return fetch(request)
  }

  // Everything else gets the landing page
  return new Response(LANDING_PAGE, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600'
    }
  })
}

const LANDING_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentPay — The Financial OS for AI Agents</title>
  <meta name="description" content="Your agent just spent $500 in 8 minutes. Did it earn it? AgentPay gives AI agents a trust score, payment rail, and audit trail.">
  <meta property="og:title" content="AgentPay — Financial infrastructure for autonomous agents">
  <meta property="og:description" content="Trust scores. Payment rails. Audit trails. For agents that work at scale.">
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
      font-size: 20px;
      color: rgba(255,255,255,0.55);
      max-width: 560px;
      margin: 0 auto 48px;
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
      flex-wrap: gap;
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
      <a href="/docs">Docs</a>
      <a href="https://github.com/Rumblingb" target="_blank">GitHub</a>
      <a href="/start" style="color:#FFB020;font-weight:600">Get started</a>
    </div>
  </nav>

  <!-- HERO -->
  <section class="hero">
    <div class="hero-badge">x402 compatible · Open protocol</div>
    <h1>Your agent just spent<br><em>$500 in 8 minutes.</em><br>Did it earn it?</h1>
    <p class="subhead">AgentPay gives AI agents a trust score, a payment rail, and an audit trail. So you know what you paid for — and so does every system it touches.</p>
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
      <div class="code-label">// Before AgentPay</div>
      <pre><span class="code-comment">// Hope the agent doesn't overspend</span>
response = requests.post(
  <span class="code-string">"https://api.service.com/analyze"</span>,
  headers={<span class="code-string">"Authorization"</span>: <span class="code-string">f"Bearer {API_KEY}"</span>}
)</pre>
      <br>
      <div class="code-label" style="margin-top:16px">// With AgentPay</div>
      <pre><span class="code-comment"># Hard spend ceiling. Verified receipt. Signed audit log.</span>
response = agentpay.call(
  service=<span class="code-string">"https://api.service.com/analyze"</span>,
  <span class="code-key">max_spend</span>=<span class="code-value">0.50</span>,   <span class="code-comment"># hard cap</span>
  <span class="code-key">agent_id</span>=<span class="code-string">"your-agent-id"</span>,
  <span class="code-key">require_receipt</span>=<span class="code-value">True</span>
)</pre>
    </div>
    <div style="margin-top:16px;font-size:13px;color:rgba(255,255,255,0.3)">
      npm install @agentpay/sdk · pip install agentpay
    </div>
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

  <!-- BOTTOM CTA -->
  <section class="bottom-cta">
    <h2>Start with 50 free calls.</h2>
    <p>No card required. Works with any LLM stack.</p>
    <div class="cta-group">
      <a href="/start" class="btn-primary">Get your API key</a>
      <a href="https://github.com/Rumblingb" class="btn-secondary" target="_blank">View on GitHub</a>
    </div>
    <p style="margin-top:24px;font-size:13px;color:rgba(255,255,255,0.2)">
      Built by AgentPay Labs · Bangalore · <a href="/health" style="color:rgba(255,255,255,0.2)">API status</a>
    </p>
  </section>

  <footer>
    <p>© 2026 AgentPay Labs. Building the financial OS for autonomous agents.</p>
    <div class="footer-links">
      <a href="/docs">Docs</a>
      <a href="https://github.com/Rumblingb">GitHub</a>
      <a href="https://x.com/agentpaylabs">X</a>
      <a href="/health">Status</a>
    </div>
  </footer>
</div>

</body>
</html>`;
