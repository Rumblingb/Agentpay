import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AgentPay Pricing — Start free, scale with your agents',
  description:
    'Free to start. Launch plan at $0/mo. Builder at $39/mo. Growth at $149/mo. Plus 0.75% on funded agent actions. No hidden fees.',
};

const PLANS = [
  {
    code: 'launch',
    name: 'Launch',
    price: '$0',
    period: '/mo',
    tagline: 'Free forever',
    highlight: false,
    cta: 'Get started free',
    ctaHref: '/login',
    features: [
      '250 tool calls / month',
      '25 credential vaults',
      'MCP server + remote endpoint',
      'Agent Passport + trust graph',
      'Community support',
    ],
  },
  {
    code: 'builder',
    name: 'Builder',
    price: '$39',
    period: '/mo',
    tagline: 'For active agents',
    highlight: true,
    cta: 'Start building',
    ctaHref: '/login?plan=builder',
    features: [
      '10,000 tool calls / month',
      '500 credential vaults',
      '$0.40 / 1,000 overage calls',
      'Governed mandates + audit trail',
      'Email support',
    ],
  },
  {
    code: 'growth',
    name: 'Growth',
    price: '$149',
    period: '/mo',
    tagline: 'For production fleets',
    highlight: false,
    cta: 'Scale up',
    ctaHref: '/login?plan=growth',
    features: [
      '100,000 tool calls / month',
      '5,000 credential vaults',
      '$0.25 / 1,000 overage calls',
      'Priority support',
      'Custom mandate policies',
    ],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    tagline: 'For large deployments',
    highlight: false,
    cta: 'Talk to us',
    ctaHref: 'mailto:founders@agentpay.so',
    features: [
      'Unlimited tool calls',
      'Unlimited credential vaults',
      'SLA + dedicated support',
      'On-prem / private deployment',
      'Custom compliance + audit',
    ],
  },
];

const INCLUDED = [
  'Capability Vault — credential storage, zero keys in agent context',
  'Governed mandates — budget enforcement before execution',
  'Payment intents — card and UPI funding flows',
  'Settlement receipts — verifiable proof for every action',
  'AgentRank — trust scoring and leaderboard',
  'MCP server — install in Claude, GPT, Cursor in 30 seconds',
  'Remote MCP endpoint at api.agentpay.so/api/mcp',
];

const COMPARE = [
  { label: 'Monthly platform fee', agentpay: 'from $0/mo', stripe: '$0', custom: 'variable' },
  { label: 'Funded action fee', agentpay: '0.75%', stripe: '2.9% + 30¢', custom: 'N/A' },
  { label: 'Agent credential vaulting', agentpay: '✓ included', stripe: '✗', custom: 'build it yourself' },
  { label: 'Mandate enforcement', agentpay: '✓ included', stripe: '✗', custom: 'build it yourself' },
  { label: 'MCP-native integration', agentpay: '✓ included', stripe: '✗', custom: '✗' },
  { label: 'AgentPassport + trust graph', agentpay: '✓ included', stripe: '✗', custom: '✗' },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#050607] text-[#e5e7eb]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        * { box-sizing: border-box; }
        a { text-decoration: none; }
        .btn { display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 22px;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;border:none;transition:opacity 0.15s; }
        .btn-green { background:linear-gradient(135deg,#22c55e 0%,#14b8a6 100%);color:#04110a; }
        .btn-green:hover { opacity:0.9; }
        .btn-outline { background:transparent;color:#d1d5db;border:1px solid #2a2a2a; }
        .btn-outline:hover { border-color:#22c55e;color:#f9fafb; }
        .btn-ghost { background:transparent;color:#9ca3af;border:1px solid #1c1c1c; }
        .btn-ghost:hover { border-color:#374151;color:#d1d5db; }
        @media (max-width: 768px) {
          .plans-grid { grid-template-columns: 1fr !important; }
          .hero-title { font-size: 36px !important; }
        }
      `}</style>

      {/* Nav */}
      <header style={{ borderBottom: '1px solid #111', padding: '0 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/" style={{ fontWeight: 800, fontSize: 16, color: '#f9fafb', letterSpacing: -0.3 }}>
            Agent<span style={{ color: '#22c55e' }}>Pay</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <Link href="/docs" style={{ fontSize: 14, color: '#9ca3af' }}>Docs</Link>
            <Link href="/" style={{ fontSize: 14, color: '#9ca3af' }}>Home</Link>
            <Link href="/login" className="btn btn-green" style={{ padding: '8px 16px', fontSize: 13 }}>Get API key</Link>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 24px' }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 999, padding: '4px 14px', fontSize: 12, color: '#22c55e', marginBottom: 20, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Simple pricing
          </div>
          <h1 className="hero-title" style={{ fontSize: 52, fontWeight: 900, letterSpacing: -1.6, color: '#f9fafb', lineHeight: 1.02, marginBottom: 20 }}>
            Start free.<br />
            <span style={{ color: '#22c55e' }}>Scale as your agents do.</span>
          </h1>
          <p style={{ fontSize: 18, color: '#9ca3af', maxWidth: 520, margin: '0 auto', lineHeight: 1.75 }}>
            Monthly plans based on tool calls. Plus 0.75% on funded agent actions — only when money actually moves.
          </p>
        </div>

        {/* Plan cards */}
        <div className="plans-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 48 }}>
          {PLANS.map((plan) => (
            <div
              key={plan.code}
              style={{
                background: plan.highlight ? '#0a1a10' : '#0d0d0d',
                border: plan.highlight ? '1px solid rgba(34,197,94,0.4)' : '1px solid #1c1c1c',
                borderRadius: 20,
                padding: '32px 24px',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {plan.highlight && (
                <>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #22c55e, #14b8a6)' }} />
                  <div style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 999, padding: '2px 10px', fontSize: 11, color: '#22c55e', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Popular
                  </div>
                </>
              )}
              <div style={{ fontSize: 12, fontWeight: 700, color: plan.highlight ? '#22c55e' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                {plan.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 4 }}>
                <span style={{ fontSize: plan.price === 'Custom' ? 32 : 44, fontWeight: 900, color: '#f9fafb', letterSpacing: -1.5, lineHeight: 1 }}>
                  {plan.price}
                </span>
                {plan.period && (
                  <span style={{ fontSize: 15, color: '#6b7280', fontWeight: 500 }}>{plan.period}</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 24 }}>{plan.tagline}</div>
              <div style={{ display: 'grid', gap: 10, marginBottom: 28, flex: 1 }}>
                {plan.features.map((f) => (
                  <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#9ca3af', lineHeight: 1.5 }}>
                    <span style={{ color: '#22c55e', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                    {f}
                  </div>
                ))}
              </div>
              <Link
                href={plan.ctaHref}
                className={plan.highlight ? 'btn btn-green' : 'btn btn-ghost'}
                style={{ width: '100%', padding: '12px' }}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Funded actions callout */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1c1c1c', borderRadius: 16, padding: '24px 32px', marginBottom: 64, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Funded actions</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#f9fafb', letterSpacing: -0.5 }}>0.75% per funded action</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Min $0.25 · Max $15 · Only charged when money moves</div>
          </div>
          <div style={{ fontSize: 13, color: '#9ca3af', maxWidth: 420, lineHeight: 1.7 }}>
            When an agent creates a payment intent that clears — Stripe card, UPI — AgentPay charges 0.75% of the settled amount. No payment, no fee. This is in addition to your monthly plan.
          </div>
        </div>

        {/* What's included */}
        <div style={{ marginBottom: 64 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#f9fafb', marginBottom: 20, letterSpacing: -0.5 }}>Included on every plan</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {INCLUDED.map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#9ca3af', background: '#0d0d0d', border: '1px solid #1c1c1c', borderRadius: 10, padding: '12px 16px', lineHeight: 1.5 }}>
                <span style={{ color: '#22c55e', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Compare */}
        <div style={{ marginBottom: 64 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: '#f9fafb', marginBottom: 24, letterSpacing: -0.5 }}>How it compares</h2>
          <div style={{ background: '#0d0d0d', border: '1px solid #1c1c1c', borderRadius: 16, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1c1c1c' }}>
                  <th style={{ padding: '14px 20px', textAlign: 'left', color: '#6b7280', fontWeight: 600 }}></th>
                  <th style={{ padding: '14px 20px', textAlign: 'center', color: '#22c55e', fontWeight: 700 }}>AgentPay</th>
                  <th style={{ padding: '14px 20px', textAlign: 'center', color: '#9ca3af', fontWeight: 600 }}>Stripe Alone</th>
                  <th style={{ padding: '14px 20px', textAlign: 'center', color: '#9ca3af', fontWeight: 600 }}>Custom Build</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((row, i) => (
                  <tr key={row.label} style={{ borderBottom: i < COMPARE.length - 1 ? '1px solid #111' : 'none' }}>
                    <td style={{ padding: '14px 20px', color: '#9ca3af' }}>{row.label}</td>
                    <td style={{ padding: '14px 20px', textAlign: 'center', color: '#22c55e', fontWeight: 600 }}>{row.agentpay}</td>
                    <td style={{ padding: '14px 20px', textAlign: 'center', color: '#6b7280' }}>{row.stripe}</td>
                    <td style={{ padding: '14px 20px', textAlign: 'center', color: '#6b7280' }}>{row.custom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div style={{ marginBottom: 64 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: '#f9fafb', marginBottom: 24, letterSpacing: -0.5 }}>Common questions</h2>
          <div style={{ display: 'grid', gap: 16 }}>
            {[
              {
                q: 'What counts as a tool call?',
                a: 'Each time an agent calls an AgentPay MCP tool — create mandate, execute capability, get passport, etc. — counts as one tool call. Calls that return errors still count.',
              },
              {
                q: 'What is a funded action?',
                a: 'A funded action is a payment that clears through AgentPay — a Stripe card capture or UPI payment. The 0.75% fee is charged on the settled amount (min $0.25, max $15). If the intent is created but never funded, no fee applies.',
              },
              {
                q: 'Is there a genuinely free tier?',
                a: 'Yes. Launch is free forever — 250 tool calls and 25 credential vaults per month. No card required to register. Great for evaluation and low-volume agents.',
              },
              {
                q: 'What happens when I exceed my plan\'s tool calls?',
                a: 'Overage is metered automatically. Builder: $0.40 per 1,000 extra calls. Growth: $0.25 per 1,000. You won\'t be cut off — just billed at the overage rate.',
              },
              {
                q: 'Can I use AgentPay without making payments?',
                a: 'Yes. Capability vaulting and mandate governance work on any plan with no funded action fee. You only pay 0.75% when an agent actually moves money.',
              },
            ].map(({ q, a }) => (
              <div key={q} style={{ background: '#0d0d0d', border: '1px solid #1c1c1c', borderRadius: 14, padding: '20px 24px' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f9fafb', marginBottom: 8 }}>{q}</div>
                <div style={{ fontSize: 14, color: '#9ca3af', lineHeight: 1.7 }}>{a}</div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1c1c1c', borderRadius: 20, padding: '48px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: '#f9fafb', marginBottom: 12, letterSpacing: -0.5 }}>Ready to start?</h2>
          <p style={{ fontSize: 15, color: '#6b7280', marginBottom: 32, maxWidth: 400, margin: '0 auto 32px' }}>
            Register free. Install the MCP server. You&apos;re live in 2 minutes.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/login" className="btn btn-green" style={{ fontSize: 15, padding: '14px 28px' }}>
              Get API key
            </Link>
            <Link href="/docs" className="btn btn-outline">
              Read the quickstart
            </Link>
          </div>
        </div>

      </main>

      <footer style={{ borderTop: '1px solid #111', padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: '#374151' }}>
          <Link href="/" style={{ color: '#374151' }}>AgentPay</Link>
          {' · '}
          <Link href="/privacy" style={{ color: '#374151' }}>Privacy</Link>
          {' · '}
          <Link href="/terms" style={{ color: '#374151' }}>Terms</Link>
        </div>
      </footer>
    </div>
  );
}
