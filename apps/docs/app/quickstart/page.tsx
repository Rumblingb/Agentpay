import type { Metadata } from 'next';
import Link from 'next/link';
import Code from '../../components/Code';

export const metadata: Metadata = {
  title: 'Quickstart - AgentPay Docs',
  description: 'Get AgentPay running in 2 minutes via MCP server, or 5 minutes via REST API.',
};

const G = '#10b981';

const S = {
  h1: { fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 0.75rem' } as React.CSSProperties,
  lead: { fontSize: '1.0625rem', color: '#9ca3af', lineHeight: 1.6, margin: '0 0 2.5rem', maxWidth: 700 } as React.CSSProperties,
  h2: { fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', margin: '2.5rem 0 0.75rem' } as React.CSSProperties,
  h3: { fontSize: '1rem', fontWeight: 600, color: '#e5e7eb', margin: '1.75rem 0 0.5rem' } as React.CSSProperties,
  p: { color: '#9ca3af', lineHeight: 1.7, margin: '0 0 1rem' } as React.CSSProperties,
  step: { display: 'flex', gap: '1rem', margin: '2rem 0', paddingTop: '2rem', borderTop: '1px solid #1a1a1a' } as React.CSSProperties,
  num: { flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: '#052e16', border: '1px solid #065f46', color: G, fontWeight: 700, fontSize: '0.8125rem', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 } as React.CSSProperties,
};

export default function Quickstart() {
  return (
    <>
      <h1 style={S.h1}>Quickstart</h1>
      <p style={S.lead}>
        Three paths. Start with the hosted edge flow, then drop to local development only if you are contributing or self-hosting.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '3rem' }}>
        {[
          { label: 'MCP server', time: '~2 min', desc: 'Claude Desktop, Cursor, any MCP host', anchor: '#mcp', primary: true },
          { label: 'REST API', time: '~5 min', desc: 'Any language, direct HTTP calls', anchor: '#rest', primary: false },
          { label: 'Local dev', time: '~20 min', desc: 'Contributing, self-hosting', anchor: '#local', primary: false },
        ].map(({ label, time, desc, anchor, primary }) => (
          <a key={anchor} href={anchor} style={{ display: 'block', background: primary ? '#0d1f17' : '#111', border: `1px solid ${primary ? '#065f46' : '#1f1f1f'}`, borderRadius: 8, padding: '1rem 1.25rem', textDecoration: 'none' }}>
            <div style={{ fontWeight: 700, color: '#fff', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: '0.75rem', color: G, fontFamily: 'monospace', marginBottom: 6 }}>{time}</div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>{desc}</div>
          </a>
        ))}
      </div>

      <div id="mcp" style={{ scrollMarginTop: 80 }}>
        <div style={{ display: 'inline-block', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: G, background: '#052e16', border: '1px solid #065f46', padding: '0.2rem 0.6rem', borderRadius: 4, marginBottom: '1rem' }}>Path A - MCP server</div>
        <h2 style={{ ...S.h2, marginTop: '0.5rem' }}>MCP server (~2 min)</h2>

        <div style={S.step}>
          <div style={S.num}>1</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ ...S.h3, marginTop: 0 }}>Get an API key</h3>
            <p style={S.p}>Register with one curl call - no Solana wallet, no Stripe account needed to start.</p>
            <Code lang="bash">{`curl -s -X POST https://api.agentpay.so/api/merchants/register \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "My Agent", "email": "you@example.com" }'`}</Code>
            <Code lang="json">{`{ "merchantId": "mer_...", "apiKey": "apk_..." }`}</Code>
            <p style={{ ...S.p, fontSize: '0.875rem', color: '#6b7280' }}>Save both values. The API key is shown once.</p>
          </div>
        </div>

        <div style={S.step}>
          <div style={S.num}>2</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ ...S.h3, marginTop: 0 }}>Add to Claude Desktop</h3>
            <p style={S.p}>Edit <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) or <code>%APPDATA%\Claude\claude_desktop_config.json</code> (Windows):</p>
            <Code lang="json">{`{
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
}`}</Code>
            <p style={S.p}>Restart Claude Desktop.</p>
          </div>
        </div>

        <div style={S.step}>
          <div style={S.num}>3</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ ...S.h3, marginTop: 0 }}>Try it</h3>
            <p style={S.p}>Ask Claude any of these:</p>
            <div style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 8, padding: '1rem 1.25rem', fontFamily: 'monospace', fontSize: '0.875rem', lineHeight: 2, color: '#9ca3af' }}>
              <div><span style={{ color: '#6b7280' }}>&gt; </span>"Create a governed mandate to book a train, budget 100 GBP, require my approval above 50."</div>
              <div><span style={{ color: '#6b7280' }}>&gt; </span>"Connect Firecrawl without exposing the raw API key to the agent."</div>
              <div><span style={{ color: '#6b7280' }}>&gt; </span>"Create a 5 dollar payment request for a research task."</div>
              <div><span style={{ color: '#6b7280' }}>&gt; </span>"Look up the AgentPassport for agent_001."</div>
            </div>
            <p style={{ ...S.p, marginTop: '1rem' }}>Claude calls the AgentPay tools and returns the result. No dashboard. No copy-pasting credentials.</p>
          </div>
        </div>

        <div style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 8, padding: '1rem 1.25rem', marginTop: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600 }}>Remote MCP (no local process)</div>
          <code style={{ color: G, fontSize: '0.875rem', fontFamily: 'monospace', display: 'block', marginBottom: 6 }}>https://api.agentpay.so/api/mcp</code>
          <span style={{ color: '#6b7280', fontSize: '0.8125rem' }}>Pass your API key as <code>Authorization: Bearer apk_...</code></span>
        </div>

        <p style={{ ...S.p, marginTop: '1.5rem' }}>
          <Link href="/mcp" style={{ color: G }}>Full MCP reference {"->"}</Link>
          {' '}with all 30+ tools, parameters, and examples.
        </p>
      </div>

      <div id="rest" style={{ scrollMarginTop: 80, marginTop: '4rem', paddingTop: '3rem', borderTop: '2px solid #1a1a1a' }}>
        <div style={{ display: 'inline-block', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#6b7280', background: '#111', border: '1px solid #1f1f1f', padding: '0.2rem 0.6rem', borderRadius: 4, marginBottom: '1rem' }}>Path B - REST API</div>
        <h2 style={{ ...S.h2, marginTop: '0.5rem' }}>REST API (~5 min)</h2>

        <div style={S.step}>
          <div style={S.num}>1</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ ...S.h3, marginTop: 0 }}>Register</h3>
            <Code lang="bash">{`curl -s -X POST https://api.agentpay.so/api/merchants/register \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "My Agent", "email": "you@example.com" }'`}</Code>
          </div>
        </div>

        <div style={S.step}>
          <div style={S.num}>2</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ ...S.h3, marginTop: 0 }}>Create a governed mandate</h3>
            <p style={S.p}>A mandate captures what the agent is allowed to do, the budget cap, and the approval policy.</p>
            <Code lang="bash">{`curl -s -X POST https://api.agentpay.so/api/mandates \\
  -H "Authorization: Bearer apk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "merchantId": "mer_...",
    "objective": "Book a train London to Bristol",
    "budgetCap": 50,
    "currency": "GBP",
    "approvalThreshold": 20,
    "agentId": "my-agent-01"
  }'`}</Code>
            <Code lang="json">{`{
  "success": true,
  "intentId": "mnd_...",
  "status": "pending_approval",
  "recommendation": "Cheapest direct service: 24.50 GBP, 07:04 depart"
}`}</Code>
          </div>
        </div>

        <div style={S.step}>
          <div style={S.num}>3</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ ...S.h3, marginTop: 0 }}>Approve and execute</h3>
            <Code lang="bash">{`# Approve
curl -s -X POST https://api.agentpay.so/api/mandates/mnd_.../approve \\
  -H "Authorization: Bearer apk_..."

# Execute
curl -s -X POST https://api.agentpay.so/api/mandates/mnd_.../execute \\
  -H "Authorization: Bearer apk_..."

# Get receipt
curl -s https://api.agentpay.so/api/receipt/mnd_...`}</Code>
          </div>
        </div>

        <div style={S.step}>
          <div style={S.num}>4</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ ...S.h3, marginTop: 0 }}>Capability Vault flow</h3>
            <p style={S.p}>Start a connect session. The user opens the connect URL, enters their key once, and AgentPay vaults it for future governed execution.</p>
            <Code lang="bash">{`curl -s -X POST https://api.agentpay.so/api/capabilities/connect-sessions \\
  -H "Authorization: Bearer apk_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "provider": "firecrawl", "merchantId": "mer_...", "agentId": "my-agent-01" }'`}</Code>
            <Code lang="json">{`{
  "sessionId": "cap_sess_...",
  "status": "auth_required",
  "connectUrl": "https://api.agentpay.so/connect/cap_sess_..."
}`}</Code>
          </div>
        </div>
      </div>

      <div id="local" style={{ scrollMarginTop: 80, marginTop: '4rem', paddingTop: '3rem', borderTop: '2px solid #1a1a1a' }}>
        <div style={{ display: 'inline-block', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#6b7280', background: '#111', border: '1px solid #1f1f1f', padding: '0.2rem 0.6rem', borderRadius: 4, marginBottom: '1rem' }}>Path C - Local dev</div>
        <h2 style={{ ...S.h2, marginTop: '0.5rem' }}>Local development (~20 min)</h2>
        <p style={S.p}>For contributors or self-hosters. Requires Node.js 20+, Docker, and Wrangler.</p>

        <Code lang="bash">{`git clone https://github.com/Rumblingb/Agentpay.git
cd Agentpay
npm ci
cp .env.example .env`}</Code>

        <p style={S.p}>Required secrets to start the API:</p>
        <Code lang="bash">{`DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
WEBHOOK_SECRET=<any-32-char-string>`}</Code>
        <p style={{ ...S.p, fontSize: '0.875rem', color: '#6b7280' }}>Everything else is optional. Missing integrations should fail closed on their own routes, not block first boot.</p>

        <Code lang="bash">{`# Workers API on :8787
cd apps/api-edge && npx wrangler dev

# Dashboard on :3000
cd dashboard && npm run dev

# MCP server pointing at local API
AGENTPAY_API_URL=http://localhost:8787 \\
AGENTPAY_API_KEY=apk_dev_test \\
npx -y @agentpayxyz/mcp-server`}</Code>
      </div>

      <div style={{ marginTop: '3.5rem', paddingTop: '2rem', borderTop: '1px solid #1a1a1a', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
        {[
          { href: '/mcp', title: 'MCP tool reference', desc: 'All 30+ tools with parameters' },
          { href: '/examples', title: 'Runnable examples', desc: 'Start from working flows, not a blank page' },
          { href: '/adapters', title: 'Use the adapters', desc: 'OpenAI, LangChain, Vercel AI SDK' },
          { href: '/passport', title: 'AgentPassport', desc: 'Portable identity and trust' },
          { href: '/pricing', title: 'Pricing', desc: 'Launch free - Builder $39 - Growth $149' },
        ].map(({ href, title, desc }) => (
          <Link key={href} href={href} style={{ display: 'block', background: '#111', border: '1px solid #1f1f1f', borderRadius: 8, padding: '1rem 1.25rem', textDecoration: 'none' }}>
            <div style={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}>{title} {"->"}</div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>{desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
