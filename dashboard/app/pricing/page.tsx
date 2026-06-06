import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AgentPay Pricing — 0.5% per settlement. No monthly fees.',
  description:
    'AgentPay charges 0.5% on confirmed settlements. Free to register, free to develop. No subscription. No minimum volume.',
};

const INCLUDED = [
  'Agent Passport — portable identity across every settlement',
  'Capability Vault — credential storage, zero keys in agent context',
  'Governed mandates — budget enforcement before execution',
  'Payment intents — USDC and card funding flows',
  'Settlement receipts — verifiable proof for every action',
  'AgentRank — trust scoring and leaderboard',
  'MCP server — install in Claude, GPT, Cursor in 30 seconds',
  'Remote MCP endpoint at api.agentpay.so/api/mcp',
];

const COMPARE = [
  { label: 'Monthly platform fee', agentpay: '—', stripe: '$0', custom: 'variable' },
  { label: 'Per-settlement fee', agentpay: '0.5%', stripe: '2.9% + 30¢', custom: 'N/A' },
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

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '80px 24px' }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 999, padding: '4px 14px', fontSize: 12, color: '#22c55e', marginBottom: 20, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Simple pricing
          </div>
          <h1 style={{ fontSize: 52, fontWeight: 900, letterSpacing: -1.6, color: '#f9fafb', lineHeight: 1.02, marginBottom: 20 }}>
            0.5% per settlement.<br />
            <span style={{ color: '#22c55e' }}>Nothing else.</span>
          </h1>
          <p style={{ fontSize: 18, color: '#9ca3af', maxWidth: 540, margin: '0 auto', lineHeight: 1.75 }}>
            No monthly fee. No minimum volume. No card required to register. Pay only when a settlement clears.
          </p>
        </div>

        {/* Pricing card */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1c1c1c', borderRadius: 24, padding: '48px', marginBottom: 48, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #22c55e, #14b8a6)' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Developer</div>
              <div style={{ fontSize: 56, fontWeight: 900, color: '#f9fafb', letterSpacing: -2, lineHeight: 1 }}>
                0.5<span style={{ fontSize: 28, color: '#9ca3af', fontWeight: 600 }}>%</span>
              </div>
              <div style={{ fontSize: 14, color: '#6b7280', marginTop: 8, marginBottom: 32 }}>per confirmed settlement</div>
              <Link href="/login" className="btn btn-green" style={{ width: '100%', padding: '14px' }}>
                Get API key — free
              </Link>
              <div style={{ marginTop: 12, fontSize: 12, color: '#4b5563', textAlign: 'center' }}>
                No card required · Instant API key
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#d1d5db', marginBottom: 20 }}>Everything included</div>
              <div style={{ display: 'grid', gap: 12 }}>
                {INCLUDED.map((item) => (
                  <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#9ca3af', lineHeight: 1.5 }}>
                    <span style={{ color: '#22c55e', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                    {item}
                  </div>
                ))}
              </div>
            </div>
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
                q: 'When do I pay?',
                a: 'Only when a settlement confirms. If an agent creates a payment intent that never clears, you pay nothing. The 0.5% is deducted from the settled amount.',
              },
              {
                q: 'What counts as a settlement?',
                a: 'A confirmed USDC transfer on-chain, or a card payment captured through the hosted funding flow. Pending intents, failed intents, and cancelled mandates incur no fee.',
              },
              {
                q: 'Is there a free tier?',
                a: 'Development is always free. You only pay when production settlements clear. There is no monthly fee, no seat fee, and no minimum volume requirement.',
              },
              {
                q: 'Can I use AgentPay without settlements?',
                a: 'Yes. Capability vaulting (credential management) and mandate governance are available without settlement. There is currently no fee for pure credential or mandate operations.',
              },
              {
                q: 'Do I need to manage Solana or USDC myself?',
                a: 'No. AgentPay handles the on-chain settlement. You register, get an API key, and the MCP server takes care of the rest.',
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
