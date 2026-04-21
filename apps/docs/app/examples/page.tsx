import type { Metadata } from 'next';
import Code from '../../components/Code';

export const metadata: Metadata = {
  title: 'Examples - AgentPay Docs',
  description: 'Runnable examples for paid research agents, capability-vault flows, and funded actions.',
};

const G = '#10b981';

const examples = [
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
        <h1 style={{ fontSize: 'clamp(1.9rem, 4vw, 2.75rem)', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.04em', margin: '0 0 1rem' }}>
          Start from working flows,
          <br />
          not a blank page.
        </h1>
        <p style={{ fontSize: '1.0625rem', color: '#9ca3af', maxWidth: 700, lineHeight: 1.7, margin: 0 }}>
          These examples are the fastest way to see the product wedge in action: governed browsing, zero-key upstream access,
          and paid execution with a receipt trail.
        </p>
      </div>

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
