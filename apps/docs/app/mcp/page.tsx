import type { Metadata } from 'next';
import Link from 'next/link';
import Code from '../../components/Code';

export const metadata: Metadata = {
  title: 'MCP Server — AgentPay Docs',
  description: 'Full reference for the AgentPay MCP server. 30+ tools across mandates, credentials, payments, and identity.',
};

const G = '#10b981';

const S = {
  h1: { fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 0.75rem' } as React.CSSProperties,
  lead: { fontSize: '1.0625rem', color: '#9ca3af', lineHeight: 1.6, margin: '0 0 2.5rem', maxWidth: 620 } as React.CSSProperties,
  h2: { fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', margin: '3rem 0 0.75rem', paddingTop: '3rem', borderTop: '2px solid #1a1a1a' } as React.CSSProperties,
  h3: { fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#6b7280', margin: '2rem 0 0.75rem' } as React.CSSProperties,
  p: { color: '#9ca3af', lineHeight: 1.7, margin: '0 0 1rem' } as React.CSSProperties,
  badge: { display: 'inline-block', fontSize: '0.6875rem', fontWeight: 600, color: G, background: '#052e16', border: '1px solid #065f46', padding: '0.15rem 0.5rem', borderRadius: 4, fontFamily: 'monospace', marginLeft: '0.5rem', verticalAlign: 'middle' } as React.CSSProperties,
};

type Tool = {
  name: string;
  desc: string;
  params?: { name: string; type: string; required: boolean; desc: string }[];
};

const surfaces: { label: string; color: string; slug: string; intro: string; tools: Tool[] }[] = [
  {
    label: 'Governed Mandates',
    color: G,
    slug: 'mandates',
    intro: 'Mandates are the safety layer for autonomous agents. The agent proposes an objective and budget cap; the principal approves once; AgentPay enforces automatically through the full create → plan → approve → execute lifecycle.',
    tools: [
      {
        name: 'agentpay_create_mandate',
        desc: 'Create a governed mandate and auto-trigger the planning step. Returns a mandate record with status, AI-generated recommendation, and approval requirement.',
        params: [
          { name: 'principalId', type: 'string', required: true, desc: 'The human principal who owns the mandate and holds approval authority' },
          { name: 'operatorId', type: 'string', required: true, desc: 'The agent or operator initiating the mandate' },
          { name: 'objective', type: 'string', required: true, desc: 'Outcome-oriented plain-language description of what should happen' },
          { name: 'source', type: 'string', required: false, desc: '"direct_human" or "delegated_agent" (default: delegated_agent)' },
          { name: 'constraints', type: 'object', required: false, desc: 'Execution constraints — e.g. { budgetMax: 5000 } in pence/cents' },
          { name: 'mandate', type: 'object', required: false, desc: 'Policy — e.g. { amountPence: 5000, currency: "GBP", autoApproveAmountPence: 2000, approvalMethod: "inline" }' },
        ],
      },
      {
        name: 'agentpay_approve_mandate',
        desc: 'Approve a mandate in awaiting_approval state. Transitions to approved so execution can begin.',
        params: [
          { name: 'intentId', type: 'string', required: true, desc: 'Mandate ID to approve' },
          { name: 'actorId', type: 'string', required: false, desc: 'Operator or principal ID recording who approved' },
          { name: 'approvalToken', type: 'string', required: false, desc: 'Ephemeral token from a linked approval session' },
        ],
      },
      {
        name: 'agentpay_execute_mandate',
        desc: 'Start execution of an approved mandate. Returns execution state and journey session ID.',
        params: [
          { name: 'intentId', type: 'string', required: true, desc: 'Mandate ID to execute' },
          { name: 'actorId', type: 'string', required: false, desc: 'Agent/operator identifier starting execution' },
          { name: 'jobId', type: 'string', required: false, desc: 'Optional downstream execution job ID' },
        ],
      },
      {
        name: 'agentpay_get_mandate',
        desc: 'Fetch the full mandate record including current status, approval state, recommendation, and latest journey state.',
        params: [
          { name: 'intentId', type: 'string', required: true, desc: 'Mandate ID to fetch' },
        ],
      },
      {
        name: 'agentpay_get_mandate_journey_status',
        desc: 'Fetch the live journey or execution session status for a mandate that is currently executing. If no journey session exists yet, that is expected until downstream dispatch starts.',
        params: [
          { name: 'intentId', type: 'string', required: true, desc: 'Mandate ID' },
        ],
      },
      {
        name: 'agentpay_get_mandate_history',
        desc: 'Fetch the append-only audit timeline for a mandate — all state transitions, approvals, and execution events.',
        params: [
          { name: 'intentId', type: 'string', required: true, desc: 'Mandate ID' },
        ],
      },
      {
        name: 'agentpay_cancel_mandate',
        desc: 'Cancel or revoke a mandate that has not yet started executing. Audit trail is preserved.',
        params: [
          { name: 'intentId', type: 'string', required: true, desc: 'Mandate ID to cancel' },
          { name: 'actorId', type: 'string', required: false, desc: 'Who is cancelling — for audit trail' },
          { name: 'reason', type: 'string', required: false, desc: 'Optional cancellation reason' },
        ],
      },
    ],
  },
  {
    label: 'Capability Vault',
    color: '#38bdf8',
    slug: 'capabilities',
    intro: 'The Capability Vault lets agents call external APIs (Firecrawl, Perplexity, OpenAI, Browserbase…) without ever seeing the raw API key. The user vaults the key once via a secure connect flow; all future calls proxy through AgentPay.',
    tools: [
      {
        name: 'agentpay_list_capability_providers',
        desc: 'List the governed external capability catalog — all providers AgentPay can vault and proxy.',
      },
      {
        name: 'agentpay_request_capability_connect',
        desc: 'Start a secure connect session for a capability provider. Returns a connectUrl the user opens to vault their API key. The agent never sees the raw credential.',
        params: [
          { name: 'provider', type: 'string', required: true, desc: 'Provider slug — firecrawl, perplexity, openai, tavily, exa, browserbase, serper, google_maps, etc.' },
          { name: 'capabilityKey', type: 'string', required: true, desc: 'Stable merchant-scoped identifier for this capability, e.g. "firecrawl_primary"' },
          { name: 'subjectType', type: 'string', required: true, desc: '"merchant", "principal", "agent", or "workspace"' },
          { name: 'subjectRef', type: 'string', required: true, desc: 'ID of the owning merchant, principal, agent, or workspace' },
          { name: 'baseUrl', type: 'string', required: false, desc: 'Base URL — implied by provider preset if omitted' },
          { name: 'allowedHosts', type: 'string[]', required: false, desc: 'Allowed upstream hosts — implied by preset if omitted' },
          { name: 'authScheme', type: 'string', required: false, desc: '"bearer", "x_api_key", or "basic" — implied by preset' },
          { name: 'credentialKind', type: 'string', required: false, desc: '"api_key", "bearer_token", or "basic_auth" — implied by preset' },
          { name: 'freeCalls', type: 'number', required: false, desc: 'Free-call quota before paid usage approval is required' },
        ],
      },
      {
        name: 'agentpay_list_capabilities',
        desc: 'List all capabilities already connected for your merchant account.',
        params: [
          { name: 'merchantId', type: 'string', required: true, desc: 'Your merchant ID' },
        ],
      },
      {
        name: 'agentpay_get_capability',
        desc: 'Fetch metadata for a single connected capability.',
        params: [
          { name: 'capabilityId', type: 'string', required: true, desc: 'Capability ID to fetch' },
        ],
      },
      {
        name: 'agentpay_execute_capability',
        desc: 'Execute an upstream API call through the governed proxy. AgentPay injects the vaulted credential, enforces the allowlisted host, and returns approval_required once the spend allowance is exhausted.',
        params: [
          { name: 'capabilityId', type: 'string', required: true, desc: 'Connected capability ID' },
          { name: 'endpoint', type: 'string', required: true, desc: 'Upstream path to call (e.g. /v1/scrape)' },
          { name: 'method', type: 'string', required: false, desc: 'HTTP method (default: POST)' },
          { name: 'body', type: 'object', required: false, desc: 'Request body forwarded to the upstream API' },
        ],
      },
    ],
  },
  {
    label: 'Payments & Funding',
    color: '#a78bfa',
    slug: 'payments',
    intro: 'Tools for inline human funding — Stripe Checkout (card) and Razorpay (UPI) — and for vaulting reusable payment methods so governed mandates can charge without re-prompting.',
    tools: [
      {
        name: 'agentpay_create_human_funding_request',
        desc: 'Create a host-native human funding request. Returns a nextAction payload with a Stripe Checkout URL (card) or UPI QR/deep-link the host can render inline. The human pays without leaving the chat.',
        params: [
          { name: 'amount', type: 'number', required: true, desc: 'Amount to request' },
          { name: 'currency', type: 'string', required: true, desc: 'Currency code (GBP, USD, INR…)' },
          { name: 'description', type: 'string', required: false, desc: 'What this payment is for' },
          { name: 'merchantId', type: 'string', required: true, desc: 'Your merchant ID' },
          { name: 'preferredMethod', type: 'string', required: false, desc: 'card or upi (default: card)' },
        ],
      },
      {
        name: 'agentpay_create_funding_setup_intent',
        desc: 'Create a reusable Stripe funding setup intent so the principal can save a card for future governed spending.',
        params: [
          { name: 'principalId', type: 'string', required: true, desc: 'Principal/user ID to attach the card to' },
          { name: 'merchantId', type: 'string', required: true, desc: 'Your merchant ID' },
        ],
      },
      {
        name: 'agentpay_confirm_funding_setup',
        desc: 'Confirm a completed Stripe funding setup and persist the saved payment method.',
        params: [
          { name: 'setupIntentId', type: 'string', required: true, desc: 'Stripe Setup Intent ID to confirm' },
        ],
      },
      {
        name: 'agentpay_list_funding_methods',
        desc: 'List all saved funding methods for a principal.',
        params: [
          { name: 'principalId', type: 'string', required: true, desc: 'Principal ID' },
        ],
      },
      {
        name: 'agentpay_create_payment_intent',
        desc: 'Create a USDC payment intent and return a Solana Pay URI.',
        params: [
          { name: 'amount', type: 'number', required: true, desc: 'Amount in USD' },
          { name: 'description', type: 'string', required: false, desc: 'Payment description' },
          { name: 'merchantId', type: 'string', required: true, desc: 'Your merchant ID' },
        ],
      },
      {
        name: 'agentpay_get_intent_status',
        desc: 'Check whether a payment has been confirmed on-chain.',
        params: [
          { name: 'intentId', type: 'string', required: true, desc: 'Payment intent ID' },
        ],
      },
      {
        name: 'agentpay_get_receipt',
        desc: 'Get the full settlement receipt for a completed payment.',
        params: [
          { name: 'intentId', type: 'string', required: true, desc: 'Payment or mandate ID' },
        ],
      },
      {
        name: 'agentpay_parse_upi_payment_request',
        desc: 'Parse and normalize a raw upi://pay URI or decoded QR payload. Returns payee, amount, reference, and all standard fields.',
        params: [
          { name: 'upiUri', type: 'string', required: true, desc: 'Raw upi://pay URI or decoded QR string' },
        ],
      },
    ],
  },
  {
    label: 'Identity & AgentPassport',
    color: '#fb923c',
    slug: 'identity',
    intro: 'AgentPassport is portable agent identity — trust score, linked accounts, phone verification, and credential attestations that travel across platforms.',
    tools: [
      {
        name: 'agentpay_get_passport',
        desc: 'Look up an agent\'s trust score, interaction history, and linked identities.',
        params: [
          { name: 'agentId', type: 'string', required: true, desc: 'Agent ID (agt_… or string identifier)' },
        ],
      },
      {
        name: 'agentpay_get_identity_bundle',
        desc: 'Fetch the portable identity bundle for an agent — verified identities, linked accounts, and trust state.',
        params: [
          { name: 'agentId', type: 'string', required: true, desc: 'Agent ID' },
        ],
      },
      {
        name: 'agentpay_verify_identity_bundle',
        desc: 'Verify an agent identity and issue a credential.',
        params: [
          { name: 'agentId', type: 'string', required: true, desc: 'Agent ID to verify' },
        ],
      },
      {
        name: 'agentpay_verify_identity_credential',
        desc: 'Verify an already-issued identity credential.',
        params: [
          { name: 'credentialId', type: 'string', required: true, desc: 'Credential ID to verify' },
        ],
      },
      {
        name: 'agentpay_link_identity_bundles',
        desc: 'Link two agent identities together in the trust graph.',
        params: [
          { name: 'agentId', type: 'string', required: true, desc: 'Primary agent ID' },
          { name: 'linkedAgentId', type: 'string', required: true, desc: 'Agent ID to link' },
        ],
      },
      {
        name: 'agentpay_start_identity_phone_verification',
        desc: 'Start a phone verification challenge for an agent identity.',
        params: [
          { name: 'agentId', type: 'string', required: true, desc: 'Agent ID' },
          { name: 'phoneNumber', type: 'string', required: true, desc: 'E.164 phone number' },
        ],
      },
      {
        name: 'agentpay_confirm_identity_phone_verification',
        desc: 'Confirm a phone verification challenge with the OTP code.',
        params: [
          { name: 'agentId', type: 'string', required: true, desc: 'Agent ID' },
          { name: 'verificationId', type: 'string', required: true, desc: 'Verification ID from start step' },
          { name: 'code', type: 'string', required: true, desc: 'OTP code from SMS' },
        ],
      },
      {
        name: 'agentpay_provision_identity_inbox',
        desc: 'Provision or return a portable agent inbox. Returns an inbox address the agent can use to send and receive messages across platforms.',
        params: [
          { name: 'agentId', type: 'string', required: true, desc: 'Agent ID' },
        ],
      },
      {
        name: 'agentpay_send_identity_inbox_message',
        desc: 'Send a message from a provisioned agent inbox.',
        params: [
          { name: 'agentId', type: 'string', required: true, desc: 'Sending agent ID' },
          { name: 'to', type: 'string', required: true, desc: 'Recipient address or agent ID' },
          { name: 'body', type: 'string', required: true, desc: 'Message body' },
        ],
      },
      {
        name: 'agentpay_list_identity_inbox_messages',
        desc: 'List recent inbox messages for an agent.',
        params: [
          { name: 'agentId', type: 'string', required: true, desc: 'Agent ID' },
          { name: 'limit', type: 'number', required: false, desc: 'Number of messages to return (default: 10)' },
        ],
      },
    ],
  },
  {
    label: 'Agent Registry',
    color: '#e879f9',
    slug: 'registry',
    intro: 'Register agents on the AgentPay network, discover other agents, and fetch public identity records.',
    tools: [
      {
        name: 'agentpay_register_agent',
        desc: 'Register a new AI agent on the AgentPay network. Returns an agent ID and public identity record.',
        params: [
          { name: 'name', type: 'string', required: true, desc: 'Agent display name' },
          { name: 'description', type: 'string', required: false, desc: 'What this agent does' },
          { name: 'merchantId', type: 'string', required: true, desc: 'Owning merchant ID' },
        ],
      },
      {
        name: 'agentpay_get_agent',
        desc: 'Look up a registered agent\'s public identity record.',
        params: [
          { name: 'agentId', type: 'string', required: true, desc: 'Agent ID to look up' },
        ],
      },
      {
        name: 'agentpay_discover_agents',
        desc: 'Search and filter agents on the network by capability, trust level, or name.',
        params: [
          { name: 'query', type: 'string', required: false, desc: 'Search query' },
          { name: 'capability', type: 'string', required: false, desc: 'Filter by capability (e.g. travel, finance)' },
          { name: 'limit', type: 'number', required: false, desc: 'Results to return (default: 20)' },
        ],
      },
      {
        name: 'agentpay_get_merchant_stats',
        desc: 'Get your account\'s payment and mandate statistics.',
        params: [
          { name: 'merchantId', type: 'string', required: true, desc: 'Your merchant ID' },
        ],
      },
    ],
  },
];

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 8, padding: '1.25rem', marginBottom: '0.75rem' }}>
      <code style={{ color: G, fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 600 }}>{tool.name}</code>
      <p style={{ color: '#9ca3af', fontSize: '0.875rem', lineHeight: 1.6, margin: '0.5rem 0 0' }}>{tool.desc}</p>
      {tool.params && tool.params.length > 0 && (
        <div style={{ marginTop: '0.875rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.8125rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' as const, color: '#4b5563', fontWeight: 600, padding: '0.25rem 0.5rem 0.25rem 0', borderBottom: '1px solid #1f1f1f' }}>param</th>
                <th style={{ textAlign: 'left' as const, color: '#4b5563', fontWeight: 600, padding: '0.25rem 0.5rem', borderBottom: '1px solid #1f1f1f' }}>type</th>
                <th style={{ textAlign: 'left' as const, color: '#4b5563', fontWeight: 600, padding: '0.25rem 0.5rem', borderBottom: '1px solid #1f1f1f' }}>req</th>
                <th style={{ textAlign: 'left' as const, color: '#4b5563', fontWeight: 600, padding: '0.25rem 0', borderBottom: '1px solid #1f1f1f' }}>description</th>
              </tr>
            </thead>
            <tbody>
              {tool.params.map(p => (
                <tr key={p.name}>
                  <td style={{ padding: '0.375rem 0.5rem 0.375rem 0', borderBottom: '1px solid #111' }}><code style={{ color: '#e5e7eb', fontFamily: 'monospace' }}>{p.name}</code></td>
                  <td style={{ padding: '0.375rem 0.5rem', borderBottom: '1px solid #111', color: '#6b7280', fontFamily: 'monospace' }}>{p.type}</td>
                  <td style={{ padding: '0.375rem 0.5rem', borderBottom: '1px solid #111', color: p.required ? G : '#4b5563' }}>{p.required ? 'yes' : 'no'}</td>
                  <td style={{ padding: '0.375rem 0', borderBottom: '1px solid #111', color: '#9ca3af' }}>{p.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function McpPage() {
  return (
    <>
      <h1 style={S.h1}>MCP Server</h1>
      <p style={S.lead}>
        Drop AgentPay into Claude Desktop or any MCP host in 30 seconds. 30+ tools across mandates, credentials, payments, and identity — no infrastructure to build.
      </p>

      {/* Quick install */}
      <div style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 8, padding: '1.25rem 1.5rem', marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600 }}>Install</div>
        <Code lang="bash">{`npx -y @agentpayxyz/mcp-server`}</Code>
      </div>

      {/* Claude Desktop config */}
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#e5e7eb', marginBottom: '0.75rem' }}>Claude Desktop config</div>
        <p style={{ ...S.p, fontSize: '0.875rem' }}>
          Edit <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) or <code>%APPDATA%\Claude\claude_desktop_config.json</code> (Windows):
        </p>
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
        <p style={{ ...S.p, fontSize: '0.875rem' }}>
          Get your API key:{' '}
          <a href="https://api.agentpay.so/api/merchants/register" target="_blank" rel="noopener noreferrer" style={{ color: G }}>
            POST /api/merchants/register
          </a>
          {' '}— register with one curl call, no Stripe or wallet needed.
        </p>
      </div>

      {/* Remote MCP */}
      <div style={{ background: '#0a1a12', border: '1px solid #065f46', borderRadius: 8, padding: '1.25rem 1.5rem', marginBottom: '3rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600 }}>Remote MCP (no local process)</div>
        <code style={{ color: G, fontSize: '0.9375rem', fontFamily: 'monospace', display: 'block', marginBottom: '0.5rem' }}>https://api.agentpay.so/api/mcp</code>
        <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>Pass your API key as <code>Authorization: Bearer apk_...</code></span>
        <div style={{ marginTop: '1rem' }}>
          <Code lang="bash">{`# Mint a short-lived token (useful for OpenAI / Anthropic remote MCP)
curl -X POST https://api.agentpay.so/api/mcp/tokens \\
  -H "Authorization: Bearer apk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"audience":"openai","ttlSeconds":3600}'`}</Code>
        </div>
      </div>

      {/* Jump links */}
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '0.5rem', marginBottom: '3rem' }}>
        {surfaces.map(s => (
          <a key={s.slug} href={`#${s.slug}`} style={{ fontSize: '0.8125rem', fontWeight: 600, color: s.color, background: '#111', border: '1px solid #1f1f1f', padding: '0.35rem 0.875rem', borderRadius: 20, textDecoration: 'none' }}>
            {s.label}
          </a>
        ))}
      </div>

      {/* Tool surfaces */}
      {surfaces.map(surface => (
        <div key={surface.slug} id={surface.slug} style={{ scrollMarginTop: 80 }}>
          <h2 style={{ ...S.h2, color: surface.color, borderTopColor: '#1a1a1a' }}>{surface.label}</h2>
          <p style={S.p}>{surface.intro}</p>
          <div style={{ marginTop: '1.5rem' }}>
            {surface.tools.map(tool => (
              <ToolCard key={tool.name} tool={tool} />
            ))}
          </div>
        </div>
      ))}

      {/* Environment variables */}
      <div id="env" style={{ scrollMarginTop: 80, marginTop: '3rem', paddingTop: '3rem', borderTop: '2px solid #1a1a1a' }}>
        <h2 style={{ ...S.h2, borderTop: 'none', paddingTop: 0, marginTop: 0 }}>Environment variables</h2>
        <div style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1f1f1f' }}>
                <th style={{ textAlign: 'left' as const, padding: '0.75rem 1.25rem', color: '#4b5563', fontWeight: 600 }}>variable</th>
                <th style={{ textAlign: 'left' as const, padding: '0.75rem 1.25rem', color: '#4b5563', fontWeight: 600 }}>required</th>
                <th style={{ textAlign: 'left' as const, padding: '0.75rem 1.25rem', color: '#4b5563', fontWeight: 600 }}>description</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'AGENTPAY_API_KEY', req: true, desc: 'Your merchant API key (apk_…)' },
                { name: 'AGENTPAY_MERCHANT_ID', req: false, desc: 'Your merchant ID (mer_…). Recommended — used in mandate and capability calls.' },
                { name: 'AGENTPAY_API_URL', req: false, desc: 'Override the API base URL. Defaults to the production Workers endpoint.' },
              ].map((row, i) => (
                <tr key={row.name} style={{ borderBottom: i < 2 ? '1px solid #111' : 'none' }}>
                  <td style={{ padding: '0.75rem 1.25rem' }}><code style={{ color: G, fontFamily: 'monospace' }}>{row.name}</code></td>
                  <td style={{ padding: '0.75rem 1.25rem', color: row.req ? G : '#4b5563' }}>{row.req ? 'yes' : 'no'}</td>
                  <td style={{ padding: '0.75rem 1.25rem', color: '#9ca3af' }}>{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Example Claude prompts */}
      <div style={{ marginTop: '3rem', paddingTop: '3rem', borderTop: '2px solid #1a1a1a' }}>
        <h2 style={{ ...S.h2, borderTop: 'none', paddingTop: 0, marginTop: 0 }}>Example prompts</h2>
        <p style={S.p}>Once configured, ask Claude any of these to exercise the full tool surface:</p>
        <div style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 8, padding: '1.25rem 1.5rem', fontFamily: 'monospace', fontSize: '0.875rem', lineHeight: 2.25, color: '#9ca3af' }}>
          {[
            'Create a governed mandate to book a train London to Bristol, budget £100, require my approval above £50.',
            'Connect Firecrawl without exposing the raw API key to the agent.',
            'Run a Firecrawl scrape through the connected capability.',
            'Create a £49 card payment request so the human can pay without leaving the chat.',
            'Create a ₹499 UPI funding request.',
            'Look up the AgentPassport for agent_001.',
            'Provision an inbox for agent_001 and send a message to traveler@example.com.',
            'List all mandates and their current status.',
            'Show me the audit timeline for mandate mnd_abc123.',
          ].map(prompt => (
            <div key={prompt}><span style={{ color: '#6b7280' }}>&gt; </span>&ldquo;{prompt}&rdquo;</div>
          ))}
        </div>
      </div>

      {/* Next steps */}
      <div style={{ marginTop: '3.5rem', paddingTop: '2rem', borderTop: '1px solid #1a1a1a', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
        {[
          { href: '/quickstart', title: 'Quickstart', desc: 'MCP in 2 min, REST in 5 min' },
          { href: '/adapters', title: 'Adapters', desc: 'OpenAI, LangChain, Vercel AI SDK' },
          { href: '/passport', title: 'AgentPassport', desc: 'Portable identity and trust' },
          { href: '/pricing', title: 'Pricing', desc: 'Launch free · Builder $39 · Growth $149' },
        ].map(({ href, title, desc }) => (
          <Link key={href} href={href} style={{ display: 'block', background: '#111', border: '1px solid #1f1f1f', borderRadius: 8, padding: '1rem 1.25rem', textDecoration: 'none' }}>
            <div style={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}>{title} →</div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>{desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
