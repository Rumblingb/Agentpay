import type { Metadata } from 'next';
import './globals.css';
import Nav from '../components/Nav';

export const metadata: Metadata = {
  title: { default: 'AgentPay Docs', template: '%s - AgentPay Docs' },
  description: 'Zero API key vaulting, governed mandates, and payment infrastructure for AI agents.',
  metadataBase: new URL('https://docs.agentpay.so'),
  openGraph: {
    siteName: 'AgentPay Docs',
    type: 'website',
    title: 'AgentPay Docs',
    description: 'Install AgentPay in minutes with MCP, build against the REST API, and ship governed paid agents.',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'AgentPay Docs',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgentPay Docs',
    description: 'Quickstart, runnable examples, MCP tools, and hosted agent payments.',
    images: ['/opengraph-image'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 1.5rem 6rem' }}>
          {children}
        </main>
        <footer
          style={{
            borderTop: '1px solid #1f1f1f',
            padding: '2rem 1.5rem',
            textAlign: 'center',
            fontSize: '0.8125rem',
            color: '#4b5563',
          }}
        >
          AgentPay - docs.agentpay.so -{' '}
          <a href="https://app.agentpay.so" style={{ color: '#6b7280', textDecoration: 'none' }}>Dashboard</a>
          {' · '}
          <a href="https://api.agentpay.so" style={{ color: '#6b7280', textDecoration: 'none' }}>API</a>
        </footer>
      </body>
    </html>
  );
}
