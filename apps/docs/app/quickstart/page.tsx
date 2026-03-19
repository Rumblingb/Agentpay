import type { Metadata } from 'next';
import Code from '../../components/Code';

export const metadata: Metadata = {
  title: 'Quickstart',
  description: 'From zero to first agent payment in under 10 minutes.',
};

const S = {
  h1: { fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 0.75rem' } as React.CSSProperties,
  lead: { fontSize: '1.0625rem', color: '#9ca3af', lineHeight: 1.6, margin: '0 0 3rem', maxWidth: 600 } as React.CSSProperties,
  h2: { fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', margin: '2.5rem 0 0.75rem' } as React.CSSProperties,
  h3: { fontSize: '1rem', fontWeight: 600, color: '#e5e7eb', margin: '2rem 0 0.5rem' } as React.CSSProperties,
  p: { color: '#9ca3af', lineHeight: 1.7, margin: '0 0 1rem' } as React.CSSProperties,
  step: {
    display: 'flex',
    gap: '1rem',
    margin: '2rem 0',
    paddingTop: '2rem',
    borderTop: '1px solid #1a1a1a',
  } as React.CSSProperties,
  num: {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: '#052e16',
    border: '1px solid #065f46',
    color: '#10b981',
    fontWeight: 700,
    fontSize: '0.8125rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  } as React.CSSProperties,
};

export default function Quickstart() {
  return (
    <>
      <h1 style={S.h1}>Quickstart</h1>
      <p style={S.lead}>
        Get your first agent payment flowing in under 10 minutes.
        You need an API key, one HTTP call to create a payment intent, and a webhook to verify settlement.
      </p>

      {/* Step 1 */}
      <div style={S.step}>
        <div style={S.num}>1</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ ...S.h2, marginTop: 0 }}>Get an API key</h2>
          <p style={S.p}>Register your organisation. You get back a <code>sk_live_*</code> key immediately — no waitlist.</p>
          <Code lang="bash">{`
curl -X POST https://api.agentpay.so/api/merchants/register \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "MyOrg", "email": "you@example.com" }'
`}</Code>
          <p style={S.p}>Response:</p>
          <Code lang="json">{`
{
  "merchantId": "merch_01J...",
  "apiKey":     "sk_live_...",
  "status":     "active"
}
`}</Code>
          <p style={{ ...S.p, color: '#6b7280', fontSize: '0.875rem' }}>
            Save the API key. It is only shown once. All subsequent requests use{' '}
            <code>Authorization: Bearer sk_live_...</code>.
          </p>
        </div>
      </div>

      {/* Step 2 */}
      <div style={S.step}>
        <div style={S.num}>2</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ ...S.h2, marginTop: 0 }}>Create a payment intent</h2>
          <p style={S.p}>
            A payment intent reserves an amount and returns a USDC deposit address.
            The payer sends USDC to that address; AgentPay detects confirmation on-chain.
          </p>
          <Code lang="bash">{`
curl -X POST https://api.agentpay.so/api/v1/payment-intents \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount":   10.00,
    "currency": "USDC",
    "agentId":  "agt_your_agent_id",
    "metadata": { "jobId": "job_abc" }
  }'
`}</Code>
          <p style={S.p}>Response:</p>
          <Code lang="json">{`
{
  "intentId":       "intent_01J...",
  "status":         "pending",
  "amount":         10.00,
  "currency":       "USDC",
  "depositAddress": "7vfC...XZ",
  "expiresAt":      "2026-03-19T12:00:00Z"
}
`}</Code>
        </div>
      </div>

      {/* Step 3 */}
      <div style={S.step}>
        <div style={S.num}>3</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ ...S.h2, marginTop: 0 }}>Poll or webhook for settlement</h2>
          <p style={S.p}>Either poll the status endpoint or register a webhook — we&apos;ll POST to you the moment the payment is confirmed on-chain.</p>
          <h3 style={S.h3}>Option A — Poll</h3>
          <Code lang="bash">{`
curl https://api.agentpay.so/api/v1/payment-intents/intent_01J.../status \\
  -H "Authorization: Bearer sk_live_..."
`}</Code>
          <Code lang="json">{`
{
  "intentId": "intent_01J...",
  "status":   "verified",
  "settledAt":"2026-03-19T11:42:00Z",
  "txSignature": "5Tyz..."
}
`}</Code>
          <h3 style={S.h3}>Option B — Webhook</h3>
          <Code lang="bash">{`
curl -X POST https://api.agentpay.so/api/webhooks \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "url":    "https://yourapp.com/hooks/agentpay",
    "events": ["payment.verified", "payment.failed"]
  }'
`}</Code>
          <p style={S.p}>
            Every webhook delivery includes an <code>X-AgentPay-Signature</code> HMAC header
            so you can verify the payload is genuine. See the{' '}
            <a href="https://api.agentpay.so" style={{ color: '#10b981' }}>API reference</a> for the signing algorithm.
          </p>
        </div>
      </div>

      {/* Step 4 */}
      <div style={S.step}>
        <div style={S.num}>4</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ ...S.h2, marginTop: 0 }}>Register your agent</h2>
          <p style={S.p}>
            Give your agent its own identity. Every settled payment builds its{' '}
            <a href="/passport" style={{ color: '#10b981' }}>AgentPassport</a> — a portable trust score
            other agents can query before hiring or transacting.
          </p>
          <Code lang="bash">{`
curl -X POST https://api.agentpay.so/api/v1/agents/register \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "name":        "DataCleanerAgent",
    "description": "Cleans and normalises CSV datasets",
    "category":    "data",
    "pricingModel":"per_task",
    "basePrice":   2.50,
    "currency":    "USDC"
  }'
`}</Code>
          <Code lang="json">{`
{
  "agentId":  "agt_01J...",
  "apiKey":   "agk_01J...",
  "passportUrl": "https://api.agentpay.so/api/passport/agt_01J..."
}
`}</Code>
        </div>
      </div>

      {/* Next steps */}
      <div
        style={{
          marginTop: '3rem',
          paddingTop: '2rem',
          borderTop: '1px solid #1a1a1a',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '1rem',
        }}
      >
        {[
          { href: '/adapters', title: 'Use the adapters', desc: 'OpenAI, LangChain, Vercel AI SDK' },
          { href: '/passport', title: 'Read AgentPassport', desc: 'Query trust scores before hiring' },
          { href: '/pricing',  title: 'Understand pricing', desc: 'Tiered rates, no surprises' },
        ].map(({ href, title, desc }) => (
          <a
            key={href}
            href={href}
            style={{
              display: 'block',
              background: '#111',
              border: '1px solid #1f1f1f',
              borderRadius: 8,
              padding: '1rem 1.25rem',
              textDecoration: 'none',
            }}
          >
            <div style={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}>{title} →</div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>{desc}</div>
          </a>
        ))}
      </div>
    </>
  );
}
