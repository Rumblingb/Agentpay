import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AgentPay Docs — Payment infrastructure for AI agents',
  description:
    'Register a merchant, create payment intents, verify Solana settlements, and build portable agent reputation with AgentPassport. 5-minute quickstart.',
};

const API = 'https://api.agentpay.so';

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[#080808] text-[#d4d4d4] font-mono">
      {/* Top bar */}
      <header className="border-b border-[#141414] px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold text-white hover:text-emerald-400 transition">
          AgentPay
        </Link>
        <nav className="flex items-center gap-6 text-xs text-[#737373]">
          <a href="#quickstart" className="hover:text-white transition">Quickstart</a>
          <a href="#sdk" className="hover:text-white transition">SDK</a>
          <a href="#reference" className="hover:text-white transition">Reference</a>
          <a href="#passport" className="hover:text-white transition">AgentPassport</a>
          <a
            href="https://github.com/Rumblingb/Agentpay"
            className="hover:text-white transition"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16 space-y-20">

        {/* Hero */}
        <section className="space-y-4">
          <div className="text-xs uppercase tracking-widest text-emerald-500 font-semibold">
            Developer Documentation
          </div>
          <h1 className="text-3xl font-bold text-white leading-tight">
            Payment infrastructure<br />for autonomous agents
          </h1>
          <p className="text-[#737373] leading-relaxed max-w-xl">
            Create payment intents, verify Solana USDC settlements, and build portable trust through{' '}
            <span className="text-white">AgentPassport</span>. One API. Works with any agent framework.
          </p>
          <div className="flex items-center gap-4 pt-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              <span className="text-xs text-emerald-400">API live at {API}</span>
            </div>
            <span className="text-[#333]">|</span>
            <span className="text-xs text-[#555]">0.5% platform fee · USDC on Solana</span>
          </div>
        </section>

        {/* Quickstart */}
        <section id="quickstart" className="space-y-8">
          <SectionHeader step="01" title="5-Minute Quickstart" />

          <Step n={1} title="Register a merchant account">
            <CodeBlock>{`curl -X POST ${API}/api/merchants/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My Agent App",
    "email": "you@example.com"
  }'

# → { "merchantId": "...", "apiKey": "apk_..." }
# Store your API key — you will not see it again.`}</CodeBlock>
          </Step>

          <Step n={2} title="Create a payment intent">
            <CodeBlock>{`curl -X POST ${API}/api/v1/payment-intents \\
  -H "Content-Type: application/json" \\
  -d '{
    "merchantId": "YOUR_MERCHANT_ID",
    "agentId":    "agent_001",
    "amount":     5,
    "currency":   "USDC",
    "purpose":    "Research task fee"
  }'

# → {
#     "intentId":          "pay_...",
#     "solanaPayUri":      "solana:...",
#     "verificationToken": "vtok_...",
#     "expiresAt":         "..."
#   }`}</CodeBlock>
            <Note>
              Open the <code className="text-emerald-400">solanaPayUri</code> in any Solana wallet (Phantom, Backpack) to pay,
              or send USDC programmatically with the <code className="text-emerald-400">verificationToken</code> as the memo.
            </Note>
          </Step>

          <Step n={3} title="Submit the transaction hash for verification">
            <CodeBlock>{`curl -X POST ${API}/api/v1/payment-intents/INTENT_ID/verify \\
  -H "Content-Type: application/json" \\
  -d '{ "transactionHash": "YOUR_SOLANA_TX_HASH" }'

# → { "status": "verified", "receipt": { ... } }`}</CodeBlock>
          </Step>

          <Step n={4} title="Get the settlement receipt">
            <CodeBlock>{`curl ${API}/api/receipt/INTENT_ID

# → {
#     "intentId":   "pay_...",
#     "amount":     5,
#     "currency":   "USDC",
#     "status":     "verified",
#     "verifiedAt": "...",
#     "agentId":    "agent_001"
#   }`}</CodeBlock>
          </Step>
        </section>

        {/* SDK */}
        <section id="sdk" className="space-y-8">
          <SectionHeader step="02" title="JavaScript / TypeScript SDK" />

          <Step n={1} title="Install">
            <CodeBlock>{`npm install @agentpayxyz/sdk`}</CodeBlock>
          </Step>

          <Step n={2} title="Basic payment flow">
            <CodeBlock>{`import { AgentPay } from '@agentpayxyz/sdk';

const agentpay = new AgentPay({
  baseUrl: '${API}',
  apiKey:  process.env.AGENTPAY_API_KEY,
});

// Create intent and get Solana Pay URI
const payment = await agentpay.pay({
  amount:  5,
  purpose: 'Research task fee',
});
console.log(payment.solanaPayUri); // send this to the payer

// Poll until confirmed
const result = await agentpay.verify(payment.intentId);
console.log(result.status); // 'verified'`}</CodeBlock>
          </Step>

          <Step n={3} title="Split payments">
            <CodeBlock>{`const payment = await agentpay.pay({
  amount:  100,
  purpose: 'Multi-agent task',
  splits: [
    { address: 'AGENT_A_WALLET', bps: 6000 }, // 60%
    { address: 'AGENT_B_WALLET', bps: 4000 }, // 40%
  ],
});
// All bps values must sum to 10000`}</CodeBlock>
          </Step>

          <Step n={4} title="Agent discovery">
            <CodeBlock>{`const results = await agentpay.discover({
  category: 'research',
  minScore: 80,
  sortBy:   'score',
  limit:    10,
});

for (const agent of results.agents) {
  console.log(agent.name, agent.trustScore);
}`}</CodeBlock>
          </Step>
        </section>

        {/* AgentPassport */}
        <section id="passport" className="space-y-8">
          <SectionHeader step="03" title="AgentPassport" />
          <p className="text-[#737373] leading-relaxed">
            AgentPassport is a portable identity and trust record for every agent. It accumulates
            automatically as agents transact through AgentPay. Free to read — for any platform.
          </p>

          <Step n={1} title="Look up any agent's passport">
            <CodeBlock>{`curl ${API}/api/passport/AGENT_ID

# → {
#     "agentId":          "agent_001",
#     "name":             "ResearchAgent",
#     "trustScore":       87,
#     "interactionCount": 142,
#     "successRate":      0.97,
#     "verified":         true,
#     "profileUrl":       "https://agentpay.so/agent/agent_001"
#   }`}</CodeBlock>
          </Step>

          <Step n={2} title="SDK lookup">
            <CodeBlock>{`const passport = await agentpay.getPassport('agent_001');
console.log(passport.trustScore);   // 87
console.log(passport.successRate);  // 0.97
console.log(passport.profileUrl);   // shareable URL`}</CodeBlock>
          </Step>
        </section>

        {/* Framework integrations */}
        <section id="reference" className="space-y-8">
          <SectionHeader step="04" title="Framework Integrations" />

          <div className="grid gap-4">
            {[
              {
                name: 'OpenAI Function Calling',
                path: 'examples/openai-function-calling',
                desc: 'Use AgentPay as a tool in GPT-4o agents',
              },
              {
                name: 'LangGraph',
                path: 'examples/langgraph-payment-node.ts',
                desc: 'Payment node for LangGraph workflows',
              },
              {
                name: 'CrewAI',
                path: 'examples/crewai-agentpay-tool.py',
                desc: 'Python tool for CrewAI task agents',
              },
              {
                name: 'AutoGPT Plugin',
                path: 'examples/autogpt-plugin',
                desc: 'AgentPay plugin for AutoGPT',
              },
              {
                name: 'Node.js Backend Agent',
                path: 'examples/node-backend-agent',
                desc: 'Minimal Node.js payment agent',
              },
            ].map(({ name, path, desc }) => (
              <a
                key={name}
                href={`https://github.com/Rumblingb/Agentpay/tree/main/${path}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start justify-between gap-4 border border-[#1a1a1a] rounded-xl p-4 hover:border-[#2a2a2a] hover:bg-white/[0.02] transition group"
              >
                <div>
                  <p className="text-sm font-semibold text-white group-hover:text-emerald-400 transition">{name}</p>
                  <p className="text-xs text-[#555] mt-0.5">{desc}</p>
                </div>
                <span className="text-[#333] group-hover:text-[#555] transition shrink-0 text-xs pt-0.5">↗</span>
              </a>
            ))}
          </div>
        </section>

        {/* API reference table */}
        <section className="space-y-6">
          <SectionHeader step="05" title="Core Endpoints" />
          <div className="border border-[#141414] rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#141414] bg-[#0d0d0d]">
                  <th className="text-left px-4 py-3 text-[#737373] font-medium">Method</th>
                  <th className="text-left px-4 py-3 text-[#737373] font-medium">Path</th>
                  <th className="text-left px-4 py-3 text-[#737373] font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0d0d0d]">
                {[
                  ['POST', '/api/merchants/register', 'Create merchant account'],
                  ['GET',  '/api/merchants/profile',  'Get profile (auth required)'],
                  ['POST', '/api/merchants/rotate-key', 'Rotate API key'],
                  ['POST', '/api/v1/payment-intents', 'Create payment intent (agent-facing)'],
                  ['GET',  '/api/v1/payment-intents/:id', 'Poll intent status'],
                  ['POST', '/api/v1/payment-intents/:id/verify', 'Submit tx hash'],
                  ['GET',  '/api/receipt/:intentId', 'Get settlement receipt'],
                  ['GET',  '/api/passport/:agentId', 'Get AgentPassport'],
                  ['POST', '/api/intents/fiat', 'Create Stripe fiat intent'],
                  ['GET',  '/api/health', 'API health check'],
                ].map(([method, path, desc]) => (
                  <tr key={path} className="hover:bg-white/[0.01]">
                    <td className="px-4 py-2.5">
                      <span className={`font-bold ${method === 'GET' ? 'text-blue-400' : 'text-emerald-400'}`}>
                        {method}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[#d4d4d4]">{path}</td>
                    <td className="px-4 py-2.5 text-[#555]">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#444]">
            Full OpenAPI spec:{' '}
            <a
              href="https://github.com/Rumblingb/Agentpay/blob/main/openapi.yaml"
              className="text-emerald-500/70 hover:text-emerald-400 transition"
              target="_blank"
              rel="noopener noreferrer"
            >
              openapi.yaml ↗
            </a>
          </p>
        </section>

        {/* Footer */}
        <footer className="border-t border-[#141414] pt-8 flex items-center justify-between text-xs text-[#333]">
          <span>AgentPay · BSL-1.1 · AGPL-3.0 after 2029</span>
          <a
            href="https://github.com/Rumblingb/Agentpay/issues"
            className="hover:text-[#555] transition"
            target="_blank"
            rel="noopener noreferrer"
          >
            Report an issue ↗
          </a>
        </footer>
      </main>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({ step, title }: { step: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-[#333] font-mono">{step}</span>
      <div className="h-px flex-1 bg-[#141414]" />
      <h2 className="text-base font-bold text-white">{title}</h2>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-5 h-5 rounded-full bg-[#141414] text-[#555] text-[10px] flex items-center justify-center font-bold shrink-0">
          {n}
        </span>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="pl-7 space-y-2">{children}</div>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-[#0d0d0d] border border-[#141414] rounded-xl p-4 text-xs text-[#d4d4d4] overflow-x-auto leading-relaxed whitespace-pre">
      {children}
    </pre>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-[#555] leading-relaxed border-l-2 border-[#1a1a1a] pl-3">
      {children}
    </p>
  );
}
