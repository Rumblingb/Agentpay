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
            Every delivery includes an <code>X-AgentPay-Signature</code> header —
            verify it before trusting the payload:
          </p>
          <Code lang="typescript">{`
// Node.js / TypeScript — verify webhook signature
import crypto from 'crypto';

app.post('/hooks/agentpay', express.raw({ type: 'application/json' }), (req, res) => {
  const sig      = req.headers['x-agentpay-signature'] as string; // "sha256=abc..."
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.AGENTPAY_WEBHOOK_SECRET!)
    .update(req.body)           // raw Buffer — must not parse JSON first
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(401).send('Bad signature');
  }

  const event = JSON.parse(req.body);
  if (event.type === 'payment.verified') {
    console.log('Settled:', event.intentId, event.amount);
  }
  res.sendStatus(200);
});
`}</Code>
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

      {/* Errors */}
      <div style={S.step}>
        <div style={S.num}>5</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ ...S.h2, marginTop: 0 }}>Error responses</h2>
          <p style={S.p}>
            All errors return a JSON body with an <code>error</code> string and an HTTP status code.
            Never parse the status code alone — always read <code>error</code> for the reason.
          </p>
          <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1f1f1f' }}>
                  {['Status', 'Code / error string', 'What it means', 'Fix'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['400', 'validation_error', 'Missing or invalid field in the request body', 'Read the error message — it names the bad field'],
                  ['401', 'unauthorized', 'API key missing or malformed', 'Add Authorization: Bearer sk_live_...'],
                  ['403', 'forbidden', 'Key valid but lacks permission for this resource', 'Use the key that owns this merchant / agent'],
                  ['404', 'not_found', 'Resource does not exist', 'Check the ID — agent or intent may not have been created yet'],
                  ['409', 'conflict', 'Action already taken (e.g. intent already verified)', 'Safe to ignore if idempotent; otherwise check current status'],
                  ['429', 'rate_limited', 'Too many requests', 'Back off with exponential retry; free tier: 60 req/min'],
                  ['500', 'internal_error', 'Something went wrong on our side', 'Retry once; if persistent, open a GitHub issue'],
                  ['503', 'service_unavailable', 'Planned maintenance or upstream outage', 'Check status.agentpay.so; retry with backoff'],
                ].map(([status, code, meaning, fix]) => (
                  <tr key={status} style={{ borderBottom: '1px solid #111' }}>
                    <td style={{ padding: '0.5rem 0.75rem', color: status.startsWith('4') ? '#f87171' : status === '503' ? '#fb923c' : '#fbbf24', fontWeight: 700, fontFamily: 'monospace' }}>{status}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: '#e5e7eb', fontFamily: 'monospace', fontSize: '0.75rem' }}>{code}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: '#9ca3af' }}>{meaning}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: '#6b7280' }}>{fix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Code lang="json">{`
// Every error response has this shape:
{
  "error":   "not_found",
  "message": "Payment intent intent_01J... does not exist",
  "status":  404
}
`}</Code>
          <p style={{ ...S.p, fontSize: '0.875rem', color: '#6b7280' }}>
            Retryable errors: <code>429</code>, <code>500</code>, <code>503</code>.
            Use exponential back-off starting at 1s. Non-retryable: <code>400</code>, <code>401</code>, <code>403</code>, <code>404</code>, <code>409</code>.
          </p>
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
