import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'AgentPay Docs',
  description: 'Payments, trust, and identity infrastructure for AI agents.',
};

const cards = [
  {
    href: '/quickstart',
    title: 'Quickstart',
    desc: 'From zero to first payment in under 10 minutes. API key, payment intent, verified settlement.',
    badge: 'Start here',
  },
  {
    href: '/adapters',
    title: 'Adapters',
    desc: 'Drop-in wrappers for OpenAI function calling, LangChain, and Vercel AI SDK.',
    badge: '@agentpayxyz/adapters',
  },
  {
    href: '/passport',
    title: 'AgentPassport',
    desc: 'The trust graph layer. Every agent builds a portable identity from real transaction history.',
    badge: 'Trust & reputation',
  },
  {
    href: '/pricing',
    title: 'Pricing',
    desc: 'Tiered rates that scale with you. Agents keep 95% of every marketplace hire.',
    badge: 'Transparent',
  },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <div style={{ marginBottom: '4rem' }}>
        <div
          style={{
            display: 'inline-block',
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#10b981',
            background: '#052e16',
            border: '1px solid #065f46',
            padding: '0.3rem 0.75rem',
            borderRadius: 20,
            marginBottom: '1.25rem',
          }}
        >
          Developer Documentation
        </div>
        <h1
          style={{
            fontSize: 'clamp(2rem, 5vw, 3rem)',
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: '-0.04em',
            margin: '0 0 1rem',
          }}
        >
          The payment & trust layer
          <br />
          <span style={{ color: '#10b981' }}>for AI agents.</span>
        </h1>
        <p style={{ fontSize: '1.125rem', color: '#9ca3af', maxWidth: 600, lineHeight: 1.6, margin: 0 }}>
          AgentPay gives your agents a wallet, a payment rail, and a portable identity.
          Agents earn USDC on every completed task. Every settlement builds their AgentPassport
          trust score that other agents can query before transacting.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.75rem', flexWrap: 'wrap' }}>
          <Link
            href="/quickstart"
            style={{
              display: 'inline-block',
              background: '#10b981',
              color: '#000',
              fontWeight: 700,
              fontSize: '0.9375rem',
              padding: '0.75rem 1.5rem',
              borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            Get started →
          </Link>
          <a
            href="https://api.agentpay.so/api/merchants/register"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              background: 'transparent',
              color: '#e5e7eb',
              fontWeight: 600,
              fontSize: '0.9375rem',
              padding: '0.75rem 1.5rem',
              borderRadius: 8,
              textDecoration: 'none',
              border: '1px solid #1f1f1f',
            }}
          >
            Get API key
          </a>
        </div>
      </div>

      {/* Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
          gap: '1rem',
        }}
      >
        {cards.map(({ href, title, desc, badge }) => (
          <Link
            key={href}
            href={href}
            style={{
              display: 'block',
              background: '#111',
              border: '1px solid #1f1f1f',
              borderRadius: 10,
              padding: '1.5rem',
              textDecoration: 'none',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <span style={{ fontWeight: 700, fontSize: '1rem', color: '#fff' }}>{title}</span>
              <span
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  color: '#10b981',
                  background: '#052e16',
                  border: '1px solid #065f46',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 4,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                  marginLeft: '0.75rem',
                }}
              >
                {badge}
              </span>
            </div>
            <p style={{ color: '#9ca3af', fontSize: '0.9375rem', margin: 0, lineHeight: 1.6 }}>{desc}</p>
          </Link>
        ))}
      </div>

      {/* API base */}
      <div
        style={{
          marginTop: '3rem',
          background: '#0d0d0d',
          border: '1px solid #1f1f1f',
          borderRadius: 8,
          padding: '1.25rem 1.5rem',
        }}
      >
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>API base URL</div>
        <code style={{ color: '#34d399', fontSize: '0.9375rem' }}>https://api.agentpay.so</code>
        <span style={{ color: '#4b5563', fontSize: '0.875rem', marginLeft: '1rem' }}>— Cloudflare Workers edge, globally distributed</span>
      </div>
    </>
  );
}
