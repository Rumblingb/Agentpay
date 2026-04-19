import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'AgentPay Docs',
  description: 'Zero API key vaulting, governed mandates, and payment infrastructure for AI agents.',
};

const cards = [
  {
    href: '/mcp',
    title: 'MCP Server',
    desc: 'Add AgentPay to Claude Desktop or any MCP host in 30 seconds. 30+ tools across mandates, credentials, and funded actions.',
    badge: 'npx -y @agentpayxyz/mcp-server',
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
    desc: 'Runnable flows for paid research agents, capability-vault demos, and backend services.',
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
      <div style={{ marginBottom: '4rem' }}>
        <div style={{ display: 'inline-block', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: G, background: '#052e16', border: '1px solid #065f46', padding: '0.3rem 0.75rem', borderRadius: 20, marginBottom: '1.25rem' }}>
          Developer Documentation
        </div>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.04em', margin: '0 0 1rem' }}>
          The trust and payment layer
          <br />
          <span style={{ color: G }}>for AI agents.</span>
        </h1>
        <p style={{ fontSize: '1.125rem', color: '#9ca3af', maxWidth: 680, lineHeight: 1.7, margin: 0 }}>
          AgentPay removes the three hard problems that keep agents from acting in the real world: upstream credential
          access, payment authorisation, and settlement proof.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.75rem', flexWrap: 'wrap' as const }}>
          <Link href="/mcp" style={{ display: 'inline-block', background: G, color: '#000', fontWeight: 700, fontSize: '0.9375rem', padding: '0.75rem 1.5rem', borderRadius: 8, textDecoration: 'none' }}>
            MCP server {"->"}
          </Link>
          <Link href="/quickstart" style={{ display: 'inline-block', background: 'transparent', color: '#e5e7eb', fontWeight: 600, fontSize: '0.9375rem', padding: '0.75rem 1.5rem', borderRadius: 8, textDecoration: 'none', border: '1px solid #1f1f1f' }}>
            Quickstart
          </Link>
          <Link href="/examples" style={{ display: 'inline-block', background: 'transparent', color: '#e5e7eb', fontWeight: 600, fontSize: '0.9375rem', padding: '0.75rem 1.5rem', borderRadius: 8, textDecoration: 'none', border: '1px solid #1f1f1f' }}>
            Examples
          </Link>
          <a href="https://api.agentpay.so/api/merchants/register" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'transparent', color: '#6b7280', fontWeight: 600, fontSize: '0.9375rem', padding: '0.75rem 1.5rem', borderRadius: 8, textDecoration: 'none', border: '1px solid #1f1f1f' }}>
            Get API key
          </a>
        </div>
      </div>

      <div style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '2.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' as const }}>
        <code style={{ color: G, fontSize: '0.9375rem', fontFamily: 'monospace' }}>npx -y @agentpayxyz/mcp-server</code>
        <span style={{ color: '#4b5563', fontSize: '0.875rem' }}>or remote MCP at</span>
        <code style={{ color: '#38bdf8', fontSize: '0.875rem', fontFamily: 'monospace' }}>https://api.agentpay.so/api/mcp</code>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1rem' }}>
        {cards.map(({ href, title, desc, badge, primary }) => (
          <Link
            key={href}
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
