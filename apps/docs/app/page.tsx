import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'AgentPay Docs',
  description: 'Codex-native MCP for secret-safe capability access, governed spending, and exact-call resume for AI agents.',
};

const cards = [
  {
    href: '/mcp',
    title: 'MCP Server',
    desc: 'Give Codex, Claude, and other MCP hosts governed tools for Leak Guard, capability access, paid execution, and exact-call resume.',
    badge: 'npx -y @agentpayxyz/mcp-server',
    primary: true,
  },
  {
    href: '/examples#codex-agentpay-mcp-demo',
    title: 'Codex MCP Demo',
    desc: 'A complete agent loop: scan leaked secrets, buy market_data under a $5 limit, pause for approval, then resume the stored call.',
    badge: 'npm run demo:codex-agentpay-mcp',
    primary: true,
  },
  {
    href: '/quickstart',
    title: 'Quickstart',
    desc: 'MCP in 2 minutes. REST API in 5 minutes. Hosted edge first, local dev later.',
    badge: 'Start here',
    primary: false,
  },
  {
    href: '/examples',
    title: 'Examples',
    desc: 'Runnable flows for paid research agents, capability-vault demos, and Codex-native MCP proof.',
    badge: 'Working code',
    primary: false,
  },
  {
    href: '/adapters',
    title: 'Adapters',
    desc: 'Drop-in wrappers for OpenAI function calling, LangChain, and Vercel AI SDK.',
    badge: '@agentpayxyz/adapters',
    primary: false,
  },
  {
    href: '/passport',
    title: 'AgentPassport',
    desc: 'Portable identity with trust graph, linked accounts, and verified attestations.',
    badge: 'Trust layer',
    primary: false,
  },
  {
    href: '/pricing',
    title: 'Pricing',
    desc: 'Launch tier free. Builder $39/mo. Growth $149/mo. 0.75% on funded actions.',
    badge: 'Transparent',
    primary: false,
  },
];

const G = '#10b981';

export default function Home() {
  return (
    <>
      <section className="hero-grid" style={{ marginBottom: '3.5rem' }}>
        <div>
          <div style={{ display: 'inline-block', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: G, background: '#052e16', border: '1px solid #065f46', padding: '0.3rem 0.75rem', borderRadius: 20, marginBottom: '1.25rem' }}>
            Codex-native MCP
          </div>
          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.35rem)', fontWeight: 800, lineHeight: 1.06, letterSpacing: 0, margin: '0 0 1rem' }}>
            Let agents buy APIs,
            <br />
            handle secrets,
            <br />
            <span style={{ color: G }}>and resume work safely.</span>
          </h1>
          <p style={{ fontSize: '1.125rem', color: '#9ca3af', maxWidth: 680, lineHeight: 1.7, margin: 0 }}>
            AgentPay is the authority layer between AI agents and the real world: Leak Guard, capability vaulting,
            governed spending, human approval, and exact-call resume through one MCP surface.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.75rem', flexWrap: 'wrap' as const }}>
          <Link href="/mcp" style={{ display: 'inline-block', background: G, color: '#000', fontWeight: 700, fontSize: '0.9375rem', padding: '0.75rem 1.5rem', borderRadius: 8, textDecoration: 'none' }}>
            MCP server {"->"}
          </Link>
          <Link href="/examples#codex-agentpay-mcp-demo" style={{ display: 'inline-block', background: 'transparent', color: '#e5e7eb', fontWeight: 600, fontSize: '0.9375rem', padding: '0.75rem 1.5rem', borderRadius: 8, textDecoration: 'none', border: '1px solid #1f1f1f' }}>
            Watch demo
          </Link>
          <Link href="/quickstart" style={{ display: 'inline-block', background: 'transparent', color: '#e5e7eb', fontWeight: 600, fontSize: '0.9375rem', padding: '0.75rem 1.5rem', borderRadius: 8, textDecoration: 'none', border: '1px solid #1f1f1f' }}>
            Quickstart
          </Link>
          <a href="https://api.agentpay.so/api/merchants/register" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'transparent', color: '#6b7280', fontWeight: 600, fontSize: '0.9375rem', padding: '0.75rem 1.5rem', borderRadius: 8, textDecoration: 'none', border: '1px solid #1f1f1f' }}>
            Get API key
          </a>
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <video
            src="/demo/agentpay-codex-mcp-agentic-clean-16x9.mp4"
            controls
            muted
            playsInline
            preload="none"
            poster="/demo/agentpay-codex-mcp-agentic-poster.png"
            style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', background: '#050505', border: '1px solid #1f1f1f', borderRadius: 8, display: 'block' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
            {[
              ['Leak Guard', 'no raw secrets'],
              ['Buy API', 'market_data < $5'],
              ['Resume', 'exact-call token'],
            ].map(([label, value]) => (
              <div key={label} style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 8, padding: '0.85rem' }}>
                <div style={{ color: '#6b7280', fontSize: '0.72rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 700 }}>{label}</div>
                <div style={{ color: '#e5e7eb', fontSize: '0.82rem', marginTop: '0.35rem', fontFamily: 'monospace', overflowWrap: 'anywhere' as const }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '2.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' as const }}>
        <code style={{ color: G, fontSize: '0.9375rem', fontFamily: 'monospace' }}>npx -y @agentpayxyz/mcp-server</code>
        <span style={{ color: '#4b5563', fontSize: '0.875rem' }}>or remote MCP at</span>
        <code style={{ color: '#38bdf8', fontSize: '0.875rem', fontFamily: 'monospace' }}>https://api.agentpay.so/api/mcp</code>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '1rem' }}>
        {cards.map(({ href, title, desc, badge, primary }) => (
          <Link
            key={`home-card:${title}:${href}`}
            href={href}
            style={{
              display: 'block',
              background: primary ? '#0d1f17' : '#111',
              border: `1px solid ${primary ? '#065f46' : '#1f1f1f'}`,
              borderRadius: 10,
              padding: '1.5rem',
              textDecoration: 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <span style={{ fontWeight: 700, fontSize: '1rem', color: '#fff' }}>{title}</span>
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: G, background: '#052e16', border: '1px solid #065f46', padding: '0.2rem 0.5rem', borderRadius: 4, fontFamily: 'monospace', whiteSpace: 'nowrap' as const, marginLeft: '0.75rem' }}>
                {badge}
              </span>
            </div>
            <p style={{ color: '#9ca3af', fontSize: '0.9375rem', margin: 0, lineHeight: 1.65 }}>{desc}</p>
          </Link>
        ))}
      </div>

      <div style={{ marginTop: '3rem', background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 8, padding: '1.25rem 1.5rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600 }}>API base URL</div>
        <code style={{ color: '#34d399', fontSize: '0.9375rem' }}>https://api.agentpay.so</code>
        <span style={{ color: '#4b5563', fontSize: '0.875rem', marginLeft: '1rem' }}>- Cloudflare Workers edge, globally distributed</span>
      </div>
    </>
  );
}
