import type { Metadata } from 'next';
import './globals.css';
import Nav from '../components/Nav';

export const metadata: Metadata = {
  title: { default: 'AgentPay Docs', template: '%s — AgentPay Docs' },
  description: 'Payments, trust, and identity infrastructure for AI agents.',
  metadataBase: new URL('https://docs.agentpay.so'),
  openGraph: {
    siteName: 'AgentPay Docs',
    type: 'website',
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
          AgentPay &mdash; docs.agentpay.so &mdash;{' '}
          <a href="https://app.agentpay.so" style={{ color: '#6b7280', textDecoration: 'none' }}>Dashboard</a>
          {' · '}
          <a href="https://api.agentpay.so" style={{ color: '#6b7280', textDecoration: 'none' }}>API</a>
        </footer>
      </body>
    </html>
  );
}
