import type { Metadata } from 'next';
import Code from '../../components/Code';

export const metadata: Metadata = {
  title: 'Examples',
  description: 'Runnable examples for Codex MCP, paid research agents, capability-vault flows, and funded actions.',
};

const G = '#10b981';

const examples = [
  {
    title: 'Codex + AgentPay MCP agentic demo',
    desc: 'Runs the real AgentPay MCP stdio server against a safe local mock API: leak scan, governed market_data access, setup resume, paid execution resume.',
    run: `npm run demo:codex-agentpay-mcp`,
  },
  {
    title: 'Research agent',
    desc: 'Search, summarize, and bill via a governed mandate.',
    run: `cd examples/agents/ResearchAgent\nnpm install\nAGENTPAY_API_KEY=apk_... AGENTPAY_MERCHANT_ID=mer_... node server.js`,
  },
  {
    title: 'Capability Vault demo',
    desc: 'Run a full create -> approve -> execute flow against the live API.',
    run: `cd examples/adapters\nnpm install\nAGENTPAY_API_KEY=apk_... npx tsx semiLiveDemo.ts`,
  },
  {
    title: 'Node backend agent',
    desc: 'Minimal backend that registers as a paid agent service.',
    run: `cd examples/node-backend-agent\nnpm install\nAGENTPAY_API_KEY=apk_... AGENTPAY_MERCHANT_ID=mer_... node index.js`,
  },
];

export default function ExamplesPage() {
  return (
    <>
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'inline-block', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: G, background: '#052e16', border: '1px solid #065f46', padding: '0.3rem 0.75rem', borderRadius: 20, marginBottom: '1rem' }}>
          Runnable Examples
        </div>
        <h1 style={{ fontSize: 'clamp(1.9rem, 4vw, 2.75rem)', fontWeight: 800, lineHeight: 1.15, letterSpacing: 0, margin: '0 0 1rem' }}>
          Start from working flows,
          <br />
          not a blank page.
        </h1>
        <p style={{ fontSize: '1.0625rem', color: '#9ca3af', maxWidth: 700, lineHeight: 1.7, margin: 0 }}>
          These examples are the fastest way to see the product wedge in action: Codex-native MCP, zero-key upstream access,
          paid execution, exact-call resume, and receipt trails.
        </p>
      </div>

      <section id="codex-agentpay-mcp-demo" style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 8, padding: '1rem', marginBottom: '2rem', scrollMarginTop: 90 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(260px, 0.9fr)', gap: '1rem', alignItems: 'center' }} className="demo-video-grid">
          <video
            src="/demo/agentpay-codex-mcp-agentic-clean-16x9.mp4"
            controls
            muted
            playsInline
            preload="none"
            poster="/demo/agentpay-codex-mcp-agentic-poster.png"
            style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', background: '#050505', borderRadius: 8, display: 'block' }}
          />
          <div style={{ padding: '0.5rem' }}>
            <div style={{ color: G, fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: '0.75rem' }}>
              Product proof
            </div>
            <h2 style={{ fontSize: '1.35rem', lineHeight: 1.2, margin: '0 0 0.75rem', color: '#fff' }}>
              Codex calls AgentPay MCP, not raw provider keys.
            </h2>
            <p style={{ color: '#9ca3af', lineHeight: 1.65, margin: '0 0 1rem' }}>
              The demo detects a leaked Stripe restricted key, refuses to return the raw secret, acquires governed
              market-data access, pauses for human setup/approval, and resumes the stored call.
            </p>
            <Code lang="bash">{`npm run demo:codex-agentpay-mcp`}</Code>
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gap: '1rem', marginBottom: '2rem' }}>
        {examples.map((example) => (
          <div key={example.title} style={{ background: '#111', border: '1px solid #1f1f1f', borderRadius: 10, padding: '1.25rem 1.5rem' }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fff', marginBottom: '0.35rem' }}>{example.title}</div>
            <p style={{ color: '#9ca3af', lineHeight: 1.7, margin: '0 0 1rem' }}>{example.desc}</p>
            <Code lang="bash">{example.run}</Code>
          </div>
        ))}
      </div>

      <div style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 10, padding: '1.25rem 1.5rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.6rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600 }}>
          Common env vars
        </div>
        <Code lang="bash">{`AGENTPAY_API_KEY=apk_...       # Required\nAGENTPAY_MERCHANT_ID=mer_...   # Recommended\nAGENTPAY_API_URL=...           # Optional override for local dev`}</Code>
      </div>
    </>
  );
}
